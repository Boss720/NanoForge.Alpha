import { useState, useMemo } from "react";
import {
  RotateCcw,
  Sparkles,
  Bot,
  Terminal,
  AlertTriangle,
  Flame,
  Clock,
  Coins,
  ShieldAlert,
  RefreshCw,
  Send,
  Zap,
  Activity,
  Copy,
  Check,
} from "lucide-react";
import type { SubagentInfo, SupervisorStrategy } from "@protocol/subagents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

export interface PlaygroundTurnLog {
  id: string;
  turnNumber: number;
  subagentId: string;
  subagentName: string;
  mode: "live" | "simulated";
  scenario?: string;
  prompt: string;
  response: string;
  toolsUsed: Array<{ name: string; args?: unknown; output?: string }>;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: "running" | "succeeded" | "failed" | "paused";
  timestamp: string;
  error?: string;
}

export interface SupervisorRecoveryLog {
  id: string;
  timestamp: string;
  subagentId: string;
  subagentName: string;
  failureType: "crash" | "timeout" | "stall" | "out_of_budget";
  strategy: SupervisorStrategy;
  affectedSubagents: string[];
  recovered: boolean;
  message: string;
}

export interface AgentSwarmPlaygroundProps {
  subagents?: SubagentInfo[];
  activeSubagentId?: string | null;
  onDispatchTurn?: (
    subagentId: string,
    prompt: string
  ) => Promise<{ success: boolean; turnId?: string; response?: string; tokensUsed?: number; latencyMs?: number } | null>;
  onSimulateTurn?: (
    subagentId: string,
    scenario: string
  ) => Promise<{ success: boolean; turnId?: string; scenario?: string; output?: string; tokensUsed?: number; latencyMs?: number } | null>;
  onInjectFailure?: (
    subagentId: string,
    failureType: "timeout" | "crash" | "stall" | "out_of_budget",
    strategy?: SupervisorStrategy
  ) => Promise<{ success: boolean; affectedSubagents?: string[]; recovered?: boolean; message?: string } | null>;
  className?: string;
}

export const PRESET_SCENARIOS = [
  {
    id: "exploration",
    title: "Codebase Exploration",
    description: "Deconstruct repo dependencies and map component hierarchy",
    prompt: "Survey the codebase layout, inspect package manifests, and map hierarchical subagent interfaces across protocol, agent host, and visual control plane.",
    mockTools: [{ name: "read_dir", args: { path: "src/" }, output: "Found 12 subdirectories and 24 files" }],
    mockResponse: "Exploration completed: Mapped 3 architectural layers (packages/protocol, apps/agent-host, src/). Identified all subagent control plane surfaces.",
  },
  {
    id: "test_generation",
    title: "Test Suite Generation",
    description: "Synthesize adversarial unit and edge case tests",
    prompt: "Generate comprehensive unit test suites covering shared memory namespace isolation, TTL sweeping, and telemetry rate computation.",
    mockTools: [{ name: "write_to_file", args: { target: "test.ts" }, output: "Generated 14 test cases" }],
    mockResponse: "Test generation complete: Synthesized 14 unit test assertions with 100% boundary and adversarial edge case coverage.",
  },
  {
    id: "regression_repair",
    title: "Regression Repair",
    description: "Trace stack trace and produce minimal surgical patch",
    prompt: "Analyze the failing regression in tree recursive inspection parameter, locate the root cause, and apply a minimal non-breaking patch.",
    mockTools: [{ name: "replace_file_content", args: { line: 42 }, output: "Patch applied cleanly" }],
    mockResponse: "Regression resolved: Adjusted recursive parameter optionality in schema validator. All 34 test suites passing cleanly.",
  },
  {
    id: "security_audit",
    title: "Security Audit",
    description: "Scan for path confinement & permission leakage",
    prompt: "Audit subagent workspace isolation, verify git worktree sandboxing, and check that no agent exceeds max supervisor depth of 3.",
    mockTools: [{ name: "view_file", args: { path: "security.ts" }, output: "Verified confinement constraints" }],
    mockResponse: "Security audit passed: SEC-SUB-05 max depth enforced; workspace path confinement verified with 0 permission leaks.",
  },
  {
    id: "dag_planning",
    title: "DAG Dependency Planning",
    description: "Plan multi-tier task execution tree",
    prompt: "Deconstruct the Phase 6 feature milestone into an optimal Directed Acyclic Graph (DAG) with parallel worker assignments.",
    mockTools: [{ name: "plan_tasks", args: { count: 6 }, output: "Scheduled 6 milestones" }],
    mockResponse: "DAG Plan generated: 6 milestones ordered by dependency topology. M1-M3 parallelizable across 3 worker agents.",
  },
];

