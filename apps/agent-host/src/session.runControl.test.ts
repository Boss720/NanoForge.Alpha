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
  close(): void;
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `nanoforge-${label}-`));
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

function nextMessage(ws: WsLike): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.addEventListener(
      "message",
      (event) => resolve(JSON.parse(String(event.data))),
      { once: true },
    );
  });
}

const mockPlan: ExecutionPlan = {
  id: "plan-rc-1",
  goal: "run-control test",
  state: "awaiting_approval",
  steps: [
    {
      id: "step-1",
      title: "Step 1",
      dependsOn: [],
      status: "pending",
    },
  ],
};

describe("Host session run-control wire acknowledgements", () => {
  it("plan.submit resolves immediately with a typed result carrying requestId and runId", async () => {
    const root = await tempWorkspace("plan-submit");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);
    // Initial ready message
    const ready = await nextMessage(ws);
    expect(ready.type).toBe("host.ready");

    const reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: "plan.submit",
        requestId: "req-sub-1",
        plan: mockPlan,
      }),
    );

    const res = await reply;
    expect(res).toMatchObject({
      type: "plan.submit.result",
      requestId: "req-sub-1",
      accepted: true,
      planId: "plan-rc-1",
    });
    expect(typeof res.runId).toBe("string");
    expect(res.at).toBeDefined();

    ws.close();
  });

  it("run.pause, run.resume, and run.cancel emit typed result messages carrying requestId and runId", async () => {
    const root = await tempWorkspace("run-controls");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);
    await nextMessage(ws); // host.ready

    // 1. Submit plan first
    let reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: "plan.submit",
        requestId: "req-sub-2",
        plan: mockPlan,
      }),
    );
    const subRes = await reply;
    expect(subRes.type).toBe("plan.submit.result");
    const runId = subRes.runId as string;

    // 2. Pause run
    reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: "run.pause",
        requestId: "req-pause-1",
        runId,
      }),
    );
    const pauseRes = await reply;
    expect(pauseRes).toMatchObject({
      type: "run.pause.result",
      requestId: "req-pause-1",
      runId,
    });
    expect(pauseRes.at).toBeDefined();

    // 3. Resume run
    reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: "run.resume",
        requestId: "req-resume-1",
        runId,
      }),
    );
    const resumeRes = await reply;
    expect(resumeRes).toMatchObject({
      type: "run.resume.result",
      requestId: "req-resume-1",
      runId,
    });
    expect(resumeRes.at).toBeDefined();

    // 4. Cancel run
    reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: "run.cancel",
        requestId: "req-cancel-1",
        runId,
      }),
    );
    const cancelRes = await reply;
    expect(cancelRes).toMatchObject({
      type: "run.cancel.result",
      requestId: "req-cancel-1",
      runId,
    });
    expect(cancelRes.at).toBeDefined();

    ws.close();
  });

  it("approval.grant and approval.deny emit typed results carrying requestId, runId, stepId", async () => {
    const root = await tempWorkspace("approvals");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);
    await nextMessage(ws); // host.ready

    // Submit plan
    let reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: "plan.submit",
        requestId: "req-sub-3",
        plan: mockPlan,
      }),
    );
    const subRes = await reply;
    const runId = subRes.runId as string;

    // Grant approval frame
    reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: "approval.grant",
        requestId: "req-grant-1",
        runId,
        stepId: "step-1",
      }),
    );
    const grantRes = await reply;
    expect(grantRes).toMatchObject({
      type: "approval.grant.result",
      requestId: "req-grant-1",
      runId,
      stepId: "step-1",
      resolved: false, // no active gate waiting for step-1
    });
    expect(grantRes.at).toBeDefined();

    // Deny approval frame
    reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: "approval.deny",
        requestId: "req-deny-1",
        runId,
        stepId: "step-1",
        reason: "User denied step",
      }),
    );
    const denyRes = await reply;
    expect(denyRes).toMatchObject({
      type: "approval.deny.result",
      requestId: "req-deny-1",
      runId,
      stepId: "step-1",
      resolved: false,
    });
    expect(denyRes.at).toBeDefined();

    ws.close();
  });

  it("unknown run emits host error carrying the exact requestId and runId", async () => {
    const root = await tempWorkspace("unknown-run");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);
    await nextMessage(ws); // host.ready

    // Pause unknown run
    let reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: "run.pause",
        requestId: "req-err-pause",
        runId: "run-unknown-xyz",
      }),
    );
    const pauseErr = await reply;
    expect(pauseErr).toMatchObject({
      type: "error",
      code: "unknown_run",
      requestId: "req-err-pause",
      runId: "run-unknown-xyz",
    });

    // Cancel unknown run
    reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: "run.cancel",
        requestId: "req-err-cancel",
        runId: "run-unknown-xyz",
      }),
    );
    const cancelErr = await reply;
    expect(cancelErr).toMatchObject({
      type: "error",
      code: "unknown_run",
      requestId: "req-err-cancel",
      runId: "run-unknown-xyz",
    });

    ws.close();
  });
});
