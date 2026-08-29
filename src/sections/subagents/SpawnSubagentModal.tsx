import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Bot,
  Eye,
  FileCode,
  FolderTree,
  GitBranch,
  Layers,
  ListTodo,
  Search,
  ShieldAlert,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type {
  InvokeSubagentParams,
  SubagentArchetype,
  SubagentInfo,
  WorkspaceIsolationMode,
} from "@protocol/subagents";
import { MAX_SUBAGENT_HIERARCHY_DEPTH, MAX_CONCURRENT_SUBAGENTS } from "@protocol/subagents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatLaunchIsolation, validateLaunchSettings } from "./launchConfig";

export { validateLaunchSettings } from "./launchConfig";

export interface SpawnSubagentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subagents: SubagentInfo[];
  defaultParentId?: string | null;
  onSpawn: (params: InvokeSubagentParams, parentId?: string) => Promise<unknown>;
}

export const ARCHETYPES: Array<{
  id: SubagentArchetype;
  name: string;
  description: string;
  defaultRoles: string[];
  defaultTools: string[];
  icon: typeof Bot;
  color: string;
}> = [
  {
    id: "explorer",
    name: "Explorer",
    description: "Read-only reconnaissance, codebase search, and dependency mapping",
    defaultRoles: ["surveyor", "investigator"],
    defaultTools: ["file.read", "workspace.search"],
    icon: Search,
    color: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
  },
  {
    id: "implementer",
    name: "Implementer",
    description: "Code modifications, feature development, and surgical refactoring",
    defaultRoles: ["developer", "refactorer"],
    defaultTools: ["file.read", "file.edit", "file.write", "terminal.exec", "workspace.search"],
    icon: FileCode,
    color: "text-purple-400 border-purple-500/30 bg-purple-500/10",
  },
  {
    id: "qa",
    name: "QA Engineer",
    description: "Bug reproduction, test enhancement, regression repair, and lint fixing",
    defaultRoles: ["qa", "tester"],
    defaultTools: ["file.read", "file.edit", "terminal.exec", "workspace.search"],
    icon: Wrench,
    color: "text-orange-400 border-orange-500/30 bg-orange-500/10",
  },
  {
    id: "specialist",
    name: "Specialist",
    description: "Domain-specific expertise (Science, Android, DB, Security plugins)",
    defaultRoles: ["domain_expert"],
    defaultTools: ["file.read", "file.edit", "terminal.exec", "mcp.call", "browser.action"],
    icon: Sparkles,
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  },
  {
    id: "verifier",
    name: "Verifier / Auditor",
    description: "Independent audit, assertions check, and visual evidence verification",
    defaultRoles: ["auditor", "verifier"],
    defaultTools: ["file.read", "terminal.exec", "workspace.search"],
    icon: Eye,
    color: "text-indigo-400 border-indigo-500/30 bg-indigo-500/10",
  },
  {
    id: "planner",
    name: "Planner",
    description: "High-level goal decomposition, DAG dependency analysis, and milestones",
    defaultRoles: ["architect", "planner"],
    defaultTools: ["file.read", "workspace.search"],
    icon: ListTodo,
    color: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  },
  {
    id: "custom",
    name: "Custom Agent",
    description: "Full user-defined role assignments, system prompts, and custom toolsets",
    defaultRoles: [],
    defaultTools: ["file.read", "file.edit", "file.write", "terminal.exec", "workspace.search"],
    icon: Bot,
    color: "text-slate-300 border-slate-500/30 bg-slate-500/10",
  },
];

export const ROLE_TEMPLATES = ARCHETYPES;

export const TOOL_PERMISSIONS: Array<{ id: string; name: string; description: string }> = [
  { id: "file.read", name: "Read Files", description: "View workspace files & directories" },
  { id: "file.edit", name: "Edit Files", description: "Surgical block edits to existing files" },
  { id: "file.write", name: "Write Files", description: "Create or overwrite files in workspace" },
  { id: "terminal.exec", name: "Terminal Execution", description: "Run build, test, and shell commands" },
  { id: "workspace.search", name: "Workspace Search", description: "Ripgrep content and file search" },
  { id: "browser.action", name: "Browser Actions", description: "Managed browser navigation and testing" },
  { id: "mcp.call", name: "MCP Protocol", description: "External Model Context Protocol tools" },
];

