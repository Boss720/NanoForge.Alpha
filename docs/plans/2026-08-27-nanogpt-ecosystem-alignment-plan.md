# NanoForge → NanoGPT Ecosystem Alignment Plan

**Audit date:** 2026-08-27
**Repository / branch:** `C:\Users\Hp\Documents\kimi\Workspaces\kpkoj\nano-forge` / `gem`
**Recommended collaboration posture:** an independent, privacy-conscious local companion and open-source NanoGPT adapter, followed by a limited partner pilot. Do not present NanoForge as an official integration or production-secure desktop runtime yet.

This plan reconciles current source inspection, a live production-preview UI smoke test, fresh quality gates, NanoGPT-owned product/API/privacy material, and NanoGPT's request for a demo, technical overview, and concrete collaboration proposal.

## 1. Current Codebase Audit Summary

NanoForge is a substantial TypeScript monorepo rather than an early mock-up. It has a React/Vite workbench, a loopback Fastify/WebSocket agent host, Zod wire contracts, provider/core packages, an SDK, workspace and reviewed-write primitives, run coordination, an audit store, subagent supervision, memory/scheduler/browser modules, and a Windows packaging path.

The current user-visible product is ahead of the fully connected runtime:

| NanoGPT-highlighted area | Current classification | Evidence and honest boundary |
| --- | --- | --- |
| Model catalog | **Partial, live browser path plus fallback** | `src/lib/nanogpt.ts:86-121` calls `/models` and falls back silently; the live UI exposed an “offline snapshot.” It does not request `?detailed=true`, caps results at 400, loses NanoGPT capability/provider-selection metadata, and treats ambiguous pricing heuristically. |
| Live NanoGPT chat | **Implemented browser-direct; host path separate** | `src/lib/nanogpt.ts:172-245` streams `/chat/completions`; `src/hooks/useAgentOrchestration.ts:238-278` uses it. The privileged host has a generic adapter, not a verified first-class NanoGPT vertical slice. |
| Run/cost tracking | **Partial and non-authoritative** | `src/lib/usage.ts`, `src/lib/usageLog.ts`, and `src/sections/CostDashboard.tsx` maintain a 500-run browser-local estimate. Host model profiles currently declare zero prices (`apps/agent-host/src/session.ts:146-155`). There is no reconciliation with NanoGPT billing/account usage. |
| Workspace tools | **Substantive but privacy/workflow boundary incomplete** | Host-backed read/search/stat/git/write and conflict-safe temp replacement exist in `apps/agent-host/src/workspace/filesystem.ts`; workspace generation and broker recovery are present. Canonical/display paths still cross into browser-visible descriptors and persistence; a session root change returns `reconnect_required`; “Reveal in Explorer” is currently a no-op (`src/sections/WorkspaceExplorer.tsx:190-193`). |
| Slash commands | **Partial** | A broad parser/registry and command palette exist, but only swarm aliases reach the host; the host rejects non-swarm commands (`apps/agent-host/src/session.ts:234-239`). `/plan` is not wired through `AppLayout`, and `/schedule`, `/browse`, `/goal`, `/learn`, `/compact`, `/cost`, and `/clear` are not real command actions. |
| Artifact review | **Strong UI concept; mixed execution paths** | The production preview visibly mounted diff review with **Apply** and **Reject**, while `src/hooks/useArtifacts.ts` / `src/sections/ArtifactDock.tsx` provide artifact state. Generic feedback only mutates local summary state, only chat patches create artifacts, and desktop/mobile reachability differs. Demo-generated patches and host-audited artifacts are not one authoritative lifecycle. |
| Browser controls | **Implemented module, not composed** | `apps/agent-host/src/browser/manager.ts` uses non-persistent contexts and constrained actions, but the production session/coordinator does not invoke it as a governed tool path. |
| Scheduling controls | **Preview/in-memory and non-executing** | `apps/agent-host/src/daemons/scheduler.ts` stores timers/cron records in process memory. The current trigger emits an untargeted wakeup that the wakeup engine drops, so a scheduled prompt does not launch a model run. Restart durability, run-time reauthorization, ownership, missed-run policy, and durable audit are absent. |
| Memory | **Implemented volatile shared store** | `apps/agent-host/src/agents/memory.ts` supports namespaces, tags, TTL, query/delete/clear, but is process-memory only and lacks an explicit persistence/consent/export/deletion-receipt product contract. |
| Agent controls | **Substantial UI/state supervisor; execution incomplete** | The preview mounted Swarm Tree, Playground, Memory, Tools, Messages, and Daemons. Spawn creates metadata/worktrees and state controls, but does not call a provider/agent loop. The playground is explicitly mocked, and some client playground frames have no host handlers. Production tool/filesystem paths also do not consistently call subagent authorization policy. |
| Privacy/security | **Good primitives with release-blocking bypasses** | Secrets are scrubbed from browser persistence, host auth is loopback/token based, path canonicalization and reviewed writes exist. A direct interactive PTY path bypasses the structured policy/approval/audit coordinator; host tokens still begin in a URL; raw workspace paths reach browser-visible state; host secret redaction is not bound to all live secret values. |

