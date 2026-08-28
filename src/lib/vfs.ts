import type { DiffLine, Patch, VirtualFile } from "@/types";

/**
 * Virtual filesystem patch engine (roadmap Task 1.1 + partial-diff upgrade).
 *
 * A `Patch` carries the target file as annotated diff lines:
 *   - "ctx" — unchanged lines (present in both versions)
 *   - "add" — lines introduced by the patch
 *   - "del" — lines removed by the patch
 *
 * Two application modes:
 *
 *   1. SPLICE (partial diffs) — when the diff's ctx lines can be located in
 *      the current file content, only the anchored region is replaced:
 *      del lines drop out, add lines are inserted, and everything outside
 *      the region (file head/tail) is left byte-for-byte intact.
 *   2. REBUILD (fallback) — when no reliable anchor match exists (no ctx
 *      lines, or the ctx sequence is not found in the file), the file is
 *      rebuilt from the diff lines alone. This is the original semantics and
 *      is correct for full-file diffs.
 *
 * Reverting mirrors the same logic with the inverse line set (ctx + del).
 */

const APPLY_KEEPS: ReadonlySet<DiffLine["type"]> = new Set(["ctx", "add"]);
const REVERT_KEEPS: ReadonlySet<DiffLine["type"]> = new Set(["ctx", "del"]);

/** Inclusive [start, end] line indices of the matched region. */
interface AnchorRegion {
  start: number;
  end: number;
}

/**
 * Locates the diff's ctx anchors in `fileLines`.
 *
 * Matcher design (deliberately conservative):
 *   - EXACT, untrimmed line equality. Diff lines are generated against the
 *     real file content, so whitespace-significant matching avoids anchoring
 *     on a line that merely looks similar after trimming.
 *   - Anchors must match as an ORDERED SUBSEQUENCE: the first ctx line pins
 *     the region start, each subsequent ctx line is matched greedily at the
 *     earliest later position, and the last one's position pins the region
 *     end. Non-ctx lines between anchors are ignored by the matcher (they
 *     are exactly the lines being deleted/replaced).
 *   - AMBIGUITY: the FIRST (topmost) start position that completes the full
 *     subsequence wins; later match sites are not considered. Greedy
 *     earliest matching may pick a nearer repeated anchor line over the
 *     "intended" one — accepted and documented.
 *   - A diff with zero ctx lines can never anchor and returns null.
 */
function findAnchorRegion(fileLines: string[], patch: Patch): AnchorRegion | null {
  const anchors = patch.lines.filter((l) => l.type === "ctx").map((l) => l.text);
  if (anchors.length === 0) return null;

  for (let start = 0; start <= fileLines.length - 1; start++) {
    if (fileLines[start] !== anchors[0]) continue;
    let cursor = start;
    let complete = true;
    for (let a = 1; a < anchors.length; a++) {
      let found = -1;
      for (let j = cursor + 1; j < fileLines.length; j++) {
        if (fileLines[j] === anchors[a]) {
          found = j;
          break;
        }
      }
      if (found === -1) {
        complete = false;
        break;
      }
      cursor = found;
    }
    if (complete) return { start, end: cursor };
  }
  return null;
}

function reconstruct(files: VirtualFile[], patch: Patch, keep: ReadonlySet<DiffLine["type"]>): VirtualFile[] {
  const index = files.findIndex((f) => f.path === patch.file);
  if (index === -1) return files; // unknown target — no-op, never throw

  const target = files[index];
  const kept = patch.lines.filter((l) => keep.has(l.type)).map((l) => l.text);

  const fileLines = target.content.split("\n");
  const region = findAnchorRegion(fileLines, patch);

  let content: string;
  if (region) {
    // SPLICE: replace only the anchored region, preserving head and tail.
    // Kept lines include the ctx anchors themselves, so the region is fully
    // rewritten in patch order (leading/trailing adds land at its edges).
    const spliced = [...fileLines.slice(0, region.start), ...kept, ...fileLines.slice(region.end + 1)];
    content = spliced.join("\n");
  } else {
    // REBUILD fallback: no reliable anchor — keep the original semantics.
    content = kept.join("\n");
  }

  // Preserve the original file's trailing-newline convention.
  if (target.content.endsWith("\n") && !content.endsWith("\n")) {
    content += "\n";
  }

  const next = files.slice();
  next[index] = { ...target, content };
  return next;
}

/**
 * Returns a new array with the patch applied to its target file. When the
 * diff's ctx lines anchor in the current content, only the matched region is
 * replaced (partial-diff splice); otherwise the file is rebuilt from
 * ctx + add lines (full-diff fallback). Files not touched by the patch keep
 * object identity. If the target path does not exist, the input array is
 * returned unchanged.
 */
export function applyPatch(files: VirtualFile[], patch: Patch): VirtualFile[] {
  return reconstruct(files, patch, APPLY_KEEPS);
}

/**
 * Inverse of {@link applyPatch}, using the SAME anchor matcher so a partial
 * revert splices the identical region: the matched span is replaced with
 * ctx + del lines (the original content of the diffed region), dropping
 * added lines. Falls back to rebuild semantics when no anchor matches.
 */
export function revertPatch(files: VirtualFile[], patch: Patch): VirtualFile[] {
  return reconstruct(files, patch, REVERT_KEEPS);
}
