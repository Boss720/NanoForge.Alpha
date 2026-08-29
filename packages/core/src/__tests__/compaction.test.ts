import { describe, it, expect } from "vitest";
import {
  ContextCompactor,
} from "../compaction/compaction";
import {
  Scratchpad,
  serializeScratchpad,
  parseScratchpad,
} from "../compaction/scratchpad";
import {
  estimateTokens,
  estimateMessagesTokens,
} from "../compaction/tokenEstimator";
import type { ChatMessage } from "../providers/types";

describe("Compaction & Scratchpad Subsystem", () => {
  describe("tokenEstimator", () => {
    it("estimates tokens for text and message payloads", () => {
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens("Hello world")).toBeGreaterThan(0);

      const msg: ChatMessage = { role: "user", content: "Implement ReAct state machine in TypeScript" };
      const tokens = estimateMessagesTokens([msg]);
      expect(tokens).toBeGreaterThan(5);
    });
  });

  describe("Scratchpad serialization & parsing", () => {
    it("serializes and parses scratchpad state bidirectionally", () => {
      const scratchpad = new Scratchpad();
      scratchpad.setGoal("Build Core ReAct Kernel");
      const ms1 = scratchpad.addMilestone("Author cancellation token", "completed");
      const ms2 = scratchpad.addMilestone("Wire up FSM transitions", "in_progress");
      scratchpad.addHypothesis("Token cascade finishes in <100ms", true);
      scratchpad.trackFile("packages/core/src/cancellation/cancellationToken.ts", "dirty");

      const xml = scratchpad.serialize();
      expect(xml).toContain("<scratchpad version=\"1.0\">");
      expect(xml).toContain("<goal>Build Core ReAct Kernel</goal>");
      expect(xml).toContain("status=\"completed\"");
      expect(xml).toContain("status=\"in_progress\"");
      expect(xml).toContain("verified=\"true\"");
      expect(xml).toContain("path=\"packages/core/src/cancellation/cancellationToken.ts\"");

      const parsed = parseScratchpad(xml);
      expect(parsed).not.toBeNull();
      expect(parsed?.goal).toBe("Build Core ReAct Kernel");
      expect(parsed?.milestones.length).toBe(2);
      expect(parsed?.hypotheses.length).toBe(1);
      expect(parsed?.hypotheses[0].verified).toBe(true);
      expect(parsed?.activeFiles.length).toBe(1);
      expect(parsed?.activeFiles[0].status).toBe("dirty");
    });

    it("handles parsing empty or invalid XML gracefully", () => {
      expect(parseScratchpad("")).toBeNull();
      expect(parseScratchpad("<invalid>xml</invalid>")).toBeNull();
    });
  });

  describe("ContextCompactor 75% sliding window", () => {
    it("does not compact when context is below 75% threshold", async () => {
      const compactor = new ContextCompactor({
        contextLimitTokens: 10_000,
        triggerThresholdRatio: 0.75,
      });

      const messages: ChatMessage[] = [
        { role: "system", content: "You are NanoForge" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "How can I help?" },
      ];

      expect(compactor.needsCompaction(messages)).toBe(false);

      const result = await compactor.compact(messages);
      expect(result.compacted).toBe(false);
      expect(result.messages.length).toBe(3);
    });

    it("triggers compaction when estimated tokens exceed 75% limit", async () => {
      const compactor = new ContextCompactor({
        contextLimitTokens: 100, // Small limit to trigger compaction
        triggerThresholdRatio: 0.75,
        recentTurnsToKeep: 1,
      });

      // Construct history with system, pinned file, Turn 0, 4 intermediate turns, and recent 1 turn
      const largeContent = "Large log output of tool execution with lots of detailed traces and files ".repeat(15);

      const messages: ChatMessage[] = [
        { role: "system", content: "You are NanoForge" },
        { role: "user", content: "@pinned File manifest with types" },
        { role: "user", content: "Turn 0: Main Goal" },
        // Intermediate Turn 1
        { role: "assistant", content: "Calling tool 1" },
        { role: "tool", name: "list_dir", content: largeContent },
        // Intermediate Turn 2
        { role: "assistant", content: "Calling tool 2" },
        { role: "tool", name: "grep_search", content: largeContent },
        // Recent Turn (preserved)
        { role: "assistant", content: "Calling recent tool" },
        { role: "tool", name: "view_file", content: "Recent file content" },
      ];

      expect(compactor.needsCompaction(messages)).toBe(true);

      const result = await compactor.compact(messages);
      expect(result.compacted).toBe(true);
      expect(result.reclaimedTokens).toBeGreaterThan(0);
      expect(result.compactedEstimatedTokens).toBeLessThan(result.originalEstimatedTokens);

      // Verify Preservation Layer:
      // 1. System message preserved
      expect(result.messages.some((m) => m.role === "system")).toBe(true);
      // 2. @pinned message preserved
      expect(result.messages.some((m) => m.content.includes("@pinned"))).toBe(true);
      // 3. Turn 0 user goal preserved
      expect(result.messages.some((m) => m.content === "Turn 0: Main Goal")).toBe(true);
      // 4. Summary block inserted
      expect(result.messages.some((m) => m.content.includes("<context_summary>"))).toBe(true);
      // 5. Recent turn preserved
      expect(result.messages.some((m) => m.content === "Recent file content")).toBe(true);
    });
  });
});
