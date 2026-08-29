# E2E Test Infra: NanoForge Production-Readiness

## Test Philosophy
- Opaque-box, requirement-driven testing based strictly on `ORIGINAL_REQUEST.md`.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise Combinations + Real-World Workload Testing.
- Zero dependency on internal private implementation details; tests interact through public HTTP/WS, CLI, SDK, and rendered UI endpoints.

## Feature Inventory & Test Mapping
| # | Feature | Requirement | Tier 1 (Coverage) | Tier 2 (Boundaries) | Tier 3 (Interactions) |
|---|---------|-------------|:-----------------:|:-------------------:|:---------------------:|
| 1 | Mermaid XSS Isolation | R1 §13 | ≥5 cases | ≥5 cases | ✓ |
| 2 | Credential Storage Security | R1 §14 | ≥5 cases | ≥5 cases | ✓ |
| 3 | WS Origin & Payload Limits | R1 §15 | ≥5 cases | ≥5 cases | ✓ |
| 4 | Path Traversal & Symlink Hardening | R1 §16 | ≥5 cases | ≥5 cases | ✓ |
| 5 | Strict Protocol Schemas | R1 §17 | ≥5 cases | ≥5 cases | ✓ |
| 6 | Content Security Policy | R1 §18 | ≥5 cases | ≥5 cases | ✓ |
| 7 | React Error Boundaries | R2 §21 | ≥5 cases | ≥5 cases | ✓ |
| 8 | Host Graceful Termination | R2 §22 | ≥5 cases | ≥5 cases | ✓ |
| 9 | Async Daemon Handling | R2 §23 | ≥5 cases | ≥5 cases | ✓ |
| 10 | Actionable /health Endpoint | R4 §34 | ≥5 cases | ≥5 cases | ✓ |
| 11 | Structured Contextual Logging | R4 §35 | ≥5 cases | ≥5 cases | ✓ |
| 12 | Bind Interface Config | R4 §36 | ≥5 cases | ≥5 cases | ✓ |
| 13 | Daemon Limits & Timeouts | R4 §37 | ≥5 cases | ≥5 cases | ✓ |
| 14 | Monolithic App.tsx Modularization | R5 §40 | ≥5 cases | ≥5 cases | ✓ |
| 15 | Lazy Loading Docks | R5 §41 | ≥5 cases | ≥5 cases | ✓ |
| 16 | Cryptographic UUIDs | R5 §42 | ≥5 cases | ≥5 cases | ✓ |
| 17 | Programmatic @nanoforge/sdk | R7 §50 | ≥5 cases | ≥5 cases | ✓ |

## Test Architecture
- **Test Runner**: Vitest (`npx vitest run tests/e2e/`) and npm test scripts (`npm run test:protocol`, `npm run test:host`, `npm test`).
- **Test Case Format**: TypeScript test suites with assertions on exit codes, HTTP responses, WebSocket error codes, and DOM snapshot trees.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Production WS Connection Lifecycle & Auth | WS Origin, Token Auth, Payload Limits, Health | High |
| 2 | Malicious Mermaid Diagram Rendering Attempt | Mermaid XSS, DOMPurify, CSP, Error Boundary | High |
| 3 | Malicious Path Traversal / Symlink Exploit Run | Path Traversal, Canonical Check, Policy Gate | High |
| 4 | Host Process Termination During Active Daemon Run | SIGINT/SIGTERM, Connection Drain, Daemon Cleanup | High |
| 5 | Full Programmatic SDK Session Streaming | @nanoforge/sdk, Typed Events, Run Coordinator | High |

## Coverage Thresholds
- Tier 1: ≥5 per feature
- Tier 2: ≥5 per feature (boundary/adversarial)
- Tier 3: Pairwise combinations across all security, lifecycle, and SDK interfaces
- Tier 4: ≥5 end-to-end real-world workload scenarios
- Tier 5: White-box adversarial coverage hardening
