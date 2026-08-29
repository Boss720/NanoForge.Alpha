/**
 * Executable plan contracts & deterministic DAG validation — Module 1, Task 1.
 *
 * An {@link ExecutionPlan} is the unit of work the agent platform proposes,
 * the user approves, and the run coordinator executes. All arrays are
 * readonly: plans are immutable once created; status transitions produce new
 * plan objects rather than mutating in place.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 1. Step Status & Lifecycle States                                  */
/* ------------------------------------------------------------------ */

/**
 * Canonical 7-state lifecycle of a single plan step:
 * - "pending": Upstream dependencies are not yet satisfied.
 * - "ready": Upstream dependencies are satisfied; awaiting approval or execution dispatch.
 * - "running": Currently executing in the agent host.
 * - "succeeded": Execution finished successfully.
 * - "failed": Execution failed or crashed; halts dependent execution branch.
 * - "blocked": Requires user approval or has an upstream failed dependency.
 * - "skipped": Intentionally bypassed by user action or conditional branch resolution.
 */
export const stepStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "skipped",
]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

/**
 * Canonical 6-state plan-level lifecycle state:
 * - "draft": Authoring in PlanComposer, AI proposal, manual editing.
 * - "awaiting_approval": Reviewing steps, diffs, and pending user approval gates.
 * - "executing": Active execution of ready steps by coordinator.
 * - "paused": Execution temporarily halted by user.
 * - "completed": All required steps in plan have succeeded or skipped.
 * - "failed": One or more unrecoverable step failures halted the plan.
 */
export const planLifecycleStateSchema = z.enum([
  "draft",
  "awaiting_approval",
  "executing",
  "paused",
  "completed",
  "failed",
]);
export type PlanLifecycleState = z.infer<typeof planLifecycleStateSchema>;

/** Legacy alias for UI components and backward compatibility. */
export const planUIStateSchema = planLifecycleStateSchema;
export type PlanUIState = PlanLifecycleState;

/* ------------------------------------------------------------------ */
/* 2. Step Resource Estimates & Phase Groupings                       */
/* ------------------------------------------------------------------ */

/** Resource estimates for UI display, cost analytics, and model routing. */
export const stepEstimateSchema = z.object({
  tokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  durationSec: z.number().nonnegative().optional(),
});
export type StepEstimate = z.infer<typeof stepEstimateSchema>;

/**
 * Logical phase grouping for hierarchical DAG execution plans:
 * e.g. "Phase 1: Discovery", "Phase 2: Implementation", "Phase 3: Verification".
 */
export const planPhaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int().nonnegative(),
});
export type PlanPhase = z.infer<typeof planPhaseSchema>;

/* ------------------------------------------------------------------ */
/* 3. PlanStep & ExecutionPlan Contracts                              */
/* ------------------------------------------------------------------ */

/**
 * One unit of work inside an execution plan.
 */
export const planStepSchema = z.object({
  /** Unique identifier within the plan. */
  id: z.string().min(1),
  /** Human-readable title displayed in the plan inspector. */
  title: z.string().min(1),
  /** Optional detailed step description / instructions. */
  description: z.string().optional(),
  /** Optional phase reference for hierarchical grouping. */
  phaseId: z.string().min(1).optional(),
  /** Current step lifecycle status. */
  status: stepStatusSchema,
  /** Step IDs that must all reach "succeeded" before this step may run. */
  dependsOn: z.array(z.string()).default([]),
  /** When "required", execution pauses until explicit user approval. */
  approval: z.enum(["required", "auto"]).optional(),
  /** True when the step mutates filesystem, network, or external state. */
  sideEffecting: z.boolean().optional(),
  /** Exact workspace paths, origins, or MCP tool names touched. */
  affectedScopes: z.array(z.string()).optional(),
  /** Rough resource estimate for cost rollups and UI. */
  estimate: stepEstimateSchema.optional(),
  /** Relative paths or IDs of produced artifacts. */
  artifacts: z.array(z.string()).optional(),
});

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  phaseId?: string;
  status: StepStatus;
  dependsOn: readonly string[];
  approval?: "required" | "auto";
  sideEffecting?: boolean;
  affectedScopes?: readonly string[];
  estimate?: StepEstimate;
  artifacts?: readonly string[];
}

