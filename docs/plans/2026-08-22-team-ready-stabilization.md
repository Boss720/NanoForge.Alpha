# NanoForge Team-Ready Stabilization Implementation Plan

**Goal:** Remove the Voice Call feature and turn NanoForge into a reproducible, secure, usable NanoGPT companion-app demo that the NanoGPT team can evaluate without setup guesswork.

**Architecture:** Keep the React control plane in `src/`, the privileged Fastify/WebSocket agent host in `apps/agent-host/`, and shared schemas/agent logic in `packages/`. Remove voice vertically across those layers, then stabilize the existing text-agent path before improving onboarding or release presentation.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Fastify 5, WebSocket, Zod, Vitest, pnpm/Turborepo, Node SEA Windows packaging.

**Estimated Time:** 24 tasks x 5 minutes = approximately 120 minutes, plus manual NanoGPT and Windows smoke testing.

---

## Prerequisites

- [ ] Work from `C:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge`.
- [ ] Preserve the current dirty worktree; do not reset unrelated changes.
- [ ] Free at least 2 GB of disk space for dependencies, builds, and release archives.
- [ ] Use Node.js 20+ and pnpm 9.15.4.
- [ ] Keep a NanoGPT API key outside source control for the final live test.

## Acceptance criteria

- [ ] No visible Voice Call button, drawer, hook, service, host manager, wire schema, or dedicated voice test remains.
- [ ] Text chat, model catalog, routing, workspace, terminal, approvals, artifacts, subagents, memory, tasks, and MCP still compile.
- [ ] `pnpm install --frozen-lockfile`, lint, typecheck, tests, and build pass from a clean checkout.
- [ ] Workspace confinement rejects symlink escapes.
- [ ] NanoGPT credentials do not persist in browser local storage.
- [ ] One version is used by package metadata, UI, release README, executable, and zip.
- [ ] A fresh Windows bundle launches both loopback services and completes a real NanoGPT chat request.
- [ ] README, demo script, limitations, and collaboration proposal are accurate.

---

## Phase 1 - Remove Voice Call vertically

### Task 1: Add a UI regression test for the removed surface

**Files:**
- Modify: `src/sections/__tests__/App.hostWiring.test.tsx`
- Test: `src/sections/__tests__/App.hostWiring.test.tsx`

**Step 1: Add the expectation**

```tsx
expect(screen.queryByRole("button", { name: /voice call/i })).not.toBeInTheDocument();
expect(screen.queryByText(/start voice call/i)).not.toBeInTheDocument();
```

**Step 2: Run the focused test**

```powershell
cmd.exe /c npm test -- src/sections/__tests__/App.hostWiring.test.tsx
```

Expected before removal: failure because the Voice Call entry point is present.

**Step 3: Commit after Task 4 passes**

```powershell
git add src/sections/__tests__/App.hostWiring.test.tsx src/App.tsx src/sections/TopBar.tsx
git commit -m "refactor(ui): remove voice call surface"
```

### Task 2: Remove Voice Call state and imports from the application shell

**Files:**
- Modify: `src/App.tsx`

**Step 1: Delete the Voice Call imports**

Remove imports of `VoiceCallDrawer`, `useVoiceCall`, and voice-only protocol types.

**Step 2: Delete voice state and handlers**

Remove `voiceOpen`, `voiceCall`, call start/end/mute/speaker handlers, and the rendered drawer.

**Step 3: Keep existing host-session ownership unchanged**

The application must continue to create and pass the same `HostSession` used by text chat, workspace, terminal, tasks, and subagents.

### Task 3: Remove the Voice Call navigation/control entry point

**Files:**
- Modify: `src/sections/TopBar.tsx`
- Modify any component found by: `rg -n "VoiceCall|voice call|PhoneCall|Mic" src`

**Step 1: Delete the button and voice-only props**

Do not replace the button with a disabled or placeholder control.

**Step 2: Typecheck the frontend**

```powershell
cmd.exe /c node_modules\.bin\tsc -p tsconfig.app.json --noEmit
```

Expected: exit code 0.

### Task 4: Delete dedicated browser voice implementation

