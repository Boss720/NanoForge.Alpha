/**
 * CLI Event & Output Formatters.
 *
 * Supports:
 * - Formatted Human Terminal Output with ANSI colors and progress indicators.
 * - NDJSON (Newline Delimited JSON) streaming event feeds.
 * - Formatted JSON objects for non-interactive / pipeline integration.
 */

import type { ExecutionPlan } from "@protocol/plan";
import type { RunEvent } from "../runs/events";
import type { RunSummary } from "../runs/coordinator";
import { type ExitCode, exitCodeDescription } from "./exitCodes";

/* ------------------------------------------------------------------------ */
/* ANSI Color Helpers                                                       */
/* ------------------------------------------------------------------------ */

export interface ColorOptions {
  noColor?: boolean;
}

export class ChalkLike {
  private readonly enabled: boolean;

  constructor(options: ColorOptions = {}) {
    const noColorEnv = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "0";
    this.enabled = !(options.noColor ?? noColorEnv);
  }

  private wrap(code: string, text: string): string {
    return this.enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
  }

  bold(text: string): string {
    return this.wrap("1", text);
  }
  dim(text: string): string {
    return this.wrap("2", text);
  }
  green(text: string): string {
    return this.wrap("32", text);
  }
  red(text: string): string {
    return this.wrap("31", text);
  }
  yellow(text: string): string {
    return this.wrap("33", text);
  }
  blue(text: string): string {
    return this.wrap("34", text);
  }
  magenta(text: string): string {
    return this.wrap("35", text);
  }
  cyan(text: string): string {
    return this.wrap("36", text);
  }
  gray(text: string): string {
    return this.wrap("90", text);
  }
  bgRed(text: string): string {
    return this.wrap("41", text);
  }
  bgGreen(text: string): string {
    return this.wrap("42", text);
  }
}

/* ------------------------------------------------------------------------ */
/* Human Formatter                                                          */
/* ------------------------------------------------------------------------ */

export class HumanFormatter {
  private readonly c: ChalkLike;
  private readonly out: (msg: string) => void;
  private readonly err: (msg: string) => void;

  constructor(
    options: ColorOptions = {},
    out: (msg: string) => void = (m) => process.stdout.write(m + "\n"),
    err: (msg: string) => void = (m) => process.stderr.write(m + "\n"),
  ) {
    this.c = new ChalkLike(options);
    this.out = out;
    this.err = err;
  }

  printBanner(): void {
    const line = "─".repeat(58);
    this.out(this.c.cyan(`┌${line}┐`));
    this.out(this.c.cyan(`│ `) + this.c.bold("NanoForge Headless CLI Runner") + " ".repeat(29) + this.c.cyan(`│`));
    this.out(this.c.cyan(`└${line}┘`));
  }

  printPlan(plan: ExecutionPlan): void {
    this.out("");
    this.out(this.c.bold(`Goal: `) + this.c.cyan(plan.goal ?? plan.title ?? "Untitled Plan"));
    this.out(this.c.dim(`Plan ID: ${plan.id} | Steps: ${plan.steps.length}`));
    this.out("");

    if (plan.phases && plan.phases.length > 0) {
      const sortedPhases = [...plan.phases].sort((a, b) => a.order - b.order);
      for (const phase of sortedPhases) {
        const stepsInPhase = plan.steps.filter((s) => s.phaseId === phase.id);
        this.out(this.c.bold(this.c.yellow(`Phase: ${phase.title}`)) + this.c.dim(` (${stepsInPhase.length} steps)`));
        if (phase.description) {
          this.out(this.c.dim(`  ${phase.description}`));
        }
        for (const step of stepsInPhase) {
          this.printPlanStep(step);
        }
        this.out("");
      }
      // Steps not in any phase
      const unassigned = plan.steps.filter((s) => !s.phaseId);
      if (unassigned.length > 0) {
        this.out(this.c.bold(`Other Steps:`));
        for (const step of unassigned) {
          this.printPlanStep(step);
        }
      }
    } else {
      this.out(this.c.bold("Steps:"));
      for (const step of plan.steps) {
        this.printPlanStep(step);
      }
    }
    this.out("");
  }

