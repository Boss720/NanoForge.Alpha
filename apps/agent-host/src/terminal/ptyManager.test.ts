/**
 * Unit and integration tests for PtyManager — Milestone 4 (R3).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  PtyManager,
  CircularScrollbackBuffer,
  DEFAULT_MAX_SCROLLBACK_BYTES,
} from "./ptyManager";
import { RunnerSpecError } from "./types";
import type { TerminalServerMessage } from "@protocol/terminal";

describe("CircularScrollbackBuffer", () => {
  it("retains output within max byte limit", () => {
    const buffer = new CircularScrollbackBuffer(1024);
    buffer.push("hello world\n");
    expect(buffer.toString()).toBe("hello world\n");
    expect(buffer.isTruncated).toBe(false);
    expect(buffer.byteLength).toBe(12);
  });

  it("truncates older bytes from the beginning when capacity is exceeded", () => {
    const maxBytes = 32;
    const buffer = new CircularScrollbackBuffer(maxBytes);
    buffer.push("0123456789"); // 10 bytes
    buffer.push("abcdefghij"); // 10 bytes
    buffer.push("KLMNOPQRST"); // 10 bytes (total 30)
    expect(buffer.isTruncated).toBe(false);

    // Overflow by 15 bytes
    buffer.push("UVWXYZ123456789"); // 15 bytes (total 45)
    expect(buffer.isTruncated).toBe(true);
    expect(buffer.byteLength).toBeLessThanOrEqual(maxBytes);
    expect(buffer.toString()).toContain("UVWXYZ123456789");
  });

  it("handles clearing the buffer", () => {
    const buffer = new CircularScrollbackBuffer(100);
    buffer.push("some data");
    buffer.clear();
    expect(buffer.toString()).toBe("");
    expect(buffer.byteLength).toBe(0);
    expect(buffer.isTruncated).toBe(false);
  });
});

describe("PtyManager", () => {
  let tmpDir: string;
  let manager: PtyManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-pty-test-"));
    manager = new PtyManager({
      workspaceRoot: tmpDir,
      maxScrollbackBytes: 1024 * 1024,
    });
  });

  afterEach(async () => {
    manager?.dispose();
    try {
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore windows lock */
    }
  });

  it("initializes with default options", () => {
    expect(manager).toBeInstanceOf(PtyManager);
    expect(manager.listSessions()).toEqual([]);
  });

  it("spawns an interactive shell session and emits terminal.created", async () => {
    const messages: TerminalServerMessage[] = [];
    manager.on("message", (msg) => messages.push(msg));

    const session = await manager.createSession({
      title: "test-shell",
      cols: 100,
      rows: 30,
    });

    expect(session.id).toBeDefined();
    expect(session.title).toBe("test-shell");
    expect(session.cols).toBe(100);
    expect(session.rows).toBe(30);
    expect(session.status).toBe("running");

    const createdMsg = messages.find((m) => m.type === "terminal.created");
    expect(createdMsg).toBeDefined();
    if (createdMsg && createdMsg.type === "terminal.created") {
      expect(createdMsg.id).toBe(session.id);
      expect(createdMsg.cols).toBe(100);
      expect(createdMsg.rows).toBe(30);
    }
  });

  it("enforces workspace confinement and rejects escaping cwd", async () => {
    await expect(
      manager.createSession({
        cwd: path.resolve(tmpDir, "../outside-workspace"),
      }),
    ).rejects.toThrow(RunnerSpecError);
  });

  it("streams terminal data and processes exit events", async () => {
    const isWin = process.platform === "win32";
    const executable = isWin ? "cmd.exe" : "sh";
    const args = isWin ? ["/c", "echo hello from test"] : ["-c", "echo hello from test"];

    const messages: TerminalServerMessage[] = [];
    manager.on("message", (msg) => messages.push(msg));

    const session = await manager.createSession({
      executable,
      args,
    });

    // Wait for process to exit
    await new Promise<void>((resolve) => {
      const check = () => {
        const exitMsg = messages.find((m) => m.type === "terminal.exit");
        if (exitMsg) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    const dataMsgs = messages.filter((m) => m.type === "terminal.data");
    expect(dataMsgs.length).toBeGreaterThan(0);

    const scrollback = manager.getScrollback(session.id);
    expect(scrollback).toContain("hello from test");

    const exitMsg = messages.find((m) => m.type === "terminal.exit");
    expect(exitMsg).toBeDefined();
    if (exitMsg && exitMsg.type === "terminal.exit") {
      expect(exitMsg.exitCode).toBe(0);
    }
  });

  it("handles writeInput, resize, and kill on sessions", async () => {
    const session = await manager.createSession({
      title: "interactive-term",
    });

    // Input forwarding
    const wrote = manager.writeInput(session.id, "echo 123\n");
    expect(wrote).toBe(true);

    // Resize geometry
    const resized = manager.resize(session.id, 120, 40);
    expect(resized).toBe(true);
    const updated = manager.getSession(session.id);
    expect(updated?.cols).toBe(120);
    expect(updated?.rows).toBe(40);

    // Kill session
    const killed = await manager.kill(session.id);
    expect(killed).toBe(true);
  });

  it("denies terminal control and inspection to a different session owner", async () => {
    const terminal = await manager.createSession({ title: "owned-terminal" }, "socket-owner-a");

    expect(manager.writeInput(terminal.id, "echo should-not-run\n", "socket-owner-b")).toBe(false);
    expect(manager.resize(terminal.id, 120, 40, "socket-owner-b")).toBe(false);
    await expect(manager.kill(terminal.id, undefined, "socket-owner-b")).resolves.toBe(false);
    expect(manager.getSession(terminal.id, "socket-owner-b")).toBeUndefined();
    expect(manager.getScrollback(terminal.id, "socket-owner-b")).toBeUndefined();
    expect(manager.listSessions("socket-owner-b")).toEqual([]);

    const ownerAInfo = manager.getSession(terminal.id, "socket-owner-a");
    expect(ownerAInfo).toBeDefined();
    expect(ownerAInfo).not.toHaveProperty("ownerId");
    expect(manager.listSessions("socket-owner-a")).toHaveLength(1);
    expect(manager.writeInput(terminal.id, "echo owner-a\n", "socket-owner-a")).toBe(true);
  });

  it("cleans up only terminals owned by the disconnected session", async () => {
    const ownerATerminal = await manager.createSession({ title: "owner-a" }, "socket-owner-a");
    const ownerBTerminal = await manager.createSession({ title: "owner-b" }, "socket-owner-b");

    await expect(manager.closeSessionsForOwner("socket-owner-a")).resolves.toBe(1);
    expect(manager.getSession(ownerATerminal.id, "socket-owner-a")).toBeUndefined();
    expect(manager.getSession(ownerBTerminal.id, "socket-owner-b")).toBeDefined();
  });

  it("manages multiple concurrent sessions independently", async () => {
    const s1 = await manager.createSession({ title: "term-1" });
    const s2 = await manager.createSession({ title: "term-2" });

    expect(s1.id).not.toBe(s2.id);
    expect(manager.listSessions().length).toBe(2);

    await manager.closeSession(s1.id);
    expect(manager.listSessions().length).toBe(1);
    expect(manager.getSession(s2.id)).toBeDefined();
    expect(manager.getSession(s1.id)).toBeUndefined();
  });

  it("sanitizes child environment and prevents token leakage", async () => {
    process.env.SECRET_API_KEY_FOR_TEST = "sensitive-value-12345";
    process.env.MY_CUSTOM_SECRET = "supersecret";

    const customManager = new PtyManager({
      workspaceRoot: tmpDir,
      env: { SAFE_VAR: "safe-val" },
    });

    const isWin = process.platform === "win32";
    const executable = isWin ? "cmd.exe" : "sh";
    const args = isWin
      ? ["/c", "echo SAFE=%SAFE_VAR% SECRET=%SECRET_API_KEY_FOR_TEST%"]
      : ["-c", 'echo "SAFE=$SAFE_VAR SECRET=$SECRET_API_KEY_FOR_TEST"'];

    const messages: TerminalServerMessage[] = [];
    customManager.on("message", (msg) => messages.push(msg));

    const s = await customManager.createSession({ executable, args });

    await new Promise<void>((resolve) => {
      const check = () => {
        if (messages.some((m) => m.type === "terminal.exit")) resolve();
        else setTimeout(check, 50);
      };
      check();
    });

    const output = customManager.getScrollback(s.id) || "";
    expect(output).toContain("SAFE=safe-val");
    expect(output).not.toContain("sensitive-value-12345");

    customManager.dispose();
    delete process.env.SECRET_API_KEY_FOR_TEST;
    delete process.env.MY_CUSTOM_SECRET;
  });
});
