/**
 * Live WebSocket session composition for the local agent host.
 *
 * This is deliberately host-side: client frames are requests only.  Model
 * proposals still pass through RunCoordinator's policy and approval seams,
 * while workspace writes remain disabled unless the embedding application
 * opts in to a reviewed write flow.
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkspaceDescriptor, WorkspaceErrorCode } from "@protocol/workspace";
import type { ExecutionPlan } from "@protocol/plan";
import type { ModelProfile } from "@protocol/routing";
import {
  commandExecuteFrameSchema,
  type CommandExecuteFrame,
  type CommandResultFrame,
} from "@protocol/commands";
import { z } from "zod";
import {
  invokeSubagentParamsSchema,
  manageSubagentsParamsSchema,
  sendMessageParamsSchema,
  type ManageSubagentsAction,
} from "@protocol/subagents";
import {
  safeParseTerminalClientMessage,
  type TerminalServerMessage,
} from "@protocol/terminal";
import type { WebSocket } from "ws";
import { AuditStore, type AuditCapabilityDecisionInput } from "./audit/store";
import {
  decodeClientMessage,
  type ClientMessage,
  type HostMessage,
} from "./protocol";
import { loadPolicy } from "./policy/policy";
import { OpenAICompatibleAdapter } from "./providers/openaiCompatible";
import { InMemoryProviderRegistry } from "./providers/registry";
import { RunCoordinator, bindRouter } from "./runs/coordinator";
import { RunEventLog, type RunEvent } from "./runs/events";
import { runTerminalJob } from "./terminal/runner";
import { PtyManager } from "./terminal/ptyManager";
import {
  handleGitStatus,
  handleReadDir,
  handleReadFile,
  handleSearch,
  handleStat,
  handleWriteFile,
} from "./workspace/filesystem";
import { createWorkspaceWatcher } from "./workspace/watcher.js";
import { assertWorkspaceGeneration, validateWorkspaceRoot, WorkspaceRootError } from "./workspace/runtime.js";
import { WorkspaceFileError } from "./workspace/filesystem.js";
import { SubagentSupervisor } from "./agents/supervisor.js";
import { DaemonManager } from "./daemons/manager.js";
import { SharedMemoryEngine } from "./agents/memory.js";
import {
  CapabilityBroker,
  digestArguments,
  type CapabilityBinding,
  type CapabilityGrant as BrokerGrant,
  type CapabilityAuditRecord,
} from "./capabilities/broker.js";
import { BrokerApprovalGate, type RunApprovalPresentation } from "./capabilities/runApprovalGate.js";

export interface AgentSessionOptions {
  workspaceRoot?: string;
  workspaceDescriptor?: WorkspaceDescriptor;
  /**
   * Disabled by default. Direct browser-originated writes need a separate
   * diff/approval workflow; enabling this is only for trusted embeddings.
   */
  allowWorkspaceWrites?: boolean;
  /** Provider configuration is read only in the privileged host process. */
  provider?: {
    id?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };
  /** Virtual PTY manager instance for interactive terminal sessions. */
  ptyManager?: PtyManager;
  /** Subagent supervisor instance. */
  subagentSupervisor?: SubagentSupervisor;
  /** Daemon task manager instance. */
  daemonManager?: DaemonManager;
  /** Shared memory engine instance. */
  memoryEngine?: SharedMemoryEngine;
  /** Host-owned durable audit store; injectable for controlled host embeddings. */
  auditStore?: SessionAuditStore;
}

export interface SessionAuditStore {
  startRun(input: { id: string; goal: string; startedAt?: string }): void;
  recordEvent(runId: string, event: RunEvent): void;
  recordArtifact?(input: { runId: string; kind: string; name: string; data: string | Uint8Array }): unknown;
  endRun(input: { runId: string; state: string; endedAt?: string }): void;
  recordCapabilityDecision(input: AuditCapabilityDecisionInput): unknown;
  close(): void;
}

type Send = (message: HostMessage | TerminalServerMessage | CommandResultFrame) => void;

type DeferredCapability = {
  readonly requestId: string;
  readonly token: string;
  readonly binding: CapabilityBinding;
  readonly grant: BrokerGrant;
  readonly issuedAt: string;
  readonly operation: string;
  readonly execute: () => Promise<void>;
  state: "pending" | "consumed" | "revoked";
};

const profileFor = (providerId: string, model: string): ModelProfile => ({
  id: model,
  provider: providerId,
  capabilities: { planning: 1, coding: 1, vision: 0, toolCalling: 1 },
  costPer1kInputTokens: 0,
  costPer1kOutputTokens: 0,
  privacyClass: "cloud",
  maxContextTokens: 128_000,
  typicalLatencyMs: 2_000,
});

const stateForEvent = (event: RunEvent): "done" | "error" | "cancelled" | undefined => {
  switch (event.type) {
    case "run.completed": return "done";
    case "run.cancelled": return "cancelled";
    case "run.failed":
    case "run.halted": return "error";
    default: return undefined;
  }
};

type CommandSupervisor = Pick<SubagentSupervisor, "spawnSubagent" | "manageSubagents" | "sendMessage">;

const commandResult = (
  frame: CommandExecuteFrame,
  result: Omit<CommandResultFrame, "type" | "command" | "requestId">,
): CommandResultFrame => ({
  type: "command.result",
  command: frame.command,
  requestId: frame.requestId,
  ...result,
});

const flagString = (flags: Record<string, string | number | boolean>, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
};

export function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const pathStr = issue.path.length > 0 ? issue.path.join(".") : "parameter";
      return `${pathStr}: ${issue.message}`;
    })
    .join("; ");
}

