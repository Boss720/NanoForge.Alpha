/**
 * Turn Events & Streaming Token Deltas Wire Protocol.
 *
 * Provides normalized schemas and types for streaming model inference deltas,
 * chunk metadata, token usage accounting, finish reasons, and turn synchronization.
 *
 * ZERO Node.js runtime dependencies (pure TypeScript/Zod).
 */

import { z } from "zod";
import { jsonValueSchema } from "./json";
import { toolRiskTierSchema, type ToolRiskTier } from "./tools";

/* ------------------------------------------------------------------ */
/* 1. Finish Reasons & Token Usage                                    */
/* ------------------------------------------------------------------ */

export const finishReasonSchema = z.enum([
  "stop",           // Natural end of generation
  "tool_calls",     // Model proposed one or more tool calls
  "length",         // Max token limit reached
  "content_filter", // Content safety policy triggered
  "abort",          // Generation aborted by client/cancellation
  "timeout",        // Stream timed out
]);
export type FinishReason = z.infer<typeof finishReasonSchema>;

export const tokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  cachedTokens: z.number().int().nonnegative().optional(),
  cachedReadTokens: z.number().int().nonnegative().optional(),
  cachedWriteTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const chunkMetadataSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  isFirstChunk: z.boolean().default(false),
  isLastChunk: z.boolean().default(false),
  timestamp: z.string().datetime(),
  latencyMs: z.number().nonnegative().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
});
export type ChunkMetadata = z.infer<typeof chunkMetadataSchema>;

/* ------------------------------------------------------------------ */
/* 2. ProviderDelta Discriminated Union                               */
/* ------------------------------------------------------------------ */

export const providerDeltaSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
    metadata: chunkMetadataSchema.optional(),
  }),
  z.object({
    type: z.literal("thinking"),
    text: z.string(),
    signature: z.string().optional(),
    metadata: chunkMetadataSchema.optional(),
  }),
  z.object({
    type: z.literal("tool_proposal"),
    callId: z.string().min(1).default("call_default"),
    name: z.string().min(1),
    args: jsonValueSchema,
    riskTier: toolRiskTierSchema.optional(),
    justification: z.string().optional(),
  }),
  z.object({
    type: z.literal("usage"),
    usage: tokenUsageSchema.optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("done"),
    finishReason: finishReasonSchema.default("stop"),
    usage: tokenUsageSchema.optional(),
  }),
]);
export type ProviderDelta = z.infer<typeof providerDeltaSchema>;

/* ------------------------------------------------------------------ */
/* 3. Turn State & Turn Synchronization                              */
/* ------------------------------------------------------------------ */

export const turnSpeakerSchema = z.enum(["user", "agent", "tool", "system"]);
export type TurnSpeaker = z.infer<typeof turnSpeakerSchema>;

export const turnStateSchema = z.enum([
  "started",
  "thinking",
  "executing",
  "completed",
  "interrupted",
  "error",
]);
export type TurnState = z.infer<typeof turnStateSchema>;

export const turnSyncSchema = z.object({
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  turnNumber: z.number().int().nonnegative().default(0),
  speaker: turnSpeakerSchema,
  promptText: z.string().optional(),
  responseText: z.string().optional(),
  toolCallsCount: z.number().int().nonnegative().default(0),
  usage: tokenUsageSchema.optional(),
  latencyMs: z.number().nonnegative().optional(),
  state: turnStateSchema,
  timestamp: z.string().datetime(),
});
export type TurnSync = z.infer<typeof turnSyncSchema>;

export const turnEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("turn.started"),
    sessionId: z.string().min(1),
    turnId: z.string().min(1),
    turnNumber: z.number().int().nonnegative(),
    speaker: turnSpeakerSchema,
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal("turn.delta"),
    sessionId: z.string().min(1),
    turnId: z.string().min(1),
    delta: providerDeltaSchema,
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal("turn.completed"),
    sessionId: z.string().min(1),
    turnId: z.string().min(1),
    turn: turnSyncSchema,
    timestamp: z.string().datetime(),
  }),
  z.object({
    type: z.literal("turn.error"),
    sessionId: z.string().min(1),
    turnId: z.string().min(1),
    code: z.string(),
    message: z.string(),
    timestamp: z.string().datetime(),
  }),
]);
export type TurnEvent = z.infer<typeof turnEventSchema>;

/* ------------------------------------------------------------------ */
/* 4. Pure Helper Utilities                                           */
/* ------------------------------------------------------------------ */

export function createTokenUsage(
  promptTokens: number,
  completionTokens: number,
  cachedTokens = 0,
  estimatedCostUsd?: number
): TokenUsage {
  const prompt = Math.max(0, Math.floor(promptTokens));
  const completion = Math.max(0, Math.floor(completionTokens));
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
    cachedTokens: Math.max(0, Math.floor(cachedTokens)),
    estimatedCostUsd: estimatedCostUsd !== undefined ? Math.max(0, estimatedCostUsd) : undefined,
  };
}

export function accumulateTokenUsage(base: TokenUsage, delta: TokenUsage): TokenUsage {
  const prompt = base.promptTokens + delta.promptTokens;
  const completion = base.completionTokens + delta.completionTokens;
  const total = prompt + completion;
  const cached = (base.cachedTokens ?? 0) + (delta.cachedTokens ?? 0);
  const cachedRead = (base.cachedReadTokens ?? 0) + (delta.cachedReadTokens ?? 0);
  const cachedWrite = (base.cachedWriteTokens ?? 0) + (delta.cachedWriteTokens ?? 0);
  const cost =
    base.estimatedCostUsd !== undefined || delta.estimatedCostUsd !== undefined
      ? (base.estimatedCostUsd ?? 0) + (delta.estimatedCostUsd ?? 0)
      : undefined;

  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    cachedTokens: cached > 0 ? cached : undefined,
    cachedReadTokens: cachedRead > 0 ? cachedRead : undefined,
    cachedWriteTokens: cachedWrite > 0 ? cachedWrite : undefined,
    estimatedCostUsd: cost,
  };
}

export function isTerminalDelta(delta: ProviderDelta | { type: string }): boolean {
  return delta.type === "done" || delta.type === "error";
}
