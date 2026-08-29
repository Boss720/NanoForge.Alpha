# NanoForge Hardening & Production Readiness Progress Tracking (Phases 0–7)

## CI failure investigation — 2026-08-28

The latest GitHub Verify retry reached the runner and failed only in the concurrent plan-submit adversarial test (`0/50` acknowledgements; `host.ready` only). The current wave had two read-only review lanes: coordinator/message-dispatch analysis and CI/test-environment analysis; both were blocked by the host usage limit. Root reproduced the failure mechanism by tracing inline coordinator startup and changed valid runs to begin on the next event-loop check phase, allowing the session to send each correlated acknowledgement before synchronous run work.

Fresh verification after the fix: the host suite passed **57 files / 803 tests** when run through the root Vitest configuration with only `apps/agent-host/src/**/*.test.ts` included; the original root suite passed **85 files / 774 tests**; `cmd.exe /c pnpm typecheck` passed **6/6 tasks**; `cmd.exe /c pnpm lint` passed; and `cmd.exe /c pnpm build` passed. The package-scoped Vitest command remains blocked in this managed shell by esbuild's denied access to the repository config path.

## Active Initiative: P0.1 Host Capability Broker

**Status:** IN PROGRESS — Wave 0 baseline and broker seam
**Plan:** `docs/plans/2026-08-27-nanogpt-ecosystem-alignment-plan.md` (P0.1 / section 4.4)
**Objective:** Establish one fail-closed, auditable authorization seam for host-privileged actions. This wave deliberately begins with the broker contract, grant binding, and the direct PTY bypass; browser, MCP, workspace-write, and daemon routes follow after the seam is integrated.

| Lane | Owner | Exclusive files | Intended proof |
| :--- | :--- | :--- | :--- |
| A — Broker core | capability worker | `apps/agent-host/src/capabilities/**` | Broker unit/adversarial tests and host typecheck |
| B — Protocol grant contract | protocol worker | `apps/agent-host/src/protocol.ts`, `apps/agent-host/src/protocol.capabilities.test.ts` | Schema tests and host typecheck |
| C — PTY bypass closure | terminal worker | `apps/agent-host/src/session.ts`, `apps/agent-host/src/session.terminal-capability.test.ts` | Crafted `terminal.create` denied without a broker-backed user grant |
| D — Integration and verification | root | `PROGRESS.md`, integration-only follow-up files | Combined diff review, full host/root gates |

**Wave 0 acceptance:** A grant is bound to host/session/workspace generation/run-step/normalized argument digest and expiry; direct terminal creation fails closed; broker decisions are audit-ready. Re-enabling a user-owned interactive terminal requires a separately designed, visible broker-mediated grant and is not implemented in this wave. Existing uncommitted workspace/QoL work is user-owned and out of scope.

**Baseline note:** The checkout is on `gem` with pre-existing uncommitted workspace/QoL changes. P0.1 work will be isolated to the allowlists above and no existing changes will be discarded.

**Wave 0 result (2026-08-27):**

- Added a fail-closed `CapabilityBroker` with opaque random tokens retained only as SHA-256 hashes, strict binding checks, expiry, revoke, and single/multi-use enforcement. Its injected audit records include binding metadata and a token hash, never the raw grant token.
- Added strict protocol schemas for capability approval requests, decisions, grants, and results. The wire contract contains opaque bindings and an arguments digest, not a canonical path, secret, executable, or raw argument payload.
- Closed the direct WebSocket PTY creation bypass: `terminal.create` now returns `terminal_interactive_denied` without allocating a PTY. Structured `RunCoordinator` execution is unchanged.
- Independent focused proof: `pnpm typecheck:host` passed; direct Vitest invocation passed **3 files / 11 tests**. Full `pnpm lint` and `pnpm typecheck` passed (**6/6 Turbo tasks**, host task cache miss). Scoped `git diff --check` passed.
- A package-script host-suite invocation incorrectly forwarded focused file arguments and ran the entire host suite, which reported **52 files / 764 tests passed** but emitted an unrelated worker-exit warning. It is not counted as a clean whole-suite gate; the direct focused invocation is the accepted proof for this incremental wave.
- Next ownership: wire the broker into workspace write, browser, MCP, daemon/scheduler, subagent mutation, and the future visible interactive-terminal grant flow; add end-to-end adversarial frame tests per privileged kind.

**Wave 1 — brokerable privileged-operation seams (IN PROGRESS):**

| Lane | Owner | Exclusive files | Intended proof |
| :--- | :--- | :--- | :--- |
| A — Reviewed workspace writes | workspace worker | `apps/agent-host/src/workspace/filesystem.ts`, `apps/agent-host/src/workspace/filesystem.test.ts` | Mutating writes require an injected broker-compatible authorization seam |
| B — Daemon and schedule mutation | daemon worker | `apps/agent-host/src/daemons/manager.ts`, `apps/agent-host/src/daemons/manager.test.ts` | Task/schedule create and control actions accept only an injected authorization seam |
| C — Subagent mutation | subagent worker | `apps/agent-host/src/agents/supervisor.ts`, `apps/agent-host/src/agents/supervisor.test.ts` | Agent-spawn and mutation paths receive a broker-compatible authorization seam |
| D — Host integration | root | `apps/agent-host/src/session.ts`, `apps/agent-host/src/session.capability-integration.test.ts`, `PROGRESS.md` | Adversarial WebSocket frames fail closed without a matching grant |

**Wave 1 acceptance:** Privileged mutation seams deny when no session-supplied authorization callback grants the exact operation. Root will bind the callbacks to `CapabilityBroker` and verify frame-level failures after the lanes return. Browser/MCP have no currently composed session entrypoint and remain explicitly unavailable until a governed route is introduced.

**Wave 1 result (2026-08-27):**

- Reviewed writes can require an authorizer that receives only a normalized relative path, content digest/size, and expected-version metadata. Denial occurs before filesystem mutation.
- Daemon/schedule and subagent mutation seams now support fail-closed authorization with redacted operation metadata; list/status/inspect remain read-only.
- Corrected the client capability approval contract: the client may approve or deny a request but cannot submit a grant or binding. The host remains the grant issuer.
- Independent focused proof: direct Vitest invocation passed **6 files / 51 tests**; `pnpm typecheck:host` passed; scoped `git diff --check` passed.

**Wave 2 — session-owned approval and consumption (IN PROGRESS):**