**Files:**
- Delete: `src/hooks/useVoiceCall.ts`
- Delete: `src/hooks/__tests__/useVoiceCall.test.tsx`
- Delete: `src/hooks/__tests__/useVoiceCall.adversarial.test.tsx`
- Delete: `src/components/voice/`
- Delete: `src/services/audioEngine.ts`
- Delete: `src/services/speechRecognition.ts`
- Delete: `src/services/speechSynthesis.ts`
- Delete: `src/services/__tests__/audioEngine.test.ts`
- Delete: `src/services/__tests__/speechRecognition.test.ts`
- Delete: `src/services/__tests__/speechSynthesis.test.ts`
- Delete: `src/test/audioMocks.ts`
- Delete: `tests/e2e/voice/`

**Step 1: Delete only the listed voice-owned files**

**Step 2: Prove there are no browser imports**

```powershell
rg -n -i "useVoiceCall|VoiceCall|speechRecognition|speechSynthesis|audioEngine" src tests
```

Expected: no production matches.

### Task 5: Add a host protocol rejection test

**Files:**
- Modify: `apps/agent-host/src/server.test.ts`

**Step 1: Add a rejected legacy-message test**

```ts
it("rejects removed voice messages", async () => {
  socket.send(JSON.stringify({ type: "voice.session.start", profileId: "default" }));
  await expectSocketClose(socket, 4400);
});
```

**Step 2: Run it before protocol removal**

```powershell
cmd.exe /c npm run test:host -- server.test.ts
```

Expected before removal: the message may parse; after removal it closes with 4400.

### Task 6: Remove host voice runtime ownership

**Files:**
- Modify: `apps/agent-host/src/session.ts`
- Modify: `apps/agent-host/src/protocol.ts`
- Delete: `apps/agent-host/src/voice/`
- Delete: `apps/agent-host/test/voice/`

**Step 1: Remove `VoiceSessionManager` construction and options**

**Step 2: Remove all `voice.*` dispatch branches and message unions**

**Step 3: Run host verification**

```powershell
cmd.exe /c npm run typecheck:host
cmd.exe /c npm run test:host
```

Expected: both exit 0.

### Task 7: Remove shared voice wire contracts

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Delete: `packages/protocol/src/voice.ts`
- Delete: `packages/protocol/src/voice.test.ts`

**Step 1: Remove voice exports**

Delete `export * from "./voice"` and any direct voice schema imports.

**Step 2: Run protocol verification**

```powershell
cmd.exe /c npm run typecheck:protocol
cmd.exe /c npm run test:protocol
```

Expected: both exit 0.

### Task 8: Remove voice claims from documentation and metadata

**Files:**
- Modify: `PROJECT.md`
- Modify: `docs/architecture/01_TARGET_ARCHITECTURE.md`
- Modify: `docs/architecture/03_ROADMAP_AND_OPERATIONS.md`
- Modify: `apps/agent-host/package.json`

**Step 1: Describe voice as explicitly out of scope**

Use this wording:

```markdown
Voice interaction is intentionally out of scope for NanoForge's current product direction. The supported interaction model is text chat plus explicit tool approvals.
```

**Step 2: Confirm removal**

```powershell
rg -n -i "voice call|voice copilot|voice manager|ambient voice" src apps packages tests README.md PROJECT.md docs
```

Expected: only the explicit out-of-scope roadmap note remains.

**Step 3: Commit**

```powershell
git add src apps/agent-host packages/protocol tests PROJECT.md docs/architecture
git commit -m "refactor: remove voice call feature"
```

---

## Phase 2 - Restore a trustworthy development baseline

### Task 9: Make pnpm the single package-manager path