/** Calculate depth of an agent node in the supervision tree */
export function getAgentDepth(agentId: string | null | undefined, subagents: SubagentInfo[]): number {
  if (!agentId || agentId === "root") return 0;
  const agent = subagents.find((a) => a.id === agentId);
  if (!agent) return 0;
  return 1 + getAgentDepth(agent.parentId, subagents);
}

export function SpawnSubagentModal({
  open,
  onOpenChange,
  subagents,
  defaultParentId,
  onSpawn,
}: SpawnSubagentModalProps) {
  const [parentId, setParentId] = useState<string>(defaultParentId ?? "root");
  const [archetype, setArchetype] = useState<SubagentArchetype>("implementer");
  const [name, setName] = useState<string>("");
  const [roles, setRoles] = useState<string[]>(["developer"]);
  const [roleInput, setRoleInput] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [workspaceIsolation, setWorkspaceIsolation] = useState<WorkspaceIsolationMode>("inherit");
  const [allowedToolKinds, setAllowedToolKinds] = useState<string[]>([
    "file.read",
    "file.edit",
    "file.write",
    "terminal.exec",
    "workspace.search",
  ]);
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(600);
  const [budgetTokens, setBudgetTokens] = useState<string>("50000");
  const [concurrency, setConcurrency] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Depth calculation
  const currentParentDepth = useMemo(() => {
    return parentId === "root" ? 0 : getAgentDepth(parentId, subagents);
  }, [parentId, subagents]);

  const proposedDepth = currentParentDepth + 1;
  const isDepthExceeded = proposedDepth > MAX_SUBAGENT_HIERARCHY_DEPTH;
  const isConcurrencyExceeded = subagents.filter((a) => a.state === "running").length >= MAX_CONCURRENT_SUBAGENTS;
  const activeCount = subagents.filter((a) => a.state === "running").length;
  const launchErrors = validateLaunchSettings({
    missionGoal: prompt,
    roles,
    timeoutSeconds,
    budgetTokens,
    workspaceIsolation,
    concurrency,
    activeCount,
  });

  const handleArchetypeSelect = (arch: typeof ARCHETYPES[number]) => {
    setArchetype(arch.id);
    setRoles([...arch.defaultRoles]);
    setAllowedToolKinds([...arch.defaultTools]);
  };

  const handleAddRole = () => {
    const trimmed = roleInput.trim();
    if (trimmed && !roles.includes(trimmed)) {
      setRoles((prev) => [...prev, trimmed]);
      setRoleInput("");
    }
  };

  const handleRemoveRole = (roleToRemove: string) => {
    setRoles((prev) => prev.filter((r) => r !== roleToRemove));
  };

  const toggleToolKind = (toolKind: string) => {
    setAllowedToolKinds((prev) =>
      prev.includes(toolKind) ? prev.filter((t) => t !== toolKind) : [...prev, toolKind],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (isDepthExceeded) {
      setErrorMsg(`SEC-SUB-05: Maximum supervisor hierarchy depth of ${MAX_SUBAGENT_HIERARCHY_DEPTH} tiers reached.`);
      return;
    }

    if (launchErrors.length > 0) {
      setErrorMsg(launchErrors[0]);
      return;
    }

    setIsSubmitting(true);
    try {
      const parsedTokens = parseInt(budgetTokens, 10);
      const params: InvokeSubagentParams = {
        archetype,
        ...(name.trim() ? { name: name.trim() } : {}),
        roles,
        skills: [],
        prompt: prompt.trim(),
        workspaceIsolation,
        allowedToolKinds,
        timeoutSeconds,
        ...(isNaN(parsedTokens) || parsedTokens <= 0 ? {} : { budgetTokens: parsedTokens }),
      };

      for (let i = 0; i < concurrency; i += 1) {
        await onSpawn(params, parentId === "root" ? undefined : parentId);
      }
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto border-border bg-card font-mono text-xs scrollbar-thin">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <DialogTitle className="font-mono text-sm tracking-wide">
              Spawn Autonomous Subagent
            </DialogTitle>
          </div>
          <DialogDescription className="font-mono text-[11px]">
            Deploy a dedicated child agent under the supervision tree with sandboxing and tool gates.
          </DialogDescription>
        </DialogHeader>

        {/* Validation warnings */}
        {isDepthExceeded && (
          <div className="flex items-center gap-2 p-2.5 rounded border border-red-500/30 bg-red-500/10 text-red-400 text-xs">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span>
              <strong>SEC-SUB-05:</strong> Maximum supervisor hierarchy depth of {MAX_SUBAGENT_HIERARCHY_DEPTH} tiers reached. Cannot spawn deeper children under this parent.
            </span>
          </div>
        )}

        {isConcurrencyExceeded && (
          <div className="flex items-center gap-2 p-2.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Concurrency warning: Active subagents count has reached {MAX_CONCURRENT_SUBAGENTS}. Consider terminating idle workers before spawning more.
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center gap-2 p-2.5 rounded border border-red-500/30 bg-red-500/10 text-red-400 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Parent Agent Selector & Depth */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-foreground mb-1">
                Parent Supervisor
              </label>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs text-foreground"
                aria-label="Parent Supervisor"
              >
                <option value="root">Root Orchestrator (Tier 0)</option>
                {subagents.map((a) => {
                  const d = getAgentDepth(a.id, subagents);
                  return (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.archetype} - Tier {d})
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-foreground mb-1">
                Agent Name (Optional)
              </label>
              <Input
                placeholder="e.g. worker_m3, audit_agent"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 font-mono text-xs bg-background"
              />
            </div>
          </div>

          {/* Archetype Selector Grid */}
          <div>
            <label className="block font-semibold text-foreground mb-1.5">
              Role template
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ARCHETYPES.map((arch) => {
                const Icon = arch.icon;
                const isSelected = archetype === arch.id;

                return (
                  <button
                    type="button"
                    key={arch.id}
                    onClick={() => handleArchetypeSelect(arch)}
                    aria-pressed={isSelected}
                    aria-label={`${arch.name} role template`}
                    className={`cursor-pointer rounded-lg border p-2.5 transition-all text-left flex flex-col justify-between ${
                      isSelected
                        ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary"
                        : "border-border/70 bg-secondary/30 hover:border-border hover:bg-secondary/60"
                    }`}
                    data-testid={`archetype-option-${arch.id}`}
                  >
                    <span data-testid={`role-template-${arch.id}`} className="sr-only">Select {arch.name} role template</span>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon className="h-3.5 w-3.5 text-primary" />
                      <span className="font-semibold text-xs text-foreground">{arch.name}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground line-clamp-2 leading-tight">
                      {arch.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Roles Tags */}
          <div>
            <label className="block font-semibold text-foreground mb-1">
              Role Tags
            </label>
            <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded border border-input bg-background min-h-[34px]">
              {roles.map((r) => (
                <Badge key={r} variant="secondary" className="font-mono text-[10px] flex items-center gap-1 pr-1">
                  <span>{r}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRole(r)}
                    className="hover:text-red-400 rounded-full"
                    aria-label={`Remove role ${r}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}
              <div className="flex-1 flex items-center gap-1 min-w-[120px]">
                <Input
                  placeholder="Add role & press Enter..."
                  value={roleInput}
                  onChange={(e) => setRoleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      handleAddRole();
                    }
                  }}
                  className="h-6 border-0 focus-visible:ring-0 p-0 text-[11px] font-mono shadow-none"
                />
              </div>
            </div>
          </div>

          {/* Mission Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-foreground">
                Mission Prompt <span className="text-red-400">*</span>
              </label>
              <span className="text-[10px] text-muted-foreground">
                {prompt.length} chars
              </span>
            </div>
            <Textarea
              data-testid="mission-goal"
              placeholder="Describe the agent's objective, instructions, and constraints in detail..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
              rows={4}
              className="font-mono text-xs bg-background resize-none leading-relaxed"
            />
          </div>

          {/* Workspace Isolation Mode */}
          <div>
            <label className="block font-semibold text-foreground mb-1.5">
              Workspace Isolation Mode
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label
                className={`flex flex-col p-2 rounded border cursor-pointer transition-all ${
                  workspaceIsolation === "inherit"
                    ? "border-primary bg-primary/10"
                    : "border-border/70 bg-secondary/20 hover:bg-secondary/40"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <input
                    type="radio"
                    name="isolation"
                    value="inherit"
                    checked={workspaceIsolation === "inherit"}
                    onChange={() => setWorkspaceIsolation("inherit")}
                    className="sr-only"
                  />
                  <FolderTree className="h-3.5 w-3.5 text-primary" />
                  <span className="font-semibold text-[11px]">Inherit</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Shared root with private <code>.agents/&lt;id&gt;</code> metadata
                </p>
              </label>

              <label
                className={`flex flex-col p-2 rounded border cursor-pointer transition-all ${
                  workspaceIsolation === "branch"
                    ? "border-primary bg-primary/10"
                    : "border-border/70 bg-secondary/20 hover:bg-secondary/40"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <input
                    type="radio"
                    name="isolation"
                    value="branch"
                    checked={workspaceIsolation === "branch"}
                    onChange={() => setWorkspaceIsolation("branch")}
                    className="sr-only"
                  />
                  <GitBranch className="h-3.5 w-3.5 text-purple-400" />
                  <span className="font-semibold text-[11px]">Branch Worktree</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Isolated Git worktree on <code>nano/&lt;id&gt;</code> branch
                </p>
              </label>

              <label
                className={`flex flex-col p-2 rounded border cursor-pointer transition-all ${
                  workspaceIsolation === "share"
                    ? "border-primary bg-primary/10"
                    : "border-border/70 bg-secondary/20 hover:bg-secondary/40"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <input
                    type="radio"
                    name="isolation"
                    value="share"
                    checked={workspaceIsolation === "share"}
                    onChange={() => setWorkspaceIsolation("share")}
                    className="sr-only"
                  />
                  <Layers className="h-3.5 w-3.5 text-cyan-400" />
                  <span className="font-semibold text-[11px]">Share Scratch</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Read-only root + ephemeral scratch overlay
                </p>
              </label>
            </div>
          </div>

          {/* Tool Permission Checkbox Matrix */}
          <div>
            <label className="block font-semibold text-foreground mb-1.5">
              Tool Permission Matrix
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TOOL_PERMISSIONS.map((tool) => {
                const isChecked = allowedToolKinds.includes(tool.id);

                return (
                  <label
                    key={tool.id}
                    className={`flex items-start gap-2 p-2 rounded border cursor-pointer transition-all ${
                      isChecked
                        ? "border-primary/60 bg-primary/5 text-foreground"
                        : "border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleToolKind(tool.id)}
                      className="rounded border-border bg-background text-primary focus:ring-1 focus:ring-primary h-3.5 w-3.5 mt-0.5"
                    />
                    <div className="leading-tight">
                      <div className="font-semibold text-[11px]">{tool.name}</div>
                      <div className="text-[9px] text-muted-foreground">{tool.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Resource Limits */}
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div>
              <label className="block font-semibold text-foreground mb-1">
                Concurrency
              </label>
              <Input
                data-testid="launch-concurrency"
                type="number"
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value, 10) || 0)}
                min={1}
                max={MAX_CONCURRENT_SUBAGENTS}
                className="h-8 font-mono text-xs bg-background"
              />
              <span className="text-[9px] text-muted-foreground">{activeCount}/{MAX_CONCURRENT_SUBAGENTS} active</span>
            </div>
            <div>
              <label className="block font-semibold text-foreground mb-1">
                Timeout: {timeoutSeconds}s ({Math.floor(timeoutSeconds / 60)} min)
              </label>
              <input
                type="range"
                min={60}
                max={3600}
                step={60}
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            <div>
              <label className="block font-semibold text-foreground mb-1">
                Token Budget
              </label>
              <Input
                type="number"
                value={budgetTokens}
                onChange={(e) => setBudgetTokens(e.target.value)}
                placeholder="50000"
                min={1000}
                className="h-8 font-mono text-xs bg-background"
              />
            </div>
          </div>

          <div data-testid="dry-run-preview" className="rounded border border-primary/20 bg-primary/5 p-2.5 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-semibold text-primary">Dry-run launch preview</span>
              <Badge variant="outline" className="text-[9px]">No host call yet</Badge>
            </div>
            <p className="leading-relaxed">
              {concurrency} {concurrency === 1 ? "agent" : "agents"} · {archetype} · {roles.length ? roles.join(", ") : "no role"} · {formatLaunchIsolation(workspaceIsolation)} · {budgetTokens || "—"} tokens · {timeoutSeconds}s
            </p>
            <p className="mt-1 text-foreground/80">Review the mission and settings above, then use the explicit confirmation action to spawn.</p>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting || isDepthExceeded || launchErrors.length > 0}
              className="font-mono text-xs"
            >
              {isSubmitting ? "Spawning Subagent..." : "Confirm & Spawn Agent"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
