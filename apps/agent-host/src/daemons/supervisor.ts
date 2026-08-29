/**
 * Background Daemon Task Supervisor.
 *
 * Supervises detached long-running processes (dev servers, builds, watchers) with:
 * - 2MB circular ring buffer per process (stdout & stderr)
 * - Interactive STDIN multiplexing (`send_input`)
 * - Process group management and clean teardown on exit
 * - Lifecycle event dispatching (spawned, output, completed, killed)
 */
import { EventEmitter } from "node:events";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveWithinWorkspace } from "../policy/policy.js";
import {
  RING_BUFFER_DEFAULT_MAX_BYTES,
  TASK_ERROR_CODES,
  type TaskId,
  type TaskStatus,
  type TaskSummary,
  type TaskLifecycleEvent,
  createTaskSummary,
} from "@protocol/tasks";
import type {
  CircularRingBufferInterface,
  SpawnTaskOptions,
  SupervisedTaskRecord,
  TaskEventListener,
} from "./types.js";

export const MAX_CONCURRENT_DAEMONS = 16;

const MINIMAL_CHILD_ENVIRONMENT_KEYS = process.platform === "win32"
  ? ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec", "TEMP", "TMP"]
  : ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"];

/** Build a child environment without forwarding the host's ambient secrets. */
export function buildDaemonEnvironment(overrides: Record<string, string> = {}): Record<string, string> {
  const environment: Record<string, string> = {};
  const hostKeys = Object.keys(process.env);
  for (const requestedKey of MINIMAL_CHILD_ENVIRONMENT_KEYS) {
    const actualKey = process.platform === "win32"
      ? hostKeys.find((key) => key.toLowerCase() === requestedKey.toLowerCase())
      : requestedKey;
    const value = actualKey ? process.env[actualKey] : undefined;
    if (value !== undefined) environment[actualKey ?? requestedKey] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) environment[key] = String(value);
  }
  return environment;
}

const activeDaemonPids = new Set<number>();

if (typeof process !== "undefined" && typeof process.on === "function") {
  process.on("exit", () => {
    for (const pid of activeDaemonPids) {
      try {
        if (process.platform === "win32") {
          execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
        } else {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            process.kill(pid, "SIGKILL");
          }
        }
      } catch {
        /* ignore */
      }
    }
  });
}

/**
 * 2MB Circular Ring Buffer for streaming process outputs without unbounded memory growth.
 */
export class CircularRingBuffer implements CircularRingBufferInterface {
  readonly maxBytes: number;
  private chunks: Buffer[] = [];
  private currentBytes: number = 0;
  private hasTruncated: boolean = false;

  constructor(maxBytes: number = RING_BUFFER_DEFAULT_MAX_BYTES) {
    this.maxBytes = Math.max(1, maxBytes);
  }

  get byteLength(): number {
    return this.currentBytes;
  }

  isTruncated(): boolean {
    return this.hasTruncated;
  }

  append(chunk: string | Buffer): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    if (buf.length === 0) return;

    // If a single chunk is bigger than maxBytes, keep only the end
    if (buf.length >= this.maxBytes) {
      this.chunks = [buf.subarray(buf.length - this.maxBytes)];
      this.currentBytes = this.maxBytes;
      this.hasTruncated = true;
      return;
    }

    this.chunks.push(buf);
    this.currentBytes += buf.length;

    // Evict oldest chunks while total exceeds maxBytes
    while (this.currentBytes > this.maxBytes && this.chunks.length > 0) {
      const oldest = this.chunks[0];
      const excess = this.currentBytes - this.maxBytes;

      if (oldest.length <= excess) {
        this.chunks.shift();
        this.currentBytes -= oldest.length;
        this.hasTruncated = true;
      } else {
        // Slice the oldest chunk
        this.chunks[0] = oldest.subarray(excess);
        this.currentBytes -= excess;
        this.hasTruncated = true;
        break;
      }
    }
  }

  readLogs(): string {
    if (this.chunks.length === 0) return "";
    return Buffer.concat(this.chunks).toString("utf8");
  }

  clear(): void {
    this.chunks = [];
    this.currentBytes = 0;
    this.hasTruncated = false;
  }
}

/**
 * Supervised process runner for daemon processes.
 */
export class DaemonSupervisor extends EventEmitter {
  readonly workspaceRoot?: string;
  private readonly tasks = new Map<TaskId, SupervisedTaskRecord>();

  constructor(workspaceRoot?: string) {
    super();
    this.setMaxListeners(100);
    this.workspaceRoot = workspaceRoot ? path.resolve(workspaceRoot) : undefined;
  }

