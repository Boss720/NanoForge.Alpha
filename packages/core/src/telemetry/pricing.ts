/**
 * Model Pricing Lookup and Cost Estimation.
 *
 * Provides utilities for looking up model pricing definitions and calculating
 * fine-grained costs for prompt, completion, cached read, and cached write tokens.
 */

import {
  KNOWN_MODEL_PRICING,
  calculateEstimatedCostUsd,
  type ModelPricing,
} from "@nanoforge/protocol";

export const DEFAULT_FALLBACK_PRICING: ModelPricing = {
  modelId: "default-fallback",
  provider: "unknown",
  inputCostPer1M: 3.0,
  outputCostPer1M: 15.0,
  cacheReadCostPer1M: 0.3,
  cacheWriteCostPer1M: 3.75,
};

export function lookupModelPricing(
  modelId: string,
  customCatalog?: Record<string, ModelPricing>
): ModelPricing {
  const normalized = modelId.toLowerCase().trim();

  // 1. Check custom catalog first
  if (customCatalog) {
    if (customCatalog[modelId]) return customCatalog[modelId];
    if (customCatalog[normalized]) return customCatalog[normalized];
  }

  // 2. Check KNOWN_MODEL_PRICING exact match
  if (KNOWN_MODEL_PRICING[modelId]) {
    return KNOWN_MODEL_PRICING[modelId];
  }
  if (KNOWN_MODEL_PRICING[normalized]) {
    return KNOWN_MODEL_PRICING[normalized];
  }

  // 3. Partial matching for vendor variants (e.g. claude-3-7-sonnet-20250219 -> claude-3-7-sonnet)
  for (const [knownKey, pricing] of Object.entries(KNOWN_MODEL_PRICING)) {
    if (normalized.includes(knownKey)) {
      return pricing;
    }
  }

  // 4. Provider-based fallback heuristics
  if (normalized.startsWith("claude-") || normalized.includes("anthropic")) {
    if (normalized.includes("haiku")) return KNOWN_MODEL_PRICING["claude-3-5-haiku"];
    return KNOWN_MODEL_PRICING["claude-3-7-sonnet"];
  }

  if (normalized.startsWith("gpt-4o-mini")) {
    return KNOWN_MODEL_PRICING["gpt-4o-mini"];
  }
  if (normalized.startsWith("gpt-4o") || normalized.includes("openai")) {
    return KNOWN_MODEL_PRICING["gpt-4o"];
  }
  if (normalized.includes("o3-mini") || normalized.includes("o1")) {
    return KNOWN_MODEL_PRICING["o3-mini"];
  }
  if (normalized.includes("ollama") || normalized.includes("local")) {
    return KNOWN_MODEL_PRICING["ollama/local"];
  }

  return {
    ...DEFAULT_FALLBACK_PRICING,
    modelId,
  };
}

export function estimateUsageCost(
  pricing: ModelPricing,
  usage: {
    promptTokens: number;
    completionTokens: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
  }
): number {
  return calculateEstimatedCostUsd(pricing, usage);
}
