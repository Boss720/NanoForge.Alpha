/**
 * Fast Isomorphic Heuristic Token Estimator.
 *
 * Estimates token counts for strings, message payloads, and transcript history
 * without requiring native C++/WASM dependencies.
 */

import type { ChatMessage } from "../providers/types";

/**
 * Fast heuristic token estimation for arbitrary text.
 * Average English/code text is approx ~3.8-4.0 characters per token.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  // Split on whitespace and count word boundaries + punctuation heuristics
  const length = text.length;
  // Base character-to-token ratio
  const baseTokens = Math.ceil(length / 3.8);

  // Bonus tokens for special code/XML punctuation
  const specialChars = (text.match(/[{}\[\]()<>\/\\=;:,`"'\n]/g) || []).length;
  const punctuationBonus = Math.floor(specialChars * 0.15);

  return Math.max(1, baseTokens + punctuationBonus);
}

export function estimateMessageTokens(message: ChatMessage): number {
  let count = 4; // Base per-message framing overhead (<|im_start|>role\n ... <|im_end|>)
  if (message.content) {
    count += estimateTokens(message.content);
  }
  if (message.name) {
    count += estimateTokens(message.name) + 1;
  }
  if (message.toolCallId) {
    count += estimateTokens(message.toolCallId) + 1;
  }
  return count;
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 3; // Priming tokens
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}
