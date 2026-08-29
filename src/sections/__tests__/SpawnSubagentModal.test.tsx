// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { SpawnSubagentModal, getAgentDepth } from "../subagents/SpawnSubagentModal";
import type { SubagentInfo } from "@protocol/subagents";

const mockAgents: SubagentInfo[] = [
  {
    id: "root-1",
    name: "Root Supervisor",
    parentId: null,
    archetype: "planner",
    roles: ["planner"],
    state: "running",
    isolationMode: "inherit",
    startedAt: "2026-08-15T00:00:00Z",
    lastHeartbeat: "2026-08-15T00:00:00Z",
    tokensUsed: 100,
    turnCount: 1,
    workingDirectory: "/workspace",
  },
  {
    id: "tier1-1",
    name: "Tier 1 Lead",
    parentId: "root-1",
    archetype: "implementer",
    roles: ["lead"],
    state: "running",
    isolationMode: "inherit",
    startedAt: "2026-08-15T00:00:00Z",
    lastHeartbeat: "2026-08-15T00:00:00Z",
    tokensUsed: 100,
    turnCount: 1,
    workingDirectory: "/workspace",
  },
  {
    id: "tier2-1",
    name: "Tier 2 Worker",
    parentId: "tier1-1",
    archetype: "qa",
    roles: ["qa"],
    state: "running",
    isolationMode: "inherit",
    startedAt: "2026-08-15T00:00:00Z",
    lastHeartbeat: "2026-08-15T00:00:00Z",
    tokensUsed: 100,
    turnCount: 1,
    workingDirectory: "/workspace",
  },
  {
    id: "tier3-1",
    name: "Tier 3 Specialist",
    parentId: "tier2-1",
    archetype: "specialist",
    roles: ["specialist"],
    state: "running",
    isolationMode: "inherit",
    startedAt: "2026-08-15T00:00:00Z",
    lastHeartbeat: "2026-08-15T00:00:00Z",
    tokensUsed: 100,
    turnCount: 1,
    workingDirectory: "/workspace",
  },
];

describe("SpawnSubagentModal Component", () => {
  it("calculates supervisor tree depths accurately", () => {
    expect(getAgentDepth("root", mockAgents)).toBe(0);
    expect(getAgentDepth("root-1", mockAgents)).toBe(1);
    expect(getAgentDepth("tier1-1", mockAgents)).toBe(2);
    expect(getAgentDepth("tier2-1", mockAgents)).toBe(3);
    expect(getAgentDepth("tier3-1", mockAgents)).toBe(4);
  });

  it("renders modal form with archetypes and isolation modes", () => {
    const onSpawn = vi.fn().mockResolvedValue({});
    const onOpenChange = vi.fn();

    render(
      <SpawnSubagentModal
        open={true}
        onOpenChange={onOpenChange}
        subagents={mockAgents}
        onSpawn={onSpawn}
      />
    );

    expect(screen.getByText("Spawn Autonomous Subagent")).toBeDefined();
    expect(screen.getByText("Explorer")).toBeDefined();
    expect(screen.getByText("Implementer")).toBeDefined();
    expect(screen.getByText("QA Engineer")).toBeDefined();
    expect(screen.getByText("Specialist")).toBeDefined();
    expect(screen.getByText("Inherit")).toBeDefined();
    expect(screen.getByText("Branch Worktree")).toBeDefined();
    expect(screen.getByText("Share Scratch")).toBeDefined();
  });

  it("blocks spawn and displays SEC-SUB-05 error if target depth > 3 tiers", () => {
    const onSpawn = vi.fn().mockResolvedValue({});
    const onOpenChange = vi.fn();

    render(
      <SpawnSubagentModal
        open={true}
        onOpenChange={onOpenChange}
        subagents={mockAgents}
        onSpawn={onSpawn}
      />
    );

    // Select Tier 3 agent as parent -> child would be Tier 4 (exceeding MAX_DEPTH=3)
    const parentSelect = screen.getByLabelText(/Parent Supervisor/i);
    fireEvent.change(parentSelect, { target: { value: "tier3-1" } });

    expect(screen.getByText(/SEC-SUB-05:/)).toBeDefined();
    const spawnBtn = screen.getByRole("button", { name: /Spawn Agent/i });
    expect((spawnBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits valid form and dispatches onSpawn callback", async () => {
    const onSpawn = vi.fn().mockResolvedValue({});
    const onOpenChange = vi.fn();

    render(
      <SpawnSubagentModal
        open={true}
        onOpenChange={onOpenChange}
        subagents={mockAgents}
        onSpawn={onSpawn}
      />
    );

    // Fill prompt
    const promptArea = screen.getByPlaceholderText(/Describe the agent's objective/i);
    fireEvent.change(promptArea, { target: { value: "Audit code coverage" } });

    // Select QA archetype
    const qaOption = screen.getByTestId("archetype-option-qa");
    fireEvent.click(qaOption);

    const spawnBtn = screen.getByRole("button", { name: /Spawn Agent/i });
    fireEvent.click(spawnBtn);

    await waitFor(() => {
      expect(onSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          archetype: "qa",
          prompt: "Audit code coverage",
        }),
        undefined // root parent
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
