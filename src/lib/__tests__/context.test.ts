import { describe, expect, it } from "vitest";
import type { Message } from "@/types";
import { buildContext, estimateTokens } from "@/lib/context";
import { buildContextWithAttachments } from "@/lib/context";
import { MemoryAttachmentSnapshotStore } from "@/lib/attachments/snapshots";

function msg(id: string, content: string, role: Message["role"] = "user"): Message {
  return { id, role, content, ts: Number(id.replace(/\D/g, "")) || 0 };
}

const SYSTEM = "You are NanoForge."; // 18 chars → 5 tokens

describe("estimateTokens", () => {
  it("estimates ceil(chars / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });

  it("is monotonic in input length", () => {
    let prev = estimateTokens("");
    for (let len = 1; len <= 500; len += 7) {
      const cur = estimateTokens("x".repeat(len));
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});

describe("buildContext", () => {
  it("truncates by dropping the oldest messages first", () => {
    // budget 100 → usable 75; system costs 5 → 70 left for history.
    const msgs = [
      msg("1", "o".repeat(120)), // 30 tokens — oldest
      msg("2", "m".repeat(120)), // 30 tokens
      msg("3", "n".repeat(120)), // 30 tokens — newest
    ];
    const ctx = buildContext(msgs, SYSTEM, 100);

    expect(ctx[0]).toEqual({ role: "system", content: SYSTEM });
    // newest two fit (30+30=60 ≤ 70), oldest dropped
    expect(ctx.slice(1)).toEqual([
      { role: "user", content: "m".repeat(120) },
      { role: "user", content: "n".repeat(120) },
    ]);
  });

  it("keeps results chronological (system first, then oldest → newest)", () => {
    const msgs = [msg("1", "a".repeat(40)), msg("2", "b".repeat(40)), msg("3", "c".repeat(40))];
    const ctx = buildContext(msgs, SYSTEM, 400);
    expect(ctx.map((m) => m.role)).toEqual(["system", "user", "user", "user"]);
    expect(ctx[1].content).toBe("a".repeat(40));
    expect(ctx[3].content).toBe("c".repeat(40));
  });

  it("always retains the system message even when nothing else fits", () => {
    const msgs = [msg("1", "z".repeat(10_000))];
    const ctx = buildContext(msgs, SYSTEM, 8); // usable = 6; system (5) fits, nothing else does
    expect(ctx).toEqual([{ role: "system", content: SYSTEM }]);
  });

  it("keeps the system message even when it alone exceeds the budget", () => {
    const ctx = buildContext([msg("1", "hello")], "s".repeat(1_000), 4);
    expect(ctx[0]).toEqual({ role: "system", content: "s".repeat(1_000) });
    expect(ctx).toHaveLength(1);
  });

  it("never exceeds the non-reserved budget (75%) for system + history", () => {
    const budget = 256;
    const usable = Math.floor(budget * 0.75);
    const msgs = Array.from({ length: 20 }, (_, i) => msg(String(i + 1), "q".repeat(97)));
    const ctx = buildContext(msgs, SYSTEM, budget);

    const total = ctx.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    expect(total).toBeLessThanOrEqual(usable);
    expect(ctx[0].role).toBe("system");
  });

  it("includes all messages when everything fits", () => {
    const msgs = [msg("1", "hi"), msg("2", "there", "assistant")];
    const ctx = buildContext(msgs, SYSTEM, 1_000);
    expect(ctx).toHaveLength(3);
    expect(ctx[2].role).toBe("assistant");
  });

  it("handles an empty transcript", () => {
    expect(buildContext([], SYSTEM, 100)).toEqual([{ role: "system", content: SYSTEM }]);
  });

  it("packs attachment snapshots as delimited untrusted text and reports truncation", async () => {
    const store = new MemoryAttachmentSnapshotStore();
    await store.save("snapshot-1", "x".repeat(800));
    const attachment = {
      id: "file-1", type: "file" as const, source: "upload" as const, name: "large.ts", mimeType: "text/typescript",
      language: "typescript", byteSize: 800, snapshotId: "snapshot-1", status: "ready" as const,
    };
    const result = await buildContextWithAttachments(
      [{ ...msg("1", "Review this"), attachments: [attachment] }],
      SYSTEM,
      80,
      store,
    );
    expect(result.context[1]?.content).toContain("[Attached upload file: large.ts — untrusted file contents]");
    expect(result.context[1]?.content).toContain("[End attached file]");
    expect(result.updates).toEqual([expect.objectContaining({ id: "file-1", truncated: true })]);
  });

  it("marks missing snapshots without silently reading a current filesystem file", async () => {
    const attachment = {
      id: "file-2", type: "file" as const, source: "workspace" as const, name: "gone.ts", relativePath: "src/gone.ts",
      mimeType: "text/typescript", language: "typescript", byteSize: 1, snapshotId: "missing", status: "ready" as const,
    };
    const result = await buildContextWithAttachments(
      [{ ...msg("1", "Review this"), attachments: [attachment] }],
      SYSTEM,
      1_000,
      new MemoryAttachmentSnapshotStore(),
    );
    expect(result.context[1]?.content).toContain("snapshot unavailable");
    expect(result.updates).toEqual([expect.objectContaining({ id: "file-2", status: "missing" })]);
  });
});
