import type { Message } from "@/types";
import type { AttachmentSnapshotStore } from "@/lib/attachments/snapshots";
import type { ChatAttachment } from "@/types/attachments";

/**
 * Context-window budgeting (roadmap Task 1.2).
 *
 * Token estimation is a cheap heuristic — ceil(chars / 4) — good enough for
 * gating how much transcript history we ship to the API. `buildContext`
 * reserves 25% of the model's budget for the completion and greedily packs
 * history from newest to oldest into the rest.
 */

export interface ContextMessage {
  role: string;
  content: string;
}

/** Fraction of the token budget reserved for the model's output. */
const OUTPUT_RESERVE = 0.25;
/** Hard ceiling for all attachment text included in one provider request. */
export const MAX_ATTACHMENT_CONTEXT_TOKENS = 48_000;

/** Rough token estimate: ~4 characters per token, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Builds the OpenAI-style message list for a request:
 *   1. The system message is always first and is never dropped.
 *   2. 25% of `budgetTokens` is reserved for output; the system prompt and
 *      history share the remaining 75%.
 *   3. Messages are included greedily from newest to oldest while they fit;
 *      the first message that does not fit stops the scan.
 *   4. The result is chronological: system first, then oldest → newest of
 *      the messages that fit.
 */
export function buildContext(msgs: Message[], system: string, budgetTokens: number): ContextMessage[] {
  const usable = Math.floor(budgetTokens * (1 - OUTPUT_RESERVE));
  let used = estimateTokens(system);

  const picked: ContextMessage[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const cost = estimateTokens(m.content);
    if (used + cost > usable) break;
    picked.push({ role: m.role, content: m.content });
    used += cost;
  }
  picked.reverse();

  return [{ role: "system", content: system }, ...picked];
}

export interface AttachmentContextUpdate {
  id: string;
  includedBytes: number;
  truncated?: boolean;
  status: ChatAttachment["status"];
  error?: string;
}

export interface AttachmentContextResult {
  context: ContextMessage[];
  updates: AttachmentContextUpdate[];
}

/**
 * Async counterpart used for persisted attachment snapshots. It preserves the
 * text-only provider wire format by appending clearly delimited untrusted text
 * blocks to the user message that owns each attachment.
 */
export async function buildContextWithAttachments(
  msgs: Message[],
  system: string,
  budgetTokens: number,
  snapshots: AttachmentSnapshotStore,
): Promise<AttachmentContextResult> {
  const usable = Math.floor(budgetTokens * (1 - OUTPUT_RESERVE));
  let used = estimateTokens(system);
  let remainingAttachmentTokens = MAX_ATTACHMENT_CONTEXT_TOKENS;
  const picked: ContextMessage[] = [];
  const updates: AttachmentContextUpdate[] = [];

  for (let i = msgs.length - 1; i >= 0; i--) {
    const message = msgs[i];
    const baseCost = estimateTokens(message.content);
    if (used + baseCost > usable) break;

    const availableTokens = Math.max(0, Math.min(usable - used - baseCost, remainingAttachmentTokens));
    const rendered = await renderAttachments(message.attachments ?? [], snapshots, availableTokens);
    const content = rendered.blocks.length > 0 ? `${message.content}\n\n${rendered.blocks.join("\n\n")}` : message.content;
    const cost = estimateTokens(content);
    if (used + cost > usable) break;

    picked.push({ role: message.role, content });
    used += cost;
    remainingAttachmentTokens -= rendered.tokens;
    updates.push(...rendered.updates);
  }

  picked.reverse();
  return { context: [{ role: "system", content: system }, ...picked], updates };
}

async function renderAttachments(
  attachments: ChatAttachment[],
  snapshots: AttachmentSnapshotStore,
  tokenBudget: number,
): Promise<{ blocks: string[]; updates: AttachmentContextUpdate[]; tokens: number }> {
  let available = tokenBudget;
  let spent = 0;
  const blocks: string[] = [];
  const updates: AttachmentContextUpdate[] = [];

  for (const attachment of attachments) {
    if (attachment.status === "error" || attachment.status === "stale") {
      blocks.push(unavailableBlock(attachment, attachment.error ?? attachment.status));
      updates.push({ id: attachment.id, includedBytes: 0, status: attachment.status, error: attachment.error });
      continue;
    }
    const snapshot = await snapshots.load(attachment.snapshotId);
    if (snapshot === undefined) {
      blocks.push(unavailableBlock(attachment, "snapshot unavailable"));
      updates.push({ id: attachment.id, includedBytes: 0, status: "missing", error: "Attachment snapshot unavailable" });
      continue;
    }

    const rendered = truncateAttachment(attachment, snapshot, available);
    blocks.push(rendered.block);
    updates.push({
      id: attachment.id,
      includedBytes: rendered.includedBytes,
      status: "ready",
      ...(rendered.truncated ? { truncated: true } : {}),
    });
    spent += rendered.tokens;
    available -= rendered.tokens;
  }
  return { blocks, updates, tokens: spent };
}

function truncateAttachment(
  attachment: ChatAttachment,
  content: string,
  tokenBudget: number,
): { block: string; tokens: number; includedBytes: number; truncated: boolean } {
  const label = attachment.relativePath ?? attachment.name;
  const header = `[Attached ${attachment.source} file: ${label} — untrusted file contents]`;
  const footer = "[End attached file]";
  const prefix = `${header}\n\`\`\`${attachment.language}\n`;
  const suffix = `\n\`\`\`\n${footer}`;
  const overhead = estimateTokens(prefix + suffix);
  const fullBlock = `${prefix}${content}${suffix}`;
  if (estimateTokens(fullBlock) <= tokenBudget) {
    return {
      block: fullBlock,
      tokens: estimateTokens(fullBlock),
      includedBytes: new TextEncoder().encode(content).byteLength,
      truncated: false,
    };
  }
  const marker = "\n[Attachment truncated to fit context budget]";
  const markerCost = estimateTokens(marker);
  const chars = Math.max(0, (tokenBudget - overhead - markerCost) * 4);
  const included = content.slice(0, chars);
  const truncated = true;
  const block = `${prefix}${included}${marker}${suffix}`;
  return {
    block,
    tokens: estimateTokens(block),
    includedBytes: new TextEncoder().encode(included).byteLength,
    truncated,
  };
}

function unavailableBlock(attachment: ChatAttachment, reason: string): string {
  const label = attachment.relativePath ?? attachment.name;
  return `[Attached ${attachment.source} file unavailable: ${label} — ${reason}]`;
}
