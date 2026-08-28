import { useCallback, useEffect, useMemo, useState, type SetStateAction } from "react";
import type { Chat, Session, UsageRun, UsageTotals, VirtualFile, Workspace, WorkspaceLocation } from "@/types";
import { FALLBACK_MODELS, VIRTUAL_PROJECT } from "@/lib/catalog";
import { createDebouncedSaver, loadState, STORAGE_KEY } from "@/lib/persist";
import { downloadSessionMarkdown } from "@/lib/exporter";
import { getAttachmentSnapshotStore } from "@/lib/attachments/snapshots";

export function createNewSession(modelId: string): Session {
  return {
    id: crypto.randomUUID(),
    title: "new run",
    messages: [],
    model: modelId,
    createdAt: Date.now(),
  };
}

function asChat(session: Session): Chat {
  return { ...session };
}

function createWorkspace(name: string, chats: Chat[] = []): Workspace {
  return { id: crypto.randomUUID(), name, chats, createdAt: Date.now() };
}

function firstChat(workspace: Workspace | undefined): Chat | undefined {
  return workspace?.chats.find((chat) => !chat.archived) ?? workspace?.chats[0];
}

function cloneChat(chat: Chat): Chat {
  return {
    ...chat,
    id: crypto.randomUUID(),
    title: `${chat.title} copy`,
    createdAt: Date.now(),
    messages: chat.messages.map((message) => ({ ...message, id: crypto.randomUUID() })),
    archived: false,
    pinned: false,
  };
}

