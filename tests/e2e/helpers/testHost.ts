/**
 * NanoForge E2E Test Helper & Test Host Factory.
 *
 * Provides isolated, opaque-box test infrastructure for launching agent hosts,
 * managing temporary test workspaces, establishing authenticated WebSockets,
 * and verifying protocol wire frames using Node's native WebSocket.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { createHost, type HostHandle } from "../../../apps/agent-host/src/server.js";
import { DaemonManager } from "../../../apps/agent-host/src/daemons/manager.js";
import { SubagentSupervisor } from "../../../apps/agent-host/src/agents/supervisor.js";
import { SharedMemoryEngine } from "../../../apps/agent-host/src/agents/memory.js";

/* Native WebSocket typing */
interface WsCloseEvent {
  code: number;
  reason: string;
}
interface WsMessageEvent {
  data: unknown;
}
export interface WsLike {
  addEventListener(type: "open" | "error", cb: (ev?: any) => void, opts?: { once?: boolean }): void;
  addEventListener(type: "close", cb: (event: WsCloseEvent) => void, opts?: { once?: boolean }): void;
  addEventListener(type: "message", cb: (event: WsMessageEvent) => void, opts?: { once?: boolean }): void;
  send(data: string): void;
  close(): void;
  readyState?: number;
}
const NativeWebSocket = globalThis.WebSocket as unknown as new (url: string) => WsLike;

export interface TestWorkspace {
  root: string;
  cleanup: () => Promise<void>;
}

export async function createTestWorkspace(prefix = "nanoforge-e2e-"): Promise<TestWorkspace> {
  const tmpDir = path.join(os.tmpdir(), `${prefix}${randomUUID().slice(0, 8)}`);
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(path.join(tmpDir, ".nanoforge"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, ".agents"), { recursive: true });

  return {
    root: tmpDir,
    cleanup: async () => {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup errors */
      }
    },
  };
}

export interface E2ETestHost {
  host: HostHandle;
  workspace: TestWorkspace;
  daemonManager: DaemonManager;
  subagentSupervisor: SubagentSupervisor;
  memoryEngine: SharedMemoryEngine;
  url: string;
  token: string;
  close: () => Promise<void>;
  connect: (customToken?: string) => Promise<TestWsClient>;
  connectRaw: (customToken?: string) => { ws: WsLike; waitForOpen: () => Promise<void>; waitForClose: () => Promise<{ code: number; reason: string }> };
}

export interface TestWsClient {
  ws: WsLike;
  messages: Record<string, unknown>[];
  nextMessage: (timeoutMs?: number) => Promise<Record<string, unknown>>;
  findMessage: (predicate: (msg: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
  sendJson: (payload: unknown) => void;
  close: () => Promise<{ code: number; reason: string }>;
}

export type CapabilityScope = "write" | "execute" | "schedule";

export interface ExactCapabilityApproval {
  requestId: string;
  toolId: string;
  scope: CapabilityScope;
}

/**
 * Validate that a capability prompt describes exactly the mutation a test
 * initiated. Tests must never treat host-wide write enablement as approval.
 */
export function assertExactCapabilityApproval(
  message: Record<string, unknown>,
  expected: ExactCapabilityApproval,
): Record<string, unknown> {
  if (message.type !== "capability.approval_required") {
    throw new Error(`Expected capability.approval_required, received ${String(message.type)}`);
  }
  if (message.requestId !== expected.requestId) {
    throw new Error(`Capability approval requestId did not match ${expected.requestId}`);
  }
  if (message.toolId !== expected.toolId) {
    throw new Error(`Capability approval toolId did not match ${expected.toolId}`);
  }
  if (message.scope !== expected.scope) {
    throw new Error(`Capability approval scope did not match ${expected.scope}`);
  }
  if (message.uses !== "single") {
    throw new Error("Capability approval must be single-use");
  }
  if (typeof message.argumentsDigest !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(message.argumentsDigest)) {
    throw new Error("Capability approval must include an exact arguments digest");
  }
  return message;
}

/**
 * Approve one host-issued capability prompt only after checking its immutable
 * request binding. The subsequent capability.result proves the decision was
 * accepted before the test waits for the deferred operation result.
 */
export async function approveExactCapability(
  client: TestWsClient,
  expected: ExactCapabilityApproval,
): Promise<Record<string, unknown>> {
  const approval = assertExactCapabilityApproval(
    await client.findMessage((message) =>
      message.type === "capability.approval_required" && message.requestId === expected.requestId,
    ),
    expected,
  );

  client.sendJson({
    type: "capability.approval",
    requestId: expected.requestId,
    approved: true,
  });

  const result = await client.findMessage((message) =>
    message.type === "capability.result" && message.requestId === expected.requestId,
  );
  if (result.ok !== true) {
    throw new Error(`Capability approval was not accepted for ${expected.requestId}`);
  }
  return approval;
}

export async function launchE2ETestHost(options: { port?: number; allowWorkspaceWrites?: boolean } = {}): Promise<E2ETestHost> {
  const workspace = await createTestWorkspace();
  const daemonManager = new DaemonManager();
  const subagentSupervisor = new SubagentSupervisor({
    workspaceRoot: workspace.root,
    daemonSupervisor: daemonManager.supervisor,
    scheduler: daemonManager.scheduler,
  });
  const memoryEngine = subagentSupervisor.memory;

  const host = await createHost({
    port: options.port ?? 0,
    allowNonBrowserClients: true,
    session: {
      workspaceRoot: workspace.root,
      allowWorkspaceWrites: options.allowWorkspaceWrites ?? true,
      daemonManager,
      subagentSupervisor,
      memoryEngine,
    },
  });

  const url = `ws://127.0.0.1:${host.port}/agent`;

  const connect = async (customToken?: string): Promise<TestWsClient> => {
    const token = customToken !== undefined ? customToken : host.tokenStore.issue();
    const wsUrl = `${url}?token=${encodeURIComponent(token)}`;
    const ws = new NativeWebSocket(wsUrl);

    const messages: Record<string, unknown>[] = [];
    const waiters: ((msg: Record<string, unknown>) => void)[] = [];

    ws.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(String(event.data));
        if (waiters.length > 0) {
          const resolve = waiters.shift()!;
          resolve(parsed);
        } else {
          messages.push(parsed);
        }
      } catch {
        /* non-json or binary frame */
      }
    });

