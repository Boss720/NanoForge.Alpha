/**
 * Cancellation Engine Types & Error Definitions.
 *
 * Defines strongly typed cancellation errors, token interfaces, and options.
 */

import type { AbortReason, CancellationTokenWire } from "@nanoforge/protocol";

export class CancellationError extends Error {
  readonly reason: AbortReason;
  readonly detail?: string;

  constructor(message = "Operation cancelled", reason: AbortReason = "user_requested", detail?: string) {
    super(message);
    this.name = "CancellationError";
    this.reason = reason;
    this.detail = detail;
    Object.setPrototypeOf(this, CancellationError.prototype);
  }
}

export interface CancellationTokenSubscription {
  dispose(): void;
}

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly reason?: AbortReason;
  readonly detail?: string;
  readonly tokenId: string;
  readonly rootId: string;
  readonly parentId?: string | null;

  onCancelled(listener: (reason: AbortReason, detail?: string) => void): CancellationTokenSubscription;
  toAbortSignal(): AbortSignal;
  throwIfCancelled(): void;
  toWire(): CancellationTokenWire;
}
