# Seamless Local Directory Operation Plan

**Status:** Proposed  
**Target branch:** `gem`  
**Scope:** Windows-first standalone NanoForge, with portable host interfaces  
**Outcome:** A user can open, revisit, inspect, edit, and switch local project folders from NanoForge without typing paths, manually reconnecting, or losing chat state.

## 1. Current Baseline

NanoForge already has the hard parts of a safe local workspace foundation:

- a loopback-only privileged agent host;
- canonical workspace-root validation and broad-root rejection;
- traversal, symlink, junction, and sensitive-path defenses;
- typed workspace RPC for open, list, read, stat, search, Git status, watch, and reviewed write;
- generation checks that reject requests aimed at an old workspace;
- lazy directory expansion, file viewing, search, Git badges, and file watching;
- opt-in writes with SHA-256/mtime conflict detection and atomic replacement;
- launcher support for starting the host at `--workspace <path>`.

The user journey is not yet seamless:

- **Open Folder** uses `window.prompt` and requires a manually typed absolute path.
- Switching folders restarts the host and reloads the entire page.
- Recent folders are display-only recovery hints; clicking one does not reopen it.
- Browser persistence intentionally has no canonical path, but the launcher has no private workspace registry to resolve an opaque ID.
- Workspace switching does not expose a single coordinated lifecycle for terminals, watchers, memory, rules, daemons, and subagents.
- Explorer context-menu entries such as **Reveal in Explorer** are visible but not wired.
- Directory enumeration is unbounded and does not expose ignore preferences or very-large-folder states.

## 2. Product Contract

The finished default journey is:

1. The user clicks **Open Folder** or presses `Ctrl+O`.
2. NanoForge opens the native Windows folder picker.
3. The selected directory is validated before any active workspace changes.
4. NanoForge prepares a new workspace-scoped host, connects to it, and only then retires the old host.
5. The explorer shows the selected directory and project summary without a page reload.
6. Chats remain attached to their NanoForge workspace; terminal, Git, rules, memory, search, and agent tools all use the same canonical root and generation.
7. The folder appears under **Recent folders** and reopens with one click in later sessions.
8. Writes remain disabled by default and require the existing reviewed-write flow.

### UX principles

- Never ask a normal user to type an absolute path.
- Never show a connected/ready state until the replacement host and root are verified.
- Never switch only part of the runtime to a new root.
- Never persist canonical local paths in browser storage.
- Preserve chat state during folder changes, but cancel or explicitly resolve active local work.
- Every failure state must offer a direct recovery action.

## 3. Target Architecture

```text
React UI
  |  authenticated loopback HTTP: choose/open/recent/reveal
  v
Stable launcher workspace broker
  |-- native folder-picker adapter
  |-- private recent-workspace registry
  |-- host lifecycle manager (prepare -> health check -> activate -> retire)
  v
Workspace-scoped agent host
  |-- canonical WorkspaceContext + generation
  |-- filesystem / watcher / Git / terminal
  |-- rules / skills / memory / daemons / subagents
  v
Selected local directory
```

The static UI server and workspace broker remain stable. Agent hosts are replaceable, workspace-scoped processes. A switch uses prepare-before-retire semantics so a bad or inaccessible selection leaves the current workspace operational.

## 4. Module Plan

### Module A — Workspace Control Protocol

**Goal:** Define one typed contract for selection, activation, reconnection, recents, and recovery.

**Primary files**

- `packages/protocol/src/workspace.ts`
- `packages/protocol/src/workspace.test.ts`
- `src/lib/workspaceBrokerClient.ts` (new)
- `src/types/workspace.ts`

**Work**

1. Add browser-to-launcher schemas for:
   - `workspace.choose`: open the native picker and return a candidate descriptor;
   - `workspace.activate`: activate a selected candidate or known opaque workspace ID;
   - `workspace.current`: return the active descriptor and connection generation;
   - `workspace.recent.list`, `workspace.recent.remove`, and optional pin/unpin;
   - `workspace.reveal`: reveal a workspace-relative file in Windows Explorer;
   - `workspace.switch.status`: staged progress and typed recovery information.
