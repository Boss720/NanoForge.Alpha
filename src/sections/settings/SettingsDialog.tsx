import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Eye,
  EyeOff,
  FolderLock,
  HardDrive,
  KeyRound,
  Loader2,
  Palette,
  PlugZap,
  Puzzle,
  ShieldCheck,
  Trash2,
  Unplug,
  X,
  Zap,
  Sliders,
  Accessibility,
  Settings as SettingsIcon,
} from "lucide-react";
import type { ConnectionState } from "@/types";
import { formatQuote } from "@/lib/x402";
import { ThemeCustomizer } from "@/sections/settings/ThemeCustomizer";
import { getAttachmentSnapshotStore } from "@/lib/attachments/snapshots";
import { useA11yPreferences, type UiDensity, type FontScale } from "@/lib/a11y";
import { TargetConfirmDialog } from "@/components/ui/TargetConfirmDialog";

const LS_MCP_NOTE_KEY = "nanoforge.mcp-note-dismissed";

export type SettingsTab = "appearance" | "accessibility" | "workspace" | "provider" | "advanced";

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  connection: ConnectionState;
  onConnect: (apiKey: string, baseUrl: string) => void;
  onDisconnect: () => void;
  onClearHistory: () => void;
  onOpenIntegrations?: () => void;
  onOpenTheme?: () => void;
  initialTab?: SettingsTab | "connection" | "theme";
  activeWorkspaceRoot?: string;
  allowWorkspaceWrites?: boolean;
  onToggleWorkspaceWrites?: (enabled: boolean) => void;
}

