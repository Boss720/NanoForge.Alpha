# NanoForge

### A local-first coding workbench for NanoGPT experimentation

NanoForge is an independently developed desktop and browser workbench for exploring how NanoGPT can fit into a private, local coding workflow. Open a folder, ask for help, inspect the proposed work, and apply changes only after an explicit review.

It is an early technical preview—not an official NanoGPT product, partnership, or embedded NanoGPT experience.

![NanoForge console](docs/assets/nanoforge-console-home.png)

![NanoForge orchestration view](docs/assets/nanoforge-swarm-control-plane.png)

## The experience

NanoForge is designed around a simple loop:

1. **Connect** — use Demo mode for a credential-free walkthrough, or connect the browser UI to NanoGPT’s OpenAI-compatible API.
2. **Open a folder** — on Windows, choose a local directory through the native folder picker. The folder stays on your machine.
3. **Work with context** — browse workspace files, search, attach relevant files, and keep the conversation and workspace state together.
4. **Review the result** — inspect the response, plan, diff-style output, and verification evidence before changing anything.
5. **Approve deliberately** — local files are read-only by default. A reviewed write requires a separate, one-time host approval bound to the exact request and expected file version.

The goal is a coding companion that feels useful immediately while keeping the local machine, provider boundary, and write path understandable.

## Highlights

| Capability | What it provides |
| --- | --- |
| Browser and Windows desktop modes | Use the lightweight browser workbench or a native Electron shell with a folder picker and private loopback services. |
| NanoGPT-compatible chat path | Connect directly to `https://nano-gpt.com/api/v1` for model discovery and streamed OpenAI-style chat responses. |
| Demo mode | Walk through the product without a provider key. Demo output should always be presented as simulated. |
| Local workspace context | Browse, search, attach, and revisit a selected folder without uploading the folder to NanoForge. |
| Review-first changes | See proposed work before applying it; writes are disabled by default and require an explicit one-time approval. |
| Conflict-aware writes | Approved writes are checked against the expected SHA-256 file version before they are applied. |
| Local agent host | Optional loopback Fastify/WebSocket control plane for workspace, run, tool, and capability flows. |
| Typed foundations | Shared protocol, provider/core abstractions, SDK types, lifecycle events, cancellation, tasks, and subagent contracts. |
| Auditable boundaries | Loopback binding, single-use WebSocket tokens, schema validation, capability decisions, and redacted logging are part of the host design. |

## The 5-minute workflow

The intended owner or developer journey is:

1. Start in Demo mode or connect a NanoGPT-compatible API key.
2. Open a disposable sample workspace.
3. Ask a bounded coding question and attach only the files needed for context.
4. Review the response, proposed plan, and diff-style output.
5. Enable reviewed writes only when needed, approve the exact change once, and run verification.

## Start in the browser

### Requirements

- Windows, macOS, or Linux for the browser workflow.
- Node.js 20 or newer.
- pnpm 9.15.4.
- A modern browser.
- A NanoGPT API key only for a live provider check; Demo mode does not require credentials.

### Install and run

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`.

For a credential-free walkthrough, choose **Demo mode**. For a live check, use the Connect UI, keep the base URL at `https://nano-gpt.com/api/v1`, enter a key, validate the connection, and select a returned model.

Keep provider keys out of source control, screenshots, URLs, recordings, and logs.

## Use the Windows desktop shell

The desktop shell is the preferred way to work with a local folder. It opens the native Windows folder picker and starts a private loopback UI/host session for the selected workspace.

```powershell
pnpm desktop:dev
```

Then:

1. Choose **Open folder**.
2. Select a non-sensitive sample or development folder.
3. Browse and search the workspace, attach files, and continue the conversation.
4. Open **Settings → Local Workspace** if you want to test reviewed writes.
5. Enable reviewed writes for the current session and approve each exact write prompt individually.

The default behavior is read-only. Cancelling an approval leaves the folder unchanged. The desktop shell does not auto-approve writes, and selecting a folder does not expose it to the network.

## Provider boundary: what is proven and what is not

The current browser integration is a direct OpenAI-compatible API path:

- `GET https://nano-gpt.com/api/v1/models`
- `POST https://nano-gpt.com/api/v1/chat/completions` with `stream: true`
- `POST .../generate-image` exists in the code, but its live response contract is not yet verified