  /**
   * Spawns a new background process or daemon.
   */
  async spawnTask(options: SpawnTaskOptions): Promise<TaskSummary> {
    const runningCount = Array.from(this.tasks.values()).filter((t) => t.status === "running").length;
    if (runningCount >= MAX_CONCURRENT_DAEMONS) {
      throw new Error(`${TASK_ERROR_CODES.ERR_TASK_MAX_LIMIT_EXCEEDED}: Maximum concurrent task limit of ${MAX_CONCURRENT_DAEMONS} reached`);
    }

    const taskId = options.taskId ?? randomUUID();
    const isDaemon = options.isDaemon ?? false;
    const args = options.args ?? [];
    const cwd = this.workspaceRoot
      ? resolveWithinWorkspace(this.workspaceRoot, options.cwd)
      : path.resolve(options.cwd);
    if (!cwd) {
      throw new Error(`${TASK_ERROR_CODES.ERR_TASK_SPAWN_FAILED}: cwd escapes the workspace root`);
    }
    const ringBuffer = new CircularRingBuffer(options.maxBufferBytes ?? RING_BUFFER_DEFAULT_MAX_BYTES);
    const startedAt = new Date().toISOString();
    const startTimeMs = Date.now();

    return new Promise<TaskSummary>((resolve, reject) => {
      let child: ChildProcess;
      try {
        // Use shell: true only on windows when executing npm/cmd or standard executables
        const isWindows = process.platform === "win32";
        const needsShell = isWindows && (options.command.endsWith(".cmd") || options.command.endsWith(".bat") || options.command === "npm" || options.command === "npx");

        child = spawn(options.command, args, {
          cwd,
          env: buildDaemonEnvironment(options.env),
          detached: isDaemon && !isWindows, // detached process group on POSIX
          stdio: ["pipe", "pipe", "pipe"],
          shell: needsShell,
        });
      } catch (err) {
        const summary = createTaskSummary({
          taskId,
          pid: 0,
          command: options.command,
          args,
          cwd,
          isDaemon,
          status: "failed",
          startedAt,
          completedAt: new Date().toISOString(),
          exitCode: 1,
          recentLogs: err instanceof Error ? err.message : String(err),
        });
        return reject(new Error(`${TASK_ERROR_CODES.ERR_TASK_SPAWN_FAILED}: ${err instanceof Error ? err.message : String(err)}`));
      }

      const pid = child.pid ?? 0;
      if (!pid) {
        return reject(new Error(`${TASK_ERROR_CODES.ERR_TASK_SPAWN_FAILED}: Process spawned without a valid PID`));
      }

      activeDaemonPids.add(pid);

      // Prevent EPIPE unhandled error events on child stdin
      child.stdin?.on("error", () => {});

      const record: SupervisedTaskRecord = {
        taskId,
        pid,
        command: options.command,
        args,
        cwd,
        isDaemon,
        creatorSubagentId: options.creatorSubagentId,
        status: "running",
        startedAt,
        childProcess: child,
        ringBuffer,
      };

      if (options.timeoutMs && options.timeoutMs > 0) {
        const timeoutTimer = setTimeout(async () => {
          if (record.status === "running") {
            ringBuffer.append(`\n[Execution Timeout: exceeded ${options.timeoutMs}ms limit. Terminating task.]\n`);
            record.status = "failed";
            record.completedAt = new Date().toISOString();
            record.durationMs = Date.now() - startTimeMs;
            record.exitCode = 124;
            this.emitLifecycleEvent({
              type: "task.completed",
              taskId,
              exitCode: 124,
              durationMs: record.durationMs,
              at: record.completedAt,
            });
            await this.killTask(taskId, "SIGTERM");
          }
        }, options.timeoutMs);
        timeoutTimer.unref();
        record.timeoutTimer = timeoutTimer;
      }

      this.tasks.set(taskId, record);

      // Handle STDOUT
      child.stdout?.on("data", (chunk: Buffer) => {
        ringBuffer.append(chunk);
        const text = chunk.toString("utf8");
        this.emitLifecycleEvent({
          type: "task.output",
          taskId,
          stream: "stdout",
          chunk: text,
          at: new Date().toISOString(),
        });
      });

      // Handle STDERR
      child.stderr?.on("data", (chunk: Buffer) => {
        ringBuffer.append(chunk);
        const text = chunk.toString("utf8");
        this.emitLifecycleEvent({
          type: "task.output",
          taskId,
          stream: "stderr",
          chunk: text,
          at: new Date().toISOString(),
        });
      });

      // Handle ERROR
      child.on("error", (err) => {
        if (record.timeoutTimer) {
          clearTimeout(record.timeoutTimer);
          record.timeoutTimer = undefined;
        }
        activeDaemonPids.delete(pid);

        if (record.status === "running") {
          record.status = "failed";
          record.completedAt = new Date().toISOString();
          record.durationMs = Date.now() - startTimeMs;
          ringBuffer.append(`\nProcess Error: ${err.message}\n`);
          this.emitLifecycleEvent({
            type: "task.completed",
            taskId,
            exitCode: 1,
            durationMs: record.durationMs,
            at: record.completedAt,
          });
        }
      });

      // Handle EXIT
      child.on("close", (code, signal) => {
        if (record.timeoutTimer) {
          clearTimeout(record.timeoutTimer);
          record.timeoutTimer = undefined;
        }
        activeDaemonPids.delete(pid);

        if (record.status === "running") {
          const durationMs = Date.now() - startTimeMs;
          record.completedAt = new Date().toISOString();
          record.exitCode = code;
          record.durationMs = durationMs;
          record.status = code === 0 ? "completed" : "failed";

          this.emitLifecycleEvent({
            type: "task.completed",
            taskId,
            exitCode: code,
            durationMs,
            at: record.completedAt,
          });
        }
      });

      // Emit spawned event
      const summary = this.formatSummary(record);
      this.emitLifecycleEvent({
        type: "task.spawned",
        task: summary,
        at: startedAt,
      });

      resolve(summary);
    });
  }

