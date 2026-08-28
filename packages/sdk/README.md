# @nanoforge/sdk

`@nanoforge/sdk` is the experimental TypeScript client for a NanoForge agent host. It is a local control-plane SDK, not an official NanoGPT SDK and not the browser-direct NanoGPT API integration.

## Workspace use

This package is part of the NanoForge monorepo. No published package or release artifact is asserted here. From the repository root:

```powershell
pnpm test:sdk
pnpm typecheck:sdk
```

## Quickstart

Start a local host and copy the single-use token printed at startup. Then connect with the canonical `/agent` endpoint:

```ts
import { NanoForgeClient } from "@nanoforge/sdk";

const client = new NanoForgeClient({
  hostUrl: "ws://127.0.0.1:4040/agent",
  token: process.env.NANOFORGE_HOST_TOKEN,
  autoReconnect: false,
});

await client.connect();
const session = await client.createSession({ title: "Local evaluation" });

for await (const event of session.streamRun({
  id: "plan-1",
  goal: "Inspect a disposable workspace",
  steps: [{ id: "inspect", title: "Read-only inspection", action: "inspect" }],
})) {
  console.log(event.type, event.state ?? event.detail ?? "");
}

await client.disconnect();
```

The host also registers `/ws`. Tokens are consumed during authentication, so automatic reconnect requires a fresh token provisioning flow.

## Available surfaces

The client exposes connection/ping, session and plan streaming, run pause/resume/cancel, tool approval responses, workspace read/search/stat/status operations, and host RPC methods for subagents, tasks, schedules, and memory. `writeFile` is available but is subject to host-side write authorization and expected-version checks.

## NanoGPT boundary

The browser workbench currently calls NanoGPT directly at `https://nano-gpt.com/api/v1` for model discovery and streaming chat. This SDK does not claim to route that traffic through the host, does not provide hosted tenancy, and does not establish official NanoGPT affiliation. A first-class NanoGPT host provider and live contract suite remain proposed collaboration work.

## License and release status

The package is currently maintained as a private workspace component. Confirm licensing, publication, versioning, and compatibility guarantees before distributing it outside the repository.
