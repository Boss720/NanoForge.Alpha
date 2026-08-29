/**
 * WebSocket protocol contracts — Module 2, Task 4.
 *
 * Zod schemas for every message that crosses
 * `ws://127.0.0.1:<port>/agent?token=<single-use-token>`, in both directions.
 * The host validates EVERY incoming client message; a schema violation closes
 * the socket with code 4400. The UI `hostClient` (Task 7) consumes the
 * inferred TypeScript types exported here, so event/state names are frozen:
 * run states are exactly `queued | approval_required | running | done |
 * error | cancelled`.
 */
import { z } from "zod";
import { executionPlanSchema, type ExecutionPlan } from "@protocol/plan";
import { jsonValueSchema } from "@protocol/json";
import {
  planSubmitResultSchema,
  runPauseResultSchema,
  runResumeResultSchema,
  runCancelResultSchema,
  approvalGrantResultSchema,
  approvalDenyResultSchema,
  toolResponseResultSchema,
  type PlanSubmitResult,
  type RunPauseResult,
  type RunResumeResult,
  type RunCancelResult,
  type ApprovalGrantResult,
  type ApprovalDenyResult,
  type ToolResponseResult,
} from "@protocol/lifecycle";
import {
  workspaceDescribeRequestSchema,
  workspaceErrorSchema,
  workspaceGitStatusRequestSchema,
  workspaceOpenRequestSchema,
  workspaceReadDirRequestSchema,
  workspaceReadFileRequestSchema,
  workspaceReadySchema,
  workspaceSearchRequestSchema,
  workspaceStatRequestSchema,
  workspaceUnwatchRequestSchema,
  workspaceWatchRequestSchema,
  workspaceWatchResultSchema,
  workspaceWriteRequestSchema,
  workspaceWriteResultSchema,
} from "@protocol/workspace";
import {
  invokeSubagentParamsSchema,
  invokeSubagentResultSchema,
  manageSubagentsParamsSchema,
  manageSubagentsResultSchema,
  sendMessageParamsSchema,
  sendMessageResultSchema,
  defineSubagentParamsSchema,
  defineSubagentResultSchema,
  subagentInfoSchema,
  subagentMessageSchema,
  subagentLifecycleEventSchema,
} from "@protocol/subagents";
import {
  manageTaskParamsSchema,
  manageTaskResultSchema,
  scheduleParamsSchema,
  scheduleResultSchema,
  taskSummarySchema,
  taskLifecycleEventSchema,
} from "@protocol/tasks";
import {
  memorySetParamsSchema,
  memorySetResultSchema,
  memoryGetParamsSchema,
  memoryGetResultSchema,
  memoryQueryParamsSchema,
  memoryQueryResultSchema,
  memoryDeleteParamsSchema,
  memoryDeleteResultSchema,
  memoryLifecycleEventSchema,
} from "@protocol/memory";
import {
  voiceCallStatusSchema,
  voiceCallEndReasonSchema,
  voiceInterruptReasonSchema,
  voiceProfileSchema,
  voiceParticipantSchema,
  voiceCallSessionSchema,
  voiceTranscriptFrameSchema,
  voiceTtsChunkSchema,
  voiceTurnSyncSchema,
  voiceInterruptFrameSchema,
  type VoiceCallStatus,
  type VoiceCallEndReason,
  type VoiceInterruptReason,
  type VoiceProfile,
  type VoiceParticipant,
  type VoiceCallSession,
  type VoiceTranscriptFrame,
  type VoiceTtsChunk,
  type VoiceTurnSync,
  type VoiceInterruptFrame,
  type VoiceClientMessage,
  type VoiceHostEvent,
} from "@protocol/voice";

export {
  planSubmitResultSchema,
  runPauseResultSchema,
  runResumeResultSchema,
  runCancelResultSchema,
  approvalGrantResultSchema,
  approvalDenyResultSchema,
  toolResponseResultSchema,
  type PlanSubmitResult,
  type RunPauseResult,
  type RunResumeResult,
  type RunCancelResult,
  type ApprovalGrantResult,
  type ApprovalDenyResult,
  type ToolResponseResult,
};