/**
 * An executable plan proposed by the agent, edited by the user,
 * and executed by the run coordinator.
 */
export const executionPlanSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  /** Goal in natural language (backward compatibility with Phase 1). */
  goal: z.string().optional(),
  /** Hierarchical phase groupings. */
  phases: z.array(planPhaseSchema).optional(),
  /** Ordered list of plan steps. */
  steps: z.array(planStepSchema),
  /** Current plan lifecycle state. */
  state: planLifecycleStateSchema.optional(),
  /** Monotonically increasing revision number for plan forking/diffing. */
  revision: z.number().int().nonnegative().optional(),
  /** Unix millisecond creation timestamp. */
  createdAt: z.number().optional(),
  /** Unix millisecond last-update timestamp. */
  updatedAt: z.number().optional(),
});

export interface ExecutionPlan {
  id: string;
  title?: string;
  goal?: string;
  phases?: readonly PlanPhase[];
  steps: readonly PlanStep[];
  state?: PlanLifecycleState;
  revision?: number;
  createdAt?: number;
  updatedAt?: number;
}

/* ------------------------------------------------------------------ */
/* 4. Pure Topological Step Resolver & Status Computations            */
/* ------------------------------------------------------------------ */

/**
 * Steps that may start executing right now:
 * 1. Step status is "pending" or "ready".
 * 2. Every dependency in `step.dependsOn` exists in `plan.steps` and has reached status "succeeded".
 * 3. Dual Approval Gate: If `step.approval === "required"` and an `approvedStepIds` ledger is supplied,
 *    `approvedStepIds.has(step.id)` MUST be true.
 *
 * Steps with failed, blocked, running, skipped, or unknown dependencies are NOT released.
 */
export function readySteps(
  plan: ExecutionPlan,
  approvedStepIds?: ReadonlySet<string>,
): PlanStep[] {
  if (!plan || !plan.steps || !Array.isArray(plan.steps)) {
    return [];
  }

  const stepMap = new Map<string, PlanStep>();
  for (const step of plan.steps) {
    stepMap.set(step.id, step as PlanStep);
  }

  return (plan.steps as PlanStep[]).filter((step) => {
    // Only pending or ready steps are eligible for release
    if (step.status !== "pending" && step.status !== "ready") {
      return false;
    }

    // Dual approval gate: if approval is required and approval ledger is provided, verify explicit authorization
    if (
      step.approval === "required" &&
      approvedStepIds !== undefined &&
      !approvedStepIds.has(step.id)
    ) {
      return false;
    }

    // Dependency check: every dependency in dependsOn must exist and have reached "succeeded"
    if (!step.dependsOn || step.dependsOn.length === 0) {
      return true;
    }

    return step.dependsOn.every((depId) => {
      const depStep = stepMap.get(depId);
      return depStep !== undefined && depStep.status === "succeeded";
    });
  });
}

/**
 * Resolves the deterministic status for all steps in a plan, applying topological
 * readiness, failure cascades, skip cascades, and approval gates.
 *
 * @param plan The input execution plan.
 * @param approvedStepIds Authoritative set of approved step IDs.
 * @returns A new immutable ExecutionPlan with updated step statuses.
 */
