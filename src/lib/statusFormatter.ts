/**
 * NanoForge Jargon-Free Error & Status Formatter
 *
 * Requirements (R1, R6):
 * - Redacts raw WebSocket error codes (4401, 4400, 1006, 1001, etc.)
 * - Redacts host ports (e.g., :4040, :49212)
 * - Redacts auth tokens (e.g., token=dry-run..., sk-...)
 * - Redacts raw local filesystem paths (e.g., C:\Users\..., /home/...)
 * - Provides multi-modal status badge metadata (Color + Icon + Text)
 */

import {
  Check,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Sparkles,
  PowerOff,
  FolderLock,
  FolderX,
  RefreshCw,
  Clock,
  ShieldAlert,
  Ban,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ConnectionState, ToolRunState } from "@/types";
import type { RuntimeStatus } from "@/sections/TopBar";

/**
 * Redacts sensitive tokens, ports, raw WebSocket codes, and absolute filesystem paths.
 */
export function formatErrorMessage(rawError: unknown): string {
  if (rawError === null || rawError === undefined) {
    return "An unknown error occurred.";
  }

  let text = typeof rawError === "string" ? rawError : rawError instanceof Error ? rawError.message : String(rawError);

  if (!text.trim()) {
    return "An unknown error occurred.";
  }

  // 1. Redact auth tokens & API keys
  text = text.replace(/token=[A-Za-z0-9_-]{8,}/gi, "token=[redacted]");
  text = text.replace(/sk-[A-Za-z0-9_-]{10,}/gi, "sk-[redacted]");
  text = text.replace(/bearer\s+[A-Za-z0-9_.-]{10,}/gi, "bearer [redacted]");

  // 2. Redact loopback URLs with ephemeral ports
  text = text.replace(/ws:\/\/127\.0\.0\.1:\d+/gi, "ws://127.0.0.1");
  text = text.replace(/http:\/\/127\.0\.0\.1:\d+/gi, "http://127.0.0.1");
  text = text.replace(/ws:\/\/localhost:\d+/gi, "ws://localhost");
  text = text.replace(/http:\/\/localhost:\d+/gi, "http://localhost");

  // 3. Redact raw local filesystem paths
  text = text.replace(/[A-Za-z]:\\[^:\s"'`<>]+/g, "[workspace folder]");
  text = text.replace(/\/Users\/[^\s"'`<>]+/g, "[workspace folder]");
  text = text.replace(/\/home\/[^\s"'`<>]+/g, "[workspace folder]");

  // 4. Translate raw WebSocket codes and low-level protocol jargon
  if (text.includes("4401") || /unauthorized/i.test(text) && /token/i.test(text)) {
    return "Authentication required: The session expired or token is invalid. Please reconnect.";
  }
  if (text.includes("4400") || /invalid.*message/i.test(text)) {
    return "Invalid request: The command format was not recognized by the local host.";
  }
  if (text.includes("1006") || /abnormal.*closure/i.test(text) || /connection.*refused/i.test(text) || /ECONNREFUSED/i.test(text)) {
    return "Host unreachable: Could not connect to the local agent host. Verify the daemon is running.";
  }
  if (text.includes("1001") || /going.*away/i.test(text)) {
    return "Host disconnected: The local agent host was stopped or restarted.";
  }

  return text;
}

export interface StatusBadgeMeta {
  label: string;
  icon: LucideIcon;
  colorClass: string;
  dotClass: string;
  description: string;
  variant: "success" | "warning" | "error" | "info" | "neutral";
}

/**
 * Returns multi-modal status badge metadata for API connection status.
 */
export function getApiStatusMeta(status: ConnectionState["status"]): StatusBadgeMeta {
  switch (status) {
    case "connected":
      return {
        label: "API live",
        icon: Check,
        colorClass: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
        dotClass: "bg-emerald-400",
        description: "Connected to model API provider with live credentials",
        variant: "success",
      };
    case "checking":
      return {
        label: "API checking…",
        icon: Loader2,
        colorClass: "text-primary border-primary/30 bg-primary/10",
        dotClass: "bg-primary pulse-dot",
        description: "Validating API connection and credentials",
        variant: "info",
      };
    case "error":
      return {
        label: "API error",
        icon: AlertCircle,
        colorClass: "text-red-400 border-red-500/30 bg-red-500/10",
        dotClass: "bg-red-400",
        description: "API connection failed or key rejected",
        variant: "error",
      };
    case "disconnected":
    default:
      return {
        label: "API demo",
        icon: Sparkles,
        colorClass: "text-muted-foreground border-border bg-secondary/60",
        dotClass: "bg-muted-foreground/50",
        description: "Running in free simulated demo mode",
        variant: "neutral",
      };
  }
}

/**
 * Returns multi-modal status badge metadata for Local Runtime status.
 */
export function getRuntimeStatusMeta(status: RuntimeStatus): StatusBadgeMeta {
  switch (status) {
    case "ready":
      return {
        label: "Runtime ready",
        icon: Check,
        colorClass: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
        dotClass: "bg-emerald-400",
        description: "Local agent host connected and workspace ready",
        variant: "success",
      };
    case "healthy":
      return {
        label: "Host healthy",
        icon: Check,
        colorClass: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
        dotClass: "bg-emerald-400",
        description: "Local agent host daemon is connected and responsive",
        variant: "success",
      };
    case "starting":
      return {
        label: "Host starting…",
        icon: Loader2,
        colorClass: "text-primary border-primary/30 bg-primary/10",
        dotClass: "bg-primary pulse-dot",
        description: "Starting local agent host daemon",
        variant: "info",
      };
    case "connecting":
      return {
        label: "Host connecting",
        icon: RefreshCw,
        colorClass: "text-primary border-primary/30 bg-primary/10",
        dotClass: "bg-primary pulse-dot",
        description: "Connecting to local agent host daemon",
        variant: "info",
      };
    case "reconnecting":
      return {
        label: "Host reconnecting…",
        icon: RefreshCw,
        colorClass: "text-primary border-primary/30 bg-primary/10",
        dotClass: "bg-primary pulse-dot",
        description: "Retrying connection to local agent host daemon",
        variant: "info",
      };
    case "switching":
      return {
        label: "Switching workspace…",
        icon: Loader2,
        colorClass: "text-primary border-primary/30 bg-primary/10",
        dotClass: "bg-primary pulse-dot",
        description: "Switching active workspace descriptor",
        variant: "info",
      };
    case "needs_attention":
      return {
        label: "Needs attention",
        icon: AlertTriangle,
        colorClass: "text-amber-400 border-amber-500/30 bg-amber-500/10",
        dotClass: "bg-amber-400",
        description: "Action required: review permission or configuration issue",
        variant: "warning",
      };
    case "error":
      return {
        label: "Host error",
        icon: AlertTriangle,
        colorClass: "text-red-400 border-red-500/30 bg-red-500/10",
        dotClass: "bg-red-400",
        description: "Local host encountered an error",
        variant: "error",
      };
    case "unavailable":
      return {
        label: "Workspace unavailable",
        icon: FolderLock,
        colorClass: "text-amber-300 border-amber-500/30 bg-amber-500/10",
        dotClass: "bg-amber-400",
        description: "Selected local workspace is currently unavailable",
        variant: "warning",
      };
    case "no-workspace":
      return {
        label: "No workspace",
        icon: FolderX,
        colorClass: "text-muted-foreground border-border bg-secondary/60",
        dotClass: "bg-muted-foreground/50",
        description: "No local folder opened yet",
        variant: "neutral",
      };
    case "offline":
    default:
      return {
        label: "Host offline",
        icon: PowerOff,
        colorClass: "text-muted-foreground border-border bg-secondary/60",
        dotClass: "bg-muted-foreground/50",
        description: "Local agent host daemon is not running",
        variant: "neutral",
      };
  }
}

/**
 * Returns multi-modal status badge metadata for supervised tool runs.
 */
export function getToolRunStatusMeta(state: ToolRunState): StatusBadgeMeta {
  switch (state) {
    case "queued":
      return {
        label: "Queued",
        icon: Clock,
        colorClass: "text-muted-foreground border-border bg-secondary/40",
        dotClass: "bg-muted-foreground",
        description: "Waiting in execution queue",
        variant: "neutral",
      };
    case "approval_required":
      return {
        label: "Approval required",
        icon: ShieldAlert,
        colorClass: "text-amber-400 border-amber-500/40 bg-amber-500/10",
        dotClass: "bg-amber-400",
        description: "Requires your review and approval before running",
        variant: "warning",
      };
    case "running":
      return {
        label: "Running",
        icon: Loader2,
        colorClass: "text-primary border-primary/40 bg-primary/10",
        dotClass: "bg-primary pulse-dot",
        description: "Executing tool command",
        variant: "info",
      };
    case "done":
      return {
        label: "Done",
        icon: Check,
        colorClass: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
        dotClass: "bg-emerald-400",
        description: "Completed successfully",
        variant: "success",
      };
    case "error":
      return {
        label: "Error",
        icon: X,
        colorClass: "text-red-400 border-red-500/40 bg-red-500/10",
        dotClass: "bg-red-400",
        description: "Tool execution failed",
        variant: "error",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        icon: Ban,
        colorClass: "text-muted-foreground border-border bg-secondary/40",
        dotClass: "bg-muted-foreground",
        description: "Cancelled by user",
        variant: "neutral",
      };
  }
}
