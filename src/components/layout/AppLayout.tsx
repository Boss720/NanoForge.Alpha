import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import type {
  ConnectionState,
  ChatSendInput,
  GenerationPrefs,
  Model,
  Session,
  UsageRun,
  UsageTotals,
  VirtualFile,
  Workspace,
  WorkspaceLocation,
} from "@/types";
import type { FileTreeNode } from "@/types/workspace";
import { TopBar, type RuntimeStatus } from "@/sections/TopBar";
import { Sidebar } from "@/sections/Sidebar";
import { WorkspaceExplorer } from "@/sections/WorkspaceExplorer";
import { useWorkspace } from "@/hooks/use-workspace";
import { ChatPanel } from "@/sections/ChatPanel";
import { ModelPanel } from "@/sections/ModelPanel";
import { ConnectDialog } from "@/sections/ConnectDialog";
import { PlanPanel } from "@/sections/PlanPanel";
import { BrowserPermissionDialog } from "@/sections/BrowserPermissionDialog";
import { VisualEvidenceCard } from "@/sections/VisualEvidenceCard";
import { ArtifactDock } from "@/sections/ArtifactDock";
import { useMediaQuery } from "@/hooks/use-media-query";
import { HighlightedCode } from "@/components/RichText";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { useHostSession } from "@/lib/hostSession";
import { useWorkspaceBroker, type WorkspaceBrokerClientLike, type WorkspaceBrokerMetadata } from "@/hooks/useWorkspaceBroker";
import type { WorkspaceBrokerConnection } from "@protocol/workspace";
import type { useArtifacts } from "@/hooks/useArtifacts";
import type { CommandResultFrame, SlashCommandWire } from "@protocol/commands";
import type { HostWorkspaceDescriptor } from "@/lib/hostClient";

// Heavy UI panels lazy-loaded with React.lazy and Suspense for code splitting
const CostDashboard = lazy(() =>
  import("@/sections/CostDashboard").then((m) => ({ default: m.CostDashboard })),
);
const SubagentsPanel = lazy(() =>
  import("@/sections/SubagentsPanel").then((m) => ({ default: m.SubagentsPanel })),
);
const IntegrationsPanel = lazy(() =>
  import("@/sections/IntegrationsPanel").then((m) => ({ default: m.IntegrationsPanel })),
);
const ThemeCustomizer = lazy(() =>
  import("@/sections/settings/ThemeCustomizer").then((m) => ({ default: m.ThemeCustomizer })),
);
const ImagePanel = lazy(() => import("@/sections/ImagePanel"));

export function DockSkeleton({ label = "Loading panel..." }: { label?: string }) {
  return (
    <div
      data-testid="dock-skeleton"
      className="flex h-full w-full min-h-[200px] flex-col items-center justify-center gap-3 p-6 text-muted-foreground"
    >
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <span className="font-mono text-[12px]">{label}</span>
    </div>
  );
}

const MAX_SWITCHER_ITEMS = 50;

function flattenWorkspaceFiles(nodes: FileTreeNode[]): VirtualFile[] {
  return nodes.flatMap((node) => node.isDir
    ? flattenWorkspaceFiles(node.children ?? [])
    : [{ path: node.path, language: "text", content: "" }]);
}

const SWARM_ALIAS_ACTIONS: Record<string, string> = {
  "/agent-list": "list",
  "/agent-tree": "tree",
  "/agent-inspect": "inspect",
  "/agent-message": "message",
  "/agent-pause": "pause",
  "/agent-resume": "resume",
  "/agent-stop": "stop",
  "/agent-focus": "focus",
};

function normalizeSwarmCommand(wire: SlashCommandWire): SlashCommandWire {
  const original = wire.command.toLowerCase();
  const positional = [...wire.positional];
  const aliasAction = SWARM_ALIAS_ACTIONS[original];
  if (aliasAction) positional.unshift(aliasAction);
  else if (original === "/agents" && positional.length === 0) positional.unshift("list");

  return {
    ...wire,
    command: "/swarm",
    positional,
  };
}

