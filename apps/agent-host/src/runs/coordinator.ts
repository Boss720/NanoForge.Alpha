/**
 * Task 18 — run coordinator.
 *
 * Drives the pipeline `approved plan step → route decision → streamed model
 * proposal → policy decision → tool execution → immutable event` for one
 * {@link ExecutionPlan} per run.
 *
 * Security invariants (docs/plans/2026-08-11-agent-platform-modules.md):
 * - Model output is only a *proposal*: every tool call passes
 *   `authorize()`; `"ask"` awaits an explicit {@link ApprovalGate} grant.
 *   Natural language NEVER counts as approval — only the gate's explicit
 *   `"granted"` outcome does.
 * - Policy deny, approval denial, approval expiry, cancellation, or a failed
 *   step halt the run immediately: a terminal event is emitted and NO further
 *   steps or tool calls start.
 * - Pause stops the run BETWEEN steps: no new step starts while paused.
 * - Everything (router, registry, policy, runner, audit sink, approval gate,
 *   event log, clock) is injected, so unit tests are fully deterministic —
 *   no real network or processes.
 */
import { randomUUID } from "node:crypto";
import type { ExecutionPlan, PlanStep, StepStatus } from "@protocol/plan";
import { readySteps } from "@protocol/plan";
import type {
  ModelProfile,
  RouteDecision,
  RouteRequest,
} from "@protocol/routing";
import { route, type RouteOptions } from "../router/router";
import { validatePlan } from "../planning/validatePlan";
import { authorize, type Policy, type ToolRequest } from "../policy/policy";
import type {
  RunnerOptions,
  TerminalJobHandle,
  TerminalJobSpec,
} from "../terminal/types";
import type {
  ChatRequest,
  ProviderAdapter,
  ProviderRegistry,
} from "../providers/types";
import {
  sha256Hex,
  type RunEvent,
  type RunEventInput,
  type RunEventInputFor,
  type RunEventLog,
} from "./events";

/* ------------------------------------------------------------------------ */
/* Injectable seams                                                         */
/* ------------------------------------------------------------------------ */

/** Routing seam: the wave-1 `route()` with profiles already bound. */
export type RouterLike = (
  request: RouteRequest,
  options?: RouteOptions,
) => RouteDecision;

/** Bind the wave-1 `route()` to a fixed profile list. */
export const bindRouter =
  (profiles: readonly ModelProfile[]): RouterLike =>
  (request, options) =>
    route(request, profiles, options);

/** Runner seam: matches `runTerminalJob` (fakeable in tests). */
export type RunnerLike = (
  spec: TerminalJobSpec,
  options: RunnerOptions,
) => TerminalJobHandle;

/** An explicit approval ask. Only the gate may grant — never chat text. */
export interface ApprovalRequest {
  runId: string;
  stepId: string;
  tool: string;
  request: ToolRequest;
  /** Why approval is needed (policy verdict context). */
  reason: string;
  /** Suggested expiry; the gate decides when an ask expires. */
  timeoutMs?: number;
}

export type ApprovalOutcome =
  | { outcome: "granted" }
  | { outcome: "denied"; reason?: string }
  | { outcome: "expired" };

export interface ApprovalGate {
  requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome>;
}

/** Minimal audit-ledger surface the coordinator writes to (Task 19 store). */
export interface RunAuditSink {
  startRun(input: { id: string; goal: string; startedAt?: string }): void;
  recordEvent(runId: string, event: RunEvent): void;
  recordArtifact?(input: {
    runId: string;
    kind: string;
    name: string;
    data: string | Uint8Array;
  }): unknown;
  endRun(input: { runId: string; state: string; endedAt?: string }): void;
}

export interface RunCoordinatorConfig {
  router: RouterLike;
  /**
   * Model profiles known to the host. `ModelProfile.provider` MUST equal the
   * adapter id registered in `providerRegistry` — that is how a routed model
   * id resolves to a streaming adapter.
   */
  profiles: readonly ModelProfile[];
  providerRegistry: ProviderRegistry;
  policy: Policy;
  runner: RunnerLike;
  auditStore: RunAuditSink;
  approvalGate: ApprovalGate;
  eventLog: RunEventLog;
  /** Workspace root passed to the runner for cwd confinement. */
  workspaceRoot: string;
  clock?: () => Date;
  /** Override how a step maps to a routing request. */
  routeRequestForStep?: (step: PlanStep, plan: ExecutionPlan) => RouteRequest;
  /** Override how a step maps to a streamed chat request. */
  chatForStep?: (step: PlanStep, plan: ExecutionPlan) => ChatRequest;
  approvalTimeoutMs?: number;
}

