import { describe, expect, it } from "vitest";
import {
  accumulateTokenUsage,
  chunkMetadataSchema,
  createTokenUsage,
  finishReasonSchema,
  isTerminalDelta,
  providerDeltaSchema,
  tokenUsageSchema,
  turnEventSchema,
  turnSpeakerSchema,
  turnStateSchema,
  turnSyncSchema,
  type ChunkMetadata,
  type FinishReason,
  type ProviderDelta,
  type TokenUsage,
  type TurnEvent,
  type TurnSpeaker,
  type TurnState,
  type TurnSync,
} from "../stream";

describe("Streaming Deltas & Turn Protocol", () => {
  const timestamp = "2026-08-21T22:30:00.000Z";

  describe("Finish Reason & Chunk Metadata Schemas", () => {
    it("validates all supported finish reasons", () => {
      const reasons: FinishReason[] = [
        "stop",
        "tool_calls",
        "length",
        "content_filter",
        "abort",
        "timeout",
      ];
      for (const reason of reasons) {
        expect(finishReasonSchema.parse(reason)).toBe(reason);
      }
    });

    it("rejects unsupported finish reasons", () => {
      expect(() => finishReasonSchema.parse("invalid_reason")).toThrow();
      expect(() => finishReasonSchema.parse(null)).toThrow();
    });

    it("validates valid chunk metadata with defaults", () => {
      const raw = {
        chunkIndex: 0,
        timestamp,
      };
      const parsed = chunkMetadataSchema.parse(raw);
      expect(parsed.chunkIndex).toBe(0);
      expect(parsed.isFirstChunk).toBe(false);
      expect(parsed.isLastChunk).toBe(false);
      expect(parsed.timestamp).toBe(timestamp);
    });

    it("validates complete chunk metadata with latency and model info", () => {
      const meta: ChunkMetadata = {
        chunkIndex: 3,
        isFirstChunk: false,
        isLastChunk: true,
        timestamp,
        latencyMs: 142.5,
        model: "claude-3-7-sonnet",
        provider: "anthropic",
      };
      const parsed = chunkMetadataSchema.parse(meta);
      expect(parsed).toEqual(meta);
    });

    it("rejects negative chunkIndex or invalid timestamp", () => {
      expect(() =>
        chunkMetadataSchema.parse({
          chunkIndex: -1,
          timestamp,
        })
      ).toThrow();

      expect(() =>
        chunkMetadataSchema.parse({
          chunkIndex: 0,
          timestamp: "invalid-time",
        })
      ).toThrow();
    });
  });

  describe("Token Usage Schema & Pure Helpers", () => {
    it("parses valid token usage with defaults", () => {
      const parsed = tokenUsageSchema.parse({});
      expect(parsed.promptTokens).toBe(0);
      expect(parsed.completionTokens).toBe(0);
      expect(parsed.totalTokens).toBe(0);
      expect(parsed.cachedTokens).toBeUndefined();
    });

    it("rejects negative token counts in tokenUsageSchema", () => {
      expect(() =>
        tokenUsageSchema.parse({
          promptTokens: -10,
        })
      ).toThrow();
    });

    it("createTokenUsage helper clamps negative numbers to 0 and computes total", () => {
      const usage = createTokenUsage(-5, 100, -20, -1.5);
      expect(usage.promptTokens).toBe(0);
      expect(usage.completionTokens).toBe(100);
      expect(usage.totalTokens).toBe(100);
      expect(usage.cachedTokens).toBe(0);
      expect(usage.estimatedCostUsd).toBe(0);
    });

    it("createTokenUsage helper builds standard usage object", () => {
      const usage = createTokenUsage(1200, 450, 300, 0.0125);
      expect(usage).toEqual({
        promptTokens: 1200,
        completionTokens: 450,
        totalTokens: 1650,
        cachedTokens: 300,
        estimatedCostUsd: 0.0125,
      });
    });

    it("accumulateTokenUsage combines base and delta accurately", () => {
      const base: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 200,
        totalTokens: 1200,
        cachedTokens: 150,
        cachedReadTokens: 100,
        cachedWriteTokens: 50,
        estimatedCostUsd: 0.005,
      };

      const delta: TokenUsage = {
        promptTokens: 500,
        completionTokens: 100,
        totalTokens: 600,
        cachedTokens: 50,
        cachedReadTokens: 40,
        cachedWriteTokens: 10,
        estimatedCostUsd: 0.002,
      };

      const accumulated = accumulateTokenUsage(base, delta);
      expect(accumulated.promptTokens).toBe(1500);
      expect(accumulated.completionTokens).toBe(300);
      expect(accumulated.totalTokens).toBe(1800);
      expect(accumulated.cachedTokens).toBe(200);
      expect(accumulated.cachedReadTokens).toBe(140);
      expect(accumulated.cachedWriteTokens).toBe(60);
      expect(accumulated.estimatedCostUsd).toBeCloseTo(0.007);
    });
  });

  describe("ProviderDelta Discriminated Union", () => {
    it("parses text delta (including empty string text)", () => {
      const delta: ProviderDelta = {
        type: "text",
        text: "Hello world",
        metadata: {
          chunkIndex: 0,
          isFirstChunk: true,
          isLastChunk: false,
          timestamp,
        },
      };
      const parsed = providerDeltaSchema.parse(delta);
      expect(parsed).toEqual(delta);
      expect(isTerminalDelta(parsed)).toBe(false);

      const emptyText = providerDeltaSchema.parse({ type: "text", text: "" });
      expect(emptyText.type).toBe("text");
    });

    it("parses thinking delta with reasoning signature", () => {
      const delta: ProviderDelta = {
        type: "thinking",
        text: "Let me consider the invariants...",
        signature: "sig_abc123",
      };
      const parsed = providerDeltaSchema.parse(delta);
 …78640 tokens truncated…ionMs: z.number().nonnegative().default(0),
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
