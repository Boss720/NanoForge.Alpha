import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createHost, type HostHandle } from "./server.js";

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

interface MessageInbox {
  next(): Promise<Record<string, unknown>>;
}

function createMessageInbox(ws: WsLike): MessageInbox {
  const received: Record<string, unknown>[] = [];
  const waiters: ((message: Record<string, unknown>) => void)[] = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else received.push(message);
  });
  return {
    next: () => {
      const message = received.shift();
      return message ? Promise.resolve(message) : new Promise((resolve) => waiters.push(resolve));
    },
  };
}

async function approveExactRequest(
  ws: WsLike,
  inbox: MessageInbox,
  requestId: string,
): Promise<void> {
  expect(await inbox.next()).toMatchObject({
    type: "capability.approval_required",
    requestId,
    scope: "write",
    uses: "single",
  });
  const result = inbox.next();
  ws.send(JSON.stringify({ type: "capability.approval", requestId, approved: true }));
  expect(await result).toMatchObject({
    type: "capability.result",
    requestId,
    ok: true,
    grant: { scope: "write", uses: "single" },
  });
}

describe("Host session reviewed local writes safety & opt-in", () => {
  it("rejects writes with write_not_approved when allowWorkspaceWrites is false (default)", async () => {
    const root = await tempWorkspace("writes-disabled");
    await fs.writeFile(path.join(root, "test.txt"), "original content", "utf8");

    host = await createHost({
      allowNonBrowserClients: true,
      session: { workspaceRoot: root, allowWorkspaceWrites: false },
    });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);
    const ready = await nextMessage(ws);
    expect(ready.type).toBe("host.ready");

    const reply = nextMessage(ws);
    ws.send(
      JSON.stringify({
        type: "workspace.writeFile",
        requestId: "write-1",
        path: "test.txt",
        content: "modified content",
        generation: 1,
      }),
    );

    const res = await reply;
    expect(res).toMatchObject({
      type: "workspace.error",
      requestId: "write-1",
      code: "write_not_approved",
    });

    // Verify disk content unchanged
    expect(await fs.readFile(path.join(root, "test.txt"), "utf8")).toBe("original content");
  });

  it("succeeds when allowWorkspaceWrites is true and matching expectedSha256 is supplied", async () => {
    const root = await tempWorkspace("writes-enabled-matching");
    const initialContent = "hello world";
    const initialHash = crypto.createHash("sha256").update(initialContent).digest("hex");
    await fs.writeFile(path.join(root, "hello.txt"), initialContent, "utf8");

    host = await createHost({
      allowNonBrowserClients: true,
      session: { workspaceRoot: root, allowWorkspaceWrites: true },
    });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    const inbox = createMessageInbox(ws);
    await waitForOpen(ws);
    await inbox.next(); // host.ready

    const updatedContent = "hello world updated";
    ws.send(
      JSON.stringify({
        type: "workspace.writeFile",
        requestId: "write-2",
        path: "hello.txt",
        content: updatedContent,
        expectedSha256: initialHash,
        generation: 1,
      }),
    );

    await approveExactRequest(ws, inbox, "write-2");
    const res = await inbox.next();
    expect(res).toMatchObject({
      type: "workspace.writeFile.result",
      requestId: "write-2",
      path: "hello.txt",
      success: true,
      sha256: crypto.createHash("sha256").update(updatedContent).digest("hex"),
      size: Buffer.byteLength(updatedContent),
    });

    // Verify disk content updated
    expect(await fs.readFile(path.join(root, "hello.txt"), "utf8")).toBe(updatedContent);
  });

  it("rejects write with write_conflict when expectedSha256 does not match current file content", async () => {
    const root = await tempWorkspace("writes-conflict");
    const currentContent = "concurrently modified content";
    await fs.writeFile(path.join(root, "shared.txt"), currentContent, "utf8");

    host = await createHost({
      allowNonBrowserClients: true,
      session: { workspaceRoot: root, allowWorkspaceWrites: true },
    });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    const inbox = createMessageInbox(ws);
    await waitForOpen(ws);
    await inbox.next(); // host.ready

    const staleHash = crypto.createHash("sha256").update("stale content from review").digest("hex");

    ws.send(
      JSON.stringify({
        type: "workspace.writeFile",
        requestId: "write-conflict-1",
        path: "shared.txt",
        content: "patch applied content",
        expectedSha256: staleHash,
        generation: 1,
      }),
    );

    await approveExactRequest(ws, inbox, "write-conflict-1");
    const res = await inbox.next();
    expect(res).toMatchObject({
      type: "workspace.error",
      requestId: "write-conflict-1",
      code: "write_conflict",
    });

    // Ensure disk file was NOT overwritten
    expect(await fs.readFile(path.join(root, "shared.txt"), "utf8")).toBe(currentContent);
  });

  it("creates a new file atomically when expectedSha256 is undefined and file does not exist", async () => {
    const root = await tempWorkspace("writes-new-file");

    host = await createHost({
      allowNonBrowserClients: true,
      session: { workspaceRoot: root, allowWorkspaceWrites: true },
    });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    const inbox = createMessageInbox(ws);
    await waitForOpen(ws);
    await inbox.next(); // host.ready

    const newContent = "brand new file content";
    ws.send(
      JSON.stringify({
        type: "workspace.writeFile",
        requestId: "write-new-1",
        path: "nested/dir/newFile.ts",
        content: newContent,
        generation: 1,
      }),
    );

    await approveExactRequest(ws, inbox, "write-new-1");
    const res = await inbox.next();
    expect(res).toMatchObject({
      type: "workspace.writeFile.result",
      requestId: "write-new-1",
      path: "nested/dir/newFile.ts",
      success: true,
      sha256: crypto.createHash("sha256").update(newContent).digest("hex"),
      size: Buffer.byteLength(newContent),
    });

    expect(await fs.readFile(path.join(root, "nested/dir/newFile.ts"), "utf8")).toBe(newContent);
  });
});
