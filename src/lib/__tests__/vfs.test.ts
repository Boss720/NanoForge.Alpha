import { describe, expect, it } from "vitest";
import type { DiffLine, Patch } from "@/types";
import { VIRTUAL_PROJECT } from "@/lib/catalog";
import { applyPatch, revertPatch } from "@/lib/vfs";

/**
 * Mirror of the RATE_LIMIT_PATCH diff in src/lib/demoAgent.ts (not exported
 * there), wrapped as a Patch targeting the virtual project's server file.
 */
const RATE_LIMIT_LINES: DiffLine[] = [
  { type: "ctx", text: 'import http from "node:http";' },
  { type: "add", text: 'import { allow } from "./rate-limit.js";' },
  { type: "ctx", text: "" },
  { type: "ctx", text: "const PORT = Number(process.env.PORT ?? 8080);" },
  { type: "del", text: "" },
  { type: "add", text: "" },
  { type: "add", text: "const WINDOW_MS = 60_000;" },
  { type: "add", text: "const MAX_REQUESTS = 60;" },
  { type: "ctx", text: "" },
  { type: "ctx", text: "const server = http.createServer((req, res) => {" },
  { type: "add", text: '  const key = req.socket.remoteAddress ?? "anon";' },
  { type: "add", text: "  if (!allow(key, MAX_REQUESTS, WINDOW_MS)) {" },
  { type: "add", text: '    res.writeHead(429, { "retry-after": "60" });' },
  { type: "add", text: '    res.end("rate limit exceeded");' },
  { type: "add", text: "    return;" },
  { type: "add", text: "  }" },
  { type: "ctx", text: '  if (req.url === "/health") {' },
  { type: "del", text: '    res.writeHead(200, { "content-type": "application/json" });' },
  { type: "add", text: '    res.writeHead(200, { "content-type": "application/json", "x-rate-limit": String(MAX_REQUESTS) });' },
  { type: "ctx", text: '    res.end(JSON.stringify({ ok: true }));' },
  { type: "ctx", text: "    return;" },
  { type: "ctx", text: "  }" },
];

const PATCH: Patch = { file: "src/server.ts", lines: RATE_LIMIT_LINES, status: "pending" };

const DELETED_LINE = '    res.writeHead(200, { "content-type": "application/json" });';
const ADDED_LINE = '    res.writeHead(200, { "content-type": "application/json", "x-rate-limit": String(MAX_REQUESTS) });';

function contentOf(files: typeof VIRTUAL_PROJECT, path: string): string {
  const f = files.find((v) => v.path === path);
  if (!f) throw new Error(`missing ${path}`);
  return f.content;
}

describe("applyPatch", () => {
  it("applies RATE_LIMIT_PATCH: added lines in, deleted lines out", () => {
    const next = applyPatch(VIRTUAL_PROJECT, PATCH);
    const content = contentOf(next, "src/server.ts");

    expect(content).toContain("x-rate-limit");
    expect(content).toContain(ADDED_LINE);
    expect(content).toContain('import { allow } from "./rate-limit.js";');
    expect(content).not.toContain(DELETED_LINE);
    // context lines survive
    expect(content).toContain('const server = http.createServer((req, res) => {');
    // trailing-newline convention preserved
    expect(content.endsWith("\n")).toBe(true);
  });

  it("returns a new array and keeps identity of untouched files", () => {
    const next = applyPatch(VIRTUAL_PROJECT, PATCH);
    expect(next).not.toBe(VIRTUAL_PROJECT);
    for (const file of VIRTUAL_PROJECT) {
      const match = next.find((f) => f.path === file.path);
      if (file.path === PATCH.file) {
        expect(match).not.toBe(file);
        expect(match?.language).toBe(file.language);
      } else {
        expect(match).toBe(file);
      }
    }
    // input not mutated
    expect(contentOf(VIRTUAL_PROJECT, "src/server.ts")).not.toContain("x-rate-limit");
  });

  it("is a no-op for an unknown target path", () => {
    const ghost: Patch = { ...PATCH, file: "src/nope.ts" };
    const next = applyPatch(VIRTUAL_PROJECT, ghost);
    expect(next).toBe(VIRTUAL_PROJECT);
  });
});