export function SettingsDialog({
  open,
  onClose,
  connection,
  onConnect,
  onDisconnect,
  onClearHistory,
  onOpenIntegrations,
  initialTab = "provider",
  activeWorkspaceRoot,
  allowWorkspaceWrites = false,
  onToggleWorkspaceWrites,
}: SettingsDialogProps) {
  // Normalize initialTab
  const resolvedInitialTab: SettingsTab =
    initialTab === "connection" ? "provider" : initialTab === "theme" ? "appearance" : (initialTab as SettingsTab);

  const [tab, setTab] = useState<SettingsTab>(resolvedInitialTab);
  const [key, setKey] = useState(connection.apiKey);
  const [base, setBase] = useState(connection.baseUrl);
  const [showKey, setShowKey] = useState(false);
  const [confirmingEnableWrites, setConfirmingEnableWrites] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheClearedNotice, setCacheClearedNotice] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [logLevel, setLogLevel] = useState<"info" | "warn" | "error" | "debug">("info");
  const [ignoredPatterns, setIgnoredPatterns] = useState(".git, node_modules, dist, .env*");
  const [mcpNoteDismissed, setMcpNoteDismissed] = useState(() => {
    try {
      return localStorage.getItem(LS_MCP_NOTE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const { preferences, updatePreferences } = useA11yPreferences();
  const checking = connection.status === "checking";
  const dialogRef = useRef<HTMLDivElement>(null);
  const providerInputRef = useRef<HTMLInputElement>(null);

  // Sync state when opened
  useEffect(() => {
    if (open) {
      setKey(connection.apiKey);
      setBase(connection.baseUrl);
      setConfirmingEnableWrites(false);
      setShowResetConfirm(false);
      setTab(resolvedInitialTab);
    }
  }, [open, connection.apiKey, connection.baseUrl, resolvedInitialTab]);

  // Focus trap & Escape key listener
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleClearAttachmentCache = async () => {
    setClearingCache(true);
    try {
      const store = getAttachmentSnapshotStore();
      await store.clear();
      setCacheClearedNotice(true);
      setTimeout(() => setCacheClearedNotice(false), 3000);
    } catch {
      /* ignore */
    } finally {
      setClearingCache(false);
    }
  };

  const dismissMcpNote = () => {
    setMcpNoteDismissed(true);
    try {
      localStorage.setItem(LS_MCP_NOTE_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        className="flex h-[88vh] max-h-[720px] w-full max-w-3xl flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5 bg-secondary/30">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <SettingsIcon className="h-4 w-4" />
            </div>
            <div>
              <h2 id="settings-dialog-title" className="font-mono text-sm font-bold tracking-wide text-foreground">
                Settings &amp; Preferences
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Manage appearance, accessibility, local workspace, provider keys, and runtime options
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Navigation (5 Unified Groups) */}
        <div
          role="tablist"
          aria-label="Settings Categories"
          className="flex flex-wrap items-center gap-1 border-b border-border bg-secondary/40 px-4 py-2"
        >
          <TabButton
            active={tab === "appearance"}
            onClick={() => setTab("appearance")}
            icon={<Palette className="h-3.5 w-3.5" />}
            label="Appearance"
            testId="tab-appearance"
          />
          <TabButton
            active={tab === "accessibility"}
            onClick={() => setTab("accessibility")}
            icon={<Accessibility className="h-3.5 w-3.5" />}
            label="Accessibility"
            testId="tab-accessibility"
          />
          <TabButton
            active={tab === "workspace"}
            onClick={() => setTab("workspace")}
            icon={<FolderLock className="h-3.5 w-3.5" />}
            label="Local Workspace"
            testId="tab-workspace"
          />
          <TabButton
            active={tab === "provider"}
            onClick={() => setTab("provider")}
            icon={<KeyRound className="h-3.5 w-3.5" />}
            label="Provider"
            testId="tab-provider"
          />
          <TabButton
            active={tab === "advanced"}
            onClick={() => setTab("advanced")}
            icon={<Sliders className="h-3.5 w-3.5" />}
            label="Advanced"
            testId="tab-advanced"
          />
        </div>

        {/* Tab Body */}
        <div className="scrollbar-thin flex-1 overflow-y-auto p-5 space-y-5">
          {/* TAB 1: Appearance */}
          {tab === "appearance" && (
            <div role="tabpanel" aria-label="Appearance" className="space-y-4">
              <ThemeCustomizer onClose={onClose} />
            </div>
          )}

          {/* TAB 2: Accessibility */}
          {tab === "accessibility" && (
            <div role="tabpanel" aria-label="Accessibility" className="space-y-5">
              <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-mono text-xs font-semibold text-foreground">Prefers Reduced Motion</h3>
                    <p className="text-[11.5px] text-muted-foreground mt-0.5">
                      Disables non-essential animations and transitions across all workbench panels.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.reducedMotion}
                      onChange={(e) => updatePreferences({ reducedMotion: e.target.checked })}
                      className="sr-only peer"
                      aria-label="Toggle reduced motion"
                    />
                    <div className="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/40 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>

                <div className="h-px bg-border/60" />

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-mono text-xs font-semibold text-foreground">High-Contrast Mode</h3>
                    <p className="text-[11.5px] text-muted-foreground mt-0.5">
                      Boosts contrast ratios, highlights interactive element borders, and sharpens focus rings (WCAG AAA compliant).
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences.highContrast}
                      onChange={(e) => updatePreferences({ highContrast: e.target.checked })}
                      className="sr-only peer"
                      aria-label="Toggle high contrast"
                    />
                    <div className="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/40 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>

                <div className="h-px bg-border/60" />

                {/* UI Density Switcher */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-mono text-xs font-semibold text-foreground">UI Density</h3>
                    <span className="font-mono text-[11px] text-primary capitalize">{preferences.density}</span>
                  </div>
                  <p className="text-[11.5px] text-muted-foreground">
                    Adjusts vertical and horizontal padding across list items, cards, and sidebars.
                  </p>
                  <div className="grid grid-cols-3 gap-2.5 pt-1">
                    {(["compact", "default", "comfortable"] as UiDensity[]).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => updatePreferences({ density: d })}
                        className={`rounded-md border p-2 text-center font-mono text-xs capitalize transition-all ${
                          preferences.density === d
                            ? "border-primary bg-primary/10 text-primary font-semibold ring-1 ring-primary"
                            : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-px bg-border/60" />

                {/* Font Scaling */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-mono text-xs font-semibold text-foreground">Font Scaling</h3>
                    <span className="font-mono text-[11px] text-primary capitalize">{preferences.fontScale}</span>
                  </div>
                  <p className="text-[11.5px] text-muted-foreground">
                    Scales application font sizes proportionally without breaking layout grids.
                  </p>
                  <div className="grid grid-cols-4 gap-2.5 pt-1">
                    {[
                      { id: "small" as FontScale, label: "85%", desc: "Small" },
                      { id: "default" as FontScale, label: "100%", desc: "Default" },
                      { id: "large" as FontScale, label: "115%", desc: "Large" },
                      { id: "xlarge" as FontScale, label: "130%", desc: "Extra" },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => updatePreferences({ fontScale: f.id })}
                        className={`flex flex-col items-center justify-center rounded-md border p-2 text-center font-mono text-xs transition-all ${
                          preferences.fontScale === f.id
                            ? "border-primary bg-primary/10 text-primary font-semibold ring-1 ring-primary"
                            : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        }`}
                      >
                        <span>{f.desc}</span>
                        <span className="text-[10px] opacity-75">{f.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Local Workspace */}
          {tab === "workspace" && (
            <div role="tabpanel" aria-label="Local Workspace" className="space-y-5">
              <div className="space-y-1.5">
                <label className="micro-label flex items-center gap-1.5 font-semibold text-foreground">
                  <HardDrive className="h-3.5 w-3.5 text-primary" /> Active Workspace Folder
                </label>
                <div
                  data-testid="active-workspace-root-display"
                  className="rounded-md border border-input bg-secondary/40 px-3 py-2 font-mono text-[12px] text-foreground break-all"
                >
                  {activeWorkspaceRoot || "No active local workspace folder"}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="enable-reviewed-local-writes"
                    className="font-semibold text-xs font-mono text-foreground cursor-pointer select-none"
                  >
                    Enable reviewed local writes
                  </label>
                  <input
                    id="enable-reviewed-local-writes"
                    type="checkbox"
                    checked={allowWorkspaceWrites}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setConfirmingEnableWrites(true);
                      } else {
                        setConfirmingEnableWrites(false);
                        onToggleWorkspaceWrites?.(false);
                      }
                    }}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20 accent-primary cursor-pointer"
                  />
                </div>

                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  When enabled, accepting patches in chat will modify files on disk in the selected folder:{" "}
                  <span className="font-mono text-foreground font-semibold break-all">
                    {activeWorkspaceRoot || "the selected folder"}
                  </span>
                  . Each write requires an additional, single-use approval prompt and performs SHA-256 conflict detection
                  before modifying the disk. This setting resets to disabled after restart.
                </p>

                {confirmingEnableWrites && (
                  <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-2.5">
                    <div className="flex items-center gap-2 text-amber-200 font-semibold text-[12px]">
                      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                      <span>Confirm Local Workspace Writes</span>
                    </div>
                    <p className="text-[11.5px] leading-relaxed text-amber-200/90">
                      Allow reviewed local writes? Accepted patches will modify files in{" "}
                      <span className="font-mono text-foreground font-semibold break-all">
                        {activeWorkspaceRoot || "the selected workspace root"}
                      </span>
                      . Are you sure you want to enable this for the current session?
                    </p>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setConfirmingEnableWrites(false)}
                        className="rounded-md border border-border bg-secondary/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmingEnableWrites(false);
                          onToggleWorkspaceWrites?.(true);
                        }}
                        className="rounded-md bg-amber-500 px-3 py-1 font-mono text-[11px] font-semibold text-black hover:bg-amber-400"
                      >
                        Enable Reviewed Writes
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                  <span>
                    Host-side enforcement: Local writes are strictly guarded by the agent host process (
                    <code className="text-foreground">NANOFORGE_ALLOW_WORKSPACE_WRITES</code>). The frontend setting alone
                    cannot force disk writes if the host daemon was started without write permissions.
                  </span>
                </div>
              </div>

              {/* Ignored File Patterns */}
              <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-2">
                <label className="font-semibold text-xs font-mono text-foreground block">
                  Ignored File &amp; Folder Patterns
                </label>
                <p className="text-[11.5px] text-muted-foreground">
                  Comma-separated globs ignored during workspace exploration and search:
                </p>
                <input
                  type="text"
                  value={ignoredPatterns}
                  onChange={(e) => setIgnoredPatterns(e.target.value)}
                  className="w-full rounded-md border border-input bg-secondary/50 px-3 py-1.5 font-mono text-xs text-foreground outline-none"
                />
              </div>

              {/* Attachment Snapshot Cache */}
              <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-xs font-mono text-foreground">Attachment Snapshot Cache</span>
                  <button
                    type="button"
                    disabled={clearingCache}
                    onClick={handleClearAttachmentCache}
                    className="rounded-md border border-border bg-secondary/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary"
                  >
                    {clearingCache ? "Clearing..." : "Clear local attachment cache"}
                  </button>
                </div>
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  Remove locally cached file snapshots from browser IndexedDB storage to free space and prune sensitive attachment history.
                </p>
                {cacheClearedNotice && (
                  <p className="text-[11.5px] text-emerald-400 font-medium">Local attachment cache cleared successfully.</p>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: Provider */}
          {tab === "provider" && (
            <div role="tabpanel" aria-label="Provider" className="space-y-4">
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                Connect a <span className="text-foreground font-medium">Nano-GPT API key</span> to access models.
                The key is kept in memory only for this session; requests stream directly from your machine to the configured base URL.
              </p>

              <div className="space-y-1.5">
                <label className="micro-label block font-semibold text-foreground">API key</label>
                <div className="flex items-center gap-1 rounded-md border border-input bg-secondary/40 px-2.5">
                  <input
                    ref={providerInputRef}
                    type={showKey ? "text" : "password"}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="paste key from nano-gpt.com → API Keys"
                    className="w-full bg-transparent py-2 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Toggle key visibility"
                  >
                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="micro-label block font-semibold text-foreground">Base URL</label>
                <input
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  className="w-full rounded-md border border-input bg-secondary/40 px-2.5 py-2 font-mono text-[12px] text-foreground outline-none"
                />
              </div>

              {connection.error && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-amber-200">
                  {connection.error}
                </div>
              )}

              {connection.status === "error" && connection.x402 !== undefined && (
                <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <p className="flex-1">
                    <span className="text-foreground">Accountless mode available.</span> This key wasn't accepted, but the
                    endpoint answered with an x402 payment quote
                    {connection.x402 ? (
                      <>
                        {" "}— <span className="font-mono text-primary">{formatQuote(connection.x402)}</span>
                      </>
                    ) : (
                      " (no price details returned)"
                    )}
                    . You can pay per request without an account — no key needed — or fix the key above for subscription access.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2.5 text-[11.5px] text-muted-foreground">
                <span>No subscription? Pay-as-you-go works too with per-model pricing.</span>
                <a
                  href="https://nano-gpt.com/api"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-primary hover:underline ml-2"
                >
                  Get a key <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {!mcpNoteDismissed && (
                <div className="flex items-start gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
                  <p className="flex-1">
                    <span className="text-foreground">Using Claude Code or Cursor?</span> The same key works over MCP — see{" "}
                    <a href="https://nano-gpt.com/mcp" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      MCP docs <ExternalLink className="inline h-3 w-3 align-[-1px]" />
                    </a>
                  </p>
                  <button onClick={dismissMcpNote} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss MCP note">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: Advanced */}
          {tab === "advanced" && (
            <div role="tabpanel" aria-label="Advanced" className="space-y-5">
              <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-3">
                <h3 className="font-mono text-xs font-semibold text-foreground">Local Host Diagnostics &amp; Logging</h3>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-muted-foreground block">Log Verbosity</label>
                    <select
                      value={logLevel}
                      onChange={(e) => setLogLevel(e.target.value as any)}
                      className="w-full rounded-md border border-input bg-secondary/50 px-2.5 py-1.5 font-mono text-xs text-foreground outline-none"
                    >
                      <option value="info">Info (Standard)</option>
                      <option value="warn">Warnings Only</option>
                      <option value="error">Errors Only</option>
                      <option value="debug">Debug (Verbose)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-muted-foreground block">Host Connection Endpoint</label>
                    <div className="rounded-md border border-input bg-secondary/40 px-2.5 py-1.5 font-mono text-xs text-muted-foreground truncate">
                      ws://127.0.0.1 (Loopback)
                    </div>
                  </div>
                </div>
              </div>

              {/* Reset Storage Section */}
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-destructive font-mono text-xs font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Destructive Actions</span>
                </div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Clear all saved local sessions, chats, usage logs, and workspace preferences from browser storage.
                </p>
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(true)}
                  className="flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/15 px-3 py-1.5 font-mono text-xs text-destructive hover:bg-destructive/25 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Reset all storage &amp; clear history
                </button>
              </div>

              {onOpenIntegrations && (
                <div className="rounded-lg border border-border bg-secondary/20 p-4 flex items-center justify-between">
                  <div>
                    <h3 className="font-mono text-xs font-semibold text-foreground">Integrations &amp; Extensions</h3>
                    <p className="text-[11.5px] text-muted-foreground">Rules packs, agent skills, and MCP servers</p>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenIntegrations}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-3 py-1.5 font-mono text-xs text-foreground hover:bg-secondary"
                  >
                    <Puzzle className="h-3.5 w-3.5 text-primary" /> Open Integrations
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-secondary/20 px-5 py-3.5">
          <div className="flex items-center gap-2">
            {tab === "provider" && connection.status === "connected" && (
              <button
                type="button"
                onClick={onDisconnect}
                className="flex items-center gap-1.5 rounded-md border border-destructive/50 px-3 py-1.5 font-mono text-xs text-red-300 hover:bg-destructive/10"
              >
                <Unplug className="h-3.5 w-3.5" /> Disconnect
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-secondary/60 px-3.5 py-1.5 font-mono text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Done
            </button>
            {tab === "provider" && (
              <button
                type="button"
                onClick={() => onConnect(key.trim(), base.trim().replace(/\/$/, ""))}
                disabled={!key.trim() || checking}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 font-mono text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                {checking ? "Testing…" : "Test & Connect"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Target-Explicit Confirmation Modal for Storage Reset */}
      <TargetConfirmDialog
        open={showResetConfirm}
        title="Reset All Storage & History"
        description="Are you sure you want to delete all saved sessions, chats, usage logs, and local workspace state? This cannot be undone."
        targetName="RESET"
        confirmLabel="Reset Storage"
        requireTypingName={false}
        onConfirm={() => {
          onClearHistory();
          setShowResetConfirm(false);
        }}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs transition-all ${
        active
          ? "bg-primary font-semibold text-primary-foreground shadow-xs"
          : "text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
