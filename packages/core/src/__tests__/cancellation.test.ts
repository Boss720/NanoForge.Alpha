import { describe, it, expect, vi } from "vitest";
import {
  CancellationTokenSource,
  CancellationError,
} from "../cancellation/cancellationToken";
import { terminateProcessTree } from "../cancellation/processKiller";

describe("CancellationTokenSource & Hierarchical Cancellation Engine", () => {
  it("initializes in non-cancelled state with valid wire structure", () => {
    const cts = new CancellationTokenSource();
    const token = cts.token;

    expect(token.isCancellationRequested).toBe(false);
    expect(token.reason).toBeUndefined();
    expect(token.tokenId).toMatch(/^tok_/);
    expect(token.rootId).toBe(token.tokenId);
    expect(token.parentId).toBeNull();

    const wire = token.toWire();
    expect(wire.isCancelled).toBe(false);
    expect(wire.tokenId).toBe(token.tokenId);
    expect(wire.rootId).toBe(token.rootId);
    expect(wire.parentId).toBeNull();
  });

  it("cancels token and notifies synchronous listeners", () => {
    const cts = new CancellationTokenSource();
    const token = cts.token;

    const listener = vi.fn();
    const sub = token.onCancelled(listener);

    expect(cts.isCancelled).toBe(false);
    cts.cancel("user_requested", "User pressed stop button");

    expect(cts.isCancelled).toBe(true);
    expect(token.isCancellationRequested).toBe(true);
    expect(token.reason).toBe("user_requested");
    expect(token.detail).toBe("User pressed stop button");
    expect(listener).toHaveBeenCalledWith("user_requested", "User pressed stop button");

    // Idempotent cancel does not trigger listener again
    cts.cancel("timeout_exceeded");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(token.reason).toBe("user_requested"); // Preserves initial reason

    sub.dispose();
  });

  it("invokes onCancelled immediately if token is already cancelled", () => {
    const cts = new CancellationTokenSource();
    cts.cancel("budget_exceeded", "Limit reached");

    const listener = vi.fn();
    cts.token.onCancelled(listener);

    expect(listener).toHaveBeenCalledWith("budget_exceeded", "Limit reached");
  });

  it("cascades cancellation down 3-tier hierarchy (Root -> Child -> Grandchild)", () => {
    const rootCts = new CancellationTokenSource();
    const childCts1 = rootCts.createChild();
    const childCts2 = rootCts.createChild();
    const grandchildCts = childCts1.createChild();

    expect(childCts1.token.parentId).toBe(rootCts.tokenId);
    expect(childCts1.token.rootId).toBe(rootCts.tokenId);
    expect(grandchildCts.token.parentId).toBe(childCts1.tokenId);
    expect(grandchildCts.token.rootId).toBe(rootCts.tokenId);

    expect(rootCts.token.isCancellationRequested).toBe(false);
    expect(childCts1.token.isCancellationRequested).toBe(false);
    expect(childCts2.token.isCancellationRequested).toBe(false);
    expect(grandchildCts.token.isCancellationRequested).toBe(false);

    // Cancel Root
    rootCts.cancel("supervisor_shutdown", "Terminating whole agent tree");

    expect(rootCts.token.isCancellationRequested).toBe(true);
    expect(childCts1.token.isCancellationRequested).toBe(true);
    expect(childCts2.token.isCancellationRequested).toBe(true);
    expect(grandchildCts.token.isCancellationRequested).toBe(true);

    expect(grandchildCts.token.reason).toBe("supervisor_shutdown");
  });

  it("preserves child isolation (cancelling child does not cancel parent or sibling)", () => {
    const rootCts = new CancellationTokenSource();
    const child1 = rootCts.createChild();
    const child2 = rootCts.createChild();

    child1.cancel("user_requested", "Abort task 1 only");

    expect(child1.token.isCancellationRequested).toBe(true);
    expect(rootCts.token.isCancellationRequested).toBe(false);
    expect(child2.token.isCancellationRequested).toBe(false);
  });

  it("automatically creates pre-cancelled child if parent is already cancelled", () => {
    const rootCts = new CancellationTokenSource();
    rootCts.cancel("timeout_exceeded", "Timeout");

    const child = rootCts.createChild();
    expect(child.token.isCancellationRequested).toBe(true);
    expect(child.token.reason).toBe("timeout_exceeded");
  });

  it("binds to native AbortSignal and fires abort event", () => {
    const cts = new CancellationTokenSource();
    const signal = cts.token.toAbortSignal();

    expect(signal.aborted).toBe(false);

    const onAbort = vi.fn();
    signal.addEventListener("abort", onAbort);

    cts.cancel("user_requested", "User abort");

    expect(signal.aborted).toBe(true);
    expect(onAbort).toHaveBeenCalled();
  });

  it("throws CancellationError when throwIfCancelled is called on cancelled token", () => {
    const cts = new CancellationTokenSource();
    expect(() => cts.token.throwIfCancelled()).not.toThrow();

    cts.cancel("process_failure", "Process crashed");

    expect(() => cts.token.throwIfCancelled()).toThrow(CancellationError);
    try {
      cts.token.throwIfCancelled();
    } catch (err: any) {
      expect(err).toBeInstanceOf(CancellationError);
      expect(err.reason).toBe("process_failure");
      expect(err.detail).toBe("Process crashed");
    }
  });

  it("handles CancellationTokenSource.None correctly", () => {
    const token = CancellationTokenSource.None;
    expect(token.isCancellationRequested).toBe(false);
    expect(() => token.throwIfCancelled()).not.toThrow();
    expect(token.toAbortSignal().aborted).toBe(false);

    const wire = token.toWire();
    expect(wire.tokenId).toBe("tok_none");
    expect(wire.isCancelled).toBe(false);
  });

  it("cleans up listener subscriptions when disposed", () => {
    const rootCts = new CancellationTokenSource();
    const childCts = rootCts.createChild();

    childCts.dispose();
    rootCts.cancel();

    // After disposal, child wasn't affected by parent cascade
    expect(childCts.isCancelled).toBe(false);
  });

  it("BENCHMARK: propagates cancellation cascade across 50 child tokens in < 10ms (strict limit < 100ms)", () => {
    const rootCts = new CancellationTokenSource();
    const children: CancellationTokenSource[] = [];

    for (let i = 0; i < 50; i++) {
      children.push(rootCts.createChild());
    }

    const start = performance.now();
    rootCts.cancel("user_requested", "Benchmarking cascade speed");
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100); // Strict requirement < 100ms
    for (const child of children) {
      expect(child.token.isCancellationRequested).toBe(true);
    }
  });

  describe("terminateProcessTree", () => {
    it("handles null/undefined process gracefully", async () => {
      const result = await terminateProcessTree(null);
      expect(result).toBe(true);
    });

    it("terminates ProcessLike object with custom kill method", async () => {
      const mockProc = {
        pid: 0,
        kill: vi.fn(),
      };

      const result = await terminateProcessTree(mockProc);
      expect(result).toBe(true);
      expect(mockProc.kill).toHaveBeenCalledWith("SIGKILL");
    });
  });
});
