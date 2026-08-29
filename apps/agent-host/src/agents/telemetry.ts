/**
 * Subagent Runtime Token & Latency Telemetry Engine.
 *
 * Tracks per-agent and fleet-wide metrics:
 * - Prompt, completion, and total tokens
 * - Dynamic USD cost calculation based on model pricing
 * - Last turn, average, and p95 turn latency percentiles
 * - Token throughput rate (tokens / second)
 * - Cumulative tool execution duration
 */

import {
  createDefaultSubagentTelemetry,
  type SubagentTelemetry,
} from "@protocol/subagents";

export interface TurnMetricsInput {
  promptTokens: number;
  completionTokens: number;
  turnLatencyMs: number;
  toolLatencyMs?: number;
  costPer1kInput?: number;
  costPer1kOutput?: number;
}

interface AgentTelemetryState {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  turnCount: number;
  turnLatencies: number[];
  toolDurationMs: number;
  startTime: number;
  lastTurnTime: number;
}

export interface FleetTelemetry {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  totalTurns: number;
  avgTurnLatencyMs: number;
  p95TurnLatencyMs: number;
  totalToolDurationMs: number;
  agentCount: number;
}

/**
 * Calculates the p95 percentile latency from an array of millisecond durations.
 */
export function calculateP95Latency(latencies: number[]): number {
  if (latencies.length === 0) return 0;
  if (latencies.length === 1) return Math.round(latencies[0]);

  const sorted = [...latencies].sort((a, b) => a - b);
  // Standard nearest-rank method for 95th percentile
  const p95Index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
  );
  return Math.round(sorted[p95Index]);
}

export class TelemetryTracker {
  private readonly agents = new Map<string, AgentTelemetryState>();

  /**
   * Initializes tracking state for a new subagent.
   */
  initAgent(subagentId: string, startedAt?: string | number): void {
    if (!this.agents.has(subagentId)) {
      const now =
        typeof startedAt === "number"
          ? startedAt
          : startedAt
          ? new Date(startedAt).getTime()
          : Date.now();

      this.agents.set(subagentId, {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        turnCount: 0,
        turnLatencies: [],
        toolDurationMs: 0,
        startTime: now,
        lastTurnTime: now,
      });
    }
  }

  /**
   * Records completed LLM turn metrics and returns updated telemetry snapshot.
   */
  recordTurn(subagentId: string, input: TurnMetricsInput): SubagentTelemetry {
    this.initAgent(subagentId);
    const state = this.agents.get(subagentId)!;

    const promptTokens = Math.max(0, Math.round(input.promptTokens || 0));
    const completionTokens = Math.max(0, Math.round(input.completionTokens || 0));
    const totalTurnTokens = promptTokens + completionTokens;
    const turnLatencyMs = Math.max(0, input.turnLatencyMs || 0);
    const toolLatencyMs = Math.max(0, input.toolLatencyMs || 0);

    state.promptTokens += promptTokens;
    state.completionTokens += completionTokens;
    state.totalTokens += totalTurnTokens;
    state.turnCount += 1;
    state.turnLatencies.push(turnLatencyMs);
    state.toolDurationMs += toolLatencyMs;
    state.lastTurnTime = Date.now();

    const inputCost = (promptTokens / 1000) * (input.costPer1kInput ?? 0);
    const outputCost = (completionTokens / 1000) * (input.costPer1kOutput ?? 0);
    state.estimatedCostUsd += inputCost + outputCost;

    return this.getTelemetry(subagentId);
  }

  /**
   * Records additional tool execution duration for a subagent.
   */
  recordToolDuration(subagentId: string, durationMs: number): void {
    this.initAgent(subagentId);
    const state = this.agents.get(subagentId)!;
    state.toolDurationMs += Math.max(0, durationMs || 0);
  }

  /**
   * Gets current telemetry snapshot for a specific subagent.
   */
  getTelemetry(subagentId: string): SubagentTelemetry {
    const state = this.agents.get(subagentId);
    if (!state) {
      return createDefaultSubagentTelemetry();
    }

    const totalDurationMs = Math.max(0, Date.now() - state.startTime);
    const avgTurnLatencyMs =
      state.turnLatencies.length > 0
        ? Math.round(
            state.turnLatencies.reduce((sum, val) => sum + val, 0) /
              state.turnLatencies.length
          )
        : 0;

    const lastTurnLatencyMs =
      state.turnLatencies.length > 0
        ? Math.round(state.turnLatencies[state.turnLatencies.length - 1])
        : 0;

    const p95TurnLatencyMs = calculateP95Latency(state.turnLatencies);

    // Compute tokens per second
    const elapsedSeconds = totalDurationMs / 1000;
    const tokensPerSecond =
      elapsedSeconds > 0 && state.totalTokens > 0
        ? Math.round((state.totalTokens / elapsedSeconds) * 100) / 100
        : 0;

    return {
      promptTokens: state.promptTokens,
      completionTokens: state.completionTokens,
      totalTokens: state.totalTokens,
      estimatedCostUsd: Math.round(state.estimatedCostUsd * 1000000) / 1000000,
      tokensPerSecond,
      turnCount: state.turnCount,
      avgTurnLatencyMs,
      lastTurnLatencyMs,
      p95TurnLatencyMs,
      totalDurationMs,
      toolDurationMs: Math.round(state.toolDurationMs),
    };
  }

  /**
   * Aggregates telemetry across all active and finished subagents in the fleet.
   */
  getFleetTelemetry(): FleetTelemetry {
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    let totalEstimatedCostUsd = 0;
    let totalTurns = 0;
    let totalToolDurationMs = 0;
    const allLatencies: number[] = [];

    for (const state of this.agents.values()) {
      totalPromptTokens += state.promptTokens;
      totalCompletionTokens += state.completionTokens;
      totalTokens += state.totalTokens;
      totalEstimatedCostUsd += state.estimatedCostUsd;
      totalTurns += state.turnCount;
      totalToolDurationMs += state.toolDurationMs;
      allLatencies.push(...state.turnLatencies);
    }

    const avgTurnLatencyMs =
      allLatencies.length > 0
        ? Math.round(
            allLatencies.reduce((sum, val) => sum + val, 0) / allLatencies.length
          )
        : 0;

    const p95TurnLatencyMs = calculateP95Latency(allLatencies);

    return {
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalEstimatedCostUsd:
        Math.round(totalEstimatedCostUsd * 1000000) / 1000000,
      totalTurns,
      avgTurnLatencyMs,
      p95TurnLatencyMs,
      totalToolDurationMs: Math.round(totalToolDurationMs),
      agentCount: this.agents.size,
    };
  }

  /**
   * Checks if an agent is registered in the telemetry tracker.
   */
  hasAgent(subagentId: string): boolean {
    return this.agents.has(subagentId);
  }

  /**
   * Resets telemetry for a specific agent or for all agents.
   */
  reset(subagentId?: string): void {
    if (subagentId) {
      this.agents.delete(subagentId);
    } else {
      this.agents.clear();
    }
  }
}
