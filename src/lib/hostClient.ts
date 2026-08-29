/**
 * Module 2 Task 7: WebSocket client for the local agent host.
 *
 * Connects to `ws://127.0.0.1:<port>/agent?token=<single-use-token>`. The
 * token is single-use, so reconnects are NOT automatic — once the socket
 * closes the client stays closed and the caller must obtain a fresh token.
 * A close with code 4401 (token rejected) surfaces as a typed
 * {@link HostAuthError}.
 *
 * The socket implementation is injectable (`WebSocketImpl`) so tests run in
 * a plain node environment without a real network.
 *
 * Wire protocol (all frames are JSON text):
 *   client -> host: plan.submit | approval.grant | approval.deny |
 *                   capability.approval |
 *                   run.pause | run.resume | run.cancel (each carries a requestId)
 *   host -> client: run.state | tool.approval_required |
 *                   capability.approval_required | capability.result | tool.output |
 *                   run.event | error | <rpcName>.result
 * A request resolves on the first host frame echoing its requestId
 * (typed `.result`/`workspace.ready`/etc. = success, `error`/`workspace.error` = rejection).
 * The client only ever sends approvals/pauses/cancels/plans — it NEVER emits
 * a tool execution frame; execution is the host's job after policy + grant.
 */
import type { ExecutionPlan, PlanUIState, ToolRunState } from "@/types";
import type { DirEntry, FileStat, SearchMatch, GitFileStatus } from "@/types/workspace";
import type { WorkspaceDescriptor, WorkspaceErrorCode, WorkspaceWriteResult } from "@protocol/workspace";
import type { HostIntegrationsState } from "@/lib/hostSession";
import type {
  InvokeSubagentParams,
  InvokeSubagentResult,
  ManageSubagentsParams,
  ManageSubagentsResult,
  SendMessageParams,
  SendMessageResult,
  DefineSubagentParams,
  DefineSubagentResult,
  SubagentInfo,
  SubagentMessage,
  SubagentLifecycleEvent,
  SubagentState,
  SubagentTelemetry,
} from "@protocol/subagents";
import type {
  ManageTaskParams,
  ManageTaskResult,
  ScheduleParams,
  ScheduleResult,
  TaskSummary,
  TaskLifecycleEvent,
} from "@protocol/tasks";
import type {
  MemoryEntry,
  MemorySetParams,
  MemorySetResult,
  MemoryGetParams,
  MemoryGetResult,
  MemoryQueryParams,
  MemoryQueryResult,
  MemoryDeleteParams,
  MemoryDeleteResult,
} from "@protocol/memory";
import type { CommandExecuteFrame, CommandResultFrame, SlashCommandWire } from "@protocol/commands";

/* ------------------------------------------------------------------ */
/* Wire message shapes                                                */
/* ------------------------------------------------------------------ */

export type HostClientRequestType =
  | "plan.submit"
  | "approval.grant"
  | "approval.deny"
  | "capability.approval"
  | "run.pause"
  | "run.resume"
  | "run.cancel"
  | "tool.response"
  | "workspace.describe"
  | "workspace.open"
  | "workspace.readDir"
  | "workspace.readFile"
  | "workspace.writeFile"
  | "workspace.stat"
  | "workspace.watch"
  | "workspace.search"
  | "workspace.gitStatus"
  | "integration.toggle"
  | "subagent.invoke"
  | "subagent.manage"
  | "subagent.sendMessage"
  | "subagent.define"
  | "task.manage"
  | "schedule.create"
  | "memory.set"
  | "memory.get"
  | "memory.query"
  | "memory.delete"
  | "playground.dispatchTurn"
  | "playground.simulateTurn"
  | "playground.injectFailure"
  | "command.execute";

export type ExecuteCommandInput = Omit<CommandExecuteFrame, "type" | "requestId">;

export interface HostClientRequest {
  type: HostClientRequestType;
  requestId: string;
  plan?: ExecutionPlan;
  runId?: string;
  stepId?: string;
  approved?: boolean;
  reason?: string;
  kind?: "rules" | "skill" | "mcp";
  id?: string;
  enabled?: boolean;
  params?: unknown;
  parentId?: string;
  callerId?: string;
  senderId?: string;
  creatorSubagentId?: string;
  command?: string;
  args?: string[];
  rawText?: string;
  parsed?: SlashCommandWire;
  path?: string;
  generation?: number;
  content?: string;
  expectedSha256?: string;
  expectedModified?: string;
}

export interface RunStateMessage {
  type: "run.state";
  runId: string;
  state: PlanUIState;
  stepStates?: Record<string, string>;
}

export interface ToolApprovalRequiredMessage {
  type: "tool.approval_required";
  runId: string;
  toolId: string;
  executable: string;
  args: string[];
  cwd: string;
  policyReason: string;
}

/** Host-issued, opaque, single-use approval request for a privileged action. */
export interface CapabilityApprovalRequiredMessage {
  type: "capability.approval_required";
  requestId: string;
  hostId: string;
  sessionId: string;
  workspaceId: string;
  generation: number;
  runId: string;
  stepId: string;
  toolId: string;
  argumentsDigest: string;
  scope: "read" | "write" | "execute" | "network" | "browser" | "mcp" | "schedule";
  expiresAt: string;
  uses: "single" | "multi";
  reason: string;
  at: string;
}

/** Result of deciding a capability request. A successful result is followed by
 * the original operation result; a rejected one terminates that operation. */
export interface CapabilityResultMessage {
  type: "capability.result";
  requestId: string;
  ok: boolean;
  errorCode?: "invalid_request" | "denied" | "expired" | "stale_binding" | "already_used";
  errorMessage?: string;
  at: string;
}

export interface ToolOutputMessage {
  type: "tool.output";
  runId: string;
  toolId: string;
  stream?: "stdout" | "stderr";
  chunk: string;
  truncated?: boolean;
  state?: ToolRunState;
  exitCode?: number;
}

export interface RunEventMessage {
  type: "run.event";
  runId: string;
  event: string;
  detail?: string;
  data?: unknown;
}

export interface HostErrorMessage {
  type: "error";
  code: string;
  message: string;
  requestId?: string;
  runId?: string;
}

