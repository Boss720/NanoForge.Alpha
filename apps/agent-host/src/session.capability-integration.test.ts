import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { AuditStore } from "./audit/store";
import { attachAgentSession } from "./session";
import { SubagentSupervisor } from "./agents/supervisor";

class TestSocket extends EventEmitter {
  readyState = 1;
  readonly sent: Record<string, unknown>[] = [];

  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as Record<string, unknown>);
  }
}

async function waitForMessage(
  socket: TestSocket,
  predicate: (message: Record<string, unknown>) => boolean,
  timeoutMs = 3_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const message = socket.sent.find(predicate);
    if (message) return message;
    if (Date.now() >= deadline) throw new Error("Timed out waiting for socket message");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const descriptor = (id: string) => ({
  id,
  name: "Capability test workspace",
  displayPath: "workspace-test",
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
} as const);

describe("direct session capability handshake", () => {
  it("holds a structured run approval behind a redacted broker request and persists its decision", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-run-capability-"));
    const socket = new TestSocket();
    const provider = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end([
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "terminal.exec", arguments: JSON.stringify({ executable: "node", args: ["-e", "process.exit(0)"], cwd: "." }) } }] } }] })}`,
        "data: [DONE]",
        "",
      ].join("\n\n"));
    });
    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("Provider did not bind a port");
    try {
      attachAgentSession(socket as never, { hostId: "host-test" }, {
        workspaceRoot: root,
        workspaceDescriptor: descriptor("workspace-test"),
        provider: {
          baseUrl: `http://127.0.0.1:${address.port}`,
          apiKey: "test-key",
          model: "test-model",
        },
      });
      socket.emit("message", JSON.stringify({
        type: "plan.submit",
        requestId: "structured-plan-1",
        plan: {
          id: "structured-plan",
          goal: "run a gated command",
          state: "awaiting_approval",
          steps: [{ id: "step-structured", title: "Gated step", dependsOn: [], status: "pending" }],
        },
      }));

      const approval = await waitForMessage(socket, (message) => message.type === "capability.approval_required");
      expect(approval).toMatchObject({
        type: "capability.approval_required",
        hostId: "host-test",
        workspaceId: "workspace-test",
        generation: 1,
        runId: expect.any(String),
        stepId: "step-structured",
        toolId: "terminal.exec",
        scope: "execute",
        argumentsDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
      expect(JSON.stringify(approval)).not.toContain("process.exit");
      expect(JSON.stringify(approval)).not.toContain("test-key");
      expect(approval).not.toHaveProperty("request");
      expect(approval).not.toHaveProperty("command");
      expect(approval).not.toHaveProperty("args");
      expect(approval).not.toHaveProperty("cwd");

      socket.emit("message", JSON.stringify({
        type: "approval.grant",
        requestId: "structured-plan-1",
        runId: approval.runId,
        stepId: "step-structured",
      }));
      const legacyResult = await waitForMessage(socket, (message) =>
        message.type === "approval.grant.result" && message.requestId === "structured-plan-1",
      );
      expect(legacyResult).toMatchObject({ resolved: false });

      socket.emit("message", JSON.stringify({
        type: "capability.approval",
        requestId: approval.requestId,
        approved: true,
      }));
      await waitForMessage(socket, (message) =>
        message.type === "run.event" && (message.data as { type?: string } | undefined)?.type === "tool.finished",
      );
      const audit = new AuditStore({ rootDir: path.join(root, ".nanoforge", "runs") });
      try {
        const decisions = audit.listCapabilityDecisions();
        expect(decisions).toEqual(expect.arrayContaining([
          expect.objectContaining({
            decision: "allow",
            requestId: approval.requestId,
            binding: expect.objectContaining({
              hostId: "host-test",
              workspaceId: "workspace-test",
              runId: approval.runId,
              stepId: "step-structured",
              toolId: "terminal.exec",
              argumentsDigest: approval.argumentsDigest,
            }),
          }),
        ]));
        expect(JSON.stringify(decisions)).not.toContain("process.exit");
      } finally {
        audit.close();
      }
    } finally {
      socket.emit("close");
      await new Promise<void>((resolve) => provider.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("holds a workspace write until matching capability approval", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-capability-"));
    const socket = new TestSocket();
    try {
      await fs.writeFile(path.join(root, "note.txt"), "before", "utf8");
      attachAgentSession(socket as never, { hostId: "host-test" }, {
        workspaceRoot: root,
        workspaceDescriptor: descriptor("workspace-test"),
        allowWorkspaceWrites: true,
      });

      socket.emit("message", JSON.stringify({
        type: "workspace.writeFile",
        requestId: "write-approval-1",
        path: "note.txt",
        content: "after",
        generation: 1,
      }));
      await new Promise((resolve) => setImmediate(resolve));

      expect(await fs.readFile(path.join(root, "note.txt"), "utf8")).toBe("before");
      const approval = socket.sent.find((message) => message.type === "capability.approval_required");
      expect(approval).toMatchObject({
        type: "capability.approval_required",
        requestId: "write-approval-1",
        hostId: "host-test",
        sessionId: expect.any(String),
        workspaceId: "workspace-test",
        generation: 1,
        toolId: "workspace.writeFile",
        scope: "write",
        argumentsDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });

      socket.emit("message", JSON.stringify({
        type: "capability.approval",
        requestId: "write-approval-1",
        approved: true,
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(await fs.readFile(path.join(root, "note.txt"), "utf8")).toBe("after");
      expect(socket.sent.filter((message) => message.type === "workspace.writeFile.result")).toHaveLength(1);

      socket.emit("message", JSON.stringify({
        type: "capability.approval",
        requestId: "write-approval-1",
        approved: true,
      }));
      await new Promise((resolve) => setImmediate(resolve));
      expect(socket.sent.at(-1)).toMatchObject({
        type: "capability.result",
        requestId: "write-approval-1",
        ok: false,
        errorCode: "already_used",
      });

      socket.emit("message", JSON.stringify({
        type: "capability.approval",
        requestId: "unknown-request",
        approved: true,
      }));
      await new Promise((resolve) => setImmediate(resolve));
      expect(socket.sent.at(-1)).toMatchObject({
        type: "capability.result",
        requestId: "unknown-request",
        ok: false,
        errorCode: "invalid_request",
      });

      socket.emit("message", JSON.stringify({
        type: "workspace.writeFile",
        requestId: "write-denied-1",
        path: "note.txt",
        content: "denied",
        generation: 1,
      }));
      await new Promise((resolve) => setImmediate(resolve));
      socket.emit("message", JSON.stringify({
        type: "capability.approval",
        requestId: "write-denied-1",
        approved: false,
        reason: "review rejected",
      }));
      await new Promise((resolve) => setImmediate(resolve));
      expect(await fs.readFile(path.join(root, "note.txt"), "utf8")).toBe("after");
      expect(socket.sent.at(-1)).toMatchObject({ type: "capability.result", requestId: "write-denied-1", ok: false, errorCode: "denied" });
    } finally {
      socket.emit("close");
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("does not spawn a subagent before approval and consumes approval once", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-subagent-capability-"));
    const socket = new TestSocket();
    const supervisor = new SubagentSupervisor({ workspaceRoot: root });
    try {
      attachAgentSession(socket as never, { hostId: "host-test" }, {
        workspaceRoot: root,
        workspaceDescriptor: descriptor("workspace-test"),
        subagentSupervisor: supervisor,
      });
      const params = {
        archetype: "custom",
        roles: [],
        prompt: "private capability prompt",
        workspaceIsolation: "inherit",
        timeoutSeconds: 600,
        skills: [],
      };
      socket.emit("message", JSON.stringify({
        type: "subagent.invoke",
        requestId: "invoke-approval-1",
        params,
      }));
      await new Promise((resolve) => setImmediate(resolve));

      expect(await fs.readdir(root)).not.toContain(".agents");
      const approval = socket.sent.find((message) => message.type === "capability.approval_required");
      expect(approval).toMatchObject({ type: "capability.approval_required", toolId: "subagent.invoke", scope: "execute" });
      expect(JSON.stringify(approval)).not.toContain("private capability prompt");

      socket.emit("message", JSON.stringify({ type: "capability.approval", requestId: "invoke-approval-1", approved: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await fs.readdir(root)).toContain(".agents");
      expect(socket.sent.filter((message) => message.type === "subagent.invoke.result")).toHaveLength(1);
      socket.emit("message", JSON.stringify({ type: "capability.approval", requestId: "invoke-approval-1", approved: true }));
      await new Promise((resolve) => setImmediate(resolve));
      expect(socket.sent.at(-1)).toMatchObject({ type: "capability.result", errorCode: "already_used" });
    } finally {
      socket.emit("close");
      await supervisor.dispose();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails closed for denied, unknown, and replayed approvals", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-capability-"));
    const socket = new TestSocket();
    try {
      await fs.writeFile(path.join(root, "note.txt"), "before", "utf8");
      attachAgentSession(socket as never, { hostId: "host-test" }, {
        workspaceRoot: root,
        workspaceDescriptor: descriptor("workspace-test"),
        allowWorkspaceWrites: true,
      });

      socket.emit("message", JSON.stringify({
        type: "workspace.writeFile",
        requestId: "write-denied-1",
        path: "note.txt",
        content: "after",
        generation: 1,
      }));
      await new Promise((resolve) => setImmediate(resolve));

      socket.emit("message", JSON.stringify({
        type: "capability.approval",
        requestId: "write-denied-1",
        approved: false,
      }));
      await new Promise((resolve) => setImmediate(resolve));
      expect(await fs.readFile(path.join(root, "note.txt"), "utf8")).toBe("before");
      expect(socket.sent).toContainEqual(expect.objectContaining({
        type: "capability.result",
        requestId: "write-denied-1",
        ok: false,
        errorCode: "denied",
      }));

      socket.emit("message", JSON.stringify({
        type: "capability.approval",
        requestId: "write-denied-1",
        approved: true,
      }));
      socket.emit("message", JSON.stringify({
        type: "capability.approval",
        requestId: "unknown-approval-1",
        approved: true,
      }));
      await new Promise((resolve) => setImmediate(resolve));
      expect(await fs.readFile(path.join(root, "note.txt"), "utf8")).toBe("before");
      expect(socket.sent).toContainEqual(expect.objectContaining({
        type: "capability.result",
        requestId: "unknown-approval-1",
        ok: false,
        errorCode: "invalid_request",
      }));
    } finally {
      socket.emit("close");
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
