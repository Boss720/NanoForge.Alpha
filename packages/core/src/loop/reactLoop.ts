/**
 * ReAct Execution Turn Runner.
 *
 * Implements a single deterministic turn cycle in the 12-state FSM:
 * Prompt Synth -> Budget Check -> (Compacting) -> Model Stream -> Parse Output
 * -> Tool Proposal -> Policy Gate -> (Awaiting Auth) -> Executing Tool -> Eval Observation
 */

import {
  createProposedToolCall,
  createToolExecutionResult,
  type ProposedToolCall,
  type TokenUsage,
  type ToolExecutionResult,
  type TurnEvent,
  type JsonValue,
} from "@nanoforge/protocol";
import type { CancellationTokenSource } from "../cancellation/cancellationToken";
import type { ContextCompactor } from "../compaction/compaction";
import type { PromptComposer, PromptContext } from "../prompt/composer";
import type { ChatMessage, ProviderAdapter, ToolDefinition } from "../providers/types";
import type { SpendTracker } from "../telemetry/spendTracker";
import type { PolicyGate } from "../tools/policyGate";
import type { ToolRegistry } from "../tools/registry";
import type { ReActFSM } from "./fsm";
import type { TurnResult } from "./types";

export interface ReActTurnOptions {
  runId: string;
  sessionId: string;
  turnNumber: number;
  fsm: ReActFSM;
  provider: ProviderAdapter;
  toolRegistry: ToolRegistry;
  policyGate: PolicyGate;
  composer: PromptComposer;
  compactor: ContextCompactor;
  spendTracker: SpendTracker;
  messages: ChatMessage[];
  turnContext: PromptContext;
  model?: string;
  rootCts: CancellationTokenSource;
  onTurnEvent?: (event: TurnEvent) => void;
}

