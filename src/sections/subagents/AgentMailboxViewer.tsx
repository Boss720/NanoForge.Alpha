import { useState, useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileCode,
  Lightbulb,
  Mail,
  Paperclip,
  Search,
  Send,
  TestTube,
} from "lucide-react";
import type { SubagentMessage, SubagentInfo, MessagePriority } from "@protocol/subagents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface AgentMailboxViewerProps {
  messages: SubagentMessage[];
  subagents: SubagentInfo[];
  activeSubagentId?: string | null;
  onSendMessage: (
    recipientId: string,
    body: string,
    options?: { subject?: string; referencedArtifacts?: string[]; priority?: MessagePriority }
  ) => Promise<unknown>;
  onSelectArtifact?: (path: string) => void;
  className?: string;
}

export interface ParsedHandoffReport {
  isHandoff: boolean;
  observation?: string;
  logicChain?: string;
  caveats?: string;
  conclusion?: string;
  verificationMethod?: string;
  rawRemainder?: string;
}

/**
 * Parses markdown text to extract standard 5-component handoff sections if present.
 */
export function parseHandoffReport(body: string): ParsedHandoffReport {
  if (!body) return { isHandoff: false };

  const observationMatch = body.match(/(?:##|\*\*)\s*(?:1\.?\s*)?Observation[s]?:?\s*(?:\*\*)?([\s\S]*?)(?=(?:##|\*\*)\s*(?:2\.?\s*)?Logic Chain|$)/i);
  const logicMatch = body.match(/(?:##|\*\*)\s*(?:2\.?\s*)?Logic Chain:?\s*(?:\*\*)?([\s\S]*?)(?=(?:##|\*\*)\s*(?:3\.?\s*)?Caveats?|$)/i);
  const caveatsMatch = body.match(/(?:##|\*\*)\s*(?:3\.?\s*)?Caveats?:?\s*(?:\*\*)?([\s\S]*?)(?=(?:##|\*\*)\s*(?:4\.?\s*)?Conclusion|$)/i);
  const conclusionMatch = body.match(/(?:##|\*\*)\s*(?:4\.?\s*)?Conclusion:?\s*(?:\*\*)?([\s\S]*?)(?=(?:##|\*\*)\s*(?:5\.?\s*)?Verification Method|$)/i);
  const verificationMatch = body.match(/(?:##|\*\*)\s*(?:5\.?\s*)?Verification Method:?\s*(?:\*\*)?([\s\S]*?)$/i);

  const isHandoff = !!(observationMatch || logicMatch || conclusionMatch || verificationMatch);

  return {
    isHandoff,
    observation: observationMatch ? observationMatch[1].trim() : undefined,
    logicChain: logicMatch ? logicMatch[1].trim() : undefined,
    caveats: caveatsMatch ? caveatsMatch[1].trim() : undefined,
    conclusion: conclusionMatch ? conclusionMatch[1].trim() : undefined,
    verificationMethod: verificationMatch ? verificationMatch[1].trim() : undefined,
  };
}

export function formatRelativeTime(isoString: string): string {
  try {
    const timestamp = new Date(isoString).getTime();
    const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diff < 10) return "just now";
    if (diff < 60) return `${diff}s ago`;
    const min = Math.floor(diff / 60);
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return new Date(isoString).toLocaleDateString();
  } catch {
    return isoString;
  }
}

export function AgentMailboxViewer({
  messages,
  subagents,
  activeSubagentId,
  onSendMessage,
  onSelectArtifact,
  className = "",
}: AgentMailboxViewerProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string>(activeSubagentId ?? "all");
  const [expandedHandoffs, setExpandedHandoffs] = useState<Record<string, Record<string, boolean>>>({});

  // Quick reply composer state
  const [replyRecipient, setReplyRecipient] = useState<string>(activeSubagentId ?? "");
  const [replySubject, setReplySubject] = useState<string>("Direct Message");
  const [replyBody, setReplyBody] = useState<string>("");
  const [replyPriority, setReplyPriority] = useState<MessagePriority>("normal");
  const [isSending, setIsSending] = useState(false);

  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of subagents) {
      map.set(a.id, a.name);
    }
    map.set("00000000-0000-0000-0000-000000000000", "Operator / UI");
    map.set("root", "Root Orchestrator");
    return map;
  }, [subagents]);

  const filteredMessages = useMemo(() => {
    return messages.filter((m) => {
      if (selectedAgentFilter !== "all") {
        if (m.senderId !== selectedAgentFilter && m.recipientId !== selectedAgentFilter) {
          return false;
        }
      }
      if (filterQuery.trim()) {
        const q = filterQuery.toLowerCase();
        const matchesSubject = m.subject.toLowerCase().includes(q);
        const matchesBody = m.body.toLowerCase().includes(q);
        const matchesSender = (m.senderName ?? agentNameMap.get(m.senderId) ?? "").toLowerCase().includes(q);
        const matchesRecipient = (agentNameMap.get(m.recipientId) ?? "").toLowerCase().includes(q);
        if (!matchesSubject && !matchesBody && !matchesSender && !matchesRecipient) return false;
      }
      return true;
    });
  }, [messages, selectedAgentFilter, filterQuery, agentNameMap]);

  const toggleHandoffSection = (msgId: string, sectionKey: string) => {
    setExpandedHandoffs((prev) => ({
      ...prev,
      [msgId]: {
        ...prev[msgId],
        [sectionKey]: !prev[msgId]?.[sectionKey],
      },
    }));
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyRecipient || !replyBody.trim()) return;

    setIsSending(true);
    try {
      await onSendMessage(replyRecipient, replyBody.trim(), {
        subject: replySubject.trim() || "Direct Message",
        priority: replyPriority,
      });
      setReplyBody("");
    } catch {
      // ignore
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className={`flex flex-col h-full ${className}`} data-testid="agent-mailbox-viewer">
      {/* Search & Filter Bar */}
      <div className="flex items-center gap-2 p-2 border-b border-border bg-card/50">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search messages, handoffs, subjects..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="pl-8 h-8 font-mono text-xs bg-background"
          />
        </div>

        <select
          value={selectedAgentFilter}
          onChange={(e) => setSelectedAgentFilter(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label="Filter by agent"
        >
          <option value="all">All Agents</option>
          {subagents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.archetype})
            </option>
          ))}
        </select>
      </div>

      {/* Messages Timeline */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-thin">
        {filteredMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground p-6">
            <Mail className="h-8 w-8 mb-2 opacity-40" />
            <p className="font-mono text-xs font-semibold">No Inter-Agent Messages</p>
            <p className="font-mono text-[11px] text-muted-foreground/80 mt-1 max-w-sm">
              Cross-agent communications, handoff reports, and operator instructions will appear in this timeline.
            </p>
          </div>
        ) : (
          filteredMessages.map((msg) => {
            const senderName = msg.senderName ?? agentNameMap.get(msg.senderId) ?? msg.senderId.slice(0, 8);
            const recipientName = agentNameMap.get(msg.recipientId) ?? msg.recipientId.slice(0, 8);
            const handoff = parseHandoffReport(msg.body);
            const expanded = expandedHandoffs[msg.messageId] ?? {
              observation: true,
              logic: true,
              caveats: false,
              conclusion: true,
              verification: true,
            };

            return (
              <div
                key={msg.messageId}
                className="rounded-lg border border-border bg-card p-3 shadow-xs space-y-2.5 transition-all"
                data-testid={`mailbox-message-card-${msg.messageId}`}
              >
                {/* Header flow line */}
                <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    {/* Sender Pill */}
                    <Badge variant="outline" className="font-mono text-[11px] bg-secondary/80 text-foreground">
                      {senderName}
                    </Badge>

                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />

                    {/* Recipient Pill */}
                    <Badge variant="outline" className="font-mono text-[11px] bg-primary/10 text-primary border-primary/30">
                      {recipientName}
                    </Badge>

                    {msg.priority === "high" && (
                      <Badge variant="destructive" className="font-mono text-[9px] px-1 py-0">
                        HIGH
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground shrink-0">
                    <Clock className="h-3 w-3" />
                    <span>{formatRelativeTime(msg.timestamp)}</span>
                  </div>
                </div>

                {/* Subject */}
                <div className="font-mono text-xs font-semibold text-foreground">
                  {msg.subject}
                </div>

                {/* Body or 5-Component Handoff Accordion */}
                {handoff.isHandoff ? (
                  <div className="space-y-1.5 font-mono text-xs">
                    {/* 1. Observation */}
                    {handoff.observation && (
                      <div className="border border-border/60 rounded bg-background/50 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleHandoffSection(msg.messageId, "observation")}
                          className="w-full flex items-center justify-between p-2 text-xs font-semibold text-blue-400 hover:bg-secondary/40 text-left"
                        >
                          <span className="flex items-center gap-1.5">
                            <Search className="h-3.5 w-3.5 text-blue-400" />
                            1. Observation
                          </span>
                          {expanded.observation ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        {expanded.observation && (
                          <div className="p-2.5 border-t border-border/40 text-muted-foreground whitespace-pre-wrap bg-zinc-950/40">
                            {handoff.observation}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 2. Logic Chain */}
                    {handoff.logicChain && (
                      <div className="border border-border/60 rounded bg-background/50 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleHandoffSection(msg.messageId, "logic")}
                          className="w-full flex items-center justify-between p-2 text-xs font-semibold text-purple-400 hover:bg-secondary/40 text-left"
                        >
                          <span className="flex items-center gap-1.5">
                            <Lightbulb className="h-3.5 w-3.5 text-purple-400" />
                            2. Logic Chain
                          </span>
                          {expanded.logic ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        {expanded.logic && (
                          <div className="p-2.5 border-t border-border/40 text-muted-foreground whitespace-pre-wrap bg-zinc-950/40">
                            {handoff.logicChain}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 3. Caveats */}
                    {handoff.caveats && (
                      <div className="border border-border/60 rounded bg-background/50 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleHandoffSection(msg.messageId, "caveats")}
                          className="w-full flex items-center justify-between p-2 text-xs font-semibold text-amber-400 hover:bg-secondary/40 text-left"
                        >
                          <span className="flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                            3. Caveats
                          </span>
                          {expanded.caveats ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        {expanded.caveats && (
                          <div className="p-2.5 border-t border-border/40 text-muted-foreground whitespace-pre-wrap bg-zinc-950/40">
                            {handoff.caveats}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 4. Conclusion */}
                    {handoff.conclusion && (
                      <div className="border border-border/60 rounded bg-background/50 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleHandoffSection(msg.messageId, "conclusion")}
                          className="w-full flex items-center justify-between p-2 text-xs font-semibold text-emerald-400 hover:bg-secondary/40 text-left"
                        >
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                            4. Conclusion
                          </span>
                          {expanded.conclusion ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        {expanded.conclusion && (
                          <div className="p-2.5 border-t border-border/40 text-muted-foreground whitespace-pre-wrap bg-zinc-950/40">
                            {handoff.conclusion}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 5. Verification Method */}
                    {handoff.verificationMethod && (
                      <div className="border border-border/60 rounded bg-background/50 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => toggleHandoffSection(msg.messageId, "verification")}
                          className="w-full flex items-center justify-between p-2 text-xs font-semibold text-teal-400 hover:bg-secondary/40 text-left"
                        >
                          <span className="flex items-center gap-1.5">
                            <TestTube className="h-3.5 w-3.5 text-teal-400" />
                            5. Verification Method
                          </span>
                          {expanded.verification ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        {expanded.verification && (
                          <div className="p-2.5 border-t border-border/40 text-muted-foreground whitespace-pre-wrap bg-zinc-950/40">
                            {handoff.verificationMethod}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="font-mono text-xs text-muted-foreground whitespace-pre-wrap bg-secondary/20 rounded p-2.5 border border-border/40">
                    {msg.body}
                  </div>
                )}

                {/* Referenced Artifacts Chips */}
                {msg.referencedArtifacts && msg.referencedArtifacts.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                      <Paperclip className="h-3 w-3" />
                      Artifacts:
                    </span>
                    {msg.referencedArtifacts.map((art) => (
                      <Badge
                        key={art}
                        variant="secondary"
                        className="cursor-pointer font-mono text-[10px] hover:bg-primary/20 hover:text-primary transition-colors flex items-center gap-1"
                        onClick={() => onSelectArtifact?.(art)}
                        title={`Open artifact: ${art}`}
                      >
                        <FileCode className="h-2.5 w-2.5" />
                        <span>{art}</span>
                        <ExternalLink className="h-2.5 w-2.5 ml-0.5 opacity-60" />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Quick Reply Composer */}
      <form onSubmit={handleSend} className="border-t border-border bg-card p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-mono text-foreground font-semibold">
            <Mail className="h-3.5 w-3.5 text-primary" />
            <span>Quick-Reply Composer</span>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={replyPriority}
              onChange={(e) => setReplyPriority(e.target.value as MessagePriority)}
              className="h-7 rounded border border-input bg-background px-2 font-mono text-[11px] text-foreground"
              aria-label="Priority"
            >
              <option value="normal">Normal Priority</option>
              <option value="high">High Priority</option>
              <option value="low">Low Priority</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={replyRecipient}
            onChange={(e) => setReplyRecipient(e.target.value)}
            className="h-7 rounded border border-input bg-background px-2 font-mono text-[11px] text-foreground"
            aria-label="Select recipient"
            required
          >
            <option value="" disabled>Select Recipient Agent...</option>
            {subagents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.archetype})
              </option>
            ))}
          </select>

          <Input
            placeholder="Subject line..."
            value={replySubject}
            onChange={(e) => setReplySubject(e.target.value)}
            className="h-7 font-mono text-[11px] bg-background"
          />
        </div>

        <div className="flex gap-2">
          <Textarea
            placeholder="Write message or directive to subagent..."
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            className="min-h-[60px] font-mono text-xs bg-background resize-none"
            rows={2}
          />

          <Button
            type="submit"
            disabled={isSending || !replyRecipient || !replyBody.trim()}
            className="self-end h-8 px-3 font-mono text-xs"
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {isSending ? "Sending..." : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}
