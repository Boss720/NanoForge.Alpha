# NanoForge End-to-End Verification & Testing Plan

**Document Version:** 1.0.0  
**Status:** Production-Ready Verification Specification  
**Author:** Worker 4 (Roadmap & Verification Architecture Specialist)  
**Target System:** NanoForge Multi-Agent Engineering Platform  
**Target Repository:** `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge`  

---

## 1. Executive Summary & Verification Strategy

The NanoForge verification framework guarantees absolute correctness, security boundary enforcement, regression resilience, and protocol invariance across the entire monorepo. This plan defines the end-to-end testing architecture spanning **Unit Tests**, **Integration Tests**, **Mock Harnesses**, **Playwright E2E Suites**, **Negative Security Fixtures**, and **Forensic Audit Procedures**.

### 1.1 Core Verification Principles
1. **Zero-Trust Tool Execution:** Natural language output from an LLM is treated strictly as an unprivileged proposal. No tool, shell command, browser navigation, or filesystem mutation may execute without satisfying deterministic policy authorization and explicit user approval gates.
2. **Deterministic & Hermetic Testing:** Test suites must execute deterministically without relying on live external LLM API endpoints or unpinned network dependencies. All LLM streams, browser backends, and MCP transports must support fully deterministic mocks.
3. **Negative-Path Priority:** Security boundaries are verified primarily through negative fixtures (attempted path traversal, shell injection, token replay, undeclared tool execution, and secret leakage).
4. **End-to-End Protocol Invariance:** Wire contracts defined in `@nanoforge/protocol` serve as the single source of truth for both backend Fastify handlers and frontend React components.

