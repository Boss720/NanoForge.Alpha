/**
 * Base Provider Adapter & SSE Streaming Utilities.
 *
 * Implements common logic for pricing calculation, context window limits,
 * and robust server-sent event (SSE) stream framing.
 */

import type { ProviderDelta } from "@nanoforge/protocol";
import type { CancellationToken } from "../cancellation/types";
import type {
  ChatRequest,
  ContextLimits,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderConfig,
} from "./types";
import { lookupModelPricing, estimateUsageCost } from "../telemetry/pricing";

export abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract readonly id: string;
  abstract readonly capabilities: ProviderCapabilities;
  abstract readonly defaultModel: string;

  constructor(protected readonly config: ProviderConfig = {}) {}

  abstract streamChat(
    request: ChatRequest,
    token?: CancellationToken
  ): AsyncIterable<ProviderDelta>;

  calculateCost(
    usage: {
      promptTokens: number;
      completionTokens: number;
      cachedReadTokens?: number;
      cachedWriteTokens?: number;
    },
    model?: string
  ): number {
    const pricing = lookupModelPricing(model || this.defaultModel);
    return estimateUsageCost(pricing, usage);
  }

  getContextLimits(model?: string): ContextLimits {
    const m = (model || this.defaultModel).toLowerCase();
    if (m.includes("claude-3-7") || m.includes("claude-3-5")) {
      return { maxInputTokens: 200_000, maxOutputTokens: 8_192 };
    }
    if (m.includes("gpt-4o")) {
      return { maxInputTokens: 128_000, maxOutputTokens: 16_384 };
    }
    if (m.includes("o3-mini") || m.includes("o1")) {
      return { maxInputTokens: 200_000, maxOutputTokens: 100_000 };
    }
    if (m.includes("ollama") || m.includes("local") || m.includes("qwen") || m.includes("llama") || this.id === "ollama") {
      return { maxInputTokens: 32_768, maxOutputTokens: 4_096 };
    }
    return { maxInputTokens: 128_000, maxOutputTokens: 4_096 };
  }

  protected getFetchFn(): typeof fetch {
    return this.config.fetchFn || (typeof fetch !== "undefined" ? fetch : (() => {
      throw new Error("No fetch implementation available in this environment.");
    }) as any);
  }
}

/**
 * Async generator that reads an SSE ReadableStream and yields raw data lines.
 */
export async function* streamSseDataLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  token?: CancellationToken
): AsyncIterable<string> {
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
        if (!trimmed || trimmed.startsWith(":")) continue; // Comment or keepalive
        if (trimmed.startsWith("data:")) {
          yield trimmed.slice(5).trim();
        }
      }
    }

    if (buffer.trim().startsWith("data:")) {
      yield buffer.trim().slice(5).trim();
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore
    }
  }
}

export interface SseEvent {
  event?: string;
  data: any;
  id?: string;
}

/**
 * Async generator that yields parsed SSE events (event + data object).
 */
export async function* streamSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  token?: CancellationToken
): AsyncIterable<SseEvent> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let currentEvent: string | undefined;
  let currentData = "";
  let currentId: string | undefined;

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
        if (!trimmed) {
          // Empty line indicates event boundary
          if (currentData) {
            let parsedData: any = currentData;
            try {
              parsedData = JSON.parse(currentData);
            } catch {
              // Raw string data
            }
            yield {
              event: currentEvent,
              data: parsedData,
              id: currentId,
            };
            currentEvent = undefined;
            currentData = "";
            currentId = undefined;
          }
          continue;
        }

        if (trimmed.startsWith(":")) continue; // Comment

        if (trimmed.startsWith("event:")) {
          currentEvent = trimmed.slice(6).trim();
        } else if (trimmed.startsWith("data:")) {
          const dataChunk = trimmed.slice(5).trim();
          currentData = currentData ? `${currentData}\n${dataChunk}` : dataChunk;
        } else if (trimmed.startsWith("id:")) {
          currentId = trimmed.slice(3).trim();
        }
      }
    }

    if (currentData) {
      let parsedData: any = currentData;
      try {
        parsedData = JSON.parse(currentData);
      } catch {
        // Raw string data
      }
      yield {
        event: currentEvent,
        data: parsedData,
        id: currentId,
      };
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore
    }
  }
}