/** Canonical run lifecycle states shared with the UI tool cards. */
export const RUN_STATES = [
  "queued",
  "approval_required",
  "running",
  "done",
  "error",
  "cancelled",
] as const;

export const runStateSchema = z.enum(RUN_STATES);
export type RunState = z.infer<typeof runStateSchema>;

/** Bounded identifier (plan ids, run ids, approval request ids). */
const idSchema = z.string().min(1).max(128);

/** ISO-8601 timestamp carried by every host-originated event. */
const atSchema = z.string().min(1);

/**
 * Wire shape of a tool execution proposal. Mirrors
 * `policy/policy.ts` `ToolRequest` (kind "terminal.exec"); later kinds
 * (browser.*, mcp.call) extend this object literal union.
 */
export const toolRequestSchema = z.object({
  kind: z.literal("terminal.exec"),
  cwd: z.string().min(1).max(4096),
  executable: z.string().min(1).max(1024),
  args: z.array(z.string().max(8192)).max(256),
});
export type ToolRequestMessage = z.infer<typeof toolRequestSchema>;

/* ------------------------------------------------------------------------ */
/* Capability approval protocol                                             */
/* ------------------------------------------------------------------------ */

/** Opaque wire identifiers must never be used to smuggle paths or payloads. */
const capabilityIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const capabilityDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/i);
const capabilityTimestampSchema = z.string().datetime({ offset: true });
export const capabilityScopeSchema = z.enum([
  "read",
  "write",
  "execute",
  "network",
  "browser",
  "mcp",
  "schedule",
]);
export type CapabilityScope = z.infer<typeof capabilityScopeSchema>;
export const capabilityUsesSchema = z.enum(["single", "multi"]);
export type CapabilityUses = z.infer<typeof capabilityUsesSchema>;

/**
 * Host-issued authority. It is deliberately only a binding and digest: raw
 * arguments, executable payloads, secrets, and canonical paths do not cross
 * this protocol in a grant.
 */
export const capabilityGrantSchema = z
  .object({
    grantId: capabilityIdSchema,
    hostId: capabilityIdSchema,
    sessionId: capabilityIdSchema,
    workspaceId: capabilityIdSchema,
    generation: z.number().int().positive(),
    runId: capabilityIdSchema,
    stepId: capabilityIdSchema,
    toolId: capabilityIdSchema,
    argumentsDigest: capabilityDigestSchema,
    scope: capabilityScopeSchema,
    issuedAt: capabilityTimestampSchema,
    expiresAt: capabilityTimestampSchema,
    uses: capabilityUsesSchema,
  })
  .strict();
export type CapabilityGrant = z.infer<typeof capabilityGrantSchema>;

export const capabilityApprovalRequestSchema = z
  .object({
    type: z.literal("capability.approval_required"),
    requestId: capabilityIdSchema,
    hostId: capabilityIdSchema,
    sessionId: capabilityIdSchema,
    workspaceId: capabilityIdSchema,
    generation: z.number().int().positive(),
    runId: capabilityIdSchema,
    stepId: capabilityIdSchema,
    toolId: capabilityIdSchema,
    argumentsDigest: capabilityDigestSchema,
    scope: capabilityScopeSchema,
    expiresAt: capabilityTimestampSchema,
    uses: capabilityUsesSchema,
    reason: z.string().min(1).max(4096),
    at: capabilityTimestampSchema,
  })
  .strict();
export type CapabilityApprovalRequest = z.infer<
  typeof capabilityApprovalRequestSchema
>;

export const capabilityApprovalDecisionSchema = z
  .object({
    type: z.literal("capability.approval"),
    requestId: capabilityIdSchema,
    approved: z.boolean(),
    reason: z.string().max(4096).optional(),
  })
  .strict();
export type CapabilityApprovalDecision = z.infer<
  typeof capabilityApprovalDecisionSchema
>;