| Lane | Owner | Exclusive files | Intended proof |
| :--- | :--- | :--- | :--- |
| A — WebSocket capability handshake | session worker | `apps/agent-host/src/session.ts`, `apps/agent-host/src/session.capability-integration.test.ts` | Direct mutation frames are deferred until host-issued, binding-matched capability approval is consumed |
| B — Integration and verification | root | `PROGRESS.md` and integration-only follow-ups | Combined diff review, focused adversarial suite, host/root gates |

**Wave 2 acceptance:** A direct workspace-write, subagent-mutation, daemon-control, or schedule frame must receive a host approval request and cannot produce a side effect until the matching client decision is processed by the host-owned broker. The grant token stays host-local; expiry/replay/mismatched binding fail closed and record an audit-ready broker decision.

**Wave 2 result (2026-08-27):**

- Added a per-session host-owned capability broker, opaque session binding, bounded decision sink, and deferred-operation registry. Grant tokens never cross the protocol; browser decisions contain only a request ID and boolean.
- Direct workspace writes, subagent mutation, daemon task mutation, schedule creation, memory mutation, and direct interactive PTY requests no longer execute from a raw browser frame. Read-only subagent/task operations remain immediate.
- The host sends redacted `capability.approval_required` metadata, consumes the exact single-use server-held token on a matching decision, and rejects unknown, denied, revoked, expired, or replayed requests without side effects.
- Independent focused proof: **7 files / 54 tests** passed; `pnpm typecheck:host` passed; scoped `git diff --check` passed. Whole-workspace `pnpm lint` and `pnpm typecheck` passed (**6/6 Turbo tasks**, host task cache miss).
- Limitation: direct-session capability decision records are bounded in host memory because the existing audit store is run-scoped. Durable, redacted non-run authorization audit records remain required before P0.1 can be called complete. Browser/MCP remain unavailable rather than brokered; structured `RunCoordinator` terminal execution is still on its legacy approval gate and needs the same broker binding.
- Next ownership: persist broker decisions in the audit ledger; bind RunCoordinator tool approval to the broker; add governed browser/MCP session routes only with an allowlisted capability contract; run a clean full suite without the known host-worker warning.

**Wave 3 — durable audit and run-tool broker adapter (IN PROGRESS):**

| Lane | Owner | Exclusive files | Intended proof |
| :--- | :--- | :--- | :--- |
| A — Capability audit ledger | audit worker | `apps/agent-host/src/audit/store.ts`, `apps/agent-host/src/audit/store.test.ts` | Append-only, redacted, non-run capability decisions persist without canonical paths or raw tokens |
| B — Run approval adapter | capability worker | `apps/agent-host/src/capabilities/runApprovalGate.ts`, `apps/agent-host/src/capabilities/runApprovalGate.test.ts` | Run/step/tool approval is broker-issued, exact-binding, single-use, and presenter-safe |
| C — Session composition | root | `apps/agent-host/src/session.ts`, `apps/agent-host/src/session.capability-integration.test.ts`, `PROGRESS.md` | Host composes durable audit and broker-backed RunCoordinator approval gates |

**Wave 3 acceptance:** Capability decisions append to a redacted durable ledger. Structured `RunCoordinator` terminal approvals bind to the same broker model as direct session mutations; an approval answer cannot authorize a different run, step, tool, or arguments digest.

**Wave 3 result (2026-08-27):**

- Added an append-only SQLite `capability_decisions` ledger. It persists opaque IDs, safe bindings, digests, decision/reason, and remaining-use counts, rejects raw request material, and redacts known secret values before storage.
- Added `BrokerApprovalGate`, which implements the existing RunCoordinator approval interface using a host-local, single-use grant bound to host/session/workspace/generation/run/step/tool/request digest.
- Replaced the session’s legacy structured-run approval composition. Structured tool requests now emit only `capability.approval_required` metadata; exact capability decisions consume the gate. Legacy approval frames cannot prefix-match or authorize a direct deferred operation.
- The broker audit sink now persists allow/deny/revoke decisions to the capability ledger. It maps only safe host/session/workspace/run/step/tool/argument-digest values and never stores the token or raw tool request.
- Independent focused proof: **4 files / 23 tests** passed, including a local streamed tool-call fixture that remained blocked until a matching capability decision and then verified its durable audit row. `pnpm typecheck:host` and scoped `git diff --check` passed.
- P0.1 remains in progress: existing browser/MCP modules have no governed session entrypoint and remain unavailable; full clean host/root suite evidence is still required before completion.

---

## Active Initiative: Seamless Local Directory Operation

**Status:** IN PROGRESS — Wave 1 control-plane foundation
**Plan:** `docs/plans/2026-08-26-seamless-local-directory-operation.md`
**Objective:** Replace manual local-folder entry and page-reload workspace switching with a secure native-picker, private-recents, typed-broker foundation.

| Lane | Owner | Exclusive files | Intended proof |
| :--- | :--- | :--- | :--- |
| A — Workspace control protocol | protocol worker | `packages/protocol/src/workspace.ts`, `packages/protocol/src/workspace.test.ts`, `src/lib/workspaceBrokerClient.ts`, `src/lib/__tests__/workspaceBrokerClient.test.ts` | Protocol and client tests |
| B — Launcher workspace broker | launcher worker | `scripts/workspace-picker.cjs`, `scripts/workspace-registry.cjs`, `scripts/nanoforge-launcher.cjs`, `scripts/__tests__/workspace-picker.test.ts`, `scripts/__tests__/workspace-registry.test.ts`, `scripts/__tests__/nanoforge-launcher.workspace.test.ts` | Launcher/registry tests |
| C — Integration and verification | root | `PROGRESS.md` plus integration-only follow-up files | Combined diff review, typecheck, lint, full suite, build |

**Wave 1 acceptance:** Typed choose/activate/current/recents control-plane contract; native-picker adapter with explicit cancellation; private, atomically written recent-workspace registry; no canonical paths persisted in browser state; no existing local-workspace behavior regresses.

**Open decisions:** The first Windows picker uses an injectable OS adapter; implementation will choose the smallest dependency-free mechanism that produces a native folder dialog. Browser File System Access handles are not the host authority.

**Wave 1 evidence (pending integration reconciliation):**

- Lane A: protocol broker tests `6/6`, client tests `3/3`, protocol and app TypeScript checks passed.
- Lane B: `cmd.exe /c npx vitest run scripts/__tests__` passed `7` files / `34` tests; registry and picker are deliberately injectable until packaging wiring is added.
- Lane C: host workspace-context test passed `3/3`; `cmd.exe /c pnpm typecheck:host` passed.
- Root review found two integration defects before acceptance: launcher endpoints and response frames do not yet match the new broker-client contract, and recent-list currently exposes registry paths to the browser. Wave 2 owns resolving both before any UI is connected.

