/**
 * 4-Tier Risk Matrix, Tool Governance & Execution Result Schemas.
 *
 * Defines the risk classification model, tool proposals, interactive user
 * approval gates, permission evaluation verdicts, and structured tool outcomes.
 *
 * ZERO Node.js runtime dependencies (pure TypeScript/Zod).
 */

import { z } from "zod";
import { type JsonValue, jsonValueSchema } from "./json";

/* ------------------------------------------------------------------ */
/* 1. 4-Tier Risk Matrix                                              */
/* ------------------------------------------------------------------ */

/**
 * 4-tier risk classification:
 * - "T0_READ_ONLY": Non-mutating read operations (view_file, list_dir, grep_search, memory.get).
 * - "T1_WORKSPACE_WRITE": Workspace file mutations inside boundary (write_to_file, replace_file_content).
 * - "T2_SIDE_EFFECT_GUARDED": Process execution or external network calls (terminal.exec, pty.spawn).
 * - "T3_DESTRUCTIVE_ADMIN": Destructive operations, root access, or actions outside workspace.
 */
export const toolRiskTierSchema = z.enum([
  "T0_READ_ONLY",
  "T1_WORKSPACE_WRITE",
  "T2_SIDE_EFFECT_GUARDED",
  "T3_DESTRUCTIVE_ADMIN",
]);
export type ToolRiskTier = z.infer<typeof toolRiskTierSchema>;

export const RISK_TIER_RANK: Readonly<Record<ToolRiskTier, number>> = {
  T0_READ_ONLY: 0,
  T1_WORKSPACE_WRITE: 1,
  T2_SIDE_EFFECT_GUARDED: 2,
  T3_DESTRUCTIVE_ADMIN: 3,
};

/* ------------------------------------------------------------------ */
/* 2. Proposed Tool Call Schema                                       */
/* ------------------------------------------------------------------ */

export const proposedToolCallSchema = z.object({
  callId: z.string().min(1).max(128),
  toolName: z.string().min(1).max(128),
  riskTier: toolRiskTierSchema.default("T2_SIDE_EFFECT_GUARDED"),
  params: z.record(z.string(), jsonValueSchema),
  justification: z.string().max(4096).optional(),
  checkpointRequired: z.boolean().default(false),
  timeoutMs: z.number().int().positive().optional(),
});
export type ProposedToolCall = z.infer<typeof proposedToolCallSchema>;

/* ------------------------------------------------------------------ */
/* 3. Permission Decisions & Approval Gates                           */
/* ------------------------------------------------------------------ */

export const permissionVerdictSchema = z.enum([
  "ALLOW_ALWAYS",
  "ALLOW_ONCE",
  "DENY",
  "PROMPT_USER",
]);
export type PermissionVerdict = z.infer<typeof permissionVerdictSchema>;

export const permissionDecisionSchema = z.discriminatedUnion("verdict", [
  z.object({
    verdict: z.literal("ALLOW_ALWAYS"),
    reason: z.string().max(4096),
    matchedRule: z.string().optional(),
  }),
  z.object({
    verdict: z.literal("ALLOW_ONCE"),
    reason: z.string().max(4096),
  }),
  z.object({
    verdict: z.literal("DENY"),
    reason: z.string().max(4096),
  }),
  z.object({
    verdict: z.literal("PROMPT_USER"),
    promptMessage: z.string().max(4096),
    defaultAction: z.enum(["ALLOW", "DENY"]).default("DENY"),
    suggestedScope: z.string().optional(),
  }),
]);
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;

