// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "@/sections/Sidebar";
import type { Chat, Workspace } from "@/types";

afterEach(cleanup);

const chats: Chat[] = [
  {
    id: "chat-pinned",
    title: "Pinned deployment",
    messages: [{ id: "m-1", role: "user", content: "ship the API", ts: 3 }],
    model: "model-a",
    createdAt: 30,
    pinned: true,
  },
  {
    id: "chat-recent",
    title: "API debugging",
    messages: [{ id: "m-2", role: "assistant", content: "database timeout", ts: 2 }],
    model: "model-a",
    createdAt: 20,
  },
  {
    id: "chat-archived",
    title: "Old experiment",
    messages: [],
    model: "model-a",
    createdAt: 10,
    archived: true,
  },
];

const workspaces: Workspace[] = [
  { id: "workspace-main", name: "Main workspace", chats, createdAt: 1, pinned: true },
  { id: "workspace-other", name: "Other workspace", chats: [], createdAt: 2 },
];

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props: React.ComponentProps<typeof Sidebar> = {
    workspaces,
    activeWorkspaceId: "workspace-main",
    activeChatId: "chat-recent",
    onSelectWorkspace: vi.fn(),
    onCreateWorkspace: vi.fn(),
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
    files: [{ path: "src/main.ts", language: "typescript", content: "" }],
    activeFile: "",
    onFileSelect: vi.fn(),
    ...overrides,
  };
  return render(<Sidebar {...props} />);
}

describe("Sidebar", () => {
  it("renders distinct workspace, pinned, recent, archived, and file areas", () => {
    renderSidebar();

    expect(screen.getByText("Main workspace")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /pinned chats/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /recent chats/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /archived chats/i })).toBeInTheDocument();
    expect(screen.getByText("Pinned deployment")).toBeInTheDocument();
    expect(screen.getByText("API debugging")).toBeInTheDocument();
    expect(screen.getByText("Old experiment")).toBeInTheDocument();
    expect(screen.getByText("src/main.ts")).toBeInTheDocument();
  });

  it("exposes local folder recovery controls and recent safe display paths", async () => {
    const user = userEvent.setup();
    const onOpenFolder = vi.fn();
    const onReconnectWorkspace = vi.fn();
    const onOpenRecentWorkspace = vi.fn();
    renderSidebar({
      workspaces: [{ ...workspaces[0], location: { kind: "local", hostWorkspaceId: "host-main", displayPath: "…/main", lastOpenedAt: 10 } }],
      onOpenFolder,
      onReconnectWorkspace,
      onOpenRecentWorkspace,
      workspaceRecovery: { status: "unavailable", message: "Host disconnected" },
    });

    await user.click(screen.getByRole("button", { name: /open local folder/i }));
    await user.click(screen.getByRole("button", { name: /reconnect/i }));
    await user.click(screen.getByRole("button", { name: "…/main" }));
    expect(onOpenFolder).toHaveBeenCalledOnce();
    expect(onReconnectWorkspace).toHaveBeenCalledOnce();
    expect(onOpenRecentWorkspace).toHaveBeenCalledWith("host-main");
    expect(screen.getByText("Host disconnected")).toBeInTheDocument();
  });

  it("filters chats by title and message content", async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.type(screen.getByRole("searchbox", { name: /search chats/i }), "database");

    expect(screen.getByText("API debugging")).toBeInTheDocument();
    expect(screen.queryByText("Pinned deployment")).not.toBeInTheDocument();
    expect(screen.queryByText("Old experiment")).not.toBeInTheDocument();
  });

  it("calls create callbacks and renames a chat inline", async () => {
    const user = userEvent.setup();
    const onCreateWorkspace = vi.fn();
    const onCreateChat = vi.fn();
    const onRenameChat = vi.fn();
    renderSidebar({ onCreateWorkspace, onCreateChat, onRenameChat });

    await user.click(screen.getByRole("button", { name: /new workspace/i }));
    await user.click(screen.getByRole("button", { name: /new chat/i }));
    await user.click(screen.getByRole("button", { name: /rename chat \"api debugging\"/i }));
    const input = screen.getByRole("textbox", { name: /rename chat \"api debugging\"/i });
    await user.clear(input);
    await user.type(input, "API investigation");
    await user.keyboard("{Enter}");

    expect(onCreateWorkspace).toHaveBeenCalledTimes(1);
    expect(onCreateChat).toHaveBeenCalledTimes(1);
    expect(onRenameChat).toHaveBeenCalledWith("chat-recent", "API investigation");
  });

  it("archives a chat and confirms before deleting it", async () => {
    const user = userEvent.setup();
    const onArchiveChat = vi.fn();
    const onDeleteChat = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderSidebar({ onArchiveChat, onDeleteChat });

    await user.click(screen.getByRole("button", { name: /archive chat \"api debugging\"/i }));
    await user.click(screen.getByRole("button", { name: /delete chat \"api debugging\"/i }));

    expect(onArchiveChat).toHaveBeenCalledWith("chat-recent", true);
    expect(window.confirm).toHaveBeenCalled();
    expect(onDeleteChat).toHaveBeenCalledWith("chat-recent");
  });
});