```
+---------------------------------------------------------------------------------------------------+
|                                 TEST PYRAMID ARCHITECTURE                                         |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|                                     / \                                                           |
|                                    /   \                                                          |
|                                   / E2E \  <-- Playwright UI & Headless CLI Journeys              |
|                                  /------- \    (Browser Direct, Host Supervised, Approvals)       |
|                                 /           \                                                     |
|                                / Integration \  <-- Fastify WS, Subprocess Runner, SQLite,       |
|                               /---------------\     MCP Client, Playwright Browser Manager        |
|                              /                 \                                                  |
|                             /   Component/Mock  \  <-- React Sections, PlanPanel, ToolRunCards,   |
|                            /---------------------\     IntegrationsPanel, ArtifactDock            |
|                           /                       \                                               |
|                          /       Unit Tests        \  <-- Zod Schemas, Policy Engine, DAG Cycles,  |
|                         /---------------------------\     Model Router, VFS Patch Splicing        |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Test Pyramid Architecture & Execution Matrix

### 2.1 Test Levels & Scopes

| Test Level | Scope & Target Subsystems | Framework / Runner | Execution Target | Verification Target |
|---|---|---|---|---|
| **Level 1: Unit** | Pure logic, Zod validation, DFS DAG cycle detection, model scoring algorithms, VFS patch splicing, regex tokenizers. | `vitest` | `packages/protocol`, `apps/agent-host/src/{policy,planning,router}`, `src/lib/` | Fast, zero-I/O execution (< 2 seconds). |
| **Level 2: Component** | React UI rendering, user interaction, approval state transitions, debounced persistence, dialog reducers. | `vitest` + `@testing-library/react` + `jsdom` | `src/sections/`, `src/components/`, `src/hooks/` | DOM state, accessibility, event handlers. |
| **Level 3: Integration** | Fastify WebSocket server, single-use token auth, `execa` terminal supervision, MCP stdio/SSE client, Playwright browser manager, SQLite audit store. | `vitest` (Node 22) | `apps/agent-host/src/` | Real process execution, loopback IPC, file I/O, secret redaction. |
| **Level 4: E2E System** | Full end-to-end user workflows: Browser-direct chat, host-supervised execution, visual diff assertions, CLI headless automation. | `playwright` | Full monorepo stack | Complete cross-process journeys and visual evidence. |

---

## 3. Verification Matrix Mapped to 7 Core Pillars

The following matrix defines the exhaustive automated test coverage across the 7 architectural pillars:

### Pillar 1: Agent Loop & Multi-Turn Iteration
| Test ID | Test Scope | Target Module | Verification Command | Assertion & Pass Criteria |
|---|---|---|---|---|
| **P1-U1** | Patch Extraction | `src/lib/patchParse.ts` | `npm test -- patchParse.test.ts` | Correctly extracts unified diff block from markdown fence with `--- file: <path>` header. |
| **P1-U2** | VFS Diff Application | `src/lib/vfs.ts` | `npm test -- vfs.test.ts` | Applies hunk additions/deletions to in-memory files; fails cleanly on anchor mismatch. |
| **P1-U3** | Edit-Verify Loop | `src/lib/agentLoop.ts` | `npm test -- agentLoop.test.ts` | Automatically generates verification turn on applied patch; terminates on `LGTM`; caps at `MAX_AUTO_TURNS=2`. |
| **P1-I1** | Host Multi-Turn Loop | `apps/agent-host/src/runs/coordinator.ts` | `npm run test:host -- coordinator.test.ts` | Feeds tool execution output back into model turn context for iterative error resolution. |
| **P1-I2** | SSE Token Streaming | `apps/agent-host/src/providers/openaiCompatible.ts` | `npm run test:host -- openaiCompatible.test.ts` | Parses OpenAI SSE chunks and emits real-time `model.delta` wire frames without swallowing text. |

### Pillar 2: Multi-Agent & Subagent Hierarchy
| Test ID | Test Scope | Target Module | Verification Command | Assertion & Pass Criteria |
|---|---|---|---|---|
| **P2-U1** | Subagent Protocol Schemas | `packages/protocol/src/subagent.ts` | `npm run test:protocol` | Validates `invoke_subagent`, `manage_subagents`, and `send_message` Zod contracts. |
| **P2-I1** | Subagent Lifecycle Supervision | `apps/agent-host/src/agents/supervisor.ts` | `npm run test:host -- supervisor.test.ts` | Spawns child agent in isolated `.agents/<id>/` folder; tracks heartbeats; terminates on timeout. |
| **P2-I2** | Cross-Agent Mailbox Bus | `apps/agent-host/src/agents/mailbox.ts` | `npm run test:host -- mailbox.test.ts` | Routes messages between parent and child agents; triggers reactive wakeup on pending promises. |
| **P2-I3** | Failure Escalation Ladder | `apps/agent-host/src/agents/supervisor.ts` | `npm run test:host -- escalation.test.ts` | Executes 4-tier recovery (Retry $\to$ Replace $\to$ Redistribute $\to$ Escalate) on subagent crash. |

### Pillar 3: Planning Mode & Approvals
| Test ID | Test Scope | Target Module | Verification Command | Assertion & Pass Criteria |
|---|---|---|---|---|
| **P3-U1** | DAG Cycle & Dependency | `packages/protocol/src/plan.ts` | `npm run test:protocol` | `readySteps()` releases steps strictly when all upstream dependencies succeed. |
| **P3-U2** | Plan Structural Validation | `apps/agent-host/src/planning/validatePlan.ts` | `npm run test:host -- validatePlan.test.ts` | Rejects duplicate IDs, cyclic dependencies, and side-effecting steps lacking `approval: "required"`. |
| **P3-C1** | Client Approval Ledger | `src/sections/PlanPanel.tsx` | `npm test -- PlanPanel.test.tsx` | Blocks execution of `approval: "required"` steps until explicit button click; downgrades rogue states. |
| **P3-I1** | Plan Modification Diff | `apps/agent-host/src/runs/coordinator.ts` | `npm run test:host -- planDiff.test.ts` | Pauses execution when agent proposes plan diff; resumes only upon explicit `approval.grant` frame. |

### Pillar 4: Artifacts & Rich UI Panels
| Test ID | Test Scope | Target Module | Verification Command | Assertion & Pass Criteria |
|---|---|---|---|---|
| **P4-C1** | Monaco Diff Editor | `src/components/artifacts/MonacoDiffViewer.tsx` | `npm test -- MonacoDiffViewer.test.tsx` | Mounts side-by-side diff; toggles inline mode; highlights modified hunks correctly. |
| **P4-C2** | Mermaid Diagram Rendering | `src/components/RichText.tsx` | `npm test -- RichText.test.tsx` | Renders SVG diagram from ```mermaid code block; falls back to code view on parse error. |
| **P4-C3** | Live Iframe Sandbox | `src/components/artifacts/LiveSandbox.tsx` | `npm test -- LiveSandbox.test.tsx` | Injects sandboxed HTML/CSS/JS; isolates storage; catches and displays runtime exceptions. |
| **P4-C4** | Slash Command Palette | `src/sections/ChatComposer.tsx` | `npm test -- ChatComposer.test.tsx` | Typing `/` renders command popover; selecting `/plan` populates prompt template. |

