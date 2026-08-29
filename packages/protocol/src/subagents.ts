/**
 * Hierarchical Subagent Swarm Protocol, State Machine, & Wire Schemas.
 *
 * Provides isomorphic Zod schemas, TypeScript types, and helper utilities for
 * subagent lifecycle states, actor-model mailbox messaging, tool parameters,
 * and WebSocket wire frames.
 *
 * ZERO Node.js runtime dependencies (pure TypeScript/Zod).
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 1. Subagent Lifecycle States & Archetypes                          */
/* ------------------------------------------------------------------ */

/**
 * Canonical 7-state lifecycle machine for subagents:
 * - "running": Actively executing LLM turns or tool processes.
 * - "idle": Execution suspended awaiting inbound events (0 CPU/token cost).
 * - "waiting_for_input": Blocked on interactive user input or approval gate.
 * - "waiting_for_dependents": Suspended awaiting completion/results from child subagents.
 * - "waiting_for_message": Suspended awaiting an incoming message from a designated sender.
 * - "canceling": Graceful abort initiated; cleaning up resources and worktrees.
 * - "errored": Unrecoverable runtime exception, syntax error, budget exceeded, or crash.
 */
export const subagentStateSchema = z.enum([
  "running",
  "idle",
  "waiting_for_input",
  "waiting_for_dependents",
  "waiting_for_message",
  "canceling",
  "errored",
  "spawning",
  "executing",
  "blocked",
  "completed",
  "failed",
  "terminated",
]);
export type SubagentState = z.infer<typeof subagentStateSchema>;

/**
 * Predefined subagent archetypes with distinct system prompt defaults & roles.
 */
export const subagentArchetypeSchema = z.enum([
  "explorer",    // Read-only reconnaissance, dependency mapping, code analysis
  "implementer", // Code modifications, refactoring, feature implementation
  "qa",          // Bug reproduction, test generation, lint/regression repair
  "specialist",  // Domain-specific skills (Science, Android, DB, Security)
  "verifier",    // Independent audit, assertion verification, visual inspection
  "planner",     // High-level DAG decomposition, scheduling, dependency analysis
  "custom",      // User-defined or dynamically registered agent configurations
]);
export type SubagentArchetype = z.infer<typeof subagentArchetypeSchema>;

/**
 * Workspace isolation modes for subagent sandboxing.
 */
export const workspaceIsolationModeSchema = z.enum([
  "inherit", // Shared workspaceRoot; isolated .agents/<id>/ metadata
  "branch",  // Isolated Git worktree (.agents/worktrees/<id>/ on nano/<id> branch)
  "share",   // Read-only workspace root + ephemeral scratch directory
]);
export type WorkspaceIsolationMode = z.infer<typeof workspaceIsolationModeSchema>;

/**
 * Erlang/OTP-inspired supervisor restart strategies for subagent trees.
 */
export const supervisorStrategySchema = z.enum([
  "one_for_one",  // If a child fails, restart only that child
  "one_for_all",  // If a child fails, terminate and restart all sibling children
  "rest_for_one", // If a child fails, terminate and restart children spawned after it
]);
export type SupervisorStrategy = z.infer<typeof supervisorStrategySchema>;

/**
 * Priority levels for inter-agent messages.
 */
export const messagePrioritySchema = z.enum(["high", "normal", "low"]);
export type MessagePriority = z.infer<typeof messagePrioritySchema>;

/* ------------------------------------------------------------------ */
/* 2. Error Codes & Protocol Constants                                */
/* ------------------------------------------------------------------ */

