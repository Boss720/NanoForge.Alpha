import { useEffect, useRef } from "react";
import { FilePenLine, ShieldCheck, Clock3, Hash, Layers3 } from "lucide-react";
import type { CapabilityApprovalRequiredMessage } from "@/lib/hostClient";

export interface CapabilityApprovalDialogProps {
  request: CapabilityApprovalRequiredMessage | null;
  onDecide: (requestId: string, approved: boolean) => void;
}

/** A per-action approval surface for host-issued capability grants. */
export function CapabilityApprovalDialog({ request, onDecide }: CapabilityApprovalDialogProps) {
  const approveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    approveRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDecide(request.requestId, false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [request, onDecide]);

  if (!request) return null;

  const isWrite = request.scope === "write";
  const action = isWrite ? "apply this reviewed change" : "continue this protected action";
  const expiresAt = new Date(request.expiresAt);
  const expiryLabel = Number.isNaN(expiresAt.getTime())
    ? "Expiry supplied by local host"
    : `Expires ${expiresAt.toLocaleString()}`;
  const scopeLabel = request.scope === "mcp" ? "MCP" : request.scope;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="capability-approval-title" aria-describedby="capability-approval-description">
      <div className="w-full max-w-md rounded-lg border border-amber-500/50 bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <FilePenLine className="h-4 w-4 text-amber-400" />
          <h2 id="capability-approval-title" className="font-mono text-[13px] font-semibold tracking-wide text-foreground">
            Approve reviewed local write <span className="font-normal text-muted-foreground">· approval inbox</span>
          </h2>
        </div>
        <div className="space-y-3 px-4 py-4">
          <p id="capability-approval-description" className="text-[12.5px] leading-relaxed text-muted-foreground">
            NanoForge is ready to {action}. This approval is limited to this exact request and can be used once.
          </p>
          <div className="grid grid-cols-2 gap-2 text-[10.5px]">
            <div className="rounded-md border border-border bg-secondary/20 px-2.5 py-2">
              <span className="flex items-center gap-1 text-muted-foreground"><Layers3 className="h-3 w-3" /> Scope</span>
              <span className="mt-1 block font-mono font-semibold text-foreground">{scopeLabel}</span>
            </div>
            <div className="rounded-md border border-border bg-secondary/20 px-2.5 py-2">
              <span className="flex items-center gap-1 text-muted-foreground"><Clock3 className="h-3 w-3" /> Lifetime</span>
              <span className="mt-1 block font-mono font-semibold text-foreground">{request.uses === "single" ? "One use" : "Multi-use"}</span>
            </div>
          </div>
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-[11.5px] text-muted-foreground">
            {request.reason}
          </div>
          <dl className="space-y-1.5 rounded-md border border-border/70 bg-background/30 px-3 py-2 font-mono text-[10px] text-muted-foreground">
            <div className="flex items-center gap-2"><Hash className="h-3 w-3 shrink-0" /><dt>Request</dt><dd className="truncate text-foreground/80">{request.requestId}</dd></div>
            <div className="flex justify-between gap-3"><dt>Tool</dt><dd className="truncate text-right text-foreground/80">{request.toolId}</dd></div>
            <div className="flex justify-between gap-3"><dt>Run</dt><dd className="truncate text-right text-foreground/80">{request.runId}</dd></div>
            <div className="flex justify-between gap-3"><dt>Expiry</dt><dd className="text-right text-amber-300">{expiryLabel}</dd></div>
          </dl>
          <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            The host checks the reviewed content and file version again before it writes. Cancel keeps your files unchanged.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => onDecide(request.requestId, false)}
            className="rounded-md border border-border px-3 py-1.5 font-mono text-[11.5px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            Cancel write
          </button>
          <button
            type="button"
            onClick={() => onDecide(request.requestId, true)}
            ref={approveRef}
            className="rounded-md bg-amber-500 px-3 py-1.5 font-mono text-[11.5px] font-semibold text-black hover:bg-amber-400"
          >
            Approve once
          </button>
        </div>
      </div>
    </div>
  );
}
