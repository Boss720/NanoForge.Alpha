# NanoForge Phase 4 & Phase 5: Complete System Walkthrough

## Overview
NanoForge Phase 4 and Phase 5 transition the platform from single-threaded LLM turn execution into an enterprise-grade, actor-model multi-agent swarm orchestration platform with background daemon supervision, workspace sandboxing, and an Antigravity-grade visual control plane.

---

## 1. Key Architectural Subsystems

### 1.1 Multi-Agent Protocol Layer (`packages/protocol`)
- **Isomorphic Architecture**: Pure TypeScript package without Node.js native dependencies (`fs`, `child_process`, `net`), ensuring seamless usage across React browser clients and Fastify Node.js backends.
- **7-State Subagent FSM**: Explicit state transitions: `running`, `idle`, `waiting_for_input`, `waiting_for_dependents`, `waiting_for_message`, `canceling`, `errored`.
- **Actor-Model Mailbox Framing**: Typed message packets (`SubagentMessage`) with priority queuing (`high`, `normal`, `low`), correlation tracking, and handoff artifact references.
- **Isomorphic 5-Field Cron Parser**: Standard cron engine (`minute hour dom month dow`) supporting step values, ranges, lists, named months/days, leap-year calculations, and next occurrence timestamps.
- **Tool Schemas**: Strongly typed Zod contracts for `invoke_subagent`, `manage_subagents`, `send_message`, `define_subagent`, `schedule`, and `manage_task`.

### 1.2 Agent Host & Supervisor Engine (`apps/agent-host/src/agents/`)
- **Supervisor Hierarchy & Recursion Cap (`SEC-SUB-05`)**: Tree structure with maximum depth limit <= 3 (`ERR_SUBAGENT_MAX_DEPTH_EXCEEDED`) and concurrency throttle <= 8 active subagents.
- **Mailbox Access Control (`SEC-SUB-03`)**: Mailbox routing restricts inter-agent message passing to direct parents, direct children, or siblings sharing the same parent. Cross-tree messaging is rejected with `ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT`.
- **Zero-Polling Reactive Wakeups**: Suspends waiting agents in `idle` state (0 CPU/token cost) and reactively wakes them via structured `<system_notification>` blocks when messages arrive, child subagents transition, or timers trigger.
- **Token Budget Metering (`SEC-SUB-04`)**: Meters total token consumption across turns, automatically terminating agents that exceed their quota and executing failure escalation.
- **5-Rung Failure Escalation Ladder**: Deterministic autonomous recovery protocol (`Retry` $\to$ `Replace` $\to$ `Skip` $\to$ `Redistribute` $\to$ `Degrade`).
- **Cascading Teardown (`killTree`)**: Post-order depth traversal cleanly aborts turn loops, prunes Git worktrees, terminates process groups, and cleans memory registries.

### 1.3 Background Daemon Task Supervisor & Scheduler (`apps/agent-host/src/daemons/`)
- **Detached Process Management**: Long-running daemons (`isDaemon: true`) spawn with independent process groups.
- **2MB Circular Ring Buffer**: Dynamically retains the most recent 2MB of stdout/stderr logs per daemon, evicting oldest chunks while preventing memory leaks.
- **Interactive STDIN Forwarding**: `manage_task(action: "send_input")` writes interactive input into running daemon processes.
- **Precision Scheduler**: Manages one-shot timers (`durationSeconds`) with conditional early cancellation (`never`, `any`, `<sender-id>`) and recurring cron schedules (`cronExpression`). Deadlock prevention synthesizes fallback notifications if monitored senders terminate prematurely.

### 1.4 Workspace Sandboxing & Confinement (`apps/agent-host/src/policy/` & `workspace/`)
- **Isolation Modes**:
  - `inherit`: Shared project repository with private `.agents/<id>/` metadata.
  - `branch`: Isolated Git worktrees (`.agents/worktrees/<id>/` on branch `nano/<id>`) cleanly created and pruned via Git CLI.
  - `share`: Read-only project repository with ephemeral scratch directories.
- **Path Confinement (`SEC-SUB-01`)**: Strictly blocks subagents from writing scratch or metadata files outside their allocated `.agents/<id>/` directory. Prevents directory traversal (`..`, `%2e%2e`), symlink escapes, and Windows case sensitivity exploits.

### 1.5 Multi-Agent Visual Control Plane (`src/sections/SubagentsPanel.tsx`)
- **Hierarchical Swarm Tree Visualizer (`AgentSwarmTreeView`)**: Tree graph rendering parent-child relationships, 7-state badges, uptime, token meters, heartbeat liveness indicators (green/amber/red STALLED >180s), and node action gates (Select, Message, Kill, Kill Tree).
- **Live Tool Execution Inspector (`AgentToolInspector`)**: Real-time tool stream with collapsible JSON parameter inspectors, duration clocks, live ANSI console, and manual tool abortion.
- **Inter-Agent Mailbox Timeline (`AgentMailboxViewer`)**: Chronological message logs with sender/recipient pills, Markdown body, automatic 5-component handoff accordion parser (`Observation`, `Logic Chain`, `Caveats`, `Conclusion`, `Verification Method`), and quick-reply composer.
- **Daemon & Schedule Manager (`DaemonTaskManager`)**: Real-time daemon process table with STDIN input bar, kill actions, log viewer, one-shot countdown timers, and cron schedule monitors.
- **Dynamic Spawner Dialog (`SpawnSubagentModal`)**: Interactive spawner with archetype presets, isolation mode selection, tool permission checkboxes, and real-time SEC-SUB-05 depth validation blocking submissions at depth >= 3.
- **Shell Integration**: TopBar status badge with active subagent count counter and responsive multi-rail dock in `App.tsx`.

---

## 2. Test Verification Matrix

All test suites execute natively in Vitest across all monorepo tiers:

```
================================================================================
                               TEST MATRIX SUMMARY
================================================================================
1. Protocol Unit & Adversarial Tests (npm run test:protocol)
   - Test Files: 9 passed (9)
   - Tests:      214 passed (214)
   - Duration:   1.06s

2. Agent Host & Supervisor Tests (npm run test:host)
   - Test Files: 36 passed (36)
   - Tests:      322 passed (322)
   - Duration:   5.63s

3. Frontend Component & Integration Tests (npm test)
   - Test Files: 32 passed (32)
   - Tests:      302 passed (302)
   - Duration:   10.48s

================================================================================
TOTAL AUTOMATED TESTS: 838 / 838 PASSED (100% PASS RATE, 0 FAILURES)
PRODUCTION BUILD:     tsc -b && vite build (0 ERRORS, CLEAN BUNDLE)
================================================================================
```

---

## 3. Verification Commands

To independently reproduce the complete verification:

```powershell
# 1. Verify Protocol Schemas & Pure Algorithms
npm run test:protocol

# 2. Verify Host Engine, Sandboxing, Daemons & Supervisors
npm run test:host

# 3. Verify Frontend Control Plane & UI Components
npm test

# 4. Verify Monorepo TypeScript & Production Build
npm run build
```
