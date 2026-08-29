import { useState, useRef, useEffect } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Edit3,
  FileText,
  Globe,
  Plug,
  Search,
  StopCircle,
  Terminal,
  XCircle,
  Activity,
} from "lucide-react";
import type { ToolRun, ToolRunState } from "@/types";
import type { SubagentInfo } from "@protocol/subagents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface AgentToolInspectorProps {
  toolRuns: ToolRun[];
  activeSubagent?: SubagentInfo | null;
  onStopTool?: (toolId: string) => void;
  className?: string;
}

const MAX_OUTPUT_BUFFER_BYTES = 2 * 1024 * 1024; // 2MB

export function getToolIcon(executableOrKind: string) {
  const normalized = executableOrKind.toLowerCase();
  if (normalized.includes("terminal") || normalized.includes("run_command") || normalized.includes("sh") || normalized.includes("bash") || normalized.includes("npm")) {
    return <Terminal className="h-4 w-4 text-blue-400" />;
  }
  if (normalized.includes("read") || normalized.includes("cat") || normalized.includes("view")) {
    return <FileText className="h-4 w-4 text-emerald-400" />;
  }
  if (normalized.includes("edit") || normalized.includes("write") || normalized.includes("patch")) {
    return <Edit3 className="h-4 w-4 text-amber-400" />;
  }
  if (normalized.includes("search") || normalized.includes("grep") || normalized.includes("find")) {
    return <Search className="h-4 w-4 text-purple-400" />;
  }
  if (normalized.includes("browser") || normalized.includes("http") || normalized.includes("fetch")) {
    return <Globe className="h-4 w-4 text-cyan-400" />;
  }
  if (normalized.includes("mcp")) {
    return <Plug className="h-4 w-4 text-pink-400" />;
  }
  return <Terminal className="h-4 w-4 text-muted-foreground" />;
}

export function getToolStateBadge(state: ToolRunState) {
  switch (state) {
    case "running":
      return (
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] flex items-center gap-1 font-mono">
          <Activity className="h-3 w-3 animate-pulse text-emerald-400" />
          Running
        </Badge>
      );
    case "done":
      return (
        <Badge variant="outline" className="bg-teal-500/10 text-teal-400 border-teal-500/30 text-[10px] flex items-center gap-1 font-mono">
          <CheckCircle2 className="h-3 w-3 text-teal-400" />
          Done
        </Badge>
      );
    case "error":
      return (
        <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px] flex items-center gap-1 font-mono">
          <XCircle className="h-3 w-3 text-red-400" />
          Error
        </Badge>
      );
    case "approval_required":
      return (
        <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px] flex items-center gap-1 font-mono">
          <AlertCircle className="h-3 w-3 text-amber-400" />
          Approval Required
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="secondary" className="text-[10px] font-mono">
          Cancelled
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-[10px] font-mono">
          {state}
        </Badge>
      );
  }
}

