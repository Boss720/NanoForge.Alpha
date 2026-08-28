/**
 * Task 8 — isolated, non-persistent browser contexts for agent runs.
 *
 * Security contract (docs/plans/2026-08-11-agent-platform-modules.md):
 * - One dedicated NON-PERSISTENT browser context per run: fresh storage
 *   state, no profile reuse. Run artifacts are written under
 *   `.nanoforge/runs/<runId>/artifacts/` — never into browser profiles.
 * - The ONLY actions a model may propose are declared in
 *   {@link browserActionSchema} (`navigate | click | fill | extract_text |
 *   screenshot`). JavaScript strings from models are FORBIDDEN: no backend
 *   method accepts or evaluates model-supplied code, and no `page.evaluate`
 *   (or equivalent) exists anywhere in this action path.
 * - Every navigation is checked against the per-run origin allow-list
 *   BEFORE any network fetch, and re-checked after navigation so a redirect
 *   to a disallowed origin fails closed.
 *
 * Testability: all browser access goes through {@link BrowserBackend}.
 * {@link PlaywrightBackend} lazily loads playwright-core and reports a clear
 * setup error when Chromium is missing; {@link FakeBackend} is an in-memory
 * DOM stub so unit tests never require a real browser.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { assertOriginAllowed } from "./origins";

// ---------------------------------------------------------------------------
// Action schema — the only browser actions a model may propose.
// ---------------------------------------------------------------------------

const selectorSchema = z.string().min(1).max(1024);

export const browserActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string().min(1).max(4096) }),
  z.object({ type: z.literal("click"), selector: selectorSchema }),
  z.object({ type: z.literal("fill"), selector: selectorSchema, value: z.string().max(10_000) }),
  z.object({ type: z.literal("extract_text"), selector: selectorSchema }),
  z.object({
    type: z.literal("screenshot"),
    name: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
      .optional(),
  }),
]);

export type BrowserAction = z.infer<typeof browserActionSchema>;
export type BrowserActionType = BrowserAction["type"];

// ---------------------------------------------------------------------------
// Backend abstraction.
// ---------------------------------------------------------------------------

/** Opaque handle identifying one non-persistent context owned by a run. */
export interface BrowserContextHandle {
  readonly id: string;
}

/**
 * All browser capabilities the agent platform may use. Deliberately narrow:
 * there is intentionally NO evaluate/script method — model-supplied code
 * must never reach the browser.
 */
export interface BrowserBackend {
  /** Create a fresh, non-persistent context (no shared storage state). */
  newContext(): Promise<BrowserContextHandle>;
  navigate(ctx: BrowserContextHandle, url: string): Promise<void>;
  click(ctx: BrowserContextHandle, selector: string): Promise<void>;
  fill(ctx: BrowserContextHandle, selector: string, value: string): Promise<void>;
  extractText(ctx: BrowserContextHandle, selector: string): Promise<string>;
  isVisible(ctx: BrowserContextHandle, selector: string): Promise<boolean>;
  currentUrl(ctx: BrowserContextHandle): Promise<string>;
  /** Full-page PNG screenshot bytes. */
  screenshot(ctx: BrowserContextHandle): Promise<Uint8Array>;
  closeContext(ctx: BrowserContextHandle): Promise<void>;
}

// ---------------------------------------------------------------------------
// Structured action results (JSON-serializable; consumed by coordinator/UI).
// ---------------------------------------------------------------------------

export type BrowserActionResult =
  | { readonly type: "navigate"; readonly ok: true; readonly url: string; readonly finalUrl: string }
  | { readonly type: "click"; readonly ok: true; readonly selector: string }
  | { readonly type: "fill"; readonly ok: true; readonly selector: string }
  | { readonly type: "extract_text"; readonly ok: true; readonly selector: string; readonly text: string }
  | {
      readonly type: "screenshot";
      readonly ok: true;
      /** Workspace-relative POSIX path, e.g. `.nanoforge/runs/<runId>/artifacts/screenshot-001.png`. */
      readonly artifactPath: string;
      readonly byteLength: number;
      readonly sha256: string;
    };

// ---------------------------------------------------------------------------
// BrowserManager — run lifecycle, origin enforcement, artifact capture.
// ---------------------------------------------------------------------------

/** Run IDs become directory names; keep them filesystem-safe. */
export const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface BrowserRunOptions {
  readonly runId: string;
  /** Allowed origins, e.g. `["http://localhost:4173"]`. */
  readonly allowlist: readonly string[];
}

