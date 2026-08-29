/**
 * Token Spend Metrics, USD Pricing & Latency Telemetry Schemas.
 *
 * Provides pure isomorphic data models for calculating and tracking exact
 * token spend (prompt, completion, cached read/write), USD cost estimation,
 * and fine-grained latency telemetry.
 *
 * ZERO Node.js runtime dependencies (pure TypeScript/Zod).
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 1. Token Spend Metrics & Latency                                   */
/* ------------------------------------------------------------------ */

export const tokenSpendMetricsSchema = z.object({
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  cachedReadTokens: z.number().int().nonnegative().default(0),
  cachedWriteTokens: z.number().int().nonnegative().default(0),
  estimatedCostUsd: z.number().nonnegative().default(0),
});
export type TokenSpendMetrics = z.infer<typeof tokenSpendMetricsSchema>;

export const latencyMetricsSchema = z.object({
  ttftMs: z.number().nonnegative().optional(), // Time to first token
  totalDurationMs: z.number().nonnegative().default(0),
  inferenceDurationMs: z.number().nonnegative().optional(),
  toolDurationMs: z.number().nonnegative().optional(),
  queueDurationMs: z.number().nonnegative().optional(),
});
export type LatencyMetrics = z.infer<typeof latencyMetricsSchema>;

/* ------------------------------------------------------------------ */
/* 2. Model Pricing Catalog & Cost Calculation                        */
/* ------------------------------------------------------------------ */

export const modelPricingSchema = z.object({
  modelId: z.string().min(1),
  provider: z.string().min(1),
  inputCostPer1M: z.number().nonnegative(),
  outputCostPer1M: z.number().nonnegative(),
  cacheReadCostPer1M: z.number().nonnegative().optional(),
  cacheWriteCostPer1M: z.number().nonnegative().optional(),
});
export type ModelPricing = z.infer<typeof modelPricingSchema>;

export const sessionSpendSummarySchema = z.object({
  sessionId: z.string().min(1),
  totalTurns: z.number().int().nonnegative().default(0),
  totalTokens: tokenSpendMetricsSchema,
  totalLatency: latencyMetricsSchema,
  toolCallCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
});
export type SessionSpendSummary = z.infer<typeof sessionSpendSummarySchema>;

/* ------------------------------------------------------------------ */
/* 3. Predefined Model Pricing Catalog                                */
/* ------------------------------------------------------------------ */

export const KNOWN_MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-3-7-sonnet": {
    modelId: "claude-3-7-sonnet",
    provider: "anthropic",
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    cacheReadCostPer1M: 0.3,
    cacheWriteCostPer1M: 3.75,
  },
  "claude-3-5-sonnet": {
    modelId: "claude-3-5-sonnet",
    provider: "anthropic",
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    cacheReadCostPer1M: 0.3,
    cacheWriteCostPer1M: 3.75,
  },
  "claude-3-5-haiku": {
    modelId: "claude-3-5-haiku",
    provider: "anthropic",
    inputCostPer1M: 0.8,
    outputCostPer1M: 4.0,
    cacheReadCostPer1M: 0.08,
    cacheWriteCostPer1M: 1.0,
  },
  "gpt-4o": {
    modelId: "gpt-4o",
    provider: "openai",
    inputCostPer1M: 2.5,
    outputCostPer1M: 10.0,
    cacheReadCostPer1M: 1.25,
  },
  "gpt-4o-mini": {
    modelId: "gpt-4o-mini",
    provider: "openai",
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    cacheReadCostPer1M: 0.075,
  },
  "o3-mini": {
    modelId: "o3-mini",
    provider: "openai",
    inputCostPer1M: 1.1,
    outputCostPer1M: 4.4,
    cacheReadCostPer1M: 0.55,
  },
  "ollama/local": {
    modelId: "ollama/local",
    provider: "ollama",
    inputCostPer1M: 0.0,
    outputCostPer1M: 0.0,
  },
};

/* ------------------------------------------------------------------ */
/* 4. Pure Helper Utilities                                           */
/* ------------------------------------------------------------------ */

export function calculateEstimatedCostUsd(
  pricing: ModelPricing,
  usage: {
    promptTokens: number;
    completionTokens: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
  }
): number {
  const prompt = Math.max(0, usage.promptTokens);
  const completion = Math.max(0, usage.completionTokens);
  const cachedRead = Math.min(prompt, Math.max(0, usage.cachedReadTokens ?? 0));
  const cachedWrite = Math.max(0, usage.cachedWriteTokens ?? 0);
  const unCachedPrompt = Math.max(0, prompt - cachedRead);

  const inputCost = (unCachedPrompt / 1_000_000) * pricing.inputCostPer1M;
  const outputCost = (completion / 1_000_000) * pricing.outputCostPer1M;
  const cacheReadCost = (cachedRead / 1_000_000) * (pricing.cacheReadCostPer1M ?? pricing.inputCostPer1M);
  const cacheWriteCost = (cachedWrite / 1_000_000) * (pricing.cacheWriteCostPer1M ?? pricing.inputCostPer1M);

  const total = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  return Math.round(total * 1_000_000) / 1_000_000;
}

export function createEmptySpendMetrics(): TokenSpendMetrics {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    estimatedCostUsd: 0,
  };
}

export function aggregateSessionSpend(metricsList: TokenSpendMetrics[]): TokenSpendMetrics {
  return metricsList.reduce((acc, curr) => ({
    promptTokens: acc.promptTokens + curr.promptTokens,
    completionTokens: acc.completionTokens + curr.completionTokens,
    totalTokens: acc.totalTokens + curr.totalTokens,
    cachedReadTokens: (acc.cachedReadTokens ?? 0) + (curr.cachedReadTokens ?? 0),
    cachedWriteTokens: (acc.cachedWriteTokens ?? 0) + (curr.cachedWriteTokens ?? 0),
    estimatedCostUsd: Math.round(((acc.estimatedCostUsd ?? 0) + (curr.estimatedCostUsd ?? 0)) * 1_000_000) / 1_000_000,
  }), createEmptySpendMetrics());
}

export function formatCostUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
