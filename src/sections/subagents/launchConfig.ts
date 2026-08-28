import type { WorkspaceIsolationMode } from "@protocol/subagents";
import { MAX_CONCURRENT_SUBAGENTS } from "@protocol/subagents";

export interface LaunchValidationInput {
  missionGoal: string;
  roles: string[];
  timeoutSeconds: number;
  budgetTokens: string;
  workspaceIsolation: WorkspaceIsolationMode;
  concurrency: number;
  activeCount: number;
}

export function validateLaunchSettings(input: LaunchValidationInput): string[] {
  const errors: string[] = [];
  const budget = Number(input.budgetTokens);

  if (!input.missionGoal.trim()) errors.push("Mission goal is required.");
  if (input.roles.filter(Boolean).length === 0) errors.push("Choose at least one role.");
  if (!Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 60 || input.timeoutSeconds > 7200) {
    errors.push("Timeout must be between 60 and 7200 seconds.");
  }
  if (!Number.isInteger(budget) || budget <= 0) {
    errors.push("Token budget must be a positive whole number.");
  }
  if (!Number.isInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > MAX_CONCURRENT_SUBAGENTS) {
    errors.push(`Concurrency must be between 1 and ${MAX_CONCURRENT_SUBAGENTS}.`);
  } else if (input.activeCount + input.concurrency > MAX_CONCURRENT_SUBAGENTS) {
    errors.push("Concurrency exceeds the available subagent slots.");
  }

  return errors;
}

export function formatLaunchIsolation(mode: WorkspaceIsolationMode): string {
  if (mode === "branch") return "Branch worktree";
  if (mode === "share") return "Shared scratch";
  return "Inherited workspace";
}