**Files:**
- Modify: `README.md`
- Verify: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`

**Step 1: Install exactly from the lockfile**

```powershell
cmd.exe /c pnpm install --frozen-lockfile
```

Expected: `node_modules/.bin/turbo.cmd` exists.

**Step 2: Document pnpm commands only**

Do not present npm and pnpm as interchangeable in the contributor path.

### Task 10: Exclude generated and agent metadata from lint

**Files:**
- Modify: `eslint.config.js`

**Step 1: Extend global ignores**

```js
globalIgnores([
  "**/dist/**",
  "**/.agents/**",
  "release/**",
  ".turbo/**",
  "coverage/**",
])
```

**Step 2: Run lint**

```powershell
cmd.exe /c pnpm lint
```

Expected: remaining failures point only to owned source/test code.

### Task 11: Repair core test fixture type drift

**Files:**
- Modify: `packages/core/src/__tests__/coverage_deep.test.ts`
- Modify: `packages/core/src/__tests__/toolRegistry.test.ts`
- Modify: `packages/core/src/__tests__/mocks/mockFetch.ts`

**Step 1: Add required proposal fields**

```ts
checkpointRequired: false,
```

**Step 2: Add complete token totals**

```ts
usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
```

**Step 3: Narrow approval-result assertions**

```ts
if (decision.verdict === "PROMPT_USER") {
  expect(decision.promptMessage).toBeTruthy();
} else {
  expect(decision.reason).toBeTruthy();
}
```

**Step 4: Verify**

```powershell
cmd.exe /c npm run typecheck:core
cmd.exe /c npm run test:core
```

Expected: both exit 0.

### Task 12: Restore the full quality gate

**Files:**
- Verify: `package.json`, `turbo.json`

**Step 1: Run every gate**

```powershell
cmd.exe /c pnpm lint
cmd.exe /c pnpm typecheck
cmd.exe /c pnpm test:all
cmd.exe /c pnpm build
```

Expected: every command exits 0 with no skipped package caused by missing tooling.

**Step 2: Commit**

```powershell
git add eslint.config.js packages/core README.md pnpm-lock.yaml
git commit -m "chore: restore deterministic quality gates"
```

---

## Phase 3 - Close release-blocking security gaps

### Task 13: Add failing symlink-escape tests

**Files:**
- Modify: `apps/agent-host/src/workspace/filesystem.test.ts`
- Modify: `apps/agent-host/src/policy/sandboxing.test.ts`

**Step 1: Create a workspace symlink to an external temporary directory**

**Step 2: Assert read, stat, directory listing, and write reject it**

```ts
await expect(handleReadFile(workspace, "escape/secret.txt"))
  .rejects.toThrow(/outside workspace|symlink/i);
```

**Step 3: Run and observe failure**

```powershell
cmd.exe /c npm run test:host -- filesystem.test.ts sandboxing.test.ts
```

### Task 14: Canonicalize workspace filesystem access

**Files:**
- Modify: `apps/agent-host/src/workspace/filesystem.ts`
- Modify: `apps/agent-host/src/policy/policy.ts`

**Step 1: Resolve real paths for reads**

```ts
const canonicalRoot = await fs.realpath(workspaceRoot);
const canonicalTarget = await fs.realpath(candidate);
if (!isWithinWorkspace(canonicalTarget, canonicalRoot)) {
  throw new Error("Path is outside workspace through a symlink");
}
```

**Step 2: For writes, canonicalize the nearest existing parent before creating the file**

**Step 3: Run the tests from Task 13**

Expected: pass.

### Task 15: Move NanoGPT credential ownership to the host

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/sections/ConnectDialog.tsx`
- Modify: `src/lib/hostSession.ts`
- Modify: `apps/agent-host/src/session.ts`

**Step 1: Add a test proving persisted state contains no `apiKey`**

```ts
expect(JSON.stringify(storage.getItem("nanoforge.v1"))).not.toContain("sk-");
```

**Step 2: Remove `apiKey` from browser-persisted connection state**

**Step 3: Send an opaque provider configuration reference to the host**

**Step 4: Resolve the actual key only inside the host process**

**Step 5: Verify UI and host tests**

### Task 16: Run the security regression suite

**Files:**
- Verify: `apps/agent-host/src/**/*.test.ts`

```powershell
cmd.exe /c npm run test:host
cmd.exe /c npm run typecheck:host
```

Expected: all tests pass and no key value appears in logs, URLs, audit records, or browser storage.

**Commit:**

```powershell
git add src apps/agent-host
git commit -m "fix(security): confine filesystem and isolate provider secrets"
```

---

## Phase 4 - Make the core workflow usable