export function AgentToolInspector({
  toolRuns,
  activeSubagent,
  onStopTool,
  className = "",
}: AgentToolInspectorProps) {
  const [expandedParams, setExpandedParams] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const outputConsoleRef = useRef<HTMLDivElement | null>(null);

  const toggleParams = (id: string) => {
    setExpandedParams((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopyParams = (id: string, params: unknown) => {
    try {
      navigator.clipboard.writeText(JSON.stringify(params, null, 2));
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  // Scroll to bottom when output arrives if auto-scroll is enabled
  useEffect(() => {
    if (autoScroll && outputConsoleRef.current) {
      outputConsoleRef.current.scrollTop = outputConsoleRef.current.scrollHeight;
    }
  }, [toolRuns, autoScroll]);

  return (
    <div className={`flex flex-col h-full ${className}`} data-testid="agent-tool-inspector">
      {/* Context banner */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-card/60">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="h-4 w-4 text-primary shrink-0" />
          {activeSubagent ? (
            <div className="flex items-center gap-2 truncate">
              <span className="font-mono text-xs font-semibold text-foreground truncate">
                {activeSubagent.name}
              </span>
              <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                {activeSubagent.archetype}
              </Badge>
              <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0 text-muted-foreground">
                {activeSubagent.state}
              </Badge>
            </div>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              Swarm Tool Execution Feed ({toolRuns.length} runs)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-mono text-muted-foreground select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-border bg-background text-primary focus:ring-1 focus:ring-primary h-3.5 w-3.5"
            />
            <span>Follow output</span>
          </label>
        </div>
      </div>

      {/* Tool runs feed */}
      <div ref={outputConsoleRef} className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">
        {toolRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground p-6">
            <Terminal className="h-8 w-8 mb-2 opacity-40" />
            <p className="font-mono text-xs font-semibold">No Tool Executions Recorded</p>
            <p className="font-mono text-[11px] text-muted-foreground/80 mt-1 max-w-sm">
              Tools invoked by active subagents or daemon tasks will stream parameters, real-time outputs, and status here.
            </p>
          </div>
        ) : (
          toolRuns.map((tool) => {
            const isParamsOpen = !!expandedParams[tool.id];
            const outputText = tool.output ?? "";
            const isTruncated = tool.truncated || outputText.length > MAX_OUTPUT_BUFFER_BYTES;
            const displayOutput = outputText.length > MAX_OUTPUT_BUFFER_BYTES
              ? outputText.slice(-MAX_OUTPUT_BUFFER_BYTES)
              : outputText;

            return (
              <div
                key={tool.id}
                className="rounded-lg border border-border bg-card overflow-hidden transition-all shadow-xs"
                data-testid={`tool-run-card-${tool.id}`}
              >
                {/* Header */}
                <div className="flex items-center justify-between gap-2 p-2.5 bg-secondary/30 border-b border-border/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1 rounded bg-secondary/60 shrink-0">
                      {getToolIcon(tool.executable)}
                    </div>
                    <span className="font-mono text-xs font-semibold text-foreground truncate" title={tool.executable}>
                      {tool.executable}
                    </span>
                    {tool.args.length > 0 && (
                      <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[200px]" title={tool.args.join(" ")}>
                        {tool.args.join(" ")}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {getToolStateBadge(tool.state)}

                    {tool.exitCode !== undefined && (
                      <Badge variant="outline" className={`font-mono text-[10px] ${tool.exitCode === 0 ? "text-emerald-400" : "text-red-400"}`}>
                        exit {tool.exitCode}
                      </Badge>
                    )}

                    {tool.state === "running" && onStopTool && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px] font-mono text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        onClick={() => onStopTool(tool.id)}
                        title="Stop running tool execution"
                      >
                        <StopCircle className="h-3 w-3 mr-1" />
                        Stop Tool
                      </Button>
                    )}
                  </div>
                </div>

                {/* Meta details & Parameters toggle */}
                <div className="p-2.5 space-y-2 text-xs font-mono">
                  {tool.cwd && (
                    <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
                      <span className="text-muted-foreground/60">cwd:</span>
                      <span className="truncate">{tool.cwd}</span>
                    </div>
                  )}

                  {tool.policyReason && (
                    <div className="text-[11px] text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded p-1.5">
                      <strong>Policy:</strong> {tool.policyReason}
                    </div>
                  )}

                  {/* Collapsible Parameter Inspector */}
                  <div className="border border-border/60 rounded bg-background/60">
                    <div
                      onClick={() => toggleParams(tool.id)}
                      className="w-full flex items-center justify-between p-1.5 text-muted-foreground hover:text-foreground text-[11px] cursor-pointer select-none"
                    >
                      <span className="flex items-center gap-1 font-semibold">
                        {isParamsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        Parameters ({tool.args.length} args)
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1 text-[10px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyParams(tool.id, { executable: tool.executable, args: tool.args, cwd: tool.cwd });
                        }}
                      >
                        {copiedId === tool.id ? (
                          <Check className="h-3 w-3 text-emerald-400 mr-1" />
                        ) : (
                          <Copy className="h-3 w-3 mr-1" />
                        )}
                        {copiedId === tool.id ? "Copied" : "Copy JSON"}
                      </Button>
                    </div>

                    {isParamsOpen && (
                      <div className="p-2 border-t border-border/40 max-h-40 overflow-y-auto scrollbar-thin">
                        <pre className="text-[11px] font-mono text-muted-foreground/90 whitespace-pre-wrap">
                          {JSON.stringify({ executable: tool.executable, args: tool.args, cwd: tool.cwd }, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>

                  {/* Output Console */}
                  {outputText && (
                    <div className="relative rounded border border-border/80 bg-zinc-950 p-2.5 text-[11px] font-mono text-zinc-100 max-h-56 overflow-y-auto scrollbar-thin">
                      <pre className="whitespace-pre-wrap break-all leading-relaxed font-mono">
                        {displayOutput}
                      </pre>

                      {isTruncated && (
                        <div className="mt-2 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5 inline-block">
                          [Output capped at 2MB]
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
