/**
 * Supervised terminal runner — Module 2, Task 6.
 *
 * Executes a {@link TerminalJobSpec} with execa under a hard supervision
 * contract (the caller must have already obtained a policy decision):
 * - `shell: false`, structured `executable + args[]` only;
 * - cwd is resolved inside `workspaceRoot`; `..` escapes throw
 *   {@link RunnerSpecError} before anything spawns;
 * - the child environment is a whitelist (PATH/SystemRoot & friends) plus
 *   explicit additions — everything sensitive is stripped;
 * - stdout/stderr stream as events and are retained in a capped ring buffer
 *   (default 1 MiB, tail kept, `truncated` flag set);
 * - a timeout kills the whole process tree, as does `cancel()`.
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { execa, type ResultPromise } from "execa";
import { resolveWithinWorkspace } from "../policy/policy";
import {
  RunnerSpecError,
  type RunnerOptions,
  type TerminalEvent,
  type TerminalJobHandle,
  type TerminalJobResult,
  type TerminalJobSpec,
} from "./types";

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Inherited-environment whitelist. Everything else from `process.env` is
 * stripped (API keys, tokens, user secrets). Explicit additions via
 * `RunnerOptions.env` / `TerminalJobSpec.env` are merged on top.
 */
export const DEFAULT_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "Path",
  "path",
  "PATHEXT",
  "COMSPEC",
  "SystemRoot",
  "SYSTEMROOT",
  "SystemDrive",
  "SYSTEMDRIVE",
  "windir",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "OS",
  "NUMBER_OF_PROCESSORS",
];

function buildRestrictedEnv(
  allowlist: readonly string[],
  hostEnv?: Record<string, string>,
  jobEnv?: Record<string, string>,
): Record<string, string> {
  const wanted = new Set(
    allowlist.map((name) =>
      process.platform === "win32" ? name.toUpperCase() : name,
    ),
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const normalized = process.platform === "win32" ? key.toUpperCase() : key;
    if (wanted.has(normalized)) env[key] = value;
  }
  Object.assign(env, hostEnv ?? {}, jobEnv ?? {});
  return env;
}

/** Ring buffer retaining at most `max` bytes (the tail) of a stream. */
class OutputCap {
  private chunks: string[] = [];
  private length = 0;
  truncated = false;

  constructor(private readonly max: number) {}

  push(chunk: string): void {
    this.chunks.push(chunk);
    this.length += chunk.length;
    while (this.length > this.max && this.chunks.length > 0) {
      this.truncated = true;
      const overflow = this.length - this.max;
      const first = this.chunks[0];
      if (first.length <= overflow) {
        this.chunks.shift();
        this.length -= first.length;
      } else {
        this.chunks[0] = first.slice(overflow);
        this.length -= overflow;
      }
    }
  }

  get value(): string {
    return this.chunks.join("");
  }
}

type Subprocess = ResultPromise<{
  shell: false;
  buffer: false;
  reject: false;
  extendEnv: false;
}>;

/**
 * Kill the process and, where the platform supports it, its whole tree.
 * Windows: `taskkill /T /F`. POSIX: the child is spawned `detached`, so a
 * negative pid kills the process group.
 */
