import { useState, type ReactNode } from "react";
import {
  Play,
  Pause,
  Square,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileEdit,
  ChevronDown,
  ChevronRight,
  Shield,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type RunStatus =
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "awaiting_approval"
  | "blocked"
  | "failed";

export interface RunCardProps {
  runId: string;
  objective?: string;
  currentStep?: string;
  touchedFiles?: string[];
  elapsedMs?: number;
  status: RunStatus;
  isDemo?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onApprove?: () => void;
}

const STATUS_CONFIG: Record<RunStatus, { icon: ReactNode; label: string; className: string; shape: string }> = {
  running: {
    icon: <Play className="h-3 w-3" />,
    label: "Running",
    className: "text-blue-400 bg-blue-400/10 border-blue-400/30",
    shape: "●",
  },
  paused: {
    icon: <Pause className="h-3 w-3" />,
    label: "Paused",
    className: "text-amber-400 bg-amber-400/10 border-amber-400/30",
    shape: "◼",
  },
  completed: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    label: "Completed",
    className: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
    shape: "✓",
  },
  cancelled: {
    icon: <Ban className="h-3 w-3" />,
    label: "Cancelled",
    className: "text-muted-foreground bg-muted/30 border-muted-foreground/30",
    shape: "⊘",
  },
  awaiting_approval: {
    icon: <Shield className="h-3 w-3" />,
    label: "Awaiting approval",
    className: "text-purple-400 bg-purple-400/10 border-purple-400/30",
    shape: "◆",
  },
  blocked: {
    icon: <AlertCircle className="h-3 w-3" />,
    label: "Blocked",
    className: "text-orange-400 bg-orange-400/10 border-orange-400/30",
    shape: "▲",
  },
  failed: {
    icon: <AlertCircle className="h-3 w-3" />,
    label: "Failed",
    className: "text-red-400 bg-red-400/10 border-red-400/30",
    shape: "✕",
  },
};

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function RunCard({
  runId,
  objective,
  currentStep,
  touchedFiles = [],
  elapsedMs,
  status,
  isDemo,
  onPause,
  onResume,
  onCancel,
  onApprove,
}: RunCardProps) {
  const [filesExpanded, setFilesExpanded] = useState(false);
  const config = STATUS_CONFIG[status];

  return (
    <div
      className="rounded-lg border border-border bg-card/60 p-3 font-mono text-[12px]"
      role="region"
      aria-label={`Agent run ${runId}: ${config.label}`}
    >
      {/* Header: status badge + elapsed */}
      <div className="flex items-center gap-2">
        <span
          className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", config.className)}
          aria-label={`Status: ${config.label}`}
        >
          {config.icon}
          <span aria-hidden="true">{config.shape}</span>
          {config.label}
        </span>
        {isDemo && (
          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
            PREVIEW
          </span>
        )}
        {elapsedMs !== undefined && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatElapsed(elapsedMs)}
          </span>
        )}
      </div>

      {/* Objective */}
      {objective && (
        <p className="mt-1.5 text-[11px] text-foreground/90 leading-snug">{objective}</p>
      )}

      {/* Current step */}
      {currentStep && status === "running" && (
        <p className="mt-1 text-[10px] text-muted-foreground italic">{currentStep}</p>
      )}

      {/* Touched files */}
      {touchedFiles.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setFilesExpanded(!filesExpanded)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={filesExpanded}
          >
            {filesExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <FileEdit className="h-3 w-3" />
            {touchedFiles.length} file{touchedFiles.length !== 1 ? "s" : ""} touched
          </button>
          {filesExpanded && (
            <ul className="mt-1 space-y-0.5 pl-5 text-[10px] text-muted-foreground">
              {touchedFiles.map((file) => (
                <li key={file} className="truncate">{file}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-2 flex items-center gap-1.5">
        {status === "running" && onPause && (
          <button
            type="button"
            onClick={onPause}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Pause run"
          >
            <Pause className="h-3 w-3" /> Pause
          </button>
        )}
        {status === "paused" && onResume && (
          <button
            type="button"
            onClick={onResume}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Resume run"
          >
            <Play className="h-3 w-3" /> Resume
          </button>
        )}
        {status === "awaiting_approval" && onApprove && (
          <button
            type="button"
            onClick={onApprove}
            className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-400 hover:bg-emerald-500/20 transition-colors"
            aria-label="Approve run"
          >
            <CheckCircle2 className="h-3 w-3" /> Approve
          </button>
        )}
        {status !== "completed" && status !== "cancelled" && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded border border-red-500/30 px-2 py-1 text-[10px] text-red-400 hover:bg-red-500/10 transition-colors"
            aria-label="Cancel run"
          >
            <Square className="h-3 w-3" /> Cancel
          </button>
        )}
      </div>
    </div>
  );
}
