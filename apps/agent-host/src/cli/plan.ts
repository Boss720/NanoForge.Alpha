/**
 * Headless Plan Generator Command Handler (`nanoforge plan`).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExecutionPlan } from "@protocol/plan";
import { HumanFormatter, JsonFormatter } from "./formatters";
import { parseOrSynthesizePlan } from "./planner";
import { EXIT_CODES, type CLIResult, type PlanCommandOptions } from "./types";

export async function executePlanCommand(options: PlanCommandOptions): Promise<CLIResult> {
  const goal = options.goal?.trim();
  const human = new HumanFormatter({ noColor: options.noColor });
  const jsonFormatter = new JsonFormatter();

  if (!goal) {
    human.printError("Missing required plan goal. Usage: nanoforge plan \"<goal>\" [--json] [--output <dir>]", EXIT_CODES.CONFIG_AUTH);
    return {
      exitCode: EXIT_CODES.CONFIG_AUTH,
      message: "Missing required plan goal",
    };
  }

  const { plan, validation } = parseOrSynthesizePlan(goal);

  if (!validation.ok) {
    if (options.json) {
      jsonFormatter.format({
        ok: false,
        error: "plan_validation_failed",
        errors: validation.errors,
        cycle: validation.cycle,
      });
    } else {
      human.printBanner();
      human.printError("Generated execution plan failed DAG verification:", EXIT_CODES.VERIFICATION_FAILED);
      for (const err of validation.errors) {
        process.stderr.write(`  • [${err.code}] ${err.path}: ${err.message}\n`);
      }
    }
    return {
      exitCode: EXIT_CODES.VERIFICATION_FAILED,
      message: "Plan verification failed",
      plan,
    };
  }

  if (options.json) {
    jsonFormatter.format(plan);
  } else {
    human.printBanner();
    human.printPlan(plan);
  }

  if (options.output) {
    try {
      const outDir = path.resolve(options.output);
      mkdirSync(outDir, { recursive: true });

      writeFileSync(path.join(outDir, "plan.json"), JSON.stringify(plan, null, 2), "utf8");
      writeFileSync(path.join(outDir, "plan.md"), renderPlanMarkdown(plan), "utf8");
    } catch (err) {
      const msg = `Failed to write output to "${options.output}": ${err instanceof Error ? err.message : String(err)}`;
      human.printError(msg, EXIT_CODES.FAILURE);
      return {
        exitCode: EXIT_CODES.FAILURE,
        message: msg,
        plan,
      };
    }
  }

  return {
    exitCode: EXIT_CODES.SUCCESS,
    plan,
  };
}

function renderPlanMarkdown(plan: ExecutionPlan): string {
  const lines: string[] = [
    `# Execution Plan: ${plan.goal ?? plan.title ?? "Untitled"}`,
    "",
    `**Plan ID:** \`${plan.id}\`  `,
    `**Revision:** ${plan.revision ?? 1}  `,
    `**Total Steps:** ${plan.steps.length}  `,
    "",
  ];

  if (plan.phases && plan.phases.length > 0) {
    const sortedPhases = [...plan.phases].sort((a, b) => a.order - b.order);
    for (const phase of sortedPhases) {
      lines.push(`## ${phase.title}`);
      if (phase.description) lines.push(`*${phase.description}*\n`);

      const steps = plan.steps.filter((s) => s.phaseId === phase.id);
      for (const step of steps) {
        const approval = step.approval === "required" ? " *(Approval Required)*" : "";
        const sideEffect = step.sideEffecting ? " *(Mutating)*" : "";
        const deps = step.dependsOn && step.dependsOn.length > 0 ? ` (depends on: ${step.dependsOn.join(", ")})` : "";
        lines.push(`- **[${step.id}]** ${step.title}${approval}${sideEffect}${deps}`);
        if (step.description) lines.push(`  > ${step.description}`);
      }
      lines.push("");
    }
  } else {
    lines.push("## Steps");
    for (const step of plan.steps) {
      const approval = step.approval === "required" ? " *(Approval Required)*" : "";
      const sideEffect = step.sideEffecting ? " *(Mutating)*" : "";
      const deps = step.dependsOn && step.dependsOn.length > 0 ? ` (depends on: ${step.dependsOn.join(", ")})` : "";
      lines.push(`- **[${step.id}]** ${step.title}${approval}${sideEffect}${deps}`);
      if (step.description) lines.push(`  > ${step.description}`);
    }
  }

  return lines.join("\n");
}
