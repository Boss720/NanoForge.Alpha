/**
 * Hierarchical CancellationTokenSource & CancellationToken implementation.
 *
 * Provides real-time <100ms cascade aborts across nested agent/tool trees,
 * native AbortSignal binding, and protocol serialization.
 */

import type { AbortReason, CancellationTokenWire } from "@nanoforge/protocol";
import { CancellationError, type CancellationToken, type CancellationTokenSubscription } from "./types";

export { CancellationError, type CancellationToken, type CancellationTokenSubscription };

/**
 * Immutable non-cancellable token instance.
 */
const NONE_TOKEN: CancellationToken = Object.freeze({
  isCancellationRequested: false,
  reason: undefined,
  detail: undefined,
  tokenId: "tok_none",
  rootId: "tok_none",
  parentId: null,
  onCancelled: () => ({ dispose: () => {} }),
  toAbortSignal: () => new AbortController().signal,
  throwIfCancelled: () => {},
  toWire: () => ({
    tokenId: "tok_none",
    rootId: "tok_none",
    parentId: null,
    isCancelled: false,
  }),
});

function generateTokenId(prefix = "tok"): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export class CancellationTokenSource {
  private _isCancelled = false;
  private _reason?: AbortReason;
  private _detail?: string;
  private _cancelledAt?: string;
  private readonly _listeners = new Set<(reason: AbortReason, detail?: string) => void>();
  private readonly _abortController = new AbortController();
  private readonly _children = new Set<CancellationTokenSource>();
  private readonly _parent?: CancellationTokenSource;
  private _parentSubscription?: CancellationTokenSubscription;
  private _isDisposed = false;

  readonly tokenId: string;
  readonly rootId: string;
  readonly parentId?: string | null;

  constructor(parentId?: string | null, rootId?: string, parent?: CancellationTokenSource) {
    this.tokenId = generateTokenId();
    this.parentId = parentId ?? null;
    this.rootId = rootId || this.tokenId;
    this._parent = parent;

    if (this._parent) {
      if (this._parent._isCancelled) {
        this.cancel(this._parent._reason, this._parent._detail);
      } else {
        this._parentSubscription = this._parent.token.onCancelled((r, d) => {
          this.cancel(r, d);
        });
      }
    }
  }

  static get None(): CancellationToken {
    return NONE_TOKEN;
  }

  get token(): CancellationToken {
    const self = this;
    return {
      get isCancellationRequested() {
        return self._isCancelled;
      },
      get reason() {
        return self._reason;
      },
      get detail() {
        return self._detail;
      },
      tokenId: this.tokenId,
      rootId: this.rootId,
      parentId: this.parentId,
      onCancelled: (listener: (reason: AbortReason, detail?: string) => void): CancellationTokenSubscription => {
        if (this._isCancelled) {
          try {
            listener(this._reason || "user_requested", this._detail);
          } catch {
            // Protect against faulty listener
          }
          return { dispose: () => {} };
        }
        if (this._isDisposed) {
          return { dispose: () => {} };
        }
        this._listeners.add(listener);
        return {
          dispose: () => {
            this._listeners.delete(listener);
          },
        };
      },
      toAbortSignal: (): AbortSignal => this._abortController.signal,
      throwIfCancelled: (): void => {
        if (this._isCancelled) {
          throw new CancellationError(
            this._detail || `Operation cancelled (${this._reason || "user_requested"})`,
            this._reason || "user_requested",
            this._detail
          );
        }
      },
      toWire: (): CancellationTokenWire => ({
        tokenId: this.tokenId,
        rootId: this.rootId,
        parentId: this.parentId ?? null,
        isCancelled: this._isCancelled,
        reason: this._reason,
        detail: this._detail,
        cancelledAt: this._cancelledAt,
      }),
    };
  }

  get isCancelled(): boolean {
    return this._isCancelled;
  }

  cancel(reason: AbortReason = "user_requested", detail?: string): void {
    if (this._isCancelled || this._isDisposed) return;
    this._isCancelled = true;
    this._reason = reason;
    this._detail = detail;
    this._cancelledAt = new Date().toISOString();

    try {
      this._abortController.abort(detail || reason);
    } catch {
      // Ignore in environments where abort controller throws on re-abort
    }

    // 1. Notify synchronous registered listeners
    const listeners = Array.from(this._listeners);
    this._listeners.clear();
    for (const listener of listeners) {
      try {
        listener(reason, detail);
      } catch {
        // Prevent listener exceptions from breaking the cascade
      }
    }

    // 2. Cascade down to all child token sources recursively
    const children = Array.from(this._children);
    this._children.clear();
    for (const child of children) {
      try {
        child.cancel(reason, detail);
      } catch {
        // Continue cascading
      }
    }
  }

  createChild(): CancellationTokenSource {
    if (this._isDisposed) {
      throw new Error("Cannot create child token from a disposed CancellationTokenSource");
    }
    const child = new CancellationTokenSource(this.tokenId, this.rootId, this);
    if (this._isCancelled) {
      child.cancel(this._reason, this._detail);
    } else {
      this._children.add(child);
    }
    return child;
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;

    if (this._parentSubscription) {
      this._parentSubscription.dispose();
      this._parentSubscription = undefined;
    }

    if (this._parent) {
      this._parent._children.delete(this);
    }

    this._listeners.clear();
    for (const child of Array.from(this._children)) {
      child.dispose();
    }
    this._children.clear();
  }
}