Fresh verification for this checkout:

- `pnpm lint`: passed.
- `pnpm typecheck`: 6/6 Turbo tasks passed (cache replayed; the command was executed on this checkout).
- `pnpm test -- --run`: 84 files / 761 tests passed.
- `pnpm test:e2e`: 13 files / 233 tests passed.
- `pnpm build`: passed; Vite warned about an 892.45 kB main JavaScript chunk and a 403.16 kB cost-dashboard chunk.
- Live preview at `http://127.0.0.1:4173`: mounted catalog, workspace/chat/files, run trace, Apply/Reject diff review, cost dashboard, and swarm controls. It showed `API demo`, `Host offline`, and an offline catalog snapshot; this is UI reachability, not a live NanoGPT-host-workspace run.

Important assumptions and unknowns:

- `{{placeholder: confirm whether the intended public deliverable is Windows-only, cross-platform desktop, browser-plus-local-host, or all three}}`
- `{{placeholder: confirm whether NanoGPT prefers OAuth PKCE/device login, partner JWT/SSO, user-supplied API keys, or a staged combination}}`
- `{{placeholder: confirm NanoGPT's current authoritative per-response price/billing metadata and reconciliation endpoint}}`
- `{{placeholder: confirm public repository, license, trademark/branding rules, support ownership, and disclosure timeline}}`
- `{{placeholder: confirm whether the browser and scheduling controls NanoGPT mentioned are expected as NanoForge-owned features or have NanoGPT APIs/contracts to integrate}}`
- `{{placeholder: define retention defaults and legal/support requirements for transcripts, audit records, artifacts, memory, and scheduled tasks}}`

## 2. Key Alignment Gaps

### A. Model catalog and routing

1. `validateKey()` uses `/models`, but NanoGPT documents that the catalog can return `200` even for an invalid key; the current “connected” result can therefore be a false positive.
2. Catalog requests omit `?detailed=true`, so descriptions, capability flags, context/output limits, authoritative pricing, icons, categories, and cost hints are not reliably loaded.
3. The UI has no explicit canonical/subscription/paid/personalized catalog mode and does not expose provider discovery, `:fast` / `:cheap` / caching routes, service tiers, or the pay-as-you-go implication of explicit provider selection.
4. Fallback data can look product-complete unless every model and price visibly carries `live`, `cached-at`, or `bundled estimate` provenance.

### B. Runs, usage, and cost

1. “≈ cost” is computed from token counts and catalog prices in the browser; it is not NanoGPT's bill or an enforceable budget.
2. Browser-direct and host-driven runs do not write one schema/ledger. Host routing profiles use zero prices.
3. The run record lacks billing mode, provider route, price-version timestamp, cache read/write tokens, service tier, NanoGPT request/run identifier, balance delta, and reconciliation state.
4. There are no preflight budget controls tied to NanoGPT key/day limits, team/model allowlists, or subscription-vs-pay-as-you-go behavior.

### C. Workspace and artifact truth

1. Browser-visible workspace descriptors/persistence expose path information that should remain host-owned.
2. Demo virtual files, local workspace files, model-produced artifacts, and audited host artifacts are separate sources of truth.
3. Apply/Reject is visually strong, but the production contract needs immutable content hashes, exact source provenance, approval identity/scope/expiry, atomic apply, post-write verification, and rollback metadata.
4. NanoGPT's Projects direction includes files, instructions, notes, tasks, and conversations; NanoForge workspaces do not yet define an interoperable project manifest or explicit exact-vs-extracted content warnings.

### D. Memory

1. Current shared memory is volatile, while NanoGPT distinguishes cross-chat Global Memory from long-context compression/Context Memory.
2. The UI does not distinguish local workspace memory, local global preferences, and optional NanoGPT-managed context memory with separate retention and cost.
3. Consent, provenance, TTL, edit/export/delete-all, synchronization, and deletion verification are incomplete.

### E. Agent, slash, browser, and scheduling controls

1. A crafted `terminal.create` frame can open an arbitrary interactive PTY outside the central policy/approval/audit coordinator.
2. Subagent isolation rules exist but are not enforced consistently at every tool/filesystem boundary.
3. Browser, MCP, and scheduling modules are not composed through one capability broker and should not be marketed as production execution.
4. Schedules are not restart-safe and do not reauthorize work at trigger time.
5. Slash commands are fragmented rather than generated from a typed, capability-aware registry with help, permission previews, schemas, stable results, and audit IDs.
6. Subagent spawn currently creates supervised state/isolation metadata but not an actual model/tool execution loop; playground behavior remains simulated and its client-only frames are not host contracts.

### F. Privacy, secrets, and release trust

1. URL-delivered bootstrap credentials are scrubbed after load, but can still enter browser history/process/referrer/log surfaces before scrubbing.
2. The host accepts literal provider keys and its audit redaction is not guaranteed to know every active secret; binary artifacts are not content-redacted.
3. `https://nano-gpt.com` should not be a default origin allowed to control the local host. Only the exact launcher origin should have host authority.
4. There is no complete user-facing data inventory, retention control, privacy route label, or “what leaves this device” preview.
5. Packaging is not yet a signed, reproducible, provenance-attested release/update channel.

