import { describe, it, expect } from "vitest";
import {
  SpendTracker,
  BudgetExceededError,
} from "../telemetry/spendTracker";
import { lookupModelPricing, estimateUsageCost } from "../telemetry/pricing";

describe("SpendTracker & Telemetry Subsystem", () => {
  describe("lookupModelPricing & estimateUsageCost", () => {
    it("looks up exact pricing for known models", () => {
      const claudePricing = lookupModelPricing("claude-3-7-sonnet");
      expect(claudePricing.provider).toBe("anthropic");
      expect(claudePricing.inputCostPer1M).toBe(3.0);
      expect(claudePricing.outputCostPer1M).toBe(15.0);
      expect(claudePricing.cacheReadCostPer1M).toBe(0.3);

      const gpt4oPricing = lookupModelPricing("gpt-4o");
      expect(gpt4oPricing.provider).toBe("openai");
      expect(gpt4oPricing.inputCostPer1M).toBe(2.5);
    });

    it("matches vendor variations via heuristic partial matching", () => {
      const p = lookupModelPricing("claude-3-7-sonnet-20250219");
      expect(p.provider).toBe("anthropic");
      expect(p.inputCostPer1M).toBe(3.0);

      const pLocal = lookupModelPricing("ollama-qwen2.5-coder");
      expect(pLocal.inputCostPer1M).toBe(0.0);
    });

    it("falls back to default fallback pricing for completely unknown models", () => {
      const unknownPricing = lookupModelPricing("custom-quantum-llm");
      expect(unknownPricing.modelId).toBe("custom-quantum-llm");
      expect(unknownPricing.provider).toBe("unknown");
    });

    it("calculates cost accurately considering cache hits and misses", () => {
      const pricing = lookupModelPricing("claude-3-7-sonnet");
      // 1000 prompt tokens (with 600 cached read), 200 completion tokens, 0 cached write
      // unCachedPrompt = 400 * 3.0 / 1M = 0.0012
      // cachedRead = 600 * 0.3 / 1M = 0.00018
      // completion = 200 * 15.0 / 1M = 0.003
      // Total = 0.00438
      const cost = estimateUsageCost(pricing, {
        promptTokens: 1000,
        completionTokens: 200,
        cachedReadTokens: 600,
      });

      expect(cost).toBeCloseTo(0.00438, 5);
    });
  });

  describe("SpendTracker usage accumulation & guards", () => {
    it("accumulates tokens and costs across multiple turns", () => {
      const tracker = new SpendTracker("gpt-4o");
      expect(tracker.getTurnCount()).toBe(0);

      tracker.recordTurnUsage({
        promptTokens: 500,
        completionTokens: 100,
      });

      let metrics = tracker.getMetrics();
      expect(metrics.promptTokens).toBe(500);
      expect(metrics.completionTokens).toBe(100);
      expect(metrics.totalTokens).toBe(600);
      expect(tracker.getTurnCount()).toBe(1);

      tracker.recordTurnUsage({
        promptTokens: 1000,
        completionTokens: 200,
      });

      metrics = tracker.getMetrics();
      expect(metrics.promptTokens).toBe(1500);
      expect(metrics.completionTokens).toBe(300);
      expect(metrics.totalTokens).toBe(1800);
      expect(tracker.getTurnCount()).toBe(2);
      expect(metrics.estimatedCostUsd).toBeGreaterThan(0);
    });

    it("enforces maxBudgetUsd guard and throws BudgetExceededError", () => {
      const tracker = new SpendTracker("claude-3-7-sonnet", {
        maxBudgetUsd: 0.01,
      });

      // 1st turn under budget
      tracker.recordTurnUsage({ promptTokens: 500, completionTokens: 100 });

      // 2nd turn exceeds $0.01 limit
      expect(() => {
        tracker.recordTurnUsage({ promptTokens: 100_000, completionTokens: 50_000 });
      }).toThrow(BudgetExceededError);

      try {
        tracker.checkBudgetGuards();
      } catch (err: any) {
        expect(err).toBeInstanceOf(BudgetExceededError);
        expect(err.guardType).toBe("budget_usd");
        expect(err.currentValue).toBeGreaterThan(0.01);
      }
    });

    it("enforces maxTurns limit guard", () => {
      const tracker = new SpendTracker("gpt-4o", {
        maxTurns: 2,
      });

      tracker.recordTurnUsage({ promptTokens: 10, completionTokens: 10 });
      expect(tracker.getTurnCount()).toBe(1);

      expect(() => {
        tracker.recordTurnUsage({ promptTokens: 10, completionTokens: 10 });
      }).toThrow(BudgetExceededError);
    });

    it("enforces maxTotalTokens limit guard", () => {
      const tracker = new SpendTracker("gpt-4o", {
        maxTotalTokens: 500,
      });

      expect(() => {
        tracker.recordTurnUsage({ promptTokens: 400, completionTokens: 200 });
      }).toThrow(BudgetExceededError);
    });

    it("tracks tool call occurrences and exports session spend summary", () => {
      const tracker = new SpendTracker("gpt-4o");
      tracker.recordToolCall("read_file");
      tracker.recordToolCall("read_file");
      tracker.recordToolCall("write_file");

      tracker.recordTurnUsage({ promptTokens: 100, completionTokens: 50 });

      const summary = tracker.toSummary("sess_test_123");
      expect(summary.sessionId).toBe("sess_test_123");
      expect(summary.totalTurns).toBe(1);
      expect(summary.totalTokens.totalTokens).toBe(150);
      expect(summary.toolCallCounts).toEqual({
        read_file: 2,
        write_file: 1,
      });
      expect(summary.startedAt).toBeDefined();
    });

    it("resets tracker cleanly", () => {
      const tracker = new SpendTracker("gpt-4o");
      tracker.recordTurnUsage({ promptTokens: 200, completionTokens: 50 });
      tracker.recordToolCall("test_tool");

      tracker.reset();
      expect(tracker.getTurnCount()).toBe(0);
      expect(tracker.getMetrics().totalTokens).toBe(0);
      expect(tracker.getToolCallCounts()).toEqual({});
    });
  });
});
