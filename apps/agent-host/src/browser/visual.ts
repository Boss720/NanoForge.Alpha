/**
 * Task 9 — visual assertions and thresholded pixel diffs (host side).
 *
 * Two capabilities, both consumed by the run coordinator and rendered by the
 * React `VisualEvidenceCard`:
 *
 * 1. DOM assertions evaluated through the {@link BrowserBackend} abstraction
 *    (never via injected script): `expect_visible`, `expect_text`,
 *    `expect_url`.
 * 2. Thresholded pixel diffs of screenshots via pixelmatch + pngjs, with
 *    `baseline.png` / `current.png` / `overlay.png` (diff heatmap) persisted
 *    under the run artifacts dir — never into browser profiles.
 *
 * All result types are plain JSON-serializable objects and carry RELATIVE
 * POSIX artifact paths so the audit ledger and the UI card can consume them
 * without host-specific absolute paths.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { z } from "zod";
import type { BrowserBackend, BrowserContextHandle } from "./manager";

// ---------------------------------------------------------------------------
// DOM assertions.
// ---------------------------------------------------------------------------

export const visualAssertionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("expect_visible"), selector: z.string().min(1) }),
  z.object({
    kind: z.literal("expect_text"),
    selector: z.string().min(1),
    /** Compared after whitespace normalization (exact match). */
    text: z.string(),
  }),
  z.object({
    kind: z.literal("expect_url"),
    /** Exact URL, or a pattern where `*` matches any substring. */
    pattern: z.string().min(1),
  }),
]);

export type VisualAssertion = z.infer<typeof visualAssertionSchema>;
export type VisualAssertionKind = VisualAssertion["kind"];