export interface PlanSubmitResultMessage {
  type: "plan.submit.result";
  requestId: string;
  runId: string;
  accepted?: boolean;
  planId?: string;
  at?: string;
}

export interface RunPauseResultMessage {
  type: "run.pause.result";
  requestId: string;
  runId: string;
  at?: string;
}

export interface RunResumeResultMessage {
  type: "run.resume.result";
  requestId: string;
  runId: string;
  at?: string;
}

export interface RunCancelResultMessage {
  type: "run.cancel.result";
  requestId: string;
  runId: string;
  at?: string;
}

export interface ApprovalGrantResultMessage {
  type: "approval.grant.result";
  requestId: string;
  runId?: string;
  stepId?: string;
  resolved?: boolean;
  at?: string;
}

export interface ApprovalDenyResultMessage {
  type: "approval.deny.result";
  requestId: string;
  runId?: string;
  stepId?: string;
  resolved?: boolean;
  at?: string;
}

export interface ToolResponseResultMessage {
  type: "tool.response.result";
  requestId: string;
  resolved?: boolean;
  at?: string;
}

export interface IntegrationsSnapshotMessage {
  type: "integrations.snapshot";
  requestId?: string;
  snapshot: HostIntegrationsState;
}

export interface SubagentInvokeResultMessage {
  type: "subagent.invoke.result";
  requestId: string;
  result: InvokeSubagentResult;
}

export interface SubagentManageResultMessage {
  type: "subagent.manage.result";
  requestId: string;
  result: ManageSubagentsResult;
}

export interface SubagentSendMessageResultMessage {
  type: "subagent.sendMessage.result";
  requestId: string;
  result: SendMessageResult;
}

export interface SubagentDefineResultMessage {
  type: "subagent.define.result";
  requestId: string;
  result: DefineSubagentResult;
}

export interface SubagentEventMessage {
  type: "subagent.event";
  event: SubagentLifecycleEvent;
  at?: string;
}

export interface SubagentSpawnedMessage {
  type: "subagent.spawned";
  subagent: SubagentInfo;
  at?: string;
}

export interface SubagentStateChangedMessage {
  type: "subagent.state_changed" | "subagent.state";
  subagentId: string;
  previousState?: SubagentState;
  newState?: SubagentState;
  state?: SubagentState;
  reason?: string;
  tokensUsed?: number;
  at?: string;
}

export interface SubagentMessageSentMessage {
  type: "subagent.message_sent" | "subagent.message";
  message: SubagentMessage;
  at?: string;
}

export interface SubagentHeartbeatMessage {
  type: "subagent.heartbeat";
  subagentId: string;
  lastVisited: string;
  progressSummary?: string;
  at?: string;
}

export interface SubagentCompletedMessage {
  type: "subagent.completed";
  subagentId: string;
  tokensUsed: number;
  turnCount: number;
  handoffArtifact?: string;
  at?: string;
}

export interface SubagentErroredMessage {
  type: "subagent.errored";
  subagentId: string;
  error: string;
  code?: string;
  at?: string;
}

export interface SubagentTreeUpdatedMessage {
  type: "subagent.tree_updated";
  rootId: string;
  activeCount: number;
  tree: SubagentInfo[];
  at?: string;
}

export interface SubagentsSnapshotMessage {
  type: "subagents.snapshot";
  snapshot: SubagentInfo[];
  at?: string;
}

export interface TaskManageResultMessage {
  type: "task.manage.result";
  requestId: string;
  result: ManageTaskResult;
}

export interface ScheduleCreateResultMessage {
  type: "schedule.create.result";
  requestId: string;
  result: ScheduleResult;
}

export interface TaskEventMessage {
  type: "task.event";
  event: TaskLifecycleEvent;
  at?: string;
}

export interface TaskSpawnedMessage {
  type: "task.spawned";
  task: TaskSummary;
  at?: string;
}

export interface TaskCompletedMessage {
  type: "task.completed";
  taskId: string;
  exitCode?: number | null;
  durationMs?: number;
  at?: string;
}

export interface TaskKilledMessage {
  type: "task.killed";
  taskId: string;
  signal?: string;
  at?: string;
}

export interface ScheduleTriggeredMessage {
  type: "schedule.triggered";
  scheduleId: string;
  iteration: number;
  prompt: string;
  at?: string;
}

export interface ScheduleCancelledMessage {
  type: "schedule.cancelled";
  scheduleId: string;
  reason: string;
  at?: string;
}

export interface TasksSnapshotMessage {
  type: "tasks.snapshot";
  snapshot: TaskSummary[];
  at?: string;
}

export interface SchedulesSnapshotMessage {
  type: "schedules.snapshot";
  snapshot: ScheduleResult[];
  at?: string;
}

export interface MemorySetResultMessage {
  type: "memory.set.result";
  requestId: string;
  result: MemorySetResult;
}

export interface MemoryGetResultMessage {
  type: "memory.get.result";
  requestId: string;
  result: MemoryGetResult;
}

export interface MemoryQueryResultResultMessage {
  type: "memory.query.result";
  requestId: string;
  result: MemoryQueryResult;
}

export interface MemoryDeleteResultMessage {
  type: "memory.delete.result";
  requestId: string;
  result: MemoryDeleteResult;
}

export interface MemoryEntrySetMessage {
  type: "memory.entry_set";
  entry: MemoryEntry;
  at?: string;
}

export interface MemoryEntryDeletedMessage {
  type: "memory.entry_deleted";
  key: string;
  namespace: string;
  at?: string;
}

export interface MemoryClearedMessage {
  type: "memory.cleared";
  namespace?: string;
  at?: string;
}

export interface MemorySnapshotMessage {
  type: "memory.snapshot";
  snapshot: MemoryEntry[];
  at?: string;
}

export interface SubagentTelemetryUpdatedMessage {
  type: "subagent.telemetry_updated";
  subagentId: string;
  telemetry: SubagentTelemetry;
  at?: string;
}

export interface SubagentTurnStartedMessage {
  type: "subagent.turn_started";
  subagentId: string;
  turnId?: string;
  prompt?: string;
  at?: string;
}