### Pillar 5: Terminal & Headless Execution
| Test ID | Test Scope | Target Module | Verification Command | Assertion & Pass Criteria |
|---|---|---|---|---|
| **P5-I1** | Supervised Process Execution | `apps/agent-host/src/terminal/runner.ts` | `npm run test:host -- runner.test.ts` | Spawns process with `shell: false`; streams chunks; terminates process tree on timeout/cancel. |
| **P5-I2** | 1MB Output Ring Buffer | `apps/agent-host/src/terminal/runner.ts` | `npm run test:host -- runner.test.ts` | Caps memory usage at 1MB when subprocess outputs runaway text; computes SHA-256 digest. |
| **P5-I3** | Headless CLI Runner | `apps/agent-host/src/cli/index.ts` | `npm run test:host -- cli.test.ts` | `nanoforge run "<prompt>" --json` executes non-interactively; outputs structured JSON event stream. |
| **P5-C1** | Embedded XTerm PTY Dock | `src/sections/TerminalDock.tsx` | `npm test -- TerminalDock.test.tsx` | Binds bidirectional WebSocket terminal stream; handles resize frames and ANSI escape sequences. |

### Pillar 6: Tool Safety & Policy Engine
| Test ID | Test Scope | Target Module | Verification Command | Assertion & Pass Criteria |
|---|---|---|---|---|
| **P6-U1** | CWD Workspace Confinement | `apps/agent-host/src/policy/policy.ts` | `npm run test:host -- policy.test.ts` | Strictly denies any tool request where `cwd` is outside `policy.workspaceRoot`. |
| **P6-U2** | Shell & Privilege Denial | `apps/agent-host/src/policy/policy.ts` | `npm run test:host -- policy.test.ts` | Denies `cmd`, `powershell`, `bash`, `sh`, `sudo`, `runas`, and metacharacters (`&&`, `\|`, `;`). |
| **P6-U3** | Whitelist vs Ask List | `apps/agent-host/src/policy/policy.ts` | `npm run test:host -- policy.test.ts` | Auto-allows `git status/diff`; prompts `ask` for `npm`, `cargo`, and write operations. |
| **P6-I1** | Redacted SQLite Audit Store | `apps/agent-host/src/audit/store.ts` | `npm run test:host -- store.test.ts` | Records append-only event ledger; redacts secrets (`env:VAR_NAME`); saves artifacts to disk. |

### Pillar 7: Extensibility (MCP, Skills, Rules, Plugins)
| Test ID | Test Scope | Target Module | Verification Command | Assertion & Pass Criteria |
|---|---|---|---|---|
| **P7-I1** | MCP Stdio Tool Sandbox | `apps/agent-host/src/mcp/client.ts` | `npm run test:host -- client.test.ts` | Reconciles declared tools; quarantines undeclared tools; injects secrets strictly into child env. |
| **P7-I2** | MCP SSE Transport | `apps/agent-host/src/mcp/sseTransport.ts` | `npm run test:host -- sseTransport.test.ts` | Establishes SSE connection over HTTP POST + EventSource; passes JSON-RPC messages. |
| **P7-I3** | Rules Precedence & Globs | `apps/agent-host/src/rules/loadRules.ts` | `npm run test:host -- loadRules.test.ts` | Applies global/project rules deterministically; filters by `appliesTo` file globs. |
| **P7-I4** | Skill Content Hash Check | `apps/agent-host/src/skills/registry.ts` | `npm run test:host -- registry.test.ts` | Locks skill execution if YAML content hash does not match disk contents. |

---

## 4. Verification Matrix Mapped to 4 Roadmap Phases

