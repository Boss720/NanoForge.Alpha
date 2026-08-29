import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModels, generateImage, NanoGptError, streamChat, toPerMillion, validateKey } from "../nanogpt";
import { X402Error } from "../x402";

describe("toPerMillion", () => {
  it("treats exactly 0.01 as already per-million (boundary)", () => {
    expect(toPerMillion(0.01)).toBe(0.01);
  });

  it("scales per-token values below 0.01 up to per-million", () => {
    expect(toPerMillion(0.00000175)).toBe(1.75);
    expect(toPerMillion(0.000014)).toBe(14);
    expect(toPerMillion(0.001)).toBe(1000);
  });

  it("passes through values already expressed per-million", () => {
    expect(toPerMillion(14)).toBe(14);
    expect(toPerMillion(1.75)).toBe(1.75);
  });

  it("accepts numeric strings", () => {
    expect(toPerMillion("0.00000175")).toBe(1.75);
    expect(toPerMillion("0.01")).toBe(0.01);
  });

  it("returns 0 for missing/invalid/non-positive input", () => {
    expect(toPerMillion(undefined)).toBe(0);
    expect(toPerMillion(null)).toBe(0);
    expect(toPerMillion("nope")).toBe(0);
    expect(toPerMillion(0)).toBe(0);
    expect(toPerMillion(-5)).toBe(0);
  });
});

function stubModelsResponse(data: Array<Record<string, unknown>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data }), { status: 200 })),
  );
}

describe("fetchModels pricing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prefers explicit pricing.prompt/completion as per-token values", async () => {
    stubModelsResponse([
      {
        id: "acme/x",
        name: "X",
        pricing: { prompt: "0.00000175", completion: "0.000014" },
        context_length: 64_000,
      },
    ]);
    const models = await fetchModels("http://example.test", "key");
    expect(models).toHaveLength(1);
    expect(models[0].inputPrice).toBe(1.75);
    expect(models[0].outputPrice).toBe(14);
    expect(models[0].priceEstimated).toBeUndefined();
    expect(models[0].contextK).toBe(64);
  });

  it("falls back to the magnitude heuristic and sets priceEstimated", async () => {
    stubModelsResponse([
      { id: "acme/y", pricing: { input: 2.5, output: 10 }, context_length: 32_000 },
    ]);
    const models = await fetchModels("http://example.test", "key");
    expect(models[0].inputPrice).toBe(2.5);
    expect(models[0].outputPrice).toBe(10);
    expect(models[0].priceEstimated).toBe(true);
  });

  it("sets priceEstimated when only one explicit per-token field is present", async () => {
    stubModelsResponse([
      { id: "acme/z", pricing: { prompt: "0.000001", output: 8 }, context_length: 32_000 },
    ]);
    const models = await fetchModels("http://example.test", "key");
    expect(models[0].inputPrice).toBe(1);
    expect(models[0].outputPrice).toBe(8);
    expect(models[0].priceEstimated).toBe(true);
  });
});

/** SSE body that streams one delta plus a usage frame, then terminates. */
function sseBody(): string {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}`,
    `data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2 } })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
}

function stubStreamResponse() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(sseBody(), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestBody(fetchMock: ReturnType<typeof stubStreamResponse>): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
}

function silentHandlers() {
  return { onDelta: () => {}, onDone: () => {}, onError: () => {} };
}

describe("streamChat generation options (Task 2.3)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("omits temperature/max_tokens when no options are passed (backwards compatible)", async () => {
    const fetchMock = stubStreamResponse();
    await streamChat("http://example.test", "key", "model-x", [{ role: "user", content: "hi" }], silentHandlers());
    const body = requestBody(fetchMock);
    expect(body).toMatchObject({ model: "model-x", stream: true });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("passes temperature and maxTokens into the request body", async () => {
    const fetchMock = stubStreamResponse();
    await streamChat(
      "http://example.test",
      "key",
      "model-x",
      [{ role: "user", content: "hi" }],
      silentHandlers(),
      undefined,
      { temperature: 0.3, maxTokens: 4096 },
    );
    const body = requestBody(fetchMock);
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(4096);
  });

  it("streams deltas and reports usage to the handlers", async () => {
    stubStreamResponse();
    const deltas: string[] = [];
    let usage: { input: number; output: number } | null = null;
    await streamChat(
      "http://example.test",
      "key",
      "model-x",
      [{ role: "user", content: "hi" }],
      { onDelta: (d) => deltas.push(d), onDone: (u) => (usage = u), onError: () => {} },
    );
    expect(deltas.join("")).toBe("hi");
    expect(usage).toEqual({ input: 3, output: 2 });
  });
});

