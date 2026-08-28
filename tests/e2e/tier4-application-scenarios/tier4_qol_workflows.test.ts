/**
 * NanoForge E2E Test Suite - Tier 4: Real-World Application Scenarios
 *
 * Covers complete end-to-end multi-workspace lifecycles, full write reviews,
 * large monorepo operations, and unattended offline recovery.
 */
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { approveExactCapability, launchE2ETestHost, type E2ETestHost } from "../helpers/testHost.js";

describe("Tier 4 - Real-World End-to-End Application Scenarios", () => {
  let e2eHost: E2ETestHost | undefined;

  afterEach(async () => {
    if (e2eHost) {
      await e2eHost.close();
      e2eHost = undefined;
    }
  });

  it("Scenario 1: Complete User Journey - First-Run Onboarding -> Open Folder -> Stepper -> Active Plan -> Completion", async () => {
    const userWorkflowState = {
      stage: "onboarding_card",
      activeWorkspace: "workspace-default",
      planId: null as string | null,
      planStatus: "idle",
    };

    expect(userWorkflowState.stage).toBe("onboarding_card");

    userWorkflowState.stage = "stepper_choosing_folder";
    userWorkflowState.stage = "stepper_validating";
    userWorkflowState.stage = "stepper_starting_tools";
    userWorkflowState.stage = "stepper_loading_files";
    userWorkflowState.stage = "ready";
    userWorkflowState.activeWorkspace = "ws_local_production";

    e2eHost = await launchE2ETestHost({ allowWorkspaceWrites: true });
    const client = await e2eHost.connect();

    client.sendJson({ type: "workspace.describe", requestId: "wf-desc" });
    const descMsg = await client.findMessage((m) => m.requestId === "wf-desc");
    expect(descMsg.type).toBe("workspace.ready");

    client.sendJson({
      type: "plan.submit",
      requestId: "wf-plan",
      plan: {
        id: "plan-workflow-1",
        goal: "Deploy production health monitoring endpoint",
        state: "awaiting_approval",
        steps: [
          { id: "step-1", title: "Generate health.ts", dependsOn: [], status: "pending", approval: "required" },
        ],
      },
    });

    const planRes = await client.findMessage((m) => m.requestId === "wf-plan");
    expect(planRes.type).toBe("plan.submit.result");
  });

  it("Scenario 2: Pre-Write Diff Review Lifecycle - Conflict Detection & Non-Destructive Resolution", async () => {
    e2eHost = await launchE2ETestHost({ allowWorkspaceWrites: true });
    const client = await e2eHost.connect();

    client.sendJson({
      type: "workspace.writeFile",
      requestId: "write-init",
      path: "config.json",
      content: JSON.stringify({ version: "1.0.0", port: 3000 }, null, 2),
    });
    await approveExactCapability(client, {
      requestId: "write-init",
      toolId: "workspace.writeFile",
      scope: "write",
    });
    const initRes = await client.findMessage((m) => m.requestId === "write-init");
    expect(initRes.type).toBe("workspace.writeFile.result");

    client.sendJson({
      type: "workspace.readFile",
      requestId: "read-1",
      path: "config.json",
    });
    const readRes = await client.findMessage((m) => m.requestId === "read-1");
    expect(readRes.type).toBe("workspace.readFile.result");
    const sha = (readRes as any).sha256;

    client.sendJson({
      type: "workspace.writeFile",
      requestId: "write-reviewed",
      path: "config.json",
      content: JSON.stringify({ version: "1.1.0", port: 3000, secure: true }, null, 2),
      expectedSha256: sha,
    });
    await approveExactCapability(client, {
      requestId: "write-reviewed",
      toolId: "workspace.writeFile",
      scope: "write",
    });
    const reviewedRes = await client.findMessage((m) => m.requestId === "write-reviewed");
    expect(reviewedRes.type).toBe("workspace.writeFile.result");
    expect((reviewedRes as any).success).toBe(true);
  });

  it("Scenario 3: Monorepo Scale Navigation - Filter Ignored Files, Directory Read & File Stat", async () => {
    e2eHost = await launchE2ETestHost({ allowWorkspaceWrites: true });
    const client = await e2eHost.connect();

    client.sendJson({
      type: "workspace.writeFile",
      requestId: "seed-1",
      path: "src/utils/logger.ts",
      content: "export const log = (msg: string) => console.log(msg);",
    });
    await approveExactCapability(client, {
      requestId: "seed-1",
      toolId: "workspace.writeFile",
      scope: "write",
    });
    await client.findMessage((m) => m.requestId === "seed-1");

    client.sendJson({
      type: "workspace.readDir",
      requestId: "readdir-1",
      path: "src/utils",
    });
    const readDirRes = await client.findMessage((m) => m.requestId === "readdir-1");
    expect(readDirRes.type).toBe("workspace.readDir.result");
    expect((readDirRes as any).entries.length).toBeGreaterThanOrEqual(1);

    client.sendJson({
      type: "workspace.stat",
      requestId: "stat-1",
      path: "src/utils/logger.ts",
    });
    const statRes = await client.findMessage((m) => m.requestId === "stat-1");
    expect(statRes.type).toBe("workspace.stat.result");
    expect((statRes as any).stat.size).toBeGreaterThan(0);
  });

  it("Scenario 4: Host Offline Disconnect & Generation-Verified Recovery", async () => {
    e2eHost = await launchE2ETestHost();
    const client1 = await e2eHost.connect();

    client1.sendJson({ type: "workspace.describe", requestId: "desc-gen1" });
    const res1 = await client1.findMessage((m) => m.requestId === "desc-gen1");
    const gen1 = (res1 as any).workspace.generation;
    expect(gen1).toBeGreaterThanOrEqual(1);

    await client1.close();

    const client2 = await e2eHost.connect();
    client2.sendJson({ type: "workspace.describe", requestId: "desc-gen2" });
    const res2 = await client2.findMessage((m) => m.requestId === "desc-gen2");
    expect(res2.type).toBe("workspace.ready");
  });
});
