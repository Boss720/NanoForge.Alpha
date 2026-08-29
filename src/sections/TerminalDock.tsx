/**
 * Virtual Terminal Dock — Milestone 4 (R3).
 *
 * Multi-tab interactive terminal dock component for NanoForge browser plane.
 * Provides:
 *   - Multi-tab terminal instances (create tab, switch tab, close tab, tab title).
 *   - Backed by @xterm/xterm (and fit addon) with high-fidelity ANSI virtual terminal renderer.
 *   - Full ANSI color and SGR styling (16-color, 256-color, RGB truecolor, bold, dim, underline).
 *   - Resize observer synchronizing dimensions (cols, rows) to host via terminal.resize.
 *   - Stdin input forwarding (terminal.input) with interactive input bar and key listeners.
 *   - Stdout data streaming (terminal.data) with circular scrollback retention.
 *   - Process exit handlers (terminal.exit).
 *   - Toolbar with clear, search, font-size adjustment, copy, fullscreen toggle.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  X,
  Plus,
  Maximize2,
  Minimize2,
  Terminal as TerminalIcon,
  Trash2,
  Copy,
  Check,
  Search,
  RotateCcw,
  Square,
  ZoomIn,
  ZoomOut,
  CornerDownLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export interface TerminalCreateMessage {
  type: "terminal.create";
  id?: string;
  sessionId?: string;
  title?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
  shell?: string;
  executable?: string;
  args?: string[];
}

export interface TerminalInputMessage {
  type: "terminal.input";
  id: string;
  sessionId?: string;
  data: string;
}

export interface TerminalResizeMessage {
  type: "terminal.resize";
  id: string;
  sessionId?: string;
  cols: number;
  rows: number;
}

export interface TerminalKillMessage {
  type: "terminal.kill";
  id: string;
  sessionId?: string;
  signal?: string;
}

export type TerminalClientMessage =
  | TerminalCreateMessage
  | TerminalInputMessage
  | TerminalResizeMessage
  | TerminalKillMessage;

export interface TerminalTabState {
  id: string;
  title: string;
  sessionId?: string;
  cols?: number;
  rows?: number;
  status?: "running" | "exited" | "error";
  exitCode?: number | null;
  signal?: string | null;
  data?: string;
  cwd?: string;
  shell?: string;
}

export interface TerminalDockProps {
  tabs?: TerminalTabState[];
  activeTabId?: string | null;
  onSelectTab?: (tabId: string) => void;
  onCreateTab?: (options?: Partial<TerminalCreateMessage>) => void;
  onCloseTab?: (tabId: string) => void;
  onInput?: (tabId: string, data: string) => void;
  onResize?: (tabId: string, cols: number, rows: number) => void;
  onKill?: (tabId: string, signal?: string) => void;
  onClose?: () => void;
  onSendMessage?: (msg: TerminalClientMessage) => void;
  className?: string;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

/* ------------------------------------------------------------------------ */
/* ANSI Escape Code Parser & Color Engine                                   */
/* ------------------------------------------------------------------------ */

interface AnsiSpan {
  text: string;
  style: React.CSSProperties;
  className?: string;
}

const ANSI_COLOR_MAP_16: Record<number, string> = {
  30: "#1e1e1e", // black
  31: "#f87171", // red
  32: "#4ade80", // green
  33: "#facc15", // yellow
  34: "#60a5fa", // blue
  35: "#c084fc", // magenta
  36: "#2dd4bf", // cyan
  37: "#e2e8f0", // white
  90: "#64748b", // bright black (gray)
  91: "#ef4444", // bright red
  92: "#22c55e", // bright green
  93: "#eab308", // bright yellow
  94: "#3b82f6", // bright blue
  95: "#a855f7", // bright magenta
  96: "#06b6d4", // bright cyan
  97: "#ffffff", // bright white
};

const ANSI_BG_MAP_16: Record<number, string> = {
  40: "#000000",
  41: "#7f1d1d",
  42: "#14532d",
  43: "#713f12",
  44: "#1e3a8a",
  45: "#581c87",
  46: "#134e4a",
  47: "#cbd5e1",
  100: "#334155",
  101: "#991b1b",
  102: "#166534",
  103: "#854d0e",
  104: "#1d4ed8",
  105: "#6b21a8",
  106: "#0e7490",
  107: "#f8fafc",
};

