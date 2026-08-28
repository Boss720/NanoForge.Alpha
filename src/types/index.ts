import type { X402Quote } from "@/lib/x402";
import type { ChatAttachment } from "@/types/attachments";

export type {
  AttachmentSource,
  AttachmentStatus,
  ChatAttachment,
  ChatAttachmentDraft,
  ChatSendInput,
  WorkspaceAttachmentContent,
  WorkspaceAttachmentResolver,
} from "@/types/attachments";

export interface NanoModel {
  id: string;
  name: string;
  provider: string;
  /** USD per 1M tokens */
  inputPrice: number;
  outputPrice: number;
  contextK: number;
  tags: string[];
  /** true when returned by the live /api/v1/models endpoint */
  live?: boolean;
  /** true when pricing came from the magnitude heuristic, not explicit per-token fields */
  priceEstimated?: boolean;
}

export type Model = NanoModel;

export type ToolKind = "read_file" | "edit_file" | "run_command" | "search" | "think";

export interface ToolCall {
  id: string;
  kind: ToolKind;
  title: string;
  detail: string;
  status: "running" | "done" | "error";
  durationMs?: number;
}

export interface DiffLine {
  type: "add" | "del" | "ctx";
  text: string;
}

export interface Patch {
  file: string;
  lines: DiffLine[];
  status: "pending" | "applied" | "rejected";
}

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  streaming?: boolean;
  toolCalls?: ToolCall[];
  patch?: Patch;
  usage?: { input: number; output: number; costUsd: number };
  model?: string;
  /** Content-free attachment metadata. Text belongs in the snapshot store. */
  attachments?: ChatAttachment[];
  /**
   * Task 2.2: marks messages produced by the edit-verify auto-loop
   * (verification prompt + the model's reply). Stored with role
   * "user"/"assistant" (NOT "system") so they stay in the wire context built
   * by `handleSend`, which filters out role === "system". The transcript
   * renders them collapsed.
   */
  auto?: boolean;
  ts: number;
}

/** Task 2.3: per-model generation settings, persisted in localStorage. */
export interface GenerationPrefs {
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_GEN_PREFS: GenerationPrefs = { temperature: 0.3, maxTokens: 4096 };

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  model: string;
  createdAt: number;
}

/** A chat is the persisted, sidebar-addressable form of a session. */
export interface Chat extends Session {
  archived?: boolean;
  pinned?: boolean;
}

/**
 * Safe-to-persist identity for a host-backed local workspace. The canonical
 * filesystem root deliberately stays inside the local host: browser storage
 * only receives an opaque id and a display-safe path label.
 */
export interface WorkspaceLocation {
  kind: "local";
  hostWorkspaceId: string;
  displayPath: string;
  lastOpenedAt: number;
  status?: "ready" | "unavailable" | "connecting";
}

/** A workspace owns chats; files remain global and are not owned by this record. */
export interface Workspace {
  id: string;
  name: string;
  chats: Chat[];
  createdAt: number;
  archived?: boolean;
  pinned?: boolean;
  location?: WorkspaceLocation;
}

export interface ConnectionState {
  apiKey: string;
  baseUrl: string;
  status: "disconnected" | "checking" | "connected" | "error";
  error?: string;
  liveModels: boolean;
  /**
   * Final phase (x402): set when key validation fails with HTTP 402 — the
   * endpoint offers accountless pay-per-request. `null` means a 402 was
   * returned but no parseable quote; `undefined` means no 402 at all.
   */
  x402?: X402Quote | null;
}

export interface UsageTotals {
  input: number;
  output: number;
  costUsd: number;
  requests: number;
}

export interface VirtualFile {
  path: string;
  language: string;
  content: string;
  size?: number;
  modified?: string;
  sha256?: string;
}

/**
 * Final roadmap phase (cost dashboard): one immutable record per finished
 * run. Persisted alongside the aggregate `UsageTotals` so per-model and
 * per-day breakdowns stay available after restart. Helpers live in
 * `src/lib/usageLog.ts`.
 */
export interface UsageRun {
  id: string;
  /** Epoch milliseconds when the run finished. */
  ts: number;
  modelId: string;
  input: number;
  output: number;
  costUsd: number;
  /** Errored runs are recorded for audit but are not billable requests. */
  errored?: boolean;
}

/* ------------------------------------------------------------------ */
/* Agent platform (Module 1 Task 2): executable plan contracts        */
/* ------------------------------------------------------------------ */

/** Plan-level UI state machine. Runs stay disabled until explicit approval. */
export type PlanUIState = "draft" | "awaiting_approval" | "executing" | "paused" | "completed";

export type PlanStepStatus = "pending" | "running" | "succeeded" | "failed" | "blocked";

export interface PlanPhase {
  id: string;
  title: string;
  description?: string;
  order: number;
}

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  phaseId?: string;
  dependsOn: string[];
  status: PlanStepStatus;
  /**
   * When present, this step may NEVER enter "running" on the strength of
   * model output or chat text — only an explicit user click counts.
   */
  approval?: "required" | "auto";
  sideEffecting?: boolean;
  /** Exact workspace-relative paths / scopes this step touches. */
  affectedScopes?: string[];
  estimate?: { tokens?: number; costUsd?: number; durationSec?: number };
  artifacts?: string[];
}

export interface ExecutionPlan {
  id: string;
  title?: string;
  goal: string;
  phases?: PlanPhase[];
  steps: PlanStep[];
  state: PlanUIState;
  revision?: number;
  createdAt?: number;
  updatedAt?: number;
}

/* ------------------------------------------------------------------ */
/* Agent platform (Module 2 Task 7): terminal tool-run cards          */
/* ------------------------------------------------------------------ */

/** Host-side lifecycle of one supervised terminal job. */
export type ToolRunState =
  | "queued"
  | "approval_required"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** One terminal tool card in the chat transcript (mirrors host run events). */
export interface ToolRun {
  id: string;
  /** Structured invocation only — never a free-form shell string. */
  executable: string;
  args: string[];
  /** Workspace-confined working directory. */
  cwd: string;
  state: ToolRunState;
  /** Why policy asked/denied, e.g. "write outside workspace requires approval". */
  policyReason?: string;
  /** Latest stdout/stderr excerpt (may be truncated by the host output cap). */
  output?: string;
  /** true when the host capped the streamed output. */
  truncated?: boolean;
  exitCode?: number;
}

export * from "./artifacts";
export * from "@protocol/subagents";
export * from "@protocol/tasks";