async function killProcessTree(subprocess: Subprocess): Promise<void> {
  const pid = subprocess.pid;
  if (pid === undefined) {
    try {
      subprocess.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    return;
  }
  if (process.platform === "win32") {
    try {
      await execa("taskkill", ["/pid", String(pid), "/t", "/f"], {
        shell: false,
        reject: false,
        windowsHide: true,
      });
    } catch {
      /* best effort */
    }
    try {
      subprocess.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * Run one supervised terminal job.
 *
 * Throws {@link RunnerSpecError} synchronously (before spawn) when the spec
 * is invalid or the cwd escapes the workspace root. The returned promise
 * resolves for every process outcome, including non-zero exits, timeouts,
 * cancellations, and spawn failures.
 */
export function runTerminalJob(
  spec: TerminalJobSpec,
  options: RunnerOptions,
): TerminalJobHandle {
  const executable = (spec.executable ?? "").trim();
  if (!executable) {
    throw new RunnerSpecError("terminal job requires a non-empty executable");
  }
  const cwd = resolveWithinWorkspace(options.workspaceRoot, spec.cwd);
  if (cwd === null) {
    throw new RunnerSpecError(
      `cwd escapes the workspace root: ${spec.cwd ?? "."}`,
    );
  }

  const id = spec.id ?? randomUUID();
  const args = spec.args ?? [];
  const timeoutMs = spec.timeoutMs ?? options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes =
    spec.maxOutputBytes ?? options.defaultMaxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const env = buildRestrictedEnv(
    options.envAllowlist
      ? [...DEFAULT_ENV_ALLOWLIST, ...options.envAllowlist]
      : DEFAULT_ENV_ALLOWLIST,
    options.env,
    spec.env,
  );

  const events = new EventEmitter();
  events.setMaxListeners(0);
  const emit = (event: TerminalEvent): void => {
    events.emit(event.type, event);
    events.emit("*", event);
  };
  const now = () => new Date().toISOString();

  const stdout = new OutputCap(maxOutputBytes);
  const stderr = new OutputCap(maxOutputBytes);
  const startedAt = Date.now();

  let timedOut = false;
  let cancelled = false;
  let settled = false;

  const subprocess = execa(executable, args, {
    cwd,
    env,
    shell: false,
    buffer: false,
    reject: false,
    extendEnv: false,
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  // Deferred to a microtask so callers can attach listeners on the returned
  // handle before "start" fires.
  queueMicrotask(() => {
    emit({
      type: "start",
      id,
      at: now(),
      pid: subprocess.pid,
      executable,
      args,
      cwd,
    });
  });

  subprocess.stdout?.on("data", (data: Buffer | string) => {
    const chunk = typeof data === "string" ? data : data.toString("utf8");
    stdout.push(chunk);
    emit({ type: "stdout", id, at: now(), chunk });
  });
  subprocess.stderr?.on("data", (data: Buffer | string) => {
    const chunk = typeof data === "string" ? data : data.toString("utf8");
    stderr.push(chunk);
    emit({ type: "stderr", id, at: now(), chunk });
  });

  const timer = setTimeout(() => {
    if (settled) return;
    timedOut = true;
    emit({ type: "timeout", id, at: now(), timeoutMs });
    void killProcessTree(subprocess);
  }, timeoutMs);
  timer.unref?.();

  const promise: Promise<TerminalJobResult> = (async () => {
    let code: number | null = null;
    let signal: string | null = null;
    let errorMessage: string | undefined;

    try {
      const result = await subprocess;
      code = typeof result.exitCode === "number" ? result.exitCode : null;
      signal = typeof result.signal === "string" ? result.signal : null;
      // Spawn-level failure (e.g. ENOENT): no exit code, no signal, and not
      // a termination we initiated.
      if (
        result.failed &&
        result.exitCode === undefined &&
        result.signal === undefined &&
        !timedOut &&
        !cancelled
      ) {
        errorMessage = result.shortMessage ?? "process failed to start";
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      settled = true;
      clearTimeout(timer);
    }

    if (errorMessage !== undefined) {
      emit({ type: "error", id, at: now(), message: errorMessage });
    }
    const durationMs = Date.now() - startedAt;
    const truncated = stdout.truncated || stderr.truncated;
    emit({
      type: "exit",
      id,
      at: now(),
      code,
      signal,
      durationMs,
      timedOut,
      cancelled,
      truncated,
    });

    const result: TerminalJobResult = {
      id,
      code,
      signal,
      timedOut,
      cancelled,
      truncated,
      stdout: stdout.value,
      stderr: stderr.value,
      durationMs,
    };
    if (errorMessage !== undefined) result.errorMessage = errorMessage;
    return result;
  })();

  const cancel = (): void => {
    if (settled || cancelled) return;
    cancelled = true;
    emit({ type: "cancelled", id, at: now() });
    void killProcessTree(subprocess);
  };

  return { id, events, promise, cancel };
}
