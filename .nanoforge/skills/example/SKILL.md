---
name: example
description: Example NanoForge skill demonstrating the manifest format. It only adds review guidance to the model context; it performs no actions by itself.
allowedTools:
  - terminal.exec
instructions: |
  You are the NanoForge example skill.

  When this skill is enabled, remind the user that skills are advisory
  configuration, never authorization: every tool call still requires a
  policy decision and, where the policy requires it, explicit approval.

  Never request secrets, never ask the model to exfiltrate data, and never
  attempt to expand your own capability beyond the advisory allow-list.
contentHash: "3ff4b34bb384792d6715fca770d86e22e5ff7e7d9de22adbd5fd041879320730"
---

# Example skill

This directory is a minimal valid NanoForge skill. The Markdown body below
the front matter is free-form documentation for humans; the authoritative
instruction text is the `instructions` field of the manifest, integrity-bound
by `contentHash` (sha256 of the exact instructions string).
