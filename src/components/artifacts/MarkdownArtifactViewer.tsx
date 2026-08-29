import { useState, Fragment, type ReactNode } from "react";
import { Copy, Check, Info, AlertTriangle, AlertCircle, Lightbulb } from "lucide-react";
import { HighlightedCode } from "@/components/RichText";
import { Button } from "@/components/ui/button";

interface MarkdownArtifactViewerProps {
  content: string;
  title?: string;
  className?: string;
}

export function MarkdownArtifactViewer({
  content,
  title = "Document",
  className = "",
}: MarkdownArtifactViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-md border border-border bg-card ${className}`}>
      {/* Header Bar */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-secondary/40 px-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] font-medium text-foreground">{title}</span>
          <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            Markdown
          </span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>

      {/* Document Content */}
      <div className="scrollbar-thin flex-1 overflow-auto bg-background p-5 text-[13px] leading-relaxed text-foreground">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  );
}

function MarkdownRenderer({ content }: { content: string }) {
  const sections = parseMarkdownSections(content);

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      {sections.map((section, idx) => (
        <Fragment key={idx}>{renderSection(section, idx)}</Fragment>
      ))}
    </div>
  );
}

type Section =
  | { type: "h1" | "h2" | "h3" | "h4"; text: string }
  | { type: "alert"; alertType: "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION"; text: string }
  | { type: "code"; lang?: string; code: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "list"; items: Array<{ checked?: boolean; text: string }> }
  | { type: "p"; text: string }
  | { type: "hr" };

function parseMarkdownSections(md: string): Section[] {
  const lines = md.split("\n");
  const sections: Section[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Horizontal rule
    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      sections.push({ type: "hr" });
      i++;
      continue;
    }

    // Headings
    if (trimmed.startsWith("# ")) {
      sections.push({ type: "h1", text: trimmed.slice(2) });
      i++;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      sections.push({ type: "h2", text: trimmed.slice(3) });
      i++;
      continue;
    }
    if (trimmed.startsWith("### ")) {
      sections.push({ type: "h3", text: trimmed.slice(4) });
      i++;
      continue;
    }
    if (trimmed.startsWith("#### ")) {
      sections.push({ type: "h4", text: trimmed.slice(5) });
      i++;
      continue;
    }

    // Code blocks
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      sections.push({ type: "code", lang, code: codeLines.join("\n") });
      i++; // skip closing ```
      continue;
    }

    // GitHub Alerts (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION])
    const alertMatch = trimmed.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
    if (alertMatch) {
      const alertType = alertMatch[1].toUpperCase() as "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";
      const alertLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        alertLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      sections.push({ type: "alert", alertType, text: alertLines.join("\n") });
      continue;
    }

    // Tables
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const headers = trimmed
        .slice(1, -1)
        .split("|")
        .map((h) => h.trim());
      i++;
      // check separator line
      if (i < lines.length && lines[i].includes("---")) {
        i++; // skip separator
        const rows: string[][] = [];
        while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
          const cols = lines[i]
            .trim()
            .slice(1, -1)
            .split("|")
            .map((c) => c.trim());
          rows.push(cols);
          i++;
        }
        sections.push({ type: "table", headers, rows });
        continue;
      }
    }

    // Lists (including task checkboxes)
    if (/^[-*]\s+(\[[ xX]\])?/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const items: Array<{ checked?: boolean; text: string }> = [];
      while (i < lines.length && (/^[-*]\s+/.test(lines[i].trim()) || /^\d+\.\s+/.test(lines[i].trim()))) {
        const itemLine = lines[i].trim();
        const taskMatch = itemLine.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
        if (taskMatch) {
          items.push({ checked: taskMatch[1].toLowerCase() === "x", text: taskMatch[2] });
        } else {
          const text = itemLine.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "");
          items.push({ text });
        }
        i++;
      }
      sections.push({ type: "list", items });
      continue;
    }

    // Paragraph
    sections.push({ type: "p", text: line });
    i++;
  }

  return sections;
}

