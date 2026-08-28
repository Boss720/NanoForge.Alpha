/**
 * x402 accountless-mode helpers.
 *
 * x402 is an HTTP-402-based per-request payment scheme: instead of holding an
 * API key, the caller gets a 402 response carrying a price quote (amount,
 * asset, network, pay-to address, expiry) and can pay for that single
 * request. nano-gpt's exact payload shape is not pinned down, so everything
 * here parses defensively: all quote fields are optional, several common
 * field-name variants are accepted, and parsing never throws.
 */

/** A normalized, lenient view of an x402 price quote. */
export interface X402Quote {
  /** Human-readable amount, e.g. "0.042". */
  amount?: string;
  /** Asset / currency symbol, e.g. "USDC". */
  currency?: string;
  /** Network / chain name, e.g. "Base". */
  network?: string;
  /** Destination address the payment should go to. */
  payTo?: string;
  /** Expiry timestamp as provided by the server (ISO string or epoch). */
  expires?: string;
}

/** True when the HTTP status signals x402 payment-required. */
export function isX402Response(status: number): boolean {
  return status === 402;
}

/** Error thrown/reported when the API answers 402; carries the parsed quote. */
export class X402Error extends Error {
  readonly status = 402;
  readonly quote: X402Quote | null;

  constructor(message: string, quote: X402Quote | null) {
    super(message);
    this.name = "X402Error";
    this.quote = quote;
  }
}

/** First present value coerced to a non-empty string; undefined when none. */
function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse one flat quote-ish object; null when nothing recognizable. */
function parseQuoteObject(o: Record<string, unknown>): X402Quote | null {
  const amount = firstString(o.amount, o.price, o.maxAmountRequired, o.value, o.cost);
  const currency = firstString(o.currency, o.asset, o.token, o.symbol, o.assetName, o.ticker);
  const network = firstString(o.network, o.chain, o.chainId, o.networkId);
  const payTo = firstString(o.payTo, o.pay_to, o.recipient, o.address, o.payee, o.pay_to_address);
  const expires = firstString(o.expires, o.expiresAt, o.expires_at, o.validUntil, o.deadline);
  // Require at least one economically meaningful field so arbitrary JSON
  // bodies don't parse as "quotes".
  if (!amount && !currency && !payTo) return null;
  const quote: X402Quote = {};
  if (amount) quote.amount = amount;
  if (currency) quote.currency = currency;
  if (network) quote.network = network;
  if (payTo) quote.payTo = payTo;
  if (expires) quote.expires = expires;
  return quote;
}

/** Recursively hunt for a quote inside a body-shaped value. */
function quoteFromBody(body: unknown): X402Quote | null {
  if (typeof body === "string") {
    try {
      return quoteFromBody(JSON.parse(body));
    } catch {
      return null;
    }
  }
  if (!isRecord(body)) return null;
  // x402 spec shape: { accepts: [ { maxAmountRequired, asset, network, payTo, ... } ] }
  if (Array.isArray(body.accepts)) {
    for (const entry of body.accepts) {
      const q = quoteFromBody(entry);
      if (q) return q;
    }
  }
  // Common nested wrappers.
  for (const key of ["quote", "payment", "paymentRequired", "x402"]) {
    if (isRecord(body[key])) {
      const q = parseQuoteObject(body[key] as Record<string, unknown>);
      if (q) return q;
    }
  }
  return parseQuoteObject(body);
}

/** Header names known to carry x402 payment-required payloads. */
const QUOTE_HEADERS = ["payment-required", "x-payment-required", "x-402-quote", "x-x402-quote"];

/** A header value may be raw JSON or base64-encoded JSON (x402 v2 style). */
function parseHeaderValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through to base64 */
  }
  try {
    return JSON.parse(atob(raw));
  } catch {
    return null;
  }
}

/**
 * Extract an X402Quote from a 402 response. Checks the JSON body first (flat
 * fields, field aliases, x402 `accepts` arrays, nested wrappers), then common
 * headers. Never throws; returns null when nothing is recognizable.
 */
export function parseX402Quote(body: unknown, headers?: Headers): X402Quote | null {
  const fromBody = quoteFromBody(body);
  if (fromBody) return fromBody;
  if (headers) {
    for (const name of QUOTE_HEADERS) {
      const raw = headers.get(name);
      if (!raw) continue;
      const parsed = parseHeaderValue(raw);
      const q = quoteFromBody(parsed);
      if (q) return q;
    }
  }
  return null;
}

/** One-line human summary, e.g. "0.042 USDC on Base". */
export function formatQuote(quote: X402Quote): string {
  const head = [quote.amount, quote.currency].filter(Boolean).join(" ");
  let line = head;
  if (quote.network) line = line ? `${line} on ${quote.network}` : `Payment on ${quote.network}`;
  if (!line && quote.payTo) line = `Payment to ${quote.payTo}`;
  return line || "x402 payment required";
}
