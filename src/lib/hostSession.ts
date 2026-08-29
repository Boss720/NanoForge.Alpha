/**
 * Agent platform — host session wiring (UI integration pass).
 *
 * Owns everything the web UI derives from the OPTIONAL local agent host:
 * the inspected execution plan, terminal tool-run cards, the router's route
 * decision, browser-permission prompts, and visual-verification evidence.
 * With the host absent (`enabled: false`, the default) every piece of state
 * stays null/empty and App renders exactly the pre-platform UI.
 *
 * Wire conventions (UI side — the host honors these; keep in sync with
 * `apps/agent-host/`):
 *
 *  1. `runId === plan.id`. A plan submitted via `submitPlan` executes as the
 *     run of the same id; `run.state` events with that runId update the
 *     plan's UI state and per-step statuses. PlanPanel's Run control
 *     (re)submits the approved plan — there is no separate `run.start`
 *     frame in the client protocol.
 *
 *  2. Task 10 browser-step convention: a plan step whose `affectedScopes`
 *     contains an entry of the form `browser:<origin>` (e.g.
 *     `browser:https://shop.example`) involves managed-browser actions on
 *     that origin. Approving such a step in PlanPanel routes through the
 *     origin permission prompt FIRST — the host grant (`approval.grant`)
 *     is sent only after the user allows; a deny sends `approval.deny`.
 *     Sensitive actions (submit/purchase/auth/download) are deliberately
 *     NOT pre-prompted here: the permission reducer's one-shot invariant
 *     (each sensitive approval is consumed by exactly one action, never
 *     persisted) makes an approve-time pre-grant meaningless. They prompt
 *     at runtime via `browser.sensitive` run events instead.
 *
 *  3. Runtime browser permission requests arrive as `run.event` frames:
 *       event: "browser.origin"     detail: JSON { origin, url? }
 *       event: "browser.sensitive"  detail: JSON { action, origin, detail? }
 *     Decisions flow back through the fixed client API as
 *     `grantApproval`/`denyApproval` with synthetic step ids:
 *       `browser/origin/<origin>`                (navigation)
 *       `browser/sensitive/<action>@<origin>`    (one-shot sensitive action)
 *     Session origin grants auto-resolve repeat navigations without a
 *     prompt (grant sent immediately); a sensitive action ALWAYS prompts.
 *
 *  4. Router decisions arrive as `run.event` "route.decision" with detail
 *     JSON `{ decision, pendingFallback?, preApprovedFallbacks? }`.
 *     Fallback approve/reject map to grant/deny with the synthetic step id
 *     `route/fallback/<modelId>`.
 *
 *  5. Visual-verification evidence arrives as `run.event` "visual.evidence"
 *     with detail JSON `{ assertions?, diff? }` (VisualEvidenceCard props).
 *
 *  6. Integrations arrive as `integrations.snapshot` frames. UI toggles are
 *     session-local host requests: they update the loaded runtime context but
 *     never rewrite `.nanoforge` manifests and never grant tool permissions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExecutionPlan, PlanStep, PlanStepStatus, ToolRun } from "@/types";
import {
  HostClient,
  HostAuthError,
  HostOriginMismatchError,
  calculateBackoffDelay,
  type HostMessage,
  type PlanSubmitResultMessage,
  type ApprovalGrantResultMessage,
  type ApprovalDenyResultMessage,
  type RunPauseResultMessage,
  type RunResumeResultMessage,
  type RunCancelResultMessage,
  type ToolResponseResultMessage,
  type CapabilityApprovalRequiredMessage,
} from "@/lib/hostClient";
import type { CommandResultFrame } from "@protocol/commands";
import type { ExecuteCommandInput, HostWorkspaceDescriptor } from "@/lib/hostClient";
import {
  type WorkspaceBrokerConnection,
  type WorkspaceWriteResult,
  isNonRetryableError,
} from "@protocol/workspace";
import type { RuntimeState } from "@protocol/lifecycle";
import type { DirEntry, FileStat, SearchMatch, GitFileStatus } from "@/types/workspace";
import {
  useBrowserPermissions,
  type BrowserPermissionDecision,
  type BrowserPermissionRequest,
  type SensitiveActionKind,
} from "@/sections/BrowserPermissionDialog";
import type { RouteDecision, RouteDecisionCardProps } from "@/sections/RouteDecisionCard";
import type { McpServerRow, RulesPackRow, SkillRow } from "@/sections/IntegrationsPanel";
import type { VisualAssertionResult, VisualDiffResult } from "@/sections/VisualEvidenceCard";

/* ------------------------------------------------------------------ */
/* Settings (additive, OFF by default)                                 */
/* ------------------------------------------------------------------ */

export interface HostSettings {
  /** Master switch — false unless the user runs a local agent host. */
  enabled: boolean;
  /** Loopback port printed by the host on startup. */
  port?: number;
  /** Single-use bearer token (never persisted by HostClient itself). */
  token?: string;
}

export const HOST_SETTINGS_KEY = "nanoforge.host";

export const DEFAULT_HOST_SETTINGS: HostSettings = { enabled: false };

let inMemoryLauncherSettings: HostSettings | null = null;

export function resetInMemoryLauncherSettings(): void {
  inMemoryLauncherSettings = null;
}

export function getInMemoryLauncherSettings(): HostSettings | null {
  return inMemoryLauncherSettings;
}

/**
 * Strips token, hostPort, and bootstrap parameters from the browser address bar
 * via window.history.replaceState so that secrets never linger in URLs or browser history.
 */
