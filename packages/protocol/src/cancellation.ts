/**
 * Hierarchical Cancellation Wire Protocol & Abort Schemas.
 *
 * Defines the wire representations for tree-structured cancellation tokens,
 * abort reasons, and cascade broadcast frames enabling <100ms cancellation propagation.
 *
 * ZERO Node.js runtime dependencies (pure TypeScript/Zod).
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 1. Abort Reasons & Target Kinds                                    */
/* ------------------------------------------------------------------ */

export const abortReasonSchema = z.enum([
  "user_requested",      // Explicit user cancellation (UI stop button, Ctrl+C)
  "timeout_exceeded",    // Execution or turn budget exceeded
  "budget_exceeded",     // Max spend or token threshold reached
  "parent_cancelled",    // Parent agent/subagent was aborted
  "supervisor_shutdown", // Supervisor policy triggered shutdown
  "process_failure",     // Critical upstream dependency failure
]);
export type AbortReason = z.infer<typeof abortReasonSchema>;

export const cancellationTargetKindSchema = z.enum([
  "agent",
  "subagent",
  "tool",
  "pty",
  "llm_stream",
]);
export type CancellationTargetKind = z.infer<typeof cancellationTargetKindSchema>;

/* ------------------------------------------------------------------ */
/* 2. CancellationTokenWire & Cascade Event Schemas                   */
/* ------------------------------------------------------------------ */

export const cancellationTokenWireSchema = z.object({
  tokenId: z.string().min(1).max(128),
  parentId: z.string().min(1).max(128).nullable().optional(),
  rootId: z.string().min(1).max(128),
  isCancelled: z.boolean().default(false),
  cancelledAt: z.string().datetime().optional(),
  reason: abortReasonSchema.optional(),
  detail: z.string().max(4096).optional(),
});
export type CancellationTokenWire = z.infer<typeof cancellationTokenWireSchema>;

export const cancellationCascadeEventSchema = z.object({
  type: z.literal("cancellation.cascade"),
  rootTokenId: z.string().min(1).max(128),
  targetTokenId: z.string().min(1).max(128),
  targetKind: cancellationTargetKindSchema,
  targetId: z.string().min(1).max(128),
  reason: abortReasonSchema,
  cascadeDepth: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
});
export type CancellationCascadeEvent = z.infer<typeof cancellationCascadeEventSchema>;

/* ------------------------------------------------------------------ */
/* 3. Pure Helper Functions                                           */
/* ------------------------------------------------------------------ */

export function createCancellationTokenWire(
  tokenId: string,
  rootId: string,
  parentId?: string | null
): CancellationTokenWire {
  return {
    tokenId,
    parentId: parentId ?? null,
    rootId,
    isCancelled: false,
  };
}

export function cancelTokenWire(
  token: CancellationTokenWire,
  reason: AbortReason = "user_requested",
  detail?: string,
  now = new Date().toISOString()
): CancellationTokenWire {
  if (token.isCancelled) return token; // Idempotent
  return {
    ...token,
    isCancelled: true,
    cancelledAt: now,
    reason,
    detail: detail ?? token.detail,
  };
}

export function isTokenAncestor(
  ancestor: CancellationTokenWire,
  descendant: CancellationTokenWire
): boolean {
  if (ancestor.tokenId === descendant.tokenId) return true;
  if (descendant.rootId !== ancestor.rootId) return false;
  if (ancestor.tokenId === descendant.rootId) return true;
  return descendant.parentId === ancestor.tokenId;
}

export function buildCascadeEvent(
  rootTokenId: string,
  targetTokenId: string,
  targetKind: CancellationTargetKind,
  targetId: string,
  reason: AbortReason,
  cascadeDepth = 0,
  timestamp = new Date().toISOString()
): CancellationCascadeEvent {
  return {
    type: "cancellation.cascade",
    rootTokenId,
    targetTokenId,
    targetKind,
    targetId,
    reason,
    cascadeDepth: Math.max(0, Math.floor(cascadeDepth)),
    timestamp,
  };
}
