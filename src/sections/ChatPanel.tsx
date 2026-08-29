import { useEffect, useRef, useState } from "react";
import {
  Bot, Brain, Check, ChevronDown, ChevronRight, CircleDollarSign, FileEdit, FileSearch,
  FolderOpen, Play, SendHorizonal, ShieldAlert, ShieldCheck, Square, TerminalSquare, X,
} from "lucide-react";
import type { ChatSendInput, GenerationPrefs, Message, NanoModel, Patch, ToolCall, ToolRun, VirtualFile, WorkspaceAttachmentResolver } from "@/types";
import type { CommandResultFrame, SlashCommandWire } from "@protocol/commands";
import { AGENT_SYSTEM_PROMPT } from "@/lib/catalog";
import { estimateTokens } from "@/lib/context";
import { RichText } from "@/components/RichText";
import { ChatComposer } from "@/sections/ChatComposer";
import { formatErrorMessage, getToolRunStatusMeta } from "@/lib/statusFormatter";

export interface ChatPanelProps {
  messages: Message[];
  running: boolean;
  model: NanoModel | undefined;
  connected: boolean;
  onSend: (text: string | ChatSendInput) => void;
  onStop: () => void;
  onPatchDecision: (messageId: string, decision: "applied" | "rejected") => void;
  genPrefs: GenerationPrefs;
  onGenPrefsChange: (prefs: GenerationPrefs) => void;
  onOpenFolder?: () => void;
  /**
   * Module 2 Task 7 (optional): supervised terminal jobs reported by the
   * local agent host. Absent/empty when no host session exists — the panel
   * then renders exactly as before.
   */
  toolRuns?: ToolRun[];
  /** Stop (cancel) one terminal job; typically wired to HostClient.cancelRun. */
  onToolStop?: (toolRunId: string) => void;
  /** Planning mode trigger */
  onTriggerPlan?: (goal: string) => void;
  onExecuteCommand?: (wire: SlashCommandWire) => Promise<CommandResultFrame | void>;
  /** Workspace files for @file mentions */
  workspaceFiles?: VirtualFile[];
  /** Future host bridge for workspace-relative file reads. */
  resolveWorkspaceAttachment?: WorkspaceAttachmentResolver;
  workspaceAttachmentRequest?: string | null;
  onWorkspaceAttachmentConsumed?: () => void;
}

const TOOL_ICON: Record<ToolCall["kind"], typeof Brain> = {
  think: Brain,
  read_file: FileSearch,
  edit_file: FileEdit,
  run_command: TerminalSquare,
  search: FileSearch,
};