  private printPlanStep(step: ExecutionPlan["steps"][number]): void {
    const approvalBadge = step.approval === "required" ? this.c.yellow(" [APPROVAL REQUIRED]") : "";
    const sideEffectBadge = step.sideEffecting ? this.c.red(" [MUTATING]") : "";
    const deps = step.dependsOn && step.dependsOn.length > 0 ? this.c.dim(` (depends on: ${step.dependsOn.join(", ")})`) : "";
    this.out(`  ${this.c.blue("•")} ${this.c.bold(step.id)}: ${step.title}${approvalBadge}${sideEffectBadge}${deps}`);
    if (step.description) {
      this.out(`    ${this.c.dim(step.description)}`);
    }
  }

  handleEvent(event: RunEvent): void {
    switch (event.type) {
      case "plan.submitted":
        this.out(this.c.blue("▶ ") + this.c.bold("Plan submitted: ") + `${event.goal} (${event.stepCount} steps)`);
        break;

      case "plan.validated":
        if (event.ok) {
          this.out(this.c.green("✔ ") + this.c.dim("Plan DAG validated successfully"));
        } else {
          this.err(this.c.red("✖ ") + this.c.bold("Plan validation failed:"));
          for (const err of event.errors ?? []) {
            this.err(`  ${this.c.red("•")} [${err.code}] ${err.path}: ${err.message}`);
          }
        }
        break;

      case "step.ready":
        this.out("");
        this.out(this.c.cyan("┌── ") + this.c.bold(`Step [${event.stepId}] starting: `) + event.title);
        break;

      case "route.decided":
        this.out(this.c.cyan("│ ") + this.c.dim(`↳ Route: `) + this.c.yellow(event.decision.primary) + (event.decision.reason ? this.c.dim(` (${event.decision.reason})`) : ""));
        break;

      case "route.fallback":
        this.out(this.c.cyan("│ ") + this.c.yellow(`↳ Route fallback: `) + `${event.from} -> ${event.to} (${event.reason})`);
        break;

      case "model.proposal":
        this.out(this.c.cyan("│ ") + this.c.dim(`↳ Proposal: `) + this.c.magenta(event.tool) + this.c.dim(` (${event.argsBytes} bytes)`));
        break;

      case "policy.decision":
        if (event.decision === "allow") {
          this.out(this.c.cyan("│ ") + this.c.green(`↳ Policy: allow `) + this.c.dim(`(${event.tool})`));
        } else if (event.decision === "ask") {
          this.out(this.c.cyan("│ ") + this.c.yellow(`↳ Policy: ask (approval required) `) + this.c.dim(`(${event.tool})`));
        } else {
          this.out(this.c.cyan("│ ") + this.c.red(`↳ Policy: deny `) + this.c.dim(`(${event.tool}: ${event.reason})`));
        }
        break;

      case "approval.requested":
        this.out(this.c.cyan("│ ") + this.c.yellow("⚠ Approval requested: ") + `${event.tool} (Reason: ${event.reason})`);
        break;

      case "approval.granted":
        this.out(this.c.cyan("│ ") + this.c.green("✔ Approval granted"));
        break;

      case "approval.denied":
        this.out(this.c.cyan("│ ") + this.c.red("✖ Approval denied: ") + event.reason);
        break;

      case "tool.started":
        this.out(this.c.cyan("│ ") + this.c.bold("⚙ Executing: ") + `${event.executable} ${event.args.join(" ")}`);
        break;

      case "tool.finished":
        if (event.code === 0 && !event.errorMessage) {
          this.out(this.c.cyan("│ ") + this.c.green("✓ Tool finished ") + this.c.dim(`(exit 0 in ${event.durationMs}ms)`));
        } else {
          this.out(this.c.cyan("│ ") + this.c.red(`✖ Tool exited with code ${event.code}: `) + (event.errorMessage ?? "failed"));
        }
        break;

      case "step.succeeded":
        this.out(this.c.cyan("└── ") + this.c.green("✔ Step completed successfully"));
        break;

      case "step.failed":
        this.out(this.c.cyan("└── ") + this.c.red("✖ Step failed: ") + event.reason);
        break;

      case "step.blocked":
        this.out(this.c.yellow("⊘ ") + this.c.dim(`Step [${event.stepId}] blocked: `) + event.reason);
        break;

      case "run.completed":
        this.out("");
        this.out(this.c.green("═".repeat(60)));
        this.out(this.c.green(this.c.bold("✔ RUN COMPLETED SUCCESSFULLY")) + ` (${event.stepsSucceeded} steps succeeded)`);
        this.out(this.c.green("═".repeat(60)));
        break;

      case "run.failed":
        this.out("");
        this.err(this.c.red("═".repeat(60)));
        this.err(this.c.red(this.c.bold("✖ RUN FAILED")) + `: ${event.reason}`);
        this.err(this.c.red("═".repeat(60)));
        break;

      case "run.halted":
        this.out("");
        this.err(this.c.yellow("═".repeat(60)));
        this.err(this.c.yellow(this.c.bold("⚠ RUN HALTED")) + `: ${event.reason}`);
        this.err(this.c.yellow("═".repeat(60)));
        break;

      case "run.cancelled":
        this.out("");
        this.out(this.c.yellow("═".repeat(60)));
        this.out(this.c.yellow(this.c.bold("⊘ RUN CANCELLED")) + (event.reason ? `: ${event.reason}` : ""));
        this.out(this.c.yellow("═".repeat(60)));
        break;
    }
  }

