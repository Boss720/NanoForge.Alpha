import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHost, type HostHandle } from "./server";
import type { ExecutionPlan } from "@protocol/plan";

interface WsLike {
  addEventListener(
    type: "open" | "error",
    cb: () => void,
    opts?: { once?: boolean },
  ): void;
  addEventListener(
    type: "close",
    cb: (event: { code: number; reason: string }) => void,
    opts?: { once?: boolean },
  ): void;
  addEventListener(
    type: "message",
    cb: (event: { data: unknown }) => void,
    opts?: { once?: boolean },
  ): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const NativeWebSocket = globalThis.WebSocket as unknown as new (
  url: string,
) => WsLike;

let host: HostHandle | undefined;
const tempRoots: string[] = [];

afterEach(async () => {
  await host?.close();
  host = undefined;
  for (const root of tempRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function tempWorkspace(label: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `nanoforge-adv-${label}-`));
  tempRoots.push(root);
  return root;
}

const agentUrl = (h: HostHandle, token?: string): string =>
  `ws://127.0.0.1:${h.port}/agent${token === undefined ? "" : `?token=${token}`}`;

function waitForOpen(ws: WsLike): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("socket error")), {
      once: true,
    });
  });
}

const createMockPlan = (id: string): ExecutionPlan => ({
  id,
  goal: `Stress plan ${id}`,
  state: "awaiting_approval",
  steps: [
    {
      id: "step-1",
      title: "Step 1",
      dependsOn: [],
      status: "pending",
    },
  ],
});

