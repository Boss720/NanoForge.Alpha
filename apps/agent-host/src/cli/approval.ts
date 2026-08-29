/**
 * Non-Interactive Approval Gate & Safety Classification.
 *
 * Enforces fail-closed security for headless runs:
 * - `none`: Every operation requiring approval fails closed immediately (Exit Code 4).
 * - `safe`: Only proven read-only/non-mutating operations are auto-granted; mutating operations fail closed (Exit Code 4).
 * - `all`: All operations requiring approval are granted.
 */

import { authorize, executableBasename, type Policy, type ToolRequest } from "../policy/policy";
import type { ApprovalGate, ApprovalOutcome, ApprovalRequest } from "../runs/coordinator";
import type { AutoApproveMode } from "./types";

const SAFE_READ_ONLY_EXECUTABLES = new Set([
  "ls",
  "dir",
  "cat",
  "type",
  "head",
  "tail",
  "echo",
  "pwd",
  "which",
  "where",
  "find",
  "grep",
  "wc",
  "true",
  "test",
]);

const SAFE_VERSION_FLAGS = new Set(["-v", "--version", "-version", "version"]);

const SAFE_GIT_SUBCOMMANDS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "remote",
  "describe",
  "tag",
  "rev-parse",
  "version",
  "help",
  "ls-files",
  "status-short",
]);

/**
 * Pure classifier to determine whether a tool request is safely non-mutating.
 */
export function isSafeToolRequest(request: ToolRequest, policy?: Policy): boolean {
  if (request.kind !== "terminal.exec") {
    return false;
  }

  // If policy explicitly allows it without asking, it is safe
  if (policy && authorize(request, policy) === "allow") {
    return true;
  }

  const base = executableBasename(request.executable);
  if (!base) return false;

  const args = request.args ?? [];
  const firstArg = (args[0] ?? "").toLowerCase();

  // Check safe read-only commands
  if (SAFE_READ_ONLY_EXECUTABLES.has(base)) {
    return true;
  }

  // Check version / info queries
  if (args.length === 1 && SAFE_VERSION_FLAGS.has(firstArg)) {
    return true;
  }

  // Check git read-only subcommands
  if (base === "git" && SAFE_GIT_SUBCOMMANDS.has(firstArg)) {
    return true;
  }

  // Check node/npm/pnpm/yarn version queries
  if (
    (base === "node" || base === "npm" || base === "pnpm" || base === "yarn" || base === "tsc" || base === "python" || base === "python3") &&
    args.length === 1 &&
    SAFE_VERSION_FLAGS.has(firstArg)
  ) {
    return true;
  }

  return false;
}

export interface CLIApprovalGateOptions {
  mode?: AutoApproveMode;
  policy?: Policy;
  timeoutMs?: number;
  onApprovalRequest?: (request: ApprovalRequest, granted: boolean, reason?: string) => void;
}

export class CLIApprovalGate implements ApprovalGate {
  private readonly mode: AutoApproveMode;
  private readonly policy?: Policy;
  private readonly timeoutMs?: number;
  private readonly onApprovalRequest?: (request: ApprovalRequest, granted: boolean, reason?: string) => void;

  constructor(options: CLIApprovalGateOptions = {}) {
    this.mode = options.mode ?? "none";
    this.policy = options.policy;
    this.timeoutMs = options.timeoutMs;
    this.onApprovalRequest = options.onApprovalRequest;
  }

  async requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome> {
    const timeout = request.timeoutMs ?? this.timeoutMs;

    const computeOutcome = (): ApprovalOutcome => {
      switch (this.mode) {
        case "all":
          this.onApprovalRequest?.(request, true);
          return { outcome: "granted" };

        case "safe": {
          const isSafe = isSafeToolRequest(request.request, this.policy);
          if (isSafe) {
            this.onApprovalRequest?.(request, true);
            return { outcome: "granted" };
          }
          const reason = `Fail-closed non-interactive refusal: tool "${request.tool}" (${request.request.executable}) is not safe under --auto-approve=safe`;
          this.onApprovalRequest?.(request, false, reason);
          return { outcome: "denied", reason };
        }

        case "none":
        default: {
          const reason = `Fail-closed non-interactive refusal: tool "${request.tool}" (${request.request.executable}) requires approval, denied under --auto-approve=none`;
          this.onApprovalRequest?.(request, false, reason);
          return { outcome: "denied", reason };
        }
      }
    };

    if (timeout && timeout > 0) {
      return new Promise<ApprovalOutcome>((resolve) => {
        const timer = setTimeout(() => {
          this.onApprovalRequest?.(request, false, "approval expired");
          resolve({ outcome: "expired" });
        }, timeout);

        // Immediate resolution for non-interactive modes
        const outcome = computeOutcome();
        clearTimeout(timer);
        resolve(outcome);
      });
    }

    return computeOutcome();
  }
}