export const capabilityResultSchema = z
  .object({
    type: z.literal("capability.result"),
    requestId: capabilityIdSchema,
    ok: z.boolean(),
    grant: capabilityGrantSchema.optional(),
    errorCode: z
      .enum(["invalid_request", "denied", "expired", "stale_binding", "already_used"])
      .optional(),
    errorMessage: z.string().max(4096).optional(),
    at: capabilityTimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ok && (!value.grant || value.errorCode || value.errorMessage)) {
      ctx.addIssue({ code: "custom", path: ["grant"], message: "Successful results require only a grant" });
    }
    if (!value.ok && (!value.errorCode || value.grant)) {
      ctx.addIssue({ code: "custom", path: ["errorCode"], message: "Failed results require an error code" });
    }
  });
export type CapabilityResult = z.infer<typeof capabilityResultSchema>;

/**
 * Plan payload for `plan.submit`. Structurally tolerant (unknown step fields
 * pass through) so the wire protocol stays compatible with
 * `@protocol/plan`'s {@link ExecutionPlan} as it evolves; the host re-validates
 * plans with the Task 2 validator before executing anything.
 */
export const planSubmitSchema = z.object({
  type: z.literal("plan.submit"),
  requestId: idSchema.optional(),
  plan: z.looseObject({
    id: idSchema,
    goal: z.string().max(8192),
    steps: z.array(z.looseObject({ id: idSchema })).max(512),
  }),
});

/* ------------------------------------------------------------------------ */
/* Workspace Types                                                          */
/* ------------------------------------------------------------------------ */

export const dirEntrySchema = z.object({
  name: z.string(),
  isDir: z.boolean(),
  size: z.number().optional(),
  modified: z.string().optional(),
});
export type DirEntry = z.infer<typeof dirEntrySchema>;

export const fileStatSchema = z.object({
  size: z.number(),
  modified: z.string(),
  isDir: z.boolean(),
  isFile: z.boolean(),
});
export type FileStat = z.infer<typeof fileStatSchema>;

export const searchMatchSchema = z.object({
  file: z.string(),
  line: z.number(),
  column: z.number(),
  text: z.string(),
  matchText: z.string(),
});
export type SearchMatch = z.infer<typeof searchMatchSchema>;

export const gitFileStatusSchema = z.object({
  path: z.string(),
  status: z.enum(["M", "A", "D", "R", "?", "!"]),
});
export type GitFileStatus = z.infer<typeof gitFileStatusSchema>;

/* ------------------------------------------------------------------------ */
/* Integrations Types                                                       */
/* ------------------------------------------------------------------------ */

export const integrationHealthSchema = z.enum(["ok", "error", "checking", "unknown"]);
export const integrationKindSchema = z.enum(["rules", "skill", "mcp"]);

export const rulesPackSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  health: integrationHealthSchema,
  lastError: z.string().nullable().optional(),
  source: z.string(),
  digest: z.string(),
  priority: z.number().optional(),
});

export const skillSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  allowedTools: z.array(z.string()),
  instructions: z.string(),
  hashValid: z.boolean(),
  enabled: z.boolean(),
  health: integrationHealthSchema,
  lastError: z.string().nullable().optional(),
});

export const mcpServerSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  tools: z.array(z.string()),
  secretRefs: z.array(z.string()).optional(),
  enabled: z.boolean(),
  health: integrationHealthSchema,
  lastError: z.string().nullable().optional(),
});

export const integrationsSnapshotSchema = z.object({
  rulesPacks: z.array(rulesPackSnapshotSchema),
  skills: z.array(skillSnapshotSchema),
  mcpServers: z.array(mcpServerSnapshotSchema),
});
export type IntegrationsSnapshot = z.infer<typeof integrationsSnapshotSchema>;

