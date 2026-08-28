import type { UsageRun } from "@/types";

/**
 * Per-run usage log (final roadmap phase: cost dashboard).
 *
 * `src/lib/usage.ts` maintains the AGGREGATE `UsageTotals`; this module keeps
 * the per-run records those totals are folded from, so the dashboard can
 * break cost down by model and by day. All helpers are pure — inputs are
 * never mutated and fresh objects/arrays are returned.
 *
 * Counting rule (mirrors `applyRunUsage`): an errored run is recorded for
 * audit — its tokens/cost still aggregate — but it is NOT counted in
 * `requests`, because it never completed a billable request.
 */

/** Default maximum number of retained run records (oldest are dropped). */
export const DEFAULT_RUN_CAP = 500;

/**
 * Appends `run` to the log, keeping at most `cap` records by dropping the
 * oldest. Returns a new array; the input is not mutated.
 */
export function appendRun(runs: UsageRun[], run: UsageRun, cap: number = DEFAULT_RUN_CAP): UsageRun[] {
  const next = [...runs, run];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/** Aggregate view over a set of runs (per model or per day). */
export interface UsageAggregate {
  input: number;
  output: number;
  costUsd: number;
  /** Completed (non-errored) runs — billable requests. */
  requests: number;
  /** Total recorded runs, errored ones included. */
  runs: number;
}

function emptyAggregate(): UsageAggregate {
  return { input: 0, output: 0, costUsd: 0, requests: 0, runs: 0 };
}

function fold(bucket: UsageAggregate, run: UsageRun): void {
  bucket.input += run.input;
  bucket.output += run.output;
  bucket.costUsd += run.costUsd;
  bucket.runs += 1;
  if (!run.errored) bucket.requests += 1;
}

/**
 * Aggregates runs per `modelId`. Keys appear in first-seen order.
 * Errored runs contribute tokens/cost but not `requests`.
 */
export function runsByModel(runs: UsageRun[]): Record<string, UsageAggregate> {
  const byModel: Record<string, UsageAggregate> = {};
  for (const run of runs) {
    const bucket = (byModel[run.modelId] ??= emptyAggregate());
    fold(bucket, run);
  }
  return byModel;
}

/**
 * Local-calendar day key (`YYYY-MM-DD`) for a run timestamp. Local time is
 * used deliberately: the dashboard is a single-user local tool, so days
 * should line up with the user's own calendar.
 */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Aggregates runs per local-calendar day (`YYYY-MM-DD`). Keys appear in
 * first-seen order; sort the keys if the dashboard needs chronological
 * order. Errored runs contribute tokens/cost but not `requests`.
 */
export function runsByDay(runs: UsageRun[]): Record<string, UsageAggregate> {
  const byDay: Record<string, UsageAggregate> = {};
  for (const run of runs) {
    const bucket = (byDay[dayKey(run.ts)] ??= emptyAggregate());
    fold(bucket, run);
  }
  return byDay;
}
