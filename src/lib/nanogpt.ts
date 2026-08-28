import type { NanoModel } from "@/types";
import { FALLBACK_MODELS } from "./catalog";
import { formatQuote, isX402Response, parseX402Quote, X402Error, type X402Quote } from "./x402";

export const DEFAULT_BASE_URL = "https://nano-gpt.com/api/v1";

function headers(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/** Typed error for nano-gpt API failures; `status` is the HTTP status when known. */
export class NanoGptError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "NanoGptError";
    this.status = status;
  }
}

/** Parse a JSON error body; undefined when the body isn't JSON. */
function tryParseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Pull a human-readable error message out of a server error body. */
function serverMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const j = body as Record<string, unknown>;
  const err = j.error;
  if (typeof err === "string" && err) return err;
  if (typeof err === "object" && err !== null) {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === "string" && m) return m;
  }
  if (typeof j.message === "string" && j.message) return j.message;
  return undefined;
}

/** Build an X402Error from a 402 response's text body + headers. */
function buildX402Error(text: string, headers_: Headers): X402Error {
  const bodyJson = tryParseJson(text);
  const quote = parseX402Quote(bodyJson, headers_);
  const msg = serverMessage(bodyJson);
  return new X402Error(
    `HTTP 402: payment required${quote ? ` — ${formatQuote(quote)}` : ""}${msg ? ` (${msg})` : ""}`,
    quote,
  );
}

/** Validate a key by listing models (lightweight authenticated call). */
export async function validateKey(
  baseUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; error?: string; x402?: X402Quote | null }> {
  try {
    const res = await fetch(`${baseUrl}/models`, { headers: headers(apiKey) });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Key rejected (401). Check the key on nano-gpt.com → API Keys." };
    }
    if (isX402Response(res.status)) {
      // Accountless mode: surface the per-request price quote, if any.
      const text = await res.text().catch(() => "");
      const err = buildX402Error(text, res.headers);
      return { ok: false, error: err.message, x402: err.quote };
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} from ${baseUrl}` };
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Network/CORS blocked the request. The key is saved — requests may still work from a proxied environment.",
    };
  }
}

/** Live model list; falls back to the bundled snapshot on any failure. */
export async function fetchModels(baseUrl: string, apiKey: string): Promise<NanoModel[]> {
  try {
    const res = await fetch(`${baseUrl}/models`, { headers: headers(apiKey) });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const rows = json.data ?? [];
    const mapped: NanoModel[] = rows
      .filter((m) => typeof m.id === "string")
      .slice(0, 400)
      .map((m) => {
        const id = m.id as string;
        const pricing = (m.pricing ?? {}) as Record<string, unknown>;
        const ctx = (m.context_length ?? m.contextWindow ?? 128_000) as number;
        // Prefer explicit OpenRouter-style per-token fields; only fall back to
        // the magnitude heuristic when they are absent/invalid.
        const explicitInput = perTokenToPerMillion(pricing.prompt);
        const explicitOutput = perTokenToPerMillion(pricing.completion);
        const inputPrice = explicitInput ?? toPerMillion(pricing.input);
        const outputPrice = explicitOutput ?? toPerMillion(pricing.output);
        return {
          id,
          name: (m.name as string) ?? id,
          provider: id.includes("/") ? id.split("/")[0] : guessProvider(id),
          inputPrice,
          outputPrice,
          contextK: Math.round(Number(ctx) / 1000) || 128,
          tags: [],
          live: true,
          ...(explicitInput == null || explicitOutput == null ? { priceEstimated: true as const } : {}),
        };
      });
    return mapped.length ? mapped : FALLBACK_MODELS;
  } catch {
    return FALLBACK_MODELS;
  }
}

/** Explicit per-token price (OpenRouter-style) → USD per 1M tokens; null when absent/invalid. */
function perTokenToPerMillion(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return +(n * 1_000_000).toFixed(3);
}

/** Magnitude heuristic for ambiguous pricing values. */
export function toPerMillion(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // nano-gpt reports per-token pricing; anything < 0.01 is per-token → scale up.
  // Exactly 0.01 is treated as already per-million.
  return n < 0.01 ? +(n * 1_000_000).toFixed(3) : n;
}

function guessProvider(id: string): string {
  const s = id.toLowerCase();
  if (s.includes("claude")) return "Anthropic";
  if (s.includes("gpt") || s.includes("o4") || s.includes("o3")) return "OpenAI";
  if (s.includes("gemini")) return "Google";
  if (s.includes("deepseek")) return "DeepSeek";
  if (s.includes("kimi")) return "Moonshot";
  if (s.includes("qwen")) return "Alibaba";
  if (s.includes("glm")) return "Zhipu";
  if (s.includes("grok")) return "xAI";
  if (s.includes("llama")) return "Meta";
  if (s.includes("mistral") || s.includes("codestral")) return "Mistral";
  return "Other";
}

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone: (usage: { input: number; output: number }) => void;
  onError: (message: string) => void;
  /**
   * Optional: called (before onError) when the API answers 402 payment-required.
   * The X402Error carries the parsed per-request price quote, when present.
   */
  onX402?: (error: X402Error) => void;
}

/** Task 2.3: optional generation controls, mapped into the request body. */
export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
}

/** OpenAI-compatible streaming chat completion against nano-gpt.com. */
export async function streamChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  h: StreamHandlers,
  signal?: AbortSignal,
  options: StreamOptions = {},
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(apiKey),
      signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      }),
    });
  } catch (e) {
    h.onError(e instanceof DOMException && e.name === "AbortError" ? "Stopped." : "Network/CORS error reaching nano-gpt.com. Try Demo mode or a local proxy.");
    return;
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    if (isX402Response(res.status)) {
      // x402 accountless mode: surface the quote so the UI can offer pay-per-request.
      const err = buildX402Error(text, res.headers);
      h.onX402?.(err);
      h.onError(err.message);
      return;
    }
    h.onError(`HTTP ${res.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = { input: 0, output: 0 };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      const line = evt.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === "string") h.onDelta(delta);
        if (json.usage) {
          usage = {
            input: json.usage.prompt_tokens ?? usage.input,
            output: json.usage.completion_tokens ?? usage.output,
          };
        }
      } catch {
        /* partial chunk — ignore */
      }
    }
  }
  h.onDone(usage);
}

