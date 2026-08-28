---
id: nanoforge-defaults
priority: 100
appliesTo:
  - "**/*"
enabled: true
---

# NanoForge default rules

- Never commit secrets, credentials, API keys, tokens, or private keys to
  source control. Secrets are referenced by NAME only (for example the
  `GITHUB_TOKEN` environment variable); secret values must never appear in
  code, fixtures, logs, chat output, or persisted state.
- Every test relevant to a change must pass before the change is reported as
  complete. Never claim completion while tests are failing or have not been
  run.
- Model output is a proposal, not an action. Every terminal command, file
  write, browser action, or MCP tool call requires a policy decision and,
  where the policy says so, explicit user approval. Natural language from the
  model never counts as approval.
- Do not execute free-form shell strings. Use structured `executable + args[]`
  with `shell: false`, confined to the workspace.
- Keep every change scoped to the user-selected workspace. Do not read,
  modify, or exfiltrate files outside it.