export function serializeZodIssues(issues: z.ZodIssue[]): Array<{ path: string; message: string; code: string }> {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Dispatches the swarm slash-command subset through the supervisor API. This
 * function is exported and dependency-injected so transport tests can verify
 * command semantics without opening a socket or constructing a supervisor.
 */
export async function dispatchCommand(
  frame: CommandExecuteFrame,
  supervisor: CommandSupervisor,
): Promise<CommandResultFrame> {
  const rawCommand = frame.command.trim().toLowerCase();
  const flags = frame.parsed?.flags ?? {};
  const positional = [...(frame.parsed?.positional ?? frame.args ?? [])];
  const aliasActions: Record<string, string> = {
    "/agent-list": "list",
    "/agent-tree": "tree",
    "/agent-inspect": "inspect",
    "/agent-message": "message",
    "/agent-pause": "pause",
    "/agent-resume": "resume",
    "/agent-stop": "stop",
    "/agent-focus": "focus",
  };
  const command = rawCommand === "/sw" || rawCommand === "/agents" || rawCommand === "/agent" || rawCommand === "/a" || aliasActions[rawCommand]
    ? "/swarm"
    : rawCommand;
  if (aliasActions[rawCommand]) positional.unshift(aliasActions[rawCommand]);
  else if (rawCommand === "/agents" && positional.length === 0) positional.unshift("list");
  const embeddedAction = command.startsWith("/swarm.") ? command.slice("/swarm.".length) : undefined;
  const action = (embeddedAction ?? positional[0] ?? "").toLowerCase();

  if (command !== "/swarm" && !embeddedAction) {
    return commandResult(frame, {
      success: false,
      error: `Unsupported command: ${frame.command}`,
      data: { code: "unsupported_command" },
    });
  }

  try {
    switch (action) {
      case "run": {
        const archetype = flagString(flags, "archetype", "type") ?? "custom";
        const prompt = flagString(flags, "prompt") ?? (embeddedAction ? positional.join(" ") : positional.slice(1).join(" "));
        if (!prompt || !prompt.trim()) {
          return commandResult(frame, {
            success: false,
            error: "swarm run requires a prompt",
            data: { code: "invalid_command" },
          });
        }
        const name = flagString(flags, "name");
        const roles = flagString(flags, "roles")?.split(",").map((role) => role.trim()).filter(Boolean);
        const isolation = flagString(flags, "workspaceIsolation", "isolation");
        const timeoutValue = flags.timeoutSeconds ?? flags.timeout;
        const budgetValue = flags.budgetTokens ?? flags.budget;
        const skills = flagString(flags, "skills")?.split(",").map((s) => s.trim()).filter(Boolean);
        const model = flagString(flags, "model");

        const rawRunParams = {
          archetype,
          prompt: prompt.trim(),
          ...(name ? { name } : {}),
          ...(roles?.length ? { roles } : {}),
          ...(isolation ? { workspaceIsolation: isolation } : {}),
          ...(typeof timeoutValue === "number" ? { timeoutSeconds: timeoutValue } : {}),
          ...(typeof budgetValue === "number" ? { budgetTokens: budgetValue } : {}),
          ...(skills?.length ? { skills } : {}),
          ...(model ? { model } : {}),
        };

        const parseResult = invokeSubagentParamsSchema.safeParse(rawRunParams);
        if (!parseResult.success) {
          return commandResult(frame, {
            success: false,
            error: `Invalid /swarm run arguments: ${formatZodIssues(parseResult.error.issues)}`,
            data: { code: "invalid_command", issues: serializeZodIssues(parseResult.error.issues) },
          });
        }

        const result = await supervisor.spawnSubagent(
          parseResult.data,
          flagString(flags, "parentId", "parent"),
        );
        return commandResult(frame, {
          success: true,
          output: `Started subagent ${result.name} (${result.subagentId})`,
          data: result as unknown as CommandResultFrame["data"],
        });
      }
      case "list":
      case "tree": {
        const recursiveVal = typeof flags.recursive === "boolean" ? flags.recursive : undefined;
        const rawListParams = {
          action: "list" as const,
          ...(recursiveVal !== undefined ? { recursive: recursiveVal } : {}),
        };

        const parseResult = manageSubagentsParamsSchema.safeParse(rawListParams);
        if (!parseResult.success) {
          return commandResult(frame, {
            success: false,
            error: `Invalid /swarm ${action} arguments: ${formatZodIssues(parseResult.error.issues)}`,
            data: { code: "invalid_command", issues: serializeZodIssues(parseResult.error.issues) },
          });
        }

        const result = await supervisor.manageSubagents(parseResult.data, flagString(flags, "callerId", "caller"));
        return commandResult(frame, {
          success: result.success,
          ...(result.message ? { output: result.message } : {}),
          ...(result.message && !result.success ? { error: result.message } : {}),
          data: result as unknown as CommandResultFrame["data"],
        });
      }
      case "inspect": {
        const subagentId = flagString(flags, "subagentId", "agent", "id") ?? frame.parsed?.mentions?.agents?.[0] ?? (embeddedAction ? positional[0] : positional[1]);
        if (!subagentId) {
          return commandResult(frame, { success: false, error: "swarm inspect requires a subagent id", data: { code: "invalid_command" } });
        }
        const fileParam = flagString(flags, "file", "inspectFile") ?? (embeddedAction ? positional[1] : positional[2]);
        const rawInspectParams = {
          action: "inspect" as const,
          subagentId,
          ...(fileParam ? { inspectFile: fileParam } : {}),
        };

        const parseResult = manageSubagentsParamsSchema.safeParse(rawInspectParams);
        if (!parseResult.success) {
          return commandResult(frame, {
            success: false,
            error: `Invalid /swarm inspect arguments: ${formatZodIssues(parseResult.error.issues)}`,
            data: { code: "invalid_command", issues: serializeZodIssues(parseResult.error.issues) },
          });
        }

        const result = await supervisor.manageSubagents(parseResult.data);
        return commandResult(frame, {
          success: result.success,
          ...(result.inspectedContent ? { output: result.inspectedContent } : {}),
          ...(result.message ? { error: result.message } : {}),
          data: result as unknown as CommandResultFrame["data"],
        });
      }
      case "message": {
        if (!supervisor.sendMessage) {
          return commandResult(frame, { success: false, error: "Host does not support swarm messages", data: { code: "unsupported_capability" } });
        }
        const recipientId = flagString(flags, "recipientId", "recipient", "agent") ?? frame.parsed?.mentions?.agents?.[0] ?? (embeddedAction ? positional[0] : positional[1]);
        const body = flagString(flags, "body") ?? (embeddedAction ? positional.slice(1).join(" ") : positional.slice(2).join(" "));
        if (!recipientId || !body || !body.trim()) {
          return commandResult(frame, { success: false, error: "swarm message requires a recipient and body", data: { code: "invalid_command" } });
        }
        const rawMessageParams = {
          recipientId,
          subject: flagString(flags, "subject") ?? "Direct Message",
          body: body.trim(),
          priority: flagString(flags, "priority") ?? "normal",
          referencedArtifacts: [],
        };

        const parseResult = sendMessageParamsSchema.safeParse(rawMessageParams);
        if (!parseResult.success) {
          return commandResult(frame, {
            success: false,
            error: `Invalid /swarm message arguments: ${formatZodIssues(parseResult.error.issues)}`,
            data: { code: "invalid_command", issues: serializeZodIssues(parseResult.error.issues) },
          });
        }

        const result = await supervisor.sendMessage(
          parseResult.data,
          flagString(flags, "senderId", "sender") ?? "root",
        );
        return commandResult(frame, {
          success: true,
          output: `Message ${result.messageId} delivered`,
          data: result as unknown as CommandResultFrame["data"],
        });
      }
      case "pause":
      case "resume":
      case "stop": {
        const subagentId = flagString(flags, "subagentId", "agent", "id") ?? frame.parsed?.mentions?.agents?.[0] ?? (embeddedAction ? positional[0] : positional[1]);
        if (!subagentId) {
          return commandResult(frame, { success: false, error: `swarm ${action} requires a subagent id`, data: { code: "invalid_command" } });
        }
        const rawManageParams = {
          action: (action === "stop" ? "kill" : action) as ManageSubagentsAction,
          subagentId,
          ...(action === "stop" ? { recursive: flags.recursive !== false } : {}),
        };

        const parseResult = manageSubagentsParamsSchema.safeParse(rawManageParams);
        if (!parseResult.success) {
          return commandResult(frame, {
            success: false,
            error: `Invalid /swarm ${action} arguments: ${formatZodIssues(parseResult.error.issues)}`,
            data: { code: "invalid_command", issues: serializeZodIssues(parseResult.error.issues) },
          });
        }

        const result = await supervisor.manageSubagents(parseResult.data);
        return commandResult(frame, {
          success: result.success,
          ...(result.success ? { output: result.message } : { error: result.message ?? `swarm ${action} failed` }),
          data: result as unknown as CommandResultFrame["data"],
        });
      }
      default:
        return commandResult(frame, { success: false, error: `Unsupported swarm action: ${action || "(missing)"}`, data: { code: "unsupported_action" } });
    }
  } catch (error) {
    return commandResult(frame, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      data: { code: "command_dispatch_error" },
    });
  }
}