The optional local host does not automatically receive the browser’s NanoGPT key or route browser chat through NanoGPT. Its provider adapter is generic and must be configured separately. NanoForge does not claim official NanoGPT affiliation, seamless embedding, hosted tenancy, or a first-class host-routed NanoGPT provider.

For a NanoGPT owner preview, the most useful next step is a focused pilot around model discovery, streaming, authentication, CORS, capabilities, usage fields, pricing units, errors, and image behavior.

## Local-first security model

- The host binds to loopback by default.
- WebSocket sessions use registered, single-use tokens.
- Workspace operations are confined to a validated local root.
- Writes fail closed unless explicitly enabled.
- Each reviewed write requires a host-issued, exact, one-time approval.
- The expected file version is checked before a write is applied.
- Browser API keys remain in live application memory; this is not secure-vault storage.
- Local chat, workspace, and usage data may persist in the browser profile. Treat an active profile as sensitive.

Do not expose the host on a public interface, use a real production workspace during evaluation, or place provider secrets in screenshots or logs. Read/search/terminal/subagent behavior still needs broader distribution-grade threat-model evaluation.

## Run the optional local host

The host is useful for protocol and local control-plane development. It chooses an ephemeral port unless `PORT` is set and prints a single-use token at startup.

```powershell
$env:PORT = "4040"
pnpm start:host
```

The canonical endpoint is:

```text
ws://127.0.0.1:4040/agent?token=<single-use-token>
```

`/ws` remains registered for compatibility. Keep the host on loopback.

## Build the Windows installer

Build the browser assets, packaged host, and NSIS installer:

```powershell
pnpm desktop:build
```

The installer is a local build artifact and is not committed to the repository. A production distribution should additionally have a clean-machine launch/install test, checksums and provenance, code signing, and a supported uninstall story.

## Architecture

```text
Windows Electron shell
  ├─ native folder picker
  ├─ private loopback UI session
  └─ private loopback agent-host session

React/Vite browser UI
  ├─ direct HTTPS → NanoGPT-compatible API
  │                  /models
  │                  /chat/completions
  └─ optional WebSocket → local agent host
                          /agent?token=...
                              ├─ workspace broker
                              ├─ capability approvals
                              ├─ runs, tools, and tasks
                              └─ provider/core integrations

Shared packages
  ├─ protocol — wire schemas and lifecycle contracts
  ├─ core     — provider and agent-loop foundations
  └─ sdk      — typed local-host client
```

## Repository map

| Area | Location | Purpose |
| --- | --- | --- |
| Browser application | `src/` | React UI, chat flow, Demo mode, persistence, workspace and review surfaces. |
| NanoGPT browser client | `src/lib/nanogpt.ts` | Direct model, chat-stream, and image request code. |
| Windows shell | `desktop/main.cjs` | Native window, folder picker, loopback session, and host lifecycle. |
| Local host | `apps/agent-host/` | Fastify/WebSocket control plane, workspace runtime, approvals, runs, and audit surfaces. |
| Protocol | `packages/protocol/` | Typed commands, events, streams, tasks, tools, and subagent contracts. |
| Core | `packages/core/` | Provider adapters and agent-loop building blocks. |
| SDK | `packages/sdk/` | Programmatic client for the local host protocol. |
| Launcher | `scripts/nanoforge-launcher.cjs` | Local UI/host startup, ports, tokens, and workspace switching. |
| Documentation | `docs/` | Architecture, security, plans, SDK notes, assessment, and known limitations. |

## Verification

Run the checks relevant to your change:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:all
pnpm test:sdk
pnpm test:host
pnpm build
pnpm desktop:build
```

These checks validate repository behavior, mocked/provider-adapter contracts, and packaging paths. They do not by themselves prove live NanoGPT compatibility. Keep any live provider test opt-in and record no secret values.


## Collaboration

The project is looking for focused NanoGPT feedback on:

- model catalog and capability metadata;
- streamed chat behavior and cancellation;
- authentication and CORS expectations;
- tool, usage, pricing, and error contracts;
- image-generation response behavior; and
- the right boundary for a local companion integration.

A useful first collaboration milestone would be a credential-free adapter contract-test suite that both sides can run without exchanging secrets.

## License and branding

The repository does not make an approved NanoGPT licensing, ownership, affiliation, or branding claim.