**Wave 2 outcome: ACCEPTED (2026-08-26)**

- Reconciled the launcher to the typed broker contract, created the native-picker/private-registry services in normal launcher runs, and bundled both sidecars into release packaging.
- Replaced `window.prompt` and `window.location.reload()` folder flow with picker -> opaque activation -> candidate-first host reconnection. Browser persistence receives only the opaque ID and display-safe label.
- Added generation propagation (`NANOFORGE_WORKSPACE_GENERATION`) from launcher replacement host to the host descriptor, preventing successful-looking handoffs from failing generation validation.
- Added immutable host-side `WorkspaceContext`; its browser-safe serialization omits the canonical root and display path.
- Independently corrected the picker flow to activate a selected workspace before marking it ready, and corrected lint failures found during the final gate.

**Fresh verification:**

- `cmd.exe /c pnpm typecheck` — PASS (6 Turbo tasks).
- `cmd.exe /c pnpm lint` — PASS.
- `cmd.exe /c pnpm test -- --run --reporter=dot` — PASS (full suite; includes launcher packaging test).
- Focused connected-workflow suite — PASS, 3 files / 13 tests.
- `cmd.exe /c pnpm build` — PASS (production Vite build).
- `git diff --check` — PASS.

**Known limits / next milestone:** Active runs still use the existing confirmation dialog rather than the planned task-inventory switch dialog; the native picker and packaged executable require a manual visible Windows smoke run before a release claim. Large-directory pagination, full file mutations, and reveal-in-Explorer UI wiring remain later plan modules.

**Launcher bootstrap fix (2026-08-26):** `loadHostSettings()` now consumes the launcher's ephemeral `hostPort`/`token` URL parameters without persisting the token. This fixes the standalone UI incorrectly showing “Local folder selection is available only from the NanoForge launcher” while opened from the launcher UI URL. `pnpm build` passed after the change; live UI reload reports `Local runtime: No workspace` (connected and awaiting a folder) rather than host offline.

---

## Master Phase Status Matrix

| Phase | Description | Status | Changed Files | Tests Added / Updated | Verification Gates |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 0** | Baseline Inspection & Verification Setup | **COMPLETED** | `PROGRESS.md` | Baseline Recorded (60 test files / 616 tests) | Typecheck: PASS<br>Lint: PASS<br>Tests: 616/616 PASS<br>Build: PASS |
| **Phase 1** | Repair Host Run-Control Acknowledgements | **COMPLETED** | `packages/protocol/src/lifecycle.ts`<br>`packages/protocol/src/__tests__/lifecycle.test.ts`<br>`apps/agent-host/src/protocol.ts`<br>`apps/agent-host/src/session.ts`<br>`apps/agent-host/src/session.runControl.test.ts`<br>`apps/agent-host/src/session.runControl.adversarial.test.ts`<br>`src/lib/hostClient.ts`<br>`src/lib/hostSession.ts`<br>`src/lib/__tests__/hostClient.test.ts`<br>`src/lib/__tests__/hostClient.runControl.test.ts`<br>`src/lib/__tests__/hostClient.runControl.adversarial.test.ts` | Unit tests (`lifecycle.test.ts`, `hostClient.test.ts`, `hostClient.runControl.test.ts`, `hostClient.runControl.adversarial.test.ts`) & Integration/Adversarial tests (`session.runControl.test.ts`, `session.runControl.adversarial.test.ts`) | Typecheck: PASS<br>tsc -b: PASS<br>Lint: PASS<br>test: 623/623 PASS<br>build: PASS |
| **Phase 2** | Harden Swarm Slash Commands & Subagent Paths | **COMPLETED** | `packages/protocol/src/subagents.ts`<br>`apps/agent-host/src/session.ts`<br>`apps/agent-host/src/agents/supervisor.ts`<br>`apps/agent-host/src/session.command.adversarial.test.ts`<br>`apps/agent-host/src/agents/agents.adversarial.test.ts` | Unit tests (`session.command.test.ts`) & Adversarial tests (`session.command.adversarial.test.ts`, `agents.adversarial.test.ts`) | Typecheck: PASS<br>tsc -b: PASS<br>Lint: PASS<br>test: 625/625 PASS |
| **Phase 3** | Reviewed Local Writes Opt-In & Conflict Safety | **COMPLETED** | `scripts/nanoforge-launcher.cjs`<br>`src/types/index.ts`<br>`src/sections/ConnectDialog.tsx`<br>`src/hooks/useAgentOrchestration.ts`<br>`src/hooks/__tests__/useAgentOrchestration.test.tsx`<br>`src/sections/__tests__/ConnectDialog.writes.test.tsx`<br>`scripts/__tests__/nanoforge-launcher.writes.test.ts` | Unit & hook tests (`useAgentOrchestration.test.tsx`, `ConnectDialog.writes.test.tsx`, `nanoforge-launcher.writes.test.ts`) | Typecheck: PASS<br>tsc -b: PASS<br>Lint: PASS<br>test: 635/635 PASS |
| **Phase 4** | Fix Session Lifecycle Leaks & Cancellation Correctness | **COMPLETED** | `apps/agent-host/src/session.ts`<br>`apps/agent-host/src/agents/supervisor.ts`<br>`apps/agent-host/src/daemons/supervisor.ts`<br>`apps/agent-host/src/daemons/scheduler.ts`<br>`src/hooks/useAgentOrchestration.ts`<br>`apps/agent-host/src/lifecycle.test.ts` | Disconnect lifecycle tests (11 connect/disconnect cycles with zero listener warnings), run-scoped cancellation tests | Typecheck: PASS<br>tsc -b: PASS<br>Lint: PASS<br>Zero MaxListenersExceededWarning |
| **Phase 5** | Tighten Loopback Origin & Search Handling | **COMPLETED** | `apps/agent-host/src/server.ts`<br>`apps/agent-host/src/workspace/filesystem.ts`<br>`apps/agent-host/src/security_invariants.adversarial.test.ts` | Exact allowed origin tests, null/missing origin rejection tests, `--` positional delimiter search injection tests | Typecheck: PASS<br>tsc -b: PASS<br>Lint: PASS<br>test:host: PASS |
| **Phase 6** | Attachment Retention & Swarm UX Semantics | **COMPLETED** | `src/lib/attachments/validation.ts`<br>`src/lib/attachments/snapshots.ts`<br>`src/hooks/useSessionPersistence.ts`<br>`src/sections/ConnectDialog.tsx`<br>`apps/agent-host/src/agents/supervisor.ts`<br>`src/lib/attachments/validation.test.ts`<br>`src/lib/attachments/snapshots.test.ts` | Snapshot store clear/keys tests, expanded sensitive filename pattern tests, chat snapshot pruning tests | Typecheck: PASS<br>tsc -b: PASS<br>Lint: PASS<br>test: PASS |
| **Phase 7** | Final Verification & Release Readiness | **COMPLETED** | `tests/e2e/e2e_phase7_smoke.test.ts`<br>`tests/e2e/helpers/testHost.ts`<br>`PROGRESS.md` | Full E2E smoke integration test (origin check, default write denial, reviewed write with SHA-256, conflict rejection, plan submit/pause/cancel ACKs, slash inspect confinement) | Typecheck: PASS (4 pkgs)<br>Lint: PASS (0 errs)<br>Tests: 643/643 PASS (64 files)<br>Build: PASS (dist & bundle)<br>No Listener Warnings |