### G. Partner readiness

1. The repository contains conflicting status language: `README.md` is cautious, while `PROJECT.md` still has stale/over-broad architecture and completion claims. A partner should not have to infer which document is authoritative.
2. There is no checked-in NanoGPT contract suite covering models, auth, streaming, tool calls, usage, provider routing, 401/402/429/503, cancellation, memory, or MCP behavior.
3. There is no credential-safe live-pilot harness or redacted evidence bundle.
4. Public claims about exact NanoGPT model counts and Context Memory pricing are inconsistent across NanoGPT-owned pages; NanoForge must consume APIs and timestamps rather than hard-code marketing totals.

## 3. Priority Updates

### Immediate — weeks 0–3: earn the right to run a private demo

| Order | Deliverable | Primary targets | Exit gate |
| --- | --- | --- | --- |
| P0.1 | Close privileged bypasses with a single Host Capability Broker | `apps/agent-host/src/session.ts`, `runs/coordinator.ts`, `policy/`, `terminal/`, protocol approval schemas | Crafted direct PTY/browser/MCP/write/daemon frames fail closed; approved run-bound operations work and are audited. |
| P0.2 | Make NanoGPT authentication and execution host-owned | New `apps/agent-host/src/providers/nanogpt.ts`, provider registry, secret store, `src/` connection UI | No key in URL/localStorage/logs; invalid/revoked key fails an actually authenticated endpoint; one live host-routed NanoGPT stream succeeds with cancellation and redacted evidence. |
| P0.3 | Ship Catalog v2 | `src/lib/nanogpt.ts`, shared model schemas, `ModelPanel.tsx`, provider adapter | `?detailed=true`; capability/pricing/unit parsing; canonical/subscription/paid/personalized modes; provenance and stale/offline labels; 3 raw fixture records verified. |
| P0.4 | Unify usage and cost semantics | New shared `UsageRecord` protocol, host audit/usage store, `CostDashboard.tsx` | Each run shows `estimated`, `provider-reported`, or `reconciled`; no estimate is presented as billed cost; balance/limit failures map correctly. |
| P0.5 | Remove path/token leaks | workspace control descriptor, broker/bootstrap, persistence migration | Browser WS frames/storage contain no canonical path or bearer token; exact launcher origin only; legacy state is scrubbed. |
| P0.6 | Truthful partner demo mode | capability flags, labels, demo fixtures, `README.md`, `PROJECT.md`, `docs/known-limitations.md` | Every highlighted control is live, preview, demo, or unavailable based on runtime state; demo cannot be mistaken for NanoGPT execution. |

### Short-Term — weeks 4–10: make highlighted features coherent

| Order | Deliverable | Dependencies | Exit gate |
| --- | --- | --- | --- |
| P1.1 | Workspace/project manifest and artifact transaction model | P0.1, P0.5 | Files/instructions/notes/tasks/conversations use opaque workspace IDs; Apply/Reject is hash-bound, atomic, audited, and recoverable. |
| P1.2 | Privacy-centered memory system | P0.2, data inventory | Local workspace/global memory and optional NanoGPT Context Memory are distinct; opt-in retention, edit/export/clear, and deletion receipts pass tests. |
| P1.3 | Enforced agent isolation and budget controls | P0.1, P0.4 | Mutation-capable subagents require isolated worktrees; token/USD/time/tool budgets are enforced host-side; parent can pause/cancel/revoke. |
| P1.4 | NanoGPT MCP integration through broker | P0.1, P0.2 | Pinned canonical package/version; allowlisted tools; per-call cost/privacy preview; network timeout/retry/audit; no secret leakage. |
| P1.5 | Governed browser tools | P0.1, P1.1 | Non-persistent context, origin approval, sensitive-action reapproval, SSRF/download controls, audited screenshots/artifacts, live journey. |
| P1.6 | Durable schedules | P0.1, P1.2, P1.3 | Encrypted durable records, owner/workspace binding, list/cancel/pause, missed-run policy, trigger-time reauthorization, auditable execution. |
| P1.7 | Typed slash-command registry | P1.1–P1.6 | UI help and protocol are generated from one registry; unsupported commands are absent; permission and cost preview precede execution. |
| P1.8 | Contract, security, and release pilot gates | All above | Live NanoGPT contract suite, hostile workspace/WS tests, clean-machine Windows journey, SBOM/checksums/signature, no-secrets evidence. |

### Long-Term — months 3–6: deepen ecosystem and partnership value

1. Support NanoGPT partner auth/SSO and teams after NanoGPT confirms the contract: per-member spend/model limits, team billing attribution, and revocation propagation.
2. Add privacy-route selection only from verified NanoGPT metadata: standard, declared ZDR, TEE, and browser-encrypted Private Mode must have explicit, qualified guarantees.
3. Expand to image/video/audio/embedding catalogs and asynchronous jobs through shared run/artifact/cost contracts, not one-off panels.
4. Add provider selection, `:fast` / `:cheap` / caching, service-tier, and BYOK controls with clear billing-mode changes and price caps.
5. Publish a stable `@nanoforge/nanogpt-adapter` contract package and secret-free compatibility fixtures; upstream what NanoGPT agrees to maintain.
6. Add signed auto-update with staged rollout/rollback, reproducible builds, provenance, and platform expansion only after Windows clean-machine proof is routine.
7. Consider optional NanoGPT Project interchange/sync only after local-first boundaries, conflict semantics, encryption, and delete propagation are agreed. Local operation should remain fully usable without sync.

