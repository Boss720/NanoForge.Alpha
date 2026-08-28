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
    (host.status …16892 tokens truncated…tton]:rounded-l-md"
            : "[&:first-child[data-selected=true]_button]:rounded-l-md",
          defaultClassNames.day
        ),
        range_start: cn(
          "rounded-l-md bg-accent",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn("rounded-r-md bg-accent", defaultClassNames.range_end),
        today: cn(
          "bg-accent text-accent-foreground rounded-md data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        outside: cn(
          "text-muted-foreground aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            )
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("size-4", className)}
                {...props}
              />
            )
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          )
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 dark:hover:text-accent-foreground flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] data-[range-end=true]:rounded-md data-[range-end=true]:rounded-r-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md data-[range-start=true]:rounded-l-md [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
