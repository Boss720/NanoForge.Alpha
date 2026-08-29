/**
 * Cross-Agent Shared Memory Protocol, Wire Schemas, & Pure Utilities.
 *
 * Provides isomorphic Zod schemas, TypeScript types, and helper utilities for
 * cross-agent key-value shared memory, namespace sandboxing, tag indexing,
 * TTL expiration, tool parameters, and WebSocket lifecycle wire frames.
 *
 * ZERO Node.js runtime dependencies (pure TypeScript/Zod).
 */

import { z } from "zod";
import { jsonValueSchema } from "./json";

/* ------------------------------------------------------------------ */
/* 1. Protocol Constants & Error Codes                                */
/* ------------------------------------------------------------------ */

export const MEMORY_ERROR_CODES = {
  ERR_MEMORY_KEY_INVALID: "ERR_MEMORY_KEY_INVALID",
  ERR_MEMORY_NAMESPACE_INVALID: "ERR_MEMORY_NAMESPACE_INVALID",
  ERR_MEMORY_TTL_INVALID: "ERR_MEMORY_TTL_INVALID",
  ERR_MEMORY_ENTRY_NOT_FOUND: "ERR_MEMORY_ENTRY_NOT_FOUND",
  ERR_MEMORY_LIMIT_EXCEEDED: "ERR_MEMORY_LIMIT_EXCEEDED",
  ERR_MEMORY_UNAUTHORIZED: "ERR_MEMORY_UNAUTHORIZED",
} as const;

export type MemoryErrorCode = (typeof MEMORY_ERROR_CODES)[keyof typeof MEMORY_ERROR_CODES];

export const DEFAULT_MEMORY_NAMESPACE = "global";
export const MAX_MEMORY_KEY_LENGTH = 256;
export const MAX_MEMORY_NAMESPACE_LENGTH = 128;
export const MAX_MEMORY_TAG_LENGTH = 64;
export const MAX_MEMORY_QUERY_LIMIT = 100;
export const DEFAULT_MEMORY_QUERY_LIMIT = 50;

/* ------------------------------------------------------------------ */
/* 2. Core Data Contract: MemoryEntry                                 */
/* ------------------------------------------------------------------ */

/**
 * Core Shared Memory Entry record schema.
 */
