/**
 * Agent & Run Lifecycle Wire Protocol & State Machine.
 *
 * Provides pure isomorphic Zod schemas, TypeScript types, state transition
 * validation, and lifecycle event schemas for autonomous agent runs and
 * execution coordinator state machines.
 *
 * ZERO Node.js runtime dependencies (pure TypeScript/Zod).
 */

import { z } from "zod";
import { jsonValueSchema } from "./json";

/* ------------------------------------------------------------------ */
/* 1. Agent Lifecycle State (9-State Machine)                         */
/* ------------------------------------------------------------------ */

/**
 * Canonical 9-state machine for autonomous agent execution:
 * - "init": Initializing context, prompt composition, or plan parsing.
 * - "ready": Pre-conditions validated; ready for turn dispatch.
 * - "thinking": Streaming LLM inference / token generation.
 * - "executing": Executing tools, PTY commands, subagents, or background tasks.
 * - "completed": All steps/goals achieved successfully (terminal).
 * - "failed": Unrecoverable error or step failure halted execution (terminal).
 * - "paused": Execution suspended by user intervention.
 * - "resumed": Execution resumed from paused state.
 * - "cancelled": Abort signal triggered; execution terminated (terminal).
 */
export const agentLifecycleStateSchema = z.enum([
  "init",
  "ready",
  "thinking",
  "executing",
  "completed",
  "failed",
  "paused",
  "resumed",
  "cancelled",
]);
export type AgentLifecycleState = z.infer<typeof agentLifecycleStateSchema>;

/** Canonical run lifecycle states shared with the host coordinator & UI tool cards. */
export const runStateSchema = z.enum([
  "queued",
  "approval_required",
  "running",
  "done",
  "error",
  "cancelled",
]);
export type RunState = z.infer<typeof runStateSchema>;

/* ------------------------------------------------------------------ */
/* 2. Lifecycle Events (Discriminated Unions)                         */
/* ------------------------------------------------------------------ */

export const agentLifecycleEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent.init"),
    runId: z.string().min(1).max(128),
    goal: z.string().max(8192),
    sessionId: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("agent.ready"),
    runId: z.string().min(1).max(128),
    stepId: z.string().optional(),
    model: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("agent.thinking"),
    runId: z.string().min(1).max(128),
    stepId: z.string().optional(),
    turnId: z.string().min(1).max(128),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("agent.executing"),
    runId: z.string().min(1).max(128),
    stepId: z.string().optional(),
    toolName: z.string().min(1).max(128),
    callId: z.string().min(1).max(128),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("agent.paused"),
    runId: z.string().min(1).max(128),
    reason: z.string().max(4096).optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("agent.resumed"),
    runId: z.string().min(1).max(128),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("agent.completed"),
    runId: z.string().min(1).max(128),
    summary: z.string().max(8192).optional(),
    totalTokens: z.number().int().nonnegative().default(0),
    durationMs: z.number().nonnegative().default(0),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("agent.failed"),
    runId: z.string().min(1).max(128),
    code: z.string().min(1).max(128),
    reason: z.string().max(4096),
    stepId: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("agent.cancelled"),
    runId: z.string().min(1).max(128),
    reason: z.string().max(4096).optional(),
    at: z.string().datetime(),
  }),
]);
export type AgentLifecycleEvent = z.infer<typeof agentLifecycleEventSchema>;

export const runLifecycleEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.state"),
    runId: z.string().min(1).max(128),
    state: runStateSchema,
    at: z.string().datetime(),
    detail: z.string().max(4096).optional(),
  }),
  z.object({
    type: z.literal("run.event"),
    runId: z.string().min(1).max(128),
    event: z.string().min(1).max(128),
    data: jsonValueSchema.optional(),
    at: z.string().datetime(),
  }),
]);
export type RunLifecycleEvent = z.infer<typeof runLifecycleEventSchema>;

/* ------------------------------------------------------------------ */
/* 3. State Machine Transition Table & Pure Helpers                  */
/* ------------------------------------------------------------------ */

export const VALID_AGENT_TRANSITIONS: Readonly<Record<AgentLifecycleState, ReadonlySet<AgentLifecycleState>>> = {
  init: new Set(["ready", "failed", "cancelled"]),
  ready: new Set(["thinking", "executing", "paused", "failed", "cancelled"]),
  thinking: new Set(["executing", "ready", "completed", "paused", "failed", "cancelled"]),
  executing: new Set(["thinking", "ready", "completed", "paused", "failed", "cancelled"]),
  paused: new Set(["resumed", "cancelled"]),
  resumed: new Set(["thinking", "executing", "ready", "failed", "cancelled"]),
  completed: new Set([]), // Terminal
  failed: new Set([]),    // Terminal
  cancelled: new Set([]), // Terminal
};

export const AGENT_TERMINAL_STATES: ReadonlySet<AgentLifecycleState> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export function isValidAgentStateTransition(
  current: AgentLifecycleState,
  next: AgentLifecycleState
): boolean {
  if (current === next) return true; // Idempotent transition is always valid
  const allowed = VALID_AGENT_TRANSITIONS[current];
  return allowed ? allowed.has(next) : false;
}

export function isAgentLifecycleTerminal(state: AgentLifecycleState): boolean {
  return AGENT_TERMINAL_STATES.has(state);
}

export function isAgentLifecycleActive(state: AgentLifecycleState): boolean {
  return state === "ready" || state === "thinking" || state === "executing" || state === "resumed";
}

export function canPauseAgent(state: AgentLifecycleState): boolean {
  return state === "ready" || state === "thinking" || state === "executing" || state === "resumed";
}