## 4. Detailed Feature Specifications

### 4.1 First-class NanoGPT provider and scoped authentication

**Purpose:** Replace two divergent provider paths with one secure, testable NanoGPT execution route owned by the local host.

**Implementation outline:**

1. Add a NanoGPT adapter implementing model discovery, Chat Completions streaming/tool calls, optional Responses support, cancellation, structured errors, and usage capture.
2. Add a `SecretStore` interface with Windows Credential Manager/DPAPI implementation and in-memory test implementation. UI receives only `secretRef`, status, scopes, expiry, and last-four fingerprint.
3. Prefer `{{placeholder: NanoGPT-approved OAuth PKCE/device-login flow}}`; retain manual API-key entry as an explicitly local fallback. Never validate via `/models`; use an authenticated account/balance/key-introspection contract confirmed by NanoGPT.
4. Route browser chat through the host in packaged/pilot mode. Keep browser-direct mode behind a developer-only flag with a conspicuous privacy warning.
5. Normalize 401 invalid/revoked, 402 balance/x402, 429 throughput/key-budget, 503 provider route, timeout, and cancellation into typed UI states.

**Privacy considerations:** Credentials never enter browser persistence, URL parameters, transcripts, crash reports, or audit payloads. Connection UI must state which endpoint receives prompts and which local context will be sent.

**NanoGPT alignment:** Uses NanoGPT's OpenAI-compatible API and scoped-key/spend-limit direction while giving local users revocation and blast-radius controls.

**Acceptance:** a secret sentinel with a nonstandard format is absent from browser storage, SQLite, text/binary artifacts, stdout/stderr, exports, and screenshots; revoked keys fail; one credential-safe live stream and cancellation pass.

### 4.2 Model Catalog v2 and routing policy

**Purpose:** Turn the catalog from a selector into an accurate, provenance-aware decision surface.

**Implementation outline:**

1. Fetch `/api/v1/models?detailed=true`; optionally support subscription, paid, and personalized variants after auth.
2. Extend `NanoModel` with canonical ID, display name, provider owner, context/output limits, modality/capability flags, price object plus unit/currency, category, icon URL, visibility source, fetched timestamp, and raw-schema version.
3. Remove magnitude guessing where the API supplies units. Quarantine malformed prices as unknown rather than converting them.
4. Add filters for tools, parallel tools, vision/PDF, structured output, reasoning, privacy route, subscription inclusion, price, context, and availability.
5. Discover providers lazily per canonical model and warn when explicit selection changes subscription coverage or pricing. Add optional `fast`, `cheap`, caching, service-tier, and max-price controls only after contract tests.
6. Cache a last-known-good catalog locally with ETag/timestamp and a strong stale badge; keep bundled fixtures only for Demo mode.

**Privacy considerations:** Unauthenticated catalog fetch should remain possible; authenticated personalization must use the host credential and persist only the returned non-secret catalog subset. Remote icons require CSP and privacy review or local proxy/cache.

**NanoGPT alignment:** Directly maps to NanoGPT's broad, dynamic catalog, detailed pricing/capabilities, subscription/paid visibility, and provider-routing ecosystem.

**Acceptance:** capture and display at least three raw parsed records from different providers; contract tests cover additive unknown fields, missing pricing, invalid auth behavior, stale fallback, provider IDs containing `/`, and >400 results without silent truncation.

### 4.3 Authoritative run, usage, and cost ledger

**Purpose:** Make run/cost tracking trustworthy for users and useful to NanoGPT without pretending estimates equal bills.

**Implementation outline:**

1. Define a shared append-only `UsageRecord`: local run/step/request IDs; NanoGPT request ID if supplied; model and routed provider; billing mode; price-source/version; input/output/reasoning/cache tokens; media/search/tool charges; estimated/provider-reported/reconciled USD; currency; timestamps; status; error class.
2. Parse terminal streaming usage frames and retain raw normalized evidence. Record estimates before execution, provider data on completion, and reconciliation separately so history is never rewritten invisibly.
3. Add budget policies per run/workspace/day: estimated preflight, warning threshold, hard stop, maximum tool/search/media spend, and provider/model allowlists.
4. Integrate account balance, subscription usage, and team usage only through documented/partner-approved endpoints. Make data freshness visible.
5. Rebuild `CostDashboard` around provenance: **Estimated**, **Reported by NanoGPT**, **Reconciled**, and **Unknown**. Show failures separately because NanoGPT states failed requests are generally not charged, while partial/provider-specific cases require confirmation.

**Privacy considerations:** Default to local records; hash/pseudonymize prompts and actor IDs; no prompt content is needed for billing. Give retention/export/delete controls. Team reporting must not leak member prompts.

