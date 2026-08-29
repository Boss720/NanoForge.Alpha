import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SharedMemoryEngine } from "./memory.js";
import {
  executeMemorySetTool,
  executeMemoryGetTool,
  executeMemoryQueryTool,
  executeMemoryDeleteTool,
} from "./tools.js";

describe("SharedMemoryEngine", () => {
  let memory: SharedMemoryEngine;

  beforeEach(() => {
    memory = new SharedMemoryEngine();
  });

  afterEach(() => {
    memory.dispose();
  });

  describe("CRUD operations & Versioning", () => {
    it("sets and gets an entry with default namespace", () => {
      const setResult = memory.set({
        key: "system_architecture",
        value: { layers: ["protocol", "agent-host", "ui"] },
        tags: ["arch", "design"],
      });

      expect(setResult.success).toBe(true);
      expect(setResult.entry.key).toBe("system_architecture");
      expect(setResult.entry.namespace).toBe("global");
      expect(setResult.entry.version).toBe(1);
      expect(setResult.entry.tags).toEqual(["arch", "design"]);
      expect(setResult.entry.createdAt).toBeDefined();
      expect(setResult.entry.updatedAt).toBeDefined();

      const getResult = memory.get({ key: "system_architecture" });
      expect(getResult.found).toBe(true);
      expect(getResult.entry).toEqual(setResult.entry);
    });

    it("increments version number and updates timestamps on subsequent writes", async () => {
      const firstSet = memory.set({
        key: "counter",
        value: 10,
        namespace: "swarm",
      });
      expect(firstSet.entry.version).toBe(1);

      // Sleep a tiny bit to ensure timestamp differs if needed
      await new Promise((r) => setTimeout(r, 5));

      const secondSet = memory.set({
        key: "counter",
        value: 20,
        namespace: "swarm",
      });
      expect(secondSet.entry.version).toBe(2);
      expect(secondSet.entry.value).toBe(20);
      expect(secondSet.entry.createdAt).toBe(firstSet.entry.createdAt);

      const thirdSet = memory.set({
        key: "counter",
        value: 30,
        namespace: "swarm",
      });
      expect(thirdSet.entry.version).toBe(3);
      expect(thirdSet.entry.value).toBe(30);
    });

    it("returns found: false when getting non-existent key", () => {
      const getResult = memory.get({ key: "missing_key", namespace: "global" });
      expect(getResult.found).toBe(false);
      expect(getResult.entry).toBeNull();
    });

    it("deletes an existing key and reports success", () => {
      memory.set({ key: "temporary_note", value: "clean me up" });
      expect(memory.get({ key: "temporary_note" }).found).toBe(true);

      const delResult = memory.delete({ key: "temporary_note" });
      expect(delResult.success).toBe(true);
      expect(delResult.deleted).toBe(true);

      const afterGet = memory.get({ key: "temporary_note" });
      expect(afterGet.found).toBe(false);

      // Deleting again returns deleted: false
      const delAgain = memory.delete({ key: "temporary_note" });
      expect(delAgain.success).toBe(true);
      expect(delAgain.deleted).toBe(false);
    });

    it("clears entries across all namespaces or within a specific namespace", () => {
      memory.set({ key: "g1", value: 1, namespace: "global" });
      memory.set({ key: "g2", value: 2, namespace: "global" });
      memory.set({ key: "s1", value: 1, namespace: "swarm" });
      memory.set({ key: "a1", value: 1, namespace: "agent:123" });

      expect(memory.size).toBe(4);

      // Clear only swarm namespace
      const clearedSwarm = memory.clear("swarm");
      expect(clearedSwarm).toBe(1);
      expect(memory.size).toBe(3);
      expect(memory.get({ key: "s1", namespace: "swarm" }).found).toBe(false);
      expect(memory.get({ key: "g1", namespace: "global" }).found).toBe(true);

      // Clear all remaining namespaces
      const clearedAll = memory.clear();
      expect(clearedAll).toBe(3);
      expect(memory.size).toBe(0);
    });
  });

  describe("Namespace Sandboxing & Isolation", () => {
    it("maintains complete key isolation across different namespaces", () => {
      memory.set({ key: "config", value: "global_value", namespace: "global" });
      memory.set({ key: "config", value: "swarm_value", namespace: "swarm" });
      memory.set({ key: "config", value: "agent_a_value", namespace: "agent:a" });
      memory.set({ key: "config", value: "private_a_value", namespace: "private:a" });

      expect(memory.get({ key: "config", namespace: "global" }).entry?.value).toBe("global_value");
      expect(memory.get({ key: "config", namespace: "swarm" }).entry?.value).toBe("swarm_value");
      expect(memory.get({ key: "config", namespace: "agent:a" }).entry?.value).toBe("agent_a_value");
      expect(memory.get({ key: "config", namespace: "private:a" }).entry?.value).toBe("private_a_value");

      // Deleting from one namespace does not affect others
      memory.delete({ key: "config", namespace: "swarm" });
      expect(memory.get({ key: "config", namespace: "swarm" }).found).toBe(false);
      expect(memory.get({ key: "config", namespace: "global" }).found).toBe(true);
      expect(memory.get({ key: "config", namespace: "agent:a" }).found).toBe(true);
    });

    it("rejects invalid namespace names and keys with control characters", () => {
      expect(() => {
        memory.set({ key: "valid_key", value: 1, namespace: "invalid namespace with spaces!" });
      }).toThrow(/Invalid memory namespace/);

      expect(() => {
        memory.set({ key: "bad\0key", value: 1, namespace: "global" });
      }).toThrow();
    });
  });

  describe("TTL Expiration & Sweeping", () => {
    it("expires keys after specified TTL seconds", async () => {
      vi.useFakeTimers();

      memory.set({
        key: "ephemeral_token",
        value: "secret_123",
        ttlSeconds: 2,
      });

      expect(memory.get({ key: "ephemeral_token" }).found).toBe(true);

      // Advance clock by 1 second (not expired yet)
      vi.advanceTimersByTime(1000);
      expect(memory.get({ key: "ephemeral_token" }).found).toBe(true);

      // Advance clock by another 1.5 seconds (2.5s total -> expired)
      vi.advanceTimersByTime(1500);
      const res = memory.get({ key: "ephemeral_token" });
      expect(res.found).toBe(false);
      expect(res.entry).toBeNull();

      vi.useRealTimers();
    });

    it("sweepExpired cleans up all expired entries across namespaces", () => {
      vi.useFakeTimers();

      memory.set({ key: "k1", value: 1, ttlSeconds: 1, namespace: "global" });
      memory.set({ key: "k2", value: 2, ttlSeconds: 5, namespace: "swarm" });
      memory.set({ key: "k3", value: 3, namespace: "global" }); // No TTL

      expect(memory.size).toBe(3);

      // Advance 2 seconds -> k1 should be expired
      vi.advanceTimersByTime(2000);
      const swept = memory.sweepExpired();
      expect(swept).toBe(1);
      expect(memory.size).toBe(2);
      expect(memory.get({ key: "k1" }).found).toBe(false);
      expect(memory.get({ key: "k2", namespace: "swarm" }).found).toBe(true);
      expect(memory.get({ key: "k3" }).found).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("Structured Query Matching & Pagination", () => {
    beforeEach(() => {
      memory.set({
        key: "database:primary:url",
        value: "postgres://localhost:5432/main",
        namespace: "global",
        tags: ["database", "infra", "prod"],
      });
      memory.set({
        key: "database:replica:url",
        value: "postgres://replica:5432/main",
        namespace: "global",
        tags: ["database", "infra", "read-only"],
      });
      memory.set({
        key: "redis:cache:url",
        value: "redis://localhost:6379",
        namespace: "global",
        tags: ["cache", "infra"],
      });
      memory.set({
        key: "subagent:task_status",
        value: "running query analysis",
        namespace: "swarm",
        tags: ["status", "swarm"],
      });
    });

    it("queries by namespace filter", () => {
      const res = memory.query({ namespace: "swarm" });
      expect(res.total).toBe(1);
      expect(res.entries[0].key).toBe("subagent:task_status");
    });

    it("queries with text search across keys and values", () => {
      // Matches key
      const keySearch = memory.query({ query: "replica" });
      expect(keySearch.total).toBe(1);
      expect(keySearch.entries[0].key).toBe("database:replica:url");

      // Matches value
      const valSearch = memory.query({ query: "6379" });
      expect(valSearch.total).toBe(1);
      expect(valSearch.entries[0].key).toBe("redis:cache:url");
    });

    it("queries with tag matching", () => {
      const tagSearch = memory.query({ tags: ["read-only"] });
      expect(tagSearch.total).toBe(1);
      expect(tagSearch.entries[0].key).toBe("database:replica:url");

      const multiTagSearch = memory.query({ tags: ["database", "cache"] });
      expect(multiTagSearch.total).toBe(3);
    });

    it("supports pagination with limit and offset", () => {
      const page1 = memory.query({ namespace: "global", limit: 2, offset: 0 });
      expect(page1.total).toBe(3);
      expect(page1.entries.length).toBe(2);

      const page2 = memory.query({ namespace: "global", limit: 2, offset: 2 });
      expect(page2.total).toBe(3);
      expect(page2.entries.length).toBe(1);
      expect(page2.entries[0].key).not.toBe(page1.entries[0].key);
    });
  });

  describe("Lifecycle Event Notifications", () => {
    it("emits memory.entry_set when an entry is added or updated", () => {
      const events: any[] = [];
      memory.subscribe((e) => events.push(e));

      memory.set(
        { key: "greeting", value: "hello world" },
        { id: "a1111111-1111-4111-8111-111111111111", name: "agent_1" }
      );

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("memory.entry_set");
      expect(events[0].entry.key).toBe("greeting");
      expect(events[0].entry.authorName).toBe("agent_1");
    });

    it("emits memory.entry_deleted when an entry is removed", () => {
      const events: any[] = [];
      memory.set({ key: "obsolete", value: 123 });
      memory.subscribe((e) => events.push(e));

      memory.delete({ key: "obsolete" });

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("memory.entry_deleted");
      expect(events[0].key).toBe("obsolete");
    });

    it("emits memory.cleared when clear() is invoked", () => {
      const events: any[] = [];
      memory.set({ key: "a", value: 1 });
      memory.subscribe((e) => events.push(e));

      memory.clear("global");

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("memory.cleared");
      expect(events[0].namespace).toBe("global");
    });
  });

  describe("Tool Execution Handlers", () => {
    it("executes executeMemorySetTool and returns parsed result", async () => {
      const result = await executeMemorySetTool(
        memory,
        {
          key: "tool_key",
          value: { status: "ok" },
          tags: ["tool"],
        },
        { id: "b2222222-2222-4222-8222-222222222222", name: "Explorer" }
      );

      expect(result.success).toBe(true);
      expect(result.entry.key).toBe("tool_key");
      expect(result.entry.authorName).toBe("Explorer");
    });

    it("executes executeMemoryGetTool and returns parsed result", async () => {
      memory.set({ key: "test_get", value: 42 });

      const result = await executeMemoryGetTool(memory, {
        key: "test_get",
      });

      expect(result.found).toBe(true);
      expect(result.entry?.value).toBe(42);
    });

    it("executes executeMemoryQueryTool and returns parsed result", async () => {
      memory.set({ key: "query_1", value: "apple" });
      memory.set({ key: "query_2", value: "banana" });

      const result = await executeMemoryQueryTool(memory, {
        query: "banana",
      });

      expect(result.total).toBe(1);
      expect(result.entries[0].key).toBe("query_2");
    });

    it("executes executeMemoryDeleteTool and returns parsed result", async () => {
      memory.set({ key: "to_delete", value: true });

      const result = await executeMemoryDeleteTool(memory, {
        key: "to_delete",
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(true);
    });
  });

  describe("Concurrency & Race Condition Handling", () => {
    it("handles 50 concurrent writes to the same key deterministically incrementing versions", async () => {
      const writes = Array.from({ length: 50 }, (_, i) =>
        Promise.resolve().then(() =>
          memory.set({
            key: "concurrent_key",
            value: `write_${i}`,
            namespace: "swarm",
          })
        )
      );

      await Promise.all(writes);

      const entry = memory.get({ key: "concurrent_key", namespace: "swarm" }).entry;
      expect(entry).toBeDefined();
      expect(entry?.version).toBe(50);
    });

    it("handles 100 concurrent writes across distinct namespaces without collision", async () => {
      const writes = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve().then(() =>
          memory.set({
            key: `key_${i % 10}`,
            value: `val_${i}`,
            namespace: `namespace_${Math.floor(i / 10)}`,
          })
        )
      );

      await Promise.all(writes);
      expect(memory.size).toBe(100);
    });
  });
});