---

## Phase 0: Baseline Inspection & Verification Setup

### Status: COMPLETED

### Description
Establish a clean baseline on the `hardening-phases-0-7` feature branch by verifying existing codebase health across all packages, running full static analysis, typechecking, linting, and comprehensive test suites, and cataloging pre-existing defects and quality signals.

### Changed Files
- `PROGRESS.md`: Initialized comprehensive Phase 0–7 tracking matrix and baseline record.

### Tests Added / Updated
- Baseline suite verified: 60 test files, 616 tests passed across root, protocol, agent-host, core, sdk, and E2E suites.

### Verification Results

| Gate / Command | Result | Notes / Details |
| :--- | :--- | :--- |
| `cmd.exe /c pnpm typecheck` | **PASS** (code 0) | 6/6 Turbo tasks successful across `@nanoforge/protocol`, `@nanoforge/core`, `@nanoforge/sdk`, `@nanoforge/agent-host` |
| `cmd.exe /c pnpm exec tsc -b` | **PASS** (code 0) | 0 root frontend TypeScript diagnostics |
| `cmd.exe /c pnpm lint` | **PASS** (code 0) | 0 ESLint errors/warnings across entire workspace |
| `cmd.exe /c pnpm test -- --run` | **PASS** (code 0) | 60 test files passed, 616 tests passed (28.28s) |
| `cmd.exe /c pnpm test:protocol` | **PASS** (code 0) | 18 test files passed, 378 tests passed (2.28s) |
| `cmd.exe /c pnpm test:host` | **PASS** (code 0) | 44 test files passed, 418 tests passed (9.08s) |
| `cmd.exe /c pnpm test:core` | **PASS** (code 0) | 8 test files passed, 95 tests passed (1.70s) |
| `cmd.exe /c pnpm test:sdk` | **PASS** (code 0) | 1 test file passed, 13 tests passed (0.95s) |
| `cmd.exe /c pnpm test:e2e` | **PASS** (code 0) | 8 test files passed, 178 tests passed (7.71s) |

---

## Phase 1: Repair Host Run-Control Acknowledgements

### Status: COMPLETED

### Description
Ensured all host run-control and mutation operations (`plan.submit`, `run.pause`, `run.resume`, `run.cancel`, `approval.grant`, `approval.deny`, `tool.response`) return typed success/error responses containing the caller's original `requestId`. For plan submissions, the acknowledgement frame carries both `runId` and `planId`. Eliminated client-side request timeouts caused by mismatched/untyped notifications and removed silent `.catch(() => {})` error swallowing in `hostSession.ts`, routing errors to `setLastError`.

### Key Objectives Achieved
1. Introduced 7 typed success-result schemas in `packages/protocol/src/lifecycle.ts` and unit tested them in `packages/protocol/src/__tests__/lifecycle.test.ts`.
2. Updated `apps/agent-host/src/protocol.ts` to re-export schemas and accept `requestId: idSchema.optional()` on all client mutation request schemas and host error frame.
3. Updated `apps/agent-host/src/session.ts` to emit typed result frames with `requestId` and `runId`, route `unknown_run` errors with `requestId` and `runId`, and support `SocketApprovalGate.resolve` by exact `requestId` or `${runId}:${stepId}` prefix.
4. Updated `src/lib/hostClient.ts` to parse typed result frames and resolve `submitPlan`, `pauseRun`, `resumeRun`, `cancelRun`, `grantApproval`, `denyApproval`, and `sendToolResponse` immediately via `requestResult`.
5. Updated `src/lib/hostSession.ts` to route errors from `sendGrant`, `runApproved`, `pause`, `cancel`, and `stopToolRun` to `setLastError`.
6. Added full client-host integration tests in `apps/agent-host/src/session.runControl.test.ts` covering immediate resolution, runId retrieval, pause/resume/cancel results, approval resolution, unknown run error handling, and zero pending frame leaks.

### Changed Files
- `packages/protocol/src/lifecycle.ts`
- `packages/protocol/src/__tests__/lifecycle.test.ts`
- `apps/agent-host/src/protocol.ts`
- `apps/agent-host/src/session.ts`
- `apps/agent-host/src/session.runControl.test.ts`
- `apps/agent-host/src/session.runControl.adversarial.test.ts`
- `src/lib/hostClient.ts`
- `src/lib/hostSession.ts`
- `src/lib/__tests__/hostClient.test.ts`
- `src/lib/__tests__/hostClient.runControl.test.ts`
- `src/lib/__tests__/hostClient.runControl.adversarial.test.ts`

---

## Phase 2: Harden Swarm Slash Commands & Subagent Paths

### Status: COMPLETED

### Description
Replaced raw string casting of slash-command arguments with protocol Zod schema validation (`invokeSubagentParamsSchema`, `manageSubagentsParamsSchema`, `sendMessageParamsSchema`). Confined subagent inspection and metadata paths strictly within `.agents/<name>_<shortId>` inside the workspace root using multi-pass sanitization, allowlist enforcement, and canonical + relative path checks.

### Key Objectives Achieved
1. Built a typed command adapter in `apps/agent-host/src/session.ts` for slash command parsing (`/swarm run`, `/swarm inspect`, `/swarm list`, `/swarm tree`, `/swarm pause`, `/swarm resume`, `/swarm stop`, `/swarm message`) with strict protocol Zod schema validation and structured error response `{ code: "invalid_command", issues: [...] }`.
2. Restricted `/swarm inspect` to `manageSubagentsInspectFileSchema` enum values (`progress.md`, `BRIEFING.md`, `handoff.md`, `DISPATCH.md`, `analysis.md`).
3. Added defense-in-depth in `SubagentSupervisor.manageSubagents()` validating allowlist compliance, multi-pass path sanitization (rejecting null bytes and URL encodings), `.agents` containment, and subagent directory lexical/canonical confinement before reading files.
4. Validated and normalized subagent names in `SubagentSupervisor.spawnSubagent()` using `validateSubagentName()` (enforcing `/^[a-zA-Z0-9_\-]+$/`, rejecting path separators, `..`, drive prefixes, control chars) and verified metadata directory confinement inside `<workspaceRoot>/.agents`.
5. Added comprehensive unit and adversarial test suites covering traversal attempts (`--file ../../../secret`, `/etc/passwd`, `C:\Windows\win.ini`), URL encodings (`%2e%2e%2f`), malicious names, invalid budgets/timeouts, and valid inspection of all 5 allowed files.

