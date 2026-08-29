# Product Requirement Document (PRD): Multi-Agent Orchestration & Hierarchical Subagents

**Document Status:** Approved / Ready for Engineering Execution  
**Target Milestone:** Phase 4 — Multi-Agent Orchestration & Autonomous Supervision  
**Author:** Worker 2 (Multi-Agent & Headless Architecture Lead)  
**Target Systems:** `packages/protocol`, `apps/agent-host`, `src/sections/SubagentMonitor.tsx`  
**Last Updated:** 2026-08-15  

---

## 1. Executive Summary

### 1.1 Overview
The **NanoForge Multi-Agent Orchestration Subsystem** transforms NanoForge from a single-threaded, single-agent tool executor into an enterprise-grade, hierarchical multi-agent supervisor system inspired by Erlang/OTP supervision trees and Google Antigravity multi-agent protocols.

Modern complex software engineering tasks (such as end-to-end refactoring, cross-repository auditing, automated migration, and full-stack feature development) overwhelm single-agent context windows and lead to catastrophic forgetting, hallucination loops, and unrecoverable errors. NanoForge solves this by introducing:
1. **Hierarchical Supervisor Trees**: Root agents dynamically spawn, supervise, coordinate, and terminate specialized child subagents with strict parent-child lifecycle contracts.
2. **Actor-Model Mailbox Protocol**: Asynchronous, typed cross-agent message passing (`send_message`) with reactive wakeup triggers, eliminating CPU-intensive and token-wasting polling loops.
3. **Workspace Confinement & Branch Sandboxing**: Fine-grained workspace isolation modes (`inherit`, `branch` with isolated Git worktrees/VFS, and `share`), enforcing that subagents operate exclusively within dedicated metadata workspaces (`.agents/<subagent_id>/`) while isolating dirty source-tree edits.
4. **Resilient Failure Escalation Ladder**: A deterministic 5-step failure recovery protocol (`Retry` $\to$ `Replace` $\to$ `Skip` $\to$ `Redistribute` $\to$ `Degrade`) ensuring zero zombie processes and zero silent task drops.
5. **Background Task & Schedule Daemons**: Supervision of long-running daemon processes, recurring cron jobs, and one-shot liveness timers with tailored wakeups.

```
                                +---------------------------+
                                |     User / Headless CLI   |
                                +-------------+-------------+
                                              | (Prompt / Plan)
                                              v
                                +---------------------------+
                                |     Root Orchestrator     |
                                |  (Parent Context & State) |
                                +------+--------------+-----+
                                       |              |
                      invoke_subagent  |              |  invoke_subagent
                                       v              v
                  +-----------------------+        +-----------------------+
                  |  Explorer Subagent 1  |        | Implementer Subagent 1|
                  |  - Role: Explorer     |        | - Role: Implementer   |
                  |  - Path: .agents/exp_1|        | - Worktree: branch-wt |
                  +-----------+-----------+        +-----------+-----------+
                              |                                |
                 send_message | (handoff.md)      send_message | (status/patch)
                              v                                v
                  +--------------------------------------------------------+
                  |            Host Message Bus & Mailbox Broker           |
                  |       - Reactive Wakeups (No Polling)                  |
                  |       - Append-Only SQLite Audit Trail (`audit.db`)    |
                  +--------------------------------------------------------+
```

### 1.2 Goals
- **Deterministic Hierarchy**: Support arbitrary $N$-level subagent trees with strict supervisor boundaries, cascading aborts, and tree-wide resource limits.
- **Reactive Wakeups**: Ensure agents suspend execution immediately after triggering asynchronous work and resume deterministically only upon receiving inbound messages, task completions, or timer events.
- **Strict Isolation**: Isolate subagent working state, logs, and scratch artifacts within `.agents/<agent_name>_<id>/`. Provide Git worktree sandboxing for concurrent code-modifying workers.
- **Role & Methodology Specialization**: Support specialized archetypes (`explorer`, `implementer`, `qa`, `specialist`, `verifier`, `planner`) that ingest domain skills and enforce standard 5-component handoff protocols (`Observation`, `Logic Chain`, `Caveats`, `Conclusion`, `Verification Method`).
- **Complete Type-Safety**: Deliver compile-ready, Zod-validated TypeScript contracts in `packages/protocol` and Fastify host handlers in `apps/agent-host`.

### 1.3 Non-Goals
- **Unsupervised Peer Swarms**: NanoForge explicitly rejects unstructured, non-hierarchical agent graphs where agents communicate without parent visibility or ownership boundaries.
- **Unrestricted Filesystem Access**: Subagents are strictly prohibited from writing scratch files, logs, or unreviewed edits outside their allocated `.agents/` folder or sandbox worktree.
- **Infinite Self-Invocation**: Hard recursive depth limits (default max depth: 3) and subagent concurrency caps (default max concurrent: 8) prevent runaway execution and token exhaustion.

---

## 2. Hierarchical Subagent Architecture

### 2.1 Core Agent Primitives

The multi-agent system exposes three core LLM tools to orchestrators and subagents:

```
+---------------------------------------------------------------------------------------------+
|                                    MULTI-AGENT TOOL PRIMITIVES                              |
+---------------------------------------------------------------------------------------------+
| 1. invoke_subagent(archetype, roles, prompt, isolation, allowedTools, timeout, budget)     |
|    -> Spawns a child agent, provisions workspace, assigns conversationId, enters supervisor |
|                                                                                             |
| 2. manage_subagents(action: 'list'|'status'|'kill'|'pause'|'resume'|'inspect', targetId)    |
|    -> Queries child status, monitors heartbeats, inspects transcripts, terminates children  |
|                                                                                             |
| 3. send_message(recipientId, subject, body, referencedArtifacts)                            |
|    -> Dispatches typed message to parent, child, or sibling, triggering reactive wakeup    |
+---------------------------------------------------------------------------------------------+
```

#### Primitive 1: `invoke_subagent`
Spawns a child agent under the caller's supervision tree.
- **Parameters**:
  - `archetype`: Base archetype (`"explorer"` | `"implementer"` | `"qa"` | `"specialist"` | `"verifier"` | `"planner"`).
  - `roles`: List of active functional roles (`string[]`).
  - `prompt`: Detailed mission specification and constraints.
  - `workspaceIsolation`: Workspace mode (`"inherit"` | `"branch"` | `"share"`).
  - `allowedToolKinds`: Array of authorized tool categories (e.g. `["file.read", "terminal.exec"]`).
  - `timeoutSeconds`: Hard execution ceiling in seconds (default: 600s).
  - `budgetTokens`: Maximum allowable prompt + completion token consumption.
- **Synchronous Return**:
  - `subagentId`: Unique UUID v4 identifying the subagent.
  - `workingDirectory`: Absolute path to assigned `.agents/<name>_<id>` directory.
  - `status`: Initial state (`"spawning"`).

#### Primitive 2: `manage_subagents`
Supervises and manages child subagents owned by the calling agent.
- **Actions**:
  - `list`: Returns all direct children with status, uptime, token usage, and last heartbeat.
  - `status`: Detailed execution state, current tool run, and last progress entry for `subagentId`.
  - `kill`: Immediately aborts child process tree, frees worktrees, and transitions status to `"terminated"`.
  - `pause` / `resume`: Freezes / unfreezes subagent turn scheduling.
  - `inspect`: Fetches verbatim `progress.md`, `BRIEFING.md`, or `handoff.md` from the child's workspace.

#### Primitive 3: `send_message`
Inter-agent asynchronous message bus.
- **Parameters**:
  - `recipientId`: Target conversation/agent UUID. Must be the agent's direct parent, a direct child, or an authorized peer in the same supervision tree.
  - `subject`: Short single-line topic summary (max 256 chars).
  - `body`: Structured markdown content following standard communication guidelines.
  - `referencedArtifacts`: Array of file paths to handoff reports or generated artifacts.
- **Behavior**:
  - Appends message to recipient's inbound mailbox queue.
  - Generates a reactive wakeup event for the recipient.
  - Returns delivery confirmation timestamp.

---

### 2.2 Subagent Archetypes and Specialization Matrix

Each subagent runs with an immutable `Archetype` defining default tool permissions, model routing preferences, and lifecycle rules:

| Archetype | Primary Focus | Default Allowed Tools | Model Class Preference | File Edit Permissions |
|---|---|---|---|---|
| **`explorer`** | Fast codebase reconnaissance, dependency mapping, reproduction | `file.read`, `workspace.search`, `terminal.exec` (read-only) | High speed / Large context (e.g. Claude 3.5 Haiku, Gemini 1.5 Flash) | Read-only in workspace; Write `.agents/` only |
| **`implementer`** | Code modification, refactoring, feature implementation | `file.read`, `file.edit`, `file.write`, `terminal.exec` | High reasoning / Coding (e.g. Claude 3.7 Sonnet, GPT-4o) | Full write in designated branch or workspace |
| **`qa`** | Bug reproduction, regression fixing, lint/test failure remediation | `file.read`, `file.edit`, `terminal.exec` | High reasoning / Precision | Fix-only in source tree; Write `.agents/` |
| **`specialist`** | Domain expertise (e.g. Bio/Science, Android, DB, Security) | Dynamic based on loaded Skill pack | High capability / Domain-specific | Defined by loaded Skill metadata |
| **`verifier`** | Independent forensic audit, test execution, visual assertion | `terminal.exec`, `browser.action`, `file.read` | High reasoning / Rigorous | Read-only in workspace; Write audit reports |
| **`planner`** | High-level decomposition, DAG scheduling, dependency resolution | `file.read`, `workspace.search` | High reasoning / Planning | Read-only in workspace; Generates plans |

---

## 3. Supervision Trees, State Machines, and Lifecycle

### 3.1 Supervision Tree Topologies

NanoForge implements three Erlang/OTP-inspired supervisor restart strategies:

```
1. One-For-One Strategy (Default):
   If child Subagent B fails, only Subagent B is restarted/replaced. Subagents A and C continue unaffected.
   [Supervisor]
     ├── [Child A] (Running)
     ├── [Child B] (Failed -> Restarting)
     └── [Child C] (Running)

2. One-For-All Strategy:
   If child Subagent B fails, all concurrent children (A, B, C) are cancelled, workspace states reverted, and the entire stage restarts.
   [Supervisor]
     ├── [Child A] (Terminating...)
     ├── [Child B] (Failed)
     └── [Child C] (Terminating...)

3. Rest-For-One Strategy:
   If child Subagent B fails, any subsequent child spawned after B (Child C) is terminated and restarted alongside B, preserving upstream pipeline integrity (A remains running).
   [Supervisor]
     ├── [Child A] (Running - Upstream intact)
     ├── [Child B] (Failed -> Restarting)
     └── [Child C] (Terminated -> Restarted after B)
```