  printSummary(summary: RunSummary, exitCode: ExitCode, durationMs?: number): void {
    this.out("");
    this.out(this.c.bold("Summary:"));
    this.out(`  ${this.c.bold("Run ID:")}    ${summary.runId}`);
    this.out(`  ${this.c.bold("Status:")}    ${this.formatStatus(summary.status)}`);
    this.out(`  ${this.c.bold("Exit Code:")} ${exitCode} (${exitCodeDescription(exitCode)})`);
    if (summary.reason) {
      this.out(`  ${this.c.bold("Reason:")}    ${summary.reason}`);
    }
    if (durationMs !== undefined) {
      this.out(`  ${this.c.bold("Duration:")}  ${(durationMs / 1000).toFixed(2)}s`);
    }
    this.out("");
  }

  private formatStatus(status: string): string {
    switch (status) {
      case "completed":
        return this.c.green(this.c.bold("COMPLETED"));
      case "failed":
        return this.c.red(this.c.bold("FAILED"));
      case "halted":
        return this.c.yellow(this.c.bold("HALTED"));
      case "cancelled":
        return this.c.gray(this.c.bold("CANCELLED"));
      default:
        return status;
    }
  }

  printError(message: string, code?: ExitCode): void {
    this.err("");
    this.err(this.c.red(this.c.bold("Error: ")) + message);
    if (code !== undefined) {
      this.err(this.c.dim(`Exit Code: ${code} (${exitCodeDescription(code)})`));
    }
    this.err("");
  }
}

/* ------------------------------------------------------------------------ */
/* NDJSON Formatter                                                         */
/* ------------------------------------------------------------------------ */

export class NdjsonFormatter {
  private readonly out: (line: string) => void;

  constructor(out: (line: string) => void = (l) => process.stdout.write(l + "\n")) {
    this.out = out;
  }

  writeEvent(event: unknown): void {
    this.out(JSON.stringify(event));
  }
}

/* ------------------------------------------------------------------------ */
/* JSON Formatter                                                           */
/* ------------------------------------------------------------------------ */

export class JsonFormatter {
  private readonly out: (text: string) => void;

  constructor(out: (text: string) => void = (t) => process.stdout.write(t + "\n")) {
    this.out = out;
  }

  format(data: unknown, pretty = true): void {
    this.out(JSON.stringify(data, null, pretty ? 2 : undefined));
  }
}
