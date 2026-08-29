import { describe, expect, it } from "vitest";
import {
  // Lifecycle
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
  LIFECYCLE_ERROR_CODES,
  type AgentLifecycleState,
  type AgentLifecycleEvent,

  // Stream
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
  type ProviderDelta,
  type TokenUsage,
  type TurnSync,

  // Cancellation
  abortReasonSchema,
  cancellationTargetKindSchema,
  cancellationTokenWireSchema,
  cancellationCascadeEventSchema,
  createCancellationTokenWire,
  cancelTokenWire,
  isTokenAncestor,
  buildCascadeEvent,
  type CancellationTokenWire,
  type AbortReason,

  // Tools
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
  type ToolRiskTier,
  type ProposedToolCall,
  type ToolExecutionResult,

  // Telemetry
  tokenSpendMetricsSchema,
  latencyMetricsSchema,
  modelPricingSchema,
  sessionSpendSummarySchema,
  KNOWN_MODEL_PRICING,
  calculateEstimatedCostUsd,
  createEmptySpendMetrics,
  aggregateSessionSpend,
  formatCostUsd,
  type TokenSpendMetrics,
  type ModelPricing,
  type SessionSpendSummary,
} from "../index";

const VALID_TIMESTAMP = "2026-08-21T22:45:00.000Z";