### Changed Files
- `packages/protocol/src/subagents.ts`
- `apps/agent-host/src/session.ts`
- `apps/agent-host/src/agents/supervisor.ts`
- `apps/agent-host/src/session.command.adversarial.test.ts`
- `apps/agent-host/src/agents/agents.adversarial.test.ts`

---

## Phase 3: Reviewed Local Writes Opt-In & Conflict Safety

### Status: COMPLETED

### Description
Ensured local workspace writes are genuinely opt-in (disabled by default in launcher) and protected against concurrent modification conflicts via atomic hash/mtime verification.

### Key Objectives Achieved
1. Changed `scripts/nanoforge-launcher.cjs` so `NANOFORGE_ALLOW_WORKSPACE_WRITES` defaults to `0` (disabled by default).
2. Added an explicit user-facing "Enable reviewed local writes" setting tab in `src/sections/ConnectDialog.tsx` showing the active workspace root and requiring deliberate confirmation.
3. Updated `VirtualFile` in `src/types/index.ts` to retain `sha256`, `modified`, and `size`.
4. In `src/hooks/useAgentOrchestration.ts`, `writeWorkspaceFile` transmits `expectedSha256` and `expectedModified`; catches `write_conflict` without marking patches applied and surfaces an actionable conflict notice.
5. Preserved host-side `allowWorkspaceWrites` check as the definitive privileged security boundary.

### Changed Files
- `scripts/nanoforge-launcher.cjs`
- `src/types/index.ts`
- `src/sections/ConnectDialog.tsx`
- `src/hooks/useAgentOrchestration.ts`
- `src/hooks/__tests__/useAgentOrchestration.test.tsx`
- `src/sections/__tests__/ConnectDialog.writes.test.tsx`
- `scripts/__tests__/nanoforge-launcher.writes.test.ts`

---

## Phase 4: Fix Session Lifecycle Leaks & Cancellation Correctness

### Status: COMPLETED

### Description
Eliminated EventEmitter listener leaks on `DaemonSupervisor`, `TaskScheduler`, and `SubagentSupervisor` by storing and invoking unsubscribe callbacks on WebSocket close. Refactored orchestration cancellation from global refs to run-scoped cancellation objects.

### Key Objectives Achieved
1. In `apps/agent-host/src/session.ts`, stored unsubscribe handles (`unsubSubagents`, `unsubMemory`, `unsubSupervisor`, `unsubScheduler`, `unsubEventLog`) and invoked each on socket close.
2. In `apps/agent-host/src/agents/supervisor.ts`, stored `unsubDaemons` and `unsubScheduler` from constructor and invoked them in `dispose()`.
3. Set `setMaxListeners(100)` on `DaemonSupervisor`, `TaskScheduler`, and `SubagentSupervisor`.
4. Guarded shared daemon/pty manager disposal so server-owned instances persist while connection-owned instances tear down cleanly.
5. In `src/hooks/useAgentOrchestration.ts`, replaced global `demoCancelledRef`/`abortRef` with run-scoped `ActiveRun` object `{ runId, sessionId, agentMsgId, cancelled, controller }`.
6. Verified 11 connect/disconnect cycles in `lifecycle.test.ts` with zero listener warnings.

### Changed Files
- `apps/agent-host/src/session.ts`
- `apps/agent-host/src/agents/supervisor.ts`
- `apps/agent-host/src/daemons/supervisor.ts`
- `apps/agent-host/src/daemons/scheduler.ts`
- `src/hooks/useAgentOrchestration.ts`
- `apps/agent-host/src/lifecycle.test.ts`

---

## Phase 5: Tighten Loopback Origin & Search Handling

### Status: COMPLETED

### Description
Enforced strict WebSocket origin validation on the agent host, rejecting `null`, missing origins, and unapproved wildcards. Hardened workspace search against ripgrep command-line flag injection.

### Key Objectives Achieved
1. In `apps/agent-host/src/server.ts`, implemented `DEFAULT_ALLOWED_ORIGINS` (`http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost:4173`, `http://127.0.0.1:4173`, `http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:4040`, `http://127.0.0.1:4040`, `https://nano-gpt.com`).
2. Rejected `null` and missing origins by default unless `allowNonBrowserClients: true` is explicitly provided.
3. In `apps/agent-host/src/workspace/filesystem.ts`, placed `--` positional delimiter before search queries in `handleSearch` to prevent ripgrep option injection (e.g. `--help`, `-F`).
4. Clamped `maxResults` to `[1, 500]`, validated include glob patterns, and returned structured `WorkspaceFileError` on tool errors.

### Changed Files
- `apps/agent-host/src/server.ts`
- `apps/agent-host/src/workspace/filesystem.ts`
- `apps/agent-host/src/security_invariants.adversarial.test.ts`

---

## Phase 6: Attachment Retention & Swarm UX Semantics

### Status: COMPLETED

### Description
Implemented bounded attachment retention with IndexedDB snapshot cleanup on chat deletion and cache pruning. Synchronized attachment filename blocklists with host sensitive-file policies. Accurately reported swarm subagent execution states.

### Key Objectives Achieved
1. In `src/lib/attachments/validation.ts`, expanded `isSensitiveFileName` to block `.npmrc`, `.netrc`, `.git-credentials`, `.pypirc`, `.terraformrc`, `id_rsa*`, `id_ed25519*`, cloud credential directories (`.aws`, `.azure`, `.docker`, `.gnupg`, `.kube`, `.ssh`, `.terraform.d`), and service account JSONs.
2. In `src/lib/attachments/snapshots.ts`, added `clear()` and `keys()` methods to `AttachmentSnapshotStore` (both `MemoryAttachmentSnapshotStore` and `IndexedDbAttachmentSnapshotStore`).
3. In `src/hooks/useSessionPersistence.ts`, cleaned up IndexedDB snapshot IDs when chats or workspaces are permanently deleted.
4. In `src/sections/ConnectDialog.tsx`, added a "Clear local attachment cache" button.
5. In `apps/agent-host/src/agents/supervisor.ts`, updated pause/resume messages to accurately describe state as marked inactive/active by supervisor.

