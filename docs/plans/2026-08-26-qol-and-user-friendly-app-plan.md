# NanoForge QoL and User-Friendly App Plan

**Status:** Proposed
**Target branch:** `gem`
**Scope:** Text-first NanoForge desktop/local-launcher experience
**Outcome:** A new user can understand the app, select a safe local project, recover from interruptions, follow agent work, and complete common tasks without needing host ports, tokens, paths, or internal terminology.

## Product principles

1. Show a clear next action, never an implementation detail, at every empty or failed state.
2. Treat the local host as infrastructure: reconnect and hand off fresh credentials through the launcher rather than asking a user to repair URLs or tokens.
3. Keep local workspace access explicit, least-privilege, and visible.
4. Make long-running agent work observable and interruptible.
5. Do not ship controls that look real but only simulate persistence or execution.
6. Preserve context across recoverable failures: chat, selected file, expanded folders, and pending drafts should survive whenever safe.

## Current constraints to design around

- The privileged boundary lives in `apps/agent-host`; `src/` remains an unprivileged browser UI.
- Local directories are selected through the NanoForge launcher and must keep canonical paths and host tokens out of browser persistence.
- Workspace changes are generation-aware and reviewed writes stay opt-in.
- The current UI includes real local-host and workspace capability, but some broader product surfaces are incomplete or simulated; UX copy must reveal that honestly until they are connected.

## Module 1 — First-run onboarding and actionable empty states

**Goal:** Make the first useful action obvious in under one minute.

**Primary areas**

- `src/components/layout/AppLayout.tsx`
- `src/sections/Sidebar.tsx`
- `src/sections/ConnectDialog.tsx`
- `src/hooks/useSessionPersistence.ts`

**Work**

1. Introduce a concise first-run card with two primary choices: **Open local folder** and **Use a guided demo**.
2. Explain in plain language what local folder access enables, what remains read-only by default, and when an approval will be requested.
3. Replace raw host/socket/token wording with user-safe status labels: **Starting local tools**, **Reconnect local runtime**, **Folder needs attention**, and **Ready**.
4. Add contextual empty states for no workspace, no chats, no files, no model key, no recent folders, and disconnected host.
5. Restore focus after dialogs and preserve unsent draft text during onboarding/reconnection.

**Acceptance**

- A new user can open a folder or begin a guided demo without reading documentation.
- No visible error exposes WebSocket codes, tokens, host ports, or canonical paths.
- Keyboard navigation, Escape cancellation, and focus restoration have component coverage.

## Module 2 — Reliable local-runtime recovery

**Goal:** Make local host recovery automatic and comprehensible.

**Primary areas**

- `scripts/nanoforge-launcher.cjs`
- `scripts/workspace-registry.cjs`
- `apps/agent-host/src/server.ts`
- `src/lib/hostSession.ts`
- `src/lib/workspaceBrokerClient.ts`

**Work**

1. Move bootstrap connection metadata out of a persistent URL and into a short-lived launcher handoff endpoint.
2. Implement one recovery operation: request fresh connection metadata, reconnect, verify `workspace.describe`, then refresh the UI session.
3. Add a broker-visible runtime state machine: `starting`, `healthy`, `reconnecting`, `switching`, `ready`, `needs_attention`, and `unavailable`.
4. Detect launcher/UI origin mismatch before opening a socket and provide a launcher-side diagnostic rather than a generic authorization failure.
5. Retry transient startup failures with bounded backoff; never retry permission, missing-folder, or malformed-request failures blindly.
6. Retain the last functioning workspace during failed replacement-host preparation and show a direct recovery choice.

**Acceptance**

- A token expires or a host restarts without requiring the user to edit/reload an authenticated URL.
- A reconnect proves WebSocket readiness and the correct workspace generation, not just `/health`.
- Restart/reconnect loops are bounded and logged without secrets.

## Module 3 — Friendly workspace and folder workflow

**Goal:** Make local project switching feel deliberate, safe, and fast.

**Primary areas**

- `src/sections/Sidebar.tsx`
- `src/sections/WorkspaceExplorer.tsx`
- `src/hooks/useWorkspaceBroker.ts`
- `scripts/workspace-picker.cjs`
- `scripts/workspace-registry.cjs`

**Work**

1. Consolidate folder controls into a workspace switcher with active-folder name, readiness badge, recents, pins, remove-from-recents, and locate-moved-folder recovery.
2. Add staged progress copy: **Choosing folder → Validating → Starting local tools → Loading files**.
3. Add a workspace summary after activation: project type, Git availability, file count/loading state, and current write capability.
4. Provide reliable `Ctrl+O` and command-palette access, with shortcut collision tests.
5. Preserve selected file, explorer expansion, search query, and chat state per opaque workspace ID.
6. When active agent work, a terminal, or a daemon exists, present an inventory and explicit switch choices rather than silently terminating work.

**Acceptance**

- Recent folders reopen in one click after restart and always revalidate before activation.
- A failed/missing folder leaves the active workspace unchanged.
- The UI never reports readiness before the host and descriptor agree on the same workspace generation.

## Module 4 — Agent work clarity and safe interruption

**Goal:** Make agent behavior legible instead of theatrical.

**Primary areas**

- `src/sections/TaskTimeline.tsx`
- `src/components/artifacts/`
- `apps/agent-host/src/runs/coordinator.ts`
- `apps/agent-host/src/session.ts`
- `packages/protocol/src/`

**Work**

