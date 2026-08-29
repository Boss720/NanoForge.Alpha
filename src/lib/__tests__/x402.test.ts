import { describe, expect, it } from "vitest";
import { formatQuote, isX402Response, parseX402Quote, X402Error } from "../x402";

describe("isX402Response", () => {
  it("is true only for 402", () => {
    expect(isX402Response(402)).toBe(true);
    expect(isX402Response(401)).toBe(false);
    expect(isX402Response(403)).toBe(false);
    expect(isX402Response(200)).toBe(false);
    expect(isX402Response(500)).toBe(false);
  });
});

describe("parseX402Quote — body shapes", () => {
  it("parses a flat quote body", () => {
    const q = parseX402Quote({
      amount: "0.042",
      currency: "USDC",
      network: "Base",
      payTo: "0xabc123",
      expires: "2026-01-01T00:00:00Z",
    });
    expect(q).toEqual({
      amount: "0.042",
      currency: "USDC",
      network: "Base",
      payTo: "0xabc123",
      expires: "2026-01-01T00:00:00Z",
    });
  });

  it("accepts common field aliases and numeric amounts", () => {
    const q = parseX402Quote({ price: 0.042, asset: "USDC", chain: "base", recipient: "0xdef" });
    expect(q).toMatchObject({ amount: "0.042", currency: "USDC", network: "base", payTo: "0xdef" });
  });

  it("parses the x402 spec `accepts` array shape", () => {
    const q = parseX402Quote({
      accepts: [
        {
          maxAmountRequired: "42000",
          asset: "USDC",
          network: "base",
          payTo: "0x999",
        },
      ],
    });
    expect(q).toMatchObject({ amount: "42000", currency: "USDC", network: "base", payTo: "0x999" });
  });

  it("parses a quote nested under a wrapper key", () => {
    const q = parseX402Quote({ quote: { amount: "1.5", currency: "USDC" } });
    expect(q).toMatchObject({ amount: "1.5", currency: "USDC" });
  });

  it("accepts a JSON string body", () => {
    const q = parseX402Quote(JSON.stringify({ amount: "0.01", currency: "USDC" }));
    expect(q).toMatchObject({ amount: "0.01" });
  });
});

describe("parseX402Quote — headers", () => {
  it("parses a JSON quote from the payment-required header", () => {
    const headers = new Headers({
      "payment-required": JSON.stringify({ amount: "0.042", currency: "USDC", network: "Base" }),
    });
    const q = parseX402Quote(undefined, headers);
    expect(q).toMatchObject({ amount: "0.042", currency: "USDC", network: "Base" });
  });

  it("parses a base64-encoded JSON quote header", () => {
    const headers = new Headers({
      "x-payment-required": btoa(JSON.stringify({ amount: "7", asset: "USDC" })),
    });
    const q = parseX402Quote(null, headers);
    expect(q).toMatchObject({ amount: "7", currency: "USDC" });
  });

  it("prefers the body over headers when both are present", () => {
    const headers = new Headers({ "payment-required": JSON.stringify({ amount: "9", currency: "ETH" }) });
    const q = parseX402Quote({ amount: "1", currency: "USDC" }, headers);
    expect(q).toMatchObject({ amount: "1", currency: "USDC" });
  });
});

describe("parseX402Quote — malformed input", () => {
  it("returns null for unrecognizable shapes", () => {
    expect(parseX402Quote(null)).toBeNull();
    expect(parseX402Quote(undefined)).toBeNull();
    expect(parseX402Quote("not json at all")).toBeNull();
    expect(parseX402Quote(42)).toBeNull();
    expect(parseX402Quote([])).toBeNull();
    expect(parseX402Quote({})).toBeNull();
    expect(parseX402Quote({ foo: "bar", baz: 1 })).toBeNull();
    expect(parseX402Quote({ accepts: [] })).toBeNull();
    expect(parseX402Quote({ accepts: [{ unrelated: true }] })).toBeNull();
  });

  it("returns null when headers carry garbage", () => {
    const headers = new Headers({ "payment-required": "!!!not-json!!!" });
    expect(parseX402Quote(undefined, headers)).toBeNull();
  });
});

describe("formatQuote", () => {
  it("formats amount + currency + network", () => {
    expect(formatQuote({ amount: "0.042", currency: "USDC", network: "Base" })).toBe(
      "0.042 USDC on Base",
    );
  });

  it("omits missing pieces gracefully", () => {
    expect(formatQuote({ amount: "0.042", currency: "USDC" })).toBe("0.042 USDC");
    expect(formatQuote({ currency: "USDC", network: "Base" })).toBe("USDC on Base");
    expect(formatQuote({ network: "Base" })).toBe("Payment on Base");
    expect(formatQuote({ payTo: "0xabc" })).toBe("Payment to 0xabc");
    expect(formatQuote({})).toBe("x402 payment required");
  });
});

describe("X402Error", () => {
  it("carries status 402 and the parsed quote", () => {
    const quote = { amount: "0.042", currency: "USDC" };
    const err = new X402Error("HTTP 402: payment required — 0.042 USDC", quote);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("X402Error");
    expect(err.status).toBe(402);
    expect(err.quote).toEqual(quote);
    expect(err.message).toContain("402");
  });

  it("tolerates a null quote", () => {
    const err = new X402Error("HTTP 402: payment required", null);
    expect(err.quote).toBeNull();
  });
});
