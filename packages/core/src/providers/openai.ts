/**
 * OpenAI & OpenAI-Compatible Provider Adapter.
 *
 * Implements standard OpenAI Chat Completions streaming with:
 * - Streaming tool call chunk reassembly across split SSE frames
 * - Reasoning / thinking content streaming (reasoning_content)
 * - Usage telemetry extraction via stream_options: { include_usage: true }
 * - Compatible with OpenAI (GPT-4o, o3-mini), DeepSeek, Together, vLLM
 */

import type { ProviderDelta, JsonValue } from "@nanoforge/protocol";
import type { CancellationToken } from "../cancellation/types";
import { CancellationError } from "../cancellation/types";
import { BaseProviderAdapter, streamSseDataLines } from "./base";
import type { ChatRequest, ProviderCapabilities, ProviderConfig } from "./types";

export class OpenAIAdapter extends BaseProviderAdapter {
  readonly id = "openai";
  readonly defaultModel = "gpt-4o";
  readonly capabilities: ProviderCapabilities = {
    planning: true,
    coding: true,
    vision: true,
    toolCalling: true,
    promptCaching: true,
    extendedThinking: false,
  };

  constructor(config: ProviderConfig = {}) {
    super(config);
  }

  async *streamChat(
    request: ChatRequest,
    token?: CancellationToken
  ): AsyncIterable<ProviderDelta> {
    token?.throwIfCancelled();

    const signal = token?.toAbortSignal();
    const fetchFn = this.getFetchFn();
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1";
    const apiKey = this.config.apiKey || "";

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...this.config.headers,
    };

    const payload = this.buildPayload(request);

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err: any) {
      if (token?.isCancellationRequested || signal?.aborted) {
        throw new CancellationError(token?.detail || "OpenAI request cancelled", token?.reason);
      }
      yield {
        type: "error",
        code: "NETWORK_ERROR",
        message: err.message || String(err),
        retryable: true,
      };
      return;
    }

    if (!response.ok) {
      const errText = await response.text();
      let errorCode = `HTTP_${response.status}`;
      let errorMessage = errText;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error?.code) errorCode = parsed.error.code;
        if (parsed.error?.message) errorMessage = parsed.error.message;
      } catch {
        // Raw text
      }

      yield {
        type: "error",
        code: errorCode,
        message: errorMessage,
        retryable: response.status === 429 || response.status >= 500,
      };
      return;
    }

    const body = response.body;
    if (!body) {
      yield {
        type: "error",
        code: "EMPTY_RESPONSE_BODY",
        message: "OpenAI response body was empty.",
        retryable: false,
      };
      return;
    }

    const reader = body.getReader();
    const toolCallAccumulators: Record<number, { id: string; name: string; argsStr: string }> = {};
    let finishReason: "stop" | "tool_calls" | "length" = "stop";

    try {
      for await (const line of streamSseDataLines(reader, token)) {
        token?.throwIfCancelled();

        if (line === "[DONE]") {
          // Emit all reassembled tool proposals before done
          for (const tc of Object.values(toolCallAccumulators)) {
            if (tc.name) {
              let parsedArgs: Record<string, JsonValue> = {};
              try {
                parsedArgs = JSON.parse(tc.argsStr || "{}");
              } catch {
                parsedArgs = {};
              }
              yield {
                type: "tool_proposal",
                callId: tc.id || `call_${Date.now()}`,
                name: tc.name,
                args: parsedArgs,
              };
            }
          }
          yield { type: "done", finishReason };
          break;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const choice = parsed.choices?.[0];
        if (choice) {
          if (choice.finish_reason === "tool_calls") {
            finishReason = "tool_calls";
          } else if (choice.finish_reason === "length") {
            finishReason = "length";
          }

          const delta = choice.delta;
          if (delta) {
            // Text delta
            if (delta.content) {
              yield { type: "text", text: delta.content };
            }

            // Reasoning delta (o1 / o3-mini / DeepSeek R1)
            if (delta.reasoning_content || delta.thought) {
              yield { type: "thinking", text: delta.reasoning_content || delta.thought };
            }

            // Tool call chunk reassembly
            if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
              finishReason = "tool_calls";
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallAccumulators[idx]) {
                  toolCallAccumulators[idx] = {
                    id: tc.id || "",
                    name: tc.function?.name || "",
                    argsStr: "",
                  };
                }
                if (tc.id) toolCallAccumulators[idx].id = tc.id;
                if (tc.function?.name) {
                  if (!toolCallAccumulators[idx].name) {
                    toolCallAccumulators[idx].name = tc.function.name;
                  } else if (!toolCallAccumulators[idx].name.includes(tc.function.name)) {
                    toolCallAccumulators[idx].name += tc.function.name;
                  }
                }
                if (tc.function?.arguments) toolCallAccumulators[idx].argsStr += tc.function.arguments;
              }
            }
          }
        }

        // Usage telemetry
        if (parsed.usage) {
          const promptTokens = parsed.usage.prompt_tokens ?? 0;
          const completionTokens = parsed.usage.completion_tokens ?? 0;
          const cachedReadTokens = parsed.usage.prompt_tokens_details?.cached_tokens ?? 0;

          yield {
            type: "usage",
            inputTokens: promptTokens,
            outputTokens: completionTokens,
            usage: {
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
              cachedReadTokens: cachedReadTokens > 0 ? cachedReadTokens : undefined,
            },
          };
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
    }
  }

  private buildPayload(request: ChatRequest): Record<string, unknown> {
    const model = request.model || this.defaultModel;
    const isReasoningModel = model.startsWith("o1") || model.startsWith("o3");

    const messages = request.messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool",
          content: m.content,
          tool_call_id: m.toolCallId || "call_default",
        };
      }
      return {
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
      };
    });

    const payload: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
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

    if (!isReasoningModel) {
      if (request.temperature !== undefined) payload.temperature = request.temperature;
      if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens;
    } else {
      if (request.maxTokens !== undefined) payload.max_completion_tokens = request.maxTokens;
    }

    return payload;
  }
}