### Changed Files
- `src/lib/attachments/validation.ts`
- `src/lib/attachments/snapshots.ts`
- `src/hooks/useSessionPersistence.ts`
- `src/sections/ConnectDialog.tsx`
- `apps/agent-host/src/agents/supervisor.ts`
- `src/lib/attachments/validation.test.ts`
- `src/lib/attachments/snapshots.test.ts`

---

## Phase 7: Final Verification & Release Readiness

### Status: COMPLETED

### Description
Executed full static and integration verification across all workspace packages, verified clean zero-defect execution with zero listener warnings, and verified production bundle creation.

### Key Objectives Achieved
1. **Automated Static Verification**:
   - `pnpm typecheck`: 6/6 Turbo tasks passed across all packages (`@nanoforge/protocol`, `@nanoforge/agent-host`, `@nanoforge/core`, `@nanoforge/sdk`).
   - `pnpm lint`: ESLint passed with 0 errors and 0 warnings.
2. **Automated Unit & Integration Verification**:
   - `pnpm test -- --run`: 64 test files passed, 643 tests passed in 28.18s with **ZERO** `MaxListenersExceededWarning` messages.
3. **End-to-End Smoke Test**:
   - Added `tests/e2e/e2e_phase7_smoke.test.ts` verifying connection with expected origin, workspace read, write disabled by default, explicit write enablement with SHA-256 verification, conflict detection, plan submit/pause/cancel acknowledgements, and `/swarm inspect` directory traversal rejection.
4. **Clean Production Build & Packaging**:
   - `pnpm build`: Vite build completed successfully generating production assets in `dist/`.
   - Packager tests verified complete Windows release bundle creation (`release/NanoForge-v0.6.0-windows-x64.zip`).
5. **Git Tree Integrity**:
   - Working tree strictly verified with zero `.agents/**` modifications.

---

## Historical Workspace Context (Pre-Hardening Baseline)
Prior implementation waves (Wave 1 Workspace/Chat migration, Swarm slash commands integration, Local Drive workspace picker & reviewed writes, and NanoGPT presentation readiness waves A/A2) established the initial feature surface through commit `0c95978`. The hardening roadmap (Phases 0–7) builds directly on this baseline to deliver enterprise-grade security, lifecycle stability, and production readiness.
## 2026-08-26 — Host bundle protocol refresh

- Rebuilt the packaged `apps/agent-host/dist/server.mjs` via `pnpm package`; the launcher executes this bundle rather than the TypeScript build output.
- Restarted the launcher on UI `4183` / host `4184` with the authenticated session URL. The UI now stays connected; with no selected directory it reports `Workspace unavailable` instead of closing the socket with `4400 invalid message`.
- Verified host `/health` returns `200` and the live browser page remains reachable after reload.
## 2026-08-26 — Launcher origin allowlist and recent-folder reconnect

- Added the packaged launcher UI origins (`http://localhost:4183` and `http://127.0.0.1:4183`) to the agent-host WebSocket allowlist.
- Rebuilt and restarted the launcher with a fresh token after the prior token was consumed.
- Live browser verification: selecting the first `skills` entry under Recent folders changed the runtime indicator to `Runtime ready`; no 4401 unauthorized-origin error remained.
## 2026-08-26 — QoL and user-friendly product plan

- Added `docs/plans/2026-08-26-qol-and-user-friendly-app-plan.md`, a seven-module delivery plan for onboarding, recovery, folders, agent clarity, explorer productivity, accessibility, and trustworthy product communication.
- The plan orders runtime recovery before UI polish and ends with packaged Windows user-journey proof.

## 2026-08-27 — NanoGPT ecosystem alignment audit

- Objective: produce an evidence-based, implementation-ready NanoGPT alignment plan covering the model catalog, run/cost tracking, workspace tools, slash commands, artifact review, browser/scheduling controls, memory, agent controls, privacy/security, and partner presentation.
- Branch/repository: `gem` at `C:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge`.
- Scope: read-only product-code audit; preserve the existing dirty worktree. Coordinator-owned outputs are this progress entry and `docs/plans/2026-08-27-nanogpt-ecosystem-alignment-plan.md`.
- Wave 1 lanes: code/feature inventory; trust-boundary and architecture audit; NanoGPT mission/product/privacy/ecosystem research and collaboration analysis.
- Wave 1 completed with three read-only lanes: feature/runtime truth; trust boundary/architecture; NanoGPT primary-source product/privacy/ecosystem research. No worker edited repository files.
- Coordinator reconciliation confirmed the primary product gaps: unaudited direct PTY capability; host/browser NanoGPT split; unauthoritative local cost estimates; browser-visible workspace paths; incomplete non-swarm slash actions; uncomposed browser/MCP; volatile non-executing schedules; volatile memory; state-only/simulated agent execution.
- Fresh gates: `pnpm lint` passed; `pnpm typecheck` passed 6/6 Turbo tasks; `pnpm test -- --run` passed 84 files / 761 tests; `pnpm test:e2e` passed 13 files / 233 tests; `pnpm build` passed with large-chunk warnings (892.45 kB main, 403.16 kB cost dashboard).
- Live production-preview proof at `http://127.0.0.1:4173`: model catalog, workspaces/chats/files, run trace, Apply/Reject diff, cost dashboard, and Swarm Control Plane were mounted. Runtime truth was `API demo`, `Host offline`, offline catalog, approximate local cost, and zero live agents; no live NanoGPT-host-workspace vertical slice was claimed.
- Deliverable: `docs/plans/2026-08-27-nanogpt-ecosystem-alignment-plan.md` with required audit/gaps/priorities/specifications/collaboration sections, detailed demo script, technical-overview outline, sources, timelines, acceptance gates, and explicit placeholders.
- Status: COMPLETED for analysis and planning. Implementation, live credentialed NanoGPT proof, clean-machine packaging/signing, and NanoGPT contract/branding decisions remain future work.

## 2026-08-28 — Army codebase and Claude Code Desktop assessment

- Objective: produce a read-only, evidence-backed assessment of the current dirty `gem` checkout, including strengths, weaknesses, shortfalls, and a current comparison with Claude Code Desktop.
- Lane plan: architecture/code health; product/runtime UX truth; security/reliability; Claude Code Desktop product comparison. Workers must not edit files; coordinator owns reconciliation and fresh verification.
- Status: IN PROGRESS.

### Assessment outcome (2026-08-28)