export async function executeReActTurn(options: ReActTurnOptions): Promise<{
  turnResult: TurnResult;
  updatedMessages: ChatMessage[];
  shouldContinue: boolean;
}> {
  const {
    runId,
    sessionId,
    turnNumber,
    fsm,
    provider,
    toolRegistry,
    policyGate,
    composer,
    compactor,
    spendTracker,
    messages,
    turnContext,
    model,
    rootCts,
    onTurnEvent,
  } = options;

  const startMs = Date.now();
  const turnId = `turn_${turnNumber}_${Date.now()}`;

  rootCts.token.throwIfCancelled();

  // 1. STATE: PROMPT_SYNTH
  fsm.transitionTo("PROMPT_SYNTH", `Synthesizing prompt for turn #${turnNumber}`);
  const turnMessages = composer.assembleTurnMessages(messages, turnContext);

  // 2. STATE: BUDGET_CHECK
  fsm.transitionTo("BUDGET_CHECK", "Checking token spend and budget thresholds");
  spendTracker.checkBudgetGuards();

  let activeMessages = turnMessages;

  // 3. STATE: COMPACTING (Conditional: >= 75% context limit)
  if (compactor.needsCompaction(activeMessages)) {
    fsm.transitionTo("COMPACTING", "Context window exceeded 75% threshold; running compaction");
    const compactionResult = await compactor.compact(activeMessages);
    if (compactionResult.compacted) {
      activeMessages = compactionResult.messages;
    }
  }

  // 4. STATE: MODEL_STREAM
  fsm.transitionTo("MODEL_STREAM", "Streaming inference from LLM provider adapter");
  const streamCts = rootCts.createChild();

  let assistantText = "";
  let thinkingText = "";
  const proposedToolCalls: ProposedToolCall[] = [];
  let turnUsage: TokenUsage | undefined;

  // Emit turn.started
  onTurnEvent?.({
    type: "turn.started",
    sessionId,
    turnId,
    turnNumber,
    speaker: "agent",
    timestamp: new Date().toISOString(),
  });

  const toolDefs: ToolDefinition[] = toolRegistry.getToolDefinitions();

  try {
    const stream = provider.streamChat(
      {
        model: model || provider.defaultModel,
        messages: activeMessages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        ephemeralCaching: true,
      },
      streamCts.token
    );

    for await (const delta of stream) {
      rootCts.token.throwIfCancelled();

      // Emit turn delta event
      onTurnEvent?.({
        type: "turn.delta",
        sessionId,
        turnId,
        delta,
        timestamp: new Date().toISOString(),
      });

      if (delta.type === "text") {
        assistantText += delta.text;
      } else if (delta.type === "thinking") {
        thinkingText += delta.text;
      } else if (delta.type === "tool_proposal") {
        const toolName = delta.name;
        const toolObj = toolRegistry.get(toolName);
        const riskTier = delta.riskTier || (toolObj ? toolObj.riskTier : "T2_SIDE_EFFECT_GUARDED");

        proposedToolCalls.push(
          createProposedToolCall(
            delta.callId || `call_${crypto.randomUUID()}`,
            toolName,
            typeof delta.args === "object" && delta.args !== null ? (delta.args as Record<string, JsonValue>) : {},
            { riskTier, justification: delta.justification }
          )
        );
      } else if (delta.type === "usage") {
        if (delta.usage) {
          turnUsage = delta.usage;
          spendTracker.recordTurnUsage({
            promptTokens: delta.usage.promptTokens,
            completionTokens: delta.usage.completionTokens,
            cachedReadTokens: delta.usage.cachedReadTokens,
            cachedWriteTokens: delta.usage.cachedWriteTokens,
          });
        }
      }
    }
  } finally {
    streamCts.dispose();
  }

  // 5. STATE: PARSE_OUTPUT
  fsm.transitionTo("PARSE_OUTPUT", "Parsing model output & checking for tool proposals");

  const toolResults: ToolExecutionResult[] = [];
  const updatedMessages = [...activeMessages];

  // Append assistant message to history
  if (assistantText || proposedToolCalls.length > 0) {
    updatedMessages.push({
      role: "assistant",
      content: assistantText,
    });
  }

  if (proposedToolCalls.length > 0) {
    // 6. STATE: TOOL_PROPOSAL
    fsm.transitionTo("TOOL_PROPOSAL", `Evaluating ${proposedToolCalls.length} tool proposal(s)`);

    for (const toolCall of proposedToolCalls) {
      rootCts.token.throwIfCancelled();

      // 7. STATE: POLICY_GATE
      fsm.transitionTo("POLICY_GATE", `Evaluating security risk tier for "${toolCall.toolName}"`);
      const decision = await policyGate.evaluate(toolCall, runId);

      let allowedToExecute = false;

      if (decision.verdict === "ALLOW_ALWAYS" || decision.verdict === "ALLOW_ONCE") {
        allowedToExecute = true;
      } else if (decision.verdict === "PROMPT_USER") {
        // 8. STATE: AWAITING_AUTH
        fsm.transitionTo("AWAITING_AUTH", `Awaiting human authorization for tool "${toolCall.toolName}"`);
        // If defaultAction is ALLOW, proceed, else deny
        if (decision.defaultAction === "ALLOW") {
          allowedToExecute = true;
        } else {
          allowedToExecute = false;
        }
      } else {
        allowedToExecute = false;
      }

      if (!allowedToExecute) {
        const denialReason =
          decision.verdict === "PROMPT_USER"
            ? decision.promptMessage
            : decision.reason || "Operation rejected by policy";

        const deniedResult = createToolExecutionResult(
          toolCall.callId,
          toolCall.toolName,
          "PERMISSION_DENIED",
          `Permission denied: ${denialReason}`,
          { exitCode: 126, durationMs: 0 },
          denialReason
        );
        toolResults.push(deniedResult);
        continue;
      }

      // 9. STATE: EXECUTING_TOOL
      fsm.transitionTo("EXECUTING_TOOL", `Executing tool "${toolCall.toolName}"`);
      spendTracker.recordToolCall(toolCall.toolName);

      const toolCts = rootCts.createChild();
      try {
        const execResult = await toolRegistry.executeTool(
          toolCall.toolName,
          toolCall.params,
          {
            workspaceRoot: turnContext.workspaceRoot || process.cwd?.() || ".",
            cancellationToken: toolCts.token,
            callId: toolCall.callId,
            turnIndex: turnNumber,
            sessionId,
          }
        );
        toolResults.push(execResult);
      } finally {
        toolCts.dispose();
      }
    }

    // 10. STATE: EVAL_OBSERVATION
    fsm.transitionTo("EVAL_OBSERVATION", "Synthesizing tool observation feedback into transcript");

    for (const result of toolResults) {
      const formattedOutput = composer.formatToolOutput(result);
      updatedMessages.push({
        role: "tool",
        name: result.toolName,
        toolCallId: result.callId,
        content: formattedOutput,
      });
    }
  } else {
    // No tool calls: final text response produced
    fsm.transitionTo("EVAL_OBSERVATION", "Model produced final response text with no further tool calls");
  }

  const durationMs = Date.now() - startMs;
  const turnResult: TurnResult = {
    turnNumber,
    turnId,
    assistantText,
    thinkingText: thinkingText || undefined,
    toolCalls: proposedToolCalls,
    toolResults,
    usage: turnUsage,
    durationMs,
  };

  // Emit turn.completed
  onTurnEvent?.({
    type: "turn.completed",
    sessionId,
    turnId,
    turn: {
      sessionId,
      turnId,
      turnNumber,
      speaker: "agent",
      promptText: undefined,
      responseText: assistantText,
      toolCallsCount: proposedToolCalls.length,
      usage: turnUsage,
      latencyMs: durationMs,
      state: "completed",
      timestamp: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  });

  // Loop continues if there were tool calls that produced observations
  const shouldContinue = proposedToolCalls.length > 0;

  return {
    turnResult,
    updatedMessages,
    shouldContinue,
  };
}