export function scrubUrlParameters(): void {
  if (typeof globalThis.window === "undefined" || !globalThis.window.history?.replaceState) return;
  try {
    const url = new URL(globalThis.window.location.href);
    if (url.searchParams.has("token") || url.searchParams.has("hostPort") || url.searchParams.has("bootstrapToken")) {
      url.searchParams.delete("token");
      url.searchParams.delete("hostPort");
      url.searchParams.delete("bootstrapToken");
      const cleanUrl = url.pathname + (url.search ? url.search : "") + url.hash;
      globalThis.window.history.replaceState({}, globalThis.document?.title ?? "", cleanUrl || "/");
    }
  } catch {
    // Ignore in non-browser / mock test environments
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** Never throws; absent/corrupt payload → the disabled default. */
export function loadHostSettings(storage: Storage | undefined = defaultStorage()): HostSettings {
  if (inMemoryLauncherSettings) {
    return inMemoryLauncherSettings;
  }
  try {
    // Standalone launcher sessions provide ephemeral host credentials in the
    // page URL. Consume them at startup into memory, and immediately strip the URL.
    if (typeof globalThis.location !== "undefined") {
      const query = new URLSearchParams(globalThis.location.search);
      const hostPort = Number(query.get("hostPort"));
      const launcherToken = query.get("token") || query.get("bootstrapToken");
      if (Number.isInteger(hostPort) && hostPort > 0 && hostPort <= 65535 && launcherToken) {
        inMemoryLauncherSettings = { enabled: true, port: hostPort, token: launcherToken };
        scrubUrlParameters();
        return inMemoryLauncherSettings;
      }
    }
    const raw = storage?.getItem(HOST_SETTINGS_KEY);
    if (!raw) return DEFAULT_HOST_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<HostSettings>;
    // Scrub legacy tokens if stored in localStorage
    if (parsed.token) {
      const { token: _, ...safe } = parsed;
      try {
        storage?.setItem(HOST_SETTINGS_KEY, JSON.stringify(safe));
      } catch {}
    }
    return {
      enabled: parsed.enabled === true,
      ...(typeof parsed.port === "number" ? { port: parsed.port } : {}),
    };
  } catch {
    return DEFAULT_HOST_SETTINGS;
  }
}

/* ------------------------------------------------------------------ */
/* Wire convention constants                                           */
/* ------------------------------------------------------------------ */

/** Task 10: `affectedScopes` entry prefix marking a managed-browser step. */
export const BROWSER_SCOPE_PREFIX = "browser:";

/** run.event names the host uses to reach the UI. */
export const HOST_RUN_EVENTS = {
  browserOrigin: "browser.origin",
  browserSensitive: "browser.sensitive",
  routeDecision: "route.decision",
  visualEvidence: "visual.evidence",
} as const;

/** Synthetic step ids used when permission/router decisions map onto the
 *  fixed approval.grant / approval.deny frames. */
export const BROWSER_ORIGIN_STEP_PREFIX = "browser/origin/";
export const BROWSER_SENSITIVE_STEP_PREFIX = "browser/sensitive/";
export const ROUTE_FALLBACK_STEP_PREFIX = "route/fallback/";

/** Task 10: extract the browser origin from a plan step, if it is one. */
export function browserScopeOrigin(step: PlanStep): string | null {
  for (const scope of step.affectedScopes ?? []) {
    if (scope.startsWith(BROWSER_SCOPE_PREFIX)) {
      const origin = scope.slice(BROWSER_SCOPE_PREFIX.length).trim();
      if (origin) return origin;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
import type {
  InvokeSubagentParams,
  InvokeSubagentResult,
  ManageSubagentsParams,
  ManageSubagentsResult,
  SendMessageParams,
  SendMessageResult,
  DefineSubagentParams,
  DefineSubagentResult,
  SubagentInfo,
  SubagentMessage,
} from "@protocol/subagents";
import type {
  ManageTaskParams,
  ManageTaskResult,
  ScheduleParams,
  ScheduleResult,
  TaskSummary,
} from "@protocol/tasks";
import type {
  MemoryEntry,
  MemorySetParams,
  MemorySetResult,
  MemoryGetParams,
  MemoryGetResult,
  MemoryQueryParams,
  MemoryQueryResult,
  MemoryDeleteParams,
  MemoryDeleteResult,
} from "@protocol/memory";

/* ------------------------------------------------------------------ */
/* Derived state types                                                 */
/* ------------------------------------------------------------------ */

/** Structural subset of HostClient the session depends on — injectable so
 *  tests (and future transports) never open a real socket. */
export interface HostClientLike {
  connect(): Promise<void>;
  close(): void;
  onEvent(handler: (msg: HostMessage) => void): () => void;
  submitPlan(plan: ExecutionPlan): Promise<PlanSubmitResultMessage | void>;
  grantApproval(runId: string, stepId: string): Promise<ApprovalGrantResultMessage | void>;
  denyApproval(runId: string, stepId: string, reason?: string): Promise<ApprovalDenyResultMessage | void>;
  pauseRun(runId: string): Promise<RunPauseResultMessage | void>;
  resumeRun?(runId: string): Promise<RunResumeResultMessage | void>;
  cancelRun(runId: string, reason?: string): Promise<RunCancelResultMessage | void>;
  sendToolResponse?(requestId: string, approved: boolean, reason?: string): Promise<ToolResponseResultMessage | void>;
  respondToCapabilityApproval?(requestId: string, approved: boolean, reason?: string): Promise<void>;
  readDir?(path?: string): Promise<DirEntry[]>;
  readFile?(path: string): Promise<{ path: string; content: string; language: string; size: number; modified?: string; sha256?: string; generation?: number }>;
  writeFile?(path: string, content: string, options?: { expectedSha256?: string; expectedModified?: string }): Promise<WorkspaceWriteResult>;
  stat?(path: string): Promise<FileStat>;
  search?(query: string, options?: { caseSensitive?: boolean; includes?: string[]; maxResults?: number }): Promise<SearchMatch[]>;
  gitStatus?(): Promise<GitFileStatus[]>;
  watch?(): Promise<void>;
  unwatch?(): Promise<void>;
  describeWorkspace?(): Promise<HostWorkspaceDescriptor>;
  selectWorkspace?(selectionToken: string): Promise<HostWorkspaceDescriptor>;
  openWorkspace?(path: string): Promise<HostWorkspaceDescriptor>;
  toggleIntegration?(kind: "rules" | "skill" | "mcp", id: string, enabled: boolean): Promise<void>;
  invokeSubagent?(params: InvokeSubagentParams, parentId?: string): Promise<InvokeSubagentResult>;
  manageSubagents?(params: ManageSubagentsParams, callerId?: string): Promise<ManageSubagentsResult>;
  sendMessage?(params: SendMessageParams, senderId?: string): Promise<SendMessageResult>;
  defineSubagent?(params: DefineSubagentParams): Promise<DefineSubagentResult>;
  manageTask?(params: ManageTaskParams): Promise<ManageTaskResult>;
  createSchedule?(params: ScheduleParams, creatorSubagentId?: string): Promise<ScheduleResult>;
  setSharedMemory?(params: MemorySetParams): Promise<MemorySetResult>;
  getSharedMemory?(params: MemoryGetParams): Promise<MemoryGetResult>;
  querySharedMemory?(params: MemoryQueryParams): Promise<MemoryQueryResult>;
  deleteSharedMemory?(params: MemoryDeleteParams): Promise<MemoryDeleteResult>;
  dispatchPlaygroundTurn?(subagentId: string, prompt: string): Promise<any>;
  simulateAgentTurn?(subagentId: string, scenario: string): Promise<any>;
  injectAgentFailure?(subagentId: string, failureType: string, strategy?: string): Promise<any>;
  executeCommand?(input: ExecuteCommandInput): Promise<CommandResultFrame>;
  dispatchCommand?(input: ExecuteCommandInput): Promise<CommandResultFrame>;
}

export interface HostIntegrationsState {
  rulesPacks: RulesPackRow[];
  skills: SkillRow[];
  mcpServers: McpServerRow[];
}

export const EMPTY_INTEGRATIONS: HostIntegrationsState = {
  rulesPacks: [],
  skills: [],
  mcpServers: [],
};

export interface HostEvidence {
  assertions?: VisualAssertionResult[];
  diff?: VisualDiffResult | null;
}

export type HostConnectionStatus = "off" | "connecting" | "connected" | "error" | RuntimeState;

interface RouteDecisionState {
  runId: string;
  decision: RouteDecision;
  pendingFallback: string | null;
  preApprovedFallbacks: string[];
}

export interface HostSession {
  enabled: boolean;
  status: HostConnectionStatus;
  runtimeState: RuntimeState;
  isOperational: boolean;
  lastError: string | null;
  plan: ExecutionPlan | null;
  toolRuns: ToolRun[];
  /** Ready-to-spread props for ModelPanel's routeDecision slot. */
  routeDecision: RouteDecisionCardProps | null;
  integrations: HostIntegrationsState;
  evidence: HostEvidence | null;
  permissionPending: BrowserPermissionRequest | null;
  /** A host-issued, exact capability grant waiting for an operator decision. */
  capabilityApprovalPending: CapabilityApprovalRequiredMessage | null;
  // Subagent & Daemon Swarm Control Plane State
  subagents: SubagentInfo[];
  activeSubagentId: string | null;
  interAgentMessages: SubagentMessage[];
  daemonTasks: TaskSummary[];
  schedules: ScheduleResult[];
  sharedMemory: MemoryEntry[];

  /** Wiring seam for the (future) plan composer and tests: install/replace
   *  the inspected plan. Passing null clears the plan rail and its evidence. */
  setPlan(plan: ExecutionPlan | null): void;
  approveStep(planId: string, stepId: string): void;
  runApproved(planId: string): void;
  pause(planId: string): void;
  cancel(planId: string): void;
  stopToolRun(toolRunId: string): void;
  decidePermission(decision: BrowserPermissionDecision): void;
  decideCapabilityApproval(requestId: string, approved: boolean): void;
  toggleRulesPack: (id: string, enabled: boolean) => void;
  toggleSkill: (id: string, enabled: boolean) => void;
  toggleMcpServer: (id: string, enabled: boolean) => void;

  // Subagents & Tasks Control Plane Methods
  setActiveSubagentId: (id: string | null) => void;
  spawnSubagent: (params: InvokeSubagentParams, parentId?: string) => Promise<InvokeSubagentResult | null>;
  killSubagent: (subagentId: string) => Promise<ManageSubagentsResult | null>;
  killSubagentTree: (subagentId: string) => Promise<ManageSubagentsResult | null>;
  sendAgentMessage: (
    recipientId: string,
    body: string,
    options?: { subject?: string; referencedArtifacts?: string[]; priority?: "high" | "normal" | "low" }
  ) => Promise<SendMessageResult | null>;
  manageSubagentsAction: (params: ManageSubagentsParams) => Promise<ManageSubagentsResult | null>;
  defineSubagent: (params: DefineSubagentParams) => Promise<DefineSubagentResult | null>;
  executeCommand: (input: ExecuteCommandInput) => Promise<CommandResultFrame>;
  dispatchCommand: (input: ExecuteCommandInput) => Promise<CommandResultFrame>;
  readWorkspaceDirectory: (path?: string) => Promise<DirEntry[] | null>;
  readWorkspaceFile: (path: string) => Promise<{ path: string; content: string; language: string; size: number; modified?: string; sha256?: string; generation?: number } | null>;
  writeWorkspaceFile: (path: string, content: string, options?: { expectedSha256?: string; expectedModified?: string }) => Promise<WorkspaceWriteResult | null>;
  statWorkspaceFile: (path: string) => Promise<FileStat | null>;
  searchWorkspace: (query: string, options?: { maxResults?: number }) => Promise<SearchMatch[] | null>;
  workspaceGitStatus: () => Promise<GitFileStatus[] | null>;
  watchWorkspace: () => Promise<boolean>;
  unwatchWorkspace: () => Promise<boolean>;
  selectWorkspace: (selectionToken: string) => Promise<HostWorkspaceDescriptor | null>;
  openWorkspace: (path: string) => Promise<HostWorkspaceDescriptor | null>;
  /** Atomically adopt an already-prepared broker host without a page reload. */
  reconnectToWorkspace: (connection: WorkspaceBrokerConnection) => Promise<HostWorkspaceDescriptor | null>;
  manageTask: (params: ManageTaskParams) => Promise<ManageTaskResult | null>;
  createSchedule: (params: ScheduleParams) => Promise<ScheduleResult | null>;
  cancelSchedule: (scheduleId: string) => Promise<ManageTaskResult | null>;
  sendTaskInput: (taskId: string, input: string) => Promise<ManageTaskResult | null>;
  killTask: (taskId: string) => Promise<ManageTaskResult | null>;

  // Shared Memory & Playground Methods
  setSharedMemory: (
    key: string,
    value: unknown,
    namespace?: string,
    ttlSeconds?: number,
    tags?: string[]
  ) => Promise<MemorySetResult | null>;
  getSharedMemory: (key: string, namespace?: string) => Promise<MemoryGetResult | null>;
  querySharedMemory: (params: MemoryQueryParams) => Promise<MemoryQueryResult | null>;
  deleteSharedMemory: (key: string, namespace?: string) => Promise<MemoryDeleteResult | null>;
  dispatchPlaygroundTurn: (
    subagentId: string,
    prompt: string
  ) => Promise<{ success: boolean; turnId?: string; response?: string; tokensUsed?: number; latencyMs?: number } | null>;
  simulateAgentTurn: (
    subagentId: string,
    scenario: string
  ) => Promise<{ success: boolean; turnId?: string; scenario?: string; output?: string; tokensUsed?: number; latencyMs?: number } | null>;
  injectAgentFailure: (
    subagentId: string,
    failureType: "timeout" | "crash" | "stall" | "out_of_budget",
    strategy?: "one_for_one" | "one_for_all" | "rest_for_one"
  ) => Promise<{ success: boolean; affectedSubagents?: string[]; recovered?: boolean; message?: string } | null>;
}

export interface UseHostSessionOptions {
  /** Overrides the persisted settings (tests / wiring seam). */
  settings?: HostSettings;
  /** Injectable client factory — production uses the real HostClient. */
  createClient?: (opts: { port?: number; token?: string; websocketUrl?: string }) => HostClientLike;
  /** Wiring seam: called with the live session API after every render
   *  (tests / the future plan composer). */
  onApi?: (api: HostSession) => void;
}

/* ------------------------------------------------------------------ */
/* Small pure helpers                                                  */
/* ------------------------------------------------------------------ */

const isPlanStepStatus = (v: unknown): v is PlanStepStatus =>
  v === "pending" || v === "running" || v === "succeeded" || v === "failed" || v === "blocked";

const SENSITIVE_ACTIONS: readonly string[] = ["submit_form", "purchase", "authentication", "download"];
const isSensitiveAction = (v: unknown): v is SensitiveActionKind =>
  typeof v === "string" && SENSITIVE_ACTIONS.includes(v);

function parseJsonDetail<T>(detail: string | undefined): T | null {
  if (!detail) return null;
  try {
    return JSON.parse(detail) as T;
  } catch {
    return null; // untrusted host payload — drop malformed frames silently
  }
}

function parseRouteDecision(v: unknown): RouteDecision | null {
  if (typeof v !== "object" || v === null) return null;
  const d = v as Record<string, unknown>;
  if (
    typeof d.primary !== "string" ||
    !Array.isArray(d.fallbacks) ||
    !d.fallbacks.every((f) => typeof f === "string") ||
    typeof d.estimatedCostUsd !== "number" ||
    typeof d.reason !== "string" ||
    typeof d.pinned !== "boolean"
  ) {
    return null;
  }
  return d as unknown as RouteDecision;
}

/** Insert or merge one tool-run card (keyed by tool id). */
function upsertToolRun(prev: ToolRun[], next: ToolRun): ToolRun[] {
  const i = prev.findIndex((t) => t.id === next.id);
  if (i === -1) return [...prev, next];
  const copy = prev.slice();
  copy[i] = { ...prev[i], ...next };
  return copy;
}

function upsertSubagent(prev: SubagentInfo[], next: SubagentInfo): SubagentInfo[] {
  const i = prev.findIndex((s) => s.id === next.id);
  if (i === -1) return [...prev, next];
  const copy = prev.slice();
  copy[i] = { ...prev[i], ...next };
  return copy;
}

function upsertTask(prev: TaskSummary[], next: TaskSummary): TaskSummary[] {
  const i = prev.findIndex((t) => t.taskId === next.taskId);
  if (i === -1) return [...prev, next];
  const copy = prev.slice();
  copy[i] = { ...prev[i], ...next };
  return copy;
}

function upsertMemoryEntry(prev: MemoryEntry[], next: MemoryEntry): MemoryEntry[] {
  const i = prev.findIndex((e) => (e.namespace || "global") === (next.namespace || "global") && e.key === next.key);
  if (i === -1) return [...prev, next];
  const copy = prev.slice();
  copy[i] = next;
  return copy;
}

const originGrantKey = (origin: string) => `origin|${origin}`;
const sensitiveGrantKey = (action: string, origin: string) => `sensitive|${action}@${origin}`;

interface PendingGrant {
  runId: string;
  stepId: string;
}

/* ------------------------------------------------------------------ */
/* The hook                                                            */
/* ------------------------------------------------------------------ */

export function useHostSession(options?: UseHostSessionOptions): HostSession {
  const settings = options?.settings ?? loadHostSettings();
  const createClient = options?.createClient;
  const enabled = settings.enabled === true && typeof settings.port === "number" && !!settings.token;
  /** Identity of the desired connection; null when the host is disabled. */
  const connKey = enabled ? `${settings.port}:${settings.token}` : null;

  const [plan, setPlanState] = useState<ExecutionPlan | null>(null);
  const [toolRuns, setToolRuns] = useState<ToolRun[]>([]);
  const [route, setRoute] = useState<RouteDecisionState | null>(null);
  const [evidence, setEvidence] = useState<HostEvidence | null>(null);
  const [integrations, setIntegrations] = useState<HostIntegrationsState>(EMPTY_INTEGRATIONS);
  const [capabilityApprovalPending, setCapabilityApprovalPending] = useState<CapabilityApprovalRequiredMessage | null>(null);

  // Subagents & Tasks Control Plane State
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  const [activeSubagentId, setActiveSubagentId] = useState<string | null>(null);
  const [interAgentMessages, setInterAgentMessages] = useState<SubagentMessage[]>([]);
  const [daemonTasks, setDaemonTasks] = useState<TaskSummary[]>([]);
  const [schedules, setSchedules] = useState<ScheduleResult[]>([]);
  const [sharedMemory, setSharedMemoryState] = useState<MemoryEntry[]>([]);

  const [runtimeState, setRuntimeState] = useState<RuntimeState>(!connKey ? "unavailable" : "starting");
  const [connectOutcome, setConnectOutcome] = useState<{ key: string; error: string | null } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const status: HostConnectionStatus = !connKey
    ? "off"
    : runtimeState === "reconnecting" || runtimeState === "starting" || runtimeState === "switching"
      ? "connecting"
      : runtimeState === "healthy" || runtimeState === "ready"
        ? "connected"
        : runtimeState === "needs_attention" || runtimeState === "unavailable"
          ? (connectOutcome?.error ? "error" : "off")
          : !connectOutcome || connectOutcome.key !== connKey
            ? "connecting"
            : connectOutcome.error
              ? "error"
              : "connected";

  const perms = useBrowserPermissions();

  const clientRef = useRef<HostClientLike | null>(null);
  const clientUnsubscribeRef = useRef<(() => void) | null>(null);
  const toolRunOwners = useRef(new Map<string, string>()); // toolId -> runId
  const pendingGrants = useRef(new Map<string, PendingGrant>()); // perm key -> grant
  // Latest-value refs keep the single host subscription stable (mounted once
  // per connection) while still reading fresh React state inside handlers.
  const latest = useRef({ perms, plan });
  useEffect(() => {
    latest.current = { perms, plan };
  });

  /* ------------------------- outbound helpers ------------------------- */

  const sendGrant = useCallback((runId: string, stepId: string, approved: boolean) => {
    const client = clientRef.current;
    if (!client) return;
    const p = approved ? client.grantApproval(runId, stepId) : client.denyApproval(runId, stepId);
    void p.catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
    });
  }, []);

  /**
   * Origin permission gate (Task 10): session/once grants resolve without a
   * prompt; anything else queues the grant behind the origin dialog.
   * Sensitive actions never take this path — they always prompt.
   */
  const requestOriginGrant = useCallback(
    (runId: string, stepId: string, origin: string, url?: string) => {
      const s = latest.current.perms.state;
      if (s.sessionAllowedOrigins.includes(origin)) {
        sendGrant(runId, stepId, true);
        return;
      }
      if (s.onceAllowedOrigins.includes(origin)) {
        // Route through the reducer so the one-shot grant is consumed (it
        // resolves silently, no prompt), then grant immediately.
        latest.current.perms.requestPermission({ kind: "origin", origin, url: url ?? origin });
        sendGrant(runId, stepId, true);
        return;
      }
      pendingGrants.current.set(originGrantKey(origin), { runId, stepId });
      latest.current.perms.requestPermission({ kind: "origin", origin, url: url ?? origin });
    },
    [sendGrant],
  );

  /* ------------------------- inbound events --------------------------- */

  const handleRunEvent = useCallback(
    (msg: Extract<HostMessage, { type: "run.event" }>) => {
      if (msg.event === HOST_RUN_EVENTS.browserOrigin) {
        const d = parseJsonDetail<{ origin?: unknown; url?: unknown }>(msg.detail);
        if (typeof d?.origin === "string" && d.origin) {
          requestOriginGrant(
            msg.runId,
            BROWSER_ORIGIN_STEP_PREFIX + d.origin,
            d.origin,
            typeof d.url === "string" ? d.url : undefined,
          );
        }
        return;
      }
      if (msg.event === HOST_RUN_EVENTS.browserSensitive) {
        const d = parseJsonDetail<{ action?: unknown; origin?: unknown; detail?: unknown }>(msg.detail);
        if (typeof d?.origin === "string" && d.origin && isSensitiveAction(d.action)) {
          // Sensitive actions ALWAYS prompt (reducer invariant) — an existing
          // origin grant must not auto-resolve this.
          pendingGrants.current.set(sensitiveGrantKey(d.action, d.origin), {
            runId: msg.runId,
            stepId: `${BROWSER_SENSITIVE_STEP_PREFIX}${d.action}@${d.origin}`,
          });
          latest.current.perms.requestPermission({
            kind: "sensitive",
            action: d.action,
            origin: d.origin,
            ...(typeof d.detail === "string" ? { detail: d.detail } : {}),
          });
        }
        return;
      }
      if (msg.event === HOST_RUN_EVENTS.routeDecision) {
        const d = parseJsonDetail<{
          decision?: unknown;
          pendingFallback?: unknown;
          preApprovedFallbacks?: unknown;
        }>(msg.detail);
        const decision = parseRouteDecision(d?.decision);
        if (decision) {
          setRoute({
            runId: msg.runId,
            decision,
            pendingFallback: typeof d?.pendingFallback === "string" ? d.pendingFallback : null,
            preApprovedFallbacks: Array.isArray(d?.preApprovedFallbacks)
              ? d.preApprovedFallbacks.filter((f): f is string => typeof f === "string")
              : [],
          });
        }
        return;
      }
      if (msg.event === HOST_RUN_EVENTS.visualEvidence) {
        const d = parseJsonDetail<{ assertions?: unknown; diff?: unknown }>(msg.detail);
        setEvidence({
          assertions: Array.isArray(d?.assertions) ? (d.assertions as VisualAssertionResult[]) : [],
          diff: (d?.diff ?? null) as VisualDiffResult | null,
        });
        return;
      }
      // Unknown run events are forward-compatible noise — ignore.
    },
    [requestOriginGrant],
  );

  const handleHostMessage = useCallback(
    (msg: HostMessage) => {
      switch (msg.type) {
        case "run.state":
          // Convention: runId === plan.id (see module docstring).
          setPlanState((prev) => {
            if (!prev || prev.id !== msg.runId) return prev;
            return {
              ...prev,
              state: msg.state,
              steps: prev.steps.map((s) => {
                const st = msg.stepStates?.[s.id];
                return isPlanStepStatus(st) ? { ...s, status: st } : s;
              }),
            };
          });
          break;
        case "tool.approval_required":
          toolRunOwners.current.set(msg.toolId, msg.runId);
          setToolRuns((prev) =>
            upsertToolRun(prev, {
              id: msg.toolId,
              executable: msg.executable,
              args: msg.args,
              cwd: msg.cwd,
              state: "approval_required",
              policyReason: msg.policyReason,
            }),
          );
          break;
        case "capability.approval_required":
          setCapabilityApprovalPending(msg);
          break;
        case "capability.result":
          setCapabilityApprovalPending((prev) => prev?.requestId === msg.requestId ? null : prev);
          if (!msg.ok) setLastError(`${msg.errorCode ?? "denied"}: ${msg.errorMessage ?? "Capability denied"}`);
          break;
        case "tool.output":
          toolRunOwners.current.set(msg.toolId, msg.runId);
          setToolRuns((prev) => {
            const existing = prev.find((t) => t.id === msg.toolId);
            // The host may stream output for auto-allowed tools that never
            // produced an approval_required frame — create the card lazily,
            // using the tool id as the display label in that case.
            const base: ToolRun =
              existing ?? { id: msg.toolId, executable: msg.toolId, args: [], cwd: "", state: "running" };
            return upsertToolRun(prev, {
              ...base,
              output: (base.output ?? "") + msg.chunk,
              ...(msg.state ? { state: msg.state } : {}),
              ...(msg.exitCode !== undefined ? { exitCode: msg.exitCode } : {}),
              ...(msg.truncated !== undefined ? { truncated: msg.truncated } : {}),
            });
          });
          break;
        case "run.event":
          handleRunEvent(msg);
          break;
        case "integrations.snapshot":
          setIntegrations(msg.snapshot);
          break;
        case "error":
          setLastError(`${msg.code}: ${msg.message}`);
          break;

        /* --- Subagent Wire Events --- */
        case "subagent.event": {
          const ev = msg.event;
          if (ev.type === "subagent.spawned") {
            setSubagents((prev) => upsertSubagent(prev, ev.subagent));
          } else if (ev.type === "subagent.state_changed") {
            setSubagents((prev) =>
              prev.map((s) =>
                s.id === ev.subagentId
                  ? {
                      ...s,
                      state: ev.newState,
                      ...(ev.reason ? { lastProgressSummary: ev.reason } : {}),
                      lastHeartbeat: ev.at,
                    }
                  : s,
              ),
            );
          } else if (ev.type === "subagent.message_sent") {
            setInterAgentMessages((prev) => [...prev, ev.message]);
          } else if (ev.type === "subagent.heartbeat") {
            setSubagents((prev) =>
              prev.map((s) =>
                s.id === ev.subagentId
                  ? {
                      ...s,
                      lastHeartbeat: ev.lastVisited ?? ev.at,
                      ...(ev.progressSummary ? { lastProgressSummary: ev.progressSummary } : {}),
                    }
                  : s,
              ),
            );
          } else if (ev.type === "subagent.completed") {
            setSubagents((prev) =>
              prev.map((s) =>
                s.id === ev.subagentId
                  ? {
                      ...s,
                      state: "idle",
                      completedAt: ev.at,
                      tokensUsed: ev.tokensUsed,
                      turnCount: ev.turnCount,
                    }
                  : s,
              ),
            );
          } else if (ev.type === "subagent.errored") {
            setSubagents((prev) =>
              prev.map((s) =>
                s.id === ev.subagentId
                  ? {
                      ...s,
                      state: "errored",
                      error: ev.error,
                    }
                  : s,
              ),
            );
          } else if (ev.type === "subagent.tree_updated") {
            setSubagents(ev.tree);
          }
          break;
        }
        case "subagent.spawned":
          setSubagents((prev) => upsertSubagent(prev, msg.subagent));
          break;
        case "subagent.state_changed":
        case "subagent.state":
          setSubagents((prev) =>
            prev.map((s) =>
              s.id === msg.subagentId
                ? {
                    ...s,
                    state: msg.newState ?? msg.state ?? s.state,
                    ...(msg.tokensUsed !== undefined ? { tokensUsed: msg.tokensUsed } : {}),
                    ...(msg.reason ? { lastProgressSummary: msg.reason } : {}),
                    lastHeartbeat: msg.at ?? new Date().toISOString(),
                  }
                : s,
            ),
          );
          break;
        case "subagent.message_sent":
        case "subagent.message":
          setInterAgentMessages((prev) => [...prev, msg.message]);
          break;
        case "subagent.heartbeat":
          setSubagents((prev) =>
            prev.map((s) =>
              s.id === msg.subagentId
                ? {
                    ...s,
                    lastHeartbeat: msg.lastVisited,
                    ...(msg.progressSummary ? { lastProgressSummary: msg.progressSummary } : {}),
                  }
                : s,
            ),
          );
          break;
        case "subagent.completed":
          setSubagents((prev) =>
            prev.map((s) =>
              s.id === msg.subagentId
                ? {
                    ...s,
                    state: "idle",
                    completedAt: msg.at,
                    tokensUsed: msg.tokensUsed,
                    turnCount: msg.turnCount,
                  }
                : s,
            ),
          );
          break;
        case "subagent.errored":
          setSubagents((prev) =>
            prev.map((s) =>
              s.id === msg.subagentId
                ? {
                    ...s,
                    state: "errored",
                    error: msg.error,
                  }
                : s,
            ),
          );
          break;
        case "subagent.tree_updated":
          setSubagents(msg.tree);
          break;
        case "subagents.snapshot":
          setSubagents(msg.snapshot ?? (msg as unknown as { subagents?: SubagentInfo[] }).subagents ?? []);
          break;

        /* --- Task & Scheduler Wire Events --- */
        case "task.event": {
          const ev = msg.event;
          if (ev.type === "task.spawned") {
            setDaemonTasks((prev) => upsertTask(prev, ev.task));
          } else if (ev.type === "task.output") {
            setDaemonTasks((prev) =>
              prev.map((t) =>
                t.taskId === ev.taskId
                  ? { ...t, recentLogs: (t.recentLogs ?? "") + ev.chunk }
                  : t,
              ),
            );
          } else if (ev.type === "task.completed") {
            setDaemonTasks((prev) =>
              prev.map((t) =>
                t.taskId === ev.taskId
                  ? { ...t, status: "completed", exitCode: ev.exitCode, completedAt: ev.at }
                  : t,
              ),
            );
          } else if (ev.type === "task.killed") {
            setDaemonTasks((prev) =>
              prev.map((t) =>
                t.taskId === ev.taskId
                  ? { ...t, status: "killed", completedAt: ev.at }
                  : t,
              ),
            );
          } else if (ev.type === "schedule.triggered") {
            setSchedules((prev) =>
              prev.map((sc) =>
                sc.scheduleId === ev.scheduleId
                  ? { ...sc, status: "active" }
                  : sc,
              ),
            );
          } else if (ev.type === "schedule.cancelled") {
            setSchedules((prev) =>
              prev.map((sc) =>
                sc.scheduleId === ev.scheduleId
                  ? { ...sc, status: "cancelled" }
                  : sc,
              ),
            );
          }
          break;
        }
        case "task.spawned":
          setDaemonTasks((prev) => upsertTask(prev, msg.task));
          break;
        case "task.completed":
          setDaemonTasks((prev) =>
            prev.map((t) =>
              t.taskId === msg.taskId
                ? { ...t, status: "completed", exitCode: msg.exitCode, completedAt: msg.at }
                : t,
            ),
          );
          break;
        case "task.killed":
          setDaemonTasks((prev) =>
            prev.map((t) =>
              t.taskId === msg.taskId
                ? { ...t, status: "killed", completedAt: msg.at }
                : t,
            ),
          );
          break;
        case "schedule.triggered":
          setSchedules((prev) =>
            prev.map((sc) =>
              sc.scheduleId === msg.scheduleId
                ? { ...sc, status: "active" }
                : sc,
            ),
          );
          break;
        case "schedule.cancelled":
          setSchedules((prev) =>
            prev.map((sc) =>
              sc.scheduleId === msg.scheduleId
                ? { ...sc, status: "cancelled" }
                : sc,
            ),
          );
          break;
        case "tasks.snapshot":
          setDaemonTasks(msg.snapshot ?? (msg as unknown as { tasks?: TaskSummary[] }).tasks ?? []);
          break;
        case "schedules.snapshot":
          setSchedules(msg.snapshot ?? (msg as unknown as { schedules?: ScheduleResult[] }).schedules ?? []);
          break;

        /* --- Shared Memory & Telemetry Wire Events --- */
        case "memory.entry_set":
          setSharedMemoryState((prev) => upsertMemoryEntry(prev, msg.entry));
          break;
        case "memory.entry_deleted":
          setSharedMemoryState((prev) =>
            prev.filter((e) => !((e.namespace || "global") === (msg.namespace || "global") && e.key === msg.key))
          );
          break;
        case "memory.cleared":
          setSharedMemoryState((prev) =>
            msg.namespace ? prev.filter((e) => (e.namespace || "global") !== msg.namespace) : []
          );
          break;
        case "memory.snapshot":
          setSharedMemoryState(msg.snapshot ?? []);
          break;
        case "subagent.telemetry_updated":
          setSubagents((prev) =>
            prev.map((s) =>
              s.id === msg.subagentId
                ? {
                    ...s,
                    telemetry: msg.telemetry,
                    tokensUsed: msg.telemetry.totalTokens ?? s.tokensUsed,
                    turnCount: msg.telemetry.turnCount ?? s.turnCount,
                  }
                : s
            )
          );
          break;
        case "subagent.turn_started":
          setSubagents((prev) =>
            prev.map((s) =>
              s.id === msg.subagentId
                ? {
                    ...s,
                    state: "running",
                    lastHeartbeat: msg.at ?? new Date().toISOString(),
                    ...(msg.prompt ? { lastProgressSummary: `Turn prompt: ${msg.prompt.slice(0, 100)}...` } : {}),
                  }
                : s
            )
          );
          break;
        case "subagent.turn_completed":
          setSubagents((prev) =>
            prev.map((s) =>
              s.id === msg.subagentId
                ? {
                    ...s,
                    state: "idle",
                    tokensUsed: (s.tokensUsed || 0) + (msg.tokensUsed || 0),
                    turnCount: (s.turnCount || 0) + 1,
                    ...(msg.output ? { lastProgressSummary: msg.output.slice(0, 100) } : {}),
                    lastHeartbeat: msg.at ?? new Date().toISOString(),
                  }
                : s
            )
          );
          break;
      }
    },
    [handleRunEvent],
  );

  /* ------------------------- connection ------------------------------- */

  const createClientRef = useRef(createClient);
  useEffect(() => {
    createClientRef.current = createClient;
  });

  const closeActiveClient = useCallback(() => {
    clientUnsubscribeRef.current?.();
    clientUnsubscribeRef.current = null;
    const current = clientRef.current;
    clientRef.current = null;
    current?.close();
  }, []);

  useEffect(() => {
    if (!connKey) return; // host disabled — nothing to connect, status derives to "off"
    const port = settings.port as number;
    const token = settings.token as string;
    const clientFactory = createClientRef.current ?? ((o: { port?: number; token?: string; websocketUrl?: string }) => new HostClient(o));
    const client = clientFactory({
      port,
      token,
    });
    clientRef.current = client;
    clientUnsubscribeRef.current = client.onEvent((message) => {
      // A socket can dispatch an already-queued event after a replacement.
      // Only the currently adopted client is allowed to mutate session state.
      if (clientRef.current === client) handleHostMessage(message);
    });

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const maxAttempts = 5;
    const initialBackoffMs = 500;
    const maxBackoffMs = 10_000;

    const attemptConnect = async (attempt = 0) => {
      if (cancelled) return;
      if (attempt > 0) {
        setRuntimeState("reconnecting");
      }
      try {
        await client.connect();
        if (cancelled) return;
        setConnectOutcome({ key: connKey, error: null });
        setLastError(null);
        setRuntimeState("healthy");
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        const isOrigin =
          err instanceof HostOriginMismatchError ||
          (typeof message === "string" && message.toLowerCase().includes("origin"));
        const isAuth =
          (err instanceof HostAuthError && !isOrigin) ||
          (typeof message === "string" && message.includes("4401"));
        const isNonRetryable = isNonRetryableError(err);

        if (isOrigin || isAuth || isNonRetryable) {
          setConnectOutcome({ key: connKey, error: message });
          setLastError(message);
          setRuntimeState("needs_attention");
          return;
        }

        if (attempt < maxAttempts - 1) {
          const delay = calculateBackoffDelay(attempt, initialBackoffMs, maxBackoffMs);
          setRuntimeState("reconnecting");
          retryTimer = setTimeout(() => {
            void attemptConnect(attempt + 1);
          }, delay);
        } else {
          setConnectOutcome({ key: connKey, error: message });
          setLastError(message);
          setRuntimeState("unavailable");
        }
      }
    };

    void attemptConnect(0);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      closeActiveClient();
    };
    // settings primitives only — a new settings object with the same values
    // must NOT reconnect.
  }, [connKey, settings.port, settings.token, handleHostMessage, closeActiveClient]);

  const reconnectToWorkspace = useCallback(async (connection: WorkspaceBrokerConnection): Promise<HostWorkspaceDescriptor | null> => {
    const current = clientRef.current;
    setRuntimeState("switching");

    let candidate: HostClientLike | null = null;
    try {
      candidate = (createClient ?? ((o: { port?: number; token?: string; websocketUrl?: string }) => new HostClient(o)))({
        ...(connection.websocketUrl ? { websocketUrl: connection.websocketUrl } : {}),
        ...(connection.port !== undefined ? { port: connection.port } : {}),
        ...(connection.token ? { token: connection.token } : {}),
      });
      await candidate.connect();
      if (!candidate.describeWorkspace) throw new Error("Replacement local host cannot describe its workspace");
      const descriptor = await candidate.describeWorkspace();
      if (descriptor.generation !== connection.generation) {
        throw new Error(`Replacement host generation ${descriptor.generation} does not match broker generation ${connection.generation}`);
      }

      // The candidate has proved it represents the broker-selected workspace.
      // Only now retire the old host, so a failed candidate leaves it usable.
      clientUnsubscribeRef.current?.();
      clientUnsubscribeRef.current = null;
      clientRef.current = candidate;
      clientUnsubscribeRef.current = candidate.onEvent((message) => {
        if (clientRef.current === candidate) handleHostMessage(message);
      });
      current?.close();

      // Workspace-scoped transient UI cannot cross a host generation.
      toolRunOwners.current.clear();
      pendingGrants.current.clear();
      setToolRuns([]);
      setRoute(null);
      setEvidence(null);
      setLastError(null);
      setConnectOutcome({ key: `${connection.port ?? "url"}:${connection.token ?? ""}`, error: null });
      setRuntimeState("ready");
      return descriptor;
    } catch (error) {
      candidate?.close();
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      if (current) {
        setRuntimeState("healthy");
      } else {
        setRuntimeState(isNonRetryableError(error) ? "needs_attention" : "unavailable");
      }
      return null;
    }
  }, [createClient, handleHostMessage]);

  /* ------------------------- actions ---------------------------------- */

  const setPlan = useCallback((next: ExecutionPlan | null) => {
    setPlanState(next);
    if (!next) {
      // Run evidence belongs to a plan/run; clearing the plan clears it too.
      setEvidence(null);
      setRoute(null);
    }
  }, []);

  const approveStep = useCallback(
    (planId: string, stepId: string) => {
      const current = latest.current.plan;
      const step = current && current.id === planId ? current.steps.find((s) => s.id === stepId) : undefined;
      const origin = step ? browserScopeOrigin(step) : null;
      if (origin) {
        // Task 10: the approval of a browser step routes through the origin
        // permission prompt FIRST; the host grant follows the user's decision
        // (see decidePermission). Chat text never reaches this path — only
        // PlanPanel's explicit Approve button calls it.
        requestOriginGrant(planId, stepId, origin, origin);
        return;
      }
      sendGrant(planId, stepId, true);
    },
    [requestOriginGrant, sendGrant],
  );

  const runApproved = useCallback((planId: string) => {
    const current = latest.current.plan;
    const client = clientRef.current;
    if (!current || current.id !== planId || !client) return;
    // Convention: (re)submitting the approved plan starts/resumes its run.
    void client.submitPlan(current).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
    });
  }, []);

  const pause = useCallback((planId: string) => {
    void clientRef.current?.pauseRun(planId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
    });
  }, []);

  const cancel = useCallback((planId: string) => {
    void clientRef.current?.cancelRun(planId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
    });
  }, []);

  const stopToolRun = useCallback((toolRunId: string) => {
    const client = clientRef.current;
    if (!client) return;
    // The protocol cancels whole runs; map the card back to its owning run.
    const runId = toolRunOwners.current.get(toolRunId) ?? toolRunId;
    void client.cancelRun(runId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
    });
  }, []);

  const decidePermission = useCallback(
    (decision: BrowserPermissionDecision) => {
      perms.decide(decision); // the reducer keeps the grants ledger
      const key =
        decision.kind === "origin"
          ? originGrantKey(decision.origin)
          : sensitiveGrantKey(decision.action, decision.origin);
      const pend = pendingGrants.current.get(key);
      pendingGrants.current.delete(key);
      if (!pend) return; // prompt had no host grant attached (defensive)
      const approved = decision.kind === "origin" ? decision.decision !== "deny" : decision.approved;
      sendGrant(pend.runId, pend.stepId, approved);
    },
    [perms, sendGrant],
  );

  const decideCapabilityApproval = useCallback((requestId: string, approved: boolean) => {
    const pending = capabilityApprovalPending;
    if (!pending || pending.requestId !== requestId) return;
    const client = clientRef.current;
    if (!client?.respondToCapabilityApproval) {
      setLastError("This local host cannot accept capability approvals. Reconnect and try again.");
      return;
    }
    setCapabilityApprovalPending(null);
    void client.respondToCapabilityApproval(requestId, approved).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
      setCapabilityApprovalPending(pending);
    });
  }, [capabilityApprovalPending]);

  const toggleIntegration = useCallback((kind: "rules" | "skill" | "mcp", id: string, enabled: boolean) => {
    setIntegrations((prev) => ({
      rulesPacks:
        kind === "rules" ? prev.rulesPacks.map((row) => (row.id === id ? { ...row, enabled } : row)) : prev.rulesPacks,
      skills:
        kind === "skill" ? prev.skills.map((row) => (row.id === id ? { ...row, enabled } : row)) : prev.skills,
      mcpServers:
        kind === "mcp" ? prev.mcpServers.map((row) => (row.id === id ? { ...row, enabled } : row)) : prev.mcpServers,
    }));
    const p = clientRef.current?.toggleIntegration?.(kind, id, enabled);
    void p?.catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
    });
  }, []);

  /* ------------------------- Subagent & Task RPC Dispatchers ------------------------- */

  const spawnSubagent = useCallback(
    async (params: InvokeSubagentParams, parentId?: string): Promise<InvokeSubagentResult | null> => {
      const client = clientRef.current;
      if (!client || !client.invokeSubagent) return null;
      try {
        const res = await client.invokeSubagent(params, parentId);
        setSubagents((prev) =>
          upsertSubagent(prev, {
            id: res.subagentId,
            parentId: parentId ?? null,
            name: res.name,
            archetype: res.archetype,
            roles: params.roles ?? [],
            state: res.state,
            workingDirectory: res.workingDirectory,
            isolationMode: params.workspaceIsolation ?? "inherit",
            startedAt: res.startedAt,
            lastHeartbeat: res.startedAt,
            tokensUsed: 0,
            turnCount: 0,
          }),
        );
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const manageSubagentsAction = useCallback(
    async (params: ManageSubagentsParams): Promise<ManageSubagentsResult | null> => {
      const client = clientRef.current;
      if (!client || !client.manageSubagents) return null;
      try {
        const res = await client.manageSubagents(params);
        if (params.action === "list" && res.subagents) {
          setSubagents(res.subagents);
        } else if (params.action === "status" && res.detail) {
          setSubagents((prev) => upsertSubagent(prev, res.detail!));
        } else if (params.action === "kill" && params.subagentId) {
          if (params.recursive) {
            setSubagents((prev) =>
              prev.map((s) =>
                s.id === params.subagentId || s.parentId === params.subagentId
                  ? { ...s, state: "errored", error: "Terminated by user" }
                  : s,
              ),
            );
          } else {
            setSubagents((prev) =>
              prev.map((s) =>
                s.id === params.subagentId
                  ? { ...s, state: "errored", error: "Terminated by user" }
                  : s,
              ),
            );
          }
        }
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const killSubagent = useCallback(
    async (subagentId: string): Promise<ManageSubagentsResult | null> => {
      return manageSubagentsAction({ action: "kill", subagentId, recursive: false });
    },
    [manageSubagentsAction],
  );

  const killSubagentTree = useCallback(
    async (subagentId: string): Promise<ManageSubagentsResult | null> => {
      return manageSubagentsAction({ action: "kill", subagentId, recursive: true });
    },
    [manageSubagentsAction],
  );

  const sendAgentMessage = useCallback(
    async (
      recipientId: string,
      body: string,
      options?: { subject?: string; referencedArtifacts?: string[]; priority?: "high" | "normal" | "low" },
    ): Promise<SendMessageResult | null> => {
      const client = clientRef.current;
      if (!client || !client.sendMessage) return null;
      try {
        const res = await client.sendMessage({
          recipientId,
          subject: options?.subject ?? "Direct Message",
          body,
          referencedArtifacts: options?.referencedArtifacts ?? [],
          priority: options?.priority ?? "normal",
        });
        const msgFrame: SubagentMessage = {
          messageId: res.messageId,
          senderId: "00000000-0000-0000-0000-000000000000",
          senderName: "Operator / UI",
          recipientId,
          timestamp: res.deliveryTimestamp,
          subject: options?.subject ?? "Direct Message",
          body,
          referencedArtifacts: options?.referencedArtifacts ?? [],
          priority: options?.priority ?? "normal",
        };
        setInterAgentMessages((prev) => [...prev, msgFrame]);
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const defineSubagent = useCallback(
    async (params: DefineSubagentParams): Promise<DefineSubagentResult | null> => {
      const client = clientRef.current;
      if (!client || !client.defineSubagent) return null;
      try {
        return await client.defineSubagent(params);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const executeCommand = useCallback(
    async (input: ExecuteCommandInput): Promise<CommandResultFrame> => {
      const client = clientRef.current;
      const execute = client?.executeCommand ?? client?.dispatchCommand;
      if (!execute) {
        return {
          type: "command.result",
          command: input.command,
          success: false,
          error: "Host does not support command execution",
          data: { code: "unsupported_capability" },
        };
      }
      try {
        return await execute.call(client, input);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const dispatchCommand = useCallback(
    (input: ExecuteCommandInput): Promise<CommandResultFrame> => executeCommand(input),
    [executeCommand],
  );

  const withWorkspaceClient = useCallback(async <T,>(operation: (client: HostClientLike) => Promise<T>): Promise<T | null> => {
    const client = clientRef.current;
    if (!client) {
      setLastError("Cannot perform workspace operation while the local host is unavailable");
      return null;
    }
    try {
      return await operation(client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
      if (isNonRetryableError(err)) {
        setRuntimeState("needs_attention");
      }
      return null;
    }
  }, []);

  const readWorkspaceDirectory = useCallback((path = "") => withWorkspaceClient((client) =>
    client.readDir ? client.readDir(path) : Promise.reject(new Error("Host does not support workspace directory reads")),
  ), [withWorkspaceClient]);
  const readWorkspaceFile = useCallback((path: string) => withWorkspaceClient((client) =>
    client.readFile ? client.readFile(path) : Promise.reject(new Error("Host does not support workspace file reads")),
  ), [withWorkspaceClient]);
  const writeWorkspaceFile = useCallback(
    async (path: string, content: string, options?: { expectedSha256?: string; expectedModified?: string }): Promise<WorkspaceWriteResult | null> => {
      const client = clientRef.current;
      if (!client) return null;
      if (!client.writeFile) throw new Error("Host does not support reviewed workspace writes");
      try {
        return await client.writeFile(path, content, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );
  const statWorkspaceFile = useCallback((path: string) => withWorkspaceClient((client) =>
    client.stat ? client.stat(path) : Promise.reject(new Error("Host does not support workspace file stats")),
  ), [withWorkspaceClient]);
  const searchWorkspace = useCallback((query: string, options?: { maxResults?: number }) => withWorkspaceClient((client) =>
    client.search ? client.search(query, options) : Promise.reject(new Error("Host does not support workspace search")),
  ), [withWorkspaceClient]);
  const workspaceGitStatus = useCallback(() => withWorkspaceClient((client) =>
    client.gitStatus ? client.gitStatus() : Promise.reject(new Error("Host does not support Git status")),
  ), [withWorkspaceClient]);
  const watchWorkspace = useCallback(async () => (await withWorkspaceClient((client) =>
    client.watch ? client.watch() : Promise.reject(new Error("Host does not support workspace watching")),
  )) !== null, [withWorkspaceClient]);
  const unwatchWorkspace = useCallback(async () => (await withWorkspaceClient((client) =>
    client.unwatch ? client.unwatch() : Promise.reject(new Error("Host does not support workspace watching")),
  )) !== null, [withWorkspaceClient]);
  const selectWorkspace = useCallback((selectionToken: string) => withWorkspaceClient(async (client) => {
    if (!client.selectWorkspace && !client.openWorkspace) {
      throw new Error("This local host cannot open folders yet");
    }
    setRuntimeState("switching");
    try {
      const desc = client.selectWorkspace
        ? await client.selectWorkspace(selectionToken)
        : await client.openWorkspace!(selectionToken);
      setRuntimeState("ready");
      return desc;
    } catch (err) {
      if (isNonRetryableError(err)) {
        setRuntimeState("needs_attention");
      }
      throw err;
    }
  }), [withWorkspaceClient]);
  const openWorkspace = useCallback((path: string) => withWorkspaceClient(async (client) => {
    if (!client.openWorkspace && !client.selectWorkspace) {
      throw new Error("This local host cannot open folders yet");
    }
    setRuntimeState("switching");
    try {
      const desc = client.openWorkspace
        ? await client.openWorkspace(path)
        : await client.selectWorkspace!(path);
      setRuntimeState("ready");
      return desc;
    } catch (err) {
      if (isNonRetryableError(err)) {
        setRuntimeState("needs_attention");
      }
      throw err;
    }
  }), [withWorkspaceClient]);

  const manageTask = useCallback(
    async (params: ManageTaskParams): Promise<ManageTaskResult | null> => {
      const client = clientRef.current;
      if (!client || !client.manageTask) return null;
      try {
        const res = await client.manageTask(params);
        if (params.action === "list" && res.tasks) {
          setDaemonTasks(res.tasks);
        } else if (params.action === "status" && res.task) {
          setDaemonTasks((prev) => upsertTask(prev, res.task!));
        } else if (params.action === "kill" && params.taskId) {
          setDaemonTasks((prev) =>
            prev.map((t) => (t.taskId === params.taskId ? { ...t, status: "killed" } : t)),
          );
        }
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const createSchedule = useCallback(
    async (params: ScheduleParams): Promise<ScheduleResult | null> => {
      const client = clientRef.current;
      if (!client || !client.createSchedule) return null;
      try {
        const res = await client.createSchedule(params);
        setSchedules((prev) => {
          const idx = prev.findIndex((s) => s.scheduleId === res.scheduleId);
          if (idx === -1) return [...prev, res];
          const copy = prev.slice();
          copy[idx] = res;
          return copy;
        });
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const cancelSchedule = useCallback(
    async (scheduleId: string): Promise<ManageTaskResult | null> => {
      setSchedules((prev) =>
        prev.map((s) => (s.scheduleId === scheduleId ? { ...s, status: "cancelled" } : s)),
      );
      return manageTask({ action: "kill", taskId: scheduleId });
    },
    [manageTask],
  );

  const sendTaskInput = useCallback(
    async (taskId: string, input: string): Promise<ManageTaskResult | null> => {
      return manageTask({ action: "send_input", taskId, input });
    },
    [manageTask],
  );

  const killTask = useCallback(
    async (taskId: string): Promise<ManageTaskResult | null> => {
      return manageTask({ action: "kill", taskId });
    },
    [manageTask],
  );

  /* ------------------------- Shared Memory & Playground RPCs ------------------------- */

  const setSharedMemory = useCallback(
    async (
      key: string,
      value: unknown,
      namespace = "global",
      ttlSeconds?: number,
      tags: string[] = []
    ): Promise<MemorySetResult | null> => {
      const client = clientRef.current;
      if (!client || !client.setSharedMemory) return null;
      try {
        const res = await client.setSharedMemory({
          key,
          value: value as any,
          namespace,
          ttlSeconds,
          tags,
        });
        if (res?.entry) {
          setSharedMemoryState((prev) => upsertMemoryEntry(prev, res.entry));
        }
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const getSharedMemory = useCallback(
    async (key: string, namespace = "global"): Promise<MemoryGetResult | null> => {
      const client = clientRef.current;
      if (!client || !client.getSharedMemory) return null;
      try {
        return await client.getSharedMemory({ key, namespace });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const querySharedMemory = useCallback(
    async (params: MemoryQueryParams): Promise<MemoryQueryResult | null> => {
      const client = clientRef.current;
      if (!client || !client.querySharedMemory) return null;
      try {
        const res = await client.querySharedMemory(params);
        if (res?.entries && !params.query && !params.namespace && !params.tags?.length) {
          setSharedMemoryState(res.entries);
        }
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const deleteSharedMemory = useCallback(
    async (key: string, namespace = "global"): Promise<MemoryDeleteResult | null> => {
      const client = clientRef.current;
      if (!client || !client.deleteSharedMemory) return null;
      try {
        const res = await client.deleteSharedMemory({ key, namespace });
        setSharedMemoryState((prev) =>
          prev.filter((e) => !((e.namespace || "global") === (namespace || "global") && e.key === key))
        );
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const dispatchPlaygroundTurn = useCallback(
    async (subagentId: string, prompt: string) => {
      const client = clientRef.current;
      if (!client || !client.dispatchPlaygroundTurn) return null;
      try {
        return await client.dispatchPlaygroundTurn(subagentId, prompt);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const simulateAgentTurn = useCallback(
    async (subagentId: string, scenario: string) => {
      const client = clientRef.current;
      if (!client || !client.simulateAgentTurn) return null;
      try {
        return await client.simulateAgentTurn(subagentId, scenario);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const injectAgentFailure = useCallback(
    async (
      subagentId: string,
      failureType: "timeout" | "crash" | "stall" | "out_of_budget",
      strategy?: "one_for_one" | "one_for_all" | "rest_for_one"
    ) => {
      const client = clientRef.current;
      if (!client || !client.injectAgentFailure) return null;
      try {
        return await client.injectAgentFailure(subagentId, failureType, strategy);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  /* ------------------------- derived props ---------------------------- */

  const routeDecision: RouteDecisionCardProps | null = route
    ? {
        decision: route.decision,
        pendingFallback: route.pendingFallback,
        preApprovedFallbacks: route.preApprovedFallbacks,
        onApproveFallback: (modelId) => sendGrant(route.runId, ROUTE_FALLBACK_STEP_PREFIX + modelId, true),
        onRejectFallback: (modelId) => sendGrant(route.runId, ROUTE_FALLBACK_STEP_PREFIX + modelId, false),
      }
    : null;

  const api: HostSession = {
    enabled,
    status,
    runtimeState,
    isOperational: runtimeState === "ready" || runtimeState === "healthy",
    // a stale error from a previous connection must not surface once disabled
    lastError: connKey ? lastError : null,
    plan,
    toolRuns,
    routeDecision,
    integrations,
    evidence,
    permissionPending: perms.pending,
    capabilityApprovalPending,
    subagents,
    activeSubagentId,
    interAgentMessages,
    daemonTasks,
    schedules,
    sharedMemory,
    setPlan,
    approveStep,
    runApproved,
    pause,
    cancel,
    stopToolRun,
    decidePermission,
    decideCapabilityApproval,
    toggleRulesPack: (id, enabled) => toggleIntegration("rules", id, enabled),
    toggleSkill: (id, enabled) => toggleIntegration("skill", id, enabled),
    toggleMcpServer: (id, enabled) => toggleIntegration("mcp", id, enabled),
    setActiveSubagentId,
    spawnSubagent,
    killSubagent,
    killSubagentTree,
    sendAgentMessage,
    manageSubagentsAction,
    defineSubagent,
    executeCommand,
    dispatchCommand,
    readWorkspaceDirectory,
    readWorkspaceFile,
    writeWorkspaceFile,
    statWorkspaceFile,
    searchWorkspace,
    workspaceGitStatus,
    watchWorkspace,
    unwatchWorkspace,
    selectWorkspace,
    openWorkspace,
    reconnectToWorkspace,
    manageTask,
    createSchedule,
    cancelSchedule,
    sendTaskInput,
    killTask,
    setSharedMemory,
    getSharedMemory,
    querySharedMemory,
    deleteSharedMemory,
    dispatchPlaygroundTurn,
    simulateAgentTurn,
    injectAgentFailure,
  };

  const onApi = options?.onApi;
  useEffect(() => {
    onApi?.(api);
  });

  return api;
}