```
+---------------------------------------------------------------------------------------------------+
| ROADMAP MILESTONE ACCEPTANCE GATES                                                                |
+-------------------+----------------------------------------------------+--------------------------+
| Roadmap Phase     | Core Verification Gate                             | Automated Suite Target   |
+-------------------+----------------------------------------------------+--------------------------+
| **Phase 1 Gate**  | Monaco Diff + Mermaid + Slash Popover + Sandbox    | `npm test` (Frontend)    |
| **Phase 2 Gate**  | Visual DAG Authoring + Dual Approval Policy        | `npm run test:host`      |
| **Phase 3 Gate**  | Headless CLI (`nanoforge run`) + XTerm PTY Dock    | `npm run test:e2e:cli`   |
| **Phase 4 Gate**  | Multi-Agent Superposition + Background Daemons     | Full Monorepo CI Suite   |
+-------------------+----------------------------------------------------+--------------------------+
```

### 4.1 Phase 1 Acceptance Gate (Free/Easy UI & Artifacts)
- [ ] `npm test -- MonacoDiffViewer.test.tsx` passes with 100% assertion coverage.
- [ ] `npm test -- RichText.test.tsx` verifies Mermaid SVG generation and KaTeX rendering.
- [ ] `npm test -- ChatComposer.test.tsx` validates slash command popover keyboard navigation (`ArrowDown`, `Enter`).
- [ ] `npm test -- LiveSandbox.test.tsx` verifies iframe error boundary captures runtime syntax errors.
- [ ] Total frontend test count exceeds 210 passing tests.

### 4.2 Phase 2 Acceptance Gate (Planning Mode & Interactive DAG)
- [ ] `npm run test:protocol` passes for all phase-grouped `ExecutionPlan` contracts.
- [ ] `npm run test:host -- validatePlan.test.ts` confirms cycle detection on dynamic graph edits.
- [ ] `npm test -- PlanPanel.test.tsx` verifies that manual step reordering updates dependencies correctly.
- [ ] Interactive approval gates prevent unauthorized execution of side-effecting steps in all test scenarios.

### 4.3 Phase 3 Acceptance Gate (Headless CLI & Terminal Ergonomics)
- [ ] `npm run test:host -- cli.test.ts` validates non-interactive execution (`nanoforge run "<prompt>" --auto-approve=safe` / `--yes`).
- [ ] CLI emits structured JSON event stream when `--output=json` / `--output=ndjson` flag is provided.
- [ ] `npm run test:host -- cli.test.ts` validates non-interactive fail-closed termination (Exit Code 4 `ERR_APPROVAL_DENIED`) when encountering unapproved `ask` policy under `--auto-approve=none`.
- [ ] `npm run test:host -- runner.test.ts` verifies real-time stdout/stderr chunk streaming to WebSocket subscribers with backpressure flow control.
- [ ] `npm test -- TerminalDock.test.tsx` verifies bidirectional xterm.js PTY keystroke forwarding.

### 4.4 Phase 4 Acceptance Gate (Multi-Agent Swarm & Daemons)
- [ ] `npm run test:host -- supervisor.test.ts` verifies concurrent execution of 3+ subagents in isolated `.agents/` folders with max depth validation (tier <= 3).
- [ ] `npm run test:host -- mailbox.test.ts` verifies bidirectional message passing and reactive wakeups (including sender failure / termination fallback wakeups).
- [ ] `npm run test:host -- daemon.test.ts` verifies background dev server persistence, process tree teardown, and log tailing.
- [ ] Escalation ladder autonomously recovers simulated failing worker agents.

---

## 5. Automated Regression Test Plans & Negative Security Fixtures

Security boundaries are strictly enforced through a dedicated suite of negative security tests (`apps/agent-host/test/security/`):

