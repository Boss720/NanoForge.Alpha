/**
 * POSIX Exit Code Resolution & Helpers.
 */

import type { RunEvent } from "../runs/events";
import type { RunSummary, RunTerminalState } from "../runs/coordinator";
import { EXIT_CODES, type ExitCode } from "./types";

export { EXIT_CODES, type ExitCode };

export function exitCodeDescription(code: ExitCode): string {
  switch (code) {
    case EXIT_CODES.SUCCESS:
      return "Success";
    case EXIT_CODES.FAILURE:
      return "Failure";
    case EXIT_CODES.POLICY_VIOLATION:
      return "Policy violation";
    case EXIT_CODES.CANCELLED:
      return "Cancelled";
    case EXIT_CODES.APPROVAL_DENIED:
      return "Approval denied / timeout";
    case EXIT_CODES.CONFIG_AUTH:
      return "Configuration / Authentication error";
    case EXIT_CODES.VERIFICATION_FAILED:
      return "Verification / Validation failed";
    default:
      return `Unknown exit code (${code})`;
  }
}

/**
 * Maps a coordinator terminal summary or event stream to the strict POSIX exit code.
 */
export function resolveExitCode(
  summary?: RunSummary | { status: RunTerminalState; reason?: string },
  events?: readonly RunEvent[],
): ExitCode {
  if (!summary) {
    return EXIT_CODES.FAILURE;
  }

  if (summary.status === "completed") {
    return EXIT_CODES.SUCCESS;
  }

  if (summary.status === "cancelled") {
    return EXIT_CODES.CANCELLED;
  }

  const reason = (summary.reason ?? "").toLowerCase();

  // Inspect event stream for the most specific terminal cause
  if (events && events.length > 0) {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.type === "policy.decision" && ev.decision === "deny") {
        return EXIT_CODES.POLICY_VIOLATION;
      }
      if (ev.type === "approval.denied") {
        return EXIT_CODES.APPROVAL_DENIED;
      }
      if (ev.type === "plan.validated" && !ev.ok) {
        return EXIT_CODES.VERIFICATION_FAILED;
      }
    }
  }

  // Inspect reason string for classification
  if (
    reason.includes("policy denied") ||
    reason.includes("policy violation") ||
    reason.includes("forbidden")
  ) {
    return EXIT_CODES.POLICY_VIOLATION;
  }

  if (
    reason.includes("approval denied") ||
    reason.includes("approval expired") ||
    reason.includes("approval timeout") ||
    reason.includes("approval required") ||
    reason.includes("non-interactive refusal")
  ) {
    return EXIT_CODES.APPROVAL_DENIED;
  }

  if (
    reason.includes("plan validation failed") ||
    reason.includes("validation error") ||
    reason.includes("cycle detected") ||
    reason.includes("verification failed")
  ) {
    return EXIT_CODES.VERIFICATION_FAILED;
  }

  if (
    reason.includes("unauthorized") ||
    reason.includes("token") ||
    reason.includes("connection refused") ||
    reason.includes("config")
  ) {
    return EXIT_CODES.CONFIG_AUTH;
  }

  return EXIT_CODES.FAILURE;
}
