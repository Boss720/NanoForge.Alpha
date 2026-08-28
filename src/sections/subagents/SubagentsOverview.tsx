import { Activity, CheckCircle2, CircleAlert, Eye, Focus, Pause } from "lucide-react";
import type { SubagentInfo } from "@protocol/subagents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
}

export interface SubagentsOverviewProps {
  subagents: SubagentInfo[];
  activeSubagentId: string | null;
  onFocusAgent: (id: string) => void;
  onInspectAgent: (id: string) => void;
}

function stateLabel(state: SubagentInfo["state"]): string {
  return state.replaceAll("_", " ");
}

function stateIcon(state: SubagentInfo["state"]): typeof Activity {
  if (state === "errored") return CircleAlert;
  if (state === "idle" || state === "completed") return CheckCircle2;
  if (state.startsWith("waiting")) return Pause;
  return Activity;
}

function getProgress(agent: SubagentInfo): number | null {
  const budget = (agent as SubagentInfo & { budgetTokens?: number }).budgetTokens;
  if (!budget || budget <= 0) return null;
  return Math.min(100, Math.round((agent.tokensUsed / budget) * 100));
}

export function SubagentsOverview({
  subagents,
  activeSubagentId,
  onFocusAgent,
  onInspectAgent,
}: SubagentsOverviewProps) {
  const running = subagents.filter((agent) => agent.state === "running").length;
  const waiting = subagents.filter((agent) => agent.state.startsWith("waiting")).length;
  const errored = subagents.filter((agent) => agent.state === "errored").length;
  const active = subagents.find((agent) => agent.id === activeSubagentId) ?? subagents[0];

  return (
    <section data-testid="subagents-overview" className="border-b border-border bg-background/40 px-3 py-2.5 font-mono">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground">Mission overview</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {subagents.length === 0 ? "No agents launched yet" : `${running} running · ${waiting} waiting · ${errored} attention`}
          </p>
        </div>
        {active && (
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onFocusAgent(active.id)} data-testid="focus-active-agent">
              <Focus className="mr-1 h-3 w-3" /> Focus
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onInspectAgent(active.id)} data-testid="inspect-active-agent">
              <Eye className="mr-1 h-3 w-3" /> Inspect
            </Button>
          </div>
        )}
      </div>

      {active && (
        <div className="mt-2 rounded border border-border/60 bg-card/60 p-2" data-testid="active-agent-summary">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {(() => { const Icon = stateIcon(active.state); return <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />; })()}
              <span className="truncate text-[11px] font-semibold text-foreground">{active.name}</span>
              <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[9px]">{stateLabel(active.state)}</Badge>
            </div>
            <span className="shrink-0 text-[9px] text-muted-foreground">{formatTokens(active.tokensUsed)} tokens</span>
          </div>
          {getProgress(active) !== null && (
            <div className="mt-1.5" aria-label={`${getProgress(active)}% token budget used`}>
              <div className="mb-0.5 flex justify-between text-[9px] text-muted-foreground"><span>Budget progress</span><span>{getProgress(active)}%</span></div>
              <div className="h-1 overflow-hidden rounded bg-secondary"><div className="h-full bg-primary" style={{ width: `${getProgress(active)}%` }} /></div>
            </div>
          )}
          {active.lastProgressSummary && <p className="mt-1 truncate text-[9px] text-muted-foreground">{active.lastProgressSummary}</p>}
        </div>
      )}
    </section>
  );
}
