import { useReducer } from "react";
import {
  AlertTriangle,
  CreditCard,
  Download,
  Globe,
  KeyRound,
  Send,
  ShieldQuestion,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Agent platform — Module 3, Task 10.
 *
 * Two-level browser permission flow, implemented as an explicit state machine
 * (exported reducer + `useBrowserPermissions` hook) rather than a form:
 *
 *   level 1 — "origin": first navigation to an origin asks allow once /
 *             allow for session / deny. Session grants auto-resolve later
 *             navigations to the SAME origin; once-grants are consumed by the
 *             next navigation.
 *   level 2 — "sensitive": submit form / purchase / authentication / download
 *             ALWAYS prompt, one approval per action, no session option.
 *
 * CRITICAL INVARIANT: an origin grant (once or session) never auto-authorizes
 * a sensitive action. The reducer has no code path that resolves a sensitive
 * request from origin state — each one surfaces as its own prompt and each
 * approval is consumed by that single action.
 *
 * Wiring: PlanPanel/App hold the state via `useBrowserPermissions`, feed
 * `pending` into <BrowserPermissionDialog/> and route the dialog's callback
 * back into `decide()`.
 */

export type SensitiveActionKind = "submit_form" | "purchase" | "authentication" | "download";

export type BrowserPermissionRequest =
  | { kind: "origin"; origin: string; url: string }
  | { kind: "sensitive"; action: SensitiveActionKind; origin: string; detail?: string };

export type OriginDecision = "allow_once" | "allow_session" | "deny";

export type BrowserPermissionDecision =
  | { kind: "origin"; origin: string; decision: OriginDecision }
  | { kind: "sensitive"; action: SensitiveActionKind; origin: string; approved: boolean };

export interface BrowserPermissionsState {
  /** Request currently shown in the dialog; null = idle. */
  pending: BrowserPermissionRequest | null;
  /** FIFO of requests waiting behind `pending`. */
  queue: BrowserPermissionRequest[];
  /** Origins the user allowed for the whole session. */
  sessionAllowedOrigins: string[];
  /** One-shot origin grants; each is consumed by the next navigation. */
  onceAllowedOrigins: string[];
  /** Origins the user explicitly denied (informational; re-requests re-prompt). */
  deniedOrigins: string[];
}

export const initialBrowserPermissionsState: BrowserPermissionsState = {
  pending: null,
  queue: [],
  sessionAllowedOrigins: [],
  onceAllowedOrigins: [],
  deniedOrigins: [],
};

export type BrowserPermissionsEvent =
  | { type: "request"; request: BrowserPermissionRequest }
  | { type: "decide"; decision: BrowserPermissionDecision };

export function browserPermissionsReducer(
  state: BrowserPermissionsState,
  event: BrowserPermissionsEvent,
): BrowserPermissionsState {
  switch (event.type) {
    case "request": {
      const req = event.request;
      if (req.kind === "origin") {
        // Session grant auto-resolves repeat navigations to the same origin…
        if (state.sessionAllowedOrigins.includes(req.origin)) return state;
        // …a once-grant is consumed by the single navigation it authorized.
        if (state.onceAllowedOrigins.includes(req.origin)) {
          return {
            ...state,
            onceAllowedOrigins: state.onceAllowedOrigins.filter((o) => o !== req.origin),
          };
        }
      }
      // NOTE: there is deliberately NO branch that lets origin grants resolve
      // `kind === "sensitive"` requests — every sensitive action re-prompts.
      if (state.pending) return { ...state, queue: [...state.queue, req] };
      return { ...state, pending: req };
    }
    case "decide": {
      const d = event.decision;
      const next: BrowserPermissionsState = { ...state };
      if (d.kind === "origin") {
        if (d.decision === "allow_session") {
          next.sessionAllowedOrigins = [...state.sessionAllowedOrigins, d.origin];
        } else if (d.decision === "allow_once") {
          next.onceAllowedOrigins = [...state.onceAllowedOrigins, d.origin];
        } else {
          next.deniedOrigins = [...state.deniedOrigins, d.origin];
        }
      }
      // Sensitive decisions are intentionally NOT persisted: approval is
      // consumed by this one action and the next one re-prompts.
      const [head, ...rest] = state.queue;
      next.pending = head ?? null;
      next.queue = rest;
      return next;
    }
  }
}

/** Hook for PlanPanel/App wiring: queue + grants state machine in one place. */
export function useBrowserPermissions() {
  const [state, dispatch] = useReducer(browserPermissionsReducer, initialBrowserPermissionsState);
  return {
    /** Request to display right now (null when idle). */
    pending: state.pending,
    /** Full state — grants, queue — for debugging/audit display. */
    state,
    requestPermission: (request: BrowserPermissionRequest) => dispatch({ type: "request", request }),
    decide: (decision: BrowserPermissionDecision) => dispatch({ type: "decide", decision }),
  };
}

export interface BrowserPermissionDialogProps {
  /** The pending request (from useBrowserPermissions); null renders nothing. */
  request: BrowserPermissionRequest | null;
  onDecide: (decision: BrowserPermissionDecision) => void;
}

const SENSITIVE_COPY: Record<
  SensitiveActionKind,
  { icon: typeof Send; verb: string; caution: string }
> = {
  submit_form: {
    icon: Send,
    verb: "submit a form",
    caution: "Typed data will be sent to the site.",
  },
  purchase: {
    icon: CreditCard,
    verb: "make a purchase",
    caution: "This can spend real money.",
  },
  authentication: {
    icon: KeyRound,
    verb: "sign in / authenticate",
    caution: "Credentials will be used on this site.",
  },
  download: {
    icon: Download,
    verb: "download a file",
    caution: "The file will be written to this machine.",
  },
};

export function BrowserPermissionDialog({ request, onDecide }: BrowserPermissionDialogProps) {
  if (!request) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div
        className={cn(
          "w-full max-w-md rounded-lg border bg-card shadow-2xl",
          request.kind === "sensitive" ? "border-amber-500/50" : "border-border",
        )}
      >
        {request.kind === "origin" ? (
          <OriginPrompt request={request} onDecide={onDecide} />
        ) : (
          <SensitivePrompt request={request} onDecide={onDecide} />
        )}
      </div>
    </div>
  );
}

