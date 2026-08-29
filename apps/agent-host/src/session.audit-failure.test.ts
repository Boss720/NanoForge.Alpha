import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { attachAgentSession, type SessionAuditStore } from "./session";

class TestSocket extends EventEmitter {
  readyState = 1;
  readonly sent: Record<string, unknown>[] = [];

  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as Record<string, unknown>);
  }
}

const descriptor = {
  id: "audit-failure-workspace",
  name: "Audit failure workspace",
  displayPath: "audit-failure-workspace",
  generation: 1,
  capabilities: {
    read: true,
    stat: true,
    watch: true,
    search: true,
    git: true,
    terminal: true,
    subagents: true,
    memory: true,
    reviewedWrite: true,
  },
} as const;

const unavailableAuditStore: SessionAuditStore = {
  startRun() {},
  recordEvent() {},
  endRun() {},
  recordCapabilityDecision() {
    throw new Error("audit store unavailable");
  },
  close() {},
};

async function waitForMessage(
  socket: TestSocket,
  predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const message = socket.sent.find(predicate);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for host message");
}

describe("session audit failure handling", () => {
  it("denies an approved workspace write when its capability decision cannot be durably recorded", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-session-audit-failure-"));
    const target = path.join(root, "note.txt");
    const socket = new TestSocket();
    try {
      await fs.writeFile(target, "before", "utf8");
      attachAgentSession(socket as never, { hostId: "host-audit-failure" }, {
        workspaceRoot: root,
        workspaceDescriptor: descriptor,
        allowWorkspaceWrites: true,
        auditStore: unavailableAuditStore,
      });

      socket.emit("message", JSON.stringify({
        type: "workspace.writeFile",
        requestId: "audit-write-1",
        path: "note.txt",
        content: "after",
        generation: 1,
      }));
      await waitForMessage(socket, (message) => message.type === "capability.approval_required");
      socket.emit("message", JSON.stringify({
        type: "capability.approval",
        requestId: "audit-write-1",
        approved: true,
      }));

      await expect(waitForMessage(socket, (message) =>
        message.type === "capability.result" && message.requestId === "audit-write-1",
      )).resolves.toMatchObject({
        ok: false,
        errorCode: "denied",
        errorMessage: "Capability audit is unavailable; approval denied",
      });
      expect(await fs.readFile(target, "utf8")).toBe("before");
      expect(socket.sent.some((message) => message.type === "workspace.writeFile.result")).toBe(false);
    } finally {
      socket.emit("close");
      await fs.unlink(target);
      await fs.rmdir(root);
    }
  });

  it("does not invoke a subagent when its approved capability decision cannot be recorded", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-subagent-audit-failure-"));
    const socket = new TestSocket();
    let invocations = 0;
    try {
      attachAgentSession(socket as never, { hostId: "host-audit-failure" }, {
        workspaceRoot: root,
        workspaceDescriptor: descriptor,
        auditStore: unavailableAuditStore,
        memoryEngine: {
          subscribe() {
            return () => {};
          },
        } as never,
        subagentSupervisor: {
          subscribe() {
            return () => {};
          },
          async spawnSubagent() {
            invocations += 1;
            return {};
          },
        } as never,
      });

      socket.emit("message", JSON.stringify({
        type: "subagent.invoke",
        requestId: "audit-subagent-1",
        params: {
          archetype: "custom",
          roles: [],
          prompt: "must not run",
          workspaceIsolation: "inherit",
          timeoutSeconds: 60,
          skills: [],
        },
      }));
      await waitForMessage(socket, (message) => message.type === "capability.approval_required");
      socket.emit("message", JSON.stringify({
        type: "capability.approval",
        requestId: "audit-subagent-1",
        approved: true,
      }));

      await expect(waitForMessage(socket, (message) =>
        message.type === "capability.result" && message.requestId === "audit-subagent-1",
      )).resolves.toMatchObject({
        ok: false,
        errorCode: "denied",
        errorMessage: "Capability audit is unavailable; approval denied",
      });
      expect(invocations).toBe(0);
      expect(socket.sent.some((message) => message.type === "subagent.invoke.result")).toBe(false);
    } finally {
      socket.emit("close");
      await fs.rmdir(root);
    }
  });
});