export function AgentSwarmPlayground({
  subagents = [],
  activeSubagentId = null,
  onDispatchTurn,
  onSimulateTurn,
  onInjectFailure,
  className = "",
}: AgentSwarmPlaygroundProps) {
  // Target subagent selection
  const [selectedAgentId, setSelectedAgentId] = useState<string>(() => {
    if (activeSubagentId) return activeSubagentId;
    if (subagents.length > 0) return subagents[0].id;
    return "root-supervisor";
  });

  // Mode: live vs simulated
  const [executionMode, setExecutionMode] = useState<"live" | "simulated">("simulated");

  // Prompt input
  const [promptText, setPromptText] = useState(PRESET_SCENARIOS[0].prompt);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(PRESET_SCENARIOS[0].id);

  // Stepper & Execution state
  const [isExecuting, setIsExecuting] = useState(false);
  const [turnCounter, setTurnCounter] = useState(1);

  // Failure Injection state
  const [failureType, setFailureType] = useState<"crash" | "timeout" | "stall" | "out_of_budget">("crash");
  const [supervisorStrategy, setSupervisorStrategy] = useState<SupervisorStrategy>("one_for_one");
  const [isInjectingFailure, setIsInjectingFailure] = useState(false);

  // Logs state
  const [turnLogs, setTurnLogs] = useState<PlaygroundTurnLog[]>([]);
  const [recoveryLogs, setRecoveryLogs] = useState<SupervisorRecoveryLog[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [copiedLogFeedback, setCopiedLogFeedback] = useState(false);

  // Target agent info
  const targetAgent = useMemo(() => {
    return subagents.find((a) => a.id === selectedAgentId) ?? null;
  }, [subagents, selectedAgentId]);

  // Handle Scenario selection
  const handleSelectScenario = (scenarioId: string) => {
    const sc = PRESET_SCENARIOS.find((s) => s.id === scenarioId);
    if (sc) {
      setSelectedScenarioId(scenarioId);
      setPromptText(sc.prompt);
    }
  };

  // Dispatch turn (Live or Simulated)
  const handleDispatchTurn = async () => {
    if (!promptText.trim()) return;

    const currentTurn = turnCounter;
    setTurnCounter((prev) => prev + 1);
    setIsExecuting(true);

    const logEntryId = `turn-${Date.now()}-${currentTurn}`;
    const agentName = targetAgent ? targetAgent.name : "Supervisor Lead";
    const startTime = Date.now();

    // Initial running log entry
    const initialLog: PlaygroundTurnLog = {
      id: logEntryId,
      turnNumber: currentTurn,
      subagentId: selectedAgentId,
      subagentName: agentName,
      mode: executionMode,
      scenario: selectedScenarioId,
      prompt: promptText,
      response: "Executing reasoning cycle...",
      toolsUsed: [],
      promptTokens: Math.floor(promptText.length / 4) + 120,
      completionTokens: 0,
      totalTokens: Math.floor(promptText.length / 4) + 120,
      latencyMs: 0,
      status: "running",
      timestamp: new Date().toISOString(),
    };

    setTurnLogs((prev) => [initialLog, ...prev]);
    setSelectedLogId(logEntryId);

    try {
      if (executionMode === "live" && onDispatchTurn) {
        const result = await onDispatchTurn(selectedAgentId, promptText);
        const latency = Date.now() - startTime;
        const respText = result?.response ?? "Live turn dispatched successfully via WebSocket.";
        const tokensDelta = result?.tokensUsed ?? 240;

        setTurnLogs((prev) =>
          prev.map((log) =>
            log.id === logEntryId
              ? {
                  ...log,
                  status: "succeeded",
                  response: respText,
                  latencyMs: latency,
                  completionTokens: tokensDelta,
                  totalTokens: log.promptTokens + tokensDelta,
                }
              : log
          )
        );
      } else if (executionMode === "simulated" && onSimulateTurn) {
        const result = await onSimulateTurn(selectedAgentId, selectedScenarioId);
        const latency = Date.now() - startTime;
        const currentScenario = PRESET_SCENARIOS.find((s) => s.id === selectedScenarioId);
        const respText = result?.output ?? currentScenario?.mockResponse ?? "Simulated turn completed.";

        setTurnLogs((prev) =>
          prev.map((log) =>
            log.id === logEntryId
              ? {
                  ...log,
                  status: "succeeded",
                  response: respText,
                  latencyMs: latency,
                  toolsUsed: currentScenario?.mockTools ?? [],
                  completionTokens: 180,
                  totalTokens: log.promptTokens + 180,
                }
              : log
          )
        );
      } else {
        // Local simulation fallback
        await new Promise((resolve) => setTimeout(resolve, 350));
        const latency = Date.now() - startTime;
        const currentScenario = PRESET_SCENARIOS.find((s) => s.id === selectedScenarioId);
        const respText = currentScenario?.mockResponse ?? "Reasoning cycle finished. Subagent returned successfully.";

        setTurnLogs((prev) =>
          prev.map((log) =>
            log.id === logEntryId
              ? {
                  ...log,
                  status: "succeeded",
                  response: respText,
                  latencyMs: latency,
                  toolsUsed: currentScenario?.mockTools ?? [],
                  completionTokens: 210,
                  totalTokens: log.promptTokens + 210,
                }
              : log
          )
        );
      }
    } catch (err) {
      const latency = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      setTurnLogs((prev) =>
        prev.map((log) =>
          log.id === logEntryId
            ? {
                ...log,
                status: "failed",
                response: "Execution failed with runtime error.",
                error: errorMsg,
                latencyMs: latency,
              }
            : log
        )
      );
    } finally {
      setIsExecuting(false);
    }
  };

  // Step-by-step turn execution
  const handleStepTurn = async () => {
    await handleDispatchTurn();
  };

  // Failure Injection
  const handleInjectFailure = async () => {
    setIsInjectingFailure(true);
    const agentName = targetAgent ? targetAgent.name : "Target Subagent";
    const startTime = Date.now();

    try {
      let recoveryResult: { success: boolean; affectedSubagents?: string[]; recovered?: boolean; message?: string } | null = null;

      if (onInjectFailure) {
        recoveryResult = await onInjectFailure(selectedAgentId, failureType, supervisorStrategy);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 400));
        recoveryResult = {
          success: true,
          affectedSubagents: [selectedAgentId],
          recovered: true,
          message: `Supervisor detected ${failureType} in ${agentName}. Executed ${supervisorStrategy} recovery strategy. Subagent restarted cleanly.`,
        };
      }

      const recoveryEntry: SupervisorRecoveryLog = {
        id: `rec-${Date.now()}`,
        timestamp: new Date().toISOString(),
        subagentId: selectedAgentId,
        subagentName: agentName,
        failureType,
        strategy: supervisorStrategy,
        affectedSubagents: recoveryResult?.affectedSubagents ?? [selectedAgentId],
        recovered: recoveryResult?.recovered ?? true,
        message:
          recoveryResult?.message ??
          `Supervisor detected ${failureType}. Executed strategy '${supervisorStrategy}'. Child state restored in ${Date.now() - startTime}ms.`,
      };

      setRecoveryLogs((prev) => [recoveryEntry, ...prev]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const recoveryEntry: SupervisorRecoveryLog = {
        id: `rec-${Date.now()}`,
        timestamp: new Date().toISOString(),
        subagentId: selectedAgentId,
        subagentName: agentName,
        failureType,
        strategy: supervisorStrategy,
        affectedSubagents: [selectedAgentId],
        recovered: false,
        message: `Recovery failed: ${errorMsg}`,
      };
      setRecoveryLogs((prev) => [recoveryEntry, ...prev]);
    } finally {
      setIsInjectingFailure(false);
    }
  };

  // Active selected log entry
  const selectedLog = useMemo(() => {
    if (!selectedLogId) {
      return turnLogs.length > 0 ? turnLogs[0] : null;
    }
    return turnLogs.find((l) => l.id === selectedLogId) ?? (turnLogs.length > 0 ? turnLogs[0] : null);
  }, [turnLogs, selectedLogId]);

  const handleCopyLog = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedLogFeedback(true);
    setTimeout(() => setCopiedLogFeedback(false), 2000);
  };

  return (
    <div
      className={`flex flex-col h-full bg-card font-mono text-xs select-none ${className}`}
      data-testid="agent-swarm-playground"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/80">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded bg-primary/10 text-primary">
            <Flame className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground">Interactive Swarm Playground</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-primary border-primary/30">
                E2E Runner
              </Badge>
            </div>
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              Step-by-step turns, benchmark scenarios &amp; supervisor resilience
            </span>
          </div>
        </div>

        {/* Live vs Simulated Mode Toggle */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-secondary/80 p-0.5 rounded-lg border border-border/80">
            <button
              type="button"
              onClick={() => setExecutionMode("simulated")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                executionMode === "simulated"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="mode-simulated-btn"
            >
              Simulated
            </button>
            <button
              type="button"
              onClick={() => setExecutionMode("live")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                executionMode === "live"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="mode-live-btn"
            >
              Live Host
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs font-mono"
            onClick={() => {
              setTurnLogs([]);
              setRecoveryLogs([]);
              setSelectedLogId(null);
            }}
            title="Clear playground logs"
            data-testid="clear-logs-btn"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      {/* Main Split Content */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        {/* Left Side: Dispatch Console & Failure Injection */}
        <div className="w-full md:w-5/12 border-r border-border flex flex-col overflow-y-auto p-3 space-y-3 scrollbar-thin">
          {/* Target Subagent Selection */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Bot className="h-3 w-3" />
                Target Subagent
              </span>
              <span className="text-[10px] text-muted-foreground">
                {subagents.length} active in tree
              </span>
            </label>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="w-full h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="target-agent-select"
            >
              <option value="root-supervisor">Root Supervisor (Lead)</option>
              {subagents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.archetype} &bull; {agent.state})
                </option>
              ))}
            </select>
          </div>

          {/* Preset Benchmark Scenarios */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-amber-400" />
              Benchmark Scenarios
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {PRESET_SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => handleSelectScenario(sc.id)}
                  className={`flex flex-col text-left p-1.5 rounded border transition-all ${
                    selectedScenarioId === sc.id
                      ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                      : "border-border/60 bg-secondary/30 hover:bg-secondary/60"
                  }`}
                  data-testid={`scenario-btn-${sc.id}`}
                >
                  <span className="font-semibold text-foreground text-[11px]">{sc.title}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{sc.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Dispatch Console */}
          <div className="space-y-1 flex-1 flex flex-col min-h-[140px]">
            <label className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Terminal className="h-3 w-3" />
                Prompt Dispatch Console
              </span>
              <span className="text-[10px] text-primary">
                {executionMode === "live" ? "Live WS RPC" : "Simulated Cycle"}
              </span>
            </label>
            <Textarea
              placeholder="Enter operator prompt to dispatch to the subagent..."
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={4}
              className="flex-1 font-mono text-xs bg-background resize-none"
              data-testid="playground-prompt-input"
            />
          </div>

          {/* Execution Controls */}
          <div className="flex items-center gap-2 pt-1 border-t border-border/60">
            <Button
              size="sm"
              onClick={handleDispatchTurn}
              disabled={isExecuting || !promptText.trim()}
              className="flex-1 h-8 font-mono text-xs"
              data-testid="dispatch-turn-btn"
            >
              {isExecuting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Executing Turn...
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Dispatch Turn
                </>
              )}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleStepTurn}
              disabled={isExecuting || !promptText.trim()}
              className="h-8 px-2.5 font-mono text-xs"
              title="Execute a single step turn"
              data-testid="step-turn-btn"
            >
              <Zap className="h-3.5 w-3.5 mr-1" />
              Step Turn
            </Button>
          </div>

          {/* Supervisor Failure Injection Section */}
          <div className="p-2.5 rounded-lg border border-red-500/30 bg-red-500/5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[11px] text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Supervisor Failure Injection
              </span>
              <Badge variant="outline" className="text-[9px] text-red-400 border-red-500/30">
                OTP Resilience
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Failure Type</label>
                <select
                  value={failureType}
                  onChange={(e) => setFailureType(e.target.value as any)}
                  className="w-full h-7 rounded border border-input bg-background px-1.5 text-[10px] text-foreground focus:outline-none"
                  data-testid="failure-type-select"
                >
                  <option value="crash">Process Crash (SIGSEGV)</option>
                  <option value="timeout">Execution Timeout (&gt;30s)</option>
                  <option value="stall">Heartbeat Stalled (&gt;180s)</option>
                  <option value="out_of_budget">Budget Exceeded</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Supervisor Strategy</label>
                <select
                  value={supervisorStrategy}
                  onChange={(e) => setSupervisorStrategy(e.target.value as any)}
                  className="w-full h-7 rounded border border-input bg-background px-1.5 text-[10px] text-foreground focus:outline-none"
                  data-testid="supervisor-strategy-select"
                >
                  <option value="one_for_one">One for One</option>
                  <option value="one_for_all">One for All</option>
                  <option value="rest_for_one">Rest for One</option>
                </select>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleInjectFailure}
              disabled={isInjectingFailure}
              className="w-full h-7 text-[11px] font-mono text-red-400 hover:bg-red-500/10 hover:text-red-300 border-red-500/30"
              data-testid="inject-failure-btn"
            >
              {isInjectingFailure ? (
                <>
                  <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />
                  Injecting &amp; Supervising...
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3 w-3 mr-1.5" />
                  Inject Failure &amp; Observe Recovery
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Right Side: Turn Logs & Inspector */}
        <div className="flex-1 flex flex-col bg-background/30 overflow-hidden">
          {/* Recovery Log Banners if any */}
          {recoveryLogs.length > 0 && (
            <div className="p-2 border-b border-red-500/20 bg-red-500/5 max-h-28 overflow-y-auto space-y-1 scrollbar-thin">
              {recoveryLogs.map((rec) => (
                <div
                  key={rec.id}
                  className="flex items-center justify-between text-[10px] p-1 rounded bg-background/80 border border-red-500/20"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ShieldAlert className="h-3 w-3 text-red-400 shrink-0" />
                    <span className="font-semibold text-red-400">{rec.failureType.toUpperCase()}</span>
                    <span className="text-muted-foreground truncate">{rec.message}</span>
                  </div>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 text-emerald-400 border-emerald-500/30">
                    {rec.strategy}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {/* Turn Logs Timeline */}
          <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
            {/* Timeline Column */}
            <div className="w-full md:w-5/12 border-r border-border overflow-y-auto p-2 space-y-1.5 scrollbar-thin">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 pb-1">
                Turn Execution Timeline ({turnLogs.length})
              </div>

              {turnLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center text-muted-foreground p-4">
                  <Activity className="h-7 w-7 mb-2 opacity-40" />
                  <p className="font-semibold">No Turns Executed Yet</p>
                  <p className="text-[11px] text-muted-foreground/80 mt-1">
                    Select a preset scenario and click "Dispatch Turn" to start execution.
                  </p>
                </div>
              ) : (
                turnLogs.map((log) => {
                  const isSelected = selectedLog?.id === log.id;
                  return (
                    <div
                      key={log.id}
                      onClick={() => setSelectedLogId(log.id)}
                      className={`flex flex-col p-2 rounded-lg border transition-all cursor-pointer ${
                        isSelected
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                          : "border-border/60 bg-card/60 hover:bg-secondary/40"
                      }`}
                      data-testid={`turn-log-row-${log.turnNumber}`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold text-foreground">Turn #{log.turnNumber}</span>
                          <Badge
                            variant="secondary"
                            className="text-[9px] px-1 py-0 bg-secondary text-muted-foreground"
                          >
                            {log.subagentName}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-1">
                          {log.status === "running" ? (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-400 border-amber-500/30">
                              Running
                            </Badge>
                          ) : log.status === "succeeded" ? (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 text-emerald-400 border-emerald-500/30">
                              Success
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 text-red-400 border-red-500/30">
                              Failed
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="mt-1 text-[10px] text-muted-foreground truncate">
                        {log.prompt}
                      </div>

                      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/40 pt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {log.latencyMs}ms
                        </span>
                        <span className="flex items-center gap-1">
                          <Coins className="h-2.5 w-2.5" />
                          +{log.totalTokens} tok
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Selected Turn Detail Inspector */}
            <div className="flex-1 flex flex-col overflow-y-auto p-3 scrollbar-thin">
              {selectedLog ? (
                <div className="space-y-3" data-testid="turn-detail-inspector">
                  {/* Detail Header */}
                  <div className="flex items-center justify-between border-b border-border/80 pb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-foreground">Turn #{selectedLog.turnNumber} Details</h4>
                        <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                          {selectedLog.mode}
                        </Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        Executed by {selectedLog.subagentName} at {new Date(selectedLog.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 font-mono text-xs"
                      onClick={() => handleCopyLog(selectedLog.response)}
                      data-testid="copy-log-btn"
                    >
                      {copiedLogFeedback ? (
                        <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 mr-1" />
                      )}
                      {copiedLogFeedback ? "Copied" : "Copy Output"}
                    </Button>
                  </div>

                  {/* Telemetry Metrics */}
                  <div className="grid grid-cols-3 gap-2 p-2 rounded bg-card/60 border border-border/60 text-center">
                    <div>
                      <span className="text-[10px] text-muted-foreground">Latency</span>
                      <p className="font-bold text-foreground">{selectedLog.latencyMs} ms</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground">Tokens (Prompt / Compl)</span>
                      <p className="font-bold text-foreground">
                        {selectedLog.promptTokens} / {selectedLog.completionTokens}
                      </p>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground">Status</span>
                      <p className="font-bold text-emerald-400 capitalize">{selectedLog.status}</p>
                    </div>
                  </div>

                  {/* Prompt Text */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase">Dispatched Prompt</span>
                    <div className="p-2 rounded bg-secondary/30 border border-border/60 text-[11px] text-foreground select-text whitespace-pre-wrap">
                      {selectedLog.prompt}
                    </div>
                  </div>

                  {/* Tool Invocations if any */}
                  {selectedLog.toolsUsed && selectedLog.toolsUsed.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase">Tool Invocations</span>
                      <div className="space-y-1">
                        {selectedLog.toolsUsed.map((tool, idx) => (
                          <div key={idx} className="p-2 rounded bg-secondary/40 border border-border/80 text-[11px]">
                            <div className="flex items-center justify-between font-bold text-primary">
                              <span>Tool: {tool.name}</span>
                            </div>
                            {tool.output && (
                              <div className="mt-1 text-muted-foreground text-[10px] bg-background/60 p-1.5 rounded">
                                {tool.output}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Response / Output */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase">Response Output</span>
                    <div className="p-2.5 rounded bg-background border border-border text-[11px] text-foreground select-text whitespace-pre-wrap leading-relaxed">
                      {selectedLog.response}
                    </div>
                  </div>

                  {/* Error if present */}
                  {selectedLog.error && (
                    <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-[11px] flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>{selectedLog.error}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-6">
                  <Terminal className="h-8 w-8 mb-2 opacity-40" />
                  <p className="font-semibold">No Turn Selected</p>
                  <p className="text-[11px] text-muted-foreground/80 mt-1">
                    Select an executed turn from the timeline on the left to inspect its parameters, tool runs, and response.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
