import { describe, expect, it } from "vitest";
import {
  accumulateTokenUsage,
  chunkMetadataSchema,
  createTokenUsage,
  finishReasonSchema,
  isTerminalDelta,
  providerDeltaSchema,
  tokenUsageSchema,
  turnEventSchema,
  turnSpeakerSchema,
  turnStateSchema,
  turnSyncSchema,
  type ChunkMetadata,
  type FinishReason,
  type ProviderDelta,
  type TokenUsage,
  type TurnEvent,
  type TurnSpeaker,
  type TurnState,
  type TurnSync,
} from "../stream";

describe("Streaming Deltas & Turn Protocol", () => {
  const timestamp = "2026-08-21T22:30:00.000Z";

  describe("Finish Reason & Chunk Metadata Schemas", () => {
    it("validates all supported finish reasons", () => {
      const reasons: FinishReason[] = [
        "stop",
        "tool_calls",
        "length",
        "content_filter",
        "abort",
        "timeout",
      ];
      for (const reason of reasons) {
        expect(finishReasonSchema.parse(reason)).toBe(reason);
      }
    });

    it("rejects unsupported finish reasons", () => {
      expect(() => finishReasonSchema.parse("invalid_reason")).toThrow();
      expect(() => finishReasonSchema.parse(null)).toThrow();
    });

    it("validates valid chunk metadata with defaults", () => {
      const raw = {
        chunkIndex: 0,
        timestamp,
      };
      const parsed = chunkMetadataSchema.parse(raw);
      expect(parsed.chunkIndex).toBe(0);
      expect(parsed.isFirstChunk).toBe(false);
      expect(parsed.isLastChunk).toBe(false);
      expect(parsed.timestamp).toBe(timestamp);
    });

    it("validates complete chunk metadata with latency and model info", () => {
      const meta: ChunkMetadata = {
        chunkIndex: 3,
        isFirstChunk: false,
        isLastChunk: true,
        timestamp,
        latencyMs: 142.5,
        model: "claude-3-7-sonnet",
        provider: "anthropic",
      };
      const parsed = chunkMetadataSchema.parse(meta);
      expect(parsed).toEqual(meta);
    });

    it("rejects negative chunkIndex or invalid timestamp", () => {
      expect(() =>
        chunkMetadataSchema.parse({
          chunkIndex: -1,
          timestamp,
        })
      ).toThrow();

      expect(() =>
        chunkMetadataSchema.parse({
          chunkIndex: 0,
          timestamp: "invalid-time",
        })
      ).toThrow();
    });
  });

  describe("Token Usage Schema & Pure Helpers", () => {
    it("parses valid token usage with defaults", () => {
      const parsed = tokenUsageSchema.parse({});
      expect(parsed.promptTokens).toBe(0);
      expect(parsed.completionTokens).toBe(0);
      expect(parsed.totalTokens).toBe(0);
      expect(parsed.cachedTokens).toBeUndefined();
    });

    it("rejects negative token counts in tokenUsageSchema", () => {
      expect(() =>
        tokenUsageSchema.parse({
          promptTokens: -10,
        })
      ).toThrow();
    });

    it("createTokenUsage helper clamps negative numbers to 0 and computes total", () => {
      const usage = createTokenUsage(-5, 100, -20, -1.5);
      expect(usage.promptTokens).toBe(0);
      expect(usage.completionTokens).toBe(100);
      expect(usage.totalTokens).toBe(100);
      expect(usage.cachedTokens).toBe(0);
      expect(usage.estimatedCostUsd).toBe(0);
    });

    it("createTokenUsage helper builds standard usage object", () => {
      const usage = createTokenUsage(1200, 450, 300, 0.0125);
      expect(usage).toEqual({
        promptTokens: 1200,
        completionTokens: 450,
        totalTokens: 1650,
        cachedTokens: 300,
        estimatedCostUsd: 0.0125,
      });
    });

    it("accumulateTokenUsage combines base and delta accurately", () => {
      const base: TokenUsage = {
        promptTokens: 1000,
        completionTokens: 200,
        totalTokens: 1200,
        cachedTokens: 150,
        cachedReadTokens: 100,
        cachedWriteTokens: 50,
        estimatedCostUsd: 0.005,
      };

      const delta: TokenUsage = {
        promptTokens: 500,
        completionTokens: 100,
        totalTokens: 600,
        cachedTokens: 50,
        cachedReadTokens: 40,
        cachedWriteTokens: 10,
        estimatedCostUsd: 0.002,
      };

      const accumulated = accumulateTokenUsage(base, delta);
      expect(accumulated.promptTokens).toBe(1500);
      expect(accumulated.completionTokens).toBe(300);
      expect(accumulated.totalTokens).toBe(1800);
      expect(accumulated.cachedTokens).toBe(200);
      expect(accumulated.cachedReadTokens).toBe(140);
      expect(accumulated.cachedWriteTokens).toBe(60);
      expect(accumulated.estimatedCostUsd).toBeCloseTo(0.007);
    });
  });

  describe("ProviderDelta Discriminated Union", () => {
    it("parses text delta (including empty string text)", () => {
      const delta: ProviderDelta = {
        type: "text",
        text: "Hello world",
        metadata: {
          chunkIndex: 0,
          isFirstChunk: true,
          isLastChunk: false,
          timestamp,
        },
      };
      const parsed = providerDeltaSchema.parse(delta);
      expect(parsed).toEqual(delta);
      expect(isTerminalDelta(parsed)).toBe(false);

      const emptyText = providerDeltaSchema.parse({ type: "text", text: "" });
      expect(emptyText.type).toBe("text");
    });

    it("parses thinking delta with reasoning signature", () => {
      const delta: ProviderDelta = {
        type: "thinking",
        text: "Let me consider the invariants...",
        signature: "sig_abc123",
      };
      const parsed = providerDeltaSchema.parse(delta);
      expect(parsed).toEqual(delta);
      expect(isTerminalDelta(parsed)).toBe(false);
    });

    it("parses tool_proposal delta with custom risk tier and arguments", () => {
      const delta: ProviderDelta = {
        type: "tool_proposal",
        callId: "call-1",
        name: "replace_file_content",
        args: { filePath: "src/index.ts", content: "export *" },
        riskTier: "T1_WORKSPACE_WRITE",
        justification: "Export new modules",
      };
      const parsed = providerDeltaSchema.parse(delta);
      expect(parsed).toEqual(delta);
      expect(isTerminalDelta(parsed)).toBe(false);
    });

    it("parses usage delta with both structured usage and loose token counters", () => {
      const delta: ProviderDelta = {
        type: "usage",
        usage: {
          promptTokens: 1500,
          completionTokens: 300,
          totalTokens: 1800,
        },
        inputTokens: 1500,
        outputTokens: 300,
      };
      const parsed = providerDeltaSchema.parse(delta);
      expect(parsed).toEqual(delta);
      expect(isTerminalDelta(parsed)).toBe(false);
    });

    it("parses error delta and marks it as terminal", () => {
      const delta: ProviderDelta = {
        type: "error",
        code: "RATE_LIMIT_EXCEEDED",
        message: "Anthropic rate limit reached. Backing off.",
        retryable: true,
      };
      const parsed = providerDeltaSchema.parse(delta);
      expect(parsed).toEqual(delta);
      expect(isTerminalDelta(parsed)).toBe(true);
    });

    it("parses done delta with finish reason and marks it as terminal", () => {
      const delta: ProviderDelta = {
        type: "done",
        finishReason: "tool_calls",
        usage: {
          promptTokens: 2000,
          completionTokens: 400,
          totalTokens: 2400,
        },
      };
      const parsed = providerDeltaSchema.parse(delta);
      expect(parsed).toEqual(delta);
      expect(isTerminalDelta(parsed)).toBe(true);
    });

    it("rejects delta with unknown type tag", () => {
      expect(() =>
        providerDeltaSchema.parse({
          type: "unknown_delta_type",
        })
      ).toThrow();
    });
  });

  describe("Turn Synchronization & Turn Events", () => {
    it("validates all turn speakers and turn states", () => {
      const speakers: TurnSpeaker[] = ["user", "agent", "tool", "system"];
      for (const speaker of speakers) {
        expect(turnSpeakerSchema.parse(speaker)).toBe(speaker);
      }

      const states: TurnState[] = [
        "started",
        "thinking",
        "executing",
        "completed",
        "interrupted",
        "error",
      ];
      for (const state of states) {
        expect(turnStateSchema.parse(state)).toBe(state);
      }
    });

    it("validates and round-trips turnSyncSchema", () => {
      const sync: TurnSync = {
        sessionId: "sess-1",
        turnId: "turn-1",
        turnNumber: 1,
        speaker: "agent",
        promptText: "Please list files",
        responseText: "Here are the files...",
        toolCallsCount: 1,
        usage: {
          promptTokens: 500,
          completionTokens: 100,
          totalTokens: 600,
        },
        latencyMs: 340,
        state: "completed",
        timestamp,
      };

      const parsed = turnSyncSchema.parse(sync);
      expect(parsed).toEqual(sync);
    });

    it("validates and round-trips all turn event types", () => {
      const events: TurnEvent[] = [
        {
          type: "turn.started",
          sessionId: "sess-1",
          turnId: "turn-1",
          turnNumber: 0,
          speaker: "user",
          timestamp,
        },
        {
          type: "turn.delta",
          sessionId: "sess-1",
          turnId: "turn-1",
          delta: {
            type: "text",
            text: "Processing your request...",
          },
          timestamp,
        },
        {
          type: "turn.completed",
          sessionId: "sess-1",
          turnId: "turn-1",
          turn: {
            sessionId: "sess-1",
            turnId: "turn-1",
            turnNumber: 0,
            speaker: "user",
            state: "completed",
            toolCallsCount: 0,
            timestamp,
          },
          timestamp,
        },
        {
          type: "turn.error",
          sessionId: "sess-1",
          turnId: "turn-1",
          code: "TIMEOUT",
          message: "Turn timed out after 30s",
          timestamp,
        },
      ];

      for (const event of events) {
        const parsed = turnEventSchema.parse(JSON.parse(JSON.stringify(event)));
        expect(parsed).toEqual(event);
      }
    });
  });
});
