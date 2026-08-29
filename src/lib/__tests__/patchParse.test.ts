import { describe, expect, it } from "vitest";
import { extractPatch } from "@/lib/patchParse";

describe("extractPatch", () => {
  it("parses a diff fence with a leading `--- file:` header", () => {
    const md = [
      "Here is the fix:",
      "",
      "```diff",
      "--- file: src/server.ts",
      " const express = require('express');",
      "-app.get('/old', handler);",
      "+app.get('/new', handler);",
      "+app.use(rateLimit);",
      "```",
      "",
      "That should do it.",
    ].join("\n");

    const patch = extractPatch(md);
    expect(patch).not.toBeNull();
    expect(patch!.file).toBe("src/server.ts");
    expect(patch!.status).toBe("pending");
    expect(patch!.lines).toEqual([
      { type: "ctx", text: "const express = require('express');" },
      { type: "del", text: "app.get('/old', handler);" },
      { type: "add", text: "app.get('/new', handler);" },
      { type: "add", text: "app.use(rateLimit);" },
    ]);
  });

  it("falls back to the fence info string for the file path", () => {
    const md = ["```patch src/server.ts", "-const a = 1;", "+const a = 2;", "```"].join("\n");

    const patch = extractPatch(md);
    expect(patch).not.toBeNull();
    expect(patch!.file).toBe("src/server.ts");
    expect(patch!.lines).toEqual([
      { type: "del", text: "const a = 1;" },
      { type: "add", text: "const a = 2;" },
    ]);
  });

  it("prefers the `--- file:` header over the info string", () => {
    const md = ["```diff wrong.ts", "--- file: right.ts", "+x", "```"].join("\n");
    expect(extractPatch(md)!.file).toBe("right.ts");
  });

  it("returns null for a plain fence with no path (documented choice: not best-effort)", () => {
    const md = ["```diff", "-a", "+b", "```"].join("\n");
    expect(extractPatch(md)).toBeNull();
  });

  it("returns null when there is no diff/patch fence at all", () => {
    const md = ["Some prose.", "", "```ts", "const x = 1;", "```"].join("\n");
    expect(extractPatch(md)).toBeNull();
    expect(extractPatch("no fences here")).toBeNull();
  });

  it("the first USABLE fence wins: unusable fences are skipped", () => {
    const md = [
      "```diff", // no path — unusable
      "-ignored",
      "```",
      "",
      "```diff src/real.ts",
      "+used",
      "```",
      "",
      "```diff src/later.ts",
      "+never",
      "```",
    ].join("\n");

    const patch = extractPatch(md);
    expect(patch!.file).toBe("src/real.ts");
    expect(patch!.lines).toEqual([{ type: "add", text: "used" }]);
  });

  it("ignores non-diff fences even when they appear first", () => {
    const md = ["```json src/config.json", "{}", "```", "", "```diff src/app.ts", "+line", "```"].join(
      "\n",
    );
    expect(extractPatch(md)!.file).toBe("src/app.ts");
  });

  it("skips unified-diff noise (file headers, hunk headers, no-newline markers)", () => {
    const md = [
      "```diff",
      "--- file: src/server.ts",
      "--- a/src/server.ts",
      "+++ b/src/server.ts",
      "@@ -1,2 +1,2 @@",
      " ctx",
      "-old",
      "+new",
      "\\ No newline at end of file",
      "```",
    ].join("\n");

    const patch = extractPatch(md);
    expect(patch!.lines).toEqual([
      { type: "ctx", text: "ctx" },
      { type: "del", text: "old" },
      { type: "add", text: "new" },
    ]);
  });

  it("returns null for an empty diff fence", () => {
    const md = ["```diff src/x.ts", "```"].join("\n");
    expect(extractPatch(md)).toBeNull();
  });
});
