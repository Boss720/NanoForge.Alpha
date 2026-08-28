/**
 * Ollama / Local LLM Provider Adapter.
 *
 * Connects directly to local Ollama instance (http://127.0.0.1:11434) with:
 * - Zero API key requirements
 * - NDJSON /api/chat streaming
 * - prompt_eval_count & eval_count usage telemetry
 * - Local offline health checks via /api/tags
 */

import type { ProviderDelta } from "@nanoforge/protocol";
import type { CancellationToken } from "../cancellation/types";
import { CancellationError } from "../cancellation/types";
import { BaseProviderAdapter } from "./base";
import type { ChatRequest, ProviderCapabilities, ProviderConfig } from "./types";

export class OllamaAdapter extends BaseProviderAdapter {
  readonly id = "ollama";
  readonly defaultModel = "qwen2.5-coder:latest";
  readonly capabilities: ProviderCapabilities = {
    planning: true,
    coding: true,
    vision: false,
    toolCalling: true,
    promptCaching: false,
    extendedThinking: false,
  };

  constructor(config: ProviderConfig = {}) {
    super({
      baseUrl: "http://127.0.0.1:11434",
      ...config,
    });
  }

  async isAvailable(): Promise<boolean> {
    const fetchFn = this.getFetchFn();
    const baseUrl = this.config.baseUrl || "http://127.0.0.1:11434";
    try {
      const resp = await fetchFn(`${baseUrl}/api/tags`, { method: "GET" });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async *streamChat(
    request: ChatRequest,
    token?: CancellationToken
  ): AsyncIterable<ProviderDelta> {
    token?.throwIfCancelled();

    const signal = token?.toAbortSignal();
    const fetchFn = this.getFetchFn();
    const baseUrl = this.config.baseUrl || "http://127.0.0.1:11434";

    const payload = this.buildPayload(request);

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.config.headers,
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err: any) {
      if (token?.isCancellationRequested || signal?.aborted) {
        throw new CancellationError(token?.detail || "Ollama request cancelled", token?.reason);
      }
      yield {
        type: "error",
        code: "OLLAMA_CONNECTION_ERROR",
        message: `Failed to connect to Ollama at ${baseUrl}: ${err.message || String(err)}`,
        retryable: true,
      };
      return;
    }

    if (!response.ok) {
      const errText = await response.text();
      yield {
        type: "error",
        code: `HTTP_${response.status}`,
        message: errText,
        retryable: response.status >= 500,
      };
      return;
    }

    const body = response.body;
    if (!body) {
      yield {
        type: "error",
        code: "EMPTY_RESPONSE_BODY",
        message: "Ollama response body was empty.",
        retryable: false,
      };
      return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        token?.throwIfCancelled();
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: any;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (parsed.message?.content) {
            yield { type: "text", text: parsed.message.content };
          }

          if (parsed.message?.tool_calls && Array.isArray(parsed.message.tool_calls)) {
            for (const tc of parsed.message.tool_calls) {
              yield {
                type: "tool_proposal",
                callId: `call_ollama_${crypto.randomUUID()}`,
                name: tc.function?.name || "",
                args: tc.function?.arguments || {},
              };
            }
          }

          if (parsed.done) {
            const promptTokens = parsed.prompt_eval_count ?? 0;
            const completionTokens = parsed.eval_count ?? 0;

            if (promptTokens > 0 || completionTokens > 0) {
              yield {
                type: "usage",
                inputTokens: promptTokens,
                outputTokens: completionTokens,
                usage: {
                  promptTokens,
                  completionTokens,
                  totalTokens: promptTokens + completionTokens,
                },
              };
            }

            yield {
              type: "done",
              finishReason: parsed.message?.tool_calls?.length ? "tool_calls" : "stop",
            };
            return;
          }
        }
      }
    } catch (err: any) {
      if (token?.isCancellationRequested || err instanceof CancellationError) {
        throw new CancellationError(token?.detail || "Stream cancelled", token?.reason);
      }
      yield {
        type: "error",
        code: "STREAM_READ_ERROR",
        message: err.message || String(err),
        retryable: false,
      };
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Ignore
      }
    }
  }

  private buildPayload(request: ChatRequest): Record<string, unknown> {
    const model = request.model || this.defaultModel;

    const messages = request.messages.map((m) => ({
      role: m.role === "tool" ? "tool" : m.role,
      content: m.content,
    }));

    const payload: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      options: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { num_predict: request.maxTokens } : {}),
      },
    };

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    return payload;
  }
}
