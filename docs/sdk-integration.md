# Local SDK integration (experimental)

`@nanoforge/sdk` is a typed client for a NanoForge agent host running on the same machine or on a separately managed trusted network. It is not the browser-direct NanoGPT API client, and this guide does not claim that NanoForge is officially affiliated with NanoGPT.

## What the SDK connects to

The SDK speaks NanoForge’s WebSocket control protocol:

```text
ws://127.0.0.1:<port>/agent?token=<single-use-token>
```

The host also registers `/ws`, but `/agent` is the documented path. The host accepts one registered token per connection. Because the token is consumed during authentication, do not enable SDK auto-reconnect unless the caller also provisions a fresh token for every reconnect.

The SDK can submit typed plans, consume run events as an `AsyncIterable`, send approval decisions, query workspace metadata/files, and call the host’s subagent/task/memory RPC surfaces. It does not turn the NanoGPT browser connection into a host-routed provider.

## Minimal local-host example

```ts
import { NanoForgeClient } from "@nanoforge/sdk";

const client = new NanoForgeClient({
  hostUrl: "ws://127.0.0.1:4040/agent",
  token: process.env.NANOFORGE_HOST_TOKEN,
  autoReconnect: false,
});

await client.connect();

const session = await client.createSession({
  title: "Disposable evaluation",
  model: "provider-configured-model",
});

for await (const event of session.streamRun({
  id: "evaluation-plan-1",
  goal: "Inspect the sample workspace",
  steps: [
    { id: "inspect", title: "Inspect the sample workspace", action: "read-only inspection" },
  ],
})) {
  console.log(event.type, event.state ?? event.detail ?? "");
}

await client.disconnect();
```

Supply the token through process configuration or an equivalent trusted handoff. Do not put host tokens or provider keys in a browser URL, source file, screenshot, or persistent browser storage.

## Provider relationship

The host contains a generic OpenAI-compatible adapter that can be configured with a base URL and provider key in the host process. The current browser UI does not pass its NanoGPT key into that adapter, and the core provider registry does not register a `nanogpt` provider. A NanoGPT host integration therefore remains a pilot/adaptor task, not an SDK capability claim.

## Workspace writes

`writeFile` is exposed by the SDK, but the host rejects workspace writes unless `allowWorkspaceWrites` is explicitly enabled. A write also carries expected file-version data in the host protocol. Use a disposable workspace and a reviewed diff; the SDK method is not a blanket authorization mechanism.

## Local verification

From the repository root:

```powershell
pnpm test:sdk
pnpm typecheck:sdk
pnpm --filter @nanoforge/sdk lint
```

These checks use test doubles for the WebSocket/provider boundary. They do not prove live NanoGPT compatibility, published package availability, hosted operation, or a stable external SDK contract.
