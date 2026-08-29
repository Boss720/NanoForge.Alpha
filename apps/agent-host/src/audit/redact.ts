/**
 * Task 19 — secret redaction for the audit ledger.
 *
 * Two layers of defense:
 * 1. Exact values: every occurrence of each known secret (provider API keys,
 *    MCP tokens, resolved secret-store values — supplied by the caller via an
 *    injectable provider) is replaced with {@link REDACTED}.
 * 2. Common secret shapes: bearer tokens, `sk-...` keys, GitHub PATs, and
 *    PEM private-key blocks are pattern-redacted even when unknown.
 *
 * `redactObject` is recursive and NEVER mutates its input — it always
 * returns a redacted copy.
 */

/** Placeholder substituted for any redacted secret material. */
export const REDACTED = "«redacted»";

const PEM_BLOCK_RE =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const GITHUB_FINE_GRAINED_RE = /github_pat_[A-Za-z0-9_]{22,}/g;
const GITHUB_CLASSIC_RE = /gh[opsur]_[A-Za-z0-9]{20,}/g;
const SK_TOKEN_RE = /sk-[A-Za-z0-9_-]{8,}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;

const SECRET_PATTERNS: readonly RegExp[] = [
  PEM_BLOCK_RE,
  GITHUB_FINE_GRAINED_RE,
  GITHUB_CLASSIC_RE,
  SK_TOKEN_RE,
  BEARER_RE,
];

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replace every occurrence of each known secret value, plus common secret
 * shapes, with `«redacted»`. Secrets shorter than 4 characters are ignored
 * (redacting them would destroy ordinary text).
 */
export function redactText(
  input: string,
  secretValues: readonly string[] = [],
): string {
  let out = input;
  for (const secret of secretValues) {
    if (typeof secret !== "string" || secret.length < 4) continue;
    out = out.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
  }
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/**
 * Deep redacted copy of `input`: strings are redacted, arrays and plain
 * objects are cloned recursively, numbers/booleans/null pass through, and
 * binary payloads (Uint8Array) are returned untouched. The input is never
 * mutated.
 */
export function redactObject<T>(input: T, secretValues: readonly string[] = []): T {
  if (typeof input === "string") {
    return redactText(input, secretValues) as T;
  }
  if (Array.isArray(input)) {
    return input.map((v) => redactObject(v, secretValues)) as T;
  }
  if (typeof input === "object" && input !== null) {
    if (input instanceof Uint8Array) return input;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = redactObject(value, secretValues);
    }
    return out as T;
  }
  return input;
}