export const approvalRequestSchema = z.object({
  requestId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128),
  toolCall: proposedToolCallSchema,
  reason: z.string().max(4096),
  at: z.string().datetime(),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const approvalResponseSchema = z.object({
  requestId: z.string().min(1).max(128),
  runId: z.string().min(1).max(128).optional(),
  approved: z.boolean(),
  reason: z.string().max(4096).optional(),
  at: z.string().datetime().optional(),
});
export type ApprovalResponse = z.infer<typeof approvalResponseSchema>;

/* ------------------------------------------------------------------ */
/* 4. Tool Execution Results & Outcomes                               */
/* ------------------------------------------------------------------ */

export const toolExecutionStatusSchema = z.enum([
  "SUCCESS",
  "PERMISSION_DENIED",
  "EXECUTION_ERROR",
  "TIMEOUT",
  "CANCELLED",
]);
export type ToolExecutionStatus = z.infer<typeof toolExecutionStatusSchema>;

export const toolExecutionMetadataSchema = z.object({
  exitCode: z.number().int().nullable().optional(),
  durationMs: z.number().nonnegative(),
  bytesWritten: z.number().int().nonnegative().optional(),
  sha256Digest: z.string().optional(),
  truncated: z.boolean().default(false),
  checkpointId: z.string().optional(),
});
export type ToolExecutionMetadata = z.infer<typeof toolExecutionMetadataSchema>;

export const toolExecutionResultSchema = z.object({
  callId: z.string().min(1).max(128),
  toolName: z.string().min(1).max(128),
  status: toolExecutionStatusSchema,
  output: z.string(),
  error: z.string().optional(),
  metadata: toolExecutionMetadataSchema,
  timestamp: z.string().datetime(),
});
export type ToolExecutionResult = z.infer<typeof toolExecutionResultSchema>;

/* ------------------------------------------------------------------ */
/* 5. Pure Helper Utilities                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_TOOL_RISK_MAP: Readonly<Record<string, ToolRiskTier>> = {
  view_file: "T0_READ_ONLY",
  list_dir: "T0_READ_ONLY",
  grep_search: "T0_READ_ONLY",
  find_by_name: "T0_READ_ONLY",
  read_url_content: "T0_READ_ONLY",
  search_web: "T0_READ_ONLY",
  "memory.get": "T0_READ_ONLY",
  "memory.query": "T0_READ_ONLY",
  write_to_file: "T1_WORKSPACE_WRITE",
  replace_file_content: "T1_WORKSPACE_WRITE",
  notebook_edit: "T1_WORKSPACE_WRITE",
  generate_image: "T1_WORKSPACE_WRITE",
  "memory.set": "T1_WORKSPACE_WRITE",
  "memory.delete": "T1_WORKSPACE_WRITE",
  run_command: "T2_SIDE_EFFECT_GUARDED",
  "terminal.exec": "T2_SIDE_EFFECT_GUARDED",
  "terminal.create": "T2_SIDE_EFFECT_GUARDED",
  schedule: "T2_SIDE_EFFECT_GUARDED",
  manage_task: "T2_SIDE_EFFECT_GUARDED",
  send_message: "T2_SIDE_EFFECT_GUARDED",
  invoke_subagent: "T2_SIDE_EFFECT_GUARDED",
  system_admin: "T3_DESTRUCTIVE_ADMIN",
  delete_root: "T3_DESTRUCTIVE_ADMIN",
};

export function classifyToolRisk(
  toolName: string,
  defaultTier: ToolRiskTier = "T2_SIDE_EFFECT_GUARDED"
): ToolRiskTier {
  if (Object.prototype.hasOwnProperty.call(DEFAULT_TOOL_RISK_MAP, toolName)) {
    return DEFAULT_TOOL_RISK_MAP[toolName];
  }
  return defaultTier;
}

export function requiresHumanApproval(
  tier: ToolRiskTier,
  autoApproveUpTo: ToolRiskTier = "T0_READ_ONLY"
): boolean {
  return RISK_TIER_RANK[tier] > RISK_TIER_RANK[autoApproveUpTo];
}

export function createProposedToolCall(
  callId: string,
  toolName: string,
  params: Record<string, JsonValue>,
  options?: Partial<Omit<ProposedToolCall, "callId" | "toolName" | "params">>
): ProposedToolCall {
  return {
    callId,
    toolName,
    riskTier: options?.riskTier ?? classifyToolRisk(toolName),
    params,
    justification: options?.justification,
    checkpointRequired: options?.checkpointRequired ?? false,
    timeoutMs: options?.timeoutMs,
  };
}

export function createToolExecutionResult(
  callId: string,
  toolName: string,
  status: ToolExecutionStatus,
  output: string,
  metadata?: Partial<ToolExecutionMetadata>,
  error?: string,
  timestamp = new Date().toISOString()
): ToolExecutionResult {
  return {
    callId,
    toolName,
    status,
    output,
    error,
    metadata: {
      exitCode: metadata?.exitCode !== undefined ? metadata.exitCode : (status === "SUCCESS" ? 0 : 1),
      durationMs: metadata?.durationMs ?? 0,
      bytesWritten: metadata?.bytesWritten,
      sha256Digest: metadata?.sha256Digest,
      truncated: metadata?.truncated ?? false,
      checkpointId: metadata?.checkpointId,
    },
    timestamp,
  };
}

export function isToolExecutionSuccessful(result: ToolExecutionResult): boolean {
  return result.status === "SUCCESS";
}