2. Return opaque `workspaceId`, a display-safe label, capabilities, connection metadata, and generation. Do not return a canonical root to browser persistence.
3. Expand typed errors with actionable categories: picker cancelled, missing, access denied, moved, too broad, active work, host startup failed, reconnect failed, and registry corruption.
4. Include request IDs and idempotency keys so double clicks and retries cannot spawn duplicate hosts.
5. Keep existing host filesystem RPC generation-aware; every post-switch request must carry the newly activated generation.

**Acceptance**

- Every request and response is Zod-validated on both sides.
- A stale generation, unknown workspace ID, or replayed activation has deterministic behavior and tests.
- No raw filesystem path is written into `nanoforge.v1` browser storage.

### Module B — Native Folder Selection and Private Recent Registry

**Goal:** Replace path entry with a native picker and make recent workspaces genuinely reopenable.

**Primary files**

- `scripts/workspace-picker.cjs` (new)
- `scripts/workspace-registry.cjs` (new)
- `scripts/nanoforge-launcher.cjs`
- `scripts/__tests__/workspace-picker.test.ts` (new)
- `scripts/__tests__/workspace-registry.test.ts` (new)

**Work**

1. Introduce a `WorkspacePicker` interface and a Windows adapter that opens a native folder-selection dialog without blocking the UI server event loop.
2. Keep manual path entry only as an explicit developer/headless fallback, not the primary UI.
3. Store canonical paths privately under the local application-data directory in a versioned registry. The browser keeps only opaque IDs and display labels.
4. Registry fields: opaque stable ID, canonical path, display label, last-opened timestamp, pinned flag, last-known accessibility, and schema version.
5. Write the registry atomically with restrictive user-only permissions where supported. Recover from a truncated/corrupt file by quarantining it and starting an empty registry.
6. Revalidate and re-canonicalize every registry path at activation time. Never trust a previously saved path or ID mapping.
7. Deduplicate case-insensitively on Windows and resolve renamed/moved/unavailable entries into a recoverable UI state.

**Acceptance**

- Clicking **Open Folder** produces a native chooser; cancelling changes nothing.
- A selected folder appears in recents and reopens after a full app restart with one click.
- Browser storage inspection shows no canonical path.
- Home, drive, inaccessible, file, junction-escape, and missing targets are rejected for the correct semantic reason.

### Module C — Zero-Reload Host Handoff

**Goal:** Switch directories without refreshing the browser or exposing a partially switched runtime.

**Primary files**

- `scripts/nanoforge-launcher.cjs`
- `apps/agent-host/src/server.ts`
- `apps/agent-host/src/workspace/runtime.ts`
- `src/lib/hostSession.ts`
- `src/lib/hostClient.ts`

**Work**

1. Extract launcher host management into a `WorkspaceHostManager` with explicit states: `idle`, `preparing`, `ready`, `activating`, `active`, `retiring`, `failed`.
2. Prepare the replacement host on an ephemeral loopback port with a fresh single-use token and the selected canonical root.
3. Perform readiness checks that verify both `/health` and `workspace.describe`; HTTP 200 alone is insufficient.
4. Return fresh connection metadata to the UI, connect the new WebSocket, confirm its descriptor/generation, then atomically mark it active.
5. Stop the previous host only after the new session is confirmed. If preparation fails, retain the existing host and workspace unchanged.
6. Add `hostSession.switchWorkspace()` to quiesce old subscriptions, reject pending old-generation RPCs, connect the new client, refresh integrations, and resume watchers.
7. Rotate tokens on every handoff and redact them from logs, errors, analytics, and browser persistence.
8. Bound shutdown time for terminals, daemons, and child processes; report what was cancelled rather than silently abandoning work.

**Acceptance**

