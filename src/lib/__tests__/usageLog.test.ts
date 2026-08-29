import { describe, expect, it } from "vitest";
import type { UsageRun } from "@/types";
import { appendRun, DEFAULT_RUN_CAP, dayKey, runsByDay, runsByModel } from "@/lib/usageLog";

function makeRun(partial: Partial<UsageRun> = {}): UsageRun {
  return {
    id: "r1",
    ts: new Date(2025, 5, 10, 12, 0, 0).getTime(), // 2025-06-10 local noon
    modelId: "gpt-nano",
    input: 100,
    output: 50,
    costUsd: 0.001,
    ...partial,
  };
}

describe("appendRun", () => {
  it("appends and returns a new array without mutating the input", () => {
    const runs = [makeRun({ id: "a" })];
    const next = appendRun(runs, makeRun({ id: "b" }));
    expect(next).toHaveLength(2);
    expect(next.map((r) => r.id)).toEqual(["a", "b"]);
    expect(next).not.toBe(runs);
    expect(runs).toHaveLength(1); // input untouched
  });

  it("keeps at most cap records, dropping the oldest", () => {
    let runs: UsageRun[] = [];
    for (let i = 0; i < 5; i++) runs = appendRun(runs, makeRun({ id: `r${i}` }), 3);
    expect(runs.map((r) => r.id)).toEqual(["r2", "r3", "r4"]);
  });

  it("allows growth up to the cap exactly", () => {
    let runs: UsageRun[] = [];
    for (let i = 0; i < 3; i++) runs = appendRun(runs, makeRun({ id: `r${i}` }), 3);
    expect(runs).toHaveLength(3);
  });

  it("defaults to DEFAULT_RUN_CAP (500)", () => {
    expect(DEFAULT_RUN_CAP).toBe(500);
    const big: UsageRun[] = Array.from({ length: 500 }, (_, i) => makeRun({ id: `r${i}` }));
    const next = appendRun(big, makeRun({ id: "new" }));
    expect(next).toHaveLength(500);
    expect(next[0].id).toBe("r1"); // oldest dropped
    expect(next[next.length - 1].id).toBe("new");
  });
});

describe("runsByModel", () => {
  it("aggregates cost, tokens and requests per modelId", () => {
    const runs = [
      makeRun({ id: "1", modelId: "a", input: 100, output: 10, costUsd: 0.01 }),
      makeRun({ id: "2", modelId: "b", input: 200, output: 20, costUsd: 0.02 }),
      makeRun({ id: "3", modelId: "a", input: 300, output: 30, costUsd: 0.03 }),
    ];
    const byModel = runsByModel(runs);
    expect(Object.keys(byModel).sort()).toEqual(["a", "b"]);
    expect(byModel.a).toEqual({ input: 400, output: 40, costUsd: 0.04, requests: 2, runs: 2 });
    expect(byModel.b).toEqual({ input: 200, output: 20, costUsd: 0.02, requests: 1, runs: 1 });
  });

  it("records errored runs but does not count them as requests", () => {
    const runs = [
      makeRun({ id: "1", modelId: "a" }),
      makeRun({ id: "2", modelId: "a", errored: true, input: 5, output: 0, costUsd: 0.0001 }),
    ];
    const agg = runsByModel(runs).a;
    expect(agg.requests).toBe(1); // only the completed run
    expect(agg.runs).toBe(2); // errored run still recorded
    expect(agg.input).toBe(105); // tokens still aggregate
    expect(agg.costUsd).toBeCloseTo(0.0011);
  });

  it("returns an empty object for no runs", () => {
    expect(runsByModel([])).toEqual({});
  });
});

describe("runsByDay", () => {
  it("aggregates runs per YYYY-MM-DD day key", () => {
    const runs = [
      makeRun({ id: "1", ts: new Date(2025, 5, 10, 9, 0, 0).getTime(), costUsd: 0.01 }),
      makeRun({ id: "2", ts: new Date(2025, 5, 10, 22, 30, 0).getTime(), costUsd: 0.02 }),
      makeRun({ id: "3", ts: new Date(2025, 5, 11, 0, 30, 0).getTime(), costUsd: 0.04 }),
    ];
    const byDay = runsByDay(runs);
    expect(Object.keys(byDay).sort()).toEqual(["2025-06-10", "2025-06-11"]);
    expect(byDay["2025-06-10"].costUsd).toBeCloseTo(0.03);
    expect(byDay["2025-06-10"].requests).toBe(2);
    expect(byDay["2025-06-11"].costUsd).toBeCloseTo(0.04);
    expect(byDay["2025-06-11"].runs).toBe(1);
  });

  it("zero-pads month and day in the key", () => {
    expect(dayKey(new Date(2025, 0, 5, 12).getTime())).toBe("2025-01-05");
  });

  it("excludes errored runs from requests but keeps their tokens/cost", () => {
    const runs = [
      makeRun({ id: "1", errored: true, input: 7 }),
      makeRun({ id: "2" }),
    ];
    const agg = runsByDay(runs)["2025-06-10"];
    expect(agg.requests).toBe(1);
    expect(agg.runs).toBe(2);
    expect(agg.input).toBe(107);
  });

  it("returns an empty object for no runs", () => {
    expect(runsByDay([])).toEqual({});
  });
});