### 3.2 Formal Subagent State Machine

Every subagent transitions through a deterministic state machine managed by `SubagentSupervisor` in `apps/agent-host`:

```
              +---------------+
              |   UNINITIALIZED
              +-------+-------+
                      | spawn()
                      v
              +---------------+
              |   SPAWNING    |
              +-------+-------+
                      | init_complete
                      v
              +---------------+   inbound message / timer   +---------------+
              |    RUNNING    +<----------------------------+     IDLE      |
              +-------+-------+                             +-------+-------+
                      |                                             ^
                      |-- turn_complete / await_message ------------|
                      |
                      |-- policy_ask / user_gate --> [ BLOCKED ] ---| (granted)
                      |
                      |-- task_complete -----------> [ COMPLETED ]
                      |
                      |-- unrecoverable_error -----> [ FAILED ]
                      |
                      +-- parent_abort / timeout --> [ TERMINATED ]
```

#### State Transition Matrix

| Current State | Event Trigger | Next State | Actions & Invariants |
|---|---|---|---|
| `UNINITIALIZED` | `invoke_subagent` called | `SPAWNING` | Allocate UUID, create `.agents/<id>`, configure worktree/VFS, write initial `BRIEFING.md`. |
| `SPAWNING` | Workspace & LLM adapter ready | `RUNNING` | Record `startedAt`, emit `subagent.spawned` event, begin Turn 1. |
| `RUNNING` | LLM turn completes with no pending tools | `IDLE` | Enter reactive sleep. No tokens consumed. Await mailbox message or timer. |
| `RUNNING` | Tool requires user approval (`ask` policy) | `BLOCKED` | Emit `tool.approval_required`. Execution paused until socket grant. |
| `BLOCKED` | User grants approval via WebSocket | `RUNNING` | Execute tool, resume turn loop. |
| `BLOCKED` | User denies approval or timeout expires | `RUNNING` | Inject policy rejection message to LLM turn context. |
| `RUNNING` | Subagent calls `send_message` with handoff | `COMPLETED` | Validate `handoff.md`, write exit audit entry, notify parent with completion frame. |
| `RUNNING` | Unhandled error / budget exhaustion | `FAILED` | Emit failure diagnostic, record error stack, notify parent supervisor. |
| `*` (Any State)| Parent calls `kill` or timeout fires | `TERMINATED` | Kill OS process tree (`taskkill /t /f` or `process.kill(-pid)`), release Git worktree. |

### 3.3 Liveness Protocol and Heartbeat Supervision

1. **Heartbeat Record**: Active subagents update their local `.agents/<id>/progress.md` after every tool execution or every 5 minutes during long-running builds with `Last visited: <ISO-8601-Timestamp>`.
2. **Zombie Detection Engine**:
   - `SubagentSupervisor` runs a background liveness check every 30 seconds.
   - If `status === "running"` and `currentTime - lastHeartbeat > heartbeatTimeoutSeconds` (default: 180s) with no active child process IO, the supervisor marks the subagent `STALLED`.
   - Stalled subagents trigger the Failure Escalation Ladder.

---

## 4. Reactive Wakeup Mechanisms (Event-Driven Architecture)

### 4.1 Elimination of Polling Loops
In naive multi-agent architectures, parent agents poll children in tight loops (`while (!done) { sleep(5); checkStatus(); }`), wasting thousands of LLM tokens and locking host threads. 

NanoForge enforces **Zero-Polling Reactive Execution**:
- When an agent has no active tools to run, its host loop **suspends immediately** (enters `IDLE` state).
- The agent's LLM context and turn state are frozen in SQLite / in-memory cache.
- The host session wakes the agent up **only when an explicit event frame arrives**.

```
+---------------------------------------------------------------------------------------------+
|                                  REACTIVE WAKEUP EVENT LOOP                                 |
+---------------------------------------------------------------------------------------------+
                                              |
     +----------------------------------------+----------------------------------------+
     |                                        |                                        |
     v                                        v                                        v
[ Mailbox Event ]                     [ Task Daemon Event ]                    [ Schedule Timer ]
- Direct message from child/parent    - Background build completed             - One-shot timer expired
- Peer agent handoff deliverable      - Dev server crashed / logged error      - Recurring cron triggered
     |                                        |                                        |
     +----------------------------------------+----------------------------------------+
                                              |
                                              v
                              +-------------------------------+
                              |    Agent Event Multiplexer    |
                              |  (apps/agent-host/src/bus/)   |
                              +---------------+---------------+
                                              |
                                              v Priority Queue:
                                                1. High: Kill / Abort / Fatal Error
                                                2. Normal: Tool Results / Messages
                                                3. Low: Informational Logs
                                              |
                                              v
                              +-------------------------------+
                              |   Thaw Agent Turn Context     |
                              |   Format Input Message Turn   |
                              |   Trigger Model Stream        |
                              +-------------------------------+
```

### 4.2 Wakeup Trigger Payload Contract

When a wakeup occurs, the host packages the trigger event into a structured prompt turn appended to the agent's conversation history:

```markdown
<system_notification>
## Reactive Wakeup Trigger: [MESSAGE_RECEIVED | TASK_COMPLETED | TIMER_EXPIRED]
- **Source**: subagent_implementer_4a9b (Implementer 1)
- **Timestamp**: 2026-08-15T02:45:10.123Z
- **Payload Summary**: Completed patch for src/server.ts with 100% test pass.
- **Attached Artifact**: c:/Users/Hp/.../.agents/teamwork_preview_worker_1/handoff.md
</system_notification>
```

---

## 5. Workspace Isolation Modes

To enable multiple subagents to work concurrently on the same repository without race conditions, corrupted files, or clobbered git trees, NanoForge provides 3 workspace isolation modes:

```
                                  WORKSPACE ISOLATION MODES
====================================================================================================

1. INHERIT MODE:
   [Main Workspace: /repo]
     ├── src/ (Shared direct read/write)
     └── .agents/
           ├── orchestrator/ (Isolated metadata)
           └── subagent_1/   (Isolated metadata: BRIEFING.md, progress.md, handoff.md)

2. BRANCH (GIT WORKTREE) MODE:
   [Main Workspace: /repo (main branch)]
     └── .agents/worktrees/
           ├── subagent_2/ -> Linked Git Worktree on branch "nano/subagent-2"
           └── subagent_3/ -> Linked Git Worktree on branch "nano/subagent-3"
   * Edits occur in completely isolated filesystem directory. Merged via pull/patch on approval.

3. SHARE MODE:
   [Main Workspace: /repo] -> Read-only mount
   [Scratch VFS: In-Memory / Temporary OS Directory] -> Writable for test runs & scratch files
====================================================================================================
```

### 5.1 Mode Comparison Matrix

| Isolation Mode | Target Use Case | Filesystem Mechanism | Merge / Synchronization Strategy |
|---|---|---|---|
| **`inherit`** | Read-only analysis, single-agent refactors, sequential tasks | Single folder, shared `workspaceRoot`, isolated `.agents/<id>` metadata | Direct filesystem writes; lockfile prevents concurrent writes to identical files |
| **`branch`** | Parallel feature implementation, risky architectural refactors | Git linked worktree (`git worktree add .agents/worktrees/<id> -b nano/<id>`) | Child produces Git commits; Parent reviews structured diff and runs `git merge` or cherry-picks |
| **`share`** | Unit test runners, lint verification, specialist code reviews | Read-only workspace mirror + overlay scratch directory | Subagent outputs a unified `.patch` file; parent applies via `git apply` |

### 5.2 Access Control & Path Containment Rules
- **Rule 1 (`.agents/` Confinement)**: Subagents may ONLY write scratch files, memory files, briefings, and handoffs inside their designated `.agents/<id>/` directory. Writing to another agent's directory is blocked by `PolicyEngine`.
- **Rule 2 (Source Tree Modification Gate)**: In `inherit` mode, any write to project source files (`src/**`, `apps/**`, `packages/**`) must be declared in the plan step's `affectedScopes` and pass policy authorization.
- **Rule 3 (Clean Teardown)**: On subagent termination, linked Git worktrees in `branch` mode are automatically pruned (`git worktree remove --force`) to prevent disk bloat.

---

## 6. Failure Escalation Ladder

Autonomous multi-agent systems must handle flaky tools, model hallucinations, test failures, and context saturation gracefully. NanoForge implements a deterministic 5-rung **Failure Escalation Ladder**:

```
+---------------------------------------------------------------------------------------------+
|                                 FAILURE ESCALATION LADDER                                   |
+---------------------------------------------------------------------------------------------+
|                                                                                             |
|  [ RUNG 1: RETRY ]                                                                          |
|  - Scope: Transient network errors, syntax errors, single test failures                     |
|  - Strategy: Feed error output back to same agent with exponential backoff (Max: 3 retries)  |
|                                                                                             |
|       │ (If 3 retries fail or context window > 85% full)                                    |
|       ▼                                                                                     |
|  [ RUNG 2: REPLACE ]                                                                        |
|  - Scope: Context saturation, cognitive loops, stuck agent state                            |
|  - Strategy: Require agent to emit partial handoff.md, terminate agent, spawn fresh clone    |
|              with clean context window and handoff summary                                   |
|                                                                                             |
|       │ (If replacement agent fails identical step)                                         |
|       ▼                                                                                     |
|  [ RUNG 3: SKIP ]                                                                           |
|  - Scope: Optional / non-blocking steps (e.g. non-critical doc lint, cosmetic check)        |
|  - Strategy: Mark plan step `skipped`, emit warning in audit log, unlock dependent steps    |
|                                                                                             |
|       │ (If step is critical / blocking)                                                    |
|       ▼                                                                                     |
|  [ RUNG 4: REDISTRIBUTE ]                                                                   |
|  - Scope: Task too large or complex for single subagent archetype                           |
|  - Strategy: Supervisor decomposes task into smaller sub-tasks and spawns multiple          |
|              specialized subagents in parallel (e.g. Explorer + Implementer + QA)           |
|                                                                                             |
|       │ (If all subagents fail or critical policy violation occurs)                         |
|       ▼                                                                                     |
|  [ RUNG 5: DEGRADE & ESCALATE ]                                                             |
|  - Scope: Unresolvable blockers, permission denials, irrecoverable build breakages          |
|  - Strategy: Halt execution pipeline, preserve all diagnostic artifacts, generate          |
|              interactive UI prompt asking user for explicit direction or manual fix         |
+---------------------------------------------------------------------------------------------+
```