export const SUBAGENT_ERROR_CODES = {
  ERR_SUBAGENT_MAX_DEPTH_EXCEEDED: "ERR_SUBAGENT_MAX_DEPTH_EXCEEDED",
  ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT: "ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT",
  ERR_SUBAGENT_RECIPIENT_NOT_FOUND: "ERR_SUBAGENT_RECIPIENT_NOT_FOUND",
  ERR_SUBAGENT_ESCALATION_DENIED: "ERR_SUBAGENT_ESCALATION_DENIED",
  ERR_SUBAGENT_BUDGET_EXCEEDED: "ERR_SUBAGENT_BUDGET_EXCEEDED",
  ERR_SUBAGENT_NOT_FOUND: "ERR_SUBAGENT_NOT_FOUND",
  ERR_SUBAGENT_INVALID_STATE_TRANSITION: "ERR_SUBAGENT_INVALID_STATE_TRANSITION",
  ERR_SUBAGENT_CONCURRENCY_LIMIT_EXCEEDED: "ERR_SUBAGENT_CONCURRENCY_LIMIT_EXCEEDED",
  ERR_SUBAGENT_INSPECTION_FILE_NOT_FOUND: "ERR_SUBAGENT_INSPECTION_FILE_NOT_FOUND",
  ERR_SUBAGENT_INVALID_CONFIG: "ERR_SUBAGENT_INVALID_CONFIG",
} as const;

export type SubagentErrorCode = (typeof SUBAGENT_ERROR_CODES)[keyof typeof SUBAGENT_ERROR_CODES];

export const MAX_SUBAGENT_HIERARCHY_DEPTH = 3;
export const MAX_CONCURRENT_SUBAGENTS = 8;
export const DEFAULT_SUBAGENT_TIMEOUT_SECONDS = 600;
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 180000; // 3 minutes

export const subagentNameRegex = /^[a-zA-Z0-9_\-]+$/;

/* ------------------------------------------------------------------ */
/* 3. Core Data Contracts: Config, Info, Message                      */
/* ------------------------------------------------------------------ */

/**
 * Declarative configuration for creating or defining a subagent.
 */
export const subagentConfigSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(subagentNameRegex, "Subagent name must contain only alphanumeric characters, hyphens, and underscores"),
  archetype: subagentArchetypeSchema,
  roles: z.array(z.string().min(1)).default([]),
  systemPrompt: z.string().max(65536).optional(),
  model: z.string().max(128).optional(),
  workspaceIsolation: workspaceIsolationModeSchema.default("inherit"),
  allowedTools: z.array(z.string().min(1)).optional(),
  allowedToolKinds: z.array(z.string().min(1)).optional(),
  timeoutSeconds: z.number().int().positive().max(7200).default(600),
  budgetTokens: z.number().int().positive().optional(),
  skills: z.array(z.string().min(1)).default([]),
  environmentVariables: z.record(z.string(), z.string()).optional(),
});
export type SubagentConfig = z.infer<typeof subagentConfigSchema>;
export type SubagentDefinition = SubagentConfig;

/**
 * Detailed token consumption and runtime latency telemetry schema for subagents.
 */
export const subagentTelemetrySchema = z.object({
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  estimatedCostUsd: z.number().nonnegative().default(0),
  tokensPerSecond: z.number().nonnegative().default(0),
  turnCount: z.number().int().nonnegative().default(0),
  avgTurnLatencyMs: z.number().nonnegative().default(0),
  lastTurnLatencyMs: z.number().nonnegative().default(0),
  p95TurnLatencyMs: z.number().nonnegative().default(0),
  totalDurationMs: z.number().nonnegative().default(0),
  toolDurationMs: z.number().nonnegative().default(0),
});
export type SubagentTelemetry = z.infer<typeof subagentTelemetrySchema>;

/**
 * Runtime telemetry and metadata for an active or completed subagent.
 */
export const subagentInfoSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  archetype: subagentArchetypeSchema,
  roles: z.array(z.string()),
  state: subagentStateSchema,
  workingDirectory: z.string(),
  worktreePath: z.string().optional(),
  isolationMode: workspaceIsolationModeSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  lastHeartbeat: z.string().datetime(),
  tokensUsed: z.number().int().nonnegative().default(0),
  turnCount: z.number().int().nonnegative().default(0),
  telemetry: subagentTelemetrySchema.optional(),
  lastProgressSummary: z.string().optional(),
  exitCode: z.number().int().optional(),
  error: z.string().optional(),
});
export type SubagentInfo = z.infer<typeof subagentInfoSchema>;
export const subagentSummarySchema = subagentInfoSchema;
export type SubagentSummary = SubagentInfo;

/**
 * Actor-model mailbox message frame passed between agents.
 */
