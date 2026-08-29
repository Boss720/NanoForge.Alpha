/**
 * Interactive PTY Manager for Agent Host — Milestone 4 (R3).
 *
 * Manages virtual terminal sessions over the terminal wire protocol.
 * Spawns interactive shells (using node-pty if available, with a cross-platform
 * child_process stream fallback), enforces workspace confinement and environment
 * sanitization, maintains a 2MB circular scrollback buffer per session, and
 * multiplexes terminal protocol messages:
 *   - terminal.create -> terminal.created
 *   - terminal.input  -> stdin stream
 *   - terminal.resize -> viewport geometry sync
 *   - terminal.kill   -> process tree termination
 *   - terminal.data   -> stdout/stderr ANSI stream
 *   - terminal.exit   -> process exit notification
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { execa } from "execa";
import { resolveWithinWorkspace } from "../policy/policy";
import { RunnerSpecError } from "./types";
import { DEFAULT_ENV_ALLOWLIST } from "./runner";
import type {
  TerminalCreateMessage,
  TerminalCreatedMessage,
  TerminalDataMessage,
  TerminalExitMessage,
  TerminalServerMessage,
} from "@protocol/terminal";

/** Default 2MB circular buffer per terminal session */
export const DEFAULT_MAX_SCROLLBACK_BYTES = 2 * 1024 * 1024; // 2 MiB

export interface PtySessionInfo {
  id: string;
  sessionId?: string;
  title: string;
  pid: number;
  cols: number;
  rows: number;
  cwd: string;
  shell: string;
  startedAt: string;
  status: "running" | "exited";
  exitCode?: number | null;
  signal?: string | null;
}

/**
 * Opaque host-issued identity for the socket/session that created a terminal.
 * This never comes from a terminal wire frame and is intentionally omitted
 * from public terminal metadata.
 */
export type PtySessionOwner = string;

export interface PtyManagerOptions {
  workspaceRoot?: string;
  envAllowlist?: readonly string[];
  env?: Record<string, string>;
  maxScrollbackBytes?: number;
  defaultCols?: number;
  defaultRows?: number;
  onMessage?: (message: TerminalServerMessage) => void;
}

/**
 * High-performance circular buffer retaining at most `maxBytes` (the tail).
 */
export class CircularScrollbackBuffer {
  private chunks: string[] = [];
  private totalBytes = 0;
  private truncated = false;

  constructor(private readonly maxBytes: number = DEFAULT_MAX_SCROLLBACK_BYTES) {}

  push(chunk: string): void {
    if (!chunk) return;
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    this.chunks.push(chunk);
    this.totalBytes += chunkBytes;

    while (this.totalBytes > this.maxBytes && this.chunks.length > 0) {
      this.truncated = true;
      const overflow = this.totalBytes - this.maxBytes;
      const first = this.chunks[0];
      const firstBytes = Buffer.byteLength(first, "utf8");

      if (firstBytes <= overflow) {
        this.chunks.shift();
        this.totalBytes -= firstBytes;
      } else {
        // Keep the tail of the first chunk
        const retainBytes = firstBytes - overflow;
        const buf = Buffer.from(first, "utf8");
        const sliced = buf.subarray(buf.length - retainBytes).toString("utf8");
        this.chunks[0] = sliced;
        this.totalBytes = this.chunks.reduce(
          (acc, c) => acc + Buffer.byteLength(c, "utf8"),
          0,
        );
        break;
      }
    }
  }

  get isTruncated(): boolean {
    return this.truncated;
  }

  get byteLength(): number {
    return this.totalBytes;
  }

  toString(): string {
    return this.chunks.join("");
  }

  clear(): void {
    this.chunks = [];
    this.totalBytes = 0;
    this.truncated = false;
  }
}

/** Internal wrapper representing an active or completed PTY session. */
class InternalPtySession {
  readonly id: string;
  readonly sessionId?: string;
  readonly ownerId?: PtySessionOwner;
  title: string;
  pid: number;
  cols: number;
  rows: number;
  readonly cwd: string;
  readonly shell: string;
  readonly startedAt: string;
  status: "running" | "exited" = "running";
  exitCode: number | null = null;
  signal: string | null = null;
  readonly buffer: CircularScrollbackBuffer;

  private childProcess?: ChildProcess;
  private ptyProcess?: {
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: (signal?: string) => void;
    pid: number;
  };
  private isKilled = false;