  /**
   * Writes input data or interactive commands to the task's STDIN.
   */
  async sendInput(taskId: TaskId, input: string): Promise<{ success: boolean; message?: string }> {
    const record = this.tasks.get(taskId);
    if (!record) {
      return { success: false, message: `Task not found: ${taskId}` };
    }

    if (
      record.status !== "running" ||
      !record.childProcess ||
      !record.childProcess.stdin ||
      record.childProcess.stdin.destroyed ||
      record.childProcess.stdin.writableEnded
    ) {
      return {
        success: false,
        message: "Process has already exited or stdin is closed",
      };
    }

    try {
      const formattedInput = input.endsWith("\n") ? input : `${input}\n`;
      const ok = record.childProcess.stdin.write(formattedInput);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Gracefully terminates or kills a running background task.
   */
  async killTask(taskId: TaskId, signal: NodeJS.Signals = "SIGTERM"): Promise<{ success: boolean; message?: string }> {
    const record = this.tasks.get(taskId);
    if (!record) {
      return { success: false, message: `Task not found: ${taskId}` };
    }

    if (record.timeoutTimer) {
      clearTimeout(record.timeoutTimer);
      record.timeoutTimer = undefined;
    }

    if (record.status !== "running" || !record.childProcess) {
      return { success: true, message: `Task ${taskId} is already in state ${record.status}` };
    }

    record.status = "killed";
    record.completedAt = new Date().toISOString();

    const pid = record.pid;
    activeDaemonPids.delete(pid);

    try {
      if (process.platform === "win32") {
        // Use taskkill on Windows to ensure tree termination
        try {
          const { execa } = await import("execa");
          await execa("taskkill", ["/pid", String(pid), "/T", "/F"], { reject: false });
        } catch {
          record.childProcess.kill("SIGKILL");
        }
      } else {
        // On POSIX, try to kill process group if detached
        try {
          process.kill(-pid, signal);
        } catch {
          record.childProcess.kill(signal);
        }
      }

      this.emitLifecycleEvent({
        type: "task.killed",
        taskId,
        signal: String(signal),
        at: new Date().toISOString(),
      });

      return { success: true };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Kills all running tasks, optionally filtered by creator subagent ID.
   */
  async killAll(creatorSubagentId?: string): Promise<void> {
    const promises: Promise<unknown>[] = [];
    for (const [taskId, record] of this.tasks.entries()) {
      if (record.status === "running") {
        if (!creatorSubagentId || record.creatorSubagentId === creatorSubagentId) {
          promises.push(this.killTask(taskId, "SIGKILL"));
        }
      }
    }
    await Promise.allSettled(promises);
  }

  /**
   * Retrieves summary for a task by ID.
   */
  getTask(taskId: TaskId): TaskSummary | undefined {
    const record = this.tasks.get(taskId);
    return record ? this.formatSummary(record) : undefined;
  }

  /**
   * Lists tasks filtered by status or daemon mode.
   */
  listTasks(filter?: {
    isDaemon?: boolean;
    status?: TaskStatus;
    creatorSubagentId?: string;
  }): TaskSummary[] {
    const results: TaskSummary[] = [];
    for (const record of this.tasks.values()) {
      if (filter?.isDaemon !== undefined && record.isDaemon !== filter.isDaemon) continue;
      if (filter?.status !== undefined && record.status !== filter.status) continue;
      if (filter?.creatorSubagentId !== undefined && record.creatorSubagentId !== filter.creatorSubagentId) continue;
      results.push(this.formatSummary(record));
    }
    return results;
  }

  /**
   * Subscribes to wire lifecycle events.
   */
  subscribe(listener: TaskEventListener): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }

  private emitLifecycleEvent(event: TaskLifecycleEvent): void {
    this.emit("event", event);
    this.emit(event.type, event);
  }

  private formatSummary(record: SupervisedTaskRecord): TaskSummary {
    return createTaskSummary({
      taskId: record.taskId,
      pid: record.pid,
      command: record.command,
      args: record.args,
      cwd: record.cwd,
      isDaemon: record.isDaemon,
      status: record.status,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      exitCode: record.exitCode,
      recentLogs: record.ringBuffer.readLogs(),
      truncated: record.ringBuffer.isTruncated(),
    });
  }
}
