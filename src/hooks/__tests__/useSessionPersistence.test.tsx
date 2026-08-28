// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSessionPersistence } from "@/hooks/useSessionPersistence";

describe("useSessionPersistence workspace and chat actions", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("keeps compatibility state and active ids consistent across core mutations", () => {
    const { result } = renderHook(() => useSessionPersistence("model-a"));
    const originalWorkspaceId = result.current.activeWorkspaceId;
    const originalChatId = result.current.activeChatId;
    const originalFiles = result.current.files;

    act(() => result.current.renameChat(originalChatId, "Renamed"));
    expect(result.current.sessions[0].title).toBe("Renamed");
    expect(result.current.activeId).toBe(originalChatId);

    let workspaceId = "";
    act(() => {
      workspaceId = result.current.createWorkspace("Team");
    });
    expect(result.current.activeWorkspaceId).toBe(workspaceId);

    let chatId = "";
    act(() => {
      chatId = result.current.createChat("model-b");
      result.current.renameChat(chatId, "Team chat");
      result.current.pinChat(chatId);
    });
    expect(result.current.activeChatId).toBe(chatId);
    expect(result.current.chats[0]).toMatchObject({ id: chatId, title: "Team chat", pinned: true });

    let duplicateId = "";
    act(() => {
      duplicateId = result.current.duplicateChat(chatId) ?? "";
    });
    expect(duplicateId).not.toBe(chatId);
    expect(result.current.activeChatId).toBe(duplicateId);

    act(() => result.current.deleteWorkspace(workspaceId));
    expect(result.current.activeWorkspaceId).toBe(originalWorkspaceId);
    expect(result.current.activeChatId).toBe(originalChatId);
    expect(result.current.files).toBe(originalFiles);
  });
});
