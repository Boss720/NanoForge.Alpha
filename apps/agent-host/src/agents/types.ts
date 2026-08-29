/**
 * Subagent Lifecycle Engine — Internal Types & Interfaces.
 */
import type {
  SubagentArchetype,
  SubagentState,
  WorkspaceIsolationMode,
  SubagentInfo,
  SubagentConfig,
  SubagentMessage,
  SubagentLifecycleEvent,
  SubagentTelemetry,
} from "@protocol/subagents";

export interface SubagentNode {
  id: string;
  parentId: string | null;
  name: string;
  archetype: SubagentArchetype;
  roles: string[];
  systemPrompt?: string;
  model?: string;
  /** Absolute host-only path used to execute the subagent. Never publish this over the browser protocol. */
  assignedWorkspaceRoot?: string;
  /** Project-relative directory suitable for the browser protocol ("." for the active workspace). */
  workingDirectory: string;
  metadataDir: string;
  worktreePath?: string;
  scratchDir?: string;
  isolationMode: WorkspaceIsolationMode;
  allowedTools?: string[];
  allowedToolKinds?: string[];
  budgetTokens?: number;
  tokensUsed: number;
  turnCount: number;
  telemetry?: SubagentTelemetry;
  state: SubagentState;
  startedAt: string;
  completedAt?: string;
  lastHeartbeat: string;
  lastProgressSummary?: string;
  exitCode?: number;
  error?: string;
  handoffArtifact?: string;
  abortController: AbortController;
  skills: string[];
  environmentVariables?: Record<string, string>;
}

export type SubagentLifecycleListener = (event: SubagentLifecycleEvent) => void;

export type EscalationRung = "retry" | "replace" | "skip" | "redistribute" | "degrade";

export interface EscalationDecision {
  rung: EscalationRung;
  subagentId: string;
  reason: string;
  actionSummary: string;
  replacementSubagentId?: string;
}
