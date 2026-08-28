/**
 * LLM Provider Adapter Types & Interfaces.
 *
 * Provides vendor-neutral interfaces for streaming inference, tool calling,
 * prompt caching breakpoints, and cost calculation.
 */

import type { ProviderDelta } from "@nanoforge/protocol";
import type { CancellationToken } from "../cancellation/types";

export interface ProviderCapabilities {
  planning: boolean;
  coding: boolean;
  vision: boolean;
  toolCalling: boolean;
  promptCaching: boolean;
  extendedThinking: boolean;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  toolCallId?: string;
  cacheControl?: { type: "ephemeral" };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  extendedThinkingTokens?: number;
  ephemeralCaching?: boolean;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetchFn?: typeof fetch;
}

export interface ContextLimits {
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  readonly defaultModel: string;
  streamChat(request: ChatRequest, token?: CancellationToken): AsyncIterable<ProviderDelta>;
  calculateCost(
    usage: {
      promptTokens: number;
      completionTokens: number;
      cachedReadTokens?: number;
      cachedWriteTokens?: number;
    },
    model?: string
  ): number;
  getContextLimits(model?: string): ContextLimits;
}