describe("generateImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to `${baseUrl}/generate-image` and maps URL results", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [{ url: "https://img.test/x.png", revised_prompt: "a nicer cat" }] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const imgs = await generateImage("http://example.test", "key", {
      prompt: "a cat",
      model: "img-model",
      size: "1024x1024",
      n: 1,
    });
    expect(imgs).toEqual([{ url: "https://img.test/x.png", revisedPrompt: "a nicer cat" }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://example.test/generate-image");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ prompt: "a cat", model: "img-model", size: "1024x1024", n: 1 });
  });

  it("maps base64 (b64_json) results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), { status: 200 }),
      ),
    );
    const imgs = await generateImage("http://example.test", "key", { prompt: "a dog" });
    expect(imgs).toEqual([{ b64: "aGVsbG8=" }]);
  });

  it("omits optional fields when not provided", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: [{ url: "u" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await generateImage("http://example.test", "key", { prompt: "x" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ prompt: "x" });
  });

  it("throws NanoGptError carrying the server's error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: "prompt blocked by policy" } }), {
            status: 400,
          }),
      ),
    );
    const promise = generateImage("http://example.test", "key", { prompt: "bad" });
    await expect(promise).rejects.toThrow("prompt blocked by policy");
    await expect(
      generateImage("http://example.test", "key", { prompt: "bad" }),
    ).rejects.toBeInstanceOf(NanoGptError);
  });

  it("falls back to HTTP status message when the error body has no message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await expect(generateImage("http://example.test", "key", { prompt: "x" })).rejects.toThrow(
      "HTTP 500",
    );
  });

  it("propagates abort as AbortError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      }),
    );
    await expect(generateImage("http://example.test", "key", { prompt: "x" })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("throws X402Error with the parsed quote on 402", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ amount: "0.042", currency: "USDC", network: "Base", payTo: "0xabc" }),
            { status: 402 },
          ),
      ),
    );
    try {
      await generateImage("http://example.test", "key", { prompt: "x" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(X402Error);
      const err = e as X402Error;
      expect(err.status).toBe(402);
      expect(err.quote).toMatchObject({ amount: "0.042", currency: "USDC", network: "Base" });
      expect(err.message).toContain("0.042 USDC on Base");
    }
  });
});

describe("streamChat x402 surfacing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports the quote via onX402 and onError on a 402 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ amount: "0.042", currency: "USDC", network: "Base" }),
            { status: 402 },
          ),
      ),
    );
    let errMsg = "";
    let x402: X402Error | null = null;
    let done = false;
    await streamChat("http://example.test", "key", "model-x", [{ role: "user", content: "hi" }], {
      onDelta: () => {},
      onDone: () => {
        done = true;
      },
      onError: (m) => {
        errMsg = m;
      },
      onX402: (e) => {
        x402 = e;
      },
    });
    expect(done).toBe(false);
    expect(x402).toBeInstanceOf(X402Error);
    expect(x402!.quote).toMatchObject({ amount: "0.042", currency: "USDC", network: "Base" });
    expect(errMsg).toContain("402");
    expect(errMsg).toContain("0.042 USDC on Base");
  });

  it("still works without an onX402 handler (non-breaking)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("payment required", { status: 402 })),
    );
    let errMsg = "";
    await streamChat("http://example.test", "key", "model-x", [{ role: "user", content: "hi" }], {
      onDelta: () => {},
      onDone: () => {},
      onError: (m) => {
        errMsg = m;
      },
    });
    expect(errMsg).toContain("402");
  });
});

describe("validateKey x402 surfacing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("includes the parsed quote in the result on 402", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ amount: "0.01", currency: "USDC", network: "Base" }), {
            status: 402,
          }),
      ),
    );
    const res = await validateKey("http://example.test", "key");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("402");
    expect(res.error).toContain("0.01 USDC on Base");
    expect(res.x402).toMatchObject({ amount: "0.01", currency: "USDC" });
  });
});
