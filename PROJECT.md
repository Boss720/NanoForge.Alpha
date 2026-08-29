# Project: NanoForge Production-Readiness Roadmap

## Architecture
NanoForge is a high-assurance agentic workspace system comprising:
- **`packages/protocol`**: Isomorphic TypeScript schema package (Zod) defining all wire events, agent planning, subagents, daemons, terminal RPC, voice calls, and tool interactions.
- **`apps/agent-host`**: Fastify WebSocket/HTTP server running local agent orchestration, daemon task supervisor, PTY terminal multiplexer, policy approval engine, and append-only SQLite audit ledger.
- **`src/`**: React 19 web/desktop frontend workbench featuring modular docks (Chat, Monaco Diff Viewer, Terminal, Subagents, Artifacts, Voice HUD).
- **`packages/sdk` (`@nanoforge/sdk`)**: Isomorphic programmatic client SDK for integrating NanoForge capabilities into compatible companion apps and third-party tools, including a possible NanoGPT pilot.

```
┌────────────────────────────────────────────────────────┐
│              Frontend Workbench (src/)                 │
│   (AppLayout, SessionManager, Connection, VoiceHUD)   │
└──────────────────────────┬─────────────────────────────┘
                           │ WebSocket / REST
                           ▼
┌────────────────────────────────────────────────────────┐
│            Agent Host Daemon (apps/agent-host)         │
│  Fastify WS ── Session ── Policy Engine ── PTY/Daemons │
│     │               │                              │   │
│     ▼               ▼                              ▼   ▼   │
│ Audit Ledger    Supervisor                     Subagents│
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│               Shared Protocol & SDK                    │
│   packages/protocol (Zod) ── packages/sdk (@nanoforge) │
└────────────────────────────────────────────────────────┘
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | F1.1 Mermaid XSS Isolation | Sanitize and render Mermaid diagrams in isolated sandbox with DOMPurify | M1 | R1 |
| 2 | F1.2 Secure Credential Storage | In-memory token storage, prevent plain-text API keys in localStorage | M1 | R1 |
| 3 | F1.3 WebSocket Origin & Payload Limits | Strict origin validation and max message size limits on Fastify host | M1 | R1 |
| 4 | F1.4 Path Traversal & Symlink Hardening | Canonical path verification against symlink and double-URL traversal | M1 | R1 |
| 5 | F1.5 Strict Protocol Schemas | Eliminate loose `z.any()`/`z.unknown()` wildcard validations in protocol | M1 | R1 |
| 6 | F1.6 Content Security Policy | Enforce CSP headers to block untrusted script execution | M1 | R1 |
| 7 | F2.1 React Error Boundaries | Component-level error boundaries around chat, docks, subagents, root | M2 | R2 |
| 8 | F2.2 Host Graceful Shutdown | SIGINT/SIGTERM handling to drain connections, save state, stop daemons | M2 | R2 |
| 9 | F2.3 Async Daemon Termination Handling | Prevent unhandled promise rejections on unexpected child process exits | M2 | R2 |
| 10 | F2.4 Actionable `/health` Subsystems | Report active subagents, memory utilization, and daemon task states | M2 | R4 |
| 11 | F2.5 Structured Contextual Logging | JSON/pino structured logging across agent runs and host daemon events | M2 | R4 |
| 12 | F2.6 Configurable Bind Interfaces | Support HOST/PORT/BIND_ADDRESS env vars for containerized environments | M2 | R4 |
| 13 | F2.7 Daemon Limits & Timeouts | Enforce execution timeouts and resource caps on background tasks | M2 | R4 |
| 14 | F3.1 Clean Scratch Artifacts | Remove loose `*.py`, `*.db`, `*.txt` and temporary test files from root | M3 | R3 |
| 15 | F3.2 Reconcile Lockfiles to pnpm | Remove `package-lock.json` and standardize solely on `pnpm` | M3 | R3 |
| 16 | F3.3 Exclude Release Binaries | Update `.gitignore` to prevent tracking of release distribution binaries | M3 | R3 |
| 17 | F3.4 Purge Unused Dependencies | Clean out unused packages from root and workspace package.json files | M3 | R3 |
| 18 | F3.5 Accurate Production Documentation | Replace default template docs with comprehensive production docs | M3 | R3 |
| 19 | F3.6 Prune Obsolete Scripts | Remove one-off, deprecated build scripts from `scripts/` directory | M3 | R3 |
| 20 | F4.1 Modularize `App.tsx` | Break monolithic App.tsx into connection, session, layout, and orchestration | M4 | R5 |
| 21 | F4.2 Code Splitting & Lazy Docks | React lazy/Suspense for Monaco diffs, Terminal dock, Visualizer | M4 | R5 |
| 22 | F4.3 Cryptographic UUIDs | Replace pseudo-random ID generators with `crypto.randomUUID()` | M4 | R5 |
| 23 | F5.1 Programmatic `@nanoforge/sdk` | Implement typed SDK client with connection, streaming, and tool RPCs | M5 | R7 |
| 24 | F5.2 Public API & Integration Docs | Document programmatic API contracts and integration guide for nano-gpt.com | M5 | R7 |
| 25 | F6.1 Standardize CI LTS Runtimes | Ensure Node.js 22 LTS is used consistently across CI workflows | M6 | R6 |
| 26 | F6.2 Automated E2E Test Suite | Automated end-to-end integration tests for WS lifecycle, plans, terminals | M6 | R6 |
| 27 | F6.3 CI Dependency Audit Scanning | Integrate automated `pnpm audit` step in CI workflow pipelines | M6 | R6 |
| 28 | F7.1 100% E2E Acceptance Pass | Execute full opaque-box test suite (Tiers 1-4) across all acceptance criteria | M7 | Acceptance |
| 29 | F7.2 Adversarial Hardening (Tier 5) | White-box stress testing, gap hunting, and edge-case validation | M7 | Acceptance |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Security & Protocol Hardening | F1.1 - F1.6 (Mermaid XSS, credentials, origin/size limits, path traversal, schemas, CSP) | none | DONE |
| M2 | Reliability, Lifecycle & Telemetry | F2.1 - F2.7 (Error boundaries, SIGINT/SIGTERM, daemon handlers, /health, logging, bind, timeouts) | none | DONE |
| M3 | Repository Hygiene & Build Optimization | F3.1 - F3.6 (Artifact cleanup, pnpm lockfile, gitignore, unused deps, docs, scripts) | none | DONE |
| M4 | Frontend Architecture & Modularization | F4.1 - F4.3 (App.tsx refactoring, lazy loading docks, crypto.randomUUID) | M1, M2 | DONE |
| M5 | Programmatic SDK Implementation | F5.1 - F5.2 (@nanoforge/sdk package, typed client, docs for nano-gpt.com) | M1, M2 | DONE |
| M6 | CI/CD Pipeline & E2E Integration | F6.1 - F6.3 (LTS CI workflows, automated E2E suites, pnpm audit) | M1, M2, M3 | DONE |
| M7 | Final E2E Pass & Adversarial Hardening | F7.1 - F7.2 (Pass 100% Tiers 1-4 and Tier 5 adversarial tests) | M1-M6 | DONE |

## Interface Contracts
### Client ↔ Agent Host (WebSocket)
- **Endpoint**: `ws://127.0.0.1:<host-port>/agent?token=<token>` for the browser/launcher path (the port is configured by the launcher; embedded hosts may expose their configured route).
- **Handshake**: Query param `?token=<token>` where token is a 192-bit base64url cryptotoken.
- **Wire Framing**: JSON objects conforming to `clientMessageSchema` and `hostMessageSchema`.
- **Close Codes**: `4401` Unauthorized, `4400` Protocol Violation, `1000` Normal Graceful Close, `1001` Going Away.

### Filesystem & Tool Isolation
- **Path Resolution**: `resolveWorkspacePath(workspaceRoot, targetPath)` decodes and canonicalizes the candidate, resolves symlinks with `fs.realpathSync.native`, and verifies containment using a path-relative boundary check. Throws `SecurityError` if breached.

### Programmatic SDK (`@nanoforge/sdk`)
```typescript
export interface NanoForgeClientOptions {
  hostUrl: string;
  token?: string;
  autoReconnect?: boolean;
}
export class NanoForgeClient {
  constructor(options: NanoForgeClientOptions);
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  createSession(options?: SessionOptions): Promise<AgentSession>;
  streamRun(plan: ExecutionPlan): AsyncIterable<RunEvent>;
}
```

## Code Layout
- `packages/protocol/src/`: Protocol schema definitions (Zod), wire formats, command schemas.
- `packages/sdk/src/`: Programmatic SDK client implementation (`@nanoforge/sdk`).
- `apps/agent-host/src/`: Fastify agent server, daemon manager, policy engine, audit ledger, runner.
- `src/`: React frontend workbench (modularized components, hooks, services, docks).
- `tests/e2e/`: Requirement-driven end-to-end integration test suites across Tiers 1-4.