/* ------------------------------------------------------------------------ */
/* Public run handle                                                        */
/* ------------------------------------------------------------------------ */

export type RunTerminalState = "completed" | "failed" | "halted" | "cancelled";
export type RunStatus = "running" | "paused" | RunTerminalState;

export interface RunSummary {
  runId: string;
  status: RunTerminalState;
  reason?: string;
}

export interface RunHandle {
  readonly runId: string;
  /** Resolves exactly once, at the run's terminal event. Never rejects. */
  readonly done: Promise<RunSummary>;
  /** Stop starting new steps; the current step finishes first. */
  pause(): void;
  resume(): void;
  /** Abort streams, cancel the active job, emit `run.cancelled`. */
  cancel(): void;
  status(): RunStatus;
}

/* ------------------------------------------------------------------------ */
/* Internals                                                                */
/* ------------------------------------------------------------------------ */

interface ProposedToolCall {
  name: string;
  args: unknown;
}

type StreamOutcome =
  | {
      ok: true;
      proposals: ProposedToolCall[];
      text: string;
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { ok: false; code: string; message: string; retryable: boolean };

interface RunContext {
  runId: string;
  plan: ExecutionPlan;
  stepStatus: Map<string, StepStatus>;
  status: RunStatus;
  terminalState?: RunTerminalState;
  terminalReason?: string;
  /** Once durable audit persistence fails, no further work may be dispatched. */
  auditFailed?: boolean;
  cancelRequested: boolean;
  paused: boolean;
  /** True once at least one step entered the pipeline (not validation-only). */
  executing: boolean;
  abort: AbortController;
  currentJob?: TerminalJobHandle;
  waiters: Set<() => void>;
  resolveDone: (summary: RunSummary) => void;
  done: Promise<RunSummary>;
}

/** Stable JSON (sorted keys) so argument digests are deterministic. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

const stableStringify = (value: unknown): string =>
  JSON.stringify(sortKeysDeep(value));

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

const TERMINAL_TOOL_DEFINITION = {
  name: "terminal.exec",
  description:
    "Run a structured terminal command inside the workspace (no shell). " +
    "Execution is gated by the host policy engine and may require user approval.",
  parameters: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Working directory, inside the workspace." },
      executable: { type: "string" },
      args: { type: "array", items: { type: "string" } },
    },
    required: ["executable"],
  },
};

function defaultRouteRequest(step: PlanStep): RouteRequest {
  const tokens = step.estimate?.tokens ?? 4096;
  return {
    kind: "coding",
    tokenEstimate: { input: tokens, output: Math.max(256, Math.floor(tokens / 4)) },
  };
}

export function buildDefaultChatRequest(step: PlanStep, plan: ExecutionPlan): ChatRequest {
  const scopes =
    step.affectedScopes && step.affectedScopes.length > 0
      ? `\nAffected scopes: ${step.affectedScopes.join(", ")}`
      : "";
  return {
    messages: [
      {
        role: "system",
        content:
          "You are NanoForge, a local agent. Propose structured tool calls " +
          "only; every call is policy-checked and may require user approval.",
      },
      {
        role: "user",
        content: `Goal: ${plan.goal}\nStep "${step.id}": ${step.title}${scopes}`,
      },
    ],
    tools: [TERMINAL_TOOL_DEFINITION],
  };
}

type BuiltToolRequest =
  | { ok: true; request: ToolRequest }
  | { ok: false; reason: string };

/** Map a raw model tool proposal to a structured ToolRequest. */
function buildToolRequest(proposal: ProposedToolCall): BuiltToolRequest {
  if (proposal.name !== "terminal.exec") {
    return { ok: false, reason: `unknown tool "${proposal.name}"` };
  }
  const args = (proposal.args ?? {}) as Record<string, unknown>;
  const executable = typeof args.executable === "string" ? args.executable.trim() : "";
  if (!executable) {
    return { ok: false, reason: "malformed terminal.exec arguments: missing executable" };
  }
  const argList = Array.isArray(args.args)
    ? args.args.filter((a): a is string => typeof a === "string")
    : [];
  const cwd = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd : ".";
  return {
    ok: true,
    request: { kind: "terminal.exec", cwd, executable, args: argList },
  };
}

/* ------------------------------------------------------------------------ */
/* RunCoordinator                                                           */
/* ------------------------------------------------------------------------ */

export class RunCoordinator {
  private readonly config: RunCoordinatorConfig;
  private readonly clock: () => Date;
  private readonly runs = new Map<string, RunContext>();

  constructor(config: RunCoordinatorConfig) {
    this.config = config;
    this.clock = config.clock ?? (() => new Date());
  }

  /** Current status of a run; undefined for unknown run ids. */
  getStatus(runId: string): RunStatus | undefined {
    return this.runs.get(runId)?.status;
  }

  /** All events recorded for a run (delegates to the injected event log). */
  events(runId: string): readonly RunEvent[] {
    return this.config.eventLog.list(runId);
  }

  /**
   * Submit a plan for execution. Validation happens synchronously; a valid
   * run proceeds asynchronously. The returned handle resolves `done` exactly
   * once with the terminal summary.
   */
  submitRun(plan: ExecutionPlan): RunHandle {
    const runId = randomUUID();
    let resolveDone!: (summary: RunSummary) => void;
    const done = new Promise<RunSummary>((resolve) => {
      resolveDone = resolve;
    });
    const ctx: RunContext = {
      runId,
      plan,
      stepStatus: new Map(plan.steps.map((s) => [s.id, s.status])),
      status: "running",
      cancelRequested: false,
      paused: false,
      executing: false,
      abort: new AbortController(),
      waiters: new Set(),
      resolveDone,
      done,
    };
    try {
      this.config.auditStore.startRun({
        id: runId,
        goal: plan.goal ?? plan.title ?? "",
        startedAt: this.clock().toISOString(),
      });
    } catch {
      this.failAudit(ctx);
      return this.handleFor(ctx);
    }
    this.runs.set(runId, ctx);

    try {
      this.emit(ctx, {
        type: "plan.submitted",
        planId: plan.id,
        goal: plan.goal ?? plan.title ?? "",
        stepCount: plan.steps.length,
        steps: plan.steps.map((s) => ({
          id: s.id,
          title: s.title,
          dependsOn: s.dependsOn,
          ...(s.approval !== undefined ? { approval: s.approval } : {}),
          ...(s.sideEffecting !== undefined ? { sideEffecting: s.sideEffecting } : {}),
          ...(s.affectedScopes !== undefined ? { affectedScopes: s.affectedScopes } : {}),
        })),
      });
    } catch {
      return this.handleFor(ctx);
    }

    const validation = validatePlan(plan);
    if (!validation.ok) {
      this.emit(ctx, {
        type: "plan.validated",
        planId: plan.id,
        ok: false,
        errors: validation.errors.map((e) => ({
          path: e.path,
          code: e.code,
          message: e.message,
        })),
      });
      this.finish(ctx, "failed", `plan validation failed: ${validation.errors.map((e) => e.message).join("; ")}`);
    } else {
      this.emit(ctx, { type: "plan.validated", planId: plan.id, ok: true });
      void this.drive(ctx);
    }

    return this.handleFor(ctx);
  }

  private handleFor(ctx: RunContext): RunHandle {
    return {
      runId: ctx.runId,
      done: ctx.done,
      pause: () => this.pause(ctx),
      resume: () => this.resume(ctx),
      cancel: () => this.cancel(ctx),
      status: () => ctx.status,
    };
  }

  /* ------------------------------ control ------------------------------ */

  private pause(ctx: RunContext): void {
    if (ctx.terminalState || ctx.cancelRequested || ctx.paused) return;
    ctx.paused = true;
    ctx.status = "paused";
    this.emit(ctx, { type: "run.paused" });
  }

  private resume(ctx: RunContext): void {
    if (ctx.terminalState || ctx.cancelRequested || !ctx.paused) return;
    ctx.paused = false;
    ctx.status = "running";
    this.emit(ctx, { type: "run.resumed" });
    this.releaseWaiters(ctx);
  }

  private cancel(ctx: RunContext): void {
    if (ctx.terminalState || ctx.cancelRequested) return;
    ctx.cancelRequested = true;
    ctx.abort.abort();
    try {
      ctx.currentJob?.cancel();
    } catch {
      /* best effort */
    }
    this.releaseWaiters(ctx);
  }

  private releaseWaiters(ctx: RunContext): void {
    const waiters = [...ctx.waiters];
    ctx.waiters.clear();
    for (const wake of waiters) wake();
  }

  /* ------------------------------ emit/finish -------------------------- */

  private emit(ctx: RunContext, input: RunEventInputFor): RunEvent {
    const event = this.config.eventLog.append({ ...input, runId: ctx.runId } as RunEventInput);
    try {
      this.config.auditStore.recordEvent(ctx.runId, event);
    } catch {
      this.failAudit(ctx);
      throw new Error("audit unavailable");
    }
    return event;
  }

  /**
   * Durable audit storage is a precondition for privileged execution. Once it
   * fails, stop the current job, prevent future steps, and settle the handle
   * without attempting another audit event that could recurse on the failure.
   */
  private failAudit(ctx: RunContext): void {
    if (ctx.auditFailed) return;
    ctx.auditFailed = true;
    ctx.terminalState = "failed";
    ctx.terminalReason = "audit unavailable";
    ctx.status = "failed";
    ctx.cancelRequested = true;
    ctx.abort.abort();
    try {
      ctx.currentJob?.cancel();
    } catch {
      /* best effort */
    }
    try {
      this.config.auditStore.endRun({
        runId: ctx.runId,
        state: "failed",
        endedAt: this.clock().toISOString(),
      });
    } catch {
      // The store is unavailable. The in-memory run must still be terminal.
    }
    this.releaseWaiters(ctx);
    ctx.resolveDone({ runId: ctx.runId, status: "failed", reason: "audit unavailable" });
  }

  /** Emit the terminal event (exactly once), close the ledger, resolve done. */
  private finish(ctx: RunContext, state: RunTerminalState, reason?: string): void {
    if (ctx.terminalState) return;
    ctx.terminalState = state;
    ctx.terminalReason = reason;
    ctx.status = state;

    if (state === "failed" && ctx.executing) {
      for (const step of ctx.plan.steps) {
        if (ctx.stepStatus.get(step.id) === "pending") {
          ctx.stepStatus.set(step.id, "blocked");
          this.emit(ctx, {
            type: "step.blocked",
            stepId: step.id,
            reason: "run failed before this step could start",
          });
        }
      }
    }

    switch (state) {
      case "completed":
        this.emit(ctx, {
          type: "run.completed",
          stepsSucceeded: ctx.plan.steps.filter(
            (s) => ctx.stepStatus.get(s.id) === "succeeded",
          ).length,
        });
        break;
      case "failed":
        this.emit(ctx, { type: "run.failed", reason: reason ?? "unknown error" });
        break;
      case "halted":
        this.emit(ctx, { type: "run.halted", reason: reason ?? "halted" });
        break;
      case "cancelled":
        this.emit(ctx, { type: "run.cancelled", ...(reason ? { reason } : {}) });
        break;
    }

    try {
      this.config.auditStore.endRun({
        runId: ctx.runId,
        state,
        endedAt: this.clock().toISOString(),
      });
    } catch {
      this.failAudit(ctx);
      return;
    }
    this.releaseWaiters(ctx);
    ctx.resolveDone({ runId: ctx.runId, status: state, ...(reason ? { reason } : {}) });
  }

  private failStep(ctx: RunContext, stepId: string, reason: string): void {
    ctx.stepStatus.set(stepId, "failed");
    this.emit(ctx, { type: "step.failed", stepId, reason });
  }

  /* ------------------------------ main loop ---------------------------- */

  private livePlan(ctx: RunContext): ExecutionPlan {
    return {
      ...ctx.plan,
      steps: ctx.plan.steps.map((s) => ({
        ...s,
        status: ctx.stepStatus.get(s.id) ?? s.status,
      })),
    };
  }

  private async waitWhilePaused(ctx: RunContext): Promise<void> {
    while (ctx.paused && !ctx.cancelRequested && !ctx.terminalState) {
      await new Promise<void>((resolve) => {
        ctx.waiters.add(resolve);
      });
    }
  }

  private async drive(ctx: RunContext): Promise<void> {
    try {
      while (!ctx.terminalState) {
        if (ctx.cancelRequested) {
          this.finish(ctx, "cancelled", "run cancelled");
          return;
        }
        await this.waitWhilePaused(ctx);
        if (ctx.cancelRequested) {
          this.finish(ctx, "cancelled", "run cancelled");
          return;
        }
        if (ctx.terminalState) return;

        const ready = readySteps(this.livePlan(ctx));
        if (ready.length === 0) {
          const allSucceeded = ctx.plan.steps.every(
            (s) => ctx.stepStatus.get(s.id) === "succeeded",
          );
          if (allSucceeded) {
            this.finish(ctx, "completed");
          } else {
            this.finish(ctx, "failed", "no runnable steps: unmet dependencies");
          }
          return;
        }
        // Sequential execution, one step per iteration: pause/cancel is
        // re-checked before every step, so no new step starts while paused.
        await this.runStep(ctx, ready[0]);
      }
    } catch (error) {
      // Defensive: an unexpected internal error still closes the ledger.
      this.finish(ctx, "failed", `coordinator error: ${errorMessage(error)}`);
    }
  }

  /* ------------------------------ step pipeline ------------------------ */

  private async runStep(ctx: RunContext, step: PlanStep): Promise<void> {
    ctx.executing = true;
    ctx.stepStatus.set(step.id, "running");
    this.emit(ctx, { type: "step.ready", stepId: step.id, title: step.title });

    // 1. Route decision (provider outage -> fallback chain via registry health).
    const request =
      this.config.routeRequestForStep?.(step, ctx.plan) ?? defaultRouteRequest(step);
    const unavailableProviders = this.config.providerRegistry
      .list()
      .filter((e) => e.health.status === "unavailable")
      .map((e) => e.adapter.id);

    let decision: RouteDecision;
    try {
      decision = this.config.router(request, { unavailableProviders });
    } catch (error) {
      const reason = `routing failed: ${errorMessage(error)}`;
      this.failStep(ctx, step.id, reason);
      this.finish(ctx, "failed", reason);
      return;
    }
    this.emit(ctx, { type: "route.decided", stepId: step.id, decision });

    // 2. Stream the model proposal, walking the fallback chain on outage.
    const candidates = [decision.primary, ...decision.fallbacks];
    let streamed:
      | (Extract<StreamOutcome, { ok: true }> & { model: string })
      | undefined;
    let lastError = "no routed candidates";

    for (let i = 0; i < candidates.length; i++) {
      if (ctx.cancelRequested) return;
      const modelId = candidates[i];
      const profile = this.config.profiles.find((p) => p.id === modelId);
      const entry = profile
        ? this.config.providerRegistry.get(profile.provider)
        : undefined;

      if (!profile || !entry || entry.health.status === "unavailable") {
        lastError = !profile
          ? `unknown model profile "${modelId}"`
          : `provider "${profile.provider}" unavailable`;
        const next = candidates[i + 1];
        if (next !== undefined) {
          this.emit(ctx, {
            type: "route.fallback",
            stepId: step.id,
            from: modelId,
            to: next,
            reason: lastError,
          });
        }
        continue;
      }

      const attempt = await this.streamProposal(ctx, step, modelId, entry.adapter);
      if (ctx.cancelRequested) return;
      if (attempt.ok) {
        streamed = { ...attempt, model: modelId };
        break;
      }

      this.emit(ctx, {
        type: "model.error",
        stepId: step.id,
        model: modelId,
        code: attempt.code,
        message: attempt.message,
        retryable: attempt.retryable,
      });
      lastError = `model ${modelId} failed: ${attempt.message}`;
      const next = candidates[i + 1];
      if (attempt.retryable && next !== undefined) {
        this.config.providerRegistry.markUnavailable(
          entry.adapter.id,
          attempt.message,
        );
        this.emit(ctx, {
          type: "route.fallback",
          stepId: step.id,
          from: modelId,
          to: next,
          reason: attempt.message,
        });
        continue;
      }
      break;
    }

    if (!streamed) {
      this.failStep(ctx, step.id, lastError);
      this.finish(ctx, "failed", lastError);
      return;
    }

    // 3. Policy decision (+ approval + execution) per proposed tool call.
    for (const proposal of streamed.proposals) {
      if (ctx.cancelRequested) return;
      const proceed = await this.gateAndExecute(ctx, step, proposal);
      if (!proceed) return; // terminal event already emitted, or cancelled
    }

    ctx.stepStatus.set(step.id, "succeeded");
    const textDigest =
      streamed.text.length > 0 ? sha256Hex(streamed.text) : undefined;
    this.emit(ctx, {
      type: "step.succeeded",
      stepId: step.id,
      ...(textDigest ? { outputDigest: textDigest } : {}),
    });
  }

  /**
   * Policy gate + optional approval + execution for one proposal.
   * Returns false when the run reached a terminal state (or was cancelled).
   */
  private async gateAndExecute(
    ctx: RunContext,
    step: PlanStep,
    proposal: ProposedToolCall,
  ): Promise<boolean> {
    const built = buildToolRequest(proposal);
    const decision = built.ok
      ? authorize(built.request, this.config.policy)
      : "deny";
    const reason = built.ok
      ? `policy engine returned "${decision}" for ${proposal.name}`
      : built.reason;
    this.emit(ctx, {
      type: "policy.decision",
      stepId: step.id,
      tool: proposal.name,
      decision,
      reason,
      ...(built.ok ? { request: built.request } : {}),
    });

    if (decision === "deny") {
      const why = `policy denied ${proposal.name}: ${reason}`;
      this.failStep(ctx, step.id, why);
      this.finish(ctx, "halted", why);
      return false;
    }

    if (decision === "ask") {
      const requestId = randomUUID();
      this.emit(ctx, {
        type: "approval.requested",
        stepId: step.id,
        requestId,
        tool: proposal.name,
        reason,
      });
      const outcome = await this.awaitApproval(ctx, {
        runId: ctx.runId,
        stepId: step.id,
        tool: proposal.name,
        request: built.ok
          ? built.request
          : { kind: "terminal.exec", cwd: ".", executable: "", args: [] },
        reason,
        ...(this.config.approvalTimeoutMs !== undefined
          ? { timeoutMs: this.config.approvalTimeoutMs }
          : {}),
      });
      if (outcome === "cancelled" || ctx.cancelRequested) return false;

      if (outcome.outcome === "granted") {
        this.emit(ctx, { type: "approval.granted", stepId: step.id, requestId });
      } else {
        const expired = outcome.outcome === "expired";
        this.emit(ctx, {
          type: "approval.denied",
          stepId: step.id,
          requestId,
          reason: expired
            ? "approval expired"
            : (outcome.reason ?? "denied by user"),
        });
        const why = expired
          ? `approval expired for ${proposal.name}`
          : `approval denied for ${proposal.name}: ${outcome.reason ?? "denied by user"}`;
        this.failStep(ctx, step.id, why);
        this.finish(ctx, "halted", why);
        return false;
      }
    }

    // 4. Execute (allow, or ask+granted). built is guaranteed ok here:
    //    !built.ok forces decision "deny" above.
    return this.executeTool(
      ctx,
      step,
      proposal,
      (built as { ok: true; request: ToolRequest }).request,
    );
  }

  /** Race the approval gate against run cancellation. */
  private awaitApproval(
    ctx: RunContext,
    request: ApprovalRequest,
  ): Promise<ApprovalOutcome | "cancelled"> {
    const gatePromise = this.config.approvalGate.requestApproval(request);
    const cancelPromise = new Promise<"cancelled">((resolve) => {
      ctx.waiters.add(() => resolve("cancelled"));
    });
    return Promise.race([gatePromise, cancelPromise]);
  }

  /** Execute one approved/allowed terminal proposal. Returns false on failure/cancel. */
  private async executeTool(
    ctx: RunContext,
    step: PlanStep,
    proposal: ProposedToolCall,
    request: ToolRequest,
  ): Promise<boolean> {
    const spec: TerminalJobSpec = {
      cwd: request.cwd,
      executable: request.executable,
      args: request.args,
    };

    let handle: TerminalJobHandle;
    try {
      handle = this.config.runner(spec, {
        workspaceRoot: this.config.workspaceRoot,
      });
    } catch (error) {
      const why = `runner rejected ${proposal.name}: ${errorMessage(error)}`;
      this.failStep(ctx, step.id, why);
      this.finish(ctx, "failed", why);
      return false;
    }

    ctx.currentJob = handle;
    this.emit(ctx, {
      type: "tool.started",
      stepId: step.id,
      jobId: handle.id,
      tool: proposal.name,
      executable: request.executable,
      args: request.args,
      cwd: request.cwd,
    });

    const result = await handle.promise;
    ctx.currentJob = undefined;

    const combined = `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n`;
    const digest = sha256Hex(combined);
    this.emit(ctx, {
      type: "tool.output_digest",
      stepId: step.id,
      jobId: handle.id,
      sha256: digest,
      bytes: combined.length,
      truncated: result.truncated,
    });
    // Large/raw output goes to the artifact dir via the ledger; the event
    // log itself only ever carries the digest.
    this.config.auditStore.recordArtifact?.({
      runId: ctx.runId,
      kind: "tool-output",
      name: `${handle.id}-output.txt`,
      data: combined,
    });

    this.emit(ctx, {
      type: "tool.finished",
      stepId: step.id,
      jobId: handle.id,
      code: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      truncated: result.truncated,
      durationMs: result.durationMs,
      ...(result.errorMessage !== undefined
        ? { errorMessage: result.errorMessage }
        : {}),
    });

    if (ctx.cancelRequested) return false;

    if (
      result.errorMessage !== undefined ||
      result.timedOut ||
      result.cancelled ||
      result.code !== 0
    ) {
      const detail = result.errorMessage
        ? result.errorMessage
        : result.timedOut
          ? "timed out"
          : result.cancelled
            ? "cancelled"
            : `exit code ${String(result.code)}`;
      const why = `tool ${proposal.name} (${request.executable}) failed: ${detail}`;
      this.failStep(ctx, step.id, why);
      this.finish(ctx, "failed", why);
      return false;
    }
    return true;
  }

  /* ------------------------------ streaming ---------------------------- */

  private async streamProposal(
    ctx: RunContext,
    step: PlanStep,
    modelId: string,
    adapter: ProviderAdapter,
  ): Promise<StreamOutcome> {
    const chat =
      this.config.chatForStep?.(step, ctx.plan) ??
      buildDefaultChatRequest(step, ctx.plan);
    const proposals: ProposedToolCall[] = [];
    let text = "";
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    try {
      for await (const delta of adapter.streamChat(chat, ctx.abort.signal)) {
        if (ctx.cancelRequested) {
          return { ok: false, code: "cancelled", message: "cancelled", retryable: false };
        }
        switch (delta.type) {
          case "text":
            text += delta.text;
            break;
          case "tool_proposal": {
            proposals.push({ name: delta.name, args: delta.args });
            const argsJson = stableStringify(delta.args ?? null);
            this.emit(ctx, {
              type: "model.proposal",
              stepId: step.id,
              model: modelId,
              tool: delta.name,
              argsDigest: sha256Hex(argsJson),
              argsBytes: argsJson.length,
            });
            break;
          }
          case "usage":
            usage = {
              inputTokens: delta.inputTokens,
              outputTokens: delta.outputTokens,
            };
            break;
          case "error":
            return {
              ok: false,
              code: delta.code,
              message: delta.message,
              retryable: delta.retryable,
            };
          case "done":
            break;
        }
      }
      return { ok: true, proposals, text, ...(usage ? { usage } : {}) };
    } catch (error) {
      if (ctx.cancelRequested) {
        return { ok: false, code: "cancelled", message: "cancelled", retryable: false };
      }
      // A thrown stream error is treated as a provider outage: retryable,
      // so the fallback chain gets its chance.
      return {
        ok: false,
        code: "stream_error",
        message: errorMessage(error),
        retryable: true,
      };
    }
  }
}
