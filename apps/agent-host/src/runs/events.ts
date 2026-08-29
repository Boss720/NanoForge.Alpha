/**
 * Task 18 — immutable run-event log.
 *
 * Every state transition of a run (plan submission, routing, model proposals,
 * policy decisions, approvals, tool execution, terminal outcomes) is recorded
 * as a frozen, append-only {@link RunEvent}. The log is the single source of
 * truth the audit ledger (Task 19) and the UI both consume.
 *
 * Contract:
 * - `seq` is monotonic per run (1, 2, 3, ...), assigned by the log.
 * - `at` is an ISO-8601 timestamp from the injected clock (deterministic in
 *   tests).
 * - Events are deep-frozen before storage/notification; subscribers are
 *   notified synchronously, in append order.
 * - Model *proposals* carry only a digest summary of the tool arguments —
 *   never raw chain-of-thought or full argument blobs.
 */
import { createHash } from "node:crypto";
import type { RouteDecision } from "@protocol/routing";
import type { ToolRequest } from "../policy/policy";

/** SHA-256 hex digest of a string or byte payload. */
export const sha256Hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

/* ------------------------------------------------------------------------ */
/* Event payloads                                                           */
/* ------------------------------------------------------------------------ */

/** Summary of one plan step captured at submission time. */
export interface SubmittedStep {
  id: string;
  title: string;
  dependsOn: readonly string[];
  approval?: "required" | "auto";
  sideEffecting?: boolean;
  affectedScopes?: readonly string[];
}

export interface ValidationErrorInfo {
  path: string;
  code: string;
  message: string;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Payload (everything after `type`) for each run-event type. Values are plain
 * object types so events stay serializable end-to-end.
 */
export type RunEventPayloadMap = {
  /** A plan was submitted for execution. */
  "plan.submitted": {
    planId: string;
    goal: string;
    stepCount: number;
    steps: SubmittedStep[];
  };
  /** Plan validation result; `ok: false` is always followed by `run.failed`. */
  "plan.validated": {
    planId: string;
    ok: boolean;
    errors?: ValidationErrorInfo[];
  };
  /** A step's dependencies are satisfied and execution has begun. */
  "step.ready": { stepId: string; title: string };
  "step.succeeded": { stepId: string; outputDigest?: string };
  "step.failed": { stepId: string; reason: string };
  /** Left pending forever because the run failed upstream. */
  "step.blocked": { stepId: string; reason: string };
  /** Router chose a model for the step; carries the full explainable decision. */
  "route.decided": { stepId: string; decision: RouteDecision };
  /** The primary (or previous fallback) failed and the next candidate is used. */
  "route.fallback": { stepId: string; from: string; to: string; reason: string };
  /**
   * The model proposed a tool call. Summary only: tool name + SHA-256 digest
   * and byte size of the canonicalized arguments — never raw chain-of-thought.
   */
  "model.proposal": {
    stepId: string;
    model: string;
    tool: string;
    argsDigest: string;
    argsBytes: number;
  };
  /** The chosen model stream failed (before or during streaming). */
  "model.error": {
    stepId: string;
    model: string;
    code: string;
    message: string;
    retryable: boolean;
  };
  /** Policy engine verdict for one proposed tool call. */
  "policy.decision": {
    stepId: string;
    tool: string;
    decision: "allow" | "ask" | "deny";
    reason: string;
    request?: ToolRequest;
  };
  /** Policy said "ask"; an explicit approval was requested from the user. */
  "approval.requested": {
    stepId: string;
    requestId: string;
    tool: string;
    reason: string;
  };
  "approval.granted": { stepId: string; requestId: string };
  /** Denial OR expiry; `reason` distinguishes ("approval expired"). */
  "approval.denied": { stepId: string; requestId: string; reason: string };
  "tool.started": {
    stepId: string;
    jobId: string;
    tool: string;
    executable: string;
    args: string[];
    cwd: string;
  };
  /** Digest of the tool's combined retained output — not the output itself. */
  "tool.output_digest": {
    stepId: string;
    jobId: string;
    sha256: string;
    bytes: number;
    truncated: boolean;
  };
  "tool.finished": {
    stepId: string;
    jobId: string;
    code: number | null;
    signal: string | null;
    timedOut: boolean;
    cancelled: boolean;
    truncated: boolean;
    durationMs: number;
    errorMessage?: string;
  };
  "run.paused": { readonly _?: never };
  "run.resumed": { readonly _?: never };
  "run.cancelled": { reason?: string };
  /** User/policy stop: approval denied, approval expired, or policy deny. */
  "run.halted": { reason: string };
  /** Error stop: validation, routing, provider exhaustion, or tool failure. */
  "run.failed": { reason: string };
  "run.completed": { stepsSucceeded: number };
};

export type RunEventType = keyof RunEventPayloadMap;

/** A stored event: caller payload plus log-assigned seq/runId/at. */
export type RunEvent = {
  [K in RunEventType]: {
    seq: number;
    runId: string;
    at: string;
    type: K;
  } & RunEventPayloadMap[K];
}[RunEventType];

/** Input to {@link RunEventLog.append}: payload + runId, no seq/at. */
export type RunEventInput = {
  [K in RunEventType]: { runId: string; type: K } & RunEventPayloadMap[K];
}[RunEventType];

/** RunEventInput minus runId (the coordinator supplies it). */
export type RunEventInputFor = {
  [K in RunEventType]: { type: K } & RunEventPayloadMap[K];
}[RunEventType];

export type RunEventListener = (event: RunEvent) => void;

/* ------------------------------------------------------------------------ */
/* Deep freeze                                                              */
/* ------------------------------------------------------------------------ */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  const obj = value as object;
  if (seen.has(obj)) return value;
  seen.add(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze((obj as Record<string, unknown>)[key], seen);
  }
  Object.freeze(obj);
  return value;
}

