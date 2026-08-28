import { Fragment, type ReactNode } from "react";
import { detectLang, tokenize, type TokenKind } from "@/lib/syntax";

/** Minimal markdown-lite: fenced code, inline code, bold, headers, lists. */
export function RichText({ text }: { text: string }) {
  const blocks = splitBlocks(text);
  return (
    <div className="space-y-2 text-[13px] leading-relaxed">
      {blocks.map((b, i) =>
        b.kind === "code" ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-md border border-border bg-black/40 p-3 font-mono text-[12px] leading-5 text-foreground/90 scrollbar-thin"
          >
            {b.lang && <div className="micro-label mb-1.5">{b.lang}</div>}
            <code>
              <HighlightedCode code={b.text} lang={b.lang} />
            </code>
          </pre>
        ) : (
          <div key={i} className="space-y-1.5">
            {b.text.split("\n").map((line, j) => (
              <Fragment key={j}>{renderLine(line, j)}</Fragment>
            ))}
          </div>
        ),
      )}
    </div>
  );
}

type Block = { kind: "code" | "text"; text: string; lang?: string };

/**
 * Task 3.3: theme-token-only syntax colors for the hand-rolled tokenizer in
 * `src/lib/syntax.ts`. Keywords use `--primary`, strings the (lighter) accent
 * foreground, comments `--muted-foreground`; plain text inherits.
 */
const TOKEN_CLASS: Record<TokenKind, string | undefined> = {
  keyword: "text-primary",
  string: "text-accent-foreground",
  comment: "italic text-muted-foreground",
  plain: undefined,
};

/** Renders `code` as highlighted spans. Shared by RichText code blocks and the workspace file viewer. */
export function HighlightedCode({ code, lang }: { code: string; lang?: string }) {
  const tokens = tokenize(code, detectLang(lang));
  return (
    <>
      {tokens.map((t, i) =>
        TOKEN_CLASS[t.kind] ? (
          <span key={i} className={TOKEN_CLASS[t.kind]}>
            {t.text}
          </span>
        ) : (
          <Fragment key={i}>{t.text}</Fragment>
        ),
      )}
    </>
  );
}

function splitBlocks(text: string): Block[] {
  const out: Block[] = [];
  const re = /```(\w*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "code", text: m[2].replace(/\n$/, ""), lang: m[1] || undefined });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

function renderLine(line: string, key: number): ReactNode {
  const trimmed = line.trim();
  if (!trimmed) return <div key={key} className="h-1" />;
  if (trimmed.startsWith("### ")) return <h4 key={key} className="pt-1 font-semibold text-foreground">{inline(trimmed.slice(4))}</h4>;
  if (trimmed.startsWith("## ")) return <h3 key={key} className="pt-1 text-[14px] font-semibold text-foreground">{inline(trimmed.slice(3))}</h3>;
  if (/^[-*] /.test(trimmed)) {
    return (
      <div key={key} className="flex gap-2 pl-1">
        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/70" />
        <span>{inline(trimmed.slice(2))}</span>
      </div>
    );
  }
  const num = trimmed.match(/^(\d+)\.\s+(.*)$/);
  if (num) {
    return (
      <div key={key} className="flex gap-2 pl-1">
        <span className="font-mono text-[12px] text-primary">{num[1]}.</span>
        <span>{inline(num[2])}</span>
      </div>
    );
  }
  return <p key={key}>{inline(line)}</p>;
}

function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`"))
      return <code key={i} className="rounded bg-secondary px-1 py-0.5 font-mono text-[11.5px] text-primary">{p.slice(1, -1)}</code>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}