describe("revertPatch", () => {
  it("reconstructs the original content: deleted lines back, added lines gone", () => {
    const next = revertPatch(VIRTUAL_PROJECT, PATCH);
    const content = contentOf(next, "src/server.ts");

    expect(content).toContain(DELETED_LINE);
    expect(content).not.toContain("x-rate-limit");
    expect(content).not.toContain(ADDED_LINE);
    expect(content).not.toContain('import { allow } from "./rate-limit.js";');
    expect(content).toContain('const server = http.createServer((req, res) => {');
  });

  it("restores the original lines after apply (round trip)", () => {
    const applied = applyPatch(VIRTUAL_PROJECT, PATCH);
    const restored = revertPatch(applied, PATCH);
    expect(contentOf(restored, "src/server.ts")).toBe(contentOf(revertPatch(VIRTUAL_PROJECT, PATCH), "src/server.ts"));
  });

  it("is a no-op for an unknown target path", () => {
    const ghost: Patch = { ...PATCH, file: "src/nope.ts" };
    expect(revertPatch(VIRTUAL_PROJECT, ghost)).toBe(VIRTUAL_PROJECT);
  });
});

/**
 * Partial-diff splicing (Task B): when the diff's ctx lines anchor in the
 * current file content, only the matched region is replaced and the rest of
 * the file survives byte-for-byte. Rebuild semantics remain as fallback.
 */
