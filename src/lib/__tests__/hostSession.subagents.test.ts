// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { HostClient, type WebSocketLike } from "@/lib/hostClient";
import { useHostSession } from "@/lib/hostSession";
import type { SubagentInfo, SubagentMessage } from "@protocol/subagents";
import type { TaskSummary, ScheduleResult } from "@protocol/tasks";

afterEach(cleanup);

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 1; // OPEN
  sent: string[] = [];
  url: string;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  sentFrames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

function makeClient(port = 4711, token = "tok-abc") {
  FakeWebSocket.instances = [];
  const client = new HostClient({
    port,
    token,
    WebSocketImpl: (url) => new FakeWebSocket(url),
  });
  return { client, ws: () => FakeWebSocket.instances[0] };
}

describe("HostClient subagent & task RPC transport", () => {
  it("invokes invokeSubagent and handles response", async () => {
    const { client, ws } = makeClient();
    const connectPromise = client.connect();
    ws().open();
    await connectPromise;

    const invokePromise = client.invokeSubagent({
      archetype: "implementer",
      name: "worker_1",
      roles: ["dev"],
      skills: [],
      prompt: "Fix tests",
      workspaceIsolation: "inherit",
      allowedToolKinds: ["file.read", "file.edit"],
      timeoutSeconds: 300,
    });

    const sent = ws().sentFrames();
    const invokeFrame = sent.find((f) => f.type === "subagent.invoke") as { type: string; params?: { name?: string }; requestId?: string } | undefined;
    expect(invokeFrame).toBeDefined();
    expect(invokeFrame?.params?.name).toBe("worker_1");

    // Respond from fake server
    ws().receive({
      type: "subagent.invoke.result",
      requestId: invokeFrame?.requestId,
      subagentId: "agent-123",
      name: "worker_1",
      archetype: "implementer",
      state: "running",
      workingDirectory: "/nano-forge",
      startedAt: new Date().toISOString(),
    });

    const result = await invokePromise;
    expect(result.subagentId).toBe("agent-123");
    expect(result.state).toBe("running");
  });

  it("manages subagents actions (kill, kill_tree, pause, resume)", async () => {
    const { client, ws } = makeClient();
    const connectPromise = client.connect();
    ws().open();
    await connectPromise;

    const managePromise = client.manageSubagents({
      action: "kill",
      recursive: false,
      subagentId: "agent-123",
    });

    const sent = ws().sentFrames();
    const frame = sent.find((f) => f.type === "subagent.manage");
    expect(frame).toBeDefined();

    ws().receive({
      type: "subagent.manage.result",
      requestId: frame?.requestId,
      success: true,
      action: "kill",
      subagentId: "agent-123",
    });

    const res = await managePromise;
    expect(res.success).toBe(true);
  });

  it("sends inter-agent messages via sendMessage", async () => {
    const { client, ws } = makeClient();
    const connectPromise = client.connect();
    ws().open();
    await connectPromise;

    const sendPromise = client.sendMessage({
      recipientId: "agent-123",
      subject: "Test Subject",
      body: "Hello Agent",
      referencedArtifacts: [],
      priority: "normal",
    });

    const sent = ws().sentFrames();
    const frame = sent.find((f) => f.type === "subagent.sendMessage");
    expect(frame).toBeDefined();

    ws().receive({
      type: "subagent.sendMessage.result",
      requestId: frame?.requestId,
      messageId: "msg-999",
      deliveryTimestamp: new Date().toISOString(),
      recipientStatus: "delivered",
    });

    const res = await sendPromise;
    expect(res.messageId).toBe("msg-999");
  });

  it("manages background daemon tasks via manageTask", async () => {
    const { client, ws } = makeClient();
    const connectPromise = client.connect();
    ws().open();
    await connectPromise;

    const taskPromise = client.manageTask({
      action: "send_input",
      taskId: "task-001",
      input: "npm test\n",
    });

    const sent = ws().sentFrames();
    const frame = sent.find((f) => f.type === "task.manage");
    expect(frame).toBeDefined();

    ws().receive({
      type: "task.manage.result",
      requestId: frame?.requestId,
      success: true,
      taskId: "task-001",
      status: "running",
    });

    const res = await taskPromise;
    expect(res.success).toBe(true);
  });

  it("creates scheduler timers and cron jobs via createSchedule", async () => {
    const { client, ws } = makeClient();
    const connectPromise = client.connect();
    ws().open();
    await connectPromise;

    const schedPromise = client.createSchedule({
      prompt: "Health check",
      durationSeconds: 300,
      timerCondition: "never",
      isDaemon: false,
    });

    const sent = ws().sentFrames();
    const frame = sent.find((f) => f.type === "schedule.create");
    expect(frame).toBeDefined();

    ws().receive({
      type: "schedule.create.result",
      requestId: frame?.requestId,
      scheduleId: "sched-1",
      scheduleType: "one_shot",
      prompt: "Health check",
      status: "active",
      createdAt: new Date().toISOString(),
      targetAt: new Date(Date.now() + 300000).toISOString(),
    });

    const res = await schedPromise;
    expect(res.scheduleId).toBe("sched-1");
  });
});


