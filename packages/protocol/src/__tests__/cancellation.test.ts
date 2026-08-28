import { describe, expect, it } from "vitest";
import {
  abortReasonSchema,
  buildCascadeEvent,
  cancellationCascadeEventSchema,
  cancellationTargetKindSchema,
  cancellationTokenWireSchema,
  cancelTokenWire,
  createCancellationTokenWire,
  isTokenAncestor,
  type AbortReason,
  type CancellationCascadeEvent,
  type CancellationTargetKind,
  type CancellationTokenWire,
} from "../cancellation";

describe("Hierarchical Cancellation Wire Protocol", () => {
  const timestamp = "2026-08-21T22:30:00.000Z";

  describe("Abort Reasons & Cancellation Target Kinds", () => {
    it("validates all supported abort reasons", () => {
      const reasons: AbortReason[] = [
        "user_requested",
        "timeout_exceeded",
        "budget_exceeded",
        "parent_cancelled",
        "supervisor_shutdown",
        "process_failure",
      ];
      for (const reason of reasons) {
        expect(abortReasonSchema.parse(reason)).toBe(reason);
      }
    });

    it("rejects unknown abort reasons", () => {
      expect(() => abortReasonSchema.parse("user_abort")).toThrow();
      expect(() => abortReasonSchema.parse("")).toThrow();
    });

    it("validates all supported cancellation target kinds", () => {
      const kinds: CancellationTargetKind[] = [
        "agent",
        "subagent",
        "tool",
        "pty",
        "llm_stream",
      ];
      for (const kind of kinds) {
        expect(cancellationTargetKindSchema.parse(kind)).toBe(kind);
      }
    });

    it("rejects invalid cancellation target kinds", () => {
      expect(() => cancellationTargetKindSchema.parse("browser")).toThrow();
    });
  });

  describe("CancellationTokenWire Schema & Tree Helpers", () => {
    it("creates an uncancelled root token", () => {
      const token = createCancellationTokenWire("tok-root", "tok-root");
      expect(token.tokenId).toBe("tok-root");
      expect(token.rootId).toBe("tok-root");
      expect(token.parentId).toBeNull();
      expect(token.isCancelled).toBe(false);
      expect(token.cancelledAt).toBeUndefined();

      const parsed = cancellationTokenWireSchema.parse(token);
      expect(parsed).toEqual(token);
    });

    it("creates an uncancelled child token with parent reference", () => {
      const child = createCancellationTokenWire("tok-child", "tok-root", "tok-root");
      expect(child.tokenId).toBe("tok-child");
      expect(child.rootId).toBe("tok-root");
      expect(child.parentId).toBe("tok-root");
      expect(child.isCancelled).toBe(false);

      const parsed = cancellationTokenWireSchema.parse(child);
      expect(parsed).toEqual(child);
    });

    it("cancels a token with reason and detail", () => {
      const token = createCancellationTokenWire("tok-1", "tok-root");
      const cancelled = cancelTokenWire(
        token,
        "timeout_exceeded",
        "Exceeded max 60s execution window",
        timestamp
      );

      expect(cancelled.isCancelled).toBe(true);
      expect(cancelled.reason).toBe("timeout_exceeded");
      expect(cancelled.detail).toBe("Exceeded max 60s execution window");
      expect(cancelled.cancelledAt).toBe(timestamp);

      const parsed = cancellationTokenWireSchema.parse(cancelled);
      expect(parsed).toEqual(cancelled);
    });

    it("cancelTokenWire is idempotent and preserves first cancellation timestamp", () => {
      const token = createCancellationTokenWire("tok-1", "tok-root");
      const firstCancel = cancelTokenWire(token, "user_requested", "Stop clicked", timestamp);
      const secondCancel = cancelTokenWire(
        firstCancel,
        "timeout_exceeded",
        "Different reason",
        "2026-08-21T23:00:00.000Z"
      );

      expect(secondCancel).toBe(firstCancel);
      expect(secondCancel.reason).toBe("user_requested");
      expect(secondCancel.cancelledAt).toBe(timestamp);
    });

    it("isTokenAncestor checks direct and root ancestry correctly", () => {
      const root = createCancellationTokenWire("tok-root", "tok-root");
      const child1 = createCancellationTokenWire("tok-child1", "tok-root", "tok-root");
      const child2 = createCancellationTokenWire("tok-child2", "tok-root", "tok-child1");
      const foreignRoot = createCancellationTokenWire("tok-foreign", "tok-foreign");

      // Self is ancestor
      expect(isTokenAncestor(root, root)).toBe(true);
      expect(isTokenAncestor(child1, child1)).toBe(true);

      // Direct parent is ancestor
      expect(isTokenAncestor(root, child1)).toBe(true);
      expect(isTokenAncestor(child1, child2)).toBe(true);

      // Root is ancestor of multi-level descendant (grandchild)
      expect(isTokenAncestor(root, child2)).toBe(true);

      // Inverted parent or foreign root
      expect(isTokenAncestor(child1, root)).toBe(false);
      expect(isTokenAncestor(foreignRoot, child1)).toBe(false);
    });
  });

  describe("Cancellation Cascade Event Schema & Factory", () => {
    it("builds and round-trips a valid cascade event", () => {
      const event = buildCascadeEvent(
        "tok-root",
        "tok-sub-1",
        "subagent",
        "sub-worker-42",
        "parent_cancelled",
        2,
        timestamp
      );

      expect(event).toEqual({
        type: "cancellation.cascade",
        rootTokenId: "tok-root",
        targetTokenId: "tok-sub-1",
        targetKind: "subagent",
        targetId: "sub-worker-42",
        reason: "parent_cancelled",
        cascadeDepth: 2,
        timestamp,
      });

      const parsed: CancellationCascadeEvent = cancellationCascadeEventSchema.parse(
        JSON.parse(JSON.stringify(event))
      );
      expect(parsed).toEqual(event);
    });

    it("clamps negative cascade depth to 0", () => {
      const event = buildCascadeEvent(
        "tok-root",
        "tok-target",
        "pty",
        "pty-proc-1",
        "user_requested",
        -5,
        timestamp
      );
      expect(event.cascadeDepth).toBe(0);
    });

    it("rejects invalid cascade event frames with missing required fields", () => {
      expect(() =>
        cancellationCascadeEventSchema.parse({
          type: "cancellation.cascade",
          rootTokenId: "tok-root",
          targetTokenId: "tok-target",
          // missing targetKind
          targetId: "target-1",
          reason: "user_requested",
          cascadeDepth: 0,
          timestamp,
        })
      ).toThrow();
    });
  });
});
