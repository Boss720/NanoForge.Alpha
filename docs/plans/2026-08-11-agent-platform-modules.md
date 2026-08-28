# Agent Platform Modules Implementation Plan

**Goal:** Extend NanoForge into a secure local agent platform with executable task plans, autonomous terminal work, managed browser verification, rules/skills/MCP support, and explainable multi-model routing.

**Architecture:** Preserve `src/` as an unprivileged React control plane. Add `apps/agent-host/`, a loopback-only local companion service that is the sole owner of terminal, browser, filesystem, credentials, and MCP processes. The browser connects over a single-use authenticated WebSocket; every model tool proposal must pass a host policy decision before execution.

**Tech Stack:** React 19, TypeScript, Vite, Vitest; Node 22, Fastify, ws, execa, Playwright, `@modelcontextprotocol/sdk`, Zod, SQLite.

**Estimated Time:** 46 small tasks (about four engineering days) plus acceptance testing.

---

## Prerequisites

- [ ] Keep the existing static build functional without the local host (demo/direct NanoGPT chat).
- [ ] Install Node 22 LTS and Playwright Chromium.
- [ ] Create `docs/security/threat-model.md` before enabling terminal or MCP access.
- [ ] Add `.env.example`; never persist API keys or MCP secrets in browser localStorage, logs, test fixtures, or source control.

## Security contracts

| Boundary | Required contract |
| --- | --- |
| Web -> host | `ws://127.0.0.1:<ephemeral-port>/agent?token=<single-use-token>`; validate all messages with Zod. |
| Tool execution | Model output is only a proposal; `PolicyEngine.authorize()` grants each scoped capability. |
| Terminal | Structured `executable + args[]`, `shell:false`, workspace-confined CWD. |
| Browser | Dedicated non-persistent Playwright context; origin allow-list; no downloads without confirmation. |
| MCP | Explicit command/args/env/tool allow-list; untrusted tool output; terminate server after the run. |
| Routing | A decision records selected model, fallback chain, estimate, and reason; a user pin overrides routing. |
| Audit | Append-only ledger of plan, model choice, tool request, approval, output digest, and artifacts. |

---

## Module 1: Task planning and implementation specs

### Task 1: Create executable plan contracts

**Files:**
- Create: `packages/protocol/src/plan.ts`
- Create: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/plan.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readySteps } from "./plan";

