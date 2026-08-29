import { useState } from "react";
import {
  Ban, Check, ChevronDown, ChevronRight, Circle, FileCode2, Layers, ListChecks, Pause, ShieldAlert,
  ShieldCheck, Square, X,
} from "lucide-react";
import type { ExecutionPlan, PlanPhase, PlanStep, PlanStepStatus, PlanUIState } from "@/types";

/**
 * Plan inspector & Antigravity-style Visual Planning panel.
 *
 * Controlled component: the plan itself comes from props and every mutation
 * is a callback.
 *
 * Approval gate: a step marked `approval: "required"` can NEVER be treated as
 * runnable from props or chat text alone — the panel records approvals in its
 * own state and only the explicit Approve click sets them. If the parent
 * (or a compromised host stream) marks such a step "running" before the
 * click, the panel downgrades the display back to a blocked/awaiting state
 * instead of rendering it as running.
 */
export interface PlanPanelProps {
  plan: ExecutionPlan;
  className?: string;
  /** Fired only from the explicit Approve button of an approval-required step. */
  onApproveStep: (planId: string, stepId: string) => void;
  /** Batch approval of all approval-required steps in a phase. */
  onApprovePhase?: (planId: string, phaseId: string) => void;
  /** Start/resume execution; disabled until every required approval is granted. */
  onRunApproved: (planId: string) => void;
  onPause: (planId: string) => void;
  onCancel: (planId: string) => void;
}

const STEP_ICON: Record<PlanStepStatus, typeof Circle> = {
  pending: Circle,
  running: ChevronRight,
  succeeded: Check,
  failed: X,
  blocked: Ban,
};

const STEP_ICON_CLASS: Record<PlanStepStatus, string> = {
  pending: "text-muted-foreground",
  running: "pulse-dot text-primary",
  succeeded: "text-emerald-400",
  failed: "text-red-400",
  blocked: "text-amber-400",
};

const STATE_LABEL: Record<PlanUIState, string> = {
  draft: "draft",
  awaiting_approval: "awaiting approval",
  executing: "executing",
  paused: "paused",
  completed: "completed",
};

const DEP_STATUS_CLASS: Record<PlanStepStatus | "unknown", string> = {
  succeeded: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  running: "border-primary/50 bg-primary/10 text-primary",
  failed: "border-red-500/40 bg-red-500/10 text-red-300",
  blocked: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  pending: "border-border bg-secondary/60 text-muted-foreground",
  unknown: "border-border bg-secondary/40 text-muted-foreground/60",
};

function fmtEstimate(step: PlanStep): string | null {
  const e = step.estimate;
  if (!e) return null;
  const parts: string[] = [];
  if (e.tokens != null) parts.push(`~${e.tokens.toLocaleString()} tok`);
  if (e.costUsd != null) parts.push(`≈$${e.costUsd.toFixed(4)}`);
  if (e.durationSec != null) parts.push(`~${e.durationSec}s`);
  return parts.length ? parts.join(" · ") : null;
}

