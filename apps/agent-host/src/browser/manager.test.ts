/**
 * Task 8 tests — BrowserManager orchestration over FakeBackend only.
 * No real browser is required: Chromium is never launched here.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserManager, FakeBackend } from "./manager";
import { assertOriginAllowed, checkOrigin, OriginDeniedError } from "./origins";

const FIXTURE_URL = "http://localhost:4173/fixture";
const SUBDOMAIN_URL = "http://app.localhost:4173/fixture";
const ALLOWLIST = ["http://localhost:4173"];

function fixtureBackend(): FakeBackend {
  const backend = new FakeBackend();
  backend.addPage({
    url: FIXTURE_URL,
    elements: {
      h1: { text: "NanoForge fixture", visible: true },
      "#go": { text: "Go", visible: true, navigatesTo: "http://localhost:4173/other" },
      "#hidden": { text: "secret", visible: false },
    },
  });
  backend.addPage({
    url: "http://localhost:4173/other",
    elements: { h1: { text: "Other page", visible: true } },
  });
  backend.addPage({
    url: SUBDOMAIN_URL,
    elements: { h1: { text: "Subdomain fixture", visible: true } },
  });
  backend.addPage({ url: "http://localhost:4173/bait", redirectTo: "https://evil.example.com/" });
  return backend;
}

describe("BrowserManager", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "nanoforge-browser-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("runs actions on an allowed local fixture origin and closes the context after the run", async () => {
    const backend = fixtureBackend();
    const manager = new BrowserManager({ backend, workspaceRoot: workspace });

    const text = await manager.withRun({ runId: "run-allowed", allowlist: ALLOWLIST }, async (runId) => {
      const nav = await manager.performAction(runId, { type: "navigate", url: FIXTURE_URL });
      expect(nav).toEqual({ type: "navigate", ok: true, url: FIXTURE_URL, finalUrl: FIXTURE_URL });

      const extracted = await manager.performAction(runId, { type: "extract_text", selector: "h1" });
      expect(backend.openContexts.size).toBe(1); // context alive during the run
      return extracted;
    });

    expect(text).toEqual({ type: "extract_text", ok: true, selector: "h1", text: "NanoForge fixture" });
    expect(backend.navigations.map((n) => n.url)).toEqual([FIXTURE_URL]);
    expect(backend.openContexts.size).toBe(0); // closed after run end
  });

  it("blocks an external origin BEFORE navigation (no fetch, structured denial)", async () => {
    const backend = fixtureBackend();
    const manager = new BrowserManager({ backend, workspaceRoot: workspace });

    await manager.withRun({ runId: "run-blocked", allowlist: ALLOWLIST }, async (runId) => {
      const error = await manager
        .performAction(runId, { type: "navigate", url: "https://tracker.example.com/collect" })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(OriginDeniedError);
      const denial = (error as OriginDeniedError).denial;
      expect(denial.allowed).toBe(false);
      expect(denial.origin).toBe("https://tracker.example.com");
      expect(denial.reason).toContain("allow-list");
    });

    // The backend proves no navigation ever happened for the denied URL.
    expect(backend.navigations).toHaveLength(0);
  });

  it("fails closed when a redirect lands on a disallowed origin", async () => {
    const backend = fixtureBackend();
    const manager = new BrowserManager({ backend, workspaceRoot: workspace });

    await manager.withRun({ runId: "run-redirect", allowlist: ALLOWLIST }, async (runId) => {
      const error = await manager
        .performAction(runId, { type: "navigate", url: "http://localhost:4173/bait" })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(OriginDeniedError);
      expect((error as OriginDeniedError).denial.origin).toBe("https://evil.example.com");
    });
  });

  it("persists a screenshot artifact under the run artifacts dir with a relative path", async () => {
    const backend = fixtureBackend();
    const manager = new BrowserManager({ backend, workspaceRoot: workspace });

    const result = await manager.withRun({ runId: "run-shots", allowlist: ALLOWLIST }, async (runId) => {
      await manager.performAction(runId, { type: "navigate", url: FIXTURE_URL });
      return manager.performAction(runId, { type: "screenshot" });
    });

    expect(result.type).toBe("screenshot");
    if (result.type !== "screenshot") return;
    expect(result.artifactPath).toBe(".nanoforge/runs/run-shots/artifacts/screenshot-001.png");
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);

    const absolute = path.join(workspace, ".nanoforge", "runs", "run-shots", "artifacts", "screenshot-001.png");
    const bytes = await readFile(absolute);
    expect(bytes.byteLength).toBe(result.byteLength);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("closes the context even when the run throws", async () => {
    const backend = fixtureBackend();
    const manager = new BrowserManager({ backend, workspaceRoot: workspace });

    await expect(
      manager.withRun({ runId: "run-error", allowlist: ALLOWLIST }, async (runId) => {
        await manager.performAction(runId, { type: "navigate", url: FIXTURE_URL });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(backend.openContexts.size).toBe(0);
  });

  it("rejects model-supplied script actions (only the 5 declared actions exist)", async () => {
    const backend = fixtureBackend();
    const manager = new BrowserManager({ backend, workspaceRoot: workspace });

    await manager.withRun({ runId: "run-schema", allowlist: ALLOWLIST }, async (runId) => {
      await expect(
        manager.performAction(runId, { type: "evaluate", code: "alert(1)" }),
      ).rejects.toThrow();
      await expect(
        manager.performAction(runId, { type: "navigate", url: "javascript:alert(1)" }),
      ).rejects.toThrow(OriginDeniedError);
    });

    expect(backend.navigations).toHaveLength(0);
    expect(backend.openContexts.size).toBe(0);
  });

  it("supports localhost subdomains for tests", async () => {
    const backend = fixtureBackend();
    const manager = new BrowserManager({ backend, workspaceRoot: workspace });

    const result = await manager.withRun({ runId: "run-sub", allowlist: ALLOWLIST }, async (runId) => {
      await manager.performAction(runId, { type: "navigate", url: SUBDOMAIN_URL });
      return manager.performAction(runId, { type: "extract_text", selector: "h1" });
    });

    expect(result).toEqual({ type: "extract_text", ok: true, selector: "h1", text: "Subdomain fixture" });
  });

  it("rejects filesystem-hostile runIds", async () => {
    const manager = new BrowserManager({ backend: fixtureBackend(), workspaceRoot: workspace });
    await expect(manager.startRun({ runId: "../escape", allowlist: ALLOWLIST })).rejects.toThrow(/runId/);
    expect(() => manager.artifactsDirFor("a/b")).toThrow(/runId/);
  });
});

describe("assertOriginAllowed / checkOrigin", () => {
  it("returns the normalized origin for allowed URLs", () => {
    expect(assertOriginAllowed("http://localhost:4173/app?x=1", ALLOWLIST)).toBe("http://localhost:4173");
  });

  it("treats default ports as equivalent (http:80, https:443)", () => {
    expect(assertOriginAllowed("http://example.com:80/a", ["http://example.com"])).toBe("http://example.com");
    expect(assertOriginAllowed("https://example.com/b", ["https://example.com:443"])).toBe("https://example.com");
  });

  it("denies scheme and port mismatches", () => {
    expect(checkOrigin("https://example.com/", ["http://example.com"]).allowed).toBe(false);
    expect(checkOrigin("http://localhost:9999/", ALLOWLIST).allowed).toBe(false);
  });

  it("does not extend subdomain matching beyond localhost", () => {
    expect(checkOrigin("https://sub.example.com/", ["https://example.com"]).allowed).toBe(false);
  });

  it("denies non-http(s) schemes and unparseable URLs", () => {
    for (const url of ["file:///etc/passwd", "data:text/html,<h1/>", "chrome://settings", "not a url"]) {
      const result = checkOrigin(url, ["file:///", "http://localhost:4173"]);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.origin).toBeNull();
      expect(() => assertOriginAllowed(url, ["file:///"])).toThrow(OriginDeniedError);
    }
  });

  it("ignores invalid allow-list entries (fail closed)", () => {
    expect(checkOrigin("http://localhost:4173/", ["not a url", ":::"]).allowed).toBe(false);
  });
});
