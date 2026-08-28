import type {
  ExecutionPlan,
  PlanStep,
  StepStatus,
  PlanLifecycleState,
} from "@nanoforge/protocol";

/**
 * Client connection configuration options.
 */
export interface NanoForgeClientOptions {
  /** WebSocket or HTTP host URL, e.g. "ws://127.0.0.1:4040/agent" or "http://127.0.0.1:4040". */
  hostUrl: string;
  /** Authentication crypto-token (192-bit base64url). */
  token?: string;
  /** Automatically reconnect if connection drops. Default: false. */
  autoReconnect?: boolean;
  /** Reconnection backoff interval in milliseconds. Default: 1000. */
  reconnectIntervalMs?: number;
  /** Maximum number of reconnection attempts before giving up. Default: 5. */
  maxReconnectAttempts?: number;
  /** Request timeout in milliseconds for synchronous RPC queries. Default: 10000. */
  timeoutMs?: number;
  /** Optional custom WebSocket constructor. */
  WebSocket?: any;
}

/** Alias for connection options. */
export type ConnectionOptions = NanoForgeClientOptions;

/**
 * Options for creating an agent session.
 */
export interface SessionOptions {
  /** Unique session identifier. Auto-generated if omitted. */
  id?: string;
  /** Initial model identifier for the session. */
  model?: string;
  /** Human-readable title for the session. */
  title?: string;
  /** Target workspace root path. */
  workspaceRoot?: string;
  /** Sandboxing isolation mode: "inherit" (shared) or "branch" (git worktree). */
  isolation?: "inherit" | "branch";
}

/**
 * Structural type for plan submission.
 */
export interface SubmittedPlan {
  id: string;
  goal: string;
  steps: Array<{
    id: string;
    title?: string;
    description?: string;
    action?: string;
    dependsOn?: string[];
    approvalRequired?: boolean;
    mutating?: boolean;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/**
 * Real-time event emitted during an agent run stream.
 */
export interface RunEvent {
  type: string;
  runId: string;
  at: string;
  state?: string;
  event?: string;
  data?: unknown;
  chunk?: string;
  stream?: "stdout" | "stderr";
  truncated?: boolean;
  detail?: string;
  error?: string;
  requestId?: string;
}

/**
 * Tool execution proposal forwarded from the host for user/system approval.
 */
export interface ToolCallRequest {
  requestId: string;
  runId: string;
  request: {
    kind: string;
    cwd: string;
    executable: string;
    args: string[];
    [key: string]: unknown;
  };
  reason: string;
  at: string;
}

/**
 * High-level approval request.
 */
export interface ApprovalRequest {
  requestId: string;
  runId: string;
  toolCall?: unknown;
  reason: string;
  at: string;
}

/**
 * Response granting or denying a tool approval request.
 */
export interface ToolResponse {
  requestId: string;
  approved: boolean;
  reason?: string;
}

/**
 * A host-issued, exact-bound approval request for a capability-gated
 * operation. The SDK deliberately exposes bindings and a digest rather than
 * raw operation arguments, paths, or credentials.
 */
export interface CapabilityApprovalRequest {
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

/**
 * Caller-supplied decision for one observed capability approval request.
 * Decisions are never inferred or sent automatically by the SDK.
 */
export interface CapabilityApprovalResolution {
  approved: boolean;
  reason?: string;
}

/**
 * Directory entry metadata returned by workspace operations.
 */
export interface WorkspaceDirEntry {
  name: string;
  isDir: boolean;
  size?: number;
  modified?: string;
}

/**
 * File status metadata returned by stat queries.
 */
export interface WorkspaceFileStat {
  size: number;
  modified: string;
  isDir: boolean;
  isFile: boolean;
}

/**
 * Search result match entry.
 */
export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  text: string;
  matchText: string;
}

/**
 * Git file tracking status.
 */
export interface GitFileStatus {
  path: string;
  status: "M" | "A" | "D" | "R" | "?" | "!";
}
