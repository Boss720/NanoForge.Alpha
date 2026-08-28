import { describe, it, expect, afterEach } from "vitest";
import { WebSocket as NativeWebSocket } from "ws";
import { ShutdownCoordinator } from "./lifecycle.js";
import { createHost, CLOSE_UNAUTHORIZED, type HostHandle } from "./server.js";
import { DaemonSupervisor } from "./daemons/supervisor.js";

function agentUrl(host: HostHandle, token?: string, origin?: string): string {
  const t = token ?? host.token;
  return `ws://${host.host}:${host.port}/agent?token=${t}`;
}

function waitForClose(ws: NativeWebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.on("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    );
  });
}

describe("ShutdownCoordinator", () => {
  it("executes handlers in descending priority order", async () => {
    const coordinator = new ShutdownCoordinator();
    const sequence: string[] = [];

    coordinator.register("low-priority", async () => {
      sequence.push("low");
    }, 1);

    coordinator.register("high-priority", async () => {
      sequence.push("high");
    }, 100);

    coordinator.register("medium-priority", async () => {
      sequence.push("medium");
    }, 50);

    await coordinator.shutdown("TEST");
    expect(sequence).toEqual(["high", "medium", "low"]);
    expect(coordinator.shuttingDown).toBe(true);
  });

  it("is idempotent and tolerates errors in individual handlers", async () => {
    const coordinator = new ShutdownCoordinator();
    let callCount = 0;

    coordinator.register("faulty-handler", async () => {
      callCount++;
      throw new Error("handler explosion");
    }, 10);

    coordinator.register("safe-handler", async () => {
      callCount++;
    }, 5);

    await coordinator.shutdown("TEST1");
    expect(callCount).toBe(2);

    // Second shutdown call should be a no-op
    await coordinator.shutdown("TEST2");
    expect(callCount).toBe(2);
  });
});

describe("Host Graceful Termination & WebSocket Draining", () => {
  let host: HostHandle | undefined;

  afterEach(async () => {
    if (host && !host.isClosing) {
      await host.close();
      host = undefined;
    }
  });

  it("drains active WebSocket connections with code 1001 and host.closing frame on close", async () => {
    host = await createHost();
    const ws = new NativeWebSocket(agentUrl(host), {
      headers: { Origin: "http://localhost:3000" },
    });

    const messages: any[] = [];
    ws.on("message", (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {}
    });

    await new Promise<void>((resolve) => {
      ws.on("open", () => resolve());
    });

    // Initiate host close
    const closePromise = waitForClose(ws);
    await host.close(500);

    const { code } = await closePromise;
    expect(code).toBe(1001);
    expect(messages.some((m) => m.type === "host.closing")).toBe(true);
    expect(host.isClosing).toBe(true);
  });

  it("rejects unauthorized WebSocket origins with close code 4401", async () => {
    host = await createHost();
    const ws = new NativeWebSocket(agentUrl(host), {
      headers: {
        Origin: "http://malicious.evil.com",
      },
    });

    const { code, reason } = await waitForClose(ws);
    expect(code).toBe(CLOSE_UNAUTHORIZED);
    expect(reason).toContain("unauthorized origin");
  });

  it("accepts whitelisted origins like nano-gpt.com and loopback", async () => {
    host = await createHost();
    const ws = new NativeWebSocket(agentUrl(host), {
      headers: {
        Origin: "https://nano-gpt.com",
      },
    });

    const opened = await new Promise<boolean>((resolve) => {
      ws.on("open", () => resolve(true));
      ws.on("close", () => resolve(false));
    });

    expect(opened).toBe(true);
    ws.close();
  });

  it("performs 11 connect/disconnect cycles cleanly without EventEmitter listener leaks", async () => {
    host = await createHost();

    for (let i = 0; i < 11; i++) {
      const token = host.tokenStore.issue();
      const ws = new NativeWebSocket(agentUrl(host, token), {
        headers: { Origin: "http://localhost:3000" },
      });

      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
      });

      const closePromise = new Promise<void>((resolve) => {
        ws.on("close", () => resolve());
      });
      ws.close();
      await closePromise;
    }

    // Verify listeners count on host-shared daemon supervisor and scheduler did not grow unbounded
    expect(host.daemonManager.supervisor.listenerCount("task.event" as any)).toBeLessThanOrEqual(5);
    expect(host.daemonManager.scheduler.listenerCount("schedule.event" as any)).toBeLessThanOrEqual(5);
  });
});

describe("Daemon Execution Timeouts & Resource Caps", () => {
  it("enforces execution timeout (timeoutMs) and terminates runaway processes", async () => {
    const supervisor = new DaemonSupervisor();
    const events: any[] = [];
    supervisor.subscribe((ev) => events.push(ev));

    const task = await supervisor.spawnTask({
      command: "node",
      args: ["-e", "setInterval(() => {}, 1000)"], // infinite loop
      cwd: process.cwd(),
      isDaemon: false,
      timeoutMs: 350,
    });

    expect(task.status).toBe("running");

    for (let i = 0; i < 25; i++) {
      const summary = supervisor.getTask(task.taskId);
      if (summary?.status === "failed" || summary?.status === "killed") break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const summary = supervisor.getTask(task.taskId);
    expect(summary?.status).toBe("failed");
    expect(summary?.exitCode).toBe(124);
    expect(summary?.recentLogs).toContain("Execution Timeout");

    await supervisor.killAll();
  });
});
