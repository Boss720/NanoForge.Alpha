// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { AgentToolInspector } from "../subagents/AgentToolInspector";
import type { ToolRun } from "@/types";

const mockToolRuns: ToolRun[] = [
  {
    id: "tool-1",
    executable: "terminal.exec",
    args: ["npm", "test"],
    cwd: "/workspace",
    state: "running",
    output: "Running vitest tests...\nPASS test_1.ts\n",
  },
  {
    id: "tool-2",
    executable: "file.edit",
    args: ["src/App.tsx"],
    cwd: "/workspace",
    state: "done",
    exitCode: 0,
    output: "Successfully updated 3 lines in src/App.tsx",
  },
  {
    id: "tool-3",
    executable: "mcp.call",
    args: ["query_uniprot", "P12345"],
    cwd: "/workspace",
    state: "error",
    exitCode: 1,
    output: "Error: Failed to connect to MCP endpoint",
  },
];

describe("AgentToolInspector Component", () => {
  it("renders tool runs with executable names, state badges, and outputs", () => {
    render(
      <AgentToolInspector
        toolRuns={mockToolRuns}
        activeSubagent={{
          id: "agent-1",
          name: "worker_1",
          parentId: null,
          archetype: "implementer",
          roles: ["dev"],
          state: "running",
          isolationMode: "inherit",
          startedAt: "2026-08-15T00:00:00Z",
          lastHeartbeat: "2026-08-15T00:01:00Z",
          tokensUsed: 1000,
          turnCount: 1,
          workingDirectory: "/workspace",
        }}
      />
    );

    expect(screen.getByText("worker_1")).toBeDefined();
    expect(screen.getByText("terminal.exec")).toBeDefined();
    expect(screen.getByText("file.edit")).toBeDefined();
    expect(screen.getByText("mcp.call")).toBeDefined();
    expect(screen.getByText("Running")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
    expect(screen.getByText("Error")).toBeDefined();
    expect(screen.getByText(/PASS test_1.ts/)).toBeDefined();
  });

  it("toggles parameter inspector collapse and expands JSON parameters", () => {
    render(<AgentToolInspector toolRuns={mockToolRuns} />);

    const paramButtons = screen.getAllByText(/Parameters \(2 args\)/i);
    expect(paramButtons.length).toBeGreaterThan(0);

    // Expand
    fireEvent.click(paramButtons[0]);
    expect(screen.getAllByText(/npm/).length).toBeGreaterThan(0);
  });

  it("triggers onStopTool callback for running tools", () => {
    const onStop = vi.fn();
    render(<AgentToolInspector toolRuns={mockToolRuns} onStopTool={onStop} />);

    const stopButton = screen.getByTitle("Stop running tool execution");
    fireEvent.click(stopButton);

    expect(onStop).toHaveBeenCalledWith("tool-1");
  });

  it("renders empty state when toolRuns list is empty", () => {
    render(<AgentToolInspector toolRuns={[]} />);
    expect(screen.getByText("No Tool Executions Recorded")).toBeDefined();
  });
});
