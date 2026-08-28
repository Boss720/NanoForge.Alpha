import { useState, useCallback } from "react";
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CollapsibleOutputProps {
  title: string;
  content: string;
  variant?: "stdout" | "stderr" | "error";
  defaultExpanded?: boolean;
}

const VARIANT_STYLES = {
  stdout: "border-border bg-card/40",
  stderr: "border-amber-500/20 bg-amber-950/20",
  error: "border-red-500/20 bg-red-950/20",
} as const;

const VARIANT_LABELS = {
  stdout: "Output",
  stderr: "Warning",
  error: "Error",
} as const;

export function CollapsibleOutput({
  title,
  content,
  variant = "stdout",
  defaultExpanded = false,
}: CollapsibleOutputProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may not be available in all contexts
    }
  }, [content]);

  return (
    <div className={cn("rounded border font-mono text-[11px]", VARIANT_STYLES[variant])}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${VARIANT_LABELS[variant]}: ${title}`}
      >
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="truncate">{title}</span>
        {variant !== "stdout" && (
          <span className={cn(
            "ml-1 rounded px-1 py-0.5 text-[9px] font-semibold",
            variant === "stderr" ? "bg-amber-500/10 text-amber-400" : "bg-red-500/10 text-red-400",
          )}>
            {VARIANT_LABELS[variant]}
          </span>
        )}
      </button>
      {expanded && (
        <div className="group relative border-t border-inherit">
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
            aria-label="Copy output"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </button>
          <pre className="scrollbar-thin max-h-64 overflow-auto whitespace-pre-wrap break-words p-2 text-[10px] leading-relaxed text-foreground/80">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
