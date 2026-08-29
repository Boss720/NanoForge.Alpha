# NanoForge Phased Delivery Roadmap & Architecture Strategy

**Document Version:** 1.0.0  
**Status:** Production-Ready Technical Specification  
**Author:** Worker 4 (Roadmap & Verification Architecture Specialist)  
**Target System:** NanoForge Multi-Agent Engineering Platform  
**Target Repository:** `c:/Users/Hp/Documents/kimi/Workspaces/kpkoj/nano-forge`  

---

## 1. Executive Summary & Strategy

NanoForge is a high-performance local agent development platform built on React 19, Fastify, and WebSocket-driven privilege separation. While its foundational security boundaries (CWD containment, cryptographic session tokens, process isolation, and SQLite-backed audit trails) are best-in-class, significant developer experience and capability gaps exist when benchmarked against industry leaders: **Claude Code CLI**, **Claude Desktop**, and **Antigravity IDE**.

To close these gaps rapidly while minimizing development risk, compute cost, and engineering friction, this roadmap defines a **4-Phase Delivery Strategy** centered on an **"Easy/Free-First"** value hierarchy:

1. **Immediate High-Value, Zero-Compute UX Wins First (Phase 1):** Elevate developer ergonomics in the UI through client-side diff editors (Monaco), rich diagrammatic Markdown (Mermaid), slash command palettes, and an isolated Artifact Dock—requiring **zero** additional LLM token costs or complex backend distributed state.
2. **Deterministic Planning & Visual Approvals (Phase 2):** Introduce Antigravity-style visual DAG authoring, step reordering, and phase-grouped execution plans with strict dual-gate policy enforcement.
3. **Headless CLI & Interactive PTY Terminal (Phase 3):** Bridge local workflows with a standalone CLI runner (`nanoforge run`) and full bidirectional virtual terminal emulation (`@xterm/xterm` + `node-pty`).
4. **Autonomous Multi-Agent Orchestration & Daemon Superposition (Phase 4):** Deploy hierarchical subagent trees (`invoke_subagent`), inter-agent mailbox protocols (`send_message`), supervisor failure escalation ladders, and background daemon task runners.

