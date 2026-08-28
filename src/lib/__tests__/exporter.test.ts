import { describe, expect, it } from "vitest";
import type { Session } from "@/types";
import { sessionFileName, sessionToMarkdown } from "@/lib/exporter";

function makeSession(): Session {
  return {
    id: "s1",
    title: "add rate limiting",
    model: "kimi-k2-0905",
    createdAt: 1720000000000,
    messages: [
      { id: "m1", role: "user", content: "add rate limiting to the server", ts: 1720000001000 },
      {
        id: "m2",
        role: "assistant",
        content: "Here is the patch.",
        ts: 1720000002000,
        patch: {
          file: "src/server.ts",
          status: "applied",
          lines: [
            { type: "ctx", text: "import express from 'express';" },
            { type: "del", text: "const app = express();" },
            { type: "add", text: "const app = rateLimit(express());" },
          ],
        },
        usage: { input: 1200, output: 340, costUsd: 0.0042 },
      },
      { id: "m3", role: "user", content: "verify", auto: true, ts: 1720000003000 },
      { id: "m4", role: "assistant", content: "LGTM", auto: true, ts: 1720000004000 },
    ],
  };
}

describe("sessionToMarkdown", () => {
  it("renders a header with model and created date", () => {
    const md = sessionToMarkdown(makeSession());
    expect(md).toContain("# add rate limiting");
    expect(md).toContain("- model: `kimi-k2-0905`");
    expect(md).toContain(new Date(1720000000000).toISOString());
  });

  it("renders each message as a role section in order", () => {
    const md = sessionToMarkdown(makeSession());
    const userIdx = md.indexOf("## User —");
    const assistantIdx = md.indexOf("## Assistant —");
    expect(userIdx).toBeGreaterThan(-1);
    expect(assistantIdx).toBeGreaterThan(userIdx);
    expect(md).toContain("add rate limiting to the server");
    expect(md).toContain("Here is the patch.");
  });

  it("annotates auto-verify turns", () => {
    const md = sessionToMarkdown(makeSession());
    expect(md).toContain("## User — 2024"); // sanity on the date format
    const autoCount = (md.match(/_\(auto-verify\)_/g) ?? []).length;
    expect(autoCount).toBe(2);
  });

  it("renders patches as diff fences with a file header and status", () => {
    const md = sessionToMarkdown(makeSession());
    expect(md).toContain("**Patch `src/server.ts` — applied**");
    expect(md).toContain("```diff\n--- file: src/server.ts");
    expect(md).toContain(" import express from 'express';");
    expect(md).toContain("-const app = express();");
    expect(md).toContain("+const app = rateLimit(express());");
    expect(md).toContain("```");
  });

  it("includes the per-message usage footer when present", () => {
    const md = sessionToMarkdown(makeSession());
    expect(md).toContain("_usage: 1,200 in / 340 out · ≈ $0.00420_");
  });

  it("handles an empty session", () => {
    const md = sessionToMarkdown({ id: "x", title: "new run", model: "m", createdAt: 0, messages: [] });
    expect(md).toContain("# new run");
    expect(md).toContain("- messages: 0");
    expect(md).not.toContain("## ");
  });
});

describe("sessionFileName", () => {
  it("slugifies the title", () => {
    expect(sessionFileName(makeSession())).toBe("add-rate-limiting.md");
  });

  it("falls back for un-sluggable titles", () => {
    const s = { ...makeSession(), title: "中文标题 !!!" };
    expect(sessionFileName(s)).toBe("nanoforge-session.md");
  });
});
