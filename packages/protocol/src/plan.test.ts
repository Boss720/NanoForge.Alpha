import { describe, expect, it } from "vitest";
import {
  readySteps,
  resolvePlanStepStatuses,
  validatePlanDAG,
  executionPlanSchema,
  stepStatusSchema,
  planLifecycleStateSchema,
  type ExecutionPlan,
} from "./plan";

describe("readySteps & DAG Resolution Suite", () => {
  /* ------------------------------------------------------------------------ */
  /* 1. Legacy & Schema Validation Tests                                       */
  /* ------------------------------------------------------------------------ */

  it("maintains backward compatibility with legacy plans lacking title, phases, or state", () => {
    const legacyPlan = {
      id: "p1",
      goal: "test legacy",
      steps: [
        { id: "inspect", title: "Inspect", dependsOn: [], status: "succeeded" },
        { id: "edit", title: "Edit", dependsOn: ["inspect"], status: "pending" },
      ],
    } as const;
    expect(readySteps(legacyPlan).map((s) => s.id)).toEqual(["edit"]);
  });

  it("validates executionPlanSchema with full optional metadata", () => {
    const fullPlan: ExecutionPlan = {
      id: "p-full",
      title: "Full Plan",
      goal: "Comprehensive schema test",
      revision: 1,
      createdAt: 1723680000000,
      updatedAt: 1723680001000,
      state: "draft",
      phases: [
        { id: "phase-1", title: "Phase 1", description: "First phase", order: 0 },
      ],
      steps: [
        {
          id: "step-1",
          phaseId: "phase-1",
          title: "Step 1",
          description: "Inspect workspace",
          status: "pending",
          dependsOn: [],
          approval: "required",
          sideEffecting: true,
          affectedScopes: ["src/index.ts"],
          estimate: { tokens: 1000, costUsd: 0.05, durationSec: 10 },
          artifacts: ["output.log"],
        },
      ],
    };
    const parsed = executionPlanSchema.parse(fullPlan);
    expect(parsed.id).toBe("p-full");
    expect(parsed.phases?.[0].title).toBe("Phase 1");
  });

  it("validates all 7 step statuses in stepStatusSchema", () => {
    const statuses = [
      "pending",
      "ready",
      "running",
      "succeeded",
      "failed",
      "blocked",
      "skipped",
    ] as const;
    for (const s of statuses) {
      expect(stepStatusSchema.parse(s)).toBe(s);
    }
  });

  it("validates all 6 plan lifecycle states in planLifecycleStateSchema", () => {
    const states = [
      "draft",
      "awaiting_approval",
      "executing",
      "paused",
      "completed",
      "failed",
    ] as const;
    for (const st of states) {
      expect(planLifecycleStateSchema.parse(st)).toBe(st);
    }
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Sequential & Terminal Status Tests                                     */
  /* ------------------------------------------------------------------------ */

  it("releases root step with empty dependsOn when status is pending or ready", () => {
    const plan: ExecutionPlan = {
      id: "p-basic-1",
      goal: "single root",
      steps: [
        { id: "root-1", title: "Root Pending", dependsOn: [], status: "pending" },
        { id: "root-2", title: "Root Ready", dependsOn: [], status: "ready" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["root-1", "root-2"]);
  });

  it("releases sequential step only after upstream prerequisite succeeds", () => {
    const plan: ExecutionPlan = {
      id: "p-seq-1",
      goal: "linear pipeline",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: [], status: "succeeded" },
        { id: "step-2", title: "Step 2", dependsOn: ["step-1"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["step-2"]);
  });

  it("does not release step when upstream prerequisite is pending or running", () => {
    const plan: ExecutionPlan = {
      id: "p-seq-2",
      goal: "pending/running upstream",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: [], status: "running" },
        { id: "step-2", title: "Step 2", dependsOn: ["step-1"], status: "pending" },
      ],
    };
    expect(readySteps(plan)).toEqual([]);
  });

  it("does not re-release running, succeeded, failed, blocked, or skipped steps", () => {
    const plan: ExecutionPlan = {
      id: "p-terminal-1",
      goal: "terminal statuses",
      steps: [
        { id: "s1", title: "Running", dependsOn: [], status: "running" },
        { id: "s2", title: "Succeeded", dependsOn: [], status: "succeeded" },
        { id: "s3", title: "Failed", dependsOn: [], status: "failed" },
        { id: "s4", title: "Blocked", dependsOn: [], status: "blocked" },
        { id: "s5", title: "Skipped", dependsOn: [], status: "skipped" },
        { id: "s6", title: "Pending Ready", dependsOn: ["s2"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["s6"]);
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Diamond / Fork-Join Dependencies                                      */
  /* ------------------------------------------------------------------------ */

  it("releases all parallel branch steps when fork root succeeds", () => {
    const plan: ExecutionPlan = {
      id: "p-diamond-1",
      goal: "fork test",
      steps: [
        { id: "root", title: "Root", dependsOn: [], status: "succeeded" },
        { id: "branch-a", title: "Branch A", dependsOn: ["root"], status: "pending" },
        { id: "branch-b", title: "Branch B", dependsOn: ["root"], status: "pending" },
        { id: "join", title: "Join", dependsOn: ["branch-a", "branch-b"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["branch-a", "branch-b"]);
  });

  it("does not release join step if only one of two upstream branches succeeds", () => {
    const plan: ExecutionPlan = {
      id: "p-diamond-2",
      goal: "partial join test",
      steps: [
        { id: "root", title: "Root", dependsOn: [], status: "succeeded" },
        { id: "branch-a", title: "Branch A", dependsOn: ["root"], status: "succeeded" },
        { id: "branch-b", title: "Branch B", dependsOn: ["root"], status: "running" },
        { id: "join", title: "Join", dependsOn: ["branch-a", "branch-b"], status: "pending" },
      ],
    };
    expect(readySteps(plan)).toEqual([]);
  });

  it("releases join step once all diamond branches have succeeded", () => {
    const plan: ExecutionPlan = {
      id: "p-diamond-3",
      goal: "complete join test",
      steps: [
        { id: "root", title: "Root", dependsOn: [], status: "succeeded" },
        { id: "branch-a", title: "Branch A", dependsOn: ["root"], status: "succeeded" },
        { id: "branch-b", title: "Branch B", dependsOn: ["root"], status: "succeeded" },
        { id: "join", title: "Join", dependsOn: ["branch-a", "branch-b"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["join"]);
  });

  it("handles wide fan-in (N=4 dependencies) correctly", () => {
    const plan: ExecutionPlan = {
      id: "p-fanin-1",
      goal: "wide fan in",
      steps: [
        { id: "d1", title: "D1", dependsOn: [], status: "succeeded" },
        { id: "d2", title: "D2", dependsOn: [], status: "succeeded" },
        { id: "d3", title: "D3", dependsOn: [], status: "succeeded" },
        { id: "d4", title: "D4", dependsOn: [], status: "pending" },
        { id: "collector", title: "Collector", dependsOn: ["d1", "d2", "d3", "d4"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["d4"]);
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Approval Gate Integration & Zero Natural Language Authority           */
  /* ------------------------------------------------------------------------ */

  it("releases step with approval: 'required' when no approval ledger is passed (backward compat)", () => {
    const plan: ExecutionPlan = {
      id: "p-app-legacy",
      goal: "unrestricted evaluation",
      steps: [
        { id: "audit", title: "Audit", dependsOn: [], status: "succeeded" },
        { id: "apply", title: "Apply", dependsOn: ["audit"], status: "pending", approval: "required" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["apply"]);
  });

  it("blocks step with approval: 'required' when approvedStepIds is empty or lacks step ID", () => {
    const plan: ExecutionPlan = {
      id: "p-app-2",
      goal: "mismatched approval id",
      steps: [
        { id: "audit", title: "Audit", dependsOn: [], status: "succeeded" },
        { id: "apply", title: "Apply", dependsOn: ["audit"], status: "pending", approval: "required" },
      ],
    };
    expect(readySteps(plan, new Set())).toEqual([]);
    expect(readySteps(plan, new Set(["other-step-id"]))).toEqual([]);
  });

  it("releases step with approval: 'required' when approvedStepIds contains step ID", () => {
    const plan: ExecutionPlan = {
      id: "p-app-3",
      goal: "approved step",
      steps: [
        { id: "audit", title: "Audit", dependsOn: [], status: "succeeded" },
        { id: "apply", title: "Apply", dependsOn: ["audit"], status: "pending", approval: "required" },
      ],
    };
    const approvals = new Set(["apply"]);
    expect(readySteps(plan, approvals).map((s) => s.id)).toEqual(["apply"]);
  });

  it("releases auto-approved step without needing membership in approvedStepIds", () => {
    const plan: ExecutionPlan = {
      id: "p-app-4",
      goal: "auto approved step",
      steps: [
        { id: "read-only", title: "Read Only", dependsOn: [], status: "pending", approval: "auto" },
      ],
    };
    expect(readySteps(plan, new Set()).map((s) => s.id)).toEqual(["read-only"]);
  });

  it("supports selective approval in parallel branches", () => {
    const plan: ExecutionPlan = {
      id: "p-app-5",
      goal: "selective parallel approval",
      steps: [
        { id: "init", title: "Init", dependsOn: [], status: "succeeded" },
        { id: "safe-branch", title: "Safe Branch", dependsOn: ["init"], status: "pending" },
        { id: "risky-branch", title: "Risky Branch", dependsOn: ["init"], status: "pending", approval: "required" },
      ],
    };
    // Ledger empty -> only safe branch released
    expect(readySteps(plan, new Set()).map((s) => s.id)).toEqual(["safe-branch"]);

    // User approves risky-branch
    const approvals = new Set(["risky-branch"]);
    expect(readySteps(plan, approvals).map((s) => s.id)).toEqual(["safe-branch", "risky-branch"]);
  });

  it("immediately revokes step readiness when removed from approvedStepIds", () => {
    const plan: ExecutionPlan = {
      id: "p-app-6",
      goal: "revocation test",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: [], status: "pending", approval: "required" },
      ],
    };
    const ledger = new Set(["step-1"]);
    expect(readySteps(plan, ledger).map((s) => s.id)).toEqual(["step-1"]);

    ledger.delete("step-1");
    expect(readySteps(plan, ledger)).toEqual([]);
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Failure & Skip Cascades (resolvePlanStepStatuses)                     */
  /* ------------------------------------------------------------------------ */

  it("cascades failure to downstream steps as blocked in resolvePlanStepStatuses", () => {
    const plan: ExecutionPlan = {
      id: "p-fail-1",
      goal: "failed dep",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: [], status: "failed" },
        { id: "step-2", title: "Step 2", dependsOn: ["step-1"], status: "pending" },
        { id: "step-3", title: "Step 3", dependsOn: ["step-2"], status: "pending" },
      ],
    };
    const resolved = resolvePlanStepStatuses(plan);
    expect(resolved.steps[1].status).toBe("blocked");
    expect(resolved.steps[2].status).toBe("blocked");
  });

  it("cascades skip to downstream steps as skipped in resolvePlanStepStatuses", () => {
    const plan: ExecutionPlan = {
      id: "p-skip-1",
      goal: "skipped dep",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: [], status: "skipped" },
        { id: "step-2", title: "Step 2", dependsOn: ["step-1"], status: "pending" },
        { id: "step-3", title: "Step 3", dependsOn: ["step-2"], status: "pending" },
      ],
    };
    const resolved = resolvePlanStepStatuses(plan);
    expect(resolved.steps[1].status).toBe("skipped");
    expect(resolved.steps[2].status).toBe("skipped");
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Multi-Phase DAGs & validatePlanDAG Validation Suite                   */
  /* ------------------------------------------------------------------------ */

  it("resolves multi-phase DAG dependencies correctly across phase boundaries", () => {
    const plan: ExecutionPlan = {
      id: "p-phases-1",
      goal: "multi-phase execution",
      phases: [
        { id: "phase-1", title: "Discovery", order: 1 },
        { id: "phase-2", title: "Implementation", order: 2 },
        { id: "phase-3", title: "Verification", order: 3 },
      ],
      steps: [
        { id: "step-1-1", phaseId: "phase-1", title: "Audit", dependsOn: [], status: "succeeded" },
        { id: "step-2-1", phaseId: "phase-2", title: "Code", dependsOn: ["step-1-1"], status: "succeeded" },
        { id: "step-2-2", phaseId: "phase-2", title: "Refactor", dependsOn: ["step-2-1"], status: "pending" },
        { id: "step-3-1", phaseId: "phase-3", title: "Test", dependsOn: ["step-2-2"], status: "pending" },
      ],
    };
    expect(readySteps(plan).map((s) => s.id)).toEqual(["step-2-2"]);
    const val = validatePlanDAG(plan);
    expect(val.valid).toBe(true);
    expect(val.errors).toHaveLength(0);
  });

  it("treats dangling/ghost dependency IDs as unsatisfied in readySteps", () => {
    const plan: ExecutionPlan = {
      id: "p-dangling-1",
      goal: "ghost dependency",
      steps: [
        { id: "step-1", title: "Step 1", dependsOn: ["phantom-step-id"], status: "pending" },
      ],
    };
    expect(readySteps(plan)).toEqual([]);
  });

  it("detects cycle, duplicate ID, and missing approval with validatePlanDAG", () => {
    const cyclicPlan: ExecutionPlan = {
      id: "p-invalid-dag",
      phases: [{ id: "p1", title: "Phase 1", order: 0 }],
      steps: [
        { id: "a", phaseId: "p1", title: "A", dependsOn: ["b"], status: "pending" },
        { id: "b", phaseId: "p1", title: "B", dependsOn: ["a"], status: "pending" },
        { id: "a", phaseId: "p1", title: "A duplicate", dependsOn: [], status: "pending" },
        { id: "c", phaseId: "p1", title: "C", dependsOn: ["ghost"], status: "pending" },
        { id: "d", phaseId: "unknown_p", title: "D", dependsOn: [], status: "pending", sideEffecting: true },
      ],
    };
    const result = validatePlanDAG(cyclicPlan);
    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("duplicate_step_id");
    expect(codes).toContain("unknown_dependency");
    expect(codes).toContain("dependency_cycle");
    expect(codes).toContain("missing_approval");
    expect(codes).toContain("unknown_phase");
    expect(result.cycle).toBeDefined();
  });
});
