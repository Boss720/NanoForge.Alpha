# NanoForge technical overview

## Purpose and status

NanoForge is an independently developed local-first coding workbench candidate. It is suitable for a controlled technical evaluation with a disposable workspace. It should be presented as a companion-app candidate, not as an official NanoGPT integration, a hosted service, or a finished release.

The repository currently has two related but separate runtime paths:

1. The browser-direct NanoGPT path is implemented in `src/lib/nanogpt.ts` and used by the React workbench.
2. The local host path is an optional Fastify/WebSocket control plane with its own generic OpenAI-compatible adapter and SDK.

No recorded live credentialed run currently joins those paths end to end.

## Runtime boundaries

```text
                           +------------------------------+
                           | NanoGPT-compatible API        |
                           | GET /models                   |
                           | POST /chat/completions (SSE)  |
                           +--------------^---------------+
                                          | browser fetch
                                          |
                         +----------------+----------------+
                         | React/Vite workbench           |
                         | src/                            |
                         +----------------+----------------+
                                          | optional loopback WebSocket
                                          v
                         +----------------+----------------+
                         | Fastify agent host             |
                         | apps/agent-host                 |
                         +----------------+----------------+
                                          |
                                          v
                  +------------------------------------------------+
                  | protocol · core · SDK · workspace/tools/runs   |
                  +------------------------------------------------+
```

The browser chat client sends a Bearer key directly to the configured base URL. It fetches models from `/models` and streams `/chat/completions` responses using `data:` frames and `[DONE]`; usage is read from OpenAI-style `prompt_tokens` and `completion_tokens` fields when supplied. The base URL defaults to `https://nano-gpt.com/api/v1`.

The host binds to `127.0.0.1` by default and exposes `/health`, `/agent`, and `/ws`. WebSocket authentication uses registered 192-bit base64url tokens that are consumed once. The SDK defaults a root URL to `/agent` when given only a host URL. The host’s generic adapter can use a configured base URL and key, but the browser connection does not configure it automatically.

## Components

| Component | Evidence in repository | Evaluation status |
| --- | --- | --- |
| Browser API client | `src/lib/nanogpt.ts` | Code and mocked tests exist; live NanoGPT behavior is unverified. |
| React workbench | `src/`, `src/App.tsx` | Local UI and demo/live orchestration are present. |
| Host runtime | `apps/agent-host/src/server.ts`, `session.ts` | Loopback host, schema validation, workspace and run surfaces are present; deployment hardening is not claimed. |
| Host provider adapter | `apps/agent-host/src/providers/openaiCompatible.ts` | Generic OpenAI-compatible adapter and mocked tests exist; no first-class NanoGPT registration. |
| Shared core | `packages/protocol/`, `packages/core/` | Protocol and provider/agent abstractions with repository tests. |
| SDK | `packages/sdk/` | Typed local-host client with mocked WebSocket tests; no published SDK claim. |

## Security and write model

The browser connection key is retained in live application state for the request path. Connection loading strips legacy persisted `apiKey` values; local storage still contains non-secret preferences and application data such as the base URL, chats, files, and usage. This is not equivalent to OS keychain or vault storage.

The host validates the workspace root, applies loopback/origin/token checks to WebSockets, validates protocol messages, and rejects workspace writes unless `allowWorkspaceWrites` is enabled. Any technical pilot should use an isolated workspace, keep host/provider secrets in the host process configuration, and inspect logs and artifacts for redaction before wider distribution.

## Verification model

Repository checks cover TypeScript, unit/component/host/SDK behavior, and mocked provider contracts. They do not establish NanoGPT account authentication, CORS policy, model availability, pricing semantics, usage billing, image response shape, rate-limit behavior, or hosted tenancy. Those require an opt-in test with NanoGPT-provided credentials and an agreed test procedure.

## Suggested integration seam

The smallest useful collaboration seam is a provider contract suite around:

- model listing and capability metadata;
- streamed chat deltas, termination, usage, and cancellation;
- tool-call behavior, if supported by the selected model;
- authentication, CORS, 401/402/429/5xx responses, and retry semantics; and
- pricing/usage fields that can be labelled as provider-reported rather than estimated.

Once that contract is agreed, the same adapter can be evaluated in the browser-direct path and, separately, as a host-routed provider with explicit secret ownership and approval semantics.
