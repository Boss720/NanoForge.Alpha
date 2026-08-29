import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CircularRingBuffer, DaemonSupervisor } from "./supervisor.js";

describe("CircularRingBuffer", () => {
  it("appends text and reads complete logs", () => {
    const ring = new CircularRingBuffer(1024);
    ring.append("Hello ");
    ring.append("World\n");

    expect(ring.byteLength).toBe(12);
    expect(ring.isTruncated()).toBe(false);
    expect(ring.readLogs()).toBe("Hello World\n");
  });

  it("truncates oldest bytes when capacity is exceeded", () => {
    const ring = new CircularRingBuffer(10); // 10 bytes max
    ring.append("12345");
    ring.append("67890");
    ring.append("ABCDE"); // Should evict older chunks

    expect(ring.byteLength).toBeLessThanOrEqual(10);
    expect(ring.isTruncated()).toBe(true);
    expect(ring.readLogs()).toBe("67890ABCDE");
  });

  it("handles single chunks larger than max capacity", () => {
    const ring = new CircularRingBuffer(5);
    ring.append("0123456789");

    expect(ring.byteLength).toBe(5);
    expect(ring.isTruncated()).toBe(true);
    expect(ring.readLogs()).toBe("56789");
  });

  it("clears correctly", () => {
    const ring = new CircularRingBuffer(100);
    ring.append("Test");
    ring.clear();

    expect(ring.byteLength).toBe(0);
    expect(ring.readLogs()).toBe("");
  });
});

describe("DaemonSupervisor", () => {
  let supervisor: DaemonSupervisor;

  beforeEach(() => {
    supervisor = new DaemonSupervisor();
  });

  afterEach(async () => {
    await supervisor.killAll();
  });

  it("spawns a short-lived process and captures stdout and completion", async () => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "cmd" : "node";
    const args = isWindows ? ["/c", "echo Hello Daemon"] : ["-e", "console.log('Hello Daemon')"];

    const events: string[] = [];
    supervisor.subscribe((e) => events.push(e.type));

    const task = await supervisor.spawnTask({
      command,
      args,
      cwd: process.cwd(),
      isDaemon: false,
    });

    expect(task.pid).toBeGreaterThan(0);
    expect(task.status).toBe("running");

    // Wait briefly for process to finish
    await new Promise((r) => setTimeout(r, 600));

    const updated = supervisor.getTask(task.taskId);
    expect(updated).toBeDefined();
    expect(updated?.status).toBe("completed");
    expect(updated?.exitCode).toBe(0);
    expect(updated?.recentLogs).toContain("Hello Daemon");

    expect(events).toContain("task.spawned");
    expect(events).toContain("task.output");
    expect(events).toContain("task.completed");
  });

  it("does not inherit arbitrary host secrets, while retaining explicit task variables", async () => {
    const secretName = "NANOFORGE_TEST_HOST_SECRET";
    const previousSecret = process.env[secretName];
    process.env[secretName] = "must-not-reach-child";
    try {
      const task = await supervisor.spawnTask({
        command: "node",
        args: ["-e", "console.log(JSON.stringify({secret: process.env.NANOFORGE_TEST_HOST_SECRET ?? null, safe: process.env.NANOFORGE_EXPLICIT_SAFE}))"],
        cwd: process.cwd(),
        env: { NANOFORGE_EXPLICIT_SAFE: "approved" },
      });

      for (let i = 0; i < 30; i++) {
        if (supervisor.getTask(task.taskId)?.recentLogs?.includes('"safe":"approved"')) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const logs = supervisor.getTask(task.taskId)?.recentLogs ?? "";
      expect(logs).toContain('"safe":"approved"');
      expect(logs).toContain('"secret":null');
      expect(logs).not.toContain("must-not-reach-child");
    } finally {
      if (previousSecret === undefined) delete process.env[secretName];
      else process.env[secretName] = previousSecret;
    }
  });

  it("terminates a running process via killTask", async () => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "cmd" : "node";
    const args = isWindows ? ["/c", "pause"] : ["-e", "setInterval(() => {}, 1000)"];

    const task = await supervisor.spawnTask({
      command,
      args,
      cwd: process.cwd(),
      isDaemon: true,
    });

    expect(task.status).toBe("running");

    const killRes = await supervisor.killTask(task.taskId);
    expect(killRes.success).toBe(true);

    const updated = supervisor.getTask(task.taskId);
    expect(updated?.status).toBe("killed");
  });

  it("supports interactive STDIN communication via sendInput", async () => {
    const isWindows = process.platform === "win32";
    // We run node in interactive eval mode or short script reading stdin
    const command = "node";
    const args = ["-e", "process.stdin.on('data', d => { console.log('ECHO:' + d.toString().trim()); process.exit(0); });"];

    const task = await supervisor.spawnTask({
      command,
      args,
      cwd: process.cwd(),
      isDaemon: false,
    });

    await new Promise((r) => setTimeout(r, 200));

    const sendRes = await supervisor.sendInput(task.taskId, "ping-input");
    expect(sendRes.success).toBe(true);

    for (let i = 0; i < 25; i++) {
      const updated = supervisor.getTask(task.taskId);
      if (updated?.recentLogs?.includes("ECHO:ping-input")) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const updated = supervisor.getTask(task.taskId);
    expect(updated?.recentLogs).toContain("ECHO:ping-input");
  });

  it("lists tasks and filters correctly", async () => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "cmd" : "node";
    const args = isWindows ? ["/c", "echo List Test"] : ["-e", "console.log('List Test')"];

    const t1 = await supervisor.spawnTask({
      command,
      args,
      cwd: process.cwd(),
      isDaemon: false,
      creatorSubagentId: "agent-aaa",
    });

    const t2 = await supervisor.spawnTask({
      command,
      args,
      cwd: process.cwd(),
      isDaemon: true,
      creatorSubagentId: "agent-bbb",
    });

    const all = supervisor.listTasks();
    expect(all.length).toBe(2);

    const daemonsOnly = supervisor.listTasks({ isDaemon: true });
    expect(daemonsOnly.length).toBe(1);
    expect(daemonsOnly[0].taskId).toBe(t2.taskId);

    const creatorFiltered = supervisor.listTasks({ creatorSubagentId: "agent-aaa" });
    expect(creatorFiltered.length).toBe(1);
    expect(creatorFiltered[0].taskId).toBe(t1.taskId);
  });
});