export function resolvePlanStepStatuses(
  plan: ExecutionPlan,
  approvedStepIds?: ReadonlySet<string>,
): ExecutionPlan {
  const stepMap = new Map<string, PlanStep>(plan.steps.map((s) => [s.id, s as PlanStep]));
  const resolvedStatuses = new Map<string, StepStatus>();

  const computeStatus = (step: PlanStep, visited: Set<string>): StepStatus => {
    if (resolvedStatuses.has(step.id)) {
      return resolvedStatuses.get(step.id)!;
    }
    if (visited.has(step.id)) {
      return "blocked";
    }
    visited.add(step.id);

    if (step.status === "running" || step.status === "succeeded" || step.status === "failed") {
      resolvedStatuses.set(step.id, step.status);
      return step.status;
    }

    if (step.status === "skipped") {
      resolvedStatuses.set(step.id, "skipped");
      return "skipped";
    }

    let hasFailedOrBlockedDep = false;
    let hasSkippedDep = false;
    let hasUnfinishedDep = false;

    for (const depId of step.dependsOn ?? []) {
      const dep = stepMap.get(depId);
      if (!dep) {
        hasFailedOrBlockedDep = true;
        break;
      }
      const depStatus = computeStatus(dep, new Set(visited));
      if (depStatus === "failed" || depStatus === "blocked") {
        hasFailedOrBlockedDep = true;
        break;
      } else if (depStatus === "skipped") {
        hasSkippedDep = true;
      } else if (depStatus !== "succeeded") {
        hasUnfinishedDep = true;
      }
    }

    let nextStatus: StepStatus;
    if (hasFailedOrBlockedDep) {
      nextStatus = "blocked";
    } else if (hasSkippedDep) {
      nextStatus = "skipped";
    } else if (hasUnfinishedDep) {
      nextStatus = "pending";
    } else {
      if (step.approval === "required" && (!approvedStepIds || !approvedStepIds.has(step.id))) {
        nextStatus = "blocked";
      } else {
        nextStatus = "ready";
      }
    }

    resolvedStatuses.set(step.id, nextStatus);
    return nextStatus;
  };

  const updatedSteps = plan.steps.map((step) => {
    const nextStatus = computeStatus(step as PlanStep, new Set());
    return nextStatus !== step.status ? { ...step, status: nextStatus } : step;
  });

  return {
    ...plan,
    steps: updatedSteps,
  };
}

/* ------------------------------------------------------------------ */
/* 5. Pure Deterministic DAG Cycle & Integrity Validation             */
/* ------------------------------------------------------------------ */

export interface PlanValidationError {
  path: string;
  code:
    | "duplicate_step_id"
    | "unknown_dependency"
    | "dependency_cycle"
    | "missing_approval"
    | "unknown_phase";
  message: string;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: PlanValidationError[];
  cycle?: string[];
}

/**
 * Canonical cycle rotation: rotates [B, C, A, B] to start with the
 * lexicographically smallest node [A, B, C, A] for consistent cycle deduplication.
 */
function canonicalizeCycle(cycle: string[]): string[] {
  if (cycle.length <= 1) return cycle;
  const nodes = cycle.slice(0, -1);
  let minIdx = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i] < nodes[minIdx]) minIdx = i;
  }
  const rotated = [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)];
  return [...rotated, rotated[0]];
}

/**
 * Pure deterministic validation for execution plans:
 * - Detects duplicate step IDs.
 * - Detects unknown/dangling dependencies.
 * - Detects self-loops and multi-node cycles with exact cycle path reporting (e.g. A → B → C → A).
 * - Enforces zero-natural-language approval security invariant: all side-effecting steps require approval: "required".
 * - Validates phase references if phases are declared.
 */
export function validatePlanDAG(plan: ExecutionPlan): PlanValidationResult {
  const errors: PlanValidationError[] = [];
  const steps = plan.steps ?? [];
  const phases = plan.phases ?? [];

  // Phase lookup
  const phaseIds = new Set(phases.map((p) => p.id));
  steps.forEach((step, i) => {
    if (step.phaseId && phases.length > 0 && !phaseIds.has(step.phaseId)) {
      errors.push({
        path: `steps[${i}].phaseId`,
        code: "unknown_phase",
        message: `Step "${step.id}" references unknown phase id "${step.phaseId}".`,
      });
    }
  });

  // Duplicate step IDs
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
      byId.set(step.id, { step: step as PlanStep, index: i });
    }
  });

  // Unknown dependency IDs
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

  // Deterministic Cycle Detection (DFS 3-color)
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const reportedCycles = new Set<string>();
  let firstDetectedCycle: string[] | undefined;

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
          if (!firstDetectedCycle) firstDetectedCycle = rawCycle;
          errors.push({
            path: `steps[${byId.get(dep)!.index}].dependsOn`,
            code: "dependency_cycle",
            message: `Dependency cycle detected: ${rawCycle.join(" → ")}.`,
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
    if ((color.get(id) ?? WHITE) === WHITE) {
      dfs(id);
    }
  }

  // Side-effecting steps must declare approval: "required"
  steps.forEach((step, i) => {
    if (step.sideEffecting && step.approval !== "required") {
      errors.push({
        path: `steps[${i}].approval`,
        code: "missing_approval",
        message: `Step "${step.id}" is side-effecting and must declare approval: "required".`,
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    ...(firstDetectedCycle ? { cycle: firstDetectedCycle } : {}),
  };
}
