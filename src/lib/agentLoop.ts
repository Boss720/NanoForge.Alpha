import type { Message, Patch } from "@/types";

/**
 * Multi-turn edit-verify loop (roadmap Task 2.2).
 *
 * The loop is driven structurally from `App.tsx`:
 *
 *   1. User applies a patch in LIVE mode.
 *   2. `handlePatchDecision` asks `shouldAutoVerify`; if allowed, it sends a
 *      verification turn built by `verificationPrompt` as a message pair
 *      flagged `auto: true` (roles user/assistant, so they stay in the wire
 *      context — the history filter only drops role === "system").
 *   3. When the verification reply finishes, `extractPatch` (Task 2.1) runs on
 *      it. If the reply contains LGTM and no follow-up diff
 *      (`shouldStopLoop`), the loop is done. If it emits a follow-up diff,
 *      that diff is attached as a new PENDING patch and the loop pauses —
 *      auto-turns only ever fire on a user "apply", so the user stays in
 *      control of every mutation.
 *   4. Applying the follow-up patch starts another verification turn, until
 *      `countAutoTurns` reaches `MAX_AUTO_TURNS`, after which
 *      `shouldAutoVerify` refuses further auto-turns.
 *
 * The loop NEVER fires in demo mode or when a patch is rejected — both are
 * gated inside `shouldAutoVerify`.
 */

/** Hard cap on verification turns per session (roadmap: 2). */
export const MAX_AUTO_TURNS = 2;

/** Demo runs scripted content; only "live" turns may trigger auto-verification. */
export type AgentMode = "live" | "demo";

/**
 * True when applying a patch should trigger an automatic verification turn.
 * Requires: the patch was APPLIED (never on reject/pending), the app is in
 * LIVE mode (never demo), and the per-session auto-turn budget remains.
 */
export function shouldAutoVerify(
  patchStatus: Patch["status"],
  mode: AgentMode,
  autoTurnsUsed: number,
  maxAutoTurns: number = MAX_AUTO_TURNS,
): boolean {
  if (patchStatus !== "applied") return false;
  if (mode !== "live") return false;
  return autoTurnsUsed < maxAutoTurns;
}

/** The verification-turn prompt sent after a patch is applied. */
export function verificationPrompt(file: string, content: string): string {
  return `Patch applied to \`${file}\`. New content:\n\`\`\`\n${content}\n\`\`\`\nReview for breakage; reply \`LGTM\` or emit a follow-up diff.`;
}

/** True when the model's verification reply says the change is good. */
export function isLgtm(reply: string): boolean {
  return /\bLGTM\b/i.test(reply);
}

/**
 * True when the loop should stop after a verification reply: the model
 * approved the change (LGTM) and did NOT emit a follow-up diff. A follow-up
 * diff always wins over an LGTM mention — it becomes a new pending patch.
 */
export function shouldStopLoop(reply: string, patch: Patch | null): boolean {
  return patch === null && isLgtm(reply);
}

/**
 * Number of auto-turns already spent in a session, derived from the
 * transcript: each verification turn contributes exactly one user message
 * flagged `auto: true`.
 */
export function countAutoTurns(messages: Message[]): number {
  return messages.reduce((n, m) => (m.auto && m.role === "user" ? n + 1 : n), 0);
}
