// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { SubagentsPanel } from "../SubagentsPanel";
import type { HostSession } from "@/lib/hostSession";
import type { SubagentInfo } from "@protocol/subagents";
import type { TaskSummary, ScheduleResult } from "@protocol/tasks";

const mockSubagents: SubagentInfo[] = [
  {
    id: "agent-1",
    name: "Planner Lead",
    parentId: null,
    archetype: "planner",
    roles: ["architect"],
    state: "running",
    isolationMode: "inherit",
    startedAt: "2026-08-15T00:00:00Z",
    lastHeartbeat: "2026-08-15T00:01:00Z",
    tokensUsed: 12500,
    turnCount: 1,
    workingDirectory: "/workspace",
  },
  {
    id: "agent-2",
    name: "Worker Dev",
    parentId: "agent-1",
    archetype: "implementer",
    roles: ["developer"],
    state: "idle",
    isolationMode: "branch",
    startedAt: "2026-08-15T00:00:00Z",
    lastHeartbeat: "2026-08-15T00:01:00Z",
    tokensUsed: 3500,
    turnCount: 1,
    workingDirectory: "/workspace",
  },
];

const mockDaemonTasks: TaskSummary[] = [
  {
    taskId: "task-1",
    pid: 1001,
    command: "vite",
    args: [],
    cwd: "/root",
    isDaemon: true,
    status: "running",
    startedAt: "2026-08-15T00:00:00Z",
  },
];

const mockSchedules: ScheduleResult[] = [
  {
    scheduleId: "sched-1",
    type: "one_shot",
    prompt: "Health check",
    status: "active",
    isDaemon: false,
  },
];

describe("SubagentsPanel Component", () => {
  it("renders top summary metrics (running agents, tokens, daemons, timers)", () => {
    const fakeSession = {
      subagents: mockSubagents,
      activeSubagentId: "agent-1",
      interAgentMessages: [],
      daemonTasks: mockDaemonTasks,
      schedules: mockSchedules,
      toolRuns: [],
      integrations: { rulesPacks: [], skills: [], mcpServers: [] },
      plan: null,
      evidence: null,
      permissionPending: null,
      routeDecision: null,
    } as unknown as HostSession;

    render(<SubagentsPanel session={fakeSession} />);

    expect(screen.getByText(/Swarm Control Plane/i)).toBeDefined();
    expect(screen.getByText(/16.0k/i)).toBeDefined(); // 12500 + 3500 tokens
    expect(screen.getByTestId("tab-swarm-tree")).toBeDefined();
    expect(screen.getByTestId("tab-tool-activity")).toBeDefined();
    expect(screen.getByTestId("tab-messages")).toBeDefined();
    expect(screen.getByTestId("tab-daemons")).toBeDefined();
  });

  it("switches across tabs correctly", () => {
    const fakeSession = {
      subagents: mockSubagents,
      activeSubagentId: "agent-1",
      interAgentMessages: [],
      daemonTasks: mockDaemonTasks,
      schedules: mockSchedules,
      toolRuns: [],
      integrations: { rulesPacks: [], skills: [], mcpServers: [] },
      plan: null,
      evidence: null,
      permissionPending: null,
      routeDecision: null,
    } as unknown as HostSession;

    render(<SubagentsPanel session={fakeSession} />);

    // Switch to Playground tab
    const playgroundTab = screen.getByTestId("tab-playground");
    fireEvent.click(playgroundTab);
    expect(screen.getByTestId("agent-swarm-playground")).toBeDefined();

    // Switch to Shared Memory tab
    const memoryTab = screen.getByTestId("tab-memory");
    fireEvent.click(memoryTab);
    expect(screen.getByTestId("agent-memory-viewer")).toBeDefined();

    // Switch to Tool Activity tab
    const toolsTab = screen.getByTestId("tab-tool-activity");
    fireEvent.click(toolsTab);
    expect(screen.getByTestId("agent-tool-inspector")).toBeDefined();

    // Switch to Messages tab
    const messagesTab = screen.getByTestId("tab-messages");
    fireEvent.click(messagesTab);
    expect(screen.getByTestId("agent-mailbox-viewer")).toBeDefined();

    // Switch to Daemons tab
    const daemonsTab = screen.getByTestId("tab-daemons");
    fireEvent.click(daemonsTab);
    expect(screen.getByTestId("daemon-task-manager")).toBeDefined();
  });

  it("opens Spawn Agent modal when Spawn Agent button is clicked", () => {
    const fakeSession = {
      subagents: mockSubagents,
      activeSubagentId: null,
      interAgentMessages: [],
      daemonTasks: [],
      schedules: [],
      toolRuns: [],
      integrations: { rulesPacks: [], skills: [], mcpServers: [] },
      plan: null,
      evidence: null,
      permissionPending: null,
      routeDecision: null,
    } as unknown as HostSession;

    render(<SubagentsPanel session={fakeSession} />);

    const spawnBtn = screen.getByTestId("spawn-agent-btn");
    fireEvent.click(spawnBtn);

    expect(screen.getByText("Spawn Autonomous Subagent")).toBeDefined();
  });

  it("opens Kill All alert confirmation dialog when power button is clicked", () => {
    const fakeSession = {
      subagents: mockSubagents,
      activeSubagentId: null,
      interAgentMessages: [],
      daemonTasks: [],
      schedules: [],
      toolRuns: [],
      integrations: { rulesPacks: [], skills: [], mcpServers: [] },
      plan: null,
      evidence: null,
      permissionPending: null,
      routeDecision: null,
    } as unknown as HostSession;

    render(<SubagentsPanel session={fakeSession} />);

    const killAllBtn = screen.getByTestId("kill-all-btn");
    fireEvent.click(killAllBtn);

    expect(screen.getByText(/Terminate Entire Subagent Swarm\?/i)).toBeDefined();
  });
});