### 6.1 State Transition Logic for Escalation
```typescript
export function determineEscalation(
  attemptCount: number,
  isCritical: boolean,
  contextUsagePercent: number,
  errorType: "transient" | "syntax" | "logic" | "policy" | "timeout"
): EscalationAction {
  if (errorType === "policy") return { action: "degrade", reason: "Policy denial requires user intervention" };
  if (errorType === "transient" && attemptCount < 3) return { action: "retry", backoffMs: Math.pow(2, attemptCount) * 1000 };
  if (contextUsagePercent > 85 || attemptCount >= 3) return { action: "replace", handoffRequired: true };
  if (!isCritical) return { action: "skip", reason: "Non-critical step skipped after failure" };
  if (attemptCount >= 5) return { action: "redistribute", partitionSize: 2 };
  return { action: "degrade", reason: "Exhausted all autonomous recovery rungs" };
}
```

---

## 7. Background Daemon Tasks & Scheduling

### 7.1 Async Task Supervisor (`apps/agent-host/src/tasks/`)
In addition to subagents, the orchestrator can manage persistent background daemon processes (such as Vite dev servers, file watchers, test runners in watch mode, and long compilation jobs).

- **Task Handle**: Each background task runs with a supervised `TaskId`, process group PID, and dedicated 2MB ring buffer.
- **Interactive STDIN**: Supports `send_input` to pass stdin to interactive background tools.
- **Clean Teardown**: Automatically kills all registered background process trees on session disconnect or run termination.

### 7.2 Scheduling Subsystem (`schedule` Tool)
The `schedule` tool enables agents to set liveness alarms, recurring health monitors, and timeout timers without running CPU `sleep` commands:

1. **One-Shot Timers**:
   - `DurationSeconds`: Seconds until timer fires.
   - `TimerCondition`:
     - `"never"`: Fires unconditionally at expiry.
     - `"any"`: Automatically cancels if any message arrives before expiry.
     - `"<sender-id>"`: Cancels early if a message arrives specifically from `<sender-id>`.
       * **Fallback Reactive Wakeup**: If the target sender (`<sender-id>`) crashes, fails, or is terminated without sending a message, the supervisor automatically synthesizes a fallback reactive wakeup event (`TASK_TERMINATED` / `SENDER_FAILED`) delivered immediately to the waiting agent's mailbox, preventing the waiting agent from remaining deadlocked in `IDLE` for the remainder of `DurationSeconds`.
2. **Recurring Cron Jobs**:
   - `CronExpression`: 5-field cron string (e.g. `*/5 * * * *` for every 5 minutes).
   - `MaxIterations`: Maximum trigger count.
   - `IsDaemon`: Whether the cron survives the current task completion. When `IsDaemon: false` (default), all active cron jobs and timers are strictly bound to the creating subagent lifecycle and are automatically cancelled upon subagent completion, failure, or termination.

---

## 8. TypeScript Protocol Definitions (`packages/protocol`)

Below are the complete, production-ready TypeScript definitions and Zod schemas to be placed in `packages/protocol/src/subagent.ts` and `packages/protocol/src/tasks.ts`.

### 8.1 Subagent Contracts (`packages/protocol/src/subagent.ts`)

