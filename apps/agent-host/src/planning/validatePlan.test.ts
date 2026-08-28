import { describe, expect, it } from "vitest";
import type { ExecutionPlan, PlanPhase, PlanStep } from "@protocol/plan";
import {
  canRunPlan,
  nextPlanState,
  validatePlan,
  isValidPlanTransition,
  validatePlanTransition,
  type PlanLifecycleState,
  type PlanUIState,
} from "./validatePlan";

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return { title: partial.id, dependsOn: [], status: "pending", ...partial };
}

function plan(steps: PlanStep[], extra?: Partial<ExecutionPlan>): ExecutionPlan {
  return { id: "p1", goal: "test goal", steps, ...extra };
}

describe("validatePlan — Multi-Pass Plan Validation & Cycle Engine", () => {
  /* ------------------------------------------------------------------------ */
  /* 1. Valid Plans (Flat & Hierarchical Phases)                              */
  /* ------------------------------------------------------------------------ */

  it("accepts a valid flat plan", () => {
    const p = plan([
      step({ id: "a" }),
      step({ id: "b", dependsOn: ["a"] }),
      step({ id: "c", dependsOn: ["b"], sideEffecting: true, approval: "required" }),
    ]);
    const res = validatePlan(p);
    expect(res.ok).toBe(true);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it("accepts a valid multi-phase execution plan", () => {
    const phases: PlanPhase[] = [
      { id: "phase-1", title: "Discovery", order: 0 },
      { id: "phase-2", title: "Execution", order: 1 },
    ];
    const p = plan(
      [
        step({ id: "s1", phaseId: "phase-1" }),
        step({ id: "s2", phaseId: "phase-2", dependsOn: ["s1"], sideEffecting: true, approval: "required" }),
      ],
      { phases },
    );
    const res = validatePlan(p);
    expect(res.ok).toBe(true);
    expect(res.valid).toBe(true);
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Structural & ID Validation                                            */
  /* ------------------------------------------------------------------------ */

  it("rejects an empty plan with no steps", () => {
    const res = validatePlan(plan([]));
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatchObject({ code: "empty_plan", path: "steps" });
  });

  it("rejects duplicate step IDs", () => {
    const res = validatePlan(plan([step({ id: "a" }), step({ id: "a" })]));
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatchObject({ code: "duplicate_step_id", path: "steps[1].id" });
  });

  it("rejects unknown dependency IDs", () => {
    const res = validatePlan(plan([step({ id: "a", dependsOn: ["ghost"] })]));
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatchObject({
      code: "unknown_dependency",
      path: "steps[0].dependsOn[0]",
    });
    expect(res.errors[0].message).toContain("ghost");
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Phase Validation & Non-Empty Phase Invariants                         */
  /* ------------------------------------------------------------------------ */

  it("rejects duplicate phase IDs", () => {
    const p = plan([step({ id: "s1", phaseId: "p1" })], {
      phases: [
        { id: "p1", title: "Phase 1", order: 0 },
        { id: "p1", title: "Phase 1 duplicate", order: 1 },
      ],
    });
    const res = validatePlan(p);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === "duplicate_phase_id")).toBe(true);
  });

  it("rejects step referencing unknown phase ID", () => {
    const p = plan([step({ id: "s1", phaseId: "nonexistent_phase" })], {
      phases: [{ id: "p1", title: "Phase 1", order: 0 }],
    });
    const res = validatePlan(p);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === "unknown_phase")).toBe(true);
  });

  it("rejects step referencing phaseId when no phases are defined", () => {
    const p = plan([step({ id: "s1", phaseId: "p1" })]);
    const res = validatePlan(p);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === "unknown_phase")).toBe(true);
  });

  it("rejects empty phase containing no steps", () => {
    const p = plan([step({ id: "s1", phaseId: "p1" })], {
      phases: [
        { id: "p1", title: "Phase 1", order: 0 },
        { id: "p2", title: "Phase 2 (Empty)", order: 1 },
      ],
    });
    const res = validatePlan(p);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === "empty_phase")).toBe(true);
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Deterministic Cycle Detection (DFS)                                   */
  /* ------------------------------------------------------------------------ */

  it("detects dependency cycles, reports cycle path and cycle array", () => {
    const res = validatePlan(
      plan([
        step({ id: "a", dependsOn: ["c"] }),
        step({ id: "b", dependsOn: ["a"] }),
        step({ id: "c", dependsOn: ["b"] }),
      ]),
    );
    expect(res.ok).toBe(false);
    const cycles = res.errors.filter((e) => e.code === "dependency_cycle");
    expect(cycles).toHaveLength(1);
    expect(cycles[0].message).toMatch(/a → c → b → a|c → b → a → c|b → a → c → b/);
    expect(cycles[0].cycle).toBeDefined();
    expect(res.cycle).toBeDefined();
  });

  it("detects a self-dependency cycle", () => {
    const res = validatePlan(plan([step({ id: "a", dependsOn: ["a"] })]));
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatchObject({ code: "dependency_cycle" });
    expect(res.errors[0].message).toContain("a → a");
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Status, State, and Security Invariant Validation                      */
  /* ------------------------------------------------------------------------ */

  it("requires approval for side-effecting steps", () => {
    const res = validatePlan(plan([step({ id: "x", sideEffecting: true })]));
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatchObject({ code: "missing_approval", path: "steps[0].approval" });
  });

  it("rejects invalid step statuses and plan states", () => {
    const invalidStepPlan = plan([
      step({ id: "s1", status: "invalid_status" as any }),
    ], { state: "invalid_state" as any });
    const res = validatePlan(invalidStepPlan);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === "invalid_step_status")).toBe(true);
    expect(res.errors.some((e) => e.code === "invalid_plan_state")).toBe(true);
  });

  it("reports multiple error classes together", () => {
    const res = validatePlan(
      plan([
        step({ id: "a", dependsOn: ["b"] }),
        step({ id: "b", dependsOn: ["a"] }),
        step({ id: "b", dependsOn: ["ghost"], sideEffecting: true }),
      ]),
    );
    expect(res.ok).toBe(false);
    const codes = res.errors.map((e) => e.code).sort();
    expect(codes).toEqual(
      ["dependency_cycle", "duplicate_step_id", "missing_approval", "unknown_dependency"].sort(),
    );
  });
});

