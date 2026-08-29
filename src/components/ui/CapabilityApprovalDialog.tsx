import { FilePenLine, ShieldCheck } from "lucide-react";
import type { CapabilityApprovalRequiredMessage } from "@/lib/hostClient";

export interface CapabilityApprovalDialogProps {
  request: CapabilityApprovalRequiredMessage | null;
  onDecide: (requestId: string, approved: boolean) => void;
}

/** A per-action approval surface for host-issued capability grants. */
export function CapabilityApprovalDialog({ request, onDecide }: CapabilityApprovalDialogProps) {
  if (!request) return null;

  const isWrite = request.scope === "write";
  const action = isWrite ? "apply this reviewed change" : "continue this protected action";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="capability-approval-title">
      <div className="w-full max-w-md rounded-lg border border-amber-500/50 bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <FilePenLine className="h-4 w-4 text-amber-400" />
          <h2 id="capability-approval-title" className="font-mono text-[13px] font-semibold tracking-wide text-foreground">
            Approve reviewed local write
          </h2>
        </div>
        <div className="space-y-3 px-4 py-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            NanoForge is ready to {action}. This approval is limited to this exact request and can be used once.
          </p>
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-[11.5px] text-muted-foreground">
            {request.reason}
          </div>
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
            className="rounded-md bg-amber-500 px-3 py-1.5 font-mono text-[11.5px] font-semibold text-black hover:bg-amber-400"
          >
            Approve once
          </button>
        </div>
      </div>
    </div>
  );
}