export interface BrowserManagerOptions {
  readonly backend: BrowserBackend;
  /** Defaults to `process.cwd()`; artifacts live at `<root>/.nanoforge/runs/`. */
  readonly workspaceRoot?: string;
}

interface RunState {
  readonly runId: string;
  readonly allowlist: readonly string[];
  readonly context: BrowserContextHandle;
  screenshotCount: number;
}

function assertValidRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Invalid runId ${JSON.stringify(runId)}: must match ${RUN_ID_PATTERN}`);
  }
}

export class BrowserManager {
  private readonly backend: BrowserBackend;
  private readonly workspaceRoot: string;
  private readonly runs = new Map<string, RunState>();

  constructor(options: BrowserManagerOptions) {
    this.backend = options.backend;
    this.workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  }

  get runsRoot(): string {
    return path.join(this.workspaceRoot, ".nanoforge", "runs");
  }

  /** Absolute artifacts dir for a run (created lazily on first artifact). */
  artifactsDirFor(runId: string): string {
    assertValidRunId(runId);
    return path.join(this.runsRoot, runId, "artifacts");
  }

  /** The backend context handle for an active run (for visual assertions). */
  contextHandleFor(runId: string): BrowserContextHandle {
    return this.requireRun(runId).context;
  }

  /** The backend this manager orchestrates (for visual assertions). */
  get browserBackend(): BrowserBackend {
    return this.backend;
  }

  /** Start a run: one fresh non-persistent context, zero shared state. */
  async startRun(options: BrowserRunOptions): Promise<void> {
    const { runId, allowlist } = options;
    assertValidRunId(runId);
    if (this.runs.has(runId)) throw new Error(`Browser run already active: ${runId}`);
    const context = await this.backend.newContext();
    this.runs.set(runId, { runId, allowlist: [...allowlist], context, screenshotCount: 0 });
  }

  /**
   * Validate and execute one model-proposed action. Unknown action types
   * (e.g. `evaluate`) fail Zod validation; disallowed origins throw
   * {@link import("./origins").OriginDeniedError} before any navigation.
   */
  async performAction(runId: string, rawAction: unknown): Promise<BrowserActionResult> {
    const run = this.requireRun(runId);
    const action: BrowserAction = browserActionSchema.parse(rawAction);

    switch (action.type) {
      case "navigate": {
        // Deny BEFORE any network fetch happens.
        assertOriginAllowed(action.url, run.allowlist);
        await this.backend.navigate(run.context, action.url);
        // Fail closed on redirects landing on a disallowed origin.
        const finalUrl = await this.backend.currentUrl(run.context);
        assertOriginAllowed(finalUrl, run.allowlist);
        return { type: "navigate", ok: true, url: action.url, finalUrl };
      }
      case "click": {
        await this.backend.click(run.context, action.selector);
        return { type: "click", ok: true, selector: action.selector };
      }
      case "fill": {
        await this.backend.fill(run.context, action.selector, action.value);
        return { type: "fill", ok: true, selector: action.selector };
      }
      case "extract_text": {
        const text = await this.backend.extractText(run.context, action.selector);
        return { type: "extract_text", ok: true, selector: action.selector, text };
      }
      case "screenshot": {
        const bytes = await this.backend.screenshot(run.context);
        run.screenshotCount += 1;
        const stem = action.name ?? `screenshot-${String(run.screenshotCount).padStart(3, "0")}`;
        const artifactsDir = this.artifactsDirFor(runId);
        await mkdir(artifactsDir, { recursive: true });
        const absolutePath = path.join(artifactsDir, `${stem}.png`);
        await writeFile(absolutePath, bytes);
        return {
          type: "screenshot",
          ok: true,
          artifactPath: this.toWorkspaceRelative(absolutePath),
          byteLength: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      }
    }
  }

  /** End a run and close its context. Idempotent. */
  async endRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (run === undefined) return;
    this.runs.delete(runId);
    await this.backend.closeContext(run.context);
  }

  /**
   * Run-scoped helper: guarantees the context is closed when `fn` returns
   * or throws — cleanup on run end AND on error.
   */
  async withRun<T>(options: BrowserRunOptions, fn: (runId: string) => Promise<T>): Promise<T> {
    await this.startRun(options);
    try {
      return await fn(options.runId);
    } finally {
      await this.endRun(options.runId);
    }
  }

  /** Close every active run context (host shutdown). */
  async closeAll(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((runId) => this.endRun(runId)));
  }

  private requireRun(runId: string): RunState {
    const run = this.runs.get(runId);
    if (run === undefined) throw new Error(`No active browser run: ${runId}`);
    return run;
  }

  private toWorkspaceRelative(absolutePath: string): string {
    return path.relative(this.workspaceRoot, absolutePath).split(path.sep).join("/");
  }
}

// ---------------------------------------------------------------------------
// PlaywrightBackend — real Chromium via playwright-core (lazy, optional).
// ---------------------------------------------------------------------------

interface PlaywrightContextState {
  readonly context: BrowserContext;
  readonly page: Page;
}

/**
 * Real browser backend. playwright-core is imported lazily and Chromium is
 * launched on first use, so the host runs fine without a browser until a
 * browser action is actually approved. Contexts created via
 * `browser.newContext()` are non-persistent by construction (fresh storage
 * state, no user-data directory, no profile reuse).
 */
export class PlaywrightBackend implements BrowserBackend {
  private browserPromise: Promise<Browser> | null = null;
  private readonly contexts = new Map<string, PlaywrightContextState>();

  private async browser(): Promise<Browser> {
    const existing = this.browserPromise;
    if (existing !== null) return existing;

    const promise = (async (): Promise<Browser> => {
      let playwright: typeof import("playwright-core");
      try {
        playwright = await import("playwright-core");
      } catch (cause) {
        throw new Error(
          "playwright-core is not available. Install it with `npm i -D playwright-core`.",
          { cause },
        );
      }
      try {
        return await playwright.chromium.launch({ headless: true });
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          "Chromium is not installed for playwright-core. " +
            "Run `npx playwright install chromium` once, then retry. " +
            `Original error: ${detail}`,
          { cause },
        );
      }
    })();
    // If the launch failed (e.g. Chromium missing), allow a retry after install.
    promise.catch(() => {
      if (this.browserPromise === promise) this.browserPromise = null;
    });
    this.browserPromise = promise;
    return promise;
  }

  private state(handle: BrowserContextHandle): PlaywrightContextState {
    const state = this.contexts.get(handle.id);
    if (state === undefined) throw new Error(`Unknown or closed browser context: ${handle.id}`);
    return state;
  }

  async newContext(): Promise<BrowserContextHandle> {
    const browser = await this.browser();
    // Non-persistent context: fresh storage state, no profile on disk.
    const context = await browser.newContext({ acceptDownloads: false });
    const page = await context.newPage();
    const handle: BrowserContextHandle = { id: randomUUID() };
    this.contexts.set(handle.id, { context, page });
    return handle;
  }

  async navigate(handle: BrowserContextHandle, url: string): Promise<void> {
    await this.state(handle).page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async click(handle: BrowserContextHandle, selector: string): Promise<void> {
    await this.state(handle).page.click(selector);
  }

  async fill(handle: BrowserContextHandle, selector: string, value: string): Promise<void> {
    await this.state(handle).page.fill(selector, value);
  }

  async extractText(handle: BrowserContextHandle, selector: string): Promise<string> {
    const text = await this.state(handle).page.textContent(selector);
    if (text === null) throw new Error(`No element matches selector: ${selector}`);
    return text;
  }

  async isVisible(handle: BrowserContextHandle, selector: string): Promise<boolean> {
    return this.state(handle).page.isVisible(selector);
  }

  async currentUrl(handle: BrowserContextHandle): Promise<string> {
    return this.state(handle).page.url();
  }

  async screenshot(handle: BrowserContextHandle): Promise<Uint8Array> {
    return this.state(handle).page.screenshot({ type: "png", fullPage: true });
  }

  async closeContext(handle: BrowserContextHandle): Promise<void> {
    const state = this.contexts.get(handle.id);
    if (state === undefined) return;
    this.contexts.delete(handle.id);
    await state.context.close();
  }

  /** Close all contexts and the shared browser process. */
  async dispose(): Promise<void> {
    this.contexts.clear();
    const promise = this.browserPromise;
    this.browserPromise = null;
    if (promise !== null) {
      const browser = await promise.catch(() => null);
      await browser?.close();
    }
  }
}

// ---------------------------------------------------------------------------
// FakeBackend — deterministic in-memory DOM stub for unit tests. No browser.
// ---------------------------------------------------------------------------

/** Deterministic 1x1 transparent PNG used when a fake page has no fixture shot. */
const FALLBACK_SCREENSHOT_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export interface FakeElement {
  readonly text?: string;
  /** Defaults to true when the element exists. */
  readonly visible?: boolean;
  /** If set, clicking this element follows a link to the given URL. */
  readonly navigatesTo?: string;
}

export interface FakePage {
  readonly url: string;
  readonly elements?: Record<string, FakeElement>;
  /** Fixture PNG bytes returned by `screenshot` on this page. */
  readonly screenshotPng?: Uint8Array;
  /** If set, navigating to `url` immediately redirects here. */
  readonly redirectTo?: string;
}

interface FakeContextState {
  currentUrl: string | null;
  readonly filledValues: Map<string, string>;
}

/**
 * In-memory {@link BrowserBackend} stub. Records every navigation attempt so
 * tests can prove that a denied origin never produced a navigation.
 */
export class FakeBackend implements BrowserBackend {
  readonly pages = new Map<string, FakePage>();
  /** Every URL the backend was asked to navigate to, in order. */
  readonly navigations: Array<{ readonly contextId: string; readonly url: string }> = [];
  /** IDs of contexts that are currently open. */
  readonly openContexts = new Set<string>();
  private readonly contexts = new Map<string, FakeContextState>();
  private nextContextId = 0;

  addPage(page: FakePage): this {
    this.pages.set(page.url, page);
    return this;
  }

  newContext(): Promise<BrowserContextHandle> {
    this.nextContextId += 1;
    const id = `fake-context-${this.nextContextId}`;
    this.contexts.set(id, { currentUrl: null, filledValues: new Map() });
    this.openContexts.add(id);
    return Promise.resolve({ id });
  }

  private state(handle: BrowserContextHandle): FakeContextState {
    const state = this.contexts.get(handle.id);
    if (state === undefined) throw new Error(`Unknown or closed fake context: ${handle.id}`);
    return state;
  }

  private currentPage(state: FakeContextState): FakePage | undefined {
    return state.currentUrl === null ? undefined : this.pages.get(state.currentUrl);
  }

  private elementAt(state: FakeContextState, selector: string): FakeElement | undefined {
    return this.currentPage(state)?.elements?.[selector];
  }

  navigate(handle: BrowserContextHandle, url: string): Promise<void> {
    const state = this.state(handle);
    this.navigations.push({ contextId: handle.id, url });
    state.currentUrl = this.pages.get(url)?.redirectTo ?? url;
    return Promise.resolve();
  }

  click(handle: BrowserContextHandle, selector: string): Promise<void> {
    const state = this.state(handle);
    const element = this.elementAt(state, selector);
    if (element === undefined) {
      return Promise.reject(new Error(`No element matches selector "${selector}" at ${state.currentUrl ?? "about:blank"}`));
    }
    if (element.visible === false) {
      return Promise.reject(new Error(`Element is not visible: ${selector}`));
    }
    if (element.navigatesTo !== undefined) {
      this.navigations.push({ contextId: handle.id, url: element.navigatesTo });
      state.currentUrl = this.pages.get(element.navigatesTo)?.redirectTo ?? element.navigatesTo;
    }
    return Promise.resolve();
  }

  fill(handle: BrowserContextHandle, selector: string, value: string): Promise<void> {
    const state = this.state(handle);
    if (this.elementAt(state, selector) === undefined) {
      return Promise.reject(new Error(`No element matches selector "${selector}" at ${state.currentUrl ?? "about:blank"}`));
    }
    state.filledValues.set(selector, value);
    return Promise.resolve();
  }

  extractText(handle: BrowserContextHandle, selector: string): Promise<string> {
    const element = this.elementAt(this.state(handle), selector);
    if (element?.text === undefined) {
      return Promise.reject(new Error(`No element matches selector: ${selector}`));
    }
    return Promise.resolve(element.text);
  }

  isVisible(handle: BrowserContextHandle, selector: string): Promise<boolean> {
    const element = this.elementAt(this.state(handle), selector);
    return Promise.resolve(element !== undefined && element.visible !== false);
  }

  currentUrl(handle: BrowserContextHandle): Promise<string> {
    return Promise.resolve(this.state(handle).currentUrl ?? "about:blank");
  }

  screenshot(handle: BrowserContextHandle): Promise<Uint8Array> {
    const page = this.currentPage(this.state(handle));
    return Promise.resolve(
      page?.screenshotPng ?? Buffer.from(FALLBACK_SCREENSHOT_BASE64, "base64"),
    );
  }

  closeContext(handle: BrowserContextHandle): Promise<void> {
    this.contexts.delete(handle.id);
    this.openContexts.delete(handle.id);
    return Promise.resolve();
  }
}
