/**
 * CLI Type Definitions & Exit Codes — Module 3.
 *
 * Strict POSIX Exit Codes:
 * 0 - Success
 * 1 - Failure (runtime / execution / tool failure)
 * 2 - Policy violation (policy engine denied action)
 * 3 - Cancelled (aborted by user / signal / timeout cancellation)
 * 4 - Approval denied / timeout (fail-closed non-interactive or explicit denial)
 * 5 - Config / Auth error (missing/invalid token, daemon unreachable, bad CLI args)
 * 6 - Verification failed (plan DAG validation error, cycle, schema violation)
 */

import type { ExecutionPlan } from "@protocol/plan";
import type { RunEvent } from "../runs/events";
import type { RunSummary } from "../runs/coordinator";

export const EXIT_CODES = {
  SUCCESS: 0,
  FAILURE: 1,
  POLICY_VIOLATION: 2,
  CANCELLED: 3,
  APPROVAL_DENIED: 4,
  CONFIG_AUTH: 5,
  VERIFICATION_FAILED: 6,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export type AutoApproveMode = "none" | "safe" | "all";
export type OutputFormat = "human" | "json" | "ndjson";

export interface GlobalCLIOptions {
  noColor?: boolean;
  help?: boolean;
  version?: boolean;
}

export interface RunCommandOptions extends GlobalCLIOptions {
  prompt: string;
  json?: boolean;
  ndjson?: boolean;
  format?: OutputFormat;
  output?: string;
  autoApprove?: AutoApproveMode;
  timeout?: number; // seconds
  token?: string;
  host?: string;
  workspaceRoot?: string;
  planFile?: string;
}

export interface PlanCommandOptions extends GlobalCLIOptions {
  goal: string;
  json?: boolean;
  output?: string;
  workspaceRoot?: string;
}

export interface CLIResult {
  exitCode: ExitCode;
  message?: string;
  summary?: RunSummary;
  plan?: ExecutionPlan;
  events?: readonly RunEvent[];
}

export interface StreamEventOptions {
  onEvent?: (event: RunEvent) => void;
  onState?: (state: string, detail?: string) => void;
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
  onError?: (error: { code: string; message: string }) => void;
}