export const memoryEntrySchema = z.object({
  key: z.string().min(1).max(MAX_MEMORY_KEY_LENGTH),
  value: jsonValueSchema,
  namespace: z.string().min(1).max(MAX_MEMORY_NAMESPACE_LENGTH).default(DEFAULT_MEMORY_NAMESPACE),
  authorId: z.string().uuid().optional(),
  authorName: z.string().max(128).optional(),
  tags: z.array(z.string().min(1).max(MAX_MEMORY_TAG_LENGTH)).default([]),
  version: z.number().int().nonnegative().default(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  ttlSeconds: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
});
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

/* ------------------------------------------------------------------ */
/* 3. Tool Parameter & Result Schemas                                 */
/* ------------------------------------------------------------------ */

/**
 * `memory.set` tool parameter and result schemas.
 */
export const memorySetParamsSchema = z.object({
  key: z.string().min(1).max(MAX_MEMORY_KEY_LENGTH),
  value: jsonValueSchema,
  namespace: z.string().min(1).max(MAX_MEMORY_NAMESPACE_LENGTH).default(DEFAULT_MEMORY_NAMESPACE),
  tags: z.array(z.string().min(1).max(MAX_MEMORY_TAG_LENGTH)).default([]),
  ttlSeconds: z.number().int().positive().optional(),
});
export type MemorySetParams = z.infer<typeof memorySetParamsSchema>;

export const memorySetResultSchema = z.object({
  success: z.boolean(),
  entry: memoryEntrySchema,
});
export type MemorySetResult = z.infer<typeof memorySetResultSchema>;

/**
 * `memory.get` tool parameter and result schemas.
 */
export const memoryGetParamsSchema = z.object({
  key: z.string().min(1).max(MAX_MEMORY_KEY_LENGTH),
  namespace: z.string().min(1).max(MAX_MEMORY_NAMESPACE_LENGTH).default(DEFAULT_MEMORY_NAMESPACE),
});
export type MemoryGetParams = z.infer<typeof memoryGetParamsSchema>;

export const memoryGetResultSchema = z.object({
  found: z.boolean(),
  entry: memoryEntrySchema.nullable().optional(),
});
export type MemoryGetResult = z.infer<typeof memoryGetResultSchema>;

/**
 * `memory.query` tool parameter and result schemas.
 */
export const memoryQueryParamsSchema = z.object({
  namespace: z.string().min(1).max(MAX_MEMORY_NAMESPACE_LENGTH).optional(),
  query: z.string().max(MAX_MEMORY_KEY_LENGTH).optional(),
  tags: z.array(z.string().min(1).max(MAX_MEMORY_TAG_LENGTH)).optional(),
  limit: z.number().int().positive().max(MAX_MEMORY_QUERY_LIMIT).default(DEFAULT_MEMORY_QUERY_LIMIT),
  offset: z.number().int().nonnegative().default(0),
});
export type MemoryQueryParams = z.infer<typeof memoryQueryParamsSchema>;
export type MemoryQueryParamsInput = z.input<typeof memoryQueryParamsSchema>;


export const memoryQueryResultSchema = z.object({
  entries: z.array(memoryEntrySchema),
  total: z.number().int().nonnegative(),
});
export type MemoryQueryResult = z.infer<typeof memoryQueryResultSchema>;

/**
 * `memory.delete` tool parameter and result schemas.
 */
export const memoryDeleteParamsSchema = z.object({
  key: z.string().min(1).max(MAX_MEMORY_KEY_LENGTH),
  namespace: z.string().min(1).max(MAX_MEMORY_NAMESPACE_LENGTH).default(DEFAULT_MEMORY_NAMESPACE),
});
export type MemoryDeleteParams = z.infer<typeof memoryDeleteParamsSchema>;

export const memoryDeleteResultSchema = z.object({
  success: z.boolean(),
  deleted: z.boolean(),
});
export type MemoryDeleteResult = z.infer<typeof memoryDeleteResultSchema>;

/* ------------------------------------------------------------------ */
/* 4. Wire Protocol Lifecycle Events                                  */
/* ------------------------------------------------------------------ */

/**
 * Shared memory lifecycle events emitted over WebSocket.
 */
export const memoryLifecycleEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("memory.entry_set"),
    entry: memoryEntrySchema,
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("memory.entry_deleted"),
    key: z.string().min(1).max(MAX_MEMORY_KEY_LENGTH),
    namespace: z.string().min(1).max(MAX_MEMORY_NAMESPACE_LENGTH),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("memory.cleared"),
    namespace: z.string().min(1).max(MAX_MEMORY_NAMESPACE_LENGTH).optional(),
    at: z.string().datetime(),
  }),
]);
export type MemoryLifecycleEvent = z.infer<typeof memoryLifecycleEventSchema>;

/* ------------------------------------------------------------------ */
/* 5. Pure Helper Utilities                                           */
/* ------------------------------------------------------------------ */

/**
 * Formats a namespaced internal storage key (e.g. `global:::myKey`).
 */
export function formatMemoryKey(namespace: string, key: string): string {
  const ns = namespace || DEFAULT_MEMORY_NAMESPACE;
  return `${ns}:::${key}`;
}

/**
 * Parses an internal namespaced storage key back into `{ namespace, key }`.
 */
export function parseMemoryKey(internalKey: string): { namespace: string; key: string } {
  const delimiterIndex = internalKey.indexOf(":::");
  if (delimiterIndex === -1) {
    return { namespace: DEFAULT_MEMORY_NAMESPACE, key: internalKey };
  }
  return {
    namespace: internalKey.slice(0, delimiterIndex) || DEFAULT_MEMORY_NAMESPACE,
    key: internalKey.slice(delimiterIndex + 3),
  };
}