function renderSection(section: Section, key: number): ReactNode {
  switch (section.type) {
    case "h1":
      return <h1 key={key} className="border-b border-border/60 pb-2 text-xl font-bold tracking-tight text-foreground">{inlineText(section.text)}</h1>;
    case "h2":
      return <h2 key={key} className="border-b border-border/40 pb-1.5 pt-3 text-lg font-semibold tracking-tight text-foreground">{inlineText(section.text)}</h2>;
    case "h3":
      return <h3 key={key} className="pt-2 text-base font-semibold text-foreground">{inlineText(section.text)}</h3>;
    case "h4":
      return <h4 key={key} className="pt-1 text-sm font-semibold text-foreground">{inlineText(section.text)}</h4>;
    case "hr":
      return <hr key={key} className="my-4 border-border/60" />;
    case "code":
      return (
        <div key={key} className="overflow-hidden rounded-md border border-border bg-black/40">
          {section.lang && (
            <div className="flex h-6 items-center justify-between border-b border-border/40 bg-secondary/30 px-3 font-mono text-[10px] text-muted-foreground">
              <span>{section.lang}</span>
            </div>
          )}
          <pre className="scrollbar-thin overflow-x-auto p-3 font-mono text-[12px] leading-5 text-foreground/90">
            <code>
              <HighlightedCode code={section.code} lang={section.lang} />
            </code>
          </pre>
        </div>
      );
    case "alert": {
      const styles = {
        NOTE: { bg: "bg-blue-500/10 border-blue-500/30 text-blue-300", icon: Info, label: "Note" },
        TIP: { bg: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300", icon: Lightbulb, label: "Tip" },
        IMPORTANT: { bg: "bg-purple-500/10 border-purple-500/30 text-purple-300", icon: AlertCircle, label: "Important" },
        WARNING: { bg: "bg-amber-500/10 border-amber-500/30 text-amber-300", icon: AlertTriangle, label: "Warning" },
        CAUTION: { bg: "bg-rose-500/10 border-rose-500/30 text-rose-300", icon: AlertCircle, label: "Caution" },
      }[section.alertType];
      const Icon = styles.icon;
      return (
        <div key={key} className={`rounded-md border p-3 ${styles.bg}`}>
          <div className="flex items-center gap-1.5 font-semibold text-[12px]">
            <Icon className="h-4 w-4" />
            <span>{styles.label}</span>
          </div>
          <div className="mt-1 text-[12px] leading-relaxed opacity-90">
            {section.text.split("\n").map((l, idx) => (
              <p key={idx}>{inlineText(l)}</p>
            ))}
          </div>
        </div>
      );
    }
    case "table":
      return (
        <div key={key} className="overflow-x-auto rounded border border-border/60">
          <table className="w-full text-left font-mono text-[12px]">
            <thead className="border-b border-border/60 bg-secondary/40 font-semibold">
              <tr>
                {section.headers.map((h, i) => (
                  <th key={i} className="px-3 py-2">{inlineText(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {section.rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-secondary/10">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-1.5">{inlineText(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "list":
      return (
        <ul key={key} className="space-y-1 pl-1">
          {section.items.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2">
              {item.checked !== undefined ? (
                <span className={`mt-0.5 font-mono text-[11px] ${item.checked ? "text-primary font-bold" : "text-muted-foreground"}`}>
                  {item.checked ? "[x]" : "[ ]"}
                </span>
              ) : (
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
              )}
              <span className={item.checked ? "text-muted-foreground line-through" : ""}>
                {inlineText(item.text)}
              </span>
            </li>
          ))}
        </ul>
      );
    case "p":
      return <p key={key} className="text-foreground/90">{inlineText(section.text)}</p>;
  }
}

function inlineText(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\))/g);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return <code key={i} className="rounded bg-secondary/80 px-1 py-0.5 font-mono text-[11px] text-primary">{p.slice(1, -1)}</code>;
    }
    if (p.startsWith("*") && p.endsWith("*")) {
      return <em key={i} className="italic text-muted-foreground">{p.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}