/* ------------------------------------------------------------------------ */
/* RunEventLog                                                              */
/* ------------------------------------------------------------------------ */

export interface RunEventLogOptions {
  /** Injectable clock; defaults to wall time. */
  clock?: () => Date;
}

/**
 * Append-only, per-run monotonic event log. There is no update or delete API.
 */
export class RunEventLog {
  private readonly clock: () => Date;
  private readonly seqByRun = new Map<string, number>();
  private readonly eventsByRun = new Map<string, RunEvent[]>();
  private readonly listeners = new Map<string, Set<RunEventListener>>();
  private readonly allListeners = new Set<RunEventListener>();

  constructor(options: RunEventLogOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Append an event: assigns the next per-run `seq` and the clock timestamp,
   * deep-freezes the result, stores it, and notifies subscribers in order.
   */
  append(input: RunEventInput): RunEvent {
    const seq = (this.seqByRun.get(input.runId) ?? 0) + 1;
    this.seqByRun.set(input.runId, seq);
    const event = deepFreeze({
      ...input,
      seq,
      at: this.clock().toISOString(),
    }) as RunEvent;
    let list = this.eventsByRun.get(input.runId);
    if (!list) {
      list = [];
      this.eventsByRun.set(input.runId, list);
    }
    list.push(event);
    for (const listener of this.listeners.get(input.runId) ?? []) listener(event);
    for (const listener of this.allListeners) listener(event);
    return event;
  }

  /** All events of a run, in seq order. */
  list(runId: string): readonly RunEvent[] {
    return this.eventsByRun.get(runId) ?? [];
  }

  /** Subscribe to one run's events. Returns an unsubscribe function. */
  subscribe(runId: string, listener: RunEventListener): () => void {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  /** Subscribe to every run's events. Returns an unsubscribe function. */
  subscribeAll(listener: RunEventListener): () => void {
    this.allListeners.add(listener);
    return () => this.allListeners.delete(listener);
  }
}
