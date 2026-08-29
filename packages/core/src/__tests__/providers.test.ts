import { describe, it, expect } from "vitest";
import { AnthropicClaudeAdapter } from "../providers/anthropic";
import { OpenAIAdapter } from "../providers/openai";
import { OllamaAdapter } from "../providers/ollama";
import { ProviderFactory } from "../providers/factory";
import { CancellationTokenSource } from "../cancellation/cancellationToken";
import { createMockFetch } from "./mocks/mockFetch";
import type { ProviderDelta } from "@nanoforge/protocol";

describe("LLM Provider Adapters Subsystem", () => {
  describe("AnthropicClaudeAdapter", () => {
    it("streams text, thinking, and tool proposals from SSE events", async () => {
      const sseChunks = [
        "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"role\":\"assistant\"}}\n\n",
        "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n",
        "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"Let us read the file first.\"}}\n\n",
        "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
        "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
        "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"I will check the files.\"}}\n\n",
        "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":1}\n\n",
        "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":2,\"content_block\":{\"type\":\"tool_use\",\"id\":\"call_ant_1\",\"name\":\"read_file\"}}\n\n",
        "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\":\\\"\"}}\n\n",
        "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"src/index.ts\\\"}\"}}\n\n",
        "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":2}\n\n",
        "event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"input_tokens\":150,\"output_tokens\":40,\"cache_read_input_tokens\":80,\"cache_creation_input_tokens\":50}}\n\n",
        "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
      ];

      const mockFetch = createMockFetch(sseChunks);
      const adapter = new AnthropicClaudeAdapter({
        apiKey: "test-anthropic-key",
        fetchFn: mockFetch,
      });

      const deltas: ProviderDelta[] = [];
      for await (const delta of adapter.streamChat({
        messages: [{ role: "user", content: "Inspect index.ts" }],
      })) {
        deltas.push(delta);
      }

      expect(deltas.some((d) => d.type === "thinking" && d.text === "Let us read the file first.")).toBe(true);
      expect(deltas.some((d) => d.type === "text" && d.text === "I will check the files.")).toBe(true);

      const toolProposal = deltas.find((d) => d.type === "tool_proposal") as any;
      expect(toolProposal).toBeDefined();
      expect(toolProposal.name).toBe("read_file");
      expect(toolProposal.args).toEqual({ path: "src/index.ts" });

      const usage = deltas.find((d) => d.type === "usage") as any;
      expect(usage).toBeDefined();
      expect(usage.usage.cachedReadTokens).toBe(80);
      expect(usage.usage.cachedWriteTokens).toBe(50);

      const done = deltas.find((d) => d.type === "done");
      expect(done).toBeDefined();
    });

    it("handles HTTP errors gracefully from Anthropic API", async () => {
      const mockFetch = createMockFetch(
        [JSON.stringify({ error: { type: "rate_limit_error", message: "Too many requests" } })],
        { status: 429, statusText: "Too Many Requests" }
      );

      const adapter = new AnthropicClaudeAdapter({ fetchFn: mockFetch });
      const deltas: ProviderDelta[] = [];
      for await (const delta of adapter.streamChat({
        messages: [{ role: "user", content: "Hi" }],
      })) {
        deltas.push(delta);
      }

      expect(deltas.length).toBe(1);
      expect(deltas[0].type).toBe("error");
      if (deltas[0].type === "error") {
        expect(deltas[0].code).toBe("rate_limit_error");
        expect(deltas[0].retryable).toBe(true);
      }
    });

    it("supports stream cancellation via CancellationToken", async () => {
      const cts = new CancellationTokenSource();
      cts.cancel("user_requested", "Cancelled before stream");

      const adapter = new AnthropicClaudeAdapter({ apiKey: "key" });
      await expect(async () => {
        for await (const _ of adapter.streamChat(
          { messages: [{ role: "user", content: "Hi" }] },
          cts.token
        )) {
          // No-op
        }
      }).rejects.toThrow();
    });
  });

  describe("OpenAIAdapter", () => {
    it("reassembles streaming tool chunks across split SSE frames", async () => {
      const sseLines = [
        `data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Let me "},"finish_reason":null}]}\n\n`,
        `data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"run command."},"finish_reason":null}]}\n\n`,
        `data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_oai_1","type":"function","function":{"name":"run_command","arguments":""}}]},"finish_reason":null}]}\n\n`,
        `data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"command\\": \\"npm"}}]},"finish_reason":null}]}\n\n`,
        `data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":" test\\"}"}}]},"finish_reason":null}]}\n\n`,
        `data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":120,"completion_tokens":35,"total_tokens":155,"prompt_tokens_details":{"cached_tokens":40}}}\n\n`,
        `data: [DONE]\n\n`,
      ];

      const mockFetch = createMockFetch(sseLines);
      const adapter = new OpenAIAdapter({
        apiKey: "test-openai-key",
        fetchFn: mockFetch,
      });

      const deltas: ProviderDelta[] = [];
      for await (const delta of adapter.streamChat({
        messages: [{ role: "user", content: "Run tests" }],
      })) {
        deltas.push(delta);
      }

      expect(deltas.some((d) => d.type === "text" && d.text === "Let me ")).toBe(true);
      expect(deltas.some((d) => d.type === "text" && d.text === "run command.")).toBe(true);

      const toolProposal = deltas.find((d) => d.type === "tool_proposal") as any;
      expect(toolProposal).toBeDefined();
      expect(toolProposal.name).toBe("run_command");
      expect(toolProposal.args).toEqual({ command: "npm test" });

      const usage = deltas.find((d) => d.type === "usage") as any;
      expect(usage).toBeDefined();
      expect(usage.usage.promptTokens).toBe(120);
      expect(usage.usage.cachedReadTokens).toBe(40);
    });

    it("handles reasoning / thinking content from o3-mini/DeepSeek models", async () => {
      const sseLines = [
        `data: {"choices":[{"delta":{"reasoning_content":"Thinking deeply about the architecture."}}]}\n\n`,
        `data: {"choices":[{"delta":{"content":"Here is the solution."}}]}\n\n`,
        `data: [DONE]\n\n`,
      ];

      const mockFetch = createMockFetch(sseLines);
      const adapter = new OpenAIAdapter({ fetchFn: mockFetch });

      const deltas: ProviderDelta[] = [];
      for await (const d of adapter.streamChat({ messages: [{ role: "user", content: "Solve" }] })) {
        deltas.push(d);
      }

      expect(deltas.some((d) => d.type === "thinking" && d.text === "Thinking deeply about the architecture.")).toBe(true);
      expect(deltas.some((d) => d.type === "text" && d.text === "Here is the solution.")).toBe(true);
    });
  });

  describe("OllamaAdapter", () => {
    it("streams NDJSON lines from local /api/chat", async () => {
      const ndjsonChunks = [
        JSON.stringify({ model: "qwen2.5-coder", message: { role: "assistant", content: "Local " }, done: false }) + "\n",
        JSON.stringify({ model: "qwen2.5-coder", message: { role: "assistant", content: "response." }, done: false }) + "\n",
        JSON.stringify({ model: "qwen2.5-coder", message: { role: "assistant", content: "" }, done: true, prompt_eval_count: 50, eval_count: 20 }) + "\n",
      ];

      const mockFetch = createMockFetch(ndjsonChunks);
      const adapter = new OllamaAdapter({ fetchFn: mockFetch });

      const deltas: ProviderDelta[] = [];
      for await (const d of adapter.streamChat({ messages: [{ role: "user", content: "Hi local" }] })) {
        deltas.push(d);
      }

      expect(deltas.some((d) => d.type === "text" && d.text === "Local ")).toBe(true);
      expect(deltas.some((d) => d.type === "text" && d.text === "response.")).toBe(true);

      const usage = deltas.find((d) => d.type === "usage") as any;
      expect(usage).toBeDefined();
      expect(usage.usage.promptTokens).toBe(50);
      expect(usage.usage.completionTokens).toBe(20);
    });

    it("checks local availability via /api/tags", async () => {
      const mockFetch = createMockFetch([JSON.stringify({ models: [] })]);
      const adapter = new OllamaAdapter({ fetchFn: mockFetch });
      const available = await adapter.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe("ProviderFactory", () => {
    it("instantiates registered provider adapters", () => {
      const anthropic = ProviderFactory.create("anthropic", { apiKey: "test-key" });
      expect(anthropic.id).toBe("anthropic");

      const openai = ProviderFactory.create("openai", { apiKey: "test-key" });
      expect(openai.id).toBe("openai");

      const ollama = ProviderFactory.create("ollama");
      expect(ollama.id).toBe("ollama");
    });

    it("throws error for unknown provider", () => {
      expect(() => {
        ProviderFactory.create("unknown_provider");
      }).toThrow(/Unknown LLM provider/);
    });
  });
});
