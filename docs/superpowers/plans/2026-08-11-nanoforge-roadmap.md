# NanoForge Codebase Assessment & Roadmap Plan

> **For agentic workers:** Execute phase-by-phase. Phases are independently shippable; tasks within a phase are ordered. Steps use checkbox (`- [ ]`) syntax. NOTE: subagent execution is disabled in this environment — execute inline.

**Goal:** Evolve NanoForge from a polished demo shell into a genuinely useful live coding agent on the nano-gpt.com API.

**Architecture:** React 19 + TypeScript + Vite + Tailwind/shadcn. Single-page app, all state in `App.tsx`, browser-direct calls to `https://nano-gpt.com/api/v1` (OpenAI-compatible). No backend, no persistence layer, no tests yet.

**Tech Stack:** React 19, TS 5.9, Vite 7, Tailwind 3.4, lucide-react, vitest (to be added).

## Implementation status — 2026-08-11

The concrete work described in Phases 0–3 is implemented in the repository, including the test scaffolding, session/request fixes, virtual filesystem patching, context and pricing handling, live patch extraction and edit/verify loop, generation controls, persistence, responsive drawers, transcript export, model quick-switching, session rename/delete, and syntax highlighting. The repository also contains implementations for the optional Phase 4 image-generation, cost-dashboard, x402, and MCP-interoperability items; the Phase 4 epics below remain preserved as the original future-scope record.

Current verification: `npm run lint`, host/protocol typechecks, production build, and root/host/protocol tests pass. The production build still reports a bundle-size warning.

## Global Constraints

- No backend server — everything ships as a static site; API calls go browser → nano-gpt.com directly (document CORS caveat; offer proxy base-URL field as escape hatch, already present).
- API key never leaves the browser; localStorage only.
- Dark forge theme tokens from `src/index.css` are the design source of truth — new UI must reuse `--primary`, `--border`, `--muted-foreground` etc., no hardcoded hex in components.
- Keep `npm run build` (tsc -b && vite build) green after every task.
- Every new lib function gets a vitest unit test.

---

# Part 1 — Assessment (current state, verified 2026-08-11)

## Inventory

