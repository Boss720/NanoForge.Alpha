/**
 * CLI Plan Synthesis & DAG Construction.
 *
 * Translates natural language goals into validated, hierarchical ExecutionPlans
 * with phase groupings, topological dependencies, side-effect annotations,
 * and approval requirements.
 */

import { randomUUID } from "node:crypto";
import type { ExecutionPlan, PlanPhase, PlanStep } from "@protocol/plan";
import { validatePlan, type ValidationResult } from "../planning/validatePlan";

export interface PlanSynthesisOptions {
  planId?: string;
  phases?: boolean;
}

/**
 * Synthesizes a well-formed ExecutionPlan from a natural language prompt or goal.
 */
export function synthesizePlan(
  goal: string,
  options: PlanSynthesisOptions = {},
): ExecutionPlan {
  const trimmed = goal.trim();
  const planId = options.planId ?? `plan-${randomUUID().slice(0, 8)}`;
  const title = trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;

  const isReadOnly =
    /^(inspect|read|check|view|status|list|search|find|diff)\b/i.test(trimmed);

  const phases: PlanPhase[] = [
    {
      id: "phase-discovery",
      title: "Discovery & Analysis",
      description: "Inspect workspace structure, files, and environment requirements",
      order: 0,
    },
    {
      id: "phase-execution",
      title: "Execution & Implementation",
      description: "Perform the core operations requested in the goal",
      order: 1,
    },
    {
      id: "phase-verification",
      title: "Verification & Audit",
      description: "Verify task outcomes, validate outputs, and run verification checks",
      order: 2,
    },
  ];

  const steps: PlanStep[] = [
    {
      id: "step-1-discovery",
      title: `Analyze workspace for: ${title}`,
      description: `Gather context, inspect environment, and verify preconditions for "${trimmed}"`,
      phaseId: "phase-discovery",
      status: "pending",
      dependsOn: [],
      sideEffecting: false,
      approval: "auto",
      affectedScopes: ["."],
      estimate: { tokens: 2048, durationSec: 5 },
    },
    {
      id: "step-2-execute",
      title: isReadOnly ? `Inspect and execute: ${title}` : `Apply changes: ${title}`,
      description: `Perform primary execution for "${trimmed}"`,
      phaseId: "phase-execution",
      status: "pending",
      dependsOn: ["step-1-discovery"],
      sideEffecting: !isReadOnly,
      approval: !isReadOnly ? "required" : "auto",
      affectedScopes: ["."],
      estimate: { tokens: 4096, durationSec: 15 },
    },
    {
      id: "step-3-verify",
      title: `Verify results for: ${title}`,
      description: `Validate output artifacts and confirm success criteria for "${trimmed}"`,
      phaseId: "phase-verification",
      status: "pending",
      dependsOn: ["step-2-execute"],
      sideEffecting: false,
      approval: "auto",
      affectedScopes: ["."],
      estimate: { tokens: 1024, durationSec: 5 },
    },
  ];

  return {
    id: planId,
    title,
    goal: trimmed,
    phases,
    steps,
    state: "draft",
    revision: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Parses a JSON execution plan string or synthesizes a plan from natural language,
 * running full DAG cycle & schema validation.
 */
export function parseOrSynthesizePlan(
  input: string,
  options: PlanSynthesisOptions = {},
): { plan: ExecutionPlan; validation: ValidationResult } {
  const trimmed = input.trim();

  // Attempt JSON parsing if input looks like a JSON object
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as ExecutionPlan;
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.steps)) {
        const validation = validatePlan(parsed);
        return { plan: parsed, validation };
      }
    } catch {
      // Fall through to natural language synthesis if JSON parsing fails
    }
  }

  const plan = synthesizePlan(trimmed, options);
  const validation = validatePlan(plan);
  return { plan, validation };
}
