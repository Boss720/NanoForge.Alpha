/**
 * Host Daemon WebSocket Client.
 *
 * Connects to a running local agent host over authenticated WebSocket,
 * submits execution plans, handles live NDJSON/event streaming, and
 * enforces fail-closed approval responses.
 */

import WebSocket from "ws";
import type { ExecutionPlan } from "@protocol/plan";
import type { HostMessage } from "../protocol";
import type { RunEvent } from "../runs/events";
import type { RunSummary, RunTerminalState } from "../runs/coordinator";
import { isSafeToolRequest } from "./approval";
import { EXIT_CODES, type AutoApproveMode, type CLIResult, type ExitCode } from "./types";
import { resolveExitCode } from "./exitCodes";

export interface DaemonClientOptions {
  host: string;
  token?: string;
  plan: ExecutionPlan;
  autoApprove?: AutoApproveMode;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  onState?: (state: string, detail?: string) => void;
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

export function normalizeHostUrl(host: string, token?: string): { url: string; token?: string } {
  let raw = host.trim();
  if (!raw.startsWith("ws://") && !raw.startsWith("wss://")) {
    if (raw.startsWith("http://")) {
      raw = "ws://" + raw.slice(7);
    } else if (raw.startsWith("https://")) {
      raw = "wss://" + raw.slice(8);
    } else {
      raw = "ws://" + raw;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid host URL: "${host}"`);
  }

  if (parsed.pathname === "" || parsed.pathname === "/") {
    parsed.pathname = "/agent";
  }

  const resolvedToken = token ?? parsed.searchParams.get("token") ?? undefined;
  if (resolvedToken) {
    parsed.searchParams.set("token", resolvedToken);
  }

  return { url: parsed.toString(), token: resolvedToken };
}

export class DaemonClient {
  static async run(options: DaemonClientOptions): Promise<CLIResult> {
    const { url, token } = normalizeHostUrl(options.host, options.token);

    if (!token) {
      return {
        exitCode: EXIT_CODES.CONFIG_AUTH,
        message: "Authentication token is required to connect to the agent host daemon.",
      };
    }

    const events: RunEvent[] = [];
    let currentRunId: string | undefined;
    let terminalSummary: RunSummary | undefined;
    let terminalReason: string | undefined;
    let approvalDeniedSeen = false;
    let policyDenialSeen = false;

    return new Promise<CLIResult>((resolve) => {
      let ws: WebSocket;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const finish = (result: CLIResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            ws.close();
          }
        } catch {
          // Socket already closed
        }
        resolve(result);
      };

      try {
        ws = new WebSocket(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (err) {
        finish({
          exitCode: EXIT_CODES.CONFIG_AUTH,
          message: `Failed to initialize connection to ${url}: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      if (options.timeoutMs && options.timeoutMs > 0) {
        timer = setTimeout(() => {
          if (currentRunId && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: "run.cancel", runId: currentRunId, reason: "Execution timed out" }));
            } catch {
              // Ignore send error
            }
          }
          finish({
            exitCode: EXIT_CODES.CANCELLED,
            message: `Execution timed out after ${options.timeoutMs}ms`,
            summary: { runId: currentRunId ?? "unknown", status: "cancelled", reason: "timeout" },
            events,
            plan: options.plan,
          });
        }, options.timeoutMs);
      }

      if (options.abortSignal) {
        options.abortSignal.addEventListener("abort", () => {
          if (currentRunId && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: "run.cancel", runId: currentRunId, reason: "Cancelled by user" }));
            } catch {
              // Ignore send error
            }
          }
          finish({
            exitCode: EXIT_CODES.CANCELLED,
            message: "Execution cancelled by user",
            summary: { runId: currentRunId ?? "unknown", status: "cancelled", reason: "cancelled" },
            events,
            plan: options.plan,
          });
        });
      }

      ws.on("error", (err: Error) => {
        finish({
          exitCode: EXIT_CODES.CONFIG_AUTH,
          message: `WebSocket error connecting to ${url}: ${err.message}`,
        });
      });

      ws.on("close", (code: number, reasonBuffer: Buffer) => {
        const reason = reasonBuffer.toString();
        if (code === 4401) {
          finish({
            exitCode: EXIT_CODES.CONFIG_AUTH,
            message: `Unauthorized: Token rejected by agent host (code 4401: ${reason || "unauthorized"})`,
          });
          return;
        }

        if (code === 4400) {
          finish({
            exitCode: EXIT_CODES.FAILURE,
            message: `Invalid protocol message sent to host (code 4400: ${reason || "invalid message"})`,
          });
          return;
        }

        if (!settled) {
          let exitCode: ExitCode = EXIT_CODES.SUCCESS;
          if (terminalSummary) {
            exitCode = resolveExitCode(terminalSummary, events);
          } else if (approvalDeniedSeen) {
            exitCode = EXIT_CODES.APPROVAL_DENIED;
          } else if (policyDenialSeen) {
            exitCode = EXIT_CODES.POLICY_VIOLATION;
          } else {
            exitCode = EXIT_CODES.FAILURE;
          }

          finish({
            exitCode,
            summary: terminalSummary ?? {
              runId: currentRunId ?? "unknown",
              status: (exitCode === EXIT_CODES.SUCCESS ? "completed" : "failed") as RunTerminalState,
              reason: terminalReason,
            },
            events,
            plan: options.plan,
          });
        }
      });

      ws.on("message", (raw: unknown) => {
        let msg: HostMessage;
        try {
          msg = JSON.parse(String(raw)) as HostMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case "host.ready": {
            // Submit the plan upon handshake readiness
            ws.send(JSON.stringify({ type: "plan.submit", plan: options.plan }));
            break;
          }

          case "run.state": {
            currentRunId = msg.runId;
            options.onState?.(msg.state, msg.detail);
            if (msg.state === "done") {
              terminalSummary = { runId: msg.runId, status: "completed" };
            } else if (msg.state === "error") {
              terminalSummary = { runId: msg.runId, status: "failed", reason: msg.detail };
              terminalReason = msg.detail;
            } else if (msg.state === "cancelled") {
              terminalSummary = { runId: msg.runId, status: "cancelled", reason: msg.detail };
              terminalReason = msg.detail;
            }
            break;
          }

          case "run.event": {
            const ev = msg.data as RunEvent;
            if (ev && typeof ev === "object") {
              events.push(ev);
              options.onEvent?.(ev);

              if (ev.type === "policy.decision" && ev.decision === "deny") {
                policyDenialSeen = true;
              }
              if (ev.type === "approval.denied") {
                approvalDeniedSeen = true;
              }
              if (ev.type === "run.completed") {
                terminalSummary = { runId: msg.runId, status: "completed" };
              }
              if (ev.type === "run.failed" || ev.type === "run.halted") {
                terminalSummary = { runId: msg.runId, status: ev.type === "run.halted" ? "halted" : "failed", reason: ev.reason };
                terminalReason = ev.reason;
              }
              if (ev.type === "run.cancelled") {
                terminalSummary = { runId: msg.runId, status: "cancelled", reason: ev.reason };
                terminalReason = ev.reason;
              }
            }
            break;
          }

          case "tool.output": {
            options.onOutput?.(msg.chunk, msg.stream);
            break;
          }

          case "tool.approval_required": {
            const mode = options.autoApprove ?? "none";
            if (mode === "all") {
              ws.send(JSON.stringify({ type: "tool.response", requestId: msg.requestId, approved: true }));
            } else if (mode === "safe") {
              const isSafe = isSafeToolRequest(msg.request);
              if (isSafe) {
                ws.send(JSON.stringify({ type: "tool.response", requestId: msg.requestId, approved: true }));
              } else {
                approvalDeniedSeen = true;
                const reason = `Disallowed by safe auto-approve policy: "${msg.request.executable}" is mutating`;
                ws.send(JSON.stringify({ type: "tool.response", requestId: msg.requestId, approved: false, reason }));
              }
            } else {
              approvalDeniedSeen = true;
              const reason = `Fail-closed non-interactive approval: tool "${msg.request.executable}" requires approval under --auto-approve=none`;
              ws.send(JSON.stringify({ type: "tool.response", requestId: msg.requestId, approved: false, reason }));
            }
            break;
          }

          case "error": {
            terminalReason = msg.message;
            if (msg.code === "unknown_run" || msg.code === "workspace_error") {
              terminalSummary = { runId: msg.runId ?? "unknown", status: "failed", reason: msg.message };
            }
            break;
          }
        }
      });
    });
  }
}
