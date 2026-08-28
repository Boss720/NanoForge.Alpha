/**
 * Token Spend & Telemetry Tracker.
 *
 * Maintains an immutable audit ledger of token consumption and USD costs,
 * enforces hard budget guards, and aggregates session telemetry.
 */

import {
  createEmptySpendMetrics,
  type ModelPricing,
  type TokenSpendMetrics,
  type SessionSpendSummary,
} from "@nanoforge/protocol";
import { lookupModelPricing, estimateUsageCost } from "./pricing";

export interface BudgetGuardConfig {
  maxBudgetUsd?: number;
  maxTurns?: number;
  maxTotalTokens?: number;
  maxDurationMs?: number;
}

export type BudgetGuardType = "budget_usd" | "turn_limit" | "token_limit" | "timeout";

export class BudgetExceededError extends Error {
  readonly guardType: BudgetGuardType;
  readonly currentValue: number;
  readonly limitValue: number;

  constructor(message: string, guardType: BudgetGuardType, currentValue: number, limitValue: number) {
    super(message);
    this.name = "BudgetExceededError";
    this.guardType = guardType;
    this.currentValue = currentValue;
    this.limitValue = limitValue;
    Object.setPrototypeOf(this, BudgetExceededError.prototype);
  }
}

export class SpendTracker {
  private _metrics: TokenSpendMetrics = createEmptySpendMetrics();
  private _turnCount = 0;
  private _startedAt = Date.now();
  private _pricing: ModelPricing;
  private _toolCallCounts: Record<string, number> = {};

  constructor(
    readonly model: string,
    readonly budgetGuards: BudgetGuardConfig = {},
    customPricing?: ModelPricing
  ) {
    this._pricing = customPricing || lookupModelPricing(model);
  }

  get pricing(): ModelPricing {
    return this._pricing;
  }

  setPricing(pricing: ModelPricing): void {
    this._pricing = pricing;
  }

  getMetrics(): TokenSpendMetrics {
    return { ...this._metrics };
  }

  getTurnCount(): number {
    return this._turnCount;
  }

  getElapsedMs(): number {
    return Date.now() - this._startedAt;
  }

  getToolCallCounts(): Record<string, number> {
    return { ...this._toolCallCounts };
  }

  recordToolCall(toolName: string): void {
    this._toolCallCounts[toolName] = (this._toolCallCounts[toolName] ?? 0) + 1;
  }

  recordTurnUsage(usage: {
    promptTokens: number;
    completionTokens: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
  }): TokenSpendMetrics {
    this._turnCount++;
    const cost = estimateUsageCost(this._pricing, usage);

    const pTokens = Math.max(0, Math.floor(usage.promptTokens));
    const cTokens = Math.max(0, Math.floor(usage.completionTokens));
    const crTokens = Math.max(0, Math.floor(usage.cachedReadTokens ?? 0));
    const cwTokens = Math.max(0, Math.floor(usage.cachedWriteTokens ?? 0));

    this._metrics.promptTokens += pTokens;
    this._metrics.completionTokens += cTokens;
    this._metrics.totalTokens += pTokens + cTokens;
    this._metrics.cachedReadTokens += crTokens;
    this._metrics.cachedWriteTokens += cwTokens;
    this._metrics.estimatedCostUsd =
      Math.round((this._metrics.estimatedCostUsd + cost) * 1_000_000) / 1_000_000;

    this.checkBudgetGuards();
    return { ...this._metrics };
  }

  checkBudgetGuards(): void {
    // 1. Budget USD guard
    if (this.budgetGuards.maxBudgetUsd !== undefined && this.budgetGuards.maxBudgetUsd > 0) {
      if (this._metrics.estimatedCostUsd > this.budgetGuards.maxBudgetUsd) {
        throw new BudgetExceededError(
          `Cost budget exceeded: $${this._metrics.estimatedCostUsd.toFixed(4)} > $${this.budgetGuards.maxBudgetUsd.toFixed(4)}`,
          "budget_usd",
          this._metrics.estimatedCostUsd,
          this.budgetGuards.maxBudgetUsd
        );
      }
    }

    // 2. Turn count guard
    if (this.budgetGuards.maxTurns !== undefined && this.budgetGuards.maxTurns > 0) {
      if (this._turnCount >= this.budgetGuards.maxTurns) {
        throw new BudgetExceededError(
          `Turn limit reached: ${this._turnCount} >= ${this.budgetGuards.maxTurns}`,
          "turn_limit",
          this._turnCount,
          this.budgetGuards.maxTurns
        );
      }
    }

    // 3. Total token guard
    if (this.budgetGuards.maxTotalTokens !== undefined && this.budgetGuards.maxTotalTokens > 0) {
      if (this._metrics.totalTokens > this.budgetGuards.maxTotalTokens) {
        throw new BudgetExceededError(
          `Token budget exceeded: ${this._metrics.totalTokens} > ${this.budgetGuards.maxTotalTokens}`,
          "token_limit",
          this._metrics.totalTokens,
          this.budgetGuards.maxTotalTokens
        );
      }
    }

    // 4. Timeout guard
    if (this.budgetGuards.maxDurationMs !== undefined && this.budgetGuards.maxDurationMs > 0) {
      const elapsed = Date.now() - this._startedAt;
      if (elapsed > this.budgetGuards.maxDurationMs) {
        throw new BudgetExceededError(
          `Duration limit exceeded: ${elapsed}ms > ${this.budgetGuards.maxDurationMs}ms`,
          "timeout",
          elapsed,
          this.budgetGuards.maxDurationMs
        );
      }
    }
  }

  toSummary(sessionId: string): SessionSpendSummary {
    return {
      sessionId,
      totalTurns: this._turnCount,
      totalTokens: { ...this._metrics },
      totalLatency: {
        totalDurationMs: this.getElapsedMs(),
      },
      toolCallCounts: { ...this._toolCallCounts },
      startedAt: new Date(this._startedAt).toISOString(),
      endedAt: new Date().toISOString(),
    };
  }

  reset(): void {
    this._metrics = createEmptySpendMetrics();
    this._turnCount = 0;
    this._startedAt = Date.now();
    this._toolCallCounts = {};
  }
}