```typescript
import { z } from "zod";
import { toolKindSchema } from "./tools";

/* ------------------------------------------------------------------------ */
/* Identifiers & Enums                                                      */
/* ------------------------------------------------------------------------ */

export const subagentIdSchema = z.string().uuid();
export type SubagentId = z.infer<typeof subagentIdSchema>;

export const subagentArchetypeSchema = z.enum([
  "explorer",
  "implementer",
  "qa",
  "specialist",
  "verifier",
  "planner",
  "custom",
]);
export type SubagentArchetype = z.infer<typeof subagentArchetypeSchema>;

export const subagentStatusSchema = z.enum([
  "spawning",
  "running",
  "idle",
  "blocked",
  "completed",
  "failed",
  "terminated",
]);
export type SubagentStatus = z.infer<typeof subagentStatusSchema>;

export const workspaceIsolationModeSchema = z.enum([
  "inherit",
  "branch",
  "share",
]);
export type WorkspaceIsolationMode = z.infer<typeof workspaceIsolationModeSchema>;

export const supervisorStrategySchema = z.enum([
  "one_for_one",
  "one_for_all",
  "rest_for_one",
]);
export type SupervisorStrategy = z.infer<typeof supervisorStrategySchema>;

/* ------------------------------------------------------------------------ */
/* Tool Schemas: invoke_subagent                                            */
/* ------------------------------------------------------------------------ */

export const invokeSubagentParamsSchema = z.object({
  archetype: subagentArchetypeSchema,
  roles: z.array(z.string().min(1)).default([]),
  prompt: z.string().min(1).max(32768),
  workspaceIsolation: workspaceIsolationModeSchema.default("inherit"),
  allowedToolKinds: z.array(toolKindSchema).optional(),
  timeoutSeconds: z.number().int().positive().max(7200).default(600),
  budgetTokens: z.number().int().positive().optional(),
  skills: z.array(z.string()).default([]),
});
export type InvokeSubagentParams = z.infer<typeof invokeSubagentParamsSchema>;

export const invokeSubagentResultSchema = z.object({
  subagentId: subagentIdSchema,
  archetype: subagentArchetypeSchema,
  workingDirectory: z.string().min(1),
  status: subagentStatusSchema,
  startedAt: z.string().datetime(),
});
export type InvokeSubagentResult = z.infer<typeof invokeSubagentResultSchema>;

/* ------------------------------------------------------------------------ */
/* Tool Schemas: manage_subagents                                           */
/* ------------------------------------------------------------------------ */

export const manageSubagentsActionSchema = z.enum([
  "list",
  "status",
  "kill",
  "pause",
  "resume",
  "inspect",
]);
export type ManageSubagentsAction = z.infer<typeof manageSubagentsActionSchema>;

export const manageSubagentsParamsSchema = z.object({
  action: manageSubagentsActionSchema,
  subagentId: subagentIdSchema.optional(),
  inspectFile: z.enum(["progress.md", "BRIEFING.md", "handoff.md", "DISPATCH.md"]).optional(),
});
export type ManageSubagentsParams = z.infer<typeof manageSubagentsParamsSchema>;

export const subagentSummarySchema = z.object({
  id: subagentIdSchema,
  parentId: subagentIdSchema.nullable(),
  archetype: subagentArchetypeSchema,
  status: subagentStatusSchema,
  workingDirectory: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  lastHeartbeat: z.string().datetime(),
  tokensUsed: z.number().int().nonnegative(),
  lastProgressSummary: z.string().optional(),
});
export type SubagentSummary = z.infer<typeof subagentSummarySchema>;

export const manageSubagentsResultSchema = z.object({
  action: manageSubagentsActionSchema,
  subagents: z.array(subagentSummarySchema).optional(),
  detail: subagentSummarySchema.optional(),
  inspectedContent: z.string().optional(),
  success: z.boolean(),
});
export type ManageSubagentsResult = z.infer<typeof manageSubagentsResultSchema>;

/* ------------------------------------------------------------------------ */
/* Tool Schemas: send_message                                               */
/* ------------------------------------------------------------------------ */

export const sendMessageParamsSchema = z.object({
  recipientId: subagentIdSchema,
  subject: z.string().min(1).max(256),
  body: z.string().min(1).max(65536),
  referencedArtifacts: z.array(z.string()).default([]),
});
export type SendMessageParams = z.infer<typeof sendMessageParamsSchema>;

export const agentMessageFrameSchema = z.object({
  messageId: z.string().uuid(),
  senderId: subagentIdSchema,
  recipientId: subagentIdSchema,
  timestamp: z.string().datetime(),
  subject: z.string().max(256),
  body: z.string(),
  referencedArtifacts: z.array(z.string()).default([]),
});
export type AgentMessageFrame = z.infer<typeof agentMessageFrameSchema>;

/* ------------------------------------------------------------------------ */
/* Subagent WebSocket Wire Frames                                           */
/* ------------------------------------------------------------------------ */

export const subagentSpawnEventSchema = z.object({
  type: z.literal("subagent.spawned"),
  parentId: subagentIdSchema.nullable(),
  subagent: subagentSummarySchema,
  at: z.string().datetime(),
});

export const subagentStateEventSchema = z.object({
  type: z.literal("subagent.state"),
  subagentId: subagentIdSchema,
  status: subagentStatusSchema,
  reason: z.string().optional(),
  at: z.string().datetime(),
});

export const subagentMessageEventSchema = z.object({
  type: z.literal("subagent.message"),
  frame: agentMessageFrameSchema,
  at: z.string().datetime(),
});

export const subagentWireEventSchema = z.discriminatedUnion("type", [
  subagentSpawnEventSchema,
  subagentStateEventSchema,
  subagentMessageEventSchema,
]);
export type SubagentWireEvent = z.infer<typeof subagentWireEventSchema>;
```

### 8.2 Background Tasks & Schedules (`packages/protocol/src/tasks.ts`)

```typescript
import { z } from "zod";

export const taskIdSchema = z.string().uuid();
export type TaskId = z.infer<typeof taskIdSchema>;

export const taskStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const scheduleConditionSchema = z.union([
  z.literal("never"),
  z.literal("any"),
  z.string().uuid(), // specific sender ID
]);
export type ScheduleCondition = z.infer<typeof scheduleConditionSchema>;

/* ------------------------------------------------------------------------ */
/* Schedule Tool Params                                                     */
/* ------------------------------------------------------------------------ */

export const scheduleParamsSchema = z.object({
  prompt: z.string().min(1).max(4096),
  durationSeconds: z.number().int().positive().optional(),
  cronExpression: z.string().min(9).max(64).optional(),
  timerCondition: scheduleConditionSchema.default("never"),
  maxIterations: z.number().int().positive().optional(),
  isDaemon: z.boolean().default(false),
}).refine(
  (data) => (data.durationSeconds !== undefined) !== (data.cronExpression !== undefined),
  { message: "Must specify exactly one of durationSeconds or cronExpression" }
);
export type ScheduleParams = z.infer<typeof scheduleParamsSchema>;

export const manageTaskParamsSchema = z.object({
  action: z.enum(["list", "kill", "status", "send_input"]),
  taskId: taskIdSchema.optional(),
  input: z.string().optional(),
});
export type ManageTaskParams = z.infer<typeof manageTaskParamsSchema>;
```

---

## 9. Fastify Host Architecture & Handlers (`apps/agent-host`)

### 9.1 Host Session Hub & Supervisor Tree Implementation

In `apps/agent-host/src/subagents/supervisor.ts`, the `SubagentSupervisor` manages process trees, VFS workspaces, and message routing:

```typescript
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import type {
  SubagentId,
  SubagentSummary,
  InvokeSubagentParams,
  AgentMessageFrame,
  SubagentStatus,
} from "@protocol/subagent";
import { createWorktree, pruneWorktree } from "../workspace/gitWorktree";
import type { RunCoordinator } from "../runs/coordinator";

export interface SubagentNode {
  summary: SubagentSummary;
  coordinator: RunCoordinator;
  worktreePath?: string;
  abortController: AbortController;
  mailbox: AgentMessageFrame[];
}

export class SubagentSupervisor extends EventEmitter {
  private readonly nodes = new Map<SubagentId, SubagentNode>();
  private readonly parentToChildren = new Map<SubagentId, Set<SubagentId>>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly coordinatorFactory: (cwd: string, subagentId: string) => RunCoordinator,
    private readonly taskSupervisor?: { cancelSubagentTasks: (subagentId: string) => Promise<void> }
  ) {
    super();
  }

  private calculateDepth(parentId: SubagentId | null): number {
    let depth = 1;
    let currentId = parentId;
    const visited = new Set<SubagentId>();
    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      depth++;
      const parentNode = this.nodes.get(currentId);
      currentId = parentNode?.summary.parentId ?? null;
    }
    return depth;
  }

  async spawnChild(parentId: SubagentId | null, params: InvokeSubagentParams): Promise<SubagentSummary> {
    // Invariant SEC-SUB-05: Recursion depth capped at 3 tiers
    const depth = this.calculateDepth(parentId);
    if (depth > 3) {
      throw new Error(`ERR_SUBAGENT_MAX_DEPTH_EXCEEDED: Subagent hierarchy depth limit of 3 exceeded (attempted depth ${depth})`);
    }

    const id = randomUUID() as SubagentId;
    const agentDirName = `${params.archetype}_${id.slice(0, 8)}`;
    const metadataDir = path.join(this.workspaceRoot, ".agents", agentDirName);
    await fs.mkdir(metadataDir, { recursive: true });

    let effectiveCwd = this.workspaceRoot;
    let worktreePath: string | undefined;

    if (params.workspaceIsolation === "branch") {
      worktreePath = path.join(this.workspaceRoot, ".agents", "worktrees", id);
      await createWorktree(this.workspaceRoot, worktreePath, `nano/subagent-${id.slice(0, 8)}`);
      effectiveCwd = worktreePath;
    }

    const summary: SubagentSummary = {
      id,
      parentId,
      archetype: params.archetype,
      status: "spawning",
      workingDirectory: metadataDir,
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      tokensUsed: 0,
    };

    const abortController = new AbortController();
    const coordinator = this.coordinatorFactory(effectiveCwd, id);

    const node: SubagentNode = {
      summary,
      coordinator,
      worktreePath,
      abortController,
      mailbox: [],
    };

    this.nodes.set(id, node);
    if (parentId) {
      if (!this.parentToChildren.has(parentId)) {
        this.parentToChildren.set(parentId, new Set());
      }
      this.parentToChildren.get(parentId)!.add(id);
    }

    summary.status = "running";
    this.emit("spawned", summary);

    // Initialize BRIEFING.md and DISPATCH.md in metadata directory
    await this.initializeMetadata(metadataDir, summary, params);

    return summary;
  }

  async dispatchMessage(message: Omit<AgentMessageFrame, "messageId" | "timestamp">): Promise<AgentMessageFrame> {
    const frame: AgentMessageFrame = {
      ...message,
      messageId: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    const recipient = this.nodes.get(frame.recipientId);
    if (!recipient) {
      throw new Error(`Recipient subagent ${frame.recipientId} does not exist or has terminated`);
    }

    recipient.mailbox.push(frame);
    this.emit("message", frame);

    // Trigger reactive wakeup on recipient coordinator
    recipient.coordinator.notifyWakeup({
      type: "message",
      frame,
    });

    return frame;
  }

  async killTree(
    rootId: SubagentId,
    reason = "Supervisor termination",
    visited = new Set<SubagentId>()
  ): Promise<void> {
    if (visited.has(rootId)) return;
    visited.add(rootId);

    const children = this.parentToChildren.get(rootId);
    if (children) {
      for (const childId of Array.from(children)) {
        await this.killTree(childId, `Cascading kill from parent ${rootId}`, visited);
      }
    }

    const node = this.nodes.get(rootId);
    if (node) {
      node.abortController.abort(reason);
      node.summary.status = "terminated";
      node.summary.completedAt = new Date().toISOString();

      if (node.worktreePath) {
        await pruneWorktree(this.workspaceRoot, node.worktreePath).catch(() => {});
      }

      // Cancel all active scheduled cron jobs and timers associated with the killed subagent
      if (this.taskSupervisor) {
        await this.taskSupervisor.cancelSubagentTasks(rootId);
      }

      this.emit("state", { subagentId: rootId, status: "terminated", reason });

      // Trigger automatic fallback reactive wakeup for any parent/peer waiting on this sender
      this.notifyWaitersOfTermination(rootId, reason);
    }

    // Clean up parentToChildren and this.nodes mappings to prevent memory leaks
    this.parentToChildren.delete(rootId);
    if (node?.summary.parentId) {
      const siblings = this.parentToChildren.get(node.summary.parentId);
      if (siblings) {
        siblings.delete(rootId);
        if (siblings.size === 0) {
          this.parentToChildren.delete(node.summary.parentId);
        }
      }
    }
    this.nodes.delete(rootId);
  }

  private notifyWaitersOfTermination(terminatedId: SubagentId, reason: string): void {
    for (const [id, activeNode] of this.nodes.entries()) {
      if (id !== terminatedId) {
        activeNode.coordinator.notifyWakeup({
          type: "sender_terminated",
          senderId: terminatedId,
          reason,
        });
      }
    }
  }

  private async initializeMetadata(dir: string, summary: SubagentSummary, params: InvokeSubagentParams): Promise<void> {
    const briefingContent = `# BRIEFING — ${summary.startedAt}\n\n## Mission\n${params.prompt}\n\n## 🔒 My Identity\n- Archetype: ${summary.archetype}\n- Subagent ID: ${summary.id}\n- Parent ID: ${summary.parentId ?? "root"}\n- Working Directory: ${summary.workingDirectory}\n`;
    await fs.writeFile(path.join(dir, "BRIEFING.md"), briefingContent, "utf-8");
    await fs.writeFile(path.join(dir, "progress.md"), `# Progress Tracking\n\nLast visited: ${summary.startedAt}\nStatus: IN_PROGRESS\n`, "utf-8");
  }
}
```

### 9.2 Fastify WebSocket Integration (`apps/agent-host/src/routes/subagents.ts`)

```typescript
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  invokeSubagentParamsSchema,
  manageSubagentsParamsSchema,
  sendMessageParamsSchema,
} from "@protocol/subagent";
import type { SubagentSupervisor } from "../subagents/supervisor";

