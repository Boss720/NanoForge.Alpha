import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import {
  BookOpen,
  Calendar,
  CircleDollarSign,
  FileCode2,
  Globe,
  Layers,
  Minimize2,
  Network,
  Paperclip,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type {
  ChatAttachmentDraft,
  GenerationPrefs,
  NanoModel,
  VirtualFile,
  WorkspaceAttachmentResolver,
} from "@/types";
import {
  MAX_ATTACHMENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  isWorkspaceRelativePath,
  languageForName,
  readBrowserFile,
} from "@/lib/attachments/validation";
import {
  BUILTIN_SLASH_COMMANDS as PROTOCOL_SLASH_COMMANDS,
  parseSlashCommand,
  type SlashCommandWire,
} from "@protocol/commands";
import { VIRTUAL_PROJECT } from "@/lib/catalog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";

/** Backwards-compatible name for the existing @file send contract. */
export type ContextMention = ChatAttachmentDraft;

export interface SlashCommandItem {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  category: "planning" | "execution" | "context" | "system" | "workspace" | "custom";
}

/** UI projection of the protocol registry; keeps the palette and host parser in sync. */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommandItem[] = PROTOCOL_SLASH_COMMANDS.map(
  ({ name, aliases, description, usage, category }) => ({
    name,
    ...(aliases ? { aliases } : {}),
    description,
    usage,
    category,
  }),
);

const SWARM_COMMAND_NAMES = new Set([
  "/swarm",
  "/sw",
  "/agents",
  "/agent-list",
  "/agent-tree",
  "/agent-inspect",
  "/agent",
  "/a",
  "/agent-message",
  "/agent-pause",
  "/agent-resume",
  "/agent-stop",
  "/agent-focus",
]);

const CATEGORY_COLORS: Record<SlashCommandItem["category"], string> = {
  planning: "border-primary/40 bg-primary/10 text-primary",
  execution: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  context: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  system: "border-purple-500/40 bg-purple-500/10 text-purple-300",
  workspace: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  custom: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
};

const COMMAND_ICONS: Record<string, typeof Sparkles> = {
  "/plan": Layers,
  "/goal": Sparkles,
  "/schedule": Calendar,
  "/browse": Globe,
  "/learn": BookOpen,
  "/cost": CircleDollarSign,
  "/compact": Minimize2,
  "/clear": Trash2,
  "/swarm": Network,
  "/agents": Network,
  "/agent": Network,
};

export interface ChatComposerProps {
  onSendMessage: (text: string, mentions?: ContextMention[]) => void;
  onTriggerPlan?: (goal: string) => void;
  onExecuteCommand?: (wire: SlashCommandWire) => void | Promise<void>;
  disabled?: boolean;
  running?: boolean;
  onStop?: () => void;
  workspaceFiles?: VirtualFile[];
  /** Optional host-backed seam. It only accepts workspace-relative paths. */
  resolveWorkspaceAttachment?: WorkspaceAttachmentResolver;
  workspaceAttachmentRequest?: string | null;
  onWorkspaceAttachmentConsumed?: () => void;
  placeholder?: string;
  model?: NanoModel;
  connected?: boolean;
  budgetTokens?: number;
  usedTokens?: number;
  usedPct?: number;
  genPrefs?: GenerationPrefs;
  onGenPrefsChange?: (prefs: GenerationPrefs) => void;
  className?: string;
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;
}

function workspaceFailure(file: VirtualFile, error: string): ContextMention {
  return {
    id: file.path,
    type: "file",
    source: "workspace",
    name: file.path.split(/[\\/]/).pop() ?? file.path,
    relativePath: file.path,
    mimeType: "text/plain",
    language: file.language || languageForName(file.path),
    byteSize: 0,
    snapshotId: crypto.randomUUID(),
    status: "error",
    error,
  };
}

export function ChatComposer({
  onSendMessage,
  onTriggerPlan,
  onExecuteCommand,
  disabled = false,
  running = false,
  onStop,
  workspaceFiles,
  resolveWorkspaceAttachment,
  workspaceAttachmentRequest,
  onWorkspaceAttachmentConsumed,
  placeholder,
  model,
  connected = false,
  budgetTokens = 0,
  usedTokens = 0,
  usedPct = 0,
  genPrefs,
  onGenPrefsChange,
  className = "",
}: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<ContextMention[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);

  useEffect(() => {
    const relativePath = workspaceAttachmentRequest;
    if (!relativePath) return;
    if (!resolveWorkspaceAttachment) {
      setAttachmentNotice("Connect a local workspace before attaching its files.");
      onWorkspaceAttachmentConsumed?.();
      return;
    }
    const id = `workspace:${relativePath}`;
    if (mentions.some((attachment) => attachment.id === id)) {
      onWorkspaceAttachmentConsumed?.();
      return;
    }
    if (mentions.filter((attachment) => attachment.status !== "error").length >= MAX_ATTACHMENTS) {
      setAttachmentNotice(`A message can include at most ${MAX_ATTACHMENTS} attachments.`);
      onWorkspaceAttachmentConsumed?.();
      return;
    }
    const draft: ContextMention = {
      id,
      type: "file",
      source: "workspace",
      name: relativePath.split(/[\\/]/).pop() ?? relativePath,
      relativePath,
      mimeType: "text/plain",
      language: languageForName(relativePath),
      byteSize: 0,
      snapshotId: crypto.randomUUID(),
      status: "loading",
    };
    setMentions((previous) => [...previous, draft]);
    onWorkspaceAttachmentConsumed?.();
    void resolveWorkspaceAttachment(relativePath)
      .then((resolved) => setMentions((previous) => previous.map((attachment) => attachment.id === id ? {
        ...attachment,
        content: resolved.content,
        mimeType: resolved.mimeType ?? attachment.mimeType,
        language: resolved.language ?? attachment.language,
        byteSize: resolved.byteSize ?? new TextEncoder().encode(resolved.content).byteLength,
        status: "ready",
        error: undefined,
      } : attachment)))
      .catch((error) => setMentions((previous) => previous.map((attachment) => attachment.id === id ? {
        ...attachment,
        status: "error",
        error: error instanceof Error ? error.message : "Could not read workspace file.",
      } : attachment)));
  }, [mentions, onWorkspaceAttachmentConsumed, resolveWorkspaceAttachment, workspaceAttachmentRequest]);

  // Popover state
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const availableFiles = workspaceFiles && workspaceFiles.length > 0 ? workspaceFiles : VIRTUAL_PROJECT;

  // Filter slash commands
  const filteredCommands = BUILTIN_SLASH_COMMANDS.filter((cmd) => {
    if (slashQuery === null) return true;
    const q = slashQuery.toLowerCase();
    if (!q) return true;
    const nameMatch = cmd.name.slice(1).toLowerCase().startsWith(q) || cmd.name.toLowerCase().startsWith(q);
    const aliasMatch = cmd.aliases?.some(
      (a) => a.slice(1).toLowerCase().startsWith(q) || a.toLowerCase().startsWith(q),
    );
    const descMatch = cmd.description.toLowerCase().includes(q);
    return nameMatch || aliasMatch || descMatch;
  });

  // Filter workspace files for @file mentions
  const filteredFiles = availableFiles.filter((file) => {
    if (mentionQuery === null) return true;
    const q = mentionQuery.toLowerCase().replace(/^file:/i, "");
    if (!q) return true;
    return file.path.toLowerCase().includes(q) || file.language.toLowerCase().includes(q);
  });

  // Check cursor position and trigger popovers
  const handleInputChange = (text: string, cursorPos?: number) => {
    setDraft(text);

    const pos = cursorPos ?? textareaRef.current?.selectionStart ?? text.length;
    const textBeforeCursor = text.slice(0, pos);

    // Detect Slash Command trigger: starts with / at beginning of line or following space
    const slashMatch = textBeforeCursor.match(/(?:^|\n)\/([a-zA-Z0-9_-]*)$/);
    if (slashMatch) {
      setSlashQuery(slashMatch[1]);
      setActiveSlashIndex(0);
      setMentionQuery(null);
      return;
    } else {
      setSlashQuery(null);
    }

    // Detect Mention trigger: @filename or @file:filename
    const mentionMatch = textBeforeCursor.match(/(?:^|\s)@([a-zA-Z0-9_\-./:]*)$/);
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
      setActiveMentionIndex(0);
      setSlashQuery(null);
      return;
    } else {
      setMentionQuery(null);
    }
  };

  const selectSlashCommand = (cmd: SlashCommandItem) => {
    const newText = `${cmd.name} `;
    setDraft(newText);
    setSlashQuery(null);

    // Focus back to textarea
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newText.length, newText.length);
      }
    }, 0);
  };

  const selectMentionFile = (file: VirtualFile) => {
    // Add to mentions array if not already present
    if (!mentions.some((m) => m.id === file.path)) {
      if (!isWorkspaceRelativePath(file.path)) {
        addAttachments([workspaceFailure(file, "Workspace attachments must use a relative path.")]);
      } else if (resolveWorkspaceAttachment) {
        addAttachments([
          {
            id: file.path,
            type: "file",
            source: "workspace",
            name: file.path.split(/[\\/]/).pop() ?? file.path,
            relativePath: file.path,
            mimeType: "text/plain",
            language: file.language,
            byteSize: 0,
            snapshotId: crypto.randomUUID(),
            status: "loading",
          },
        ]);
        void resolveWorkspaceAttachment(file.path)
          .then((resolved) => {
            setMentions((prev) =>
              prev.map((attachment) =>
                attachment.id !== file.path
                  ? attachment
                  : {
                      ...attachment,
                      mimeType: resolved.mimeType ?? attachment.mimeType,
                      language: resolved.language ?? attachment.language,
                      byteSize: resolved.byteSize ?? new TextEncoder().encode(resolved.content).byteLength,
                      content: resolved.content,
                      status: "ready",
                      error: undefined,
                    },
              ),
            );
          })
          .catch((error) => updateAttachmentFailure(file.path, error));
      } else {
        addAttachments([
          {
            id: file.path,
            type: "file",
            source: "workspace",
            name: file.path.split(/[\\/]/).pop() ?? file.path,
            relativePath: file.path,
            mimeType: "text/plain",
            language: file.language,
            byteSize: new TextEncoder().encode(file.content).byteLength,
            snapshotId: crypto.randomUUID(),
            status: "ready",
            content: file.content,
          },
        ]);
      }
    }

    // Replace the `@...` token in the draft
    if (textareaRef.current) {
      const pos = textareaRef.current.selectionStart;
      const textBefore = draft.slice(0, pos);
      const textAfter = draft.slice(pos);
      const replacedBefore = textBefore.replace(/@([a-zA-Z0-9_\-./:]*)$/, "").trimEnd();
      const trimmedAfter = textAfter.trimStart();
      const newDraft = replacedBefore
        ? `${replacedBefore} ${trimmedAfter}`
        : trimmedAfter;
      setDraft(newDraft.trimStart());
    }

    setMentionQuery(null);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const removeMention = (id: string) => {
    setMentions((prev) => prev.filter((m) => m.id !== id));
  };

  const addAttachments = (incoming: ContextMention[]) => {
    setMentions((previous) => {
      const next = [...previous];
      for (const attachment of incoming) {
        if (next.some((item) => item.id === attachment.id)) continue;
        if (next.length >= MAX_ATTACHMENTS) {
          setAttachmentNotice(`A message can include at most ${MAX_ATTACHMENTS} attachments.`);
          continue;
        }
        const total = next.filter((item) => item.status !== "error").reduce((sum, item) => sum + item.byteSize, 0);
        if (attachment.status !== "error" && total + attachment.byteSize > MAX_TOTAL_ATTACHMENT_BYTES) {
          setAttachmentNotice("Attachments must total 1 MiB or less.");
          continue;
        }
        next.push(attachment);
      }
      return next;
    });
  };

  const updateAttachmentFailure = (id: string, error: unknown) => {
    setMentions((previous) =>
      previous.map((attachment) =>
        attachment.id === id
          ? { ...attachment, status: "error", error: error instanceof Error ? error.message : "Could not read attachment." }
          : attachment,
      ),
    );
  };

  const addBrowserFiles = async (files: File[]) => {
    const read = await Promise.all(files.map((file) => readBrowserFile(file)));
    addAttachments(read);
  };

  const retryAttachment = async (attachment: ContextMention) => {
    if (attachment.source === "upload" && attachment.file) {
      const retried = await readBrowserFile(attachment.file);
      setMentions((previous) => previous.map((item) => (item.id === attachment.id ? { ...retried, id: attachment.id, snapshotId: attachment.snapshotId } : item)));
      return;
    }
    if (attachment.source === "workspace" && attachment.relativePath && resolveWorkspaceAttachment) {
      setMentions((previous) => previous.map((item) => (item.id === attachment.id ? { ...item, status: "loading", error: undefined } : item)));
      try {
        const resolved = await resolveWorkspaceAttachment(attachment.relativePath);
        setMentions((previous) => previous.map((item) => item.id === attachment.id ? {
          ...item,
          content: resolved.content,
          mimeType: resolved.mimeType ?? item.mimeType,
          language: resolved.language ?? item.language,
          byteSize: resolved.byteSize ?? new TextEncoder().encode(resolved.content).byteLength,
          status: "ready",
        } : item));
      } catch (error) {
        updateAttachmentFailure(attachment.id, error);
      }
    }
  };

  const handlePickerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) void addBrowserFiles(files);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingFile(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) void addBrowserFiles(files);
  };

  const submit = () => {
    const text = draft.trim();
    if ((!text && mentions.length === 0) || running || disabled || mentions.some((attachment) => attachment.status === "loading")) return;

    const command = parseSlashCommand(text);
    if (command && SWARM_COMMAND_NAMES.has(command.command) && onExecuteCommand) {
      void onExecuteCommand(command);
      setDraft("");
      setMentions([]);
      setSlashQuery(null);
      setMentionQuery(null);
      return;
    }

    // Check if input is /plan command
    if (text.startsWith("/plan") || text.startsWith("/p ")) {
      const goal = text.replace(/^\/(?:plan|p)\s*/i, "").trim();
      if (onTriggerPlan) {
        onTriggerPlan(goal);
      }
    }

    onSendMessage(text, mentions.length > 0 ? mentions : undefined);
    setDraft("");
    setMentions([]);
    setSlashQuery(null);
    setMentionQuery(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash palette navigation
    if (slashQuery !== null && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSlashIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSlashIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = filteredCommands[activeSlashIndex];
        if (selected) {
          selectSlashCommand(selected);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashQuery(null);
        return;
      }
    }

    // Mention popup navigation
    if (mentionQuery !== null && filteredFiles.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveMentionIndex((prev) => (prev + 1) % filteredFiles.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveMentionIndex((prev) => (prev - 1 + filteredFiles.length) % filteredFiles.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = filteredFiles[activeMentionIndex];
        if (selected) {
          selectMentionFile(selected);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    // Submit on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={`relative shrink-0 border-t border-border bg-card/60 px-5 py-3 ${className}`} data-testid="chat-composer">
      {/* Floating Slash Command Palette Popover */}
      {slashQuery !== null && (
        <div
          ref={popoverRef}
          data-testid="slash-popover"
          className="absolute bottom-full mb-2 left-5 right-5 max-h-72 overflow-y-auto rounded-lg border border-border bg-card/95 p-2 shadow-2xl backdrop-blur-md z-50 scrollbar-thin animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-2 py-1.5 mb-1.5">
            <span className="micro-label flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" /> Slash Commands
            </span>
            <span className="font-mono text-[9.5px] text-muted-foreground">
              ↑↓ navigate · ↵ select · esc dismiss
            </span>
          </div>

          {filteredCommands.length === 0 ? (
            <div className="px-3 py-4 text-center font-mono text-[11.5px] text-muted-foreground">
              No slash commands match "/{slashQuery}"
            </div>
          ) : (
            <div className="space-y-1">
              {filteredCommands.map((cmd, idx) => {
                const isSelected = idx === activeSlashIndex;
                const Icon = COMMAND_ICONS[cmd.name] ?? Sparkles;
                return (
                  <button
                    key={cmd.name}
                    data-testid={`slash-item-${cmd.name.slice(1)}`}
                    data-active={isSelected}
                    onClick={() => selectSlashCommand(cmd)}
                    onMouseEnter={() => setActiveSlashIndex(idx)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                      isSelected
                        ? "bg-primary/15 border-l-2 border-primary text-foreground"
                        : "hover:bg-secondary/60 text-muted-foreground"
                    }`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-foreground">
                          {cmd.name}
                        </span>
                        {cmd.aliases && cmd.aliases.length > 0 && (
                          <span className="font-mono text-[10px] text-muted-foreground/70">
                            ({cmd.aliases.join(", ")})
                          </span>
                        )}
                        <span
                          className={`rounded border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider ${
                            CATEGORY_COLORS[cmd.category]
                          }`}
                        >
                          {cmd.category}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">{cmd.description}</p>
                    </div>
                    <span className="hidden font-mono text-[9.5px] text-muted-foreground/60 md:block">
                      {cmd.usage}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Floating @file Context Mention Autocomplete Popover */}
      {mentionQuery !== null && (
        <div
          data-testid="mention-popover"
          className="absolute bottom-full mb-2 left-5 right-5 max-h-64 overflow-y-auto rounded-lg border border-border bg-card/95 p-2 shadow-2xl backdrop-blur-md z-50 scrollbar-thin animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-2 py-1.5 mb-1.5">
            <span className="micro-label flex items-center gap-1 text-primary">
              <FileCode2 className="h-3 w-3" /> Mention Workspace File (@file)
            </span>
            <span className="font-mono text-[9.5px] text-muted-foreground">
              ↑↓ navigate · ↵ attach context · esc dismiss
            </span>
          </div>

          {filteredFiles.length === 0 ? (
            <div className="px-3 py-4 text-center font-mono text-[11.5px] text-muted-foreground">
              No files match "@{mentionQuery}"
            </div>
          ) : (
            <div className="space-y-1">
              {filteredFiles.map((file, idx) => {
                const isSelected = idx === activeMentionIndex;
                return (
                  <button
                    key={file.path}
                    data-testid={`mention-item-${file.path}`}
                    data-active={isSelected}
                    onClick={() => selectMentionFile(file)}
                    onMouseEnter={() => setActiveMentionIndex(idx)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                      isSelected
                        ? "bg-primary/15 border-l-2 border-primary text-foreground"
                        : "hover:bg-secondary/60 text-muted-foreground"
                    }`}
                  >
                    <FileCode2 className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground">
                      {file.path}
                    </span>
                    <span className="rounded border border-border bg-card px-1.5 py-px font-mono text-[9.5px] text-muted-foreground uppercase">
                      {file.language}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Input container */}
      <div
        className={`rounded-lg border border-input bg-secondary/40 transition-colors focus-within:border-primary/60 ${isDraggingFile ? "border-primary bg-primary/5" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setIsDraggingFile(true); }}
        onDragLeave={() => setIsDraggingFile(false)}
        onDrop={handleDrop}
        data-testid="attachment-drop-zone"
      >
        {/* Context mention chips */}
        {mentions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 px-3 py-1.5">
            <span className="micro-label normal-case tracking-normal text-muted-foreground">attachments:</span>
            {mentions.map((m) => (
              <span
                key={m.id}
                data-testid={`mention-chip-${m.id}`}
                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary"
              >
                <FileCode2 className="h-3 w-3" />
                <span>{m.relativePath ?? m.name}</span>
                <span className="text-[9px] text-primary/70">{m.source} · {formatBytes(m.byteSize)} · {m.status}{m.truncated ? " · truncated" : ""}</span>
                {m.status === "error" && <span className="max-w-40 truncate text-[9px] text-red-300">{m.error}</span>}
                {(m.status === "error" || m.status === "stale" || m.status === "missing") && (m.file || (m.source === "workspace" && resolveWorkspaceAttachment)) && (
                  <button type="button" aria-label={`Retry attachment ${m.name}`} onClick={() => void retryAttachment(m)} className="rounded p-0.5 hover:bg-primary/20">
                    <RotateCcw className="h-2.5 w-2.5" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Remove mention ${m.id}`}
                  onClick={() => removeMention(m.id)}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20 transition-colors text-primary/80 hover:text-primary"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        {attachmentNotice && (
          <div className="border-b border-red-500/20 px-3 py-1.5 font-mono text-[10px] text-red-300" role="status">
            {attachmentNotice}
          </div>
        )}

        <input ref={fileInputRef} type="file" multiple className="sr-only" data-testid="attachment-file-input" onChange={handlePickerChange} />
        <textarea
          ref={textareaRef}
          data-testid="chat-textarea"
          value={draft}
          disabled={disabled}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder={
            placeholder ??
            (connected
              ? "Describe changes or type / for commands (/plan, /browse, /learn, @file)…"
              : "Demo mode — type /plan or “add rate limiting to the server”")
          }
          className="w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
        />

        {/* Composer bottom status bar */}
        <div className="flex items-center gap-2 px-3 pb-2.5">
          <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10.5px] text-primary">
            {model?.name ?? "no model"}
          </span>
          <span className="micro-label normal-case tracking-normal">
            {connected ? "live · API connected" : "demo script · no tokens burned"}
          </span>

          {budgetTokens > 0 && (
            <span className="flex items-center gap-1.5" title="estimated context usage vs model window">
              <span className="h-1 w-16 overflow-hidden rounded-full bg-secondary sm:w-24">
                <span
                  className={`block h-full transition-all ${usedPct > 85 ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${Math.min(100, usedPct)}%` }}
                />
              </span>
              <span className="hidden font-mono text-[10px] text-muted-foreground md:block">
                {fmtK(usedTokens)} / {fmtK(budgetTokens)}
              </span>
            </span>
          )}

          <div className="flex-1" />

          <button
            type="button"
            aria-label="Attach files from device"
            title="Attach text or code files from this device"
            disabled={disabled || running || mentions.length >= MAX_ATTACHMENTS}
            onClick={() => fileInputRef.current?.click()}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>

          {genPrefs && onGenPrefsChange && (
            <GenSettings genPrefs={genPrefs} onChange={onGenPrefsChange} />
          )}

          <span className="micro-label hidden sm:block">/ commands · @ files · ⏎ send</span>

          {running ? (
            <button
              onClick={onStop}
              data-testid="stop-agent-button"
              className="flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/15 px-3 py-1.5 font-mono text-[11.5px] text-red-300 transition-colors hover:bg-destructive/25 active:scale-[0.98]"
            >
              <Square className="h-3 w-3" /> stop
            </button>
          ) : (
            <button
              onClick={submit}
              data-testid="run-agent-button"
              disabled={(!draft.trim() && mentions.length === 0) || mentions.some((attachment) => attachment.status === "loading")}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-mono text-[11.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30 active:scale-[0.98]"
            >
              <Play className="h-3 w-3" /> run agent
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GenSettings({
  genPrefs,
  onChange,
}: {
  genPrefs: GenerationPrefs;
  onChange: (p: GenerationPrefs) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Generation settings"
          title={`temperature ${genPrefs.temperature.toFixed(2)} · max ${genPrefs.maxTokens} tokens`}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-64 border-border bg-card p-3.5">
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="micro-label">temperature</span>
              <span className="font-mono text-[11px] text-foreground">
                {genPrefs.temperature.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[genPrefs.temperature]}
              min={0}
              max={1.5}
              step={0.05}
              onValueChange={([v]) => onChange({ ...genPrefs, temperature: v })}
              aria-label="Temperature"
            />
            <div className="mt-1 flex justify-between font-mono text-[9.5px] text-muted-foreground">
              <span>precise</span>
              <span>creative</span>
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="micro-label">max tokens</span>
              <span className="font-mono text-[11px] text-foreground">
                {genPrefs.maxTokens.toLocaleString()}
              </span>
            </div>
            <Slider
              value={[genPrefs.maxTokens]}
              min={256}
              max={8192}
              step={256}
              onValueChange={([v]) => onChange({ ...genPrefs, maxTokens: v })}
              aria-label="Max tokens"
            />
            <div className="mt-1 flex justify-between font-mono text-[9.5px] text-muted-foreground">
              <span>256</span>
              <span>8,192</span>
            </div>
          </div>
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            Saved per model · applied to the next live request.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
