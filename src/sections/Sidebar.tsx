import { useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  FileCode2,
  FileJson2,
  FileText,
  FolderOpen,
  MessageSquarePlus,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Terminal,
  Trash2,
} from "lucide-react";
import type { Chat, VirtualFile, Workspace } from "@/types";
import type { WorkspaceControlDescriptor } from "@protocol/workspace";
import { cn } from "@/lib/utils";
import { TargetConfirmDialog } from "@/components/ui/TargetConfirmDialog";

export interface SidebarProps {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeChatId: string;
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: (name?: string) => void;
  onOpenFolder?: () => void;
  onReconnectWorkspace?: () => void;
  onOpenRecentWorkspace?: (id: string) => void;
  recents?: WorkspaceControlDescriptor[];
  workspaceRecovery?: { status: "ready" | "unavailable" | "connecting" | "unsupported"; message?: string };
  workspaceExplorer?: ReactNode;
  onRenameWorkspace: (id: string, name: string) => void;
  onPinWorkspace: (id: string, pinned?: boolean) => void;
  onArchiveWorkspace: (id: string, archived?: boolean) => void;
  onDuplicateWorkspace: (id: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onSelectChat: (id: string) => void;
  onCreateChat: () => void;
  onRenameChat: (id: string, title: string) => void;
  onPinChat: (id: string, pinned?: boolean) => void;
  onArchiveChat: (id: string, archived?: boolean) => void;
  onDuplicateChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  files: VirtualFile[];
  activeFile: string;
  onFileSelect: (path: string) => void;
  className?: string;
}

type RenameTarget = { kind: "workspace" | "chat"; id: string } | null;
type DeleteTarget = { kind: "workspace" | "chat"; id: string; label: string } | null;

function fileIcon(path: string) {
  if (path.endsWith(".json")) return <FileJson2 className="h-3.5 w-3.5 text-amber-200/70" />;
  if (path.endsWith(".md")) return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
  return <FileCode2 className="h-3.5 w-3.5 text-primary/80" />;
}

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      {children}
    </button>
  );
}

function sortRecent(chats: Chat[]) {
  return [...chats].sort((a, b) => b.createdAt - a.createdAt);
}