export interface SubagentTurnCompletedMessage {
  type: "subagent.turn_completed";
  subagentId: string;
  turnId?: string;
  tokensUsed?: number;
  turnLatencyMs?: number;
  output?: string;
  at?: string;
}

export interface PlaygroundDispatchTurnResultMessage {
  type: "playground.dispatchTurn.result";
  requestId: string;
  result?: {
    success: boolean;
    turnId?: string;
    response?: string;
    tokensUsed?: number;
    latencyMs?: number;
  };
  turnId?: string;
  response?: string;
  tokensUsed?: number;
  latencyMs?: number;
  success?: boolean;
}

export interface PlaygroundSimulateTurnResultMessage {
  type: "playground.simulateTurn.result";
  requestId: string;
  result?: {
    success: boolean;
    turnId?: string;
    scenario?: string;
    output?: string;
    tokensUsed?: number;
    latencyMs?: number;
  };
  turnId?: string;
  scenario?: string;
  output?: string;
  tokensUsed?: number;
  latencyMs?: number;
  success?: boolean;
}

export interface PlaygroundInjectFailureResultMessage {
  type: "playground.injectFailure.result";
  requestId: string;
  result?: {
    success: boolean;
    affectedSubagents?: string[];
    recovered?: boolean;
    message?: string;
  };
  affectedSubagents?: string[];
  recovered?: boolean;
  message?: string;
  success?: boolean;
}

export type HostMessage =
  | RunStateMessage
  | ToolApprovalRequiredMessage
  | CapabilityApprovalRequiredMessage
  | CapabilityResultMessage
  | ToolOutputMessage
  | RunEventMessage
  | HostErrorMessage
  | PlanSubmitResultMessage
  | RunPauseResultMessage
  | RunResumeResultMessage
  | RunCancelResultMessage
  | ApprovalGrantResultMessage
  | ApprovalDenyResultMessage
  | ToolResponseResultMessage
  | IntegrationsSnapshotMessage
  | SubagentInvokeResultMessage
  | SubagentManageResultMessage
  | SubagentSendMessageResultMessage
  | SubagentDefineResultMessage
  | SubagentEventMessage
  | SubagentSpawnedMessage
  | SubagentStateChangedMessage
  | SubagentMessageSentMessage
  | SubagentHeartbeatMessage
  | SubagentCompletedMessage
  | SubagentErroredMessage
  | SubagentTreeUpdatedMessage
  | SubagentsSnapshotMessage
  | TaskManageResultMessage
  | ScheduleCreateResultMessage
  | TaskEventMessage
  | TaskSpawnedMessage
  | TaskCompletedMessage
  | TaskKilledMessage
  | ScheduleTriggeredMessage
  | ScheduleCancelledMessage
  | TasksSnapshotMessage
  | SchedulesSnapshotMessage
  | MemorySetResultMessage
  | MemoryGetResultMessage
  | MemoryQueryResultResultMessage
  | MemoryDeleteResultMessage
  | MemoryEntrySetMessage
  | MemoryEntryDeletedMessage
  | MemoryClearedMessage
  | MemorySnapshotMessage
  | SubagentTelemetryUpdatedMessage
  | SubagentTurnStartedMessage
  | SubagentTurnCompletedMessage
  | PlaygroundDispatchTurnResultMessage
  | PlaygroundSimulateTurnResultMessage
  | PlaygroundInjectFailureResultMessage
  | CommandResultFrame
  | WorkspaceReadyMessage
  | WorkspaceErrorMessage
  | { type: "workspace.readDir.result"; requestId: string; path: string; entries: DirEntry[] }
  | { type: "workspace.readFile.result"; requestId: string; path: string; content: string; language: string; size: number; modified: string; sha256: string; generation: number }
  | { type: "workspace.writeFile.result"; requestId: string; path: string; generation: number; success: boolean; modified?: string; sha256?: string; bytesWritten?: number }
  | { type: "workspace.stat.result"; requestId: string; path: string; stat: FileStat; generation: number }
  | { type: "workspace.search.result"; requestId: string; matches: SearchMatch[] }
  | { type: "workspace.gitStatus.result"; requestId: string; files: GitFileStatus[] }
  | { type: "workspace.watch.result"; requestId?: string; enabled: boolean; generation: number }
  | { type: "workspace.fileChanged"; path: string; changeType: "created" | "modified" | "deleted" };

/** Any host frame may carry a requestId correlating it to a client request. */
type WithRequestId = { requestId?: string };

/* ------------------------------------------------------------------ */
/* Errors                                                             */
/* ------------------------------------------------------------------ */

/** Socket closed with 4401 — single-use token missing, reused, or expired. */
export class HostAuthError extends Error {
  readonly code = 4401;
  constructor(reason?: string) {
    super(`agent host rejected the session token (4401)${reason ? `: ${reason}` : ""}`);
    this.name = "HostAuthError";
  }
}

/** Socket closed with 4401 due to origin mismatch against host allowedOrigins. */
export class HostOriginMismatchError extends HostAuthError {
  constructor(reason?: string) {
    super(reason ?? "origin not permitted by host");
    this.name = "HostOriginMismatchError";
    this.message =
      "Origin mismatch: The UI origin is not permitted by the local agent host. Please launch NanoForge from the authorized launcher origin (e.g. http://127.0.0.1:4183) or configure allowedOrigins on the host.";
  }
}

/** Socket closed for a non-auth reason before/between requests. */
export class HostConnectionError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "HostConnectionError";
    this.code = code;
  }
}

/**
 * Calculates a bounded exponential backoff delay with jitter.
 * Defaults: 500ms -> 1000ms -> 2000ms -> 4000ms -> up to 10000ms max with 25% jitter.
 */
export function calculateBackoffDelay(
  attempt: number,
  baseMs = 500,
  maxMs = 10000,
  jitterFactor = 0.25,
  randomFn: () => number = Math.random
): number {
  const boundedAttempt = Math.max(0, Math.min(attempt, 30));
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, boundedAttempt));
  const jitter = exponential * jitterFactor * (typeof randomFn === "function" ? randomFn() : Math.random());
  return Math.min(maxMs, Math.round(exponential + jitter));
}

