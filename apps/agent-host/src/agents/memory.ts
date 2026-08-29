/**
 * Cross-Agent Shared Memory Engine.
 *
 * Implements high-performance in-memory key-value storage with:
 * - Namespace sandboxing (global, swarm, agent:<id>, private:<id>, custom)
 * - Version incrementing & mutation tracking
 * - TTL expiration & automated background sweeping
 * - Structured query matching (substring, regex-safe, tag intersection, pagination)
 * - Reactive EventEmitter lifecycle notifications
 */

import { EventEmitter } from "node:events";
import path from "node:path";
import type { z } from "zod";
import {
  DEFAULT_MEMORY_NAMESPACE,
  createMemoryEntry,
  formatMemoryKey,
  isMemoryExpired,
  matchesMemoryQuery,
  memoryDeleteParamsSchema,
  memoryGetParamsSchema,
  memoryQueryParamsSchema,
  memorySetParamsSchema,
  validateMemoryKey,
  validateMemoryNamespace,
  type MemoryDeleteResult,
  type MemoryEntry,
  type MemoryGetResult,
  type MemoryLifecycleEvent,
  type MemoryQueryResult,
  type MemorySetResult,
} from "@protocol/memory";

export type MemorySetInput = z.input<typeof memorySetParamsSchema>;
export type MemoryGetInput = z.input<typeof memoryGetParamsSchema>;
export type MemoryQueryInput = z.input<typeof memoryQueryParamsSchema>;
export type MemoryDeleteInput = z.input<typeof memoryDeleteParamsSchema>;

export interface SharedMemoryEngineOptions {
  workspaceRoot?: string;
  autoSweepIntervalMs?: number;
}

export class SharedMemoryEngine extends EventEmitter {
  readonly workspaceRoot: string;
  private readonly entries = new Map<string, MemoryEntry>();
  private sweeperTimer: NodeJS.Timeout | null = null;

  constructor(options: SharedMemoryEngineOptions = {}) {
    super();
    this.workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    if (options.autoSweepIntervalMs && options.autoSweepIntervalMs > 0) {
      this.startSweeper(options.autoSweepIntervalMs);
    }
  }

  /**
   * Sets or updates a memory entry in a designated namespace.
   */
  set(
    rawParams: MemorySetInput,
    authorInfo?: { id?: string; name?: string }
  ): MemorySetResult {
    const params = memorySetParamsSchema.parse(rawParams);
    const namespace = params.namespace || DEFAULT_MEMORY_NAMESPACE;

    if (!validateMemoryNamespace(namespace)) {
      throw new Error(`Invalid memory namespace: "${namespace}"`);
    }
    if (!validateMemoryKey(params.key)) {
      throw new Error(`Invalid memory key: "${params.key}"`);
    }

    const internalKey = formatMemoryKey(namespace, params.key);
    const existing = this.entries.get(internalKey);

    const now = new Date().toISOString();
    const version = (existing?.version ?? 0) + 1;
    const createdAt = existing?.createdAt ?? now;

    const entry = createMemoryEntry(params, {
      authorId: authorInfo?.id,
      authorName: authorInfo?.name,
      version,
      createdAt,
      updatedAt: now,
    });

    this.entries.set(internalKey, entry);

    this.emitLifecycleEvent({
      type: "memory.entry_set",
      entry,
      at: now,
    });

    return {
      success: true,
      entry,
    };
  }

  /**
   * Retrieves a memory entry by namespace and key.
   */
  get(rawParams: MemoryGetInput): MemoryGetResult {
    const params = memoryGetParamsSchema.parse(rawParams);
    const namespace = params.namespace || DEFAULT_MEMORY_NAMESPACE;
    const internalKey = formatMemoryKey(namespace, params.key);

    const entry = this.entries.get(internalKey);
    if (!entry) {
      return { found: false, entry: null };
    }

    if (isMemoryExpired(entry)) {
      this.entries.delete(internalKey);
      this.emitLifecycleEvent({
        type: "memory.entry_deleted",
        key: params.key,
        namespace,
        at: new Date().toISOString(),
      });
      return { found: false, entry: null };
    }

    return {
      found: true,
      entry,
    };
  }

  /**
   * Queries memory entries by namespace, text search, tags, and pagination.
   */
  query(rawParams: MemoryQueryInput = {}): MemoryQueryResult {
    const params = memoryQueryParamsSchema.parse(rawParams);
    this.sweepExpired();

    const matching: MemoryEntry[] = [];
    for (const entry of this.entries.values()) {
      if (matchesMemoryQuery(entry, params)) {
        matching.push(entry);
      }
    }

    // Sort by updatedAt descending for consistent recency
    matching.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const total = matching.length;
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 50;
    const entries = matching.slice(offset, offset + limit);

    return {
      entries,
      total,
    };
  }

  /**
   * Deletes a specific memory entry.
   */
  delete(rawParams: MemoryDeleteInput): MemoryDeleteResult {
    const params = memoryDeleteParamsSchema.parse(rawParams);
    const namespace = params.namespace || DEFAULT_MEMORY_NAMESPACE;
    const internalKey = formatMemoryKey(namespace, params.key);

    const existed = this.entries.delete(internalKey);
    if (existed) {
      this.emitLifecycleEvent({
        type: "memory.entry_deleted",
        key: params.key,
        namespace,
        at: new Date().toISOString(),
      });
    }

    return {
      success: true,
      deleted: existed,
    };
  }

  /**
   * Clears all memory entries, optionally scoped to a namespace.
   */
  clear(namespace?: string): number {
    let clearedCount = 0;
    const now = new Date().toISOString();

    if (!namespace) {
      clearedCount = this.entries.size;
      this.entries.clear();
      this.emitLifecycleEvent({
        type: "memory.cleared",
        at: now,
      });
    } else {
      for (const [key, entry] of Array.from(this.entries.entries())) {
        if (entry.namespace === namespace) {
          this.entries.delete(key);
          clearedCount++;
        }
      }
      this.emitLifecycleEvent({
        type: "memory.cleared",
        namespace,
        at: now,
      });
    }

    return clearedCount;
  }

  /**
   * Sweeps and removes all expired entries across all namespaces.
   */
  sweepExpired(): number {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    let swept = 0;

    for (const [internalKey, entry] of Array.from(this.entries.entries())) {
      if (isMemoryExpired(entry, nowMs)) {
        this.entries.delete(internalKey);
        swept++;
        this.emitLifecycleEvent({
          type: "memory.entry_deleted",
          key: entry.key,
          namespace: entry.namespace,
          at: nowIso,
        });
      }
    }

    return swept;
  }

  /**
   * Starts periodic TTL sweeper.
   */
  startSweeper(intervalMs: number = 5000): void {
    this.stopSweeper();
    this.sweeperTimer = setInterval(() => {
      this.sweepExpired();
    }, intervalMs);
    this.sweeperTimer.unref();
  }

  /**
   * Stops periodic TTL sweeper.
   */
  stopSweeper(): void {
    if (this.sweeperTimer) {
      clearInterval(this.sweeperTimer);
      this.sweeperTimer = null;
    }
  }

  /**
   * Gets the total number of entries currently stored.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Subscribes to memory lifecycle events.
   */
  subscribe(listener: (event: MemoryLifecycleEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }

  /**
   * Disposes resources and timer.
   */
  dispose(): void {
    this.stopSweeper();
    this.removeAllListeners();
    this.entries.clear();
  }

  private emitLifecycleEvent(event: MemoryLifecycleEvent): void {
    this.emit("event", event);
    this.emit(event.type, event);
  }
}