describe("partial diff splicing", () => {
  const FILE = {
    path: "src/app.ts",
    language: "typescript",
    content: [
      "// header",
      "const a = 1;",
      "const b = 2;",
      "const c = 3;",
      "const d = 4;",
      "// footer",
      "",
    ].join("\n"), // trailing newline, like the catalog files
  };
  const files = [FILE];

  function patched(patch: Patch): string {
    const next = applyPatch(files, patch);
    return next.find((f) => f.path === FILE.path)!.content;
  }
  function reverted(patch: Patch, base = files): string {
    const next = revertPatch(base, patch);
    return next.find((f) => f.path === FILE.path)!.content;
  }

  it("mid-file partial diff leaves head and tail intact", () => {
    const patch: Patch = {
      file: FILE.path,
      status: "pending",
      lines: [
        { type: "ctx", text: "const b = 2;" },
        { type: "del", text: "const c = 3;" },
        { type: "add", text: "const c = 30;" },
        { type: "add", text: "const c2 = 31;" },
        { type: "ctx", text: "const d = 4;" },
      ],
    };
    const content = patched(patch);
    expect(content).toBe(
      ["// header", "const a = 1;", "const b = 2;", "const c = 30;", "const c2 = 31;", "const d = 4;", "// footer", ""].join("\n"),
    );
    expect(content.startsWith("// header\nconst a = 1;")).toBe(true);
    expect(content.endsWith("// footer\n")).toBe(true);
  });

  it("partial diff at file start inserts before the first anchor", () => {
    const patch: Patch = {
      file: FILE.path,
      status: "pending",
      lines: [
        { type: "add", text: 'import { x } from "./x.js";' },
        { type: "ctx", text: "// header" },
        { type: "ctx", text: "const a = 1;" },
      ],
    };
    const content = patched(patch);
    expect(content).toBe(
      ['import { x } from "./x.js";', "// header", "const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;", "// footer", ""].join("\n"),
    );
  });

  it("partial diff at file end appends after the last anchor", () => {
    const patch: Patch = {
      file: FILE.path,
      status: "pending",
      lines: [
        { type: "ctx", text: "const d = 4;" },
        { type: "ctx", text: "// footer" },
        { type: "add", text: "export {}; // appended" },
      ],
    };
    const content = patched(patch);
    expect(content.startsWith("// header\nconst a = 1;")).toBe(true);
    expect(content).toContain("// footer\nexport {}; // appended");
    // trailing-newline convention of the original file is preserved
    expect(content.endsWith("\n")).toBe(true);
  });

  it("ambiguous anchors: the first (topmost) match site wins", () => {
    const dup = {
      path: "src/dup.ts",
      language: "typescript",
      content: ["same();", "same();", "same();"].join("\n"),
    };
    const patch: Patch = {
      file: dup.path,
      status: "pending",
      lines: [
        { type: "ctx", text: "same();" },
        { type: "add", text: "// inserted" },
        { type: "ctx", text: "same();" },
      ],
    };
    const next = applyPatch([dup], patch);
    expect(next[0].content).toBe(["same();", "// inserted", "same();", "same();"].join("\n"));
  });

  it("falls back to rebuild semantics when ctx anchors do not match the file", () => {
    const patch: Patch = {
      file: FILE.path,
      status: "pending",
      lines: [
        { type: "ctx", text: "totally unrelated content" },
        { type: "add", text: "brand new line" },
        { type: "del", text: "ghost line" },
      ],
    };
    const content = patched(patch);
    // Rebuild: ctx + add only — head/tail of the original file are gone.
    expect(content).toBe("totally unrelated content\nbrand new line\n");
  });

  it("falls back to rebuild semantics for diffs with no ctx lines at all", () => {
    const patch: Patch = {
      file: FILE.path,
      status: "pending",
      lines: [
        { type: "del", text: "old" },
        { type: "add", text: "new-a" },
        { type: "add", text: "new-b" },
      ],
    };
    expect(patched(patch)).toBe("new-a\nnew-b\n");
    expect(reverted(patch)).toBe("old\n");
  });

  it("revert splices the same region (inverse) on a fresh file", () => {
    const patch: Patch = {
      file: FILE.path,
      status: "pending",
      lines: [
        { type: "ctx", text: "const b = 2;" },
        { type: "del", text: "const c = 3;" },
        { type: "add", text: "const c = 30;" },
        { type: "ctx", text: "const d = 4;" },
      ],
    };
    // Reverting the untouched file keeps head/tail and restores del lines.
    expect(reverted(patch)).toBe(FILE.content);
  });

  it("apply then revert round-trips back to the exact original content", () => {
    const patch: Patch = {
      file: FILE.path,
      status: "pending",
      lines: [
        { type: "ctx", text: "const b = 2;" },
        { type: "del", text: "const c = 3;" },
        { type: "add", text: "const c = 30;" },
        { type: "add", text: "const extra = true;" },
        { type: "ctx", text: "const d = 4;" },
      ],
    };
    const applied = applyPatch(files, patch);
    expect(applied[0].content).not.toBe(FILE.content);
    const restored = revertPatch(applied, patch);
    expect(restored[0].content).toBe(FILE.content);
  });

  it("the RATE_LIMIT patch (partial diff of catalog server.ts) now preserves the file tail", () => {
    const next = applyPatch(VIRTUAL_PROJECT, PATCH);
    const content = contentOf(next, "src/server.ts");
    // Previously truncated by rebuild semantics; splice keeps the tail.
    expect(content).toContain("server.listen(PORT, () => {");
    expect(content).toContain("res.writeHead(404);");
    // Revert restores the deleted line and keeps the spliced tail too.
    // (Byte-exact equality with the catalog original is NOT expected: the
    // demo diff itself is asymmetric — it carries both `del ""` and
    // `add ""` for the same blank line — so the inverse reinserts one extra
    // empty line. Faithful minimal diffs round-trip exactly, as shown by the
    // round-trip tests above.)
    const restored = contentOf(revertPatch(next, PATCH), "src/server.ts");
    expect(restored).toContain(DELETED_LINE);
    expect(restored).not.toContain(ADDED_LINE);
    expect(restored).toContain("server.listen(PORT, () => {");
  });
});
