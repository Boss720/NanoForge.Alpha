import { ArrowDown, GitBranch, Pin, PinOff, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Agent platform — Module 5, Task 17 (UI half).
 *
 * Explainable routing view: which model was selected, the ordered fallback
 * chain, the human-readable reason, the cost estimate, and whether the choice
 * is user-pinned or automatic.
 *
 * Fallback policy (Task 17): switching to a fallback model requires explicit
 * user approval UNLESS that fallback was pre-approved in the execution plan.
 * The card is controlled — `pendingFallback` + `preApprovedFallbacks` in,
 * approve/reject callbacks out; it holds no routing state of its own.
 */

export interface RouteDecision {
  /** Selected (primary) model id. */
  primary: string;
  /** Ordered fallback model ids; index 0 is tried first. */
  fallbacks: string[];
  /** Estimated cost of the routed run, USD. */
  estimatedCostUsd: number;
  /** Human-readable explanation of the routing choice. */
  reason: string;
  /** true when the user pinned the model (pin overrides routing). */
  pinned: boolean;
}

export interface RouteDecisionCardProps {
  decision: RouteDecision;
  /**
   * Fallback model the router wants to switch to right now (primary failed /
   * over budget / outage). null/undefined = primary active, nothing pending.
   */
  pendingFallback?: string | null;
  /** Model ids explicitly pre-approved as fallbacks in the execution plan. */
  preApprovedFallbacks?: string[];
  onApproveFallback?: (modelId: string) => void;
  onRejectFallback?: (modelId: string) => void;
  className?: string;
}

export function RouteDecisionCard({
  decision,
  pendingFallback = null,
  preApprovedFallbacks = [],
  onApproveFallback,
  onRejectFallback,
  className,
}: RouteDecisionCardProps) {
  const fallbackPreApproved =
    pendingFallback !== null && preApprovedFallbacks.includes(pendingFallback);
  const approvalRequired = pendingFallback !== null && !fallbackPreApproved;

  return (
    <section
      aria-label="Route decision"
      className={cn("rounded-md border border-border bg-card", className)}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <GitBranch className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[11px] font-semibold tracking-wide text-foreground">
          route decision
        </span>
        <div className="flex-1" />
        {decision.pinned ? (
          <span className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[9.5px] text-primary">
            <Pin className="h-2.5 w-2.5" /> pinned
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
            <PinOff className="h-2.5 w-2.5" /> automatic
          </span>
        )}
      </div>

      <div className="space-y-2.5 px-3 py-2.5">
        {/* selected model + estimate */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-mono text-[12.5px] text-foreground" title={decision.primary}>
            {decision.primary}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
            est. ${decision.estimatedCostUsd.toFixed(4)}
          </span>
        </div>

        {/* human-readable reason */}
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">{decision.reason}</p>

        {/* ordered fallback chain */}
        {decision.fallbacks.length > 0 && (
          <div>
            <div className="micro-label mb-1">fallbacks (in order)</div>
            <ol className="space-y-0.5">
              {decision.fallbacks.map((f, i) => {
                const isPending = f === pendingFallback;
                return (
                  <li
                    key={f}
                    className={cn(
                      "flex items-center gap-1.5 rounded px-1.5 py-1 font-mono text-[11px]",
                      isPending
                        ? "border border-amber-500/40 bg-amber-500/10 text-amber-200"
                        : "text-muted-foreground",
                    )}
                  >
                    <span className="w-4 shrink-0 text-right text-[10px]">{i + 1}.</span>
                    <span className="truncate" title={f}>
                      {f}
                    </span>
                    {isPending && <ArrowDown className="ml-auto h-3 w-3 shrink-0" />}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* fallback gate: approval required unless pre-approved by the plan */}
        {pendingFallback !== null && approvalRequired && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
            <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-amber-200">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Switch to fallback <span className="font-mono">{pendingFallback}</span>? The execution
              plan did not pre-approve this fallback — your approval is required.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => onRejectFallback?.(pendingFallback)}
                className="rounded-md border border-destructive/50 px-2.5 py-1 font-mono text-[10.5px] text-red-300 hover:bg-destructive/10"
              >
                reject
              </button>
              <div className="flex-1" />
              <button
                onClick={() => onApproveFallback?.(pendingFallback)}
                className="rounded-md bg-amber-500 px-2.5 py-1 font-mono text-[10.5px] font-semibold text-black hover:opacity-90"
              >
                approve fallback
              </button>
            </div>
          </div>
        )}

        {pendingFallback !== null && fallbackPreApproved && (
          <p className="flex items-start gap-1.5 rounded-md border border-border bg-secondary/30 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            Fallback to <span className="font-mono text-foreground">{pendingFallback}</span> was
            pre-approved in the execution plan — switching automatically.
          </p>
        )}
      </div>
    </section>
  );
}