export const subagentMessageSchema = z.object({
  messageId: z.string().uuid(),
  senderId: z.string().uuid(),
  senderName: z.string().optional(),
  recipientId: z.string().uuid(),
  timestamp: z.string().datetime(),
  subject: z.string().min(1).max(256),
  body: z.string().min(1).max(65536),
  referencedArtifacts: z.array(z.string()).default([]),
  priority: messagePrioritySchema.default("normal"),
  correlationId: z.string().uuid().optional(),
});
export type SubagentMessage = z.infer<typeof subagentMessageSchema>;
export const agentMessageFrameSchema = subagentMessageSchema;
export type AgentMessageFrame = SubagentMessage;

/* ------------------------------------------------------------------ */
/* 4. Wire Protocol Events                                            */
/* ------------------------------------------------------------------ */

export const subagentLifecycleEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subagent.spawned"),
    subagent: subagentInfoSchema,
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.state_changed"),
    subagentId: z.string().min(1).max(128),
    previousState: subagentStateSchema,
    newState: subagentStateSchema,
    reason: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.message_sent"),
    message: subagentMessageSchema,
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.heartbeat"),
    subagentId: z.string().min(1).max(128),
    lastVisited: z.string().datetime(),
    progressSummary: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.completed"),
    subagentId: z.string().min(1).max(128),
    tokensUsed: z.number().int().nonnegative(),
    turnCount: z.number().int().nonnegative(),
    handoffArtifact: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.errored"),
    subagentId: z.string().min(1).max(128),
    error: z.string(),
    code: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.tree_updated"),
    rootId: z.string().min(1).max(128),
    activeCount: z.number().int().nonnegative(),
    tree: z.array(subagentInfoSchema),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("subagent.telemetry_updated"),
    subagentId: z.string().min(1).max(128),
    telemetry: subagentTelemetrySchema,
    at: z.string().datetime(),
  }),
]);
export type SubagentLifecycleEvent = z.infer<typeof subagentLifecycleEventSchema>;

/* ------------------------------------------------------------------ */
/* 5. Tool Parameter and Result Schemas                               */
/* ------------------------------------------------------------------ */

/**
 * `invoke_subagent` tool schemas
 */
export const invokeSubagentParamsSchema = z.object({
  archetype: subagentArchetypeSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(subagentNameRegex, "Subagent name must contain only alphanumeric characters, hyphens, and underscores")
    .optional(),
  roles: z.array(z.string().min(1)).default([]),
  prompt: z.string().min(1).max(32768),
  workspaceIsolation: workspaceIsolationModeSchema.default("inherit"),
  allowedTools: z.array(z.string().min(1)).optional(),
  allowedToolKinds: z.array(z.string().min(1)).optional(),
  timeoutSeconds: z.number().int().positive().max(7200).default(600),
  budgetTokens: z.number().int().positive().optional(),
  skills: z.array(z.string().min(1)).default([]),
  model: z.string().max(128).optional(),
});
export type InvokeSubagentParams = z.infer<typeof invokeSubagentParamsSchema>;

export const invokeSubagentResultSchema = z.object({
  subagentId: z.string().uuid(),
  name: z.string(),
  archetype: subagentArchetypeSchema,
  workingDirectory: z.string(),
  state: subagentStateSchema,
  startedAt: z.string().datetime(),
});
export type InvokeSubagentResult = z.infer<typeof invokeSubagentResultSchema>;

/**
 * `manage_subagents` tool schemas
 */
export const manageSubagentsActionSchema = z.enum([
  "list",
  "status",
  "kill",
  "pause",
  "resume",
  "inspect",
]);
export type ManageSubagentsAction = z.infer<typeof manageSubagentsActionSchema>;

export const manageSubagentsInspectFileSchema = z.enum([
  "progress.md",
  "BRIEFING.md",
  "handoff.md",
  "DISPATCH.md",
  "analysis.md",
]);
export type ManageSubagentsInspectFile = z.infer<typeof manageSubagentsInspectFileSchema>;

export const manageSubagentsParamsSchema = z.object({
  action: manageSubagentsActionSchema,
  subagentId: z.string().uuid().optional(),
  inspectFile: manageSubagentsInspectFileSchema.optional(),
  recursive: z.boolean().optional(),
});
export type ManageSubagentsParams = z.infer<typeof manageSubagentsParamsSchema>;


