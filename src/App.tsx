import { useCallback, useState } from "react";
import { useConnectionManager } from "@/hooks/useConnectionManager";
import { useSessionPersistence } from "@/hooks/useSessionPersistence";
import { useAgentOrchestration } from "@/hooks/useAgentOrchestration";
import { useArtifacts } from "@/hooks/useArtifacts";
import { useHostSession, type UseHostSessionOptions } from "@/lib/hostSession";
import { AppLayout } from "@/components/layout/AppLayout";
import { CapabilityApprovalDialog } from "@/components/ui/CapabilityApprovalDialog";

export default function App({ hostSession }: { hostSession?: UseHostSessionOptions } = {}) {
  // Agent platform host session hook
  const host = useHostSession(hostSession);

  // Phase 1: Dedicated Artifact Dock Manager
  const artifactsManager = useArtifacts();

  // Connection & model catalog domain
  const {
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
  } = useConnectionManager();

  // Session & persistence domain
  const {
    setSessions,
    session,
    usage,
    setUsage,
    runs,
    setRuns,
    files,
    setFiles,
    viewerFile,
    setViewerFile,
    handleClearHistory,
    handleExport,
    workspaces,
    activeWorkspaceId,
    activeChatId,
    createWorkspace,
    switchWorkspace,
    renameWorkspace,
    archiveWorkspace,
    deleteWorkspace,
    duplicateWorkspace,
    pinWorkspace,
    updateWorkspaceLocation,
    createChat,
    switchChat,
    renameChat,
    archiveChat,
    deleteChat,
    duplicateChat,
    pinChat,
  } = useSessionPersistence(selectedModel);

  const [allowWorkspaceWrites, setAllowWorkspaceWrites] = useState(false);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const workspaceWriteCapability =
    host.status === "connected" &&
    activeWorkspace?.location?.status === "ready" &&
    allowWorkspaceWrites
      ? "live"
      : "virtual";

  const reviewedWorkspaceWrite = useCallback(
    async (path: string, content: string, options?: { expectedSha256?: string; expectedModified?: string }) => {
      const result = await host.writeWorkspaceFile(path, content, options);
      if (!result) throw new Error(host.lastError ?? "The local host rejected the reviewed write.");
      return result;
    },
    [host],
  );

  // Agent orchestration & chat loop domain
  const {
    running,
    handleSend,
    handleStop,
    handlePatchDecision,
  } = useAgentOrchestration({
    session,
    connected,
    connection,
    selectedModel,
    model,
    genPrefs,
    files,
    setFiles,
    setSessions,
    setUsage,
    setRuns,
    artifactsManager,
    readWorkspaceFile: host.readWorkspaceFile,
    writeWorkspaceFile: reviewedWorkspaceWrite,
    workspaceWriteCapability,
  });

  return (
    <>
      <AppLayout
        host={host}
      artifactsManager={artifactsManager}
      connection={connection}
      models={models}
      selectedModel={selectedModel}
      setSelectedModel={setSelectedModel}
      genPrefs={genPrefs}
      handleGenPrefsChange={handleGenPrefsChange}
      connected={connected}
      model={model}
      handleConnect={handleConnect}
      handleDisconnect={handleDisconnect}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspaceId}
      activeChatId={activeChatId}
      onSelectWorkspace={switchWorkspace}
      onCreateWorkspace={createWorkspace}
      onRenameWorkspace={renameWorkspace}
      onUpdateWorkspaceLocation={updateWorkspaceLocation}
      onPinWorkspace={pinWorkspace}
      onArchiveWorkspace={archiveWorkspace}
      onDuplicateWorkspace={duplicateWorkspace}
      onDeleteWorkspace={deleteWorkspace}
      onSelectChat={switchChat}
      onCreateChat={createChat}
      onRenameChat={renameChat}
      onPinChat={pinChat}
      onArchiveChat={archiveChat}
      onDuplicateChat={duplicateChat}
      onDeleteChat={deleteChat}
      session={session}
      usage={usage}
      runs={runs}
      files={files}
      viewerFile={viewerFile}
      setViewerFile={setViewerFile}
      handleClearHistory={handleClearHistory}
      handleExport={handleExport}
      running={running}
      handleSend={handleSend}
      handleStop={handleStop}
      handlePatchDecision={handlePatchDecision}
      allowWorkspaceWrites={allowWorkspaceWrites}
        onToggleWorkspaceWrites={setAllowWorkspaceWrites}
      />
      <CapabilityApprovalDialog
        request={host.capabilityApprovalPending}
        onDecide={host.decideCapabilityApproval}
      />
    </>
  );
}