- A successful switch does not call `window.location.reload()`.
- A failed switch leaves the old explorer and host fully usable.
- Old watchers and WebSockets close exactly once; no listener or process leak remains after 20 switches.
- All workspace-scoped services report the same workspace ID and generation.

### Module D — Workspace Lifecycle Coordinator

**Goal:** Make directory switching safe and predictable across every local subsystem.

**Primary files**

- `apps/agent-host/src/workspace/context.ts` (new)
- `apps/agent-host/src/session.ts`
- `apps/agent-host/src/runs/coordinator.ts`
- `apps/agent-host/src/terminal/ptyManager.ts`
- `apps/agent-host/src/daemons/`
- `apps/agent-host/src/agents/`
- `apps/agent-host/src/rules/`
- `apps/agent-host/src/skills/`

**Work**

1. Create an immutable `WorkspaceContext` containing canonical root, opaque ID, generation, capabilities, policy, audit namespace, and cancellation scope.
2. Require filesystem, terminal, Git, watcher, memory, rules, skills, daemons, subagents, and run coordination to receive that context rather than independent root strings.
3. Add a switch preflight that inventories active runs, PTYs, daemons, pending approvals, and subagents.
4. UX policy:
   - no active work: switch immediately;
   - active foreground work: offer **Cancel work and switch** or **Stay here**;
   - background daemons: list what will stop;
   - unresolved write review: keep the review attached to the old workspace and invalidate it after switching.
5. Cancel old-context work through the existing coordinator, wait for bounded cleanup, and audit the transition.
6. Reject any event or tool result whose context ID/generation no longer matches the active workspace.

**Acceptance**

- A terminal can never retain the previous directory after the UI reports the new folder.
- Old subagent, watcher, or daemon events cannot appear in the new workspace.
- Switching during active work has an explicit, tested outcome with no implicit data loss.

### Module E — User-Facing Workspace Experience

**Goal:** Make local folders feel like a first-class product surface.

**Primary files**

- `src/components/layout/AppLayout.tsx`
- `src/sections/Sidebar.tsx`
- `src/sections/WorkspaceExplorer.tsx`
- `src/sections/ConnectDialog.tsx`
- `src/hooks/use-workspace.ts`
- `src/hooks/useSessionPersistence.ts`

**Work**

1. Replace `window.prompt` and `window.confirm` with accessible product dialogs.
2. Add entry points:
   - primary empty-state **Open Folder** button;
   - sidebar **Open Folder** button;
   - `Ctrl+O` shortcut with collision coverage;
   - command-palette action;
   - recent and pinned folders.
3. Show staged progress: **Choosing folder**, **Validating**, **Starting local tools**, **Connecting**, **Loading files**.
4. Preserve the current screen until activation succeeds, then transition explorer/chat chrome together.
5. Make recent items functional. Provide **Remove from recents**, **Pin**, and **Locate moved folder** actions.
6. Replace generic errors with targeted recovery:
   - offline -> **Restart local host**;
   - missing/moved -> **Locate folder**;
   - denied -> OS-permission guidance and **Try again**;
   - active work -> task inventory and explicit cancellation;
   - host failure -> **Retry** while keeping the old workspace.
7. Bind each NanoForge workspace’s chats to its opaque local workspace ID. Switching NanoForge workspaces should activate the corresponding local directory before marking it ready.
8. Make the active root unmistakable in the top bar and workspace settings using a display-safe breadcrumb and status badge.
9. Wire **Reveal in Explorer** through the launcher broker; remove any context-menu operation that remains nonfunctional.

**Acceptance**

- A first-time user can open a project without knowing its path syntax.
- A recent folder is one click from ready explorer state.
- Keyboard-only users can select, cancel, switch, and recover with focus restored correctly.
- UI never claims **Ready** while the host is offline, stale, or still rooted elsewhere.

### Module F — Directory and File Operations

**Goal:** Complete the expected local-directory workflow without weakening reviewed-write safety.

**Primary files**

