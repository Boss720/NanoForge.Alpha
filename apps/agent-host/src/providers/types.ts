/**
 * Task 16 — normalized provider adapter contracts.
 *
 * Every host-side model provider is hidden behind `ProviderAdapter`, which
 * streams provider-agnostic `ProviderDelta`s. The router/coordinator never
 * sees vendor-specific wire formats (SSE frames, tool-call chunks, usage
 * fields); adapters normalize them here.
 */

/** What a provider can be routed for. */
export interface ProviderCapabilities {
  planning: boolean;
  coding: boolean;
  vision: boolean;
  toolCalling: boolean;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** Provider-agnostic chat message. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Tool name when role === "tool". */
  name?: string;
  /** Correlates a tool result with the proposal that requested it. */
  toolCallId?: string;
}

/** Provider-agnostic tool definition offered to the model. */
export interface ToolDefinition {
  name: string;
  description?: string;
  /** JSON Schema for the arguments object. */
  parameters?: Record<string, unknown>;
}

/** Provider-agnostic streaming chat request. */
export interface ChatRequest {
  messages: ChatMessage[];
  /** Overrides the adapter's configured default model. */
  model?: string;
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * Normalized stream deltas. A well-behaved adapter yields zero or more
 * content deltas, at most one terminal `error` OR a final `done`.
 *
 * - `text`: incremental assistant text.
 * - `tool_proposal`: a *proposal* only — execution is gated by the policy
 *   engine and user approval; adapters NEVER execute tools.
 * - `usage`: token accounting as reported by the provider.
 * - `error`: typed, normalized failure (`retryable` guides router fallback).
 * - `done`: clean end of stream.
 */
export type ProviderDelta =
  | { type: "text"; text: string }
  | { type: "tool_proposal"; name: string; args: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "done" };

export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  streamChat(request: ChatRequest, signal?: AbortSignal): AsyncIterable<ProviderDelta>;
}

export type ProviderHealthStatus = "available" | "unavailable";

export interface ProviderHealth {
  status: ProviderHealthStatus;
  /** Epoch ms of the last health transition. */
  since: number;
  /** Why the provider was marked unavailable, when known. */
  reason?: string;
}

export interface ProviderEntry {
  adapter: ProviderAdapter;
  health: ProviderHealth;
}

/**
 * Maps provider id → adapter + health state. The router consults
 * `list()`/`get()` and skips providers marked unavailable (fallback chain).
 */
export interface ProviderRegistry {
  register(adapter: ProviderAdapter): void;
  get(id: string): ProviderEntry | undefined;
  markUnavailable(id: string, reason?: string): void;
  markAvailable(id: string): void;
  list(): ProviderEntry[];
}