describe("plan lifecycle state machine (6 states)", () => {
  it("draft → awaiting_approval on execute, and only approve starts executing", () => {
    let state: PlanLifecycleState = "draft";
    expect(canRunPlan(state)).toBe(false);

    state = nextPlanState(state, "execute");
    expect(state).toBe("awaiting_approval");
    expect(canRunPlan(state)).toBe(false);

    // No-op events in awaiting_approval
    expect(nextPlanState(state, "execute")).toBe("awaiting_approval");
    expect(nextPlanState(state, "resume")).toBe("awaiting_approval");
    expect(nextPlanState(state, "complete")).toBe("awaiting_approval");

    state = nextPlanState(state, "approve");
    expect(state).toBe("executing");
    expect(canRunPlan(state)).toBe(true);
  });

  it("handles pause/resume/complete/fail/cancel/reset transitions across all 6 states", () => {
    let state: PlanLifecycleState = nextPlanState("draft", "execute");
    state = nextPlanState(state, "approve");
    expect(nextPlanState(state, "pause")).toBe("paused");
    expect(nextPlanState("paused", "resume")).toBe("executing");
    expect(nextPlanState(state, "complete")).toBe("completed");
    expect(canRunPlan("completed")).toBe(false);

    // fail transitions from executing, paused, and awaiting_approval
    expect(nextPlanState("executing", "fail")).toBe("failed");
    expect(nextPlanState("paused", "fail")).toBe("failed");
    expect(nextPlanState("awaiting_approval", "fail")).toBe("failed");

    // cancel returns to draft from active/pending states
    expect(nextPlanState("awaiting_approval", "cancel")).toBe("draft");
    expect(nextPlanState("executing", "cancel")).toBe("draft");
    expect(nextPlanState("paused", "cancel")).toBe("draft");

    // reset returns completed/failed back to draft
    expect(nextPlanState("completed", "reset")).toBe("draft");
    expect(nextPlanState("failed", "reset")).toBe("draft");
  });

  it("validates state transition validity with isValidPlanTransition & validatePlanTransition", () => {
    expect(isValidPlanTransition("draft", "awaiting_approval")).toBe(true);
    expect(isValidPlanTransition("awaiting_approval", "executing")).toBe(true);
    expect(isValidPlanTransition("executing", "completed")).toBe(true);
    expect(isValidPlanTransition("executing", "failed")).toBe(true);
    expect(isValidPlanTransition("completed", "draft")).toBe(true);
    expect(isValidPlanTransition("failed", "draft")).toBe(true);

    // Invalid transitions
    expect(isValidPlanTransition("draft", "executing")).toBe(false);
    expect(isValidPlanTransition("completed", "executing")).toBe(false);

    const validReport = validatePlanTransition("draft", "awaiting_approval");
    expect(validReport.valid).toBe(true);

    const invalidReport = validatePlanTransition("draft", "executing");
    expect(invalidReport.valid).toBe(false);
    expect(invalidReport.error).toContain('Invalid plan state transition from "draft" to "executing"');
  });
});