```typescript
// Example Negative Security Test Suite: apps/agent-host/test/security/policyEscape.test.ts
import { describe, expect, it } from "vitest";
import { authorize, defaultPolicy } from "../../src/policy/policy";

describe("Security Boundaries: Negative Attack Fixtures", () => {
  const policy = { ...defaultPolicy, workspaceRoot: "C:\\projects\\app" };

  it("N1: Traversal Escape: Denies path escaping workspace root", () => {
    const decision = authorize({
      kind: "terminal.exec",
      cwd: "C:\\projects\\app\\..\\..\\Windows\\System32",
      executable: "git",
      args: ["status"],
    }, policy);
    expect(decision).toBe("deny");
  });

  it("N2: Command Injection: Denies chained shell metacharacters", () => {
    const decision = authorize({
      kind: "terminal.exec",
      cwd: "C:\\projects\\app",
      executable: "git",
      args: ["status", "&&", "rmdir", "/s", "/q", "C:\\"],
    }, policy);
    expect(decision).toBe("deny");
  });

  it("N3: Shell Binary Denial: Denies direct invocation of cmd/powershell/bash", () => {
    for (const shell of ["cmd.exe", "powershell.exe", "pwsh", "bash", "sh", "zsh"]) {
      const decision = authorize({
        kind: "terminal.exec",
        cwd: "C:\\projects\\app",
        executable: shell,
        args: ["-c", "dir"],
      }, policy);
      expect(decision).toBe("deny");
    }
  });

  it("N4: Privilege Escalation Denial: Denies sudo/runas/psexec", () => {
    for (const bin of ["sudo", "runas", "psexec", "doas"]) {
      const decision = authorize({
        kind: "terminal.exec",
        cwd: "C:\\projects\\app",
        executable: bin,
        args: ["whoami"],
      }, policy);
      expect(decision).toBe("deny");
    }
  });
});
```

### Table of Negative Security Fixtures
| Fixture ID | Threat Scenario | Attack Payload | Expected Enforcement Result |
|---|---|---|---|
| **SEC-N1** | Directory Traversal Escape | `cwd: "/app/../../etc/passwd"` | Hard `deny` via `isWithinWorkspace` boundary check. |
| **SEC-N2** | Shell Metacharacter Chaining | `args: ["status", ";", "curl evil.com"]` | Hard `deny` via `COMPOSITION_RE` regex scan. |
| **SEC-N3** | Single-Use Token Replay | Re-connecting WebSocket with used token | Socket closed immediately with status `4401 Unauthorized`. |
| **SEC-N4** | Undeclared MCP Tool Call | Calling `mcp.db.dropTable` when not in `def.tools` | Host rejects execution with `QuarantinedToolError`. |
| **SEC-N5** | Browser Origin Escape | Navigating from `localhost:3000` to `evil.com` | Blocked before HTTP request; dispatches approval dialog. |
| **SEC-N6** | Audit Ledger Secret Leak | Storing command with `env:GITHUB_TOKEN` | Token is resolved only in child env; redacted as `***` in SQLite ledger. |
| **SEC-N7** | Side-Effect Step Execution | Running `file.write` without user approval grant | Coordinator halts step in `blocked` state. |
| **SEC-N8** | Symlink / NTFS Junction Escape | Symlink pointing from workspace to `/etc` or `C:\Windows` | Hard `deny` via canonical `fs.realpathSync` workspace check. |
| **SEC-N9** | Non-Interactive Headless Deadlock | `ask` policy tool encountered under `--auto-approve=none` | Immediate fail-closed exit with Exit Code 4 (`ERR_APPROVAL_DENIED`). |
| **SEC-N10**| Root Deletion Guard Bypass | `rm -rf /` or `del /s /q C:\` under `--auto-approve=all` | Unconditionally hard-denied by root deletion guard. |
| **SEC-N11**| Cross-Subagent Workspace Pollution | Subagent attempting file writes into `.agents/<other_id>/` | Hard `deny` via subagent folder confinement ACL. |

---

## 6. Protocol Validation Harnesses & Mock Fixtures

To enable hermetic testing of both frontend UI and backend host without live network calls, NanoForge utilizes two primary test harnesses:

### 6.1 Deterministic Mock LLM Provider (`apps/agent-host/test/fixtures/mockProvider.ts`)
Allows injecting scripted SSE token streams, tool proposals, and deliberate error responses:
```typescript
export class MockLLMProvider {
  private script: Array<{ text?: string; toolCall?: ToolCallProposal; delayMs?: number }> = [];

  enqueueTextDelta(text: string) { this.script.push({ text }); return this; }
  enqueueToolProposal(tool: ToolCallProposal) { this.script.push({ toolCall: tool }); return this; }

