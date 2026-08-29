# Product Requirement Document (PRD): Headless CLI & Terminal Integration

**Document Status:** Approved / Ready for Engineering Execution  
**Target Milestone:** Phase 3 — Headless CLI, Terminal Ergonomics & PTY Integration  
**Author:** Worker 2 (Multi-Agent & Headless Architecture Lead)  
**Target Systems:** `bin/nanoforge.ts`, `apps/agent-host/src/cli/`, `apps/agent-host/src/terminal/`, `packages/protocol`, `src/sections/TerminalDock.tsx`  
**Last Updated:** 2026-08-15  

---

## 1. Executive Summary

### 1.1 Overview
The **NanoForge Headless CLI & Terminal Integration Subsystem** provides a dual-interface execution engine for NanoForge:
1. **Headless CLI Execution Engine (`nanoforge run <prompt>`)**: A non-interactive, scriptable command-line interface tailored for CI/CD pipelines, pre-commit hooks, local scripts, and automated test-fix loops. It supports real-time streaming output (NDJSON, structured JSON, colored text, or raw model output) with deterministic exit code semantics and non-interactive policy auto-approval gates.
2. **Embedded Interactive PTY Terminal (`@xterm/xterm` + `node-pty`)**: A full pseudo-terminal (PTY) emulation layer integrated into both the backend `apps/agent-host` and the web control plane (`src/sections/TerminalDock.tsx`). This replaces static `<pre>` text dumps with a hardware-accelerated, multi-tab terminal dock supporting full ANSI 24-bit TrueColor rendering, interactive standard input (`stdin`), window resizing (`SIGWINCH`), and dynamic agent session attachment.

```
+---------------------------------------------------------------------------------------------------+
|                                     NANOGORGE INTERFACE TOPOLOGY                                  |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  [ CI/CD / Scripts ]                      [ Developer Workstation ]       [ NanoForge Web UI ]    |
|         │                                             │                            │              |
|         │ `nanoforge run "fix tests"`                 │ `nanoforge attach`         │ (React Tabs) |
|         v                                             v                            v              |
|  +--------------------+                     +--------------------+       +---------------------+  |
|  | Headless CLI Mode  |                     | Interactive TUI/CLI|       | TerminalDock (xterm)|  |
|  | - NDJSON streaming |                     | - Ink / Clack TUI  |       | - WebGL Renderer    |  |
|  | - Exit code ledger |                     | - Local PTY Attach |       | - Multi-Tab Dock    |  |
|  +---------+----------+                     +---------+----------+       +----------+----------+  |
|            │                                          │                             │             |
|            +────────────────────┬─────────────────────+─────────────────────────────+             |
|                                 │                                                                 |
|                                 v IPC / WebSocket (Loopback / Named Pipe)                         |
|  +---------------------------------------------------------------------------------------------+  |
|  |                                  APPS / AGENT-HOST DAEMON                                   |  |
|  |                                                                                             |  |
|  |   +--------------------------+    +--------------------------+    +---------------------+   |  |
|  |   |    HeadlessRunner.ts     |    |      PtyManager.ts       |    |   PolicyEngine.ts   |   |  |
|  |   | - Auto-approval evaluator|    | - node-pty child daemon  |    | - Confined CWD      |   |  |
|  |   | - Turn iteration loop    |    | - 2MB circular buffer    |    | - Auto-grant bounds |   |  |
|  |   | - Verification harness   |    | - Resize & backpressure  |    | - Redaction ledger  |   |  |
|  |   +--------------------------+    +--------------------------+    +---------------------+   |  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
```

### 1.2 Goals
- **Autonomous Headless Scripting**: Enable running complete agent tasks from bash/zsh/PowerShell scripts with zero GUI requirement: `nanoforge run "Implement user auth" --auto-approve=safe --output=json`.
- **Streamlined CI/CD Integration**: Provide machine-readable NDJSON streaming, standard I/O separation (clean structured output on `stdout`, progress spinners/logs on `stderr`), and standardized POSIX exit codes.
- **Hardware-Accelerated Terminal Dock**: Embed high-performance `@xterm/xterm` with WebGL rendering, 24-bit TrueColor, clickable URLs, and multi-tab management.
- **True Interactive PTY**: Deliver real interactive terminal emulation via `node-pty` on Windows (`conpty`), macOS, and Linux (`openpty`), supporting interactive terminal commands (e.g. `vim`, `less`, `htop`, `npm init`, interactive git rebases).
- **Zero-Friction Daemon Lifecycle**: Automatically detect or start the background host daemon over local named pipes or loopback sockets.

