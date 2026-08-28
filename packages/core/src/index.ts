/**
 * @nanoforge/core — Headless Autonomous ReAct Agent Kernel.
 *
 * Provides pure isomorphic ReAct execution loop, pluggable LLM provider adapters,
 * hierarchical cancellation trees, 75% sliding-window context compaction,
 * spend tracking, and tool risk governance.
 */

// 1. Core Engine & ReAct Loop
export { AgentEngine } from "./loop/agentEngine";
export { executeReActTurn, type ReActTurnOptions } from "./loop/reactLoop";
export { ReActFSM, VALID_LOOP_TRANSITIONS, type StateTransitionRecord } from "./loop/fsm";
export type {
  AgentEngineOptions,
  LoopState,
  RunResult,
  TurnResult,
} from "./loop/types";

// 2. Prompt Composition & XML Context Synthesizer
export {
  PromptComposer,
  DEFAULT_NANOFORGE_SYSTEM_PROMPT,
  type PromptContext,
  type PinnedFile,
} from "./prompt/composer";
export {
  escapeXml,
  unescapeXml,
  formatXmlTag,
  extractXmlTag,
  extractAllXmlTags,
} from "./prompt/xmlFormatter";

// 3. Compaction & Scratchpad
export {
  Scratchpad,
  serializeScratchpad,
  parseScratchpad,
  createEmptyScratchpad,
  type ScratchpadState,
  type Milestone,
  type MilestoneStatus,
  type Hypothesis,
  type ActiveFileState,
  type FileMutationStatus,
} from "./compaction/scratchpad";
export {
  ContextCompactor,
  type CompactionConfig,
  type CompactionResult,
} from "./compaction/compaction";
export {
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
} from "./compaction/tokenEstimator";

// 4. Pluggable LLM Providers
export { ProviderFactory, type ProviderFactoryFn } from "./providers/factory";
export { AnthropicClaudeAdapter } from "./providers/anthropic";
export { OpenAIAdapter } from "./providers/openai";
export { OllamaAdapter } from "./providers/ollama";
export { BaseProviderAdapter, streamSseDataLines, streamSseEvents, type SseEvent } from "./providers/base";
export type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderConfig,
  ChatRequest,
  ChatMessage,
  ChatRole,
  ToolDefinition,
  ContextLimits,
} from "./providers/types";

// 5. Hierarchical Cancellation Engine
export {
  CancellationTokenSource,
  CancellationError,
  type CancellationToken,
  type CancellationTokenSubscription,
} from "./cancellation/cancellationToken";
export {
  terminateProcessTree,
  type ProcessLike,
  type TerminateProcessOptions,
} from "./cancellation/processKiller";

// 6. Tool Registry & Policy Gate
export { ToolRegistry } from "./tools/registry";
export { PolicyGate, type PolicyGateOptions } from "./tools/policyGate";
export { zodToJsonSchemaShim } from "./tools/types";
export type { Tool, ToolExecutionContext } from "./tools/types";

// 7. Telemetry & Spend Accounting
export {
  SpendTracker,
  BudgetExceededError,
  type BudgetGuardConfig,
  type BudgetGuardType,
} from "./telemetry/spendTracker";
export {
  lookupModelPricing,
  estimateUsageCost,
  DEFAULT_FALLBACK_PRICING,
} from "./telemetry/pricing";

// Core Version
export const CORE_VERSION = "0.1.0";
