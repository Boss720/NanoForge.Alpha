# NanoForge Test Infrastructure & Architecture Guide

## 1. Architecture Overview

NanoForge test infrastructure is designed for hermetic, opaque-box, and end-to-end testing across both the frontend React workbench and the backend Node/Fastify daemon runtime.

```
+-------------------------------------------------------------+
¦                    Vitest Test Runner                       ¦
+-------------------------------------------------------------¦
¦    Frontend Component &      ¦    E2E Opaque-Box Suite      ¦
¦      Wiring Unit Tests       ¦        (Tiers 1 - 4)         ¦
¦  (src/sections/__tests__/)   ¦        (tests/e2e/)          ¦
+------------------------------+------------------------------¦
¦  - React Testing Library     ¦  - Fastify Loopback Server   ¦
¦  - jsdom isolated DOM        ¦  - Ephemeral Ports / Tokens  ¦
¦  - FakeHostClient Seam       ¦  - Temp Folder Sandboxing    ¦
¦  - WebSocket Mock Isolation  ¦  - Real WebSocket Frames     ¦
+-------------------------------------------------------------+
```

### Key Infrastructure Components
1. **Isolated Test Workspaces (`tests/e2e/helpers/testHost.ts`)**: Every test execution provisions a dedicated sandboxed temporary directory (`os.tmpdir()/nanoforge-e2e-*`) with clean `.nanoforge/` and `.agents/` scaffolds, ensuring zero side-effects on the developer host.
2. **Ephemeral Agent Host (`launchE2ETestHost`)**: Launches an in-memory or ephemeral port loopback Fastify instance bound to `127.0.0.1`, utilizing single-use crypto tokens and strict CORS origin checks.
3. **Native WebSocket Verification**: Tests interact over real or mock WebSockets using strict Zod protocol validation (`@nanoforge/protocol`), asserting on wire frames rather than internal implementation state.
4. **UI Host Seam (`hostSession` / `createClient`)**: Frontend integration tests inject `FakeHostClient` or mock sockets, enabling thorough verification of UI state machines, dialog focus trapping, and run cards without spinning up network sockets.

---

## 2. Test Methodologies

### 2.1 Category-Partition Testing
Systematically divides the functional domain into mutually exclusive categories and partitions:
- **Authentication**: Valid single-use token vs. expired token vs. missing token vs. forged Bearer header.
- **Workspace Paths**: Canonical absolute directory vs. non-existent directory (`ENOENT`) vs. file path vs. permission-denied directory (`EACCES`).
- **File Types**: UTF-8 plain text vs. binary assets vs. oversized files (>1MB) vs. locked/in-use files.
- **Write Policy**: Reviewed writes enabled with user confirmation vs. reviewed writes disabled by default.

### 2.2 Boundary Value Analysis (BVA)
Tests behavioral limits, extreme thresholds, and boundary transitions:
- **Exponential Backoff**: 0ms base, 500ms initial retry, doubling up to the 8000ms max cap, with maximum 5 retry attempts.
- **Watcher Coalescing**: 100ms debouncing window tested under rapid bursts of 500+ file events.
- **Directory Virtualization**: 5,000+ file directory navigation with 50-item pagination frames.
- **Responsive Viewport**: Window widths of 320px (extreme mobile/narrow), 800px (<1024px drawer collapse breakpoint), and 1280px+ (full desktop multi-dock).
- **Search Query Limits**: 0-length query vs. 10,000-character adversarial string.

### 2.3 Pairwise Combinatorial Testing
Validates cross-feature interactions where multiple features operate simultaneously:
- **Workspace Switch × Active Agent Plan**: Switching workspaces while an agent plan is in `awaiting_approval` triggers an accessible safety confirmation modal; cancelling retains active workspace and plan; confirming cleanly aborts the plan and clears pending diffs.
- **Host Reconnection × Opaque-ID Isolation**: Reconnection after a token expiration validates generation increment (`generation + 1`) and preserves per-workspace tree expansion, open files, and search filters.
- **Diff Review × Accessibility Themes**: Activating High-Contrast mode or switching themes immediately updates Monaco diff viewer token colors without resetting line review state.
- **Reviewed Writes Toggle × Write Execution**: Toggling reviewed writes disabled in settings immediately causes backend write requests to be rejected with `write_not_approved`.

### 2.4 Real-World Workload Testing
Exercises realistic user journeys end-to-end:
- **Onboarding & Demo Journey**: Fresh start -> Actionable onboarding card -> Guided demo run -> Switch to local folder -> 4-stage stepper (Choosing -> Validating -> Tools -> Loading) -> Workspace summary badges.
- **Agent Write Review & Conflict Resolution**: Plan submission -> Step approval -> Multi-stream tool run (stdout/stderr separation) -> Monaco pre-write diff review -> Added/removed metrics -> Conflict handling (Reload / Compare / Save-As) -> Write confirmation.
- **Monorepo Scale & Ignored Files**: Navigation of deeply nested file trees -> Dotfile and gitignore filtering -> Breadcrumb jumps -> File stat inspection -> Audit logging.
- **Host Offline Recovery**: Mid-session socket disconnect -> `reconnecting` state machine transition -> Backoff retry -> Token refresh -> Generation-verified re-attach -> Zero UI state loss.

---

## 3. Test Tier Matrix & Coverage

| Tier | Focus Area | Features Covered | Test Files |
|------|------------|------------------|------------|
| **Tier 1** | Feature Coverage | Features 1-38 (R1-R7) | `tests/e2e/tier1-feature-coverage/` |
| **Tier 2** | Boundary & Adversarial | Limits, Crashes, Bursts, Narrow Viewports | `tests/e2e/tier2-boundary-adversarial/` |
| **Tier 3** | Cross-Feature Interactions | Combinatorial State Interactions | `tests/e2e/tier3-cross-feature/` |
| **Tier 4** | Real-World Workloads | End-to-End User Workflows | `tests/e2e/tier4-application-scenarios/` |

---

## 4. Running the Test Suite

```bash
# Run all test suites across the monorepo
pnpm test

# Run only E2E test suites
npx vitest run tests/e2e

# Run with full coverage report
pnpm test -- --coverage
```
