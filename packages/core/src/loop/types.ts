/**
 * ReAct Execution Loop & Agent Engine Types.
 *
 * Defines the 12-state FSM states, event hooks, turn results, and engine options.
 */

import type {
  AgentLifecycleEvent,
  ProposedToolCall,
  SessionSpendSummary,
  TokenUsage,
  ToolExecutionResult,
  ToolRiskTier,
  TurnEvent,
} from "@nanoforge/protocol";
import type { CancellationTokenSource } from "../cancellation/cancellationToken";
import type { ProviderAdapter } from "../providers/types";
import type { ToolRegistry } from "../tools/registry";
import type { PolicyGateOptions } from "../tools/policyGate";
import type { PinnedFile } from "../prompt/composer";
import type { ScratchpadState } from "../compaction/scratchpad";

export type LoopState =
  | "IDLE"
  | "PROMPT_SYNTH"
  | "BUDGET_CHECK"
  | "COMPACTING"
  | "MODEL_STREAM"
  | "PARSE_OUTPUT"
  | "TOOL_PROPOSAL"
  | "POLICY_GATE"
  | "AWAITING_AUTH"
  | "EXECUTING_TOOL"
  | "EVAL_OBSERVATION"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export interface AgentEngineOptions {
  provider: ProviderAdapter;
  toolRegistry: ToolRegistry;
  workspaceRoot: string;
  model?: string;
  sessionId?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  maxDurationMs?: number;
  autoApproveUpTo?: ToolRiskTier;
  securityPolicy?: PolicyGateOptions;
  systemPrompt?: string;
  defaultRules?: string[];
  pinnedFiles?: PinnedFile[];
  scratchpad?: ScratchpadState;
  contextLimitTokens?: number;
  onLifecycleEvent?: (event: AgentLifecycleEvent) => void;
  onTurnEvent?: (event: TurnEvent) => void;
}

export interface TurnResult {
  turnNumber: number;
  turnId: string;
  assistantText: string;
  thinkingText?: string;
  toolCalls: ProposedToolCall[];
  toolResults: ToolExecutionResult[];
  usage?: TokenUsage;
  durationMs: number;
}

export interface RunResult {
  runId: string;
  sessionId: string;
  status: "completed" | "failed" | "cancelled";
  finalResponse: string;
  turns: TurnResult[];
  spendSummary: SessionSpendSummary;
  error?: string;
  totalDurationMs: number;
}