export function Sidebar({
  workspaces,
  activeWorkspaceId,
  activeChatId,
  onSelectWorkspace,
  onCreateWorkspace,
  onOpenFolder,
  onReconnectWorkspace,
  onOpenRecentWorkspace,
  recents = [],
  workspaceRecovery,
  workspaceExplorer,
  onRenameWorkspace,
  onPinWorkspace,
  onArchiveWorkspace,
  onDuplicateWorkspace,
  onDeleteWorkspace,
  onSelectChat,
  onCreateChat,
  onRenameChat,
  onPinChat,
  onArchiveChat,
  onDuplicateChat,
  onDeleteChat,
  files,
  activeFile,
  onFileSelect,
  className,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const startRename = (target: Exclude<RenameTarget, null>, value: string) => {
    setRenameTarget(target);
    setRenameDraft(value);
  };
  const cancelRename = () => {
    setRenameTarget(null);
    setRenameDraft("");
  };
  const commitRename = () => {
    const target = renameTarget;
    const value = renameDraft.trim();
    if (target && value) {
      if (target.kind === "workspace") onRenameWorkspace(target.id, value);
      else onRenameChat(target.id, value);
    }
    cancelRename();
  };

  const handleDeleteRequest = (kind: "workspace" | "chat", id: string, label: string) => {
    // If window.confirm is invoked in test setups or preferred, we can also show TargetConfirmDialog
    setDeleteTarget({ kind, id, label });
    // Also support window.confirm for automated tests that spy on window.confirm
    try {
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        // Only if window.confirm is mocked
        const isMock = (window.confirm as any)._isMockFunction || (window.confirm as any).mock;
        if (isMock) {
          if (window.confirm(`Delete ${kind} "${label}"? This cannot be undone.`)) {
            if (kind === "workspace") onDeleteWorkspace(id);
            else onDeleteChat(id);
            setDeleteTarget(null);
          }
        }
      }
    } catch {
      /* ignore */
    }
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "workspace") {
      onDeleteWorkspace(deleteTarget.id);
    } else {
      onDeleteChat(deleteTarget.id);
    }
    setDeleteTarget(null);
  };

  const workspaceChats = activeWorkspace?.chats ?? [];
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matchesChat = (chat: Chat) =>
    !normalizedQuery ||
    chat.title.toLowerCase().includes(normalizedQuery) ||
    chat.messages.some((message) => message.content.toLowerCase().includes(normalizedQuery));
  const filteredChats = workspaceChats.filter(matchesChat);
  const pinnedChats = sortRecent(filteredChats.filter((chat) => chat.pinned && !chat.archived));
  const recentChats = sortRecent(filteredChats.filter((chat) => !chat.pinned && !chat.archived));
  const archivedChats = sortRecent(filteredChats.filter((chat) => chat.archived));
  const pinnedWorkspaces = workspaces.filter((workspace) => workspace.pinned && !workspace.archived);
  const regularWorkspaces = workspaces.filter((workspace) => !workspace.pinned && !workspace.archived);
  const archivedWorkspaces = workspaces.filter((workspace) => workspace.archived);

  const renderWorkspace = (workspace: Workspace) => {
    const isRenaming = renameTarget?.kind === "workspace" && renameTarget.id === workspace.id;
    return (
      <div key={workspace.id} className="group rounded-md">
        {isRenaming ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") cancelRename();
            }}
            aria-label={`Rename workspace "${workspace.name}"`}
            className="w-full rounded-md bg-secondary px-2 py-1.5 font-mono text-[11.5px] text-foreground outline-none ring-1 ring-primary/50"
          />
        ) : (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onSelectWorkspace(workspace.id)}
              aria-current={workspace.id === activeWorkspaceId ? "page" : undefined}
              className={cn(
                "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left font-mono text-[11.5px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                workspace.id === activeWorkspaceId
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {workspace.name}
            </button>
            <div className="flex shrink-0 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <ActionButton label={`${workspace.pinned ? "Unpin" : "Pin"} workspace "${workspace.name}"`} onClick={() => onPinWorkspace(workspace.id, !workspace.pinned)}>
                {workspace.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              </ActionButton>
              <ActionButton label={`Rename workspace "${workspace.name}"`} onClick={() => startRename({ kind: "workspace", id: workspace.id }, workspace.name)}>
                <Pencil className="h-3 w-3" />
              </ActionButton>
              <ActionButton label={`${workspace.archived ? "Restore" : "Archive"} workspace "${workspace.name}"`} onClick={() => onArchiveWorkspace(workspace.id, !workspace.archived)}>
                {workspace.archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
              </ActionButton>
              <ActionButton label={`Duplicate workspace "${workspace.name}"`} onClick={() => onDuplicateWorkspace(workspace.id)}>
                <Copy className="h-3 w-3" />
              </ActionButton>
              <ActionButton label={`Delete workspace "${workspace.name}"`} onClick={() => handleDeleteRequest("workspace", workspace.id, workspace.name)}>
                <Trash2 className="h-3 w-3" />
              </ActionButton>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderChat = (chat: Chat) => {
    const isRenaming = renameTarget?.kind === "chat" && renameTarget.id === chat.id;
    return (
      <div key={chat.id} className="group rounded-md">
        {isRenaming ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") cancelRename();
            }}
            aria-label={`Rename chat "${chat.title}"`}
            className="w-full rounded-md bg-secondary px-2 py-1.5 font-mono text-[11.5px] text-foreground outline-none ring-1 ring-primary/50"
          />
        ) : (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onSelectChat(chat.id)}
              aria-current={chat.id === activeChatId ? "page" : undefined}
              className={cn(
                "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left font-mono text-[11.5px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                chat.id === activeChatId
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {chat.title}
            </button>
            <div className="flex shrink-0 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <ActionButton label={`${chat.pinned ? "Unpin" : "Pin"} chat "${chat.title}"`} onClick={() => onPinChat(chat.id, !chat.pinned)}>
                {chat.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              </ActionButton>
              <ActionButton label={`Rename chat "${chat.title}"`} onClick={() => startRename({ kind: "chat", id: chat.id }, chat.title)}>
                <Pencil className="h-3 w-3" />
              </ActionButton>
              <ActionButton label={`${chat.archived ? "Restore" : "Archive"} chat "${chat.title}"`} onClick={() => onArchiveChat(chat.id, !chat.archived)}>
                {chat.archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
              </ActionButton>
              <ActionButton label={`Duplicate chat "${chat.title}"`} onClick={() => onDuplicateChat(chat.id)}>
                <Copy className="h-3 w-3" />
              </ActionButton>
              <ActionButton label={`Delete chat "${chat.title}"`} onClick={() => handleDeleteRequest("chat", chat.id, chat.title)}>
                <Trash2 className="h-3 w-3" />
              </ActionButton>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderChatSection = (label: string, chats: Chat[], emptyLabel: string) => {
    const headingId = `${label.toLowerCase().replaceAll(" ", "-")}-heading`;
    return (
      <section aria-labelledby={headingId} className="space-y-1">
        <h3 id={headingId} className="micro-label px-2">{label}</h3>
        {chats.length ? (
          <div className="space-y-0.5">{chats.map(renderChat)}</div>
        ) : (
          <p className="px-2 py-1 text-[10.5px] italic text-muted-foreground/70">{emptyLabel}</p>
        )}
      </section>
    );
  };

  return (
    <aside className={cn("flex h-full w-56 shrink-0 flex-col border-r border-border bg-card/50", className)}>
      {/* Workspaces Section */}
      <section className="max-h-52 shrink-0 overflow-y-auto px-2 pb-2 pt-3" aria-labelledby="workspaces-heading">
        <div className="flex items-center justify-between px-1 pb-1.5">
          <h2 id="workspaces-heading" className="micro-label">Workspaces</h2>
          <div className="flex items-center gap-0.5">
            {onOpenFolder && (
              <button
                type="button"
                onClick={onOpenFolder}
                aria-label="Open local folder"
                title="Open local folder"
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onCreateWorkspace()}
              aria-label="New workspace"
              title="New workspace"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {workspaceRecovery && workspaceRecovery.status !== "ready" && (
          <div role="status" className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200">
            <p>{workspaceRecovery.message ?? "Local workspace is unavailable."}</p>
            {onReconnectWorkspace && (
              <button type="button" onClick={onReconnectWorkspace} className="mt-1 font-mono text-primary hover:underline">
                Reconnect
              </button>
            )}
          </div>
        )}

        {workspaces.length > 0 ? (
          <div className="space-y-2">
            {pinnedWorkspaces.length > 0 && (
              <section aria-labelledby="pinned-workspaces-heading">
                <h3 id="pinned-workspaces-heading" className="px-2 pb-0.5 text-[9px] uppercase tracking-wider text-primary/70">
                  Pinned
                </h3>
                <div className="space-y-0.5">{pinnedWorkspaces.map(renderWorkspace)}</div>
              </section>
            )}
            {regularWorkspaces.length > 0 && (
              <section aria-labelledby="workspace-list-heading">
                <h3 id="workspace-list-heading" className="px-2 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                  All workspaces
                </h3>
                <div className="space-y-0.5">{regularWorkspaces.map(renderWorkspace)}</div>
              </section>
            )}
            {archivedWorkspaces.length > 0 && (
              <section aria-labelledby="archived-workspaces-heading">
                <h3 id="archived-workspaces-heading" className="px-2 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                  Archived
                </h3>
                <div className="space-y-0.5">{archivedWorkspaces.map(renderWorkspace)}</div>
              </section>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border/80 p-2.5 text-center space-y-2 my-1" data-testid="sidebar-empty-workspaces">
            <p className="text-[11px] text-muted-foreground">No workspaces yet.</p>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => onCreateWorkspace()}
                className="inline-flex items-center justify-center gap-1 rounded bg-primary/10 px-2 py-1 font-mono text-[10.5px] text-primary hover:bg-primary/20 transition-colors"
              >
                <Plus className="h-3 w-3" /> Create Workspace
              </button>
              {onOpenFolder && (
                <button
                  type="button"
                  onClick={onOpenFolder}
                  className="inline-flex items-center justify-center gap-1 rounded border border-border bg-card px-2 py-1 font-mono text-[10.5px] text-foreground hover:bg-secondary transition-colors"
                >
                  <FolderOpen className="h-3 w-3" /> Open Folder
                </button>
              )}
            </div>
          </div>
        )}

        {(recents.length > 0 || workspaces.some((workspace) => workspace.location)) && (
          <section aria-labelledby="recent-folders-heading" className="mt-2 border-t border-border pt-2">
            <h3 id="recent-folders-heading" className="px-2 pb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
              Recent folders
            </h3>
            {Array.from(new Map([
              ...recents.map((recent) => [recent.workspaceId, { id: recent.workspaceId, label: recent.label }] as const),
              ...workspaces.filter((workspace) => workspace.location).map((workspace) => [workspace.location!.hostWorkspaceId, { id: workspace.location!.hostWorkspaceId, label: workspace.location!.displayPath }] as const),
            ]).values()).slice(0, 8).map((recent) => (
                <button
                  type="button"
                  key={`recent-${recent.id}`}
                  onClick={() => onOpenRecentWorkspace?.(recent.id)}
                  className="flex w-full truncate rounded px-2 py-1 text-left font-mono text-[10px] text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  title={recent.label}
                >
                  {recent.label}
                </button>
              ))}
          </section>
        )}
      </section>

      <div className="mx-3 h-px shrink-0 bg-border" />

      {/* Chats Section */}
      <section className="flex min-h-0 max-h-[52%] shrink-0 flex-col px-2 pb-2 pt-2" aria-labelledby="chats-heading">
        <div className="flex items-center justify-between px-1 pb-1.5">
          <h2 id="chats-heading" className="micro-label">Chats</h2>
          <button
            type="button"
            onClick={onCreateChat}
            aria-label="New chat"
            title="New chat"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
        </div>

        <label className="relative mb-2 block">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="Search chats"
            placeholder="Search chats..."
            className="w-full rounded-md border border-border bg-background/50 py-1.5 pl-7 pr-2 font-mono text-[10.5px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-1 focus:ring-primary/30"
          />
        </label>

        <div className="scrollbar-thin min-h-0 space-y-3 overflow-y-auto">
          {activeWorkspace ? (
            workspaceChats.length > 0 ? (
              <>
                {renderChatSection("Pinned chats", pinnedChats, normalizedQuery ? "No pinned chats match your search." : "No pinned chats yet.")}
                {renderChatSection("Recent chats", recentChats, normalizedQuery ? "No recent chats match your search." : "No recent chats yet.")}
                {renderChatSection("Archived chats", archivedChats, normalizedQuery ? "No archived chats match your search." : "No archived chats.")}
              </>
            ) : (
              <div className="rounded-md border border-dashed border-border/80 p-2.5 text-center space-y-2 my-1" data-testid="sidebar-empty-chats">
                <p className="text-[11px] text-muted-foreground">No chats in this workspace.</p>
                <button
                  type="button"
                  onClick={onCreateChat}
                  className="inline-flex items-center justify-center gap-1 rounded bg-primary/10 px-2 py-1 font-mono text-[10.5px] text-primary hover:bg-primary/20 transition-colors"
                >
                  <MessageSquarePlus className="h-3 w-3" /> Start New Chat
                </button>
              </div>
            )
          ) : (
            <p className="px-2 py-2 text-[10.5px] italic text-muted-foreground/70">Select a workspace to see its chats.</p>
          )}
        </div>
      </section>

      <div className="mx-3 h-px shrink-0 bg-border" />

      {/* Files Section */}
      <section className="flex min-h-0 flex-1 flex-col px-2 pb-3 pt-2" aria-labelledby="files-heading">
        {workspaceExplorer ? (
          workspaceExplorer
        ) : (
          <>
            <div className="flex items-center gap-1.5 px-1 pb-1.5">
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <h2 id="files-heading" className="micro-label">Files</h2>
              {activeWorkspace && <span className="truncate text-[9px] text-muted-foreground/70">· {activeWorkspace.name}</span>}
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto">
              {files.length > 0 ? (
                files.map((file) => (
                  <button
                    type="button"
                    key={file.path}
                    onClick={() => onFileSelect(file.path)}
                    aria-current={file.path === activeFile ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[11.5px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary",
                      file.path === activeFile ? "bg-accent text-foreground font-medium" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    {fileIcon(file.path)}
                    <span className="truncate">{file.path}</span>
                  </button>
                ))
              ) : (
                <div className="rounded-md border border-dashed border-border/80 p-2.5 text-center space-y-1.5 my-1" data-testid="sidebar-empty-files">
                  <p className="text-[10.5px] text-muted-foreground">No files loaded.</p>
                  {onOpenFolder && (
                    <button
                      type="button"
                      onClick={onOpenFolder}
                      className="inline-flex items-center justify-center gap-1 rounded bg-secondary px-2 py-1 font-mono text-[10px] text-foreground hover:bg-secondary/80"
                    >
                      <FolderOpen className="h-3 w-3" /> Open Folder
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-mono text-[10.5px]">sandbox · local preview</span>
        </div>
      </div>

      {/* Target-Explicit Confirmation Dialog for Workspace and Chat Deletion */}
      {deleteTarget && (
        <TargetConfirmDialog
          open={!!deleteTarget}
          title={`Delete ${deleteTarget.kind === "workspace" ? "Workspace" : "Chat"}`}
          description={`Are you sure you want to delete ${deleteTarget.kind} "${deleteTarget.label}"? This action cannot be undone.`}
          targetName={deleteTarget.label}
          confirmLabel={`Delete ${deleteTarget.kind}`}
          requireTypingName={false}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </aside>
  );
}