export const manageSubagentsResultSchema = z.object({
  action: manageSubagentsActionSchema,
  subagents: z.array(subagentInfoSchema).optional(),
  detail: subagentInfoSchema.optional(),
  inspectedContent: z.string().optional(),
  success: z.boolean(),
  message: z.string().optional(),
});
export type ManageSubagentsResult = z.infer<typeof manageSubagentsResultSchema>;

/**
 * `send_message` tool schemas
 */
export const sendMessageParamsSchema = z.object({
  recipientId: z.string().uuid(),
  subject: z.string().min(1).max(256),
  body: z.string().min(1).max(65536),
  referencedArtifacts: z.array(z.string()).default([]),
  priority: messagePrioritySchema.default("normal"),
});
export type SendMessageParams = z.infer<typeof sendMessageParamsSchema>;

export const sendMessageResultSchema = z.object({
  messageId: z.string().uuid(),
  deliveryTimestamp: z.string().datetime(),
  recipientStatus: subagentStateSchema,
  delivered: z.boolean(),
});
export type SendMessageResult = z.infer<typeof sendMessageResultSchema>;

/**
 * `define_subagent` tool schemas
 */
export const defineSubagentParamsSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(subagentNameRegex, "Subagent name must contain only alphanumeric characters, hyphens, and underscores"),
  archetype: subagentArchetypeSchema.default("custom"),
  description: z.string().min(1).max(1024),
  systemPromptTemplate: z.string().min(1).max(32768),
  defaultRoles: z.array(z.string().min(1)).default([]),
  defaultAllowedTools: z.array(z.string().min(1)).optional(),
  defaultIsolation: workspaceIsolationModeSchema.default("inherit"),
  defaultBudgetTokens: z.number().int().positive().optional(),
  defaultTimeoutSeconds: z.number().int().positive().default(600),
  skills: z.array(z.string().min(1)).default([]),
});
export type DefineSubagentParams = z.infer<typeof defineSubagentParamsSchema>;

export const defineSubagentResultSchema = z.object({
  definitionId: z.string().uuid(),
  name: z.string(),
  archetype: subagentArchetypeSchema,
  registered: z.boolean(),
});
export type DefineSubagentResult = z.infer<typeof defineSubagentResultSchema>;

/* ------------------------------------------------------------------ */
/* 6. Helper Functions & Pure Utilities                               */
/* ------------------------------------------------------------------ */

/**
 * Valid state transitions for the Subagent finite state machine.
 */
const VALID_STATE_TRANSITIONS: Readonly<Record<SubagentState, ReadonlySet<SubagentState>>> = {
  running: new Set([
    "idle",
    "waiting_for_input",
    "waiting_for_dependents",
    "waiting_for_message",
    "canceling",
    "errored",
    "executing",
    "blocked",
    "completed",
    "failed",
    "terminated",
  ]),
  idle: new Set([
    "running",
    "waiting_for_input",
    "waiting_for_dependents",
    "waiting_for_message",
    "canceling",
    "errored",
    "executing",
    "blocked",
    "completed",
    "failed",
    "terminated",
  ]),
  waiting_for_input: new Set(["running", "idle", "canceling", "errored", "executing", "blocked", "completed", "failed", "terminated"]),
  waiting_for_dependents: new Set(["running", "idle", "canceling", "errored", "executing", "blocked", "completed", "failed", "terminated"]),
  waiting_for_message: new Set(["running", "idle", "canceling", "errored", "executing", "blocked", "completed", "failed", "terminated"]),
  canceling: new Set(["errored", "idle", "failed", "terminated"]),
  errored: new Set([]), // terminal state
  spawning: new Set(["running", "idle", "executing", "canceling", "errored", "failed", "terminated"]),
  executing: new Set(["running", "idle", "waiting_for_input", "waiting_for_dependents", "waiting_for_message", "blocked", "completed", "failed", "canceling", "errored", "terminated"]),
  blocked: new Set(["running", "idle", "executing", "canceling", "errored", "failed", "terminated"]),
  completed: new Set(["idle", "running"]),
  failed: new Set([]), // terminal state
  terminated: new Set([]), // terminal state
};