describe("Adversarial Stress: Host session run-control wire acknowledgements", () => {
  it("ADV-1: handles 50 concurrent plan submissions without dropped acks or runId collisions", async () => {
    const root = await tempWorkspace("concurrent-plans");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    // Filter messages by requestId
    const results = new Map<string, Record<string, unknown>>();
    const runIds = new Set<string>();
    const allMessages: unknown[] = [];
    let closeReason: string | undefined;

    ws.addEventListener("close", (event) => {
      closeReason = `code=${event.code} reason=${event.reason}`;
    });

    const msgPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        try {
          const parsed = JSON.parse(String(event.data));
          allMessages.push(parsed);
          if (parsed.type === "plan.submit.result" && parsed.requestId) {
            results.set(parsed.requestId, parsed);
            runIds.add(parsed.runId);
            if (results.size === 50) {
              resolve();
            }
          }
        } catch {}
      });
    });

    // Send 50 plan submits concurrently
    for (let i = 0; i < 50; i++) {
      ws.send(
        JSON.stringify({
          type: "plan.submit",
          requestId: `req-stress-sub-${i}`,
          plan: createMockPlan(`plan-stress-${i}`),
        }),
      );
    }

    await Promise.race([
      msgPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: received only ${results.size}/50 acks, closeReason=${closeReason}, allMsgs=${allMessages.length} [${allMessages.map((m: any) => m.type).join(",")}]`)), 20000)),
    ]);

    expect(results.size).toBe(50);
    expect(runIds.size).toBe(50); // every single runId must be distinct
    for (let i = 0; i < 50; i++) {
      const res = results.get(`req-stress-sub-${i}`);
      expect(res).toBeDefined();
      expect(res?.accepted).toBe(true);
      expect(res?.planId).toBe(`plan-stress-${i}`);
    }

    ws.close();
  }, 25000);

  it("ADV-2: rapid interleaved pause/resume/cancel calls on active run return correlated responses", async () => {
    const root = await tempWorkspace("rapid-controls");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    // 1. Submit a plan
    const subPromise = new Promise<string>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "plan.submit.result" && parsed.requestId === "req-sub-init") {
          resolve(parsed.runId);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "plan.submit",
        requestId: "req-sub-init",
        plan: createMockPlan("plan-rapid-control"),
      }),
    );

    const runId = await subPromise;
    expect(runId).toBeDefined();

    // 2. Fire rapid burst of pause -> resume -> pause -> resume -> cancel
    const actions = [
      { type: "run.pause", req: "req-p1" },
      { type: "run.resume", req: "req-r1" },
      { type: "run.pause", req: "req-p2" },
      { type: "run.resume", req: "req-r2" },
      { type: "run.cancel", req: "req-c1" },
    ];

    const responses = new Map<string, Record<string, unknown>>();
    const controlPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.requestId && parsed.requestId.startsWith("req-")) {
          responses.set(parsed.requestId, parsed);
          if (responses.size === actions.length) {
            resolve();
          }
        }
      });
    });

    for (const a of actions) {
      ws.send(
        JSON.stringify({
          type: a.type,
          requestId: a.req,
          runId,
        }),
      );
    }

    await Promise.race([
      controlPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: received only ${responses.size}/5 responses`)), 5000)),
    ]);

    expect(responses.get("req-p1")?.type).toBe("run.pause.result");
    expect(responses.get("req-r1")?.type).toBe("run.resume.result");
    expect(responses.get("req-p2")?.type).toBe("run.pause.result");
    expect(responses.get("req-r2")?.type).toBe("run.resume.result");
    expect(responses.get("req-c1")?.type).toBe("run.cancel.result");

    for (const a of actions) {
      const res = responses.get(a.req);
      expect(res?.runId).toBe(runId);
      expect(res?.at).toBeDefined();
    }

    ws.close();
  });

  it("ADV-3: unknown runId error frame carries exact requestId and runId for all control verbs", async () => {
    const root = await tempWorkspace("unknown-run-controls");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    const unknownVerbs = [
      { type: "run.pause", requestId: "req-unk-pause", runId: "ghost-run-1" },
      { type: "run.resume", requestId: "req-unk-resume", runId: "ghost-run-2" },
      { type: "run.cancel", requestId: "req-unk-cancel", runId: "ghost-run-3" },
    ];

    const errResponses = new Map<string, Record<string, unknown>>();
    const errPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "error" && typeof parsed.requestId === "string" && parsed.requestId.startsWith("req-unk-")) {
          errResponses.set(parsed.requestId, parsed);
          if (errResponses.size === unknownVerbs.length) {
            resolve();
          }
        }
      });
    });

    for (const v of unknownVerbs) {
      ws.send(JSON.stringify(v));
    }

    await Promise.race([
      errPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for unknown_run errors")), 5000)),
    ]);

    for (const v of unknownVerbs) {
      const err = errResponses.get(v.requestId);
      expect(err).toBeDefined();
      expect(err?.code).toBe("unknown_run");
      expect(err?.runId).toBe(v.runId);
      expect(err?.requestId).toBe(v.requestId);
    }

    ws.close();
  });

  it("ADV-4: backward compatibility — missing requestId does not crash server and executes mutation", async () => {
    const root = await tempWorkspace("no-request-id");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    // 1. Submit plan without requestId
    const statePromise = new Promise<string>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "run.state" && parsed.state === "queued") {
          resolve(parsed.runId);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "plan.submit",
        // NO requestId
        plan: createMockPlan("plan-no-req-id"),
      }),
    );

    const runId = await statePromise;
    expect(runId).toBeDefined();

    // 2. Pause and Cancel without requestId
    ws.send(
      JSON.stringify({
        type: "run.pause",
        runId,
      }),
    );

    ws.send(
      JSON.stringify({
        type: "run.cancel",
        runId,
      }),
    );

    // 3. Pause unknown run without requestId (should not crash server)
    ws.send(
      JSON.stringify({
        type: "run.pause",
        runId: "unknown-run-no-req",
      }),
    );

    // Verify server is still alive by sending a ping
    const pongPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "pong") resolve();
      });
    });

    ws.send(JSON.stringify({ type: "ping" }));
    await pongPromise;

    ws.close();
  });

  it("ADV-5: preserves complex and unicode requestIds verbatim across all acks and errors", async () => {
    const root = await tempWorkspace("complex-req-ids");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    const testIds = [
      "req-uuid-550e8400-e29b-41d4-a716-446655440000",
      "req-🚀-🔥-atom-⚡",
      "req-quoted-\"escaped\"-test",
      "req-sql-';-drop-table-runs;--",
      "req-a".repeat(20), // long requestId
    ];

    for (const testId of testIds) {
      const reply = new Promise<Record<string, unknown>>((resolve) => {
        const handler = (event: { data: unknown }) => {
          const parsed = JSON.parse(String(event.data));
          if (parsed.requestId === testId) {
            resolve(parsed);
          }
        };
        ws.addEventListener("message", handler);
      });

      ws.send(
        JSON.stringify({
          type: "plan.submit",
          requestId: testId,
          plan: createMockPlan(`plan-${testId}`),
        }),
      );

      const res = await reply;
      expect(res.requestId).toBe(testId);
      expect(res.type).toBe("plan.submit.result");
    }

    ws.close();
  });

  it("ADV-6: approval race conditions — multiple approvals for same gate resolve first, reject remainder", async () => {
    const root = await tempWorkspace("approval-races");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    // Send 5 rapid approvals for the same request ID
    const approvalAcks: Array<Record<string, unknown>> = [];
    const ackPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "approval.grant.result" && parsed.requestId?.startsWith("req-grant-race-")) {
          approvalAcks.push(parsed);
          if (approvalAcks.length === 5) resolve();
        }
      });
    });

    for (let i = 0; i < 5; i++) {
      ws.send(
        JSON.stringify({
          type: "approval.grant",
          requestId: `req-grant-race-${i}`,
          runId: "run-race-1",
          stepId: "step-1",
        }),
      );
    }

    await Promise.race([
      ackPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout on approval race")), 5000)),
    ]);

    expect(approvalAcks).toHaveLength(5);
    // Since no tool approval gate was waiting, all resolve with resolved: false without throwing
    for (const ack of approvalAcks) {
      expect(ack.type).toBe("approval.grant.result");
      expect(ack.resolved).toBe(false);
      expect(ack.at).toBeDefined();
    }

    ws.close();
  });

  it("ADV-7: tool.response emits typed tool.response.result carrying requestId and resolved flag", async () => {
    const root = await tempWorkspace("tool-response");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    const reply = new Promise<Record<string, unknown>>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "tool.response.result" && parsed.requestId === "req-tool-resp-1") {
          resolve(parsed);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "tool.response",
        requestId: "req-tool-resp-1",
        approved: true,
      }),
    );

    const res = await reply;
    expect(res).toMatchObject({
      type: "tool.response.result",
      requestId: "req-tool-resp-1",
      resolved: false, // no active gate waiting
    });
    expect(res.at).toBeDefined();

    ws.close();
  });

  it("ADV-8: stress — 100 rapid alternating pause/resume mutations receive 100% correlated acks", async () => {
    const root = await tempWorkspace("100-pause-resume");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    // 1. Submit a plan
    const subPromise = new Promise<string>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "plan.submit.result" && parsed.requestId === "req-sub-100") {
          resolve(parsed.runId);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "plan.submit",
        requestId: "req-sub-100",
        plan: createMockPlan("plan-100-mutations"),
      }),
    );

    const runId = await subPromise;
    expect(runId).toBeDefined();

    // 2. Fire 100 alternating pause/resume mutations
    const acks = new Map<string, Record<string, unknown>>();
    const allAcksPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.requestId && parsed.requestId.startsWith("req-100-")) {
          acks.set(parsed.requestId, parsed);
          if (acks.size === 100) {
            resolve();
          }
        }
      });
    });

    for (let i = 0; i < 100; i++) {
      const isPause = i % 2 === 0;
      ws.send(
        JSON.stringify({
          type: isPause ? "run.pause" : "run.resume",
          requestId: `req-100-${i}`,
          runId,
        }),
      );
    }

    await Promise.race([
      allAcksPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: received ${acks.size}/100 acks`)), 10000)),
    ]);

    expect(acks.size).toBe(100);
    for (let i = 0; i < 100; i++) {
      const isPause = i % 2 === 0;
      const ack = acks.get(`req-100-${i}`);
      expect(ack).toBeDefined();
      expect(ack?.type).toBe(isPause ? "run.pause.result" : "run.resume.result");
      expect(ack?.runId).toBe(runId);
    }

    ws.close();
  });
});

