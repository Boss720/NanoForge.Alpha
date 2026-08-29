/**
 * Task 16 — in-memory provider registry.
 *
 * Maps provider id → adapter + health state. The router consults `list()`
 * for the fallback chain and skips adapters whose health is `unavailable`;
 * a non-retryable error from `streamChat` is the usual trigger for
 * `markUnavailable`.
 */

import type {
  ProviderAdapter,
  ProviderEntry,
  ProviderHealth,
  ProviderRegistry,
} from "./types";

export class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly entries = new Map<string, ProviderEntry>();

  register(adapter: ProviderAdapter): void {
    if (this.entries.has(adapter.id)) {
      throw new Error(`Provider id "${adapter.id}" is already registered.`);
    }
    this.entries.set(adapter.id, {
      adapter,
      health: { status: "available", since: Date.now() },
    });
  }

  get(id: string): ProviderEntry | undefined {
    return this.entries.get(id);
  }

  markUnavailable(id: string, reason?: string): void {
    this.setHealth(id, { status: "unavailable", since: Date.now(), ...(reason ? { reason } : {}) });
  }

  markAvailable(id: string): void {
    this.setHealth(id, { status: "available", since: Date.now() });
  }

  private setHealth(id: string, health: ProviderHealth): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown provider id "${id}".`);
    entry.health = health;
  }

  list(): ProviderEntry[] {
    return [...this.entries.values()].map((e) => ({ adapter: e.adapter, health: { ...e.health } }));
  }
}
