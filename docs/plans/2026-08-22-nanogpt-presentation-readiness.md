# NanoGPT Presentation Readiness Plan

## Objective

Prepare NanoForge for a credible private technical evaluation by the NanoGPT team, then for a downloadable companion-app pilot. The immediate goal is not to add the largest possible feature set; it is to make the demonstrated path safe, truthful, reproducible, and easy to evaluate.

## Recommended Positioning

Present NanoForge as an **independently developed, local-first NanoGPT companion app candidate**. Propose a technical pilot first. Do not describe it as an official NanoGPT integration, joint product, or partnership until NanoGPT approves that language.

Recommended collaboration statement:

> NanoForge is an independently developed local companion app for NanoGPT. We would like to validate NanoGPT as its first-class provider across model discovery, streaming, tool calls, usage, pricing, and errors. If the pilot is useful, we can open-source the NanoGPT adapter and compatibility tests while discussing a companion-app listing or deeper integration separately.

## Independent Assessment Handoffs

- Product/demo lane: the UI is visually strong and has a compelling plan → context → edit → verification → review narrative, but demo mode, local-runtime state, and trial delivery are not yet clear enough for an evaluator.
- Technical/release lane: the local architecture has strong foundations and broad automated coverage, but sensitive-file access, child-process environment inheritance, launcher path handling, write authorization, secret redaction, and release reproducibility must be tightened before distributing the app.
- NanoGPT lane: browser-direct model/chat/image touchpoints exist, but the privileged host is not yet wired as a first-class NanoGPT provider and no real NanoGPT contract smoke test has been recorded.

## Must-Do Gate Before Sending a Trial or Repository

### P0.1 Safe demo boundary

- Category: Feature
- Effort: Medium
- Rationale: Demo-generated patches currently receive the same host write callback as live mode. A canned demonstration must never modify the evaluator's real workspace.
- Actions:
  - Disable host writes, shell access, network access, and subagent mutations in scripted demo mode.
  - Provide an immutable sample workspace plus **Reset demo** and `/demo reset`.
  - Label all simulated tool calls, usage, costs, and patches as simulated.
- Acceptance:
  - Applying a demo patch cannot change any file on disk.
  - Reset returns chats, files, costs, and artifacts to the same baseline.

### P0.2 Workspace and credential containment

- Category: Feature
- Effort: High
- Rationale: Workspace-relative reads currently allow sensitive files such as `.env` and private keys, and daemon tasks inherit the host process environment.
- Actions:
  - Add a shared sensitive-path policy covering reads, search, attachments, watchers, writes, terminal context, and model context.
  - Replace child-process `process.env` inheritance with a minimal allowlist and explicitly approved injected variables.
  - Feed configured secrets into audit, error, and diagnostic redaction.
- Acceptance:
  - Tests prove `.env`, SSH keys, cloud credentials, npm tokens, and configured provider secrets cannot leak through files, logs, audits, artifacts, terminals, diagnostics, or subagent messages.

### P0.3 Per-operation reviewed-write authorization

- Category: Feature
- Effort: High
- Rationale: The launcher currently enables workspace writes globally and the SDK exposes a write method without requiring the reviewed file version.
- Actions:
  - Replace the global write switch with a short-lived, file-scoped approval capability.
  - Require expected SHA-256 or mtime on every overwrite.
  - Show workspace root, relative path, diff, and conflict state in the approval UI.
- Acceptance:
  - Unapproved, expired, cross-file, stale-version, and replayed write requests fail closed.
  - The patch is marked applied only after the atomic host write succeeds.

### P0.4 Launcher hardening

- Category: QoL / Security
- Effort: Low
- Rationale: Static serving currently performs unguarded URI decoding and uses a string-prefix confinement check that is unsafe for sibling paths.
- Actions:
  - Return controlled `400` responses for malformed URI and null-byte input.
  - Use `path.relative`-based containment rather than `startsWith`.
  - Convert the current vulnerability-demonstration tests into regression tests against the real server.
- Acceptance:
  - Malformed URI, null-byte, traversal, and sibling-prefix probes never crash the launcher and never escape the distribution root.