- Army lanes completed read-only reviews of shared architecture, browser/product UX, host security/reliability, and current Claude Code Desktop capabilities. No worker edited source files.
- Coordinator verification: `pnpm lint` PASS; `pnpm typecheck` PASS (6/6 Turbo tasks); `pnpm build` PASS (2,573 modules transformed; large-chunk and duplicate dynamic/static import warnings); root `pnpm test -- --run --reporter=dot` FAIL (84 files: 78 passed, 6 failed; 761 tests: 750 passed, 11 failed).
- Correct host-suite invocation outside the sandbox: 55 files, 789 tests; 53 files / 784 tests passed and 2 files / 5 tests failed. The failures are capability-approval contract drift in older tests, plus a memory RPC timeout.
- Conclusion: strong technical prototype and security-oriented control-plane foundation; not release-ready or feature-complete as a Claude Code Desktop competitor. Highest priorities are to repair contract/test drift, close PTY ownership and disconnect cleanup, eliminate filesystem TOCTOU and silent audit-failure gaps, finish one live UI-to-host NanoGPT golden path, and provide supported native desktop packaging.
- Working tree was already materially dirty and gained unrelated pre-existing agent/docs changes during the assessment; all changes were preserved. No cleanup, reset, commit, or push was performed.

## 2026-08-28 — Army Wave 1: Seamless local folders first

- Objective: make opening, reopening, and switching local folders feel immediate and safe; preserve browser path privacy; ensure subagents receive the active host workspace under their existing isolation rules; then begin remediation from the assessment.
- Wave 1 ownership: A — browser workspace UX and persistence (`src/App.tsx`, `src/components/layout/AppLayout.tsx`, `src/sections/Sidebar.tsx`, `src/hooks/useSessionPersistence.ts`, owned tests); B — launcher folder broker/registry/picker (`scripts/workspace-*.cjs`, `scripts/nanoforge-launcher.cjs`, owned tests); C — subagent inherited-workspace contract (`apps/agent-host/src/agents/{supervisor,types}.ts`, owned tests); D — read-only integration/test-contract triage.
- Acceptance: a folder can be opened from the native picker or Recents, becomes a named app workspace without a reload, reconnects the host using opaque descriptors only, and newly spawned subagents operate in that active workspace (or their intentional Git worktree). The current folder survives a failed switch.
- Coordinator gates: targeted lane tests, lint, typecheck, relevant host/browser workflow tests, then the full suite; no user-owned dirty changes will be discarded.
- Status: COMPLETED WITH KNOWN SUITE DRIFT.

### Wave 1 evidence (coordinator, 2026-08-28)

- Focused folder/broker regression suite: 5 files / 21 tests passed.
- Subagent supervisor contract: 1 file / 10 tests passed; agent-host typecheck and root lint passed.
- Fresh production web build and packaged host artifact completed (`pnpm build`, then `pnpm package`).
- Browser proof on an isolated launcher using non-default loopback ports: the opaque `nano-forge` Recent folder entry was visible and enabled; clicking it restarted the host and finished at `Local runtime: Runtime ready`, with no origin-mismatch error. This also exposed and fixed the custom-launcher-port origin handoff: the launcher now passes one exact `127.0.0.1` UI origin to the host, which accepts only explicit loopback HTTP origins.
- Subagents now retain the selected host root privately as `assignedWorkspaceRoot`; browser-facing results expose `.` for inherit mode or a project-relative worktree location for branch isolation.
- Known unrelated suite drift remains: two existing host contract tests still expect implicit mutation execution instead of capability approval. Wave 2 owns that migration.

## 2026-08-28 — Army Wave 2: explicit mutation approval migration

- Objective: repair the assessment’s first blocking recommendation without weakening host-side approval: make host, E2E, and SDK clients resolve exact capability requests explicitly before write or memory mutations.
- Ownership: A — host contract tests only (`apps/agent-host/src/server.test.ts`, `apps/agent-host/src/session.writes.test.ts`); B — E2E helper and affected scenarios only (`tests/e2e/helpers/testHost.ts`, phase-7, QoL, challenger tests); C — SDK approval contract and tests only (`packages/sdk/**` plus directly required protocol types); D — read-only security test map for PTY ownership, disconnect cleanup, filesystem TOCTOU, and audit-persistence failure handling.
- Constraints: no implicit auto-approval, no production policy weakening, exact request binding, no commits, no recursive deletion, preserve the dirty worktree.
- Acceptance: host/E2E suites pass for the correct approval-aware reason; SDK exposes an observable approval path; coordinator independently inspects the combined diff and runs focused suites before broader validation.
- Status: COMPLETED.

### Wave 2 evidence (coordinator, 2026-08-28)

- Host tests now approve exact capability prompts before write and memory assertions. Full host suite: 55 files / 792 tests passed.
- SDK adds caller-controlled pending-approval inspection, approval/denial, and exact-binding validation; full SDK suite: 1 file / 15 tests passed.
- E2E helper validates request ID, tool ID, scope, single-use policy, and argument digest before issuing test approvals. Full E2E suite: 13 files / 233 tests passed.
- `pnpm typecheck` passed all 6 Turbo tasks and `pnpm lint` passed.
- The root Vitest invocation still exits after its packaging-test stream without emitting the reporter summary or the shell exit marker. It is not being counted as a full-root-suite pass; its host, SDK, and E2E constituents above were independently run to completion.
- Next security work, deliberately not merged into this wave: fail closed on audit persistence failure; host-session PTY ownership and disconnect cleanup; filesystem symlink/junction TOCTOU defense; host-scoped audit-store ownership. See the 2026-08-28 Army assessment for the verified rationale and target map.

## 2026-08-28 — Army Wave 3: fail-closed audit, PTY ownership primitives, filesystem races

- Objective: begin the next security recommendations without overlapping the already-dirty host-session files.
- Ownership: A — capability audit persistence failure behavior (`apps/agent-host/src/session.ts`, `src/capabilities/{broker,runApprovalGate}.ts`, `src/runs/coordinator.ts`, directly owned tests); B — filesystem revalidation/TOCTOU defenses (`src/workspace/filesystem.ts`, `src/policy/policy.ts`, directly owned tests); C — session-owner-safe PTY manager primitives (`src/terminal/ptyManager.ts`, directly owned tests).
- Deferred deliberately: browser-session plumbing and disconnect cleanup require the PTY primitive from C and use `session.ts`, which A owns in this wave. They will become a separate, exclusive follow-up lane after coordinator reconciliation.
- Constraints: durable audit failures deny/revoke before side effects; PTY ownership is unforgeable and no cross-session access is allowed; filesystem checks remain fail closed; no automatic approvals, commits, or destructive operations.
- Acceptance: new red tests prove each risk, focused suites pass after implementation, and coordinator independently validates the combined diff before opening the session integration wave.
- Status: IN PROGRESS.

