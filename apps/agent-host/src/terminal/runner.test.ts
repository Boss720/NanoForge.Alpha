/**
 * Tests for the supervised terminal runner — Module 2, Task 6.
 *
 * Cross-platform deterministic: the executable under test is always `node -e`
 * and the workspace root is the OS temp dir (exists on every platform).
 */
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runTerminalJob } from "./runner";
import { RunnerSpecError, type TerminalEvent } from "./types";

const WORKSPACE = os.tmpdir();
// Absolute path to the node binary: no PATH resolution, no shim interference.
const NODE = process.execPath;

const run = (
  spec: Parameters<typeof runTerminalJob>[0],
  workspaceRoot: string = WORKSPACE,
) => runTerminalJob(spec, { workspaceRoot });

/** Track the full event sequence of a job from the moment it returns. */
function track(handle: ReturnType<typeof runTerminalJob>): TerminalEvent[] {
  const sequence: TerminalEvent[] = [];
  handle.events.on("*", (event: TerminalEvent) => sequence.push(event));
  return sequence;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("runTerminalJob", () => {
  it("streams stdout incrementally before exit", async () => {
    const handle = run({
      executable: NODE,
      args: [
        "-e",
        "let i=0;const t=setInterval(()=>{console.log('line-'+(++i));if(i>=5)clearInterval(t);},60);",
      ],
      timeoutMs: 15_000,
    });
    const events = track(handle);
    let sawExit = false;
    let chunksBeforeExit = 0;
    handle.events.on("exit", () => {
      sawExit = true;
    });
    handle.events.on("stdout", () => {
      if (!sawExit) chunksBeforeExit += 1;
    });

    const result = await handle.promise;
    expect(result.code).toBe(0);
    for (let i = 1; i <= 5; i += 1) {
      expect(result.stdout).toContain(`line-${i}`);
    }
    // Output arrived while the process was still running, in several chunks.
    expect(chunksBeforeExit).toBeGreaterThanOrEqual(2);
    expect(events[0]?.type).toBe("start");
    expect(events.at(-1)?.type).toBe("exit");
  });

  it("captures stderr separately and reports the exit code", async () => {
    const handle = run({
      executable: NODE,
      args: ["-e", "console.error('oops');process.exit(3);"],
      timeoutMs: 10_000,
    });
    const events = track(handle);
    const result = await handle.promise;
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("oops");
    expect(events.some((e) => e.type === "stderr")).toBe(true);
  });

  it("kills the process on timeout and flags it", async () => {
    const handle = run({
      executable: NODE,
      args: ["-e", "setInterval(()=>{},200);"],
      timeoutMs: 500,
    });
    const events = track(handle);
    const result = await handle.promise;
    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(result.durationMs).toBeLessThan(10_000);
    const types = events.map((e) => e.type);
    expect(types).toContain("timeout");
    expect(types.indexOf("timeout")).toBeLessThan(types.lastIndexOf("exit"));
  });

  it("cancel() kills the whole process tree", async () => {
    const handle = run({
      executable: NODE,
      args: [
        "-e",
        "const {spawn}=require('node:child_process');" +
          "const c=spawn(process.execPath,['-e','setInterval(()=>{},100)'],{stdio:'ignore'});" +
          "console.log('grandchild:'+c.pid);setInterval(()=>{},200);",
      ],
      timeoutMs: 30_000,
    });
    const events = track(handle);

    let buffer = "";
    const grandchildPid = await new Promise<number>((resolve) => {
      handle.events.on("stdout", (event: { chunk: string }) => {
        buffer += event.chunk;
        const match = buffer.match(/grandchild:(\d+)/);
        if (match) resolve(Number(match[1]));
      });
    });
    expect(isAlive(grandchildPid)).toBe(true);

    handle.cancel();
    const result = await handle.promise;
    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);

    const types = events.map((e) => e.type);
    expect(types).toContain("cancelled");
    expect(types.indexOf("cancelled")).toBeLessThan(types.lastIndexOf("exit"));

    // The grandchild must be dead too — tree cancellation, not just the root.
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline && isAlive(grandchildPid)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(isAlive(grandchildPid)).toBe(false);
  });

  it("rejects a cwd escaping the workspace before spawning", () => {
    const nestedRoot = path.join(WORKSPACE, "nf-runner-root", "sub");
    expect(() =>
      runTerminalJob(
        { executable: NODE, args: ["-e", "1"], cwd: "../.." },
        { workspaceRoot: nestedRoot },
      ),
    ).toThrow(RunnerSpecError);
    expect(() =>
      runTerminalJob(
        { executable: NODE, args: ["-e", "1"], cwd: path.resolve(nestedRoot, "..", "..") },
        { workspaceRoot: nestedRoot },
      ),
    ).toThrow(/workspace root/);
  });

  it("rejects an empty executable before spawning", () => {
    expect(() => run({ executable: "   " })).toThrow(RunnerSpecError);
  });

  it("caps retained output with a truncation flag (ring keeps the tail)", async () => {
    const handle = run({
      executable: NODE,
      args: [
        "-e",
        "process.stdout.write('x'.repeat(1024*1024)+'TAIL-MARKER');",
      ],
      maxOutputBytes: 4096,
      timeoutMs: 15_000,
    });
    const result = await handle.promise;
    expect(result.code).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(4096);
    expect(result.stdout.endsWith("TAIL-MARKER")).toBe(true);
  });

  it("strips sensitive inherited env but keeps explicit additions", async () => {
    process.env.NF_RUNNER_SECRET = "topsecret";
    try {
      const handle = run({
        executable: NODE,
        args: [
          "-e",
          "console.log('secret='+(process.env.NF_RUNNER_SECRET??'unset'));" +
            "console.log('job='+(process.env.NF_JOB_VAR??'unset'));" +
            "console.log('path='+(typeof (process.env.PATH??process.env.Path)));",
        ],
        env: { NF_JOB_VAR: "hello" },
        timeoutMs: 10_000,
      });
      const result = await handle.promise;
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("secret=unset");
      expect(result.stdout).toContain("job=hello");
      expect(result.stdout).toContain("path=string");
    } finally {
      delete process.env.NF_RUNNER_SECRET;
    }
  });

  it("settles with a failure when the executable does not exist", async () => {
    const handle = run({
      executable: "nanoforge-definitely-not-a-real-binary-xyz",
      args: [],
      timeoutMs: 10_000,
    });
    const events = track(handle);
    const result = await handle.promise;
    // POSIX: execa reports ENOENT with no exit code -> "error" event.
    // Windows: execa routes unresolved commands through cmd.exe, which exits
    // 1 with a "not recognized" stderr message -> no exit code either way.
    expect(result.code).not.toBe(0);
    const reported =
      result.errorMessage ??
      (result.code === null || result.code === undefined ? "no-exit-code" : result.stderr);
    expect(`${reported}`).toMatch(/not recognized|ENOENT|not found|no-exit-code|Failed/i);
    expect(events.at(-1)?.type).toBe("exit");
  });
});
