import { useMemo, useState } from "react";
import { Check, ExternalLink, Search } from "lucide-react";
import type { NanoModel } from "@/types";
import { cn } from "@/lib/utils";
import { RouteDecisionCard, type RouteDecisionCardProps } from "./RouteDecisionCard";

interface Props {
  models: NanoModel[];
  selected: string;
  onSelect: (id: string) => void;
  live: boolean;
  /**
   * Agent platform (Task 17): optional route decision view. Omit entirely
   * when no local host/router is active — the panel is unchanged without it.
   */
  routeDecision?: RouteDecisionCardProps;
  /** Layout overrides — e.g. `hidden lg:flex` inline, `h-full w-full border-l-0` in a drawer. */
  className?: string;
}

export function ModelPanel({ models, selected, onSelect, live, routeDecision, className }: Props) {
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState<string>("all");

  const providers = useMemo(() => ["all", ...Array.from(new Set(models.map((m) => m.provider))).sort()], [models]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return models.filter(
      (m) =>
        (provider === "all" || m.provider === provider) &&
        (!needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle)),
    );
  }, [models, q, provider]);

  return (
    <aside className={cn("flex w-72 shrink-0 flex-col border-l border-border bg-card/50", className)}>
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="micro-label">Model catalog</span>
        <span className={`font-mono text-[10px] ${live ? "text-emerald-400" : "text-muted-foreground"}`}>
          {live ? "● live /api/v1/models" : "○ offline snapshot"}
        </span>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-md border border-input bg-secondary/40 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search the model catalog…"
            className="w-full bg-transparent font-mono text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      {/* Task 17: surfaced only while a host/router route decision exists. */}
      {routeDecision && (
        <div className="px-2 pb-2">
          <RouteDecisionCard {...routeDecision} />
        </div>
      )}

      <div className="scrollbar-thin flex gap-1 overflow-x-auto px-3 pb-2">
        {providers.map((p) => (
          <button
            key={p}
            onClick={() => setProvider(p)}
            className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
              provider === p
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {filtered.map((m) => {
          const active = m.id === selected;
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                active ? "border-primary/60 bg-primary/10" : "border-transparent hover:border-border hover:bg-accent/40"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`font-mono text-[12px] ${active ? "text-primary" : "text-foreground"}`}>{m.name}</span>
                {active && <Check className="h-3 w-3 text-primary" />}
                <div className="flex-1" />
                <span className="micro-label">{m.provider}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                <span title={m.priceEstimated ? "estimated pricing" : undefined}>
                  {m.priceEstimated ? "~" : ""}${m.inputPrice.toFixed(2)} in · ${m.outputPrice.toFixed(2)} out /1M
                </span>
                <span>·</span>
                <span>{m.contextK}k ctx</span>
              </div>
              {m.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.tags.map((t) => (
                    <span key={t} className="rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-2 py-6 text-center font-mono text-[11px] text-muted-foreground">no models match</div>
        )}
      </div>

      <div className="border-t border-border px-3 py-2.5">
        <a
          href="https://nano-gpt.com/models"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-primary"
        >
          <ExternalLink className="h-3 w-3" />
          full catalog + pricing on nano-gpt.com
        </a>
      </div>
    </aside>
  );
}
