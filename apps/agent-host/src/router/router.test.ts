import { describe, expect, it } from "vitest";
import type { ModelProfile, RouteRequest } from "@protocol/routing";
import { route } from "./router";

const localCoder: ModelProfile = {
  id: "ollama/qwen3-coder",
  provider: "ollama",
  capabilities: { planning: 0.5, coding: 0.6, vision: 0, toolCalling: 0.5 },
  costPer1kInputTokens: 0,
  costPer1kOutputTokens: 0,
  privacyClass: "local",
  maxContextTokens: 32_768,
  typicalLatencyMs: 800,
};

const cloudPro: ModelProfile = {
  id: "gpt-5.2-pro",
  provider: "openai",
  capabilities: { planning: 0.9, coding: 0.95, vision: 0.9, toolCalling: 0.95 },
  costPer1kInputTokens: 0.01,
  costPer1kOutputTokens: 0.03,
  privacyClass: "cloud",
  maxContextTokens: 200_000,
  typicalLatencyMs: 1500,
};

const cloudMini: ModelProfile = {
  id: "gpt-5.2-mini",
  provider: "openai",
  capabilities: { planning: 0.6, coding: 0.75, vision: 0, toolCalling: 0.8 },
  costPer1kInputTokens: 0.0005,
  costPer1kOutputTokens: 0.0015,
  privacyClass: "cloud",
  maxContextTokens: 128_000,
  typicalLatencyMs: 500,
};

const euMid: ModelProfile = {
  id: "mistral-large-eu",
  provider: "mistral-eu",
  capabilities: { planning: 0.7, coding: 0.8, vision: 0, toolCalling: 0.7 },
  costPer1kInputTokens: 0.002,
  costPer1kOutputTokens: 0.006,
  privacyClass: "cloud-eu",
  maxContextTokens: 64_000,
  typicalLatencyMs: 900,
};

const ALL = [localCoder, cloudPro, cloudMini, euMid];

const codingRequest: RouteRequest = {
  kind: "coding",
  tokenEstimate: { input: 10_000, output: 2000 },
};

describe("route", () => {
  it("lets a user pin override automatic scoring", () => {
    const d = route({ ...codingRequest, pinnedModelId: localCoder.id }, ALL);
    expect(d.primary).toBe(localCoder.id);
    expect(d.pinned).toBe(true);
    expect(d.fallbacks[0]).toBe(cloudPro.id); // automatic best remains as fallback
    expect(d.reason).toContain("pinned by user");
    // Sanity: without the pin, the stronger cloud model wins.
    expect(route(codingRequest, ALL).primary).toBe(cloudPro.id);
  });

  it("routes a vision request only to vision-capable models", () => {
    const d = route(
      { kind: "general", needsVision: true, tokenEstimate: { input: 4000, output: 1000 } },
      ALL,
    );
    expect(d.primary).toBe(cloudPro.id);
    expect(d.fallbacks).toEqual([]);
    expect(d.reason).toContain("no vision capability");
  });

  it("falls back to a cheaper model when a cost cap demotes the best one", () => {
    const d = route({ ...codingRequest, costCapUsd: 0.01 }, ALL);
    expect(d.primary).toBe(cloudMini.id); // gpt-5.2-pro est $0.16 > cap
    expect(d.fallbacks).not.toContain(cloudPro.id);
    expect(d.estimatedCostUsd).toBeLessThanOrEqual(0.01);
    expect(d.reason).toContain("cost cap");
    expect(d.reason).toContain(cloudPro.id); // demotion is explained
  });

  it("falls back across providers during a provider outage", () => {
    const d = route(codingRequest, ALL, { unavailableProviders: ["openai"] });
    expect(d.primary).toBe(euMid.id);
    expect(d.fallbacks).toEqual([localCoder.id]);
    expect(d.reason).toContain('provider "openai" unavailable');
  });

  it("hard-excludes privacy violations instead of penalizing them", () => {
    const d = route({ ...codingRequest, privacyRequired: "local" }, ALL);
    expect(d.primary).toBe(localCoder.id);
    expect(d.fallbacks).toEqual([]);
    expect(d.reason).toContain("privacy cloud below required local");
  });

  it("accepts cloud-eu and local when cloud-eu privacy is required", () => {
    const d = route({ ...codingRequest, privacyRequired: "cloud-eu" }, ALL);
    expect(d.primary).toBe(euMid.id);
    expect(d.fallbacks).toEqual([localCoder.id]);
  });

  it("accepts a Set for unavailableProviders", () => {
    const d = route(codingRequest, ALL, {
      unavailableProviders: new Set(["openai", "mistral-eu"]),
    });
    expect(d.primary).toBe(localCoder.id);
  });

  it("throws when the pinned model id is unknown", () => {
    expect(() => route({ ...codingRequest, pinnedModelId: "nope" }, ALL)).toThrow(
      /pinned model "nope"/,
    );
  });

  it("throws with a full explanation when nothing is eligible", () => {
    expect(() =>
      route(
        { kind: "general", needsVision: true, tokenEstimate: { input: 1000, output: 500 } },
        ALL,
        { unavailableProviders: ["openai"] },
      ),
    ).toThrow(/no eligible model/);
  });

  it("hard-excludes profiles whose context window cannot hold the estimate", () => {
    const big: RouteRequest = {
      kind: "coding",
      tokenEstimate: { input: 40_000, output: 5000 }, // > local 32k, fits eu 64k
    };
    const d = route(big, ALL, { unavailableProviders: ["openai"] });
    expect(d.primary).toBe(euMid.id);
    expect(d.reason).toContain("exceed context 32768");
  });
});
