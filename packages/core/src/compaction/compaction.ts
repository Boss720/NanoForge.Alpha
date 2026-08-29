/**
 * 75% Sliding-Window Context Compaction Engine.
 *
 * Automatically compacts conversation history when estimated tokens reach 75%
 * of model context limit, while strictly preserving immutable system prompts,
 * pinned files, active XML scratchpads, and the initial user goal.
 */

import type { ChatMessage } from "../providers/types";
import { estimateMessagesTokens, estimateTokens } from "./tokenEstimator";
import { parseScratchpad, serializeScratchpad } from "./scratchpad";
import { escapeXml } from "../prompt/xmlFormatter";

export interface CompactionConfig {
  contextLimitTokens: number;
  triggerThresholdRatio?: number; // Default: 0.75
  recentTurnsToKeep?: number;    // Default: 2
  customSummarizer?: (messages: ChatMessage[]) => Promise<string> | string;
}

export interface CompactionResult {
  compacted: boolean;
  originalEstimatedTokens: number;
  compactedEstimatedTokens: number;
  reclaimedTokens: number;
  messages: ChatMessage[];
  summaryBlock?: string;
}

export class ContextCompactor {
  readonly contextLimitTokens: number;
  readonly triggerThresholdRatio: number;
  readonly recentTurnsToKeep: number;
  private readonly _customSummarizer?: (messages: ChatMessage[]) => Promise<string> | string;

  constructor(config: CompactionConfig) {
    this.contextLimitTokens = config.contextLimitTokens;
    this.triggerThresholdRatio = config.triggerThresholdRatio ?? 0.75;
    this.recentTurnsToKeep = config.recentTurnsToKeep ?? 2;
    this._customSummarizer = config.customSummarizer;
  }

  get thresholdTokens(): number {
    return Math.floor(this.contextLimitTokens * this.triggerThresholdRatio);
  }

  needsCompaction(messages: ChatMessage[]): boolean {
    const estimated = estimateMessagesTokens(messages);
    return estimated >= this.thresholdTokens;
  }

