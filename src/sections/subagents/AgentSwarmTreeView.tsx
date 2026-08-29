import { useState, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  DollarSign,
  Hourglass,
  Layers,
  Mail,
  Moon,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  Timer,
  Trash2,
  Zap,
} from "lucide-react";
import type { SubagentInfo, SubagentState, SubagentArchetype } from "@protocol/subagents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export interface AgentSwarmTreeViewProps {
  subagents: SubagentInfo[];
  activeSubagentId?: string | null;
  onSelectAgent: (subagentId: string) => void;
  onKillAgent: (subagentId: string) => void;
  onKillTree: (subagentId: string) => void;
  onMessageAgent?: (subagentId: string) => void;
  className?: string;
}

export interface TreeNode {
  agent: SubagentInfo;
  depth: number;
  children: TreeNode[];
}

/** Build hierarchical trees from flat list using parentId */
export function buildAgentForest(subagents: SubagentInfo[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const rootNodes: TreeNode[] = [];

  // Create nodes
  for (const agent of subagents) {
    nodeMap.set(agent.id, {
      agent,
      depth: 0,
      children: [],
    });
  }

  // Connect parents and children
  for (const agent of subagents) {
    const node = nodeMap.get(agent.id)!;
    if (agent.parentId && nodeMap.has(agent.parentId)) {
      const parent = nodeMap.get(agent.parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  // Fix depths recursively in case children were added before parent depth was computed
  function updateDepths(node: TreeNode, depth: number) {
    node.depth = depth;
    for (const child of node.children) {
      updateDepths(child, depth + 1);
    }
  }

  for (const root of rootNodes) {
    updateDepths(root, 0);
  }

  return rootNodes;
}

export function formatUptime(startedAt: string, completedAt?: string): string {
  try {
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const sec = Math.max(0, Math.floor((end - start) / 1000));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    if (min < 60) return `${min}m ${remSec}s`;
    const hrs = Math.floor(min / 60);
    const remMin = min % 60;
    return `${hrs}h ${remMin}m`;
  } catch {
    return "0s";
  }
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M tok`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k tok`;
  return `${tokens} tok`;
}

export function getBudgetGaugeColor(percentage: number): string {
  if (percentage < 70) return "bg-emerald-500";
  if (percentage <= 90) return "bg-amber-500";
  return "bg-red-500";
}

export function formatLatency(latencyMs: number): string {
  if (!latencyMs || latencyMs <= 0) return "0ms";
  if (latencyMs >= 1000) return `${(latencyMs / 1000).toFixed(2)}s`;
  return `${Math.round(latencyMs)}ms`;
}

export function formatCost(usd: number): string {
  if (usd <= 0) return "$0.000";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function getLivenessStatus(lastHeartbeat: string): {
  status: "healthy" | "delayed" | "stalled";
  color: string;
  label: string;
} {
  try {
    const last = new Date(lastHeartbeat).getTime();
    const diffMs = Date.now() - last;
    if (diffMs < 30_000) {
      return { status: "healthy", color: "bg-emerald-500", label: "Healthy" };
    }
    if (diffMs < 180_000) {
      return { status: "delayed", color: "bg-amber-500", label: "Active" };
    }
    return { status: "stalled", color: "bg-red-500", label: "STALLED >180s" };
  } catch {
    return { status: "stalled", color: "bg-red-500", label: "STALLED" };
  }
}

export function getStateBadge(state: SubagentState) {
  switch (state) {
    case "running":
      return {
        label: "Running",
        className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
        icon: <Activity className="h-3 w-3 animate-pulse text-emerald-400" />,
      };
    case "idle":
      return {
        label: "Idle",
        className: "bg-slate-500/10 text-slate-300 border-slate-500/30",
        icon: <Moon className="h-3 w-3 text-slate-400" />,
      };
    case "waiting_for_input":
      return {
        label: "Waiting for Input",
        className: "bg-amber-500/10 text-amber-400 border-amber-500/30",
        icon: <ShieldAlert className="h-3 w-3 text-amber-400" />,
      };
    case "waiting_for_dependents":
      return {
        label: "Waiting for Dependents",
        className: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30",
        icon: <Hourglass className="h-3 w-3 animate-pulse text-indigo-400" />,
      };
    case "waiting_for_message":
      return {
        label: "Waiting for Message",
        className: "bg-blue-500/10 text-blue-400 border-blue-500/30",
        icon: <Mail className="h-3 w-3 text-blue-400" />,
      };
    case "canceling":
      return {
        label: "Canceling",
        className: "bg-orange-500/10 text-orange-400 border-orange-500/30",
        icon: <RefreshCw className="h-3 w-3 animate-spin text-orange-400" />,
      };
    case "errored":
      return {
        label: "Errored",
        className: "bg-red-500/10 text-red-400 border-red-500/30",
        icon: <AlertTriangle className="h-3 w-3 text-red-400" />,
      };
    default:
      return {
        label: state,
        className: "bg-secondary text-muted-foreground border-border",
        icon: <Bot className="h-3 w-3" />,
      };
  }
}

export function getArchetypeStyle(archetype: SubagentArchetype) {
  switch (archetype) {
    case "explorer":
      return "bg-cyan-500/10 text-cyan-400 border-cyan-500/30";
    case "implementer":
      return "bg-purple-500/10 text-purple-400 border-purple-500/30";
    case "qa":
      return "bg-orange-500/10 text-orange-400 border-orange-500/30";
    case "specialist":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    case "verifier":
      return "bg-indigo-500/10 text-indigo-400 border-indigo-500/30";
    case "planner":
      return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    case "custom":
    default:
      return "bg-slate-500/10 text-slate-300 border-slate-500/30";
  }
}

export function AgentSwarmTreeView({
  subagents,
  activeSubagentId,
  onSelectAgent,
  onKillAgent,
  onKillTree,
  onMessageAgent,
  className = "",
}: AgentSwarmTreeViewProps) {
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedArchetype, setSelectedArchetype] = useState<string>("all");
  const [selectedState, setSelectedState] = useState<string>("all");

  const toggleCollapse = (id: string) => {
    setCollapsedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredSubagents = useMemo(() => {
    return subagents.filter((a) => {
      if (selectedArchetype !== "all" && a.archetype !== selectedArchetype) return false;
      if (selectedState !== "all" && a.state !== selectedState) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = a.name.toLowerCase().includes(q);
        const matchesId = a.id.toLowerCase().includes(q);
        const matchesRoles = a.roles.some((r) => r.toLowerCase().includes(q));
        const matchesProgress = (a.lastProgressSummary ?? "").toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesRoles && !matchesProgress) return false;
      }
      return true;
    });
  }, [subagents, searchQuery, selectedArchetype, selectedState]);

  const forest = useMemo(() => buildAgentForest(filteredSubagents), [filteredSubagents]);

  const renderNode = (node: TreeNode) => {
    const { agent, depth, children } = node;
    const isSelected = activeSubagentId === agent.id;
    const isCollapsed = !!collapsedNodes[agent.id];
    const stateBadge = getStateBadge(agent.state);
    const liveness = getLivenessStatus(agent.lastHeartbeat);
    const archetypeClass = getArchetypeStyle(agent.archetype);
    const hasChildren = children.length > 0;
    const telemetry = agent.telemetry;
    const budgetTokens = (agent as any).budgetTokens as number | undefined;
    const tokensUsed = agent.tokensUsed ?? (telemetry?.totalTokens ?? 0);
    const budgetPct = budgetTokens && budgetTokens > 0 ? Math.round((tokensUsed / budgetTokens) * 100) : null;
    const gaugeColor = budgetPct !== null ? getBudgetGaugeColor(budgetPct) : "bg-emerald-500";
    const avgLatency = telemetry?.avgTurnLatencyMs;
    const lastLatency = telemetry?.lastTurnLatencyMs;
    const tokPerSec = telemetry?.tokensPerSecond;
    const estimatedCost = telemetry?.estimatedCostUsd ?? (tokensUsed > 0 ? (tokensUsed / 1000) * 0.003 : 0);

    return (
      <div key={agent.id} className="relative flex flex-col" data-testid={`agent-tree-node-${agent.id}`}>
        {/* Node card */}
        <div
          className={`group flex flex-col rounded-lg border transition-all duration-150 p-3 mb-2 cursor-pointer ${
            isSelected
              ? "border-primary bg-primary/5 shadow-sm shadow-primary/10 ring-1 ring-primary"
              : "border-border/80 bg-card hover:border-border hover:bg-secondary/40"
          }`}
          style={{ marginLeft: `${depth * 24}px` }}
          onClick={() => onSelectAgent(agent.id)}
          data-testid="agent-card"
        >
          {/* Header row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {hasChildren ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapse(agent.id);
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label={isCollapsed ? "Expand subtree" : "Collapse subtree"}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
              ) : (
                <span className="w-4" />
              )}

              {/* Liveness dot */}
              <span
                className={`h-2 w-2 rounded-full ${liveness.color} ${
                  liveness.status === "healthy" ? "animate-pulse" : ""
                }`}
                title={`Heartbeat: ${liveness.label}`}
              />

              <span className="font-mono text-xs font-semibold text-foreground truncate" title={agent.name}>
                {agent.name}
              </span>

              <Badge variant="outline" className={`font-mono text-[10px] px-1.5 py-0 ${archetypeClass}`}>
                {agent.archetype}
              </Badge>

              {depth > 0 && (
                <Badge variant="secondary" className="font-mono text-[9px] px-1 py-0 text-muted-foreground">
                  Tier {depth}
                </Badge>
              )}
            </div>

            {/* State badge */}
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge variant="outline" className={`font-mono text-[10px] flex items-center gap-1 px-1.5 py-0.5 ${stateBadge.className}`}>
                {stateBadge.icon}
                <span>{stateBadge.label}</span>
              </Badge>
            </div>
          </div>

          {/* Token Budget Gauge & Meter */}
          <div className="mt-2 flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
              <span className="flex items-center gap-1">
                <Coins className="h-3 w-3 text-muted-foreground/70" />
                <span className="font-semibold text-foreground">{formatTokens(tokensUsed)}</span>
                {budgetTokens ? (
                  <span className="text-muted-foreground/70">
                    / {formatTokens(budgetTokens)} ({budgetPct}%)
                  </span>
                ) : null}
              </span>
              {telemetry && (telemetry.promptTokens > 0 || telemetry.completionTokens > 0) && (
                <span className="text-[9px] text-muted-foreground">
                  P: {formatTokens(telemetry.promptTokens || 0)} &bull; C: {formatTokens(telemetry.completionTokens || 0)}
                </span>
              )}
            </div>

            {budgetTokens ? (
              <div className="h-1.5 w-full bg-secondary/80 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${gaugeColor}`}
                  style={{ width: `${Math.min(100, budgetPct ?? 0)}%` }}
                  data-testid="token-budget-gauge"
                />
              </div>
            ) : null}
          </div>

          {/* Telemetry metrics & Badges row */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-mono text-muted-foreground">
            <span className="flex items-center gap-1 bg-secondary/40 px-1.5 py-0.5 rounded border border-border/40">
              <Clock className="h-3 w-3 text-muted-foreground/70" />
              <span>{formatUptime(agent.startedAt, agent.completedAt)}</span>
            </span>

            <span className="flex items-center gap-1 bg-secondary/40 px-1.5 py-0.5 rounded border border-border/40">
              <span>Turn {agent.turnCount || (telemetry?.turnCount ?? 0)}</span>
            </span>

            {avgLatency !== undefined && avgLatency > 0 && (
              <span className="flex items-center gap-1 bg-secondary/40 px-1.5 py-0.5 rounded border border-border/40 text-primary">
                <Timer className="h-3 w-3 text-primary/70" />
                <span>{formatLatency(avgLatency)} avg</span>
              </span>
            )}

            {lastLatency !== undefined && lastLatency > 0 && (
              <span className="flex items-center gap-1 bg-secondary/40 px-1.5 py-0.5 rounded border border-border/40">
                <span>{formatLatency(lastLatency)} last</span>
              </span>
            )}

            {tokPerSec !== undefined && tokPerSec > 0 && (
              <span className="flex items-center gap-1 bg-secondary/40 px-1.5 py-0.5 rounded border border-border/40 text-amber-400">
                <Zap className="h-3 w-3 text-amber-400" />
                <span>{Math.round(tokPerSec)} tok/s</span>
              </span>
            )}

            {estimatedCost > 0 && (
              <span className="flex items-center gap-1 bg-secondary/40 px-1.5 py-0.5 rounded border border-border/40 text-emerald-400">
                <DollarSign className="h-3 w-3 text-emerald-400" />
                <span>{formatCost(estimatedCost)}</span>
              </span>
            )}

            <span className="flex items-center gap-1 bg-secondary/40 px-1.5 py-0.5 rounded border border-border/40">
              <Layers className="h-3 w-3 text-muted-foreground/70" />
              <span>{agent.isolationMode}</span>
            </span>

            {agent.roles.length > 0 && (
              <span className="truncate max-w-[140px] text-muted-foreground/80" title={agent.roles.join(", ")}>
                roles: {agent.roles.join(", ")}
              </span>
            )}

            {liveness.status === "stalled" && (
              <Badge variant="destructive" className="font-mono text-[9px] px-1 py-0">
                STALLED &gt; 180s
              </Badge>
            )}
          </div>

          {/* Last progress summary if available */}
          {agent.lastProgressSummary && (
            <div className="mt-1.5 text-xs text-muted-foreground/90 bg-secondary/30 rounded px-2 py-1 line-clamp-1">
              {agent.lastProgressSummary}
            </div>
          )}

          {/* Error if present */}
          {agent.error && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{agent.error}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-2.5 flex items-center justify-end gap-1.5 pt-1.5 border-t border-border/40">
            {onMessageAgent && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] font-mono text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onMessageAgent(agent.id);
                }}
                title="Send message to subagent"
              >
                <Mail className="h-3 w-3 mr-1" />
                Message
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] font-mono text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={(e) => {
                e.stopPropagation();
                onKillAgent(agent.id);
              }}
              title="Terminate subagent"
            >
              <Power className="h-3 w-3 mr-1" />
              Kill
            </Button>

            {hasChildren && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] font-mono text-red-400 hover:bg-red-500/10 hover:text-red-300"
                onClick={(e) => {
                  e.stopPropagation();
                  onKillTree(agent.id);
                }}
                title="Terminate subagent and all child branches"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Kill Tree
              </Button>
            )}
          </div>
        </div>

        {/* Child branches */}
        {!isCollapsed && hasChildren && (
          <div className="flex flex-col relative">
            {children.map((child) => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full ${className}`} data-testid="agent-swarm-tree-view">
      {/* Search & Filter toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-border bg-card/50">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter agents by name, role, id..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 font-mono text-xs bg-background"
          />
        </div>

        <select
          value={selectedArchetype}
          onChange={(e) => setSelectedArchetype(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label="Filter by archetype"
        >
          <option value="all">All Archetypes</option>
          <option value="explorer">Explorer</option>
          <option value="implementer">Implementer</option>
          <option value="qa">QA</option>
          <option value="specialist">Specialist</option>
          <option value="verifier">Verifier</option>
          <option value="planner">Planner</option>
          <option value="custom">Custom</option>
        </select>

        <select
          value={selectedState}
          onChange={(e) => setSelectedState(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label="Filter by state"
        >
          <option value="all">All States</option>
          <option value="running">Running</option>
          <option value="idle">Idle</option>
          <option value="waiting_for_input">Waiting for Input</option>
          <option value="waiting_for_dependents">Waiting for Dependents</option>
          <option value="waiting_for_message">Waiting for Message</option>
          <option value="canceling">Canceling</option>
          <option value="errored">Errored</option>
        </select>
      </div>

      {/* Tree Canvas */}
      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
        {subagents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground p-6">
            <Bot className="h-8 w-8 mb-2 opacity-40" />
            <p className="font-mono text-xs font-semibold">No Subagents Spawned</p>
            <p className="font-mono text-[11px] text-muted-foreground/80 mt-1 max-w-sm">
              Use the "Spawn Agent" button above or dispatch subagents via orchestrator commands to view the swarm hierarchy.
            </p>
          </div>
        ) : filteredSubagents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center text-muted-foreground">
            <Search className="h-6 w-6 mb-2 opacity-40" />
            <p className="font-mono text-xs">No subagents match filter criteria</p>
          </div>
        ) : (
          <div className="space-y-1">
            {forest.map((treeRoot) => renderNode(treeRoot))}
          </div>
        )}
      </div>
    </div>
  );
}