- `packages/protocol/src/workspace.ts`
- `apps/agent-host/src/workspace/filesystem.ts`
- `apps/agent-host/src/policy/policy.ts`
- `src/sections/WorkspaceExplorer.tsx`
- `src/components/artifacts/MonacoDiffViewer.tsx`

**Work**

1. Add typed operations for create file, create folder, rename/move, duplicate, and trash.
2. Route mutations through centralized policy and visible review. New files/folders and renames need scoped confirmation; delete uses the OS recycle bin where possible and clearly reports recoverability.
3. Keep path confinement, sensitive-path filtering, atomicity, expected-version checks, and audit logging on every mutation.
4. Add conflict UI with **Reload**, **Compare**, and **Save as new file** choices.
5. Add safe handling for unsupported binary files, text encoding failures, read-only files, long Windows paths, locked files, and case-only renames.
6. Refresh only affected tree nodes and Git badges after a mutation instead of rebuilding the entire explorer.

**Acceptance**

- No UI control implies a file operation that is not wired.
- Delete is recoverable by default and always identifies the exact target.
- Concurrent external edits produce a visible conflict, never a silent overwrite.
- Junction and traversal attacks remain blocked for every new operation.

### Module G — Explorer Scale, Watching, and Project Awareness

**Goal:** Keep operation responsive on real repositories and explain what NanoForge is doing.

**Primary files**

- `apps/agent-host/src/workspace/filesystem.ts`
- `apps/agent-host/src/workspace/watcher.ts`
- `src/hooks/use-workspace.ts`
- `src/sections/WorkspaceExplorer.tsx`

**Work**

1. Add bounded/paginated directory listing with continuation tokens and a visible **Load more** state.
2. Centralize default ignores and merge `.gitignore` plus project-local `.nanoforgeignore`; expose a safe **Show ignored files** preference.
3. Coalesce watcher bursts, preserve expanded nodes, and refresh only changed branches.
4. Detect common project metadata (`package.json`, `pyproject.toml`, `Cargo.toml`, `.git`) and show a lightweight project summary; do not run install scripts automatically.
5. Add cancellable search, query IDs, result limits, file filters, and stale-result suppression on workspace switch.
6. Surface indexing/search limitations instead of presenting partial results as complete.

**Acceptance**

- A repository with 100,000 files reaches an interactive root view without loading the whole tree.
- Watch storms remain bounded and do not duplicate nodes or leak handlers.
- Search results from an old directory never render after a switch.

### Module H — Security, Audit, and Privacy

**Goal:** Preserve the local-first security boundary while reducing user friction.

**Primary files**

- `apps/agent-host/src/policy/policy.ts`
- `apps/agent-host/src/workspace/runtime.ts`
- `apps/agent-host/src/audit/`
- `scripts/nanoforge-launcher.cjs`
- `docs/architecture/02_SECURITY_AND_PERMISSIONS.md`

**Work**

1. Authenticate every broker endpoint with the launcher session token and enforce exact loopback origin/host checks.
2. Add CSRF protection, content-type/size limits, rate limits, and idempotency to state-changing broker calls.
3. Reuse canonical path and junction checks at selection, activation, reveal, and mutation boundaries.
4. Keep provider credentials, canonical recent paths, and capability tokens out of browser storage and UI logs.
5. Audit workspace selection, activation, failure, switch cancellation, reveal, and mutation with redaction.
6. Keep reviewed writes disabled at host startup unless explicitly enabled. The frontend toggle remains advisory; host capability is authoritative.
7. Threat-model malicious local webpages attempting loopback calls, registry tampering, token replay, stale workspace events, and hostile directory structures.

**Acceptance**

- Cross-origin webpages cannot choose, open, reveal, or mutate a folder.
- Tokens and canonical private paths do not appear in persisted browser state or redacted logs.
- Existing adversarial path-confinement tests continue to pass, with coverage for every new endpoint.

## 5. Delivery Milestones

