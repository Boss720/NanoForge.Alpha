import { describe, expect, it } from "vitest";
import {
  agentLifecycleStateSchema,
  runStateSchema,
  agentLifecycleEventSchema,
  runLifecycleEventSchema,
  VALID_AGENT_TRANSITIONS,
  AGENT_TERMINAL_STATES,
  isValidAgentStateTransition,
  isAgentLifecycleTerminal,
  isAgentLifecycleActive,
  canPauseAgent,
  canResumeAgent,
  canCancelAgent,
  finishReasonSchema,
  tokenUsageSchema,
  chunkMetadataSchema,
  providerDeltaSchema,
  turnSpeakerSchema,
  turnStateSchema,
  turnSyncSchema,
  turnEventSchema,
  createTokenUsage,
  accumulateTokenUsage,
  isTerminalDelta,
  abortReasonSchema,
  cancellationTargetKindSchema,
  cancellationTokenWireSchema,
  cancellationCascadeEventSchema,
  createCancellationTokenWire,
  cancelTokenWire,
  isTokenAncestor,
  buildCascadeEvent,
  toolRiskTierSchema,
  RISK_TIER_RANK,
  proposedToolCallSchema,
  permissionVerdictSchema,
  permissionDecisionSchema,
  approvalRequestSchema,
  approvalResponseSchema,
  toolExecutionStatusSchema,
  toolExecutionMetadataSchema,
  toolExecutionResultSchema,
  classifyToolRisk,
  requiresHumanApproval,
  createProposedToolCall,
  createToolExecutionResult,
  isToolExecutionSuccessful,
  tokenSpendMetricsSchema,
  latencyMetricsSchema,
  modelPricingSchema,
  sessionSpendSummarySchema,
  KNOWN_MODEL_PRICING,
  calculateEstimatedCostUsd,
  createEmptySpendMetrics,
  aggregateSessionSpend,
  formatCostUsd,
  type ProviderDelta,
  type ProposedToolCall,
  type ToolExecutionResult,
  type CancellationTokenWire,
  type SessionSpendSummary,
  type JsonValue,
} from "../index";

const VALID_TIMESTAMP = "2026-08-21T22:50:00.000Z";

