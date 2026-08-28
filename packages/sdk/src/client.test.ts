import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NanoForgeClient,
  AgentSession,
  ApprovalDeniedError,
  SDK_VERSION,
  AuthenticationError,
  ProtocolError,
  TimeoutError,
  EventStreamQueue,
  TypedEventEmitter,
} from "./index";

class MockWebSocket {
  public url: string;
  public readyState: number = 0; // CONNECTING
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: ((err: any) => void) | null = null;
  public onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  public sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 10);
  }

  public send(data: string) {
    this.sent.push(data);
  }

  public close(code = 1000, reason = "") {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose({ code, reason });
  }

  public simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage({ data: typeof data === "string" ? data : JSON.stringify(data) });
    }
  }

  public simulateClose(code: number, reason = "") {
    this.readyState = 3;
    if (this.onclose) this.onclose({ code, reason });
  }
}

describe("@nanoforge/sdk", () => {
  it("exports current SDK version", () => {
    expect(SDK_VERSION).toBe("0.1.0");
  });

  describe("EventStreamQueue", () => {
    it("pushes and consumes items asynchronously", async () => {
      const queue = new EventStreamQueue<string>();
      queue.push("event-1");
      queue.push("event-2");
      queue.finish();

      const items: string[] = [];
      for await (const item of queue) {
        items.push(item);
      }
      expect(items).toEqual(["event-1", "event-2"]);
    });

    it("handles async wait before push", async () => {
      const queue = new EventStreamQueue<number>();
      setTimeout(() => {
        queue.push(10);
        queue.push(20);
        queue.finish();
      }, 20);

      const items: number[] = [];
      for await (const item of queue) {
        items.push(item);
      }
      expect(items).toEqual([10, 20]);
    });
  });

  describe("TypedEventEmitter", () => {
    it("registers and fires event handlers", () => {
      const emitter = new TypedEventEmitter();
      const handler = vi.fn();
      emitter.on("test", handler);
      emitter.emit("test", { value: 42 });
      expect(handler).toHaveBeenCalledWith({ value: 42 });

      emitter.off("test", handler);
      emitter.emit("test", { value: 43 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("handles once listeners", () => {
      const emitter = new TypedEventEmitter();
      const handler = vi.fn();
      emitter.once("single", handler);
      emitter.emit("single", "first");
      emitter.emit("single", "second");
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith("first");
    });
  });

  describe("NanoForgeClient", () => {
    let client: NanoForgeClient;
    let mockWs: MockWebSocket;

    beforeEach(() => {
      client = new NanoForgeClient({
        hostUrl: "ws://127.0.0.1:4040/agent",
        token: "auth-tok-12345",
        WebSocket: function (url: string) {
          mockWs = new MockWebSocket(url);
          return mockWs;
        },
      });
    });

    afterEach(async () => {
      await client.disconnect();
    });

    it("connects and attaches auth token query parameter", async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);
      expect(mockWs.url).toContain("token=auth-tok-12345");
    });

    it("creates and retrieves agent sessions", async () => {
      const session = await client.createSession({
        title: "Test Session",
        model: "kimi-k2",
      });

      expect(session).toBeInstanceOf(AgentSession);
      expect(session.title).toBe("Test Session");
      expect(session.model).toBe("kimi-k2");
      expect(client.getSession(session.id)).toBe(session);
    });

    it("submits plan and streams execution events via AsyncIterable", async () => {
      await client.connect();

      const plan = {
        id: "plan-123",
        goal: "Refactor auth middleware",
        steps: [{ id: "step-1", title: "Audit existing code" }],
      };

      const streamPromise = (async () => {
        const events: any[] = [];
        for await (const event of client.streamRun(plan)) {
          events.push(event);
        }
        return events;
      })();

      // Wait for submit message to be sent
      await new Promise((r) => setTimeout(r, 20));
      expect(mockWs.sent.length).toBeGreaterThan(0);
      const sentObj = JSON.parse(mockWs.sent[0]);
      expect(sentObj.type).toBe("plan.submit");
      expect(sentObj.plan.id).toBe("plan-123");

      // Simulate events from host
      mockWs.simulateMessage({
        type: "run.state",
        runId: "plan-123",
        state: "running",
        at: new Date().toISOString(),
      });
      mockWs.simulateMessage({
        type: "tool.output",
        runId: "plan-123",
        stream: "stdout",
        chunk: "Analyzing code...",
        truncated: false,
        at: new Date().toISOString(),
      });
      mockWs.simulateMessage({
        type: "run.state",
        runId: "plan-123",
        state: "done",
        at: new Date().toISOString(),
      });

      const events = await streamPromise;
      expect(events.length).toBe(3);
      expect(events[0].state).toBe("running");
      expect(events[1].chunk).toBe("Analyzing code...");
      expect(events[2].state).toBe("done");
    });

    it("routes streaming events when host generates a server-side UUID runId", async () => {
      await client.connect();

      const plan = {
        id: "plan-custom-456",
        goal: "Server runId mapping test",
        steps: [{ id: "step-1", title: "Compile typescript" }],
      };

      const streamPromise = (async () => {
        const events: any[] = [];
        for await (const event of client.streamRun(plan)) {
          events.push(event);
        }
        return events;
      })();

      await new Promise((r) => setTimeout(r, 20));
      const serverRunId = "server-uuid-9999";

      // Simulate initial host state frames keyed by server-generated runId
      mockWs.simulateMessage({
        type: "run.state",
        runId: serverRunId,
        state: "queued",
        at: new Date().toISOString(),
      });
      mockWs.simulateMessage({
        type: "run.state",
        runId: serverRunId,
        state: "running",
        at: new Date().toISOString(),
      });
      mockWs.simulateMessage({
        type: "run.event",
        runId: serverRunId,
        event: "plan.submitted",
        data: { planId: "plan-custom-456" },
        at: new Date().toISOString(),
      });
      mockWs.simulateMessage({
        type: "run.state",
        runId: serverRunId,
        state: "done",
        at: new Date().toISOString(),
      });

      const events = await streamPromise;
      expect(events.length).toBe(4);
      expect(events[0].state).toBe("queued");
      expect(events[0].runId).toBe(serverRunId);
      expect(events[1].state).toBe("running");
      expect(events[2].event).toBe("plan.submitted");
      expect(events[3].state).toBe("done");
    });

    it("sends tool approval and denial frames", async () => {
      await client.connect();

      await client.grantApproval("req-appr-1");
      const lastSent1 = JSON.parse(mockWs.sent[mockWs.sent.length - 1]);
      expect(lastSent1).toEqual({
        type: "approval.grant",
        requestId: "req-appr-1",
      });

      await client.denyApproval("req-appr-2", "User cancelled");
      const lastSent2 = JSON.parse(mockWs.sent[mockWs.sent.length - 1]);
      expect(lastSent2).toEqual({
        type: "approval.deny",
        requestId: "req-appr-2",
        reason: "User cancelled",
      });

      await client.sendToolResponse("req-appr-3", true);
      const lastSent3 = JSON.parse(mockWs.sent[mockWs.sent.length - 1]);
      expect(lastSent3).toEqual({
        type: "tool.response",
        requestId: "req-appr-3",
        approved: true,
      });
    });

    it("surfaces a capability approval without automatically approving a gated mutation", async () => {
      await client.connect();
      const approvalListener = vi.fn();
      client.on("capability_approval_required", approvalListener);

      const writePromise = client.writeFile("note.txt", "after");
      await new Promise((r) => setTimeout(r, 10));
      const writeRequest = JSON.parse(mockWs.sent.at(-1)!);

      mockWs.simulateMessage(capabilityApprovalFor(writeRequest.requestId));

      const [request] = client.getPendingCapabilityApprovals();
      expect(request).toMatchObject({
        requestId: writeRequest.requestId,
        toolId: "workspace.writeFile",
        scope: "write",
      });
      expect(client.getPendingCapabilityApproval(writeRequest.requestId)).toBe(request);
      expect(approvalListener).toHaveBeenCalledWith(request);
      expect(mockWs.sent).toHaveLength(1);

      await client.approveCapability(request, "Reviewed exact write");
      expect(JSON.parse(mockWs.sent.at(-1)!)).toEqual({
        type: "capability.approval",
        requestId: writeRequest.requestId,
        approved: true,
        reason: "Reviewed exact write",
      });
      await expect(client.approveCapability(request)).rejects.toBeInstanceOf(ProtocolError);
      expect(mockWs.sent).toHaveLength(2);

      mockWs.simulateMessage({
        type: "capability.result",
        requestId: writeRequest.requestId,
        ok: true,
        at: new Date().toISOString(),
      });
      expect(client.getPendingCapabilityApproval(writeRequest.requestId)).toBeUndefined();

      mockWs.simulateMessage({
        type: "workspace.writeFile.result",
        requestId: writeRequest.requestId,
        success: true,
      });
      await expect(writePromise).resolves.toBe(true);
    });

    it("refuses altered or denied capability approvals without resolving the mutation", async () => {
      await client.connect();
      const writePromise = client.writeFile("note.txt", "denied");
      await new Promise((r) => setTimeout(r, 10));
      const writeRequest = JSON.parse(mockWs.sent.at(-1)!);

      mockWs.simulateMessage(capabilityApprovalFor(writeRequest.requestId));
      const request = client.getPendingCapabilityApproval(writeRequest.requestId)!;

      await expect(client.approveCapability({ ...request, argumentsDigest: "sha256:altered" }))
        .rejects.toBeInstanceOf(ProtocolError);
      expect(mockWs.sent).toHaveLength(1);

      await client.denyCapability(request, "User rejected this exact mutation");
      expect(JSON.parse(mockWs.sent.at(-1)!)).toEqual({
        type: "capability.approval",
        requestId: writeRequest.requestId,
        approved: false,
        reason: "User rejected this exact mutation",
      });

      mockWs.simulateMessage({
        type: "capability.result",
        requestId: writeRequest.requestId,
        ok: false,
        errorCode: "denied",
        errorMessage: "Capability approval denied",
        at: new Date().toISOString(),
      });
      await expect(writePromise).rejects.toBeInstanceOf(ApprovalDeniedError);
    });

    it("handles workspace readDir and readFile RPC queries", async () => {
      await client.connect();

      const readDirPromise = client.readDir("src");

      // Find requestId from sent frame
      await new Promise((r) => setTimeout(r, 10));
      const sentMsg = JSON.parse(mockWs.sent[mockWs.sent.length - 1]);
      expect(sentMsg.type).toBe("workspace.readDir");

      // Respond with result
      mockWs.simulateMessage({
        type: "workspace.readDir.result",
        requestId: sentMsg.requestId,
        path: "src",
        entries: [{ name: "App.tsx", isDir: false, size: 1024 }],
      });

      const entries = await readDirPromise;
      expect(entries.length).toBe(1);
      expect(entries[0].name).toBe("App.tsx");
    });

    it("emits authentication error on 4401 close code", async () => {
      const errorListener = vi.fn();
      client.on("error", errorListener);

      await client.connect();
      mockWs.simulateClose(4401, "Unauthorized");

      expect(errorListener).toHaveBeenCalled();
      const err = errorListener.mock.calls[0][0];
      expect(err).toBeInstanceOf(AuthenticationError);
    });

    it("emits protocol error on 4400 close code", async () => {
      const errorListener = vi.fn();
      client.on("error", errorListener);

      await client.connect();
      mockWs.simulateClose(4400, "Bad Request");

      expect(errorListener).toHaveBeenCalled();
      const err = errorListener.mock.calls[0][0];
      expect(err).toBeInstanceOf(ProtocolError);
    });
  });
});

function capabilityApprovalFor(requestId: string) {
  return {
    type: "capability.approval_required",
    requestId,
    hostId: "host-test",
    sessionId: "session-test",
    workspaceId: "workspace-test",
    generation: 1,
    runId: "run-test",
    stepId: "step-test",
    toolId: "workspace.writeFile",
    argumentsDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    scope: "write",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    uses: "single",
    reason: "Approval required for workspace.writeFile",
    at: new Date().toISOString(),
  };
}