**NanoGPT alignment:** Matches NanoGPT's pay-as-you-go, subscriptions, per-key caps, team usage, balance, and provider-dependent pricing direction.

**Acceptance:** mocked and live-safe fixtures cover successful stream, cache hit, provider fallback, subscription operation, explicit provider pay-go, search charge, 401/402/429/503, cancellation, and unknown price; dashboard totals equal ledger fold and never relabel estimates as actual.

### 4.4 Unified capability broker and approval model

**Purpose:** Ensure every privileged action obeys one least-privilege policy.

**Implementation outline:**

1. Introduce a host `CapabilityBroker` called by terminal, workspace write/delete, browser, MCP, daemon, schedule, and subagent mutation paths.
2. Bind grants to host instance, client session, opaque workspace ID/generation, run/step/tool, normalized arguments digest, approved scope, expiry, and single/multi-use semantics.
3. Remove arbitrary agent-originated `terminal.create`; offer structured command execution by default. User-owned interactive terminal requires a separate visible grant and cannot be silently reused by an agent.
4. Centralize deny/ask/allow, egress policies, rate/resource limits, cancellation, redaction, and audit emission.
5. Add a UI permission sheet showing exact target, data leaving device, estimated cost, files affected, reversibility, and grant lifetime.

**Privacy considerations:** Prompt injection cannot convert model text into authority. Grants contain no raw secrets and are revoked on workspace switch, disconnect, parent cancellation, or generation change.

**NanoGPT alignment:** Makes tool calling, agent controls, local workspaces, MCP, browser actions, and schedules compatible with a privacy-conscious partner story.

**Acceptance:** adversarial direct WebSocket frames for every privileged kind fail closed without a matching grant; natural-language “approval” never authorizes; all grants and outcomes are auditable and secret-free.

### 4.5 Workspace/project and artifact transaction model

**Purpose:** Join NanoForge's strongest differentiator—local project execution—with NanoGPT's evolving Projects/workspaces direction.

**Implementation outline:**

1. Use an opaque `WorkspaceControlDescriptor` in browser/protocol state; canonical paths stay solely inside the launcher/host registry.
2. Add a local `.nanoforge/project.json` manifest for versioned instructions, notes, tasks, conversation references, memory policy, capabilities, and artifact index. Do not store provider keys or canonical paths.
3. Represent source inputs as `exact`, `extracted`, `reconstructed`, or `generated`, with warnings modeled after NanoGPT's exact-vs-reconstructed distinction.
4. Create an artifact state machine: proposed → previewed → accepted/rejected → applying → applied/conflicted/failed → verified/rolled-back. Bind approval to base hash and exact diff.
5. Apply via host atomic write; immediately read back/hash, record Git status, and offer revert via a new reviewed transaction—not an unaudited reset.
6. Keep Demo workspace physically separate and watermarked; Apply should default to disabled or Reject-only unless a disposable host workspace is explicitly connected.

**Privacy considerations:** Default local-only; file inclusion is explicit; sensitive paths and attachment blocklists apply before provider context assembly. Exports disclose included data and omit secrets/raw host paths.

**NanoGPT alignment:** Mirrors NanoGPT Projects' files/instructions/notes/tasks/conversations while adding safe local code execution and artifact review.

**Acceptance:** stale hashes, external modification, junction race, oversized/binary/encoded files, rejected artifacts, crash mid-apply, and workspace switch all have deterministic outcomes and tests.

### 4.6 Memory with explicit locality, purpose, and retention

**Purpose:** Offer useful memory without collapsing several privacy contracts into one toggle.

**Implementation outline:**

1. Define three distinct stores: **Workspace memory** (local, workspace-scoped), **Personal preferences** (local, cross-workspace, opt-in), and **NanoGPT Context Memory** (remote/opt-in, separate retention/cost contract).
2. Each entry carries source, purpose, scope, sensitivity class, created/last-used timestamps, TTL, confidence, and user-edit status.
3. Persist local memory encrypted after opt-in; default sensitive/code-derived memory to workspace-only and bounded TTL. Never auto-promote secrets or raw files to global memory.
4. Provide view/edit/pin/export/delete-by-scope/clear-all controls and verifiable deletion receipts. Disable means no reads or writes, not merely “do not display.”
5. If NanoGPT Context Memory is enabled, show exactly what compressed context is sent, retention days, current documented price `{{placeholder}}`, and provider/privacy route.

**Privacy considerations:** Local first, opt-in synchronization, data minimization, no identity or content in usage telemetry, and explicit limitations for provider ZDR/TEE/Private Mode.

**NanoGPT alignment:** Matches NanoGPT's distinction between Global Memory and Context Memory and its opt-in privacy controls.

**Acceptance:** restart durability, expiry, scope isolation, disabled-mode non-access, export, clear-all, and remote-retention request tests pass; deleted entries cannot reappear from cache/sync.

### 4.7 Agent controls and isolation

**Purpose:** Convert a sophisticated control-plane UI into enforceable agent governance.

**Implementation outline:**