function OriginPrompt({
  request,
  onDecide,
}: {
  request: Extract<BrowserPermissionRequest, { kind: "origin" }>;
  onDecide: (d: BrowserPermissionDecision) => void;
}) {
  const decide = (decision: OriginDecision) => onDecide({ kind: "origin", origin: request.origin, decision });
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Globe className="h-4 w-4 text-primary" />
        <span className="font-mono text-[13px] font-semibold tracking-wide text-foreground">
          First navigation to a new origin
        </span>
      </div>
      <div className="space-y-3 px-4 py-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          The agent wants to navigate the managed browser to{" "}
          <span className="font-mono text-foreground">{request.origin}</span>.
        </p>
        <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {request.url}
        </div>
        <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Navigation permission never authorizes sensitive actions — submitting forms, purchases,
          sign-ins, and downloads each ask separately.
        </p>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <button
          onClick={() => decide("deny")}
          className="rounded-md border border-destructive/50 px-3 py-1.5 font-mono text-[11.5px] text-red-300 hover:bg-destructive/10"
        >
          deny
        </button>
        <div className="flex-1" />
        <button
          onClick={() => decide("allow_once")}
          className="rounded-md border border-border px-3 py-1.5 font-mono text-[11.5px] text-foreground hover:bg-accent/40"
        >
          allow once
        </button>
        <button
          onClick={() => decide("allow_session")}
          className="rounded-md bg-primary px-3.5 py-1.5 font-mono text-[11.5px] font-semibold text-primary-foreground hover:opacity-90"
        >
          allow for session
        </button>
      </div>
    </>
  );
}

function SensitivePrompt({
  request,
  onDecide,
}: {
  request: Extract<BrowserPermissionRequest, { kind: "sensitive" }>;
  onDecide: (d: BrowserPermissionDecision) => void;
}) {
  const copy = SENSITIVE_COPY[request.action];
  const Icon = copy.icon;
  const decide = (approved: boolean) =>
    onDecide({ kind: "sensitive", action: request.action, origin: request.origin, approved });
  return (
    <>
      <div className="flex items-center gap-2 border-b border-amber-500/30 px-4 py-3">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <span className="font-mono text-[13px] font-semibold tracking-wide text-foreground">
          Sensitive action — explicit confirmation required
        </span>
      </div>
      <div className="space-y-3 px-4 py-4">
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          The agent wants to <span className="font-mono text-amber-200">{copy.verb}</span> on{" "}
          <span className="font-mono text-foreground">{request.origin}</span>.{" "}
          {copy.caution}
        </p>
        {request.detail && (
          <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {request.detail}
          </div>
        )}
        <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-amber-200">
          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Origin permission does not authorize this action. Approval applies to this single action
          only — the next one asks again.
        </p>
      </div>
      <div className="flex items-center gap-2 border-t border-amber-500/30 px-4 py-3">
        <button
          onClick={() => decide(false)}
          className="rounded-md border border-destructive/50 px-3 py-1.5 font-mono text-[11.5px] text-red-300 hover:bg-destructive/10"
        >
          deny
        </button>
        <div className="flex-1" />
        <button
          onClick={() => decide(true)}
          className="rounded-md bg-amber-500 px-3.5 py-1.5 font-mono text-[11.5px] font-semibold text-black hover:opacity-90"
        >
          approve once
        </button>
      </div>
    </>
  );
}
