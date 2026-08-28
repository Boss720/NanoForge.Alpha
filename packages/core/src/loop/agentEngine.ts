/**
 * Headless Autonomous ReAct Agent Engine.
 *
 * Implements the full execution coordinator managing session state,
 * lifecycle events, cancellation cascade, spend tracking, compaction,
 * and multi-turn ReAct reasoning loops.
 */

import {
  type AgentLifecycleEvent,
  type TurnEvent,
} from "@nanoforge/protocol";
import { CancellationTokenSource, CancellationError } from "../cancellation/cancellationToken";
import { ContextCompactor } from "../compaction/compaction";
import { PromptComposer, type PromptContext } from "../prompt/composer";
import type { ChatMessage, ProviderAdapter } from "../providers/types";
import { SpendTracker } from "../telemetry/spendTracker";
import { PolicyGate } from "../tools/policyGate";
import type { ToolRegistry } from "../tools/registry";
import { ReActFSM } from "./fsm";
import { executeReActTurn } from "./reactLoop";
import type { AgentEngineOptions, RunResult, TurnResult } from "./types";

function generateRunId(): string {
  return `run_${crypto.randomUUID()}`;
}

export class AgentEngine {
  private readonly _provider: ProviderAdapter;
  private readonly _toolRegistry: ToolRegistry;
  private readonly _policyGate: PolicyGate;
  private readonly _composer: PromptComposer;
  private readonly _compactor: ContextCompactor;
  private readonly _spendTracker: SpendTracker;
  private readonly _fsm: ReActFSM;
  private readonly _options: AgentEngineOptions;

  constructor(options: AgentEngineOptions) {
    this._options = options;
    this._provider = options.provider;
    this._toolRegistry = options.toolRegistry;
    this._policyGate = new PolicyGate({
      autoApproveUpTo: options.autoApproveUpTo ?? "T0_READ_ONLY",
      ...options.securityPolicy,
    });
    this._composer = new PromptComposer({
      workspaceRoot: options.workspaceRoot,
      systemPrompt: options.systemPrompt,
      defaultRules: options.defaultRules,
    });
    this._spendTracker = new SpendTracker(
      options.model || options.provider.defaultModel,
      {
        maxTurns: options.maxTurns ?? 50,
        maxBudgetUsd: options.maxBudgetUsd ?? 10.0,
        maxDurationMs: options.maxDurationMs,
      }
    );
    this._compactor = new ContextCompactor({
      contextLimitTokens: options.contextLimitTokens ?? options.provider.getContextLimits(options.model).maxInputTokens,
      triggerThresholdRatio: 0.75,
      recentTurnsToKeep: 2,
    });
    this._fsm = new ReActFSM("IDLE");
  }

  get fsm(): ReActFSM {
    return this._fsm;
  }

  get spendTracker(): SpendTracker {
    return this._spendTracker;
  }

  get toolRegistry(): ToolRegistry {
    return this._toolRegistry;
  }

  get provider(): ProviderAdapter {
    return this._provider;
  }