1. Standardize a compact run card: current objective, current step, files/tools touched, elapsed time, approval state, and safe cancel/pause/resume actions.
2. Make tool output collapsible with clear stdout/stderr/error treatment and copy support.
3. Show an explicit pre-write diff/review surface including target path, changed lines, conflict state, and rollback/reload choices.
4. Use predictable run outcomes: completed, cancelled, blocked awaiting approval, blocked by local runtime, and failed with recovery guidance.
5. Label demo, simulated, preview, and live/provider-backed workflows consistently; remove actions that cannot yet perform their advertised work.
6. Persist a bounded, redacted local activity history per workspace so users can answer “what happened?” after a reconnect.

**Acceptance**

- A user can stop or approve a run without searching through a transcript.
- Each visible run state maps to an actual host state and protocol event.
- No local write occurs without the existing host-side reviewed-write authorization.

## Module 5 — File explorer productivity and graceful scale

**Goal:** Improve everyday project browsing without compromising path safety.

**Primary areas**

- `src/sections/WorkspaceExplorer.tsx`
- `apps/agent-host/src/workspace/filesystem.ts`
- `apps/agent-host/src/workspace/watcher.ts`
- `packages/protocol/src/workspace.ts`

**Work**

1. Add fast file/folder filtering, recent files, breadcrumbs, refresh, Git badges, and an explicit ignored-files preference.
2. Paginate large directory listings, coalesce watcher bursts, and retain expanded folders through refreshes.
3. Improve preview states for binary, oversized, locked, encoding-failed, and externally modified files.
4. Wire only safe, complete context actions: reveal in Explorer, copy relative path, copy absolute path only behind explicit confirmation, and reviewed file operations once implemented.
5. Add conflict handling with **Reload**, **Compare**, and **Save as new file** rather than accidental overwrites.
6. Surface indexing/search bounds so incomplete results cannot be mistaken for complete ones.

**Acceptance**

- A large repository remains interactive without rendering every file at once.
- Old-workspace watcher/search events cannot appear after a switch.
- Every context-menu action has a real host-backed implementation or is absent.

## Module 6 — Preferences, accessibility, and visual calm

**Goal:** Let users adapt the app without overwhelming them.

**Primary areas**

- `src/sections/Settings.tsx`
- `src/components/layout/`
- `src/styles/`
- `src/hooks/`

**Work**

1. Group preferences into Appearance, Accessibility, Local workspace, Provider, and Advanced; hide advanced controls until requested.
2. Add density, reduced-motion, high-contrast, font-size, and keyboard-shortcut preferences.
3. Ensure consistent status color/shape/text combinations; no state relies on color alone.
4. Add responsive layout rules for narrow windows and a stable minimum useful width.
5. Use confirmation dialogs for destructive/local-impact actions with exact targets and recovery information.
6. Persist only non-sensitive UI preferences; keep paths, host tokens, and provider secrets out of browser storage.

**Acceptance**

- Core flows pass keyboard-only and screen-reader smoke checks.
- A narrow desktop window retains a usable chat, workspace switcher, and primary action.
- Settings do not imply that a browser-side toggle can override host authority.

## Module 7 — Trust, privacy, and product truthfulness

**Goal:** Reduce uncertainty without making unsupported claims.

**Primary areas**

- `apps/agent-host/src/policy/`
- `apps/agent-host/src/audit/`
- `src/sections/Settings.tsx`
- `docs/architecture/`

**Work**

1. Add a human-readable local-access panel: selected folder label, read/write capability, recent host health, and audit summary.
2. Provide clear privacy wording: folders stay local; only configured provider requests leave the machine; writes require review unless explicitly enabled.
3. Keep provider credentials host-owned where possible and redact error/log surfaces.
4. Add product-level capability flags so incomplete features are either hidden or marked preview, never presented as completed functionality.
5. Maintain a release checklist that distinguishes UI demo evidence, connected local-host evidence, and packaged-app proof.

**Acceptance**

- A user can tell what the app can access and why, without seeing a raw path or secret.
- Capability copy follows actual runtime checks, not static marketing text.
- Security and release limitations remain visible to maintainers before shipping.

## Delivery sequence

| Phase | Modules | User-visible result | Exit gate |
|---|---|---|---|
| 1. Recovery foundation | 2, 7 | Reconnect works without URL/token repair; truthful status states | broker/host auth tests and live reconnect journey |
| 2. Friendly entry | 1, 3 | Clear onboarding, local folder flow, functioning recents | keyboard/UI tests and native-picker journey |
| 3. Understandable work | 4 | Observable agent runs, approvals, and outcomes | protocol-to-UI run-state tests |
| 4. Daily productivity | 5, 6 | Calm responsive explorer and accessible settings | large-folder, watcher, responsive, a11y checks |
| 5. Release proof | All | Packaged app completes the full local workflow | executable launch and end-to-end Windows smoke test |

## Cross-module verification

Run these before declaring a phase complete:

```powershell
cmd.exe /c pnpm typecheck
cmd.exe /c pnpm lint
cmd.exe /c pnpm test -- --run
cmd.exe /c pnpm build
cmd.exe /c pnpm package
```

Mandatory live journey:

1. Launch the packaged app and select a local folder through the native picker.
2. Reopen it from Recents, then simulate a host restart/token expiry and use the in-app recovery action.
3. Browse, search, inspect Git state, and open a file in a sizeable repository.
4. Start a controlled agent task, inspect its work, pause/cancel it, and complete one reviewed write where enabled.
5. Switch to another folder while work is active, verify the explicit lifecycle choice, and prove no old-folder event appears.
6. Inspect persisted browser data and logs for absence of canonical paths, tokens, and secrets.

## Definition of done

QoL work is complete when a fresh user can get from launch to a ready local project, recover from a local-host interruption, understand agent activity, and use core project navigation with only product language and visible recovery actions. A passing health endpoint or an attractive static UI alone is not sufficient proof.
