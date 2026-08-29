import type { ReactNode } from "react";
import {
  Copy,
  FolderOpen,
  LayoutPanelLeft,
  MessageSquarePlus,
  PanelRight,
  RotateCcw,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface AppContextMenuProps {
  children: ReactNode;
  sidebarCollapsed: boolean;
  modelCollapsed: boolean;
  artifactDockOpen: boolean;
  activeFile?: string | null;
  onNewChat: () => void;
  onOpenFolder: () => void;
  onToggleSidebar: () => void;
  onToggleModelCatalog: () => void;
  onToggleArtifacts: () => void;
  onResetPanelLayout: () => void;
}

/** Context actions shared by the desktop shell, regardless of the clicked panel. */
export function AppContextMenu({
  children,
  sidebarCollapsed,
  modelCollapsed,
  artifactDockOpen,
  activeFile,
  onNewChat,
  onOpenFolder,
  onToggleSidebar,
  onToggleModelCatalog,
  onToggleArtifacts,
  onResetPanelLayout,
}: AppContextMenuProps) {
  const copyActiveFile = () => {
    if (!activeFile) return;
    void navigator.clipboard?.writeText(activeFile);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuLabel className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          NanoForge workspace
        </ContextMenuLabel>
        <ContextMenuItem onClick={onNewChat}>
          <MessageSquarePlus />
          New chat
          <ContextMenuShortcut>Ctrl+N</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onOpenFolder}>
          <FolderOpen />
          Open local folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onToggleSidebar}>
          <LayoutPanelLeft />
          {sidebarCollapsed ? "Show navigation sidebar" : "Hide navigation sidebar"}
        </ContextMenuItem>
        <ContextMenuItem onClick={onToggleModelCatalog}>
          <PanelRight />
          {modelCollapsed ? "Show model catalog" : "Hide model catalog"}
        </ContextMenuItem>
        <ContextMenuItem onClick={onToggleArtifacts}>
          <PanelRight />
          {artifactDockOpen ? "Close artifacts dock" : "Open artifacts dock"}
        </ContextMenuItem>
        <ContextMenuItem onClick={onResetPanelLayout}>
          <RotateCcw />
          Reset panel layout
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!activeFile} onClick={copyActiveFile}>
          <Copy />
          Copy active file path
          <ContextMenuShortcut>Ctrl+Shift+C</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
