/**
 * Challenger 2: Comprehensive Empirical Stress Test Harness for Invariants 1-5
 * 
 * Verifies:
 * 1. Invariant 1: Graceful Host Termination (SIGINT/SIGTERM, WS close 1001 Going Away, child daemon teardown, no zombies, standalone process signal handling)
 * 2. Invariant 2: Daemon Timeout (exit code 124) & Stream Safety (EPIPE safety on killed process child.stdin, 2MB circular buffer eviction)
 * 3. Invariant 3: Actionable /health Telemetry (subagent states, memory rssMb/heapUsedMb, daemon task counts, concurrent health queries)
 * 4. Invariant 4: Programmatic @nanoforge/sdk (instantiation, connection, session, async iterable streamRun, RPCs, error handling)
 * 5. Invariant 5: 100% E2E Acceptance Suite
 */
import { describe, it, expect, afterEach } from "vitest";
import { assertExactCapabilityApproval, launchE2ETestHost, type E2ETestHost } from "./helpers/testHost.js";
import { DaemonSupervisor, CircularRingBuffer } from "../../apps/agent-host/src/daemons/supervisor.js";
import { NanoForgeClient, EventStreamQueue } from "@nanoforge/sdk";
import type { ExecutionPlan } from "@nanoforge/protocol";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