### Wave 3A evidence (coordinator, 2026-08-28)

- Durable capability-decision persistence is now fail closed. A broker audit sink failure revokes the exact grant before returning `audit_unavailable`; the session returns the stable denial `Capability audit is unavailable; approval denied` and does not dispatch the deferred operation.
- `RunCoordinator` now treats `startRun`, event, artifact, and end-run audit failures as terminal `failed` runs with the stable `audit unavailable` reason. It cancels the current job, releases waiters, settles the handle once, and does not recursively emit another unauditable event.
- Added controlled throwing-audit tests that prove no approved workspace write, structured tool, or subagent invocation runs when its capability decision cannot be persisted; they also prove start and in-flight coordinator audit failures leave no active run.
- Red-test evidence captured before implementation: coordinator submission threw `audit store unavailable`, and the session incorrectly returned `capability.result { ok: true }` after an audit-store failure.
- Fresh verification: focused audit + existing capability/coordinator regression set passed (4 files / 19 tests); final focused audit set passed (2 files / 6 tests); complete host suite passed (57 files / 801 tests); agent-host typecheck and root `pnpm lint` passed; scoped `git diff --check` passed.
- Lane A ownership is complete. PTY ownership and filesystem TOCTOU lanes remain exclusive follow-up work; no files in those lanes were changed here.

### Wave 3 coordinator outcome (2026-08-28)

- Status: COMPLETED. Coordinator independently ran the full agent-host suite (57 files / 801 tests), agent-host typecheck, and root lint after all three lanes landed.
- Filesystem operations now revalidate canonical confinement immediately before sensitive I/O. The deterministic parent-symlink swap test fails closed with `path_outside_workspace`.
- PTY manager primitives now bind private owner identifiers and reject cross-owner input, resize, kill, scrollback, metadata, and list operations. `closeSessionsForOwner` cleans only that owner’s terminals.
- Wave 4 is the exclusive `session.ts` integration of those PTY primitives: one authenticated client must not control another client’s terminal, and disconnect must close only the disconnecting client’s terminals.

## 2026-08-28 — Army Wave 4: live-session PTY ownership integration

- Status: COMPLETED locally after the assigned worker hit an account usage limit before editing. No partial worker change was accepted.
- Each attached agent session now creates a host-only opaque PTY owner. `terminal.input`, `terminal.resize`, and `terminal.kill` pass that owner into the shared manager.
- Unauthorized or unknown terminal control receives the same generic `terminal_access_denied` / `Terminal operation unavailable` response, without revealing terminal existence or ownership.
- On socket close, the session calls `closeSessionsForOwner` and never disposes a supplied shared manager; other clients' terminals remain live.
- Red proof: before wiring, terminal calls had no owner argument. Final focused session + PTY suite passed 2 files / 14 tests. Final host suite passed 57 files / 802 tests; repository typecheck and lint passed; `pnpm package` rebuilt `apps/agent-host/dist/server.mjs`, which contains the session-owner hardening.
- Remaining recommendation, intentionally not started in this wave: make durable audit-store ownership host-scoped across multiple sockets and test shared-store shutdown semantics.

## 2026-08-28 — Packaged local-folder repair

- Root cause: the Windows SEA executable used its embedded-only `require` for the picker and workspace-registry sidecars, so `/workspace/*` routes fell through to the static UI. Loading an absolute sidecar path alone still failed because SEA intercepts all entry-script `require` calls.
- Fix: the launcher now detects SEA, creates a file-backed loader with `node:module.createRequire(__filename)`, and resolves sidecars next to `NanoForge.exe`. This keeps development loading unchanged and makes the bundle's picker/registry files reachable at runtime.
- Native visibility fix: the picker no longer creates a hidden owner form or uses `CREATE_NO_WINDOW`; PowerShell hides its console with `-WindowStyle Hidden` while the `FolderBrowserDialog` stays visible.
- Verification: focused launcher/picker/registry suite passed (3 files / 16 tests); `pnpm build:exe` and `pnpm package` succeeded. The fresh bundled executable completed dry-run startup, its authenticated switch-status endpoint returned JSON, a native choose request returned `workspace.choose.result`, activation returned `workspace.activate.result`, and the resulting host health check returned `200`.
- A fresh visible NanoForge instance remains running on isolated loopback ports with an activated opaque workspace descriptor. No repository changes were committed.

## 2026-08-28 — Windows desktop shell milestone

- Replaced the external-browser launch direction with an Electron desktop shell (`desktop/main.cjs`). It reserves isolated loopback ports, starts the existing audited launcher/host internally, waits for health, and loads the authenticated UI inside one owned `BrowserWindow` with renderer Node access disabled, context isolation enabled, sandboxing enabled, and popup creation denied.
- Electron owns the native folder dialog through an injected launcher picker. Folder selection no longer relies on the PowerShell dialog path when running inside the desktop shell; the workspace broker continues to return opaque descriptors to the renderer.
- The launcher supports Electron child-host execution with a narrowly passed `ELECTRON_RUN_AS_NODE=1` environment override. Existing environment allowlist tests cover that explicit override.
- Added `desktop:dev` and `desktop:build`, Electron/electron-builder development dependencies, and a Windows NSIS configuration. `pnpm desktop:build` passed; it produced `release/desktop-app/NanoForge-Desktop-0.1.0-Setup.exe` (128,317,607 bytes) and the unpacked desktop executable.
- Fresh runtime proof: the packaged `release/desktop-app/win-unpacked/NanoForge.exe` was launched, had a visible responsive NanoForge window, returned host health `200`, and reported one active renderer socket. Focused launcher tests passed (3 files / 15 tests); `pnpm build` and `pnpm lint` passed. Existing Vite large-chunk warnings and the unsigned/default Electron icon remain release-polish work, not runtime blockers.
# Desktop reviewed-write approval repair (2026-08-28)

- Restored the desktop path from reviewed patch to host-issued, single-use approval: the Electron shell now enables only the host's approval gate, while each write still waits for an explicit renderer decision and SHA-256 conflict verification.
- Added a renderer capability approval prompt and correlation handling so the intermediate approval frame cannot prematurely settle the original write request.
- Verified: focused host-client/session/UI tests (4 files / 38 tests), lint, typecheck, and production build all pass. The updated Electron shell is visibly responsive and its private loopback host returned health 200.
- Packaging note: the prior Electron installer output is locked by an older Windows process; the refreshed host bundle and desktop source app are live, but a replacement NSIS installer needs that stale process or temporary output released first.
