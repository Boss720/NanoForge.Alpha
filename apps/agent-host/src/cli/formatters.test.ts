/**
 * CLI Formatters Unit Tests.
 */

import { describe, expect, it } from "vitest";
import type { ExecutionPlan } from "@protocol/plan";
import type { RunEvent } from "../runs/events";
import { ChalkLike, HumanFormatter, JsonFormatter, NdjsonFormatter } from "./formatters";
import { EXIT_CODES } from "./types";

describe("ChalkLike", () => {
  it("applies ANSI codes when colors are enabled", () => {
    const chalk = new ChalkLike({ noColor: false });
    expect(chalk.green("ok")).toContain("\x1b[32m");
    expect(chalk.bold("title")).toContain("\x1b[1m");
    expect(chalk.red("error")).toContain("\x1b[31m");
  });

  it("strips ANSI codes when noColor is true", () => {
    const chalk = new ChalkLike({ noColor: true });
    expect(chalk.green("ok")).toBe("ok");
    expect(chalk.bold("title")).toBe("title");
    expect(chalk.red("error")).toBe("error");
  });
});

describe("HumanFormatter", () => {
  const samplePlan: ExecutionPlan = {
    id: "plan-1",
    goal: "Deploy web service",
    phases: [
      { id: "p1", title: "Build Phase", order: 0 },
    ],
    steps: [
      {
        id: "s1",
        title: "Compile sources",
        phaseId: "p1",
        status: "pending",
        dependsOn: [],
        sideEffecting: true,
        approval: "required",
      },
    ],
  };

  it("prints banner and plan structure without error", () => {
    const output: string[] = [];
    const human = new HumanFormatter({ noColor: true }, (msg) => output.push(msg));

    human.printBanner();
    human.printPlan(samplePlan);

    const fullOutput = output.join("\n");
    expect(fullOutput).toContain("NanoForge Headless CLI Runner");
    expect(fullOutput).toContain("Deploy web service");
    expect(fullOutput).toContain("Build Phase");
    expect(fullOutput).toContain("Compile sources");
    expect(fullOutput).toContain("[APPROVAL REQUIRED]");
  });

  it("formats all lifecycle run events", () => {
    const output: string[] = [];
    const errOutput: string[] = [];
    const human = new HumanFormatter(
      { noColor: true },
      (msg) => output.push(msg),
      (msg) => errOutput.push(msg),
    );

    const events: RunEvent[] = [
      {
        seq: 1,
        runId: "r1",
        at: "2026-08-15T00:00:00.000Z",
        type: "plan.submitted",
        planId: "p1",
        goal: "Test run",
        stepCount: 1,
        steps: [{ id: "s1", title: "Step 1", dependsOn: [] }],
      },
      {
        seq: 2,
        runId: "r1",
        at: "2026-08-15T00:00:01.000Z",
        type: "plan.validated",
        planId: "p1",
        ok: true,
      },
      {
        seq: 3,
        runId: "r1",
        at: "2026-08-15T00:00:02.000Z",
        type: "step.ready",
        stepId: "s1",
        title: "Step 1",
      },
      {
        seq: 4,
        runId: "r1",
        at: "2026-08-15T00:00:03.000Z",
        type: "policy.decision",
        stepId: "s1",
        tool: "terminal.exec",
        decision: "allow",
        reason: "whitelisted read-only",
      },
      {
        seq: 5,
        runId: "r1",
        at: "2026-08-15T00:00:04.000Z",
        type: "tool.started",
        stepId: "s1",
        jobId: "j1",
        tool: "terminal.exec",
        executable: "git",
        args: ["status"],
        cwd: ".",
      },
      {
        seq: 6,
        runId: "r1",
        at: "2026-08-15T00:00:05.000Z",
        type: "tool.finished",
        stepId: "s1",
        jobId: "j1",
        code: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
        truncated: false,
        durationMs: 12,
      },
      {
        seq: 7,
        runId: "r1",
        at: "2026-08-15T00:00:06.000Z",
        type: "step.succeeded",
        stepId: "s1",
      },
      {
        seq: 8,
        runId: "r1",
        at: "2026-08-15T00:00:07.000Z",
        type: "run.completed",
        stepsSucceeded: 1,
      },
    ];

    for (const ev of events) {
      human.handleEvent(ev);
    }

    const text = output.join("\n");
    expect(text).toContain("Plan submitted: Test run");
    expect(text).toContain("Plan DAG validated successfully");
    expect(text).toContain("Step [s1] starting");
    expect(text).toContain("Policy: allow");
    expect(text).toContain("Executing: git status");
    expect(text).toContain("Tool finished (exit 0 in 12ms)");
    expect(text).toContain("Step completed successfully");
    expect(text).toContain("RUN COMPLETED SUCCESSFULLY");
  });

  it("prints summary box with exit code and duration", () => {
    const output: string[] = [];
    const human = new HumanFormatter({ noColor: true }, (msg) => output.push(msg));

    human.printSummary({ runId: "r-999", status: "completed" }, EXIT_CODES.SUCCESS, 1500);

    const text = output.join("\n");
    expect(text).toContain("Summary:");
    expect(text).toContain("Run ID:    r-999");
    expect(text).toContain("Status:    COMPLETED");
    expect(text).toContain("Exit Code: 0 (Success)");
    expect(text).toContain("Duration:  1.50s");
  });
});

describe("NdjsonFormatter", () => {
  it("emits valid single-line JSON objects", () => {
    const lines: string[] = [];
    const formatter = new NdjsonFormatter((l) => lines.push(l));

    formatter.writeEvent({ type: "run.state", state: "running", at: "2026-08-15" });
    formatter.writeEvent({ type: "step.ready", stepId: "s1" });

    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0])).toEqual({ type: "run.state", state: "running", at: "2026-08-15" });
    expect(JSON.parse(lines[1])).toEqual({ type: "step.ready", stepId: "s1" });
  });
});

describe("JsonFormatter", () => {
  it("formats pretty JSON data", () => {
    const output: string[] = [];
    const formatter = new JsonFormatter((t) => output.push(t));

    formatter.format({ ok: true, count: 42 });
    expect(output.length).toBe(1);
    expect(JSON.parse(output[0])).toEqual({ ok: true, count: 42 });
  });
});
