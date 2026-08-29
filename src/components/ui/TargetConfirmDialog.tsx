import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";

export interface TargetConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  targetName: string;
  confirmLabel?: string;
  cancelLabel?: string;
  requireTypingName?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  icon?: ReactNode;
}

export function TargetConfirmDialog({
  open,
  title,
  description,
  targetName,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  requireTypingName = false,
  onConfirm,
  onCancel,
  icon,
}: TargetConfirmDialogProps) {
  const [typedValue, setTypedValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setTypedValue("");
      const timer = setTimeout(() => {
        if (requireTypingName) {
          inputRef.current?.focus();
        } else {
          cancelBtnRef.current?.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, requireTypingName]);

  // Trap focus & Escape / Enter keys
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && (!requireTypingName || typedValue.trim() === targetName.trim())) {
        e.preventDefault();
        onConfirm();
      } else if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel, onConfirm, requireTypingName, targetName, typedValue]);

  if (!open) return null;

  const isMatch = !requireTypingName || typedValue.trim() === targetName.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        className="w-full max-w-md rounded-lg border border-destructive/40 bg-card p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 text-destructive font-mono text-sm font-semibold">
            {icon || <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />}
            <h2 id="confirm-dialog-title" className="text-foreground font-bold">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p id="confirm-dialog-desc" className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>

        {requireTypingName && (
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-mono text-muted-foreground block">
              Type <strong className="text-foreground font-semibold font-mono select-all">"{targetName}"</strong> to confirm:
            </label>
            <input
              ref={inputRef}
              type="text"
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              placeholder={targetName}
              className="w-full rounded-md border border-input bg-secondary/50 px-3 py-1.5 font-mono text-xs text-foreground outline-none ring-1 ring-destructive/30 focus:ring-destructive"
              aria-label={`Type "${targetName}" to confirm`}
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/60">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border bg-secondary/60 px-3 py-1.5 font-mono text-xs text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={!isMatch}
            onClick={onConfirm}
            className="flex items-center gap-1.5 rounded-md bg-destructive px-3.5 py-1.5 font-mono text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