### P0.5 Truthful branding, docs, and licensing

- Category: QoL
- Effort: Low
- Rationale: Current public text contains contradictory endpoints, versions, model counts, credential-storage claims, and language that may imply NanoGPT endorsement or ownership.
- Actions:
  - Replace “seamless embedding” and “enterprise-grade/high assurance” with evidence-based descriptions.
  - Remove `Copyright NanoForge / nano-gpt.com` unless NanoGPT explicitly approves it.
  - Add an independent-project disclaimer and decide the repository license before sharing source.
  - Remove hard-coded model counts; display the live catalog count and timestamp.
  - Correct the API-key copy: the key is held in memory while only the base URL is persisted.
  - Align documentation to the real `/agent` endpoint, launcher ports, workspace variables, and supported surfaces.
  - Mark old roadmaps and handoffs as historical rather than current verification.
- Acceptance:
  - README, app copy, SDK guide, technical brief, package metadata, and release notes contain no conflicting capability, privacy, endpoint, ownership, or version claims.

### P0.6 One authoritative version and reproducible trial artifact

- Category: Feature
- Effort: Medium
- Rationale: Source packages report `0.1.0`, the packager defaults to `0.6.0`, and the release directory contains multiple versioned archives. This undermines evaluator confidence.
- Actions:
  - Derive UI, host, SDK, CLI, executable, ZIP, and release notes from one version source.
  - Always build a fresh bundle; pin packaging dependencies.
  - Produce a SHA-256 checksum, dependency/SBOM summary, and concise install/uninstall instructions.
  - Smoke-test on a clean supported Windows VM without Node or pnpm.
  - Sign the binary if distributing beyond a tightly scoped private pilot.
- Acceptance:
  - One archive, one version, one checksum, no generated runtime state or secrets, and a clean-machine launch in under two minutes.

### P0.7 Real NanoGPT golden-path verification

- Category: Feature
- Effort: Medium
- Rationale: Local unit tests mock NanoGPT responses. Compatibility, CORS, catalog fields, image paths, streaming usage, tool calls, errors, and pricing remain externally unverified.
- Actions:
  - Add an opt-in smoke test that uses a secret supplied outside source control.
  - Verify `/models`, one minimal streamed chat, cancellation, usage fields, 401/402/429 handling, and one tool-call-capable model if officially supported.
  - Verify image/video and x402 flows only after NanoGPT confirms their contracts.
  - Record model, endpoint, date, response shape, and pass/fail without logging credentials or full private prompts.
- Acceptance:
  - A fresh packaged build completes the exact live workflow shown in the video.
  - Estimates are clearly separated from provider-reported or billed values.

## QoL Roadmap After the P0 Gate

1. **First-run readiness checklist**
   - Category: QoL
   - Effort: Medium
   - Rationale: Show separate states for NanoGPT API, local runtime, active workspace, catalog freshness, model capability, and execution mode.

2. **Native folder picker**
   - Category: QoL
   - Effort: Medium
   - Rationale: Replace manual path entry with a host-owned native picker, root preview, recent folders, and clear authority warnings.

3. **Dual API/runtime status and diagnostics**
   - Category: QoL
   - Effort: Medium
   - Rationale: “Demo mode” currently does not explain whether the local runtime is online. Add a redacted diagnostic bundle for evaluator support.

4. **Dynamic capability-aware model catalog**
   - Category: Feature
   - Effort: Medium
   - Rationale: Use confirmed catalog fields for modality, tool support, context, pricing units, lifecycle, and availability. Add favorites, recents, task filters, and a catalog timestamp.

5. **NanoGPT coding presets**
   - Category: QoL
   - Effort: Medium
   - Rationale: Offer fast edit, deep review, large-context analysis, and swarm coordinator presets only for models with verified capabilities.

6. **Shareable run report**
   - Category: Feature
   - Effort: Medium
   - Rationale: Export a partner-friendly bundle containing the task, model, timing, token/cost source, approved diff, verification result, and redacted diagnostics.

