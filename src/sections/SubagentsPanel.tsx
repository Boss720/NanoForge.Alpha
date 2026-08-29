import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Cpu,
  Database,
  Flame,
  Mail,
  Network,
  Plus,
  Power,
  Terminal,
  X,
} from "lucide-react";
import type { HostSession } from "@/lib/hostSession";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AgentSwarmTreeView } from "./subagents/AgentSwarmTreeView";
import { AgentToolInspector } from "./subagents/AgentToolInspector";
import { AgentMailboxViewer } from "./subagents/AgentMailboxViewer";
import { DaemonTaskManager } from "./subagents/DaemonTaskManager";
import { SpawnSubagentModal } from "./subagents/SpawnSubagentModal";
import { AgentMemoryViewer } from "./subagents/AgentMemoryViewer";
import { AgentSwarmPlayground } from "./subagents/AgentSwarmPlayground";
import { SubagentsOverview } from "./subagents/SubagentsOverview";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface SubagentsPanelProps {
  session: HostSession;
  onClose?: () => void;
  onSelectArtifact?: (path: string) => void;
  className?: string;
}

export type SubagentsTab = "tree" | "playground" | "memory" | "tools" | "messages" | "daemons";

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
}

export function SubagentsPanel({
  session,
  onClose,
  onSelectArtifact,
  className = "",
}: SubagentsPanelProps) {
  const [activeTab, setActiveTab] = useState<SubagentsTab>("tree");
  const [isSpawnModalOpen, setIsSpawnModalOpen] = useState(false);
  const [isKillAllAlertOpen, setIsKillAllAlertOpen] = useState(false);
  const [selectedParentForSpawn, setSelectedParentForSpawn] = useState<string | null>(null);

  const {
    subagents = [],
    activeSubagentId = null,
    interAgentMessages = [],
    daemonTasks = [],
    schedules = [],
    sharedMemory = [],
    toolRuns = [],
    setActiveSubagentId,
    spawnSubagent,
    killSubagent,
    killSubagentTree,
    sendAgentMessage,
    createSchedule,
    cancelSchedule,
    sendTaskInput,
    killTask,
    stopToolRun,
    setSharedMemory,
    querySharedMemory,
    deleteSharedMemory,
    dispatchPlaygroundTurn,
    simulateAgentTurn,
    injectAgentFailure,
  } = session;

  // Aggregate Swarm Metrics
  const metrics = useMemo(() => {
    const runningCount = subagents.filter((a) => a.state === "running").length;
    const idleCount = subagents.filter((a) => a.state === "idle").length;
    const blockedCount = subagents.filter(
      (a) => a.state === "waiting_for_input" || a.state === "waiting_for_dependents" || a.state === "waiting_for_message"
    ).length;
    const erroredCount = subagents.filter((a) => a.state === "errored").length;

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    let totalBurnRate = 0;
    let totalLatency = 0;
    let latencyCount = 0;

    for (const a of subagents) {
      const t = a.telemetry;
      const tokens = a.tokensUsed || (t?.totalTokens ?? 0);
      totalTokens += tokens;
      if (t) {
        totalPromptTokens += t.promptTokens || 0;
        totalCompletionTokens += t.completionTokens || 0;
        totalBurnRate += t.tokensPerSecond || 0;
        if (t.avgTurnLatencyMs > 0) {
          totalLatency += t.avgTurnLatencyMs;
          latencyCount++;
        }
      }
    }

    const avgTurnLatency = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;
    const activeTasksCount = daemonTasks.filter((t) => t.status === "running").length;
    const activeTimersCount = schedules.filter((s) => s.status === "active").length;
    const memoryEntriesCount = sharedMemory.length;
    const memoryNamespacesCount = new Set(sharedMemory.map((e) => e.namespace || "global")).size;

    return {
      runningCount,
      idleCount,
      blockedCount,
      erroredCount,
      totalTokens,
      totalPromptTokens,
      totalCompletionTokens,
      totalBurnRate: Math.round(totalBurnRate),
      avgTurnLatency,
      activeTasksCount,
      activeTimersCount,
      memoryEntriesCount,
      memoryNamespacesCount,
    };
  }, [subagents, daemonTasks, schedules, sharedMemory]);

  const activeAgent = useMemo(() => {
    return subagents.find((a) => a.id === activeSubagentId) ?? null;
  }, [subagents, activeSubagentId]);

  const handleSelectAgent = (subagentId: string) => {
    setActiveSubagentId?.(subagentId);
  };

  const handleMessageAgent = (subagentId: string) => {
    setActiveSubagentId?.(subagentId);
    setActiveTab("messages");
  };

  const handleFocusAgent = (subagentId: string) => {
    setActiveSubagentId?.(subagentId);
    setActiveTab("tree");
  };

  const handleInspectAgent = (subagentId: string) => {
    setActiveSubagentId?.(subagentId);
    setActiveTab("tools");
  };

  const handleKillAgent = async (subagentId: string) => {
    try {
      await killSubagent?.(subagentId);
    } catch {
      // ignore
    }
  };

  const handleKillTree = async (subagentId: string) => {
    try {
      await killSubagentTree?.(subagentId);
    } catch {
      // ignore
    }
  };

  const handleKillAll = async () => {
    try {
      // Terminate all root agents and daemons
      for (const agent of subagents) {
        if (!agent.parentId) {
          void killSubagentTree?.(agent.id);
        }
      }
      for (const task of daemonTasks) {
        if (task.status === "running") {
          void killTask?.(task.taskId);
        }
      }
    } catch {
      // ignore
    } finally {
      setIsKillAllAlertOpen(false);
    }
  };

  return (
    <div
      className={`flex flex-col h-full bg-card border-l border-border select-none ${className}`}
      data-testid="subagents-panel"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card/80">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-md bg-primary/10 text-primary">
            <Network className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">
                Swarm Control Plane
              </h2>
              <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 text-primary border-primary/30">
                {subagents.length} agents
              </Badge>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground hidden sm:block">
              Supervision tree, mailboxes &amp; background daemons
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            className="h-7 px-2.5 font-mono text-xs"
            onClick={() => {
              setSelectedParentForSpawn(activeSubagentId ?? null);
              setIsSpawnModalOpen(true);
            }}
            data-testid="spawn-agent-btn"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Spawn Agent
          </Button>

          {subagents.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 font-mono text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={() => setIsKillAllAlertOpen(true)}
              title="Terminate all active subagents and tasks"
              data-testid="kill-all-btn"
            >
              <Power className="h-3.5 w-3.5" />
            </Button>
          )}

          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label="Close subagents dock"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Metrics Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-3 py-2 border-b border-border bg-secondary/20 text-center font-mono text-xs">
        <div className="flex flex-col items-center justify-center p-1 rounded bg-background/50 border border-border/40">
          <span className="text-[10px] text-muted-foreground">Agents</span>
          <span className="font-bold text-foreground flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {metrics.runningCount} <span className="text-[10px] text-muted-foreground font-normal">/ {subagents.length}</span>
          </span>
          <span className="text-[9px] text-muted-foreground/70 hidden sm:inline">
            {metrics.runningCount} run &bull; {metrics.idleCount} idle
          </span>
        </div>

        <div className="flex flex-col items-center justify-center p-1 rounded bg-background/50 border border-border/40">
          <span className="text-[10px] text-muted-foreground">Tokens</span>
          <span className="font-bold text-foreground">
            {formatTokens(metrics.totalTokens)}
          </span>
          <span className="text-[9px] text-muted-foreground/70 hidden sm:inline truncate max-w-[110px]">
            {metrics.totalPromptTokens > 0 || metrics.totalCompletionTokens > 0
              ? `P:${formatTokens(metrics.totalPromptTokens)} C:${formatTokens(metrics.totalCompletionTokens)}`
              : "prompt & compl"}
          </span>
        </div>

        <div className="flex flex-col items-center justify-center p-1 rounded bg-background/50 border border-border/40">
          <span className="text-[10px] text-muted-foreground">Burn &amp; Latency</span>
          <span className="font-bold text-foreground">
            {metrics.totalBurnRate > 0
              ? `${metrics.totalBurnRate} tok/s`
              : metrics.avgTurnLatency > 0
              ? `${metrics.avgTurnLatency}ms`
              : "0 tok/s"}
          </span>
          <span className="text-[9px] text-muted-foreground/70 hidden sm:inline">
            {metrics.avgTurnLatency > 0 ? `${metrics.avgTurnLatency}ms / turn` : "real-time"}
          </span>
        </div>

        <div className="flex flex-col items-center justify-center p-1 rounded bg-background/50 border border-border/40">
          <span className="text-[10px] text-muted-foreground">Shared Memory</span>
          <span className="font-bold text-foreground">
            {metrics.memoryEntriesCount} <span className="text-[10px] text-muted-foreground font-normal">entries</span>
          </span>
          <span className="text-[9px] text-muted-foreground/70 hidden sm:inline">
            {metrics.memoryNamespacesCount} namespace{metrics.memoryNamespacesCount === 1 ? "" : "s"}
          </span>
        </div>

        <div className="col-span-2 sm:col-span-1 flex flex-col items-center justify-center p-1 rounded bg-background/50 border border-border/40">
          <span className="text-[10px] text-muted-foreground">Daemons &amp; Timers</span>
          <span className="font-bold text-foreground">
            {metrics.activeTasksCount} <span className="text-[10px] text-muted-foreground font-normal">/ {metrics.activeTimersCount}</span>
          </span>
          <span className="text-[9px] text-muted-foreground/70 hidden sm:inline">
            {metrics.activeTasksCount} tasks &bull; {metrics.activeTimersCount} sched
          </span>
        </div>
      </div>

      <SubagentsOverview
        subagents={subagents}
        activeSubagentId={activeSubagentId}
        onFocusAgent={handleFocusAgent}
        onInspectAgent={handleInspectAgent}
      />

      {/* Tabs Navigation */}
      <div className="flex items-center border-b border-border bg-card font-mono text-xs overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveTab("tree")}
          className={`flex-1 min-w-[90px] py-2 px-1.5 text-center border-b-2 font-semibold transition-colors flex items-center justify-center gap-1 ${
            activeTab === "tree"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/30"
          }`}
          data-testid="tab-swarm-tree"
        >
          <Network className="h-3.5 w-3.5" />
          <span>Swarm Tree</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("playground")}
          className={`flex-1 min-w-[90px] py-2 px-1.5 text-center border-b-2 font-semibold transition-colors flex items-center justify-center gap-1 ${
            activeTab === "playground"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/30"
          }`}
          data-testid="tab-playground"
        >
          <Flame className="h-3.5 w-3.5" />
          <span>Playground</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("memory")}
          className={`flex-1 min-w-[90px] py-2 px-1.5 text-center border-b-2 font-semibold transition-colors flex items-center justify-center gap-1 ${
            activeTab === "memory"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/30"
          }`}
          data-testid="tab-memory"
        >
          <Database className="h-3.5 w-3.5" />
          <span>Memory</span>
          {metrics.memoryEntriesCount > 0 && (
            <span className="px-1 rounded-full bg-primary/20 text-primary text-[9px]">
              {metrics.memoryEntriesCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("tools")}
          className={`flex-1 min-w-[90px] py-2 px-1.5 text-center border-b-2 font-semibold transition-colors flex items-center justify-center gap-1 ${
            activeTab === "tools"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/30"
          }`}
          data-testid="tab-tool-activity"
        >
          <Terminal className="h-3.5 w-3.5" />
          <span>Tools</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("messages")}
          className={`flex-1 min-w-[90px] py-2 px-1.5 text-center border-b-2 font-semibold transition-colors flex items-center justify-center gap-1 ${
            activeTab === "messages"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/30"
          }`}
          data-testid="tab-messages"
        >
          <Mail className="h-3.5 w-3.5" />
          <span>Messages</span>
          {interAgentMessages.length > 0 && (
            <span className="px-1 rounded-full bg-primary/20 text-primary text-[9px]">
              {interAgentMessages.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("daemons")}
          className={`flex-1 min-w-[90px] py-2 px-1.5 text-center border-b-2 font-semibold transition-colors flex items-center justify-center gap-1 ${
            activeTab === "daemons"
              ? "border-primary text-primary bg-primary/5"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/30"
          }`}
          data-testid="tab-daemons"
        >
          <Cpu className="h-3.5 w-3.5" />
          <span>Daemons</span>
        </button>
      </div>

      {/* Main Tab Views Canvas */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "tree" && (
          <AgentSwarmTreeView
            subagents={subagents}
            activeSubagentId={activeSubagentId}
            onSelectAgent={handleSelectAgent}
            onKillAgent={handleKillAgent}
            onKillTree={handleKillTree}
            onMessageAgent={handleMessageAgent}
          />
        )}

        {activeTab === "playground" && (
          <AgentSwarmPlayground
            subagents={subagents}
            activeSubagentId={activeSubagentId}
            onDispatchTurn={dispatchPlaygroundTurn}
            onSimulateTurn={simulateAgentTurn}
            onInjectFailure={injectAgentFailure}
          />
        )}

        {activeTab === "memory" && (
          <AgentMemoryViewer
            sharedMemory={sharedMemory}
            subagents={subagents}
            activeSubagentId={activeSubagentId}
            onSetMemory={setSharedMemory}
            onDeleteMemory={deleteSharedMemory}
            onQueryMemory={querySharedMemory}
          />
        )}

        {activeTab === "tools" && (
          <AgentToolInspector
            toolRuns={toolRuns}
            activeSubagent={activeAgent}
            onStopTool={stopToolRun}
          />
        )}

        {activeTab === "messages" && (
          <AgentMailboxViewer
            messages={interAgentMessages}
            subagents={subagents}
            activeSubagentId={activeSubagentId}
            onSendMessage={async (recId, body, opts) => {
              if (sendAgentMessage) {
                return sendAgentMessage(recId, body, opts);
              }
            }}
            onSelectArtifact={onSelectArtifact}
          />
        )}

        {activeTab === "daemons" && (
          <DaemonTaskManager
            daemonTasks={daemonTasks}
            schedules={schedules}
            onSendInput={async (taskId, input) => {
              if (sendTaskInput) return sendTaskInput(taskId, input);
            }}
            onKillTask={async (taskId) => {
              if (killTask) return killTask(taskId);
            }}
            onCreateSchedule={createSchedule ? async (params) => createSchedule(params) : undefined}
            onCancelSchedule={async (schedId) => {
              if (cancelSchedule) return cancelSchedule(schedId);
            }}
          />
        )}
      </div>

      {/* Spawn Subagent Modal Dialog */}
      <SpawnSubagentModal
        open={isSpawnModalOpen}
        onOpenChange={setIsSpawnModalOpen}
        subagents={subagents}
        defaultParentId={selectedParentForSpawn}
        onSpawn={async (params, pId) => {
          if (spawnSubagent) {
            return spawnSubagent(params, pId);
          }
        }}
      />

      {/* Terminate All Confirmation Alert */}
      <AlertDialog open={isKillAllAlertOpen} onOpenChange={setIsKillAllAlertOpen}>
        <AlertDialogContent className="max-w-md border-border bg-card font-mono text-xs">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono text-sm text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              Terminate Entire Subagent Swarm?
            </AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs">
              This action will forcefully kill all active child subagents, abort their ongoing tool processes, release isolated Git worktrees, and terminate background daemon tasks.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleKillAll}
              className="bg-red-600 hover:bg-red-700 text-white font-mono text-xs"
            >
              Terminate All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
