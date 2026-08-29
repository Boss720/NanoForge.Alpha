import { describe, it, expect, beforeEach, vi } from "vitest";
import { TelemetryTracker, calculateP95Latency } from "./telemetry.js";
import { SubagentSupervisor } from "./supervisor.js";

describe("TelemetryTracker & Supervisor Telemetry Integration", () => {
  let tracker: TelemetryTracker;

  beforeEach(() => {
    tracker = new TelemetryTracker();
  });

  describe("calculateP95Latency", () => {
    it("returns 0 for empty arrays", () => {
      expect(calculateP95Latency([])).toBe(0);
    });

    it("returns the single element for 1-item arrays", () => {
      expect(calculateP95Latency([250])).toBe(250);
    });

    it("calculates accurate 95th percentile for distribution", () => {
      // 100 values from 1 to 100
      const latencies = Array.from({ length: 100 }, (_, i) => i + 1);
      const p95 = calculateP95Latency(latencies);
      expect(p95).toBe(95);
    });

    it("handles non-uniform latency distributions", () => {
      const latencies = [100, 120, 110, 90, 105, 500, 95, 115, 100, 130];
      const p95 = calculateP95Latency(latencies);
      // 10 items, 95% -> index 9 -> 500
      expect(p95).toBe(500);
    });
  });

  describe("TelemetryTracker Unit Metrics", () => {
    const subagentId = "11111111-1111-1111-1111-111111111111";

    it("initializes zeroed telemetry for unknown agent", () => {
      const telemetry = tracker.getTelemetry("unknown-id");
      expect(telemetry.promptTokens).toBe(0);
      expect(telemetry.completionTokens).toBe(0);
      expect(telemetry.totalTokens).toBe(0);
      expect(telemetry.estimatedCostUsd).toBe(0);
      expect(telemetry.turnCount).toBe(0);
      expect(telemetry.avgTurnLatencyMs).toBe(0);
      expect(telemetry.p95TurnLatencyMs).toBe(0);
    });

    it("accumulates tokens, latency, and computes USD cost correctly across turns", () => {
      // Turn 1: 1000 prompt tokens ($0.003/1k), 500 completion tokens ($0.015/1k), 1000ms latency
      const turn1 = tracker.recordTurn(subagentId, {
        promptTokens: 1000,
        completionTokens: 500,
        turnLatencyMs: 1000,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
      });

      expect(turn1.promptTokens).toBe(1000);
      expect(turn1.completionTokens).toBe(500);
      expect(turn1.totalTokens).toBe(1500);
      expect(turn1.turnCount).toBe(1);
      // Cost: (1000/1000)*0.003 + (500/1000)*0.015 = 0.003 + 0.0075 = 0.0105
      expect(turn1.estimatedCostUsd).toBe(0.0105);
      expect(turn1.lastTurnLatencyMs).toBe(1000);
      expect(turn1.avgTurnLatencyMs).toBe(1000);
      expect(turn1.p95TurnLatencyMs).toBe(1000);

      // Turn 2: 2000 prompt tokens, 1000 completion tokens, 2000ms latency
      const turn2 = tracker.recordTurn(subagentId, {
        promptTokens: 2000,
        completionTokens: 1000,
        turnLatencyMs: 2000,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
      });

      expect(turn2.promptTokens).toBe(3000);
      expect(turn2.completionTokens).toBe(1500);
      expect(turn2.totalTokens).toBe(4500);
      expect(turn2.turnCount).toBe(2);
      // Additional cost: (2000/1000)*0.003 + (1000/1000)*0.015 = 0.006 + 0.015 = 0.021 => total 0.0315
      expect(turn2.estimatedCostUsd).toBe(0.0315);
      expect(turn2.lastTurnLatencyMs).toBe(2000);
      expect(turn2.avgTurnLatencyMs).toBe(1500);
    });

    it("records tool execution duration accurately", () => {
      tracker.recordToolDuration(subagentId, 350);
      tracker.recordToolDuration(subagentId, 650);

      const tel = tracker.getTelemetry(subagentId);
      expect(tel.toolDurationMs).toBe(1000);
    });

    it("aggregates fleet-wide telemetry across multiple subagents", () => {
      const agentA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const agentB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

      tracker.recordTurn(agentA, {
        promptTokens: 1000,
        completionTokens: 500,
        turnLatencyMs: 800,
        toolLatencyMs: 200,
        costPer1kInput: 0.002,
        costPer1kOutput: 0.01,
      });

      tracker.recordTurn(agentB, {
        promptTokens: 2000,
        completionTokens: 1000,
        turnLatencyMs: 1200,
        toolLatencyMs: 300,
        costPer1kInput: 0.002,
        costPer1kOutput: 0.01,
      });

      const fleet = tracker.getFleetTelemetry();
      expect(fleet.agentCount).toBe(2);
      expect(fleet.totalPromptTokens).toBe(3000);
      expect(fleet.totalCompletionTokens).toBe(1500);
      expect(fleet.totalTokens).toBe(4500);
      expect(fleet.totalTurns).toBe(2);
      expect(fleet.avgTurnLatencyMs).toBe(1000);
      expect(fleet.totalToolDurationMs).toBe(500);
      expect(fleet.totalEstimatedCostUsd).toBeGreaterThan(0);
    });
  });

  describe("SubagentSupervisor Telemetry Integration", () => {
    it("records turn telemetry, updates subagent node summary, and emits wire event", async () => {
      const supervisor = new SubagentSupervisor();
      const events: any[] = [];
      supervisor.subscribe((e) => events.push(e));

      const spawnResult = await supervisor.spawnSubagent({
        archetype: "implementer",
        name: "test_telemetry_agent",
        prompt: "Run performance benchmark turn",
      });

      const subagentId = spawnResult.subagentId;
      expect(supervisor.telemetry.hasAgent(subagentId)).toBe(true);

      const tel = supervisor.recordTurnTelemetry(subagentId, {
        promptTokens: 400,
        completionTokens: 200,
        turnLatencyMs: 650,
        costPer1kInput: 0.001,
        costPer1kOutput: 0.002,
      });

      expect(tel.totalTokens).toBe(600);
      expect(tel.turnCount).toBe(1);

      // Verify node summary includes telemetry
      const summary = supervisor.registry.getSummary(subagentId);
      expect(summary?.tokensUsed).toBe(600);
      expect(summary?.turnCount).toBe(1);
      expect(summary?.telemetry).toBeDefined();
      expect(summary?.telemetry?.totalTokens).toBe(600);
      expect(summary?.telemetry?.avgTurnLatencyMs).toBe(650);

      // Verify wire event emitted
      const telemetryEvent = events.find((e) => e.type === "subagent.telemetry_updated");
      expect(telemetryEvent).toBeDefined();
      expect(telemetryEvent.subagentId).toBe(subagentId);
      expect(telemetryEvent.telemetry.totalTokens).toBe(600);
    });

    it("triggers budget overflow and escalation ladder when token budget is exceeded via turn telemetry", async () => {
      const supervisor = new SubagentSupervisor();
      const events: any[] = [];
      supervisor.subscribe((e) => events.push(e));

      const spawnResult = await supervisor.spawnSubagent({
        archetype: "implementer",
        name: "budget_constrained_agent",
        prompt: "Perform task within budget",
        budgetTokens: 500,
      });

      const subagentId = spawnResult.subagentId;

      supervisor.recordTurnTelemetry(subagentId, {
        promptTokens: 300,
        completionTokens: 300, // Total 600 > 500 budget
        turnLatencyMs: 500,
      });

      const summary = supervisor.registry.getSummary(subagentId);
      expect(summary?.state).toBe("errored");
      expect(summary?.error).toMatch(/Token budget limit exceeded/);

      const errorEvent = events.find((e) => e.type === "subagent.errored");
      expect(errorEvent).toBeDefined();
      expect(errorEvent.code).toBe("ERR_SUBAGENT_BUDGET_EXCEEDED");
    });
  });
});