### 1.3 Non-Goals
- **Replacing Standalone Terminal Emulators**: NanoForge Terminal Dock is an integrated companion for agent oversight and project execution, not a replacement for general-purpose desktop terminals (e.g. Alacritty, iTerm2).
- **Unrestricted Shell Escalation**: Headless `--auto-approve` flags cannot bypass hard security boundaries (e.g. path traversal outside `workspaceRoot` or execution of denied privilege-escalation binaries like `sudo`/`runas`).

---

## 2. Headless CLI Architecture (`nanoforge run`)

### 2.1 CLI Binary Topology (`bin/nanoforge.ts`)
The CLI entrypoint is built with TypeScript and executed via `tsx` or compiled into a standalone binary distribution (`@nanoforge/cli`).

```
bin/
└── nanoforge.ts                # Executable binary entrypoint (#!/usr/bin/env node)
apps/agent-host/src/cli/
├── index.ts                    # Command dispatcher & arg parsing
├── commands/
│   ├── run.ts                  # `nanoforge run <prompt>` (Headless runner)
│   ├── plan.ts                 # `nanoforge plan <goal>` (Plan generation)
│   ├── serve.ts                # `nanoforge serve` (Daemon starter)
│   ├── attach.ts               # `nanoforge attach <sessionId>` (Terminal attach)
│   └── doctor.ts               # `nanoforge doctor` (System & tool diagnostics)
├── formatters/
│   ├── ndjson.ts               # Line-delimited JSON stream formatter
│   ├── json.ts                 # Single-shot final JSON formatter
│   ├── text.ts                 # Colored human-readable TUI output
│   └── raw.ts                  # Raw assistant text stream
└── daemonClient.ts             # IPC / Named pipe / WebSocket client
```

### 2.2 Execution Lifecycle of `nanoforge run`

```
  [ User executes: `nanoforge run "Refactor auth" --auto-approve=safe --output=ndjson` ]
                                       │
                                       ▼
  1. CLI Argument Parsing & Flag Validation (`cli/commands/run.ts`)
     - Resolves workspaceRoot (default: process.cwd())
     - Validates flags (--auto-approve, --output, --timeout, --model)
                                       │
                                       ▼
  2. Host Daemon Discovery / Spawning (`cli/daemonClient.ts`)
     - Checks if daemon socket is active at `\\.\pipe\nanoforge-<hash>` or `127.0.0.1:<port>`
     - If inactive: Spawns detached background `apps/agent-host` daemon process
     - Performs cryptographic token handshake
                                       │
                                       ▼
  3. Session Initialization (`apps/agent-host/src/cli/headlessRunner.ts`)
     - Creates isolated run session with configured policy & approval mode
     - Builds execution context with workspace files, git status, and active skills
                                       │
                                       ▼
  4. Autonomous Execution & Verification Loop
     - Step A: Model streams tool proposals (e.g. `file.edit`, `terminal.exec`)
     - Step B: Auto-approval evaluator checks policy bounds:
         * If within policy $\to$ Auto-grants execution
         * If outside policy $\to$ Evaluates `--auto-approve` tier or aborts
     - Step C: Executes tools, collects stdout/stderr chunks, verifies diffs
     - Step D: Automated verification run (`npm test`, `pytest`, etc.)
     - Step E: Evaluates test results $\to$ Loops if broken, completes if passing
                                       │
                                       ▼
  5. Stream Formatting & Exit Contract
     - Emits events formatted according to `--output` flag
     - Closes session, records SQLite audit ledger
     - Terminates process with standard exit code (0 = success, 1 = failure, etc.)
```

