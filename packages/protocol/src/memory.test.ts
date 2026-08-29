import { describe, expect, it } from "vitest";
import {
  MEMORY_ERROR_CODES,
  DEFAULT_MEMORY_NAMESPACE,
  MAX_MEMORY_KEY_LENGTH,
  MAX_MEMORY_NAMESPACE_LENGTH,
  MAX_MEMORY_TAG_LENGTH,
  MAX_MEMORY_QUERY_LIMIT,
  DEFAULT_MEMORY_QUERY_LIMIT,
  memoryEntrySchema,
  memorySetParamsSchema,
  memorySetResultSchema,
  memoryGetParamsSchema,
  memoryGetResultSchema,
  memoryQueryParamsSchema,
  memoryQueryResultSchema,
  memoryDeleteParamsSchema,
  memoryDeleteResultSchema,
  memoryLifecycleEventSchema,
  formatMemoryKey,
  parseMemoryKey,
  isMemoryExpired,
  createMemoryEntry,
  matchesMemoryQuery,
  validateMemoryNamespace,
  validateMemoryKey,
  type MemoryEntry,
  type MemoryLifecycleEvent,
} from "./memory";

describe("Protocol Shared Memory & Lifecycle Schemas Suite", () => {
  const sampleUuid = "123e4567-e89b-12d3-a456-426614174000";
  const sampleTimestamp = "2026-08-15T12:00:00.000Z";
  const futureTimestamp = "2026-08-15T13:00:00.000Z";
  const pastTimestamp = "2026-08-15T11:00:00.000Z";

  /* ------------------------------------------------------------------------ */
  /* 1. Protocol Constants & Error Codes                                      */
  /* ------------------------------------------------------------------------ */

  describe("Constants & Error Codes", () => {
    it("exports standard constants", () => {
      expect(DEFAULT_MEMORY_NAMESPACE).toBe("global");
      expect(MAX_MEMORY_KEY_LENGTH).toBe(256);
      expect(MAX_MEMORY_NAMESPACE_LENGTH).toBe(128);
      expect(MAX_MEMORY_TAG_LENGTH).toBe(64);
      expect(MAX_MEMORY_QUERY_LIMIT).toBe(100);
      expect(DEFAULT_MEMORY_QUERY_LIMIT).toBe(50);
    });

    it("exports canonical error codes", () => {
      expect(MEMORY_ERROR_CODES.ERR_MEMORY_KEY_INVALID).toBe("ERR_MEMORY_KEY_INVALID");
      expect(MEMORY_ERROR_CODES.ERR_MEMORY_NAMESPACE_INVALID).toBe("ERR_MEMORY_NAMESPACE_INVALID");
      expect(MEMORY_ERROR_CODES.ERR_MEMORY_TTL_INVALID).toBe("ERR_MEMORY_TTL_INVALID");
      expect(MEMORY_ERROR_CODES.ERR_MEMORY_ENTRY_NOT_FOUND).toBe("ERR_MEMORY_ENTRY_NOT_FOUND");
      expect(MEMORY_ERROR_CODES.ERR_MEMORY_LIMIT_EXCEEDED).toBe("ERR_MEMORY_LIMIT_EXCEEDED");
      expect(MEMORY_ERROR_CODES.ERR_MEMORY_UNAUTHORIZED).toBe("ERR_MEMORY_UNAUTHORIZED");
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 2. MemoryEntry Schema                                                    */
  /* ------------------------------------------------------------------------ */

  describe("memoryEntrySchema", () => {
    it("parses valid MemoryEntry with full fields", () => {
      const raw: MemoryEntry = {
        key: "system.architecture",
        value: { layers: ["protocol", "agent-host", "ui"], status: "active" },
        namespace: "swarm:project_1",
        authorId: sampleUuid,
        authorName: "ArchitectAgent",
        tags: ["architecture", "spec", "v1"],
        version: 3,
        createdAt: sampleTimestamp,
        updatedAt: sampleTimestamp,
        ttlSeconds: 3600,
        expiresAt: futureTimestamp,
      };

      const parsed = memoryEntrySchema.parse(raw);
      expect(parsed.key).toBe("system.architecture");
      expect(parsed.namespace).toBe("swarm:project_1");
      expect(parsed.version).toBe(3);
      expect(parsed.authorId).toBe(sampleUuid);
      expect(parsed.tags).toEqual(["architecture", "spec", "v1"]);
      expect(parsed.ttlSeconds).toBe(3600);
      expect(parsed.expiresAt).toBe(futureTimestamp);
    });

    it("applies default values for namespace, tags, and version", () => {
      const raw = {
        key: "config.port",
        value: 8080,
        createdAt: sampleTimestamp,
        updatedAt: sampleTimestamp,
      };

      const parsed = memoryEntrySchema.parse(raw);
      expect(parsed.namespace).toBe("global");
      expect(parsed.tags).toEqual([]);
      expect(parsed.version).toBe(1);
      expect(parsed.value).toBe(8080);
      expect(parsed.authorId).toBeUndefined();
      expect(parsed.ttlSeconds).toBeUndefined();
      expect(parsed.expiresAt).toBeUndefined();
    });

    it("supports various data types in value (primitive, array, object, null)", () => {
      const primitives = [
        "a string value",
        42,
        3.14159,
        true,
        false,
        null,
        [1, 2, "three", { four: 4 }],
        { nested: { deeply: { key: "val" } } },
      ];

      for (const val of primitives) {
        const parsed = memoryEntrySchema.parse({
          key: "test.key",
          value: val,
          createdAt: sampleTimestamp,
          updatedAt: sampleTimestamp,
        });
        expect(parsed.value).toEqual(val);
      }
    });

    it("rejects invalid key, namespace, tags, and timestamps", () => {
      // Empty key
      expect(() =>
        memoryEntrySchema.parse({
          key: "",
          value: "test",
          createdAt: sampleTimestamp,
          updatedAt: sampleTimestamp,
        })
      ).toThrow();

      // Key exceeding 256 chars
      expect(() =>
        memoryEntrySchema.parse({
          key: "k".repeat(257),
          value: "test",
          createdAt: sampleTimestamp,
          updatedAt: sampleTimestamp,
        })
      ).toThrow();

      // Empty namespace
      expect(() =>
        memoryEntrySchema.parse({
          key: "valid.key",
          value: "test",
          namespace: "",
          createdAt: sampleTimestamp,
          updatedAt: sampleTimestamp,
        })
      ).toThrow();

      // Namespace exceeding 128 chars
      expect(() =>
        memoryEntrySchema.parse({
          key: "valid.key",
          value: "test",
          namespace: "n".repeat(129),
          createdAt: sampleTimestamp,
          updatedAt: sampleTimestamp,
        })
      ).toThrow();

      // Tag exceeding 64 chars
      expect(() =>
        memoryEntrySchema.parse({
          key: "valid.key",
          value: "test",
          tags: ["t".repeat(65)],
          createdAt: sampleTimestamp,
          updatedAt: sampleTimestamp,
        })
      ).toThrow();

      // Empty tag string
      expect(() =>
        memoryEntrySchema.parse({
          key: "valid.key",
          value: "test",
          tags: [""],
          createdAt: sampleTimestamp,
          updatedAt: sampleTimestamp,
        })
      ).toThrow();

      // Negative or non-integer version
      expect(() =>
        memoryEntrySchema.parse({
          key: "valid.key",
          value: "test",
          version: -1,
          createdAt: sampleTimestamp,
          updatedAt: sampleTimestamp,
        })
      ).toThrow();

      expect(() =>
        memoryEntrySchema.parse({
          key: "valid.key",
          value: "test",
          version: 1.5,
          createdAt: sampleTimestamp,
          updatedAt: sampleTimestamp,
        })
      ).toThrow();

      // Invalid datetime
      expect(() =>
        memoryEntrySchema.parse({
          key: "valid.key",
          value: "test",
          createdAt: "not-a-datetime",
          updatedAt: sampleTimestamp,
        })
      ).toThrow();

      // Non-UUID authorId
      expect(() =>
        memoryEntrySchema.parse({
          key: "valid.key",
          value: "test",
          authorId: "invalid-uuid",
          createdAt: sampleTimestamp,
          updatedAt: sampleTimestamp,
        })
      ).toThrow();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Tool Parameters & Result Schemas                                      */
  /* ------------------------------------------------------------------------ */

  describe("Tool Schemas (set, get, query, delete)", () => {
    it("validates memorySetParamsSchema & memorySetResultSchema", () => {
      // Default namespace and tags
      const setParams = memorySetParamsSchema.parse({
        key: "database.url",
        value: "postgres://localhost:5432/test",
      });
      expect(setParams.namespace).toBe("global");
      expect(setParams.tags).toEqual([]);
      expect(setParams.ttlSeconds).toBeUndefined();

      // Full params
      const fullSetParams = memorySetParamsSchema.parse({
        key: "session.token",
        value: "abc123xyz",
        namespace: "auth",
        tags: ["jwt", "session"],
        ttlSeconds: 300,
      });
      expect(fullSetParams.namespace).toBe("auth");
      expect(fullSetParams.ttlSeconds).toBe(300);

      // Result validation
      const entry: MemoryEntry = {
        key: "session.token",
        value: "abc123xyz",
        namespace: "auth",
        tags: ["jwt", "session"],
        version: 1,
        createdAt: sampleTimestamp,
        updatedAt: sampleTimestamp,
        ttlSeconds: 300,
      };
      const result = memorySetResultSchema.parse({
        success: true,
        entry,
      });
      expect(result.success).toBe(true);
      expect(result.entry.key).toBe("session.token");
    });

    it("validates memoryGetParamsSchema & memoryGetResultSchema", () => {
      // Default namespace
      const getParams = memoryGetParamsSchema.parse({
        key: "database.url",
      });
      expect(getParams.namespace).toBe("global");

      // Custom namespace
      const customGetParams = memoryGetParamsSchema.parse({
        key: "user:100",
        namespace: "cache",
      });
      expect(customGetParams.namespace).toBe("cache");

      // Found result
      const foundResult = memoryGetResultSchema.parse({
        found: true,
        entry: {
          key: "database.url",
          value: "postgres://localhost:5432/test",
          namespace: "global",
          tags: [],
          version: 1,
          createdAt: sampleTimestamp,
          updatedAt: sampleTimestamp,
        },
      });
      expect(foundResult.found).toBe(true);
      expect(foundResult.entry?.key).toBe("database.url");

      // Not found result
      const notFoundResult = memoryGetResultSchema.parse({
        found: false,
        entry: null,
      });
      expect(notFoundResult.found).toBe(false);
      expect(notFoundResult.entry).toBeNull();
    });

    it("validates memoryQueryParamsSchema & memoryQueryResultSchema", () => {
      // Default query params
      const defaultQuery = memoryQueryParamsSchema.parse({});
      expect(defaultQuery.limit).toBe(50);
      expect(defaultQuery.offset).toBe(0);
      expect(defaultQuery.namespace).toBeUndefined();
      expect(defaultQuery.query).toBeUndefined();
      expect(defaultQuery.tags).toBeUndefined();

      // Custom query params
      const customQuery = memoryQueryParamsSchema.parse({
        namespace: "project:123",
        query: "fastify",
        tags: ["routing", "http"],
        limit: 20,
        offset: 10,
      });
      expect(customQuery.limit).toBe(20);
      expect(customQuery.offset).toBe(10);
      expect(customQuery.query).toBe("fastify");

      // Query boundary validations
      expect(() =>
        memoryQueryParamsSchema.parse({ limit: 0 })
      ).toThrow();

      expect(() =>
        memoryQueryParamsSchema.parse({ limit: 101 })
      ).toThrow();

      expect(() =>
        memoryQueryParamsSchema.parse({ offset: -1 })
      ).toThrow();

      // Result schema
      const queryResult = memoryQueryResultSchema.parse({
        entries: [
          {
            key: "item.1",
            value: 1,
            namespace: "project:123",
            tags: ["routing"],
            version: 1,
            createdAt: sampleTimestamp,
            updatedAt: sampleTimestamp,
          },
        ],
        total: 1,
      });
      expect(queryResult.total).toBe(1);
      expect(queryResult.entries).toHaveLength(1);
    });

    it("validates memoryDeleteParamsSchema & memoryDeleteResultSchema", () => {
      const deleteParams = memoryDeleteParamsSchema.parse({
        key: "old.record",
        namespace: "archive",
      });
      expect(deleteParams.key).toBe("old.record");
      expect(deleteParams.namespace).toBe("archive");

      const deleteResult = memoryDeleteResultSchema.parse({
        success: true,
        deleted: true,
      });
      expect(deleteResult.success).toBe(true);
      expect(deleteResult.deleted).toBe(true);

      const notDeletedResult = memoryDeleteResultSchema.parse({
        success: true,
        deleted: false,
      });
      expect(notDeletedResult.deleted).toBe(false);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Wire Protocol Lifecycle Events                                        */
  /* ------------------------------------------------------------------------ */

  describe("memoryLifecycleEventSchema", () => {
    const entry: MemoryEntry = {
      key: "swarm.state",
      value: { activeNodes: 4 },
      namespace: "swarm",
      tags: ["swarm"],
      version: 2,
      createdAt: sampleTimestamp,
      updatedAt: sampleTimestamp,
    };

    it("validates memory.entry_set event", () => {
      const event: MemoryLifecycleEvent = {
        type: "memory.entry_set",
        entry,
        at: sampleTimestamp,
      };
      const parsed = memoryLifecycleEventSchema.parse(event);
      expect(parsed.type).toBe("memory.entry_set");
      if (parsed.type === "memory.entry_set") {
        expect(parsed.entry.key).toBe("swarm.state");
      }
    });

    it("validates memory.entry_deleted event", () => {
      const event: MemoryLifecycleEvent = {
        type: "memory.entry_deleted",
        key: "swarm.state",
        namespace: "swarm",
        at: sampleTimestamp,
      };
      const parsed = memoryLifecycleEventSchema.parse(event);
      expect(parsed.type).toBe("memory.entry_deleted");
      if (parsed.type === "memory.entry_deleted") {
        expect(parsed.key).toBe("swarm.state");
        expect(parsed.namespace).toBe("swarm");
      }
    });

    it("validates memory.cleared event with and without namespace", () => {
      const eventWithNamespace: MemoryLifecycleEvent = {
        type: "memory.cleared",
        namespace: "temp",
        at: sampleTimestamp,
      };
      const parsed1 = memoryLifecycleEventSchema.parse(eventWithNamespace);
      expect(parsed1.type).toBe("memory.cleared");
      if (parsed1.type === "memory.cleared") {
        expect(parsed1.namespace).toBe("temp");
      }

      const eventGlobal: MemoryLifecycleEvent = {
        type: "memory.cleared",
        at: sampleTimestamp,
      };
      const parsed2 = memoryLifecycleEventSchema.parse(eventGlobal);
      expect(parsed2.type).toBe("memory.cleared");
      if (parsed2.type === "memory.cleared") {
        expect(parsed2.namespace).toBeUndefined();
      }
    });

    it("rejects unknown event types", () => {
      expect(() =>
        memoryLifecycleEventSchema.parse({
          type: "memory.unknown_event",
          at: sampleTimestamp,
        })
      ).toThrow();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Pure Helper Utilities                                                 */
  /* ------------------------------------------------------------------------ */

  describe("Pure Helper Utilities", () => {
    it("formats and parses memory keys with formatMemoryKey and parseMemoryKey", () => {
      expect(formatMemoryKey("swarm", "leadAgent")).toBe("swarm:::leadAgent");
      expect(formatMemoryKey("", "leadAgent")).toBe("global:::leadAgent");

      expect(parseMemoryKey("swarm:::leadAgent")).toEqual({
        namespace: "swarm",
        key: "leadAgent",
      });
      expect(parseMemoryKey("leadAgent")).toEqual({
        namespace: "global",
        key: "leadAgent",
      });
      expect(parseMemoryKey(":::orphanKey")).toEqual({
        namespace: "global",
        key: "orphanKey",
      });
    });

    it("checks expiration accurately with isMemoryExpired", () => {
      // No expiration set
      expect(isMemoryExpired({ expiresAt: undefined })).toBe(false);
      expect(isMemoryExpired({ expiresAt: null })).toBe(false);

      // Future expiration against reference time
      const refTime = new Date(sampleTimestamp).getTime();
      expect(isMemoryExpired({ expiresAt: futureTimestamp }, refTime)).toBe(false);

      // Past expiration against reference time
      expect(isMemoryExpired({ expiresAt: pastTimestamp }, refTime)).toBe(true);

      // Exact expiration matches (is expired)
      expect(isMemoryExpired({ expiresAt: sampleTimestamp }, refTime)).toBe(true);
    });

    it("creates MemoryEntry with createMemoryEntry factory", () => {
      const refTime = new Date(sampleTimestamp).getTime();
      const entry = createMemoryEntry(
        {
          key: "cache.ttl_item",
          value: { count: 99 },
          namespace: "cache",
          tags: ["ephemeral"],
          ttlSeconds: 60,
        },
        {
          authorId: sampleUuid,
          authorName: "Worker",
          version: 2,
          now: refTime,
        }
      );

      expect(entry.key).toBe("cache.ttl_item");
      expect(entry.namespace).toBe("cache");
      expect(entry.version).toBe(2);
      expect(entry.authorId).toBe(sampleUuid);
      expect(entry.authorName).toBe("Worker");
      expect(entry.createdAt).toBe(sampleTimestamp);
      expect(entry.updatedAt).toBe(sampleTimestamp);
      expect(entry.ttlSeconds).toBe(60);
      expect(entry.expiresAt).toBe(new Date(refTime + 60000).toISOString());
    });

    it("matches query criteria with matchesMemoryQuery", () => {
      const entry: MemoryEntry = {
        key: "services.paymentGateway.stripe",
        value: { apiKey: "sk_test_123", mode: "sandbox" },
        namespace: "services",
        tags: ["finance", "stripe", "api"],
        version: 1,
        createdAt: sampleTimestamp,
        updatedAt: sampleTimestamp,
      };

      // Exact namespace match
      expect(matchesMemoryQuery(entry, { namespace: "services" })).toBe(true);
      expect(matchesMemoryQuery(entry, { namespace: "database" })).toBe(false);

      // Substring query match in key
      expect(matchesMemoryQuery(entry, { query: "payment" })).toBe(true);
      expect(matchesMemoryQuery(entry, { query: "stripe" })).toBe(true);

      // Substring query match in serialized value
      expect(matchesMemoryQuery(entry, { query: "sandbox" })).toBe(true);
      expect(matchesMemoryQuery(entry, { query: "nonexistent" })).toBe(false);

      // Tag matching
      expect(matchesMemoryQuery(entry, { tags: ["stripe"] })).toBe(true);
      expect(matchesMemoryQuery(entry, { tags: ["finance", "other"] })).toBe(true);
      expect(matchesMemoryQuery(entry, { tags: ["crypto", "blockchain"] })).toBe(false);

      // Combined matching
      expect(
        matchesMemoryQuery(entry, {
          namespace: "services",
          query: "stripe",
          tags: ["finance"],
        })
      ).toBe(true);

      expect(
        matchesMemoryQuery(entry, {
          namespace: "services",
          query: "stripe",
          tags: ["missing_tag"],
        })
      ).toBe(false);
    });

    it("validates namespace and key strings with validateMemoryNamespace & validateMemoryKey", () => {
      // Namespaces
      expect(validateMemoryNamespace("global")).toBe(true);
      expect(validateMemoryNamespace("swarm:team_1")).toBe(true);
      expect(validateMemoryNamespace("agent-123.workspace/v2")).toBe(true);

      expect(validateMemoryNamespace("")).toBe(false);
      expect(validateMemoryNamespace(" ")).toBe(false);
      expect(validateMemoryNamespace("namespace with space")).toBe(false);
      expect(validateMemoryNamespace("n".repeat(129))).toBe(false);

      // Keys
      expect(validateMemoryKey("config.json")).toBe(true);
      expect(validateMemoryKey("task-result-42")).toBe(true);
      expect(validateMemoryKey("a".repeat(256))).toBe(true);

      expect(validateMemoryKey("")).toBe(false);
      expect(validateMemoryKey("   ")).toBe(false);
      expect(validateMemoryKey("key\0withNullByte")).toBe(false);
      expect(validateMemoryKey("k".repeat(257))).toBe(false);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Adversarial, Stress, & Serialization Tests                            */
  /* ------------------------------------------------------------------------ */

  describe("Adversarial & Serialization Tests", () => {
    it("handles hostile injection strings in keys and namespaces without failure", () => {
      const hostileStrings = [
        "../../etc/passwd",
        "..\\..\\windows\\system32",
        "<script>alert('xss')</script>",
        "SELECT * FROM memory WHERE '1'='1';",
        "'; DROP TABLE memory; --",
        "key\nwith\nnewlines",
        "emoji_🔑_name",
        "{}[]()!@#$%^&*()_+",
      ];

      for (const hostile of hostileStrings) {
        // As long as key length <= 256 and non-empty, it parses safely
        if (hostile.length <= 256 && hostile.length > 0) {
          const parsed = memoryEntrySchema.parse({
            key: hostile,
            value: { injected: hostile },
            createdAt: sampleTimestamp,
            updatedAt: sampleTimestamp,
          });
          expect(parsed.key).toBe(hostile);
        }
      }
    });

    it("ensures JSON round-trip serialization preserves all types correctly", () => {
      const entry: MemoryEntry = {
        key: "complex.structure",
        value: {
          num: 123.456,
          bool: true,
          nested: [null, "string", { inner: false }],
        },
        namespace: "deep",
        authorId: sampleUuid,
        authorName: "Serializer",
        tags: ["json", "serialization"],
        version: 10,
        createdAt: sampleTimestamp,
        updatedAt: sampleTimestamp,
        ttlSeconds: 7200,
        expiresAt: futureTimestamp,
      };

      const serialized = JSON.stringify(entry);
      const deserialized = JSON.parse(serialized);
      const reparsed = memoryEntrySchema.parse(deserialized);

      expect(reparsed).toEqual(entry);
    });

    it("rejects non-positive and float ttlSeconds in memorySetParamsSchema", () => {
      expect(() =>
        memorySetParamsSchema.parse({
          key: "ttl.test",
          value: 123,
          ttlSeconds: 0,
        })
      ).toThrow();

      expect(() =>
        memorySetParamsSchema.parse({
          key: "ttl.test",
          value: 123,
          ttlSeconds: -100,
        })
      ).toThrow();

      expect(() =>
        memorySetParamsSchema.parse({
          key: "ttl.test",
          value: 123,
          ttlSeconds: 15.5,
        })
      ).toThrow();
    });
  });
});
