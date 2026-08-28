/**
 * Plan validation engine and lifecycle state machine — Module 1, Task 2.
 *
 * Validates an `ExecutionPlan` (from `@protocol/plan`) before it can be
 * approved or executed, supporting hierarchical phases, deterministic
 * cycle detection with formatted paths, step status validation, and
 * the 6-state plan lifecycle state machine.
 */

import type {
  ExecutionPlan,
  PlanPhase,
  PlanStep,
  StepStatus,
  PlanLifecycleState,
} from "@protocol/plan";

// Re-export lifecycle states and UI state alias for consumer compatibility
export type { PlanLifecycleState };
export type PlanUIState = PlanLifecycleState;

export type ValidationErrorCode =
  | "duplicate_step_id"
  | "unknown_dependency"
  | "dependency_cycle"
  | "missing_approval"
  | "duplicate_phase_id"
  | "unknown_phase"
  | "empty_phase"
  | "invalid_step_status"
  | "invalid_plan_state"
  | "empty_plan";

export interface ValidationError {
  /** JSON-path-ish location, e.g. "steps[2].dependsOn[0]", "phases[1].id". */
  path: string;
  code: ValidationErrorCode;
  message: string;
  /** Structured cycle path if code === "dependency_cycle", e.g. ["stepA", "stepB", "stepA"]. */
  cycle?: string[];
}

export type ValidationResult =
  | { ok: true; valid: true; errors: []; cycle?: undefined }
  | { ok: false; valid: false; errors: ValidationError[]; cycle?: string[] };

const VALID_STEP_STATUSES = new Set<StepStatus>([
  "pending",
  "ready",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "skipped",
]);

const VALID_PLAN_STATES = new Set<PlanLifecycleState>([
  "draft",
  "awaiting_approval",
  "executing",
  "paused",
  "completed",
  "failed",
]);

/**
 * Validates an ExecutionPlan against structural integrity rules,
 * phase grouping contracts, cycle constraints, and approval invariants.
 */
export function validatePlan(plan: ExecutionPlan): ValidationResult {
  const errors: ValidationError[] = [];
  const steps: readonly PlanStep[] = plan.steps ?? [];
  const phases: readonly PlanPhase[] = plan.phases ?? [];

  // Pass 1: Empty plan check
  if (steps.length === 0) {
    errors.push({
      path: "steps",
      code: "empty_plan",
      message: "Plan must contain at least one step.",
    });
  }

  // Pass 2: Phase validation
  const phasesById = new Map<string, { phase: PlanPhase; index: number }>();
  phases.forEach((phase, i) => {
    const existing = phasesById.get(phase.id);
    if (existing) {
      errors.push({
        path: `phases[${i}].id`,
        code: "duplicate_phase_id",
        message: `Duplicate phase id "${phase.id}" (first occurrence at phases[${existing.index}]).`,
      });
    } else {
      phasesById.set(phase.id, { phase, index: i });
    }
  });

  // Pass 3: Step ID uniqueness and status validation
  const byId = new Map<string, { step: PlanStep; index: number }>();
  steps.forEach((step, i) => {
    const existing = byId.get(step.id);
    if (existing) {
      errors.push({
        path: `steps[${i}].id`,
        code: "duplicate_step_id",
        message: `Duplicate step id "${step.id}" (first occurrence at steps[${existing.index}]).`,
      });
    } else {
      byId.set(step.id, { step, index: i });
    }

    if (step.status && !VALID_STEP_STATUSES.has(step.status)) {
      errors.push({
        path: `steps[${i}].status`,
        code: "invalid_step_status",
        message: `Step "${step.id}" has invalid status "${step.status}".`,
      });
    }
  });

  // Pass 4: Step phaseId reference integrity & non-empty phases
  const referencedPhaseIds = new Set<string>();
  steps.forEach((step, i) => {
    if (step.phaseId) {
      referencedPhaseIds.add(step.phaseId);
      if (phases.length > 0) {
        if (!phasesById.has(step.phaseId)) {
          errors.push({
            path: `steps[${i}].phaseId`,
            code: "unknown_phase",
            message: `Step "${step.id}" references unknown phase id "${step.phaseId}".`,
          });
        }
      } else {
        errors.push({
          path: `steps[${i}].phaseId`,
          code: "unknown_phase",
          message: `Step "${step.id}" references phase id "${step.phaseId}" but no phases are defined in the plan.`,
        });
      }
    }
  });

  if (phases.length > 0 && steps.length > 0) {
    phases.forEach((phase, i) => {
      if (!referencedPhaseIds.has(phase.id)) {
        errors.push({
          path: `phases[${i}]`,
          code: "empty_phase",
          message: `Phase "${phase.id}" ("${phase.title}") contains no steps.`,
        });
      }
    });
  }

  // Pass 5: Plan state validation
  if (plan.state && !VALID_PLAN_STATES.has(plan.state)) {
    errors.push({
      path: "state",
      code: "invalid_plan_state",
      message: `Plan has invalid lifecycle state "${plan.state}".`,
    });
  }

  // Pass 6: Unknown dependency IDs
  steps.forEach((step, i) => {
    (step.dependsOn ?? []).forEach((dep, j) => {
      if (!byId.has(dep)) {
        errors.push({
          path: `steps[${i}].dependsOn[${j}]`,
          code: "unknown_dependency",
          message: `Step "${step.id}" depends on unknown step id "${dep}".`,
        });
      }
    });
  });

  // Pass 7: Deterministic Cycle Detection (3-Color DFS)
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const reportedCycles = new Set<string>();
  let primaryCycle: string[] | undefined = undefined;

  const canonicalizeCycle = (cycle: string[]): string[] => {
    if (cycle.length <= 1) return cycle;
    const nodes = cycle.slice(0, -1);
    let minIdx = 0;
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i] < nodes[minIdx]) minIdx = i;
    }
    const rotated = [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)];
    return [...rotated, rotated[0]];
  };

  const dfs = (id: string): void => {
    color.set(id, GRAY);
    stack.push(id);
    const entry = byId.get(id)!;
    for (const dep of entry.step.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) {
        const rawCycle = [...stack.slice(stack.indexOf(dep)), dep];
        const canonical = canonicalizeCycle(rawCycle);
        const key = canonical.join("->");
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          if (!primaryCycle) primaryCycle = rawCycle;
          errors.push({
            path: `steps[${entry.index}].dependsOn`,
            code: "dependency_cycle",
            message: `Dependency cycle detected: ${rawCycle.join(" → ")}.`,
            cycle: rawCycle,
          });
        }
      } else if (c === WHITE) {
        dfs(dep);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  };

  for (const id of byId.keys()) {
    if ((color.get(id) ?? WHITE) === WHITE) dfs(id);
  }

  // Pass 8: Side-effecting steps must require explicit approval
  steps.forEach((step, i) => {
    if (step.sideEffecting && step.approval !== "required") {
      errors.push({
        path: `steps[${i}].approval`,
        code: "missing_approval",
        message: `Step "${step.id}" is side-effecting and must declare approval: "required".`,
      });
    }
  });

  if (errors.length > 0) {
    return {
      ok: false,
      valid: false,
      errors,
      ...(primaryCycle ? { cycle: primaryCycle } : {}),
    };
  }

  return { ok: true, valid: true, errors: [] };
}