export function ChatPanel({
  messages,
  running,
  model,
  connected,
  onSend,
  onStop,
  onPatchDecision,
  genPrefs,
  onGenPrefsChange,
  onOpenFolder,
  toolRuns,
  onToolStop,
  onTriggerPlan,
  onExecuteCommand,
  workspaceFiles,
  resolveWorkspaceAttachment,
  workspaceAttachmentRequest,
  onWorkspaceAttachmentConsumed,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [commandStatus, setCommandStatus] = useState<{ text: string; success: boolean } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Live context meter — estimate over the same system+history the
  // send path packs (via buildContext)
  const budgetTokens = model ? model.contextK * 1000 : 0;
  const usedTokens =
    estimateTokens(AGENT_SYSTEM_PROMPT) +
    messages.reduce(
      (sum, m) => (m.role === "system" || !m.content ? sum : sum + estimateTokens(m.content)),
      0,
    );
  const usedPct = budgetTokens > 0 ? (usedTokens / budgetTokens) * 100 : 0;

  const handleExecuteCommand = async (wire: SlashCommandWire) => {
    if (!onExecuteCommand) {
      setCommandStatus({ text: "Swarm commands require a connected agent host.", success: false });
      return;
    }
    setCommandStatus({ text: `Running ${wire.command}…`, success: true });
    try {
      const result = await onExecuteCommand(wire);
      if (result) {
        setCommandStatus({
          text: result.success
            ? result.output ?? `${result.command} completed.`
            : formatErrorMessage(result.error ?? `${result.command} failed.`),
          success: result.success,
        });
      }
    } catch (error) {
      setCommandStatus({ text: formatErrorMessage(error), success: false });
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      {/* transcript */}
      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {messages.length === 0 && (
          <EmptyState
            onPick={(t) => onSend(t)}
            connected={connected}
            onOpenFolder={onOpenFolder}
          />
        )}
        {messages.map((m) => (
          <MessageView key={m.id} m={m} onPatchDecision={onPatchDecision} />
        ))}
        {toolRuns && toolRuns.length > 0 && (
          <div className="max-w-[85%] space-y-2">
            {toolRuns.map((t) => (
              <ToolRunCard key={t.id} t={t} onStop={onToolStop} />
            ))}
          </div>
        )}
      </div>

      {/* composer with floating caret popover slash engine & @file autocomplete */}
      {commandStatus && (
        <div
          className={`mx-4 mb-2 rounded border px-3 py-2 font-mono text-[11px] ${
            commandStatus.success
              ? "border-primary/30 bg-primary/5 text-primary"
              : "border-red-500/30 bg-red-500/5 text-red-300"
          }`}
          role="status"
          data-testid="command-status"
        >
          {commandStatus.text}
        </div>
      )}
      <ChatComposer
        onSendMessage={(text, attachments) => {
          if (!attachments || attachments.length === 0) {
            onSend(text);
            return;
          }
          onSend({ text, attachments });
        }}
        onTriggerPlan={onTriggerPlan}
        onExecuteCommand={handleExecuteCommand}
        running={running}
        onStop={onStop}
        model={model}
        connected={connected}
        budgetTokens={budgetTokens}
        usedTokens={usedTokens}
        usedPct={usedPct}
        genPrefs={genPrefs}
        onGenPrefsChange={onGenPrefsChange}
        workspaceFiles={workspaceFiles}
        resolveWorkspaceAttachment={resolveWorkspaceAttachment}
        workspaceAttachmentRequest={workspaceAttachmentRequest}
        onWorkspaceAttachmentConsumed={onWorkspaceAttachmentConsumed}
      />
    </section>
  );
}

function EmptyState({
  onPick,
  connected,
  onOpenFolder,
}: {
  onPick: (t: string) => void;
  connected: boolean;
  onOpenFolder?: () => void;
}) {
  const starters = [
    { title: "Add rate limiting to the server", desc: "Watch the full plan → read → edit → verify loop with a reviewable diff." },
    { title: "Document the API in README.md", desc: "Smaller change — the agent scopes it to one file." },
    { title: "Refactor server.ts to use routes", desc: "Live mode: streamed from your nano-gpt key." },
  ];

  return (
    <div className="mx-auto max-w-xl pt-8 pb-4 text-center space-y-6 animate-in fade-in duration-200" data-testid="onboarding-hero-card">
      {/* Brand Icon & Heading */}
      <div>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" className="mx-auto ember-glow rounded-lg" aria-hidden>
          <path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2Z" fill="hsl(32 100% 55%)" stroke="hsl(22 100% 50%)" strokeWidth="1" strokeLinejoin="round" />
        </svg>
        <h1 className="mt-3.5 font-mono text-[16px] font-bold tracking-[0.2em] text-foreground">
          FORGE A CHANGE
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          A high-performance local AI agent workbench connected to{" "}
          <span className="text-foreground font-medium">NanoGPT's OpenAI-compatible API</span>.
          {connected ? " Your API key is live." : " No key yet — free guided demo scripts run out-of-the-box."}
        </p>
      </div>

      {/* Primary Action Buttons: Open Local Folder & Guided Demo */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onOpenFolder && (
          <button
            type="button"
            onClick={onOpenFolder}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-mono text-xs font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Open local folder"
          >
            <FolderOpen className="h-4 w-4" />
            Open local folder
          </button>
        )}
        <button
          type="button"
          onClick={() => onPick("Add rate limiting to the server")}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 font-mono text-xs font-medium text-foreground transition-colors hover:border-primary/60 hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Use a guided demo"
        >
          <Play className="h-4 w-4 text-primary" />
          Use a guided demo
        </button>
      </div>

      {/* Plain-Language Security & Privacy Boundaries (R1, R7) */}
      <div className="rounded-xl border border-border/80 bg-secondary/20 p-4 text-left space-y-2.5 shadow-inner">
        <div className="flex items-center gap-2 font-mono text-xs font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span>Local Security &amp; Privacy Guarantees</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px] text-muted-foreground">
          <div className="rounded-md border border-border/40 bg-card/60 p-2.5 space-y-1">
            <span className="font-semibold font-mono text-foreground block">1. Local-First</span>
            <p>Execution stays on your machine. No source code leaves your local environment.</p>
          </div>
          <div className="rounded-md border border-border/40 bg-card/60 p-2.5 space-y-1">
            <span className="font-semibold font-mono text-foreground block">2. Reviewed Writes</span>
            <p>Read-only by default. Any file write requires your explicit review and approval.</p>
          </div>
          <div className="rounded-md border border-border/40 bg-card/60 p-2.5 space-y-1">
            <span className="font-semibold font-mono text-foreground block">3. Secret Protection</span>
            <p>API keys and tokens stay in-memory. Zero telemetry or plaintext secret storage.</p>
          </div>
        </div>
      </div>

      {/* Starter Prompts */}
      <div className="space-y-2 text-left">
        <div className="micro-label px-1">Quick Starters</div>
        {starters.map((s) => (
          <button
            key={s.title}
            onClick={() => onPick(s.title)}
            className="group w-full rounded-lg border border-border bg-card px-3.5 py-3 transition-colors hover:border-primary/50 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <div className="flex items-center gap-2 font-mono text-[12px] text-foreground">
              <SendHorizonal className="h-3 w-3 text-primary" />
              {s.title}
            </div>
            <div className="mt-1 pl-5 text-[11.5px] text-muted-foreground">{s.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageView({ m, onPatchDecision }: { m: Message; onPatchDecision: ChatPanelProps["onPatchDecision"] }) {
  // Task 2.2: edit-verify auto-turns render collapsed; a pending patch (if the
  // verification reply emitted a follow-up diff) stays fully visible with
  // working Apply/Reject.
  if (m.auto) return <AutoTurnView m={m} onPatchDecision={onPatchDecision} />;
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-lg border border-primary/25 bg-primary/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground">
          {m.content}
          {m.attachments && m.attachments.length > 0 && <MessageAttachmentChips attachments={m.attachments} />}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[85%] space-y-2">
      {m.toolCalls?.map((t) => <ToolCard key={t.id} t={t} />)}
      {m.patch && <PatchCard p={m.patch} onDecision={(d) => onPatchDecision(m.id, d)} />}
      {m.content && (
        <div className="text-foreground/85">
          <RichText text={m.content} />
          {m.streaming && <span className="caret-blink ml-0.5 inline-block h-3.5 w-[7px] bg-primary align-middle" />}
        </div>
      )}
      {m.usage && (
        <div className="flex items-center gap-1.5 pt-0.5 font-mono text-[10.5px] text-muted-foreground">
          <CircleDollarSign className="h-3 w-3" />
          {m.model} · {m.usage.input.toLocaleString()} in / {m.usage.output.toLocaleString()} out · ≈ ${m.usage.costUsd.toFixed(5)}
        </div>
      )}
    </div>
  );
}

function MessageAttachmentChips({ attachments }: { attachments: NonNullable<Message["attachments"]> }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-primary/15 pt-2" data-testid="message-attachments">
      {attachments.map((attachment) => (
        <span key={attachment.id} className="inline-flex max-w-full items-center gap-1 rounded border border-primary/25 bg-card/30 px-1.5 py-0.5 font-mono text-[10px] text-primary">
          <FileSearch className="h-3 w-3 shrink-0" />
          <span className="truncate">{attachment.relativePath ?? attachment.name}</span>
          <span className="text-primary/65">{attachment.source} · {attachment.status}{attachment.truncated ? " · truncated" : ""}</span>
          {attachment.status === "missing" && <span className="text-amber-300">snapshot unavailable</span>}
          {attachment.status === "error" && attachment.error && <span className="truncate text-red-300">{formatErrorMessage(attachment.error)}</span>}
        </span>
      ))}
    </div>
  );
}

function AutoTurnView({ m, onPatchDecision }: { m: Message; onPatchDecision: ChatPanelProps["onPatchDecision"] }) {
  const [open, setOpen] = useState(false);
  const snippet = m.content.replace(/\s+/g, " ").trim().slice(0, 72);
  return (
    <div className="max-w-[85%] space-y-2">
      <div className="rounded-md border border-border/60 bg-card/40">
        <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
          <Bot className={`h-3.5 w-3.5 ${m.streaming ? "pulse-dot text-primary" : "text-muted-foreground"}`} />
          <span className="micro-label">auto-verify · {m.role === "user" ? "prompt" : "reply"}</span>
          {snippet && (
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground/70">{snippet}</span>
          )}
          {!snippet && <div className="flex-1" />}
          {m.streaming && <span className="h-2 w-2 rounded-full bg-primary pulse-dot" />}
          {open ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
        {open && m.content && (
          <div className="border-t border-border/60 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
            {m.role === "user" ? <pre className="whitespace-pre-wrap font-mono">{m.content}</pre> : <RichText text={m.content} />}
          </div>
        )}
      </div>
      {m.patch && <PatchCard p={m.patch} onDecision={(d) => onPatchDecision(m.id, d)} />}
      {m.usage && (
        <div className="flex items-center gap-1.5 pt-0.5 font-mono text-[10.5px] text-muted-foreground">
          <CircleDollarSign className="h-3 w-3" />
          {m.model} · {m.usage.input.toLocaleString()} in / {m.usage.output.toLocaleString()} out · ≈ ${m.usage.costUsd.toFixed(5)}
        </div>
      )}
    </div>
  );
}

function ToolCard({ t }: { t: ToolCall }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[t.kind];
  return (
    <div className="rounded-md border border-border bg-card/70">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <Icon className={`h-3.5 w-3.5 ${t.status === "running" ? "pulse-dot text-primary" : "text-muted-foreground"}`} />
        <span className="font-mono text-[11.5px] text-foreground/90">{t.title}</span>
        <span className="micro-label">{t.kind}</span>
        <div className="flex-1" />
        {t.durationMs != null && <span className="font-mono text-[10px] text-muted-foreground">{t.durationMs}ms</span>}
        {t.status === "done" ? (
          <span className="flex items-center gap-1 text-emerald-400 font-mono text-[10.5px]">
            <Check className="h-3 w-3" /> done
          </span>
        ) : t.status === "error" ? (
          <span className="flex items-center gap-1 text-red-400 font-mono text-[10.5px]">
            <X className="h-3 w-3" /> error
          </span>
        ) : (
          <span className="flex items-center gap-1 text-primary font-mono text-[10.5px]">
            <span className="h-2 w-2 rounded-full bg-primary pulse-dot" /> running
          </span>
        )}
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
      </button>
      {open && <div className="border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">{formatErrorMessage(t.detail)}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Supervised terminal tool cards (host-driven, multi-modal status)    */
/* ------------------------------------------------------------------ */

function ToolRunCard({ t, onStop }: { t: ToolRun; onStop?: (toolRunId: string) => void }) {
  const [open, setOpen] = useState(t.state === "running" || t.state === "error");
  const stoppable = t.state === "queued" || t.state === "running" || t.state === "approval_required";
  const meta = getToolRunStatusMeta(t.state);
  const StatusIcon = meta.icon;

  return (
    <div className="rounded-md border border-border bg-card/70" data-testid={`tool-run-${t.id}`} data-state={t.state}>
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <TerminalSquare className={`h-3.5 w-3.5 shrink-0 ${t.state === "running" ? "pulse-dot text-primary" : "text-muted-foreground"}`} />
          <span className="shrink-0 font-mono text-[11.5px] text-foreground/90">{t.executable}</span>
          <span className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground">
            {t.args.join(" ")}
          </span>
          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] shrink-0 border ${meta.colorClass}`}>
            <StatusIcon className="h-2.5 w-2.5 shrink-0" />
            <span>{meta.label}</span>
          </span>
        </button>
        {stoppable && onStop && (
          <button
            aria-label={`Stop ${t.executable}`}
            onClick={() => onStop(t.id)}
            className="flex shrink-0 items-center gap-1 rounded border border-destructive/50 bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] text-red-300 transition-colors hover:bg-destructive/25"
          >
            <Square className="h-2.5 w-2.5" /> stop
          </button>
        )}
        {t.exitCode != null && (
          <span className={`shrink-0 font-mono text-[10px] ${t.exitCode === 0 ? "text-muted-foreground" : "text-red-400"}`}>
            exit {t.exitCode}
          </span>
        )}
        <button onClick={() => setOpen(!open)} aria-label="Toggle details" className="shrink-0">
          {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </button>
      </div>
      {open && (
        <div className="space-y-1 border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <div>
            <span className="micro-label normal-case tracking-normal">cwd </span>
            {formatErrorMessage(t.cwd)}
          </div>
          {t.policyReason && (
            <div className="flex items-center gap-1 text-amber-400/90">
              <ShieldAlert className="h-3 w-3" /> policy: {t.policyReason}
            </div>
          )}
          {t.output && (
            <pre className="scrollbar-thin max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[11px]">
              {t.output}
            </pre>
          )}
          {t.truncated && (
            <div className="text-[10px] uppercase tracking-wider text-amber-400/80">
              … output truncated by host cap
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PatchCard({ p, onDecision }: { p: Patch; onDecision: (d: "applied" | "rejected") => void }) {
  const adds = p.lines.filter((l) => l.type === "add").length;
  const dels = p.lines.filter((l) => l.type === "del").length;
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-card px-2.5 py-1.5">
        <FileEdit className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[11.5px] text-foreground">{p.file}</span>
        <span className="font-mono text-[10.5px] text-emerald-400">+{adds}</span>
        <span className="font-mono text-[10.5px] text-red-400">−{dels}</span>
        <div className="flex-1" />
        {p.status === "pending" ? (
          <div className="flex gap-1.5">
            <button
              onClick={() => onDecision("applied")}
              className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10.5px] text-emerald-300 hover:bg-emerald-500/20"
            >
              <Check className="h-3 w-3" /> apply
            </button>
            <button
              onClick={() => onDecision("rejected")}
              className="flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-mono text-[10.5px] text-red-300 hover:bg-red-500/20"
            >
              <X className="h-3 w-3" /> reject
            </button>
          </div>
        ) : (
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wider border ${
              p.status === "applied"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-red-500/40 bg-red-500/10 text-red-400"
            }`}
          >
            {p.status === "applied" ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            {p.status}
          </span>
        )}
      </div>
      <pre className="scrollbar-thin max-h-64 overflow-auto bg-black/40 p-2.5 font-mono text-[11.5px] leading-[1.55]">
        {p.lines.map((l, i) => (
          <div
            key={i}
            className={
              l.type === "add"
                ? "bg-emerald-500/10 text-emerald-300"
                : l.type === "del"
                  ? "bg-red-500/10 text-red-300/90 line-through decoration-red-400/40"
                  : "text-muted-foreground"
            }
          >
            <span className="mr-2 inline-block w-3 select-none text-right opacity-60">
              {l.type === "add" ? "+" : l.type === "del" ? "−" : " "}
            </span>
            {l.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