export function registerSubagentRoutes(fastify: FastifyInstance, supervisor: SubagentSupervisor) {
  supervisor.on("spawned", (summary) => {
    fastify.websocketServer.clients.forEach((client: WebSocket) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: "subagent.spawned", subagent: summary, at: new Date().toISOString() }));
      }
    });
  });

  supervisor.on("state", ({ subagentId, status, reason }) => {
    fastify.websocketServer.clients.forEach((client: WebSocket) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: "subagent.state", subagentId, status, reason, at: new Date().toISOString() }));
      }
    });
  });

  supervisor.on("message", (frame) => {
    fastify.websocketServer.clients.forEach((client: WebSocket) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: "subagent.message", frame, at: new Date().toISOString() }));
      }
    });
  });
}
```

---

## 10. Security Invariants & Audit Ledger

### 10.1 Security Invariants Table
| Invariant ID | Security Invariant Rule | Enforcement Layer | Failure Action |
|---|---|---|---|
| `SEC-SUB-01` | Subagents must never write outside assigned `.agents/<id>/` or designated git worktree. | `PolicyEngine.authorize()` + Path confinement | Immediate `deny` and subagent state flag |
| `SEC-SUB-02` | Subagents cannot escalate their own `allowedToolKinds` beyond what parent granted. | `SubagentSupervisor.spawnChild` | Synchronous validation error |
| `SEC-SUB-03` | Inter-agent messages must route through `SubagentSupervisor` mailbox; no raw socket hijacking. | Mailbox Message Router | Message dropped; audit warning logged |
| `SEC-SUB-04` | Single subagent token consumption cannot exceed `budgetTokens`. | `RunCoordinator` Token Meter | Abort turn and escalate to `replace` |
| `SEC-SUB-05` | Max supervisor recursion depth is capped at 3 tiers. | `SubagentSupervisor` depth check | Rejection of `invoke_subagent` call |

### 10.2 Forensic Audit Trail (`audit.db`)
All multi-agent operations are recorded into the tamper-proof SQLite audit database:
- `subagent_runs`: Stores `id`, `parent_id`, `archetype`, `prompt_hash`, `isolation_mode`, `started_at`, `completed_at`, `exit_status`.
- `inter_agent_messages`: Records `message_id`, `sender_id`, `recipient_id`, `subject`, `body_sha256`, `timestamp`.
- `subagent_tool_ledger`: Links each tool execution to its specific originating subagent UUID.

---

## 11. Acceptance Criteria & Test Plan

### 11.1 Verifiable Test Criteria
1. **Supervisor Tree Spawning (`vitest` unit tests)**:
   - Root agent successfully spawns 3 parallel subagents (`explorer`, `implementer`, `qa`).
   - Each subagent gets an isolated directory in `.agents/` and a valid `BRIEFING.md`.
2. **Reactive Wakeup Verification**:
   - Subagent enters `IDLE` state after completing turn.
   - Dispatching `send_message` from parent resumes child execution within $< 50\text{ms}$ without any background sleep polling.
3. **Branch Worktree Sandboxing**:
   - Subagent in `branch` mode makes file edits on `nano/subagent-1`.
   - Main repository workspace root remains unpolluted until explicit parent merge.
4. **Escalation Ladder Test**:
   - Inject intentional syntax error $\to$ verify `Retry` triggered.
   - Inject context overflow $\to$ verify `Replace` triggered with valid `handoff.md`.
   - Inject fatal policy failure $\to$ verify `Degrade` halts tree and emits user UI prompt.
5. **Cascading Termination**:
   - Calling `killTree(rootId)` terminates all child subagents and prunes worktrees cleanly with zero orphaned OS processes.

---
*End of PRD: Multi-Agent Orchestration & Hierarchical Subagents*