| File | Lines | Responsibility | Health |
|---|---|---|---|
| `src/App.tsx` | 268 | All state, send flow, connect/disconnect, overlays | ⚠️ god-component, contains 3 real bugs (below) |
| `src/sections/ChatPanel.tsx` | 248 | Transcript, tool cards, patch card, composer | ✅ good; minor a11y gaps |
| `src/sections/ModelPanel.tsx` | ~120 | Catalog list/search/filter | ✅ good; pricing label ambiguous |
| `src/sections/TopBar.tsx` | ~90 | Brand, plan chip, usage, connection | ✅ good |
| `src/sections/Sidebar.tsx` | ~90 | Sessions + virtual file tree | ✅ good |
| `src/sections/ConnectDialog.tsx` | ~120 | Key entry + test | ⚠️ stale-key bug (#3 below) |
| `src/components/RichText.tsx` | ~90 | Markdown-lite renderer | ⚠️ no syntax highlight, regex inline parser fragile with nested marks |
| `src/lib/nanogpt.ts` | 151 | API client: validate/fetchModels/streamChat | ⚠️ `toPerMillion` heuristic fragile |
| `src/lib/demoAgent.ts` | 110 | Scripted demo run | ✅ good |
| `src/lib/catalog.ts` | ~120 | Fallback models, virtual project, system prompt | ✅ good |
| `src/types/index.ts` | — | Shared types | ✅ good |

## Confirmed defects

1. **Cross-session write bug** (`App.tsx`): `patchMessage` closes over `activeId`. If the user switches sessions mid-run, streaming deltas land in the *newly active* session. Fix by capturing `session.id` in `handleSend` and patching by explicit id.
2. **Error runs counted as successful requests** (`App.tsx` `finishRun`): `onError` path calls `finishRun(..., {0,0})` which still increments `usage.requests`.
3. **Stale key in ConnectDialog**: component early-returns `null` but stays mounted, so `key` state survives disconnect → reopening shows the old key while TopBar says "demo mode".
4. **Orphan scaffold files**: `src/pages/Home.tsx`, `src/App.css`, and the `react-router` dependency are dead weight (router removed from `main.tsx`).
5. **No git repo, no test runner** — nothing is versioned or verified except `tsc`.

## Architectural gaps (biggest → smallest)

- **A. Live mode is chat, not an agent.** No tool/function-calling loop; live responses never produce `Patch` cards; patches are demo-only.
- **B. Apply/Reject is cosmetic.** Patch status flips but virtual files never change; file viewer shows stale content.
- **C. No persistence.** Sessions, usage, and patch history vanish on reload (only the key persists).
- **D. Context management is naive.** `slice(-12)` ignores token budget vs. the selected model's `contextK`; no usage bar.
- **E. Zero responsive behavior.** Fixed `w-56`/`w-72` rails crush <1100px viewports.
- **F. `toPerMillion` heuristic** (`nanogpt.ts`): guesses per-token vs per-million by magnitude — will misprice any model priced exactly at boundary values. Prefer explicit field names, keep heuristic as fallback with a `priceEstimated` flag.

---

# Part 2 — Roadmap

## Phase 0 — Stabilize (bug fixes + hygiene) · ~1 session

### Task 0.1: Repo + test scaffolding

**Files:**
- Create: `.git/` (`git init`), `vitest.config.ts`, `src/lib/__tests__/`
- Modify: `package.json` (add `vitest`, `@vitest/coverage-v8`, `jsdom` devDeps; add `"test": "vitest run"` script; rename `"name": "nanoforge"`)

- [x] `git init && git add -A && git commit -m "chore: baseline"`
- [x] `npm i -D vitest jsdom @vitest/coverage-v8`
- [x] Create `vitest.config.ts` with `environment: "node"`, `alias @ → ./src` (mirror vite.config).
- [x] Delete `src/pages/Home.tsx`, `src/App.css`; `npm uninstall react-router`.
- [x] Verify: `npm test` (0 tests pass), `npm run build` green. Commit.

### Task 0.2: Fix cross-session write bug

**Files:** Modify `src/App.tsx` (`patchMessage`, `handleSend`)
**Test:** `src/lib/__tests__/sessionReducer.test.ts` — extract message-patching into `src/lib/sessionReducer.ts` (pure functions) so it is testable.

- Interfaces:
  - Produces: `patchSessionMessage(sessions: Session[], sessionId: string, msgId: string, fn: (m: Message) => Message): Session[]`
- [x] Write failing test: patch targets session B while another session is "active" — assert only session B changed.
- [x] Implement `sessionReducer.ts`; refactor `App.tsx` to call it with the `session.id` captured at `handleSend` time (not `activeId`).
- [x] Manual check: start demo run, switch sessions mid-stream, confirm no leakage. Build green. Commit.

### Task 0.3: Fix request counting + stale key

**Files:** Modify `src/App.tsx` (`finishRun` gains `counted: boolean` param), `src/sections/ConnectDialog.tsx`

- [x] Test: `finishRun` with `{input:0, output:0, errored:true}` does not increment `requests`.
- [x] In `onError`, call `finishRun(agentMsg.id, { input: 0, output: 0 }, { errored: true })`.
- [x] ConnectDialog: sync local state on open — `useEffect(() => { setKey(connection.apiKey); setBase(connection.baseUrl); }, [open])`.
- [x] Build green. Commit.

## Phase 1 — Make "Apply" real + context awareness · ~1–2 sessions

### Task 1.1: Virtual filesystem with patch application

**Files:**
- Create: `src/lib/vfs.ts`, `src/lib/__tests__/vfs.test.ts`
- Modify: `src/App.tsx` (hold `files` in state instead of importing `VIRTUAL_PROJECT` directly), `src/sections/Sidebar.tsx` (props already take `files`), viewer overlay (read from state)

- Interfaces:
  - Produces:
    - `applyPatch(files: VirtualFile[], patch: Patch): VirtualFile[]` — reconstructs the file by walking diff lines: keep `ctx`, keep `add`, drop `del`.
    - `revertPatch(files: VirtualFile[], patch: Patch): VirtualFile[]`
- [x] Failing test: applying `RATE_LIMIT_PATCH` to `src/server.ts` yields content containing `x-rate-limit` and no `−` lines.
- [x] Implement; wire `handlePatchDecision("applied")` → `setFiles(applyPatch(...))`; show toast-free inline confirm (patch card already shows status).
- [x] File viewer + sidebar read from `files` state. Build green. Commit.

### Task 1.2: Context budget + token meter

**Files:**
- Create: `src/lib/context.ts`, `src/lib/__tests__/context.test.ts`
- Modify: `src/App.tsx` (`handleSend` history building), `src/sections/ChatPanel.tsx` (composer footer shows `3.2k / 256k` bar)

- Interfaces:
  - Produces: `buildContext(msgs: Message[], system: string, budgetTokens: number): { role: string; content: string }[]` — greedy from newest, estimate tokens as `ceil(chars/4)`, reserve 25% of budget for output.
- [x] Failing tests: truncation drops oldest first; system message always retained; estimate monotonic in length.
- [x] Implement; replace `slice(-12)`; pass `model.contextK * 1000` as budget.
- [x] Composer: thin progress bar (`bg-secondary` track, `bg-primary` fill, red >85%). Build green. Commit.

### Task 1.3: Pricing robustness

**Files:** Modify `src/lib/nanogpt.ts` + `src/types/index.ts` (add `priceEstimated?: boolean`), ModelPanel label

- [x] Read `pricing.prompt`/`completion` when present; only fall back to heuristic otherwise, setting `priceEstimated: true`; render `~` prefix in ModelPanel for estimated prices.
- [x] Change label `$1.75/14 · 1M tok` → `$1.75 in · $14.00 out /1M`.
- [x] Unit-test `toPerMillion` boundary (0.01 exactly → treated as per-million). Commit.

## Phase 2 — Real agent loop in live mode · ~2–3 sessions (the flagship upgrade)

### Task 2.1: Patch extraction from live output

**Files:**
- Create: `src/lib/patchParse.ts`, `src/lib/__tests__/patchParse.test.ts`
- Modify: `src/App.tsx` live `onDone` handler

- Interfaces:
  - Produces: `extractPatch(markdown: string): Patch | null` — finds a fenced `diff`/`patch` block, parses `+`/`-`/` ` lines, reads target file from a leading `--- file: path` line or the fence info string.
- [x] Failing tests for: diff fence with file header; plain fence; no fence → null.
- [x] Update `AGENT_SYSTEM_PROMPT` to require: *"When changing code, emit one ```diff fence whose first line is `--- file: <path>`"*."
- [x] On live `onDone`, run `extractPatch`; if found attach to th…30823 tokens truncated…ls, milestones, hypotheses, and active modified workspace files.
 */

import { escapeXml, unescapeXml } from "../prompt/xmlFormatter";

export type MilestoneStatus = "pending" | "in_progress" | "completed" | "failed";

export interface Milestone {
  id: string;
  title: string;
  status: MilestoneStatus;
}

export interface Hypothesis {
  id: string;
  text: string;
  verified: boolean;
}

export type FileMutationStatus = "clean" | "dirty" | "deleted";

export interface ActiveFileState {
  path: string;
  status: FileMutationStatus;
}

export interface ScratchpadState {
  version: "1.0";
  goal: string;
  milestones: Milestone[];
  hypotheses: Hypothesis[];
  activeFiles: ActiveFileState[];
}

export function createEmptyScratchpad(goal = ""): ScratchpadState {
  return {
    version: "1.0",
    goal,
    milestones: [],
    hypotheses: [],
    activeFiles: [],
  };
}

export function serializeScratchpad(state: ScratchpadState): string {
  const milestonesXml = state.milestones
    .map(
      (m) =>
        `    <milestone id="${escapeXml(m.id)}" status="${escapeXml(m.status)}">${escapeXml(m.title)}</milestone>`
    )
    .join("\n");

  const hypothesesXml = state.hypotheses
    .map(
      (h) =>
        `    <hypothesis id="${escapeXml(h.id)}" verified="${h.verified ? "true" : "false"}">${escapeXml(h.text)}</hypothesis>`
    )
    .join("\n");

  const filesXml = state.activeFiles
    .map(
      (f) =>
        `    <file path="${escapeXml(f.path)}" status="${escapeXml(f.status)}" />`
    )
    .join("\n");

  return [
    `<scratchpad version="1.0">`,
    `  <goal>${escapeXml(state.goal)}</goal>`,
    `  <milestones>`,
    milestonesXml,
    `  </milestones>`,
    `  <hypotheses>`,
    hypothesesXml,
    `  </hypotheses>`,
    `  <active_files>`,
    filesXml,
    `  </active_files>`,
    `</scratchpad>`,
  ].join("\n");
}

export function parseScratchpad(xml: string): ScratchpadState | null {
  if (!xml || typeof xml !== "string") return null;

  const scratchpadMatch = xml.match(/<scratchpad(?:\s+version="([^"]*)")?>([\s\S]*?)<\/scratchpad>/i);
  if (!scratchpadMatch) return null;

  const body = scratchpadMatch[2];

  // Extract goal
  const goalMatch = body.match(/<goal>([\s\S]*?)<\/goal>/i);
  const goal = goalMatch ? unescapeXml(goalMatch[1].trim()) : "";

  // Extract milestones
  const milestones: Milestone[] = [];
  const milestoneRegex = /<milestone\s+id="([^"]*)"\s+status="([^"]*)">([\s\S]*?)<\/milestone>/gi;
  let mMatch: RegExpExecArray | null;
  while ((mMatch = milestoneRegex.exec(body)) !== null) {
    const status = mMatch[2].toLowerCase() as MilestoneStatus;
    milestones.push({
      id: unescapeXml(mMatch[1]),
      status: ["pending", "in_progress", "completed", "failed"].includes(status) ? status : "pending",
      title: unescapeXml(mMatch[3].trim()),
    });
  }

  // Extract hypotheses
  const hypotheses: Hypothesis[] = [];
  const hypothesisRegex = /<hypothesis\s+id="([^"]*)"\s+verified="([^"]*)">([\s\S]*?)<\/hypothesis>/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = hypothesisRegex.exec(body)) !== null) {
    hypotheses.push({
      id: unescapeXml(hMatch[1]),
      verified: hMatch[2].toLowerCase() === "true",
      text: unescapeXml(hMatch[3].trim()),
    });
  }

  // Extract active files
  const activeFiles: ActiveFileState[] = [];
  const fileRegex = /<file\s+path="([^"]*)"\s+status="([^"]*)"\s*\/>/gi;
  let fMatch: RegExpExecArray | null;
  while ((fMatch = fileRegex.exec(body)) !== null) {
    const status = fMatch[2].toLowerCase() as FileMutationStatus;
    activeFiles.push({
      path: unescapeXml(fMatch[1]),
      status: ["clean", "dirty", "deleted"].includes(status) ? status : "clean",
    });
  }

  return {
    version: "1.0",
    goal,
    milestones,
    hypotheses,
    activeFiles,
  };
}

export class Scratchpad {
  private _state: ScratchpadState;

  constructor(initialState?: ScratchpadState) {
    this._state = initialState ? { ...initialState } : createEmptyScratchpad();
  }

  static parse(xml: string): Scratchpad | null {
    const parsed = parseScratchpad(xml);
    return parsed ? new Scratchpad(parsed) : null;
  }

  get state(): ScratchpadState {
    return {
      ...this._state,
      milestones: [...this._state.milestones],
      hypotheses: [...this._state.hypotheses],
      activeFiles: [...this._state.activeFiles],
    };
  }

  setGoal(goal: string): void {
    this._state.goal = goal;
  }

  addMilestone(title: string, status: MilestoneStatus = "pending"): string {
    const id = `ms_${this._state.milestones.length + 1}`;
    this._state.milestones.push({ id, title, status });
    return id;
  }

  updateMilestone(id: string, status: MilestoneStatus): boolean {
    const ms = this._state.milestones.find((m) => m.id === id);
    if (ms) {
      ms.status = status;
      return true;
    }
    return false;
  }

  addHypothesis(text: string, verified = false): string {
    const id = `hyp_${this._state.hypotheses.length + 1}`;
    this._state.hypotheses.push({ id, text, verified });
    return id;
  }

  verifyHypothesis(id: string, verified: boolean): boolean {
    const h = this._state.hypotheses.find((hyp) => hyp.id === id);
    if (h) {
      h.verified = verified;
      return true;
    }
    return false;
  }

  trackFile(path: string, status: FileMutationStatus = "dirty"): void {
    const existing = this._state.activeFiles.find((f) => f.path === path);
    if (existing) {
      existing.status = status;
    } else {
      this._state.activeFiles.push({ path, status });
    }
  }

  serialize(): string {
    return serializeScratchpad(this._state);
  }
}
