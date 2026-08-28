/**
 * Task 8 — per-run origin allow-list enforcement.
 *
 * Security contract (docs/plans/2026-08-11-agent-platform-modules.md):
 * navigation to any origin outside the run's allow-list must be denied
 * BEFORE any network fetch happens. `assertOriginAllowed` / `checkOrigin`
 * are pure functions over URL strings; they perform no I/O.
 *
 * Matching rules:
 * - scheme + host + effective port must match an allow-list entry exactly
 *   (default ports are normalized: http=80, https=443);
 * - only http: and https: URLs can ever be allowed (file:, data:,
 *   javascript:, chrome: etc. are denied unconditionally);
 * - an allow-list entry whose host is exactly `localhost` also matches
 *   subdomains of localhost (e.g. `app.localhost`) on the same scheme+port,
 *   which lets tests use isolated loopback hostnames. No other host gets
 *   wildcard/subdomain treatment.
 * - paths in allow-list entries are ignored: allowance is origin-scoped.
 */

export interface OriginDenial {
  readonly allowed: false;
  /** The URL that was checked. */
  readonly url: string;
  /** Normalized `scheme://host[:port]` of the checked URL, null if unparseable. */
  readonly origin: string | null;
  readonly reason: string;
  readonly allowlist: readonly string[];
}

export type OriginCheckResult = { readonly allowed: true; readonly origin: string } | OriginDenial;

/** Structured denial thrown by {@link assertOriginAllowed}. */
export class OriginDeniedError extends Error {
  readonly code = "ORIGIN_DENIED" as const;
  readonly denial: OriginDenial;

  constructor(denial: OriginDenial) {
    super(`Origin denied before navigation: ${denial.origin ?? denial.url} (${denial.reason})`);
    this.name = "OriginDeniedError";
    this.denial = denial;
  }
}

const DEFAULT_PORTS: Readonly<Record<string, number>> = { http: 80, https: 443 };
const LOCALHOST = "localhost";

interface NormalizedOrigin {
  readonly scheme: "http" | "https";
  readonly host: string;
  readonly port: number;
}

/** Parse and normalize a URL to its origin parts; null when not an http(s) URL. */
function normalizeOrigin(raw: string): NormalizedOrigin | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") return null;
  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) return null;
  const port = parsed.port === "" ? DEFAULT_PORTS[scheme] : Number.parseInt(parsed.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { scheme, host, port };
}

function formatOrigin(origin: NormalizedOrigin): string {
  const isDefaultPort = origin.port === DEFAULT_PORTS[origin.scheme];
  return `${origin.scheme}://${origin.host}${isDefaultPort ? "" : `:${origin.port}`}`;
}

function entryMatches(entry: NormalizedOrigin, target: NormalizedOrigin): boolean {
  if (entry.scheme !== target.scheme || entry.port !== target.port) return false;
  if (entry.host === target.host) return true;
  // Loopback-only exception: `localhost` entries also cover `*.localhost`.
  return entry.host === LOCALHOST && target.host.endsWith(`.${LOCALHOST}`);
}

/**
 * Check `url` against the run allow-list without throwing.
 * Invalid allow-list entries are ignored (fail closed).
 */
export function checkOrigin(url: string, allowlist: readonly string[]): OriginCheckResult {
  const target = normalizeOrigin(url);
  if (target === null) {
    return {
      allowed: false,
      url,
      origin: null,
      reason: "URL is not a valid http(s) URL",
      allowlist,
    };
  }
  const origin = formatOrigin(target);
  for (const rawEntry of allowlist) {
    const entry = normalizeOrigin(rawEntry);
    if (entry !== null && entryMatches(entry, target)) {
      return { allowed: true, origin };
    }
  }
  return {
    allowed: false,
    url,
    origin,
    reason: "origin is not in the run allow-list",
    allowlist,
  };
}

/**
 * Assert `url` may be navigated to under the run allow-list.
 * Returns the normalized origin on success; throws {@link OriginDeniedError}
 * with a structured {@link OriginDenial} otherwise. Pure — performs no fetch.
 */
export function assertOriginAllowed(url: string, allowlist: readonly string[]): string {
  const result = checkOrigin(url, allowlist);
  if (!result.allowed) throw new OriginDeniedError(result);
  return result.origin;
}
