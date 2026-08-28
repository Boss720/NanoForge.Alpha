import type { NanoModel, UsageTotals } from "@/types";

/**
 * Usage accounting helpers (roadmap Task 0.3).
 *
 * Extracted from App.tsx `finishRun` so the request-counting rule is unit
 * testable: a run that errored still accrues whatever token/cost figures it
 * reported (usually zero), but must NOT increment `requests` — it never
 * completed a billable request.
 */

export interface RunUsage {
  input: number;
  output: number;
  costUsd: number;
}

/** USD cost of a run under the given model's per-1M-token pricing. */
export function runCost(model: NanoModel | undefined, input: number, output: number): number {
  return model ? (input / 1e6) * model.inputPrice + (output / 1e6) * model.outputPrice : 0;
}

/**
 * Fold one finished run into the cumulative totals. Errored runs add their
 * (typically zero) tokens/cost but do not count as a completed request.
 * Pure — returns a new object.
 */
export function applyRunUsage(totals: UsageTotals, run: RunUsage, opts?: { errored?: boolean }): UsageTotals {
  return {
    input: totals.input + run.input,
    output: totals.output + run.output,
    costUsd: totals.costUsd + run.costUsd,
    requests: totals.requests + (opts?.errored ? 0 : 1),
  };
}