export function hydratePersisted(): {
  sessions: Session[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeChatId: string;
  usage: UsageTotals;
  files: VirtualFile[];
  runs: UsageRun[];
} | null {
  const state = loadState();
  if (!state) return null;
  const workspaces = state.workspaces.map((workspace) => ({
    ...workspace,
    chats: workspace.chats.map((chat) => ({
      ...chat,
      messages: chat.messages.map((message) =>
        message.streaming ? { ...message, streaming: false } : message,
      ),
    })),
  }));
  return {
    sessions: workspaces.flatMap((workspace) => workspace.chats),
    workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    activeChatId: state.activeChatId,
    usage: state.usage,
    files: state.files,
    runs: state.runs ?? [],
  };
}

export function useSessionPersistence(defaultModelId: string = FALLBACK_MODELS[3].id) {
  const [hydrated] = useState(hydratePersisted);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => {
    if (hydrated?.workspaces.length) return hydrated.workspaces;
    return [createWorkspace("Default workspace", [asChat(createNewSession(defaultModelId))])];
  });
  const [activeWorkspaceIdState, setActiveWorkspaceIdState] = useState(() =>
    hydrated?.activeWorkspaceId ?? hydrated?.workspaces[0]?.id ?? workspaces[0]?.id ?? "",
  );
  const [activeChatIdState, setActiveChatIdState] = useState(() =>
    hydrated?.activeChatId ?? firstChat(workspaces[0])?.id ?? "",
  );
  const [usage, setUsage] = useState<UsageTotals>(
    () => hydrated?.usage ?? { input: 0, output: 0, costUsd: 0, requests: 0 },
  );
  const [runs, setRuns] = useState<UsageRun[]>(() => hydrated?.runs ?? []);
  const [files, setFiles] = useState<VirtualFile[]>(() => hydrated?.files ?? VIRTUAL_PROJECT);
  const [viewerFile, setViewerFile] = useState<string | null>(null);

  const sessions = useMemo(() => workspaces.flatMap((workspace) => workspace.chats), [workspaces]);
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceIdState) ?? workspaces[0],
    [workspaces, activeWorkspaceIdState],
  );
  const session = useMemo(
    () => sessions.find((chat) => chat.id === activeChatIdState) ?? firstChat(activeWorkspace),
    [sessions, activeChatIdState, activeWorkspace],
  );

  const [saver] = useState(() => createDebouncedSaver(500));
  useEffect(() => {
    saver({ workspaces, activeWorkspaceId: activeWorkspace?.id ?? "", activeChatId: activeChatIdState, usage, files, runs });
  }, [saver, workspaces, activeWorkspace, activeChatIdState, usage, files, runs]);

  useEffect(() => {
    const handleBeforeUnload = () => saver.flush();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      saver.flush();
    };
  }, [saver]);

  const switchWorkspace = useCallback((id: string) => {
    setWorkspaces((current) => {
      const workspace = current.find((candidate) => candidate.id === id);
      if (!workspace) return current;
      setActiveWorkspaceIdState(id);
      setActiveChatIdState(firstChat(workspace)?.id ?? "");
      return current;
    });
  }, []);

  const switchChat = useCallback((id: string) => {
    setWorkspaces((current) => {
      const workspace = current.find((candidate) => candidate.chats.some((chat) => chat.id === id));
      if (!workspace) return current;
      setActiveWorkspaceIdState(workspace.id);
      setActiveChatIdState(id);
      return current;
    });
  }, []);

  const setActiveId = switchChat;
  const setActiveChatId = switchChat;
  const setActiveWorkspaceId = switchWorkspace;

  /** Compatibility setter: orchestration still updates a flat Session array. */
  const setSessions = useCallback(
    (update: SetStateAction<Session[]>) => {
      setWorkspaces((current) => {
        const previous = current.flatMap((workspace) => workspace.chats);
        const next = typeof update === "function" ? update(previous) : update;
        const previousIds = new Set(previous.map((chat) => chat.id));
        return current.map((workspace) => {
          const ownIds = new Set(workspace.chats.map((chat) => chat.id));
          const chats = next.filter((chat) => ownIds.has(chat.id)).map(asChat);
          if (workspace.id === activeWorkspaceIdState) {
            chats.push(...next.filter((chat) => !previousIds.has(chat.id)).map(asChat));
          }
          return { ...workspace, chats };
        });
      });
    },
    [activeWorkspaceIdState],
  );

  const createChat = useCallback(
    (modelId: string = defaultModelId, workspaceId: string = activeWorkspaceIdState) => {
      const chat = asChat(createNewSession(modelId));
      setWorkspaces((current) =>
        current.map((workspace) =>
          workspace.id === workspaceId ? { ...workspace, chats: [chat, ...workspace.chats] } : workspace,
        ),
      );
      setActiveWorkspaceIdState(workspaceId);
      setActiveChatIdState(chat.id);
      return chat.id;
    },
    [activeWorkspaceIdState, defaultModelId],
  );

  const handleNewSession = createChat;

  const renameChat = useCallback((id: string, title: string) => {
    setWorkspaces((current) =>
      current.map((workspace) => ({
        ...workspace,
        chats: workspace.chats.map((chat) => (chat.id === id ? { ...chat, title } : chat)),
      })),
    );
  }, []);

  const archiveChat = useCallback((id: string, archived = true) => {
    setWorkspaces((current) =>
      current.map((workspace) => ({
        ...workspace,
        chats: workspace.chats.map((chat) => (chat.id === id ? { ...chat, archived } : chat)),
      })),
    );
    if (archived && activeChatIdState === id) {
      const replacement = sessions.find((chat) => chat.id !== id && !chat.archived);
      if (replacement) switchChat(replacement.id);
    }
  }, [activeChatIdState, sessions, switchChat]);

  const deleteChat = useCallback((id: string) => {
    if (sessions.length <= 1) return;
    const targetChat = workspaces.flatMap((w) => w.chats).find((c) => c.id === id);
    if (targetChat) {
      const snapshotIds = targetChat.messages
        .flatMap((m) => m.attachments ?? [])
        .map((a) => a.snapshotId)
        .filter((sid): sid is string => Boolean(sid));
      if (snapshotIds.length > 0) {
        const store = getAttachmentSnapshotStore();
        for (const sid of snapshotIds) {
          void store.remove(sid).catch(() => undefined);
        }
      }
    }
    const next = workspaces.map((workspace) => ({
      ...workspace,
      chats: workspace.chats.filter((chat) => chat.id !== id),
    }));
    setWorkspaces(next);
    if (activeChatIdState === id) {
      const replacement = next.flatMap((workspace) => workspace.chats).find((chat) => !chat.archived)
        ?? next.flatMap((workspace) => workspace.chats)[0];
      if (replacement) switchChat(replacement.id);
    }
  }, [activeChatIdState, sessions.length, switchChat, workspaces]);

  const duplicateChat = useCallback((id: string) => {
    const source = workspaces.flatMap((workspace) => workspace.chats).find((chat) => chat.id === id);
    if (!source) return undefined;
    const duplicate = cloneChat(source);
    setWorkspaces((current) => current.map((workspace) =>
      workspace.chats.some((chat) => chat.id === id)
        ? { ...workspace, chats: [duplicate, ...workspace.chats] }
        : workspace,
    ));
    setActiveChatIdState(duplicate.id);
    return duplicate.id;
  }, [workspaces]);

  const pinChat = useCallback((id: string, pinned = true) => {
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      chats: workspace.chats.map((chat) => (chat.id === id ? { ...chat, pinned } : chat)),
    })));
  }, []);

  const createWorkspaceAction = useCallback((name = "New workspace", location?: WorkspaceLocation) => {
    const workspace = createWorkspace(name);
    if (location) workspace.location = location;
    setWorkspaces((current) => [...current, workspace]);
    setActiveWorkspaceIdState(workspace.id);
    setActiveChatIdState("");
    return workspace.id;
  }, []);

  const renameWorkspace = useCallback((id: string, name: string) => {
    setWorkspaces((current) => current.map((workspace) => workspace.id === id ? { ...workspace, name } : workspace));
  }, []);

  /** Associates browser-visible workspace metadata with a host-owned root. */
  const updateWorkspaceLocation = useCallback((id: string, location: WorkspaceLocation | undefined) => {
    setWorkspaces((current) => current.map((workspace) =>
      workspace.id === id ? { ...workspace, ...(location ? { location } : { location: undefined }) } : workspace,
    ));
  }, []);

  const archiveWorkspace = useCallback((id: string, archived = true) => {
    if (archived && workspaces.filter((workspace) => !workspace.archived && workspace.id !== id).length === 0) return;
    setWorkspaces((current) => current.map((workspace) => workspace.id === id ? { ...workspace, archived } : workspace));
    if (archived && activeWorkspaceIdState === id) {
      const replacement = workspaces.find((workspace) => workspace.id !== id && !workspace.archived);
      if (replacement) switchWorkspace(replacement.id);
    }
  }, [activeWorkspaceIdState, switchWorkspace, workspaces]);

  const deleteWorkspace = useCallback((id: string) => {
    if (workspaces.length <= 1) return;
    const targetWorkspace = workspaces.find((w) => w.id === id);
    if (targetWorkspace) {
      const snapshotIds = targetWorkspace.chats
        .flatMap((c) => c.messages)
        .flatMap((m) => m.attachments ?? [])
        .map((a) => a.snapshotId)
        .filter((sid): sid is string => Boolean(sid));
      if (snapshotIds.length > 0) {
        const store = getAttachmentSnapshotStore();
        for (const sid of snapshotIds) {
          void store.remove(sid).catch(() => undefined);
        }
      }
    }
    const next = workspaces.filter((workspace) => workspace.id !== id);
    setWorkspaces(next);
    if (activeWorkspaceIdState === id) {
      const replacement = next[0];
      setActiveWorkspaceIdState(replacement.id);
      setActiveChatIdState(firstChat(replacement)?.id ?? "");
    }
  }, [activeWorkspaceIdState, workspaces]);

  const duplicateWorkspace = useCallback((id: string) => {
    const source = workspaces.find((workspace) => workspace.id === id);
    if (!source) return undefined;
    const workspace: Workspace = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} copy`,
      createdAt: Date.now(),
      chats: source.chats.map(cloneChat),
      archived: false,
      pinned: false,
    };
    setWorkspaces((current) => [...current, workspace]);
    setActiveWorkspaceIdState(workspace.id);
    setActiveChatIdState(firstChat(workspace)?.id ?? "");
    return workspace.id;
  }, [workspaces]);

  const pinWorkspace = useCallback((id: string, pinned = true) => {
    setWorkspaces((current) => current.map((workspace) => workspace.id === id ? { ...workspace, pinned } : workspace));
  }, []);

  const handleClearHistory = useCallback((modelId: string = defaultModelId) => {
    saver.cancel();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage blocked */
    }
    const workspace = createWorkspace("Default workspace", [asChat(createNewSession(modelId))]);
    setWorkspaces([workspace]);
    setActiveWorkspaceIdState(workspace.id);
    setActiveChatIdState(workspace.chats[0].id);
    setUsage({ input: 0, output: 0, costUsd: 0, requests: 0 });
    setRuns([]);
    setFiles(VIRTUAL_PROJECT);
    setViewerFile(null);
  }, [defaultModelId, saver]);

  const handleExport = useCallback(() => {
    if (session) downloadSessionMarkdown(session);
  }, [session]);

  return {
    sessions,
    setSessions,
    activeId: activeChatIdState,
    setActiveId,
    session,
    usage,
    setUsage,
    runs,
    setRuns,
    files,
    setFiles,
    viewerFile,
    setViewerFile,
    saver,
    handleNewSession,
    handleRenameSession: renameChat,
    handleDeleteSession: deleteChat,
    handleClearHistory,
    handleExport,
    workspaces,
    activeWorkspaceId: activeWorkspace?.id ?? "",
    activeWorkspace,
    chats: activeWorkspace?.chats ?? [],
    activeChatId: activeChatIdState,
    setActiveWorkspaceId,
    setActiveChatId,
    createWorkspace: createWorkspaceAction,
    switchWorkspace,
    renameWorkspace,
    updateWorkspaceLocation,
    archiveWorkspace,
    deleteWorkspace,
    duplicateWorkspace,
    pinWorkspace,
    createChat,
    switchChat,
    renameChat,
    archiveChat,
    deleteChat,
    duplicateChat,
    pinChat,
  };
}
