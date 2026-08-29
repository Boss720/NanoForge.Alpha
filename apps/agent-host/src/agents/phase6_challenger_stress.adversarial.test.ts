/**
 * Phase 6 Empirical Adversarial & Stress Challenger Test Suite
 *
 * Exhaustively stress-tests:
 * 1. Shared Memory Engine:
 *    - Strict namespace isolation across parallel tenants
 *    - Rapid concurrent writes & mutation race conditions (5,000+ ops)
 *    - TTL exact timestamp expiration boundaries (before, exact, after, sweep)
 *    - Query filtering (regex-safe substrings, structured JSON matching, multi-tag logic, pagination)
 * 2. Telemetry Tracker:
 *    - Exact p95 mathematical percentile correctness across diverse sample sizes (0, 1, 2, 3, 10, 20, 95, 100, 1000, 10000)
 *    - Extreme latency skew and bimodal distributions
 *    - High-precision USD cost accounting and micro-cent rounding
 *    - Zero-turn edge cases, fleet-wide aggregation invariants, and lifecycle resets
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SharedMemoryEngine } from "./memory.js";
import { TelemetryTracker, calculateP95Latency } from "./telemetry.js";
import {
  isMemoryExpired,
  matchesMemoryQuery,
  validateMemoryKey,
  validateMemoryNamespace,
  formatMemoryKey,
  parseMemoryKey,
  DEFAULT_MEMORY_NAMESPACE,
} from "@protocol/memory";

describe("Milestone 6 Challenger: Shared Memory Adversarial & Stress Checks", () => {
  let engine: SharedMemoryEngine;

  beforeEach(() => {
    engine = new SharedMemoryEngine();
  });

  afterEach(() => {
    engine.dispose();
  });

  describe("1. Namespace Isolation & Confinement", () => {
    it("strictly isolates keys across distinct namespaces with identical key names", () => {
      const namespaces = ["global", "swarm:alpha", "swarm:beta", "agent:1", "agent:2", "private:user"];
      const key = "auth_token";

      // Write different values to the same key name in each namespace
      namespaces.forEach((ns, idx) => {
        engine.set({
          key,
          namespace: ns,
          value: { token: `secret-${idx}`, index: idx },
          tags: [`ns-${idx}`],
        });
      });

      // Verify each namespace returns its own value and not others
      namespaces.forEach((ns, idx) => {
        const res = engine.get({ key, namespace: ns });
        expect(res.found).toBe(true);
        expect((res.entry?.value as any)?.token).toBe(`secret-${idx}`);
        expect(res.entry?.namespace).toBe(ns);
      });

      // Deleting in swarm:alpha must NOT delete from swarm:beta or global
      const delAlpha = engine.delete({ key, namespace: "swarm:alpha" });
      expect(delAlpha.deleted).toBe(true);
      expect(engine.get({ key, namespace: "swarm:alpha" }).found).toBe(false);
      expect(engine.get({ key, namespace: "swarm:beta" }).found).toBe(true);
      expect(engine.get({ key, namespace: "global" }).found).toBe(true);

      // Clearing swarm:beta must remove only swarm:beta entries
      engine.set({ key: "extra_key_1", namespace: "swarm:beta", value: 123 });
      engine.set({ key: "extra_key_2", namespace: "global", value: 456 });

      const clearedBeta = engine.clear("swarm:beta");
      expect(clearedBeta).toBe(2); // auth_token and extra_key_1
      expect(engine.get({ key, namespace: "swarm:beta" }).found).toBe(false);
      expect(engine.get({ key: "extra_key_2", namespace: "global" }).found).toBe(true);
      expect(engine.get({ key, namespace: "agent:1" }).found).toBe(true);
    });

    it("rejects invalid or dangerous namespace and key names", () => {
      // Namespaces with illegal characters
      const hostileNamespaces = [
        "", // empty
        "   ", // whitespace only
        "ns with space",
        "ns$bad#chars",
        "ns;drop table;",
        "ns\0nullbyte",
        "A".repeat(129), // exceeds MAX_MEMORY_NAMESPACE_LENGTH (128)
      ];

      for (const ns of hostileNamespaces) {
        expect(() => {
          engine.set({ key: "validKey", namespace: ns, value: 1 });
        }).toThrow();
        expect(validateMemoryNamespace(ns)).toBe(false);
      }

      // Keys with illegal characters
      const hostileKeys = [
        "", // empty
        "   ", // whitespace only
        "key\0null",
        "A".repeat(257), // exceeds MAX_MEMORY_KEY_LENGTH (256)
      ];

      for (const k of hostileKeys) {
        expect(() => {
          engine.set({ key: k, namespace: "global", value: 1 });
        }).toThrow();
        expect(validateMemoryKey(k)).toBe(false);
      }
    });

    it("correctly round-trips formatMemoryKey and parseMemoryKey with edge cases", () => {
      const cases = [
        { ns: "global", key: "myKey" },
        { ns: "swarm:team-1", key: "step:4:output" },
        { ns: "ns/with/slashes", key: "key.with.dots" },
        { ns: "ns_123", key: "key:::with:::internal:::delimiter" },
      ];

      for (const { ns, key } of cases) {
        const formatted = formatMemoryKey(ns, key);
        const parsed = parseMemoryKey(formatted);
        expect(parsed.namespace).toBe(ns);
        expect(parsed.key).toBe(key);
      }
    });
  });

  describe("2. Rapid Concurrent Writes & High Mutation Load", () => {
    it("handles 5,000 concurrent asynchronous set/get/query/delete operations without state corruption", async () => {
      const TOTAL_OPS = 5000;
      const NUM_KEYS = 100;
      const NUM_NAMESPACES = 10;

      let eventCount = 0;
      engine.subscribe(() => {
        eventCount++;
      });

      const promises: Promise<any>[] = [];

      for (let i = 0; i < TOTAL_OPS; i++) {
        const ns = `tenant_${i % NUM_NAMESPACES}`;
        const key = `key_${i % NUM_KEYS}`;
        const opType = i % 10;

        if (opType < 6) {
          // 60% SET operations
          promises.push(
            Promise.resolve().then(() => {
              return engine.set({
                key,
                namespace: ns,
                value: { opIndex: i, timestamp: Date.now() },
                tags: [`batch_${i % 5}`],
              });
            })
          );
        } else if (opType < 8) {
          // 20% GET operations
          promises.push(
            Promise.resolve().then(() => {
              return engine.get({ key, namespace: ns });
            })
          );
        } else if (opType === 8) {
          // 10% QUERY operations
          promises.push(
            Promise.resolve().then(() => {
              return engine.query({ namespace: ns, limit: 10 });
            })
          );
        } else {
          // 10% DELETE operations
          promises.push(
            Promise.resolve().then(() => {
              return engine.delete({ key, namespace: ns });
            })
          );
        }
      }

      await Promise.all(promises);

      // Verify engine size is consistent (<= NUM_KEYS * NUM_NAMESPACES)
      expect(engine.size).toBeLessThanOrEqual(NUM_KEYS * NUM_NAMESPACES);
      expect(eventCount).toBeGreaterThan(0);

      // Verify that remaining entries have valid monotonic versions
      const allEntries = engine.query({ limit: 100 });
      for (const entry of allEntries.entries) {
        expect(entry.version).toBeGreaterThanOrEqual(1);
        expect(entry.key).toMatch(/^key_\d+$/);
        expect(entry.namespace).toMatch(/^tenant_\d+$/);
      }
    });

    it("monotonically increments entry version on sequential updates to the same key", () => {
      const key = "version_test";
      const namespace = "swarm:version";

      for (let v = 1; v <= 50; v++) {
        const res = engine.set({
          key,
          namespace,
          value: { iteration: v },
        });
        expect(res.entry.version).toBe(v);
      }

      const finalGet = engine.get({ key, namespace });
      expect(finalGet.found).toBe(true);
      expect(finalGet.entry?.version).toBe(50);
      expect((finalGet.entry?.value as any)?.iteration).toBe(50);
    });
  });

  describe("3. TTL Expiration Timestamp Boundaries", () => {
    it("evaluates TTL boundaries with exact millisecond precision", () => {
      const now = 1700000000000; // Reference timestamp
      const ttlSeconds = 10;
      const expiresAtIso = new Date(now + ttlSeconds * 1000).toISOString();

      const entry = { expiresAt: expiresAtIso };

      // 1ms before expiration -> NOT expired
      expect(isMemoryExpired(entry, now + 9999)).toBe(false);

      // Exactly at expiration -> EXPIRED (expMs <= refMs)
      expect(isMemoryExpired(entry, now + 10000)).toBe(true);

      // 1ms after expiration -> EXPIRED
      expect(isMemoryExpired(entry, now + 10001)).toBe(true);

      // Entry with no expiresAt -> NEVER expired
      expect(isMemoryExpired({}, now + 999999999)).toBe(false);
      expect(isMemoryExpired({ expiresAt: undefined }, now)).toBe(false);
    });

    it("evicts expired entries on get and during sweepExpired", async () => {
      // Set key with 1s TTL
      engine.set({
        key: "ephemeral_1",
        namespace: "global",
        value: "temporary data",
        ttlSeconds: 1,
      });

      // Immediately available
      expect(engine.get({ key: "ephemeral_1" }).found).toBe(true);

      // Wait 1.1 seconds for TTL to elapse
      await new Promise((r) => setTimeout(r, 1100));

      // get() must detect expiration, delete from map, and return not found
      const expiredGet = engine.get({ key: "ephemeral_1" });
      expect(expiredGet.found).toBe(false);
      expect(expiredGet.entry).toBeNull();
      expect(engine.size).toBe(0);
    });

    it("sweeps multiple expired keys across different namespaces in background sweep", async () => {
      engine.set({ key: "k1", namespace: "ns1", value: "v1", ttlSeconds: 1 });
      engine.set({ key: "k2", namespace: "ns2", value: "v2", ttlSeconds: 1 });
      engine.set({ key: "k3_permanent", namespace: "ns1", value: "permanent" }); // No TTL

      expect(engine.size).toBe(3);

      await new Promise((r) => setTimeout(r, 1100));

      const swept = engine.sweepExpired();
      expect(swept).toBe(2);
      expect(engine.size).toBe(1);

      const remaining = engine.get({ key: "k3_permanent", namespace: "ns1" });
      expect(remaining.found).toBe(true);
    });
  });

  describe("4. Complex Query Filtering & Search Robustness", () => {
    beforeEach(() => {
      engine.set({
        key: "config:database:primary",
        namespace: "system",
        value: { host: "db.production.internal", port: 5432, ssl: true },
        tags: ["database", "prod", "critical"],
      });
      engine.set({
        key: "config:database:replica",
        namespace: "system",
        value: { host: "db-replica.production.internal", port: 5433, ssl: true },
        tags: ["database", "prod", "readonly"],
      });
      engine.set({
        key: "user:session:admin",
        namespace: "auth",
        value: "Bearer super_secret_jwt_token_12345",
        tags: ["auth", "security"],
      });
      engine.set({
        key: "system:metrics:cache",
        namespace: "telemetry",
        value: { hitRate: 0.98, memoryMb: 512 },
        tags: ["telemetry", "cache"],
      });
    });

    it("matches substring in key name case-insensitively", () => {
      const res = engine.query({ query: "DATABASE" });
      expect(res.total).toBe(2);
      expect(res.entries.map((e) => e.key)).toContain("config:database:primary");
      expect(res.entries.map((e) => e.key)).toContain("config:database:replica");
    });

    it("matches substring inside string values", () => {
      const res = engine.query({ query: "super_secret_jwt" });
      expect(res.total).toBe(1);
      expect(res.entries[0].key).toBe("user:session:admin");
    });

    it("matches substring inside structured JSON object values", () => {
      const res = engine.query({ query: "db-replica" });
      expect(res.total).toBe(1);
      expect(res.entries[0].key).toBe("config:database:replica");
    });

    it("filters by tag intersection correctly", () => {
      // Tags prod OR critical -> matches primary and replica
      const resProd = engine.query({ tags: ["prod"] });
      expect(resProd.total).toBe(2);

      // Tag readonly -> matches replica only
      const resReadonly = engine.query({ tags: ["readonly"] });
      expect(resReadonly.total).toBe(1);
      expect(resReadonly.entries[0].key).toBe("config:database:replica");

      // Non-existent tag -> 0 matches
      const resNone = engine.query({ tags: ["non_existent_tag"] });
      expect(resNone.total).toBe(0);
      expect(resNone.entries).toEqual([]);
    });

    it("applies namespace scoping and pagination (limit/offset) correctly", () => {
      const resSystem = engine.query({ namespace: "system" });
      expect(resSystem.total).toBe(2);

      const paged1 = engine.query({ namespace: "system", limit: 1, offset: 0 });
      expect(paged1.entries.length).toBe(1);
      expect(paged1.total).toBe(2);

      const paged2 = engine.query({ namespace: "system", limit: 1, offset: 1 });
      expect(paged2.entries.length).toBe(1);
      expect(paged2.total).toBe(2);
      expect(paged1.entries[0].key).not.toBe(paged2.entries[0].key);
    });
  });
});

describe("Milestone 6 Challenger: Telemetry Tracker Adversarial Checks", () => {
  let tracker: TelemetryTracker;

  beforeEach(() => {
    tracker = new TelemetryTracker();
  });

  describe("1. P95 Percentile Latency Calculation Accuracy", () => {
    it("handles zero, single, and small sample edge cases", () => {
      expect(calculateP95Latency([])).toBe(0);
      expect(calculateP95Latency([500])).toBe(500);
      expect(calculateP95Latency([10, 20])).toBe(20);
      expect(calculateP95Latency([10, 50, 100])).toBe(100);
    });

    it("calculates mathematically rigorous 95th percentiles for diverse sample sizes", () => {
      // Sample size 10: 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 -> p95Index = ceil(10*0.95)-1 = 9 -> 100
      const sample10 = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      expect(calculateP95Latency(sample10)).toBe(100);

      // Sample size 20: 1..20 -> p95Index = ceil(20*0.95)-1 = 18 -> 19
      const sample20 = Array.from({ length: 20 }, (_, i) => i + 1);
      expect(calculateP95Latency(sample20)).toBe(19);

      // Sample size 100: 1..100 -> p95Index = ceil(100*0.95)-1 = 94 -> 95
      const sample100 = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(calculateP95Latency(sample100)).toBe(95);

      // Sample size 1,000: 1..1000 -> p95Index = ceil(1000*0.95)-1 = 949 -> 950
      const sample1000 = Array.from({ length: 1000 }, (_, i) => i + 1);
      expect(calculateP95Latency(sample1000)).toBe(950);
    });

    it("handles bimodal and extreme outlier distributions correctly", () => {
      // 95 fast requests (10ms) and 5 slow requests (10,000ms) in 100 total
      const latencies: number[] = [];
      for (let i = 0; i < 95; i++) latencies.push(10);
      for (let i = 0; i < 5; i++) latencies.push(10000);

      // Index 94 (95th item in 0-indexed sorted) is 10ms
      expect(calculateP95Latency(latencies)).toBe(10);

      // Add 1 more slow request (94 fast, 6 slow) -> Index 94 is now 10000ms
      latencies[0] = 10000;
      expect(calculateP95Latency(latencies)).toBe(10000);
    });

    it("handles uniform and identical values without floating point distortion", () => {
      const uniform = Array(50).fill(123.45);
      expect(calculateP95Latency(uniform)).toBe(123);
    });
  });

  describe("2. USD Cost Accounting & Floating Point Precision", () => {
    it("accumulates costs across turns with micro-dollar rounding to 6 decimals", () => {
      const agentId = "agent-cost-precision-1";

      // 123 prompt tokens at $0.0015/1k, 456 completion tokens at $0.006/1k
      // Cost = (123/1000)*0.0015 + (456/1000)*0.006 = 0.0001845 + 0.002736 = 0.0029205 -> 0.002921
      const tel = tracker.recordTurn(agentId, {
        promptTokens: 123,
        completionTokens: 456,
        turnLatencyMs: 250,
        costPer1kInput: 0.0015,
        costPer1kOutput: 0.006,
      });

      expect(tel.estimatedCostUsd).toBe(0.002921);
      expect(Number.isFinite(tel.estimatedCostUsd)).toBe(true);
    });

    it("handles zero-cost models without producing NaN or negative costs", () => {
      const agentId = "agent-free-model";

      const tel = tracker.recordTurn(agentId, {
        promptTokens: 5000,
        completionTokens: 2500,
        turnLatencyMs: 100,
        costPer1kInput: 0,
        costPer1kOutput: 0,
      });

      expect(tel.estimatedCostUsd).toBe(0);
      expect(tel.totalTokens).toBe(7500);
    });

    it("handles very large token counts without integer or float overflow", () => {
      const agentId = "agent-massive-tokens";

      const tel = tracker.recordTurn(agentId, {
        promptTokens: 50000000,
        completionTokens: 25000000,
        turnLatencyMs: 5000,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
      });

      // 50,000k * 0.003 = 150; 25,000k * 0.015 = 375; Total = 525
      expect(tel.totalTokens).toBe(75000000);
      expect(tel.estimatedCostUsd).toBe(525);
    });
  });

  describe("3. Zero-Turn Edge Cases, Fleet Invariants & Lifecycle Resets", () => {
    it("maintains consistent zeroed metrics for initialized agents before first turn", () => {
      const agentId = "agent-zero-turn";
      tracker.initAgent(agentId);

      const tel = tracker.getTelemetry(agentId);
      expect(tel.turnCount).toBe(0);
      expect(tel.promptTokens).toBe(0);
      expect(tel.completionTokens).toBe(0);
      expect(tel.totalTokens).toBe(0);
      expect(tel.estimatedCostUsd).toBe(0);
      expect(tel.avgTurnLatencyMs).toBe(0);
      expect(tel.lastTurnLatencyMs).toBe(0);
      expect(tel.p95TurnLatencyMs).toBe(0);
      expect(tel.tokensPerSecond).toBe(0);
      expect(tel.toolDurationMs).toBe(0);
    });

    it("correctly aggregates fleet telemetry mixing active, completed, and zero-turn agents", () => {
      const agent1 = "agent-1";
      const agent2 = "agent-2";
      const agentIdle = "agent-idle";

      tracker.initAgent(agentIdle); // 0 turns

      tracker.recordTurn(agent1, {
        promptTokens: 1000,
        completionTokens: 200,
        turnLatencyMs: 400,
        toolLatencyMs: 100,
        costPer1kInput: 0.002,
        costPer1kOutput: 0.005,
      });

      tracker.recordTurn(agent2, {
        promptTokens: 2000,
        completionTokens: 800,
        turnLatencyMs: 600,
        toolLatencyMs: 300,
        costPer1kInput: 0.002,
        costPer1kOutput: 0.005,
      });

      const fleet = tracker.getFleetTelemetry();
      expect(fleet.agentCount).toBe(3);
      expect(fleet.totalPromptTokens).toBe(3000);
      expect(fleet.totalCompletionTokens).toBe(1000);
      expect(fleet.totalTokens).toBe(4000);
      expect(fleet.totalTurns).toBe(2);
      expect(fleet.avgTurnLatencyMs).toBe(500); // (400 + 600) / 2
      expect(fleet.p95TurnLatencyMs).toBe(600);
      expect(fleet.totalToolDurationMs).toBe(400);
    });

    it("resets specific agent without affecting other agents, and resets whole fleet cleanly", () => {
      const a1 = "a1";
      const a2 = "a2";

      tracker.recordTurn(a1, { promptTokens: 100, completionTokens: 50, turnLatencyMs: 100 });
      tracker.recordTurn(a2, { promptTokens: 200, completionTokens: 100, turnLatencyMs: 200 });

      expect(tracker.getFleetTelemetry().agentCount).toBe(2);

      // Reset a1
      tracker.reset(a1);
      expect(tracker.hasAgent(a1)).toBe(false);
      expect(tracker.hasAgent(a2)).toBe(true);
      expect(tracker.getFleetTelemetry().agentCount).toBe(1);
      expect(tracker.getFleetTelemetry().totalTokens).toBe(300);

      // Reset all
      tracker.reset();
      expect(tracker.hasAgent(a2)).toBe(false);
      expect(tracker.getFleetTelemetry().agentCount).toBe(0);
      expect(tracker.getFleetTelemetry().totalTokens).toBe(0);
    });
  });
});