describe("useHostSession subagents state management", () => {
  it("initializes empty subagents, messages, daemonTasks, and schedules when host is off", () => {
    const { result } = renderHook(() => useHostSession({ settings: { enabled: false } }));

    expect(result.current.subagents).toEqual([]);
    expect(result.current.activeSubagentId).toBeNull();
    expect(result.current.interAgentMessages).toEqual([]);
    expect(result.current.daemonTasks).toEqual([]);
    expect(result.current.schedules).toEqual([]);
  });

  it("handles subagents.snapshot message to populate subagents list", async () => {
    let onEventHandler: ((msg: unknown) => void) | undefined;
    const mockClient = {
      state: "connected" as const,
      onEvent: vi.fn((cb: (msg: unknown) => void) => {
        onEventHandler = cb;
        return () => {};
      }),
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };

    const { result } = renderHook(() =>
      useHostSession({
        settings: { enabled: true, port: 4711, token: "tok-test" },
        createClient: () => mockClient as unknown as HostClient,
      }),
    );

    const initialAgents: SubagentInfo[] = [
      {
        id: "agent-1",
        name: "Worker 1",
        parentId: null,
        archetype: "implementer",
        roles: ["dev"],
        state: "running",
        isolationMode: "inherit",
        startedAt: "2026-08-15T00:00:00Z",
        lastHeartbeat: "2026-08-15T00:01:00Z",
        tokensUsed: 1000,
        turnCount: 1,
        workingDirectory: "/nano-forge",
      },
    ];

    act(() => {
      onEventHandler?.({
        type: "subagents.snapshot",
        snapshot: initialAgents,
      });
    });

    expect(result.current.subagents).toHaveLength(1);
    expect(result.current.subagents[0].id).toBe("agent-1");
  });

  it("updates agent state on subagent.state_changed and subagent.heartbeat events", () => {
    let onEventHandler: ((msg: unknown) => void) | undefined;
    const mockClient = {
      state: "connected" as const,
      onEvent: vi.fn((cb: (msg: unknown) => void) => {
        onEventHandler = cb;
        return () => {};
      }),
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };

    const { result } = renderHook(() =>
      useHostSession({
        settings: { enabled: true, port: 4711, token: "tok-test" },
        createClient: () => mockClient as unknown as HostClient,
      }),
    );

    // Initialize with an agent
    act(() => {
      onEventHandler?.({
        type: "subagent.spawned",
        subagent: {
          id: "agent-2",
          name: "QA Agent",
          parentId: null,
          archetype: "qa",
          roles: ["tester"],
          state: "running",
          isolationMode: "branch",
          startedAt: "2026-08-15T00:00:00Z",
          lastHeartbeat: "2026-08-15T00:00:00Z",
          tokensUsed: 200,
          turnCount: 1,
          workingDirectory: "/nano-forge",
        },
      });
    });

    expect(result.current.subagents).toHaveLength(1);
    expect(result.current.subagents[0].state).toBe("running");

    // Heartbeat
    act(() => {
      onEventHandler?.({
        type: "subagent.heartbeat",
        subagentId: "agent-2",
        lastVisited: "2026-08-15T00:02:00Z",
        progressSummary: "Running test suite",
      });
    });

    expect(result.current.subagents[0].lastHeartbeat).toBe("2026-08-15T00:02:00Z");
    expect(result.current.subagents[0].lastProgressSummary).toBe("Running test suite");

    // State change
    act(() => {
      onEventHandler?.({
        type: "subagent.state_changed",
        subagentId: "agent-2",
        newState: "idle",
      });
    });

    expect(result.current.subagents[0].state).toBe("idle");
  });

  it("records inter-agent messages from subagent.message_sent events", () => {
    let onEventHandler: ((msg: unknown) => void) | undefined;
    const mockClient = {
      state: "connected" as const,
      onEvent: vi.fn((cb: (msg: unknown) => void) => {
        onEventHandler = cb;
        return () => {};
      }),
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };

    const { result } = renderHook(() =>
      useHostSession({
        settings: { enabled: true, port: 4711, token: "tok-test" },
        createClient: () => mockClient as unknown as HostClient,
      }),
    );

    const message: SubagentMessage = {
      messageId: "msg-1",
      senderId: "agent-1",
      senderName: "Worker 1",
      recipientId: "agent-2",
      subject: "Handoff Report",
      body: "## 1. Observation\nTest passed\n## 2. Logic Chain\nFixed bug",
      timestamp: "2026-08-15T00:05:00Z",
      priority: "normal",
      referencedArtifacts: [],
    };

    act(() => {
      onEventHandler?.({
        type: "subagent.message_sent",
        message,
      });
    });

    expect(result.current.interAgentMessages).toHaveLength(1);
    expect(result.current.interAgentMessages[0].subject).toBe("Handoff Report");
  });

  it("handles daemon tasks and scheduler events", () => {
    let onEventHandler: ((msg: unknown) => void) | undefined;
    const mockClient = {
      state: "connected" as const,
      onEvent: vi.fn((cb: (msg: unknown) => void) => {
        onEventHandler = cb;
        return () => {};
      }),
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };

    const { result } = renderHook(() =>
      useHostSession({
        settings: { enabled: true, port: 4711, token: "tok-test" },
        createClient: () => mockClient as unknown as HostClient,
      }),
    );

    // Task spawned
    const task: TaskSummary = {
      taskId: "task-100",
      pid: 4321,
      command: "vite",
      args: ["dev"],
      cwd: "/workspace",
      isDaemon: true,
      status: "running",
      startedAt: "2026-08-15T00:00:00Z",
    };

    act(() => {
      onEventHandler?.({
        type: "task.spawned",
        task,
      });
    });

    expect(result.current.daemonTasks).toHaveLength(1);
    expect(result.current.daemonTasks[0].command).toBe("vite");

    // Task completed
    act(() => {
      onEventHandler?.({
        type: "task.completed",
        taskId: "task-100",
        exitCode: 0,
        at: "2026-08-15T00:10:00Z",
      });
    });

    expect(result.current.daemonTasks[0].status).toBe("completed");
    expect(result.current.daemonTasks[0].exitCode).toBe(0);

    // Schedule snapshot
    const schedule: ScheduleResult = {
      scheduleId: "sched-50",
      type: "cron",
      prompt: "Periodic backup",
      status: "active",
      isDaemon: true,
      nextRunAt: "2026-08-15T00:05:00Z",
    };

    act(() => {
      onEventHandler?.({
        type: "schedules.snapshot",
        snapshot: [schedule],
      });
    });

    expect(result.current.schedules).toHaveLength(1);
    expect(result.current.schedules[0].scheduleId).toBe("sched-50");
  });
});
