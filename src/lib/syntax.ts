/**
 * Tiny hand-rolled syntax highlighter (roadmap Task 3.3) — no dependencies.
 *
 * Produces a flat token stream with three classified kinds — `keyword`,
 * `string`, `comment` — plus `plain`. Rendering maps kinds to theme-token
 * Tailwind classes (see `RichText.tsx` / the file viewer in `App.tsx`), so
 * this file stays free of any color concerns.
 *
 * Supported languages: TypeScript/JavaScript, JSON, Markdown. Anything else
 * returns the input as a single `plain` token.
 *
 * Scanning is left-to-right with a combined alternation regex, so the
 * EARLIEST match wins — a `//` inside a string and a `"` inside a comment
 * are both handled correctly without a state machine.
 */

export type TokenKind = "keyword" | "string" | "comment" | "plain";

export interface Token {
  text: string;
  kind: TokenKind;
}

export type SyntaxLang = "ts" | "json" | "md" | "text";

/** Maps free-form language labels (fence info strings, VirtualFile.language) to a supported grammar. */
export function detectLang(lang?: string): SyntaxLang {
  const l = (lang ?? "").toLowerCase();
  if (["ts", "tsx", "typescript", "js", "jsx", "javascript", "mts", "cts", "mjs", "cjs"].includes(l)) return "ts";
  if (["json", "jsonc", "json5"].includes(l)) return "json";
  if (["md", "markdown", "mdx"].includes(l)) return "md";
  return "text";
}

const TS_KEYWORDS = new Set([
  "abstract", "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
  "debugger", "declare", "default", "delete", "do", "else", "enum", "export", "extends",
  "false", "finally", "for", "from", "function", "if", "implements", "import", "in",
  "instanceof", "interface", "let", "new", "null", "of", "private", "protected", "public",
  "readonly", "return", "static", "super", "switch", "this", "throw", "true", "try", "type",
  "typeof", "undefined", "var", "void", "while", "yield",
]);

const STRING_RE = String.raw`"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\`(?:\\.|[^\\\`])*\``;
const LINE_COMMENT_RE = String.raw`//[^\n]*`;
const BLOCK_COMMENT_RE = String.raw`/\*[\s\S]*?\*/`;
const IDENT_RE = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;

interface LangSpec {
  /** Combined alternation regex; group i corresponds to `kinds[i]`. */
  re: RegExp;
  kinds: TokenKind[];
  /** When set, `keyword`-group matches are demoted to `plain` unless in this set. */
  keywords?: Set<string>;
  /** Index of the identifier group that needs keyword-set checking. */
  keywordGroup?: number;
}

function buildSpec(patterns: { source: string; kind: TokenKind }[], flags = "gm"): LangSpec & { groupCount: number } {
  const re = new RegExp(patterns.map((p) => `(${p.source})`).join("|"), flags);
  return { re, kinds: patterns.map((p) => p.kind), groupCount: patterns.length };
}

const SPECS: Record<Exclude<SyntaxLang, "text">, LangSpec & { keywords?: Set<string>; keywordGroup?: number }> = {
  ts: {
    ...buildSpec([
      { source: LINE_COMMENT_RE, kind: "comment" },
      { source: BLOCK_COMMENT_RE, kind: "comment" },
      { source: STRING_RE, kind: "string" },
      { source: IDENT_RE, kind: "keyword" },
    ]),
    keywords: TS_KEYWORDS,
    keywordGroup: 3,
  },
  json: {
    ...buildSpec([
      { source: LINE_COMMENT_RE, kind: "comment" }, // tolerated (jsonc)
      // object keys — a string immediately followed by a colon — read as keywords
      { source: String.raw`"(?:\\.|[^"\\\n])*"(?=\s*:)`, kind: "keyword" },
      { source: String.raw`"(?:\\.|[^"\\\n])*"`, kind: "string" },
      { source: String.raw`\b(?:true|false|null)\b`, kind: "keyword" },
    ]),
  },
  md: {
    ...buildSpec([
      { source: String.raw`^#{1,6}[^\n]*`, kind: "keyword" },
      { source: "`[^`\\n]+`", kind: "string" },
      { source: String.raw`\*\*[^*\n]+\*\*`, kind: "keyword" },
    ]),
  },
};

function push(tokens: Token[], text: string, kind: TokenKind) {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.kind === kind) last.text += text; // coalesce adjacent same-kind runs
  else tokens.push({ text, kind });
}

/**
 * Splits `code` into classified tokens. Concatenating `token.text` over the
 * result always reproduces the input exactly. Unknown languages yield a
 * single `plain` token (or an empty array for empty input).
 */
export function tokenize(code: string, lang: SyntaxLang): Token[] {
  if (!code) return [];
  if (lang === "text") return [{ text: code, kind: "plain" }];
  const spec = SPECS[lang];
  const tokens: Token[] = [];
  const re = new RegExp(spec.re.source, spec.re.flags); // fresh lastIndex per call
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) push(tokens, code.slice(last, m.index), "plain");
    let kind: TokenKind = "plain";
    for (let g = 0; g < spec.kinds.length; g++) {
      const text = m[g + 1];
      if (text !== undefined) {
        kind = spec.kinds[g];
        if (g === spec.keywordGroup && spec.keywords && !spec.keywords.has(text)) kind = "plain";
        break;
      }
    }
    push(tokens, m[0], kind);
    last = m.index + m[0].length;
    if (m[0] === "") re.lastIndex++; // paranoia guard against zero-width loops
  }
  if (last < code.length) push(tokens, code.slice(last), "plain");
  return tokens;
}