/* ------------------------------------------------------------------ */
/* Injectable socket                                                  */
/* ------------------------------------------------------------------ */

/** Structural subset of the browser WebSocket the client relies on. */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface HostClientOptions {
  /** Loopback port printed by the host on startup. Required without websocketUrl. */
  port?: number;
  /** Single-use bearer token. Required without websocketUrl. Never persisted by this client. */
  token?: string;
  /** Ephemeral broker-supplied endpoint. It is never written to browser storage. */
  websocketUrl?: string;
  /** Override for tests; defaults to the global WebSocket constructor. */
  WebSocketImpl?: WebSocketFactory;
  /** Bounds failed workspace requests so a missing host reply cannot hang the UI. */
  requestTimeoutMs?: number;
  /** Maximum reconnect attempts when using backoff (default: 5). */
  maxReconnectAttempts?: number;
  /** Initial backoff delay in ms (default: 500ms). */
  initialBackoffMs?: number;
  /** Maximum backoff delay in ms (default: 10000ms). */
  maxBackoffMs?: number;
}

/** Safe browser-facing result of a future host workspace picker/select flow. */
export type HostWorkspaceDescriptor = WorkspaceDescriptor;

export interface WorkspaceReadyMessage {
  type: "workspace.ready";
  requestId?: string;
  workspace: HostWorkspaceDescriptor;
  at: string;
}

export interface WorkspaceErrorMessage {
  type: "workspace.error";
  requestId?: string;
  code: WorkspaceErrorCode;
  message: string;
  generation: number;
  recoverable: boolean;
}

const WS_OPEN = 1;
const AUTH_CLOSE_CODE = 4401;