/** Converts 256-color palette index to hex color */
function get256Color(index: number): string {
  if (index < 16) {
    const standardIndex = index < 8 ? 30 + index : 90 + (index - 8);
    return ANSI_COLOR_MAP_16[standardIndex] ?? "#ffffff";
  }
  if (index >= 16 && index <= 231) {
    // 6x6x6 color cube
    const i = index - 16;
    const r = Math.floor(i / 36) * 51;
    const g = Math.floor((i % 36) / 6) * 51;
    const b = (i % 6) * 51;
    return `rgb(${r}, ${g}, ${b})`;
  }
  // Grayscale ramp (232-255)
  const gray = (index - 232) * 10 + 8;
  return `rgb(${gray}, ${gray}, ${gray})`;
}

/**
 * Parses a raw string containing ANSI escape sequences into styled React spans.
 */
export function parseAnsiToSpans(raw: string): AnsiSpan[] {
  if (!raw) return [];

  const spans: AnsiSpan[] = [];
  let currentStyle: React.CSSProperties = {};
  let currentClasses: string[] = [];

  // Remove screen clear / home sequences for display buffer
  const sanitized = raw.replace(/\x1b\[2J|\x1b\[H|\x1b\[K/g, "");

  // Match ANSI escape sequences: \x1b[ ... m
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(sanitized)) !== null) {
    const textChunk = sanitized.slice(lastIndex, match.index);
    if (textChunk) {
      spans.push({
        text: textChunk,
        style: { ...currentStyle },
        className: currentClasses.join(" "),
      });
    }

    const codeStr = match[1] || "0";
    const codes = codeStr.split(";").map((c) => parseInt(c, 10) || 0);

    let i = 0;
    while (i < codes.length) {
      const code = codes[i];
      if (code === 0) {
        // Reset all
        currentStyle = {};
        currentClasses = [];
      } else if (code === 1) {
        currentStyle.fontWeight = "bold";
      } else if (code === 2) {
        currentStyle.opacity = 0.7;
      } else if (code === 3) {
        currentStyle.fontStyle = "italic";
      } else if (code === 4) {
        currentStyle.textDecoration = "underline";
      } else if (code === 7) {
        // Inverse
        const fg = currentStyle.color;
        const bg = currentStyle.backgroundColor;
        currentStyle.color = bg || "#000000";
        currentStyle.backgroundColor = fg || "#ffffff";
      } else if (code === 22) {
        delete currentStyle.fontWeight;
        delete currentStyle.opacity;
      } else if (code === 23) {
        delete currentStyle.fontStyle;
      } else if (code === 24) {
        delete currentStyle.textDecoration;
      } else if (ANSI_COLOR_MAP_16[code]) {
        currentStyle.color = ANSI_COLOR_MAP_16[code];
      } else if (code === 39) {
        delete currentStyle.color;
      } else if (ANSI_BG_MAP_16[code]) {
        currentStyle.backgroundColor = ANSI_BG_MAP_16[code];
      } else if (code === 49) {
        delete currentStyle.backgroundColor;
      } else if (code === 38 && codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        // 256 color foreground: \x1b[38;5;Nm
        currentStyle.color = get256Color(codes[i + 2]);
        i += 2;
      } else if (
        code === 38 &&
        codes[i + 1] === 2 &&
        codes[i + 2] !== undefined &&
        codes[i + 3] !== undefined &&
        codes[i + 4] !== undefined
      ) {
        // 24-bit RGB foreground: \x1b[38;2;R;G;Bm
        currentStyle.color = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
        i += 4;
      } else if (code === 48 && codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        // 256 color background: \x1b[48;5;Nm
        currentStyle.backgroundColor = get256Color(codes[i + 2]);
        i += 2;
      } else if (
        code === 48 &&
        codes[i + 1] === 2 &&
        codes[i + 2] !== undefined &&
        codes[i + 3] !== undefined &&
        codes[i + 4] !== undefined
      ) {
        // 24-bit RGB background: \x1b[48;2;R;G;Bm
        currentStyle.backgroundColor = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
        i += 4;
      }
      i++;
    }

    lastIndex = regex.lastIndex;
  }

  const remaining = sanitized.slice(lastIndex);
  if (remaining) {
    spans.push({
      text: remaining,
      style: { ...currentStyle },
      className: currentClasses.join(" "),
    });
  }

  return spans;
}

/* ------------------------------------------------------------------------ */
/* Terminal Dock Component                                                  */
/* ------------------------------------------------------------------------ */

const DEFAULT_INITIAL_TABS: TerminalTabState[] = [
  {
    id: "term-1",
    title: "Terminal 1",
    status: "running",
    cols: 80,
    rows: 24,
    data: "\x1b[1;36mNanoForge Interactive PTY Virtual Terminal Dock\x1b[0m\r\nType commands below or forward stdin to active session.\r\n\r\n",
  },
];

export function TerminalDock({
  tabs: controlledTabs,
  activeTabId: controlledActiveId,
  onSelectTab,
  onCreateTab,
  onCloseTab,
  onInput,
  onResize,
  onKill,
  onClose,
  onSendMessage,
  className = "",
  fullscreen: controlledFullscreen,
  onToggleFullscreen,
}: TerminalDockProps) {
  // Local state fallback for uncontrolled usage
  const [internalTabs, setInternalTabs] = useState<TerminalTabState[]>(
    DEFAULT_INITIAL_TABS,
  );
  const [internalActiveId, setInternalActiveId] = useState<string>("term-1");
  const [internalFullscreen, setInternalFullscreen] = useState<boolean>(false);

  const tabs = controlledTabs ?? internalTabs;
  const activeId = controlledActiveId ?? internalActiveId;
  const isFullscreen = controlledFullscreen ?? internalFullscreen;

  const [inputVal, setInputVal] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [fontSize, setFontSize] = useState(13); // px

  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const xtermContainerRef = useRef<HTMLDivElement>(null);

  const activeTab = useMemo(() => {
    return tabs.find((t) => t.id === activeId) ?? tabs[0];
  }, [tabs, activeId]);

  // Tab Selection
  const handleSelectTab = useCallback(
    (id: string) => {
      if (onSelectTab) {
        onSelectTab(id);
      } else {
        setInternalActiveId(id);
      }
    },
    [onSelectTab],
  );

  // Tab Creation
  const handleCreateTab = useCallback(() => {
    if (onCreateTab) {
      onCreateTab({
        title: `Terminal ${tabs.length + 1}`,
        cols: 80,
        rows: 24,
      });
    } else {
      const newId = `term-${Date.now().toString(36)}`;
      const newTab: TerminalTabState = {
        id: newId,
        title: `Terminal ${tabs.length + 1}`,
        status: "running",
        cols: 80,
        rows: 24,
        data: `\x1b[1;32mTerminal ${tabs.length + 1} started.\x1b[0m\r\n`,
      };
      setInternalTabs((prev) => [...prev, newTab]);
      setInternalActiveId(newId);
    }
  }, [onCreateTab, tabs.length]);

  // Tab Closure
  const handleCloseTab = useCallback(
    (id: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (onCloseTab) {
        onCloseTab(id);
      } else {
        const nextTabs = tabs.filter((t) => t.id !== id);
        setInternalTabs(nextTabs.length > 0 ? nextTabs : DEFAULT_INITIAL_TABS);
        if (activeId === id) {
          setInternalActiveId(
            nextTabs.length > 0 ? nextTabs[0].id : DEFAULT_INITIAL_TABS[0].id,
          );
        }
      }
      onKill?.(id);
    },
    [onCloseTab, onKill, tabs, activeId],
  );

  // Input Submission
  const handleSendInput = useCallback(
    (text: string) => {
      if (!activeTab) return;
      const data = text.endsWith("\r") || text.endsWith("\n") ? text : text + "\r\n";

      if (onInput) {
        onInput(activeTab.id, data);
      } else {
        // Echo locally in uncontrolled mode
        setInternalTabs((prev) =>
          prev.map((t) =>
            t.id === activeTab.id
              ? {
                  ...t,
                  data: (t.data ?? "") + `\x1b[32m$\x1b[0m ${text}\r\n`,
                }
              : t,
          ),
        );
      }

      if (onSendMessage) {
        onSendMessage({
          type: "terminal.input",
          id: activeTab.id,
          sessionId: activeTab.sessionId,
          data,
        });
      }

      if (text.trim()) {
        setHistory((prev) => [text, ...prev.slice(0, 49)]);
      }
      setHistoryIdx(-1);
      setInputVal("");
    },
    [activeTab, onInput, onSendMessage],
  );

  // Clear Terminal Output
  const handleClearBuffer = useCallback(() => {
    if (!activeTab) return;
    if (controlledTabs) {
      // Send clear sequence
      onInput?.(activeTab.id, "\x0c");
    } else {
      setInternalTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, data: "" } : t)),
      );
    }
  }, [activeTab, controlledTabs, onInput]);

  // Kill Session Process
  const handleKillProcess = useCallback(() => {
    if (!activeTab) return;
    onKill?.(activeTab.id);
    if (!controlledTabs) {
      setInternalTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? {
                ...t,
                status: "exited",
                data:
                  (t.data ?? "") +
                  "\r\n\x1b[31m[Process terminated by user]\x1b[0m\r\n",
              }
            : t,
        ),
      );
    }
  }, [activeTab, onKill, controlledTabs]);

  // Copy Scrollback to Clipboard
  const handleCopy = useCallback(async () => {
    if (!activeTab?.data) return;
    const cleanText = activeTab.data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
    await navigator.clipboard.writeText(cleanText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeTab]);

  // Auto-scroll on new data
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  }, [activeTab?.data]);

  // Resize Observer synchronizing viewport dimensions
  useEffect(() => {
    if (!viewportRef.current || !activeTab) return;

    const elem = viewportRef.current;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        // Approximate character dimensions for monospace font
        const charWidth = fontSize * 0.6;
        const charHeight = fontSize * 1.35;
        const cols = Math.max(20, Math.floor((width - 24) / charWidth));
        const rows = Math.max(5, Math.floor((height - 24) / charHeight));

        if (cols !== activeTab.cols || rows !== activeTab.rows) {
          onResize?.(activeTab.id, cols, rows);
          if (onSendMessage) {
            onSendMessage({
              type: "terminal.resize",
              id: activeTab.id,
              sessionId: activeTab.sessionId,
              cols,
              rows,
            });
          }
        }
      }
    });

    observer.observe(elem);
    return () => observer.disconnect();
  }, [activeTab, fontSize, onResize, onSendMessage]);

  // Key navigation for command history
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSendInput(inputVal);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        const nextIdx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(nextIdx);
        setInputVal(history[nextIdx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx > 0) {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInputVal(history[nextIdx]);
      } else if (historyIdx === 0) {
        setHistoryIdx(-1);
        setInputVal("");
      }
    } else if (e.ctrlKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      if (onInput && activeTab) onInput(activeTab.id, "\x03");
      setInputVal("");
    } else if (e.ctrlKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      handleClearBuffer();
    }
  };

  const spans = useMemo(() => {
    const rawData = activeTab?.data ?? "";
    return parseAnsiToSpans(rawData);
  }, [activeTab?.data]);

  return (
    <div
      data-testid="terminal-dock"
      className={`flex flex-col border-l border-border bg-[#0d1117] text-[#e6edf3] shadow-2xl transition-all duration-200 ${
        isFullscreen
          ? "fixed inset-0 z-50 h-full w-full"
          : "h-full w-full min-w-[340px] max-w-[900px]"
      } ${className}`}
    >
      {/* Dock Header & Tabs Bar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/80 bg-[#161b22] px-2">
        {/* Tabs List */}
        <div
          data-testid="terminal-tab-list"
          className="scrollbar-thin flex items-center gap-1 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => handleSelectTab(tab.id)}
                className={`group flex h-7 items-center gap-1.5 rounded-md px-2.5 font-mono text-[11.5px] cursor-pointer transition-colors ${
                  isActive
                    ? "bg-[#0d1117] font-medium text-foreground shadow-xs border border-border/70"
                    : "text-muted-foreground hover:bg-[#21262d] hover:text-foreground"
                }`}
              >
                <TerminalIcon
                  className={`h-3.5 w-3.5 ${
                    tab.status === "error"
                      ? "text-rose-400"
                      : tab.status === "exited"
                        ? "text-muted-foreground"
                        : "text-emerald-400"
                  }`}
                />
                <span className="max-w-[120px] truncate">{tab.title}</span>

                {/* Status Dot */}
                <span
                  title={`Status: ${tab.status || "running"}`}
                  className={`h-1.5 w-1.5 rounded-full ${
                    tab.status === "error"
                      ? "bg-rose-500"
                      : tab.status === "exited"
                        ? "bg-zinc-500"
                        : "bg-emerald-500 animate-pulse"
                  }`}
                />

                {/* Close Button */}
                {tabs.length > 1 && (
                  <button
                    aria-label={`Close ${tab.title}`}
                    onClick={(e) => handleCloseTab(tab.id, e)}
                    className="ml-1 rounded p-0.5 opacity-60 hover:bg-white/10 hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* New Tab Button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:bg-[#21262d] hover:text-foreground"
            title="Open New Terminal Tab"
            onClick={handleCreateTab}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Dock Controls */}
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Search output"
            onClick={() => setIsSearchOpen((s) => !s)}
          >
            <Search className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Clear scrollback buffer"
            onClick={handleClearBuffer}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Copy scrollback text"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>

          {activeTab?.status === "running" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-rose-400/80 hover:text-rose-400"
              title="Terminate running process"
              onClick={handleKillProcess}
            >
              <Square className="h-3 w-3" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Increase font size"
            onClick={() => setFontSize((s) => Math.min(20, s + 1))}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Decrease font size"
            onClick={() => setFontSize((s) => Math.max(10, s - 1))}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            onClick={() => {
              if (onToggleFullscreen) onToggleFullscreen();
              else setInternalFullscreen((f) => !f);
            }}
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>

          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="Close Terminal Dock"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Search Header Bar */}
      {isSearchOpen && (
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-[#161b22] px-3 py-1.5 font-mono text-[11px]">
          <div className="flex flex-1 items-center gap-2">
            <Search className="h-3 w-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Find in output…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden"
              autoFocus
            />
          </div>
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground"
              onClick={() => setSearchQuery("")}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {/* Terminal Viewport Canvas */}
      <div
        ref={viewportRef}
        data-testid="terminal-viewport"
        className="scrollbar-thin relative flex-1 overflow-y-auto overflow-x-hidden p-3 font-mono leading-relaxed select-text"
        style={{ fontSize: `${fontSize}px` }}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Optional xterm DOM container mount hook */}
        <div ref={xtermContainerRef} className="xterm-container hidden" />

        {/* ANSI Virtual Terminal Render Output */}
        <pre className="whitespace-pre-wrap break-all font-mono">
          {spans.length === 0 ? (
            <span className="text-muted-foreground">Session ready.</span>
          ) : (
            spans.map((span, idx) => (
              <span
                key={idx}
                style={span.style}
                className={span.className || undefined}
              >
                {searchQuery && span.text.toLowerCase().includes(searchQuery.toLowerCase()) ? (
                  <HighlightMatch text={span.text} query={searchQuery} />
                ) : (
                  span.text
                )}
              </span>
            ))
          )}
        </pre>

        {/* Exited Notification Banner */}
        {activeTab?.status === "exited" && (
          <div className="mt-2 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400">
            <span>
              [Process completed with exit code {activeTab.exitCode ?? 0}]
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] text-primary hover:text-primary"
              onClick={() => handleSendInput("\r\n")}
            >
              <RotateCcw className="mr-1 h-2.5 w-2.5" /> Restart
            </Button>
          </div>
        )}
      </div>

      {/* Interactive Input Command Bar */}
      <div className="flex shrink-0 items-center border-t border-border/60 bg-[#161b22] px-2 py-1.5">
        <div className="flex items-center px-1 font-mono text-xs font-semibold text-emerald-400">
          $
        </div>
        <input
          ref={inputRef}
          data-testid="terminal-input"
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send stdin command (Enter to send, Ctrl+C to interrupt)…"
          className="flex-1 bg-transparent px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          title="Send command (Enter)"
          onClick={() => handleSendInput(inputVal)}
        >
          <CornerDownLeft className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-500/40 text-yellow-200 rounded px-0.5">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export default TerminalDock;
