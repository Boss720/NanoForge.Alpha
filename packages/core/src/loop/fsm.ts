/**
 * 12-State Finite State Machine (FSM) for Autonomous ReAct Loop.
 *
 * Implements deterministic state transitions, entry/exit guards, and transition logging:
 * IDLE -> PROMPT_SYNTH -> BUDGET_CHECK -> (COMPACTING) -> MODEL_STREAM
 * -> PARSE_OUTPUT -> (TOOL_PROPOSAL -> POLICY_GATE -> AWAITING_AUTH -> EXECUTING_TOOL)
 * -> EVAL_OBSERVATION -> COMPLETED / (loop to PROMPT_SYNTH)
 */

import type { LoopState } from "./types";

export interface StateTransitionRecord {
  from: LoopState;
  to: LoopState;
  timestamp: string;
  reason?: string;
}

export const VALID_LOOP_TRANSITIONS: Readonly<Record<LoopState, ReadonlySet<LoopState>>> = {
  IDLE: new Set(["PROMPT_SYNTH", "CANCELLED", "FAILED"]),
  PROMPT_SYNTH: new Set(["BUDGET_CHECK", "CANCELLED", "FAILED"]),
  BUDGET_CHECK: new Set(["COMPACTING", "MODEL_STREAM", "CANCELLED", "FAILED"]),
  COMPACTING: new Set(["MODEL_STREAM", "CANCELLED", "FAILED"]),
  MODEL_STREAM: new Set(["PARSE_OUTPUT", "CANCELLED", "FAILED"]),
  PARSE_OUTPUT: new Set(["TOOL_PROPOSAL", "EVAL_OBSERVATION", "CANCELLED", "FAILED"]),
  TOOL_PROPOSAL: new Set(["POLICY_GATE", "CANCELLED", "FAILED"]),
  POLICY_GATE: new Set(["AWAITING_AUTH", "EXECUTING_TOOL", "EVAL_OBSERVATION", "CANCELLED", "FAILED"]),
  AWAITING_AUTH: new Set(["EXECUTING_TOOL", "EVAL_OBSERVATION", "CANCELLED", "FAILED"]),
  EXECUTING_TOOL: new Set(["EVAL_OBSERVATION", "CANCELLED", "FAILED"]),
  EVAL_OBSERVATION: new Set(["PROMPT_SYNTH", "COMPLETED", "CANCELLED", "FAILED"]),
  COMPLETED: new Set([]),
  CANCELLED: new Set([]),
  FAILED: new Set([]),
};

export class ReActFSM {
  private _state: LoopState = "IDLE";
  private readonly _history: StateTransitionRecord[] = [];
  private readonly _listeners = new Set<(transition: StateTransitionRecord) => void>();

  constructor(initialState: LoopState = "IDLE") {
    this._state = initialState;
  }

  get state(): LoopState {
    return this._state;
  }

  get isTerminal(): boolean {
    return this._state === "COMPLETED" || this._state === "CANCELLED" || this._state === "FAILED";
  }

  get history(): ReadonlyArray<StateTransitionRecord> {
    return this._history;
  }

  canTransitionTo(nextState: LoopState): boolean {
    if (this._state === nextState) return true;
    const allowed = VALID_LOOP_TRANSITIONS[this._state];
    return allowed ? allowed.has(nextState) : false;
  }

  transitionTo(nextState: LoopState, reason?: string): void {
    if (this._state === nextState) return; // Idempotent

    if (!this.canTransitionTo(nextState)) {
      throw new Error(
        `Invalid FSM transition: cannot transition from "${this._state}" to "${nextState}".`
      );
    }

    const record: StateTransitionRecord = {
      from: this._state,
      to: nextState,
      timestamp: new Date().toISOString(),
      reason,
    };

    this._state = nextState;
    this._history.push(record);

    for (const listener of Array.from(this._listeners)) {
      try {
        listener(record);
      } catch {
        // Safe callback execution
      }
    }
  }

  onTransition(listener: (transition: StateTransitionRecord) => void): { dispose(): void } {
    this._listeners.add(listener);
    return {
      dispose: () => this._listeners.delete(listener),
    };
  }

  reset(): void {
    this._state = "IDLE";
    this._history.length = 0;
  }
}