describe("readySteps", () => {
  it("releases a step only after every dependency succeeds", () => {
    const plan = { id: "p1", goal: "test", steps: [
      { id: "inspect", title: "Inspect", dependsOn: [], status: "succeeded" },
      { id: "edit", title: "Edit", dependsOn: ["inspect"], status: "pending" },
    ] } as const;
    expect(readySteps(plan).map((s) => s.id)).toEqual(["edit"]);
  });
});
```

**Step 2: Run the test**

```powershell
npm test -- packages/protocol/src/plan.test.ts
```

Expected: FAIL because `./plan` does not exist.

**Step 3: Implement the minimum**

```ts
export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "blocked";
export interface PlanStep { id: string; title: string; dependsOn: string[]; status: StepStatus; }
export interface ExecutionPlan { id: string; goal: string; steps: PlanStep[]; }
export const readySteps = (plan: ExecutionPlan) => plan.steps.filter(
  (step) => step.status === "pending" &&
    step.dependsOn.every((id) => plan.steps.some((d) => d.id === id && d.status === "succeeded")),
);
```

**Step 4: Verify and commit**

```powershell
npm test -- packages/protocol/src/plan.test.ts
git add packages/protocol; git commit -m "feat(plan): add executable step contracts"
```

Expected: PASS.

### Task 2: Validate plans and approval gates

**Files:** Create `apps/agent-host/src/planning/validatePlan.ts`; test `validatePlan.test.ts`; modify `src/types/index.ts`.

Write tests first for duplicate IDs, cycles, unknown dependencies, and side-effecting steps missing `approval: "required"`. Implement `validatePlan(plan)` and UI states `draft | awaiting_approval | executing | paused | completed`. Run is disabled until each required approval is explicit—natural language never counts as approval.

### Task 3: Render plan inspector

**Files:** Create `src/sections/PlanPanel.tsx`; modify `src/App.tsx` and `src/sections/ChatPanel.tsx`; test `PlanPanel.test.tsx`.

Render steps, dependencies, exact affected scopes, estimate, approval state, artifacts, Pause, and Cancel. Test that an approval-required step cannot run before the explicit button click.

---

## Module 2: Autonomous terminal execution

### Task 4: Scaffold the authenticated local host

**Files:** Create `apps/agent-host/src/server.ts`, `protocol.ts`, `server.test.ts`; modify root `package.json`.

Bind only to `127.0.0.1` on an ephemeral port. Generate a cryptographic one-use token and reject malformed/reused tokens.

```ts
host.get("/health", async () => ({ ok: true, version: HOST_VERSION }));
host.get("/agent", { websocket: true }, (socket, req) => {
  if (!tokenStore.consume(new URL(req.url!, "http://host").searchParams.get("token"))) {
    socket.close(4401, "unauthorized"); return;
  }
  attachAgentProtocol(socket);
});
```

Test unauthenticated sockets close with `4401`; verify `/health` returns `ok: true`.

### Task 5: Build the policy engine before any runner

**Files:** Create `apps/agent-host/src/policy/policy.ts`, `default-policy.json`; test `policy.test.ts`.

Allow only read commands inside the user-selected workspace. Require interactive approval for writes, network access, installation, termination, redirection, and everything outside the root. Ban free-form shells and composition. Test: `git status` allowed; `cmd /c` denied; `npm install` asks.

```ts
export interface ToolRequest { kind: "terminal.exec"; cwd: string; executable: string; args: string[]; }
export function authorize(req: ToolRequest, policy: Policy): "allow" | "ask" | "deny" {
  if (!isWithinWorkspace(req.cwd, policy.workspaceRoot)) return "deny";
  return policy.readOnlyExecutables.includes(req.executable) ? "allow" : "ask";
}
```

### Task 6: Implement supervised terminal jobs

**Files:** Create `apps/agent-host/src/terminal/runner.ts`, `types.ts`; test `runner.test.ts`.

Use `execa(executable, args, { shell: false })` with workspace CWD resolution, a restricted environment, output cap, timeout, tree cancellation, and streamed stdout/stderr events. Test streaming, timeout, cancellation, and `../` rejection.

### Task 7: Connect terminal events to the UI

**Files:** Create `src/lib/hostClient.ts`; modify `src/types/index.ts`, `ChatPanel.tsx`, `App.tsx`; test `hostClient.test.ts`.

Map `queued | approval_required | running | done | error | cancelled` to existing tool cards. Render executable, args, CWD, policy reason, truncation, and Stop. Acceptance: rejecting a request produces no child process.

---

## Module 3: Managed browser and visual verification

### Task 8: Add isolated Playwright contexts

**Files:** Create `apps/agent-host/src/browser/manager.ts`, `origins.ts`; test `manager.test.ts`.

One non-persistent browser context per run. The only action schema is `navigate | click | fill | extract_text | screenshot`; JavaScript strings from models are forbidden. Test allowed local fixture, blocked external origin, and screenshot artifact.

### Task 9: Add visual assertions and evidence cards

**Files:** Create `apps/agent-host/src/browser/visual.ts`, `visual.test.ts`, `src/sections/VisualEvidenceCard.tsx`.

Support `expect_visible`, `expect_text`, `expect_url`, and thresholded pixel diffs. Persist baseline/current/overlay under run artifacts, not browser profiles. A fixture visual change must fail and show the diff image.

### Task 10: Require browser action approvals

**Files:** Create `src/sections/BrowserPermissionDialog.tsx`; modify `PlanPanel.tsx`, `App.tsx`; test dialog.

Ask before first origin navigation. Require a separate confirmation for submit, purchase, authentication, or download. Test that origin permission cannot automatically authorize submit.

---

## Module 4: Custom rules, skills, and MCP

### Task 11: Add rules packs

**Files:** Create `.nanoforge/rules/default.md`, `apps/agent-host/src/rules/loadRules.ts`; test `loadRules.test.ts`.

Use YAML front matter `id, priority, appliesTo, enabled`. Apply global/project/run rules in a deterministic precedence order and show sources plus a context digest. Test precedence and glob matching.

### Task 12: Add safe skill registry

**Files:** Create `.nanoforge/skills/example/SKILL.md`, `apps/agent-host/src/skills/registry.ts`; test `registry.test.ts`.

Support a narrow manifest: `name, description, allowedTools, instructions, contentHash`. Display expanded instructions before enabling. A skill folder never authorizes a script. Test malformed front matter and hash mismatch.

### Task 13: Add MCP registry and stdio client

**Files:** Create `apps/agent-host/src/mcp/registry.ts`, `client.ts`, `types.ts`; test `client.test.ts`.

Store server definitions in `.nanoforge/mcp.json`: approved command, fixed args, secret reference, declared tools. Start after approval, call `tools/list`, namespace tools as `mcp.<server>.<tool>`, validate schemas, and stop after the run. Test fake server success, undeclared tool rejection, and command denial.

### Task 14: Render Integrations settings

**Files:** Create `src/sections/IntegrationsPanel.tsx`; modify `ConnectDialog.tsx`, `App.tsx`; test panel.

Render rules, skills, and MCP separately, with enable/disable, health check, and last error. Secrets resolve only on the host from OS secure storage/process environment. Acceptance: no secret ever appears in DOM or logs.

---

## Module 5: Multi-model engine routing

### Task 15: Define the routing contract and policy

**Files:** Create `packages/protocol/src/routing.ts`, `apps/agent-host/src/router/router.ts`; test `router.test.ts`.

Score model profiles by capabilities (planning/coding/vision/tool calling), token estimate, latency target, privacy class, and cost cap. Return a fully explainable decision.

```ts
export interface RouteDecision {
  primary: string; fallbacks: string[]; estimatedCostUsd: number;
  reason: string; pinned: boolean;
}
```

Test a user pin override, vision request, cost fallback, and provider outage fallback.

### Task 16: Add normalized provider adapters

**Files:** Create `apps/agent-host/src/providers/types.ts`, `openaiCompatible.ts`, `registry.ts`; test adapter.

Move NanoGPT compatibility logic from `src/lib/nanogpt.ts` into the first host adapter, normalizing deltas, tool proposals, usage, and errors. Keep existing direct browser mode for backward compatibility. Test a mocked SSE sequence.

### Task 17: Add route decision UI

**Files:** Create `src/sections/RouteDecisionCard.tsx`; modify `ModelPanel.tsx`, `App.tsx`; test card.

Show model, fallbacks, reason, estimate, and pinned/automatic state. A fallback requires user approval unless it was explicitly pre-approved in the execution plan.

---

## Module 6: Coordination, audit, and release gates

### Task 18: Implement the run coordinator

**Files:** Create `apps/agent-host/src/runs/coordinator.ts`, `events.ts`; test coordinator.

Sequence: approved plan step -> route decision -> streamed model proposal -> policy decision -> tool execution -> immutable event. Halt on cancellation, denial, expiry, or failed dependency. Test that denied approval results in no tool call.

### Task 19: Persist a redacted audit ledger

**Files:** Create `apps/agent-host/src/audit/store.ts`, `redact.ts`; test store.

Use SQLite for metadata and a per-run artifact directory for large outputs/screenshots. Store SHA-256 digests and relative paths. Test secret redaction in ledger and Markdown/JSON export.

### Task 20: Build acceptance fixtures and CI

**Files:** Create `apps/agent-host/test/e2e/terminal-plan.test.ts`, `browser-verify.test.ts`, `.github/workflows/verify.yml`; modify `package.json`.

Run unit tests, typechecks, lint, web build, host tests, and deterministic browser fixtures. Include negative fixtures for workspace escape, token reuse, unapproved MCP tool, origin escape, secret leak, and terminal write without approval.

```powershell
npm test
npm run build
npm run test:host
npm run test:e2e
```

Expected: all pass; negative tests demonstrate enforcement, not only happy paths.

---

## Delivery order

1. Modules 1–2 behind `host.enabled=false`: explicit planning and terminal approvals.
2. Module 6 ledger/coordinator before enabling autonomous runs.
3. Module 3 with localhost test origins, then user-managed origins.
4. Module 4 disabled by default.
5. Module 5 last: routing may optimize quality/cost but must never bypass policy.

## Definition of done

- Users approve plans, inspect terminal/browser evidence, pause/cancel, and export a redacted audit bundle.
- Models cannot reach terminal, browser, filesystem, credentials, network, or MCP beyond user-approved policy.
- Existing direct NanoGPT and demo paths work when the host is absent.
- All build, unit, host, and E2E gates pass from a clean checkout.

