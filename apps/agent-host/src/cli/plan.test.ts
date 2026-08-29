/**
 * Plan Command Integration Tests (`nanoforge plan`).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePlanCommand } from "./plan";
import { EXIT_CODES } from "./types";

describe("executePlanCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nanoforge-plan-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Cleanup best effort
    }
  });

  it("returns Exit Code 5 if goal is missing", async () => {
    const res = await executePlanCommand({ goal: "" });
    expect(res.exitCode).toBe(EXIT_CODES.CONFIG_AUTH);
  });

  it("synthesizes and outputs a valid plan in human format", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const res = await executePlanCommand({ goal: "Optimize database queries" });
    expect(res.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(res.plan).toBeDefined();
    expect(res.plan?.steps.length).toBeGreaterThan(0);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("Optimize database queries"));
    stdoutSpy.mockRestore();
  });

  it("formats plan as JSON when --json is passed", async () => {
    const outputs: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      outputs.push(String(chunk));
      return true;
    });

    const res = await executePlanCommand({ goal: "Refactor auth middleware", json: true });
    expect(res.exitCode).toBe(EXIT_CODES.SUCCESS);
    const combined = outputs.join("");
    const parsed = JSON.parse(combined);
    expect(parsed.goal).toBe("Refactor auth middleware");
    expect(Array.isArray(parsed.steps)).toBe(true);
    stdoutSpy.mockRestore();
  });

  it("writes plan.json and plan.md to output directory", async () => {
    const outDir = path.join(tmpDir, "my-plan");
    const res = await executePlanCommand({ goal: "Deploy staging cluster", output: outDir });
    expect(res.exitCode).toBe(EXIT_CODES.SUCCESS);

    const jsonPath = path.join(outDir, "plan.json");
    const mdPath = path.join(outDir, "plan.md");

    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(mdPath)).toBe(true);

    const planJson = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(planJson.goal).toBe("Deploy staging cluster");

    const planMd = readFileSync(mdPath, "utf8");
    expect(planMd).toContain("# Execution Plan: Deploy staging cluster");
  });

  it("returns Exit Code 6 if input plan JSON has DAG validation errors", async () => {
    const cyclicPlanJson = JSON.stringify({
      id: "bad-plan",
      goal: "Cyclic plan",
      steps: [
        { id: "a", title: "A", status: "pending", dependsOn: ["b"] },
        { id: "b", title: "B", status: "pending", dependsOn: ["a"] },
      ],
    });

    const res = await executePlanCommand({ goal: cyclicPlanJson });
    expect(res.exitCode).toBe(EXIT_CODES.VERIFICATION_FAILED);
  });
});