```
+---------------------------------------------------------------------------------------------------+
|                                 NANOGORGE EVOLUTION TIMELINE                                      |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  [PHASE 1: Easy/Free UI & Artifacts]                                                              |
|  - Monaco Side-by-Side Diff Editor                                                                |
|  - Markdown + Mermaid.js + KaTeX Engine                                                           |
|  - Inline Slash Command Popover (/plan, /browse, /learn, /cost)                                   |
|  - Dedicated Artifact Dock & Sandboxed Iframe Canvas                                              |
|  --> Friction: LOW | Token Cost: ZERO | Eng Days: 3-4                                             |
|                                                                                                   |
|           |                                                                                       |
|           v                                                                                       |
|  [PHASE 2: Interactive Planning Mode]                                                             |
|  - Antigravity-Style Visual DAG Composer (@xyflow/react)                                          |
|  - Multi-Phase Plan Grouping (Discovery -> Execution -> Verification)                             |
|  - Interactive Step Reordering, Dynamic Branching & Modification Diffs                           |
|  - Hard Client/Host Dual Approval Gates                                                           |
|  --> Friction: MED-LOW | Token Cost: LOW (Single Shot) | Eng Days: 4-5                            |
|                                                                                                   |
|           |                                                                                       |
|           v                                                                                       |
|  [PHASE 3: Headless CLI & Terminal Ergonomics]                                                    |
|  - Standalone CLI Runner (`nanoforge run`, `-p`, `--json`, `--output`)                             |
|  - Real-Time Token & Terminal Output Streaming Wire Protocol                                      |
|  - Multi-Tab Embedded PTY Terminal Dock (@xterm/xterm + node-pty)                                 |
|  - Interactive Stdin/Resize IPC Framing                                                           |
|  --> Friction: MEDIUM | Token Cost: MODERATE | Eng Days: 5-6                                      |
|                                                                                                   |
|           |                                                                                       |
|           v                                                                                       |
|  [PHASE 4: Full Multi-Agent Orchestration & Daemons]                                              |
|  - Hierarchical Subagent Tree (Root -> Orchestrator -> Specialist)                                |
|  - Cross-Agent Mailbox Protocol (send_message, reactive wakeups)                                  |
|  - Background Daemon Supervisor (Dev servers, watchers, cron timers)                              |
|  - Supervisor Failure Escalation (Retry -> Replace -> Skip -> Redistribute -> Degrade)            |
|  - Multi-Workspace / Git Worktree Isolation (.agents/ conventions)                               |
|  --> Friction: HIGH | Token Cost: DYNAMIC/PARALLEL | Eng Days: 7-9                                |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Strategy Rationale: The "Easy/Free-First" Value Hierarchy

Traditional agent roadmaps often begin with complex multi-agent orchestration or heavy distributed runtimes. This inverted approach leads to high debugging overhead, unstable protocols, and excessive token burn before core developer ergonomics are solidified.

The **Easy/Free-First Strategy** prioritizes features by calculating an **Efficiency Score ($\mathbf{E}$)**:

$$\mathbf{E} = \frac{\text{Developer Ergonomics Impact} \times \text{User Perceived Value}}{\text{Implementation Friction} \times \text{LLM / Infrastructure Operating Cost}}$$

```
+---------------------------------------------------------------------------------------------------+
| VALUE MATRIX: EFFICIENCY SCORING                                                                  |
+-------------------+-----------------+--------------------+------------------+---------------------+
| Feature           | Perceived Value | Implement Friction | Token/Op Cost    | Priority Tier       |
+-------------------+-----------------+--------------------+------------------+---------------------+
| Monaco Diff Dock  | HIGH (9/10)     | LOW (2/10)         | ZERO ($0)        | Phase 1 (Immediate) |
| Mermaid Diagrams  | HIGH (8/10)     | LOW (2/10)         | ZERO ($0)        | Phase 1 (Immediate) |
| Slash Palette     | HIGH (9/10)     | LOW (3/10)         | ZERO ($0)        | Phase 1 (Immediate) |
| Live Iframe Box   | HIGH (8/10)     | LOW (3/10)         | ZERO ($0)        | Phase 1 (Immediate) |
| Plan DAG Composer | VERY HIGH (9/10)| MED (4/10)         | LOW (1 plan call)| Phase 2 (Fast Follow|
| Headless CLI      | VERY HIGH (9/10)| MED (5/10)         | STANDARD         | Phase 3 (Core Infra)|
| XTerm PTY Dock    | HIGH (8/10)     | MED (5/10)         | ZERO ($0)        | Phase 3 (Core Infra)|
| Subagent Swarms   | VERY HIGH (10/10| HIGH (8/10)        | HIGH (N x agents)| Phase 4 (Advanced)  |
| Daemon Supervisor | HIGH (8/10)     | HIGH (7/10)        | LOW-MED          | Phase 4 (Advanced)  |
+-------------------+-----------------+--------------------+------------------+---------------------+
```

### Strategic Benefits:
1. **Immediate User Delight:** Users gain Claude Desktop-level artifact inspection and Antigravity-level slash commands within days, without modifying the host execution backend.
2. **Zero Regressions on Core Security:** Backend policy containment and crypto token handshakes remain untouched while frontend capabilities expand.
3. **Decoupled Architecture:** Protocol schemas in `@nanoforge/protocol` are stabilized early in Phases 1 & 2, ensuring seamless integration when Headless CLI (Phase 3) and Multi-Agent trees (Phase 4) land.

---

## 3. Phase 1: Free/Easy High-Value UI & Artifacts

### 3.1 Executive Summary
Phase 1 focuses exclusively on client-side interface upgrades, rich rendering, and interactive artifact management. By replacing basic text areas and regex-based markdown parsers with industry-standard web components, NanoForge immediately matches the visual polish of Claude Desktop and Antigravity IDE at zero marginal compute cost.

### 3.2 Objectives & Value Proposition
- Provide side-by-side and unified syntax-highlighted code diff inspection.
- Enable full GitHub-Flavored Markdown (GFM), KaTeX mathematical formulas, and Mermaid diagram visualization.
- Implement an inline slash command popover in the chat composer with argument autocomplete.
- Establish a dedicated, tabbed Artifact Dock with live sandboxed HTML/SVG preview capabilities.

### 3.3 Deliverables & Technical Specifications

#### Deliverable 1.1: Dedicated Artifact Dock & Sandboxed Canvas (`src/sections/ArtifactDock.tsx`)
- **Component Architecture:**
  - Dock positioned as a collapsible right-side drawer or resizable split pane (`react-resizable-panels`).
  - Tabs: `Diff Viewer`, `Diagrams`, `Live Sandbox`, `Markdown / Docs`, `Version History`.
  - Version Scrubber: Header timeline allowing users to scrub between artifact revisions (`v1`, `v2`, `v3`).
- **Live Sandbox (`src/components/artifacts/LiveSandbox.tsx`):**
  - Sandboxed `<iframe>` with `sandbox="allow-scripts allow-forms allow-same-origin"`.
  - Auto-injects Tailwind CDN, React 19 UMD, and error boundaries to capture runtime exceptions and render diagnostic banners.

#### Deliverable 1.2: Monaco Side-by-Side Diff Editor (`src/components/artifacts/MonacoDiffViewer.tsx`)
- **Package Integration:** `@monaco-editor/react`.
- **Capabilities:**
  - Side-by-side and inline toggle.
  - Hunk navigation (`F7` / `Shift+F7` next/previous difference).
  - Word-level character difference highlighting.
  - Theme synchronization with NanoForge CSS variables (`--background`, `--foreground`, `--primary`).
  - Read-only review mode with single-click "Stage/Accept Hunk" controls.

#### Deliverable 1.3: Markdown, Mermaid & KaTeX Engine (`src/components/RichText.tsx` Upgrade)
- **Engine Stack:** `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `mermaid`.
- **Capabilities:**
  - Renders interactive Mermaid.js flowcharts, sequence diagrams, state machines, and Gantt charts.
  - Renders inline and block LaTeX equations ($\KaTeX$).
  - Syntax highlighting for 120+ programming languages via `rehype-highlight` / `shiki`.
  - Copy-to-clipboard button and line numbers for all code blocks.

#### Deliverable 1.4: Slash Command Engine & Popover Palette (`src/sections/ChatComposer.tsx`)
- **Trigger:** Typing `/` in the prompt textarea displays an accessible popover anchored to the caret.
- **Initial Command Set:**
  - `/plan <goal>`: Transitions interface into Planning Mode and drafts an initial execution plan.
  - `/goal <description>`: Sets a persistent mission objective banner in the TopBar.
  - `/browse <url>`: Requests a managed browser session for DOM inspection and visual verification.
  - `/learn <concept>`: Analyzes codebase patterns and creates a reusable `.nanoforge/skills/` definition.
  - `/cost`: Opens the interactive Spend & Token Analytics modal (`CostDashboard.tsx`).
  - `/compact`: Triggers context window compaction and history summarization.
  - `/clear`: Resets active session transcript with confirmation.
- **Context Mention Pills:**
  - `@file:<path>`: Triggers fuzzy workspace file autocomplete.
  - `@rule:<name>`: Attaches specific system prompt rules.

### 3.4 Architectural Prerequisites
- Node.js 22 LTS, Vite 7, React 19.
- Clean separation of UI state from host WebSocket transport.

### 3.5 Risk & Mitigation Analysis
| Risk Description | Severity | Likelihood | Mitigation Strategy |
|---|---|---|---|
| **Monaco Bundle Bloat:** Monaco Editor can add ~5MB to client bundle size. | Medium | High | Utilize `React.lazy()` dynamic imports for `@monaco-editor/react` to load the editor only when an artifact tab opens. |
| **Mermaid Parse Failure:** Invalid diagram syntax from LLM markdown causes UI crash. | Low | Medium | Wrap Mermaid renderer in an ErrorBoundary; render fallback syntax-highlighted code block with line error markers on parse exception. |
| **Iframe Sandbox Escape:** Untrusted HTML artifact executing malicious scripts. | High | Low | Enforce strict iframe sandbox attributes (`sandbox="allow-scripts"` without `allow-top-navigation` or `allow-modals`); isolate cookies and origin storage. |

### 3.6 Developer Ergonomics Impact
- Code changes and diffs are instantly readable without mental reconstruction of raw patch text.
- Architecture proposals become immediately tangible via rendered system diagrams.
- Common operations become instantaneous via keyboard-driven slash commands.

### 3.7 Cost & Friction Scoring
- **Implementation Complexity:** 2 / 10
- **Compute / API Token Cost:** $0.00 (Zero marginal LLM cost)
- **Risk Score:** Low (1 / 10)
- **Friction Level:** Very Low
- **Estimated Engineering Effort:** 3–4 Days

---

## 4. Phase 2: Planning Mode & Interactive Plan Composer

### 4.1 Executive Summary
Phase 2 upgrades NanoForge's static DAG execution into an **Antigravity-grade Planning Mode**. Users and agents gain the ability to collaborate interactively on multi-phase execution plans, visually inspect step dependency trees, reorder and edit proposed actions, and enforce strict dual-gate policy approvals before any side-effecting code or shell command executes.

### 4.2 Objectives & Value Proposition
- Replace flat step lists with a visual, interactive DAG workflow canvas.
- Introduce dynamic phase grouping (`Phase 1: Discovery`, `Phase 2: Implementation`, `Phase 3: Verification`).
- Allow human-in-the-loop plan authoring, branch exploration, and step parameter customization.
- Enforce cryptographic and protocol-level approval barriers for side-effecting tasks.

### 4.3 Deliverables & Technical Specifications

#### Deliverable 2.1: Visual DAG Graph & Plan Composer (`src/sections/PlanPanel.tsx` & `src/components/plan/`)
- **Graph Visualization Engine:** `@xyflow/react` (React Flow) or custom SVG DAG renderer.
- **Capabilities:**
  - Interactive dependency node graph showing step dependencies (`dependsOn`), execution status (`pending`, `running`, `succeeded`, `failed`, `blocked`), and estimates.
  - Drag-and-drop step reordering with automatic cycle detection and topological re-indexing.
  - Expandable node details displaying affected scopes (`affectedScopes`), command parameters, and bound artifacts.
  - Phase container grouping with progress percentages per phase.

```
+---------------------------------------------------------------------------------------------------+
| PLAN COMPOSER: VISUAL DAG ARCHITECTURE                                                            |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  +---------------------------+       +----------------------------+                               |
|  | Phase 1: Discovery        | ----> | Phase 2: Implementation    |                               |
|  |  - Step 1: gitStatus [OK] |       |  - Step 3: edit src/api.ts |                               |
|  |  - Step 2: readFile  [OK] |       |    (Approval Required)     |                               |
|  +---------------------------+       +--------------+-------------+                               |
|                                                     |                                             |
|                                                     v                                             |
|                                      +----------------------------+                               |
|                                      | Phase 3: Verification      |                               |
|                                      |  - Step 4: npm test        |                               |
|                                      |  - Step 5: browser.verify  |                               |
|                                      +----------------------------+                               |
+---------------------------------------------------------------------------------------------------+
```

#### Deliverable 2.2: Plan Authoring & Revision Protocol (`packages/protocol/src/plan.ts`)
- **Schema Enhancements:**
  ```typescript
  export interface ExecutionPlanPhase {
    id: string;
    name: string;
    description?: string;
    stepIds: readonly string[];
  }

  export interface ExecutionPlan {
    id: string;
    goal: string;
    phases?: readonly ExecutionPlanPhase[];
    steps: readonly PlanStep[];
    version: number;
    parentPlanId?: string; // For branch exploration
  }

  export interface PlanDiff {
    planId: string;
    addedSteps: PlanStep[];
    modifiedSteps: { stepId: string; changes: Partial<PlanStep> }[];
    removedStepIds: string[];
  }
  ```

#### Deliverable 2.3: Interactive Approval Gates & Modification Diffs
- **Approval State Machine:**
  $$\text{Draft} \xrightarrow{\text{User Validate}} \text{Awaiting Approval} \xrightarrow{\text{Grant}} \text{Executing} \xrightarrow{\text{Error/Halt}} \text{Paused/Blocked}$$
- **Modification Flow:**
  When an agent proposes a plan amendment mid-run, the UI displays a `PlanModificationModal` highlighting added, modified, or skipped steps. The coordinator pauses execution until the user accepts or rejects the plan diff.

#### Deliverable 2.4: Agent Host Plan Coordinator Integration (`apps/agent-host/src/runs/coordinator.ts`)
- Implements phase-aware scheduling in `coordinator.ts`.
- Validates that no step in `Phase N+1` can enter `running` if any blocking prerequisite in `Phase N` has failed.
- Generates structured audit records for every plan edit and approval timestamp.

### 4.4 Architectural Prerequisites
- Completion of Phase 1 (Markdown and UI rendering).
- Unified type exports from `@nanoforge/protocol`.

### 4.5 Risk & Mitigation Analysis
| Risk Description | Severity | Likelihood | Mitigation Strategy |
|---|---|---|---|
| **DAG Cycle Injection:** User or LLM introduces circular dependencies during drag-and-drop reordering. | High | Medium | Execute `validatePlan()` DFS cycle detection on every state transition before committing to host state; show visual error ring on offending nodes. |
| **Approval Fatigue:** Excessive approval prompts for benign steps frustrate developers. | Medium | High | Support session-scoped auto-grant rules for designated read-only tools and safe directory scopes (`tests/`, `docs/`). |

### 4.6 Developer Ergonomics Impact
- Full transparency and control over complex multi-step refactorings before any file is touched.
- Eliminates "rogue agent" edits through deterministic approval gates.
- Clear milestone visualization tracks long-running feature development.

### 4.7 Cost & Friction Scoring
- **Implementation Complexity:** 4 / 10
- **Compute / API Token Cost:** Low (1 initial planning turn per workflow)
- **Risk Score:** Low-Medium (2 / 10)
- **Friction Level:** Low
- **Estimated Engineering Effort:** 4–5 Days

---

## 5. Phase 3: Headless CLI & Terminal Ergonomics

### 5.1 Executive Summary
Phase 3 transforms NanoForge into a unified CLI and GUI engineering system. It introduces a standalone headless command-line interface (`nanoforge run`) capable of executing tasks non-interactively in CI/CD environments, while upgrading the GUI with a full multi-tab `@xterm/xterm` virtual terminal emulator powered by `node-pty`.

### 5.2 Objectives & Value Proposition
- Deliver a native CLI binary for headless automation, scripting, and shell integration.
- Stream LLM reasoning tokens and subprocess `stdout`/`stderr` chunks over WebSocket in real-time.
- Embed a full ANSI-compliant, interactive PTY terminal in the web UI for debugging and manual intervention.
- Support non-interactive exit codes, output formatting (`--json`, `--quiet`), and pipeline chaining.

### 5.3 Deliverables & Technical Specifications

#### Deliverable 3.1: Standalone Headless CLI Engine (`apps/agent-host/src/cli/`)
- **Command Entrypoint:** `nanoforge` / `bin/nanoforge.ts`.
- **Command Syntax & Options:**
  ```bash
  # Execute single-shot prompt non-interactively (--auto-approve safe or alias --yes)
  nanoforge run "Fix TypeScript errors in src/lib/hostClient.ts" --auto-approve=safe --output=json

  # Generate and inspect plan without executing
  nanoforge plan "Migrate database schema to SQLite v2" --output plan.json

  # Run with explicit model and token budget
  nanoforge run "Add unit tests" --model claude-3-5-sonnet --budget-usd 2.00
  ```
- **CLI Capabilities:**
  - Ink / Clack animated spinners and interactive approval prompts in TTY mode.
  - Raw JSON event streaming (`--json`) for IDE and CI/CD ingestion.
  - Standard Unix exit codes: `0` (Success), `1` (Plan Failure), `2` (Policy Denial), `130` (Cancelled).

#### Deliverable 3.2: Full Streaming Wire Protocol (`packages/protocol/src/protocol.ts`)
- **Protocol Frames:**
  ```typescript
  export interface ModelDeltaFrame {
    type: "model.delta";
    runId: string;
    stepId?: string;
    delta: string; // Token chunk
  }

  export interface ToolOutputFrame {
    type: "tool.output";
    runId: string;
    jobId: string;
    stream: "stdout" | "stderr";
    chunk: string; // Raw or ANSI string
  }
  ```
- Unblocks `coordinator.ts` to stream LLM generation directly to the client as tokens arrive.

#### Deliverable 3.3: Embedded Multi-Tab PTY Terminal Dock (`src/sections/TerminalDock.tsx`)
- **Engine Stack:** `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl` + `@xterm/addon-unicode11`.
- **Backend Bridge:** `node-pty` / `execa` PTY session manager in `apps/agent-host/src/terminal/pty.ts`.
- **Capabilities:**
  - Multi-tab management: `Terminal 1`, `Build Server`, `Test Watcher`.
  - Full bidirectional interactive `stdin` (supports interactive prompts, `vim`, `nano`, `top`).
  - Terminal resize negotiation: client window resize sends `{ type: "terminal.resize", cols, rows }`.
  - ANSI 256-color and truecolor theme matching.

```
+---------------------------------------------------------------------------------------------------+
| TERMINAL & HEADLESS ARCHITECTURE                                                                  |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|   [Headless CLI: nanoforge run]                    [Web UI: Terminal Dock (xterm.js)]             |
|              |                                                     |                              |
|              | stdio / exit codes                                  | WebSocket: terminal.input/data|
|              v                                                     v                              |
|   +-------------------------------------------------------------------------------------------+   |
|   |                              APPS / AGENT-HOST SERVER                                     |   |
|   |                                                                                           |   |
|   |   +--------------------------+                 +--------------------------------------+   |   |
|   |   |   CLI Execution Engine   |                 |       PTY Process Supervisor         |   |   |
|   |   |  - Non-interactive loop  |                 |  - node-pty spawn                    |   |   |
|   |   |  - JSON event formatter  |                 |  - 1MB circular output ring buffer   |   |   |
|   |   +--------------------------+                 +--------------------------------------+   |   |
|   |                                                                                           |   |
|   +-------------------------------------------------------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
```

### 5.4 Architectural Prerequisites
- Completion of Phase 1 & Phase 2.
- Integration of `node-pty` native compilation across Windows, macOS, and Linux targets.

### 5.5 Risk & Mitigation Analysis
| Risk Description | Severity | Likelihood | Mitigation Strategy |
|---|---|---|---|
| **Native PTY Compilation Failures:** `node-pty` C++ bindings fail to compile in restricted environments. | High | Medium | Implement pure `execa` non-PTY fallback mode that emulates stream buffering when native PTY bindings are unavailable. |
| **Output Flooding / Memory Leak:** Runaway subprocess generates gigabytes of stdout, crashing the host. | High | Low | Enforce strict 1MB circular ring buffer in `runner.ts`; truncate stream and emit warning frame if buffer overflows. |

### 5.6 Developer Ergonomics Impact
- Parity with Claude Code CLI for terminal-first developers who prefer working from shell scripts and Makefiles.
- Full interactive debugging in the browser without context-switching to an external terminal emulator.
- Real-time token streaming provides immediate visual feedback during long generation turns.

### 5.7 Cost & Friction Scoring
- **Implementation Complexity:** 5 / 10
- **Compute / API Token Cost:** Standard per-turn model rates
- **Risk Score:** Medium (3 / 10)
- **Friction Level:** Medium
- **Estimated Engineering Effort:** 5–6 Days

---

## 6. Phase 4: Full Multi-Agent Orchestration & Daemon/Subagent Engine

### 6.1 Executive Summary
Phase 4 delivers the flagship multi-agent capabilities of Antigravity IDE. It introduces hierarchical subagent delegation (`invoke_subagent`), structured inter-agent message passing (`send_message`), supervisor failure escalation ladders, background daemon management (long-running dev servers, file watchers, cron schedules), and strict multi-workspace file isolation under `.agents/` conventions.

### 6.2 Objectives & Value Proposition
- Enable root orchestrator agents to spawn, monitor, and supervise specialized subagents (e.g. `Explorer`, `Implementer`, `Auditor`).
- Implement reactive wakeups and timer schedules without costly LLM polling loops.
- Support persistent background daemon processes with tail log inspection.
- Provide a robust failure escalation ladder to self-heal stalled, stuck, or failing subtasks.
- Render an interactive Subagent Fleet Monitor in the UI.

### 6.3 Deliverables & Technical Specifications

#### Deliverable 4.1: Subagent Lifecycle & Coordination Protocol (`packages/protocol/src/subagent.ts`)
- **Protocol Schema:**
  ```typescript
  export const subagentArchetypeSchema = z.enum([
    "orchestrator",
    "explorer",
    "implementer",
    "auditor",
    "specialist",
  ]);

  export interface InvokeSubagentParams {
    archetype: z.infer<typeof subagentArchetypeSchema>;
    goal: string;
    assignedFolder: string; // e.g. .agents/explorer_1/
    timeoutSeconds: number;
    scopedPermissions?: PermissionRule[];
  }

  export interface AgentMessageFrame {
    messageId: string;
    senderId: string;
    recipientId: string; // Parent ID, peer ID, or broadcast
    timestamp: string;
    subject: string;
    body: string;
    referencedArtifacts: string[];
  }
  ```

#### Deliverable 4.2: Subagent Supervisor & Process Manager (`apps/agent-host/src/agents/`)
- **Supervisor Topology:**
  ```
  Root Orchestrator (PID: root-001)
  ├── Explorer Subagent (PID: exp-001)  --> Discovers files & writes analysis.md
  ├── Implementer Subagent (PID: imp-001) --> Edits code in workspace
  └── Auditor Subagent (PID: aud-001)    --> Verifies tests & inspects diffs
  ```
- **Supervisor Failure Escalation Ladder:**
  1. **Tier 1 (Retry):** Step fails transiently $\to$ Re-invoke with error diagnostic context (up to 2 retries).
  2. **Tier 2 (Replace):** Subagent exceeds timeout or loops $\to$ Terminate subagent, spawn fresh instance with summarized state from `progress.md`.
  3. **Tier 3 (Redistribute):** Specialist unable to resolve $\to$ Re-assign task to higher-capability model profile.
  4. **Tier 4 (Degrade / Escalate):** Unrecoverable blocker $\to$ Pause DAG, format diagnostic report, and request human intervention.

#### Deliverable 4.3: Background Daemon & Task Scheduler (`apps/agent-host/src/tasks/`)
- **Daemon Supervisor (`apps/agent-host/src/tasks/manager.ts`):**
  - Manages detached long-running background processes (e.g. `npm run dev`, `docker compose up`).
  - Implements ring-buffer log capture with streaming WebSocket tail.
- **Reactive Timer Engine (`schedule`):**
  - One-shot timers (`DurationSeconds`) and recurring cron jobs (`CronExpression`).
  - Wakeup conditions: `never`, `any`, or `<senderId>` (early-cancels timer when a designated subagent completes).

#### Deliverable 4.4: Workspace Isolation & File Conventions (`.agents/`)
- **Isolation Policy:**
  - Each subagent is assigned an isolated metadata folder: `.agents/<agent_name>_<id>/`.
  - **Read Access:** Global across workspace root.
  - **Write Access:** Confined strictly to own `.agents/` directory for metadata (`BRIEFING.md`, `progress.md`, `handoff.md`). Code edits to source files require explicit patch artifacts or verified implementer permissions.

#### Deliverable 4.5: Subagent Fleet Visualizer UI (`src/sections/SubagentMonitor.tsx`)
- **Capabilities:**
  - Real-time hierarchical tree visualization of all active and completed agents.
  - Liveness heartbeat indicators (`Last visited: [timestamp]`).
  - Slide-over Inter-Agent Message Inspector displaying verbatim communications.
  - Individual agent controls: Pause, Inspect Log, Terminate.

```
+---------------------------------------------------------------------------------------------------+
| MULTI-AGENT ORCHESTRATION & SUPERVISOR ARCHITECTURE                                               |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|   +-------------------------------------------------------------------------------------------+   |
|   |                                  ROOT ORCHESTRATOR                                        |   |
|   |  - Maintains Global Mission & Master Execution Plan                                       |   |
|   |  - Dispatches tasks to specialized child workers                                          |   |
|   +-----------------------------+-----------------------------+-------------------------------+   |
|                                 |                             |                                   |
|                 +---------------+             +---------------+                                   |
|                 v                             v                                                   |
|   +---------------------------+   +---------------------------+   +---------------------------+   |
|   |    Explorer Subagent      |   |   Implementer Subagent    |   |     Auditor Subagent      |   |
|   | - Read-only workspace scan|   | - Confined code editing   |   | - Independent verification|   |
|   | - Writes analysis.md      |   | - Runs local unit tests   |   | - Attestation validation  |   |
|   | - Working: .agents/exp_1/ |   | - Working: .agents/imp_1/ |   | - Working: .agents/aud_1/ |   |
|   +---------------------------+   +---------------------------+   +---------------------------+   |
|                 |                             |                             |                     |
|                 +-----------------------------+-----------------------------+                     |
|                                               |                                                   |
|                                               v                                                   |
|   +-------------------------------------------------------------------------------------------+   |
|   |                                INTER-AGENT MAILBOX BUS                                    |   |
|   |  - send_message(recipientId, subject, body, artifacts)                                    |   |
|   |  - Reactive Wakeup on message receipt / early-cancel timers                               |   |
|   |  - SQLite append-only message ledger                                                      |   |
|   +-------------------------------------------------------------------------------------------+   |
+---------------------------------------------------------------------------------------------------+
```

### 6.4 Architectural Prerequisites
- Completion of Phases 1, 2, and 3.
- Robust SQLite audit database schema migration.

### 6.5 Risk & Mitigation Analysis
| Risk Description | Severity | Likelihood | Mitigation Strategy |
|---|---|---|---|
| **Subagent Fork Bombs / Infinite Spawning:** Rogue agent spawns nested subagents uncontrollably. | Critical | Low | Enforce strict global hierarchy constraints: maximum tree depth = 2, maximum concurrent active subagents = 4. |
| **Token Budget Exhaustion:** Parallel subagents rapidly burn LLM token credits. | High | Medium | Implement hierarchical token budgeting; each subagent receives a hard token allocation quota enforced by the host model router. |
| **Orphaned Background Daemons:** Terminated sessions leave orphan Node/Python processes on host. | High | Low | Host process maintains an active PID registry; `process.on("exit")` and WebSocket disconnect hooks cleanly kill all child process trees (`taskkill /t /f`). |

### 6.6 Developer Ergonomics Impact
- Autonomous decomposition and execution of complex, multi-file engineering epics.
- Seamless coordination between planning, implementation, and verification workers.
- Zero manual polling required—the platform proactively notifies developers upon completion.

### 6.7 Cost & Friction Scoring
- **Implementation Complexity:** 8 / 10
- **Compute / API Token Cost:** High (Scales with number of active parallel subagents)
- **Risk Score:** High (7 / 10)
- **Friction Level:** High
- **Estimated Engineering Effort:** 7–9 Days

---

## 7. Phased Capability Evolution Matrix (Across 7 Core Pillars)

The table below outlines the exact capability progression of NanoForge across all 7 architectural pillars throughout the 4 delivery phases:

| Architectural Pillar | Current Baseline | Phase 1 (UI & Artifacts) | Phase 2 (Planning Mode) | Phase 3 (Headless & PTY) | Phase 4 (Multi-Agent Swarm) |
|---|---|---|---|---|---|
| **1. Agent Loop & Context** | 2-turn VFS auto-verify; Host single-shot | 2-turn VFS + Rich token budget bar | Multi-turn planning turns with state diffs | Streaming token loop + real-time tool feedback | Full multi-turn hierarchical loop with self-correction |
| **2. Multi-Agent & Subagents** | None (Single coordinator) | None | None | Background CLI task runner | Full Hierarchical Subagent Tree + Mailbox + Wakeups |
| **3. Planning & Approvals** | Static DAG list; Host `PlanPanel` | Static DAG list + UI polish | Interactive Visual DAG + Phase Grouping + Diff Gates | Headless plan generation (`nanoforge plan`) | Dynamic multi-agent distributed plan execution |
| **4. Artifacts & Rich UI** | Basic PatchCard + Screenshot modal | Monaco Diff + Mermaid + Live Sandbox Canvas | Interactive Plan Authoring Canvas | Terminal Output streaming in Artifact Dock | Multi-Agent Artifact Ledger & Version Gallery |
| **5. Terminal & Headless** | Static `<pre>` cards; No PTY; No CLI | Static `<pre>` cards + copy actions | Static cards + plan step bindings | Standalone CLI (`nanoforge run`) + Embedded XTerm PTY | Background Daemons + Supervised Process Trees |
| **6. Tool Safety & Policy** | Binary allow/deny; Hardcoded terminal | Unchanged (Zero-risk UI upgrades) | Polymorphic `ToolRequest` union + Granular ACLs | Headless non-interactive policy validation (`--auto-approve safe` / `--yes`) | Hierarchical role-scoped permission containment |
| **7. Extensibility & MCP** | Stdio/SSE tools only; Ephemeral | Unchanged | MCP tools bound to visual plan steps | MCP stdio/SSE in headless CLI | Full MCP (Resources, Prompts, Roots) + Skill Studio |

---

## 8. Cost, Resource & Friction Scoring Synthesis Matrix

| Phase | Phase Name | Primary Modules Affected | Implementation Complexity (1-10) | LLM Compute / Token Cost | User Friction Level | Est. Eng Days | Recommended Staffing |
|---|---|---|---|---|---|---|---|
| **Phase 1** | Free/Easy High-Value UI & Artifacts | `src/sections/`, `src/components/`, `src/lib/` | **2 / 10** | **$0.00 (Zero)** | **Very Low** | 3–4 Days | 1 Frontend Specialist |
| **Phase 2** | Planning Mode & Interactive DAG | `src/sections/PlanPanel.tsx`, `packages/protocol`, `agent-host/runs/` | **4 / 10** | **Low (<$0.05/run)** | **Low** | 4–5 Days | 1 Full-Stack Engineer |
| **Phase 3** | Headless CLI & Terminal Ergonomics | `apps/agent-host/src/cli/`, `terminal/`, `packages/protocol` | **5 / 10** | **Standard** | **Medium** | 5–6 Days | 1 Systems/CLI Engineer |
| **Phase 4** | Multi-Agent Orchestration & Daemons | `apps/agent-host/src/agents/`, `tasks/`, `audit/`, `packages/protocol` | **8 / 10** | **Dynamic (Multi-agent)**| **High** | 7–9 Days | 2 Senior Systems Engineers |
| **TOTAL** | **Full Platform Delivery** | **Full Monorepo** | — | — | — | **19–24 Days** | **Team of 2–3 Engineers** |

---

## 9. Delivery Schedule & Milestone Dependencies

```
WEEK 1: HIGH-VALUE UI & ARTIFACT FOUNDATIONS
[Day 1-2] Phase 1.1: Monaco Diff Viewer & Rich Markdown/Mermaid Engine
[Day 3-4] Phase 1.2: Chat Slash Command Popover & Dedicated Artifact Dock
[Day 5]   Phase 1 Milestone Gate & Playwright UI Regression Verification

WEEK 2: PLANNING MODE & VISUAL DAG COMPOSER
[Day 6-7] Phase 2.1: Visual DAG Graph (@xyflow/react) & Step Reordering
[Day 8-9] Phase 2.2: Phase Grouping, Plan Modification Diffs & Dual-Gate Approvals
[Day 10]  Phase 2 Milestone Gate & Plan Validation Integration Tests

WEEK 3: HEADLESS CLI & INTERACTIVE PTY TERMINAL
[Day 11-12] Phase 3.1: Standalone `nanoforge run` CLI & JSON Event Streaming
[Day 13-14] Phase 3.2: Embedded @xterm/xterm PTY Terminal Dock & node-pty Bridge
[Day 15]    Phase 3 Milestone Gate & Headless CI/CD Automation Tests

WEEK 4: MULTI-AGENT SWARMS & BACKGROUND DAEMONS
[Day 16-18] Phase 4.1: Hierarchical Subagents, Mailbox Bus & Supervisor Escalation
[Day 19-20] Phase 4.2: Background Daemon Supervisor, Reactive Timers & Fleet UI
[Day 21]    Phase 4 Milestone Gate & Full Platform E2E Acceptance Verification
```

---

## 10. Summary & Next Steps

This Phased Roadmap establishes a disciplined, risk-managed progression for NanoForge. By harvesting immediate high-value frontend wins in Phase 1 and sequentially building toward full multi-agent autonomy in Phase 4, the platform guarantees continuous deliverability, zero security regressions, and best-in-class developer ergonomics.

Engineering teams should proceed immediately to execute **Phase 1** against the specifications in `docs/PRD_PLANNING_ARTIFACTS_SLASH.md` and verify all milestones against `docs/E2E_VERIFICATION_PLAN.md`.
