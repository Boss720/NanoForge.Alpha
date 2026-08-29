// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { AgentMemoryViewer, calculateEntrySize, formatBytes } from "../AgentMemoryViewer";
import type { MemoryEntry } from "@protocol/memory";

afterEach(cleanup);

const mockMemoryEntries: MemoryEntry[] = [
  {
    key: "auth_token",
    namespace: "global",
    value: "jwt-token-xyz-12345",
    tags: ["auth", "security"],
    version: 1,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    ttlSeconds: 3600,
    authorName: "Security Agent",
  },
  {
    key: "session_state",
    namespace: "swarm",
    value: { step: 3, activeWorkers: ["worker-1", "worker-2"], status: "in_progress" },
    tags: ["state", "coordination"],
    version: 2,
    createdAt: "2026-08-15T00:01:00.000Z",
    updatedAt: "2026-08-15T00:02:00.000Z",
    authorName: "Planner Lead",
  },
  {
    key: "scratch_buffer",
    namespace: "agent:worker-1",
    value: [1, 2, 3, 4, 5],
    tags: ["temp"],
    version: 1,
    createdAt: "2026-08-15T00:02:00.000Z",
    updatedAt: "2026-08-15T00:02:00.000Z",
    authorName: "Worker 1",
  },
];

describe("AgentMemoryViewer Component", () => {
  it("renders empty state when no shared memory entries exist", () => {
    render(<AgentMemoryViewer sharedMemory={[]} />);

    expect(screen.getByText(/Cross-Agent Shared Memory/i)).toBeDefined();
    expect(screen.getByText(/0 entries/i)).toBeDefined();
    expect(screen.getByText(/No Memory Entries Found/i)).toBeDefined();
  });

  it("renders shared memory entries with key names, namespaces, and types", () => {
    render(<AgentMemoryViewer sharedMemory={mockMemoryEntries} />);

    expect(screen.getByText(/3 entries/i)).toBeDefined();
    expect(screen.getByTestId("memory-entry-row-auth_token")).toBeDefined();
    expect(screen.getByTestId("memory-entry-row-session_state")).toBeDefined();
    expect(screen.getByTestId("memory-entry-row-scratch_buffer")).toBeDefined();
    expect(screen.getAllByText("global").length).toBeGreaterThan(0);
    expect(screen.getAllByText("swarm").length).toBeGreaterThan(0);
    expect(screen.getAllByText("agent:worker-1").length).toBeGreaterThan(0);
  });

  it("filters memory entries by search query", () => {
    render(<AgentMemoryViewer sharedMemory={mockMemoryEntries} />);

    const searchInput = screen.getByTestId("memory-search-input");
    fireEvent.change(searchInput, { target: { value: "auth_token" } });

    expect(screen.getByTestId("memory-entry-row-auth_token")).toBeDefined();
    expect(screen.queryByTestId("memory-entry-row-session_state")).toBeNull();
    expect(screen.queryByTestId("memory-entry-row-scratch_buffer")).toBeNull();
  });

  it("filters memory entries by namespace selection", () => {
    render(<AgentMemoryViewer sharedMemory={mockMemoryEntries} />);

    const namespaceSelect = screen.getByTestId("namespace-select");
    fireEvent.change(namespaceSelect, { target: { value: "swarm" } });

    expect(screen.getByTestId("memory-entry-row-session_state")).toBeDefined();
    expect(screen.queryByTestId("memory-entry-row-auth_token")).toBeNull();
    expect(screen.queryByTestId("memory-entry-row-scratch_buffer")).toBeNull();
  });

  it("inspects a selected memory entry and shows formatted JSON viewer", () => {
    render(<AgentMemoryViewer sharedMemory={mockMemoryEntries} />);

    // Click second entry
    const sessionStateRow = screen.getByTestId("memory-entry-row-session_state");
    fireEvent.click(sessionStateRow);

    const inspector = screen.getByTestId("memory-inspector");
    expect(inspector).toBeDefined();
    const jsonViewer = screen.getByTestId("json-content-viewer");
    expect(within(jsonViewer).getByText(/activeWorkers/i)).toBeDefined();
    expect(screen.getByText(/Planner Lead/i)).toBeDefined();
  });

  it("copies memory value to clipboard on copy button click", async () => {
    const writeTextSpy = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextSpy },
    });

    render(<AgentMemoryViewer sharedMemory={mockMemoryEntries} />);

    const copyBtn = screen.getByTestId("copy-value-btn");
    fireEvent.click(copyBtn);

    expect(writeTextSpy).toHaveBeenCalled();
  });

  it("opens 'Set Key' dialog, fills inputs, and submits new memory entry", async () => {
    const onSetMemory = vi.fn().mockResolvedValue({
      success: true,
      entry: {
        key: "new_api_key",
        namespace: "global",
        value: "secret_123",
        tags: ["api"],
        version: 1,
        createdAt: "2026-08-15T00:00:00Z",
        updatedAt: "2026-08-15T00:00:00Z",
      },
    });

    render(<AgentMemoryViewer sharedMemory={mockMemoryEntries} onSetMemory={onSetMemory} />);

    const setKeyBtn = screen.getByTestId("set-memory-btn");
    fireEvent.click(setKeyBtn);

    expect(screen.getByText(/Set Shared Memory Key/i)).toBeDefined();

    const keyInput = screen.getByTestId("input-memory-key");
    const valueInput = screen.getByTestId("input-memory-value");
    const tagsInput = screen.getByTestId("input-memory-tags");

    fireEvent.change(keyInput, { target: { value: "new_api_key" } });
    fireEvent.change(valueInput, { target: { value: "secret_123" } });
    fireEvent.change(tagsInput, { target: { value: "api, keys" } });

    const submitBtn = screen.getByTestId("submit-memory-btn");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSetMemory).toHaveBeenCalledWith(
        "new_api_key",
        "secret_123",
        "global",
        undefined,
        ["api", "keys"]
      );
    });
  });

  it("opens delete confirmation alert and calls onDeleteMemory on confirm", async () => {
    const onDeleteMemory = vi.fn().mockResolvedValue({ success: true, deleted: true });

    render(<AgentMemoryViewer sharedMemory={mockMemoryEntries} onDeleteMemory={onDeleteMemory} />);

    const deleteBtn = screen.getByTestId("delete-memory-btn");
    fireEvent.click(deleteBtn);

    expect(screen.getByText(/Delete Shared Memory Key\?/i)).toBeDefined();

    const confirmBtn = screen.getByTestId("confirm-delete-memory-btn");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onDeleteMemory).toHaveBeenCalledWith("auth_token", "global");
    });
  });

  it("calculates byte sizes and formats correctly", () => {
    expect(calculateEntrySize(mockMemoryEntries[0])).toBeGreaterThan(0);
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});