/**
 * Checks whether a memory entry is expired against a reference timestamp.
 */
export function isMemoryExpired(
  entry: { expiresAt?: string | null },
  referenceTime: number | string | Date = Date.now()
): boolean {
  if (!entry.expiresAt) return false;
  const refMs =
    typeof referenceTime === "number"
      ? referenceTime
      : new Date(referenceTime).getTime();
  const expMs = new Date(entry.expiresAt).getTime();
  return Number.isFinite(expMs) && expMs <= refMs;
}

/**
 * Pure factory creating a fully validated MemoryEntry with calculated version & timestamps.
 */
export function createMemoryEntry(
  params: MemorySetParams,
  options?: {
    authorId?: string;
    authorName?: string;
    version?: number;
    createdAt?: string;
    updatedAt?: string;
    now?: number | string | Date;
  }
): MemoryEntry {
  const nowMs =
    options?.now !== undefined
      ? typeof options.now === "number"
        ? options.now
        : new Date(options.now).getTime()
      : Date.now();
  const nowIso = new Date(nowMs).toISOString();

  let expiresAt: string | undefined;
  if (params.ttlSeconds !== undefined && params.ttlSeconds > 0) {
    expiresAt = new Date(nowMs + params.ttlSeconds * 1000).toISOString();
  }

  const namespace = params.namespace ?? DEFAULT_MEMORY_NAMESPACE;
  const version = options?.version !== undefined && options.version >= 1 ? options.version : 1;
  const createdAt = options?.createdAt ?? nowIso;
  const updatedAt = options?.updatedAt ?? nowIso;

  return memoryEntrySchema.parse({
    key: params.key,
    value: params.value,
    namespace,
    authorId: options?.authorId,
    authorName: options?.authorName,
    tags: params.tags ?? [],
    version,
    createdAt,
    updatedAt,
    ttlSeconds: params.ttlSeconds,
    expiresAt,
  });
}

/**
 * Pure predicate matching a MemoryEntry against query criteria.
 */
export function matchesMemoryQuery(
  entry: MemoryEntry,
  params: MemoryQueryParamsInput | MemoryQueryParams | {
    namespace?: string;
    query?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }
): boolean {

  if (params.namespace && entry.namespace !== params.namespace) {
    return false;
  }

  if (params.query) {
    const q = params.query.toLowerCase();
    const keyMatch = entry.key.toLowerCase().includes(q);
    let valueMatch = false;
    if (typeof entry.value === "string") {
      valueMatch = entry.value.toLowerCase().includes(q);
    } else if (entry.value !== null && entry.value !== undefined) {
      try {
        valueMatch = JSON.stringify(entry.value).toLowerCase().includes(q);
      } catch {
        valueMatch = false;
      }
    }
    if (!keyMatch && !valueMatch) {
      return false;
    }
  }

  if (params.tags && params.tags.length > 0) {
    const hasMatchingTag = params.tags.some((t) => entry.tags.includes(t));
    if (!hasMatchingTag) {
      return false;
    }
  }

  return true;
}

/**
 * Validates a memory namespace name against confinement rules.
 */
export function validateMemoryNamespace(namespace: string): boolean {
  if (!namespace || namespace.length < 1 || namespace.length > MAX_MEMORY_NAMESPACE_LENGTH) {
    return false;
  }
  // Allowed: alphanumeric, hyphens, underscores, dots, colons, slashes
  return /^[a-zA-Z0-9_\-.:/]+$/.test(namespace);
}

/**
 * Validates a memory key name against character restrictions.
 */
export function validateMemoryKey(key: string): boolean {
  if (!key || key.length < 1 || key.length > MAX_MEMORY_KEY_LENGTH) {
    return false;
  }
  // Disallow null bytes and whitespace only
  return !key.includes("\0") && key.trim().length > 0;
}