export function canResumeAgent(state: AgentLifecycleState): boolean {
  return state === "paused";
}

export function canCancelAgent(state: AgentLifecycleState): boolean {
  return !isAgentLifecycleTerminal(state);
}

/* ------------------------------------------------------------------ */
/* 4. Protocol Error Codes                                            */
/* ------------------------------------------------------------------ */

export const LIFECYCLE_ERROR_CODES = {
  ERR_INVALID_STATE_TRANSITION: "ERR_INVALID_STATE_TRANSITION",
  ERR_AGENT_ALREADY_TERMINAL: "ERR_AGENT_ALREADY_TERMINAL",
  ERR_AGENT_NOT_PAUSED: "ERR_AGENT_NOT_PAUSED",
  ERR_AGENT_ALREADY_PAUSED: "ERR_AGENT_ALREADY_PAUSED",
  ERR_AGENT_EXECUTION_TIMEOUT: "ERR_AGENT_EXECUTION_TIMEOUT",
} as const;
export type LifecycleErrorCode = (typeof LIFECYCLE_ERROR_CODES)[keyof typeof LIFECYCLE_ERROR_CODES];

/* ------------------------------------------------------------------ */
/* 5. Run Control & Acknowledgement Result Schemas                   */
/* ------------------------------------------------------------------ */

export const planSubmitResultSchema = z.object({
  type: z.literal("plan.submit.result"),
  requestId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128),
  accepted: z.boolean().default(true),
  planId: z.string().optional(),
  at: z.string().min(1),
});
export type PlanSubmitResult = z.infer<typeof planSubmitResultSchema>;

export const runPauseResultSchema = z.object({
  type: z.literal("run.pause.result"),
  requestId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128),
  at: z.string().min(1),
});
export type RunPauseResult = z.infer<typeof runPauseResultSchema>;

export const runResumeResultSchema = z.object({
  type: z.literal("run.resume.result"),
  requestId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128),
  at: z.string().min(1),
});
export type RunResumeResult = z.infer<typeof runResumeResultSchema>;

export const runCancelResultSchema = z.object({
  type: z.literal("run.cancel.result"),
  requestId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128),
  at: z.string().min(1),
});
export type RunCancelResult = z.infer<typeof runCancelResultSchema>;

export const approvalGrantResultSchema = z.object({
  type: z.literal("approval.grant.result"),
  requestId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128).optional(),
  stepId: z.string().min(1).max(128).optional(),
  resolved: z.boolean().default(true),
  at: z.string().min(1),
});
export type ApprovalGrantResult = z.infer<typeof approvalGrantResultSchema>;

export const approvalDenyResultSchema = z.object({
  type: z.literal("approval.deny.result"),
  requestId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128).optional(),
  stepId: z.string().min(1).max(128).optional(),
  resolved: z.boolean().default(true),
  at: z.string().min(1),
});
export type ApprovalDenyResult = z.infer<typeof approvalDenyResultSchema>;

export const toolResponseResultSchema = z.object({
  type: z.literal("tool.response.result"),
  requestId: z.string().min(1).max(128),
  resolved: z.boolean().default(true),
  at: z.string().min(1),
});
export type ToolResponseResult = z.infer<typeof toolResponseResultSchema>;

/* ------------------------------------------------------------------ */
/* 6. Runtime State Machine (7-State Machine)                         */
/* ------------------------------------------------------------------ */

/**
 * Canonical 7-state runtime state machine across protocol, host daemon, and UI:
 * - "starting": Host or connection is bootstrapping.
 * - "healthy": Connection established and host daemon is responsive.
 * - "reconnecting": Connection dropped; attempting bounded exponential backoff.
 * - "switching": Workspace transition or descriptor activation in progress.
 * - "ready": Workspace descriptor verified and runtime is ready for turns/tasks.
 * - "needs_attention": Recoverable error, permission gate, or non-retryable rejection.
 * - "unavailable": Terminal failure, host unreachable, or disabled.
 */
export const runtimeStateSchema = z.enum([
  "starting",
  "healthy",
  "reconnecting",
  "switching",
  "ready",
  "needs_attention",
  "unavailable",
]);
export type RuntimeState = z.infer<typeof runtimeStateSchema>;

export const VALID_RUNTIME_TRANSITIONS: Readonly<Record<RuntimeState, ReadonlySet<RuntimeState>>> = {
  starting: new Set(["healthy", "ready", "reconnecting", "needs_attention", "unavailable"]),
  healthy: new Set(["ready", "switching", "reconnecting", "needs_attention", "unavailable", "starting"]),
  ready: new Set(["healthy", "switching", "reconnecting", "needs_attention", "unavailable", "starting"]),
  reconnecting: new Set(["healthy", "ready", "starting", "needs_attention", "unavailable"]),
  switching: new Set(["healthy", "ready", "reconnecting", "needs_attention", "unavailable"]),
  needs_attention: new Set(["starting", "healthy", "ready", "reconnecting", "switching", "unavailable"]),
  unavailable: new Set(["starting", "healthy", "ready", "reconnecting", "switching", "needs_attention"]),
};

export function isValidRuntimeTransition(
  current: RuntimeState,
  next: RuntimeState
): boolean {
  if (current === next) return true;
  const allowed = VALID_RUNTIME_TRANSITIONS[current];
  return allowed ? allowed.has(next) : false;
}

export function isRuntimeOperational(state: RuntimeState): boolean {
  return state === "healthy" || state === "ready";
}

export function isRuntimeTransitioning(state: RuntimeState): boolean {
  return state === "starting" || state === "reconnecting" || state === "switching";
}
