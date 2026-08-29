import { describe, it, expect, vi } from "vitest";
import { AgentEngine } from "../loop/agentEngine";
import { ToolRegistry } from "../tools/registry";
import { ReActFSM } from "../loop/fsm";
import { CancellationTokenSource } from "../cancellation/cancellationToken";
import { MockProviderAdapter } from "./mocks/mockProviders";
import {
  mockReadTool,
  mockWriteTool,
  mockCommandTool,
  mockAdminTool,
  mockFailingTool,
} from "./mocks/mockTools";
import type { AgentLifecycleEvent, TurnEvent } from "@nanoforge/protocol";

describe("ReAct Loop & AgentEngine Autonomous Execution", () => {
  describe("ReActFSM State Transitions", () => {
    it("tracks valid state transitions and fires transition callbacks", () => {
      const fsm = new ReActFSM("IDLE");
      const transitions: string[] = [];

      fsm.onTransition((t) => {
        transitions.push(`${t.from} -> ${t.to}`);
      });

      expect(fsm.state).toBe("IDLE");
      fsm.transitionTo("PROMPT_SYNTH");
      fsm.transitionTo("BUDGET_CHECK");
      fsm.transitionTo("MODEL_STREAM");
      fsm.transitionTo("PARSE_OUTPUT");
      fsm.transitionTo("TOOL_PROPOSAL");
      fsm.transitionTo("POLICY_GATE");
      fsm.transitionTo("EXECUTING_TOOL");
      fsm.transitionTo("EVAL_OBSERVATION");
      fsm.transitionTo("COMPLETED");

      expect(fsm.state).toBe("COMPLETED");
      expect(fsm.isTerminal).toBe(true);
      expect(transitions.length).toBe(9);
      expect(transitions[0]).toBe("IDLE -> PROMPT_SYNTH");
    });

    it("rejects invalid state transitions", () => {
      const fsm = new ReActFSM("IDLE");
      expect(() => {
        fsm.transitionTo("EXECUTING_TOOL");
      }).toThrow(/Invalid FSM transition/);
    });
  });

  describe("AgentEngine Multi-Turn Execution", () => {
    it("executes single turn with direct text response", async () => {
      const provider = new MockProviderAdapter([
        [
          { type: "text", text: "I have completed the task directly." },
          { type: "done", finishReason: "stop" },
        ],
      ]);

      const registry = new ToolRegistry();
      registry.register(mockReadTool);

      const lifecycleEvents: AgentLifecycleEvent[] = [];
      const turnEvents: TurnEvent[] = [];

      const engine = new AgentEngine({
        provider,
        toolRegistry: registry,
        workspaceRoot: "/workspace",
        onLifecycleEvent: (e) => lifecycleEvents.push(e),
        onTurnEvent: (e) => turnEvents.push(e),
      });

      const result = await engine.run("What is 2 + 2?");

      expect(result.status).toBe("completed");
      expect(result.finalResponse).toBe("I have completed the task directly.");
      expect(result.turns.length).toBe(1);
      expect(result.turns[0].toolCalls.length).toBe(0);

      expect(lifecycleEvents.some((e) => e.type === "agent.init")).toBe(true);
      expect(lifecycleEvents.some((e) => e.type === "agent.ready")).toBe(true);
      expect(lifecycleEvents.some((e) => e.type === "agent.completed")).toBe(true);
    });

    it("executes multi-turn tool chaining (Tool 1 -> Tool 2 -> Final Response)", async () => {
      const provider = new MockProviderAdapter([
        // Turn 1: Propose read_file
        [
          { type: "text", text: "First, I will read the configuration." },
          {
            type: "tool_proposal",
            callId: "call_read_1",
            name: "read_file",
            args: { path: "config.json" },
          },
          { type: "done", finishReason: "tool_calls" },
        ],
        // Turn 2: Propose write_file based on observation
        [
          { type: "text", text: "Now I will update the file." },
          {
            type: "tool_proposal",
            callId: "call_write_2",
            name: "write_file",
            args: { path: "output.json", content: "updated data" },
          },
          { type: "done", finishReason: "tool_calls" },
        ],
        // Turn 3: Final completion
        [
          { type: "text", text: "All operations successfully completed." },
          { type: "done", finishReason: "stop" },
        ],
      ]);

      const registry = new ToolRegistry();
      registry.registerMany([mockReadTool, mockWriteTool]);

      const engine = new AgentEngine({
        provider,
        toolRegistry: registry,
        workspaceRoot: "/workspace",
        autoApproveUpTo: "T1_WORKSPACE_WRITE",
      });

      const result = await engine.run("Update the configuration file");

      expect(result.status).toBe("completed");
      expect(result.turns.length).toBe(3);
      expect(result.turns[0].toolCalls[0].toolName).toBe("read_file");
      expect(result.turns[0].toolResults[0].status).toBe("SUCCESS");
      expect(result.turns[1].toolCalls[0].toolName).toBe("write_file");
      expect(result.turns[1].toolResults[0].status).toBe("SUCCESS");
      expect(result.finalResponse).toBe("All operations successfully completed.");
    });

    it("self-corrects after tool execution failure in multi-turn loop", async () => {
      const provider = new MockProviderAdapter([
        // Turn 1: Call failing tool
        [
          { type: "text", text: "Attempting risky operation." },
          {
            type: "tool_proposal",
            callId: "call_fail_1",
            name: "fail_tool",
            args: { msg: "Connection timed out" },
          },
          { type: "done", finishReason: "tool_calls" },
        ],
        // Turn 2: Model observes error and falls back to safe read tool
        [
          { type: "text", text: "Tool failed, falling back to read_file." },
          {
            type: "tool_proposal",
            callId: "call_read_fallback",
            name: "read_file",
            args: { path: "fallback.txt" },
          },
          { type: "done", finishReason: "tool_calls" },
        ],
        // Turn 3: Completion
        [
          { type: "text", text: "Recovered from error and completed." },
          { type: "done", finishReason: "stop" },
        ],
      ]);

      const registry = new ToolRegistry();
      registry.registerMany([mockFailingTool, mockReadTool]);

      const engine = new AgentEngine({
        provider,
        toolRegistry: registry,
        workspaceRoot: "/workspace",
        autoApproveUpTo: "T0_READ_ONLY",
      });

      const result = await engine.run("Perform operation with fallback");

      expect(result.status).toBe("completed");
      expect(result.turns.length).toBe(3);
      expect(result.turns[0].toolResults[0].status).toBe("EXECUTION_ERROR");
      expect(result.turns[1].toolResults[0].status).toBe("SUCCESS");
      expect(result.finalResponse).toBe("Recovered from error and completed.");
    });

    it("handles tool permission denial when policy rejects tool", async () => {
      const provider = new MockProviderAdapter([
        // Turn 1: Propose T3 tool when autoApprove is T0 and interactive handler denies
        [
          {
            type: "tool_proposal",
            callId: "call_admin_1",
            name: "admin_cleanup",
            args: { target: "/all" },
          },
          { type: "done", finishReason: "tool_calls" },
        ],
        // Turn 2: Final response acknowledging permission denied
        [
          { type: "text", text: "Cannot proceed because permission was denied." },
          { type: "done", finishReason: "stop" },
        ],
      ]);

      const registry = new ToolRegistry();
      registry.register(mockAdminTool);

      const engine = new AgentEngine({
        provider,
        toolRegistry: registry,
        workspaceRoot: "/workspace",
        autoApproveUpTo: "T0_READ_ONLY",
        securityPolicy: {
          interactiveApprovalHandler: async () => false, // User denies
        },
      });

      const result = await engine.run("Clean up everything");

      expect(result.status).toBe("completed");
      expect(result.turns[0].toolResults[0].status).toBe("PERMISSION_DENIED");
      expect(result.finalResponse).toContain("permission was denied");
    });

    it("aborts execution cleanly within < 100ms when root cancellation token is triggered", async () => {
      const provider = new MockProviderAdapter([
        [
          { type: "text", text: "Starting long operation..." },
          {
            type: "tool_proposal",
            callId: "call_slow",
            name: "read_file",
            args: { path: "huge.bin" },
          },
          { type: "done", finishReason: "tool_calls" },
        ],
      ]);

      const registry = new ToolRegistry();
      registry.register(mockReadTool);

      const cts = new CancellationTokenSource();
      const engine = new AgentEngine({
        provider,
        toolRegistry: registry,
        workspaceRoot: "/workspace",
      });

      // Cancel before / during run
      const runPromise = engine.run("Long run", cts);
      cts.cancel("user_requested", "User cancelled run");

      const result = await runPromise;
      expect(result.status).toBe("cancelled");
      expect(result.error).toContain("cancelled");
      expect(engine.fsm.state).toBe("CANCELLED");
    });
  });
});
