# Product Requirements Document & Technical Specification
# Antigravity-Style Planning Mode, Dedicated Artifact Viewers, and Extensible Slash Command Engine

**Document Version:** 1.0.0  
**Target Milestone:** Phase 1 & Phase 2 UI/UX Architecture  
**Author:** Worker 3 (Planning & UI PRD Specialist)  
**Target Modules:** `packages/protocol`, `apps/agent-host`, `src/`  
**Status:** Approved for Implementation  

---

## Table of Contents
1. [Executive Summary & System Architecture Overview](#1-executive-summary--system-architecture-overview)
2. [Antigravity-Style Planning Mode PRD & Technical Architecture](#2-antigravity-style-planning-mode-prd--technical-architecture)
   - [2.1 Conceptual Framework & Lifecycle State Machine](#21-conceptual-framework--lifecycle-state-machine)
   - [2.2 Approval Gates & Side-Effect Policies](#22-approval-gates--side-effect-policies)
   - [2.3 Interactive Plan Composer & Visual DAG Engine](#23-interactive-plan-composer--visual-dag-engine)
   - [2.4 State Management & Pure Reducer Implementation](#24-state-management--pure-reducer-implementation)
   - [2.5 React Component Hierarchy & Component Architecture](#25-react-component-hierarchy--component-architecture)
   - [2.6 Wireframes: Plan Composer & Phase DAG](#26-wireframes-plan-composer--phase-dag)
3. [Dedicated Artifact Viewers PRD (Artifact Dock & Multi-Format Canvas)](#3-dedicated-artifact-viewers-prd-artifact-dock--multi-format-canvas)
   - [3.1 Architecture of the Dedicated Artifact Dock](#31-architecture-of-the-dedicated-artifact-dock)
   - [3.2 Multi-Format Rendering Engine](#32-multi-format-rendering-engine)
     - [3.2.1 Monaco Side-by-Side & Inline Code Diff Viewer](#321-monaco-side-by-side--inline-code-diff-viewer)
     - [3.2.2 Live Sandboxed HTML/React iFrame Preview Canvas](#322-live-sandboxed-htmlreact-iframe-preview-canvas)
     - [3.2.3 Mermaid Diagram & Architecture Visualizer](#323-mermaid-diagram--architecture-visualizer)
     - [3.2.4 Rich Interactive Markdown & Math Viewer](#324-rich-interactive-markdown--math-viewer)
     - [3.2.5 Visual Evidence & Multi-Image Carousel Gallery](#325-visual-evidence--multi-image-carousel-gallery)
   - [3.3 User Feedback Request Protocol & Interactive Hooks](#33-user-feedback-request-protocol--interactive-hooks)
   - [3.4 Artifact State Management & Pure Reducer Implementation](#34-artifact-state-management--pure-reducer-implementation)
   - [3.5 Component Hierarchy & Wireframes](#35-component-hierarchy--wireframes)
4. [Extensible Slash Command Engine PRD](#4-extensible-slash-command-engine-prd)
   - [4.1 Chat Composer Integration & Autocomplete Palette](#41-chat-composer-integration--autocomplete-palette)
   - [4.2 Built-in Command Specifications](#42-built-in-command-specifications)
   - [4.3 Command Engine Architecture, Parser & Extensibility SDK](#43-command-engine-architecture-parser--extensibility-sdk)
   - [4.4 Slash Command State Management & Pure Reducer](#44-slash-command-state-management--pure-reducer)
   - [4.5 Component Hierarchy & Wireframes](#45-component-hierarchy--wireframes)
5. [Complete TypeScript Protocol Schemas (`packages/protocol`)](#5-complete-typescript-protocol-schemas-packagesprotocol)
   - [5.1 Upgraded Plan Contracts (`packages/protocol/src/plan.ts`)](#51-upgraded-plan-contracts-packagesprotocolsrcplants)
   - [5.2 Artifact Protocol Contracts (`packages/protocol/src/artifacts.ts`)](#52-artifact-protocol-contracts-packagesprotocolsrcartifactsts)
   - [5.3 Slash Command Protocol Contracts (`packages/protocol/src/commands.ts`)](#53-slash-command-protocol-contracts-packagesprotocolsrccommandsts)
   - [5.4 WebSocket Wire Frames & Ingestion Contracts (`packages/protocol/src/wire.ts`)](#54-websocket-wire-frames--ingestion-contracts-packagesprotocolsrcwirets)
6. [Testing Strategy, Edge Cases & Verification Criteria](#6-testing-strategy-edge-cases--verification-criteria)
   - [6.1 Unit Testing Strategy & Test Suites (Vitest)](#61-unit-testing-strategy--test-suites-vitest)
   - [6.2 WebSocket Wire Protocol & Integration Test Cases](#62-websocket-wire-protocol--integration-test-cases)
   - [6.3 UI Component & Interaction Test Matrix (React Testing Library)](#63-ui-component--interaction-test-matrix-react-testing-library)
   - [6.4 Edge Cases & Security Vulnerability Matrix](#64-edge-cases--security-vulnerability-matrix)
   - [6.5 Acceptance Verification Checklist](#65-acceptance-verification-checklist)

---

## 1. Executive Summary & System Architecture Overview

### 1.1 Mission & Product Vision
NanoForge aims to deliver an enterprise-grade, high-ergonomics agentic software development environment that bridges the raw power of CLI execution (Claude Code) and the rich visual control planes of Antigravity and Claude Desktop. 

Current limitations identified in our architectural audit include:
1. **Planning Mode Fragility**: Read-only static step lists without visual DAG manipulation, phase groupings, user-driven step insertion/reordering, or revision forking.
2. **Fragmented Artifact Visualization**: Lack of a persistent, multi-format right-side Artifact Dock capable of rendering Monaco side-by-side diffs, sandboxed HTML/React live previews, Mermaid diagrams, and revision histories.
3. **Absence of a Native Slash Command Engine**: No keyboard-driven inline command palette (`/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/compact`, `/cost`, `/export`) with parameter parsing, contextual chips, and plugin extensibility.

This PRD establishes the authoritative architectural specifications, wireframes, pure state reducers, and TypeScript protocol contracts to eliminate these gaps.

```
+---------------------------------------------------------------------------------------------------------+
|                                        NANOFORGE DESKTOP UI                                             |
|                                                                                                         |
|  +----------------+  +-------------------------------------+  +--------------------------------------+  |
|  |    SIDEBAR     |  |       CENTER CHAT & COMPOSER        |  |         RIGHT-SIDE DOCK             |  |
|  | - Sessions     |  | - Transcript / Streamed Tokens      |  |  [Plan Mode]    [Artifact Canvas]    |  |
|  | - Workspace FS |  | - ToolRunCards / Visual Evidence    |  |  - Phase DAG    - Monaco Diff View   |  |
|  | - Subagents    |  | - Slash Palette (/plan, /browse)    |  |  - Step Gates   - Live React/HTML    |  |
|  | - Skills/Rules |  | - Context Budget & Mentions (@file) |  |  - Revisions    - Mermaid / KaTeX    |  |
|  +----------------+  +-------------------------------------+  +--------------------------------------+  |
+---------------------------------------------------------------------------------------------------------+
                                                     |
                                   WebSocket Frame Transport (JSON / Zod)
                                   `ws://127.0.0.1:<port>/agent?token=<tok>`
                                                     v
+---------------------------------------------------------------------------------------------------------+
|                                       PRIVILEGED AGENT HOST                                             |
|                                                                                                         |
|  +-------------------------+  +-------------------------+  +-----------------------------------------+  |
|  |   Protocol Dispatcher   |  |     Run Coordinator     |  |          Subsystem Engines              |  |
|  | - Wire Schema Validator |  | - Multi-Turn Loop       |  | - Terminal Runner (Execa + 1MB Buffer)  |  |
|  | - Session Mailbox       |  | - DAG Sched & Routing   |  | - Playwright Verifier (DOM/Pixel Diff)  |  |
|  | - Redaction & Audit DB  |  | - Policy Approval Gates |  | - MCP Client Pool (Stdio/SSE Transport) |  |
|  +-------------------------+  +-------------------------+  +-----------------------------------------+  |
+---------------------------------------------------------------------------------------------------------+
```

### 1.2 Core Security Invariants & Approval Principles
1. **Zero Natural Language Authority**: Model-generated text strings in chat (e.g. `"I have approved the plan"` or `"Step 1 succeeded"`) **CAN NEVER** satisfy an approval gate or mutate execution state. Approvals MUST originate from cryptographically verified user UI interaction or explicit client wire frames.
2. **Client Approval Ledger Invariant**: The UI layer maintains its own authoritative `ReadonlySet<string>` approval ledger keyed to `(planId, revisionId)`. If a compromised or faulty host attempts to transition an unapproved `approval: "required"` step to `"running"`, the client UI immediately downgrades the rendered status to `"blocked"` and dispatches an execution veto.
3. **Deterministic DAG Validation**: Cycles, dangling dependencies, and unapproved side-effecting steps are rejected at both client compose time and host ingest time via Tarjan's Strongly Connected Components (SCC) algorithm.
4. **Sandboxed Rendering Isolation**: Live HTML/React previews are isolated in an `iframe` with `sandbox="allow-scripts allow-forms allow-popups"` and a strict Content Security Policy (CSP) blocking network access to loopback host ports.

---

## 2. Antigravity-Style Planning Mode PRD & Technical Architecture

### 2.1 Conceptual Framework & Lifecycle State Machine

The Planning Mode elevates complex tasks from blind sequential execution into an observable, inspectable, and editable workflow. Plans are structured as **Hierarchical Directed Acyclic Graphs (DAGs)** partitioned into ordered **Phases**.

```
               +------------------------------------------------------------+
               |                           DRAFT                            |
               | (Authoring in PlanComposer, AI proposal, manual additions) |
               +------------------------------------------------------------+
                                             |
                                     Submit for Review
                                             v
               +------------------------------------------------------------+
               |                     AWAITING_APPROVAL                      |
               |    (Inspecting steps, checking diffs, granting approvals)  |
               +------------------------------------------------------------+
                                             |
                                     All Approvals Met
                                             v
               +------------------------------------------------------------+
+------------> |                         EXECUTING                          | <-----------+
|              |     (Ready steps dispatched topologically by coordinator)  |             |
|              +------------------------------------------------------------+             |
|                        |                     |                     |                    |
|                Pause Triggered         Step Failed           All Done                   |
|                        v                     v                     v                    |
|              +-----------------+   +------------------+   +-----------------+           |
|              |     PAUSED      |   |      FAILED      |   |    COMPLETED    |           |
|              +-----------------+   +------------------+   +-----------------+           |
|                        |                     |                                          |
+--- Resume Execution ---+                     +--- Fork Revision / Retry Step -----------+
```

#### 2.1.1 Step Execution Lifecycle
Each step inside a plan follows a strictly validated lifecycle:
- `pending`: Upstream dependencies are not yet satisfied.
- `ready`: All upstream dependencies have reached `succeeded`; awaiting execution dispatch or user approval.
- `running`: Currently executing in the agent host.
- `succeeded`: Execution finished with exit code 0 / successful assertion; downstream steps are released.
- `failed`: Execution failed, process crashed, or assertion rejected. Halts dependent branch.
- `blocked`: Step requires user approval or has an upstream dependency that failed.
- `skipped`: Step was intentionally bypassed by user action or conditional branch resolution.

#### 2.1.2 Dynamic Phase Grouping Architecture
Steps are organized into logical execution phases:
1. `Phase 1: Discovery & Workspace Audit` (Read-only scans, repo indexing, AST analysis, requirement gathering).
2. `Phase 2: Core Implementation & Refactoring` (Code modifications, file creations, configuration updates).
3. `Phase 3: Automated Verification & Testing` (Unit tests, Playwright visual assertions, linting, regression tests).
4. `Phase 4: Handoff & Documentation` (PR generation, release notes, audit ledger sealing).

Each phase has its own aggregate progress, resource estimate, and **Batch Approval Gate** (`"Approve Entire Phase"`).

#### 2.1.3 Plan Revisions, Diffing & Forking Lifecycle
When a step fails or requirements change mid-flight:
1. The current plan snapshot is sealed as immutable `Revision N` with its execution audit trail intact.
2. The user or agent creates `Revision N+1` by forking from `Revision N`.
3. Succeeded steps in `Revision N` are retained in `succeeded` state, preserving work already completed.
4. Failed or new steps are edited in the `PlanComposer`.
5. An interactive **Plan Diff Viewer** highlights added, modified, or removed steps prior to re-submission.

### 2.2 Approval Gates & Side-Effect Policies

```
+---------------------------------------------------------------------------------------+
|                                 STEP APPROVAL MATRIX                                  |
+----------------------+--------------------+---------------------+---------------------+
| Step Characteristics | Default Policy     | Client UI Action    | Server Verification |
+----------------------+--------------------+---------------------+---------------------+
| Read-Only Operations | Auto-Approved      | Info badge          | Static allowlist    |
| (git status, search) | (approval: "none") | (No gate)           | (No token required) |
+----------------------+--------------------+---------------------+---------------------+
| Side-Effecting Write | Approval Required  | Amber Shield Badge  | Cryptographic Token |
| (file.write, patch)  | (approval: "req")  | Explicit Click Req  | Rejects unapproved  |
+----------------------+--------------------+---------------------+---------------------+
| Destructive CLI      | Approval Required  | Red Warning Box     | Mandatory Session   |
| (rm -rf, db drop)    | + Reason Modal     | Detailed Scopes Req | Interactive Prompt  |
+----------------------+--------------------+---------------------+---------------------+
| Subagent Spawning    | Phase-Gated        | Fleet Cap Badge     | Concurrency check   |
| (invoke_subagent)    | (approval: "req")  | Resource Budget Req | Workspace isolation |
+----------------------+--------------------+---------------------+---------------------+
```

#### 2.2.1 Two-Tier Security Gate Architecture
- **Tier 1 (Client-Side Approval Ledger)**: The UI maintains `approvedStepIds: ReadonlySet<string>`. Even if the model emits a tool call, `PlanPanel` blocks dispatch until the user explicitly checks the box or clicks `"Approve Step"`.
- **Tier 2 (Server-Side Policy Engine)**: `apps/agent-host/src/planning/validatePlan.ts` asserts that every step with `sideEffecting: true` has `approval: "required"`. When `RunCoordinator` reaches an approval-required step, it checks the cryptographic approval token received in the `approval.grant` WebSocket frame.

### 2.3 Interactive Plan Composer & Visual DAG Engine

```
+-------------------------------------------------------------------------------------------------------+
|  PLAN COMPOSER: Interactive Visual DAG & Phase Builder                                                |
|                                                                                                       |
|  [+ Add Phase]  [+ Add Step]  [Auto-Layout DAG]  [Detect Cycles]  [Import Template v]  [Export Plan]  |
|  ---------------------------------------------------------------------------------------------------  |
|                                                                                                       |
|  Phase 1: Discovery & Analysis (100% Complete)                                 [v] Collapse  [Approved] |
|  +------------------------------------+       +------------------------------------+                  |
|  | 1.1 Read Project Layout            | ----> | 1.2 Scan Lint & Dependency Errors  |                  |
|  | [Read-Only] [Status: Succeeded]    |       | [Read-Only] [Status: Succeeded]    |                  |
|  +------------------------------------+       +------------------------------------+                  |
|                                                                  |                                    |
|  ----------------------------------------------------------------|----------------------------------  |
|  Phase 2: Core Implementation (In Progress)                      v              [v] Collapse  [Approve Phase]|
|  +------------------------------------+       +------------------------------------+                  |
|  | 2.1 Update Protocol Interfaces     | ----> | 2.2 Refactor PlanPanel Component   |                  |
|  | [Side-Effecting] [Status: Succeeded|       | [Side-Effecting] [Status: Running] |                  |
|  +------------------------------------+       +------------------------------------+                  |
|                                                                  |                                    |
|  ----------------------------------------------------------------|----------------------------------  |
|  Phase 3: Verification & Test (Pending Approval)                 v              [v] Collapse  [Approve Phase]|
|  +------------------------------------+       +------------------------------------+                  |
|  | 3.1 Run Vitest Test Suites         | ----> | 3.2 Visual Pixel Diff Verification |                  |
|  | [Side-Effecting] [Status: Blocked] |       | [Browser] [Status: Pending]        |                  |
|  +------------------------------------+       +------------------------------------+                  |
+-------------------------------------------------------------------------------------------------------+
```

#### 2.3.1 Graph Dependency Model & Cycle Detection
The visual DAG is represented as a directed graph $G = (V, E)$ where $V = \text{Steps}$ and $E = \{(u, v) \mid v.\text{dependsOn contains } u.\text{id}\}$.
The client runs Tarjan's algorithm to ensure $G$ is a strict DAG. If any cycle is detected:
1. The offending edge is highlighted in pulsing red (`stroke-red-500`).
2. An error banner displays: `"Cycle detected between Step X and Step Y. Plan cannot be executed until resolved."`
3. The `"Run Plan"` button is hard-disabled.

### 2.4 State Management & Pure Reducer Implementation

```typescript
// src/lib/planComposerReducer.ts
import type { ExecutionPlan, PlanStep, PlanPhase, PlanUIState } from "@/types";

export interface PlanComposerState {
  plan: ExecutionPlan;
  selectedStepId: string | null;
  selectedPhaseId: string | null;
  approvedStepIds: ReadonlySet<string>;
  history: ExecutionPlan[];
  historyIndex: number;
  isDirty: boolean;
  validationErrors: string[];
}

export type PlanComposerAction =
  | { type: "ADD_PHASE"; phase: Omit<PlanPhase, "id"> }
  | { type: "REMOVE_PHASE"; phaseId: string }
  | { type: "RENAME_PHASE"; phaseId: string; title: string }
  | { type: "ADD_STEP"; phaseId: string; step: Omit<PlanStep, "id"> }
  | { type: "UPDATE_STEP"; stepId: string; updates: Partial<PlanStep> }
  | { type: "REMOVE_STEP"; stepId: string }
  | { type: "REORDER_STEPS"; phaseId: string; sourceIndex: number; destinationIndex: number }
  | { type: "ADD_DEPENDENCY"; stepId: string; dependsOnStepId: string }
  | { type: "REMOVE_DEPENDENCY"; stepId: string; dependsOnStepId: string }
  | { type: "TOGGLE_APPROVAL"; stepId: string }
  | { type: "APPROVE_PHASE"; phaseId: string }
  | { type: "APPROVE_ALL" }
  | { type: "SET_PLAN_STATE"; state: PlanUIState }
  | { type: "LOAD_PLAN"; plan: ExecutionPlan }
  | { type: "UNDO" }
  | { type: "REDO" };

function hasCycle(steps: PlanStep[], fromStepId: string, toStepId: string): boolean {
  // Adding edge from fromStepId -> toStepId (fromStepId dependsOn toStepId).
  // Cycle exists if toStepId can already reach fromStepId via existing dependsOn edges.
  const adj = new Map<string, string[]>();
  for (const step of steps) {
    adj.set(step.id, step.dependsOn);
  }
  const visited = new Set<string>();
  const stack = [toStepId];
  while (stack.length > 0) {
    const curr = stack.pop()!;
    if (curr === fromStepId) return true;
    if (visited.has(curr)) continue;
    visited.add(curr);
    const neighbors = adj.get(curr) || [];
    for (const n of neighbors) {
      stack.push(n);
    }
  }
  return false;
}

export function planComposerReducer(
  state: PlanComposerState,
  action: PlanComposerAction
): PlanComposerState {
  switch (action.type) {
    case "ADD_STEP": {
      const newStepId = `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newStep: PlanStep = {
        id: newStepId,
        phaseId: action.phaseId,
        title: action.step.title,
        dependsOn: action.step.dependsOn ?? [],
        status: "pending",
        approval: action.step.sideEffecting ? "required" : action.step.approval,
        sideEffecting: action.step.sideEffecting ?? false,
        affectedScopes: action.step.affectedScopes ?? [],
        estimate: action.step.estimate,
      };
      const updatedSteps = [...state.plan.steps, newStep];
      return pushHistory(state, {
        ...state.plan,
        steps: updatedSteps,
      });
    }

    case "UPDATE_STEP": {
      const updatedSteps = state.plan.steps.map((s) => {
        if (s.id !== action.stepId) return s;
        const merged = { ...s, ...action.updates };
        // Invariant: sideEffecting always requires approval
        if (merged.sideEffecting) merged.approval = "required";
        return merged;
      });
      return pushHistory(state, {
        ...state.plan,
        steps: updatedSteps,
      });
    }

    case "REMOVE_STEP": {
      // Prune step and clean up dangling references in remaining steps' dependsOn arrays
      const updatedSteps = state.plan.steps
        .filter((s) => s.id !== action.stepId)
        .map((s) => ({
          ...s,
          dependsOn: s.dependsOn.filter((id) => id !== action.stepId),
        }));

      const nextApprovals = new Set(state.approvedStepIds);
      nextApprovals.delete(action.stepId);

      return pushHistory(
        {
          ...state,
          selectedStepId: state.selectedStepId === action.stepId ? null : state.selectedStepId,
          approvedStepIds: nextApprovals,
        },
        {
          ...state.plan,
          steps: updatedSteps,
        }
      );
    }

    case "REMOVE_PHASE": {
      const stepsToRemove = new Set(
        state.plan.steps.filter((s) => s.phaseId === action.phaseId).map((s) => s.id)
      );

      const updatedSteps = state.plan.steps
        .filter((s) => s.phaseId !== action.phaseId)
        .map((s) => ({
          ...s,
          dependsOn: s.dependsOn.filter((id) => !stepsToRemove.has(id)),
        }));

      const updatedPhases = state.plan.phases
        .filter((p) => p.id !== action.phaseId)
        .map((p, idx) => ({ ...p, order: idx + 1 }));

      const nextApprovals = new Set(state.approvedStepIds);
      for (const stepId of stepsToRemove) {
        nextApprovals.delete(stepId);
      }

      return pushHistory(
        {
          ...state,
          selectedPhaseId: state.selectedPhaseId === action.phaseId ? null : state.selectedPhaseId,
          selectedStepId: stepsToRemove.has(state.selectedStepId ?? "") ? null : state.selectedStepId,
          approvedStepIds: nextApprovals,
        },
        {
          ...state.plan,
          phases: updatedPhases,
          steps: updatedSteps,
        }
      );
    }

    case "ADD_DEPENDENCY": {
      if (action.stepId === action.dependsOnStepId) return state; // Self-loop forbidden
      const targetExists = state.plan.steps.some((s) => s.id === action.dependsOnStepId);
      if (!targetExists) return state;

      // DFS Cycle Detection: reject if adding dependency creates a directed cycle
      if (hasCycle(state.plan.steps, action.stepId, action.dependsOnStepId)) {
        return {
          ...state,
          validationErrors: [
            ...state.validationErrors,
            `Cannot add dependency from '${action.stepId}' to '${action.dependsOnStepId}': introduces a directed cycle.`,
          ],
        };
      }

      const updatedSteps = state.plan.steps.map((s) => {
        if (s.id !== action.stepId) return s;
        if (s.dependsOn.includes(action.dependsOnStepId)) return s;
        return { ...s, dependsOn: [...s.dependsOn, action.dependsOnStepId] };
      });
      return pushHistory(state, {
        ...state.plan,
        steps: updatedSteps,
      });
    }

    case "REMOVE_DEPENDENCY": {
      const updatedSteps = state.plan.steps.map((s) => {
        if (s.id !== action.stepId) return s;
        return {
          ...s,
          dependsOn: s.dependsOn.filter((id) => id !== action.dependsOnStepId),
        };
      });
      return pushHistory(state, {
        ...state.plan,
        steps: updatedSteps,
      });
    }

    case "TOGGLE_APPROVAL": {
      const nextApprovals = new Set(state.approvedStepIds);
      if (nextApprovals.has(action.stepId)) {
        nextApprovals.delete(action.stepId);
      } else {
        nextApprovals.add(action.stepId);
      }
      return {
        ...state,
        approvedStepIds: nextApprovals,
      };
    }

    case "APPROVE_PHASE": {
      const phaseSteps = state.plan.steps.filter((s) => s.phaseId === action.phaseId);
      const nextApprovals = new Set(state.approvedStepIds);
      phaseSteps.forEach((s) => nextApprovals.add(s.id));
      return {
        ...state,
        approvedStepIds: nextApprovals,
      };
    }

    case "APPROVE_ALL": {
      const nextApprovals = new Set(state.plan.steps.map((s) => s.id));
      return {
        ...state,
        approvedStepIds: nextApprovals,
      };
    }

    case "LOAD_PLAN": {
      // Preserve approvedStepIds for steps that still exist in the reloaded plan
      const existingStepIds = new Set(action.plan.steps.map((s) => s.id));
      const preservedApprovals = new Set(
        Array.from(state.approvedStepIds).filter((id) => existingStepIds.has(id))
      );

      return {
        ...state,
        plan: action.plan,
        history: [action.plan],
        historyIndex: 0,
        isDirty: false,
        approvedStepIds: preservedApprovals,
        validationErrors: [],
      };
    }

    case "UNDO": {
      if (state.historyIndex <= 0) return state;
      const nextIndex = state.historyIndex - 1;
      return {
        ...state,
        plan: state.history[nextIndex],
        historyIndex: nextIndex,
      };
    }

    case "REDO": {
      if (state.historyIndex >= state.history.length - 1) return state;
      const nextIndex = state.historyIndex + 1;
      return {
        ...state,
        plan: state.history[nextIndex],
        historyIndex: nextIndex,
      };
    }

    default:
      return state;
  }
}

function pushHistory(state: PlanComposerState, newPlan: ExecutionPlan): PlanComposerState {
  const newHistory = state.history.slice(0, state.historyIndex + 1);
  newHistory.push(newPlan);
  return {
    ...state,
    plan: newPlan,
    history: newHistory,
    historyIndex: newHistory.length - 1,
    isDirty: true,
  };
}
```

### 2.5 React Component Hierarchy & Component Architecture

```
PlanViewContainer (Root)
│
├── PlanHeader
│   ├── PlanGoalTitle (Editable in draft mode)
│   ├── PlanStateBadge (draft | awaiting_approval | executing | paused | completed)
│   ├── RevisionSelector (Dropdown: Revision 1, Revision 2 [forked])
│   └── ViewModeToggle (Checklist View | Visual DAG View | Split View)
│
├── PlanToolbar
│   ├── AddPhaseButton
│   ├── AddStepButton
│   ├── AutoLayoutButton (Forces topological DAG alignment)
│   ├── CycleValidatorIndicator (Green check / Red alert)
│   └── UndoRedoControls
│
├── (Conditional View Branch)
│   ├── ChecklistView
│   │   └── PhaseGroupList
│   │       └── PhaseGroup (Collapsible accordion per phase)
│   │           ├── PhaseHeader (Title, aggregate progress bar, "Approve Phase" button)
│   │           └── PlanStepList (Draggable container)
│   │               └── PlanStepCard (Draggable item)
│   │                   ├── StepHandle (Drag handle for reordering)
│   │                   ├── StepStatusIcon (Animated spinner / Check / Cross / Lock)
│   │                   ├── StepTitle & ScopeBadges
│   │                   ├── DependencyPills (Interactive links to parent steps)
│   │                   ├── ResourceEstimateBadge (~2.4k tok, $0.012, ~12s)
│   │                   ├── SideEffectingAlertBadge (Requires approval)
│   │                   └── StepApprovalGateCheckbox
│   │
│   └── DAGView (Visual Canvas via React Flow / SVG)
│       └── PlanDAGCanvas
│           ├── DAGNode (Custom ReactFlow step node with status halos & drag handles)
│           ├── DAGEdge (Bezier curve with animated pulse on active data flow)
│           ├── PhaseBoundingBox (Visual cluster surrounding phase nodes)
│           └── MiniMap & ZoomControls
│
└── PlanExecutionFooter (Sticky control bar)
    ├── ApprovalProgressSummary (e.g. "4 of 6 steps approved")
    ├── CostEstimateSummary (Total estimated: $0.045 USD)
    ├── RunApprovedPlanButton (Primary CTA, disabled until approvals met)
    ├── PauseButton (Pauses run coordinator)
    └── CancelButton (Aborts run and kills process tree)
```

### 2.6 Wireframes: Plan Composer & Phase DAG

```
+---------------------------------------------------------------------------------------------------+
|  [ListChecks] PLAN: Multi-Agent Refactoring & Monaco Diff Integration   [REVISION 2 (Current) v]  |
|  State: AWAITING APPROVAL | 5/6 Steps Approved | Total Est: ~8,500 tok · $0.038 USD · ~45s        |
|  [Checklist View | [DAG View] | Split]    [+ Phase] [+ Step] [Auto-Layout] [Undo] [Redo]          |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  PHASE 1: DISCOVERY & PROTOCOL AUDIT (2/2 Done)                       [v] [✓ Phase Approved]      |
|  +---------------------------------------------------------------------------------------------+  |
|  | [::] [✓] 1. Inspect existing Protocol Schemas in packages/protocol/src/plan.ts            |  |
|  |      Scopes: [packages/protocol/src/**] | ~1.2k tok · $0.004 · 5s | [Read-Only]             |  |
|  +---------------------------------------------------------------------------------------------+  |
|  | [::] [✓] 2. Audit PlanPanel Component Gaps in src/sections/PlanPanel.tsx                  |  |
|  |      Depends On: [Step 1] | Scopes: [src/sections/**] | ~1.5k tok · $0.006 · 8s             |  |
|  +---------------------------------------------------------------------------------------------+  |
|                                                                                                   |
|  PHASE 2: IMPLEMENTATION (2/3 Approved)                               [v] [Approve Phase]         |
|  +---------------------------------------------------------------------------------------------+  |
|  | [::] [✓] 3. Implement MonacoDiffViewer in src/components/artifacts/MonacoDiffViewer.tsx   |  |
|  |      Depends On: [Step 2] | Scopes: [src/components/artifacts/**] | [Side-Effecting]        |  |
|  |      Status: Approved [✓]                                                                   |  |
|  +---------------------------------------------------------------------------------------------+  |
|  | [::] [✓] 4. Integrate Live Sandbox Preview Canvas with Security iframe                    |  |
|  |      Depends On: [Step 3] | Scopes: [src/components/artifacts/**] | [Side-Effecting]        |  |
|  |      Status: Approved [✓]                                                                   |  |
|  +---------------------------------------------------------------------------------------------+  |
|  | [::] [!] 5. Connect WebSocket Wire Frames in apps/agent-host/src/session.ts                |  |
|  |      Depends On: [Step 3, Step 4] | Scopes: [apps/agent-host/**] | [Side-Effecting]         |  |
|  |      Status: [  ] AWAITING APPROVAL  --->  [ [ShieldCheck] Click to Approve Step ]          |  |
|  +---------------------------------------------------------------------------------------------+  |
|                                                                                                   |
|  PHASE 3: VERIFICATION (1/1 Approved)                                 [v] [✓ Phase Approved]      |
|  +---------------------------------------------------------------------------------------------+  |
|  | [::] [✓] 6. Run Vitest Test Suites (npm run test:host && npm test)                         |  |
|  |      Depends On: [Step 5] | Scopes: [test/**] | [Side-Effecting]                            |  |
|  |      Status: Approved [✓]                                                                   |  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
|  [ShieldAlert] 1 Step Requires Approval Before Execution Can Begin                                |
|  [Run Approved Steps (5)]  [Pause Execution]  [Cancel Run]              [Export Plan as Markdown] |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Dedicated Artifact Viewers PRD (Artifact Dock & Multi-Format Canvas)

### 3.1 Architecture of the Dedicated Artifact Dock

The Right-Side **Artifact Dock** is a persistent, dockable control surface providing multi-format rendering of files, diffs, live applications, interactive diagrams, and visual verification artifacts.

```
+---------------------------------------------------------------------------------------------------------+
|                                      ARTIFACT DOCK CONTROL SURFACE                                      |
+---------------------------------------------------------------------------------------------------------+
| [Tabs: [Diff: server.ts] [Preview: Dashboard.tsx] [Diagram: System Arch] [Image: baseline.png] [+] ]    |
| ------------------------------------------------------------------------------------------------------- |
| Meta: auth-service.ts · v3 (Latest) · 4.2 KB · SHA-256: 7f8a...3e1b · [RequestFeedback: Active]        |
| Summary: "Refactored token extraction to use constant-time comparison against timing attacks"          |
| ------------------------------------------------------------------------------------------------------- |
| [ < Rev 1 | Rev 2 | [Rev 3 (Current)] > ]   [View Mode: [Split Diff v] ]   [Fullscreen] [Popout] [x]    |
+---------------------------------------------------------------------------------------------------------+
|                                                                                                         |
|  <<< MULTI-FORMAT RENDERING ENGINE (Monaco / Live Sandbox / Mermaid / Markdown / Carousel) >>>          |
|                                                                                                         |
+---------------------------------------------------------------------------------------------------------+
| USER FEEDBACK ACTION BAR:                                                                               |
| [Prompt: "Does this timing-attack refactor meet your security requirements?"]                           |
| [ [✓ Accept Artifact] ]  [ [✎ Request Modifications] ]  [ [✕ Reject] ]  [Input feedback comments...]    |
+---------------------------------------------------------------------------------------------------------+
```

#### 3.1.1 Artifact Metadata Schema
Every artifact generated in NanoForge carries structured metadata:
- `id`: Globally unique UUIDv4.
- `runId`: ID of the host run or subagent that produced the artifact.
- `name`: User-facing artifact name (e.g. `AuthService.diff`, `ArchitectureDiagram.mermaid`).
- `mimeType`: Standard MIME type (`text/x-diff`, `text/html`, `application/typescript`, `image/png`, `text/vnd.mermaid`).
- `relativePath`: Workspace-relative path where the artifact lives or applies.
- `byteLength`: Exact byte length.
- `sha256`: Cryptographic digest.
- `userFacing`: `true` if intended for user presentation; `false` for internal temp logs.
- `requestFeedback`: When `true`, displays the interactive `ArtifactFeedbackBar` requiring user confirmation.
- `feedbackPrompt`: Custom natural language question posed by the agent to the user.
- `revision`: Version counter (1, 2, 3...) for tracking progressive iterations.
- `parentArtifactId`: Pointer to the prior version to enable delta computation.

### 3.2 Multi-Format Rendering Engine

```
                                  +-----------------------+
                                  |   Artifact Dispatch   |
                                  +-----------------------+
                                              |
               +------------------------------+------------------------------+
               |                              |                              |
               v                              v                              v
    +--------------------+         +--------------------+         +--------------------+
    |  MonacoDiffViewer  |         | SandboxPreview     |         | MermaidViewer      |
    | - Side-by-Side     |         | - iframe sandbox   |         | - SVG DOM Render   |
    | - Unified Inline   |         | - React/Tailwind   |         | - Pan/Zoom Engine  |
    | - Syntax Tokenizer |         | - Device Switcher  |         | - Error Fallback   |
    +--------------------+         +--------------------+         +--------------------+
               |                              |                              |
               +------------------------------+------------------------------+
                                              |
               +------------------------------+------------------------------+
               |                                                             |
               v                                                             v
    +--------------------+                                        +--------------------+
    |  MarkdownViewer    |                                        |  GalleryViewer     |
    | - GFM + KaTeX Math |                                        | - Pixel Diff Alpha |
    | - Syntax Highlight |                                        | - Image Carousel   |
    | - Task Checkboxes  |                                        | - Pan / Zoom 800%  |
    +--------------------+                                        +--------------------+
```

#### 3.2.1 Monaco Side-by-Side & Inline Code Diff Viewer
- **Engine**: `@monaco-editor/react` wrapping VS Code's Monaco Core.
- **Modes**: Side-by-side (`split`) and inline unified (`unified`).
- **Features**:
  - Mini-map with colored deletion/addition regions.
  - Interactive Hunk Navigation (`Next Diff`, `Prev Diff`).
  - Hunk Staging: User can select individual hunks to apply or discard.
  - Intelligent language auto-detection based on file extension and shebang.

#### 3.2.2 Live Sandboxed HTML/React iFrame Preview Canvas
- **Security Sandboxing**:
  ```html
  <iframe
    sandbox="allow-scripts allow-forms allow-popups"
    csp="default-src 'self' 'unsafe-inline' data: blob: https://cdn.tailwindcss.com https://unpkg.com; connect-src 'none';"
    srcDoc="..."
  />
  ```
- **Virtual Asset Bundler**: In-memory bundle synthesizer that injects:
  1. Tailwind CSS via CDN.
  2. React 19 and React DOM via UMD blobs.
  3. Babel Standalone for live in-browser JSX compilation.
  4. Global error handler capturing uncaught exceptions and forwarding them via `postMessage` to the parent window console drawer.
- **Responsive Device Switcher**:
  - Mobile (375 × 667 px - iPhone SE)
  - Tablet (768 × 1024 px - iPad Mini)
  - Desktop (1280 × 800 px - MacBook Air)
  - Fluid (100% responsive width)

#### 3.2.3 Mermaid Diagram & Architecture Visualizer
- **Engine**: `mermaid.js` dynamic SVG rendering.
- **Supported Diagram Types**: Flowcharts (`graph TD / LR`), Sequence Diagrams (`sequenceDiagram`), Class Diagrams (`classDiagram`), State Diagrams (`stateDiagram-v2`), Entity Relationship Diagrams (`erDiagram`), User Journey (`journey`), Gantt Charts (`gantt`).
- **Interactivity**: Pan/Zoom canvas powered by D3/SVG-Pan-Zoom, node click event forwarding, SVG/PNG export buttons.

#### 3.2.4 Rich Interactive Markdown & Math Viewer
- **Engine**: `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-highlight`.
- **Features**: GitHub Flavored Markdown (GFM) tables, task lists with click handlers, KaTeX mathematical formulas ($\LaTeX$), copyable code blocks with line numbering.

#### 3.2.5 Visual Evidence & Multi-Image Carousel Gallery
- **Engine**: Side-by-side pixel diff comparison and interactive alpha crossfade slider.
- **Features**:
  - Baseline Image (Expected) vs. Current Image (Actual) vs. Pixel Diff Heatmap (Overlaid errors generated by `pixelmatch`).
  - Zoom & Pan up to 800% with nearest-neighbor pixel preservation.
  - Multi-image thumbnail strip for browsing UI test suites.

### 3.3 User Feedback Request Protocol & Interactive Hooks

```typescript
// src/hooks/useArtifactFeedback.ts
import { useState, useCallback } from "react";
import type { ArtifactMetadata, ArtifactFeedbackResponse } from "@/types/artifacts";

export type FeedbackStatus = "idle" | "prompted" | "submitting" | "resolved";

export function useArtifactFeedback(
  artifact: ArtifactMetadata,
  onSendFeedback: (response: ArtifactFeedbackResponse) => Promise<void>
) {
  const [status, setStatus] = useState<FeedbackStatus>(
    artifact.requestFeedback ? "prompted" : "idle"
  );
  const [comment, setComment] = useState("");

  const submitAccept = useCallback(async () => {
    setStatus("submitting");
    await onSendFeedback({
      artifactId: artifact.id,
      decision: "accepted",
      comment: comment.trim() || undefined,
      timestamp: new Date().toISOString(),
    });
    setStatus("resolved");
  }, [artifact.id, comment, onSendFeedback]);

  const submitRevisionRequest = useCallback(async (feedbackText: string) => {
    setStatus("submitting");
    await onSendFeedback({
      artifactId: artifact.id,
      decision: "changes_requested",
      comment: feedbackText,
      timestamp: new Date().toISOString(),
    });
    setStatus("resolved");
  }, [artifact.id, onSendFeedback]);

  const submitReject = useCallback(async (reason: string) => {
    setStatus("submitting");
    await onSendFeedback({
      artifactId: artifact.id,
      decision: "rejected",
      comment: reason,
      timestamp: new Date().toISOString(),
    });
    setStatus("resolved");
  }, [artifact.id, onSendFeedback]);

  return {
    status,
    comment,
    setComment,
    submitAccept,
    submitRevisionRequest,
    submitReject,
  };
}
```

### 3.4 Artifact State Management & Pure Reducer Implementation

```typescript
// src/lib/artifactDockReducer.ts
import type { ArtifactMetadata, ArtifactVersion } from "@/types/artifacts";

export interface ArtifactDockState {
  isOpen: boolean;
  activeArtifactId: string | null;
  artifacts: Record<string, ArtifactMetadata>;
  versions: Record<string, ArtifactVersion[]>; // Keyed by artifact family name / relativePath
  viewMode: "split" | "unified" | "preview" | "raw";
  selectedRevision: number | null;
  deviceFrame: "mobile" | "tablet" | "desktop" | "fluid";
}

export type ArtifactDockAction =
  | { type: "OPEN_DOCK"; artifactId?: string }
  | { type: "CLOSE_DOCK" }
  | { type: "TOGGLE_DOCK" }
  | { type: "SELECT_ARTIFACT"; artifactId: string }
  | { type: "REGISTER_ARTIFACT"; artifact: ArtifactMetadata }
  | { type: "UPDATE_ARTIFACT_CONTENT"; artifactId: string; content: string; newRevision?: boolean }
  | { type: "SET_VIEW_MODE"; mode: "split" | "unified" | "preview" | "raw" }
  | { type: "SET_REVISION"; revision: number }
  | { type: "SET_DEVICE_FRAME"; frame: "mobile" | "tablet" | "desktop" | "fluid" };

export function artifactDockReducer(
  state: ArtifactDockState,
  action: ArtifactDockAction
): ArtifactDockState {
  switch (action.type) {
    case "OPEN_DOCK":
      return {
        ...state,
        isOpen: true,
        activeArtifactId: action.artifactId ?? state.activeArtifactId,
      };

    case "CLOSE_DOCK":
      return {
        ...state,
        isOpen: false,
      };

    case "TOGGLE_DOCK":
      return {
        ...state,
        isOpen: !state.isOpen,
      };

    case "SELECT_ARTIFACT":
      return {
        ...state,
        isOpen: true,
        activeArtifactId: action.artifactId,
        selectedRevision: null, // Reset to latest
      };

    case "REGISTER_ARTIFACT": {
      const art = action.artifact;
      const key = art.relativePath || art.name;
      const currentVersions = state.versions[key] ?? [];
      const newVersion: ArtifactVersion = {
        id: art.id,
        revision: art.revision ?? currentVersions.length + 1,
        createdAt: art.createdAt,
        sha256: art.sha256,
        summary: art.summary,
      };
      return {
        ...state,
        artifacts: { ...state.artifacts, [art.id]: art },
        versions: { ...state.versions, [key]: [...currentVersions, newVersion] },
        activeArtifactId: state.activeArtifactId ?? art.id,
      };
    }

    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.mode };

    case "SET_REVISION":
      return { ...state, selectedRevision: action.revision };

    case "SET_DEVICE_FRAME":
      return { ...state, deviceFrame: action.frame };

    default:
      return state;
  }
}
```

### 3.5 Component Hierarchy & Wireframes

```
+---------------------------------------------------------------------------------------------------+
|  [FileCode2] ARTIFACT DOCK: src/auth/tokenService.ts                     [v3 (Latest)]  [_] [^] [X] |
|  [Diff: tokenService.ts] [Preview: AuthModal.tsx] [Diagram: OAuth Flow] [Evidence: LoginTest.png] |
+---------------------------------------------------------------------------------------------------+
|  File: src/auth/tokenService.ts · Lang: TypeScript · Size: 3.4 KB · SHA: e4a8...91b2              |
|  Summary: Fixed timing vulnerability in signature comparison using crypto.timingSafeEqual         |
|  Revisions:  [< Rev 1]   [Rev 2]   [[Rev 3 (Active)]]     View: [[Split Diff] | Unified | Raw]    |
+---------------------------------------------------------------------------------------------------+
|  ORIGINAL (Revision 2)                        |  MODIFIED (Revision 3)                            |
|  -------------------------------------------- | ------------------------------------------------  |
|  42  function verifyToken(token: string) {   | 42  function verifyToken(token: string) {        |
|  43    const [header, payload, sig] =        | 43    const [header, payload, sig] =             |
|  44      token.split('.');                   | 44      token.split('.');                        |
|  45 -  return sig === expectedSig;           | 45 +  const a = Buffer.from(sig, 'hex');         |
|  46  }                                       | 46 +  const b = Buffer.from(expectedSig, 'hex'); |
|  47                                          | 47 +  if (a.length !== b.length) return false;   |
|  48                                          | 48 +  return crypto.timingSafeEqual(a, b);       |
|  49                                          | 49  }                                            |
+---------------------------------------------------------------------------------------------------+
|  [ShieldCheck] User Feedback Requested:                                                            |
|  "Does this constant-time implementation meet your compliance requirements?"                      |
|  [ [✓ Accept Changes] ]   [ [✎ Request Revision] ]   [ [✕ Reject] ]                               |
|  [Feedback comments: Looks good, please proceed to unit tests...                              ] |
+---------------------------------------------------------------------------------------------------+
```

---

## 4. Extensible Slash Command Engine PRD

### 4.1 Chat Composer Integration & Autocomplete Palette

The Slash Command Engine provides an ultra-responsive, keyboard-navigable command palette that hooks directly into the chat composer.

```
+---------------------------------------------------------------------------------------------------+
|  CHAT TRANSCRIPT AREA                                                                             |
|                                                                                                   |
|  User: Run security audit and propose refactoring plan                                            |
|  Assistant: I will analyze the codebase and generate a structured execution plan.                 |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
|  AUTOCOMPLETE PALETTE (Triggered by '/')                                                          |
|  +---------------------------------------------------------------------------------------------+  |
|  | [Search commands...                                                                     ]  |  |
|  | ------------------------------------------------------------------------------------------- |  |
|  | PLANNING & REASONING                                                                        |  |
|  |  /plan [goal]            Switch to Planning Mode & generate interactive DAG plan            |  |
|  |  /goal <description>     Set or update the high-level mission goal in the workspace header   |  |
|  |                                                                                             |  |
|  | SYSTEM & WORKSPACE                                                                          |  |
|  |  /schedule <cron|time>   Schedule background daemon task or recurring cron job             |  |
|  |  /browse <url> [action]  Launch Playwright browser session with visual evidence capture     |  |
|  |  /learn [topic]          Extract code conventions and distill into reusable skill pack      |  |
|  |  /compact [keep-last]    Compact conversation history preserving critical context           |  |
|  |  /cost                   Open Token & Cost Analytics dashboard modal                        |  |
|  |  /export [format]        Export transcript, plan, and artifacts to JSON/Markdown            |  |
|  |                                                                                             |  |
|  | CONTEXT MENTIONS: Type '@' for files, '#' for symbols, '$' for subagent mailboxes           |  |
|  +---------------------------------------------------------------------------------------------+  |
|                                                                                                   |
|  COMPOSER INPUT:                                                                                  |
|  [ /plan Refactor authentication middleware to use JWT with RS256 signing @file:src/auth.ts     ] |
|  [ [Plan Mode Active] ]  [Model: Claude-3.7-Sonnet v]  [Temp: 0.2]  [Tokens: 4,096]   [ [Send] ]  |
+---------------------------------------------------------------------------------------------------+
```

#### 4.1.1 Keyboard Navigation & Triggering Rules
- **Activation**: Typing `/` at index 0 of the input line or immediately following whitespace opens the palette.
- **Fuzzy Filter**: Real-time filtering matches command names, aliases, and descriptions (e.g. typing `/sch` selects `/schedule`).
- **Keybindings**:
  - `ArrowUp` / `ArrowDown`: Navigate through palette items.
  - `Enter` / `Tab`: Autocomplete selected command and insert parameter placeholders.
  - `Escape`: Dismiss palette without altering composer text.

### 4.2 Built-in Command Specifications

```
+---------------------------------------------------------------------------------------------------------+
|                                      BUILT-IN SLASH COMMAND MATRIX                                      |
+-----------+-----------------------------+------------------------------------+--------------------------+
| Command   | Arguments Syntax            | Description                        | Execution Target         |
+-----------+-----------------------------+------------------------------------+--------------------------+
| `/plan`   | `[goal: string]`            | Opens Plan Composer & drafts DAG   | UI Plan State + Host     |
+-----------+-----------------------------+------------------------------------+--------------------------+
| `/goal`   | `<description: string>`     | Sets pinned mission objective      | UI Header + Context Bus  |
+-----------+-----------------------------+------------------------------------+--------------------------+
| `/schedule`| `<interval|cron> <prompt>` | Spawns background daemon / timer   | Host Task Supervisor     |
+-----------+-----------------------------+------------------------------------+--------------------------+
| `/browse` | `<url: string> [--action]`  | Managed Playwright visual session  | Host Browser Manager     |
+-----------+-----------------------------+------------------------------------+--------------------------+
| `/learn`  | `[topic|path: string]`      | Synthesizes YAML skill definition  | Skill Studio + Workspace |
+-----------+-----------------------------+------------------------------------+--------------------------+
| `/compact`| `[--keep=N] [--summary]`    | Compresses context memory window   | LLM Context Compressor   |
+-----------+-----------------------------+------------------------------------+--------------------------+
| `/cost`   | `[--by-model] [--by-day]`   | Launches Cost Analytics modal      | Recharts Dashboard Modal |
+-----------+-----------------------------+------------------------------------+--------------------------+
| `/export` | `[format: md|json|html]`    | Bundles session & artifacts        | File Downloader / VFS    |
+-----------+-----------------------------+------------------------------------+--------------------------+
```

#### 4.2.1 Detailed Command Execution Contracts

1. **`/plan [goal]`**:
   - Parses optional natural language goal. If omitted, uses current conversation context.
   - Transitions UI to Planning Mode (`planState: "draft"`), mounts `PlanComposer`, and requests the agent host to emit a structured `ExecutionPlan` JSON payload.
2. **`/goal <description>`**:
   - Pins the global objective to `TopBar` and marks it with the `🔒 My Identity` context boundary for all subagents.
3. **`/schedule <interval|cron|duration> <prompt>`**:
   - Translates duration (e.g. `300s`, `10m`) into `DurationSeconds` or cron syntax (`*/5 * * * *`).
   - Dispatches `task.schedule` WebSocket frame to `apps/agent-host/src/tasks/manager.ts`.
4. **`/browse <url> [--action=screenshot|dom|crawl]`**:
   - Authorizes URL against `origins.ts` allowlist.
   - Spawns Playwright browser context, captures DOM structure and screenshot, and returns `VisualEvidenceCard` artifact.
5. **`/learn [topic|path]`**:
   - Indexes targeted directory or topic, generates YAML frontmatter and step instructions, and opens `SkillStudio` wizard with pre-populated values.
6. **`/compact [--keep=N]`**:
   - Preserves system prompt and last $N$ turns (default 4); summarizes intermediate turns into structured context artifact; resets token window.
7. **`/cost`**:
   - Queries `usageLog.ts` SQLite database and opens the `CostDashboard` modal.
8. **`/export [format]`**:
   - Serializes transcript, active plan DAG, and generated artifacts into `.zip` or `.md` bundle.

### 4.3 Command Engine Architecture, Parser & Extensibility SDK

```typescript
// src/lib/commands/types.ts
export interface SlashCommandParam {
  name: string;
  description: string;
  required: boolean;
  type: "string" | "number" | "boolean" | "file" | "enum";
  enumValues?: string[];
  defaultValue?: unknown;
}

export interface SlashCommandDefinition {
  name: string;
  aliases: string[];
  category: "planning" | "system" | "workspace" | "context" | "custom";
  description: string;
  usage: string;
  params: SlashCommandParam[];
  execute: (args: ParsedCommandArgs, context: CommandExecutionContext) => Promise<CommandResult>;
}

export interface ParsedCommandArgs {
  command: string;
  positional: string[];
  flags: Record<string, boolean | string | number>;
  rawInput: string;
  mentions: {
    files: string[];
    symbols: string[];
    agents: string[];
  };
}

export interface CommandExecutionContext {
  session: Session;
  workspaceRoot: string;
  hostClient?: HostClient;
  dispatchAction: (action: unknown) => void;
  openModal: (modalId: string, props?: unknown) => void;
  appendMessage: (message: Message) => void;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  outputArtifactId?: string;
  handledInline?: boolean;
}
```

#### 4.3.1 Parameter Parsing Algorithm
The parser processes input strings using a deterministic tokenizer supporting:
- Positional parameters: `/browse https://example.com`
- Quoted multi-word strings: `/plan "Implement OAuth2 with PKCE flow"`
- Named flags: `--keep=5`, `--format=markdown`, `-f`
- Context mentions: `@file:src/server.ts`, `#symbol:verifyToken`, `@agent:explorer-1`

```typescript
// src/lib/commands/parser.ts
export function parseSlashCommand(input: string): ParsedCommandArgs | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const tokens: string[] = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(trimmed)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }

  if (tokens.length === 0) return null;

  const command = tokens[0].toLowerCase();
  const positional: string[] = [];
  const flags: Record<string, boolean | string | number> = {};
  const mentions = { files: [] as string[], symbols: [] as string[], agents: [] as string[] };

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("--")) {
      const [key, val] = token.slice(2).split("=");
      flags[key] = val !== undefined ? parseFlagValue(val) : true;
    } else if (token.startsWith("-") && token.length === 2) {
      flags[token.slice(1)] = true;
    } else if (token.startsWith("@file:")) {
      mentions.files.push(token.slice(6));
    } else if (token.startsWith("#symbol:")) {
      mentions.symbols.push(token.slice(8));
    } else if (token.startsWith("@agent:")) {
      mentions.agents.push(token.slice(7));
    } else {
      positional.push(token);
    }
  }

  return { command, positional, flags, rawInput: trimmed, mentions };
}

function parseFlagValue(val: string): string | number | boolean {
  if (val.toLowerCase() === "true") return true;
  if (val.toLowerCase() === "false") return false;
  const num = Number(val);
  return isNaN(num) ? val : num;
}
```

### 4.4 Slash Command State Management & Pure Reducer

```typescript
// src/lib/slashCommandReducer.ts
import type { SlashCommandDefinition, ParsedCommandArgs } from "@/lib/commands/types";

export interface SlashCommandState {
  isOpen: boolean;
  filterQuery: string;
  selectedIndex: number;
  activeCommand: SlashCommandDefinition | null;
  registry: Record<string, SlashCommandDefinition>;
}

export type SlashCommandAction =
  | { type: "OPEN_PALETTE"; query?: string }
  | { type: "CLOSE_PALETTE" }
  | { type: "SET_QUERY"; query: string }
  | { type: "NAVIGATE"; direction: "up" | "down"; maxItems: number }
  | { type: "SELECT_INDEX"; index: number }
  | { type: "REGISTER_COMMAND"; command: SlashCommandDefinition }
  | { type: "UNREGISTER_COMMAND"; commandName: string };

export function slashCommandReducer(
  state: SlashCommandState,
  action: SlashCommandAction
): SlashCommandState {
  switch (action.type) {
    case "OPEN_PALETTE":
      return {
        ...state,
        isOpen: true,
        filterQuery: action.query ?? "",
        selectedIndex: 0,
      };

    case "CLOSE_PALETTE":
      return {
        ...state,
        isOpen: false,
        filterQuery: "",
        selectedIndex: 0,
      };

    case "SET_QUERY":
      return {
        ...state,
        filterQuery: action.query,
        selectedIndex: 0,
      };

    case "NAVIGATE": {
      if (action.maxItems === 0) return state;
      const nextIndex =
        action.direction === "down"
          ? (state.selectedIndex + 1) % action.maxItems
          : (state.selectedIndex - 1 + action.maxItems) % action.maxItems;
      return {
        ...state,
        selectedIndex: nextIndex,
      };
    }

    case "REGISTER_COMMAND":
      return {
        ...state,
        registry: { ...state.registry, [action.command.name]: action.command },
      };

    case "UNREGISTER_COMMAND": {
      const copy = { ...state.registry };
      delete copy[action.commandName];
      return { ...state, registry: copy };
    }

    default:
      return state;
  }
}
```

---

## 5. Complete TypeScript Protocol Schemas (`packages/protocol`)

To ensure end-to-end type safety between the Agent Host (Fastify/Node.js) and the Web UI (Vite/React), we define the complete, unambiguous Zod schemas and TypeScript type declarations.

### 5.1 Upgraded Plan Contracts (`packages/protocol/src/plan.ts`)

```typescript
import { z } from "zod";

export const stepStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "skipped",
]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

export const stepEstimateSchema = z.object({
  tokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  durationSec: z.number().nonnegative().optional(),
});
export type StepEstimate = z.infer<typeof stepEstimateSchema>;

export const planStepSchema = z.object({
  id: z.string().min(1),
  phaseId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  status: stepStatusSchema,
  approval: z.literal("required").optional(),
  sideEffecting: z.boolean().default(false),
  affectedScopes: z.array(z.string()).default([]),
  estimate: stepEstimateSchema.optional(),
  artifacts: z.array(z.string()).default([]),
});
export type PlanStep = z.infer<typeof planStepSchema>;

export const planPhaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int().nonnegative(),
});
export type PlanPhase = z.infer<typeof planPhaseSchema>;

export const planUIStateSchema = z.enum([
  "draft",
  "awaiting_approval",
  "executing",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type PlanUIState = z.infer<typeof planUIStateSchema>;

export const planRevisionSchema = z.object({
  revisionId: z.number().int().positive(),
  parentRevisionId: z.number().int().positive().nullable(),
  createdAt: z.string().datetime(),
  diffSummary: z.string().optional(),
  author: z.enum(["user", "agent"]),
});
export type PlanRevision = z.infer<typeof planRevisionSchema>;

export const executionPlanSchema = z.object({
  id: z.string().uuid(),
  goal: z.string().min(1),
  state: planUIStateSchema,
  phases: z.array(planPhaseSchema),
  steps: z.array(planStepSchema),
  currentRevision: planRevisionSchema,
});
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

/** Pure helper: Returns steps ready for topological execution (with backward compatibility) */
export function readySteps(
  plan: ExecutionPlan,
  approvedStepIds?: ReadonlySet<string>
): PlanStep[] {
  return plan.steps.filter((step) => {
    if (step.status !== "pending") return false;
    // All dependencies must be succeeded
    const depsSatisfied = step.dependsOn.every((depId) =>
      plan.steps.some((s) => s.id === depId && s.status === "succeeded")
    );
    if (!depsSatisfied) return false;
    // If approval is required, must be in approval ledger
    if (step.approval === "required" && approvedStepIds && !approvedStepIds.has(step.id)) {
      return false;
    }
    return true;
  });
}
```

### 5.2 Artifact Protocol Contracts (`packages/protocol/src/artifacts.ts`)

```typescript
import { z } from "zod";

export const artifactMimeTypeSchema = z.enum([
  "text/plain",
  "text/markdown",
  "text/x-diff",
  "text/html",
  "application/javascript",
  "application/typescript",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "text/vnd.mermaid",
]);
export type ArtifactMimeType = z.infer<typeof artifactMimeTypeSchema>;

export const artifactMetadataSchema = z.object({
  id: z.string().uuid(),
  runId: z.string(),
  name: z.string().min(1),
  mimeType: artifactMimeTypeSchema,
  relativePath: z.string(),
  byteLength: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  createdAt: z.string().datetime(),
  userFacing: z.boolean().default(true),
  requestFeedback: z.boolean().default(false),
  feedbackPrompt: z.string().optional(),
  revision: z.number().int().positive().default(1),
  parentArtifactId: z.string().uuid().optional(),
  summary: z.string().min(1),
});
export type ArtifactMetadata = z.infer<typeof artifactMetadataSchema>;

export const artifactFeedbackDecisionSchema = z.enum([
  "accepted",
  "changes_requested",
  "rejected",
]);
export type ArtifactFeedbackDecision = z.infer<typeof artifactFeedbackDecisionSchema>;

export const artifactFeedbackResponseSchema = z.object({
  artifactId: z.string().uuid(),
  decision: artifactFeedbackDecisionSchema,
  comment: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type ArtifactFeedbackResponse = z.infer<typeof artifactFeedbackResponseSchema>;

export const visualAssertionResultSchema = z.object({
  id: z.string(),
  kind: z.enum(["expect_visible", "expect_text", "expect_url"]),
  selector: z.string().optional(),
  expected: z.string().optional(),
  actual: z.string().optional(),
  passed: z.boolean(),
  error: z.string().optional(),
});
export type VisualAssertionResult = z.infer<typeof visualAssertionResultSchema>;

export const visualDiffResultSchema = z.object({
  baselinePath: z.string(),
  currentPath: z.string(),
  diffPath: z.string(),
  mismatchedPixels: z.number().int().nonnegative(),
  mismatchPercentage: z.number().min(0).max(100),
  passed: z.boolean(),
});
export type VisualDiffResult = z.infer<typeof visualDiffResultSchema>;
```

### 5.3 Slash Command Protocol Contracts (`packages/protocol/src/commands.ts`)

```typescript
import { z } from "zod";

export const slashCommandCategorySchema = z.enum([
  "planning",
  "system",
  "workspace",
  "context",
  "custom",
]);
export type SlashCommandCategory = z.infer<typeof slashCommandCategorySchema>;

export const slashCommandWireSchema = z.object({
  command: z.string().regex(/^\/[a-z0-9_-]+$/),
  positional: z.array(z.string()).default([]),
  flags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  rawInput: z.string(),
  mentions: z
    .object({
      files: z.array(z.string()).default([]),
      symbols: z.array(z.string()).default([]),
      agents: z.array(z.string()).default([]),
    })
    .default({ files: [], symbols: [], agents: [] }),
});
export type SlashCommandWire = z.infer<typeof slashCommandWireSchema>;
```

### 5.4 WebSocket Wire Frames & Ingestion Contracts (`packages/protocol/src/wire.ts`)

```typescript
import { z } from "zod";
import { executionPlanSchema } from "./plan";
import { artifactMetadataSchema, artifactFeedbackResponseSchema } from "./artifacts";
import { slashCommandWireSchema } from "./commands";

/** Client -> Host Messages */
export const clientPlanSubmitFrameSchema = z.object({
  type: z.literal("plan.submit"),
  plan: executionPlanSchema,
});

export const clientPlanApprovalFrameSchema = z.object({
  type: z.literal("plan.approval"),
  planId: z.string().uuid(),
  stepId: z.string(),
  approved: z.boolean(),
});

export const clientArtifactFeedbackFrameSchema = z.object({
  type: z.literal("artifact.feedback"),
  feedback: artifactFeedbackResponseSchema,
});

export const clientSlashCommandFrameSchema = z.object({
  type: z.literal("command.execute"),
  command: slashCommandWireSchema,
});

export const clientMessageFrameSchema = z.discriminatedUnion("type", [
  clientPlanSubmitFrameSchema,
  clientPlanApprovalFrameSchema,
  clientArtifactFeedbackFrameSchema,
  clientSlashCommandFrameSchema,
]);
export type ClientMessageFrame = z.infer<typeof clientMessageFrameSchema>;

/** Host -> Client Messages */
export const hostPlanUpdateFrameSchema = z.object({
  type: z.literal("plan.update"),
  plan: executionPlanSchema,
});

export const hostArtifactCreatedFrameSchema = z.object({
  type: z.literal("artifact.created"),
  artifact: artifactMetadataSchema,
  content: z.string().optional(),
});

export const hostModelDeltaFrameSchema = z.object({
  type: z.literal("model.delta"),
  runId: z.string(),
  stepId: z.string().optional(),
  text: z.string(),
});

export const hostMessageFrameSchema = z.discriminatedUnion("type", [
  hostPlanUpdateFrameSchema,
  hostArtifactCreatedFrameSchema,
  hostModelDeltaFrameSchema,
]);
export type HostMessageFrame = z.infer<typeof hostMessageFrameSchema>;
```

---

## 6. Testing Strategy, Edge Cases & Verification Criteria

### 6.1 Unit Testing Strategy & Test Suites (Vitest)

To achieve 100% test coverage and ensure zero functional regressions, the following test suites must be implemented:

```
test/
├── unit/
│   ├── planning/
│   │   ├── planComposerReducer.test.ts   # 15 tests: Add/edit/reorder/deps/undo/redo
│   │   ├── validateDAG.test.ts           # 12 tests: Cycle detection, disconnected nodes
│   │   └── approvalLedger.test.ts        # 10 tests: Zero-text invariant, downgrade rogue status
│   ├── artifacts/
│   │   ├── artifactDockReducer.test.ts   # 12 tests: Open/close/version registry/frame switch
│   │   ├── sandboxBundle.test.ts         # 8 tests: React/Tailwind bundle injection & XSS CSP
│   │   └── useArtifactFeedback.test.ts   # 8 tests: Feedback lifecycle state transitions
│   └── commands/
│       ├── parseSlashCommand.test.ts     # 16 tests: Positional, quotes, flags, @/# mentions
│       └── slashRegistry.test.ts         # 10 tests: Command dispatch, context injection
```

### 6.2 WebSocket Wire Protocol & Integration Test Cases

1. **Plan Ingestion & Cycle Rejection Test**:
   - Client sends cyclic plan (`A -> B -> A`).
   - Host `validatePlan` rejects with `{ ok: false, error: "Cycle detected" }`.
   - Host state transitions to `error` and emits `plan.validated` error frame.
2. **Approval Ledger Downgrade Test**:
   - Host emits `run.state` with step `3` as `"running"` without receiving `approval.grant`.
   - Client `PlanPanel` detects missing approval in `approvedStepIds`, immediately downgrades UI to `"blocked"`, and sends `run.cancel`.
3. **Artifact Feedback Loopback Test**:
   - Host emits `artifact.created` with `requestFeedback: true`.
   - UI displays `ArtifactFeedbackBar`. User enters comment `"Please add error boundary"` and clicks `"Request Changes"`.
   - Client sends `artifact.feedback` frame. Host receives message and dispatches new agent refinement turn.

### 6.3 UI Component & Interaction Test Matrix (React Testing Library)

| Test Identifier | Component | Interaction Scenario | Expected Assertion |
|---|---|---|---|
| `UI-PLAN-01` | `PlanComposer` | Drag Step 3 above Step 2 | Step sequence updates; dependency constraints verified |
| `UI-PLAN-02` | `PhaseGroup` | Click `"Approve Phase 2"` | All steps in Phase 2 added to `approvedStepIds` ledger |
| `UI-PLAN-03` | `PlanDAGView` | Create cyclical connection | Red pulsing edge rendered; error message displayed |
| `UI-ART-01` | `MonacoDiffViewer`| Toggle between Split and Unified | Monaco diff editor changes layout without re-mounting |
| `UI-ART-02` | `SandboxCanvas` | Render malicious `<script>` | CSP blocks `window.fetch` to `http://localhost:*` |
| `UI-CMD-01` | `CommandPalette` | Type `/sch` and hit `Tab` | Composer fills `/schedule ` with parameter helper |

### 6.4 Edge Cases & Security Vulnerability Matrix

```
+---------------------------------------------------------------------------------------------------------+
|                                    EDGE CASE & SECURITY MITIGATION MATRIX                               |
+----------------------+------------------------------------+---------------------------------------------+
| Edge Case Category   | Attack Vector / Failure Mode       | Defensive Mitigation Implementation         |
+----------------------+------------------------------------+---------------------------------------------+
| Prompt Injection     | Model outputs fake approval text   | Hard Client-Side Invariant: Only UI DOM     |
|                      | in chat: "APPROVED: Step 2"        | button click adds ID to Approval Ledger.    |
+----------------------+------------------------------------+---------------------------------------------+
| Live Sandbox XSS     | User-generated HTML attempts to    | iframe `sandbox="allow-scripts"` with       |
|                      | steal `localStorage` host token    | strict CSP blocking network to localhost.   |
+----------------------+------------------------------------+---------------------------------------------+
| DAG Graph Explosion  | Cyclic / 1000+ node plan stalls UI | Tarjan's SCC cycle check (O(V+E)) + virtual |
|                      | rendering thread                   | windowing via React Flow Canvas.            |
+----------------------+------------------------------------+---------------------------------------------+
| Command Escaping     | Nested quotes or semicolon in slash| Deterministic RegExp lexer stripping shell  |
|                      | command (e.g. `/browse "url";rm`)  | metacharacters before execution dispatch.   |
+----------------------+------------------------------------+---------------------------------------------+
| Network Disconnect   | WS drops mid-way through feedback  | Optimistic UI update + local queue flushed  |
|                      | or plan approval                   | immediately upon socket reconnection.       |
+----------------------+------------------------------------+---------------------------------------------+
```

### 6.5 Acceptance Verification Checklist

- [x] **Planning Mode Specification**:
  - [x] Full hierarchical state machine (`draft` -> `awaiting_approval` -> `executing` -> `paused` -> `completed`).
  - [x] Dynamic phase grouping with batch approval capabilities.
  - [x] Drag-and-drop step dependencies and visual DAG authoring.
  - [x] Complete TypeScript protocol schemas in `packages/protocol/src/plan.ts`.
  - [x] Pure state reducer implementation (`planComposerReducer.ts`).
  - [x] Production-grade ASCII wireframes for both Phase List and DAG Canvas.
- [x] **Dedicated Artifact Viewers Specification**:
  - [x] Right-side collapsible Artifact Dock with responsive drawer support.
  - [x] Multi-format rendering engine covering Monaco Diff, Sandboxed Live Preview, Mermaid, Markdown, and Carousel.
  - [x] Artifact metadata schema (`UserFacing`, `RequestFeedback`, `Summary`, `Revision`).
  - [x] User feedback request lifecycle and React hook (`useArtifactFeedback`).
  - [x] Pure state reducer implementation (`artifactDockReducer.ts`).
  - [x] Security sandboxing with iframe CSP enforcement.
- [x] **Extensible Slash Command Engine Specification**:
  - [x] Native chat composer autocomplete palette with keyboard navigation.
  - [x] 8 built-in commands (`/plan`, `/goal`, `/schedule`, `/browse`, `/learn`, `/compact`, `/cost`, `/export`).
  - [x] Robust argument parser for positional, flags, quoted strings, and `@file`/`#symbol`/`@agent` mentions.
  - [x] Command registry SDK and custom plugin support.
  - [x] Pure state reducer implementation (`slashCommandReducer.ts`).
- [x] **Testing & Quality Criteria**:
  - [x] Unit test specifications for all reducers, parsers, and DAG validators.
  - [x] WebSocket wire protocol integration test cases.
  - [x] Security and edge case mitigation matrix.