1. Require an agent card with objective, archetype, owner, parent, model/routing policy, workspace mode, writable allowlist, tool allowlist, network policy, time/token/USD budgets, and retention policy.
2. Default explorer/planner/verifier to read-only. Mutation-capable agents use isolated worktrees; shared-source writes are denied.
3. Invoke subagent authorization on every workspace/tool call, not only at spawn. Propagate capability grants narrowly; children cannot mint broader authority.
4. Wire pause/resume/cancel/revoke to actual coordinator/child process state and wait for acknowledged termination.
5. Replace or hide playground simulations in pilot mode. Display live/demo/preview provenance beside agent counts and telemetry.

**Privacy considerations:** Child context is minimized; mailbox/memory data is scoped; agent logs are redacted; network/tool access is explicit and revocable.

**NanoGPT alignment:** Complements NanoGPT inference/MCP with a transparent local A2A/task lifecycle rather than claiming NanoGPT owns the executor.

**Acceptance:** escape attempts across worktrees, source-tree mutation from read-only roles, budget overrun, parent cancellation, stale approval replay, and secret inheritance all fail predictably.

### 4.8 Typed slash-command system

**Purpose:** Make fast controls discoverable and safe rather than a loose set of parser aliases.

**Implementation outline:**

1. Define one registry containing command name/aliases, schema, capability prerequisites, preview renderer, execution owner, permission/cost class, result schema, and help examples.
2. Initial verified families: `/model`, `/route`, `/cost`, `/workspace`, `/artifact`, `/memory`, `/agent`/`/swarm`, `/browser`, `/schedule`, `/privacy`, `/help`.
3. Generate autocomplete/help UI and protocol schemas from the registry. Hide unavailable commands based on runtime capabilities.
4. Commands that mutate, transmit, spend, or schedule must render a preview and route through the capability broker; parse success never equals authorization.
5. Return stable structured result/error codes and an audit/run ID.

**Privacy considerations:** Avoid echoing secrets/raw paths in history or autocomplete. Redact command logs; make destructive scope and remote transmission explicit.

**NanoGPT alignment:** Converts a feature NanoGPT explicitly noticed into a safe gateway for catalog, budgets, memory, agents, and tools.

**Acceptance:** alias collision, keyboard shortcut, malformed flags, unsupported capability, injection-like arguments, approval denial, and stable result-schema tests pass.

### 4.9 NanoGPT MCP and web/data tools

**Purpose:** Use NanoGPT's documented agent ecosystem instead of recreating every remote capability.

**Implementation outline:**

1. Confirm and pin `{{placeholder: canonical @nanogpt/mcp package name/version}}`; prefer a direct typed API adapter for critical contracts and MCP for optional tools.
2. Register only selected tools (e.g., list models, balance, web search, scrape, image, vision). Disable arbitrary server/tool discovery in pilot mode.
3. Run MCP through the capability broker with secret references, per-call timeout/retry, data-egress preview, URL/SSRF validation, response size limits, and cost metadata.
4. Store raw responses as local audited artifacts only when requested; sanitize rendered content and distinguish source data from model inference.

**Privacy considerations:** Show queries/URLs/files sent to NanoGPT and downstream providers. Block local/private-network scraping and secret-bearing URLs. Respect NanoGPT and downstream provider retention disclosures.

**NanoGPT alignment:** MCP is NanoGPT's publicly documented agent-facing surface and creates an obvious open-source integration deliverable.

**Acceptance:** allowlisted call succeeds; unknown tool, malicious MCP output, local URL, oversized payload, timeout, revoked key, and cost-cap breach fail closed.

### 4.10 Governed browser controls

**Purpose:** Turn the existing secure-looking browser module into a real, reviewable workflow.

**Implementation outline:**

1. Add browser tool schemas to the coordinator/broker; retain one non-persistent context per run.
2. Require origin approval for navigation and one-shot reapproval for authentication, submission, purchase, download, upload, clipboard, or external side effects.
3. Add DNS/IP re-resolution and private-network blocking, redirect validation, download quarantine, MIME/size limits, and no model-supplied JavaScript.
4. Send screenshots/extracted text to the shared artifact/audit lifecycle with source URL, timestamp, digest, and redaction state.
5. Label it **NanoForge browser control** unless NanoGPT confirms a native browser-agent contract. NanoGPT's publicly documented browser assistant is not sufficient evidence for a general-purpose control API.

**Privacy considerations:** Fresh profiles prevent account/cookie leakage; attached page data and screenshots require explicit transmission preview before model inference.

**NanoGPT alignment:** Adds controlled browser evidence to NanoGPT-powered agents while respecting NanoGPT's privacy-conscious positioning.

**Acceptance:** redirects to private networks, cross-origin escalation, sensitive action without reapproval, persistent cookies, script injection, and unapproved downloads are blocked; a safe read-only lookup produces a cited artifact.

### 4.11 Durable, reauthorized scheduling

**Purpose:** Make scheduled agent work dependable and safe after restart.

**Implementation outline:**

