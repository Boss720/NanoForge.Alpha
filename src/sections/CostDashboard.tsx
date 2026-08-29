import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { NanoModel, UsageRun, UsageTotals } from "@/types";
import { runsByDay, runsByModel } from "@/lib/usageLog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/**
 * Final roadmap phase: cost dashboard.
 *
 * Data flow: App records one `UsageRun` per finished run (src/lib/usageLog.ts)
 * and persists the log alongside the aggregate `UsageTotals`. This dialog is a
 * pure read view over those two props:
 *   - per-model spend bar chart  (runsByModel, top 12 by cost)
 *   - daily spend area chart     (runsByDay, chronological keys)
 *   - summary row                (lifetime aggregate `usage` + run count)
 *
 * Colors come from the shadcn chart wrapper's config → CSS variables, which
 * reference theme tokens only (`--primary`) — no hardcoded hex.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runs: UsageRun[];
  /** Live/fallback model catalog — used to resolve modelId → display name. */
  models: NanoModel[];
  usage: UsageTotals;
}

/** Cap on bars so the per-model chart stays readable with many models. */
const MAX_MODEL_BARS = 12;

const chartConfig = {
  costUsd: { label: "Cost", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

const costFormatter = (value: unknown, name: unknown) => (
  <div className="flex w-full min-w-[8rem] items-center justify-between gap-4">
    <span className="text-muted-foreground">{name === "costUsd" ? "cost" : String(name)}</span>
    <span className="font-mono font-medium text-foreground">${Number(value).toFixed(4)}</span>
  </div>
);

export function CostDashboard({ open, onOpenChange, runs, models, usage }: Props) {
  const byModel = useMemo(() => {
    const nameOf = (id: string) => models.find((m) => m.id === id)?.name ?? id;
    const agg = runsByModel(runs);
    return Object.entries(agg)
      .map(([id, a]) => ({ model: nameOf(id), costUsd: a.costUsd, requests: a.requests }))
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, MAX_MODEL_BARS);
  }, [runs, models]);

  const byDay = useMemo(() => {
    const agg = runsByDay(runs);
    // Keys are YYYY-MM-DD so plain string sort is chronological; label M-D.
    return Object.keys(agg)
      .sort()
      .map((day) => ({ day: day.slice(5), costUsd: agg[day].costUsd }));
  }, [runs]);

  const erroredRuns = useMemo(() => runs.filter((r) => r.errored).length, [runs]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-[13px] tracking-wide">
            <BarChart3 className="h-4 w-4 text-primary" /> Cost dashboard
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">
            per-run usage recorded locally · capped at 500 runs
          </DialogDescription>
        </DialogHeader>

        {/* summary row — lifetime aggregate */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="total spend" value={`$${usage.costUsd.toFixed(4)}`} accent />
          <Stat label="requests" value={String(usage.requests)} />
          <Stat label="tokens" value={fmt(usage.input + usage.output)} />
          <Stat
            label="runs logged"
            value={String(runs.length)}
            hint={erroredRuns > 0 ? `${erroredRuns} errored` : undefined}
          />
        </div>

        {runs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-10 text-center">
            <BarChart3 className="h-6 w-6 text-muted-foreground/50" />
            <p className="font-mono text-[12px] text-muted-foreground">no runs logged yet</p>
            <p className="max-w-sm text-[11.5px] leading-relaxed text-muted-foreground/80">
              Send a prompt and each finished run is recorded here — spend per model and per day.
            </p>
          </div>
        ) : (
          <div className="scrollbar-thin max-h-[55vh] space-y-5 overflow-y-auto pr-1">
            {/* per-model spend */}
            <section>
              <div className="micro-label mb-2">spend by model (top {Math.min(byModel.length, MAX_MODEL_BARS)})</div>
              <ChartContainer config={chartConfig} className="h-[220px] w-full">
                <BarChart data={byModel} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                  <YAxis
                    type="category"
                    dataKey="model"
                    width={132}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10 }}
                  />
                  <ChartTooltip content={<ChartTooltipContent formatter={costFormatter} />} />
                  <Bar dataKey="costUsd" fill="var(--color-costUsd)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ChartContainer>
            </section>

            {/* daily spend trend */}
            <section>
              <div className="micro-label mb-2">daily spend</div>
              <ChartContainer config={chartConfig} className="h-[180px] w-full">
                <AreaChart data={byDay} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
                  <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `$${v}`} tick={{ fontSize: 10 }} />
                  <ChartTooltip content={<ChartTooltipContent formatter={costFormatter} />} />
                  <Area
                    type="monotone"
                    dataKey="costUsd"
                    stroke="var(--color-costUsd)"
                    fill="var(--color-costUsd)"
                    fillOpacity={0.18}
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ChartContainer>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
      <div className="micro-label">{label}</div>
      <div className={`mt-1 font-mono text-[14px] font-semibold ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
      {hint && <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
