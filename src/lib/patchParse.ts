import type { DiffLine, Patch } from "@/types";

/**
 * Patch extraction from model markdown output (roadmap Task 2.1).
 *
 * `extractPatch` scans markdown for fenced ```diff / ```patch code blocks and
 * turns the first USABLE one into a `Patch` (status "pending").
 *
 * Target-file resolution, in priority order:
 *   1. A leading `--- file: <path>` line inside the fence body.
 *   2. The first token of the fence info string, e.g. ```diff src/server.ts
 *
 * A fence with no resolvable path is NOT usable and is skipped (the next
 * fence gets a chance); if no fence yields a path, `extractPatch` returns
 * null. Fences of any other language (```ts, ```json, ...) are ignored.
 *
 * Line parsing inside the fence body:
 *   `+...`  -> { type: "add", text: rest }
 *   `-...`  -> { type: "del", text: rest }
 *   ` ...`  -> { type: "ctx", text: rest }
 * Unified-diff noise is skipped: `+++ ...` / `--- ...` file headers,
 * `@@ ... @@` hunk headers, and `\ No newline at end of file` markers.
 * Any other non-empty line is kept as best-effort context.
 */

const FENCE_RE = /```(diff|patch)\b([^\n]*)\r?\n([\s\S]*?)(?:```|$)/g;
const FILE_HEADER_RE = /^---\s+file:\s*(\S+)\s*$/;

function parseDiffBody(body: string, startLine: number): DiffLine[] {
  const lines = body.split(/\r?\n/);
  const out: DiffLine[] = [];
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue; // blank padding carries no meaning
    if (line.startsWith("@@")) continue; // hunk header
    if (line.startsWith("+++") || line.startsWith("---")) continue; // unified file headers
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    const marker = line[0];
    if (marker === "+") out.push({ type: "add", text: line.slice(1) });
    else if (marker === "-") out.push({ type: "del", text: line.slice(1) });
    else if (marker === " ") out.push({ type: "ctx", text: line.slice(1) });
    else out.push({ type: "ctx", text: line }); // best-effort context
  }
  return out;
}

export function extractPatch(markdown: string): Patch | null {
  for (const match of markdown.matchAll(FENCE_RE)) {
    const info = (match[2] ?? "").trim();
    const body = match[3] ?? "";
    const bodyLines = body.split(/\r?\n/);

    // Skip leading blank lines, then look for the `--- file:` header.
    let start = 0;
    while (start < bodyLines.length && bodyLines[start].trim() === "") start++;

    let file: string | null = null;
    if (start < bodyLines.length) {
      const header = FILE_HEADER_RE.exec(bodyLines[start]);
      if (header) {
        file = header[1];
        start++;
      }
    }
    if (!file && info) {
      file = info.split(/\s+/)[0] ?? null;
    }
    if (!file) continue; // not usable — try the next fence

    const diffLines = parseDiffBody(body, start);
    if (diffLines.length === 0) continue; // empty fence is not a patch

    return { file, lines: diffLines, status: "pending" };
  }
  return null;
}