/**
 * Determines whether a subagent state transition from `current` to `next` is valid.
 */
export function isValidStateTransition(
  current: SubagentState,
  next: SubagentState
): boolean {
  if (current === next) return true; // Self-transitions are idempotent
  const allowed = VALID_STATE_TRANSITIONS[current];
  return allowed ? allowed.has(next) : false;
}

/** Alias for isValidStateTransition. */
export const canTransitionState = isValidStateTransition;

/**
 * Returns true if the subagent is in an active non-terminal state.
 */
export function isSubagentActive(state: SubagentState): boolean {
  return state !== "errored";
}

/**
 * Returns true if the subagent state represents a waiting/suspended condition.
 */
export function isSubagentWaiting(state: SubagentState): boolean {
  return (
    state === "idle" ||
    state === "waiting_for_input" ||
    state === "waiting_for_dependents" ||
    state === "waiting_for_message"
  );
}

/**
 * Validates a proposed subagent name against character restrictions.
 * Allowed: alphanumeric characters, underscores, and hyphens (1-64 chars).
 */
export function validateSubagentName(name: string): boolean {
  if (!name || name.length < 1 || name.length > 64) return false;
  return subagentNameRegex.test(name);
}

/**
 * Creates a validated SubagentMessage payload.
 */
export function createSubagentMessage(params: {
  messageId?: string;
  senderId: string;
  senderName?: string;
  recipientId: string;
  subject: string;
  body: string;
  timestamp?: string;
  referencedArtifacts?: string[];
  priority?: MessagePriority;
  correlationId?: string;
}): SubagentMessage {
  const messageId = params.messageId ?? crypto.randomUUID();
  const timestamp = params.timestamp ?? new Date().toISOString();

  return subagentMessageSchema.parse({
    messageId,
    senderId: params.senderId,
    senderName: params.senderName,
    recipientId: params.recipientId,
    timestamp,
    subject: params.subject,
    body: params.body,
    referencedArtifacts: params.referencedArtifacts ?? [],
    priority: params.priority ?? "normal",
    correlationId: params.correlationId,
  });
}

/**
 * Wakeup Trigger types for reactive transcript formatting.
 */
export type WakeupTriggerType =
  | "MESSAGE_RECEIVED"
  | "CHILD_COMPLETED"
  | "CHILD_ERRORED"
  | "TASK_COMPLETED"
  | "TIMER_EXPIRED"
  | "SENDER_TERMINATED"
  | "STATE_CHANGED";

export interface WakeupNotificationOptions {
  trigger: WakeupTriggerType | string;
  sourceId: string;
  sourceName?: string;
  timestamp?: string;
  summary: string;
  attachedArtifact?: string;
  details?: Record<string, unknown>;
}

/**
 * Formats a structured `<system_notification>` block for injecting reactive
 * wakeups into an agent's prompt transcript without polling.
 */
export function formatWakeupNotification(options: WakeupNotificationOptions): string {
  const at = options.timestamp ?? new Date().toISOString();
  const nameSuffix = options.sourceName ? ` (${options.sourceName})` : "";
  const lines: string[] = [
    "<system_notification>",
    `## Reactive Wakeup Trigger: ${options.trigger}`,
    `- **Source**: ${options.sourceId}${nameSuffix}`,
    `- **Timestamp**: ${at}`,
    `- **Payload Summary**: ${options.summary}`,
  ];

  if (options.attachedArtifact) {
    lines.push(`- **Attached Artifact**: ${options.attachedArtifact}`);
  }

  if (options.details && Object.keys(options.details).length > 0) {
    lines.push(`- **Details**: ${JSON.stringify(options.details)}`);
  }

  lines.push("</system_notification>");
  return lines.join("\n");
}

/**
 * Creates a zero-initialized SubagentTelemetry object.
 */
export function createDefaultSubagentTelemetry(): SubagentTelemetry {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    tokensPerSecond: 0,
    turnCount: 0,
    avgTurnLatencyMs: 0,
    lastTurnLatencyMs: 0,
    p95TurnLatencyMs: 0,
    totalDurationMs: 0,
    toolDurationMs: 0,
  };
}