export interface AppLayoutProps {
  host: ReturnType<typeof useHostSession>;
  artifactsManager: ReturnType<typeof useArtifacts>;
  connection: ConnectionState;
  models: Model[];
  selectedModel: string;
  setSelectedModel: (id: string) => void;
  genPrefs: GenerationPrefs;
  handleGenPrefsChange: (p: GenerationPrefs) => void;
  connected: boolean;
  model?: Model;
  handleConnect: (apiKey: string, baseUrl: string) => Promise<void>;
  handleDisconnect: () => void;
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeChatId: string;
  session?: Session;
  onSelectWorkspace: (id: string) => void;
  onCreateWorkspace: (name?: string, location?: WorkspaceLocation) => string | void;
  onRenameWorkspace: (id: string, name: string) => void;
  /** Optional while the app shell migration is in flight. */
  onUpdateWorkspaceLocation?: (id: string, location: WorkspaceLocation | undefined) => void;
  onPinWorkspace: (id: string, pinned?: boolean) => void;
  onArchiveWorkspace: (id: string, archived?: boolean) => void;
  onDuplicateWorkspace: (id: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onSelectChat: (id: string) => void;
  onCreateChat: (modelId?: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onPinChat: (id: string, pinned?: boolean) => void;
  onArchiveChat: (id: string, archived?: boolean) => void;
  onDuplicateChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  usage: UsageTotals;
  runs: UsageRun[];
  files: VirtualFile[];
  viewerFile: string | null;
  setViewerFile: (path: string | null) => void;
  handleClearHistory: (modelId?: string) => void;
  handleExport: () => void;
  running: boolean;
  handleSend: (text: string | ChatSendInput, opts?: { auto?: boolean }) => void;
  handleStop: () => void;
  handlePatchDecision: (messageId: string, decision: "applied" | "rejected") => void;
  /** Attachment lane consumes this seam once it owns chat attachment state. */
  onAttachWorkspaceFile?: (path: string) => void;
  allowWorkspaceWrites?: boolean;
  onToggleWorkspaceWrites?: (enabled: boolean) => void;
  /** Ephemeral launcher broker dependency injection; never persisted. */
  workspaceBrokerClient?: WorkspaceBrokerClientLike;
  workspaceBrokerMetadata?: WorkspaceBrokerMetadata | null;
  /** Future host-session dynamic reconnect seam. The current host session has no safe implementation. */
  onConnectionMetadata?: (connection: WorkspaceBrokerConnection) => void;
}

export function AppLayout({
  host,
  artifactsManager,
  connection,
  models,
  selectedModel,
  setSelectedModel,
  genPrefs,
  handleGenPrefsChange,
  connected,
  model,
  handleConnect,
  handleDisconnect,
  workspaces,
  activeWorkspaceId,
  activeChatId,
  onSelectWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onUpdateWorkspaceLocation,
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
  session,
  usage,
  runs,
  files,
  viewerFile,
  setViewerFile,
  handleClearHistory,
  handleExport,
  running,
  handleSend,
  handleStop,
  handlePatchDecision,
  onAttachWorkspaceFile,
  allowWorkspaceWrites,
  onToggleWorkspaceWrites,
  workspaceBrokerClient,
  workspaceBrokerMetadata,
  onConnectionMetadata,
}: AppLayoutProps) {
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [costsOpen, setCostsOpen] = useState(false);
  const [imagesOpen, setImagesOpen] = useState(false);
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const [openedWorkspace, setOpenedWorkspace] = useState<HostWorkspaceDescriptor | null>(null);
  const [workspaceRecovery, setWorkspaceRecovery] = useState<{ status: "ready" | "unavailable" | "connecting" | "unsupported"; message?: string }>({ status: "ready" });
  const [remoteViewer, setRemoteViewer] = useState<{ path: string; language: string; content: string } | null>(null);
  const [workspaceAttachmentRequest, setWorkspaceAttachmentRequest] = useState<string | null>(null);
  const workspaceBroker = useWorkspaceBroker({ client: workspaceBrokerClient, metadata: workspaceBrokerMetadata });

  const handleSwarmCommand = useCallback(
    async (wire: SlashCommandWire): Promise<CommandResultFrame> => {
      const normalized = normalizeSwarmCommand(wire);
      const action = normalized.positional[0]?.toLowerCase();
      setSubagentsOpen(true);

      if (!action) {
        return {
          type: "command.result",
          command: wire.command,
          success: true,
          output: "Swarm control plane opened.",
        };
      }

      if (action === "focus") {
        const agentId = normalized.positional[1];
        if (!agentId) {
          return { type: "command.result", command: wire.command, success: false, error: "swarm focus requires an agent id" };
        }
        host.setActiveSubagentId(agentId);
        return {
          type: "command.result",
          command: wire.command,
          success: true,
          output: `Focused agent ${agentId}.`,
          data: { agentId },
        };
      }

      return host.executeCommand({
        command: normalized.command,
        args: normalized.positional,
        rawText: normalized.rawInput,
        parsed: normalized,
      });
    },
    [host],
  );

  const isNarrow = useMediaQuery("(max-width: 1023px)");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState("");

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const persistedHostWorkspace = activeWorkspace?.location?.status === "ready";
  const hasHostWorkspace =
    (host.status === "connected" || host.runtimeState === "ready" || host.runtimeState === "healthy") &&
    (persistedHostWorkspace || openedWorkspace !== null);
  const runtimeStatus: RuntimeStatus = host.status === "off" || (host.runtimeState === "unavailable" && !host.enabled)
    ? "offline"
    : host.runtimeState === "reconnecting"
      ? "reconnecting"
      : host.runtimeState === "switching"
        ? "switching"
        : host.runtimeState === "starting" || host.status === "connecting"
          ? "connecting"
          : host.runtimeState === "needs_attention"
            ? "needs_attention"
            : host.status === "error" || host.runtimeState === "unavailable"
              ? "error"
              : hasHostWorkspace
                ? "ready"
                : activeWorkspace?.location
                  ? "unavailable"
                  : "no-workspace";
  const workspaceClient = useMemo(() => hasHostWorkspace ? {
    readDir: async (path = "") => {
      const result = await host.readWorkspaceDirectory(path);
      if (!result) throw new Error(host.lastError ?? "Unable to read local workspace");
      return result;
    },
    readFile: async (path: string) => {
      const result = await host.readWorkspaceFile(path);
      if (!result) throw new Error(host.lastError ?? "Unable to read local file");
      return result;
    },
    search: async (query: string, options?: { maxResults?: number }) => {
      const result = await host.searchWorkspace(query, options);
      if (!result) throw new Error(host.lastError ?? "Unable to search local workspace");
      return result;
    },
    gitStatus: async () => (await host.workspaceGitStatus()) ?? [],
  } : undefined, [hasHostWorkspace, host]);
  const workspaceExplorer = useWorkspace(workspaceClient);
  const { refreshTree, refreshGitStatus } = workspaceExplorer;

  useEffect(() => {
    if (!hasHostWorkspace) return;
    void refreshTree();
    void refreshGitStatus();
    void host.watchWorkspace();
    return () => { void host.unwatchWorkspace(); };
  }, [hasHostWorkspace, host, refreshGitStatus, refreshTree]);

  const openFolder = useCallback(async () => {
    if (running || host.subagents.some((agent) => agent.state === "running")) {
      const approved = window.confirm("Opening another folder interrupts active local work. Continue?");
      if (!approved) return;
    }
    if (!workspaceBroker.available) {
      setWorkspaceRecovery({ status: "unsupported", message: "Local folder selection is available only from the NanoForge launcher." });
      return;
    }
    setWorkspaceRecovery({ status: "connecting", message: "Waiting for the native folder picker…" });
    const selection = await workspaceBroker.choose();
    if (!selection) {
      setWorkspaceRecovery({ status: "ready" });
      return;
    }
    setWorkspaceRecovery({ status: "connecting", message: "Starting the selected local workspace…" });
    const result = await workspaceBroker.activate(selection.workspace.workspaceId);
    if (!result) {
      setWorkspaceRecovery({ status: "unavailable", message: "The selected folder could not be opened. Your current workspace is unchanged." });
      return;
    }
    const location: WorkspaceLocation = {
      kind: "local",
      hostWorkspaceId: result.workspace.workspaceId,
      displayPath: result.workspace.label,
      lastOpenedAt: Date.now(),
      status: "ready",
    };
    if (result.connection) {
      setWorkspaceRecovery({ status: "connecting", message: "Connecting the selected local workspace…" });
      const descriptor = await host.reconnectToWorkspace(result.connection);
      if (!descriptor) {
        setWorkspaceRecovery({ status: "unavailable", message: host.lastError ?? "The selected folder could not be connected. Your previous local host remains active." });
        return;
      }
      setOpenedWorkspace(descriptor);
      onConnectionMetadata?.(result.connection);
      const existing = workspaces.find((workspace) => workspace.location?.hostWorkspaceId === location.hostWorkspaceId);
      const appWorkspaceId = existing?.id ?? onCreateWorkspace(result.workspace.label, location);
      if (appWorkspaceId) {
        onUpdateWorkspaceLocation?.(appWorkspaceId, location);
        onSelectWorkspace(appWorkspaceId);
      }
      setWorkspaceRecovery({ status: "ready" });
      return;
    }
    const appWorkspaceId = onCreateWorkspace(result.workspace.label, { ...location, status: "unavailable" });
    setWorkspaceRecovery({ status: "unavailable", message: "Folder selected, but this session cannot connect a local host. Your current workspace is unchanged." });
    if (appWorkspaceId) onUpdateWorkspaceLocation?.(appWorkspaceId, { ...location, status: "unavailable" });
  }, [host, onConnectionMetadata, onCreateWorkspace, onSelectWorkspace, onUpdateWorkspaceLocation, running, workspaceBroker, workspaces]);

  const reconnectWorkspace = useCallback(() => {
    if (activeWorkspace?.location) setWorkspaceRecovery({ status: "unavailable", message: "Reconnect the local host, then reopen this folder from Recent folders." });
    else void openFolder();
  }, [activeWorkspace?.location, openFolder]);

  const openRecentWorkspace = useCallback(async (workspaceId: string) => {
    if (!workspaceBroker.available) {
      setWorkspaceRecovery({ status: "unsupported", message: "Recent local folders can only be opened from the NanoForge launcher." });
      return;
    }
    setWorkspaceRecovery({ status: "connecting", message: "Opening local folder…" });
    const result = await workspaceBroker.activate(workspaceId);
    if (!result) {
      setWorkspaceRecovery({ status: "unavailable", message: "The selected recent folder could not be opened." });
      return;
    }
    const location: WorkspaceLocation = {
      kind: "local",
      hostWorkspaceId: result.workspace.workspaceId,
      displayPath: result.workspace.label,
      lastOpenedAt: Date.now(),
      status: "ready",
    };
    if (result.connection) {
      setWorkspaceRecovery({ status: "connecting", message: "Connecting the selected local workspace…" });
      const descriptor = await host.reconnectToWorkspace(result.connection);
      if (!descriptor) {
        setWorkspaceRecovery({ status: "unavailable", message: host.lastError ?? "The selected folder could not be connected. Your previous local host remains active." });
        return;
      }
      setOpenedWorkspace(descriptor);
      onConnectionMetadata?.(result.connection);
      const existing = workspaces.find((candidate) => candidate.location?.hostWorkspaceId === workspaceId);
      const appWorkspaceId = existing?.id ?? onCreateWorkspace(result.workspace.label, location);
      if (appWorkspaceId) {
        onUpdateWorkspaceLocation?.(appWorkspaceId, location);
        onSelectWorkspace(appWorkspaceId);
      }
      setWorkspaceRecovery({ status: "ready" });
      return;
    }
    const appWorkspaceId = onCreateWorkspace(result.workspace.label, { ...location, status: "unavailable" });
    setWorkspaceRecovery({ status: "unavailable", message: "This folder is available in Recents, but this session cannot connect a local host. Your current workspace is unchanged." });
    if (appWorkspaceId) onUpdateWorkspaceLocation?.(appWorkspaceId, { ...location, status: "unavailable" });
  }, [host, onConnectionMetadata, onCreateWorkspace, onSelectWorkspace, onUpdateWorkspaceLocation, workspaceBroker, workspaces]);

  const revealWorkspacePath = useCallback(async (path: string) => {
    const workspaceId = activeWorkspace?.location?.hostWorkspaceId;
    if (!workspaceId || !workspaceBroker.available) return false;
    try {
      await workspaceBroker.reveal(workspaceId, path);
      return true;
    } catch {
      setWorkspaceRecovery({ status: "unavailable", message: "The launcher could not reveal that path." });
      return false;
    }
  }, [activeWorkspace?.location?.hostWorkspaceId, workspaceBroker]);

  const openWorkspaceFile = useCallback(async (path: string) => {
    const file = await host.readWorkspaceFile(path);
    if (!file) {
      setWorkspaceRecovery({ status: "unavailable", message: host.lastError ?? `Could not read ${path}.` });
      return;
    }
    setRemoteViewer(file);
  }, [host]);

  const attachWorkspaceFile = useCallback((path: string) => {
    setWorkspaceAttachmentRequest(path);
    onAttachWorkspaceFile?.(path);
    if (!onAttachWorkspaceFile) setWorkspaceRecovery({ status: "ready", message: `${path} is ready for the attachment pipeline.` });
  }, [onAttachWorkspaceFile]);

  const workspaceFiles = hasHostWorkspace ? flattenWorkspaceFiles(workspaceExplorer.tree) : files;
  const resolveWorkspaceAttachment = hasHostWorkspace
    ? async (path: string) => {
        const result = await host.readWorkspaceFile(path);
        if (!result) throw new Error(host.lastError ?? `Could not read ${path}.`);
        return {
          content: result.content,
          language: result.language,
          byteSize: result.size,
          mimeType: "text/plain",
        };
      }
    : undefined;

  useEffect(() => {
    if (!isNarrow) {
      setSidebarOpen(false);
      setModelsOpen(false);
    }
  }, [isNarrow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcherOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openFolder();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFolder]);

  useEffect(() => {
    if (switcherOpen) setSwitcherQuery("");
  }, [switcherOpen]);

  const activeViewer = useMemo(
    () => files.find((f) => f.path === viewerFile),
    [files, viewerFile],
  );
  const displayedViewer = remoteViewer ?? activeViewer;
  const effectiveRecovery = host.status === "off" && activeWorkspace?.location
    ? { status: "unavailable" as const, message: "Local host is offline. Reconnect to reopen this folder." }
    : workspaceRecovery;

  const explorerNode = hasHostWorkspace ? <WorkspaceExplorer
    className="h-full w-full border-0 bg-transparent"
    tree={workspaceExplorer.tree}
    activeFile={workspaceExplorer.activeFile}
    onFileSelect={openWorkspaceFile}
    onRevealPath={workspaceBroker.available && activeWorkspace?.location?.status === "ready" ? revealWorkspacePath : undefined}
    onRefresh={() => { void workspaceExplorer.refreshTree(); void workspaceExplorer.refreshGitStatus(); }}
    onSearch={(query) => { void workspaceExplorer.searchFiles(query); }}
    onLoadDirectory={workspaceExplorer.loadDirectory}
    onAttachToChat={attachWorkspaceFile}
    searchResults={workspaceExplorer.searchResults}
    error={workspaceExplorer.error}
    isConnected={host.status === "connected"}
  /> : undefined;

  const switcher = useMemo(() => {
    const q = switcherQuery.trim().toLowerCase();
    if (!q) {
      return {
        items: models.slice(0, MAX_SWITCHER_ITEMS),
        total: models.length,
        truncated: models.length > MAX_SWITCHER_ITEMS,
      };
    }
    const rank = (m: Model) => {
      const name = m.name.toLowerCase();
      const id = m.id.toLowerCase();
      if (name.startsWith(q)) return 0;
      if (id.startsWith(q)) return 1;
      return 2;
    };
    const matches = models
      .filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return {
      items: matches.slice(0, MAX_SWITCHER_ITEMS),
      total: matches.length,
      truncated: matches.length > MAX_SWITCHER_ITEMS,
    };
  }, [models, switcherQuery]);

  const switcherProviders = useMemo(
    () => Array.from(new Set(switcher.items.map((m) => m.provider))).sort(),
    [switcher.items],
  );

  const onConnectSubmit = useCallback(
    async (apiKey: string, baseUrl: string) => {
      await handleConnect(apiKey, baseUrl);
      setSettingsOpen(false);
    },
    [handleConnect],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <ErrorBoundary panelName="Top Bar">
        <TopBar
          connection={connection}
          usage={usage}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenModels={() => setModelsOpen(true)}
          onExport={handleExport}
          canExport={!!session && session.messages.length > 0}
          onOpenCosts={() => setCostsOpen(true)}
          onOpenImages={() => setImagesOpen(true)}
          onOpenArtifacts={artifactsManager.toggleDock}
          artifactCount={artifactsManager.artifacts.length}
          onOpenSubagents={() => setSubagentsOpen((o) => !o)}
          subagentCount={
            host.subagents.filter((a) => a.state === "running").length || host.subagents.length
          }
          onOpenTheme={() => setThemeOpen(true)}
          runtimeStatus={runtimeStatus}
        />
      </ErrorBoundary>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar dock for desktop (lg and up) */}
        <ErrorBoundary panelName="Sidebar Navigation" className="hidden lg:flex">
          <Sidebar
            className="hidden lg:flex"
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            activeChatId={activeChatId}
            onSelectWorkspace={onSelectWorkspace}
            onCreateWorkspace={onCreateWorkspace}
            onOpenFolder={() => { void openFolder(); }}
            onReconnectWorkspace={reconnectWorkspace}
            onOpenRecentWorkspace={openRecentWorkspace}
            recents={workspaceBroker.recents}
            workspaceRecovery={effectiveRecovery}
            onRenameWorkspace={onRenameWorkspace}
            onPinWorkspace={onPinWorkspace}
            onArchiveWorkspace={onArchiveWorkspace}
            onDuplicateWorkspace={onDuplicateWorkspace}
            onDeleteWorkspace={onDeleteWorkspace}
            onSelectChat={onSelectChat}
            onCreateChat={() => onCreateChat(selectedModel)}
            onRenameChat={onRenameChat}
            onPinChat={onPinChat}
            onArchiveChat={onArchiveChat}
            onDuplicateChat={onDuplicateChat}
            onDeleteChat={onDeleteChat}
            files={files}
            activeFile={viewerFile ?? ""}
            onFileSelect={(p) => setViewerFile(p)}
            workspaceExplorer={explorerNode}
          />
        </ErrorBoundary>

        {/* Central Chat Panel */}
        <ErrorBoundary panelName="Chat Transcript" className="flex-1">
          <ChatPanel
            messages={session?.messages ?? []}
            running={running}
            model={model}
            connected={connected}
            onSend={handleSend}
            onStop={handleStop}
            onPatchDecision={handlePatchDecision}
            genPrefs={genPrefs}
            onGenPrefsChange={handleGenPrefsChange}
            onOpenFolder={() => { void openFolder(); }}
            toolRuns={host.toolRuns}
            onToolStop={host.stopToolRun}
            onExecuteCommand={handleSwarmCommand}
            workspaceFiles={workspaceFiles}
            resolveWorkspaceAttachment={resolveWorkspaceAttachment}
            workspaceAttachmentRequest={workspaceAttachmentRequest}
            onWorkspaceAttachmentConsumed={() => setWorkspaceAttachmentRequest(null)}
          />
        </ErrorBoundary>

        {/* Artifact Viewer Dock */}
        {artifactsManager.isOpen && artifactsManager.artifacts.length > 0 && (
          <aside
            data-testid="artifact-rail"
            className="hidden min-h-0 w-[440px] shrink-0 flex-col lg:flex"
          >
            <ErrorBoundary panelName="Artifact Viewer">
              <ArtifactDock
                artifacts={artifactsManager.artifacts}
                activeArtifactId={artifactsManager.activeArtifactId}
                onSelectArtifact={artifactsManager.selectArtifact}
                onClose={artifactsManager.closeDock}
                onSendFeedback={artifactsManager.handleFeedback}
              />
            </ErrorBoundary>
          </aside>
        )}

        {/* Subagents Swarm Control Plane Dock */}
        {subagentsOpen && (
          <aside
            data-testid="subagents-rail"
            className="hidden min-h-0 w-[480px] shrink-0 flex-col lg:flex"
          >
            <ErrorBoundary panelName="Subagent Swarm Control Plane">
              <Suspense fallback={<DockSkeleton label="Loading Subagents Swarm Control Plane..." />}>
                <SubagentsPanel
                  session={host}
                  onClose={() => setSubagentsOpen(false)}
                  onSelectArtifact={(p) => setViewerFile(p)}
                />
              </Suspense>
            </ErrorBoundary>
          </aside>
        )}

        {/* Plan Inspector Side Rail (mounted when plan or evidence exists) */}
        {(host.plan || host.evidence) && (
          <aside data-testid="plan-rail" className="hidden min-h-0 w-80 shrink-0 flex-col lg:flex">
            {host.plan && (
              <ErrorBoundary panelName="Plan Inspector">
                <PlanPanel
                  plan={host.plan}
                  className="min-h-0 flex-1"
                  onApproveStep={host.approveStep}
                  onRunApproved={host.runApproved}
                  onPause={host.pause}
                  onCancel={host.cancel}
                />
              </ErrorBoundary>
            )}
            {host.evidence && (
              <ErrorBoundary panelName="Visual Evidence">
                <div className="scrollbar-thin max-h-[45%] shrink-0 overflow-y-auto border-l border-t border-border bg-card/40 p-2">
                  <VisualEvidenceCard
                    assertions={host.evidence.assertions}
                    diff={host.evidence.diff}
                  />
                </div>
              </ErrorBoundary>
            )}
          </aside>
        )}

        {/* Model Selection Panel */}
        <ErrorBoundary panelName="Model Selection" className="hidden lg:flex">
          <ModelPanel
            className="hidden lg:flex"
            models={models}
            selected={selectedModel}
            onSelect={setSelectedModel}
            live={connection.liveModels}
            routeDecision={host.routeDecision ?? undefined}
          />
        </ErrorBoundary>
      </div>

      {/* Mobile Drawers (Sheet) */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="gap-0 border-border bg-card p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Sessions &amp; workspace</SheetTitle>
          </SheetHeader>
          <ErrorBoundary panelName="Sidebar Navigation (Mobile)">
            <Sidebar
              className="h-full w-full border-r-0"
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              activeChatId={activeChatId}
              onSelectWorkspace={(id) => {
                onSelectWorkspace(id);
                setSidebarOpen(false);
              }}
              onCreateWorkspace={(name) => {
                onCreateWorkspace(name);
                setSidebarOpen(false);
              }}
              onOpenFolder={() => { void openFolder(); }}
              onReconnectWorkspace={reconnectWorkspace}
              onOpenRecentWorkspace={(id) => { openRecentWorkspace(id); setSidebarOpen(false); }}
              workspaceRecovery={effectiveRecovery}
              onRenameWorkspace={onRenameWorkspace}
              onPinWorkspace={onPinWorkspace}
              onArchiveWorkspace={onArchiveWorkspace}
              onDuplicateWorkspace={onDuplicateWorkspace}
              onDeleteWorkspace={onDeleteWorkspace}
              onSelectChat={(id) => {
                onSelectChat(id);
                setSidebarOpen(false);
              }}
              onCreateChat={() => {
                onCreateChat(selectedModel);
                setSidebarOpen(false);
              }}
              onRenameChat={onRenameChat}
              onPinChat={onPinChat}
              onArchiveChat={onArchiveChat}
              onDuplicateChat={onDuplicateChat}
              onDeleteChat={onDeleteChat}
              files={files}
              activeFile={viewerFile ?? ""}
              onFileSelect={(p) => {
                setViewerFile(p);
                setSidebarOpen(false);
              }}
              workspaceExplorer={explorerNode}
            />
          </ErrorBoundary>
        </SheetContent>
      </Sheet>

      <Sheet open={modelsOpen} onOpenChange={setModelsOpen}>
        <SheetContent side="right" className="gap-0 border-border bg-card p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Model catalog</SheetTitle>
          </SheetHeader>
          <ErrorBoundary panelName="Model Catalog (Mobile)">
            <ModelPanel
              className="h-full w-full border-l-0"
              models={models}
              selected={selectedModel}
              onSelect={(id) => {
                setSelectedModel(id);
                setModelsOpen(false);
              }}
              live={connection.liveModels}
              routeDecision={host.routeDecision ?? undefined}
            />
          </ErrorBoundary>
        </SheetContent>
      </Sheet>

      <Sheet open={subagentsOpen && isNarrow} onOpenChange={setSubagentsOpen}>
        <SheetContent side="right" className="gap-0 border-border bg-card p-0 sm:max-w-xl w-full">
          <SheetHeader className="sr-only">
            <SheetTitle>Subagent Swarm Control Plane</SheetTitle>
          </SheetHeader>
          <ErrorBoundary panelName="Subagents Panel (Mobile)">
            <Suspense fallback={<DockSkeleton label="Loading Subagents..." />}>
              <SubagentsPanel
                session={host}
                onClose={() => setSubagentsOpen(false)}
                onSelectArtifact={(p) => {
                  setViewerFile(p);
                  setSubagentsOpen(false);
                }}
              />
            </Suspense>
          </ErrorBoundary>
        </SheetContent>
      </Sheet>

      {/* Connect Settings Dialog */}
      <ErrorBoundary panelName="Connect Settings Dialog">
        <ConnectDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          connection={connection}
          onConnect={onConnectSubmit}
          onDisconnect={handleDisconnect}
          onClearHistory={() => handleClearHistory(selectedModel)}
          onOpenIntegrations={() => setIntegrationsOpen(true)}
          onOpenTheme={() => {
            setSettingsOpen(false);
            setThemeOpen(true);
          }}
          activeWorkspaceRoot={activeWorkspace?.location?.displayPath}
          allowWorkspaceWrites={allowWorkspaceWrites}
          onToggleWorkspaceWrites={onToggleWorkspaceWrites}
        />
      </ErrorBoundary>

      {/* Theme Customizer Dialog */}
      <Dialog open={themeOpen} onOpenChange={setThemeOpen}>
        <DialogContent className="scrollbar-thin max-h-[85vh] overflow-y-auto border-border bg-card sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-[13px] tracking-wide">
              Theme &amp; Visual Palette
            </DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              Customize presets, accent colors, surface contrast, and border radius in real-time.
            </DialogDescription>
          </DialogHeader>
          <ErrorBoundary panelName="Theme Customizer">
            <Suspense fallback={<DockSkeleton label="Loading theme customizer..." />}>
              <ThemeCustomizer onClose={() => setThemeOpen(false)} />
            </Suspense>
          </ErrorBoundary>
        </DialogContent>
      </Dialog>

      {/* Integrations Dialog */}
      <Dialog open={integrationsOpen} onOpenChange={setIntegrationsOpen}>
        <DialogContent className="scrollbar-thin max-h-[85vh] overflow-y-auto border-border bg-card sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-[13px] tracking-wide">Integrations</DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              Rules packs, skills, and MCP servers managed by the local agent host.
            </DialogDescription>
          </DialogHeader>
          <ErrorBoundary panelName="Integrations Manager">
            <Suspense fallback={<DockSkeleton label="Loading integrations..." />}>
              <IntegrationsPanel
                plugins={[]}
                rulesPacks={host.integrations.rulesPacks}
                skills={host.integrations.skills}
                mcpServers={host.integrations.mcpServers}
                onToggleRulesPack={host.toggleRulesPack}
                onToggleSkill={host.toggleSkill}
                onToggleMcpServer={host.toggleMcpServer}
                onTogglePlugin={() => {}}
              />
            </Suspense>
          </ErrorBoundary>
        </DialogContent>
      </Dialog>

      {/* Browser Permission Dialog */}
      <ErrorBoundary panelName="Browser Permission Dialog">
        <BrowserPermissionDialog
          request={host.permissionPending}
          onDecide={host.decidePermission}
        />
      </ErrorBoundary>

      {/* Ctrl/Cmd+K Model Switcher */}
      <CommandDialog
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        title="Switch model"
        description="Search the model catalog and press Enter to switch"
        className="border-border bg-card"
      >
        <CommandInput
          placeholder="search models…"
          value={switcherQuery}
          onValueChange={setSwitcherQuery}
        />
        <CommandList className="scrollbar-thin">
          <CommandEmpty className="font-mono text-[12px] text-muted-foreground">
            no models match
          </CommandEmpty>
          {switcherProviders.map((p) => (
            <CommandGroup heading={p} key={p}>
              {switcher.items
                .filter((m) => m.provider === p)
                .map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.name} ${m.id}`}
                    onSelect={() => {
                      setSelectedModel(m.id);
                      setSwitcherOpen(false);
                    }}
                    className="font-mono text-[12px]"
                  >
                    <span
                      className={m.id === selectedModel ? "text-primary" : "text-foreground"}
                    >
                      {m.name}
                    </span>
                    {m.id === selectedModel && <Check className="h-3 w-3 text-primary" />}
                    <CommandShortcut>
                      {m.priceEstimated ? "~" : ""}${m.inputPrice.toFixed(2)}/$
                      {m.outputPrice.toFixed(2)} · {m.contextK}k
                    </CommandShortcut>
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
        {switcher.truncated && (
          <div className="border-t border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
            showing {switcher.items.length} of {switcher.total} — keep typing to narrow
          </div>
        )}
      </CommandDialog>

      {/* Cost Dashboard Modal */}
      {costsOpen && (
        <ErrorBoundary panelName="Cost Dashboard">
          <Suspense fallback={null}>
            <CostDashboard
              open={costsOpen}
              onOpenChange={setCostsOpen}
              runs={runs}
              models={models}
              usage={usage}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Image Generation Panel Modal */}
      {imagesOpen && (
        <ErrorBoundary panelName="Image Generation Panel">
          <Suspense fallback={null}>
            <ImagePanel
              open={imagesOpen}
              onOpenChange={setImagesOpen}
              baseUrl={connection.baseUrl}
              apiKey={connection.apiKey}
              connected={connected}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* File Viewer Overlay Modal */}
      {displayedViewer && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6"
          onClick={() => { setViewerFile(null); setRemoteViewer(null); }}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <span className="font-mono text-[12px] text-foreground">{displayedViewer.path}</span>
              <span className="micro-label">{displayedViewer.language}</span>
              <div className="flex-1" />
              <button
                onClick={() => { setViewerFile(null); setRemoteViewer(null); }}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="scrollbar-thin flex-1 overflow-auto bg-black/30 p-4 font-mono text-[12px] leading-relaxed text-foreground/85">
              <code>
                <HighlightedCode code={displayedViewer.content} lang={displayedViewer.language} />
              </code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
