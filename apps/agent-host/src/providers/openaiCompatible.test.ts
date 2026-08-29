import { describe, expect, it } from "vitest";
import { normalizeHttpError, OpenAICompatibleAdapter } from "./openaiCompatible";
import type { ChatRequest, ProviderDelta } from "./types";

/** Build a fake fetch returning an SSE stream from raw text chunks. */
function sseFetch(chunks: string[]): typeof fetch {
  return (async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;
}

async function collect(iter: AsyncIterable<ProviderDelta>): Promise<ProviderDelta[]> {
  const out: ProviderDelta[] = [];
  for await (const d of iter) out.push(d);
  return out;
}

const REQUEST: ChatRequest = {
  messages: [{ role: "user", content: "hello" }],
};

function makeAdapter(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return new OpenAICompatibleAdapter({
    id: "nanogpt",
    baseUrl: "https://nano-gpt.com/api/v1",
    model: "test-model",
    apiKey: "sk-test",
    fetchImpl,
    ...extra,
  });
}

describe("OpenAICompatibleAdapter SSE normalization", () => {
  it("normalizes text deltas, a tool proposal, usage, and done", async () => {
    const chunks = [
      // split mid-frame to exercise buffering
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"cho',
      'ices":[{"delta":{"content":" world"}}]}\n\n',
      // tool call streamed as two partial chunks
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"run_","arguments":"{\\"cmd\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"shell","arguments":"\\"ls\\"}"}}]}}]}\n\n',
      // usage frame then terminator
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":7}}\n\n',
      "data: [DONE]\n\n",
    ];
    const deltas = await collect(makeAdapter(sseFetch(chunks)).streamChat(REQUEST));

    const texts = deltas.filter((d) => d.type === "text").map((d) => (d as { text: string }).text);
    expect(texts).toEqual(["Hello", " world"]);

    const proposals = deltas.filter((d) => d.type === "tool_proposal");
    expect(proposals).toEqual([{ type: "tool_proposal", name: "run_shell", args: { cmd: "ls" } }]);

    expect(deltas).toContainEqual({ type: "usage", inputTokens: 12, outputTokens: 7 });
    expect(deltas.at(-1)).toEqual({ type: "done" });
  });

  it("emits a typed error delta for an in-stream error frame", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      'data: {"error":{"message":"model overloaded","code":"overloaded"}}\n\n',
      "data: [DONE]\n\n",
    ];
    const deltas = await collect(makeAdapter(sseFetch(chunks)).streamChat(REQUEST));
    expect(deltas[0]).toEqual({ type: "text", text: "partial" });
    expect(deltas[1]).toEqual({
      type: "error",
      code: "stream_error",
      message: "model overloaded",
      retryable: false,
    });
    expect(deltas).toHaveLength(2); // stream ends after the error frame
  });

  it("normalizes non-200 responses (401 not retryable, 500 retryable)", async () => {
    const unauthorized = (async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })) as typeof fetch;
    let deltas = await collect(makeAdapter(unauthorized).streamChat(REQUEST));
    expect(deltas).toEqual([
      { type: "error", code: "unauthorized", message: "HTTP 401: bad key", retryable: false },
    ]);

    const serverErr = (async () => new Response("oops", { status: 500 })) as typeof fetch;
    deltas = await collect(makeAdapter(serverErr).streamChat(REQUEST));
    expect(deltas).toEqual([
      { type: "error", code: "server_error", message: "HTTP 500: oops", retryable: true },
    ]);

    const rateLimited = (async () => new Response("", { status: 429 })) as typeof fetch;
    deltas = await collect(makeAdapter(rateLimited).streamChat(REQUEST));
    expect(deltas[0]).toMatchObject({ type: "error", code: "rate_limited", retryable: true });
  });

  it("normalizes a network failure as retryable network_error", async () => {
    const boom = (async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;
    const deltas = await collect(makeAdapter(boom).streamChat(REQUEST));
    expect(deltas).toEqual([
      { type: "error", code: "network_error", message: "socket hang up", retryable: true },
    ]);
  });

  it("resolves secrets via the caller-injected resolver and sends Bearer auth", async () => {
    let seenAuth: string | null = null;
    const spyFetch = (async (_url: unknown, init?: RequestInit) => {
      seenAuth = new Headers(init?.headers).get("authorization");
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          c.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;

    const adapter = makeAdapter(spyFetch, {
      apiKey: undefined,
      secretRef: "vault:nanogpt",
      resolveSecret: (ref: string) => (ref === "vault:nanogpt" ? "sk-resolved" : undefined),
    });
    const deltas = await collect(adapter.streamChat(REQUEST));
    expect(seenAuth).toBe("Bearer sk-resolved");
    expect(deltas.at(-1)).toEqual({ type: "done" });
  });

  it("yields auth_missing when no key or resolvable secretRef is configured", async () => {
    const adapter = makeAdapter(sseFetch([]), { apiKey: undefined, secretRef: "vault:x" });
    const deltas = await collect(adapter.streamChat(REQUEST));
    expect(deltas).toEqual([
      expect.objectContaining({ type: "error", code: "auth_missing", retryable: false }),
    ]);
  });
});

describe("normalizeHttpError", () => {
  it("maps statuses to codes/retryability", () => {
    expect(normalizeHttpError(401)).toEqual({ code: "unauthorized", retryable: false });
    expect(normalizeHttpError(402)).toEqual({ code: "payment_required", retryable: false });
    expect(normalizeHttpError(429)).toEqual({ code: "rate_limited", retryable: true });
    expect(normalizeHttpError(503)).toEqual({ code: "server_error", retryable: true });
    expect(normalizeHttpError(400)).toEqual({ code: "http_error", retryable: false });
  });
});