  async compact(messages: ChatMessage[]): Promise<CompactionResult> {
    const originalEstimatedTokens = estimateMessagesTokens(messages);

    if (originalEstimatedTokens < this.thresholdTokens || messages.length <= 4) {
      return {
        compacted: false,
        originalEstimatedTokens,
        compactedEstimatedTokens: originalEstimatedTokens,
        reclaimedTokens: 0,
        messages: [...messages],
      };
    }

    // 1. Separate System messages and Pinned messages (0% pruned)
    const systemMessages: ChatMessage[] = [];
    const conversationMessages: ChatMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemMessages.push(msg);
      } else if (msg.content && (msg.content.includes("@pinned") || msg.content.includes("<pinned_files>"))) {
        // Pinned context messages are preserved
        systemMessages.push(msg);
      } else {
        conversationMessages.push(msg);
      }
    }

    if (conversationMessages.length <= this.recentTurnsToKeep * 2 + 1) {
      return {
        compacted: false,
        originalEstimatedTokens,
        compactedEstimatedTokens: originalEstimatedTokens,
        reclaimedTokens: 0,
        messages: [...messages],
      };
    }

    // 2. Partition conversation into:
    // - Turn 0 (First User Request)
    // - Intermediate History (to be summarized)
    // - Recent K Turns (preserved verbatim)
    const turn0UserMessage = conversationMessages[0];
    const tailCount = Math.min(conversationMessages.length - 1, this.recentTurnsToKeep * 2);
    const recentMessages = conversationMessages.slice(conversationMessages.length - tailCount);
    const intermediateMessages = conversationMessages.slice(1, conversationMessages.length - tailCount);

    if (intermediateMessages.length === 0) {
      return {
        compacted: false,
        originalEstimatedTokens,
        compactedEstimatedTokens: originalEstimatedTokens,
        reclaimedTokens: 0,
        messages: [...messages],
      };
    }

    // 3. Extract any active scratchpad from intermediate messages
    let activeScratchpadXml: string | null = null;
    for (let i = intermediateMessages.length - 1; i >= 0; i--) {
      const msg = intermediateMessages[i];
      if (msg.content && msg.content.includes("<scratchpad")) {
        const parsed = parseScratchpad(msg.content);
        if (parsed) {
          activeScratchpadXml = serializeScratchpad(parsed);
          break;
        }
      }
    }

    // 4. Summarize intermediate messages
    let summaryText: string;
    if (this._customSummarizer) {
      summaryText = await this._customSummarizer(intermediateMessages);
    } else {
      summaryText = this.buildDeterministicSummary(intermediateMessages);
    }

    const summaryBlock = [
      `<context_summary>`,
      summaryText,
      activeScratchpadXml ? `\n<active_scratchpad_state>\n${activeScratchpadXml}\n</active_scratchpad_state>` : "",
      `</context_summary>`,
    ].filter(Boolean).join("\n");

    const summaryMessage: ChatMessage = {
      role: "user",
      content: `[Previous execution history compacted due to context window limits]:\n\n${summaryBlock}`,
    };

    // 5. Reassemble compacted transcript
    const compactedMessages: ChatMessage[] = [
      ...systemMessages,
      turn0UserMessage,
      summaryMessage,
      ...recentMessages,
    ];

    const compactedEstimatedTokens = estimateMessagesTokens(compactedMessages);
    const reclaimedTokens = Math.max(0, originalEstimatedTokens - compactedEstimatedTokens);

    return {
      compacted: true,
      originalEstimatedTokens,
      compactedEstimatedTokens,
      reclaimedTokens,
      messages: compactedMessages,
      summaryBlock,
    };
  }

  private buildDeterministicSummary(messages: ChatMessage[]): string {
    const executedTools: Array<{ name: string; status?: string; brief: string }> = [];
    const filesTouched = new Set<string>();
    const keyObservations: string[] = [];

    for (const msg of messages) {
      if (msg.role === "tool" || (msg.name && msg.name.startsWith("tool_"))) {
        const toolName = msg.name || "unknown_tool";
        const brief = msg.content.slice(0, 120).replace(/\s+/g, " ");
        executedTools.push({ name: toolName, brief });

        // Heuristic extraction of touched files
        const pathMatches = msg.content.match(/(?:[a-zA-Z]:[\\\/]|\.\/|\/)[a-zA-Z0-9_\-\.\/]+/g);
        if (pathMatches) {
          for (const p of pathMatches.slice(0, 5)) {
            filesTouched.add(p);
          }
        }
      } else if (msg.role === "assistant" && msg.content) {
        if (msg.content.includes("<hypothesis") || msg.content.includes("Observation:")) {
          keyObservations.push(msg.content.slice(0, 150).replace(/\s+/g, " "));
        }
      }
    }

    const sections: string[] = [];
    sections.push(`- Intermediate turns compacted: ${messages.length} messages.`);

    if (executedTools.length > 0) {
      sections.push(`- Tools executed (${executedTools.length}):`);
      for (const t of executedTools.slice(0, 10)) {
        sections.push(`  * ${escapeXml(t.name)}: ${escapeXml(t.brief)}`);
      }
      if (executedTools.length > 10) {
        sections.push(`  * ... and ${executedTools.length - 10} more tool executions.`);
      }
    }

    if (filesTouched.size > 0) {
      sections.push(`- Files inspected/modified: ${Array.from(filesTouched).slice(0, 10).join(", ")}`);
    }

    if (keyObservations.length > 0) {
      sections.push(`- Key discoveries / observations:`);
      for (const obs of keyObservations.slice(0, 5)) {
        sections.push(`  * ${escapeXml(obs)}`);
      }
    }

    return sections.join("\n");
  }
}
