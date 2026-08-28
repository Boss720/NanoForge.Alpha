/**
 * Asynchronous iterable queue for streaming real-time event frames.
 */
export class EventStreamQueue<T> implements AsyncIterable<T> {
  private _queue: T[] = [];
  private _resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private _done = false;
  private _error: Error | null = null;

  public push(value: T): void {
    if (this._done) return;
    if (this._resolvers.length > 0) {
      const resolve = this._resolvers.shift()!;
      resolve({ value, done: false });
    } else {
      this._queue.push(value);
    }
  }

  public finish(): void {
    if (this._done) return;
    this._done = true;
    while (this._resolvers.length > 0) {
      const resolve = this._resolvers.shift()!;
      resolve({ value: undefined as any, done: true });
    }
  }

  public fail(err: Error): void {
    if (this._done) return;
    this._done = true;
    this._error = err;
    while (this._resolvers.length > 0) {
      const resolve = this._resolvers.shift()!;
      resolve(Promise.reject(err) as any);
    }
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this._error) {
          return Promise.reject(this._error);
        }
        if (this._queue.length > 0) {
          const value = this._queue.shift()!;
          return Promise.resolve({ value, done: false });
        }
        if (this._done) {
          return Promise.resolve({ value: undefined as any, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this._resolvers.push(resolve);
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        this._done = true;
        this._queue = [];
        return Promise.resolve({ value: undefined as any, done: true });
      },
    };
  }
}

export type EventHandler<T = any> = (payload: T) => void | Promise<void>;

/**
 * Lightweight type-safe EventEmitter.
 */
export class TypedEventEmitter {
  private _listeners: Map<string, Set<EventHandler>> = new Map();

  public on<T = any>(event: string, handler: EventHandler<T>): this {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(handler as EventHandler);
    return this;
  }

  public once<T = any>(event: string, handler: EventHandler<T>): this {
    const wrapped: EventHandler<T> = (payload: T) => {
      this.off(event, wrapped);
      return handler(payload);
    };
    return this.on(event, wrapped);
  }

  public off<T = any>(event: string, handler: EventHandler<T>): this {
    const set = this._listeners.get(event);
    if (set) {
      set.delete(handler as EventHandler);
      if (set.size === 0) {
        this._listeners.delete(event);
      }
    }
    return this;
  }

  public emit<T = any>(event: string, payload?: T): boolean {
    const set = this._listeners.get(event);
    if (!set || set.size === 0) return false;
    for (const handler of Array.from(set)) {
      try {
        void handler(payload);
      } catch (err) {
        console.error(`Error in event listener for "${event}":`, err);
      }
    }
    return true;
  }

  public removeAllListeners(event?: string): this {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
    return this;
  }
}