    await new Promise<void>((resolve, reject) => {
      let isOpened = false;
      const onOpen = () => {
        isOpened = true;
        setTimeout(() => {
          if (ws.readyState === 1) {
            resolve();
          }
        }, 20);
      };
      const onError = (err: any) => reject(err);
      const onClose = (event: any) => {
        const code = event.code ?? (event as any).status;
        if (!isOpened || (code && code >= 4000)) {
          reject(new Error(`WebSocket connection closed with code ${code}`));
        }
      };
      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onError, { once: true });
      ws.addEventListener("close", onClose, { once: true });
    });

    const nextMessage = (timeoutMs = 5000): Promise<Record<string, unknown>> => {
      if (messages.length > 0) {
        return Promise.resolve(messages.shift()!);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(resolve);
          if (idx !== -1) waiters.splice(idx, 1);
          reject(new Error(`Timeout waiting for WebSocket message after ${timeoutMs}ms`));
        }, timeoutMs);

        waiters.push((msg) => {
          clearTimeout(timer);
          resolve(msg);
        });
      });
    };

    const findMessage = async (
      predicate: (msg: Record<string, unknown>) => boolean,
      timeoutMs = 5000
    ): Promise<Record<string, unknown>> => {
      const startTime = Date.now();
      for (let i = 0; i < messages.length; i++) {
        if (predicate(messages[i])) {
          const [found] = messages.splice(i, 1);
          return found;
        }
      }

      const unmatched: Record<string, unknown>[] = [];
      try {
        while (Date.now() - startTime < timeoutMs) {
          const remaining = timeoutMs - (Date.now() - startTime);
          if (remaining <= 0) break;
          const msg = await nextMessage(remaining);
          if (predicate(msg)) {
            return msg;
          }
          unmatched.push(msg);
        }
      } finally {
        if (unmatched.length > 0) {
          messages.unshift(...unmatched);
        }
      }
      throw new Error(`findMessage predicate not matched within ${timeoutMs}ms`);
    };

    const sendJson = (payload: unknown) => {
      ws.send(JSON.stringify(payload));
    };

    const close = (): Promise<{ code: number; reason: string }> => {
      return new Promise((resolve) => {
        ws.addEventListener("close", (event) => {
          resolve({ code: event.code, reason: event.reason });
        }, { once: true });
        ws.close();
      });
    };

    return {
      ws,
      messages,
      nextMessage,
      findMessage,
      sendJson,
      close,
    };
  };

  const connectRaw = (customToken?: string): { ws: WsLike; waitForOpen: () => Promise<void>; waitForClose: () => Promise<{ code: number; reason: string }> } => {
    const token = customToken !== undefined ? customToken : host.tokenStore.issue();
    const wsUrl = `${url}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const ws = new NativeWebSocket(wsUrl);

    const waitForOpen = () =>
      new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", (err) => reject(err), { once: true });
      });

    const waitForClose = () =>
      new Promise<{ code: number; reason: string }>((resolve) => {
        ws.addEventListener("close", (event) => {
          resolve({ code: event.code, reason: event.reason });
        }, { once: true });
      });

    return { ws, waitForOpen, waitForClose };
  };

  return {
    host,
    workspace,
    daemonManager,
    subagentSupervisor,
    memoryEngine,
    url,
    token: host.token,
    close: async () => {
      await subagentSupervisor.dispose();
      await daemonManager.dispose();
      await host.close();
      await workspace.cleanup();
    },
    connect,
    connectRaw,
  };
}
