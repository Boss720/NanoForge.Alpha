import { describe, expect, it, vi } from "vitest";
import {
  HostAuthError,
  HostClient,
  HostConnectionError,
  type WebSocketLike,
} from "@/lib/hostClient";
import type { ExecutionPlan } from "@/types";

class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  readyState = 0; // CONNECTING
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
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }

  sentFrames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

function makeClient(port = 4711, token = "tok-adv", requestTimeoutMs = 15_000) {
  FakeWebSocket.instances = [];
  const client = new HostClient({
    port,
    token,
    requestTimeoutMs,
    WebSocketImpl: (url) => new FakeWebSocket(url),
  });
  return { client, ws: () => FakeWebSocket.instances[0] };
}

async function connect(client: HostClient): Promise<FakeWebSocket> {
  const p = client.connect();
  const ws = FakeWebSocket.instances[0];
  ws.open();
  await p;
  return ws;
}

const mockPlan: ExecutionPlan = {
  id: "plan-adv-1",
  goal: "stress test",
  state: "awaiting_approval",
  steps: [{ id: "s1", title: "Step 1", dependsOn: [], status: "pending" }],
};

describe("Adversarial Stress: HostClient Run-Control & Acknowledgements", () => {
  it("ADV-CLI-1: socket closure immediately aborts all in-flight run-control promises and clears pending map", async () => {
    const { client } = makeClient();
    const ws = await connect(client);

    // Launch 20 concurrent in-flight requests across different verbs
    const promises: Promise<unknown>[] = [
      client.submitPlan(mockPlan),
      client.pauseRun("run-1"),
      client.resumeRun("run-1"),
      client.cancelRun("run-1"),
      client.grantApproval("run-1", "step-1"),
      client.denyApproval("run-1", "step-2"),
      client.sendToolResponse("req-gate-1", true),
    ];

    for (let i = 0; i < 13; i++) {
      promises.push(client.pauseRun(`run-${i}`));
    }

    expect(ws.sentFrames()).toHaveLength(20);

    // Suddenly socket drops with 1006 abnormal closure
    ws.close(1006, "Connection lost unexpectedly");

    // All 20 promises MUST reject immediately without waiting for 15s timeout
    const results = await Promise.allSettled(promises);
    expect(results).toHaveLength(20);
    for (const res of results) {
      expect(res.status).toBe("rejected");
      if (res.status === "rejected") {
        expect(res.reason).toBeInstanceOf(HostConnectionError);
        expect(res.reason.message).toContain("1006");
      }
    }
  });

  it("ADV-CLI-2: unknown run error response rejects run-control mutation immediately", async () => {
    const { client } = makeClient();
    const ws = await connect(client);

    const pausePromise = client.pauseRun("unknown-run-xyz");
    const sent = ws.sentFrames()[0];

    ws.receive({
      type: "error",
      code: "unknown_run",
      message: "run not found: unknown-run-xyz",
      requestId: sent.requestId,
      runId: "unknown-run-xyz",
    });

    await expect(pausePromise).rejects.toThrow(/unknown_run: run not found: unknown-run-xyz/);
  });

  it("ADV-CLI-3: mismatched requestId does not resolve or corrupt pending mutation promise", async () => {
    const { client } = makeClient();
    const ws = await connect(client);

    const cancelPromise = client.cancelRun("run-mismatch");
    const frame = ws.sentFrames()[0];

    // Host sends response with a DIFFERENT requestId
    ws.receive({
      type: "run.cancel.result",
      requestId: "some-other-req-id",
      runId: "run-mismatch",
      at: new Date().toISOString(),
    });

    // Cancel promise must still be pending
    let isSettled = false;
    cancelPromise.then(() => (isSettled = true), () => (isSettled = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(isSettled).toBe(false);

    // Now send the matching requestId
    ws.receive({
      type: "run.cancel.result",
      requestId: frame.requestId,
      runId: "run-mismatch",
      at: new Date().toISOString(),
    });

    await expect(cancelPromise).resolves.toMatchObject({
      type: "run.cancel.result",
      requestId: frame.requestId,
      runId: "run-mismatch",
    });
  });

  it("ADV-CLI-4: malformed JSON and unrecognized frame types do not crash client or settle pending requests", async () => {
    const { client } = makeClient();
    const ws = await connect(client);

    const submitPromise = client.submitPlan(mockPlan);
    const frame = ws.sentFrames()[0];

    // Feed junk data into socket
    ws.receive("GARBAGE_NON_JSON_DATA{{{");
    ws.receive({ type: "unknown.bogus.type", requestId: frame.requestId });
    ws.receive({ type: "plan.submit.result" }); // missing required fields (no requestId)
    ws.receive(null);
    ws.receive(12345);

    // Submit promise must still be pending
    let isSettled = false;
    submitPromise.then(() => (isSettled = true), () => (isSettled = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(isSettled).toBe(false);

    // Send valid frame
    ws.receive({
      type: "plan.submit.result",
      requestId: frame.requestId,
      runId: "run-valid-1",
      accepted: true,
      planId: mockPlan.id,
      at: new Date().toISOString(),
    });

    await expect(submitPromise).resolves.toMatchObject({
      type: "plan.submit.result",
      runId: "run-valid-1",
    });
  });

  it("ADV-CLI-5: timeout mechanism cleanly rejects unanswered run-control mutation and frees memory", async () => {
    vi.useFakeTimers();
    try {
      const { client } = makeClient(4711, "tok", 5000);
      const ws = await connect(client);

      const pausePromise = client.pauseRun("run-no-reply");
      const frame = ws.sentFrames()[0];
      expect(frame.type).toBe("run.pause");

      // Advance clock past 5000ms timeout
      vi.advanceTimersByTime(5001);

      await expect(pausePromise).rejects.toThrow(/agent host request timed out/);

      // Now late arrival of response should be safely ignored and not throw
      expect(() => {
        ws.receive({
          type: "run.pause.result",
          requestId: frame.requestId,
          runId: "run-no-reply",
          at: new Date().toISOString(),
        });
      }).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ADV-CLI-6: 50 concurrent mixed requests correlate to their exact result types without crosstalk", async () => {
    const { client } = makeClient();
    const ws = await connect(client);

    const reqs: Array<{ type: string; promise: Promise<unknown> }> = [];

    for (let i = 0; i < 10; i++) {
      reqs.push({ type: "plan.submit.result", promise: client.submitPlan(mockPlan) });
      reqs.push({ type: "run.pause.result", promise: client.pauseRun(`run-${i}`) });
      reqs.push({ type: "run.resume.result", promise: client.resumeRun(`run-${i}`) });
      reqs.push({ type: "run.cancel.result", promise: client.cancelRun(`run-${i}`) });
      reqs.push({ type: "approval.grant.result", promise: client.grantApproval(`run-${i}`, `s-${i}`) });
    }

    const sentFrames = ws.sentFrames();
    expect(sentFrames).toHaveLength(50);

    // Reply in reverse order to test out-of-order resolution
    for (let i = sentFrames.length - 1; i >= 0; i--) {
      const f = sentFrames[i];
      const matchingReq = reqs[i];
      ws.receive({
        type: matchingReq.type,
        requestId: f.requestId,
        runId: `run-resolved-${i}`,
        at: new Date().toISOString(),
      });
    }

    const settled = await Promise.all(reqs.map((r) => r.promise));
    expect(settled).toHaveLength(50);
    for (let i = 0; i < 50; i++) {
      expect((settled[i] as any).type).toBe(reqs[i].type);
      expect((settled[i] as any).requestId).toBe(sentFrames[i].requestId);
    }
  });

  it("ADV-CLI-7: closing client explicitly rejects all pending requests", async () => {
    const { client } = makeClient();
    await connect(client);

    const p1 = client.pauseRun("r1");
    const p2 = client.cancelRun("r2");

    client.close();

    await expect(p1).rejects.toThrow(/host client closed/);
    await expect(p2).rejects.toThrow(/host client closed/);
    expect(client.connected).toBe(false);
  });

  it("ADV-CLI-8: token rejection (4401) during in-flight request fails with typed HostAuthError", async () => {
    const { client } = makeClient();
    const ws = await connect(client);

    const submit = client.submitPlan(mockPlan);
    ws.close(4401, "Token expired or already consumed");

    await expect(submit).rejects.toBeInstanceOf(HostAuthError);
    await expect(submit).rejects.toThrow(/4401/);
  });

  it("ADV-CLI-9: invalid plan submission error rejects submitPlan promise with host error details", async () => {
    const { client } = makeClient();
    const ws = await connect(client);

    const submit = client.submitPlan(mockPlan);
    const frame = ws.sentFrames()[0];

    ws.receive({
      type: "error",
      code: "invalid_plan",
      message: "Plan validation failed: dependency cycle detected",
      requestId: frame.requestId,
    });

    await expect(submit).rejects.toThrow(/invalid_plan: Plan validation failed: dependency cycle detected/);
  });
});