export type PlanEvent =
  | "approve"
  | "execute"
  | "pause"
  | "resume"
  | "complete"
  | "fail"
  | "cancel"
  | "reset";

/**
 * Pure plan-state transition function.
 *
 * INVARIANT: natural language NEVER counts as approval. The ONLY transition
 * from `awaiting_approval` to `executing` is the explicit `approve` event,
 * which must originate from a deliberate user action (an approval button /
 * explicit consent affordance), never from chat text or model output.
 */
export function nextPlanState(state: PlanLifecycleState, event: PlanEvent): PlanLifecycleState {
  switch (event) {
    case "execute":
      return state === "draft" ? "awaiting_approval" : state;
    case "approve":
      return state === "awaiting_approval" ? "executing" : state;
    case "pause":
      return state === "executing" ? "paused" : state;
    case "resume":
      return state === "paused" ? "executing" : state;
    case "complete":
      return state === "executing" ? "completed" : state;
    case "fail":
      return state === "executing" || state === "paused" || state === "awaiting_approval"
        ? "failed"
        : state;
    case "cancel":
      return state === "awaiting_approval" || state === "executing" || state === "paused"
        ? "draft"
        : state;
    case "reset":
      return state === "completed" || state === "failed" ? "draft" : state;
    default:
      return state;
  }
}

/** A run may start or advance ONLY while the plan is `executing`. */
export function canRunPlan(state: PlanLifecycleState): boolean {
  return state === "executing";
}

/** Checks whether a transition between two plan lifecycle states is allowed. */
export function isValidPlanTransition(from: PlanLifecycleState, to: PlanLifecycleState): boolean {
  if (from === to) return true;
  const ALLOWED: Record<PlanLifecycleState, ReadonlySet<PlanLifecycleState>> = {
    draft: new Set(["awaiting_approval"]),
    awaiting_approval: new Set(["executing", "draft", "failed"]),
    executing: new Set(["paused", "completed", "failed", "draft"]),
    paused: new Set(["executing", "failed", "draft"]),
    completed: new Set(["draft"]),
    failed: new Set(["draft"]),
  };
  return ALLOWED[from]?.has(to) ?? false;
}

/** Validates state transitions with a descriptive error message if invalid. */
export function validatePlanTransition(
  from: PlanLifecycleState,
  to: PlanLifecycleState,
): { valid: boolean; error?: string } {
  if (isValidPlanTransition(from, to)) {
    return { valid: true };
  }
  return {
    valid: false,
    error: `Invalid plan state transition from "${from}" to "${to}".`,
  };
}