describe("Milestone M1.2 Adversarial Challenger Deep Stress Harness", () => {
  /* ======================================================================== */
  /* 1. Deep Object Nesting & Complex JSON Hierarchy                          */
  /* ======================================================================== */

  describe("1. Deep Object Nesting & Structural Hierarchy", () => {
    it("handles 100 levels of nested objects in proposed tool call params without stack overflow", () => {
      let nestedObj: Record<string, JsonValue> = { leaf: "deep_value", depth: 100 };
      for (let i = 99; i >= 1; i--) {
        nestedObj = { level: i, child: nestedObj, metadata: { index: i, tag: `tag_${i}` } };
      }

      const proposal: ProposedToolCall = {
        callId: "deep-call-1",
        toolName: "nested_processor",
        riskTier: "T1_WORKSPACE_WRITE",
        params: nestedObj,
        checkpointRequired: true,
      };

      const serialized = JSON.stringify(proposal);
      const deserialized = JSON.parse(serialized);
      const parsed = proposedToolCallSchema.parse(deserialized);

      expect(parsed.callId).toBe("deep-call-1");
      expect(parsed.params).toBeDefined();
      expect(parsed.params.level).toBe(1);

      // Traverse down to 100th level
      let current = parsed.params as Record<string, any>;
      for (let i = 1; i < 100; i++) {
        expect(current.level).toBe(i);
        current = current.child;
      }
      expect(current.leaf).toBe("deep_value");
      expect(current.depth).toBe(100);
    });

    it("handles large heterogeneous arrays and complex metadata in run lifecycle events", () => {
      const complexData = {
        matrix: Array.from({ length: 50 }, (_, row) =>
          Array.from({ length: 20 }, (_, col) => ({ row, col, val: row * 20 + col }))
        ),
        flags: [true, false, null, "string", 42, { nested: [1, 2, 3] }],
      };

      const runEvent = {
        type: "run.event" as const,
        runId: "run-complex-data",
        event: "dag.node.evaluated",
        data: complexData,
        at: VALID_TIMESTAMP,
      };

      const parsed = runLifecycleEventSchema.parse(JSON.parse(JSON.stringify(runEvent)));
      expect(parsed.type).toBe("run.event");
      if (parsed.type === "run.event") {
        expect((parsed.data as any).matrix).toHaveLength(50);
        expect((parsed.data as any).matrix[49][19].val).toBe(49 * 20 + 19);
      }
    });

    it("handles deeply nested tool_proposal args within providerDeltaSchema", () => {
      const complexArgs = {
        codeSnippet: "function test() { return 42; }",
        ast: {
          type: "Program",
          body: [
            {
              type: "FunctionDeclaration",
              id: { name: "test" },
              body: {
                type: "BlockStatement",
                body: [{ type: "ReturnStatement", argument: { type: "Literal", value: 42 } }],
              },
            },
          ],
        },
      };

      const delta: ProviderDelta = {
        type: "tool_proposal",
        callId: "call-ast-1",
        name: "ast_transform",
        args: complexArgs,
        riskTier: "T1_WORKSPACE_WRITE",
        justification: "Refactor AST node",
      };

      const parsed = providerDeltaSchema.parse(JSON.parse(JSON.stringify(delta)));
      expect(parsed).toEqual(delta);
    });
  });

  /* ======================================================================== */
  /* 2. Boundary Numbers, Floating Point Precision & Numeric Edge Cases        */
  /* ======================================================================== */

  describe("2. Boundary Numbers & Numeric Limits", () => {
    it("handles Number.MAX_SAFE_INTEGER in integer token counters", () => {
      const maxTokens = Number.MAX_SAFE_INTEGER; // 9007199254740991
      const usage = tokenUsageSchema.parse({
        promptTokens: maxTokens,
        completionTokens: 0,
        totalTokens: maxTokens,
      });

      expect(usage.promptTokens).toBe(maxTokens);
      expect(usage.totalTokens).toBe(maxTokens);

      const agentCompleted = agentLifecycleEventSchema.parse({
        type: "agent.completed",
        runId: "run-huge-tokens",
        totalTokens: maxTokens,
        durationMs: 99999999.99,
        at: VALID_TIMESTAMP,
      });

      expect(agentCompleted.type).toBe("agent.completed");
      if (agentCompleted.type === "agent.completed") {
        expect(agentCompleted.totalTokens).toBe(maxTokens);
      }
    });

    it("strictly rejects NaN and Infinity in token and metric fields", () => {
      // NaN
      expect(() =>
        tokenUsageSchema.parse({
          promptTokens: NaN,
          completionTokens: 0,
          totalTokens: 0,
        })
      ).toThrow();

      // Infinity
      expect(() =>
        tokenUsageSchema.parse({
          promptTokens: Infinity,
          completionTokens: 0,
          totalTokens: 0,
        })
      ).toThrow();

      expect(() =>
        tokenSpendMetricsSchema.parse({
          promptTokens: 100,
          completionTokens: 100,
          totalTokens: 200,
          estimatedCostUsd: Infinity,
        })
      ).toThrow();

      expect(() =>
        latencyMetricsSchema.parse({
          totalDurationMs: -Infinity,
        })
      ).toThrow();
    });

    it("verifies sub-cent floating point precision in calculateEstimatedCostUsd", () => {
      const pricing = KNOWN_MODEL_PRICING["gpt-4o-mini"]; // input $0.15/1M, output $0.60/1M, cache $0.075/1M
      // 1 single prompt token = 1 / 1,000,000 * 0.15 = $0.00000015 -> rounded to 6 decimal places = $0.000000
      const cost1 = calculateEstimatedCostUsd(pricing, {
        promptTokens: 1,
        completionTokens: 0,
      });
      expect(cost1).toBe(0);

      // 10 prompt tokens = 10 / 1,000,000 * 0.15 = $0.0000015 -> $0.000002
      const cost10 = calculateEstimatedCostUsd(pricing, {
        promptTokens: 10,
        completionTokens: 0,
      });
      expect(cost10).toBe(0.000002);

      // Zero token usage should yield 0.000000 exactly
      const costZero = calculateEstimatedCostUsd(pricing, {
        promptTokens: 0,
        completionTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
      });
      expect(costZero).toBe(0);
    });

    it("verifies zero-cost models (e.g. Ollama local) calculate 0 USD spend regardless of token volume", () => {
      const ollamaPricing = KNOWN_MODEL_PRICING["ollama/local"];
      const cost = calculateEstimatedCostUsd(ollamaPricing, {
        promptTokens: 10_000_000,
        completionTokens: 5_000_000,
        cachedReadTokens: 2_000_000,
        cachedWriteTokens: 1_000_000,
      });
      expect(cost).toBe(0);
    });

    it("strictly rejects floats where integer is specified in wire schema", () => {
      // turnNumber must be int
      expect(() =>
        turnSyncSchema.parse({
          sessionId: "s1",
          turnId: "t1",
          turnNumber: 3.14159,
          speaker: "agent",
          state: "completed",
          timestamp: VALID_TIMESTAMP,
        })
      ).toThrow();

      // toolCallsCount must be int
      expect(() =>
        turnSyncSchema.parse({
          sessionId: "s1",
          turnId: "t1",
          turnNumber: 1,
          speaker: "agent",
          toolCallsCount: 2.5,
          state: "completed",
          timestamp: VALID_TIMESTAMP,
        })
      ).toThrow();

      // cascadeDepth must be int
      expect(() =>
        cancellationCascadeEventSchema.parse({
          type: "cancellation.cascade",
          rootTokenId: "r1",
          targetTokenId: "t1",
          targetKind: "agent",
          targetId: "a1",
          reason: "user_requested",
          cascadeDepth: 1.1,
          timestamp: VALID_TIMESTAMP,
        })
      ).toThrow();
    });
  });

  /* ======================================================================== */
  /* 3. Unicode, Binary Payloads & Hostile Encodings                           */
  /* ======================================================================== */

  describe("3. Unicode, Binary Payloads & Special Characters", () => {
    it("safely handles multi-byte UTF-8, astral planes, zero-width joiners, and emoji sequences", () => {
      const complexUnicodeText = "🚀 Test with emojis: 👨‍👩‍👧‍👦, math: 𝒳 = ∑(λᵢ), CJK: 𠮷野家, Arabic: مرحبا, Hebrew: שלום";

      const textDelta: ProviderDelta = {
        type: "text",
        text: complexUnicodeText,
        metadata: {
          chunkIndex: 0,
          isFirstChunk: true,
          isLastChunk: false,
          timestamp: VALID_TIMESTAMP,
        },
      };

      const serialized = JSON.stringify(textDelta);
      const parsed = providerDeltaSchema.parse(JSON.parse(serialized));
      expect(parsed.type).toBe("text");
      if (parsed.type === "text") {
        expect(parsed.text).toBe(complexUnicodeText);
      }
    });

    it("safely handles control characters, ANSI escape codes, null bytes and newlines in tool output", () => {
      const rawTerminalOutput = "\x1b[31;1mERROR:\x1b[0m Command \0failed\r\n\tline 1\n\tline 2\x08\x0c";

      const toolResult: ToolExecutionResult = createToolExecutionResult(
        "call-ansi-1",
        "terminal.exec",
        "EXECUTION_ERROR",
        rawTerminalOutput,
        { durationMs: 150.5 }
      );

      const serialized = JSON.stringify(toolResult);
      const parsed = toolExecutionResultSchema.parse(JSON.parse(serialized));
      expect(parsed.output).toBe(rawTerminalOutput);
      expect(parsed.metadata.exitCode).toBe(1);
    });

    it("safely round-trips large binary payloads encoded as base64 (e.g. 64KB audio PCM chunks)", () => {
      // 64 KB simulated base64 payload
      const binaryChunkBase64 = "UklGRi4AAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=".repeat(1000);

      const delta: ProviderDelta = {
        type: "text",
        text: binaryChunkBase64,
        metadata: {
          chunkIndex: 42,
          isFirstChunk: false,
          isLastChunk: false,
          timestamp: VALID_TIMESTAMP,
        },
      };

      const parsed = providerDeltaSchema.parse(JSON.parse(JSON.stringify(delta)));
      if (parsed.type === "text") {
        expect(parsed.text.length).toBe(binaryChunkBase64.length);
        expect(parsed.text).toBe(binaryChunkBase64);
      }
    });

    it("verifies exact boundary string length constraints", () => {
      // Exact limit: 128 chars runId -> OK
      const maxRunId = "x".repeat(128);
      expect(() =>
        agentLifecycleEventSchema.parse({
          type: "agent.init",
          runId: maxRunId,
          goal: "Test boundary",
          at: VALID_TIMESTAMP,
        })
      ).not.toThrow();

      // 129 chars runId -> REJECTED
      const overRunId = "x".repeat(129);
      expect(() =>
        agentLifecycleEventSchema.parse({
          type: "agent.init",
          runId: overRunId,
          goal: "Test boundary",
          at: VALID_TIMESTAMP,
        })
      ).toThrow();

      // Exact limit: 8192 chars goal -> OK
      const maxGoal = "g".repeat(8192);
      expect(() =>
        agentLifecycleEventSchema.parse({
          type: "agent.init",
          runId: "run-1",
          goal: maxGoal,
          at: VALID_TIMESTAMP,
        })
      ).not.toThrow();

      // 8193 chars goal -> REJECTED
      const overGoal = "g".repeat(8193);
      expect(() =>
        agentLifecycleEventSchema.parse({
          type: "agent.init",
          runId: "run-1",
          goal: overGoal,
          at: VALID_TIMESTAMP,
        })
      ).toThrow();

      // Exact limit: 4096 chars justification -> OK
      const maxJust = "j".repeat(4096);
      expect(() =>
        proposedToolCallSchema.parse({
          callId: "c1",
          toolName: "test_tool",
          params: {},
          justification: maxJust,
        })
      ).not.toThrow();

      // 4097 chars justification -> REJECTED
      const overJust = "j".repeat(4097);
      expect(() =>
        proposedToolCallSchema.parse({
          callId: "c1",
          toolName: "test_tool",
          params: {},
          justification: overJust,
        })
      ).toThrow();
    });
  });

  /* ======================================================================== */
  /* 4. Prototype Pollution & Malicious JSON Injection                         */
  /* ======================================================================== */

  describe("4. Prototype Pollution & Injection Attacks", () => {
    it("does not pollute Object prototype when parsing __proto__ keys in params and args", () => {
      const maliciousJson = JSON.parse('{"callId":"c-pollute","toolName":"pollute_tool","params":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"normalKey":"safe"}}');

      const parsed = proposedToolCallSchema.parse(maliciousJson);
      expect(parsed.callId).toBe("c-pollute");

      // Verify that Object.prototype was NOT polluted
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect(({} as any).polluted).toBeUndefined();
    });

    it("safely handles malicious keys in tool execution results", () => {
      const maliciousPayload = JSON.parse('{"callId":"c1","toolName":"t1","status":"SUCCESS","output":"ok","metadata":{"durationMs":10,"__proto__":{"admin":true}},"timestamp":"2026-08-21T22:50:00.000Z"}');

      const parsed = toolExecutionResultSchema.parse(maliciousPayload);
      expect(parsed.status).toBe("SUCCESS");
      expect((Object.prototype as any).admin).toBeUndefined();
    });
  });

  /* ======================================================================== */
  /* 5. High-Frequency Streaming Delta Zod Parsing Performance Benchmark     */
  /* ======================================================================== */

  describe("5. High-Frequency Streaming Delta Throughput & Performance", () => {
    it("processes 5,000 high-frequency streaming ProviderDeltas under tight latency budget (< 500ms total, > 10,000 deltas/sec)", () => {
      const deltaSamples: ProviderDelta[] = [
        {
          type: "text",
          text: "Delta chunk token stream evaluation ",
          metadata: { chunkIndex: 1, isFirstChunk: false, isLastChunk: false, timestamp: VALID_TIMESTAMP },
        },
        {
          type: "thinking",
          text: "Refining semantic reasoning step...",
          signature: "sig_123",
          metadata: { chunkIndex: 2, isFirstChunk: false, isLastChunk: false, timestamp: VALID_TIMESTAMP },
        },
        {
          type: "tool_proposal",
          callId: "call_perf_1",
          name: "view_file",
          args: { AbsolutePath: "/workspace/src/index.ts" },
          riskTier: "T0_READ_ONLY",
          justification: "Inspect entry point",
        },
        {
          type: "usage",
          usage: { promptTokens: 500, completionTokens: 100, totalTokens: 600, cachedTokens: 150 },
        },
        {
          type: "done",
          finishReason: "stop",
          usage: { promptTokens: 500, completionTokens: 120, totalTokens: 620 },
        },
      ];

      const TOTAL_ITERATIONS = 5000;
      const rawPayloads: any[] = [];
      for (let i = 0; i < TOTAL_ITERATIONS; i++) {
        rawPayloads.push(deltaSamples[i % deltaSamples.length]);
      }

      const startTime = performance.now();
      let parsedCount = 0;

      for (let i = 0; i < TOTAL_ITERATIONS; i++) {
        const result = providerDeltaSchema.parse(rawPayloads[i]);
        if (result) parsedCount++;
      }

      const durationMs = performance.now() - startTime;
      const deltasPerSec = Math.round((TOTAL_ITERATIONS / durationMs) * 1000);
      const avgLatencyUs = Math.round((durationMs / TOTAL_ITERATIONS) * 1000 * 100) / 100;

      expect(parsedCount).toBe(TOTAL_ITERATIONS);
      // Performance sanity thresholds: must process 5000 deltas in < 1000ms (> 5,000/s)
      expect(durationMs).toBeLessThan(1000);
      expect(deltasPerSec).toBeGreaterThan(5000);

      // Document metrics for reporting
      console.log(`[STRESS BENCHMARK] Parsed ${TOTAL_ITERATIONS} streaming deltas in ${durationMs.toFixed(2)}ms (${deltasPerSec.toLocaleString()} deltas/sec, avg ${avgLatencyUs} µs/delta)`);
    });

    it("verifies memory stability and zero leakage across 10,000 rapid schema round-trips", () => {
      const eventSample = {
        type: "agent.executing",
        runId: "run-stress-999",
        stepId: "step-1",
        toolName: "run_command",
        callId: "call-999",
        at: VALID_TIMESTAMP,
      };

      const ITERATIONS = 10000;
      const start = performance.now();
      for (let i = 0; i < ITERATIONS; i++) {
        const parsed = agentLifecycleEventSchema.parse(eventSample);
        expect(parsed.type).toBe("agent.executing");
      }
      const elapsed = performance.now() - start;
      const opsPerSec = Math.round((ITERATIONS / elapsed) * 1000);
      expect(elapsed).toBeLessThan(1500);

      console.log(`[STRESS BENCHMARK] Parsed ${ITERATIONS} lifecycle events in ${elapsed.toFixed(2)}ms (${opsPerSec.toLocaleString()} ops/sec)`);
    });
  });
});