1. Persist encrypted schedule records with owner, workspace ID/generation, command/plan template hash, time zone, recurrence, next run, expiry, budgets, and required capabilities.
2. Creation/changes require explicit approval. At trigger time, revalidate workspace, secret/key status, budgets, model availability, and capabilities; never reuse an expired interactive approval.
3. Define missed-run, overlap, retry/backoff, offline, daylight-saving, and version-migration semantics.
4. Provide list/pause/resume/run-now/cancel/history controls and audit every transition.
5. Default schedules to notification/plan preparation until unattended mutation policy is explicitly approved.

**Privacy considerations:** Prompts and secrets are referenced, not duplicated; notifications omit sensitive content; clearing a workspace can revoke its schedules.

**NanoGPT alignment:** Preserves the scheduling feature NanoGPT noticed while making local execution and spend predictable.

**Acceptance:** restart, DST, missed tick, overlapping run, revoked key, moved/deleted workspace, budget cap, and cancellation tests pass with one execution at most.

### 4.12 Privacy center, audit integrity, and release trust

**Purpose:** Make privacy an observable product behavior and produce a partner-safe binary/repository.

**Implementation outline:**

1. Add a Privacy Center listing every store and egress path: browser state, IndexedDB attachments, host secrets, `.nanoforge` audit/artifacts, memory, schedules, NanoGPT/provider requests, and optional sync.
2. Provide data export and scoped deletion with receipts; show retention and last-access timestamps.
3. Hash-chain ledger records and sign exports, but describe them as tamper-evident—not tamper-proof against a local administrator.
4. Bundle/pin Mermaid rather than load runtime code from a CDN. Add dependency, license, secret, SBOM, and provenance scans.
5. Build from clean inputs only; unify version metadata; generate checksums; Authenticode-sign executable/installer; test update signature, rollback, and clean-machine launch.
6. Reconcile `README.md`, `PROJECT.md`, architecture docs, limitations, and demo copy against a generated capability matrix.

**Privacy considerations:** Mirror NanoGPT's qualified language: NanoForge can guarantee its own local defaults, but downstream ZDR/TEE claims depend on documented routes/providers; Private Mode is a separate stronger guarantee only where supported.

**NanoGPT alignment:** Makes the “local companion” proposition credible beside NanoGPT's browser-local history, opt-in sync/memory, limited metadata retention, provider routing, ZDR, TEE, and Private Mode choices.

**Acceptance:** storage/egress inventory test, complete export/delete journey, secret scan, SBOM/provenance generation, signed clean-machine install/launch/update/rollback, and documentation drift check pass.

## 5. Next Steps for Collaboration

### Recommended proposal to NanoGPT

Offer a three-stage collaboration, not an undifferentiated “partnership” request:

1. **Open-source compatibility layer:** NanoGPT provider adapter, typed fixtures, and credential-free contract tests for catalog, streaming, tools, usage, errors, routing, and cancellation.
2. **Private companion-app pilot:** 5–10 technical users, disposable/local repositories, scoped keys, hard spend caps, opt-in diagnostics, weekly issue review, and no public endorsement claim.
3. **Partner integration decision:** after security/live-flow/release gates, decide between OAuth/partner JWT, team billing/model controls, co-marketing, distribution, support SLAs, and possible revenue-share terms.

Ask NanoGPT for concrete confirmation of:

- recommended local-app auth and token scopes;
- current model/pricing/usage schemas and whether a request-level billed-cost/reconciliation field exists;
- partner test credentials or a sandbox with hard limits;
- canonical MCP package and support policy;
- supported privacy-route metadata for ZDR, TEE, and Private Mode;
- Projects/artifact interoperability interest;
- branding, repository/license, security disclosure, and support expectations;
- whether browser/scheduling are NanoForge-owned differentiators or intended NanoGPT integration points.

### {{demo_video_script}}

**Target length:** 4 minutes. Record a fresh build in a disposable repository. Hide all keys/tokens/absolute paths. Prefer **Reject**; Apply only after the reviewed-write/live-host path is intentionally enabled and verified. Label any disconnected sequence `Demo mode`.

| Time | Visual action | Narration / evidence |
| --- | --- | --- |
| 0:00–0:20 | Title card, Privacy Center summary, runtime badges | “NanoForge is an independent local-first control plane for NanoGPT-powered work. Files and execution stay local; only the context I approve goes to the selected NanoGPT route.” Show build commit/version and `Live NanoGPT` / `Local host ready`, not a static mock. |
| 0:20–0:55 | Open Catalog v2; filter tools + coding; inspect three records | “This is NanoGPT's detailed catalog, timestamped and provenance-labelled.” Show canonical ID, provider, capability flags, context/output limits, subscription/pay-go status, and pricing unit. Raw fixture panel shows three redacted records. |
| 0:55–1:20 | Select a cheap route and set a $0.05 run cap | Explain estimate vs billed/reconciled cost, key limits, provider-selection billing warning, and privacy route. |
| 1:20–1:55 | Open disposable workspace; submit “inspect rate limiting and propose a minimal tested patch” | Show only opaque workspace label in UI. Permission preview lists the exact files/context sent; no canonical path or secret appears. |
| 1:55–2:25 | Stream run; expand plan/tool events and one approval | Show model/request/run IDs, NanoGPT usage, local policy decision, and a structured command. Explicitly say the terminal/tool authority remains local and revocable. |
| 2:25–2:55 | Open artifact diff and choose **Reject** | Show base hash, provenance, tests, Apply/Reject, and audit record. “Model output never writes by itself.” |
| 2:55–3:20 | Open cost dashboard | Compare estimate, provider-reported usage, and reconciled/balance state. Show 401/402/429 handling via fixtures, not a live failure that might expose data. |
| 3:20–3:40 | Open Memory and Agent controls | Show workspace-only memory with TTL/export/delete, an isolated read-only subagent, budgets, pause/cancel, and no simulated agents. |
| 3:40–4:00 | Architecture/limitations slide and collaboration ask | “We propose an open-source adapter and contract suite first, then a small private companion pilot. Browser and scheduling remain NanoForge-owned previews until their security gates and NanoGPT integration expectations are confirmed.” |