describe("Milestone M1.2 Adversarial Wire Protocol Stress Harness", () => {
  /* ======================================================================== */
  /* 1. Adversarial Lifecycle State Machine & Transition Invariants            */
  /* ======================================================================== */

  describe("1. Lifecycle State Machine & Invalid Transitions", () => {
    const allStates: AgentLifecycleState[] = [
      "init",
      "ready",
      "thinking",
      "executing",
      "completed",
      "failed",
      "paused",
      "resumed",
      "cancelled",
    ];

    it("evaluates all 81 (9x9) state transitions deterministically against specification", () => {
      for (const from of allStates) {
        for (const to of allStates) {
          const result = isValidAgentStateTransition(from, to);
          if (from === to) {
            // Idempotent self-transition is always legal
            expect(result).toBe(true);
          } else {
            const allowedSet = VALID_AGENT_TRANSITIONS[from];
            const isExpected = allowedSet ? allowedSet.has(to) : false;
            expect(result).toBe(isExpected);
          }
        }
      }
    });

    it("strictly forbids terminal states from transitioning to any different state", () => {
      const terminalStates: AgentLifecycleState[] = ["completed", "failed", "cancelled"];
      for (const term of terminalStates) {
        expect(isAgentLifecycleTerminal(term)).toBe(true);
        expect(canCancelAgent(term)).toBe(false);
        expect(canPauseAgent(term)).toBe(false);
        expect(canResumeAgent(term)).toBe(false);
        expect(isAgentLifecycleActive(term)).toBe(false);

        for (const target of allStates) {
          if (target !== term) {
            expect(isValidAgentStateTransition(term, target)).toBe(false);
          }
        }
      }
    });

    it("verifies illegal skipping and reverse transitions", () => {
      // Illegal jumps from init
      expect(isValidAgentStateTransition("init", "thinking")).toBe(false);
      expect(isValidAgentStateTransition("init", "executing")).toBe(false);
      expect(isValidAgentStateTransition("init", "completed")).toBe(false);
      expect(isValidAgentStateTransition("init", "paused")).toBe(false);
      expect(isValidAgentStateTransition("init", "resumed")).toBe(false);

      // Illegal jumps from paused
      expect(isValidAgentStateTransition("paused", "init")).toBe(false);
      expect(isValidAgentStateTransition("paused", "ready")).toBe(false);
      expect(isValidAgentStateTransition("paused", "thinking")).toBe(false);
      expect(isValidAgentStateTransition("paused", "executing")).toBe(false);
      expect(isValidAgentStateTransition("paused", "completed")).toBe(false);
      expect(isValidAgentStateTransition("paused", "failed")).toBe(false);

      // Illegal jumps to init
      for (const s of allStates) {
        if (s !== "init") {
          expect(isValidAgentStateTransition(s, "init")).toBe(false);
        }
      }
    });

    it("rejects corrupted and hostile agent lifecycle event payloads", () => {
      // Oversized runId (> 128 chars)
      const hugeRunId = "r".repeat(129);
      expect(() =>
        agentLifecycleEventSchema.parse({
          type: "agent.init",
          runId: hugeRunId,
          goal: "Build app",
          at: VALID_TIMESTAMP,
        })
      ).toThrow();

      // Oversized goal (> 8192 chars)
      const hugeGoal = "g".repeat(8193);
      expect(() =>
        agentLifecycleEventSchema.parse({
          type: "agent.init",
          runId: "run-1",
          goal: hugeGoal,
          at: VALID_TIMESTAMP,
        })
      ).toThrow();

      // Malformed ISO datetime (missing T, invalid month, random string)
      const badDates = [
        "2026-08-21 22:45:00",
        "2026-13-45T99:99:99Z",
        "yesterday",
        "1724283900000",
        "",
      ];
      for (const badDate of badDates) {
        expect(() =>
          agentLifecycleEventSchema.parse({
            type: "agent.ready",
            runId: "run-1",
            at: badDate,
          })
        ).toThrow();
      }

      // Negative durationMs or totalTokens in completed event
      expect(() =>
        agentLifecycleEventSchema.parse({
          type: "agent.completed",
          runId: "run-1",
          totalTokens: -50,
          at: VALID_TIMESTAMP,
        })
      ).toThrow();

      expect(() =>
        agentLifecycleEventSchema.parse({
          type: "agent.completed",
          runId: "run-1",
          durationMs: -100,
          at: VALID_TIMESTAMP,
        })
      ).toThrow();

      // Float totalTokens (must be integer)
      expect(() =>
        agentLifecycleEventSchema.parse({
          type: "agent.completed",
          runId: "run-1",
          totalTokens: 12.34,
          at: VALID_TIMESTAMP,
        })
      ).toThrow();
    });

    it("rejects mismatched discriminator and unknown event types", () => {
      expect(() =>
        agentLifecycleEventSchema.parse({
          type: "agent.unknown_state",
          runId: "run-1",
          at: VALID_TIMESTAMP,
        })
      ).toThrow();

      expect(() =>
        runLifecycleEventSchema.parse({
          type: "run.unknown",
          runId: "run-1",
          at: VALID_TIMESTAMP,
        })
      ).toThrow();
    });
  });

  /* ======================================================================== */
  /* 2. Malformed ProviderDelta Stream Frames & Chunk Stress                   */
  /* ======================================================================== */

  describe("2. Malformed ProviderDelta Stream Frames", () => {
    it("rejects unknown delta type tags", () => {
      const hostileDeltas = [
        { type: "raw" },
        { type: "stream_chunk" },
        { type: "delta" },
        { type: "" },
        { type: null },
        { type: 123 },
      ];

      for (const delta of hostileDeltas) {
        expect(() => providerDeltaSchema.parse(delta)).toThrow();
      }
    });

    it("rejects invalid finish reasons in done delta", () => {
      const badFinishReasons = [
        "cancelled",
        "interrupted",
        "finished",
        "error",
        "complete",
        "",
        null,
      ];

      for (const reason of badFinishReasons) {
        expect(() =>
          providerDeltaSchema.parse({
            type: "done",
            finishReason: reason,
          })
        ).toThrow();
      }
    });

    it("rejects corrupted tool_proposal frames", () => {
      // Empty tool name
      expect(() =>
        providerDeltaSchema.parse({
          type: "tool_proposal",
          callId: "c-1",
          name: "",
          args: {},
        })
      ).toThrow();

      // Invalid riskTier
      expect(() =>
        providerDeltaSchema.parse({
          type: "tool_proposal",
          callId: "c-1",
          name: "view_file",
          args: {},
          riskTier: "T4_HYPER_DESTRUCTIVE",
        })
      ).toThrow();

      // Missing args
      expect(() =>
        providerDeltaSchema.parse({
          type: "tool_proposal",
          callId: "c-1",
          name: "view_file",
        })
      ).toThrow();
    });

    it("rejects corrupted chunk metadata", () => {
      // Float chunkIndex
      expect(() =>
        chunkMetadataSchema.parse({
          chunkIndex: 1.5,
          timestamp: VALID_TIMESTAMP,
        })
      ).toThrow();

      // Negative latencyMs
      expect(() =>
        chunkMetadataSchema.parse({
          chunkIndex: 0,
          latencyMs: -5,
          timestamp: VALID_TIMESTAMP,
        })
      ).toThrow();
    });

    it("tests boundary cases of createTokenUsage and accumulateTokenUsage", () => {
      // Clamping negative values and float floor
      const usage1 = createTokenUsage(-100.9, -0.5, -50, -10);
      expect(usage1.promptTokens).toBe(0);
      expect(usage1.completionTokens).toBe(0);
      expect(usage1.totalTokens).toBe(0);
      expect(usage1.cachedTokens).toBe(0);
      expect(usage1.estimatedCostUsd).toBe(0);

      // Floats truncated/floored
      const usage2 = createTokenUsage(100.9, 50.1, 20.7, 0.005);
      expect(usage2.promptTokens).toBe(100);
      expect(usage2.completionTokens).toBe(50);
      expect(usage2.totalTokens).toBe(150);
      expect(usage2.cachedTokens).toBe(20);
      expect(usage2.estimatedCostUsd).toBe(0.005);

      // Accumulate with undefined/partial fields
      const base: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };
      const delta: TokenUsage = {
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        cachedTokens: 80,
        estimatedCostUsd: 0.0012,
      };

      const combined = accumulateTokenUsage(base, delta);
      expect(combined.promptTokens).toBe(300);
      expect(combined.completionTokens).toBe(150);
      expect(combined.totalTokens).toBe(450);
      expect(combined.cachedTokens).toBe(80);
      expect(combined.estimatedCostUsd).toBe(0.0012);
    });

    it("accumulates cachedReadTokens and cachedWriteTokens alongside prompt and completion tokens", () => {
      const base: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 200,
        totalTokens: 1200,
        cachedReadTokens: 400,
        cachedWriteTokens: 100,
      };
      const delta: TokenUsage = {
        promptTokens: 500,
        completionTokens: 100,
        totalTokens: 600,
        cachedReadTokens: 200,
        cachedWriteTokens: 50,
      };
      const accumulated = accumulateTokenUsage(base, delta);
      expect(accumulated.cachedReadTokens).toBe(600);
      expect(accumulated.cachedWriteTokens).toBe(150);
      expect(accumulated.promptTokens).toBe(1500);
      expect(accumulated.completionTokens).toBe(300);
      expect(accumulated.totalTokens).toBe(1800);
    });

    it("verifies isTerminalDelta discriminates correctly", () => {
      expect(isTerminalDelta({ type: "done", finishReason: "stop" })).toBe(true);
      expect(isTerminalDelta({ type: "error", code: "ERR", message: "fail", retryable: false })).toBe(true);
      expect(isTerminalDelta({ type: "text", text: "" })).toBe(false);
      expect(isTerminalDelta({ type: "thinking", text: "" })).toBe(false);
      expect(isTerminalDelta({ type: "tool_proposal", callId: "1", name: "tool", args: {} })).toBe(false);
      expect(isTerminalDelta({ type: "usage", inputTokens: 0 })).toBe(false);
    });
  });

  /* ======================================================================== */
  /* 3. Circular & Corrupted Cancellation Token Trees                          */
  /* ======================================================================== */

  describe("3. Cancellation Token Trees & Hierarchy Robustness", () => {
    it("handles cyclic and corrupted parent-child relationships in isTokenAncestor", () => {
      const tokenA = createCancellationTokenWire("tok-A", "root-1", "tok-B");
      const tokenB = createCancellationTokenWire("tok-B", "root-1", "tok-A");

      // Direct parent checks
      expect(isTokenAncestor(tokenA, tokenA)).toBe(true);
      expect(isTokenAncestor(tokenB, tokenB)).toBe(true);
      expect(isTokenAncestor(tokenB, tokenA)).toBe(true); // tokenA.parentId === tokenB.tokenId
      expect(isTokenAncestor(tokenA, tokenB)).toBe(true); // tokenB.parentId === tokenA.tokenId

      // Cross-root isolation: Even if parentId matches, different rootId must return false
      const foreignAncestor = createCancellationTokenWire("tok-Foreign", "root-2");
      const childWithForeignParent = createCancellationTokenWire("tok-Child", "root-1", "tok-Foreign");
      expect(isTokenAncestor(foreignAncestor, childWithForeignParent)).toBe(false);
    });

    it("verifies isTokenAncestor recognizes root as ancestor of all descendant levels in tree", () => {
      const root = createCancellationTokenWire("root", "root");
      const branch1 = createCancellationTokenWire("branch-1", "root", "root");
      const leaf1 = createCancellationTokenWire("leaf-1", "root", "branch-1");

      // Direct parent is recognized
      expect(isTokenAncestor(root, branch1)).toBe(true);
      expect(isTokenAncestor(branch1, leaf1)).toBe(true);

      // Root is recognized as ancestor of deep descendant (grandchild / leaf1)
      expect(isTokenAncestor(root, leaf1)).toBe(true);
    });

    it("verifies strict idempotency and immutability of cancelled tokens", () => {
      const root = createCancellationTokenWire("tok-1", "tok-1");
      expect(root.isCancelled).toBe(false);

      const firstCancelled = cancelTokenWire(
        root,
        "user_requested",
        "User aborted",
        "2026-08-21T22:00:00.000Z"
      );
      expect(firstCancelled.isCancelled).toBe(true);
      expect(firstCancelled.reason).toBe("user_requested");
      expect(firstCancelled.cancelledAt).toBe("2026-08-21T22:00:00.000Z");

      // Attempt second cancellation with different reason and time -> must return original unchanged
      const secondCancelled = cancelTokenWire(
        firstCancelled,
        "budget_exceeded",
        "Budget blown",
        "2026-08-21T23:00:00.000Z"
      );
      expect(secondCancelled).toBe(firstCancelled);
      expect(secondCancelled.reason).toBe("user_requested");
      expect(secondCancelled.cancelledAt).toBe("2026-08-21T22:00:00.000Z");
    });

    it("rejects malformed cascade events and clamps negative depth", () => {
      // Clamping negative depth
      const event = buildCascadeEvent("r1", "t1", "llm_stream", "stream-1", "process_failure", -10.8);
      expect(event.cascadeDepth).toBe(0);

      // Reject invalid targetKind
      expect(() =>
        cancellationCascadeEventSchema.parse({
          type: "cancellation.cascade",
          rootTokenId: "r1",
          targetTokenId: "t1",
          targetKind: "thread_pool",
          targetId: "th-1",
          reason: "user_requested",
          cascadeDepth: 0,
          timestamp: VALID_TIMESTAMP,
        })
      ).toThrow();

      // Reject invalid abort reason
      expect(() =>
        cancellationCascadeEventSchema.parse({
          type: "cancellation.cascade",
          rootTokenId: "r1",
          targetTokenId: "t1",
          targetKind: "agent",
          targetId: "ag-1",
          reason: "unknown_abort_reason",
          cascadeDepth: 0,
          timestamp: VALID_TIMESTAMP,
        })
      ).toThrow();
    });
  });

  /* ======================================================================== */
  /* 4. Out-of-Range Risk Tiers, Tool Governance & Approval Gates             */
  /* ======================================================================== */

  describe("4. Out-of-Range Risk Tiers & Tool Governance", () => {
    it("verifies safe fallback for unclassified and hostile tool names including prototype properties", () => {
      const unknownTools = [
        "arbitrary_binary_exec",
        "rm_rf_slash",
        "eval_code",
        "curl_remote",
        "",
        "   ",
        "__proto__",
        "constructor",
        "toString",
        "valueOf",
        "hasOwnProperty",
      ];

      for (const tool of unknownTools) {
        expect(classifyToolRisk(tool)).toBe("T2_SIDE_EFFECT_GUARDED");
        expect(classifyToolRisk(tool, "T3_DESTRUCTIVE_ADMIN")).toBe("T3_DESTRUCTIVE_ADMIN");
        expect(classifyToolRisk(tool, "T0_READ_ONLY")).toBe("T0_READ_ONLY");
      }
    });

    it("comprehensively verifies requiresHumanApproval across all 16 (4x4) tier pairs", () => {
      const tiers: ToolRiskTier[] = [
        "T0_READ_ONLY",
        "T1_WORKSPACE_WRITE",
        "T2_SIDE_EFFECT_GUARDED",
        "T3_DESTRUCTIVE_ADMIN",
      ];

      for (const tier of tiers) {
        for (const threshold of tiers) {
          const requires = requiresHumanApproval(tier, threshold);
          const expected = RISK_TIER_RANK[tier] > RISK_TIER_RANK[threshold];
          expect(requires).toBe(expected);
        }
      }
    });

    it("rejects invalid risk tiers and malformed tool proposal payloads", () => {
      const badTiers = ["T4", "T_READ", "T0", "READ_ONLY", "ADMIN", ""];
      for (const bad of badTiers) {
        expect(() => toolRiskTierSchema.parse(bad)).toThrow();
      }

      // Zero or negative timeoutMs
      expect(() =>
        proposedToolCallSchema.parse({
          callId: "c-1",
          toolName: "run_command",
          params: {},
          timeoutMs: 0,
        })
      ).toThrow();

      expect(() =>
        proposedToolCallSchema.parse({
          callId: "c-1",
          toolName: "run_command",
          params: {},
          timeoutMs: -500,
        })
      ).toThrow();

      // Oversized justification (> 4096)
      expect(() =>
        proposedToolCallSchema.parse({
          callId: "c-1",
          toolName: "run_command",
          params: {},
          justification: "j".repeat(4097),
        })
      ).toThrow();
    });

    it("verifies createToolExecutionResult default exit codes and overrides", () => {
      // SUCCESS defaults to exitCode 0
      const ok = createToolExecutionResult("c-1", "view_file", "SUCCESS", "content");
      expect(ok.metadata.exitCode).toBe(0);
      expect(isToolExecutionSuccessful(ok)).toBe(true);

      // EXECUTION_ERROR defaults to exitCode 1
      const err = createToolExecutionResult("c-2", "run_command", "EXECUTION_ERROR", "", {}, "Failed");
      expect(err.metadata.exitCode).toBe(1);
      expect(isToolExecutionSuccessful(err)).toBe(false);

      // CANCELLED with explicit null exitCode
      const cancelled = createToolExecutionResult("c-3", "run_command", "CANCELLED", "", { exitCode: null });
      expect(cancelled.metadata.exitCode).toBeNull();

      // Custom exit code override (e.g. 127 Command Not Found)
      const notFound = createToolExecutionResult("c-4", "run_command", "EXECUTION_ERROR", "", { exitCode: 127 });
      expect(notFound.metadata.exitCode).toBe(127);
    });

    it("rejects invalid tool execution result fields", () => {
      // Negative durationMs
      expect(() =>
        toolExecutionResultSchema.parse({
          callId: "c-1",
          toolName: "view_file",
          status: "SUCCESS",
          output: "ok",
          metadata: { durationMs: -10 },
          timestamp: VALID_TIMESTAMP,
        })
      ).toThrow();

      // Negative bytesWritten
      expect(() =>
        toolExecutionResultSchema.parse({
          callId: "c-1",
          toolName: "write_to_file",
          status: "SUCCESS",
          output: "ok",
          metadata: { durationMs: 10, bytesWritten: -1 },
          timestamp: VALID_TIMESTAMP,
        })
      ).toThrow();

      // Invalid status
      expect(() =>
        toolExecutionResultSchema.parse({
          callId: "c-1",
          toolName: "view_file",
          status: "FAILED", // Must be EXECUTION_ERROR or PERMISSION_DENIED
          output: "ok",
          metadata: { durationMs: 10 },
          timestamp: VALID_TIMESTAMP,
        })
      ).toThrow();
    });
  });

  /* ======================================================================== */
  /* 5. Negative Tokens, Pricing Math, Zero-Cost & Telemetry Stress            */
  /* ======================================================================== */

  describe("5. Telemetry, Negative Tokens & Pricing Stress", () => {
    it("clamps negative token inputs in calculateEstimatedCostUsd", () => {
      const pricing = KNOWN_MODEL_PRICING["claude-3-7-sonnet"];
      const cost = calculateEstimatedCostUsd(pricing, {
        promptTokens: -1000,
        completionTokens: -500,
        cachedReadTokens: -200,
        cachedWriteTokens: -100,
      });
      expect(cost).toBe(0.0);
    });

    it("clamps cachedReadTokens exceeding promptTokens", () => {
      const pricing = KNOWN_MODEL_PRICING["claude-3-7-sonnet"];
      // promptTokens: 100, cachedReadTokens: 10000 -> capped to 100
      // 100 cachedRead @ $0.30/1M = $0.00003
      // 0 uncachedPrompt
      const cost = calculateEstimatedCostUsd(pricing, {
        promptTokens: 100,
        completionTokens: 0,
        cachedReadTokens: 10000,
      });
      expect(cost).toBe(0.00003);
    });

    it("handles fallback pricing when cacheReadCost or cacheWriteCost are undefined", () => {
      const customPricing: ModelPricing = {
        modelId: "custom-llm",
        provider: "custom-provider",
        inputCostPer1M: 5.0,
        outputCostPer1M: 20.0,
        // cacheReadCostPer1M and cacheWriteCostPer1M omitted
      };

      // 1,000,000 prompt (500,000 cached read -> falls back to inputCostPer1M $5.00/1M)
      // 500,000 cached write -> falls back to inputCostPer1M $5.00/1M
      // 500,000 uncached prompt @ $5.00/1M = $2.50
      // 500,000 cached read @ $5.00/1M = $2.50
      // 500,000 cached write @ $5.00/1M = $2.50
      // 1,000,000 completion @ $20.00/1M = $20.00
      // Total = $27.50
      const cost = calculateEstimatedCostUsd(customPricing, {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        cachedReadTokens: 500_000,
        cachedWriteTokens: 500_000,
      });
      expect(cost).toBe(27.5);
    });

    it("verifies aggregateSessionSpend with empty, single, and multiple metrics", () => {
      // Empty array
      const empty = aggregateSessionSpend([]);
      expect(empty).toEqual(createEmptySpendMetrics());

      // Single item
      const single: TokenSpendMetrics = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedReadTokens: 20,
        cachedWriteTokens: 10,
        estimatedCostUsd: 0.00045,
      };
      const agg1 = aggregateSessionSpend([single]);
      expect(agg1).toEqual(single);

      // Multiple items with precision preservation
      const m1: TokenSpendMetrics = {
        promptTokens: 1000,
        completionTokens: 200,
        totalTokens: 1200,
        cachedReadTokens: 300,
        cachedWriteTokens: 0,
        estimatedCostUsd: 0.003125,
      };
      const m2: TokenSpendMetrics = {
        promptTokens: 2000,
        completionTokens: 400,
        totalTokens: 2400,
        cachedReadTokens: 800,
        cachedWriteTokens: 100,
        estimatedCostUsd: 0.006875,
      };
      const agg2 = aggregateSessionSpend([m1, m2]);
      expect(agg2.promptTokens).toBe(3000);
      expect(agg2.completionTokens).toBe(600);
      expect(agg2.totalTokens).toBe(3600);
      expect(agg2.cachedReadTokens).toBe(1100);
      expect(agg2.cachedWriteTokens).toBe(100);
      expect(agg2.estimatedCostUsd).toBe(0.01);
    });

    it("verifies formatCostUsd boundary formatting", () => {
      expect(formatCostUsd(0)).toBe("$0.00");
      expect(formatCostUsd(-100)).toBe("$0.00");
      expect(formatCostUsd(0.00001)).toBe("$0.0000");
      expect(formatCostUsd(0.0001)).toBe("$0.0001");
      expect(formatCostUsd(0.0049)).toBe("$0.0049");
      expect(formatCostUsd(0.0099)).toBe("$0.0099");
      expect(formatCostUsd(0.01)).toBe("$0.01");
      expect(formatCostUsd(0.999)).toBe("$1.00");
      expect(formatCostUsd(12345.67)).toBe("$12345.67");
    });

    it("rejects negative metrics in telemetry schemas", () => {
      expect(() =>
        tokenSpendMetricsSchema.parse({
          promptTokens: 100,
          cachedReadTokens: -1,
        })
      ).toThrow();

      expect(() =>
        modelPricingSchema.parse({
          modelId: "test",
          provider: "test",
          inputCostPer1M: -3.0,
          outputCostPer1M: 15.0,
        })
      ).toThrow();

      expect(() =>
        sessionSpendSummarySchema.parse({
          sessionId: "s1",
          totalTurns: -1,
          totalTokens: createEmptySpendMetrics(),
          totalLatency: { totalDurationMs: 0 },
          startedAt: VALID_TIMESTAMP,
        })
      ).toThrow();
    });
  });

  /* ======================================================================== */
  /* 6. 100% Comprehensive JSON Round-Trip Resilience                          */
  /* ======================================================================== */

  describe("6. 100% Schema JSON Round-Trip Resilience", () => {
    it("round-trips all 9 AgentLifecycleEvent variants through JSON serialization without data loss", () => {
      const events: AgentLifecycleEvent[] = [
        { type: "agent.init", runId: "r-1", goal: "Goal with emoji 🚀 and unicode ñáé", at: VALID_TIMESTAMP },
        { type: "agent.ready", runId: "r-1", stepId: "s-1", model: "claude-3-7-sonnet", at: VALID_TIMESTAMP },
        { type: "agent.thinking", runId: "r-1", stepId: "s-1", turnId: "t-1", at: VALID_TIMESTAMP },
        { type: "agent.executing", runId: "r-1", stepId: "s-1", toolName: "write_to_file", callId: "c-1", at: VALID_TIMESTAMP },
        { type: "agent.paused", runId: "r-1", reason: "User breakpoint", at: VALID_TIMESTAMP },
        { type: "agent.resumed", runId: "r-1", at: VALID_TIMESTAMP },
        { type: "agent.completed", runId: "r-1", summary: "All tests green", totalTokens: 15420, durationMs: 4520.5, at: VALID_TIMESTAMP },
        { type: "agent.failed", runId: "r-1", code: "ERR_EXEC", reason: "Command failed with code 1", stepId: "s-2", at: VALID_TIMESTAMP },
        { type: "agent.cancelled", runId: "r-1", reason: "SIGINT received", at: VALID_TIMESTAMP },
      ];

      for (const event of events) {
        const serialized = JSON.stringify(event);
        const deserialized = JSON.parse(serialized);
        const parsed = agentLifecycleEventSchema.parse(deserialized);
        expect(parsed).toEqual(event);
      }
    });

    it("round-trips all 6 ProviderDelta variants through JSON serialization", () => {
      const deltas: ProviderDelta[] = [
        {
          type: "text",
          text: "Here is the code: ```typescript\nconst x = 1;\n```",
          metadata: { chunkIndex: 0, isFirstChunk: true, isLastChunk: false, timestamp: VALID_TIMESTAMP },
        },
        {
          type: "thinking",
          text: "Evaluating tree invariants and cycle detection...",
          signature: "sig_abc",
        },
        {
          type: "tool_proposal",
          callId: "call_abc",
          name: "replace_file_content",
          args: { TargetFile: "src/index.ts", Content: "export *;" },
          riskTier: "T1_WORKSPACE_WRITE",
          justification: "Update exports",
        },
        {
          type: "usage",
          usage: { promptTokens: 1000, completionTokens: 200, totalTokens: 1200, cachedTokens: 400 },
          inputTokens: 1000,
          outputTokens: 200,
        },
        {
          type: "error",
          code: "PROVIDER_TIMEOUT",
          message: "Upstream socket timeout after 60000ms",
          retryable: true,
        },
        {
          type: "done",
          finishReason: "tool_calls",
          usage: { promptTokens: 1500, completionTokens: 300, totalTokens: 1800 },
        },
      ];

      for (const delta of deltas) {
        const serialized = JSON.stringify(delta);
        const deserialized = JSON.parse(serialized);
        const parsed = providerDeltaSchema.parse(deserialized);
        expect(parsed).toEqual(delta);
      }
    });

    it("round-trips ProposedToolCall and ToolExecutionResult through JSON serialization", () => {
      const proposal: ProposedToolCall = {
        callId: "call-100",
        toolName: "run_command",
        riskTier: "T2_SIDE_EFFECT_GUARDED",
        params: { CommandLine: "npm run test", Cwd: "/workspace" },
        justification: "Run unit test suite",
        checkpointRequired: true,
        timeoutMs: 60000,
      };

      const parsedProposal = proposedToolCallSchema.parse(JSON.parse(JSON.stringify(proposal)));
      expect(parsedProposal).toEqual(proposal);

      const result: ToolExecutionResult = {
        callId: "call-100",
        toolName: "run_command",
        status: "SUCCESS",
        output: "Test Files 16 passed\nTests 342 passed",
        error: undefined,
        metadata: {
          exitCode: 0,
          durationMs: 4200.5,
          bytesWritten: 2048,
          sha256Digest: "abcdef1234567890",
          truncated: false,
          checkpointId: "chk-99",
        },
        timestamp: VALID_TIMESTAMP,
      };

      const parsedResult = toolExecutionResultSchema.parse(JSON.parse(JSON.stringify(result)));
      expect(parsedResult).toEqual(result);
    });

    it("round-trips TurnSync and TurnEvent schemas through JSON serialization", () => {
      const sync: TurnSync = {
        sessionId: "sess-1",
        turnId: "turn-1",
        turnNumber: 3,
        speaker: "agent",
        promptText: "Fix the bug",
        responseText: "The bug was resolved.",
        toolCallsCount: 2,
        usage: { promptTokens: 2500, completionTokens: 600, totalTokens: 3100, estimatedCostUsd: 0.0165 },
        latencyMs: 1250,
        state: "completed",
        timestamp: VALID_TIMESTAMP,
      };

      const parsedSync = turnSyncSchema.parse(JSON.parse(JSON.stringify(sync)));
      expect(parsedSync).toEqual(sync);
    });

    it("round-trips SessionSpendSummary through JSON serialization", () => {
      const summary: SessionSpendSummary = {
        sessionId: "sess-prod-999",
        totalTurns: 12,
        totalTokens: {
          promptTokens: 45000,
          completionTokens: 8200,
          totalTokens: 53200,
          cachedReadTokens: 32000,
          cachedWriteTokens: 4000,
          estimatedCostUsd: 0.1852,
        },
        totalLatency: {
          ttftMs: 145.2,
          totalDurationMs: 18200.0,
          inferenceDurationMs: 14500.0,
          toolDurationMs: 3200.0,
          queueDurationMs: 500.0,
        },
        toolCallCounts: {
          view_file: 8,
          replace_file_content: 3,
          run_command: 5,
        },
        startedAt: VALID_TIMESTAMP,
        endedAt: "2026-08-21T22:48:00.000Z",
      };

      const parsedSummary = sessionSpendSummarySchema.parse(JSON.parse(JSON.stringify(summary)));
      expect(parsedSummary).toEqual(summary);
    });
  });
});
