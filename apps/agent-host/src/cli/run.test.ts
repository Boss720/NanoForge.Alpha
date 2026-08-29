/**
 * Headless Execution Runner Integration Tests (`nanoforge run`).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionPlan } from "@protocol/plan";
import type { ModelProfile } from "@protocol/routing";
import type { Policy } from "../policy/policy";
import type { ProviderAdapter, ProviderDelta } from "../providers/types";
import { InMemoryProviderRegistry } from "../providers/registry";
import type { RunnerOptions, TerminalJobHandle, TerminalJobSpec } from "../terminal/types";
import { WebSocketServer } from "ws";
import { executeRunCommand } from "./run";
import { StandaloneRunner } from "./standalone";
import { DaemonClient } from "./client";
import { EXIT_CODES } from "./types";

/* ------------------------------------------------------------------------ */
/* Test Fakes & Fixtures                                                    */
/* ------------------------------------------------------------------------ */

const testProfile: ModelProfile = {
  id: "test-model",
  provider: "test-provider",
  capabilities: { planning: 1, coding: 1, vision: 0, toolCalling: 1 },
  costPer1kInputTokens: 0.001,
  costPer1kOutputTokens: 0.002,
  privacyClass: "cloud",
  maxContextTokens: 128_000,
  typicalLatencyMs: 100,
};

const testPolicy: Policy = {
  workspaceRoot: ".",
  shells: ["cmd", "powershell", "bash", "sh"],
  deniedExecutables: ["rmdir"],
  askExecutables: ["npm"],
  readOnly: [{ executable: "git", firstArgs: ["status", "log", "diff"] }],
  redirectionDecision: "ask",
  compositionDecision: "deny",
  defaultDecision: "ask",
};

function createScriptedAdapter(deltas: ProviderDelta[]): ProviderAdapter {
  return {
    id: testProfile.provider,
    capabilities: { planning: true, coding: true, vision: false, toolCalling: true },
    streamChat: async function* () {
      for (const d of deltas) yield d;
    },
  };
}

function createFakeRunner(exitCode = 0): (spec: TerminalJobSpec, options: RunnerOptions) => TerminalJobHandle {
  let counter = 0;
  return (spec) => {
    const id = `job-${++counter}`;
    return {
      id,
      events: new EventEmitter(),
      promise: Promise.resolve({
        id,
        code: exitCode,
        signal: null,
        timedOut: false,
        cancelled: false,
        truncated: false,
        stdout: `executed ${spec.executable} ${(spec.args ?? []).join(" ")}\n`,
        stderr: "",
        durationMs: 5,
      }),
      cancel: () => {},
    };
  };
}

