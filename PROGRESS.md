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
| **Phase 5** | Tighten Loopback Origin & Search Handling | **COMPLETED** | `apps/agent-host/src/server.ts`<br>`apps/agent-host/src/workspace/filesyst…73075 tokens truncated…t.remainingUses ?? null, tokenDigest, binding,
    };
    const eventDigest = `sha256:${sha256Hex(JSON.stringify(safe))}`;
    const result = this.db.prepare(
      "INSERT INTO capability_decisions (at, grantId, requestId, decision, reasonCode, remainingUses, tokenDigest, bindingJson, eventDigest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(safe.at, safe.grantId, safe.requestId, safe.decision, safe.reasonCode, safe.remainingUses, safe.tokenDigest, JSON.stringify(binding), eventDigest);
    return { id: Number(result.lastInsertRowid), ...safe, decision: safe.decision as CapabilityDecision, eventDigest };
  }

  /**
   * Close a run: record its terminal state, end time, and final digest.
   * (Run metadata transitions; the event ledger itself is append-only.)
   */
  endRun(input: { runId: string; state: AuditRunState | string; endedAt?: string }): void {
    this.db
      .prepare("UPDATE runs SET state = ?, endedAt = ?, digest = ? WHERE id = ?")
      .run(
        input.state,
        input.endedAt ?? this.clock().toISOString(),
        this.digests.get(input.runId) ?? null,
        input.runId,
      );
  }

  /* ------------------------------ reading ------------------------------ */

  getRun(runId: string): AuditRunRecord | undefined {
    const row = this.db
      .prepare("SELECT id, goal, state, startedAt, endedAt, digest FROM runs WHERE id = ?")
      .get(runId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: asString(row.id),
      goal: asString(row.goal),
      state: asString(row.state),
      startedAt: asString(row.startedAt),
      endedAt: asStringOrNull(row.endedAt),
      digest: asStringOrNull(row.digest),
    };
  }

  /** All stored events of a run, in seq order, with parsed redacted payloads. */
  listEvents(runId: string): AuditEventRecord[] {
    const rows = this.db
      .prepare(
        "SELECT runId, seq, type, at, payloadJson, sha256 FROM events WHERE runId = ? ORDER BY seq ASC",
      )
      .all(runId) as unknown as Record<string, unknown>[];
    return rows.map((row) => ({
      runId: asString(row.runId),
      seq: asNumber(row.seq),
      type: asString(row.type),
      at: asString(row.at),
      payload: JSON.parse(asString(row.payloadJson)) as Record<string, unknown>,
      sha256: asString(row.sha256),
    }));
  }

  listArtifacts(runId: string): AuditArtifactRecord[] {
    const rows = this.db
      .prepare(
        "SELECT runId, kind, relativePath, sha256, bytes FROM artifacts WHERE runId = ? ORDER BY relativePath ASC",
      )
      .all(runId) as unknown as Record<string, unknown>[];
    return rows.map((row) => ({
      runId: asString(row.runId),
      kind: asString(row.kind),
      relativePath: asString(row.relativePath),
      sha256: asString(row.sha256),
      bytes: asNumber(row.bytes),
    }));
  }

  listCapabilityDecisions(): AuditCapabilityDecisionRecord[] {
    const rows = this.db.prepare("SELECT id, at, grantId, requestId, decision, reasonCode, remainingUses, tokenDigest, bindingJson, eventDigest FROM capability_decisions ORDER BY id ASC").all() as unknown as Record<string, unknown>[];
    return rows.map((row) => ({
      id: asNumber(row.id), at: asString(row.at), grantId: asStringOrNull(row.grantId), requestId: asStringOrNull(row.requestId),
      decision: asString(row.decision) as CapabilityDecision, reasonCode: asString(row.reasonCode), remainingUses: row.remainingUses === null ? null : asNumber(row.remainingUses),
      tokenDigest: asStringOrNull(row.tokenDigest), binding: JSON.parse(asString(row.bindingJson)) as CapabilityDecisionBinding, eventDigest: asString(row.eventDigest),
    }));
  }

  /* ------------------------------ export ------------------------------- */

  exportRun(runId: string, options: { format: "json" }): AuditRunExport;
  exportRun(runId: string, options: { format: "markdown" }): string;
  exportRun(
    runId: string,
    options: { format: "json" | "markdown" },
  ): AuditRunExport | string {
    const run = this.getRun(runId);
    if (!run) throw new Error(`exportRun: unknown run id "${runId}"`);
    const events = this.listEvents(runId);
    const artifacts = this.listArtifacts(runId);
    const secrets = this.secrets();

    if (options.format === "json") {
      // Stored data is redacted at write time; redact again at the boundary
      // so exports stay clean even if the secret set grew since.
      return redactObject({ run, events, artifacts }, secrets);
    }
    return redactText(renderMarkdown(run, events, artifacts), secrets);
  }

  close(): void {
    this.db.close();
  }
}

/* ------------------------------------------------------------------------ */
/* Markdown rendering                                                       */
/* ------------------------------------------------------------------------ */

const payloadStr = (e: AuditEventRecord, key: string): string =>
  typeof e.payload[key] === "string" ? (e.payload[key] as string) : "";
function renderMarkdown(
  run: AuditRunRecord,
  events: AuditEventRecord[],
  artifacts: AuditArtifactRecord[],
): string {
  const lines: string[] = [
    `# Run audit: ${run.id}`,
    "",
    `- **Goal:** ${run.goal}`,
    `- **State:** ${run.state}`,
    `- **Started:** ${run.startedAt}`,
    `- **Ended:** ${run.endedAt ?? "—"}`,
    `- **Digest:** \`${run.digest ?? "—"}\``,
    "",
  ];

  /* Route decisions */
  lines.push("## Route decisions", "");
  const routeEvents = events.filter(
    (e) => e.type === "route.decided" || e.type === "route.fallback",
  );
  if (routeEvents.length === 0) lines.push("- (none)");
  for (const e of routeEvents) {
    if (e.type === "route.decided") {
      const d = e.payload.decision as
        | {
            primary?: unknown;
            fallbacks?: unknown;
            estimatedCostUsd?: unknown;
            reason?: unknown;
            pinned?: unknown;
          }
      | undefined;
      const fallbacks = Array.isArray(d?.fallbacks)
        ? (d.fallbacks as unknown[]).map(String).join(", ")
        : "";
      lines.push(
        `- Step \`${payloadStr(e, "stepId")}\`: **${String(d?.primary ?? "?")}**` +
          (fallbacks ? ` (fallbacks: ${fallbacks})` : "") +
          (typeof d?.estimatedCostUsd === "number"
            ? ` — est $${d.estimatedCostUsd.toFixed(4)}`
            : "") +
          (d?.pinned === true ? " — pinned by user" : "") +
          (typeof d?.reason === "string" ? `\n  - ${d.reason}` : ""),
      );
    } else {
      lines.push(
        `- Step \`${payloadStr(e, "stepId")}\`: fell back from **${payloadStr(e, "from")}** to **${payloadStr(e, "to")}** — ${payloadStr(e, "reason")}`,
      );
    }
  }
  lines.push("");

  /* Policy decisions */
  lines.push("## Policy decisions", "");
  const policyEvents = events.filter((e) => e.type === "policy.decision");
  if (policyEvents.length === 0) lines.push("- (none)");
  for (const e of policyEvents) {
    lines.push(
      `- Step \`${payloadStr(e, "stepId")}\`: \`${payloadStr(e, "tool")}\` → **${payloadStr(e, "decision")}** — ${payloadStr(e, "reason")}`,
    );
  }
  lines.push("");

  /* Approvals */
  lines.push("## Approvals", "");
  const approvalEvents = events.filter((e) => e.type.startsWith("approval."));
  if (approvalEvents.length === 0) lines.push("- (none)");
  for (const e of approvalEvents) {
    const step = payloadStr(e, "stepId");
    if (e.type === "approval.requested") {
      lines.push(
        `- Step \`${step}\`: approval requested for \`${payloadStr(e, "tool")}\` — ${payloadStr(e, "reason")}`,
      );
    } else if (e.type === "approval.granted") {
      lines.push(`- Step \`${step}\`: **granted**`);
    } else {
      lines.push(`- Step \`${step}\`: **denied** — ${payloadStr(e, "reason")}`);
    }
  }
  lines.push("");

  /* Tool runs */
  lines.push("## Tool runs", "");
  const startedByJob = new Map<string, AuditEventRecord>();
  const digestByJob = new Map<string, AuditEventRecord>();
  for (const e of events) {
    if (e.type === "tool.started") startedByJob.set(payloadStr(e, "jobId"), e);
    if (e.type === "tool.output_digest") digestByJob.set(payloadStr(e, "jobId"), e);
  }
  const finished = events.filter((e) => e.type === "tool.finished");
  if (finished.length === 0) lines.push("- (none)");
  for (const e of finished) {
    const jobId = payloadStr(e, "jobId");
    const started = startedByJob.get(jobId);
    const digest = digestByJob.get(jobId);
    const command = started
      ? `\`${[payloadStr(started, "executable"), ...((started.payload.args as string[]) ?? [])].join(" ")}\` (cwd \`${payloadStr(started, "cwd")}\`)`
      : `\`${payloadStr(e, "tool")}\``;
    const outcome =
      e.payload.errorMessage !== undefined
        ? `error: ${String(e.payload.errorMessage)}`
        : e.payload.timedOut === true
          ? "timed out"
          : e.payload.cancelled === true
            ? "cancelled"
            : `exit ${String(e.payload.code)}`;
    lines.push(
      `- Step \`${payloadStr(e, "stepId")}\`: ${command} — ${outcome} in ${String(e.payload.durationMs)} ms` +
        (digest
          ? `; output sha256 \`${payloadStr(digest, "sha256")}\` (${String(digest.payload.bytes)} bytes${digest.payload.truncated === true ? ", truncated" : ""})`
          : ""),
    );
  }
  lines.push("");

  /* Artifacts */
  lines.push("## Artifacts", "");
  if (artifacts.length === 0) lines.push("- (none)");
  for (const a of artifacts) {
    lines.push(
      `- \`${a.kind}\` ${a.relativePath} — sha256 \`${a.sha256}\`, ${a.bytes} bytes`,
    );
  }
  lines.push("");

  return lines.join("\n");
}