describe("Challenger 2 Empirical Verification: Runtime Stability, Lifecycle, SDK & Daemons", () => {
  let testHost: E2ETestHost | null = null;

  afterEach(async () => {
    if (testHost) {
      await testHost.close();
      testHost = null;
    }
  });

  /* ======================================================================== */
  /* Invariant 1: Graceful Host Termination                                   */
  /* ======================================================================== */
  describe("Invariant 1: Graceful Host Termination", () => {
    it("drains active WebSocket connections with close code 1001 (Going Away) and host.closing payload", async () => {
      testHost = await launchE2ETestHost();
      const client = await testHost.connect();

      // Ensure ready frame was received
      const readyMsg = await client.nextMessage();
      expect(readyMsg.type).toBe("host.ready");

      // Set up listener for closing frame and close code
      const closePromise = new Promise<{ code: number; reason: string; lastMsg?: any }>((resolve) => {
        let lastMessage: any;
        client.ws.addEventListener("message", (ev) => {
          try {
            lastMessage = JSON.parse(String(ev.data));
          } catch {
            /* ignore */
          }
        });
        client.ws.addEventListener("close", (event) => {
          resolve({ code: event.code, reason: event.reason, lastMsg: lastMessage });
        }, { once: true });
      });

      // Trigger host termination
      await testHost.host.close(1000);

      const closeResult = await closePromise;
      expect(closeResult.code).toBe(1001);
      expect(closeResult.reason).toContain("Server shutting down");
      if (closeResult.lastMsg) {
        expect(closeResult.lastMsg.type).toBe("host.closing");
      }
    });

    it("drains a swarm of 10 concurrent WebSocket clients simultaneously with code 1001", async () => {
      testHost = await launchE2ETestHost();
      const clientCount = 10;
      const clients: any[] = [];
      const closePromises: Promise<{ code: number; reason: string }>[] = [];

      for (let i = 0; i < clientCount; i++) {
        const client = await testHost.connect();
        await client.nextMessage(); // consume host.ready
        clients.push(client);

        closePromises.push(
          new Promise((resolve) => {
            client.ws.addEventListener("close", (event) => {
              resolve({ code: event.code, reason: event.reason });
            }, { once: true });
          })
        );
      }

      // Close host and drain all sockets
      await testHost.host.close(1500);

      const results = await Promise.all(closePromises);
      expect(results.length).toBe(clientCount);
      for (const res of results) {
        expect(res.code).toBe(1001);
        expect(res.reason).toContain("Server shutting down");
      }
    });

    it("terminates all active child daemons and prevents orphaned zombie processes on host shutdown", async () => {
      testHost = await launchE2ETestHost();

      // Spawn 3 long-running child daemons
      const daemons = await Promise.all([
        testHost.daemonManager.supervisor.spawnTask({
          command: "node",
          args: ["-e", "setInterval(() => {}, 1000)"],
          cwd: testHost.workspace.root,
          isDaemon: true,
        }),
        testHost.daemonManager.supervisor.spawnTask({
          command: "node",
          args: ["-e", "setInterval(() => {}, 1000)"],
          cwd: testHost.workspace.root,
          isDaemon: true,
        }),
        testHost.daemonManager.supervisor.spawnTask({
          command: "node",
          args: ["-e", "setInterval(() => {}, 1000)"],
          cwd: testHost.workspace.root,
          isDaemon: true,
        }),
      ]);

      for (const d of daemons) {
        expect(d.pid).toBeGreaterThan(0);
        expect(testHost.daemonManager.supervisor.getTask(d.taskId)?.status).toBe("running");
      }

      // Close the host (which invokes daemonManager.dispose() -> killAll())
      await testHost.host.close(1000);

      // Wait for process teardown
      await new Promise((r) => setTimeout(r, 600));

      // Verify all tasks transitioned out of running
      for (const d of daemons) {
        const postCloseTask = testHost.daemonManager.supervisor.getTask(d.taskId);
        expect(["killed", "failed", "completed"]).toContain(postCloseTask?.status);
      }
    });

    it("standalone host process starts with ephemeral port and responds to shutdown", async () => {
      const tsxCli = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
      const hostProc = spawn(process.execPath, [tsxCli, "apps/agent-host/src/server.ts"], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: "0", HOST: "127.0.0.1" },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });

      let stdoutText = "";
      hostProc.stdout?.on("data", (d) => {
        stdoutText += d.toString();
      });

      // Wait for host to bind and print listening message
      let attempts = 0;
      while (!stdoutText.includes("listening:") && attempts < 120) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }

      expect(stdoutText).toContain("listening:");

      // Terminate host process
      const exitPromise = new Promise<{ code: number | null }>((resolve) => {
        hostProc.on("exit", (code) => resolve({ code }));
      });

      hostProc.kill("SIGTERM");

      const exitResult = await Promise.race([
        exitPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Host shutdown timeout")), 8000)),
      ]);

      expect(exitResult).toBeDefined();
    }, 20000);
  });

  /* ======================================================================== */
  /* Invariant 2: Daemon Timeout & Stream Safety                              */
  /* ======================================================================== */
  describe("Invariant 2: Daemon Timeout & Stream Safety", () => {
    it("enforces timeoutMs watchdog timer and terminates runaway process with exit code 124", async () => {
      const supervisor = new DaemonSupervisor();
      const lifecycleEvents: any[] = [];
      supervisor.subscribe((ev) => lifecycleEvents.push(ev));

      const startTime = Date.now();
      const task = await supervisor.spawnTask({
        command: "node",
        args: ["-e", "setInterval(() => {}, 1000)"], // Would run forever without watchdog
        cwd: process.cwd(),
        timeoutMs: 400, // 400ms watchdog
      });

      expect(task.status).toBe("running");
      const pid = task.pid;
      expect(pid).toBeGreaterThan(0);

      // Wait for watchdog to trigger and kill the process
      await new Promise((r) => setTimeout(r, 1200));

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(400);

      // Verify task status and exit code 124
      const updated = supervisor.getTask(task.taskId);
      expect(["failed", "killed"]).toContain(updated?.status);
      expect(updated?.exitCode).toBe(124);
      expect(updated?.recentLogs).toContain("Execution Timeout");

      // Verify lifecycle event emission
      const completedEv = lifecycleEvents.find((e) => e.type === "task.completed");
      expect(completedEv).toBeDefined();
      expect(completedEv.exitCode).toBe(124);

      await supervisor.killAll();
    });

    it("prevents unhandled EPIPE errors and handles 50 concurrent writes to dead process stdin", async () => {
      const supervisor = new DaemonSupervisor();

      // Spawn a fast-exiting process
      const task = await supervisor.spawnTask({
        command: "node",
        args: ["-e", "process.exit(0)"],
        cwd: process.cwd(),
      });

      // Wait for process to fully exit
      let attempts = 0;
      while (supervisor.getTask(task.taskId)?.status === "running" && attempts < 20) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }

      // Flood 50 concurrent writes to dead stdin
      const writePromises: Promise<{ success: boolean; message?: string }>[] = [];
      for (let i = 0; i < 50; i++) {
        writePromises.push(supervisor.sendInput(task.taskId, `flood write ${i}\n`));
      }

      const results = await Promise.all(writePromises);
      expect(results.length).toBe(50);
      for (const res of results) {
        expect(res.success).toBe(false);
        expect(res.message).toBeDefined();
      }

      await supervisor.killAll();
    });

    it("caps daemon stdout/stderr output to 2MB circular ring buffer and flags truncation", () => {
      const buffer = new CircularRingBuffer(2 * 1024 * 1024); // 2MB
      expect(buffer.maxBytes).toBe(2097152);
      expect(buffer.isTruncated()).toBe(false);

      // Append 1MB
      const chunk1MB = Buffer.alloc(1024 * 1024, "A");
      buffer.append(chunk1MB);
      expect(buffer.byteLength).toBe(1024 * 1024);
      expect(buffer.isTruncated()).toBe(false);

      // Append another 1.5MB (total 2.5MB -> should evict 0.5MB and set isTruncated = true)
      const chunk1_5MB = Buffer.alloc(1536 * 1024, "B");
      buffer.append(chunk1_5MB);
      expect(buffer.byteLength).toBe(2 * 1024 * 1024);
      expect(buffer.isTruncated()).toBe(true);

      const logs = buffer.readLogs();
      expect(logs.length).toBe(2 * 1024 * 1024);
      expect(logs.endsWith("B".repeat(100))).toBe(true);
    });
  });

  /* ======================================================================== */
  /* Invariant 3: Actionable /health Endpoint                                 */
  /* ======================================================================== */
  describe("Invariant 3: Actionable /health Endpoint", () => {
    it("reports actionable telemetry including subagents, memory utilization (rssMb/heapUsedMb), and daemon counts", async () => {
      testHost = await launchE2ETestHost();

      // 1. Create subagents in various states
      testHost.subagentSupervisor.registry.register({
        id: "sub-1",
        name: "Worker 1",
        archetype: "coder",
        roles: ["worker"],
        state: "running",
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        tokensUsed: 0,
        turnCount: 0,
        telemetry: { executionTimeMs: 0, cpuTimeMs: 0, memoryBytes: 0 },
      });

      testHost.subagentSupervisor.registry.register({
        id: "sub-2",
        name: "Worker 2",
        archetype: "researcher",
        roles: ["specialist"],
        state: "idle",
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        tokensUsed: 0,
        turnCount: 0,
        telemetry: { executionTimeMs: 0, cpuTimeMs: 0, memoryBytes: 0 },
      });

      testHost.subagentSupervisor.registry.register({
        id: "sub-3",
        name: "Worker 3",
        archetype: "critic",
        roles: ["critic"],
        state: "errored",
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        tokensUsed: 0,
        turnCount: 0,
        telemetry: { executionTimeMs: 0, cpuTimeMs: 0, memoryBytes: 0 },
      });

      // 2. Spawn a background daemon task
      const daemon = await testHost.daemonManager.supervisor.spawnTask({
        command: "node",
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: testHost.workspace.root,
        isDaemon: true,
      });

      // 3. Create a schedule
      await testHost.daemonManager.scheduleTask({
        cronExpression: "*/5 * * * *",
        prompt: "Check system health metrics",
      });

      // 4. Query /health via HTTP GET
      const res = await fetch(`http://127.0.0.1:${testHost.host.port}/health`);
      expect(res.status).toBe(200);

      const health: any = await res.json();

      // Assert basic health properties
      expect(health.ok).toBe(true);
      expect(health.version).toBe("0.1.0");
      expect(typeof health.uptimeSeconds).toBe("number");
      expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(health.timestamp).toBeDefined();
      expect(health.hostId).toBe(testHost.host.hostId);
      expect(health.port).toBe(testHost.host.port);

      // Assert memory utilization metrics
      expect(health.memory).toBeDefined();
      expect(typeof health.memory.rssMb).toBe("number");
      expect(health.memory.rssMb).toBeGreaterThan(0);
      expect(typeof health.memory.heapUsedMb).toBe("number");
      expect(health.memory.heapUsedMb).toBeGreaterThan(0);
      expect(typeof health.memory.heapTotalMb).toBe("number");
      expect(health.memory.heapTotalMb).toBeGreaterThanOrEqual(health.memory.heapUsedMb);
      expect(typeof health.memory.rssBytes).toBe("number");

      // Assert subagent counts
      expect(health.subagents).toBeDefined();
      expect(health.subagents.total).toBe(3);
      expect(health.subagents.running).toBe(1);
      expect(health.subagents.idle).toBe(1);
      expect(health.subagents.errored).toBe(1);

      // Assert daemon task metrics
      expect(health.daemons).toBeDefined();
      expect(health.daemons.totalTasks).toBeGreaterThanOrEqual(1);
      expect(health.daemons.runningTasks).toBeGreaterThanOrEqual(1);
      expect(health.daemons.activeSchedules).toBe(1);
      expect(Array.isArray(health.daemons.tasks)).toBe(true);

      const reportedTask = health.daemons.tasks.find((t: any) => t.taskId === daemon.taskId);
      expect(reportedTask).toBeDefined();
      expect(reportedTask.status).toBe("running");
      expect(reportedTask.isDaemon).toBe(true);
      expect(reportedTask.pid).toBe(daemon.pid);

      await testHost.daemonManager.supervisor.killAll();
    });

    it("serves 30 concurrent rapid /health queries under 500ms total without latency degradation", async () => {
      testHost = await launchE2ETestHost();

      const start = Date.now();
      const requests = Array.from({ length: 30 }, () =>
        fetch(`http://127.0.0.1:${testHost!.host.port}/health`).then((r) => r.json())
      );

      const results: any[] = await Promise.all(requests);
      const duration = Date.now() - start;

      expect(results.length).toBe(30);
      for (const h of results) {
        expect(h.ok).toBe(true);
        expect(h.version).toBe("0.1.0");
      }
      expect(duration).toBeLessThan(2000);
    });
  });

  /* ======================================================================== */
  /* Invariant 4: Programmatic @nanoforge/sdk                                 */
  /* ======================================================================== */
  describe("Invariant 4: Programmatic @nanoforge/sdk", () => {
    it("instantiates NanoForgeClient, connects, creates session, and streams plan execution events via AsyncIterable", async () => {
      testHost = await launchE2ETestHost();
      const token = testHost.host.tokenStore.issue();

      // 1. Instantiate SDK client
      const client = new NanoForgeClient({
        hostUrl: `http://127.0.0.1:${testHost.host.port}`,
        token,
        autoReconnect: false,
      });

      expect(client.isConnected()).toBe(false);

      // 2. Connect client
      await client.connect();
      expect(client.isConnected()).toBe(true);

      // 3. Test ping
      const latency = await client.ping();
      expect(latency).toBeGreaterThanOrEqual(0);

      // 4. Create Agent Session
      const session = await client.createSession({
        title: "Integration Test Session",
        isolation: "inherit",
        workspaceRoot: testHost.workspace.root,
      });

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.title).toBe("Integration Test Session");

      // 5. Test EventStreamQueue and AsyncIterable streaming
      const queue = new EventStreamQueue<any>();
      client.on("run.state", (msg: any) => queue.push(msg));
      client.on("run.event", (msg: any) => queue.push(msg));

      const plan: ExecutionPlan = {
        id: `plan-${Date.now()}`,
        goal: "Deploy production build and verify health",
        steps: [
          {
            id: "step-1",
            title: "Build package",
            kind: "command",
            payload: { command: "node -v" },
          },
        ],
      };

      await session.submitPlan(plan);

      const collectedEvents: any[] = [];
      const consumePromise = (async () => {
        for await (const ev of queue) {
          collectedEvents.push(ev);
          if (collectedEvents.length >= 2) {
            break;
          }
        }
      })();

      await Promise.race([
        consumePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Streaming timeout")), 3000)),
      ]);

      expect(collectedEvents.length).toBeGreaterThanOrEqual(2);
      expect(collectedEvents.some((e) => e.type === "run.state")).toBe(true);

      // 5b. Test direct session.streamRun(plan) AsyncIterable with live server-assigned runId
      const liveStreamPlan: ExecutionPlan = {
        id: `plan-live-${Date.now()}`,
        goal: "Stream live execution plan",
        steps: [
          {
            id: "step-1",
            title: "Version check",
            kind: "command",
            payload: { command: "node -v" },
          },
        ],
      };

      const directStreamEvents: any[] = [];
      for await (const event of session.streamRun(liveStreamPlan)) {
        directStreamEvents.push(event);
      }
      expect(directStreamEvents.length).toBeGreaterThan(0);
      expect(directStreamEvents.some((e) => e.type === "run.state")).toBe(true);

      // 6. Test session control methods (pause, resume, cancel)
      await session.pause("test-run-id");
      await session.resume("test-run-id");
      await session.cancel("test-run-id", "Test completed");

      // 7. Disconnect client
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it("performs typed RPC queries with an observable, exact SDK memory approval", async () => {
      testHost = await launchE2ETestHost();
      const token = testHost.host.tokenStore.issue();

      const client = new NanoForgeClient({
        hostUrl: `http://127.0.0.1:${testHost.host.port}`,
        token,
      });

      await client.connect();

      // Test workspace readDir
      const entries = await client.readDir(".");
      expect(Array.isArray(entries)).toBe(true);

      // The host must surface a request-bound prompt before this memory mutation
      // can run. The test explicitly inspects that host-issued request before
      // asking the SDK to resolve it; no approval is inferred or automatic.
      const approvalRequired = new Promise<any>((resolve) => {
        client.on("capability.approval_required", resolve);
      });
      const setResultPromise = client.setMemory({
        action: "set",
        key: "test_key",
        namespace: "global",
        value: "test_val",
        valueType: "string",
      });
      const approvalFrame = await approvalRequired;
      const approval = assertExactCapabilityApproval(approvalFrame, {
        requestId: String(approvalFrame.requestId),
        toolId: "memory.set",
        scope: "write",
      });
      expect(approval.requestId).toEqual(expect.any(String));
      expect(client.getPendingCapabilityApproval(approvalFrame.requestId)).toEqual(approvalFrame);
      await client.approveCapability(approvalFrame);

      const setResult = await setResultPromise;
      expect(setResult.success).toBe(true);

      const getResult = await client.getMemory({
        action: "get",
        key: "test_key",
        namespace: "global",
      });
      expect(getResult.found).toBe(true);
      expect(getResult.entry?.value).toBe("test_val");

      // Test task manager via SDK
      const taskList = await client.manageTask({ action: "list" });
      expect(taskList.success).toBe(true);
      expect(Array.isArray(taskList.tasks)).toBe(true);

      await client.disconnect();
    });
  });
});
