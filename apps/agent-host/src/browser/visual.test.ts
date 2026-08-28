/**
 * Task 9 tests — visual assertions (via FakeBackend) and pixel diffs
 * (fixtures generated programmatically with pngjs). No real browser needed.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeBackend } from "./manager";
import { diffScreenshots, runVisualAssertion, saveVisualDiff, urlPatternToRegExp } from "./visual";

type Rgba = [number, number, number, number];

interface ChangedBlock {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly rgba: Rgba;
}

/** Generate a solid PNG fixture, optionally with one changed rectangular block. */
function solidPng(width: number, height: number, rgba: Rgba, block?: ChangedBlock): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inBlock =
        block !== undefined && x >= block.x && x < block.x + block.w && y >= block.y && y < block.y + block.h;
      const color = inBlock ? block.rgba : rgba;
      const idx = (width * y + x) << 2;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = color[3];
    }
  }
  return PNG.sync.write(png);
}

const BASE_COLOR: Rgba = [10, 20, 30, 255];
const CHANGED_BLOCK: ChangedBlock = { x: 0, y: 0, w: 16, h: 16, rgba: [200, 30, 30, 255] };

describe("visual evidence", () => {
  let workspace: string;
  let baselineBytes: Buffer;
  let changedBytes: Buffer;
  let baselinePath: string;
  let currentPath: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "nanoforge-visual-"));
    baselineBytes = solidPng(64, 64, BASE_COLOR);
    changedBytes = solidPng(64, 64, BASE_COLOR, CHANGED_BLOCK);
    baselinePath = path.join(workspace, "baseline.png");
    currentPath = path.join(workspace, "current.png");
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  describe("diffScreenshots", () => {
    it("passes identical images and still writes an overlay", async () => {
      await writeFile(baselinePath, baselineBytes);
      await writeFile(currentPath, baselineBytes);

      const result = await diffScreenshots(baselinePath, currentPath, {
        maxDiffRatio: 0,
        pathRoot: workspace,
      });

      expect(result.match).toBe(true);
      expect(result.diffPixels).toBe(0);
      expect(result.diffRatio).toBe(0);
      expect(result.totalPixels).toBe(64 * 64);
      expect(result.overlayPath).toBe("overlay.png");
      // Overlay exists on disk and is a valid PNG of the same size.
      const overlay = PNG.sync.read(await readFile(path.join(workspace, result.overlayPath)));
      expect(overlay.width).toBe(64);
      expect(overlay.height).toBe(64);
    });

    it("fails a changed image above the threshold and highlights the diff in red", async () => {
      await writeFile(baselinePath, baselineBytes);
      await writeFile(currentPath, changedBytes);

      const result = await diffScreenshots(baselinePath, currentPath, {
        maxDiffRatio: 0.01,
        pathRoot: workspace,
      });

      expect(result.match).toBe(false);
      expect(result.diffPixels).toBe(16 * 16);
      expect(result.diffRatio).toBeCloseTo((16 * 16) / (64 * 64), 6);

      // Overlay diff heatmap exists on disk and marks the changed block red.
      const overlay = PNG.sync.read(await readFile(path.join(workspace, result.overlayPath)));
      const red = (x: number, y: number): boolean => {
        const idx = (overlay.width * y + x) << 2;
        return overlay.data[idx] === 255 && overlay.data[idx + 1] === 0 && overlay.data[idx + 2] === 0;
      };
      expect(red(8, 8)).toBe(true); // inside the changed block
      expect(red(8, 8 + 16)).toBe(false); // just below it
    });

    it("passes a changed image when the diff ratio is within tolerance", async () => {
      await writeFile(baselinePath, baselineBytes);
      await writeFile(currentPath, changedBytes);

      const result = await diffScreenshots(baselinePath, currentPath, {
        maxDiffRatio: 0.5,
        pathRoot: workspace,
      });

      expect(result.match).toBe(true);
      expect(result.diffPixels).toBe(16 * 16);
    });

    it("never throws on dimension mismatch — returns match:false with diffRatio 1", async () => {
      await writeFile(baselinePath, baselineBytes);
      await writeFile(currentPath, solidPng(32, 32, BASE_COLOR));

      const result = await diffScreenshots(baselinePath, currentPath, { pathRoot: workspace });

      expect(result.match).toBe(false);
      expect(result.diffRatio).toBe(1);
      expect(result.note).toContain("Dimension mismatch");
      await expect(readFile(path.join(workspace, result.overlayPath))).resolves.toBeDefined();
    });
  });

  describe("saveVisualDiff", () => {
    it("persists baseline/current/overlay under the artifacts dir with relative paths", async () => {
      const artifactsDir = path.join(workspace, ".nanoforge", "runs", "run-visual", "artifacts");

      const result = await saveVisualDiff({
        artifactsDir,
        baseline: baselineBytes,
        current: changedBytes,
        maxDiffRatio: 0.01,
        pathRoot: workspace,
      });

      expect(result.match).toBe(false);
      expect(result.baselinePath).toBe(".nanoforge/runs/run-visual/artifacts/baseline.png");
      expect(result.currentPath).toBe(".nanoforge/runs/run-visual/artifacts/current.png");
      expect(result.overlayPath).toBe(".nanoforge/runs/run-visual/artifacts/overlay.png");

      for (const rel of [result.baselinePath, result.currentPath, result.overlayPath]) {
        const bytes = await readFile(path.join(workspace, rel));
        expect(PNG.sync.read(bytes).width).toBe(64);
      }

      // Result type must survive a JSON round trip unchanged (UI card + ledger).
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    });

    it("supports name-prefixed artifact sets", async () => {
      const artifactsDir = path.join(workspace, "artifacts");
      const result = await saveVisualDiff({
        artifactsDir,
        name: "hero",
        baseline: baselineBytes,
        current: baselineBytes,
        pathRoot: workspace,
      });

      expect(result.match).toBe(true);
      expect(result.overlayPath).toBe("artifacts/hero.overlay.png");
      await expect(readFile(path.join(artifactsDir, "hero.baseline.png"))).resolves.toBeDefined();
    });
  });

  describe("runVisualAssertion against FakeBackend", () => {
    const PAGE_URL = "http://localhost:4173/fixture";

    async function fixtureContext(): Promise<{ backend: FakeBackend; ctx: { id: string } }> {
      const backend = new FakeBackend();
      backend.addPage({
        url: PAGE_URL,
        elements: {
          h1: { text: "  Hello NanoForge  ", visible: true },
          "#ghost": { text: "boo", visible: false },
        },
      });
      const ctx = await backend.newContext();
      await backend.navigate(ctx, PAGE_URL);
      return { backend, ctx };
    }

    it("expect_text passes on whitespace-normalized match and reports actual text on mismatch", async () => {
      const { backend, ctx } = await fixtureContext();

      const pass = await runVisualAssertion(backend, ctx, {
        kind: "expect_text",
        selector: "h1",
        text: "Hello NanoForge",
      });
      expect(pass.pass).toBe(true);
      expect(pass.actual).toBe("  Hello NanoForge  ");

      const fail = await runVisualAssertion(backend, ctx, {
        kind: "expect_text",
        selector: "h1",
        text: "Goodbye",
      });
      expect(fail.pass).toBe(false);
      expect(fail.expected).toBe("Goodbye");
      expect(fail.actual).toBe("  Hello NanoForge  ");
      expect(JSON.parse(JSON.stringify(fail))).toEqual(fail);
    });

    it("expect_text fails (without throwing) when the selector is missing", async () => {
      const { backend, ctx } = await fixtureContext();
      const result = await runVisualAssertion(backend, ctx, {
        kind: "expect_text",
        selector: "#missing",
        text: "anything",
      });
      expect(result.pass).toBe(false);
      expect(result.message).toContain("could not be evaluated");
    });

    it("expect_url matches exact and wildcard patterns, and rejects others", async () => {
      const { backend, ctx } = await fixtureContext();

      const exact = await runVisualAssertion(backend, ctx, { kind: "expect_url", pattern: PAGE_URL });
      expect(exact.pass).toBe(true);

      const wildcard = await runVisualAssertion(backend, ctx, {
        kind: "expect_url",
        pattern: "http://localhost:4173/*",
      });
      expect(wildcard.pass).toBe(true);

      const miss = await runVisualAssertion(backend, ctx, {
        kind: "expect_url",
        pattern: "https://*.example.com/*",
      });
      expect(miss.pass).toBe(false);
      expect(miss.actual).toBe(PAGE_URL);
    });

    it("expect_visible passes for visible elements and fails for hidden or missing ones", async () => {
      const { backend, ctx } = await fixtureContext();

      const visible = await runVisualAssertion(backend, ctx, { kind: "expect_visible", selector: "h1" });
      expect(visible.pass).toBe(true);
      expect(visible.actual).toBe("visible");

      const hidden = await runVisualAssertion(backend, ctx, { kind: "expect_visible", selector: "#ghost" });
      expect(hidden.pass).toBe(false);
      expect(hidden.actual).toBe("not visible");

      const missing = await runVisualAssertion(backend, ctx, { kind: "expect_visible", selector: "#nope" });
      expect(missing.pass).toBe(false);
    });

    it("rejects invalid assertion payloads", async () => {
      const { backend, ctx } = await fixtureContext();
      await expect(runVisualAssertion(backend, ctx, { kind: "expect_script", code: "1+1" })).rejects.toThrow();
    });
  });

  describe("urlPatternToRegExp", () => {
    it("treats * as wildcard and escapes regex metacharacters", () => {
      expect(urlPatternToRegExp("http://localhost:4173/*").test("http://localhost:4173/a/b?x=1")).toBe(true);
      expect(urlPatternToRegExp("http://localhost:4173/*").test("http://localhost:4173")).toBe(false);
      expect(urlPatternToRegExp("https://a.b/c").test("https://aXb/c")).toBe(false);
      expect(urlPatternToRegExp("https://a.b/c").test("https://a.b/c")).toBe(true);
    });
  });
});