### 2.3 Non-Interactive Fail-Closed Policy Enforcement
In headless non-interactive execution (e.g. CI/CD runners, automated scripts where standard input is not a TTY and no interactive approval socket client is attached):
- **Fail-Closed on Unapproved Ask**: When running under `--auto-approve=none`, any tool proposal classified under the `ask` policy requires manual confirmation. Because interactive approval cannot be acquired in non-interactive headless mode, the execution engine MUST NOT hang or deadlock until timeout. Instead, it must immediately fail closed and terminate with **Exit Code 4 (`ERR_APPROVAL_DENIED`)**.
- **Safe Tier Boundaries**: Under `--auto-approve=safe` (or `--yes` / `-y`), safe operations (read-only queries, whitelisted tools, workspace-confined file edits) are auto-granted. Any tool in `askExecutables` (such as `rm`, `del`, `curl`, arbitrary process termination) or modifications to critical build manifests (`package.json`, `Cargo.toml`, `Makefile`, `.github/**`) require explicit escalation and fail closed if unapproved.
- **Inviolable Security Guards Under `--auto-approve=all`**: Passing `--auto-approve=all` auto-approves non-denied tools up to configured token/cost budgets, but **NEVER** bypasses root directory deletion guards (`rm -rf /`, `del /s /q C:\`) or path traversal escaping `workspaceRoot`.
- **Filesystem Canonicalization**: All path arguments, working directories, and symlinks/NTFS junctions are canonicalized via `fs.realpathSync` to guarantee that workspace confinement cannot be evaded through junction or symbolic link redirection.

---

## 3. Command-Line Interface & Flag Specification

### 3.1 Syntax and Command Matrix

```bash
# General Syntax
nanoforge [command] [options] [arguments]

# Commands
nanoforge run <prompt>          # Run an autonomous prompt non-interactively
nanoforge plan <goal>           # Formulate a validated execution plan without running tools
nanoforge serve                 # Start the background agent-host daemon
nanoforge attach [sessionId]    # Attach terminal to a running daemon session
nanoforge doctor                # Check environment, Node version, Playwright, MCP tools
```

### 3.2 Non-Interactive Execution Flags for `nanoforge run`

| Flag | Type / Allowed Values | Default | Description |
|---|---|---|---|
| `<prompt>` | `string` (Positional) | Required | Natural language prompt or task description to execute. |
| `-w, --workspace <dir>` | `string` (Path) | `process.cwd()` | Target repository workspace root. Must resolve to valid local directory (canonicalized via `fs.realpathSync`). |
| `-a, --auto-approve <tier>`| `"none"` \| `"safe"` \| `"all"` | `"none"` | Approval automation level:<br>• `none`: Requires manual socket confirmation for any `ask` tool. In non-interactive headless mode, immediately fails closed with Exit Code 4 (`ERR_APPROVAL_DENIED`).<br>• `safe`: Auto-approves read-only operations, whitelisted tools, and workspace-confined edits.<br>• `all`: Auto-approves non-denied tools up to configured token/cost budgets. **NEVER** bypasses root directory deletion guards (`rm -rf /`, `del /s /q C:\`) or workspace path traversal. |
| `-y, --yes` | `boolean` | `false` | Convenience alias for `--auto-approve=safe`. |
| `-o, --output <format>` | `"text"` \| `"json"` \| `"ndjson"` \| `"raw"` | `"text"` | Output stream formatting (see Section 4). |
| `-m, --model <modelId>` | `string` | Config default | Model profile override (e.g. `claude-3-7-sonnet`, `gpt-4o`, `deepseek-chat`). |
| `--max-turns <n>` | `number` (Integer) | `10` | Hard ceiling on autonomous agent turn loop iterations. |
| `-t, --timeout <duration>` | `string` / `number` (e.g. `300s`, `10m`) | `600s` | Global execution timeout. Terminates process with Exit Code 4 if exceeded. |
| `--plan-only` | `boolean` | `false` | Formulates and outputs the plan DAG without executing side-effecting tools. |
| `--isolated` | `boolean` | `false` | Runs inside an ephemeral Git worktree or temporary scratch directory. |
| `--budget-usd <amount>` | `number` (Float) | `2.00` | Hard cap on total LLM dollar spend for the run. |
| `-q, --quiet` | `boolean` | `false` | Suppresses progress banners and non-essential logs on stderr. |
| `-v, --verbose` | `boolean` | `false` | Emits raw debug traces, LLM prompt tokens, and internal coordinator events. |

---

## 4. Standard I/O Framing, Event Streaming, and Exit Codes

### 4.1 Output Formatting Modes

#### Mode 1: NDJSON Stream (`--output=ndjson`)
Emits one JSON object per line on `stdout`. This is the standard format for machine ingestion, CI/CD runners, and IDE plugins.

```json
{"event":"session.init","runId":"run_4a9b","workspace":"/repo","model":"claude-3-7-sonnet","timestamp":"2026-08-15T03:00:00.000Z"}
{"event":"turn.start","turnIndex":1,"timestamp":"2026-08-15T03:00:01.100Z"}
{"event":"model.delta","delta":"I will inspect `src/server.ts` to locate the missing route handler.","timestamp":"2026-08-15T03:00:01.450Z"}
{"event":"tool.start","tool":"file.read","params":{"path":"src/server.ts"},"timestamp":"2026-08-15T03:00:02.000Z"}
{"event":"tool.end","tool":"file.read","durationMs":12,"success":true,"timestamp":"2026-08-15T03:00:02.012Z"}
{"event":"tool.start","tool":"file.edit","params":{"path":"src/server.ts","edits":[{"startLine":45,"endLine":45,"replacementContent":"fastify.get('/health', async () => ({ status: 'ok' }));"}]},"timestamp":"2026-08-15T03:00:03.000Z"}
{"event":"tool.end","tool":"file.edit","durationMs":45,"success":true,"timestamp":"2026-08-15T03:00:03.045Z"}
{"event":"tool.start","tool":"terminal.exec","params":{"executable":"npm","args":["test"]},"timestamp":"2026-08-15T03:00:04.000Z"}
{"event":"tool.chunk","stream":"stdout","chunk":"PASS src/server.test.ts\nTests: 12 passed, 12 total\n","timestamp":"2026-08-15T03:00:06.200Z"}
{"event":"tool.end","tool":"terminal.exec","durationMs":2210,"exitCode":0,"success":true,"timestamp":"2026-08-15T03:00:06.210Z"}
{"event":"session.complete","runId":"run_4a9b","status":"succeeded","turns":1,"costUsd":0.014,"artifacts":["handoff.md"],"timestamp":"2026-08-15T03:00:07.000Z"}
```

#### Mode 2: Structured JSON (`--output=json`)
Collects all execution turns, tool outputs, diffs, and metrics, emitting a single comprehensive JSON payload at program exit:

```json
{
  "runId": "run_4a9b",
  "status": "succeeded",
  "goal": "Refactor auth",
  "turns": 1,
  "stats": {
    "durationMs": 7120,
    "tokensIn": 4250,
    "tokensOut": 890,
    "costUsd": 0.0142
  },
  "changes": [
    {
      "path": "src/server.ts",
      "action": "modified",
      "linesAdded": 3,
      "linesDeleted": 1
    }
  ],
  "verification": {
    "testCommand": "npm test",
    "passed": true,
    "summary": "12 passed, 12 total"
  },
  "handoff": "Observation: Verified route added. Logic: Fastify endpoint responds 200. Conclusion: Fix verified."
}
```

#### Mode 3: Human Text (`--output=text`)
Rich CLI output featuring ANSI colors, spin animations (via `ora`/`clack`), formatted diff blocks, and summary tables. Clean separation: progress banners write to `stderr`, final result writes to `stdout`.

---

### 4.2 POSIX Standard Exit Code Contract

NanoForge CLI adheres to a strict, standardized exit code matrix for seamless integration into shell scripts, Makefiles, and GitHub Actions pipelines:

| Exit Code | Constant Name | Description | Suggested CI/CD Action |
|---|---|---|---|
| **`0`** | `EXIT_SUCCESS` | Task completed successfully, all plan steps passed, verification tests verified. | Proceed to next pipeline stage. |
| **`1`** | `EXIT_AGENT_FAILURE` | Agent completed turns but failed to achieve goal or unresolved test errors remain. | Fail build; display agent error log. |
| **`2`** | `EXIT_POLICY_VIOLATION` | Command attempted unauthorized tool call, path traversal, or denied binary. | Fail build immediately; alert security. |
| **`3`** | `EXIT_USER_CANCELLED` | Execution interrupted via `SIGINT` (`Ctrl+C`), `SIGTERM`, or explicit cancel. | Abort pipeline cleanly. |
| **`4`** | `EXIT_TIMEOUT_EXCEEDED` / `ERR_APPROVAL_DENIED` | Global execution timeout reached (`--timeout`) or non-interactive headless session encountered unapproved `ask` policy. Process trees killed. | Retry with larger timeout, split task, or configure appropriate `--auto-approve` tier. |
| **`5`** | `EXIT_CONFIG_AUTH_ERROR` | Invalid CLI arguments, missing API keys, unreachable daemon, or socket auth failure. | Fail setup; verify environment variables. |
| **`6`** | `EXIT_VERIFICATION_FAILED` | Code modified but automated tests/linting failed on final verification turn. | Reject PR / Block merge. |

---

## 5. Embedded Interactive PTY Architecture

### 5.1 Real PTY vs Static `<pre>` Output
NanoForge replaces passive text streaming with a true pseudo-terminal architecture:

```
+---------------------------------------------------------------------------------------------------+
|                                   EMBEDDED PTY SYSTEM ARCHITECTURE                                |
+---------------------------------------------------------------------------------------------------+

   +---------------------------------------------------------------------------------------------+
   |                                  FRONTEND: REACT / WEBGL                                    |
   |                                                                                             |
   |   +-------------------------------------------------------------------------------------+   |
   |   |                           src/sections/TerminalDock.tsx                             |   |
   |   |   [ Tab 1: Server (Vite) ]  [ Tab 2: Agent Runner ]  [ Tab 3: Bash ]  [ + New ]     |   |
   |   +-------------------------------------------------------------------------------------+   |
   |   |                                                                                     |   |
   |   |   +-----------------------------------------------------------------------------+   |   |
   |   |   |                   @xterm/xterm (XTermTerminal.tsx)                          |   |   |
   |   |   |   - WebGL Addon (@xterm/addon-webgl) for 60fps GPU acceleration            |   |   |
   |   |   |   - Fit Addon (@xterm/addon-fit) for dynamic DOM resize calculation         |   |   |
   |   |   |   - Unicode11 Addon (@xterm/addon-unicode11) for emoji & Nerd Fonts         |   |   |
   |   |   |   - Search Addon (@xterm/addon-search) for interactive Ctrl+F search        |   |   |
   |   |   +-----------------------------------------------------------------------------+   |   |
   |   +-------------------------------------------------------------------------------------+   |
   +----------------------------------------------+----------------------------------------------+
                                                  ^
                                                  | WebSocket Stream (Binary / UTF-8 Frames)
                                                  | - `terminal.input`  { id, data }
                                                  | - `terminal.output` { id, data }
                                                  | - `terminal.resize` { id, cols, rows }
                                                  v
   +---------------------------------------------------------------------------------------------+
   |                             BACKEND: APPS / AGENT-HOST (Node 22)                            |
   |                                                                                             |
   |   +-------------------------------------------------------------------------------------+   |
   |   |                      PtyManager (apps/agent-host/src/terminal/pty.ts)               |   |
   |   |                                                                                     |   |
   |   |   - Spawns real OS PTY via `node-pty`:                                              |   |
   |   |       * Windows: ConPTY (OpenConsole.exe / Windows 10+ pseudo-console API)          |   |
   |   |       * POSIX: openpty(3) / forkpty(3)                                              |   |
   |   |   - 2MB Per-Terminal Circular Ring Buffer (preserves scrollback on reconnect)       |   |
   |   |   - Process Tree Supervision: Clean termination with taskkill / SIGKILL             |   |
   |   |   - Flow Control & Backpressure: Pauses child stdout when WebSocket buffer is full   |   |
   |   +-------------------------------------------------------------------------------------+   |
   +---------------------------------------------------------------------------------------------+
```

### 5.2 Terminal Wire Protocol Schemas (`packages/protocol/src/terminal.ts`)

```typescript
import { z } from "zod";

export const ptySessionIdSchema = z.string().uuid();
export type PtySessionId = z.infer<typeof ptySessionIdSchema>;

/* ------------------------------------------------------------------------ */
/* Client-to-Host Terminal Frames                                           */
/* ------------------------------------------------------------------------ */

export const ptyCreateFrameSchema = z.object({
  type: z.literal("terminal.create"),
  sessionId: ptySessionIdSchema.optional(),
  title: z.string().max(64).default("Terminal"),
  executable: z.string().max(1024).optional(),
  args: z.array(z.string()).default([]),
  cwd: z.string().max(4096).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cols: z.number().int().positive().default(80),
  rows: z.number().int().positive().default(24),
});
export type PtyCreateFrame = z.infer<typeof ptyCreateFrameSchema>;

export const ptyInputFrameSchema = z.object({
  type: z.literal("terminal.input"),
  sessionId: ptySessionIdSchema,
  data: z.string(), // Raw keystrokes or stdin stream
});
export type PtyInputFrame = z.infer<typeof ptyInputFrameSchema>;

export const ptyResizeFrameSchema = z.object({
  type: z.literal("terminal.resize"),
  sessionId: ptySessionIdSchema,
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});
export type PtyResizeFrame = z.infer<typeof ptyResizeFrameSchema>;

export const ptyKillFrameSchema = z.object({
  type: z.literal("terminal.kill"),
  sessionId: ptySessionIdSchema,
  signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT"]).default("SIGTERM"),
});
export type PtyKillFrame = z.infer<typeof ptyKillFrameSchema>;

export const ptyClientMessageSchema = z.discriminatedUnion("type", [
  ptyCreateFrameSchema,
  ptyInputFrameSchema,
  ptyResizeFrameSchema,
  ptyKillFrameSchema,
]);
export type PtyClientMessage = z.infer<typeof ptyClientMessageSchema>;

/* ------------------------------------------------------------------------ */
/* Host-to-Client Terminal Frames                                           */
/* ------------------------------------------------------------------------ */

export const ptyCreatedEventSchema = z.object({
  type: z.literal("terminal.created"),
  sessionId: ptySessionIdSchema,
  title: z.string(),
  pid: z.number().int().positive(),
  cols: z.number(),
  rows: z.number(),
});

export const ptyDataEventSchema = z.object({
  type: z.literal("terminal.data"),
  sessionId: ptySessionIdSchema,
  data: z.string(), // UTF-8 ANSI stream
});

export const ptyExitEventSchema = z.object({
  type: z.literal("terminal.exit"),
  sessionId: ptySessionIdSchema,
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
});

export const ptyHostMessageSchema = z.discriminatedUnion("type", [
  ptyCreatedEventSchema,
  ptyDataEventSchema,
  ptyExitEventSchema,
]);
export type PtyHostMessage = z.infer<typeof ptyHostMessageSchema>;
```

---

## 6. Multi-Tab Terminal Dock & UI Component Specification

### 6.1 React Terminal Dock Component (`src/sections/TerminalDock.tsx`)

The Terminal Dock is a collapsible bottom panel with tabbed terminal sessions:

```tsx
import React, { useState, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Plus, X, Maximize2, Minimize2, Terminal as TerminalIcon } from "lucide-react";
import type { PtySessionId } from "@protocol/terminal";

export interface TerminalTab {
  id: PtySessionId;
  title: string;
  isAgentAttached?: boolean;
}

export function TerminalDock({
  isOpen,
  onToggle,
  onSendInput,
  onResize,
  onCreatePty,
  onKillPty,
}: TerminalDockProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<PtySessionId | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);

  // Initialize xterm instance on mount
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "Fira Code, Menlo, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
      },
      allowTransparency: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);

    try {
      const webgl = new WebglAddon();
      term.loadAddon(webgl);
    } catch {
      // Fallback to standard canvas if WebGL is unavailable
    }

    term.open(terminalRef.current);
    fit.fit();

    term.onData((data) => {
      if (activeTabId) onSendInput(activeTabId, data);
    });

    term.onResize(({ cols, rows }) => {
      if (activeTabId) onResize(activeTabId, cols, rows);
    });

    xtermInstance.current = term;
    fitAddon.current = fit;

    const handleResize = () => fit.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
    };
  }, [activeTabId]);

  return (
    <div className={`border-t border-border bg-card transition-all ${isOpen ? (isExpanded ? "h-96" : "h-64") : "h-9"}`}>
      {/* Header / Tabs Bar */}
      <div className="flex h-9 items-center justify-between border-b border-border px-2 bg-secondary/30">
        <div className="flex items-center gap-1 overflow-x-auto">
          <div className="flex items-center gap-1.5 px-2 text-xs font-semibold text-muted-foreground">
            <TerminalIcon className="h-3.5 w-3.5" />
            <span>Terminal</span>
          </div>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`flex items-center gap-1.5 rounded-t px-2.5 py-1 text-xs font-mono transition-colors ${
                activeTabId === tab.id
                  ? "bg-background text-foreground border-t-2 border-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <span>{tab.title}</span>
              <X
                className="h-3 w-3 hover:text-red-400"
                onClick={(e) => {
                  e.stopPropagation();
                  onKillPty(tab.id);
                }}
              />
            </button>
          ))}
          <button
            onClick={onCreatePty}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-secondary text-muted-foreground"
            title="New Terminal"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      {isOpen && <div ref={terminalRef} className="h-[calc(100%-2.25rem)] w-full p-1" />}
    </div>
  );
}
```

---

## 7. Host Daemon PTY Implementation (`apps/agent-host`)

### 7.1 PTY Manager (`apps/agent-host/src/terminal/ptyManager.ts`)

```typescript
import { EventEmitter } from "node:events";
import * as pty from "node-pty";
import * as os from "os";
import * as path from "node:path";
import * as fs from "node:fs";
import { exec } from "node:child_process";
import type { WebSocket } from "ws";
import type { PtySessionId, PtyCreateFrame } from "@protocol/terminal";

/** Strict allowlist for PTY child environments to prevent host API key/secret leakage */
export const DEFAULT_ENV_ALLOWLIST = [
  "PATH",
  "TERM",
  "HOME",
  "USER",
  "LANG",
  "SHELL",
  "SYSTEMROOT",
  "SystemRoot",
  "COMSPEC",
  "ComSpec",
  "APPDATA",
  "LOCALAPPDATA",
  "TMP",
  "TEMP",
] as const;

export function sanitizeHostEnvironment(customEnv?: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };

  for (const key of DEFAULT_ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) {
      sanitized[key] = val;
    }
  }

  // Merge explicitly provided caller env if allowed
  if (customEnv) {
    for (const [k, v] of Object.entries(customEnv)) {
      sanitized[k] = v;
    }
  }

  return sanitized;
}

export interface ManagedPty {
  id: PtySessionId;
  title: string;
  process: pty.IPty;
  ringBuffer: string[];
  maxBufferBytes: number;
  currentBufferBytes: number;
  isPaused: boolean;
  attachedSocket?: WebSocket;
}

export class PtyManager extends EventEmitter {
  private readonly sessions = new Map<PtySessionId, ManagedPty>();
  private readonly defaultShell =
    os.platform() === "win32" ? "powershell.exe" : process.env.SHELL || "bash";

  createSession(options: PtyCreateFrame & { sessionId: PtySessionId }): ManagedPty {
    const shell = options.executable || this.defaultShell;
    // Canonicalize path to resolve symlinks and NTFS junctions
    const cwd = options.cwd ? fs.realpathSync(path.resolve(options.cwd)) : process.cwd();

    // Sanitize environment variables to block credential leakage
    const env = sanitizeHostEnvironment(options.env);

    const ptyProcess = pty.spawn(shell, options.args || [], {
      name: "xterm-256color",
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd,
      env,
    });

    const managed: ManagedPty = {
      id: options.sessionId,
      title: options.title || "Terminal",
      process: ptyProcess,
      ringBuffer: [],
      maxBufferBytes: 2 * 1024 * 1024, // 2MB true circular buffer
      currentBufferBytes: 0,
      isPaused: false,
    };

    ptyProcess.onData((data: string) => {
      this.appendToBuffer(managed, data);
      this.emit("data", { sessionId: options.sessionId, data });

      // WebSocket Backpressure Management: pause when buffer > 64KB
      if (managed.attachedSocket) {
        const buffered = managed.attachedSocket.bufferedAmount;
        if (buffered > 64 * 1024 && !managed.isPaused) {
          managed.process.pause();
          managed.isPaused = true;
        }
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      this.emit("exit", { sessionId: options.sessionId, exitCode, signal });
      this.sessions.delete(options.sessionId);
    });

    this.sessions.set(options.sessionId, managed);
    return managed;
  }

  attachSocket(sessionId: PtySessionId, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.attachedSocket = ws;

    // Resume PTY on WebSocket buffer drain
    const checkDrain = () => {
      if (session.isPaused && ws.bufferedAmount < 16 * 1024) {
        session.process.resume();
        session.isPaused = false;
      }
    };

    ws.on("drain", checkDrain);
  }

  writeInput(sessionId: PtySessionId, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`PTY session ${sessionId} not found`);
    session.process.write(data);
  }

  resize(sessionId: PtySessionId, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.process.resize(Math.max(1, cols), Math.max(1, rows));
    } catch {
      // Ignore resize on dead process
    }
  }

  /**
   * Robust Process Tree Teardown:
   * Uses `taskkill /F /T /PID <pid>` on Windows.
   * Uses process group `process.kill(-pid, 'SIGKILL')` on POSIX.
   */
  async kill(sessionId: PtySessionId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const pid = session.process.pid;
    if (pid) {
      if (os.platform() === "win32") {
        await new Promise<void>((resolve) => {
          exec(`taskkill /F /T /PID ${pid}`, () => resolve());
        });
      } else {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          try {
            session.process.kill("SIGKILL");
          } catch {
            // Already dead
          }
        }
      }
    } else {
      session.process.kill();
    }

    this.sessions.delete(sessionId);
  }

  getBuffer(sessionId: PtySessionId): string {
    const session = this.sessions.get(sessionId);
    return session ? session.ringBuffer.join("") : "";
  }

  private appendToBuffer(session: ManagedPty, chunk: string): void {
    const chunkBytes = Buffer.byteLength(chunk, "utf-8");
    session.ringBuffer.push(chunk);
    session.currentBufferBytes += chunkBytes;

    while (session.currentBufferBytes > session.maxBufferBytes && session.ringBuffer.length > 0) {
      const removed = session.ringBuffer.shift()!;
      session.currentBufferBytes -= Buffer.byteLength(removed, "utf-8");
    }
  }
}
```

---

## 8. Verification Plan & Test Matrix

### 8.1 Automated Verification Scenarios
1. **Headless Execution Test (`nanoforge run`)**:
   - Run command: `nanoforge run "Add 2+2 in math.ts" --auto-approve=safe --output=json`
   - Assert exit code is `0`.
   - Assert JSON output contains `status: "succeeded"` and valid file modifications.
2. **Policy Violation Test**:
   - Run command: `nanoforge run "rm -rf /" --auto-approve=safe`
   - Assert exit code is `2` (`EXIT_POLICY_VIOLATION`).
   - Assert no destructive deletions occurred.
3. **PTY Session Spawning & ANSI Rendering**:
   - Spawn PTY session running `ls --color=always` / `dir`.
   - Assert `terminal.data` frames contain valid SGR ANSI color escape sequences (`\u001b[32m`).
4. **Interactive STDIN Test**:
   - Spawn interactive PTY session with Python REPL (`python -q`).
   - Send `terminal.input` with `"print(40 + 2)\n"`.
   - Assert `terminal.data` stream returns `"42"`.
5. **Dynamic Resize Synchronization**:
   - Emit `terminal.resize` frame with `cols: 120, rows: 40`.
   - Verify `ptyProcess.cols === 120` and `ptyProcess.rows === 40`.

---
*End of PRD: Headless CLI & Terminal Integration*