### Task 17: Define one supported golden path

**Files:**
- Create: `docs/GOLDEN_PATH.md`
- Modify: `src/sections/ChatComposer.tsx`

Document exactly:

```text
Open workspace -> connect NanoGPT -> select model -> submit coding task -> review plan -> approve tool -> review artifact/diff -> export result
```

Remove or hide any control that is not required for this path and is not wired to live host behavior.

### Task 18: Replace remaining workspace demo data

**Files:**
- Modify: `src/hooks/use-workspace.ts`
- Modify: `src/sections/WorkspaceExplorer.tsx`
- Modify: `src/hooks/use-task-timeline.ts`
- Modify: `src/sections/TaskTimeline.tsx`

**Step 1: Add tests using a mocked `HostClient`**

**Step 2: Use `readDir`, `search`, `gitStatus`, and run events as the only data source**

**Step 3: Show an honest disconnected/empty state when the host is absent**

### Task 19: Add a first-run readiness screen

**Files:**
- Create: `src/sections/ReadinessChecklist.tsx`
- Create: `src/sections/__tests__/ReadinessChecklist.test.tsx`
- Modify: `src/App.tsx`

Show four checks: local host, writable workspace choice, NanoGPT provider, and selected model. The main task composer becomes active only when required checks pass.

### Task 20: Add one real NanoGPT contract smoke test

**Files:**
- Create: `scripts/smoke-nanogpt.mjs`
- Modify: `package.json`

The script must read the key from `NANOFORGE_PROVIDER_API_KEY`, call `/models`, then make a minimal `/chat/completions` request. It must never print the key.

```json
"smoke:nanogpt": "node scripts/smoke-nanogpt.mjs"
```

Expected: authenticated model response and one minimal assistant completion.

---

## Phase 5 - Make the repository and demo presentable

### Task 21: Replace the Vite template README

**Files:**
- Rewrite: `README.md`

Required sections: product statement, screenshot, supported golden path, architecture, NanoGPT integration, security boundaries, installation, development, verification, limitations, roadmap, and collaboration proposal.

Do not claim native desktop packaging, symlink defense, secret isolation, or live features unless verified in the same revision.

### Task 22: Unify version metadata

**Files:**
- Modify: `package.json`
- Modify: `scripts/package-release.js`
- Modify: `release/README.txt` through the generator only

Use one version source:

```js
const version = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8")).version;
```

Remove hard-coded `0.6.0` defaults and generate the archive name from this value.

### Task 23: Build and smoke-test a fresh Windows release

**Files:**
- Verify: `scripts/build-exe.js`
- Verify: `scripts/package-release.js`
- Output: `release/NanoForge.exe`
- Output: `release/NanoForge-v<version>-windows-x64.zip`

```powershell
cmd.exe /c pnpm build
cmd.exe /c npm run build:exe
cmd.exe /c npm run package -- --version <version>
```

Launch the exact new executable and verify:

- `127.0.0.1:4173` returns HTTP 200 and the built HTML.
- `127.0.0.1:4174/health` returns the expected host version.
- A WebSocket token works once and fails on reuse.
- One NanoGPT chat completes through the shipped UI.
- Voice Call is absent.

### Task 24: Record the team-facing demo

**Files:**
- Create: `docs/DEMO_SCRIPT.md`
- Create: `docs/TECHNICAL_OVERVIEW.md`
- Create: `docs/KNOWN_LIMITATIONS.md`

The 90-120 second demo should show only the golden path. End with this collaboration request:

```text
We would like to make NanoGPT a first-class provider in NanoForge and collaborate on the model catalog, authentication contract, cost metadata, and a supported companion-app workflow.
```

**Final verification:**

```powershell
cmd.exe /c pnpm lint
cmd.exe /c pnpm typecheck
cmd.exe /c pnpm test:all
cmd.exe /c pnpm build
git status --short
```

Expected: all gates pass; only intentional source, documentation, and freshly generated release changes remain.

---

## Execution order

Execute sequentially: Voice removal -> deterministic gates -> security -> golden path -> documentation -> fresh release -> demo. Do not begin presentation polish while build, security, or release provenance remains red.
