import { describe, expect, it } from "vitest";
import type { Message, Patch } from "@/types";
import {
  MAX_AUTO_TURNS,
  countAutoTurns,
  isLgtm,
  shouldAutoVerify,
  shouldStopLoop,
  verificationPrompt,
} from "@/lib/agentLoop";

const demoPatch: Patch = {
  file: "src/server.ts",
  status: "pending",
  lines: [
    { type: "ctx", text: "const a = 1;" },
    { type: "del", text: "const b = 2;" },
    { type: "add", text: "const b = 3;" },
  ],
};

describe("shouldAutoVerify", () => {
  it("fires when a patch is applied in live mode under the cap", () => {
    expect(shouldAutoVerify("applied", "live", 0)).toBe(true);
    expect(shouldAutoVerify("applied", "live", MAX_AUTO_TURNS - 1)).toBe(true);
  });

  it("stops at the cap", () => {
    expect(shouldAutoVerify("applied", "live", MAX_AUTO_TURNS)).toBe(false);
    expect(shouldAutoVerify("applied", "live", MAX_AUTO_TURNS + 5)).toBe(false);
  });

  it("never fires in demo mode", () => {
    expect(shouldAutoVerify("applied", "demo", 0)).toBe(false);
  });

  it("never fires when a patch is rejected (or still pending)", () => {
    expect(shouldAutoVerify("rejected", "live", 0)).toBe(false);
    expect(shouldAutoVerify("pending", "live", 0)).toBe(false);
  });
});

describe("verificationPrompt", () => {
  it("embeds the target file, the new content, and the LGTM instruction", () => {
    const p = verificationPrompt("src/server.ts", "const a = 1;");
    expect(p).toContain("Patch applied to `src/server.ts`");
    expect(p).toContain("```\nconst a = 1;\n```");
    expect(p).toContain("LGTM");
    expect(p).toContain("follow-up diff");
  });
});

describe("isLgtm", () => {
  it("detects LGTM at the start, inside prose, and case-insensitively", () => {
    expect(isLgtm("LGTM")).toBe(true);
    expect(isLgtm("LGTM — the change is safe.")).toBe(true);
    expect(isLgtm("Reviewed the new content: lgtm.")).toBe(true);
  });

  it("does not match unrelated replies or substrings", () => {
    expect(isLgtm("I found a bug; here is a follow-up diff.")).toBe(false);
    expect(isLgtm("BLGTMX")).toBe(false);
    expect(isLgtm("")).toBe(false);
  });
});

describe("shouldStopLoop", () => {
  it("stops after LGTM with no follow-up diff", () => {
    expect(shouldStopLoop("LGTM — no breakage.", null)).toBe(true);
  });

  it("does not stop when the reply has no LGTM", () => {
    expect(shouldStopLoop("Hmm, needs another look.", null)).toBe(false);
  });

  it("a follow-up diff wins over an LGTM mention (becomes a new pending patch)", () => {
    expect(shouldStopLoop("Almost LGTM, but one line broke:", demoPatch)).toBe(false);
  });
});

describe("countAutoTurns", () => {
  const msg = (over: Partial<Message>): Message => ({
    id: Math.random().toString(36).slice(2),
    role: "user",
    content: "x",
    ts: 0,
    ...over,
  });

  it("counts only user messages flagged auto", () => {
    const messages: Message[] = [
      msg({}),
      msg({ auto: true }), // auto turn 1 (user side)
      msg({ role: "assistant", auto: true }), // reply side — not counted
      msg({ role: "assistant" }),
      msg({ auto: true }), // auto turn 2
    ];
    expect(countAutoTurns(messages)).toBe(2);
  });

  it("returns 0 for a transcript without auto-turns", () => {
    expect(countAutoTurns([msg({}), msg({ role: "assistant" })])).toBe(0);
    expect(countAutoTurns([])).toBe(0);
  });
});
