import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  CancellationTokenSource,
  CancellationError,
  terminateProcessTree,
  SpendTracker,
  BudgetExceededError,
  lookupModelPricing,
  estimateUsageCost,
  DEFAULT_FALLBACK_PRICING,
  ToolRegistry,
  PolicyGate,
  zodToJsonSchemaShim,
  Scratchpad,
  serializeScratchpad,
  parseScratchpad,
  createEmptyScratchpad,
  ContextCompactor,
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  PromptComposer,
  DEFAULT_NANOFORGE_SYSTEM_PROMPT,
  escapeXml,
  unescapeXml,
  formatXmlTag,
  extractXmlTag,
  extractAllXmlTags,
  ProviderFactory,
  AnthropicClaudeAdapter,
  OpenAIAdapter,
  OllamaAdapter,
  streamSseEvents,
  streamSseDataLines,
  AgentEngine,
  ReActFSM,
  executeReActTurn,
  CORE_VERSION,
} from "../index";
import { createMockFetch } from "./mocks/mockFetch";
import { MockProviderAdapter } from "./mocks/mockProviders";
import { mockReadTool, mockWriteTool } from "./mocks/mockTools";

describe("Milestone M1.3 Deep Edge-Case & Exhaustive Coverage Suite", () => {
  it("verifies CORE_VERSION constant", () => {
    expect(CORE_VERSION).toBe("0.1.0");
  });

  describe("Cancellation & Process Killer Edge Cases", () => {
    it("handles CancellationError properties and custom detail", () => {
      const err = new CancellationError("Turn aborted", "timeout_exceeded", "Took 5000ms");
      expect(err.name).toBe("CancellationError");
      expect(err.reason).toBe("timeout_exceeded");
      expect(err.detail).toBe("Took 5000ms");
    });

    it("handles terminateProcessTree on various process shapes", async () => {
      // Null / undefined
      expect(await terminateProcessTree(null)).toBe(true);
      expect(await terminateProcessTree(undefined)).toBe(true);

      // Process without PID but with kill()
      const procNoPid = { kill: vi.fn() };
      expect(await terminateProcessTree(procNoPid)).toBe(true);
      expect(procNoPid.kill).toHaveBeenCalledWith("SIGKILL");

      // Process with dead PID
      const procWithPid = { pid: 999999, kill: vi.fn() };
      const res = await terminateProcessTree(procWithPid, undefined, { gracePeriodMs: 10 });
      expect(typeof res).toBe("boolean");
    });

    it("prevents creating child on disposed CancellationTokenSource", () => {
      const cts = new CancellationTokenSource();
      cts.dispose();
      expect(() => cts.createChild()).toThrow(/disposed/);
      expect(cts.token.onCancelled(() => {}).dispose).toBeDefined();
    });
  });

  describe("Pricing & SpendTracker Edge Cases", () => {
    it("looks up pricing across model families and custom catalogs", () => {
      expect(lookupModelPricing("claude-3-5-haiku").inputCostPer1M).toBe(0.8);
      expect(lookupModelPricing("gpt-4o-mini").inputCostPer1M).toBe(0.15);
      expect(lookupModelPricing("o3-mini").inputCostPer1M).toBe(1.1);
      expect(lookupModelPricing("o1-preview").inputCostPer1M).toBe(1.1);
      expect(lookupModelPricing("ollama-llama3").inputCostPer1M).toBe(0.0);

      // Custom catalog lookup
      const customCatalog = {
        "custom-model": {
          modelId: "custom-model",
          provider: "custom",
          inputCostPer1M: 5.0,
          outputCostPer1M: 20.0,
        },
      };
      expect(lookupModelPricing("custom-model", customCatalog).inputCostPer1M).toBe(5.0);

      // Fallback
      expect(DEFAULT_FALLBACK_PRICING.inputCostPer1M).toBe(3.0);
    });

    it("enforces maxDurationMs timeout guard in SpendTracker", async () => {
      const tracker = new SpendTracker("gpt-4o", {
        maxDurationMs: 10,
      });

      await new Promise((r) => setTimeout(r, 25));

      expect(() => {
        tracker.recordTurnUsage({ promptTokens: 10, completionTokens: 10 });
      }).toThrow(BudgetExceededError);

      try {
        tracker.checkBudgetGuards();
      } catch (err: any) {
        expect(err.guardType).toBe("timeout");
      }
    });

    it("allows updating pricing and inspecting pricing getter", () => {
      const tracker = new SpendTracker("gpt-4o");
      expect(tracker.pricing.provider).toBe("openai");

      tracker.setPricing({
        modelId: "updated-model",
        provider: "custom",
        inputCostPer1M: 1.0,
        outputCostPer1M: 2.0,
      });
      expect(tracker.pricing.inputCostPer1M).toBe(1.0);
    });
  });

  describe("ToolRegistry & PolicyGate Edge Cases", () => {
    it("rejects invalid tool registrations and unknown executions", async () => {
      const registry = new ToolRegistry();
      expect(() => registry.register({} as any)).toThrow(/Invalid tool definition/);
      expect(() => registry.register({ name: "" } as any)).toThrow(/Invalid tool definition/);

      const cts = new CancellationTokenSource();
      const unknownResult = await registry.executeTool("non_existent", {}, {
        workspaceRoot: ".",
        cancellationToken: cts.token,
        callId: "call_unk",
        turnIndex: 1,
        sessionId: "s1",
      });
      expect(unknownResult.status).toBe("EXECUTION_ERROR");
    });

    it("executes tools returning various output types (string, object, number, boolean)", async () => {
      const registry = new ToolRegistry();
      registry.register({
        name: "number_tool",
        description: "Returns number",
        schema: z.object({ val: z.number() }),
        riskTier: "T0_READ_ONLY",
        async execute(p) { return p.val; },
      });

      const cts = new CancellationTokenSource();
      const res = await registry.executeTool("number_tool", { val: 42 }, {
        workspaceRoot: ".",
        cancellationToken: cts.token,
        callId: "c1",
        turnIndex: 1,
        sessionId: "s1",
      });
      expect(res.status).toBe("SUCCESS");
      expect(res.output).toBe("42");
    });

    it("executes checkpointHook when checkpointRequired is set on T1 tools", async () => {
      const checkpointHook = vi.fn().mockResolvedValue("chk_123");
      const gate = new PolicyGate({
        autoApproveUpTo: "T1_WORKSPACE_WRITE",
        checkpointHook,
      });

      const decision = await gate.evaluate({
        callId: "c_chk",
        toolName: "write_file",
        riskTier: "T1_WORKSPACE_WRITE",
        params: { path: "a.txt" },
        checkpointRequired: true,
      });

      expect(decision.verdict).toBe("ALLOW_ALWAYS");
      expect(checkpointHook).toHaveBeenCalled();
    });

    it("handles interactive approval handler throwing an unexpected error", async () => {
      const gate = new PolicyGate({
        autoApproveUpTo: "T0_READ_ONLY",
        interactiveApprovalHandler: async () => {
          throw new Error("RPC disconnected");
        },
      });

      const decision = await gate.evaluate({
        callId: "c_err",
        toolName: "run_command",
        riskTier: "T2_SIDE_EFFECT_GUARDED",
        params: { command: "ls" },
        checkpointRequired: false,
      });

      expect(decision.verdict).toBe("DENY");
      if (decision.verdict !== "DENY") {
        throw new Error(`Expected DENY, received ${decision.verdict}`);
      }
      expect(decision.reason).toContain("RPC disconnected");
    });
  });

  describe("Scratchpad & Compaction Edge Cases", () => {
    it("handles Scratchpad mutations and query methods", () => {
      const sp = new Scratchpad();
      const empty = createEmptyScratchpad("New goal");
      expect(empty.goal).toBe("New goal");

      const msId = sp.addMilestone("Step 1", "pending");
      expect(sp.updateMilestone(msId, "completed")).toBe(true);
      expect(sp.updateMilestone("non_existent", "completed")).toBe(false);

      const hypId = sp.addHypothesis("Hypothesis A", false);
      expect(sp.verifyHypothesis(hypId, true)).toBe(true);
      expect(sp.verifyHypothesis("non_existent", true)).toBe(false);

      sp.trackFile("file1.ts", "dirty");
      sp.trackFile("file1.ts", "clean"); // Update existing
      sp.trackFile("file2.ts", "deleted");

      const state = sp.state;
      expect(state.activeFiles.length).toBe(2);
      expect(state.activeFiles[0].status).toBe("clean");
      expect(state.activeFiles[1].status).toBe("deleted");
    });

    it("supports customSummarizer function in ContextCompactor", async () => {
      const customSummarizer = vi.fn().mockReturnValue("Custom summarized history block");
      const compactor = new ContextCompactor({
        contextLimitTokens: 50,
        triggerThresholdRatio: 0.5,
        customSummarizer,
      });

      const messages = [
        { role: "system" as const, content: "Sys" },
        { role: "user" as const, content: "Goal" },
        { role: "assistant" as const, content: "A1" },
        { role: "tool" as const, name: "tool1", content: "Result 1 with very long output text ".repeat(10) },
        { role: "assistant" as const, content: "A2" },
        { role: "tool" as const, name: "tool2", content: "Result 2 with very long output text ".repeat(10) },
        { role: "assistant" as const, content: "Recent A" },
        { role: "tool" as const, name: "recent_tool", content: "Recent R" },
      ];

      const result = await compactor.compact(messages);
      expect(result.compacted).toBe(true);
      expect(customSummarizer).toHaveBeenCalled();
      expect(result.summaryBlock).toContain("Custom summarized history block");
    });
  });

  describe("Prompt Composer & XML Utilities Edge Cases", () => {
    it("handles formatXmlTag with empty content", () => {
      const emptyTag = formatXmlTag("empty_tag", "", { attr: "val" });
      expect(emptyTag).toBe('<empty_tag attr="val" />');
    });

    it("handles empty and edge-case inputs in XML formatters", () => {
      expect(escapeXml("")).toBe("");
      expect(unescapeXml("")).toBe("");
      expect(extractXmlTag("", "tag")).toBeNull();
      expect(extractAllXmlTags("", "tag")).toEqual([]);
    });

    it("composes prompt with custom context tags and scratchpad state object", () => {
      const composer = new PromptComposer();
      const prompt = composer.composeSystemPrompt({
        customContext: { env_name: "production", region: "us-east-1" },
        scratchpad: {
          version: "1.0",
          goal: "Deploy",
          milestones: [{ id: "m1", title: "Verify", status: "completed" }],
          hypotheses: [],
          activeFiles: [],
        },
      });

      expect(prompt).toContain("<env_name>production</env_name>");
      expect(prompt).toContain("<region>us-east-1</region>");
      expect(prompt).toContain("<goal>Deploy</goal>");
    });
  });

  describe("Provider Factory & Base Provider Edge Cases", () => {
    it("lists registered providers and checks existence", () => {
      expect(ProviderFactory.has("anthropic")).toBe(true);
      expect(ProviderFactory.has("openai")).toBe(true);
      expect(ProviderFactory.has("ollama")).toBe(true);
      expect(ProviderFactory.has("non_existent")).toBe(false);

      const list = ProviderFactory.list();
      expect(list).toContain("anthropic");
      expect(list).toContain("openai");
      expect(list).toContain("ollama");

      expect(() => ProviderFactory.register("", () => ({} as any))).toThrow();
    });

    it("calculates cost and context limits across BaseProviderAdapter subclasses", () => {
      const anthropic = new AnthropicClaudeAdapter();
      expect(anthropic.getContextLimits("claude-3-7-sonnet").maxInputTokens).toBe(200_000);
      expect(anthropic.calculateCost({ promptTokens: 1000, completionTokens: 100 }, "claude-3-7-sonnet")).toBeGreaterThan(0);

      const openai = new OpenAIAdapter();
      expect(openai.getContextLimits("o3-mini").maxOutputTokens).toBe(100_000);
      expect(openai.getContextLimits("gpt-4o").maxInputTokens).toBe(128_000);

      const ollama = new OllamaAdapter();
      expect(ollama.getContextLimits().maxInputTokens).toBe(32_768);
    });

    it("handles extended thinking tokens and temperature options in Anthropic buildPayload", async () => {
      const mockFetch = createMockFetch([
        "event: message_start\ndata: {\"type\":\"message_start\"}\n\n",
        "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"Thinking done.\"}}\n\n",
        "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"}}\n\n",
        "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
      ]);

      const adapter = new AnthropicClaudeAdapter({ fetchFn: mockFetch });
      const deltas = [];
      for await (const d of adapter.streamChat({
        messages: [{ role: "user", content: "Hi" }],
        extendedThinkingTokens: 2048,
        tools: [{ name: "t1", description: "d1", parameters: { type: "object" } }],
      })) {
        deltas.push(d);
      }

      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas.some((d) => d.type === "done" && d.finishReason === "length")).toBe(true);
    });

    it("handles tool calling in Ollama adapter", async () => {
      const ndjson = [
        JSON.stringify({
          model: "qwen2.5-coder",
          message: {
            role: "assistant",
            tool_calls: [
              {
                function: {
                  name: "read_file",
                  arguments: { path: "main.ts" },
                },
              },
            ],
          },
          done: false,
        }) + "\n",
        JSON.stringify({ model: "qwen2.5-coder", done: true }) + "\n",
      ];

      const mockFetch = createMockFetch(ndjson);
      const adapter = new OllamaAdapter({ fetchFn: mockFetch });
      const deltas = [];
      for await (const d of adapter.streamChat({
        messages: [{ role: "user", content: "Inspect" }],
        tools: [{ name: "read_file", description: "Read", parameters: { type: "object" } }],
      })) {
        deltas.push(d);
      }

      const toolDelta = deltas.find((d) => d.type === "tool_proposal") as any;
      expect(toolDelta).toBeDefined();
      expect(toolDelta.name).toBe("read_file");
      expect(toolDelta.args).toEqual({ path: "main.ts" });
    });
  });

  describe("ReActFSM & AgentEngine Advanced Edge Cases", () => {
    it("resets ReActFSM cleanly and records transition history", () => {
      const fsm = new ReActFSM("IDLE");
      fsm.transitionTo("PROMPT_SYNTH", "Starting");
      fsm.transitionTo("BUDGET_CHECK");

      expect(fsm.history.length).toBe(2);
      expect(fsm.history[0].reason).toBe("Starting");

      fsm.reset();
      expect(fsm.state).toBe("IDLE");
      expect(fsm.history.length).toBe(0);
    });

    it("handles uncaught provider failures in AgentEngine run loop", async () => {
      const failingProvider = new MockProviderAdapter([
        [{ type: "error", code: "FATAL_CRASH", message: "API down completely", retryable: false }],
      ]);

      const registry = new ToolRegistry();
      const engine = new AgentEngine({
        provider: failingProvider,
        toolRegistry: registry,
        workspaceRoot: ".",
      });

      const result = await engine.run("Do something");
      expect(result.status).toBe("completed"); // Completed 1 turn with error delta handled
      expect(result.turns.length).toBe(1);
    });
  });

  describe("convertZodType Full Type Matrix Coverage", () => {
    it("converts all Zod types across primitive, composite, and wrapper variants", async () => {
      const { convertZodType } = await import("../tools/types");

      // null / undefined
      expect(convertZodType(null)).toEqual({ type: "object" });
      expect(convertZodType(undefined)).toEqual({ type: "object" });

      // String
      expect(convertZodType(z.string())).toEqual({ type: "string" });

      // Number & Integer
      expect(convertZodType(z.number())).toEqual({ type: "number" });
      expect(convertZodType(z.number().int())).toEqual({ type: "integer" });

      // Boolean
      expect(convertZodType(z.boolean())).toEqual({ type: "boolean" });

      // Enum & NativeEnum
      expect(convertZodType(z.enum(["opt1", "opt2"]))).toEqual({ type: "string", enum: ["opt1", "opt2"] });

      enum TestEnum {
        A = "ALPHA",
        B = "BETA",
      }
      expect(convertZodType(z.nativeEnum(TestEnum))).toEqual({ type: "string", enum: ["ALPHA", "BETA"] });

      // Array
      expect(convertZodType(z.array(z.string()))).toEqual({ type: "array", items: { type: "string" } });

      // Object
      const objSchema = z.object({
        req: z.string(),
        opt: z.string().optional(),
        def: z.number().default(10),
      });
      const objRes = convertZodType(objSchema);
      expect(objRes.type).toBe("object");
      expect((objRes as any).required).toContain("req");
      expect((objRes as any).required).not.toContain("opt");
      expect((objRes as any).required).not.toContain("def");

      // Record
      expect(convertZodType(z.record(z.string(), z.number()))).toEqual({
        type: "object",
        additionalProperties: { type: "number" },
      });

      // Union
      const unionRes = convertZodType(z.union([z.string(), z.number()]));
      expect((unionRes as any).anyOf).toBeDefined();

      // Literal
      expect(convertZodType(z.literal("fixed_value"))).toEqual({ type: "string", const: "fixed_value" });

      // Unknown & Any
      expect(convertZodType(z.unknown())).toEqual({ type: "object" });
      expect(convertZodType(z.any())).toEqual({ type: "object" });

      // Description preservation
      const descSchema = z.string().describe("Described field");
      expect(convertZodType(descSchema)).toEqual({ type: "string", description: "Described field" });
    });
  });

  describe("Provider Error Paths & Edge Cases", () => {
    it("handles OpenAI HTTP error and empty response body", async () => {
      // 500 error
      const mockErrFetch = createMockFetch(
        [JSON.stringify({ error: { code: "server_error", message: "OpenAI internal server error" } })],
        { status: 500, statusText: "Internal Error" }
      );
      const errAdapter = new OpenAIAdapter({ fetchFn: mockErrFetch });
      const deltas = [];
      for await (const d of errAdapter.streamChat({ messages: [{ role: "user", content: "Hi" }] })) {
        deltas.push(d);
      }
      expect(deltas.some((d) => d.type === "error" && d.code === "server_error")).toBe(true);

      // Empty response body
      const mockEmptyFetch = async () => new Response(null, { status: 200 });
      const emptyAdapter = new OpenAIAdapter({ fetchFn: mockEmptyFetch as any });
      const emptyDeltas = [];
      for await (const d of emptyAdapter.streamChat({ messages: [{ role: "user", content: "Hi" }] })) {
        emptyDeltas.push(d);
      }
      expect(emptyDeltas.some((d) => d.type === "error" && d.code === "EMPTY_RESPONSE_BODY")).toBe(true);
    });

    it("handles Anthropic empty response body", async () => {
      const mockEmptyFetch = async () => new Response(null, { status: 200 });
      const adapter = new AnthropicClaudeAdapter({ fetchFn: mockEmptyFetch as any });
      const deltas = [];
      for await (const d of adapter.streamChat({ messages: [{ role: "user", content: "Hi" }] })) {
        deltas.push(d);
      }
      expect(deltas.some((d) => d.type === "error" && d.code === "EMPTY_RESPONSE_BODY")).toBe(true);
    });

    it("handles Ollama HTTP 500 error and empty response body", async () => {
      const mockErrFetch = createMockFetch(["Server fault"], { status: 500 });
      const errAdapter = new OllamaAdapter({ fetchFn: mockErrFetch });
      const deltas = [];
      for await (const d of errAdapter.streamChat({ messages: [{ role: "user", content: "Hi" }] })) {
        deltas.push(d);
      }
      expect(deltas.some((d) => d.type === "error" && d.code === "HTTP_500")).toBe(true);

      const mockEmptyFetch = async () => new Response(null, { status: 200 });
      const emptyAdapter = new OllamaAdapter({ fetchFn: mockEmptyFetch as any });
      const emptyDeltas = [];
      for await (const d of emptyAdapter.streamChat({ messages: [{ role: "user", content: "Hi" }] })) {
        emptyDeltas.push(d);
      }
      expect(emptyDeltas.some((d) => d.type === "error" && d.code === "EMPTY_RESPONSE_BODY")).toBe(true);
    });

    it("covers OpenAIAdapter payload composition for tool messages and non-reasoning options", async () => {
      let capturedBody: any;
      const mockFetch = async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(`data: [DONE]\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      };

      const adapter = new OpenAIAdapter({ fetchFn: mockFetch as any });
      for await (const _ of adapter.streamChat({
        model: "gpt-4o",
        temperature: 0.7,
        maxTokens: 500,
        messages: [
          { role: "system", content: "Sys prompt" },
          { role: "user", content: "Call tool" },
          { role: "tool", toolCallId: "c1", content: "Tool output text" },
        ],
        tools: [{ name: "t1", description: "d1", parameters: { type: "object" } }],
      })) {
        // stream
      }

      expect(capturedBody).toBeDefined();
      expect(capturedBody.temperature).toBe(0.7);
      expect(capturedBody.max_tokens).toBe(500);
      expect(capturedBody.messages.some((m: any) => m.role === "tool" && m.tool_call_id === "c1")).toBe(true);
    });

    it("covers Anthropic Claude payload composition for multiple system messages and tools", async () => {
      let capturedBody: any;
      const mockFetch = async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(`event: message_stop\ndata: {}\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      };

      const adapter = new AnthropicClaudeAdapter({ fetchFn: mockFetch as any });
      for await (const _ of adapter.streamChat({
        model: "claude-3-5-sonnet",
        temperature: 0.5,
        messages: [
          { role: "system", content: "Sys 1" },
          { role: "system", content: "Sys 2" },
          { role: "user", content: "Query" },
          { role: "tool", toolCallId: "call_t1", content: "Tool result" },
        ],
        tools: [{ name: "t1", description: "d1", parameters: { type: "object" } }],
      })) {
        // stream
      }

      expect(capturedBody).toBeDefined();
      expect(capturedBody.system[0].text).toContain("Sys 1");
      expect(capturedBody.system[0].text).toContain("Sys 2");
      expect(capturedBody.temperature).toBe(0.5);
    });

    it("covers ZodEffects and refine wrappers in convertZodType", async () => {
      const { convertZodType } = await import("../tools/types");
      const refined = z.string().refine((val) => val.length > 0);
      const res = convertZodType(refined);
      expect(res).toEqual({ type: "string" });
    });

    it("covers pricing heuristics for all prefixes", () => {
      expect(lookupModelPricing("claude-custom").provider).toBe("anthropic");
      expect(lookupModelPricing("gpt-4o").provider).toBe("openai");
      expect(lookupModelPricing("anthropic-claude").provider).toBe("anthropic");
      expect(lookupModelPricing("openai-custom").provider).toBe("openai");
      expect(lookupModelPricing("local-custom").provider).toBe("ollama");
    });

    it("covers ContextCompactor with intermediate observations and file touch extraction", async () => {
      const compactor = new ContextCompactor({
        contextLimitTokens: 50,
        triggerThresholdRatio: 0.5,
        recentTurnsToKeep: 1,
      });

      const messages = [
        { role: "system" as const, content: "Sys" },
        { role: "user" as const, content: "Initial Goal" },
        { role: "assistant" as const, content: "<hypothesis id=\"h1\">Observation: testing something</hypothesis>" },
        { role: "tool" as const, name: "tool1", content: "Edited file /workspace/src/app.ts and ./config.json ".repeat(10) },
        { role: "assistant" as const, content: "Recent assistant" },
        { role: "user" as const, content: "Recent user" },
      ];

      const res = await compactor.compact(messages);
      expect(res.compacted).toBe(true);
      expect(res.summaryBlock).toContain("/workspace/src/app.ts");
      expect(res.summaryBlock).toContain("Observation: testing something");
    });

    it("covers agentEngine onTurnEvent and lifecycle callbacks in multi-turn run", async () => {
      const provider = new MockProviderAdapter([
        [
          { type: "thinking", text: "Thinking about plan" },
          { type: "text", text: "Proposing tool" },
          { type: "tool_proposal", callId: "c1", name: "read_file", args: { path: "f.txt" } },
          { type: "usage", usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 } },
          { type: "done", finishReason: "tool_calls" },
        ],
        [
          { type: "text", text: "Done with everything" },
          { type: "done", finishReason: "stop" },
        ],
      ]);

      const registry = new ToolRegistry();
      registry.register(mockReadTool);

      const turnEvents: any[] = [];
      const lifecycleEvents: any[] = [];

      const engine = new AgentEngine({
        provider,
        toolRegistry: registry,
        workspaceRoot: ".",
        onTurnEvent: (e) => turnEvents.push(e),
        onLifecycleEvent: (e) => lifecycleEvents.push(e),
      });

      const result = await engine.run("Test run events");
      expect(result.status).toBe("completed");
      expect(turnEvents.some((e) => e.type === "turn.started")).toBe(true);
      expect(turnEvents.some((e) => e.type === "turn.completed")).toBe(true);
      expect(lifecycleEvents.some((e) => e.type === "agent.executing")).toBe(true);
    });

    it("covers SSE stream edge cases with multiple data lines and keep-alive comments", async () => {
      const lines = [
        ": keepalive comment\n\n",
        "event: custom_event\nid: 42\ndata: line 1\ndata: line 2\n\n",
        "data: [DONE]\n\n",
      ];

      const mockFetch = createMockFetch(lines);
      const resp = await mockFetch("http://localhost");
      const reader = resp.body!.getReader();

      const events: any[] = [];
      for await (const ev of streamSseEvents(reader)) {
        events.push(ev);
      }

      expect(events.length).toBe(2);
      expect(events[0].event).toBe("custom_event");
      expect(events[0].id).toBe("42");
      expect(events[0].data).toContain("line 1\nline 2");
    });
  });
});