/* ------------------------------------------------------------------------ */
/* Client -> Host                                                           */
/* ------------------------------------------------------------------------ */

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  planSubmitSchema,
  z.object({
    type: z.literal("approval.grant"),
    requestId: idSchema,
    runId: idSchema.optional(),
    stepId: idSchema.optional(),
  }),
  z.object({
    type: z.literal("approval.deny"),
    requestId: idSchema,
    runId: idSchema.optional(),
    stepId: idSchema.optional(),
    reason: z.string().max(4096).optional(),
  }),
  capabilityApprovalDecisionSchema,
  z.object({
    type: z.literal("run.pause"),
    runId: idSchema,
    requestId: idSchema.optional(),
  }),
  z.object({
    type: z.literal("run.resume"),
    runId: idSchema,
    requestId: idSchema.optional(),
  }),
  z.object({
    type: z.literal("run.cancel"),
    runId: idSchema,
    requestId: idSchema.optional(),
    reason: z.string().max(4096).optional(),
  }),
  /** Client answer to a host `tool.approval_required` request. */
  z.object({
    type: z.literal("tool.response"),
    requestId: idSchema,
    approved: z.boolean(),
    reason: z.string().max(4096).optional(),
  }),
  // Workspace RPCs
  workspaceDescribeRequestSchema,
  workspaceOpenRequestSchema,
  workspaceReadDirRequestSchema,
  workspaceReadFileRequestSchema,
  workspaceWriteRequestSchema,
  workspaceStatRequestSchema,
  workspaceSearchRequestSchema,
  workspaceGitStatusRequestSchema,
  workspaceWatchRequestSchema,
  workspaceUnwatchRequestSchema,
  z.object({
    type: z.literal("integration.toggle"),
    requestId: idSchema,
    kind: integrationKindSchema,
    id: idSchema,
    enabled: z.boolean(),
  }),
  // Subagent RPCs
  z.object({
    type: z.literal("subagent.invoke"),
    requestId: idSchema,
    params: invokeSubagentParamsSchema,
    parentId: z.string().optional(),
  }),
  z.object({
    type: z.literal("subagent.manage"),
    requestId: idSchema,
    params: manageSubagentsParamsSchema,
    callerId: z.string().optional(),
  }),
  z.object({
    type: z.literal("subagent.sendMessage"),
    requestId: idSchema,
    params: sendMessageParamsSchema,
    senderId: z.string(),
  }),
  z.object({
    type: z.literal("subagent.define"),
    requestId: idSchema,
    params: defineSubagentParamsSchema,
  }),
  // Daemon & Schedule RPCs
  z.object({
    type: z.literal("task.manage"),
    requestId: idSchema,
    params: manageTaskParamsSchema,
  }),
  z.object({
    type: z.literal("schedule.create"),
    requestId: idSchema,
    params: scheduleParamsSchema,
    creatorSubagentId: z.string().optional(),
  }),
  // Memory RPCs
  z.object({
    type: z.literal("memory.set"),
    requestId: idSchema,
    params: memorySetParamsSchema,
    authorInfo: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("memory.get"),
    requestId: idSchema,
    params: memoryGetParamsSchema,
  }),
  z.object({
    type: z.literal("memory.query"),
    requestId: idSchema,
    params: memoryQueryParamsSchema,
  }),
  z.object({
    type: z.literal("memory.delete"),
    requestId: idSchema,
    params: memoryDeleteParamsSchema,
  }),
  // Voice Call RPCs
  z.object({
    type: z.literal("voice.session.start"),
    requestId: idSchema,
    voiceProfile: voiceProfileSchema.partial().optional(),
    participant: voiceParticipantSchema.partial().optional(),
    inputGain: z.number().min(0).max(2).optional(),
    outputVolume: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("voice.session.pause"),
    requestId: idSchema,
    sessionId: idSchema,
  }),
  z.object({
    type: z.literal("voice.session.resume"),
    requestId: idSchema,
    sessionId: idSchema,
  }),
  z.object({
    type: z.literal("voice.session.end"),
    requestId: idSchema,
    sessionId: idSchema,
    reason: voiceCallEndReasonSchema.optional(),
  }),
  z.object({
    type: z.literal("voice.session.mute"),
    requestId: idSchema,
    sessionId: idSchema,
    muted: z.boolean(),
  }),
  z.object({
    type: z.literal("voice.session.gain"),
    requestId: idSchema,
    sessionId: idSchema,
    inputGain: z.number().min(0).max(2).optional(),
    outputVolume: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("voice.transcript.submit"),
    requestId: idSchema,
    sessionId: idSchema,
    turnId: idSchema,
    text: z.string().max(32768),
    isFinal: z.boolean(),
    confidence: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("voice.interrupt"),
    requestId: idSchema,
    sessionId: idSchema,
    turnId: idSchema.optional(),
    reason: voiceInterruptReasonSchema,
    spokenTextSnippet: z.string().max(4096).optional(),
  }),
  z.object({
    type: z.literal("voice.audio.chunk"),
    requestId: idSchema,
    sessionId: idSchema,
    turnId: idSchema.optional(),
    data: z.string(),
    format: z.string().optional(),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageType = ClientMessage["type"];

/* ------------------------------------------------------------------------ */
/* Host -> Client                                                           */
/* ------------------------------------------------------------------------ */

export const hostMessageSchema = z.discriminatedUnion("type", [
  /** First frame after a successful handshake. */
  z.object({
    type: z.literal("host.ready"),
    version: z.string(),
    hostId: idSchema,
    workspace: workspaceReadySchema.shape.workspace.optional(),
    at: atSchema,
  }),
  z.object({ type: z.literal("pong"), at: atSchema }),
  /** Run lifecycle transition; `state` is one of RUN_STATES. */
  z.object({
    type: z.literal("run.state"),
    runId: idSchema,
    state: runStateSchema,
    at: atSchema,
    detail: z.string().max(4096).optional(),
  }),
  /** Policy/approval gate: execution pauses until the client answers. */
  z.object({
    type: z.literal("tool.approval_required"),
    requestId: idSchema,
    runId: idSchema,
    request: toolRequestSchema,
    reason: z.string().max(4096),
    at: atSchema,
  }),
  capabilityApprovalRequestSchema,
  /** Incremental terminal output. */
  z.object({
    type: z.literal("tool.output"),
    runId: idSchema,
    requestId: idSchema.optional(),
    stream: z.enum(["stdout", "stderr"]),
    chunk: z.string(),
    truncated: z.boolean(),
    at: atSchema,
  }),
  /** Generic run-scoped event (pause requested, artifact written, ...). */
  z.object({
    type: z.literal("run.event"),
    runId: idSchema,
    event: z.string().min(1).max(128),
    data: jsonValueSchema.optional(),
    at: atSchema,
  }),
  z.object({
    type: z.literal("error"),
    code: z.string().min(1).max(128),
    message: z.string().max(4096),
    requestId: idSchema.optional(),
    runId: idSchema.optional(),
    at: atSchema.optional(),
  }),
  // Run Control & Acknowledgement Result Frames
  planSubmitResultSchema,
  runPauseResultSchema,
  runResumeResultSchema,
  runCancelResultSchema,
  approvalGrantResultSchema,
  approvalDenyResultSchema,
  toolResponseResultSchema,
  capabilityResultSchema,
  // Workspace RPC Results
  workspaceReadySchema,
  workspaceErrorSchema,
  z.object({ type: z.literal("workspace.readDir.result"), requestId: idSchema, path: z.string(), entries: z.array(dirEntrySchema), generation: z.number().int().positive() }),
  z.object({ type: z.literal("workspace.readFile.result"), requestId: idSchema, path: z.string(), content: z.string(), language: z.string(), size: z.number(), modified: z.string().datetime(), sha256: z.string().regex(/^[a-f0-9]{64}$/i), generation: z.number().int().positive() }),
  workspaceWriteResultSchema,
  z.object({ type: z.literal("workspace.stat.result"), requestId: idSchema, path: z.string(), stat: fileStatSchema, generation: z.number().int().positive() }),
  z.object({ type: z.literal("workspace.search.result"), requestId: idSchema, matches: z.array(searchMatchSchema), generation: z.number().int().positive() }),
  z.object({ type: z.literal("workspace.gitStatus.result"), requestId: idSchema, files: z.array(gitFileStatusSchema), generation: z.number().int().positive() }),
  workspaceWatchResultSchema,
  z.object({ type: z.literal("workspace.fileChanged"), path: z.string(), changeType: z.enum(["created", "modified", "deleted"]), generation: z.number().int().positive() }),
  z.object({
    type: z.literal("integrations.snapshot"),
    requestId: idSchema.optional(),
    snapshot: integrationsSnapshotSchema,
    at: atSchema,
  }),
  // Subagent RPC Results & Events
  z.object({ type: z.literal("subagent.invoke.result"), requestId: idSchema, result: invokeSubagentResultSchema }),
  z.object({ type: z.literal("subagent.manage.result"), requestId: idSchema, result: manageSubagentsResultSchema }),
  z.object({ type: z.literal("subagent.sendMessage.result"), requestId: idSchema, result: sendMessageResultSchema }),
  z.object({ type: z.literal("subagent.define.result"), requestId: idSchema, result: defineSubagentResultSchema }),
  z.object({ type: z.literal("subagent.event"), event: subagentLifecycleEventSchema, at: atSchema }),
  // Task & Schedule RPC Results & Events
  z.object({ type: z.literal("task.manage.result"), requestId: idSchema, result: manageTaskResultSchema }),
  z.object({ type: z.literal("schedule.create.result"), requestId: idSchema, result: scheduleResultSchema }),
  z.object({ type: z.literal("task.event"), event: taskLifecycleEventSchema, at: atSchema }),
  // Memory RPC Results & Events
  z.object({ type: z.literal("memory.set.result"), requestId: idSchema, result: memorySetResultSchema }),
  z.object({ type: z.literal("memory.get.result"), requestId: idSchema, result: memoryGetResultSchema }),
  z.object({ type: z.literal("memory.query.result"), requestId: idSchema, result: memoryQueryResultSchema }),
  z.object({ type: z.literal("memory.delete.result"), requestId: idSchema, result: memoryDeleteResultSchema }),
  z.object({ type: z.literal("memory.event"), event: memoryLifecycleEventSchema, at: atSchema }),
  // Voice Call RPC Results & Events
  z.object({
    type: z.literal("voice.session.ready"),
    requestId: idSchema.optional(),
    session: voiceCallSessionSchema,
    at: atSchema,
  }),
  z.object({
    type: z.literal("voice.session.state"),
    requestId: idSchema.optional(),
    sessionId: idSchema,
    status: voiceCallStatusSchema,
    at: atSchema,
    detail: z.string().max(4096).optional(),
  }),
  z.object({
    type: z.literal("voice.transcript.event"),
    frame: voiceTranscriptFrameSchema,
    at: atSchema,
  }),
  z.object({
    type: z.literal("voice.tts.chunk"),
    chunk: voiceTtsChunkSchema,
    at: atSchema,
  }),
  z.object({
    type: z.literal("voice.turn.event"),
    turn: voiceTurnSyncSchema,
    at: atSchema,
  }),
  z.object({
    type: z.literal("voice.interrupted"),
    frame: voiceInterruptFrameSchema,
    at: atSchema,
  }),
]);

export type HostMessage = z.infer<typeof hostMessageSchema>;
export type HostMessageType = HostMessage["type"];

/** Convenience extracts for the UI hostClient. */
export type RunStateMessage = Extract<HostMessage, { type: "run.state" }>;
export type ToolApprovalRequiredMessage = Extract<
  HostMessage,
  { type: "tool.approval_required" }
>;
export type ToolOutputMessage = Extract<HostMessage, { type: "tool.output" }>;
export type RunEventMessage = Extract<HostMessage, { type: "run.event" }>;
export type HostErrorMessage = Extract<HostMessage, { type: "error" }>;

/** Structural type of a submitted plan payload (aligned with @protocol/plan). */
export type SubmittedPlan = Pick<ExecutionPlan, "id" | "goal"> & {
  steps: Array<Pick<ExecutionPlan["steps"][number], "id">> &
    Record<string, unknown>;
};

export type DecodeResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: "invalid_json" | "schema_violation" };

/**
 * Parse and validate one raw inbound WebSocket frame. The server closes the
 * socket with 4400 on any `{ ok: false }` result.
 */
export function decodeClientMessage(raw: unknown): DecodeResult {
  let parsed: unknown = raw;
  if (typeof raw === "string" || raw instanceof Buffer || Array.isArray(raw)) {
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  }
  const result = clientMessageSchema.safeParse(parsed);
  if (!result.success) return { ok: false, error: "schema_violation" };
  return { ok: true, message: result.data };
}
