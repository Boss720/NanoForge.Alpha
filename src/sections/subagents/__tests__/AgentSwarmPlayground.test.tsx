// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AgentSwarmPlayground, PRESET_SCENARIOS } from "../AgentSwarmPlayground";
import type { SubagentInfo } from "@protocol/subagents";

afterEach(cleanup);

const mockSubagents: SubagentInfo[] = [
  {
    id: "agent-lead",
    name: "Lead Planner",
    parentId: null,
    archetype: "planner",
    roles: ["architect"],
    state: "running",
    isolationMode: "inherit",
    startedAt: "2026-08-15T00:00:00.000Z",
    lastHeartbeat: "2026-08-15T00:01:00.000Z",
    tokensUsed: 1500,
    turnCount: 2,
    workingDirectory: "/workspace",
  },
  {
    id: "agent-worker",
    name: "Developer Worker",
    parentId: "agent-lead",
    archetype: "implementer",
    roles: ["dev"],
    state: "idle",
    isolationMode: "branch",
    startedAt: "2026-08-15T00:00:00.000Z",
    lastHeartbeat: "2026-08-15T00:01:00.000Z",
    tokensUsed: 3200,
    turnCount: 4,
    workingDirectory: "/workspace",
  },
];

describe("AgentSwarmPlayground Component", () => {
  it("renders the playground console, scenario buttons, and controls", () => {
    render(<AgentSwarmPlayground subagents={mockSubagents} />);

    expect(screen.getByText(/Interactive Swarm Playground/i)).toBeDefined();
    expect(screen.getByTestId("target-agent-select")).toBeDefined();
    expect(screen.getByTestId("playground-prompt-input")).toBeDefined();
    expect(screen.getByTestId("dispatch-turn-btn")).toBeDefined();
    expect(screen.getByTestId("step-turn-btn")).toBeDefined();
    expect(screen.getByTestId("inject-failure-btn")).toBeDefined();
    expect(screen.getByText(/Codebase Exploration/i)).toBeDefined();
    expect(screen.getByText(/Test Suite Generation/i)).toBeDefined();
    expect(screen.getByText(/Regression Repair/i)).toBeDefined();
  });

  it("switches between Simulated and Live Host execution modes", () => {
    render(<AgentSwarmPlayground subagents={mockSubagents} />);

    const liveBtn = screen.getByTestId("mode-live-btn");
    fireEvent.click(liveBtn);

    expect(screen.getByText(/Live WS RPC/i)).toBeDefined();

    const simBtn = screen.getByTestId("mode-simulated-btn");
    fireEvent.click(simBtn);

    expect(screen.getByText(/Simulated Cycle/i)).toBeDefined();
  });

  it("selects a benchmark scenario and updates the prompt input", () => {
    render(<AgentSwarmPlayground subagents={mockSubagents} />);

    const testGenBtn = screen.getByTestId("scenario-btn-test_generation");
    fireEvent.click(testGenBtn);

    const promptInput = screen.getByTestId("playground-prompt-input") as HTMLTextAreaElement;
    expect(promptInput.value).toBe(PRESET_SCENARIOS[1].prompt);
  });

  it("dispatches turn in simulated mode and renders turn log and detail inspector", async () => {
    const onSimulateTurn = vi.fn().mockResolvedValue({
      success: true,
      turnId: "turn-sim-1",
      scenario: "exploration",
      output: "Exploration mock response completed.",
      tokensUsed: 190,
      latencyMs: 120,
    });

    render(
      <AgentSwarmPlayground
        subagents={mockSubagents}
        activeSubagentId="agent-lead"
        onSimulateTurn={onSimulateTurn}
      />
    );

    const dispatchBtn = screen.getByTestId("dispatch-turn-btn");
    fireEvent.click(dispatchBtn);

    await waitFor(() => {
      expect(onSimulateTurn).toHaveBeenCalledWith("agent-lead", "exploration");
    });

    await waitFor(() => {
      expect(screen.getByTestId("turn-log-row-1")).toBeDefined();
      expect(screen.getByTestId("turn-detail-inspector")).toBeDefined();
      expect(screen.getByText(/Exploration mock response completed/i)).toBeDefined();
    });
  });

  it("dispatches turn in live mode and calls onDispatchTurn", async () => {
    const onDispatchTurn = vi.fn().mockResolvedValue({
      success: true,
      turnId: "turn-live-1",
      response: "Live execution completed.",
      tokensUsed: 350,
      latencyMs: 450,
    });

    render(
      <AgentSwarmPlayground
        subagents={mockSubagents}
        activeSubagentId="agent-worker"
        onDispatchTurn={onDispatchTurn}
      />
    );

    // Switch to Live Host mode
    const liveBtn = screen.getByTestId("mode-live-btn");
    fireEvent.click(liveBtn);

    const dispatchBtn = screen.getByTestId("dispatch-turn-btn");
    fireEvent.click(dispatchBtn);

    await waitFor(() => {
      expect(onDispatchTurn).toHaveBeenCalledWith("agent-worker", expect.any(String));
    });

    await waitFor(() => {
      expect(screen.getByText(/Live execution completed/i)).toBeDefined();
    });
  });

  it("steps through a turn using the Step Turn button", async () => {
    const onSimulateTurn = vi.fn().mockResolvedValue({
      success: true,
      output: "Step turn output.",
      tokensUsed: 100,
    });

    render(
      <AgentSwarmPlayground
        subagents={mockSubagents}
        activeSubagentId="agent-lead"
        onSimulateTurn={onSimulateTurn}
      />
    );

    const stepBtn = screen.getByTestId("step-turn-btn");
    fireEvent.click(stepBtn);

    await waitFor(() => {
      expect(onSimulateTurn).toHaveBeenCalled();
    });
  });

  it("injects supervisor failure and renders recovery log with strategy", async () => {
    const onInjectFailure = vi.fn().mockResolvedValue({
      success: true,
      affectedSubagents: ["agent-worker"],
      recovered: true,
      message: "Supervisor detected crash. Restarted agent-worker using one_for_one strategy.",
    });

    render(
      <AgentSwarmPlayground
        subagents={mockSubagents}
        activeSubagentId="agent-worker"
        onInjectFailure={onInjectFailure}
      />
    );

    const failureTypeSelect = screen.getByTestId("failure-type-select");
    fireEvent.change(failureTypeSelect, { target: { value: "crash" } });

    const strategySelect = screen.getByTestId("supervisor-strategy-select");
    fireEvent.change(strategySelect, { target: { value: "one_for_one" } });

    const injectBtn = screen.getByTestId("inject-failure-btn");
    fireEvent.click(injectBtn);

    await waitFor(() => {
      expect(onInjectFailure).toHaveBeenCalledWith("agent-worker", "crash", "one_for_one");
    });

    await waitFor(() => {
      expect(screen.getByText(/Restarted agent-worker using one_for_one strategy/i)).toBeDefined();
    });
  });

  it("copies turn output to clipboard", async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextSpy },
    });

    const onSimulateTurn = vi.fn().mockResolvedValue({
      success: true,
      output: "Sample output for copy testing.",
      tokensUsed: 50,
    });

    render(
      <AgentSwarmPlayground
        subagents={mockSubagents}
        activeSubagentId="agent-lead"
        onSimulateTurn={onSimulateTurn}
      />
    );

    const dispatchBtn = screen.getByTestId("dispatch-turn-btn");
    fireEvent.click(dispatchBtn);

    await waitFor(() => {
      expect(screen.getByTestId("copy-log-btn")).toBeDefined();
    });

    const copyBtn = screen.getByTestId("copy-log-btn");
    fireEvent.click(copyBtn);

    expect(writeTextSpy).toHaveBeenCalled();
  });

  it("clears turn logs on clear button click", async () => {
    const onSimulateTurn = vi.fn().mockResolvedValue({
      success: true,
      output: "Temporary turn.",
      tokensUsed: 50,
    });

    render(
      <AgentSwarmPlayground
        subagents={mockSubagents}
        activeSubagentId="agent-lead"
        onSimulateTurn={onSimulateTurn}
      />
    );

    const dispatchBtn = screen.getByTestId("dispatch-turn-btn");
    fireEvent.click(dispatchBtn);

    await waitFor(() => {
      expect(screen.getByTestId("turn-log-row-1")).toBeDefined();
    });

    const clearBtn = screen.getByTestId("clear-logs-btn");
    fireEvent.click(clearBtn);

    expect(screen.queryByTestId("turn-log-row-1")).toBeNull();
    expect(screen.getByText(/No Turns Executed Yet/i)).toBeDefined();
  });
});