  async *streamChat(): AsyncGenerator<ProviderDelta> {
    for (const item of this.script) {
      if (item.text) yield { type: "text", text: item.text };
      if (item.toolCall) yield { type: "tool_call", tool: item.toolCall };
    }
  }
}
```

### 6.2 WebSocket Session Invariance Harness (`apps/agent-host/test/fixtures/wsHarness.ts`)
Spawns an ephemeral loopback Fastify WebSocket server, attaches the agent protocol, generates a valid cryptographic token, and exposes typed send/receive helpers for integration testing.

---

## 7. Playwright End-to-End Test Suite Specifications

Playwright E2E tests (`test/e2e/`) run against a compiled production build to verify full browser journeys:

### Suite E2E-1: Browser-Direct Mode Full Journey (`test/e2e/directMode.spec.ts`)
1. User loads `http://localhost:5173`.
2. Connects with mock API key.
3. Enters prompt: *"Add rate limiting to server.ts"*.
4. Verifies SSE streaming message renders in chat transcript.
5. Verifies `PatchCard` appears with unified diff preview.
6. Clicks **Apply Patch**.
7. Verifies in-memory VFS updates and file viewer displays new code.
8. Verifies auto-verification turn triggers and displays assistant's `LGTM` badge.

### Suite E2E-2: Host-Supervised Plan Execution Journey (`test/e2e/hostPlan.spec.ts`)
1. Local agent host daemon boots on loopback.
2. Web UI connects over authenticated WebSocket (`?token=...`).
3. Submits task: *"Run test suite and fix broken test"*.
4. Verifies `PlanPanel` renders with multi-step DAG.
5. Side-effecting step (`terminal.exec: npm test`) triggers `ApprovalRequiredModal`.
6. User clicks **Grant Approval**.
7. Subprocess executes; streamed terminal output renders in `ToolRunCard`.
8. Visual evidence card displays passing assertion metrics and diff screenshot.
9. Audit SQLite store is verified on disk for redacted records.

---

## 8. CI/CD Automation Pipeline & Pre-Commit Quality Gates

### 8.1 GitHub Actions Workflow (`.github/workflows/verify.yml`)
```yaml
name: NanoForge Comprehensive Quality & Verification Gate

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  verify:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ ubuntu-latest, windows-latest, macos-latest ]
        node-version: [ 22.x ]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install Monorepo Dependencies
        run: npm ci

      - name: Protocol Typecheck & Contract Tests
        run: |
          npm run typecheck:protocol
          npm run test:protocol

      - name: Agent Host Typecheck & Unit/Integration Tests
        run: |
          npm run typecheck:host
          npm run test:host

      - name: Frontend Linter & Unit Tests
        run: |
          npm run lint
          npm run test

      - name: Production Web Build
        run: npm run build

      - name: Install Playwright Browsers
        run: npx playwright install --with-deps chromium

      - name: Playwright E2E Verification Suites
        run: npx playwright test
```

### 8.2 Local Unified Verification Script
Developers execute a single command before submitting changes:
```powershell
npm run verify:all
```
*Script executes:* `typecheck:protocol` $\to$ `test:protocol` $\to$ `typecheck:host` $\to$ `test:host` $\to$ `lint` $\to` `test` $\to$ `build`.

---

## 9. Audit & Forensic Integrity Verification

To satisfy the **Integrity Mandate** and enable independent verification by the Forensic Auditor:

### 9.1 Verification Checklist for Independent Auditors
1. **Zero Hardcoded Outputs:** Run codebase-wide grep searches for mock hashes, fabricated test strings, or bypass toggles:
   ```powershell
   grep -rn "LGTM" src/lib/
   grep -rn "bypassAuth" apps/agent-host/
   ```
2. **Deterministic Test Execution:** Execute all test runners and verify 100% genuine pass status:
   ```powershell
   # 1. Protocol Tests (Pure contracts)
   npm run test:protocol

   # 2. Agent Host Tests (16 suites, 158 tests)
   npm run test:host

   # 3. Frontend Unit & Component Tests
   npm test

   # 4. Monorepo Production Build
   npm run build
   ```
3. **Cryptographic Ledger Validation:** Verify that the SQLite audit ledger created during test execution (`.nanoforge/audit.db`) contains valid SHA-256 digests and zero plain-text secrets.

---

## 10. Conclusion

This End-to-End Verification Plan establishes a rock-solid, multi-layered testing harness for NanoForge. By coupling pure unit validation with exhaustive negative security fixtures, deterministic mock harnesses, and full Playwright E2E journeys, NanoForge guarantees enterprise-grade reliability, unbreakable security containment, and rapid development velocity across all roadmap milestones.