/** One generated image: either a hosted URL or base64 data (or both). */
export interface GeneratedImage {
  url?: string;
  b64?: string;
  revisedPrompt?: string;
}

export interface GenerateImageOptions {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
}

/**
 * Image generation against nano-gpt.
 *
 * URL convention: follows streamChat — baseUrl already ends with `/api/v1`
 * and the endpoint is appended. Per the roadmap, nano-gpt's image endpoint is
 * `POST /api/generate-image`, so we call `${baseUrl}/generate-image` (the
 * nano-gpt path is primary; the OpenAI-style `/images/generations` path is
 * NOT used because the roadmap pins the nano-gpt route).
 *
 * Throws NanoGptError on HTTP failures (with the server's error message when
 * present) and X402Error (carrying the parsed quote) on 402. Abort signals
 * propagate as AbortError.
 */
export async function generateImage(
  baseUrl: string,
  apiKey: string,
  opts: GenerateImageOptions,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/generate-image`, {
      method: "POST",
      headers: headers(apiKey),
      signal,
      body: JSON.stringify({
        prompt: opts.prompt,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.size ? { size: opts.size } : {}),
        ...(opts.n !== undefined ? { n: opts.n } : {}),
      }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new NanoGptError("Network/CORS error reaching nano-gpt.com.");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (isX402Response(res.status)) throw buildX402Error(text, res.headers);
    const bodyJson = tryParseJson(text);
    throw new NanoGptError(
      serverMessage(bodyJson) ?? `HTTP ${res.status}${text ? `: ${text.slice(0, 180)}` : ""}`,
      res.status,
    );
  }

  const json = (await res.json()) as Record<string, unknown>;
  const rows: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray(json.data)
      ? json.data
      : Array.isArray(json.images)
        ? json.images
        : [];
  const images: GeneratedImage[] = rows.map((item) => {
    if (typeof item === "string") return { url: item };
    const o = (item ?? {}) as Record<string, unknown>;
    const img: GeneratedImage = {};
    if (typeof o.url === "string") img.url = o.url;
    const b64 = o.b64_json ?? o.b64;
    if (typeof b64 === "string") img.b64 = b64;
    const revised = o.revised_prompt ?? o.revisedPrompt;
    if (typeof revised === "string") img.revisedPrompt = revised;
    return img;
  });
  if (!images.length) {
    throw new NanoGptError("generate-image returned no images.", res.status);
  }
  return images;
}