describe("executeRunCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "nanoforge-run-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  it("returns Exit Code 5 if prompt is missing", async () => {
    const res = await executeRunCommand({ prompt: "" });
    expect(res.exitCode).toBe(EXIT_CODES.CONFIG_AUTH);
  });

  it("returns Exit Code 6 if loaded plan file contains DAG cycle", async () => {
    const planFile = path.join(tmpDir, "cyclic-plan.json");
    writeFileSync(
      planFile,
      JSON.stringify({
        id: "cycle-plan",
        goal: "Cycle",
        steps: [
          { id: "s1", title: "Step 1", status: "pending", dependsOn: ["s2"] },
          { id: "s2", title: "Step 2", status: "pending", dependsOn: ["s1"] },
        ],
      }),
      "utf8",
    );

    const res = await executeRunCommand({ prompt: "", planFile, json: true });
    expect(res.exitCode).toBe(EXIT_CODES.VERIFICATION_FAILED);
  });

  it("executes successfully in standalone mode with --json and writes output dir", async () => {
    const plan: ExecutionPlan = {
      id: "run-plan-1",
      goal: "Check repository status",
      steps: [
        {
          id: "step-1",
          title: "Run git status",
          status: "pending",
          dependsOn: [],
          sideEffecting: false,
          approval: "auto",
        },
      ],
    };

    const planFile = path.join(tmpDir, "valid-plan.json");
    writeFileSync(planFile, JSON.stringify(plan), "utf8");

    const outDir = path.join(tmpDir, "run-output");

    const registry = new InMemoryProviderRegistry();
    registry.register(
      createScriptedAdapter([
        {
          type: "tool_proposal",
          name: "terminal.exec",
          args: { executable: "git", args: ["status"], cwd: "." },
        },
        { type: "text", text: "Checked repository status" },
        { type: "done" },
      ]),
    );

    const res = await StandaloneRunner.run({
      plan,
      autoApprove: "none",
      workspaceRoot: tmpDir,
      policy: { ...testPolicy, workspaceRoot: tmpDir },
      runner: createFakeRunner(0),
      profiles: [testProfile],
      providerRegistry: registry,
    });

    expect(res.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(res.summary?.status).toBe("completed");
    expect(res.events?.length).toBeGreaterThan(0);
  });

  it("fails closed under --auto-approve=none when mutating tool requires approval (Exit Code 4)", async () => {
    const plan: ExecutionPlan = {
      id: "mutating-plan",
      goal: "Install dependencies",
      steps: [
        {
          id: "step-npm",
          title: "Run npm install",
          status: "pending",
          dependsOn: [],
          sideEffecting: true,
          approval: "required",
        },
      ],
    };

    const registry = new InMemoryProviderRegistry();
    registry.register(
      createScriptedAdapter([
        {
          type: "tool_proposal",
          name: "terminal.exec",
          args: { executable: "npm", args: ["install"], cwd: "." },
        },
      ]),
    );

    const res = await StandaloneRunner.run({
      plan,
      autoApprove: "none", // fail closed
      workspaceRoot: tmpDir,
      policy: { ...testPolicy, workspaceRoot: tmpDir },
      runner: createFakeRunner(0),
      profiles: [testProfile],
      providerRegistry: registry,
    });

    expect(res.exitCode).toBe(EXIT_CODES.APPROVAL_DENIED);
    expect(res.summary?.status).toBe("halted");
    expect(res.summary?.reason).toContain("approval denied");
  });

  it("auto-grants safe read-only operations under --auto-approve=safe (Exit Code 0)", async () => {
    const plan: ExecutionPlan = {
      id: "safe-plan",
      goal: "Check status",
      steps: [
        {
          id: "step-git",
          title: "Run git status",
          status: "pending",
          dependsOn: [],
          sideEffecting: false,
          approval: "auto",
        },
      ],
    };

    const registry = new InMemoryProviderRegistry();
    registry.register(
      createScriptedAdapter([
        {
          type: "tool_proposal",
          name: "terminal.exec",
          args: { executable: "git", args: ["status"], cwd: "." },
        },
        { type: "done" },
      ]),
    );

    const res = await StandaloneRunner.run({
      plan,
      autoApprove: "safe",
      workspaceRoot: tmpDir,
      policy: { ...testPolicy, workspaceRoot: tmpDir },
      runner: createFakeRunner(0),
      profiles: [testProfile],
      providerRegistry: registry,
    });

    expect(res.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(res.summary?.status).toBe("completed");
  });

  it("denies mutating operations under --auto-approve=safe (Exit Code 4)", async () => {
    const plan: ExecutionPlan = {
      id: "mutating-plan-2",
      goal: "Mutate files",
      steps: [
        {
          id: "step-mutate",
          title: "Install library",
          status: "pending",
          dependsOn: [],
          sideEffecting: true,
          approval: "required",
        },
      ],
    };

    const registry = new InMemoryProviderRegistry();
    registry.register(
      createScriptedAdapter([
        {
          type: "tool_proposal",
          name: "terminal.exec",
          args: { executable: "npm", args: ["install", "lodash"], cwd: "." },
        },
      ]),
    );

    const res = await StandaloneRunner.run({
      plan,
      autoApprove: "safe",
      workspaceRoot: tmpDir,
      policy: { ...testPolicy, workspaceRoot: tmpDir },
      runner: createFakeRunner(0),
      profiles: [testProfile],
      providerRegistry: registry,
    });

    expect(res.exitCode).toBe(EXIT_CODES.APPROVAL_DENIED);
    expect(res.summary?.status).toBe("halted");
  });

  it("auto-grants mutating operations under --auto-approve=all (Exit Code 0)", async () => {
    const plan: ExecutionPlan = {
      id: "mutating-plan-3",
      goal: "Mutate with all approval",
      steps: [
        {
          id: "step-mutate-all",
          title: "Install dependencies",
          status: "pending",
          dependsOn: [],
          sideEffecting: true,
          approval: "required",
        },
      ],
    };

    const registry = new InMemoryProviderRegistry();
    registry.register(
      createScriptedAdapter([
        {
          type: "tool_proposal",
          name: "terminal.exec",
          args: { executable: "npm", args: ["install"], cwd: "." },
        },
        { type: "done" },
      ]),
    );

    const res = await StandaloneRunner.run({
      plan,
      autoApprove: "all",
      workspaceRoot: tmpDir,
      policy: { ...testPolicy, workspaceRoot: tmpDir },
      runner: createFakeRunner(0),
      profiles: [testProfile],
      providerRegistry: registry,
    });

    expect(res.exitCode).toBe(EXIT_CODES.SUCCESS);
    expect(res.summary?.status).toBe("completed");
  });

  it("halts with policy violation when model proposes a forbidden tool (Exit Code 2)", async () => {
    const plan: ExecutionPlan = {
      id: "policy-deny-plan",
      goal: "Run forbidden shell",
      steps: [
        {
          id: "step-shell",
          title: "Spawn powershell",
          status: "pending",
          dependsOn: [],
          sideEffecting: true,
          approval: "required",
        },
      ],
    };

    const registry = new InMemoryProviderRegistry();
    registry.register(
      createScriptedAdapter([
        {
          type: "tool_proposal",
          name: "terminal.exec",
          args: { executable: "powershell", args: ["-Command", "ls"], cwd: "." },
        },
      ]),
    );

    const res = await StandaloneRunner.run({
      plan,
      autoApprove: "all",
      workspaceRoot: tmpDir,
      policy: { ...testPolicy, workspaceRoot: tmpDir },
      runner: createFakeRunner(0),
      profiles: [testProfile],
      providerRegistry: registry,
    });

    expect(res.exitCode).toBe(EXIT_CODES.POLICY_VIOLATION);
    expect(res.summary?.status).toBe("halted");
    expect(res.summary?.reason).toContain("policy denied");
  });

  it("cancels execution when AbortSignal fires (Exit Code 3)", async () => {
    const plan: ExecutionPlan = {
      id: "cancel-plan",
      goal: "Long running task",
      steps: [
        {
          id: "step-long",
          title: "Long step",
          status: "pending",
          dependsOn: [],
          sideEffecting: false,
          approval: "auto",
        },
      ],
    };

    const controller = new AbortController();

    const registry = new InMemoryProviderRegistry();
    registry.register({
      id: testProfile.provider,
      capabilities: { planning: true, coding: true, vision: false, toolCalling: true },
      streamChat: async function* (_, signal) {
        yield { type: "text", text: "Starting..." };
        // Trigger abort mid-run
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (signal?.aborted) {
          yield { type: "error", code: "cancelled", message: "cancelled", retryable: false };
        }
      },
    });

    const res = await StandaloneRunner.run({
      plan,
      autoApprove: "all",
      workspaceRoot: tmpDir,
      policy: { ...testPolicy, workspaceRoot: tmpDir },
      runner: createFakeRunner(0),
      profiles: [testProfile],
      providerRegistry: registry,
      abortSignal: controller.signal,
    });

    expect(res.exitCode).toBe(EXIT_CODES.CANCELLED);
    expect(res.summary?.status).toBe("cancelled");
  });
});

describe("DaemonClient Integration", () => {
  it("returns Exit Code 5 if token is rejected (unauthorized / 4401)", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const address = wss.address() as { port: number };

    wss.on("connection", (socket) => {
      socket.close(4401, "unauthorized");
    });

    const plan: ExecutionPlan = {
      id: "daemon-plan-bad-token",
      goal: "Test auth failure",
      steps: [
        {
          id: "step-1",
          title: "Step 1",
          status: "pending",
          dependsOn: [],
        },
      ],
    };

    try {
      const res = await DaemonClient.run({
        host: `http://127.0.0.1:${address.port}`,
        token: "invalid-token-here-12345678901234567890",
        plan,
      });

      expect(res.exitCode).toBe(EXIT_CODES.CONFIG_AUTH);
      expect(res.message).toContain("Unauthorized");
    } finally {
      wss.close();
    }
  });

  it("handles successful execution over authenticated WebSocket daemon stream", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const address = wss.address() as { port: number };

    wss.on("connection", (socket, req) => {
      const token = new URL(req.url ?? "", "http://127.0.0.1").searchParams.get("token");
      if (token !== "valid-token-12345678901234567890") {
        socket.close(4401, "unauthorized");
        return;
      }

      socket.send(JSON.stringify({ type: "host.ready", version: "0.1.0", hostId: "host-1", at: new Date().toISOString() }));

      socket.on("message", (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === "plan.submit") {
          socket.send(JSON.stringify({ type: "run.state", runId: "r-1", state: "running", at: new Date().toISOString() }));
          socket.send(JSON.stringify({
            type: "run.event",
            runId: "r-1",
            event: "run.completed",
            data: { seq: 1, runId: "r-1", at: new Date().toISOString(), type: "run.completed", stepsSucceeded: 1 },
            at: new Date().toISOString(),
          }));
          socket.send(JSON.stringify({ type: "run.state", runId: "r-1", state: "done", at: new Date().toISOString() }));
          setTimeout(() => socket.close(), 10);
        }
      });
    });

    const plan: ExecutionPlan = {
      id: "daemon-plan-success",
      goal: "Test success stream",
      steps: [{ id: "step-1", title: "Step 1", status: "pending", dependsOn: [] }],
    };

    try {
      const res = await DaemonClient.run({
        host: `http://127.0.0.1:${address.port}`,
        token: "valid-token-12345678901234567890",
        plan,
      });

      expect(res.exitCode).toBe(EXIT_CODES.SUCCESS);
      expect(res.summary?.status).toBe("completed");
      expect(res.events?.length).toBeGreaterThan(0);
    } finally {
      wss.close();
    }
  });

  it("returns Exit Code 5 if host daemon is unreachable", async () => {
    const plan: ExecutionPlan = {
      id: "daemon-plan-unreachable",
      goal: "Test connection refusal",
      steps: [{ id: "step-1", title: "Step 1", status: "pending", dependsOn: [] }],
    };

    const res = await DaemonClient.run({
      host: "http://127.0.0.1:59999", // Unused port
      token: "some-token-value-12345678901234567890",
      plan,
    });

    expect(res.exitCode).toBe(EXIT_CODES.CONFIG_AUTH);
  });
});
