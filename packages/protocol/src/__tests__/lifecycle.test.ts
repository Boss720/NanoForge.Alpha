import { describe, expect, it } from "vitest";
import {
  AGENT_TERMINAL_STATES,
  LIFECYCLE_ERROR_CODES,
  VALID_AGENT_TRANSITIONS,
  agentLifecycleEventSchema,
  agentLifecycleStateSchema,
  canCancelAgent,
  canPauseAgent,
  canResumeAgent,
  isAgentLifecycleActive,
  isAgentLifecycleTerminal,
  isValidAgentStateTransition,
  planSubmitResultSchema,
  runPauseResultSchema,
  runResumeResultSchema,
  runCancelResultSchema,
  approvalGrantResultSchema,
  approvalDenyResultSchema,
  toolResponseResultSchema,
  runLifecycleEventSchema,
  runStateSchema,
  runtimeStateSchema,
  isValidRuntimeTransition,
  isRuntimeOperational,
  isRuntimeTransitioning,
  type AgentLifecycleEvent,
  type AgentLifecycleState,
  type RunLifecycleEvent,
  type RunState,
  type RuntimeState,
} from "../lifecycle";

describe("Agent Lifecycle Wire Protocol", () => {
  describe("Agent & Run Lifecycle Enums", () => {
    it("validates all 9 canonical agent lifecycle states", () => {
      const states: AgentLifecycleState[] = [
        "init",
        "ready",
        "thinking",
        "executing",
        "completed",
        "failed",
        "paused",
        "resumed",
        "cancelled",
      ];

      for (const state of states) {
        expect(agentLifecycleStateSchema.parse(state)).toBe(state);
      }
    });

    it("rejects invalid agent lifecycle state strings", () => {
      const invalidStates = ["idle", "running", "stopped", "unknown", "", 123];
      for (const invalid of invalidStates) {
        expect(() => agentLifecycleStateSchema.parse(invalid)).toThrow();
      }
    });

    it("validates all 6 canonical run states", () => {
      const states: RunState[] = [
        "queued",
        "approval_required",
        "running",
        "done",
        "error",
        "cancelled",
      ];

      for (const state of states) {
        expect(runStateSchema.parse(state)).toBe(state);
      }
    });

    it("rejects invalid run state strings", () => {
      const invalidStates = ["init", "executing", "finished", "aborted", null];
      for (const invalid of invalidStates) {
        expect(() => runStateSchema.parse(invalid)).toThrow();
      }
    });
  });

  describe("State Transition Matrix & Pure Helpers", () => {
    it("allows valid forward transitions from init", () => {
      expect(isValidAgentStateTransition("init", "ready")).toBe(true);
      expect(isValidAgentStateTransition("init", "failed")).toBe(true);
      expect(isValidAgentStateTransition("init", "cancelled")).toBe(true);

      // Disallowed transitions from init
      expect(isValidAgentStateTransition("init", "thinking")).toBe(false);
      expect(isValidAgentStateTransition("init", "executing")).toBe(false);
      expect(isValidAgentStateTransition("init", "completed")).toBe(false);
      expect(isValidAgentStateTransition("init", "paused")).toBe(false);
      expect(isValidAgentStateTransition("init", "resumed")).toBe(false);
    });

    it("allows valid transitions through the active execution cycle", () => {
      // ready -> thinking or executing or paused or terminal
      expect(isValidAgentStateTransition("ready", "thinking")).toBe(true);
      expect(isValidAgentStateTransition("ready", "executing")).toBe(true);
      expect(isValidAgentStateTransition("ready", "paused")).toBe(true);
      expect(isValidAgentStateTransition("ready", "failed")).toBe(true);
      expect(isValidAgentStateTransition("ready", "cancelled")).toBe(true);

      // thinking -> executing or ready or completed or paused or failed or cancelled
      expect(isValidAgentStateTransition("thinking", "executing")).toBe(true);
      expect(isValidAgentStateTransition("thinking", "ready")).toBe(true);
      expect(isValidAgentStateTransition("thinking", "completed")).toBe(true);
      expect(isValidAgentStateTransition("thinking", "paused")).toBe(true);
      expect(isValidAgentStateTransition("thinking", "failed")).toBe(true);
      expect(isValidAgentStateTransition("thinking", "cancelled")).toBe(true);

      // executing -> thinking or ready or completed or paused or failed or cancelled
      expect(isValidAgentStateTransition("executing", "thinking")).toBe(true);
      expect(isValidAgentStateTransition("executing", "ready")).toBe(true);
      expect(isValidAgentStateTransition("executing", "completed")).toBe(true);
      expect(isValidAgentStateTransition("executing", "paused")).toBe(true);
    });

    it("enforces paused and resumed state constraints", () => {
      // paused can only go to resumed or cancelled
      expect(isValidAgentStateTransition("paused", "resumed")).toBe(true);
      expect(isValidAgentStateTransition("paused", "cancelled")).toBe(true);
      expect(isValidAgentStateTransition("paused", "thinking")).toBe(false);
      expect(isValidAgentStateTransition("paused", "executing")).toBe(false);
      expect(isValidAgentStateTransition("paused", "completed")).toBe(false);

      // resumed can go to thinking, executing, ready, failed, cancelled
      expect(isValidAgentStateTransition("resumed", "thinking")).toBe(true);
      expect(isValidAgentStateTransition("resumed", "executing")).toBe(true);
      expect(isValidAgentStateTransition("resumed", "ready")).toBe(true);
      expect(isValidAgentStateTransition("resumed", "failed")).toBe(true);
      expect(isValidAgentStateTransition("resumed", "cancelled")).toBe(true);
    });

    it("treats idempotent self-transitions as valid", () => {
      const allStates: AgentLifecycleState[] = [
        "init",
        "ready",
        "thinking",
        "executing",
        "completed",
        "failed",
        "paused",
        "resumed",
        "cancelled",
      ];
      for (const state of allStates) {
        expect(isValidAgentStateTransition(state, state)).toBe(true);
      }
    });

    it("enforces terminal states have 0 outgoing transitions to other states", () => {
      const terminalStates: AgentLifecycleState[] = ["completed", "failed", "cancelled"];
      const allStates: AgentLifecycleState[] = [
        "init",
        "ready",
        "thinking",
        "executing",
        "completed",
        "failed",
        "paused",
        "resumed",
        "cancelled",
      ];

      for (const terminal of terminalStates) {
        expect(AGENT_TERMINAL_STATES.has(terminal)).toBe(true);
        expect(VALID_AGENT_TRANSITIONS[terminal].size).toBe(0);
        expect(isAgentLifecycleTerminal(terminal)).toBe(true);

        for (const other of allStates) {
          if (other !== terminal) {
            expect(isValidAgentStateTransition(terminal, other)).toBe(false);
          }
        }
      }
    });

    it("correctly identifies active, pausable, resumable, and cancellable states", () => {
      // Active states
      expect(isAgentLifecycleActive("ready")).toBe(true);
      expect(isAgentLifecycleActive("thinking")).toBe(true);
      expect(isAgentLifecycleActive("executing")).toBe(true);
      expect(isAgentLifecycleActive("resumed")).toBe(true);
      expect(isAgentLifecycleActive("init")).toBe(false);
      expect(isAgentLifecycleActive("paused")).toBe(false);
      expect(isAgentLifecycleActive("completed")).toBe(false);

      // Pausable states
      expect(canPauseAgent("ready")).toBe(true);
      expect(canPauseAgent("thinking")).toBe(true);
      expect(canPauseAgent("executing")).toBe(true);
      expect(canPauseAgent("resumed")).toBe(true);
      expect(canPauseAgent("init")).toBe(false);
      expect(canPauseAgent("paused")).toBe(false);
      expect(canPauseAgent("completed")).toBe(false);

      // Resumable states
      expect(canResumeAgent("paused")).toBe(true);
      expect(canResumeAgent("ready")).toBe(false);
      expect(canResumeAgent("thinking")).toBe(false);
      expect(canResumeAgent("init")).toBe(false);

      // Cancellable states (any non-terminal)
      expect(canCancelAgent("init")).toBe(true);
      expect(canCancelAgent("ready")).toBe(true);
      expect(canCancelAgent("thinking")).toBe(true);
      expect(canCancelAgent("executing")).toBe(true);
      expect(canCancelAgent("paused")).toBe(true);
      expect(canCancelAgent("resumed")).toBe(true);
      expect(canCancelAgent("completed")).toBe(false);
      expect(canCancelAgent("failed")).toBe(false);
      expect(canCancelAgent("cancelled")).toBe(false);
    });

    it("exports standard lifecycle error codes", () => {
      expect(LIFECYCLE_ERROR_CODES.ERR_INVALID_STATE_TRANSITION).toBe("ERR_INVALID_STATE_TRANSITION");
      expect(LIFECYCLE_ERROR_CODES.ERR_AGENT_ALREADY_TERMINAL).toBe("ERR_AGENT_ALREADY_TERMINAL");
      expect(LIFECYCLE_ERROR_CODES.ERR_AGENT_NOT_PAUSED).toBe("ERR_AGENT_NOT_PAUSED");
      expect(LIFECYCLE_ERROR_CODES.ERR_AGENT_ALREADY_PAUSED).toBe("ERR_AGENT_ALREADY_PAUSED");
      expect(LIFECYCLE_ERROR_CODES.ERR_AGENT_EXECUTION_TIMEOUT).toBe("ERR_AGENT_EXECUTION_TIMEOUT");
    });
  });

  describe("Agent Lifecycle Event Schemas Round-Trip", () => {
    const timestamp = "2026-08-21T22:30:00.000Z";

    it("validates and round-trips agent.init event", () => {
      const event: AgentLifecycleEvent = {
        type: "agent.init",
        runId: "run-101",
        goal: "Refactor monorepo protocol",
        sessionId: "sess-abc",
        at: timestamp,
      };
      const parsed = agentLifecycleEventSchema.parse(JSON.parse(JSON.stringify(event)));
      expect(parsed).toEqual(event);
    });

    it("validates and round-trips agent.ready event", () => {
      const event: AgentLifecycleEvent = {
        type: "agent.ready",
        runId: "run-101",
        stepId: "step-1",
        model: "claude-3-7-sonnet",
        at: timestamp,
      };
      const parsed = agentLifecycleEventSchema.parse(JSON.parse(JSON.stringify(event)));
      expect(parsed).toEqual(event);
    });

    it("validates and round-trips agent.thinking event", () => {
      const event: AgentLifecycleEvent = {
        type: "agent.thinking",
        runId: "run-101",
        stepId: "step-1",
        turnId: "turn-5",
        at: timestamp,
      };
      const parsed = agentLifecycleEventSchema.parse(JSON.parse(JSON.stringify(event)));
      expect(parsed).toEqual(event);
    });

    it("validates and round-trips agent.executing event", () => {
      const event: AgentLifecycleEvent = {
        type: "agent.executing",
        runId: "run-101",
        stepId: "step-1",
        toolName: "replace_file_content",
        callId: "call-99",
        at: timestamp,
      };
      const parsed = agentLifecycleEventSchema.parse(JSON.parse(JSON.stringify(event)));
      expect(parsed).toEqual(event);
    });

    it("validates and round-trips agent.paused event", () => {
      const event: AgentLifecycleEvent = {
        type: "agent.paused",
        runId: "run-101",
        reason: "User requested interactive review",
        at: timestamp,
      };
      const parsed = agentLifecycleEventSchema.parse(JSON.parse(JSON.stringify(event)));
      expect(parsed).toEqual(event);
    });

    it("validates and round-trips agent.resumed event", () => {
      const event: AgentLifecycleEvent = {
        type: "agent.resumed",
        runId: "run-101",
        at: timestamp,
      };
      const parsed = agentLifecycleEventSchema.parse(JSON.parse(JSON.stringify(event)));
      expect(parsed).toEqual(event);
    });

    it("validates and round-trips agent.completed event with default fallback values", () => {
      const raw = {
        type: "agent.completed",
        runId: "run-101",
        summary: "Execution successfully finished",
        at: timestamp,
      };
      const parsed = agentLifecycleEventSchema.parse(raw);
      expect(parsed.type).toBe("agent.completed");
      if (parsed.type === "agent.completed") {
        expect(parsed.totalTokens).toBe(0);
        expect(parsed.durationMs).toBe(0);
        expect(parsed.summary).toBe("Execution successfully finished");
      }
    });

    it("validates and round-trips agent.failed event", () => {
      const event: AgentLifecycleEvent = {
        type: "agent.failed",
        runId: "run-101",
        code: "ERR_TOOL_EXECUTION_FAILED",
        reason: "Compilation error in test target",
        stepId: "step-2",
        at: timestamp,
      };
      const parsed = agentLifecycleEventSchema.parse(JSON.parse(JSON.stringify(event)));
      expect(parsed).toEqual(event);
    });

    it("validates and round-trips agent.cancelled event", () => {
      const event: AgentLifecycleEvent = {
        type: "agent.cancelled",
        runId: "run-101",
        reason: "Aborted via UI button",
        at: timestamp,
      };
      const parsed = agentLifecycleEventSchema.parse(JSON.parse(JSON.stringify(event)));
      expect(parsed).toEqual(event);
    });

    it("rejects invalid agent lifecycle events", () => {
      // Invalid date
      expect(() =>
        agentLifecycleEventSchema.parse({
          type: "agent.init",
          runId: "run-1",
          goal: "goal",
          at: "not-a-datetime",
        })
      ).toThrow();

      // Missing required field
      expect(() =>
        agentLifecycleEventSchema.parse({
          type: "agent.executing",
          runId: "run-1",
          at: timestamp,
        })
      ).toThrow();
    });
  });

  describe("Run Lifecycle Event Schemas", () => {
    const timestamp = "2026-08-21T22:30:00.000Z";

    it("validates run.state event", () => {
      const event: RunLifecycleEvent = {
        type: "run.state",
        runId: "run-505",
        state: "running",
        at: timestamp,
        detail: "Starting agent loop turn 1",
      };
      const parsed = runLifecycleEventSchema.parse(event);
      expect(parsed).toEqual(event);
    });

    it("validates run.event with arbitrary data payload", () => {
      const event: RunLifecycleEvent = {
        type: "run.event",
        runId: "run-505",
        event: "checkpoint_saved",
        data: { checkpointId: "chk-1", snapshotSize: 4096 },
        at: timestamp,
      };
      const parsed = runLifecycleEventSchema.parse(event);
      expect(parsed).toEqual(event);
    });
  });

  describe("Run Control & Acknowledgement Result Schemas", () => {
    const timestamp = "2026-08-26T16:00:00.000Z";

    it("validates and round-trips plan.submit.result", () => {
      const frame = {
        type: "plan.submit.result",
        requestId: "req-1",
        runId: "run-101",
        accepted: true,
        planId: "plan-1",
        at: timestamp,
      };
      const parsed = planSubmitResultSchema.parse(frame);
      expect(parsed).toEqual(frame);
    });

    it("validates and round-trips run.pause.result", () => {
      const frame = {
        type: "run.pause.result",
        requestId: "req-2",
        runId: "run-101",
        at: timestamp,
      };
      const parsed = runPauseResultSchema.parse(frame);
      expect(parsed).toEqual(frame);
    });

    it("validates and round-trips run.resume.result", () => {
      const frame = {
        type: "run.resume.result",
        requestId: "req-3",
        runId: "run-101",
        at: timestamp,
      };
      const parsed = runResumeResultSchema.parse(frame);
      expect(parsed).toEqual(frame);
    });

    it("validates and round-trips run.cancel.result", () => {
      const frame = {
        type: "run.cancel.result",
        requestId: "req-4",
        runId: "run-101",
        at: timestamp,
      };
      const parsed = runCancelResultSchema.parse(frame);
      expect(parsed).toEqual(frame);
    });

    it("validates and round-trips approval.grant.result", () => {
      const frame = {
        type: "approval.grant.result",
        requestId: "req-5",
        runId: "run-101",
        stepId: "step-1",
        resolved: true,
        at: timestamp,
      };
      const parsed = approvalGrantResultSchema.parse(frame);
      expect(parsed).toEqual(frame);
    });

    it("validates and round-trips approval.deny.result", () => {
      const frame = {
        type: "approval.deny.result",
        requestId: "req-6",
        runId: "run-101",
        stepId: "step-1",
        resolved: false,
        at: timestamp,
      };
      const parsed = approvalDenyResultSchema.parse(frame);
      expect(parsed).toEqual(frame);
    });

    it("validates and round-trips tool.response.result", () => {
      const frame = {
        type: "tool.response.result",
        requestId: "req-7",
        resolved: true,
        at: timestamp,
      };
      const parsed = toolResponseResultSchema.parse(frame);
      expect(parsed).toEqual(frame);
    });
  });

  describe("Runtime State Machine (7-State Machine)", () => {
    it("validates all 7 canonical runtime states", () => {
      const states = [
        "starting",
        "healthy",
        "reconnecting",
        "switching",
        "ready",
        "needs_attention",
        "unavailable",
      ] as const;

      for (const state of states) {
        expect(runtimeStateSchema.parse(state)).toBe(state);
      }
    });

    it("rejects invalid runtime state strings", () => {
      const invalid = ["idle", "connecting", "connected", "online", "broken", null, 123];
      for (const inv of invalid) {
        expect(() => runtimeStateSchema.parse(inv)).toThrow();
      }
    });

    it("enforces canonical runtime state transitions", () => {
      // starting -> healthy, ready, reconnecting, needs_attention, unavailable
      expect(isValidRuntimeTransition("starting", "healthy")).toBe(true);
      expect(isValidRuntimeTransition("starting", "ready")).toBe(true);
      expect(isValidRuntimeTransition("starting", "reconnecting")).toBe(true);
      expect(isValidRuntimeTransition("starting", "needs_attention")).toBe(true);
      expect(isValidRuntimeTransition("starting", "unavailable")).toBe(true);
      expect(isValidRuntimeTransition("starting", "switching")).toBe(false);

      // healthy -> ready, switching, reconnecting, needs_attention, unavailable
      expect(isValidRuntimeTransition("healthy", "ready")).toBe(true);
      expect(isValidRuntimeTransition("healthy", "switching")).toBe(true);
      expect(isValidRuntimeTransition("healthy", "reconnecting")).toBe(true);
      expect(isValidRuntimeTransition("healthy", "needs_attention")).toBe(true);
      expect(isValidRuntimeTransition("healthy", "unavailable")).toBe(true);

      // ready -> healthy, switching, reconnecting, needs_attention, unavailable
      expect(isValidRuntimeTransition("ready", "healthy")).toBe(true);
      expect(isValidRuntimeTransition("ready", "switching")).toBe(true);
      expect(isValidRuntimeTransition("ready", "reconnecting")).toBe(true);
      expect(isValidRuntimeTransition("ready", "needs_attention")).toBe(true);
      expect(isValidRuntimeTransition("ready", "unavailable")).toBe(true);

      // reconnecting -> healthy, ready, starting, needs_attention, unavailable
      expect(isValidRuntimeTransition("reconnecting", "healthy")).toBe(true);
      expect(isValidRuntimeTransition("reconnecting", "ready")).toBe(true);
      expect(isValidRuntimeTransition("reconnecting", "needs_attention")).toBe(true);
      expect(isValidRuntimeTransition("reconnecting", "unavailable")).toBe(true);

      // switching -> healthy, ready, reconnecting, needs_attention, unavailable
      expect(isValidRuntimeTransition("switching", "ready")).toBe(true);
      expect(isValidRuntimeTransition("switching", "healthy")).toBe(true);
      expect(isValidRuntimeTransition("switching", "needs_attention")).toBe(true);
      expect(isValidRuntimeTransition("switching", "unavailable")).toBe(true);

      // idempotent self-transitions
      expect(isValidRuntimeTransition("ready", "ready")).toBe(true);
      expect(isValidRuntimeTransition("healthy", "healthy")).toBe(true);
    });

    it("evaluates runtime operational and transitioning helper predicates", () => {
      expect(isRuntimeOperational("healthy")).toBe(true);
      expect(isRuntimeOperational("ready")).toBe(true);
      expect(isRuntimeOperational("starting")).toBe(false);
      expect(isRuntimeOperational("reconnecting")).toBe(false);
      expect(isRuntimeOperational("switching")).toBe(false);
      expect(isRuntimeOperational("needs_attention")).toBe(false);
      expect(isRuntimeOperational("unavailable")).toBe(false);

      expect(isRuntimeTransitioning("starting")).toBe(true);
      expect(isRuntimeTransitioning("reconnecting")).toBe(true);
      expect(isRuntimeTransitioning("switching")).toBe(true);
      expect(isRuntimeTransitioning("ready")).toBe(false);
      expect(isRuntimeTransitioning("healthy")).toBe(false);
    });
  });
});
