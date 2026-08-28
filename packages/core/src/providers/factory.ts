/**
 * Provider Factory & Registry.
 *
 * Provides a dynamic registry for instantiating and configuring LLM provider adapters.
 */

import { AnthropicClaudeAdapter } from "./anthropic";
import { OpenAIAdapter } from "./openai";
import { OllamaAdapter } from "./ollama";
import type { ProviderAdapter, ProviderConfig } from "./types";

export type ProviderFactoryFn = (config?: ProviderConfig) => ProviderAdapter;

export class ProviderFactory {
  private static readonly _registry = new Map<string, ProviderFactoryFn>();

  static register(providerId: string, factoryFn: ProviderFactoryFn): void {
    if (!providerId || typeof providerId !== "string") {
      throw new Error("Provider ID must be a non-empty string.");
    }
    this._registry.set(providerId.toLowerCase().trim(), factoryFn);
  }

  static has(providerId: string): boolean {
    return this._registry.has(providerId.toLowerCase().trim());
  }

  static list(): string[] {
    return Array.from(this._registry.keys());
  }

  static create(providerId: string, config: ProviderConfig = {}): ProviderAdapter {
    const id = providerId.toLowerCase().trim();
    const factory = this._registry.get(id);

    if (!factory) {
      const available = Array.from(this._registry.keys()).join(", ");
      throw new Error(
        `Unknown LLM provider "${providerId}". Registered providers: [${available}]`
      );
    }

    return factory(config);
  }
}

// Built-in Registrations
ProviderFactory.register("anthropic", (cfg) => new AnthropicClaudeAdapter(cfg));
ProviderFactory.register("claude", (cfg) => new AnthropicClaudeAdapter(cfg));
ProviderFactory.register("openai", (cfg) => new OpenAIAdapter(cfg));
ProviderFactory.register("gpt", (cfg) => new OpenAIAdapter(cfg));
ProviderFactory.register("ollama", (cfg) => new OllamaAdapter(cfg));
ProviderFactory.register("local", (cfg) => new OllamaAdapter(cfg));
ProviderFactory.register("deepseek", (cfg) => new OpenAIAdapter({ baseUrl: "https://api.deepseek.com/v1", ...cfg }));
ProviderFactory.register("openrouter", (cfg) => new OpenAIAdapter({ baseUrl: "https://openrouter.ai/api/v1", ...cfg }));