7. **Resilient provider recovery**
   - Category: QoL
   - Effort: Medium
   - Rationale: Give useful recovery actions for 401, 402, 429, unavailable models, stale catalogs, CORS failures, and transient provider errors.

8. **Swarm demonstration preset**
   - Category: Feature
   - Effort: Medium
   - Rationale: `/swarm demo` should launch a clearly labelled explorer → implementer → verifier workflow with visible budgets, permissions, messages, and final handoff.

9. **Useful empty states**
   - Category: QoL
   - Effort: Low
   - Rationale: Every top-bar control should open helpful content, explain prerequisites, or be disabled. Empty Artifacts and inactive host-only panels must not appear broken.

10. **First-class host-routed NanoGPT provider**
    - Category: Feature
    - Effort: High
    - Rationale: Move live coding execution onto the privileged provider/agent path so tools, approvals, retries, usage, routing, and audits share one authoritative runtime.

## Deferred Features

- Hosted multi-user trial — High effort. Do not expose the local host directly; a hosted version requires per-user containers, strong authentication, TLS, quotas, rate limits, retention controls, and process/network isolation.
- Team/cloud synchronization — High effort. Wait until the local companion workflow and collaboration model are validated.
- Broad marketplace/plugin expansion — Medium/High effort. It would dilute the NanoGPT evaluation unless tied to a specific pilot need.

## Presentation Package

Send four concise artifacts:

1. A 3–5 minute demo video using a disposable sample workspace and a verified live NanoGPT request.
2. A private repository or one checksummed Windows pilot package, depending on the agreed license.
3. A two-page technical overview covering React workbench, local Fastify host, shared protocol/core/SDK, security boundary, and known limitations.
4. A one-paragraph collaboration proposal plus focused questions for NanoGPT.

Do not send the current README or existing release archives unchanged.

## Demo Flow

1. **0:00–0:25 — Positioning:** independent local-first companion for reviewable coding with NanoGPT.
2. **0:25–0:55 — Readiness:** show live NanoGPT API, connected local runtime, active sample workspace, and fresh catalog.
3. **0:55–1:25 — Context:** choose a model, open one file, and attach workspace context.
4. **1:25–2:35 — Agent loop:** run one bounded task; show plan, reads, tool approval, streamed output, and verification.
5. **2:35–3:20 — Review:** inspect the diff and apply it only to the disposable sample workspace.
6. **3:20–4:10 — Differentiator:** run the swarm preset and show role boundaries, budgets, mail, and verifier handoff.
7. **4:10–4:40 — Evidence:** show cost/usage source, run report, tests, and the explicit known-limitations panel.
8. **4:40–5:00 — Ask:** request a companion-app technical pilot and NanoGPT API-contract guidance.

## Questions for NanoGPT

- Which model, streaming, tool-call, image/video, and error contracts are officially supported?
- What are the authoritative capability, context, availability, lifecycle, and pricing fields?
- Is browser-direct CORS an intended integration path, or should companion apps use a local/backend proxy?
- Is scoped OAuth/device authorization planned, or should users continue to paste API keys?
- What billed-cost, balance, usage, and rate-limit metadata can the UI rely on?
- What exact x402 contract, if any, should companion apps support?
- What branding and trademark language is acceptable?
- Would NanoGPT prefer an open-source provider adapter and conformance suite, a companion-app listing, or a broader pilot?

## Recommended Sequence

- Wave A — Safety and truthfulness: P0.1–P0.5.
- Wave B — Live compatibility and distribution: P0.6–P0.7.
- Wave C — Demo polish: readiness checklist, native picker, diagnostics, dynamic catalog, useful empty states, and swarm preset.
- Wave D — Partnership-driven engineering: host-routed provider, billing reconciliation, shared presets, and any jointly selected integration work.

## Release Decision

- Private screen-share/video: proceed after safe demo isolation, truthful copy, and one live NanoGPT verification.
- Private downloadable pilot: proceed only after every P0 item and clean-machine smoke testing passes.
- Public repository: additionally requires a deliberate license, contribution/security policies, current documentation, and secret/dependency review.
- Hosted trial: defer until tenant-isolation architecture exists.
