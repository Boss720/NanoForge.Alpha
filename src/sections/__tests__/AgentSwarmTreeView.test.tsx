// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import {
  AgentSwarmTreeView,
  buildAgentForest,
  formatTokens,
  getLivenessStatus,
} from "../subagents/AgentSwarmTreeView";
import type { SubagentInfo } from "@protocol/subagents";

const mockAgents: SubagentInfo[] = [
  {
    id: "agent-root",
    name: "Supervisor Orchestrator",
    parentId: null,
    archetype: "planner",
    roles: ["architect", "supervisor"],
    state: "running",
    isolationMode: "inherit",
    startedAt: new Date(Date.now() - 120000).toISOString(), // 2m ago
    lastHeartbeat: new Date(Date.now() - 5000).toISOString(), // 5s ago (healthy)
    tokensUsed: 15400,
    turnCount: 4,
    workingDirectory: "/workspace",
    lastProgressSummary: "Coordinating milestone 3 agents",
  },
  {
    id: "agent-child-1",
    name: "Implementer Worker",
    parentId: "agent-root",
    archetype: "implementer",
    roles: ["developer"],
    state: "running",
    isolationMode: "branch",
    startedAt: new Date(Date.now() - 60000).toISOString(),
    lastHeartbeat: new Date(Date.now() - 45000).toISOString(), // 45s ago (delayed/active)
    tokensUsed: 3200,
    turnCount: 2,
    workingDirectory: "/workspace",
  },
  {
    id: "agent-child-2",
    name: "QA Auditor",
    parentId: "agent-root",
    archetype: "qa",
    roles: ["tester"],
    state: "idle",
    isolationMode: "inherit",
    startedAt: new Date(Date.now() - 30000).toISOString(),
    lastHeartbeat: new Date(Date.now() - 200000).toISOString(), // >180s ago (stalled)
    tokensUsed: 800,
    turnCount: 1,
    workingDirectory: "/workspace",
  },
  {
    id: "agent-grandchild",
    name: "Specialist Linter",
    parentId: "agent-child-1",
    archetype: "specialist",
    roles: ["linter"],
    state: "waiting_for_dependents",
    isolationMode: "share",
    startedAt: new Date(Date.now() - 15000).toISOString(),
    lastHeartbeat: new Date(Date.now() - 1000).toISOString(),
    tokensUsed: 450,
    turnCount: 1,
    workingDirectory: "/workspace",
  },
];