export function PlanPanel({
  plan,
  className,
  onApproveStep,
  onApprovePhase,
  onRunApproved,
  onPause,
  onCancel,
}: PlanPanelProps) {
  // Local approval ledger, keyed to the plan id so a new plan starts clean.
  // Only an explicit button click writes here — never props, never chat text.
  const [approvals, setApprovals] = useState<{ planId: string; stepIds: ReadonlySet<string> }>({
    planId: plan.id,
    stepIds: new Set<string>(),
  });
  const approvedSteps = approvals.planId === plan.id ? approvals.stepIds : new Set<string>();

  // Track expanded/collapsed state of phase accordions (default open)
  const [collapsedPhases, setCollapsedPhases] = useState<Record<string, boolean>>({});

  const togglePhase = (phaseId: string) => {
    setCollapsedPhases((prev) => ({
      ...prev,
      [phaseId]: !prev[phaseId],
    }));
  };

  const isApprovalSatisfied = (step: PlanStep) =>
    step.approval !== "required" || approvedSteps.has(step.id);

  /** Displayed status: unapproved required steps are never shown as running. */
  const effectiveStatus = (step: PlanStep): PlanStepStatus => {
    if (step.approval === "required" && !approvedSteps.has(step.id)) {
      if (step.status === "running") return "blocked";
    }
    return step.status;
  };

  const approve = (stepId: string) => {
    setApprovals((prev) => {
      const base = prev.planId === plan.id ? prev.stepIds : new Set<string>();
      return { planId: plan.id, stepIds: new Set(base).add(stepId) };
    });
    onApproveStep(plan.id, stepId);
  };

  const approvePhase = (phaseId: string) => {
    const phaseSteps = plan.steps.filter((s) => s.phaseId === phaseId);
    const stepsToApprove = phaseSteps.filter(
      (s) => s.approval === "required" && !approvedSteps.has(s.id),
    );
    if (stepsToApprove.length === 0) return;

    setApprovals((prev) => {
      const base = prev.planId === plan.id ? prev.stepIds : new Set<string>();
      const next = new Set(base);
      for (const s of stepsToApprove) {
        next.add(s.id);
      }
      return { planId: plan.id, stepIds: next };
    });

    for (const s of stepsToApprove) {
      onApproveStep(plan.id, s.id);
    }
    onApprovePhase?.(plan.id, phaseId);
  };

  const pendingApprovals = plan.steps.filter((s) => !isApprovalSatisfied(s));
  const allApproved = pendingApprovals.length === 0;
  const canRun = allApproved && plan.state !== "executing" && plan.state !== "completed";
  const canPause = plan.state === "executing";
  const canCancel = plan.state !== "completed";

  const hasPhases = plan.phases && plan.phases.length > 0;
  const sortedPhases = hasPhases
    ? [...plan.phases!].sort((a, b) => a.order - b.order)
    : [];

  const getPhaseStatus = (phaseSteps: PlanStep[]): PlanStepStatus => {
    if (phaseSteps.length === 0) return "pending";
    if (phaseSteps.every((s) => effectiveStatus(s) === "succeeded")) return "succeeded";
    if (phaseSteps.some((s) => effectiveStatus(s) === "failed")) return "failed";
    if (phaseSteps.some((s) => effectiveStatus(s) === "running")) return "running";
    if (phaseSteps.some((s) => effectiveStatus(s) === "blocked")) return "blocked";
    return "pending";
  };

  const renderStepItem = (step: PlanStep, indexDisplay: string | number) => {
    const status = effectiveStatus(step);
    const Icon = STEP_ICON[status];
    const needsApproval = step.approval === "required" && !approvedSteps.has(step.id);
    const estimate = fmtEstimate(step);

    return (
      <li
        key={step.id}
        data-testid={`plan-step-${step.id}`}
        data-status={status}
        className="rounded-md border border-border bg-card/70 px-3 py-2 transition-colors hover:border-border/80"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground/60">{indexDisplay}.</span>
          <Icon className={`h-3.5 w-3.5 ${STEP_ICON_CLASS[status]}`} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground/90 font-medium">{step.title}</span>
          <span className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
            {needsApproval && status === "blocked" ? "awaiting approval" : status}
          </span>
        </div>

        {step.description && (
          <p className="mt-1 pl-7 text-[11.5px] leading-relaxed text-muted-foreground">
            {step.description}
          </p>
        )}

        {/* dependency edges (DAG badges with status styling) */}
        {step.dependsOn.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-7">
            <span className="micro-label normal-case tracking-normal">depends on</span>
            {step.dependsOn.map((dep) => {
              const depStep = plan.steps.find((s) => s.id === dep);
              const depStatus = depStep ? effectiveStatus(depStep) : "unknown";
              return (
                <span
                  key={dep}
                  data-testid={`dep-badge-${dep}`}
                  data-status={depStatus}
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10px] transition-colors ${DEP_STATUS_CLASS[depStatus]}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                  {dep}
                </span>
              );
            })}
          </div>
        )}

        {/* exact affected scopes */}
        {step.affectedScopes && step.affectedScopes.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-7">
            <span className="micro-label normal-case tracking-normal">scopes</span>
            {step.affectedScopes.map((scope) => (
              <span
                key={scope}
                className="rounded border border-primary/25 bg-primary/5 px-1.5 py-px font-mono text-[10px] text-primary/90"
              >
                {scope}
              </span>
            ))}
          </div>
        )}

        {estimate && (
          <div className="mt-1.5 pl-7 font-mono text-[10px] text-muted-foreground">{estimate}</div>
        )}

        {step.sideEffecting && (
          <div className="mt-1 pl-7 font-mono text-[10px] text-amber-400/90 flex items-center gap-1">
            <ShieldAlert className="h-3 w-3" /> side-effecting
          </div>
        )}

        {needsApproval && (
          <div className="mt-2 pl-7 flex items-center gap-2">
            <button
              onClick={() => approve(step.id)}
              aria-label={`Approve step ${step.title}`}
              className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10.5px] text-amber-300 transition-colors hover:bg-amber-500/20 active:scale-[0.98]"
            >
              <ShieldCheck className="h-3 w-3" /> approve
            </button>
            <span className="text-[10px] text-muted-foreground/70">Manual authorization required</span>
          </div>
        )}
        {step.approval === "required" && approvedSteps.has(step.id) && (
          <div className="mt-1.5 flex items-center gap-1 pl-7 font-mono text-[10px] text-emerald-400">
            <ShieldCheck className="h-3 w-3" /> approved
          </div>
        )}

        {step.artifacts && step.artifacts.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 pl-7">
            {step.artifacts.map((a) => (
              <li key={a} className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                <FileCode2 className="h-3 w-3" />
                {a}
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  const renderPhaseAccordion = (phase: PlanPhase) => {
    const phaseSteps = plan.steps.filter((s) => s.phaseId === phase.id);
    const completedCount = phaseSteps.filter((s) => effectiveStatus(s) === "succeeded").length;
    const phaseStatus = getPhaseStatus(phaseSteps);
    const PhaseIcon = STEP_ICON[phaseStatus];
    const isCollapsed = !!collapsedPhases[phase.id];

    const phaseNeedsApproval = phaseSteps.some(
      (s) => s.approval === "required" && !approvedSteps.has(s.id),
    );
    const phaseHasApprovalRequired = phaseSteps.some((s) => s.approval === "required");

    return (
      <div
        key={phase.id}
        data-testid={`plan-phase-${phase.id}`}
        data-status={phaseStatus}
        className="rounded-lg border border-border/80 bg-card/40 overflow-hidden shadow-xs"
      >
        {/* Accordion Header */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => togglePhase(phase.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              togglePhase(phase.id);
            }
          }}
          aria-expanded={!isCollapsed}
          aria-label={`Phase ${phase.order}: ${phase.title}`}
          className="flex flex-col gap-1.5 border-b border-border/60 bg-secondary/20 px-3.5 py-2.5 cursor-pointer hover:bg-secondary/40 transition-colors select-none"
        >
          <div className="flex items-center gap-2">
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
              Phase {phase.order}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
              {phase.title}
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground" data-testid={`phase-counter-${phase.id}`}>
                {completedCount}/{phaseSteps.length} complete
              </span>
              <PhaseIcon className={`h-3.5 w-3.5 ${STEP_ICON_CLASS[phaseStatus]}`} />
            </div>
          </div>

          {phase.description && (
            <p className="text-[11.5px] text-muted-foreground/80 pl-6 leading-normal">
              {phase.description}
            </p>
          )}

          {/* Phase Approval Controls */}
          {phaseNeedsApproval ? (
            <div className="pl-6 pt-1 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => approvePhase(phase.id)}
                aria-label={`Approve phase ${phase.title}`}
                className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/20 active:scale-[0.98]"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Approve Phase
              </button>
              <span className="font-mono text-[10px] text-amber-400/90">Batch authorization available</span>
            </div>
          ) : phaseHasApprovalRequired && (
            <div className="pl-6 pt-1 flex items-center gap-1 font-mono text-[10px] text-emerald-400">
              <ShieldCheck className="h-3 w-3" /> Phase Approved
            </div>
          )}
        </div>

        {/* Phase Step List */}
        {!isCollapsed && (
          <ol className="space-y-2 p-2.5">
            {phaseSteps.map((step, idx) => renderStepItem(step, `${phase.order}.${idx + 1}`))}
            {phaseSteps.length === 0 && (
              <li className="py-2 text-center font-mono text-[11px] text-muted-foreground">
                No steps defined in this phase
              </li>
            )}
          </ol>
        )}
      </div>
    );
  };

  // Steps that don't belong to any declared phase
  const unphasedSteps = hasPhases
    ? plan.steps.filter((s) => !s.phaseId || !plan.phases?.some((p) => p.id === s.phaseId))
    : [];

  return (
    <section
      aria-label="Execution plan"
      className={`flex min-h-0 flex-col border-l border-border bg-card/40 ${className ?? ""}`}
    >
      {/* header */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {hasPhases ? (
            <Layers className="h-3.5 w-3.5 text-primary" />
          ) : (
            <ListChecks className="h-3.5 w-3.5 text-primary" />
          )}
          <span className="micro-label">{hasPhases ? "phased plan" : "plan"}</span>
          <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {STATE_LABEL[plan.state]}
          </span>
          {hasPhases && (
            <span className="rounded border border-primary/25 bg-primary/5 px-1.5 py-0.5 font-mono text-[10px] text-primary">
              {plan.phases!.length} phases · {plan.steps.length} steps
            </span>
          )}
        </div>
        <h2 className="mt-1.5 text-[13px] font-medium leading-snug text-foreground">{plan.goal}</h2>
        {!allApproved && (
          <p className="mt-1 flex items-center gap-1 font-mono text-[10px] text-amber-400">
            <ShieldAlert className="h-3 w-3" />
            {pendingApprovals.length} approval{pendingApprovals.length === 1 ? "" : "s"} required — chat text never counts
          </p>
        )}
      </div>

      {/* steps or phased accordions */}
      <div className="scrollbar-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {hasPhases ? (
          <div className="space-y-3">
            {sortedPhases.map((phase) => renderPhaseAccordion(phase))}
            {unphasedSteps.length > 0 && (
              <div className="rounded-lg border border-border bg-card/30 p-2.5">
                <span className="micro-label mb-2 block">Unassigned Steps</span>
                <ol className="space-y-2">
                  {unphasedSteps.map((step, idx) => renderStepItem(step, idx + 1))}
                </ol>
              </div>
            )}
          </div>
        ) : (
          <ol className="space-y-2">
            {plan.steps.map((step, i) => renderStepItem(step, i + 1))}
          </ol>
        )}
      </div>

      {/* controls */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2.5 bg-card/60">
        <button
          onClick={() => onRunApproved(plan.id)}
          disabled={!canRun}
          title={allApproved ? "Run the approved plan" : "Approve every required step first"}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-mono text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30 active:scale-[0.98]"
        >
          <ChevronRight className="h-3 w-3" /> run
        </button>
        <button
          onClick={() => onPause(plan.id)}
          disabled={!canPause}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-[11px] text-foreground/80 transition-colors hover:border-primary/40 disabled:opacity-30 active:scale-[0.98]"
        >
          <Pause className="h-3 w-3" /> pause
        </button>
        <button
          onClick={() => onCancel(plan.id)}
          disabled={!canCancel}
          className="flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/15 px-3 py-1.5 font-mono text-[11px] text-red-300 transition-colors hover:bg-destructive/25 disabled:opacity-30 active:scale-[0.98]"
        >
          <Square className="h-3 w-3" /> cancel
        </button>
      </div>
    </section>
  );
}