  constructor(opts: {
    id: string;
    sessionId?: string;
    ownerId?: PtySessionOwner;
    title: string;
    pid: number;
    cols: number;
    rows: number;
    cwd: string;
    shell: string;
    maxScrollbackBytes: number;
  }) {
    this.id = opts.id;
    this.sessionId = opts.sessionId;
    this.ownerId = opts.ownerId;
    this.title = opts.title;
    this.pid = opts.pid;
    this.cols = opts.cols;
    this.rows = opts.rows;
    this.cwd = opts.cwd;
    this.shell = opts.shell;
    this.startedAt = new Date().toISOString();
    this.buffer = new CircularScrollbackBuffer(opts.maxScrollbackBytes);
  }

  attachChildProcess(child: ChildProcess): void {
    this.childProcess = child;
    this.pid = child.pid ?? this.pid;
  }

  attachPtyProcess(pty: {
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: (signal?: string) => void;
    pid: number;
  }): void {
    this.ptyProcess = pty;
    this.pid = pty.pid;
  }

  write(data: string): boolean {
    if (this.status === "exited" || this.isKilled) return false;
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
      return true;
    }
    if (this.childProcess?.stdin && !this.childProcess.stdin.destroyed) {
      this.childProcess.stdin.write(data);
      return true;
    }
    return false;
  }

  resize(cols: number, rows: number): boolean {
    this.cols = cols;
    this.rows = rows;
    if (this.ptyProcess) {
      try {
        this.ptyProcess.resize(cols, rows);
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }

  async kill(signal?: string): Promise<void> {
    if (this.isKilled && this.status === "exited") return;
    this.isKilled = true;

    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill(signal);
      } catch {
        /* already dead */
      }
      return;
    }

    if (this.childProcess) {
      const pid = this.childProcess.pid;
      if (pid) {
        if (process.platform === "win32") {
          try {
            await execa("taskkill", ["/pid", String(pid), "/t", "/f"], {
              shell: false,
              reject: false,
              windowsHide: true,
            });
          } catch {
            /* ignore */
          }
        } else {
          try {
            process.kill(-pid, (signal as NodeJS.Signals) || "SIGKILL");
          } catch {
            try {
              process.kill(pid, (signal as NodeJS.Signals) || "SIGKILL");
            } catch {
              /* ignore */
            }
          }
        }
      }
      try {
        this.childProcess.kill((signal as NodeJS.Signals) || "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }

  getInfo(): PtySessionInfo {
    return {
      id: this.id,
      sessionId: this.sessionId,
      title: this.title,
      pid: this.pid,
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      shell: this.shell,
      startedAt: this.startedAt,
      status: this.status,
      exitCode: this.exitCode,
      signal: this.signal,
    };
  }
}

/**
 * Builds sanitized environment for interactive terminal shells.
 */
function buildTerminalEnv(
  allowlist: readonly string[],
  hostEnv?: Record<string, string>,
  jobEnv?: Record<string, string>,
): Record<string, string> {
  const wanted = new Set(
    allowlist.map((name) =>
      process.platform === "win32" ? name.toUpperCase() : name,
    ),
  );
  const env: Record<string, string> = {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const normalized = process.platform === "win32" ? key.toUpperCase() : key;
    if (wanted.has(normalized)) {
      // Sensitive patterns strip
      if (/TOKEN|SECRET|KEY|PASSWORD|AUTH|CREDENTIAL/i.test(key)) {
        continue;
      }
      env[key] = value;
    }
  }

  // Explicit additions overlay
  Object.assign(env, hostEnv ?? {}, jobEnv ?? {});
  return env;
}

/**
 * Determines default shell executable and initial arguments.
 */
function resolveDefaultShell(
  requestedShell?: string,
  requestedExecutable?: string,
  requestedArgs?: string[],
): { shell: string; args: string[] } {
  if (requestedExecutable) {
    return {
      shell: requestedExecutable,
      args: requestedArgs ?? [],
    };
  }
  if (requestedShell) {
    return {
      shell: requestedShell,
      args: requestedArgs ?? [],
    };
  }

  if (process.platform === "win32") {
    // Prefer PowerShell -> cmd
    const comspec = process.env.COMSPEC || "cmd.exe";
    const powershell = "powershell.exe";
    return {
      shell: powershell,
      args: requestedArgs && requestedArgs.length > 0 ? requestedArgs : ["-NoLogo"],
    };
  } else {
    const defaultShell = process.env.SHELL || "/bin/bash";
    return {
      shell: defaultShell,
      args: requestedArgs ?? [],
    };
  }
}

export class PtyManager extends EventEmitter {
  readonly workspaceRoot: string;
  private readonly envAllowlist: readonly string[];
  private readonly hostEnv?: Record<string, string>;
  private readonly maxScrollbackBytes: number;
  private readonly defaultCols: number;
  private readonly defaultRows: number;
  private readonly onMessageCallback?: (message: TerminalServerMessage) => void;
  private readonly sessions = new Map<string, InternalPtySession>();
  private disposed = false;

  constructor(options: PtyManagerOptions = {}) {
    super();
    this.workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    this.envAllowlist = options.envAllowlist
      ? [...DEFAULT_ENV_ALLOWLIST, ...options.envAllowlist]
      : [
          ...DEFAULT_ENV_ALLOWLIST,
          "LANG",
          "LC_ALL",
          "TERM",
          "COLORTERM",
          "SHLVL",
          "TERM_PROGRAM",
          "CI",
        ];
    this.hostEnv = options.env;
    this.maxScrollbackBytes =
      options.maxScrollbackBytes ?? DEFAULT_MAX_SCROLLBACK_BYTES;
    this.defaultCols = options.defaultCols ?? 80;
    this.defaultRows = options.defaultRows ?? 24;
    this.onMessageCallback = options.onMessage;
  }

  /**
   * Broadcast a terminal server message to subscribers and optional callback.
   */
  private emitServerMessage(message: TerminalServerMessage): void {
    if (this.disposed) return;
    this.emit(message.type, message);
    this.emit("message", message);
    this.onMessageCallback?.(message);
  }

  /**
   * Allocate and spawn a new interactive PTY terminal session.
   */
  async createSession(
    spec: Partial<TerminalCreateMessage> = {},
    ownerId?: PtySessionOwner,
  ): Promise<PtySessionInfo> {
    if (this.disposed) {
      throw new Error("PtyManager is disposed");
    }

    const id = spec.id ?? randomUUID();
    if (ownerId !== undefined && (ownerId.length === 0 || ownerId.length > 256)) {
      throw new TypeError("terminal owner must be a non-empty opaque identifier up to 256 characters");
    }
    const cols = spec.cols ?? this.defaultCols;
    const rows = spec.rows ?? this.defaultRows;
    const title = spec.title ?? `terminal-${this.sessions.size + 1}`;

    // Workspace confinement check
    const resolvedCwd = resolveWithinWorkspace(
      this.workspaceRoot,
      spec.cwd ?? ".",
    );
    if (resolvedCwd === null) {
      throw new RunnerSpecError(
        `cwd escapes the workspace root: ${spec.cwd ?? "."}`,
      );
    }

    const { shell, args } = resolveDefaultShell(
      spec.shell,
      spec.executable,
      spec.args,
    );
    const env = buildTerminalEnv(this.envAllowlist, this.hostEnv, spec.env);

    const session = new InternalPtySession({
      id,
      sessionId: spec.sessionId,
      ownerId,
      title,
      pid: 0,
      cols,
      rows,
      cwd: resolvedCwd,
      shell,
      maxScrollbackBytes: this.maxScrollbackBytes,
    });
    this.sessions.set(id, session);

    // Try node-pty dynamic import if supported in this runtime
    let spawnedWithNodePty = false;
    try {
      // Dynamic import to avoid hard bundling requirements
      const nodePty = await (Function('return import("node-pty")')() as Promise<any>);
      if (nodePty && typeof nodePty.spawn === "function") {
        const ptyProc = nodePty.spawn(shell, args, {
          name: "xterm-256color",
          cols,
          rows,
          cwd: resolvedCwd,
          env,
        });

        session.attachPtyProcess(ptyProc);
        spawnedWithNodePty = true;

        ptyProc.onData((data: string) => {
          session.buffer.push(data);
          const msg: TerminalDataMessage = {
            type: "terminal.data",
            id,
            sessionId: spec.sessionId,
            data,
          };
          this.emitServerMessage(msg);
        });

        ptyProc.onExit((e: { exitCode: number; signal?: number }) => {
          session.status = "exited";
          session.exitCode = e.exitCode;
          session.signal = e.signal ? String(e.signal) : null;
          const msg: TerminalExitMessage = {
            type: "terminal.exit",
            id,
            sessionId: spec.sessionId,
            exitCode: e.exitCode,
            signal: session.signal ?? undefined,
          };
          this.emitServerMessage(msg);
        });
      }
    } catch {
      // Fallback to stdio stream child process
      spawnedWithNodePty = false;
    }

    if (!spawnedWithNodePty) {
      // Cross-platform child_process stream fallback
      const child = spawn(shell, args, {
        cwd: resolvedCwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      });

      session.attachChildProcess(child);

      const handleData = (chunk: Buffer | string) => {
        const str = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        session.buffer.push(str);
        const msg: TerminalDataMessage = {
          type: "terminal.data",
          id,
          sessionId: spec.sessionId,
          data: str,
        };
        this.emitServerMessage(msg);
      };

      child.stdout?.on("data", handleData);
      child.stderr?.on("data", handleData);

      child.on("error", (err) => {
        const str = `\r\n\x1b[31m[Terminal Process Error: ${err.message}]\x1b[0m\r\n`;
        session.buffer.push(str);
        this.emitServerMessage({
          type: "terminal.data",
          id,
          sessionId: spec.sessionId,
          data: str,
        });
      });

      child.on("close", (code, signal) => {
        session.status = "exited";
        session.exitCode = code ?? (signal ? 1 : 0);
        session.signal = signal ? String(signal) : null;
        const msg: TerminalExitMessage = {
          type: "terminal.exit",
          id,
          sessionId: spec.sessionId,
          exitCode: session.exitCode,
          signal: session.signal ?? undefined,
        };
        this.emitServerMessage(msg);
      });
    }

    const createdMsg: TerminalCreatedMessage = {
      type: "terminal.created",
      id,
      sessionId: spec.sessionId,
      title,
      pid: session.pid || 1,
      cols,
      rows,
    };
    this.emitServerMessage(createdMsg);

    return session.getInfo();
  }

  /**
   * Write keystroke or raw input data to a terminal's stdin stream.
   */
  writeInput(id: string, data: string, ownerId?: PtySessionOwner): boolean {
    const session = this.getOwnedSession(id, ownerId);
    if (!session) return false;
    return session.write(data);
  }

  /**
   * Resize terminal viewport dimensions.
   */
  resize(id: string, cols: number, rows: number, ownerId?: PtySessionOwner): boolean {
    const session = this.getOwnedSession(id, ownerId);
    if (!session) return false;
    return session.resize(cols, rows);
  }

  /**
   * Terminate a terminal process and its whole process tree.
   */
  async kill(id: string, signal?: string, ownerId?: PtySessionOwner): Promise<boolean> {
    const session = this.getOwnedSession(id, ownerId);
    if (!session) return false;
    await session.kill(signal);
    return true;
  }

  /**
   * Retrieve retained scrollback buffer for a session.
   */
  getScrollback(id: string, ownerId?: PtySessionOwner): string | undefined {
    return this.getOwnedSession(id, ownerId)?.buffer.toString();
  }

  /**
   * Get metadata info for an active or exited session.
   */
  getSession(id: string, ownerId?: PtySessionOwner): PtySessionInfo | undefined {
    return this.getOwnedSession(id, ownerId)?.getInfo();
  }

  /** List terminal sessions owned by one owner (or legacy unowned sessions). */
  listSessions(ownerId?: PtySessionOwner): PtySessionInfo[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.ownerId === ownerId)
      .map((session) => session.getInfo());
  }

  /**
   * Remove and terminate a specific session.
   */
  async closeSession(id: string, ownerId?: PtySessionOwner): Promise<void> {
    const session = this.getOwnedSession(id, ownerId);
    if (session) {
      await session.kill();
      this.sessions.delete(id);
    }
  }

  /**
   * Close only sessions created by one owner without disposing the shared manager.
   * A host session's disconnect handler can call this safely while terminals from
   * other authenticated sessions remain active.
   */
  async closeSessionsForOwner(ownerId: PtySessionOwner): Promise<number> {
    if (ownerId.length === 0 || ownerId.length > 256) {
      throw new TypeError("terminal owner must be a non-empty opaque identifier up to 256 characters");
    }
    const ownedIds = Array.from(this.sessions.values())
      .filter((session) => session.ownerId === ownerId)
      .map((session) => session.id);
    for (const id of ownedIds) {
      await this.closeSession(id, ownerId);
    }
    return ownedIds.length;
  }

  private getOwnedSession(
    id: string,
    ownerId?: PtySessionOwner,
  ): InternalPtySession | undefined {
    const session = this.sessions.get(id);
    return session?.ownerId === ownerId ? session : undefined;
  }

  /**
   * Terminate all terminal sessions and release resources.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const session of this.sessions.values()) {
      void session.kill();
    }
    this.sessions.clear();
    this.removeAllListeners();
  }
}