| Milestone | Modules | User-visible result | Exit gate |
|---|---|---|---|
| **M1: Trustworthy control plane** | A, B, H | Native chooser and private functional recents behind tests | Protocol, registry, picker, auth, and path-adversarial tests pass |
| **M2: Seamless switching** | C, D | Folder changes without page reload or partial-root state | 20-switch stress test; failed handoff preserves old workspace |
| **M3: Finished core UX** | E | Open, recent, recovery, progress, keyboard, and reveal flows are fully wired | Component tests plus real UI-to-launcher-to-host journey |
| **M4: Complete directory operations** | F | Create, rename, move, duplicate, trash, and conflict recovery | Mutation security matrix and recycle/restore verification |
| **M5: Real-repository resilience** | G | Large folders, ignores, watcher bursts, and search stay responsive | 100k-file fixture, watch-storm test, stale-result test |
| **M6: Release proof** | All | Packaged Windows app performs the complete journey | Full gates, packaged `.exe` launch, native picker, visible window, and live folder smoke test |

## 6. Verification Strategy

### Automated gates per milestone

```powershell
cmd.exe /c pnpm typecheck
cmd.exe /c pnpm exec tsc -b
cmd.exe /c pnpm lint
cmd.exe /c pnpm test -- --run
cmd.exe /c pnpm test:protocol
cmd.exe /c pnpm test:host
cmd.exe /c pnpm test:sdk
cmd.exe /c pnpm test:e2e
cmd.exe /c pnpm build
```

Add focused suites for:

- picker cancel/success/error behavior through an injected adapter;
- corrupt registry recovery and atomic concurrent updates;
- broker authentication, CSRF, replay, and origin rejection;
- prepare/activate/retire success and rollback;
- repeated switch leak detection;
- active-run, PTY, daemon, subagent, and pending-write switch semantics;
- missing, moved, inaccessible, locked, and junction-backed folders;
- very large directories and watcher bursts;
- browser persistence privacy;
- reachability of every workspace action and shortcut collision checks.

### Mandatory live Windows journey

1. Build the current standalone artifact.
2. Launch it and confirm the visible NanoForge window/browser is focused.
3. Choose disposable Folder A through the native picker.
4. Read and search files, inspect Git state, reveal a file in Explorer, and approve one conflict-protected write.
5. Start a terminal/daemon, attempt a switch, and verify the active-work dialog names what will stop.
6. Switch to Folder B without a page reload; verify all workspace-scoped services report B.
7. Force a failed switch and prove Folder B remains usable.
8. Restart NanoForge and reopen Folder A from recents with one click.
9. Inspect browser storage and logs for raw paths, tokens, and secrets.
10. Record artifact path, size, launch command, companion files, process/window proof, and endpoint results.

## 7. Implementation Order and Dependencies

```text
A Protocol
  -> B Picker + Registry
  -> C Host Handoff
       -> D Lifecycle Coordinator
       -> E Workspace UX
            -> F File Operations
            -> G Scale + Awareness
All modules -> H security review -> M6 release proof
```

Start with A and B because functional recents require a private ID-to-path authority. Do C before polishing E: otherwise the UI would be built around the current reload behavior and need rework. F and G can proceed after the lifecycle contract is stable.

## 8. Explicit Non-Goals

- Granting unrestricted filesystem access outside the active root.
- Persisting provider secrets or canonical recent paths in browser local storage.
- Enabling writes automatically when a folder is selected.
- Automatically installing dependencies or running project scripts on open.
- Treating the browser File System Access API as the privileged workspace authority; it does not provide a reliable canonical-path contract for the host.
- Supporting multiple simultaneously active roots in the first release. Recent workspaces are quick switches, not concurrently mounted roots.

## 9. Definition of Done

This initiative is complete only when a fresh packaged Windows build proves the complete native-picker-to-local-file journey. Unit/typecheck success or a host health response alone is not sufficient. Every visible workspace control must be wired, switching must be atomic and rollback-safe, recent folders must reopen after restart, and all filesystem side effects must remain confined, reviewed, auditable, and generation-correct.
