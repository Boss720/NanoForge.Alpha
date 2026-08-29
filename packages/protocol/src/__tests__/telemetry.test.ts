import { describe, expect, it } from "vitest";
import {
  KNOWN_MODEL_PRICING,
  aggregateSessionSpend,
  calculateEstimatedCostUsd,
  createEmptySpendMetrics,
  formatCostUsd,
  latencyMetricsSchema,
  modelPricingSchema,
  sessionSpendSummarySchema,
  tokenSpendMetricsSchema,
  type LatencyMetrics,
  type ModelPricing,
  type SessionSpendSummary,
  type TokenSpendMetrics,
} from "../telemetry";

describe("Telemetry, Token Accounting & Cost Wire Protocol", () => {
  const timestamp = "2026-08-21T22:30:00.000Z";

  describe("Token Spend Metrics & Latency Schemas", () => {
    it("parses valid token spend metrics with defaults", () => {
      const parsed = tokenSpendMetricsSchema.parse({});
      expect(parsed).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        estimatedCostUsd: 0,
      });
    });

    it("rejects negative token values in tokenSpendMetricsSchema", () => {
      expect(() =>
        tokenSpendMetricsSchema.parse({
          promptTokens: -100,
        })
      ).toThrow();
    });

    it("validates latency metrics with partial and full timings", () => {
      const lat: LatencyMetrics = {
        ttftMs: 250.5,
        totalDurationMs: 1450.0,
        inferenceDurationMs: 1100.0,
        toolDurationMs: 300.0,
        queueDurationMs: 50.0,
      };

      const parsed = latencyMetricsSchema.parse(lat);
      expect(parsed).toEqual(lat);
    });

    it("rejects negative durations in latencyMetricsSchema", () => {
      expect(() =>
        latencyMetricsSchema.parse({
          totalDurationMs: -50,
        })
      ).toThrow();
    });
  });

  describe("Model Pricing Catalog & USD Cost Calculation", () => {
    it("contains expected pricing for known foundation models", () => {
      expect(KNOWN_MODEL_PRICING["claude-3-7-sonnet"].inputCostPer1M).toBe(3.0);
      expect(KNOWN_MODEL_PRICING["claude-3-7-sonnet"].outputCostPer1M).toBe(15.0);
      expect(KNOWN_MODEL_PRICING["claude-3-7-sonnet"].cacheReadCostPer1M).toBe(0.3);

      expect(KNOWN_MODEL_PRICING["gpt-4o"].inputCostPer1M).toBe(2.5);
      expect(KNOWN_MODEL_PRICING["gpt-4o"].outputCostPer1M).toBe(10.0);

      expect(KNOWN_MODEL_PRICING["ollama/local"].inputCostPer1M).toBe(0.0);
      expect(KNOWN_MODEL_PRICING["ollama/local"].outputCostPer1M).toBe(0.0);
    });

    it("calculates exactly 0.0 for zero tokens", () => {
      const pricing = KNOWN_MODEL_PRICING["claude-3-7-sonnet"];
      const cost = calculateEstimatedCostUsd(pricing, {
        promptTokens: 0,
        completionTokens: 0,
      });
      expect(cost).toBe(0.0);
    });

    it("calculates accurate cost for standard prompt and completion", () => {
      const pricing = KNOWN_MODEL_PRICING["claude-3-7-sonnet"];
      // 1,000,000 prompt tokens @ $3.00/1M = $3.00
      // 1,000,000 completion tokens @ $15.00/1M = $15.00
      // Total = $18.00
      const cost = calculateEstimatedCostUsd(pricing, {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
      });
      expect(cost).toBe(18.0);
    });

    it("applies discounted prompt cache read pricing", () => {
      const pricing = KNOWN_MODEL_PRICING["claude-3-7-sonnet"];
      // 1,000,000 prompt tokens total:
      // 800,000 cached read @ $0.30/1M = $0.24
      // 200,000 uncached prompt @ $3.00/1M = $0.60
      // 0 completion
      // Total = $0.84
      const cost = calculateEstimatedCostUsd(pricing, {
        promptTokens: 1_000_000,
        completionTokens: 0,
        cachedReadTokens: 800_000,
      });
      expect(cost).toBeCloseTo(0.84, 4);
    });

    it("handles cached read tokens exceeding prompt tokens gracefully by capping", () => {
      const pricing = KNOWN_MODEL_PRICING["claude-3-7-sonnet"];
      // Prompt is 10,000, but cachedReadTokens passed as 20,000 -> capped to 10,000 @ $0.30/1M = $0.003
      const cost = calculateEstimatedCostUsd(pricing, {
        promptTokens: 10_000,
        completionTokens: 0,
        cachedReadTokens: 20_000,
      });
      expect(cost).toBe(0.003);
    });

    it("calculates exactly $0.00 for local / free models", () => {
      const pricing = KNOWN_MODEL_PRICING["ollama/local"];
      const cost = calculateEstimatedCostUsd(pricing, {
        promptTokens: 50_000,
        completionTokens: 10_000,
      });
      expect(cost).toBe(0.0);
    });
  });

  describe("Spend Aggregation & Formatting Helpers", () => {
    it("createEmptySpendMetrics initializes clean zeroes", () => {
      expect(createEmptySpendMetrics()).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        estimatedCostUsd: 0,
      });
    });

    it("aggregateSessionSpend sums metrics correctly across multiple turns", () => {
      const turn1: TokenSpendMetrics = {
        promptTokens: 1000,
        completionTokens: 200,
        totalTokens: 1200,
        cachedReadTokens: 500,
        cachedWriteTokens: 0,
        estimatedCostUsd: 0.0045,
      };

      const turn2: TokenSpendMetrics = {
        promptTokens: 2000,
        completionTokens: 400,
        totalTokens: 2400,
        cachedReadTokens: 1500,
        cachedWriteTokens: 0,
        estimatedCostUsd: 0.0075,
      };

      const aggregate = aggregateSessionSpend([turn1, turn2]);
      expect(aggregate.promptTokens).toBe(3000);
      expect(aggregate.completionTokens).toBe(600);
      expect(aggregate.totalTokens).toBe(3600);
      expect(aggregate.cachedReadTokens).toBe(2000);
      expect(aggregate.estimatedCostUsd).toBe(0.012);
    });

    it("formatCostUsd formats various monetary amounts accurately", () => {
      expect(formatCostUsd(0)).toBe("$0.00");
      expect(formatCostUsd(-0.5)).toBe("$0.00");
      expect(formatCostUsd(NaN)).toBe("$0.00");
      expect(formatCostUsd(Infinity)).toBe("$0.00");
      expect(formatCostUsd(-Infinity)).toBe("$0.00");
      expect(formatCostUsd(0.0025)).toBe("$0.0025");
      expect(formatCostUsd(0.0001)).toBe("$0.0001");
      expect(formatCostUsd(0.05)).toBe("$0.05");
      expect(formatCostUsd(1.234)).toBe("$1.23");
      expect(formatCostUsd(15.99)).toBe("$15.99");
    });
  });

  describe("Session Spend Summary Schema", () => {
    it("validates and round-trips a complete session spend summary", () => {
      const summary: SessionSpendSummary = {
        sessionId: "sess-abc-123",
        totalTurns: 4,
        totalTokens: {
          promptTokens: 5000,
          completionTokens: 1200,
          totalTokens: 6200,
          cachedReadTokens: 3000,
          cachedWriteTokens: 0,
          estimatedCostUsd: 0.024,
        },
        totalLatency: {
          ttftMs: 180,
          totalDurationMs: 4500,
          inferenceDurationMs: 3800,
          toolDurationMs: 700,
        },
        toolCallCounts: {
          view_file: 3,
          replace_file_content: 1,
        },
        startedAt: timestamp,
        endedAt: "2026-08-21T22:30:15.000Z",
      };

      const parsed = sessionSpendSummarySchema.parse(JSON.parse(JSON.stringify(summary)));
      expect(parsed).toEqual(summary);
    });
  });
});
