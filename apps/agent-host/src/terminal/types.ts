/**
 * Supervised terminal runner types — Module 2, Task 6.
 *
 * The runner only executes structured `{ executable, args[] }` jobs with
 * `shell: false`, after a policy decision has already been made by the
 * caller. It enforces workspace-confined CWD resolution, a restricted
 * environment, output caps, timeouts, and process-tree cancellation, and
 * streams stdout/stderr through an EventEmitter.
 */
import type { EventEmitter } from "node:events";

/** Job specification. `cwd` is absolute or relative to the workspace root. */
export interface TerminalJobSpec {
  /** Optional caller-assigned id; a UUID is generated when omitted. */
  id?: string;
  executable: string;
  args?: string[];
  cwd?: string;
  /** Explicit environment additions (merged over the restricted base env). */
  env?: Record<string, string>;
  /** Kill the process tree after this many ms. Default 60_000. */
  timeoutMs?: number;
  /** Per-stream retained-output cap in bytes (ring). Default 1 MiB. */
  maxOutputBytes?: number;
}

export interface RunnerOptions {
  /** Absolute root every job cwd must resolve within. */
  workspaceRoot: string;
  /** Extra inherited-env variable names on top of the built-in allowlist. */
  envAllowlist?: string[];
  /** Host-level explicit environment additions for every job. */
  env?: Record<string, string>;
  defaultTimeoutMs?: number;
  defaultMaxOutputBytes?: number;
}

/** Thrown synchronously for spec violations (before any spawn). */
export class RunnerSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerSpecError";
  }
}

/* ------------------------------------------------------------------------ */
/* Events                                                                   */
/* ------------------------------------------------------------------------ */

interface EventBase {
  id: string;
  /** ISO-8601 timestamp. */
  at: string;
}

export interface StartEvent extends EventBase {
  type: "start";
  pid: number | undefined;
  executable: string;
  args: string[];
  cwd: string;
}

export interface OutputEvent extends EventBase {
  type: "stdout" | "stderr";
  chunk: string;
}

export interface ExitEvent extends EventBase {
  type: "exit";
  code: number | null;
  signal: string | null;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
}

export interface TimeoutEvent extends EventBase {
  type: "timeout";
  timeoutMs: number;
}

export interface CancelledEvent extends EventBase {
  type: "cancelled";
}

/** Spawn-level failure (e.g. executable not found). */
export interface RunnerErrorEvent extends EventBase {
  type: "error";
  message: string;
}

export type TerminalEvent =
  | StartEvent
  | OutputEvent
  | ExitEvent
  | TimeoutEvent
  | CancelledEvent
  | RunnerErrorEvent;

export type TerminalEventType = TerminalEvent["type"];

/** Final settled outcome; the promise never rejects for process failures. */
export interface TerminalJobResult {
  id: string;
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  /** True when retained stdout or stderr hit the cap (ring kept the tail). */
  truncated: boolean;
  /** Retained (possibly truncated) output. */
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Set on spawn-level failure (e.g. executable not found). */
  errorMessage?: string;
}

export interface TerminalJobHandle {
  id: string;
  /**
   * Emits each event under its `type` name ("start", "stdout", "stderr",
   * "exit", "timeout", "cancelled", "error") plus every event under "*".
   */
  events: EventEmitter;
  /** Resolves with the final result once the process settles. */
  promise: Promise<TerminalJobResult>;
  /** Terminate the whole process tree. Emits "cancelled" then "exit". */
  cancel(): void;
}
