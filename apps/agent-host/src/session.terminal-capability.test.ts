import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { attachAgentSession } from "./session";

class TestSocket extends EventEmitter {
  readyState = 1;
  readonly sent: Record<string, unknown>[] = [];

  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as Record<string, unknown>);
  }
}

const workspaceDescriptor = {
  id: "workspace-test",
  name: "Test workspace",
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
    reviewedWrite: false,
  },
} as const;

describe("direct interactive terminal capability boundary", () => {
  it("rejects agent-originated terminal.create by default", async () => {
    const socket = new TestSocket();
    const createSession = vi.fn().mockResolvedValue({ id: "pty-1" });
    attachAgentSession(socket as never, { hostId: "host-test" }, {
      workspaceRoot: process.cwd(),
      workspaceDescriptor,
      ptyManager: { createSession, on: vi.fn(), off: vi.fn() } as never,
    });

    socket.emit("message", JSON.stringify({
      type: "terminal.create",
      id: "pty-1",
      cwd: ".",
    }));
    await Promise.resolve();

    expect(createSession).not.toHaveBeenCalled();
    expect(socket.sent).toContainEqual({
      type: "error",
      code: "terminal_interactive_denied",
      message: "Direct interactive terminal creation is disabled by host policy",
      at: expect.any(String),
    });
  });

  it("keeps terminal controls and disconnect cleanup scoped to one client session", async () => {
    const socketA = new TestSocket();
    const socketB = new TestSocket();
    const writeInput = vi.fn().mockReturnValue(false);
    const resize = vi.fn().mockReturnValue(false);
    const kill = vi.fn().mockResolvedValue(false);
    const closeSessionsForOwner = vi.fn().mockResolvedValue(0);
    const ptyManager = {
      on: vi.fn(),
      off: vi.fn(),
      writeInput,
      resize,
      kill,
      closeSessionsForOwner,
    };

    attachAgentSession(socketA as never, { hostId: "host-test" }, {
      workspaceRoot: process.cwd(),
      workspaceDescriptor,
      ptyManager: ptyManager as never,
    });
    attachAgentSession(socketB as never, { hostId: "host-test" }, {
      workspaceRoot: process.cwd(),
      workspaceDescriptor,
      ptyManager: ptyManager as never,
    });

    socketA.emit("message", JSON.stringify({ type: "terminal.input", id: "terminal-owned-by-a", data: "echo a" }));
    socketB.emit("message", JSON.stringify({ type: "terminal.input", id: "terminal-owned-by-a", data: "echo b" }));
    await Promise.resolve();

    const ownerA = writeInput.mock.calls[0]?.[2];
    const ownerB = writeInput.mock.calls[1]?.[2];
    expect(ownerA).toEqual(expect.any(String));
    expect(ownerB).toEqual(expect.any(String));
    expect(ownerA).not.toBe(ownerB);
    expect(socketB.sent).toContainEqual({
      type: "error",
      code: "terminal_access_denied",
      message: "Terminal operation unavailable",
      at: expect.any(String),
    });

    socketA.emit("close");
    await Promise.resolve();
    expect(closeSessionsForOwner).toHaveBeenCalledWith(ownerA);
    expect(closeSessionsForOwner).not.toHaveBeenCalledWith(ownerB);
  });
});
