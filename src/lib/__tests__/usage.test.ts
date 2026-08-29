import { describe, expect, it } from "vitest";
import type { NanoModel, UsageTotals } from "@/types";
import { applyRunUsage, runCost } from "@/lib/usage";

const MODEL: NanoModel = {
  id: "kimi-k2-0905",
  name: "Kimi K2 0905",
  provider: "Moonshot",
  inputPrice: 0.6,
  outputPrice: 2.5,
  contextK: 256,
  tags: [],
};

const ZERO: UsageTotals = { input: 0, output: 0, costUsd: 0, requests: 0 };

describe("runCost", () => {
  it("prices per 1M tokens", () => {
    expect(runCost(MODEL, 1_000_000, 1_000_000)).toBeCloseTo(3.1);
    expect(runCost(MODEL, 500, 250)).toBeCloseTo((500 / 1e6) * 0.6 + (250 / 1e6) * 2.5);
  });

  it("returns 0 when no model is selected", () => {
    expect(runCost(undefined, 1234, 5678)).toBe(0);
  });
});

describe("applyRunUsage", () => {
  it("accumulates tokens, cost, and one request on success", () => {
    const next = applyRunUsage(ZERO, { input: 1000, output: 200, costUsd: 0.001 });
    expect(next).toEqual({ input: 1000, output: 200, costUsd: 0.001, requests: 1 });
  });

  it("does NOT increment requests for an errored run (defect #2)", () => {
    const next = applyRunUsage(ZERO, { input: 0, output: 0, costUsd: 0 }, { errored: true });
    expect(next.requests).toBe(0);
    expect(next.input).toBe(0);
    expect(next.output).toBe(0);
  });

  it("errored runs still fold in any reported usage without counting a request", () => {
    const base: UsageTotals = { input: 10, output: 5, costUsd: 0.0001, requests: 3 };
    const next = applyRunUsage(base, { input: 100, output: 50, costUsd: 0.001 }, { errored: true });
    expect(next).toEqual({ input: 110, output: 55, costUsd: 0.0011, requests: 3 });
  });

  it("accumulates across multiple successful runs", () => {
    let u = ZERO;
    u = applyRunUsage(u, { input: 100, output: 10, costUsd: 0.001 });
    u = applyRunUsage(u, { input: 200, output: 20, costUsd: 0.002 });
    expect(u.requests).toBe(2);
    expect(u.input).toBe(300);
    expect(u.costUsd).toBeCloseTo(0.003);
  });

  it("does not mutate its input", () => {
    const base: UsageTotals = { input: 1, output: 2, costUsd: 3, requests: 4 };
    applyRunUsage(base, { input: 5, output: 6, costUsd: 7 });
    expect(base).toEqual({ input: 1, output: 2, costUsd: 3, requests: 4 });
  });
});