const HOST_MESSAGE_TYPES = new Set([
  "run.state",
  "tool.approval_required",
  "capability.approval_required",
  "capability.result",
  "tool.output",
  "run.event",
  "error",
  "plan.submit.result",
  "run.pause.result",
  "run.resume.result",
  "run.cancel.result",
  "approval.grant.result",
  "approval.deny.result",
  "tool.response.result",
  "workspace.ready",
  "workspace.error",
  "workspace.readDir.result",
  "workspace.readFile.result",
  "workspace.writeFile.result",
  "workspace.stat.result",
  "workspace.search.result",
  "workspace.gitStatus.result",
  "workspace.fileChanged",
  "workspace.watch.result",
  "integrations.snapshot",
  "subagent.invoke.result",
  "subagent.manage.result",
  "subagent.sendMessage.result",
  "subagent.define.result",
  "subagent.event",
  "subagent.spawned",
  "subagent.state_changed",
  "subagent.state",
  "subagent.message_sent",
  "subagent.message",
  "subagent.heartbeat",
  "subagent.completed",
  "subagent.errored",
  "subagent.tree_updated",
  "subagents.snapshot",
  "task.manage.result",
  "schedule.create.result",
  "task.event",
  "task.spawned",
  "task.completed",
  "task.killed",
  "schedule.triggered",
  "schedule.cancelled",
  "tasks.snapshot",
  "schedules.snapshot",
  "memory.set.result",
  "memory.get.result",
  "memory.query.result",
  "memory.delete.result",
  "memory.entry_set",
  "memory.entry_deleted",
  "memory.cleared",
  "memory.snapshot",
  "subagent.telemetry_updated",
  "subagent.turn_started",
  "subagent.turn_completed",
  "playground.dispatchTurn.result",
  "playground.simulateTurn.result",
  "playground.injectFailure.result",
  "command.result",
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isString = (v: unknown): v is string => typeof v === "string";

/**
 * Lightweight defensive validation of an incoming frame. Returns the typed
 * message or null when the frame is malformed (malformed frames are dropped;
 * model/host output is untrusted by contract).
 */
export function parseHostMessage(raw: unknown): (HostMessage & WithRequestId) | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(data) || !isString(data.type) || !HOST_MESSAGE_TYPES.has(data.type)) return null;
  const requestId = isString(data.requestId) ? data.requestId : undefined;

  switch (data.type) {
    case "run.state":
      if (!isString(data.runId) || !isString(data.state)) return null;
      return { ...(data as unknown as RunStateMessage), requestId };
    case "tool.approval_required":
      if (
        !isString(data.runId) ||
        !isString(data.toolId) ||
        !isString(data.executable) ||
        !Array.isArray(data.args) ||
        !data.args.every(isString) ||
        !isString(data.cwd) ||
        !isString(data.policyReason)
      )
        return null;
      return { ...(data as unknown as ToolApprovalRequiredMessage), requestId };
    case "capability.approval_required":
      if (
        !isString(data.requestId) ||
        !isString(data.hostId) ||
        !isString(data.sessionId) ||
        !isString(data.workspaceId) ||
        typeof data.generation !== "number" ||
        !isString(data.runId) ||
        !isString(data.stepId) ||
        !isString(data.toolId) ||
        !isString(data.argumentsDigest) ||
        !isString(data.scope) ||
        !isString(data.expiresAt) ||
        !isString(data.uses) ||
        !isString(data.reason) ||
        !isString(data.at)
      ) return null;
      if (!/^(read|write|execute|network|browser|mcp|schedule)$/.test(data.scope)) return null;
      if (!/^(single|multi)$/.test(data.uses)) return null;
      return data as unknown as CapabilityApprovalRequiredMessage;
    case "capability.result":
      if (!isString(data.requestId) || typeof data.ok !== "boolean" || !isString(data.at)) return null;
      if (data.errorCode !== undefined && !isString(data.errorCode)) return null;
      if (data.errorMessage !== undefined && !isString(data.errorMessage)) return null;
      return data as unknown as CapabilityResultMessage;
    case "tool.output":
      if (!isString(data.runId) || !isString(data.toolId) || !isString(data.chunk)) return null;
      return { ...(data as unknown as ToolOutputMessage), requestId };
    case "run.event":
      if (!isString(data.runId) || !isString(data.event)) return null;
      return { ...(data as unknown as RunEventMessage), requestId };
    case "error":
      if (!isString(data.code) || !isString(data.message)) return null;
      return { ...(data as unknown as HostErrorMessage), requestId };
    case "plan.submit.result":
      if (!isString(data.requestId) || !isString(data.runId)) return null;
      return { ...(data as unknown as PlanSubmitResultMessage), requestId: data.requestId as string };
    case "run.pause.result":
      if (!isString(data.requestId) || !isString(data.runId)) return null;
      return { ...(data as unknown as RunPauseResultMessage), requestId: data.requestId as string };
    case "run.resume.result":
      if (!isString(data.requestId) || !isString(data.runId)) return null;
      return { ...(data as unknown as RunResumeResultMessage), requestId: data.requestId as string };
    case "run.cancel.result":
      if (!isString(data.requestId) || !isString(data.runId)) return null;
      return { ...(data as unknown as RunCancelResultMessage), requestId: data.requestId as string };
    case "approval.grant.result":
      if (!isString(data.requestId)) return null;
      return { ...(data as unknown as ApprovalGrantResultMessage), requestId: data.requestId as string };
    case "approval.deny.result":
      if (!isString(data.requestId)) return null;
      return { ...(data as unknown as ApprovalDenyResultMessage), requestId: data.requestId as string };
    case "tool.response.result":
      if (!isString(data.requestId)) return null;
      return { ...(data as unknown as ToolResponseResultMessage), requestId: data.requestId as string };
    case "workspace.ready":
      if (!isRecord(data.workspace) || !isString(data.workspace.id) || !isString(data.workspace.name) || !isString(data.workspace.displayPath) || typeof data.workspace.generation !== "number") return null;
      return { ...(data as unknown as WorkspaceReadyMessage), requestId };
    case "workspace.error":
      if (!isString(data.code) || !isString(data.message) || typeof data.generation !== "number") return null;
      return { ...(data as unknown as WorkspaceErrorMessage), requestId };
    case "workspace.readDir.result":
      if (!isString(data.requestId) || !isString(data.path) || !Array.isArray(data.entries)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "workspace.search.result":
      if (!isString(data.requestId) || !Array.isArray(data.matches)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "workspace.gitStatus.result":
      if (!isString(data.requestId) || !Array.isArray(data.files)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "workspace.fileChanged":
      if (!isString(data.path) || !isString(data.changeType)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "workspace.watch.result":
      if (typeof data.enabled !== "boolean" || typeof data.generation !== "number") return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "integrations.snapshot":
      if (!isRecord(data.snapshot)) return null;
      return { ...(data as unknown as IntegrationsSnapshotMessage), requestId };
    case "subagent.invoke.result":
    case "subagent.manage.result":
    case "subagent.sendMessage.result":
    case "subagent.define.result":
    case "task.manage.result":
    case "schedule.create.result":
      if (!isString(data.requestId)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "workspace.readFile.result":
      if (!isString(data.requestId) || !isString(data.path) || !isString(data.content) || !isString(data.language) || typeof data.size !== "number") return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "workspace.writeFile.result":
      if (!isString(data.requestId) || !isString(data.path) || typeof data.success !== "boolean") return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "workspace.stat.result":
      if (!isString(data.requestId) || !isString(data.path) || !isRecord(data.stat)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "command.result":
      if (!isString(data.command) || typeof data.success !== "boolean") return null;
      if (data.output !== undefined && !isString(data.output)) return null;
      if (data.error !== undefined && !isString(data.error)) return null;
      return { ...(data as unknown as CommandResultFrame), requestId };
    case "subagent.event":
      if (!isRecord(data.event)) return null;
      return { ...(data as unknown as SubagentEventMessage), requestId };
    case "subagent.spawned":
      if (!isRecord(data.subagent)) return null;
      return { ...(data as unknown as SubagentSpawnedMessage), requestId };
    case "subagent.state_changed":
    case "subagent.state":
      if (!isString(data.subagentId)) return null;
      return { ...(data as unknown as SubagentStateChangedMessage), requestId };
    case "subagent.message_sent":
    case "subagent.message":
      if (!isRecord(data.message)) return null;
      return { ...(data as unknown as SubagentMessageSentMessage), requestId };
    case "subagent.heartbeat":
      if (!isString(data.subagentId)) return null;
      return { ...(data as unknown as SubagentHeartbeatMessage), requestId };
    case "subagent.completed":
      if (!isString(data.subagentId)) return null;
      return { ...(data as unknown as SubagentCompletedMessage), requestId };
    case "subagent.errored":
      if (!isString(data.subagentId) || !isString(data.error)) return null;
      return { ...(data as unknown as SubagentErroredMessage), requestId };
    case "subagent.tree_updated":
      if (!isString(data.rootId) || !Array.isArray(data.tree)) return null;
      return { ...(data as unknown as SubagentTreeUpdatedMessage), requestId };
    case "subagents.snapshot":
      if (!Array.isArray(data.snapshot)) return null;
      return { ...(data as unknown as SubagentsSnapshotMessage), requestId };
    case "task.event":
      if (!isRecord(data.event)) return null;
      return { ...(data as unknown as TaskEventMessage), requestId };
    case "task.spawned":
      if (!isRecord(data.task)) return null;
      return { ...(data as unknown as TaskSpawnedMessage), requestId };
    case "task.completed":
      if (!isString(data.taskId)) return null;
      return { ...(data as unknown as TaskCompletedMessage), requestId };
    case "task.killed":
      if (!isString(data.taskId)) return null;
      return { ...(data as unknown as TaskKilledMessage), requestId };
    case "schedule.triggered":
      if (!isString(data.scheduleId)) return null;
      return { ...(data as unknown as ScheduleTriggeredMessage), requestId };
    case "schedule.cancelled":
      if (!isString(data.scheduleId)) return null;
      return { ...(data as unknown as ScheduleCancelledMessage), requestId };
    case "tasks.snapshot":
      if (!Array.isArray(data.snapshot)) return null;
      return { ...(data as unknown as TasksSnapshotMessage), requestId };
    case "schedules.snapshot":
      if (!Array.isArray(data.snapshot)) return null;
      return { ...(data as unknown as SchedulesSnapshotMessage), requestId };
    case "memory.set.result":
    case "memory.get.result":
    case "memory.query.result":
    case "memory.delete.result":
    case "playground.dispatchTurn.result":
    case "playground.simulateTurn.result":
    case "playground.injectFailure.result":
      if (!isString(data.requestId)) return null;
      return { ...(data as Record<string, unknown>), requestId } as never;
    case "memory.entry_set":
      if (!isRecord(data.entry)) return null;
      return { ...(data as unknown as MemoryEntrySetMessage), requestId };
    case "memory.entry_deleted":
      if (!isString(data.key) || !isString(data.namespace)) return null;
      return { ...(data as unknown as MemoryEntryDeletedMessage), requestId };
    case "memory.cleared":
      return { ...(data as unknown as MemoryClearedMessage), requestId };
    case "memory.snapshot":
      if (!Array.isArray(data.snapshot)) return null;
      return { ...(data as unknown as MemorySnapshotMessage), requestId };
    case "subagent.telemetry_updated":
      if (!isString(data.subagentId) || !isRecord(data.telemetry)) return null;
      return { ...(data as unknown as SubagentTelemetryUpdatedMessage), requestId };
    case "subagent.turn_started":
      if (!isString(data.subagentId)) return null;
      return { ...(data as unknown as SubagentTurnStartedMessage), requestId };
    case "subagent.turn_completed":
      if (!isString(data.subagentId)) return null;
      return { ...(data as unknown as SubagentTurnCompletedMessage), requestId };
    default:
      return null;
  }
}

export type HostEventHandler = (msg: HostMessage) => void;

interface PendingRequest {
  resolve: (value?: any) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class HostClient {
  private readonly url: string;
  private readonly makeSocket: WebSocketFactory;
  private ws: WebSocketLike | null = null;
  private seq = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscribers = new Set<HostEventHandler>();
  private openPromise: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private closed = false;
  private readonly requestTimeoutMs: number;
  private workspaceGeneration: number | null = null;
  public readonly maxReconnectAttempts: number;
  public readonly initialBackoffMs: number;
  public readonly maxBackoffMs: number;

  constructor(opts: HostClientOptions) {
    if (opts.websocketUrl) {
      this.url = opts.websocketUrl;
    } else if (typeof opts.port === "number" && opts.token) {
      this.url = `ws://127.0.0.1:${opts.port}/agent?token=${encodeURIComponent(opts.token)}`;
    } else {
      throw new HostConnectionError("host connection needs websocketUrl or port and token");
    }
    this.makeSocket =
      opts.WebSocketImpl ??
      ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 15_000;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 5;
    this.initialBackoffMs = opts.initialBackoffMs ?? 500;
    this.maxBackoffMs = opts.maxBackoffMs ?? 10_000;
  }

  /** Calculate backoff delay with jitter for a given attempt index */
  calculateBackoff(attempt: number, randomFn?: () => number): number {
    return calculateBackoffDelay(attempt, this.initialBackoffMs, this.maxBackoffMs, 0.25, randomFn);
  }

  /** Connect with bounded exponential backoff with jitter on transient failures */
  async connectWithRetry(options?: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    onRetry?: (attempt: number, delayMs: number) => void;
  }): Promise<void> {
    const maxAttempts = options?.maxAttempts ?? this.maxReconnectAttempts;
    const initialDelayMs = options?.initialDelayMs ?? this.initialBackoffMs;
    const maxDelayMs = options?.maxDelayMs ?? this.maxBackoffMs;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.connect();
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (
          err instanceof HostOriginMismatchError ||
          (err instanceof HostAuthError && !(err instanceof HostOriginMismatchError)) ||
          this.closed
        ) {
          throw err;
        }
        if (attempt < maxAttempts - 1) {
          const delay = calculateBackoffDelay(attempt, initialDelayMs, maxDelayMs);
          options?.onRetry?.(attempt + 1, delay);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError ?? new HostConnectionError("Failed to connect to host after retries");
  }

  /** Open the socket. Resolves on `open`; rejects HostAuthError on a 4401 close. */
  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WS_OPEN) return Promise.resolve();
    if (this.closed) return Promise.reject(new HostConnectionError("host client is closed"));
    this.ws = this.makeSocket(this.url);
    this.ws.onopen = () => {
      this.openPromise?.resolve();
      this.openPromise = null;
    };
    this.ws.onmessage = (ev) => this.handleFrame(ev.data);
    this.ws.onerror = () => {
      /* errors always arrive with/are followed by a close event */
    };
    this.ws.onclose = (ev) => this.handleClose(ev.code, ev.reason);
    return new Promise<void>((resolve, reject) => {
      this.openPromise = { resolve, reject };
    });
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WS_OPEN;
  }

  /** Subscribe to validated host events. Returns an unsubscribe function. */
  onEvent(handler: HostEventHandler): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  submitPlan(plan: ExecutionPlan): Promise<PlanSubmitResultMessage> {
    return this.requestResult({ type: "plan.submit", plan }).then(
      (m) => m as PlanSubmitResultMessage,
    );
  }

  grantApproval(runId: string, stepId: string): Promise<ApprovalGrantResultMessage> {
    return this.requestResult({ type: "approval.grant", runId, stepId }).then(
      (m) => m as ApprovalGrantResultMessage,
    );
  }

  denyApproval(runId: string, stepId: string, reason?: string): Promise<ApprovalDenyResultMessage> {
    return this.requestResult({
      type: "approval.deny",
      runId,
      stepId,
      ...(reason ? { reason } : {}),
    }).then((m) => m as ApprovalDenyResultMessage);
  }

  pauseRun(runId: string): Promise<RunPauseResultMessage> {
    return this.requestResult({ type: "run.pause", runId }).then(
      (m) => m as RunPauseResultMessage,
    );
  }

  resumeRun(runId: string): Promise<RunResumeResultMessage> {
    return this.requestResult({ type: "run.resume", runId }).then(
      (m) => m as RunResumeResultMessage,
    );
  }

  cancelRun(runId: string, reason?: string): Promise<RunCancelResultMessage> {
    return this.requestResult({
      type: "run.cancel",
      runId,
      ...(reason ? { reason } : {}),
    }).then((m) => m as RunCancelResultMessage);
  }

  sendToolResponse(requestId: string, approved: boolean, reason?: string): Promise<ToolResponseResultMessage> {
    return this.requestResult({
      type: "tool.response",
      requestId,
      approved,
      ...(reason ? { reason } : {}),
    }).then((m) => m as ToolResponseResultMessage);
  }

  /** Answer an existing host-issued capability prompt. The original request
   * keeps its correlation id and resolves only when the operation finishes. */
  respondToCapabilityApproval(requestId: string, approved: boolean, reason?: string): Promise<void> {
    return this.sendOneWay({
      type: "capability.approval",
      requestId,
      approved,
      ...(reason ? { reason } : {}),
    });
  }

  /** Read the active host workspace after a fresh broker handoff. */
  describeWorkspace(): Promise<HostWorkspaceDescriptor> {
    return this.requestResult({ type: "workspace.describe" }).then((m) => {
      const workspace = (m as WorkspaceReadyMessage).workspace;
      this.workspaceGeneration = workspace.generation;
      return workspace;
    });
  }

  /** Generation-verified workspace check */
  verifyWorkspaceGeneration(expectedGeneration: number): Promise<HostWorkspaceDescriptor> {
    return this.describeWorkspace().then((descriptor) => {
      if (descriptor.generation !== expectedGeneration) {
        throw new HostConnectionError(
          `Workspace generation mismatch: expected generation ${expectedGeneration}, got ${descriptor.generation}`
        );
      }
      return descriptor;
    });
  }

  readDir(path = ""): Promise<DirEntry[]> { return this.requestResult({ type: "workspace.readDir", path, ...this.workspaceGenerationRequest() }).then((m) => (m as { entries: DirEntry[] }).entries); }
  readFile(path: string): Promise<{ path: string; content: string; language: string; size: number; modified: string; sha256: string; generation: number }> {
    return this.requestResult({ type: "workspace.readFile", path, ...this.workspaceGenerationRequest() }).then((m) => m as { path: string; content: string; language: string; size: number; modified: string; sha256: string; generation: number });
  }
  stat(path: string): Promise<FileStat> {
    return this.requestResult({ type: "workspace.stat", path, ...this.workspaceGenerationRequest() }).then((m) => (m as { stat: FileStat }).stat);
  }
  search(query: string, options?: { caseSensitive?: boolean; includes?: string[]; maxResults?: number }): Promise<SearchMatch[]> {
    return this.requestResult({ type: "workspace.search", query, options, ...this.workspaceGenerationRequest() }).then((m) => (m as { matches: SearchMatch[] }).matches);
  }
  gitStatus(): Promise<GitFileStatus[]> { return this.requestResult({ type: "workspace.gitStatus", ...this.workspaceGenerationRequest() }).then((m) => (m as { files: GitFileStatus[] }).files); }
  writeFile(path: string, content: string, options?: { expectedSha256?: string; expectedModified?: string }): Promise<WorkspaceWriteResult> {
    return this.requestResult({ type: "workspace.writeFile", path, content, ...options, ...this.workspaceGenerationRequest() }).then((m) => {
      if (!(m as { success?: boolean }).success) throw new HostConnectionError(`host rejected write for ${path}`);
      return m as WorkspaceWriteResult;
    });
  }
  watch(): Promise<void> { return this.sendOneWay({ type: "workspace.watch", enabled: true, ...this.workspaceGenerationRequest() }); }
  unwatch(): Promise<void> { return this.sendOneWay({ type: "workspace.watch", enabled: false, ...this.workspaceGenerationRequest() }); }
  /** Open a path supplied by an explicit local-user action. The host validates it. */
  openWorkspace(path: string, generation = 1): Promise<HostWorkspaceDescriptor> {
    return this.requestResult({ type: "workspace.open", path, generation }).then((m) => (m as WorkspaceReadyMessage).workspace);
  }

  /** Backwards-compatible alias for the earlier picker seam. */
  selectWorkspace(path: string): Promise<HostWorkspaceDescriptor> {
    return this.openWorkspace(path);
  }
  toggleIntegration(kind: "rules" | "skill" | "mcp", id: string, enabled: boolean): Promise<void> {
    return this.request({ type: "integration.toggle", kind, id, enabled });
  }

  invokeSubagent(params: InvokeSubagentParams, parentId?: string): Promise<InvokeSubagentResult> {
    return this.requestResult({
      type: "subagent.invoke",
      params,
      ...(parentId ? { parentId } : {}),
    }).then((m) => (m as { result?: InvokeSubagentResult }).result ?? (m as unknown as InvokeSubagentResult));
  }

  manageSubagents(params: ManageSubagentsParams, callerId?: string): Promise<ManageSubagentsResult> {
    return this.requestResult({
      type: "subagent.manage",
      params,
      ...(callerId ? { callerId } : {}),
    }).then((m) => (m as { result?: ManageSubagentsResult }).result ?? (m as unknown as ManageSubagentsResult));
  }

  sendMessage(params: SendMessageParams, senderId = "root"): Promise<SendMessageResult> {
    return this.requestResult({
      type: "subagent.sendMessage",
      params,
      senderId,
    }).then((m) => (m as { result?: SendMessageResult }).result ?? (m as unknown as SendMessageResult));
  }

  defineSubagent(params: DefineSubagentParams): Promise<DefineSubagentResult> {
    return this.requestResult({
      type: "subagent.define",
      params,
    }).then((m) => (m as { result?: DefineSubagentResult }).result ?? (m as unknown as DefineSubagentResult));
  }

  /** Execute a typed slash-command frame through the authenticated host. */
  executeCommand(input: ExecuteCommandInput): Promise<CommandResultFrame> {
    const args = input.args ?? [];
    return this.requestResult({
      type: "command.execute",
      command: input.command,
      args,
      rawText: input.rawText ?? [input.command, ...args].join(" "),
      ...(input.parsed ? { parsed: input.parsed } : {}),
    }).then((message) => message as CommandResultFrame);
  }

  /** Alias retained for command-dispatch callers. */
  dispatchCommand(input: ExecuteCommandInput): Promise<CommandResultFrame> {
    return this.executeCommand(input);
  }

  manageTask(params: ManageTaskParams): Promise<ManageTaskResult> {
    return this.requestResult({
      type: "task.manage",
      params,
    }).then((m) => (m as { result?: ManageTaskResult }).result ?? (m as unknown as ManageTaskResult));
  }

  createSchedule(params: ScheduleParams, creatorSubagentId?: string): Promise<ScheduleResult> {
    return this.requestResult({
      type: "schedule.create",
      params,
      ...(creatorSubagentId ? { creatorSubagentId } : {}),
    }).then((m) => (m as { result?: ScheduleResult }).result ?? (m as unknown as ScheduleResult));
  }

  setSharedMemory(params: MemorySetParams): Promise<MemorySetResult> {
    return this.requestResult({
      type: "memory.set",
      params,
    }).then((m) => (m as { result?: MemorySetResult }).result ?? (m as unknown as MemorySetResult));
  }

  getSharedMemory(params: MemoryGetParams): Promise<MemoryGetResult> {
    return this.requestResult({
      type: "memory.get",
      params,
    }).then((m) => (m as { result?: MemoryGetResult }).result ?? (m as unknown as MemoryGetResult));
  }

  querySharedMemory(params: MemoryQueryParams): Promise<MemoryQueryResult> {
    return this.requestResult({
      type: "memory.query",
      params,
    }).then((m) => (m as { result?: MemoryQueryResult }).result ?? (m as unknown as MemoryQueryResult));
  }

  deleteSharedMemory(params: MemoryDeleteParams): Promise<MemoryDeleteResult> {
    return this.requestResult({
      type: "memory.delete",
      params,
    }).then((m) => (m as { result?: MemoryDeleteResult }).result ?? (m as unknown as MemoryDeleteResult));
  }

  dispatchPlaygroundTurn(subagentId: string, prompt: string): Promise<any> {
    return this.requestResult({
      type: "playground.dispatchTurn",
      params: { subagentId, prompt },
    }).then((m) => (m as { result?: any }).result ?? m);
  }

  simulateAgentTurn(subagentId: string, scenario: string): Promise<any> {
    return this.requestResult({
      type: "playground.simulateTurn",
      params: { subagentId, scenario },
    }).then((m) => (m as { result?: any }).result ?? m);
  }

  injectAgentFailure(subagentId: string, failureType: string, strategy?: string): Promise<any> {
    return this.requestResult({
      type: "playground.injectFailure",
      params: { subagentId, failureType, ...(strategy ? { strategy } : {}) },
    }).then((m) => (m as { result?: any }).result ?? m);
  }

  /** Terminate the session. No reconnect — the token is single-use. */
  close(): void {
    this.closed = true;
    this.failPending(new HostConnectionError("host client closed"));
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState !== 3 /* CLOSED */) {
      try {
        ws.close(1000, "client done");
      } catch {
        /* fake sockets may throw; ignore */
      }
    }
  }

  /* ------------------------------ internals ------------------------------ */

  private request(msg: Omit<HostClientRequest, "requestId">): Promise<void> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      return Promise.reject(new HostConnectionError("not connected to agent host"));
    }
    const requestId = `req-${++this.seq}`;
    const frame: HostClientRequest = { ...msg, requestId };
    return new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, this.pendingRequest(requestId, resolve, reject));
      this.ws!.send(JSON.stringify(frame));
    });
  }

  private requestResult(msg: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return Promise.reject(new HostConnectionError("not connected to agent host"));
    const requestId = `req-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, this.pendingRequest(requestId, resolve, reject));
      this.ws!.send(JSON.stringify({ ...msg, requestId }));
    });
  }

  private sendOneWay(msg: Record<string, unknown>): Promise<void> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return Promise.reject(new HostConnectionError("not connected to agent host"));
    this.ws.send(JSON.stringify(msg));
    return Promise.resolve();
  }

  private workspaceGenerationRequest(): { generation?: number } {
    return this.workspaceGeneration === null ? {} : { generation: this.workspaceGeneration };
  }

  private pendingRequest(requestId: string, resolve: (value?: any) => void, reject: (error: Error) => void): PendingRequest {
    const timeout = setTimeout(() => {
      if (this.pending.delete(requestId)) reject(new HostConnectionError(`agent host request timed out (${requestId})`));
    }, this.requestTimeoutMs);
    return { resolve, reject, timeout };
  }

  private handleFrame(raw: unknown): void {
    const msg = parseHostMessage(typeof raw === "string" ? raw : String(raw));
    if (!msg) return; // untrusted/malformed frame: drop silently

    // request/response correlation
    const isCapabilityIntermediate =
      msg.type === "capability.approval_required" ||
      (msg.type === "capability.result" && msg.ok);
    if (msg.requestId && !isCapabilityIntermediate) {
      const p = this.pending.get(msg.requestId);
      if (p) {
        this.pending.delete(msg.requestId);
        clearTimeout(p.timeout);
        if (msg.type === "error" || msg.type === "workspace.error") {
          p.reject(new HostConnectionError(`${msg.code}: ${msg.message}`));
        } else if (msg.type === "capability.result") {
          p.reject(new HostConnectionError(`${msg.errorCode ?? "denied"}: ${msg.errorMessage ?? "Capability denied"}`));
        } else {
          p.resolve(msg);
        }
      }
    }

    for (const handler of this.subscribers) handler(msg);
  }

  private handleClose(code: number, reason?: string): void {
    const isOriginMismatch =
      code === AUTH_CLOSE_CODE &&
      typeof reason === "string" &&
      reason.toLowerCase().includes("origin");

    const err = isOriginMismatch
      ? new HostOriginMismatchError(reason)
      : code === AUTH_CLOSE_CODE
        ? new HostAuthError(reason)
        : new HostConnectionError(
            `agent host socket closed (${code}${reason ? `: ${reason}` : ""})`,
            code,
          );
    if (this.openPromise) {
      this.openPromise.reject(err);
      this.openPromise = null;
    }
    this.failPending(err);
    if (code === AUTH_CLOSE_CODE) {
      for (const handler of this.subscribers) {
        handler({
          type: "error",
          code: isOriginMismatch ? "origin_mismatch" : "unauthorized",
          message: err.message,
        });
      }
    }
  }

  private failPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timeout);
      p.reject(err);
    }
    this.pending.clear();
  }
}