/** JSON-serializable outcome of one DOM visual assertion. */
export interface VisualAssertionResult {
  readonly kind: VisualAssertionKind;
  readonly pass: boolean;
  readonly selector?: string;
  /** Expected text / URL pattern, when the assertion has one. */
  readonly expected?: string;
  /** Observed text / URL / visibility, when evaluation reached the page. */
  readonly actual?: string;
  readonly message: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** `*` wildcards match any substring; everything else is literal. */
export function urlPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Evaluate one assertion against the page in `ctx`. Evaluation failures
 * (e.g. selector not found) are reported as `pass: false` results rather
 * than thrown, so a broken page produces evidence, not a crashed run.
 * Invalid assertion payloads still throw a ZodError.
 */
export async function runVisualAssertion(
  backend: BrowserBackend,
  ctx: BrowserContextHandle,
  rawAssertion: unknown,
): Promise<VisualAssertionResult> {
  const assertion = visualAssertionSchema.parse(rawAssertion);

  try {
    switch (assertion.kind) {
      case "expect_visible": {
        const visible = await backend.isVisible(ctx, assertion.selector);
        return {
          kind: assertion.kind,
          pass: visible,
          selector: assertion.selector,
          actual: visible ? "visible" : "not visible",
          message: visible
            ? `Element ${assertion.selector} is visible`
            : `Element ${assertion.selector} is not visible`,
        };
      }
      case "expect_text": {
        const actual = await backend.extractText(ctx, assertion.selector);
        const pass = normalizeWhitespace(actual) === normalizeWhitespace(assertion.text);
        return {
          kind: assertion.kind,
          pass,
          selector: assertion.selector,
          expected: assertion.text,
          actual,
          message: pass
            ? `Element ${assertion.selector} has expected text`
            : `Element ${assertion.selector} text mismatch`,
        };
      }
      case "expect_url": {
        const actual = await backend.currentUrl(ctx);
        const pass = urlPatternToRegExp(assertion.pattern).test(actual);
        return {
          kind: assertion.kind,
          pass,
          expected: assertion.pattern,
          actual,
          message: pass ? `URL matches ${assertion.pattern}` : `URL does not match ${assertion.pattern}`,
        };
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: assertion.kind,
      pass: false,
      ...("selector" in assertion ? { selector: assertion.selector } : {}),
      ...("text" in assertion ? { expected: assertion.text } : {}),
      ...("pattern" in assertion ? { expected: assertion.pattern } : {}),
      message: `Assertion could not be evaluated: ${detail}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Pixel diffs.
// ---------------------------------------------------------------------------

/** JSON-serializable outcome of a screenshot pixel diff. */
export interface VisualDiffResult {
  /** True when `diffRatio <= maxDiffRatio` (and dimensions matched). */
  readonly match: boolean;
  /** Fraction of pixels that differ, 0..1. */
  readonly diffRatio: number;
  readonly diffPixels: number;
  readonly totalPixels: number;
  /** pixelmatch per-pixel sensitivity that was used. */
  readonly threshold: number;
  /** Maximum tolerated diff ratio for this assertion. */
  readonly maxDiffRatio: number;
  /** Relative POSIX path of the baseline PNG. */
  readonly baselinePath: string;
  /** Relative POSIX path of the current (actual) PNG. */
  readonly currentPath: string;
  /** Relative POSIX path of the written overlay/heatmap PNG. */
  readonly overlayPath: string;
  /** Present when the images could not be compared pixel-by-pixel. */
  readonly note?: string;
}

export interface DiffScreenshotsOptions {
  /** pixelmatch per-pixel matching threshold (0..1, smaller = stricter). Default 0.1. */
  readonly threshold?: number;
  /** Maximum tolerated ratio of differing pixels. Default 0 (any diff fails). */
  readonly maxDiffRatio?: number;
  /** Where to write the overlay heatmap. Default: `overlay.png` next to `currentPath`. */
  readonly overlayPath?: string;
  /** Root the result paths are made relative to. Default: `process.cwd()`. */
  readonly pathRoot?: string;
}

function toPortableRelative(root: string, absolutePath: string): string {
  const relative = path.relative(root, absolutePath);
  const portable = relative.split(path.sep).join("/");
  return portable === "" || portable.startsWith("..") || path.isAbsolute(portable)
    ? absolutePath.split(path.sep).join("/")
    : portable;
}

async function readPng(filePath: string): Promise<PNG> {
  return PNG.sync.read(await readFile(filePath));
}

/**
 * Compare two PNG screenshots pixel-by-pixel and persist a diff overlay
 * (unchanged pixels faded grayscale, differing pixels highlighted red).
 * Dimension mismatches never throw: they return `match: false`,
 * `diffRatio: 1`, and an overlay copied from the current image.
 */
export async function diffScreenshots(
  baselinePath: string,
  currentPath: string,
  options: DiffScreenshotsOptions = {},
): Promise<VisualDiffResult> {
  const threshold = options.threshold ?? 0.1;
  const maxDiffRatio = options.maxDiffRatio ?? 0;
  const overlayPath =
    options.overlayPath ?? path.join(path.dirname(currentPath), "overlay.png");
  const pathRoot = options.pathRoot ?? process.cwd();

  const baseline = await readPng(baselinePath);
  const current = await readPng(currentPath);

  const base = {
    threshold,
    maxDiffRatio,
    baselinePath: toPortableRelative(pathRoot, path.resolve(baselinePath)),
    currentPath: toPortableRelative(pathRoot, path.resolve(currentPath)),
    overlayPath: toPortableRelative(pathRoot, path.resolve(overlayPath)),
  };

  if (baseline.width !== current.width || baseline.height !== current.height) {
    await mkdir(path.dirname(overlayPath), { recursive: true });
    await writeFile(overlayPath, PNG.sync.write(current));
    const totalPixels = Math.max(baseline.width * baseline.height, current.width * current.height);
    return {
      ...base,
      match: false,
      diffRatio: 1,
      diffPixels: totalPixels,
      totalPixels,
      note:
        `Dimension mismatch: baseline ${baseline.width}x${baseline.height} ` +
        `vs current ${current.width}x${current.height}; overlay is the current image.`,
    };
  }

  const overlay = new PNG({ width: baseline.width, height: baseline.height });
  const diffPixels = pixelmatch(baseline.data, current.data, overlay.data, baseline.width, baseline.height, {
    threshold,
    diffColor: [255, 0, 0],
    aaColor: [255, 200, 0],
  });
  await mkdir(path.dirname(overlayPath), { recursive: true });
  await writeFile(overlayPath, PNG.sync.write(overlay));

  const totalPixels = baseline.width * baseline.height;
  const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  return {
    ...base,
    match: diffRatio <= maxDiffRatio,
    diffRatio,
    diffPixels,
    totalPixels,
  };
}

// ---------------------------------------------------------------------------
// Run-artifact persistence helper.
// ---------------------------------------------------------------------------

export interface SaveVisualDiffOptions {
  /** Absolute run artifacts dir, e.g. from `BrowserManager.artifactsDirFor(runId)`. */
  readonly artifactsDir: string;
  /** Baseline PNG: file path or raw bytes. */
  readonly baseline: string | Uint8Array;
  /** Current (actual) PNG: file path or raw bytes. */
  readonly current: string | Uint8Array;
  /** Optional name prefix: `<name>.baseline.png` etc. Default: `baseline.png`. */
  readonly name?: string;
  readonly threshold?: number;
  readonly maxDiffRatio?: number;
  /** Root for relative result paths (usually the workspace root). */
  readonly pathRoot?: string;
}

async function materializePng(targetPath: string, source: string | Uint8Array): Promise<void> {
  if (typeof source === "string") {
    await writeFile(targetPath, await readFile(source));
  } else {
    await writeFile(targetPath, source);
  }
}

/**
 * Persist `baseline.png`, `current.png`, and the diff `overlay.png` into the
 * run artifacts dir and return the diff result with relative paths.
 */
export async function saveVisualDiff(options: SaveVisualDiffOptions): Promise<VisualDiffResult> {
  const { artifactsDir, name } = options;
  await mkdir(artifactsDir, { recursive: true });
  const stem = (part: string): string => (name === undefined ? `${part}.png` : `${name}.${part}.png`);

  const baselinePath = path.join(artifactsDir, stem("baseline"));
  const currentPath = path.join(artifactsDir, stem("current"));
  const overlayPath = path.join(artifactsDir, stem("overlay"));

  await materializePng(baselinePath, options.baseline);
  await materializePng(currentPath, options.current);

  return diffScreenshots(baselinePath, currentPath, {
    threshold: options.threshold,
    maxDiffRatio: options.maxDiffRatio,
    overlayPath,
    pathRoot: options.pathRoot,
  });
}
