/**
 * Task 16 — OpenAI-compatible (chat-completions SSE) provider adapter.
 *
 * Ports the streaming/compatibility logic of the browser-side client
 * `src/lib/nanogpt.ts` to the host, normalizing it behind `ProviderAdapter`:
 * same endpoint shape (`POST {baseUrl}/chat/completions`), Bearer auth,
 * `stream_options: { include_usage: true }`, SSE `data:` frames terminated
 * by `[DONE]`, and OpenAI-style `usage.prompt_tokens/completion_tokens`.
 *
 * Security: fully injectable. The constructor receives `apiKey` directly OR
 * an opaque `secretRef` that the *caller* resolves via `resolveSecret` (e.g.
 * the host secret store). This module never reads `process.env` and never
 * resolves secret references itself.
 */

import type {
  ChatRequest,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderDelta,
} from "./types";

export interface OpenAICompatibleConfig {
  /** Adapter id in the registry, e.g. "nanogpt". */
  id: string;
  /** Base URL already ending in the API prefix, e.g. "https://nano-gpt.com/api/v1". */
  baseUrl: string;
  /** Default model used when the request doesn't specify one. */
  model: string;
  /** Literal API key. Prefer `secretRef` in host contexts. */
  apiKey?: string;
  /** Opaque reference resolved by the caller-supplied `resolveSecret`. */
  secretRef?: string;
  /** Caller-injected secret resolver (host secret store). */
  resolveSecret?: (ref: string) => string | Promise<string>;
  /** Injectable fetch for testing/proxying. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  capabilities?: Partial<ProviderCapabilities>;
}

/** Normalize an HTTP status to a stable error code + retryability. */
export function normalizeHttpError(status: number): { code: string; retryable: boolean } {
  if (status === 401 || status === 403) return { code: "unauthorized", retryable: false };
  if (status === 402) return { code: "payment_required", retryable: false };
  if (status === 404) return { code: "not_found", retryable: false };
  if (status === 429) return { code: "rate_limited", retryable: true };
  if (status >= 500) return { code: "server_error", retryable: true };
  return { code: "http_error", retryable: false };
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

function isAbort(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && e.name === "AbortError")
  );
}

interface PendingToolCall {
  name: string;
  argText: string;
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;

  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly apiKey?: string;
  private readonly secretRef?: string;
  private readonly resolveSecret?: (ref: string) => string | Promise<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAICompatibleConfig) {
    this.id = config.id;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.defaultModel = config.model;
    this.apiKey = config.apiKey;
    this.secretRef = config.secretRef;
    this.resolveSecret = config.resolveSecret;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.capabilities = {
      planning: config.capabilities?.planning ?? true,
      coding: config.capabilities?.coding ?? true,
      vision: config.capabilities?.vision ?? false,
      toolCalling: config.capabilities?.toolCalling ?? true,
    };
  }

  private async resolveApiKey(): Promise<string | undefined> {
    if (this.apiKey) return this.apiKey;
    if (this.secretRef && this.resolveSecret) return this.resolveSecret(this.secretRef);
    return undefined;
  }

  async *streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ProviderDelta> {
    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      yield {
        type: "error",
        code: "auth_missing",
        message: `Provider "${this.id}" has no API key: pass apiKey or a resolvable secretRef.`,
        retryable: false,
      };
      return;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: signal ?? null,
        body: JSON.stringify({
          model: request.model ?? this.defaultModel,
          messages: request.messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(request.tools?.length
            ? {
                tools: request.tools.map((t) => ({
                  type: "function",
                  function: {
                    name: t.name,
                    ...(t.description ? { description: t.description } : {}),
                    ...(t.parameters ? { parameters: t.parameters } : {}),
                  },
                })),
              }
            : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
        }),
      });
    } catch (e) {
      if (isAbort(e)) {
        yield { type: "error", code: "aborted", message: "Request aborted.", retryable: false };
      } else {
        yield {
          type: "error",
          code: "network_error",
          message: e instanceof Error ? e.message : "Network error reaching provider.",
          retryable: true,
        };
      }
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      const msg = serverMessage(tryParseJson(text)) ?? (text ? text.slice(0, 180) : "");
      const { code, retryable } = normalizeHttpError(res.status);
      yield {
        type: "error",
        code,
        message: `HTTP ${res.status}${msg ? `: ${msg}` : ""}`,
        retryable,
      };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawDone = false;
    // OpenAI streams tool calls as partial chunks keyed by `index`;
    // accumulate name/arguments and emit one proposal per call at the end.
    const toolCalls = new Map<number, PendingToolCall>();

    try {
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
          if (payload === "[DONE]") {
            sawDone = true;
            continue;
          }
          let json: Record<string, unknown>;
          try {
            json = JSON.parse(payload) as Record<string, unknown>;
          } catch {
            continue; // partial chunk — ignore
          }

          // In-stream error frame (some gateways emit these mid-SSE).
          const errMsg = serverMessage(json);
          if (json.error !== undefined && errMsg) {
            yield { type: "error", code: "stream_error", message: errMsg, retryable: false };
            return;
          }

          const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0];
          const delta = choice?.delta as Record<string, unknown> | undefined;
          const content = delta?.content;
          if (typeof content === "string" && content) yield { type: "text", text: content };

          const tcs = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(tcs)) {
            for (const tc of tcs) {
              const idx = typeof tc.index === "number" ? tc.index : 0;
              const acc = toolCalls.get(idx) ?? { name: "", argText: "" };
              const fn = tc.function as Record<string, unknown> | undefined;
              if (typeof fn?.name === "string") acc.name += fn.name;
              if (typeof fn?.arguments === "string") acc.argText += fn.arguments;
              toolCalls.set(idx, acc);
            }
          }

          const usage = json.usage as Record<string, unknown> | undefined;
          if (usage) {
            yield {
              type: "usage",
              inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
              outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
            };
          }
        }
        if (sawDone) {
          // Drain remaining frames in buffer on next iterations; most servers
          // close the connection right after [DONE].
        }
      }
    } catch (e) {
      if (isAbort(e)) {
        yield { type: "error", code: "aborted", message: "Stream aborted.", retryable: false };
      } else {
        yield {
          type: "error",
          code: "stream_error",
          message: e instanceof Error ? e.message : "Stream read failure.",
          retryable: true,
        };
      }
      return;
    } finally {
      reader.releaseLock();
    }

    for (const idx of [...toolCalls.keys()].sort((a, b) => a - b)) {
      const acc = toolCalls.get(idx)!;
      let args: unknown = {};
      try {
        args = acc.argText ? JSON.parse(acc.argText) : {};
      } catch {
        args = acc.argText; // keep raw text if the provider emitted invalid JSON
      }
      yield { type: "tool_proposal", name: acc.name, args };
    }

    yield { type: "done" };
  }
}
