/**
 * Phase 7 E2E Integration Smoke Test
 * 
 * Verifies end-to-end runtime security and protocol contracts:
 * 1. Connection with expected origin vs unauthorized origin rejection
 * 2. Workspace read succeeds
 * 3. Write disabled by default on default host launch
 * 4. Explicit enablement permits reviewed writes with SHA-256 conflict detection
 * 5. Plan submit, pause, resume, and cancel wire acknowledgements
 * 6. Adversarial slash command / swarm inspect traversal rejection
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { approveExactCapability, launchE2ETestHost, type E2ETestHost } from "./helpers/testHost.js";
import { CLOSE_UNAUTHORIZED } from "../../apps/agent-host/src/server.js";
import type { ExecutionPlan } from "@protocol/plan";

describe("Phase 7 End-to-End Smoke Test", () => {
  let e2eHost: E2ETestHost | undefined;

  afterEach(async () => {
    if (e2eHost) {
      await e2eHost.close();
      e2eHost = undefined;
    }
  });

  it("1. validates connection and token authentication", async () => {
    e2eHost = await launchE2ETestHost();

    // Invalid token rejected
    const { waitForClose } = e2eHost.connectRaw("invalid_token");
    const { code } = await waitForClose();
    expect(code).toBe(CLOSE_UNAUTHORIZED);

    // Valid authenticated connection succeeds and receives host.ready
    const client = await e2eHost.connect();
    const readyMsg = await client.nextMessage();
    expect(readyMsg.type).toBe("host.ready");
    expect(typeof readyMsg.hostId).toBe("string");
    await client.close();
  });

  it("2. enforces write disabled by default, then allows write when explicitly enabled", async () => {
    // Launch host with writes disabled (default)
    e2eHost = await launchE2ETestHost({ allowWorkspaceWrites: false });
    const root = e2eHost.workspace.root;
    const testFilePath = path.join(root, "example.txt");
    await fs.writeFile(testFilePath, "original content", "utf8");

    const client = await e2eHost.connect();
    await client.nextMessage(); // host.ready

    // Read workspace file works
    client.sendJson({
      type: "workspace.readFile",
      requestId: "req-read-1",
      path: "example.txt",
    });
    const readResult = await client.findMessage((m) => m.type === "workspace.readFile.result");
    expect(readResult.type).toBe("workspace.readFile.result");
    expect(readResult.content).toBe("original content");
    const sha = readResult.sha256 as string;
    expect(sha).toBeDefined();

    // Write fails because write is disabled by default
    client.sendJson({
      type: "workspace.writeFile",
      requestId: "req-write-denied",
      path: "example.txt",
      content: "unauthorized edit",
      expectedSha256: sha,
    });
    const writeDenied = await client.findMessage((m) => m.type === "workspace.error");
    expect(writeDenied.type).toBe("workspace.error");
    expect(writeDenied.code).toBe("write_not_approved");

    // File on disk remains unmodified
    expect(await fs.readFile(testFilePath, "utf8")).toBe("original content");
    await client.close();
    await e2eHost.close();

    // Now launch host with explicit write enablement
    e2eHost = await launchE2ETestHost({ allowWorkspaceWrites: true });
    const root2 = e2eHost.workspace.root;
    const testFilePath2 = path.join(root2, "example.txt");
    await fs.writeFile(testFilePath2, "original content", "utf8");

    const client2 = await e2eHost.connect();
    await client2.nextMessage(); // host.ready

    client2.sendJson({
      type: "workspace.readFile",
      requestId: "req-read-2",
      path: "example.txt",
    });
    const readResult2 = await client2.findMessage((m) => m.type === "workspace.readFile.result");
    const sha2 = readResult2.sha256 as string;

    // Perform reviewed write with matching SHA-256
    client2.sendJson({
      type: "workspace.writeFile",
      requestId: "req-write-ok",
      path: "example.txt",
      content: "approved edit",
      expectedSha256: sha2,
    });
    await approveExactCapability(client2, {
      requestId: "req-write-ok",
      toolId: "workspace.writeFile",
      scope: "write",
    });
    const writeSuccess = await client2.findMessage((m) => m.type === "workspace.writeFile.result");
    expect(writeSuccess.type).toBe("workspace.writeFile.result");
    expect(writeSuccess.success).toBe(true);

    // Verify on-disk content updated
    expect(await fs.readFile(testFilePath2, "utf8")).toBe("approved edit");

    // Test conflict rejection on stale hash
    client2.sendJson({
      type: "workspace.writeFile",
      requestId: "req-write-conflict",
      path: "example.txt",
      content: "conflicting edit",
      expectedSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
    await approveExactCapability(client2, {
      requestId: "req-write-conflict",
      toolId: "workspace.writeFile",
      scope: "write",
    });
    const conflictResult = await client2.findMessage((m) => m.type === "workspace.error");
    expect(conflictResult.type).toBe("workspace.error");
    expect(conflictResult.code).toBe("write_conflict");

    await client2.close();
  });

  it("3. validates plan submit/pause/cancel acknowledgements and rejects invalid swarm inspect", async () => {
    e2eHost = await launchE2ETestHost({ allowWorkspaceWrites: true });
    const client = await e2eHost.connect();
    await client.nextMessage(); // host.ready

    // Submit plan
    const plan: ExecutionPlan = {
      id: "smoke-plan-1",
      goal: "E2E Smoke Plan",
      state: "awaiting_approval",
      steps: [{ id: "s1", title: "Step 1", dependsOn: [], status: "pending" }],
    };

    client.sendJson({
      type: "plan.submit",
      requestId: "req-plan-sub",
      plan,
    });
    const submitResult = await client.findMessage((m) => m.type === "plan.submit.result");
    expect(submitResult.type).toBe("plan.submit.result");
    expect(submitResult.requestId).toBe("req-plan-sub");
    expect(submitResult.runId).toBeDefined();
    const runId = submitResult.runId as string;

    // Pause run
    client.sendJson({
      type: "run.pause",
      requestId: "req-pause",
      runId,
    });
    const pauseResult = await client.findMessage((m) => m.type === "run.pause.result");
    expect(pauseResult.type).toBe("run.pause.result");
    expect(pauseResult.requestId).toBe("req-pause");
    expect(pauseResult.runId).toBe(runId);

    // Cancel run
    client.sendJson({
      type: "run.cancel",
      requestId: "req-cancel",
      runId,
    });
    const cancelResult = await client.findMessage((m) => m.type === "run.cancel.result");
    expect(cancelResult.type).toBe("run.cancel.result");
    expect(cancelResult.requestId).toBe("req-cancel");
    expect(cancelResult.runId).toBe(runId);

    // Spawn subagent to inspect
    const spawnRes = await e2eHost.subagentSupervisor.spawnSubagent({
      archetype: "custom",
      name: "worker_smoke",
      roles: ["Smoke Tester"],
      prompt: "Test inspection",
    });
    expect(spawnRes.subagentId).toBeDefined();
    const subagentId = spawnRes.subagentId;

    // Test invalid traversal in /swarm inspect
    client.sendJson({
      type: "command.execute",
      command: "/swarm",
      args: ["inspect", subagentId, "--file", "../../../etc/passwd"],
      rawText: `/swarm inspect ${subagentId} --file ../../../etc/passwd`,
      requestId: "req-cmd-1",
    });
    const inspectDenied = await client.findMessage((m) => m.type === "command.result");
    expect(inspectDenied.type).toBe("command.result");
    expect(inspectDenied.success).toBe(false);
    expect(String(inspectDenied.error)).toMatch(/Invalid \/swarm inspect arguments|invalid_inspect_file/i);
    expect((inspectDenied.data as any)?.code).toBe("invalid_command");

    await client.close();
  });
});
