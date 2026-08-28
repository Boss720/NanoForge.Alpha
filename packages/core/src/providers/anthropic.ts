/**
 * Anthropic Claude Provider Adapter.
 *
 * Implements native Anthropic Messages API with:
 * - Ephemeral Prompt Caching (3 strategic breakpoints)
 * - Claude 3.7 Extended Thinking deltas (thinking_delta)
 * - Tool calling with JSON delta accumulation
 * - Cache read/creation usage telemetry
 */

import type { ProviderDelta, JsonValue } from "@nanoforge/protocol";
import type { CancellationToken } from "../cancellation/types";
import { CancellationError } from "../cancellation/types";
import { BaseProviderAdapter, streamSseEvents } from "./base";
import type { ChatMessage, ChatRequest, ProviderCapabilities, ProviderConfig } from "./types";

export class AnthropicClaudeAdapter extends BaseProviderAdapter {
  readonly id = "anthropic";
  readonly defaultModel = "claude-3-7-sonnet";
  readonly capabilities: ProviderCapabilities = {
    planning: true,
    coding: true,
    vision: true,
    toolCalling: true,
    promptCaching: true,
    extendedThinking: true,
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
    const baseUrl = this.config.baseUrl || "https://api.anthropic.com";
    const apiKey = this.config.apiKey || "";

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31,thinking-2025-02-07",
      ...this.config.headers,
    };

    const payload = this.buildPayload(request);

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err: any) {
      if (token?.isCancellationRequested || signal?.aborted) {
        throw new CancellationError(token?.detail || "Anthropic request cancelled", token?.reason);
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
        if (parsed.error?.type) errorCode = parsed.error.type;
        if (parsed.error?.message) errorMessage = parsed.error.message;
      } catch {
        // Use raw text
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
        message: "Anthropic response body was empty.",
        retryable: false,
      };
      return;
    }

    const reader = body.getReader();
    let accumulatedToolCall: { callId: string; name: string; argsStr: string } | null = null;
    let finishReason: "stop" | "tool_calls" | "length" = "stop";

    try {
      for await (const sse of streamSseEvents(reader, token)) {
        token?.throwIfCancelled();

        const eventType = sse.event;
        const data = sse.data;

        if (eventType === "content_block_start") {
          const cb = data?.content_block;
          if (cb?.type === "tool_use") {
            finishReason = "tool_calls";
            accumulatedToolCall = {
              callId: cb.id || `call_${Date.now()}`,
              name: cb.name || "",
              argsStr: "",
            };
          }
        } else if (eventType === "content_block_delta") {
          const delta = data?.delta;
          if (!delta) continue;

          if (delta.type === "text_delta" && delta.text) {
            yield { type: "text", text: delta.text };
          } else if (delta.type === "thinking_delta" && delta.thinking) {
            yield { type: "thinking", text: delta.thinking };
          } else if (delta.type === "input_json_delta" && delta.partial_json) {
            if (accumulatedToolCall) {
              accumulatedToolCall.argsStr += delta.partial_json;
            }
          }
        } else if (eventType === "content_block_stop") {
          if (accumulatedToolCall) {
            let parsedArgs: Record<string, JsonValue> = {};
            try {
              parsedArgs = JSON.parse(accumulatedToolCall.argsStr || "{}");
            } catch {
              parsedArgs = {};
            }
            yield {
              type: "tool_proposal",
              callId: accumulatedToolCall.callId,
              name: accumulatedToolCall.name,
              args: parsedArgs,
            };
            accumulatedToolCall = null;
          }
        } else if (eventType === "message_delta") {
          const usage = data?.usage;
          if (usage) {
            const promptTokens = usage.input_tokens ?? 0;
            const completionTokens = usage.output_tokens ?? 0;
            const cachedReadTokens = usage.cache_read_input_tokens ?? 0;
            const cachedWriteTokens = usage.cache_creation_input_tokens ?? 0;

            yield {
              type: "usage",
              inputTokens: promptTokens,
              outputTokens: completionTokens,
              usage: {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
                cachedReadTokens: cachedReadTokens > 0 ? cachedReadTokens : undefined,
                cachedWriteTokens: cachedWriteTokens > 0 ? cachedWriteTokens : undefined,
              },
            };
          }
          if (data?.delta?.stop_reason) {
            if (data.delta.stop_reason === "tool_use") {
              finishReason = "tool_calls";
            } else if (data.delta.stop_reason === "max_tokens") {
              finishReason = "length";
            }
          }
        } else if (eventType === "message_stop") {
          yield { type: "done", finishReason };
        } else if (eventType === "error") {
          yield {
            type: "error",
            code: data?.error?.type || "ANTHROPIC_STREAM_ERROR",
            message: data?.error?.message || JSON.stringify(data),
            retryable: false,
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
    const isThinkingModel = model.includes("3-7") || request.extendedThinkingTokens !== undefined;

    // Separate system messages and user/assistant messages
    let systemPrompt = "";
    const conversationMessages: Array<{ role: "user" | "assistant"; content: any }> = [];

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
      } else if (msg.role === "tool") {
        conversationMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId || "call_default",
              content: msg.content,
            },
          ],
        });
      } else {
        conversationMessages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }

    const payload: Record<string, unknown> = {
      model,
      messages: conversationMessages,
      max_tokens: request.maxTokens ?? (isThinkingModel ? 8192 : 4096),
      stream: true,
    };

    if (systemPrompt) {
      payload.system = [
        {
          type: "text",
          text: systemPrompt,
          ...(request.ephemeralCaching !== false ? { cache_control: { type: "ephemeral" } } : {}),
        },
      ];
    }

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((t, idx) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
        // Apply cache control breakpoint to the last tool definition
        ...(idx === request.tools!.length - 1 && request.ephemeralCaching !== false
          ? { cache_control: { type: "ephemeral" } }
          : {}),
      }));
    }

    if (isThinkingModel && request.extendedThinkingTokens) {
      payload.thinking = {
        type: "enabled",
        budget_tokens: request.extendedThinkingTokens,
      };
    } else if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }

    return payload;
  }
}
