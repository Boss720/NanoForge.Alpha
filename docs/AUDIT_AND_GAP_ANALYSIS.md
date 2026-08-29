# Comprehensive Architectural Audit & 7-Pillar Capability Gap Analysis: NanoForge

**Document Version:** 1.0.0  
**Classification:** Technical Architecture & Forensic Audit  
**Date:** 2026-08-15  
**Target Repository:** `nano-forge` (`apps/agent-host`, `packages/protocol`, `src/`)  
**Auditor:** Teamwork Preview Audit & Gap Matrix Specialist

---

## Table of Contents

1. [Executive Summary & Architectural Foundations](#1-executive-summary--architectural-foundations)
2. [Codebase Anatomy & Module Inventory](#2-codebase-anatomy--module-inventory)
   - [2.1 Backend Agent Host (`apps/agent-host/src/`)](#21-backend-agent-host-appsagent-hostsrc)
   - [2.2 Shared Protocol Package (`packages/protocol/src/`)](#22-shared-protocol-package-packagesprotocolsrc)
   - [2.3 React Frontend & State Pipeline (`src/`)](#23-react-frontend--state-pipeline-src)
3. [Dual Execution Model Deep Dive](#3-dual-execution-model-deep-dive)
   - [3.1 Model A: Browser-Direct In-Memory VFS Execution](#31-model-a-browser-direct-in-memory-vfs-execution)
   - [3.2 Model B: Privileged Fastify WebSocket Host DAG Execution](#32-model-b-privileged-fastify-websocket-host-dag-execution)
   - [3.3 Architectural Comparison & Divergence Analysis](#33-architectural-comparison--divergence-analysis)
4. [End-to-End Execution Loop Tracing](#4-end-to-end-execution-loop-tracing)
   - [4.1 Lifecycle of an Agent Turn in Agent-Host](#41-lifecycle-of-an-agent-turn-in-agent-host)
   - [4.2 Lifecycle of an Agent Turn in Browser-Direct Mode](#42-lifecycle-of-an-agent-turn-in-browser-direct-mode)
5. [In-Depth Engine Audits & Security Invariants](#5-in-depth-engine-audits--security-invariants)
   - [5.1 Sandboxing & Policy Engine (`policy.ts`)](#51-sandboxing--policy-engine-policyts)
   - [5.2 Supervised Terminal Runner (`terminal/runner.ts`)](#52-supervised-terminal-runner-terminalrunnerts)
   - [5.3 Append-Only Redacted SQLite Audit Ledger (`audit/store.ts`)](#53-append-only-redacted-sqlite-audit-ledger-auditstorets)
   - [5.4 MCP Client Engine (`mcp/client.ts`, `sseTransport.ts`)](#54-mcp-client-engine-mcpclientts-ssetransportts)
   - [5.5 Managed Playwright Browser & Visual Diff Verifier (`browser/`)](#55-managed-playwright-browser--visual-diff-verifier-browser)
   - [5.6 Extensibility: Skills, Rules, and Plugin Packages](#56-extensibility-skills-rules-and-plugin-packages)
6. [Comprehensive 7-Pillar Capability Gap Matrix](#6-comprehensive-7-pillar-capability-gap-matrix)
   - [Pillar 1: Agent Loop & Context / Multi-Turn Iteration](#pillar-1-agent-loop--context--multi-turn-iteration)
   - [Pillar 2: Multi-Agent & Subagents](#pillar-2-multi-agent--subagents)
   - [Pillar 3: Planning & Approvals](#pillar-3-planning--approvals)
   - [Pillar 4: Artifacts & UI Panels](#pillar-4-artifacts--ui-panels)
   - [Pillar 5: Terminal & Headless Execution](#pillar-5-terminal--headless-execution)
   - [Pillar 6: Tool Safety & Policy Engine](#pillar-6-tool-safety--policy-engine)
   - [Pillar 7: Extensibility (MCP, Skills, Rules, Plugins)](#pillar-7-extensibility-mcp-skills-rules-plugins)
7. [Synthesis of Critical Architectural Bottlenecks](#7-synthesis-of-critical-architectural-bottlenecks)
8. [Actionable Recommendations & Strategic Trajectory](#8-actionable-recommendations--strategic-trajectory)

---

## 1. Executive Summary & Architectural Foundations

NanoForge is a high-assurance, multi-model agentic workspace combining a reactive React web interface with a privileged local Fastify WebSocket daemon (`apps/agent-host`). The system is architected around deterministic execution security: LLMs operate in an unprivileged context where all proposed side effects (terminal execution, filesystem modifications, browser automation, and MCP tool invocations) are intercepted, validated against cryptographic policies, audited to an append-only SQLite ledger, and subjected to interactive approval gates.

```
+-------------------------------------------------------------------------------------------------------+
|                                           NANOGORGE CLIENT (src/)                                     |
|                                                                                                       |
|   +---------------------------------------------+   +---------------------------------------------+   |
|   |         Browser-Direct VFS Mode             |   |            Host-Supervised Mode             |   |
|   |  - OpenAI-compatible SSE (/chat/completions)|   |  - HostClient WebSocket (ws://127.0.0.1)   |   |
|   |  - React in-memory VFS (VirtualFile[])      |   |  - PlanPanel DAG Tracker & Approval Ledger  |   |
|   |  - 2-turn auto-verify loop (LGTM check)     |   |  - BrowserPermissionDialog (2-tier gate)    |   |
|   |  - Local debounced storage (nanoforge.v1)   |   |  - VisualEvidenceCard (Pixelmatch diffs)    |   |
|   +---------------------------------------------+   +---------------------------------------------+   |
+--------------------------------------------------------------------|----------------------------------+
                                                                     | ws://127.0.0.1:<port>/agent?token=...
                                                                     v
+-------------------------------------------------------------------------------------------------------+
|                                       APPS / AGENT-HOST (Daemon)                                      |
|                                                                                                       |
|   +-----------------------------------------------------------------------------------------------+   |
|   |  server.ts (Fastify HTTP/WS) + TokenStore Auth (Single-use Cryptographic Bearer Tokens)        |   |
|   +-----------------------------------------------------------------------------------------------+   |
|                                                    |                                                  |
|                                                    v                                                  |
|   +-----------------------------------------------------------------------------------------------+   |
|   |  session.ts (WebSocket Session Handler, Event Multiplexing, Workspace RPCs)                   |   |
|   +-----------------------------------------------------------------------------------------------+   |
|                                                    |                                                  |
|                                                    v                                                  |
|   +-----------------------------------------------------------------------------------------------+   |
|   |  runs/coordinator.ts (DAG Execution Plan Coordinator)                                         |   |
|   |  - DFS Cycle & Dependency Validation (planning/validatePlan.ts)                              |   |
|   |  - Multi-Criteria Model Routing (router/router.ts - 60% Capability, 20% Latency, 20% Cost)    |   |
|   |  - SSE Model Adapter (providers/openaiCompatible.ts)                                          |   |
|   |  - Policy Engine Gate (policy/policy.ts - CWD confinement, Shell Denial, Metacharacter Deny)  |   |
|   |  - Interactive Socket Approval Gate (SocketApprovalGate)                                      |   |
|   |  - Supervised Execa Subprocess Runner (terminal/runner.ts - 1MB Ring Buffer, Capped Env)     |   |
|   |  - Redacted Append-Only SQLite Ledger (audit/store.ts - audit.db, SHA-256 Digest Chain)       |   |
|   +-----------------------------------------------------------------------------------------------+   |
|                                                    |                                                  |
|   +-------------------+   +--------------------+   +-------------------+   +----------------------+   |
|   |   mcp/client.ts   |   | browser/manager.ts |   |   workspace/fs    |   | skills/ & rules/     |   |
|   |  - Stdio/SSE MCP  |   |  - Playwright /    |   |  - Path confinement|   |  - YAML skill parser |   |
|   |  - 7 Security     |   |    FakeBackend     |   |  - Git status     |   |  - Markdown rules    |   |
|   |    Gates          |   |  - Visual Assert   |   |  - Search & Watch |   |  - SHA-256 hash lock |   |
|   +-------------------+   +--------------------+   +-------------------+   +----------------------+   |
+-------------------------------------------------------------------------------------------------------+
```

### Key Architectural Strengths
1. **Unprivileged Model Proposals:** The LLM cannot execute code directly. It generates structured proposals (`ProposedToolCall`) that pass through an authorization matrix before spawning OS processes.
2. **Defensive Policy Engine:** `apps/agent-host/src/policy/policy.ts` implements strict CWD confinement, hardcoded shell denial (`cmd`, `powershell`, `bash`), metacharacter composition detection (`&&`, `||`, `;`, backticks), and explicit read-only whitelisting (`git status`, `node -v`).
3. **Tamper-Evident Audit Ledger:** `apps/agent-host/src/audit/store.ts` records every run, event, and artifact to an append-only SQLite database (`audit.db`) with automatic secret redaction and a continuous SHA-256 digest hash chain.
4. **Decoupled Verification Seams:** The browser automation subsystem (`apps/agent-host/src/browser/manager.ts`) provides clean interface abstraction (`BrowserBackend`) enabling automated testing via `FakeBackend` without spinning up heavyweight Chromium processes.

---

## 2. Codebase Anatomy & Module Inventory

The repository is organized as a pnpm/npm monorepo containing `apps/agent-host`, `packages/protocol`, `src/`, and supporting configuration.

### 2.1 Backend Agent Host (`apps/agent-host/src/`)

| Module Path | Primary Responsibility | Critical Types / Functions | Lines |
|---|---|---|---|
| `server.ts` | Fastify HTTP + WebSocket server setup, token lifecycle, loopback binding | `AgentHostServer`, `TokenStore`, `startServer()` | 280 |
| `session.ts` | WebSocket connection handler, incoming message validation, RPC dispatcher | `AgentSession`, `SocketApprovalGate`, `parseClientMessage()` | 266 |
| `runs/coordinator.ts` | ExecutionPlan DAG runner, model dispatching, step state machine, tool invocation | `RunCoordinator`, `RunHandle`, `RunContext`, `drive()` | 910 |
| `policy/policy.ts` | Security evaluation, workspace boundary check, shell/composition detection | `authorize()`, `isWithinWorkspace()`, `resolveWithinWorkspace()` | 186 |
| `terminal/runner.ts` | Supervised child process spawning via Execa, env sanitization, ring buffer | `runTerminalJob()`, `DEFAULT_ENV_ALLOWLIST`, `ringBuffer` | 321 |
| `audit/store.ts` | SQLite append-only ledger (`audit.db`), SHA-256 digest chain, artifact storage | `AuditStore`, `recordEvent()`, `recordArtifact()`, `endRun()` | 461 |
| `audit/redact.ts` | Secret redaction engine replacing known tokens with `[REDACTED:...]` | `redactText()`, `redactObject()`, `buildRedactor()` | 120 |
| `router/router.ts` | Multi-criteria model scoring algorithm (60% Cap, 20% Lat, 20% Cost) | `route()`, `capabilityScore()`, `latencyScore()`, `costScore()` | 198 |
| `providers/openaiCompatible.ts` | SSE streaming adapter for OpenAI-compatible chat completion endpoints | `OpenAICompatibleAdapter`, `streamChat()` | 285 |
| `mcp/client.ts` | MCP client with 7-gate sandboxing, secret reference injection, tool namespacing | `withMcpServer()`, `validateToolArgs()`, `resolveSecretEnv()` | 416 |
| `mcp/sseTransport.ts` | Custom SSE transport implementation for remote MCP servers over HTTP/SSE | `SseClientTransport` implementing `@modelcontextprotocol/sdk` | 112 |
| `mcp/types.ts` | MCP server definitions, tool schemas, secret reference validators | `McpServerDefinition`, `secretReferenceSchema` | 111 |
| `browser/manager.ts` | Playwright & in-memory browser automation manager, action execution | `BrowserManager`, `PlaywrightBackend`, `FakeBackend` | 508 |
| `browser/origins.ts` | Browser origin matching, localhost validation, redirect verification | `isOriginAllowed()`, `matchOriginPattern()` | 124 |
| `browser/visual.ts` | Visual DOM assertions and pixel-by-pixel diff engine via pixelmatch/pngjs | `evaluateAssertions()`, `compareScreenshots()` | 298 |
| `workspace/filesystem.ts` | Confined filesystem operations (readDir, readFile, writeFile, search, gitStatus) | `readDir()`, `readFile()`, `writeFile()`, `search()`, `gitStatus()` | 280 |
| `skills/registry.ts` | YAML-based skill definition parser, instruction validator, SHA-256 lock | `SkillRegistry`, `loadSkills()`, `computeSkillHash()` | 190 |
| `rules/loadRules.ts` | Markdown rules pack parser and context injection formatter | `loadRulesPacks()`, `formatRulesContext()` | 160 |
| `plugins/plugins.ts` | Compound plugin packager (combining Skills, Rules, and MCP definitions) | `loadPlugin()`, `packagePlugin()`, `PluginManifest` | 210 |

---

### 2.2 Shared Protocol Package (`packages/protocol/src/`)

The `packages/protocol` package contains core data models:

| File | Responsibilities | Key Exports | Lines |
|---|---|---|---|
| `plan.ts` | Execution plan data structures, step states, and DAG ready-step resolution | `StepStatus`, `StepEstimate`, `PlanStep`, `ExecutionPlan`, `readySteps()` | 86 |
| `routing.ts` | Model capabilities, privacy rankings, token estimators, and scoring formulas | `PrivacyClass`, `PRIVACY_RANK`, `TaskKind`, `ModelProfile`, `RouteRequest`, `RouteDecision`, `scoreProfile()` | 213 |
| `index.ts` | Barrel file re-exporting `plan.ts` and `routing.ts` | `* from "./plan"`, `* from "./routing"` | 7 |

#### Protocol Fragmentation Deficit
`packages/protocol` only exports plan and routing data types. The WebSocket wire protocol schemas (`apps/agent-host/src/protocol.ts`) and frontend client types (`src/lib/hostClient.ts`) are completely detached from `packages/protocol`, creating triple maintenance overhead and schema drift risk.

---

### 2.3 React Frontend & State Pipeline (`src/`)

The frontend is a Vite + React application featuring Tailwind CSS, Radix UI primitives, Lucide icons, and Recharts.

| Section / Component | Purpose | Key Interfaces & State Hooks | Lines |
|---|---|---|---|
| `src/App.tsx` | Master coordinator: dual-mode execution routing, drawer layouts, NanoGPT streaming | `useHostSession()`, `NanoModel[]`, `VirtualFile[]`, `Session[]` | 800 |
| `src/sections/ChatPanel.tsx` | Transcript renderer, auto-verify loop UI, streaming output, patch decisions | `ToolRunCard`, `MessageBubble`, `onPatchDecision`, `onToolStop` | 501 |
| `src/sections/PlanPanel.tsx` | Execution plan visualizer, dependency badges, client-side approval ledger | `ExecutionPlan`, `approvedSteps: Set<string>`, `onApproveStep` | 244 |
| `src/sections/WorkspaceExplorer.tsx` | Tree view for host workspace with git status, search, and file inspector | `FileTreeNode`, `useWorkspace()`, `onFileSelect` | 320 |
| `src/sections/BrowserPermissionDialog.tsx` | 2-tier approval dialog: Origin session grants vs one-shot sensitive actions | `BrowserPermissionRequest`, `onDecide("allow_session" \| ...)` | 293 |
| `src/sections/IntegrationsPanel.tsx` | Tabbed settings for Skills, Rules Packs, MCP Servers, and Plugins | `SkillRowView`, `McpRowView`, `PluginRowView`, `onToggleIntegration` | 380 |
| `src/sections/CostDashboard.tsx` | Spend analytics using Recharts (lifetime totals, daily area chart, model bars) | `UsageRun[]`, `UsageTotals`, `CostBarChart`, `DailySpendChart` | 172 |
| `src/sections/VisualEvidenceCard.tsx` | Side-by-side visual diff card rendering baseline, current, overlay, assertions | `VisualAssertionResult[]`, `VisualDiffResult` | 210 |
| `src/lib/hostSession.ts` | React hook bridging WebSocket wire frames to reactive state | `useHostSession()`, `HostSession`, `ToolRun[]`, `pendingApprovals` | 642 |
| `src/lib/hostClient.ts` | WebSocket client connecting to `ws://127.0.0.1:<port>/agent` | `HostClient`, `parseHostMessage()`, `request()`, `send()` | 414 |
| `src/lib/agentLoop.ts` | 2-turn browser-direct edit-verify loop (diff parsing, LGTM check) | `MAX_AUTO_TURNS = 2`, `shouldAutoVerify()`, `verificationPrompt()` | 76 |
| `src/lib/vfs.ts` | In-memory virtual file system supporting anchor-based patch splicing | `applyPatch()`, `revertPatch()`, `findAnchorRegion()` | 132 |

---

## 3. Dual Execution Model Deep Dive

NanoForge operates in two fundamentally different operational paradigms:

```
+---------------------------------------------------------------------------------------------------+
|                                     EXECUTION PARADIGM COMPARISON                                 |
+====================================+==================================+===========================+
| Feature Dimension                  | Model A: Browser-Direct VFS      | Model B: Fastify Host DAG |
+====================================+==================================+===========================+
| Transport Layer                    | HTTP SSE (/chat/completions)     | WebSocket (ws://127.0.0.1) |
+------------------------------------+----------------------------------+---------------------------+
| Target Filesystem                  | In-Memory React State (VFS)      | Real OS Filesystem (Disk) |
+------------------------------------+----------------------------------+---------------------------+
| Terminal / Command Execution       | None (Simulated Diff Patches)    | Real OS Subprocesses      |
+------------------------------------+----------------------------------+---------------------------+
| Authorization / Policy Check       | User clicks Apply Patch          | Policy Engine + SocketGate|
+------------------------------------+----------------------------------+---------------------------+
| Multi-Turn Feedback Loop           | 2-turn auto-verify (LGTM check)  | None (Single-shot DAG)    |
+------------------------------------+----------------------------------+---------------------------+
| LLM Streaming UX                   | Live token-by-token text delta   | Swallowed in coordinator  |
+------------------------------------+----------------------------------+---------------------------+
| Browser Automation                 | None                             | Playwright + Pixelmatch   |
+------------------------------------+----------------------------------+---------------------------+
| MCP Server Support                 | None                             | Stdio / SSE MCP Client    |
+------------------------------------+----------------------------------+---------------------------+
| Persistence                        | LocalStorage (nanoforge.v1)      | SQLite (audit.db)         |
+------------------------------------+----------------------------------+---------------------------+
```

### 3.1 Model A: Browser-Direct In-Memory VFS Execution

In Browser-Direct Mode (`src/App.tsx:337-395`), the web client communicates directly with any OpenAI-compatible API endpoint (e.g. NanoGPT, OpenRouter, Local Ollama):
1. **State Isolation:** All file operations occur on an in-memory `VirtualFile[]` array (`src/lib/vfs.ts`). The model outputs unified diff code blocks (````diff ... ````).
2. **Patch Extraction & Splicing:** `src/lib/patchParse.ts` extracts structured `Patch` objects. `src/lib/vfs.ts:applyPatch()` locates anchor regions via fuzzy 3-line context matching and splices changes into the virtual file.
3. **Auto-Verify Loop (`src/lib/agentLoop.ts`):** If a patch is applied and auto-verify is enabled, the system constructs a synthetic user turn:
   ```markdown
   Applied the following diff to <filePath>:
   <diffBody>
   Verify whether this change fulfills the requirements. If correct, reply LGTM. Otherwise provide a correcting diff.
   ```
   The loop continues for up to `MAX_AUTO_TURNS = 2` turns or terminates when the model outputs `LGTM` without further diff blocks.

### 3.2 Model B: Privileged Fastify WebSocket Host DAG Execution

In Host Mode (`apps/agent-host`), execution is delegated to a local daemon:
1. **Loopback Authentication:** When the daemon launches, it generates a single-use cryptographic token (`TokenStore` in `server.ts:132-186`). The frontend connects via `ws://127.0.0.1:<port>/agent?token=<token>`.
2. **DAG Plan Execution:** The host receives a pre-constructed `ExecutionPlan` (`packages/protocol/src/plan.ts`). `RunCoordinator` validates the graph with DFS cycle detection, computes model routing scores, calls the LLM for a tool proposal, evaluates the policy engine, prompts the user if policy is `ask`, and executes the command via supervised Execa.
3. **Audit Recording:** Every step state transition, tool execution digest, and generated artifact is persisted to `.nanoforge/runs/audit.db`.

### 3.3 Architectural Comparison & Divergence Analysis

The primary architectural disconnect in NanoForge is that **neither mode is complete on its own**:
- **Browser Mode** has multi-turn iterative reasoning and smooth token-by-token streaming, but cannot execute real terminal commands, access the real filesystem, or use MCP servers.
- **Host Mode** has full OS access, sandboxed subprocesses, Playwright verification, and tamper-evident auditing, but its execution is limited to a single-shot step runner where LLM output streaming is discarded and terminal outputs are never fed back to the model for multi-turn reasoning.

---

## 4. End-to-End Execution Loop Tracing

### 4.1 Lifecycle of an Agent Turn in Agent-Host

The execution flow of a single plan step in `apps/agent-host` proceeds through 10 distinct phases:

```
[1. Submit Plan] ──> [2. DAG Validation] ──> [3. Step Ready Check] ──> [4. Model Routing]
                                                                               │
                                                                               v
[8. Audit Record] <── [7. Supervised Exec] <── [6. Approval Gate] <── [5. Policy Check] <── [Provider SSE]
       │
       v
[9. Browser Evidence] ──> [10. Step Settled (Succeeded/Failed)]
```

#### Detailed Phase Walkthrough:
1. **Submission & Ingest (`session.ts:224-233`):**  
   The client sends `{ type: "plan.submit", plan: { id, goal, steps } }`. Fastify validates the payload using Zod schema `planSubmitSchema`.
2. **DAG Cycle & Dependency Validation (`planning/validatePlan.ts:26-107`):**  
   The validator checks for: (a) Duplicate step IDs; (b) References to non-existent dependencies; (c) Cycles using Depth-First Search; (d) Invariant: Any step with `sideEffecting: true` must have `approval: "required"`.
3. **Step Scheduling (`runs/coordinator.ts:509-524`):**  
   `readySteps(livePlan)` filters steps with `status === "pending"` whose upstream `dependsOn` steps are all `status === "succeeded"`.
4. **Scored Model Routing (`router/router.ts:115-198`):**  
   `route(request, profiles, options)` executes hard exclusions (privacy class rank, vision capability, token context window fit, provider health) and scores eligible models using:
   $$\text{Score} = 0.6 \cdot \text{Capability} + 0.2 \cdot \text{Latency} + 0.2 \cdot \text{Cost}$$
5. **Model Proposal Streaming (`providers/openaiCompatible.ts:120-285`):**  
   The adapter streams from the model endpoint. Assistant text chunks accumulate locally in `text += delta.text`. Tool proposals accumulate into `ProposedToolCall[]`.
   - *Audit Finding:* `coordinator.ts:862` swallows `delta.text`. It does NOT stream tokens over the WebSocket to the client.
6. **Policy Authorization (`policy/policy.ts:122-185`):**  
   `authorize(request, policy)` inspects: (a) CWD confinement within `workspaceRoot`; (b) Denied shell binaries (`cmd`, `powershell`, `bash`, `sh`, `zsh`); (c) Shell metacharacters (`&&`, `||`, `;`, backticks, `$()`); (d) Redirection operators (`>`, `<`); (e) Whitelist (`git status`, `git log`, `node -v`); (f) Ask list (`npm`, `cargo`, write operations).
7. **Interactive Socket Approval Gate (`session.ts:53-88`):**  
   If policy returns `ask`, `SocketApprovalGate.requestApproval` emits `{ type: "tool.approval_required", requestId, runId, request, reason }` over WebSocket and awaits user approval.
8. **Supervised Subprocess Execution (`terminal/runner.ts:165-320`):**  
   `runTerminalJob()` executes the binary with `shell: false`, a stripped environment allowlist (`DEFAULT_ENV_ALLOWLIST`), and a 1MB memory ring buffer.
   - *Audit Finding:* Terminal stdout/stderr events (`handle.events`) are buffered and hashed, but not forwarded in real-time over WebSocket.
9. **Tamper-Evident Audit Recording (`audit/store.ts:150-250`):**  
   The SHA-256 digest of stdout/stderr is written to `audit.db` along with redacted event metadata, updating the run's cumulative digest hash chain.
10. **Step Settling (`runs/coordinator.ts:636-644`):**  
    Step transitions to `succeeded` and emits `step.succeeded`.
    - *Critical Gap:* The output of `terminal.exec` is **NOT fed back to the LLM**. Each plan step is strictly a single-shot execution.

---

### 4.2 Lifecycle of an Agent Turn in Browser-Direct Mode

```
[User Prompt] ──> [NanoGPT SSE Stream] ──> [Real-time Token Render] ──> [Extract ```diff]
                                                                               │
                                                                               v
[LGTM / Max Auto Turns Reached] <── [Apply Patch to VFS] <── [Synthetic Verify Prompt]
```

1. **Streaming Generation:** `streamChat()` connects to `/chat/completions` and yields token deltas directly to `ChatPanel.tsx`.
2. **Diff Extraction:** When generation finishes, `src/lib/patchParse.ts` detects unified diff blocks and renders `PatchCard.tsx`.
3. **Patch Application:** User clicks "Apply Patch", mutating `virtualFiles` in React state via `src/lib/vfs.ts`.
4. **Autonomous Follow-up:** If `autoVerify` is enabled, `agentLoop.ts` dispatches a verification prompt to the LLM. If the assistant responds with `LGTM` and no further diff blocks, the loop completes.

---

## 5. In-Depth Engine Audits & Security Invariants

### 5.1 Sandboxing & Policy Engine (`policy.ts`)

`apps/agent-host/src/policy/policy.ts` implements a multi-layer deterministic security boundary:

```typescript
// Core Policy Invariants from policy.ts:
1. Workspace Confinement:
   isWithinWorkspace(req.cwd, policy.workspaceRoot) === true // Rejects ../ escapes

2. Shell Denial:
   DENIED_SHELLS = ["cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", 
                    "pwsh.exe", "bash", "sh", "zsh", "fish", "cscript", "wscript", "mshta", "wsl"]
   // Matches basename(req.executable) -> Returns "deny"

3. Privilege Escalation Denial:
   DENIED_COMMANDS = ["sudo", "doas", "runas", "psexec"] -> Returns "deny"

4. Metacharacter Composition Denial:
   COMPOSITION_RE = /&&|\|\||[;|`&]|\$\(|\$\{|\r|\n/ -> Returns policy.compositionDecision ("deny")

5. Redirection Gating:
   REDIRECTION_RE = /[<>]/ -> Returns policy.redirectionDecision ("ask")

6. Read-Only Whitelist (Auto-Allow):
   "git status", "git log", "git diff", "git show", "node -v", "npm -v", "python -V", "ls", "pwd"
```

#### Security Strengths & Edge Cases
- **Descriptor Redirection Handling:** `policy.ts:155-167` explicitly strips harmless descriptor redirections (`2>&1`, `>>`, `<`) before evaluating composition regex, preventing false-positive denials while maintaining safety.
- **Limitation:** `ToolRequest` is currently hardcoded as a single shape `{ kind: "terminal.exec", ... }`. Non-terminal operations (browser automation, MCP calls, file writes) cannot pass through the policy engine without returning `deny` (line 123).

---

### 5.2 Supervised Terminal Runner (`terminal/runner.ts`)

`apps/agent-host/src/terminal/runner.ts` executes child processes under a strict supervision contract:

1. **No Shell Invocation:** Subprocesses are spawned exclusively via Execa with `shell: false`, passing structured `executable + args[]`. This eliminates shell injection vulnerabilities.
2. **Environment Sanitization:** Process environment is scrubbed against `DEFAULT_ENV_ALLOWLIST` (`PATH`, `SystemRoot`, `TEMP`, `HOME`, `USERPROFILE`). Secret API keys (`OPENAI_API_KEY`, `NANOGPT_API_KEY`, etc.) in `process.env` are stripped before spawning child processes.
3. **Bounded Memory Ring Buffer:** Process output is captured in a 1 MiB sliding ring buffer (`DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024`). When output exceeds 1 MiB, earlier chunks are discarded, the tail is preserved, and `truncated: true` is set on the result.
4. **Process Tree Termination:** On timeout (default 60s) or cancellation:
   - On Windows: Spawns `taskkill /pid <PID> /t /f` to terminate the entire process tree.
   - On POSIX: Dispatches `process.kill(-pid, "SIGKILL")` to the process group.

---

### 5.3 Append-Only Redacted SQLite Audit Ledger (`audit/store.ts`)

`apps/agent-host/src/audit/store.ts` implements a tamper-evident audit store using Node.js built-in `node:sqlite DatabaseSync`:

```
Database Schema (audit.db):
--------------------------------------------------------------------------------
runs:
  - id TEXT PRIMARY KEY
  - goal TEXT NOT NULL
  - state TEXT NOT NULL
  - started_at TEXT NOT NULL
  - ended_at TEXT
  - digest TEXT                <-- Tamper-evident cumulative SHA-256 hash

events:
  - run_id TEXT NOT NULL
  - seq INTEGER NOT NULL       <-- Monotonic sequence counter
  - type TEXT NOT NULL
  - at TEXT NOT NULL
  - payload TEXT NOT NULL      <-- Pre-redacted JSON payload
  - PRIMARY KEY (run_id, seq)

artifacts:
  - id TEXT PRIMARY KEY
  - run_id TEXT NOT NULL
  - step_id TEXT
  - name TEXT NOT NULL
  - relative_path TEXT NOT NULL
  - mime_type TEXT NOT NULL
  - byte_length INTEGER NOT NULL
  - sha256 TEXT NOT NULL       <-- Content-addressable hash
```

#### Security Contracts
- **Automatic Secret Redaction:** All event payloads and text artifacts pass through `redactObject()` and `redactText()` before writing to SQLite or disk. Known secret values are replaced with `[REDACTED:len=...]`.
- **Append-Only Invariant:** There are no `UPDATE` or `DELETE` SQL statements for events. Any attempt to rewrite `(run_id, seq)` triggers a SQLite primary key constraint failure.
- **Tamper-Evident Hash Chain:** Every recorded event hash is folded into the run's cumulative digest:
  $$\text{Digest}_{k} = \text{SHA256}(\text{Digest}_{k-1} + \text{EventHash}_k)$$
  The final digest is committed to the `runs` table when `endRun()` is called.

---

### 5.4 MCP Client Engine (`mcp/client.ts`, `sseTransport.ts`)

`apps/agent-host/src/mcp/client.ts` implements a Model Context Protocol client with 7 discrete security gates:

1. **Registry Gate:** Server must be explicitly enabled in `mcp-servers.json`.
2. **Command Verification:** Launch command and arguments must byte-for-byte match the registered definition.
3. **Pre-Execution User Approval:** `approvalFn` must return true before the child process is spawned.
4. **Secret Reference Injection:** Environment variables use secret references (`env:SECRET_NAME`). Secrets are resolved from the host environment at runtime and passed only to the child process.
5. **Tool Namespace Reconciliation:** Advertised tools from `tools/list` are checked against declared `def.tools`. Undeclared tools are quarantined into `rejectedTools`. Callable tools are exposed as `mcp.<server>.<tool>`.
6. **JSON Schema Argument Validation:** `validateToolArgs()` validates parameters against property types, required fields, enum constraints, and rejects undeclared properties (`additionalProperties: false`).
7. **Deterministic Process Cleanup:** Subprocesses are terminated in a `finally` block upon completion or error.

#### MCP Gaps vs Full Specification
- **Tools Only:** NanoForge currently implements only MCP **Tools**. It does NOT implement MCP **Resources** (`resources/list`, `resources/read`), MCP **Prompts** (`prompts/list`, `prompts/get`), MCP **Roots** (`roots/list`), or MCP **Sampling** (`sampling/createMessage`).
- **Ephemeral Lifecycle:** `withMcpServer` spawns and terminates the MCP process per execution. It does not maintain a persistent connection pool.

---

### 5.5 Managed Playwright Browser & Visual Diff Verifier (`browser/`)

The browser subsystem (`apps/agent-host/src/browser/`) provides headless browser automation and visual verification:

1. **Backend Abstraction:** `BrowserBackend` interface decouples automation logic from Playwright, allowing `FakeBackend` (in-memory mock) for fast unit testing and `PlaywrightBackend` (Chromium) for real rendering.
2. **Restricted Action Surface:** Actions are strictly limited to `navigate`, `click`, `fill`, `extract_text`, and `screenshot`. Arbitrary JavaScript evaluation (`page.evaluate`) is forbidden.
3. **Origin Sandboxing (`origins.ts`):** Target URLs are validated against an allowlist pattern (`scheme://host[:port]`) before navigation and after navigation (to catch HTTP redirects).
4. **Visual Regression Engine (`visual.ts`):** Evaluates DOM assertions (`expect_visible`, `expect_text`, `expect_url`) and performs pixel-by-pixel image comparisons using `pngjs` and `pixelmatch`, generating a visual diff artifact (`overlay.png`).

---

### 5.6 Extensibility: Skills, Rules, and Plugin Packages

1. **YAML Skills (`skills/registry.ts`):** Skills are defined in YAML/Markdown with declared allowed tools. A SHA-256 digest is computed over instructions; if modified on disk without updating the hash, execution is blocked.
2. **Markdown Rules Packs (`rules/loadRules.ts`):** System rules are loaded from markdown files in `.nanoforge/rules/` and injected into the LLM system prompt.
3. **Plugin Packages (`plugins/plugins.ts`):** Compound bundles combining Skills, Rules Packs, and MCP Server definitions into installable packages.

---

## 6. Comprehensive 7-Pillar Capability Gap Matrix

This matrix provides a detailed, technical comparison across all 7 core capability pillars between **NanoForge**, **Claude Code CLI**, **Claude Desktop**, and **Antigravity**.

```
=================================================================================================================================
                                          7-PILLAR CAPABILITY GAP MATRIX
=================================================================================================================================
```

### Pillar 1: Agent Loop & Context / Multi-Turn Iteration

| Capability Dimension | NanoForge (Current) | Claude Code CLI | Claude Desktop | Antigravity |
|---|---|---|---|---|
| **Loop Execution Model** | Static DAG Plan (Host) / 2-Turn auto-verify (Browser) | Autonomous multi-turn REPL loop | Single-turn prompt $\to$ tool response loop | Multi-turn Goal/Task execution loop with reactive wakeups |
| **Tool Output Feedback** | **Deficit:** Tool outputs are hashed & stored, but NOT fed back to LLM in Host mode | Full stdout/stderr fed back to model for reasoning & error recovery | Full MCP tool result returned to model | Full tool outputs returned to model with adaptive error recovery |
| **Streaming Token Delivery** | **Deficit:** Swallowed in `coordinator.ts:862`; no live stream to Host UI | Live real-time ANSI token streaming in terminal | Real-time SSE token streaming in UI | Real-time bi-directional WebSocket token streaming |
| **Context Window Management** | Basic token budgeting reserving 25% output (`src/lib/context.ts`) | Automatic context compaction & `/compact` command | Basic sliding window | Intelligent context window budgeter with summarization & pinning |
| **Turn Checkpointing & Rewind** | None; step failure marks DAG blocked | Turn history rewind & session rollback | Fork conversation from message | Full state checkpointing, turn branching, and retry |

---

### Pillar 2: Multi-Agent & Subagents

| Capability Dimension | NanoForge (Current) | Claude Code CLI | Claude Desktop | Antigravity |
|---|---|---|---|---|
| **Subagent Hierarchy** | **Deficit:** No subagent support in runtime or protocol | Single agent with background task support | None | Hierarchical Agent Trees (Parent $\to$ Subagents $\to$ Leaf Workers) |
| **Cross-Agent Messaging** | **Deficit:** No mailbox or messaging bus | None | None | Bi-directional typed mailbox protocol (`send_message`) |
| **Workspace Isolation** | Single shared workspace directory | Single shared workspace | Single desktop context | Folder-based metadata isolation (`.agents/<agent_name>_<id>/`) |
| **Liveness & Heartbeats** | None | Process spinner | None | Periodic heartbeat via `progress.md` with timeout alarms |
| **Concurrency Control** | Single-threaded step runner | Async background jobs | Single thread | Parallel subagent execution with join/barrier synchronization |

---

### Pillar 3: Planning & Approvals

| Capability Dimension | NanoForge (Current) | Claude Code CLI | Claude Desktop | Antigravity |
|---|---|---|---|---|
| **Plan Formulation** | Pre-constructed static `ExecutionPlan` | Interactive natural language todo lists | None | Antigravity-style Planning Mode (Draft $\to$ Plan $\to$ Approval $\to$ Run) |
| **Plan Modification & Editing** | **Deficit:** Read-only in UI; cannot edit or add steps | Dynamic in-session todo list updating | None | Interactive plan authoring, phase re-ordering, step insertion |
| **Phase & Grouping Hierarchy** | Flat array of steps with `dependsOn` | Flat task list | None | Multi-phase groupings (Discovery $\to$ Execution $\to$ Verification) |
| **Approval Gating** | Deterministic Client-side Ledger (`PlanPanel.tsx`) | CLI confirmation prompt per destructive tool | MCP tool approval prompt | Multi-level approval gates (Proceed, Review Diff, Skip, Abort) |
| **DAG Visualization** | Badge list with dependency IDs | Text list with status markers | None | Interactive DAG graph visualizer with live step progression |

---

### Pillar 4: Artifacts & UI Panels

| Capability Dimension | NanoForge (Current) | Claude Code CLI | Claude Desktop | Antigravity |
|---|---|---|---|---|
| **Dedicated Artifact Dock** | **Deficit:** Fragmented across chat cards & modal viewer | Terminal inline diffs | Dedicated Right-rail Artifact Panel | Multi-tab Artifact Dock with version history carousel |
| **Code Diff Editor** | Basic line-by-line `+/-` diff card (`PatchCard.tsx`) | Colored unified diffs in terminal | Side-by-side diff renderer | Monaco Editor side-by-side & unified diffs with syntax highlighting |
| **Live Web Sandbox** | None | None | HTML/JS interactive sandbox preview | Live iframe sandbox with Hot-Reload for HTML/React/SVG |
| **Diagrams & Visuals** | Minimal custom markdown renderer (`RichText.tsx`) | ASCII art | Markdown + SVG | Native Mermaid.js rendering + KaTeX math notation |
| **Cost & Usage Tracking** | Recharts Cost Dashboard with daily/model spend | Built-in `/cost` command | Token count in settings | Live token budget & real-time cost telemetry per run |

---

### Pillar 5: Terminal & Headless Execution

| Capability Dimension | NanoForge (Current) | Claude Code CLI | Claude Desktop | Antigravity |
|---|---|---|---|---|
| **Interactive Terminal (PTY)** | **Deficit:** No xterm.js; static `<pre>` text cards | Full interactive PTY / Ink TUI | None | Embedded multi-tab xterm.js terminal dock with PTY backend |
| **Interactive stdin Support** | **Deficit:** Cannot send input to running process | Full terminal stdin support | None | `send_input` tool support for interactive CLI programs |
| **Headless CLI Execution** | **Deficit:** Fastify daemon only; no standalone CLI | Rich CLI flags (`-p`, `--output json`, non-interactive) | None | Full headless CLI engine (`nanoforge run "<prompt>" --json`) |
| **Background Daemons & Tasks** | **Deficit:** Synchronous block capped at 60s | Background bash processes | None | Long-running background daemons, test watchers, dev servers |
| **Timer & Cron Scheduling** | None | None | None | One-shot timers & cron schedules (`schedule` tool) |

---

### Pillar 6: Tool Safety & Policy Engine

| Capability Dimension | NanoForge (Current) | Claude Code CLI | Claude Desktop | Antigravity |
|---|---|---|---|---|
| **Policy Enforcement Engine** | `policy.ts` (Workspace root, Shell denial, Regex) | Prompt-based user approval & allowlist | Server-level toggle | Comprehensive Policy Engine with Granular ACLs & Capabilities |
| **Tool Type Polymorphism** | **Deficit:** Strictly `terminal.exec` only | Polymorphic tools (Bash, File, Glob, Edit) | MCP Tools | Polymorphic Tool Union (Terminal, FS, Browser, MCP, Subagents) |
| **File Path Permissions** | Workspace root containment check | Workspace boundary check | Sandboxed desktop access | Granular path pattern rules (e.g. read-only `.env`, protected dirs) |
| **Audit Ledger & Redaction** | Tamper-evident SQLite `audit.db` + SHA-256 hash chain | Session log file | None | Redacted append-only SQLite audit ledger with provenance chain |
| **Browser Security** | 2-tier approval dialog (Origin session vs Sensitive action) | None | None | Strict origin matching + screenshot redaction + visual assertions |

---

### Pillar 7: Extensibility (MCP, Skills, Rules, Plugins)

| Capability Dimension | NanoForge (Current) | Claude Code CLI | Claude Desktop | Antigravity |
|---|---|---|---|---|
| **MCP Tools** | Stdio & SSE transports with 7 security gates | Native MCP stdio tool execution | Full MCP client (Tools) | Full MCP client & server ecosystem |
| **MCP Resources & Prompts** | **Deficit:** Not implemented | Prompts supported via CLI | Full support (Resources, Prompts) | Full support for Resources, Prompts, Roots, and Sampling |
| **MCP Lifecycle Management** | Ephemeral process spawned & killed per run | Persistent connection pool | Persistent connection | Stateful MCP Connection Pool with health checks & auto-reconnect |
| **Custom Skills System** | YAML skill definitions with SHA-256 hash lock | Markdown instructions | Prompt instructions | Dynamic Skill Registry with local dumps & capability bounds |
| **Rules Packs & Plugins** | Markdown rules + Compound ZIP/Folder Plugin bundles | `.clauderc` rules | System prompt configs | Granular rule packs with priority ordering & dynamic loading |
| **Slash Command Engine** | **Deficit:** Model switcher only (`Cmd+K`) | Native slash commands (`/compact`, `/cost`, `/pr`)| None | Extensible Slash Command Engine (`/plan`, `/goal`, `/browse`, `/learn`) |

---

## 7. Synthesis of Critical Architectural Bottlenecks

From the forensic audit across `apps/agent-host`, `packages/protocol`, and `src/`, five critical bottlenecks prevent NanoForge from achieving its full potential:

```
+-----------------------------------------------------------------------------------------------+
|                             5 CORE ARCHITECTURAL BOTTLENECKS                                  |
+===============================================================================================+
| 1. Disconnected Tool Output Feedback Loop                                                     |
|    - Coordinator runs terminal commands, stores hashes in SQLite, but does NOT feed stdout/  |
|      stderr back to the LLM for multi-turn error correction and test verification.            |
+-----------------------------------------------------------------------------------------------+
| 2. Tool Surface Bottleneck (Hardcoded terminal.exec)                                          |
|    - policy.ts, coordinator.ts, and protocol.ts hardcode kind: "terminal.exec". Filesystem    |
|      RPCs, BrowserManager, and MCP client are siloed and cannot be invoked by the LLM.        |
+-----------------------------------------------------------------------------------------------+
| 3. Protocol & Schema Fragmentation                                                            |
|    - packages/protocol is an orphaned stub (plan/routing only). Wire schemas live in          |
|      apps/agent-host, while frontend duplicates types in hostClient.ts.                       |
+-----------------------------------------------------------------------------------------------+
| 4. Missing Interactive Terminal & Headless CLI Engine                                         |
|    - No xterm.js / PTY integration (static text cards only). No standalone CLI binary for    |
|      running prompts or executing plans in headless CI/CD environments.                       |
+-----------------------------------------------------------------------------------------------+
| 5. Absence of Subagents, Planning Authoring & Artifact Canvas                                 |
|    - Multi-agent coordination is absent from the protocol. Planning is read-only. Diffs and   |
|      previews are fragmented across chat cards without a dedicated Monaco/Mermaid dock.       |
+-----------------------------------------------------------------------------------------------+
```

---

## 8. Actionable Recommendations & Strategic Trajectory

To systematically eliminate these bottlenecks, the engineering execution should be structured into four sequential phases following an **"Easy/Free High-Impact First"** strategy:

### Phase 1: Free/Easy High-Value UI & Artifact System
- Deploy `@monaco-editor/react` side-by-side diff viewer and live preview canvas in a dedicated `ArtifactDock`.
- Upgrade markdown rendering with `react-markdown`, `remark-gfm`, `mermaid`, and KaTeX.
- Unify `@nanoforge/protocol` as the single source of truth for all wire schemas.

### Phase 2: Planning Mode & Slash Command Engine
- Build the interactive Plan Composer with phase groupings (Discovery, Execution, Verification) and dynamic DAG graph rendering.
- Implement the Slash Command Engine in the chat composer (`/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/compact`, `/cost`).
- Bridge the host execution loop to feed tool outputs back to the LLM for iterative multi-turn repair.

### Phase 3: Headless CLI & Terminal Ergonomics (xterm.js & PTY)
- Integrate `@xterm/xterm` with node-pty backend into a dockable bottom terminal panel.
- Implement standalone CLI executable (`nanoforge run "<prompt>"`, `--json` streaming) for headless automation.
- Add background daemon task supervisor with ring-buffer logs and timeout management.

### Phase 4: Full Multi-Agent Orchestration & Persistent MCP Pool
- Implement hierarchical subagent lifecycle (`invoke_subagent`, `manage_subagents`, `send_message`) with `.agents/` isolated folder conventions.
- Build the Multi-Agent Fleet Visualizer tree and inter-agent message inspector in the UI.
- Upgrade MCP client to a persistent connection pool supporting MCP Resources, Prompts, Roots, and Sampling.

---
*End of Audit & Gap Analysis Document.*