describe("AgentSwarmTreeView Component", () => {
  it("builds correct hierarchical tree forest with depths", () => {
    const forest = buildAgentForest(mockAgents);
    expect(forest).toHaveLength(1);
    expect(forest[0].agent.id).toBe("agent-root");
    expect(forest[0].depth).toBe(0);
    expect(forest[0].children).toHaveLength(2);

    const child1 = forest[0].children.find((c) => c.agent.id === "agent-child-1");
    expect(child1).toBeDefined();
    expect(child1?.depth).toBe(1);
    expect(child1?.children).toHaveLength(1);
    expect(child1?.children[0].agent.id).toBe("agent-grandchild");
    expect(child1?.children[0].depth).toBe(2);
  });

  it("calculates formatting helpers correctly (uptime, tokens, liveness)", () => {
    expect(formatTokens(500)).toBe("500 tok");
    expect(formatTokens(15400)).toBe("15.4k tok");
    expect(formatTokens(2500000)).toBe("2.5M tok");

    const healthy = getLivenessStatus(new Date(Date.now() - 10000).toISOString());
    expect(healthy.status).toBe("healthy");

    const delayed = getLivenessStatus(new Date(Date.now() - 60000).toISOString());
    expect(delayed.status).toBe("delayed");

    const stalled = getLivenessStatus(new Date(Date.now() - 250000).toISOString());
    expect(stalled.status).toBe("stalled");
    expect(stalled.label).toContain("STALLED");
  });

  it("renders tree nodes with states, archetypes, and progress summaries", () => {
    const onSelect = vi.fn();
    const onKill = vi.fn();
    const onKillTree = vi.fn();

    render(
      <AgentSwarmTreeView
        subagents={mockAgents}
        activeSubagentId="agent-root"
        onSelectAgent={onSelect}
        onKillAgent={onKill}
        onKillTree={onKillTree}
      />
    );

    expect(screen.getByText("Supervisor Orchestrator")).toBeDefined();
    expect(screen.getByText("Implementer Worker")).toBeDefined();
    expect(screen.getByText("QA Auditor")).toBeDefined();
    expect(screen.getByText("Specialist Linter")).toBeDefined();
    expect(screen.getByText("Coordinating milestone 3 agents")).toBeDefined();
    expect(screen.getByText("STALLED > 180s")).toBeDefined();
  });

  it("triggers onSelectAgent when clicking an agent card", () => {
    const onSelect = vi.fn();
    const onKill = vi.fn();
    const onKillTree = vi.fn();

    render(
      <AgentSwarmTreeView
        subagents={mockAgents}
        activeSubagentId="agent-root"
        onSelectAgent={onSelect}
        onKillAgent={onKill}
        onKillTree={onKillTree}
      />
    );

    const childCard = screen.getByText("Implementer Worker");
    fireEvent.click(childCard);

    expect(onSelect).toHaveBeenCalledWith("agent-child-1");
  });

  it("triggers onKillAgent and onKillTree callbacks", () => {
    const onSelect = vi.fn();
    const onKill = vi.fn();
    const onKillTree = vi.fn();

    render(
      <AgentSwarmTreeView
        subagents={mockAgents}
        activeSubagentId="agent-root"
        onSelectAgent={onSelect}
        onKillAgent={onKill}
        onKillTree={onKillTree}
      />
    );

    const killButtons = screen.getAllByTitle("Terminate subagent");
    fireEvent.click(killButtons[0]);
    expect(onKill).toHaveBeenCalledWith("agent-root");

    const killTreeButtons = screen.getAllByTitle("Terminate subagent and all child branches");
    fireEvent.click(killTreeButtons[0]);
    expect(onKillTree).toHaveBeenCalledWith("agent-root");
  });

  it("filters agents by search query", () => {
    render(
      <AgentSwarmTreeView
        subagents={mockAgents}
        onSelectAgent={() => {}}
        onKillAgent={() => {}}
        onKillTree={() => {}}
      />
    );

    const searchInput = screen.getByPlaceholderText(/Filter agents by name/i);
    fireEvent.change(searchInput, { target: { value: "Linter" } });

    expect(screen.getByText("Specialist Linter")).toBeDefined();
    expect(screen.queryByText("Implementer Worker")).toBeNull();
  });

  it("renders token budget gauge, latency badges, burn rate, and USD cost meters", () => {
    const agentsWithTelemetry: SubagentInfo[] = [
      {
        id: "agent-telemetry",
        name: "Telemetry Worker",
        parentId: null,
        archetype: "implementer",
        roles: ["dev"],
        state: "running",
        isolationMode: "inherit",
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        tokensUsed: 8000,
        turnCount: 5,
        workingDirectory: "/workspace",
        budgetTokens: 10000,
        telemetry: {
          promptTokens: 5000,
          completionTokens: 3000,
          totalTokens: 8000,
          tokensPerSecond: 145,
          turnCount: 5,
          avgTurnLatencyMs: 850,
          lastTurnLatencyMs: 620,
          p95TurnLatencyMs: 950,
          totalDurationMs: 4250,
          toolDurationMs: 1200,
          estimatedCostUsd: 0.024,
        },
      } as unknown as SubagentInfo,
    ];

    render(
      <AgentSwarmTreeView
        subagents={agentsWithTelemetry}
        onSelectAgent={() => {}}
        onKillAgent={() => {}}
        onKillTree={() => {}}
      />
    );

    expect(screen.getByText("Telemetry Worker")).toBeDefined();
    expect(screen.getByTestId("token-budget-gauge")).toBeDefined();
    expect(screen.getByText(/8.0k tok/i)).toBeDefined();
    expect(screen.getByText(/10.0k tok/i)).toBeDefined();
    expect(screen.getByText(/850ms avg/i)).toBeDefined();
    expect(screen.getByText(/620ms last/i)).toBeDefined();
    expect(screen.getByText(/145 tok\/s/i)).toBeDefined();
    expect(screen.getByText(/\$0\.024/i)).toBeDefined();
  });
});
