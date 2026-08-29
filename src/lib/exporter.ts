import type { Patch, Session } from "@/types";

/**
 * Transcript export (roadmap Task 3.3): serialize a session to Markdown.
 *
 * - Each message becomes a `## Role` section; edit-verify auto-turns are
 *   annotated with `(auto-verify)`.
 * - Attached patches render as ```diff fences whose first line is
 *   `--- file: <path>` — the same convention `extractPatch` parses, so
 *   exported transcripts round-trip conceptually with live agent output.
 * - Per-message usage, when present, is appended as an italic footer line.
 */

function patchToDiff(patch: Patch): string[] {
  return [
    `--- file: ${patch.file}`,
    ...patch.lines.map((l) => `${l.type === "add" ? "+" : l.type === "del" ? "-" : " "}${l.text}`),
  ];
}

const ROLE_LABEL: Record<string, string> = { user: "User", assistant: "Assistant", system: "System" };

export function sessionToMarkdown(session: Session): string {
  const out: string[] = [
    `# ${session.title}`,
    "",
    `- model: \`${session.model}\``,
    `- created: ${new Date(session.createdAt).toISOString()}`,
    `- messages: ${session.messages.length}`,
    "",
  ];

  for (const m of session.messages) {
    const role = ROLE_LABEL[m.role] ?? m.role;
    const auto = m.auto ? " _(auto-verify)_" : "";
    out.push(`## ${role} — ${new Date(m.ts).toISOString()}${auto}`, "");
    if (m.content) out.push(m.content, "");
    if (m.patch) {
      out.push(`**Patch \`${m.patch.file}\` — ${m.patch.status}**`, "", "```diff", ...patchToDiff(m.patch), "```", "");
    }
    if (m.usage) {
      out.push(
        `_usage: ${m.usage.input.toLocaleString("en-US")} in / ${m.usage.output.toLocaleString("en-US")} out · ≈ $${m.usage.costUsd.toFixed(5)}_`,
        "",
      );
    }
  }
  return out.join("\n");
}

/** Filesystem-safe download name derived from the session title. */
export function sessionFileName(session: Session): string {
  const slug = session.title
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "nanoforge-session"}.md`;
}

/** Browser-side download helper — kept out of the pure function for testability. */
export function downloadSessionMarkdown(session: Session): void {
  const blob = new Blob([sessionToMarkdown(session)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sessionFileName(session);
  a.click();
  URL.revokeObjectURL(url);
}