const parseCommandFrame = (raw: unknown): CommandExecuteFrame | null => {
  let parsed: unknown = raw;
  if (typeof raw === "string" || raw instanceof Buffer || Array.isArray(raw)) {
    try { parsed = JSON.parse(String(raw)); } catch { return null; }
  }
  const result = commandExecuteFrameSchema.safeParse(parsed);
  return result.success ? result.data : null;
};

const capabilityId = (value: string, prefix: string): string =>
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    ? value
    : `${prefix}-${digestArguments(value).slice(0, 24)}`;

const capabilityErrorCode = (
  reason: "allowed" | "binding_mismatch" | "expired" | "replayed" | "revoked" | "unknown_grant" | "invalid_request" | "audit_unavailable",
): "invalid_request" | "denied" | "expired" | "stale_binding" | "already_used" => {
  switch (reason) {
    case "expired": return "expired";
    case "replayed": return "already_used";
    case "binding_mismatch": return "stale_binding";
    case "unknown_grant":
    case "invalid_request": return "invalid_request";
    default: return "denied";
  }
};

/** Attach a fully composed coordinator + workspace RPC session to one socket. */
export function attachAgentSession(
  socket: WebSocket,
  context: { hostId: string },
  options: AgentSessionOptions = {},
): void {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const workspace = options.workspaceDescriptor;
  if (!workspace) {
    throw new Error("Agent session requires a validated workspace descriptor");
  }
  const generation = workspace.generation;
  const now = () => new Date().toISOString();
  const sessionId = `session-${randomUUID()}`;
  // Host-only capability used to bind any future interactive PTY activity to
  // this socket. It is never included in protocol frames or terminal metadata.
  const ptyOwnerId = `pty-owner-${randomUUID()}`;
  const capabilityHostId = capabilityId(context.hostId, "host");
  const capabilityWorkspaceId = capabilityId(workspace.id, "workspace");
  const send: Send = (message) => {
    const payload = JSON.stringify(message);
    if (socket.readyState === 1) socket.send(payload);
    else socket.once("open", () => socket.send(payload));
  };
  const terminalAccessDenied = () => send({
    type: "error",
    code: "terminal_access_denied",
    // Do not distinguish an unknown terminal from one owned by another client.
    message: "Terminal operation unavailable",
    at: now(),
  });
  const providerId = options.provider?.id ?? process.env.NANOFORGE_PROVIDER_ID ?? "openai-compatible";
  const model = options.provider?.model ?? process.env.NANOFORGE_PROVIDER_MODEL ?? "unconfigured";
  const registry = new InMemoryProviderRegistry();
  registry.register(new OpenAICompatibleAdapter({
    id: providerId,
    model,
    baseUrl: options.provider?.baseUrl ?? process.env.NANOFORGE_PROVIDER_BASE_URL ?? "http://127.0.0.1:9",
    apiKey: options.provider?.apiKey ?? process.env.NANOFORGE_PROVIDER_API_KEY,
  }));
  const profiles = [profileFor(providerId, model)];
  const eventLog = new RunEventLog();
  const auditStore: SessionAuditStore = options.auditStore ?? new AuditStore({ rootDir: path.join(workspaceRoot, ".nanoforge", "runs") });
  const brokerRequestIds = new Map<string, string>();
  const capabilityAudit: CapabilityAuditRecord[] = [];
  const capabilityBroker = new CapabilityBroker({
    auditSink: (record) => {
      capabilityAudit.push(record);
      if (capabilityAudit.length > 256) capabilityAudit.shift();
      auditStore.recordCapabilityDecision({
        at: new Date(record.at).toISOString(),
        grantId: record.grantId,
        ...(brokerRequestIds.has(record.grantId) ? { requestId: brokerRequestIds.get(record.grantId) } : {}),
        decision: record.decision,
        reasonCode: record.reason,
        ...(record.remainingUses === undefined ? {} : { remainingUses: record.remainingUses }),
        tokenDigest: `sha256:${record.tokenHash}`,
        binding: {
          hostId: record.binding.hostInstanceId,
          sessionId: record.binding.clientSessionId,
          workspaceId: record.binding.workspaceId,
          runId: record.binding.runId,
          stepId: record.binding.stepId,
          toolId: record.binding.toolId,
          argumentsDigest: `sha256:${record.binding.argsDigest}`,
        },
      });
    },
  });
  const capabilityRequests = new Map<string, DeferredCapability>();
  const runApprovalRequestIds = new Set<string>();
  const approvalGate = new BrokerApprovalGate({
    broker: capabilityBroker,
    binding: {
      hostInstanceId: capabilityHostId,
      clientSessionId: sessionId,
      workspaceId: capabilityWorkspaceId,
      workspaceGeneration: generation,
    },
    scope: "execute",
    present: (metadata: RunApprovalPresentation) => {
      // Correlate the opaque gate request only after the broker has issued it;
      // raw tool requests and grant tokens never enter the socket payload.
      brokerRequestIds.set(metadata.grantId, metadata.requestId);
      runApprovalRequestIds.add(metadata.requestId);
      send({
        type: "capability.approval_required",
        requestId: metadata.requestId,
        hostId: capabilityHostId,
        sessionId,
        workspaceId: capabilityWorkspaceId,
        generation,
        runId: metadata.runId,
        stepId: metadata.stepId,
        toolId: metadata.toolId,
        argumentsDigest: `sha256:${metadata.requestDigest}`,
        scope: "execute",
        expiresAt: new Date(metadata.expiresAt).toISOString(),
        uses: "single",
        reason: `Approval required for ${metadata.toolId}`,
        at: now(),
      });
    },
  });
  const coordinator = new RunCoordinator({
    router: bindRouter(profiles),
    profiles,
    providerRegistry: registry,
    policy: loadPolicy(workspaceRoot),
    runner: runTerminalJob,
    auditStore,
    approvalGate,
    eventLog,
    workspaceRoot,
  });
  const runs = new Map<string, ReturnType<RunCoordinator["submitRun"]>>();
  let watcher: ReturnType<typeof createWorkspaceWatcher> | undefined;
  const ptyManager =
    options.ptyManager ??
    new PtyManager({
      workspaceRoot,
      onMessage: (msg) => send(msg),
    });

  const daemonManager = options.daemonManager ?? new DaemonManager();
  const subagentSupervisor =
    options.subagentSupervisor ??
    new SubagentSupervisor({
      workspaceRoot,
      daemonSupervisor: daemonManager.supervisor,
      scheduler: daemonManager.scheduler,
    });
  const memoryEngine = options.memoryEngine ?? subagentSupervisor.memory;

  const onTerminalMessage = (message: TerminalServerMessage) => send(message);
  ptyManager.on("message", onTerminalMessage);

  const unsubs: (() => void)[] = [];

  const unsubSubagents = subagentSupervisor.subscribe((event) => {
    send({ type: "subagent.event", event, at: now() });
  });
  if (typeof unsubSubagents === "function") unsubs.push(unsubSubagents);

  const unsubMemory = memoryEngine.subscribe((event) => {
    send({ type: "memory.event", event, at: now() });
  });
  if (typeof unsubMemory === "function") unsubs.push(unsubMemory);

  const unsubSupervisor = daemonManager.supervisor.subscribe((event) => {
    send({ type: "task.event", event, at: now() });
  });
  if (typeof unsubSupervisor === "function") unsubs.push(unsubSupervisor);

  const unsubScheduler = daemonManager.scheduler.subscribe((event) => {
    send({ type: "task.event", event, at: now() });
  });
  if (typeof unsubScheduler === "function") unsubs.push(unsubScheduler);

  const unsubEventLog = eventLog.subscribeAll((event) => {
    // Submission emits its first ledger events synchronously. Defer their
    // socket fan-out so the caller always receives queued/running first.
    queueMicrotask(() => {
      const state = stateForEvent(event);
      if (state) {
        send({ type: "run.state", runId: event.runId, state, at: event.at });
      }
      send({ type: "run.event", runId: event.runId, event: event.type, data: event as any, at: event.at });
    });
  });
  if (typeof unsubEventLog === "function") unsubs.push(unsubEventLog);
  send({ type: "host.ready", version: "0.1.0", hostId: context.hostId, workspace, at: now() });

  const workspaceError = (
    error: unknown,
    requestId?: string,
    requestedWorkspace?: WorkspaceDescriptor,
  ): void => {
    const nodeCode = (error as NodeJS.ErrnoException | undefined)?.code;
    let code: WorkspaceErrorCode = "io_error";
    if (error instanceof WorkspaceRootError || error instanceof WorkspaceFileError) code = error.code;
    else if (nodeCode === "ENOENT") code = "not_found";
    else if (nodeCode === "EACCES" || nodeCode === "EPERM") code = "permission_denied";
    send({
      type: "workspace.error",
      requestId,
      code,
      message: error instanceof Error ? error.message : String(error),
      generation,
      recoverable: code !== "permission_denied" && code !== "root_too_broad",
      requestedWorkspace,
      at: now(),
    });
  };
  const capabilityResult = (
    requestId: string,
    result: {
      ok: boolean;
      grant?: {
        grantId: string;
        hostId: string;
        sessionId: string;
        workspaceId: string;
        generation: number;
        runId: string;
        stepId: string;
        toolId: string;
        argumentsDigest: string;
        scope: "read" | "write" | "execute" | "network" | "browser" | "mcp" | "schedule";
        issuedAt: string;
        expiresAt: string;
        uses: "single" | "multi";
      };
      errorCode?: "invalid_request" | "denied" | "expired" | "stale_binding" | "already_used";
      errorMessage?: string;
    },
  ): void => {
    send({ type: "capability.result", requestId, ...result, at: now() });
  };

  const requestCapability = (
    requestId: string,
    operation: string,
    scope: "write" | "execute" | "schedule",
    metadata: Readonly<Record<string, string | number | boolean>>,
    execute: () => Promise<void>,
  ): void => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)) {
      send({
        type: "error",
        code: "capability_invalid_request",
        message: "Capability request identifier is invalid",
        requestId,
        at: now(),
      });
      return;
    }
    const existing = capabilityRequests.get(requestId);
    if (existing || runApprovalRequestIds.has(requestId)) {
      capabilityResult(requestId, {
        ok: false,
        errorCode: "invalid_request",
        errorMessage: "Capability request is already pending or completed",
      });
      return;
    }

    const runId = `request-${digestArguments({ requestId, operation }).slice(0, 32)}`;
    const stepId = `step-${digestArguments({ requestId, operation, sessionId }).slice(0, 32)}`;
    const toolId = capabilityId(operation, "tool");
    const binding: CapabilityBinding = {
      hostInstanceId: capabilityHostId,
      clientSessionId: sessionId,
      workspaceId: capabilityWorkspaceId,
      workspaceGeneration: generation,
      runId,
      stepId,
      toolId,
      argsDigest: digestArguments(metadata),
      scope,
    };
    let grant: BrokerGrant;
    try {
      grant = capabilityBroker.issue({ binding, ttlMs: 60_000, maxUses: 1 });
    } catch {
      capabilityResult(requestId, {
        ok: false,
        errorCode: "invalid_request",
        errorMessage: "Capability request could not be issued",
      });
      return;
    }
    capabilityRequests.set(requestId, {
      requestId,
      token: grant.token,
      binding,
      grant,
      issuedAt: now(),
      operation,
      execute,
      state: "pending",
    });
    brokerRequestIds.set(grant.grantId, requestId);
    send({
      type: "capability.approval_required",
      requestId,
      hostId: capabilityHostId,
      sessionId,
      workspaceId: capabilityWorkspaceId,
      generation,
      runId,
      stepId,
      toolId,
      argumentsDigest: `sha256:${binding.argsDigest}`,
      scope,
      expiresAt: new Date(grant.expiresAt).toISOString(),
      uses: "single",
      reason: `Approval required for ${operation}`,
      at: now(),
    });
  };

  const resolveCapability = (requestId: string, approved: boolean, reason?: string): void => {
    const request = capabilityRequests.get(requestId);
    if (!request) {
      capabilityResult(requestId, {
        ok: false,
        errorCode: "invalid_request",
        errorMessage: "Unknown capability request",
      });
      return;
    }
    if (!approved) {
      void reason;
      if (request.state === "pending") {
        request.state = "revoked";
        capabilityBroker.revoke(request.token);
      }
      capabilityResult(requestId, {
        ok: false,
        errorCode: request.state === "consumed" ? "already_used" : "denied",
        errorMessage: "Capability denied",
      });
      return;
    }

    const consumed = capabilityBroker.consume(request.token, request.binding);
    if (!consumed.allowed) {
      capabilityResult(requestId, {
        ok: false,
        errorCode: capabilityErrorCode(consumed.reason),
        errorMessage: consumed.reason === "audit_unavailable"
          ? "Capability audit is unavailable; approval denied"
          : "Capability approval could not be applied",
      });
      return;
    }
    request.state = "consumed";
    capabilityResult(requestId, {
      ok: true,
      grant: {
        grantId: request.grant.grantId,
        hostId: capabilityHostId,
        sessionId,
        workspaceId: capabilityWorkspaceId,
        generation,
        runId: request.binding.runId,
        stepId: request.binding.stepId,
        toolId: request.binding.toolId,
        argumentsDigest: `sha256:${request.binding.argsDigest}`,
        scope: request.binding.scope as "write" | "execute" | "schedule",
        issuedAt: request.issuedAt,
        expiresAt: new Date(request.grant.expiresAt).toISOString(),
        uses: "single",
      },
    });
    void request.execute().catch(() => {
      // The deferred operation owns its stable error/result frame. Never leak
      // raw operation payloads from this transport-level safety net.
    });
  };
  const dispatchWorkspace = async (message: ClientMessage): Promise<void> => {
    try {
      if (message.type === "workspace.describe") {
        send({ type: "workspace.ready", requestId: message.requestId, workspace, at: now() });
        return;
      }
      if (message.type === "workspace.open") {
        assertWorkspaceGeneration(message.generation, generation);
        const requested = await validateWorkspaceRoot(message.path, generation + 1);
        const sameRoot = path.resolve(requested.canonicalRoot).toLowerCase() === path.resolve(workspaceRoot).toLowerCase();
        if (sameRoot) {
          send({ type: "workspace.ready", requestId: message.requestId, workspace, at: now() });
          return;
        }
        if (Array.from(runs.values()).some((run) => run.status() === "running" || run.status() === "paused")) {
          throw new WorkspaceRootError("active_work", "Cannot switch workspaces while a run is active");
        }
        workspaceError(
          new WorkspaceRootError("reconnect_required", "Validated workspace requires a host reconnect so every privileged subsystem changes root atomically"),
          message.requestId,
          requested.descriptor,
        );
        return;
      }
      if ("generation" in message) assertWorkspaceGeneration(message.generation, generation);
      switch (message.type) {
        case "workspace.readDir":
          send({ type: "workspace.readDir.result", requestId: message.requestId, path: message.path, entries: await handleReadDir(workspaceRoot, message.path), generation });
          return;
        case "workspace.readFile": {
          const result = await handleReadFile(workspaceRoot, message.path);
          send({ type: "workspace.readFile.result", requestId: message.requestId, path: message.path, ...result, generation });
          return;
        }
        case "workspace.stat":
          send({ type: "workspace.stat.result", requestId: message.requestId, path: message.path, stat: await handleStat(workspaceRoot, message.path), generation });
          return;
        case "workspace.search":
          send({ type: "workspace.search.result", requestId: message.requestId, matches: await handleSearch(workspaceRoot, message.query, message.options), generation });
          return;
        case "workspace.gitStatus":
          send({ type: "workspace.gitStatus.result", requestId: message.requestId, files: await handleGitStatus(workspaceRoot), generation });
          return;
        case "workspace.writeFile":
          if (!options.allowWorkspaceWrites) throw new WorkspaceRootError("write_not_approved", "workspace writes require an approved write workflow");
          requestCapability(
            message.requestId,
            "workspace.writeFile",
            "write",
            {
              pathDigest: digestArguments(message.path),
              contentDigest: digestArguments(message.content),
              expectedSha256Digest: digestArguments(message.expectedSha256 ?? ""),
              expectedModifiedDigest: digestArguments(message.expectedModified ?? ""),
            },
            async () => {
              try {
                const result = await handleWriteFile(workspaceRoot, message.path, message.content, {
                  expectedSha256: message.expectedSha256,
                  expectedModified: message.expectedModified,
                });
                send({ type: "workspace.writeFile.result", requestId: message.requestId, path: message.path, generation, ...result });
              } catch (error) {
                workspaceError(error, message.requestId);
              }
            },
          );
          return;
        case "workspace.watch":
          if (message.enabled && !watcher) {
            watcher = createWorkspaceWatcher({ workspaceRoot }, (event) => send({ type: "workspace.fileChanged", ...event, generation }));
          } else if (!message.enabled && watcher) {
            await watcher.close();
            watcher = undefined;
          }
          send({ type: "workspace.watch.result", requestId: message.requestId, enabled: Boolean(message.enabled && watcher), generation });
          return;
        case "workspace.unwatch":
          if (watcher) {
            await watcher.close();
            watcher = undefined;
          }
          send({ type: "workspace.watch.result", requestId: message.requestId, enabled: false, generation });
          return;
      }
    } catch (error) {
      workspaceError(error, "requestId" in message ? message.requestId : undefined);
    }
  };

  socket.on("message", async (data: unknown) => {
    const commandMessage = parseCommandFrame(data);
    if (commandMessage) {
      const result = await dispatchCommand(commandMessage, subagentSupervisor);
      send(result);
      return;
    }
    const decoded = decodeClientMessage(data);
    if (!decoded.ok) {
      if (typeof data === "string" || data instanceof Buffer || Array.isArray(data)) {
        try {
          const parsed = JSON.parse(String(data));
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "type" in parsed &&
            typeof (parsed as { type: unknown }).type === "string" &&
            ((parsed as { type: string }).type).startsWith("terminal.")
          ) {
            const terminalResult = safeParseTerminalClientMessage(parsed);
            if (terminalResult.success) {
              const tMsg = terminalResult.data;
              switch (tMsg.type) {
                case "terminal.create":
                  // Interactive PTYs are privileged and must be broker-granted.
                  // Structured run terminal execution remains available through
                  // RunCoordinator; this direct socket path fails closed.
                  send({
                    type: "error",
                    code: "terminal_interactive_denied",
                    message: "Direct interactive terminal creation is disabled by host policy",
                    at: now(),
                  });
                  break;
                case "terminal.input":
                  if (!ptyManager.writeInput(tMsg.id, tMsg.data, ptyOwnerId)) terminalAccessDenied();
                  break;
                case "terminal.resize":
                  if (!ptyManager.resize(tMsg.id, tMsg.cols, tMsg.rows, ptyOwnerId)) terminalAccessDenied();
                  break;
                case "terminal.kill":
                  void ptyManager.kill(tMsg.id, tMsg.signal, ptyOwnerId).then((killed) => {
                    if (!killed) terminalAccessDenied();
                  }, terminalAccessDenied);
                  break;
              }
              return;
            }
          }
        } catch {
          /* ignore */
        }
      }
      socket.close(4400, "invalid message");
      return;
    }
    const message = decoded.message;
    if (message.type.startsWith("workspace.")) {
      void dispatchWorkspace(message);
      return;
    }
    switch (message.type) {
      case "ping": send({ type: "pong", at: now() }); break;
      case "capability.approval":
        if (capabilityRequests.has(message.requestId)) {
          resolveCapability(message.requestId, message.approved, message.reason);
        } else {
          const resolved = approvalGate.resolve(message.requestId, message.approved, message.reason);
          if (!resolved) {
            capabilityResult(message.requestId, {
              ok: false,
              errorCode: "invalid_request",
              errorMessage: "Unknown capability request",
            });
          }
        }
        break;
      case "plan.submit": {
        // The wire schema deliberately stays forward-compatible; the
        // coordinator performs the authoritative plan validation before a
        // step can execute.
        try {
          const handle = coordinator.submitRun(message.plan as unknown as ExecutionPlan);
          runs.set(handle.runId, handle);
          if (message.requestId) {
            send({
              type: "plan.submit.result",
              requestId: message.requestId,
              runId: handle.runId,
              accepted: true,
              planId: message.plan.id,
              at: now(),
            });
          }
          send({ type: "run.state", runId: handle.runId, state: "queued", at: now() });
          send({ type: "run.state", runId: handle.runId, state: "running", at: now() });
        } catch (err) {
          send({
            type: "error",
            code: "invalid_plan",
            message: err instanceof Error ? err.message : String(err),
            requestId: message.requestId,
            at: now(),
          });
        }
        break;
      }
      case "run.pause": {
        const handle = runs.get(message.runId);
        if (!handle) {
          send({
            type: "error",
            code: "unknown_run",
            message: `run not found: ${message.runId}`,
            runId: message.runId,
            requestId: message.requestId,
            at: now(),
          });
        } else {
          handle.pause();
          if (message.requestId) {
            send({
              type: "run.pause.result",
              requestId: message.requestId,
              runId: message.runId,
              at: now(),
            });
          }
        }
        break;
      }
      case "run.resume": {
        const handle = runs.get(message.runId);
        if (!handle) {
          send({
            type: "error",
            code: "unknown_run",
            message: `run not found: ${message.runId}`,
            runId: message.runId,
            requestId: message.requestId,
            at: now(),
          });
        } else {
          handle.resume();
          if (message.requestId) {
            send({
              type: "run.resume.result",
              requestId: message.requestId,
              runId: message.runId,
              at: now(),
            });
          }
        }
        break;
      }
      case "run.cancel": {
        const handle = runs.get(message.runId);
        if (!handle) {
          send({
            type: "error",
            code: "unknown_run",
            message: `run not found: ${message.runId}`,
            runId: message.runId,
            requestId: message.requestId,
            at: now(),
          });
        } else {
          handle.cancel();
          if (message.requestId) {
            send({
              type: "run.cancel.result",
              requestId: message.requestId,
              runId: message.runId,
              at: now(),
            });
          }
        }
        break;
      }
      case "approval.grant": {
        // Legacy frames may resolve only an exact broker-owned request ID;
        // they never address direct deferred operations or prefix-match runs.
        const resolved = approvalGate.resolve(message.requestId, true);
        send({
          type: "approval.grant.result",
          requestId: message.requestId,
          runId: message.runId,
          stepId: message.stepId,
          resolved,
          at: now(),
        });
        break;
      }
      case "approval.deny": {
        const resolved = approvalGate.resolve(message.requestId, false, message.reason);
        send({
          type: "approval.deny.result",
          requestId: message.requestId,
          runId: message.runId,
          stepId: message.stepId,
          resolved,
          at: now(),
        });
        break;
      }
      case "tool.response": {
        const resolved = approvalGate.resolve(message.requestId, message.approved, message.reason);
        send({
          type: "tool.response.result",
          requestId: message.requestId,
          resolved,
          at: now(),
        });
        break;
      }
      case "subagent.invoke": {
        requestCapability(
          message.requestId,
          "subagent.invoke",
          "execute",
          {
            paramsDigest: digestArguments(message.params),
            parentIdDigest: digestArguments(message.parentId ?? ""),
          },
          async () => {
            try {
              const result = await subagentSupervisor.spawnSubagent(message.params, message.parentId);
              send({ type: "subagent.invoke.result", requestId: message.requestId, result });
            } catch (err) {
              send({ type: "error", code: "subagent_error", message: "Subagent invocation failed", requestId: message.requestId, at: now() });
            }
          },
        );
        break;
      }
      case "subagent.manage": {
        const mutates = message.params.action === "pause" || message.params.action === "resume" || message.params.action === "kill";
        const execute = async (): Promise<void> => {
          try {
            const result = await subagentSupervisor.manageSubagents(message.params, message.callerId);
            send({ type: "subagent.manage.result", requestId: message.requestId, result });
          } catch {
            send({ type: "error", code: "subagent_error", message: "Subagent management failed", requestId: message.requestId, at: now() });
          }
        };
        if (mutates) {
          requestCapability(message.requestId, "subagent.manage", "execute", {
            paramsDigest: digestArguments(message.params),
            callerIdDigest: digestArguments(message.callerId ?? ""),
          }, execute);
        } else {
          void execute();
        }
        break;
      }
      case "subagent.sendMessage": {
        requestCapability(message.requestId, "subagent.sendMessage", "execute", {
          paramsDigest: digestArguments(message.params),
          senderIdDigest: digestArguments(message.senderId),
        }, async () => {
          try {
            const result = await subagentSupervisor.sendMessage(message.params, message.senderId);
            send({ type: "subagent.sendMessage.result", requestId: message.requestId, result });
          } catch {
            send({ type: "error", code: "subagent_error", message: "Subagent message failed", requestId: message.requestId, at: now() });
          }
        });
        break;
      }
      case "subagent.define": {
        requestCapability(message.requestId, "subagent.define", "execute", {
          paramsDigest: digestArguments(message.params),
        }, async () => {
          try {
            const result = await subagentSupervisor.defineSubagent(message.params);
            send({ type: "subagent.define.result", requestId: message.requestId, result });
          } catch {
            send({ type: "error", code: "subagent_error", message: "Subagent definition failed", requestId: message.requestId, at: now() });
          }
        });
        break;
      }
      case "task.manage": {
        const mutates = message.params.action === "kill" || message.params.action === "send_input";
        const execute = async (): Promise<void> => {
          try {
            const result = await daemonManager.manageTask(message.params);
            send({ type: "task.manage.result", requestId: message.requestId, result });
          } catch {
            send({ type: "error", code: "task_error", message: "Task management failed", requestId: message.requestId, at: now() });
          }
        };
        if (mutates) {
          requestCapability(message.requestId, "task.manage", "execute", {
            paramsDigest: digestArguments(message.params),
          }, execute);
        } else {
          void execute();
        }
        break;
      }
      case "schedule.create": {
        requestCapability(message.requestId, "schedule.create", "schedule", {
          paramsDigest: digestArguments(message.params),
          creatorSubagentIdDigest: digestArguments(message.creatorSubagentId ?? ""),
        }, async () => {
          try {
            const result = await daemonManager.scheduleTask(message.params, message.creatorSubagentId);
            send({ type: "schedule.create.result", requestId: message.requestId, result });
          } catch {
            send({ type: "error", code: "schedule_error", message: "Schedule creation failed", requestId: message.requestId, at: now() });
          }
        });
        break;
      }
      case "memory.set": {
        requestCapability(message.requestId, "memory.set", "write", {
          paramsDigest: digestArguments(message.params),
          authorInfoDigest: digestArguments(message.authorInfo ?? {}),
        }, async () => {
          try {
            const result = memoryEngine.set(message.params, message.authorInfo);
            send({ type: "memory.set.result", requestId: message.requestId, result });
          } catch {
            send({ type: "error", code: "memory_error", message: "Memory update failed", requestId: message.requestId, at: now() });
          }
        });
        break;
      }
      case "memory.get": {
        try {
          const result = memoryEngine.get(message.params);
          send({ type: "memory.get.result", requestId: message.requestId, result });
        } catch (err) {
          send({ type: "error", code: "memory_error", message: err instanceof Error ? err.message : String(err), at: now() });
        }
        break;
      }
      case "memory.query": {
        try {
          const result = memoryEngine.query(message.params);
          send({ type: "memory.query.result", requestId: message.requestId, result });
        } catch (err) {
          send({ type: "error", code: "memory_error", message: err instanceof Error ? err.message : String(err), at: now() });
        }
        break;
      }
      case "memory.delete": {
        requestCapability(message.requestId, "memory.delete", "write", {
          paramsDigest: digestArguments(message.params),
        }, async () => {
          try {
            const result = memoryEngine.delete(message.params);
            send({ type: "memory.delete.result", requestId: message.requestId, result });
          } catch {
            send({ type: "error", code: "memory_error", message: "Memory deletion failed", requestId: message.requestId, at: now() });
          }
        });
        break;
      }
    }
  });
  socket.on("close", () => {
    for (const unsub of unsubs) {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    }
    approvalGate.dispose("client disconnected");
    for (const request of capabilityRequests.values()) {
      if (request.state === "pending") capabilityBroker.revoke(request.token);
    }
    capabilityRequests.clear();
    void watcher?.close();
    // Shared PTY managers outlive an individual socket, so release only this
    // session's terminals rather than disposing the manager itself.
    void ptyManager.closeSessionsForOwner(ptyOwnerId).catch(() => undefined);
    auditStore.close();
    ptyManager.off("message", onTerminalMessage);
    if (!options.ptyManager) {
      ptyManager.dispose();
    }
    if (!options.subagentSupervisor) {
      void subagentSupervisor.dispose();
    }
    if (!options.daemonManager) {
      void daemonManager.dispose();
    }
  });
}
