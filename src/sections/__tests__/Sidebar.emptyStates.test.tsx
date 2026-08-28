// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../Sidebar";
import type { Workspace } from "@/types";
import type { WorkspaceControlDescriptor } from "@protocol/workspace";

afterEach(cleanup);

describe("Sidebar — Contextual Actionable Empty States (R1, R6)", () => {
  const defaultProps = {
    workspaces: [] as Workspace[],
    activeWorkspaceId: "",
    activeChatId: "",
    onSelectWorkspace: vi.fn(),
    onCreateWorkspace: vi.fn(),
    onOpenFolder: vi.fn(),
    onRenameWorkspace: vi.fn(),
    onPinWorkspace: vi.fn(),
    onArchiveWorkspace: vi.fn(),
    onDuplicateWorkspace: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onSelectChat: vi.fn(),
    onCreateChat: vi.fn(),
    onRenameChat: vi.fn(),
    onPinChat: vi.fn(),
    onArchiveChat: vi.fn(),
    onDuplicateChat: vi.fn(),
    onDeleteChat: vi.fn(),
    files: [],
    activeFile: "",
    onFileSelect: vi.fn(),
  };

  it("shows launcher Recents even when no app workspace represents them", () => {
    const recent: WorkspaceControlDescriptor = {
      workspaceId: "launcher-recent-1",
      label: "Unrepresented project",
      generation: 1,
      capabilities: {
        read: true,
        stat: true,
        watch: true,
        search: true,
        git: true,
        terminal: true,
        subagents: true,
        memory: true,
        reviewedWrite: false,
      },
    };

    render(<Sidebar {...defaultProps} recents={[recent]} onOpenRecentWorkspace={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Unrepresented project" })).toBeInTheDocument();
  });

  it("renders actionable empty state when 0 workspaces exist with create and open folder buttons", async () => {
    const user = userEvent.setup();
    const onCreateWorkspace = vi.fn();
    const onOpenFolder = vi.fn();

    render(
      <Sidebar
        {...defaultProps}
        workspaces={[]}
        onCreateWorkspace={onCreateWorkspace}
        onOpenFolder={onOpenFolder}
      />
    );

    const emptyWorkspaces = screen.getByTestId("sidebar-empty-workspaces");
    expect(emptyWorkspaces).toBeInTheDocument();
    expect(screen.getByText("No workspaces yet.")).toBeInTheDocument();

    const createBtn = screen.getByRole("button", { name: /create workspace/i });
    await user.click(createBtn);
    expect(onCreateWorkspace).toHaveBeenCalledTimes(1);

    const openBtn = screen.getAllByRole("button", { name: /open folder/i })[0];
    await user.click(openBtn);
    expect(onOpenFolder).toHaveBeenCalledTimes(1);
  });

  it("renders actionable empty state when active workspace has 0 chats", async () => {
    const user = userEvent.setup();
    const onCreateChat = vi.fn();
    const workspaces: Workspace[] = [
      { id: "ws-1", name: "Empty Workspace", chats: [], createdAt: 100 },
    ];

    render(
      <Sidebar
        {...defaultProps}
        workspaces={workspaces}
        activeWorkspaceId="ws-1"
        onCreateChat={onCreateChat}
      />
    );

    expect(screen.getByTestId("sidebar-empty-chats")).toBeInTheDocument();
    expect(screen.getByText("No chats in this workspace.")).toBeInTheDocument();

    const startChatBtn = screen.getByRole("button", { name: /start new chat/i });
    await user.click(startChatBtn);
    expect(onCreateChat).toHaveBeenCalledTimes(1);
  });

  it("renders actionable empty files state when 0 files exist", async () => {
    const user = userEvent.setup();
    const onOpenFolder = vi.fn();
    const workspaces: Workspace[] = [
      { id: "ws-1", name: "Workspace", chats: [], createdAt: 100 },
    ];

    render(
      <Sidebar
        {...defaultProps}
        workspaces={workspaces}
        activeWorkspaceId="ws-1"
        files={[]}
        onOpenFolder={onOpenFolder}
      />
    );

    expect(screen.getByTestId("sidebar-empty-files")).toBeInTheDocument();
    expect(screen.getByText("No files loaded.")).toBeInTheDocument();
    const openBtn = screen.getByRole("button", { name: /open folder/i });
    await user.click(openBtn);
    expect(onOpenFolder).toHaveBeenCalledTimes(1);
  });
});