  async run(
    goal: string,
    rootCts?: CancellationTokenSource
  ): Promise<RunResult> {
    const runId = generateRunId();
    const sessionId = this._options.sessionId || `sess_${Date.now()}`;
    const cts = rootCts || new CancellationTokenSource();
    const token = cts.token;
    const startMs = Date.now();

    const turns: TurnResult[] = [];
    let finalResponse = "";

    // 1. Emit agent.init
    this.emitLifecycle({
      type: "agent.init",
      runId,
      goal,
      sessionId,
      at: new Date().toISOString(),
    });

    // 2. Emit agent.ready
    this.emitLifecycle({
      type: "agent.ready",
      runId,
      model: this._options.model || this._provider.defaultModel,
      at: new Date().toISOString(),
    });

    // Initial conversation message history
    let messages: ChatMessage[] = [
      {
        role: "user",
        content: goal,
      },
    ];

    const turnContext: PromptContext = {
      workspaceRoot: this._options.workspaceRoot,
      systemPrompt: this._options.systemPrompt,
      defaultRules: this._options.defaultRules,
      pinnedFiles: this._options.pinnedFiles,
      scratchpad: this._options.scratchpad,
    };

    let turnNumber = 1;
    const maxTurns = this._options.maxTurns ?? 50;

    try {
      while (turnNumber <= maxTurns) {
        token.throwIfCancelled();

        // Emit thinking lifecycle
        this.emitLifecycle({
          type: "agent.thinking",
          runId,
          turnId: `turn_${turnNumber}`,
          at: new Date().toISOString(),
        });

        // Execute single ReAct turn
        const { turnResult, updatedMessages, shouldContinue } = await executeReActTurn({
          runId,
          sessionId,
          turnNumber,
          fsm: this._fsm,
          provider: this._provider,
          toolRegistry: this._toolRegistry,
          policyGate: this._policyGate,
          composer: this._composer,
          compactor: this._compactor,
          spendTracker: this._spendTracker,
          messages,
          turnContext,
          model: this._options.model,
          rootCts: cts,
          onTurnEvent: this._options.onTurnEvent,
        });

        turns.push(turnResult);
        messages = updatedMessages;

        if (turnResult.assistantText) {
          finalResponse = turnResult.assistantText;
        }

        // Check if tools were executed and emit executing lifecycle
        if (turnResult.toolCalls.length > 0) {
          for (const tc of turnResult.toolCalls) {
            this.emitLifecycle({
              type: "agent.executing",
              runId,
              toolName: tc.toolName,
              callId: tc.callId,
              at: new Date().toISOString(),
            });
          }
        }

        // If no tool calls were proposed, model produced final response
        if (!shouldContinue) {
          break;
        }

        turnNumber++;
      }

      // STATE: COMPLETED
      this._fsm.transitionTo("COMPLETED", "Goal achieved or execution finished");

      const totalDurationMs = Date.now() - startMs;
      const spendSummary = this._spendTracker.toSummary(sessionId);

      this.emitLifecycle({
        type: "agent.completed",
        runId,
        summary: finalResponse.slice(0, 1000),
        totalTokens: spendSummary.totalTokens.totalTokens,
        durationMs: totalDurationMs,
        at: new Date().toISOString(),
      });

      return {
        runId,
        sessionId,
        status: "completed",
        finalResponse,
        turns,
        spendSummary,
        totalDurationMs,
      };
    } catch (err: any) {
      const totalDurationMs = Date.now() - startMs;
      const spendSummary = this._spendTracker.toSummary(sessionId);

      if (token.isCancellationRequested || err instanceof CancellationError) {
        this._fsm.transitionTo("CANCELLED", err.message || "Operation cancelled");
        this.emitLifecycle({
          type: "agent.cancelled",
          runId,
          reason: err.message || "Operation cancelled",
          at: new Date().toISOString(),
        });

        return {
          runId,
          sessionId,
          status: "cancelled",
          finalResponse,
          turns,
          spendSummary,
          error: err.message || "Operation cancelled",
          totalDurationMs,
        };
      }

      this._fsm.transitionTo("FAILED", err.message || String(err));
      this.emitLifecycle({
        type: "agent.failed",
        runId,
        code: err.name || "AGENT_EXECUTION_ERROR",
        reason: err.message || String(err),
        at: new Date().toISOString(),
      });

      return {
        runId,
        sessionId,
        status: "failed",
        finalResponse,
        turns,
        spendSummary,
        error: err.message || String(err),
        totalDurationMs,
      };
    }
  }

  private emitLifecycle(event: AgentLifecycleEvent): void {
    if (this._options.onLifecycleEvent) {
      try {
        this._options.onLifecycleEvent(event);
      } catch {
        // Safe callback execution
      }
    }
  }
}
