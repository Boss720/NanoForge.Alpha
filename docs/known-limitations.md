# Known limitations

This document separates repository evidence from claims that need a NanoGPT pilot or a release artifact.

## NanoGPT compatibility

- The browser code targets `https://nano-gpt.com/api/v1`, `GET /models`, and OpenAI-compatible streamed `POST /chat/completions`. The repository contains mocks and parsing tests, not a recorded live credentialed response.
- CORS, authentication, model availability, model capability metadata, tool calls, usage/billing fields, pricing units, rate limits, cancellation, and provider error behavior require live verification.
- The image path uses `POST /generate-image`, which is not the OpenAI-style image route. Its response shape and availability are not proven here.
- The bundled model list is an offline fallback snapshot. It is not a current model count, availability statement, or pricing guarantee.

## Integration and product scope

- There is no official NanoGPT affiliation, endorsement, partnership, or approved branding language in this repository.
- The browser chat path is direct to the configured API. It is not a seamless NanoGPT embedding and is not routed through the optional host.
- The host contains a generic OpenAI-compatible adapter, but NanoGPT is not a first-class registered provider in the core registry and the browser key is not handed to the host automatically.
- There is no hosted tenancy, multi-user account layer, remote workspace isolation, OAuth/device authorization flow, or production secret-management service.
- The SDK is a private workspace component with repository tests; no published package, semantic-version compatibility promise, or external support commitment is claimed.

## Security and writes

- API keys are kept in browser memory for direct requests. The loader scrubs legacy persisted `apiKey` values, but this is not secure-vault storage; a compromised browser context can access an active key.
- Browser local storage still persists application data and non-secret settings. Clear the profile or use a disposable browser profile after an evaluation.
- The host binds to loopback by default and uses one-use WebSocket tokens. A token cannot be reused for automatic reconnect without a fresh token flow.
- Host writes are disabled by default and are only enabled through an explicit host configuration. The review/approval model and broader filesystem, process, environment, and network threat model still need a distribution-grade audit.
- Do not expose the host to a public interface, use a real production workspace, or place provider secrets in screenshots, URLs, source, or logs.

## Release and version provenance

- The root, host, and SDK manifests currently report `0.1.0`; this is source version metadata, not proof of a released product.
- The working tree contains versioned files under `release/` with different historical-looking names. No one of those archives is designated or verified as the current NanoForge release in this documentation lane.
- A credible downloadable pilot still needs one version source, a fresh build, checksum/provenance, clean-machine smoke testing, and a supported install/uninstall story.

## What still needs external evidence

Before making a NanoGPT compatibility or shipping claim, obtain:

1. NanoGPT test credentials or an approved sandbox, plus permission to run the exact `/models` and streamed chat checks.
2. An agreed contract for capabilities, tool calls, images, usage, pricing, billing, errors, and CORS/authentication.
3. If distributing a pilot, a fresh release artifact and a clean supported-machine launch record.
4. NanoGPT’s approved branding/affiliation language and preferred collaboration channel.
