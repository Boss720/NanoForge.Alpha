/**
 * CLI Plan Synthesis & Parser Unit Tests.
 */

import { describe, expect, it } from "vitest";
import type { ExecutionPlan } from "@protocol/plan";
import { parseOrSynthesizePlan, synthesizePlan } from "./planner";

describe("synthesizePlan", () => {
  it("synthesizes a valid multi-phase ExecutionPlan for general goal", () => {
    const plan = synthesizePlan("Build and test the compiler");
    expect(plan.id).toMatch(/^plan-/);
    expect(plan.goal).toBe("Build and test the compiler");
    expect(plan.phases?.length).toBe(3);
    expect(plan.steps.length).toBe(3);

    // Dependencies must be sequential
    expect(plan.steps[0].dependsOn).toEqual([]);
    expect(plan.steps[1].dependsOn).toEqual(["step-1-discovery"]);
    expect(plan.steps[2].dependsOn).toEqual(["step-2-execute"]);

    // Mutating step must have approval required
    expect(plan.steps[1].sideEffecting).toBe(true);
    expect(plan.steps[1].approval).toBe("required");
  });

  it("marks read-only query goals appropriately", () => {
    const plan = synthesizePlan("Inspect git status of repository");
    expect(plan.steps[1].sideEffecting).toBe(false);
    expect(plan.steps[1].approval).toBe("auto");
  });
});

describe("parseOrSynthesizePlan", () => {
  it("validates and parses a valid JSON execution plan", () => {
    const customPlan: ExecutionPlan = {
      id: "custom-plan-1",
      goal: "Custom Plan",
      steps: [
        {
          id: "step-a",
          title: "Step A",
          status: "pending",
          dependsOn: [],
          sideEffecting: false,
          approval: "auto",
        },
      ],
    };

    const { plan, validation } = parseOrSynthesizePlan(JSON.stringify(customPlan));
    expect(validation.ok).toBe(true);
    expect(plan.id).toBe("custom-plan-1");
  });

  it("detects DAG validation errors on invalid JSON plan (e.g. cycle)", () => {
    const cyclicPlan: ExecutionPlan = {
      id: "cyclic-plan",
      goal: "Cyclic",
      steps: [
        {
          id: "step-1",
          title: "Step 1",
          status: "pending",
          dependsOn: ["step-2"],
        },
        {
          id: "step-2",
          title: "Step 2",
          status: "pending",
          dependsOn: ["step-1"],
        },
      ],
    };

    const { validation } = parseOrSynthesizePlan(JSON.stringify(cyclicPlan));
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors.some((e) => e.code === "dependency_cycle")).toBe(true);
    }
  });

  it("detects missing approval on side-effecting step", () => {
    const planWithoutApproval: ExecutionPlan = {
      id: "unapproved-plan",
      goal: "Missing Approval",
      steps: [
        {
          id: "step-1",
          title: "Mutating Step",
          status: "pending",
          dependsOn: [],
          sideEffecting: true,
          approval: "auto", // Invalid! Side-effecting step must have approval: "required"
        },
      ],
    };

    const { validation } = parseOrSynthesizePlan(JSON.stringify(planWithoutApproval));
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors.some((e) => e.code === "missing_approval")).toBe(true);
    }
  });
});