**Recording gate:** repeat the exact flow live once before recording; inspect browser storage, `.nanoforge` exports, and console/log output for secrets and absolute paths; capture terminal proof for lint, typecheck, tests, build, host connection, live NanoGPT request, reviewed rejection/apply, and cost reconciliation.

### {{technical_overview_document}} outline

1. **Executive summary and non-affiliation statement** — what NanoForge is, who it serves, and what is pilot-only.
2. **Verified capability matrix** — implemented / partial / demo / absent, with last-tested commit and commands.
3. **System architecture** — unprivileged React UI; loopback host; capability broker; NanoGPT adapter; workspace registry; audit/usage stores; protocol/SDK boundaries.
4. **Golden data flow** — auth → detailed catalog → context selection → NanoGPT request → usage/tool stream → local approval/execution → artifact review → ledger reconciliation.
5. **NanoGPT contracts used** — exact endpoints, headers, schemas, error codes, routing/billing modes, MCP package/version, and compatibility policy.
6. **Privacy/data-flow inventory** — each datum, location, encryption, retention, deletion, egress destination, and user control; qualified provider/ZDR/TEE/Private Mode language.
7. **Threat model and mitigations** — XSS, prompt injection, WS origin/token theft, PTY/tool bypass, symlink/junction race, malicious MCP/browser content, secret leakage, local attacker, supply chain.
8. **Workspace and artifact safety** — opaque IDs, exact/extracted provenance, conflict hashes, atomic write, Apply/Reject, rollback, audit.
9. **Run/cost semantics** — estimate vs reported vs reconciled, price versions, budgets, subscription/pay-go/provider selection, teams.
10. **Memory/agent/browser/schedule contracts** — locality, retention, capabilities, approvals, isolation, durability, cancellation.
11. **Quality and release evidence** — CI matrix, contract/E2E/adversarial/live tests, performance budgets, SBOM/provenance/signing, clean-machine proof.
12. **Known limitations and unsupported claims** — explicit, revision-stamped list.
13. **Pilot proposal** — scope, users, success metrics, telemetry opt-in, support/security process, timeline, and exit criteria.
14. **Open decisions (`{{placeholders}}`)** — auth/partner API, cost reconciliation, privacy metadata, licensing/branding, support/SLA, platform targets.

### Collaboration success metrics

- 100% of pilot NanoGPT requests use scoped, revocable host-owned credentials.
- 100% of privileged actions have a broker decision and audit ID; zero direct PTY/tool bypasses.
- 0 secrets or canonical paths in browser persistence, exports, screenshots, logs, or crash evidence.
- ≥99% catalog parsing success over the live detailed feed; unknown fields are additive-safe.
- 100% of run costs labelled by provenance; reconciled totals meet `{{placeholder: agreed tolerance}}`.
- ≥95% pilot golden-path completion without maintainer intervention; all failures identify auth, balance, rate, provider, host, policy, or workspace cause.
- All external demo claims trace to a current capability-matrix row and evidence artifact.

## Primary NanoGPT sources

- [NanoGPT Help / mission](https://nano-gpt.com/help)
- [Privacy explainer](https://nano-gpt.com/privacy)
- [Privacy guide](https://nano-gpt.com/privacy-guide)
- [Projects becoming AI workspaces](https://nano-gpt.com/blog/nanogpt-projects-ai-workspaces)
- [Models API](https://docs.nano-gpt.com/api-reference/endpoint/models)
- [Chat Completions API](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion)
- [Responses API](https://docs.nano-gpt.com/api-reference/endpoint/responses)
- [Provider selection](https://docs.nano-gpt.com/api-reference/miscellaneous/provider-selection)
- [Rate limits and per-key spend caps](https://docs.nano-gpt.com/api-reference/miscellaneous/rate-limits)
- [Subscription usage](https://docs.nano-gpt.com/api-reference/endpoint/subscription-usage)
- [Teams API](https://docs.nano-gpt.com/api-reference/teams)
- [Context Memory endpoint](https://docs.nano-gpt.com/api-reference/endpoint/memory)
- [NanoGPT MCP](https://docs.nano-gpt.com/api-reference/miscellaneous/mcp-server)
- [Authentication](https://docs.nano-gpt.com/authentication)
