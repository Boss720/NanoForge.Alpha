import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SubagentSupervisor } from "./supervisor.js";
import * as gitWorktree from "../workspace/gitWorktree.js";
import {
  executeInvokeSubagentTool,
  executeManageSubagentsTool,
  executeSendMessageTool,
  executeDefineSubagentTool,
} from "./tools.js";

describe("SubagentSupervisor & Lifecycle Management", () => {
  let tmpRoot: string;
  let supervisor: SubagentSupervisor;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-supervisor-test-"));
    supervisor = new SubagentSupervisor({ workspaceRoot: tmpRoot });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("spawns a child subagent and writes initial metadata files", async () => {
    const events: string[] = [];
    supervisor.subscribe((e) => events.push(e.type));

    const result = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "imp_module2",
      prompt: "Implement Fastify routes",
      workspaceIsolation: "inherit",
    });

    expect(result.subagentId).toBeDefined();
    expect(result.name).toBe("imp_module2");
    expect(result.state).toBe("running");

    const node = supervisor.registry.get(result.subagentId);
    expect(node).toBeDefined();

    // Verify metadata files were created
    const metadataDir = path.resolve(tmpRoot, node!.metadataDir);
    const briefingContent = await fs.readFile(path.join(metadataDir, "BRIEFING.md"), "utf8");
    const dispatchContent = await fs.readFile(path.join(metadataDir, "DISPATCH.md"), "utf8");
    const progressContent = await fs.readFile(path.join(metadataDir, "progress.md"), "utf8");

    expect(briefingContent).toContain("imp_module2");
    expect(dispatchContent).toContain("Implement Fastify routes");
    expect(progressContent).toContain("Task initialized");

    expect(events).toContain("subagent.spawned");
    expect(events).toContain("subagent.tree_updated");
  });

  it("inherits the active host workspace without publishing its canonical path", async () => {
    const result = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "active_workspace_worker",
      prompt: "Work in the folder selected by the host",
      workspaceIsolation: "inherit",
    });
    const node = supervisor.registry.get(result.subagentId)!;
    const summary = supervisor.registry.getSummary(result.subagentId)!;

    expect(node.assignedWorkspaceRoot).toBe(tmpRoot);
    expect(node.workingDirectory).toBe(".");
    expect(result.workingDirectory).toBe(".");
    expect(JSON.stringify(summary)).not.toContain(tmpRoot);
  });

  it("gives branch-isolated agents their own internal worktree and only exposes a relative path", async () => {
    const worktreeSpy = vi.spyOn(gitWorktree, "createWorktree").mockImplementation(
      async (workspaceRoot, relativeWorktreePath, branchName) => ({
        success: true,
        worktreePath: path.resolve(workspaceRoot, relativeWorktreePath),
        branch: branchName,
      }),
    );

    try {
      const result = await supervisor.spawnSubagent({
        archetype: "implementer",
        name: "branch_workspace_worker",
        prompt: "Work in an isolated branch",
        workspaceIsolation: "branch",
      });
      const node = supervisor.registry.get(result.subagentId)!;
      const summary = supervisor.registry.getSummary(result.subagentId)!;

      expect(node.assignedWorkspaceRoot).not.toBe(tmpRoot);
      expect(node.assignedWorkspaceRoot).toBe(path.resolve(tmpRoot, node.worktreePath!));
      expect(node.workingDirectory).toBe(node.worktreePath);
      expect(result.workingDirectory).toBe(node.worktreePath);
      expect(JSON.stringify(summary)).not.toContain(tmpRoot);
    } finally {
      worktreeSpy.mockRestore();
    }
  });

  it("denies mutation before any subagent state or files are created when enforcement is enabled", async () => {
    const guarded = new SubagentSupervisor({
      workspaceRoot: tmpRoot,
      enforceMutationAuthorization: true,
      authorizeMutation: () => false,
    });

    await expect(guarded.spawnSubagent({
      archetype: "implementer",
      prompt: "sensitive task text",
    })).rejects.toThrow("Subagent mutation denied");
    expect(guarded.registry.getAll()).toHaveLength(0);
    const listing = await guarded.manageSubagents({ action: "list" });
    expect(listing.success).toBe(true);
    await expect(fs.access(path.join(tmpRoot, ".agents"))).rejects.toThrow();
    await guarded.dispose();
  });

  it("passes a redacted authorization context for a valid spawn", async () => {
    const contexts: unknown[] = [];
    const guarded = new SubagentSupervisor({
      workspaceRoot: tmpRoot,
      enforceMutationAuthorization: true,
      authorizeMutation: (context) => {
        contexts.push(context);
        return true;
      },
    });

    const spawned = await guarded.spawnSubagent({
      archetype: "implementer",
      name: "safe_name",
      prompt: "do not expose this prompt",
    });
    expect(spawned.subagentId).toBeDefined();
    expect(contexts).toHaveLength(1);
    const context = contexts[0] as { operation: string; metadata: Record<string, unknown> };
    expect(context.operation).toBe("spawn");
    expect(context.metadata).not.toHaveProperty("prompt");
    expect(JSON.stringify(context)).not.toContain("do not expose this prompt");
    expect(guarded.registry.getAll()).toHaveLength(1);
    await guarded.dispose();
  });

  it("enforces token budget limits and triggers escalation on breach (SEC-SUB-04)", async () => {
    const events: string[] = [];
    supervisor.subscribe((e) => events.push(e.type));
    const agentId = "88888888-8888-4888-8888-888888888888";

    const node: any = {
      id: agentId,
      parentId: null,
      name: "budget_agent",
      archetype: "implementer",
      roles: ["implementer"],
      workingDirectory: tmpRoot,
      metadataDir: ".agents/budget_agent",
      isolationMode: "inherit",
      budgetTokens: 5000,
      tokensUsed: 0,
      turnCount: 0,
      state: "running",
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      abortController: new AbortController(),
      skills: [],
    };

    supervisor.registry.register(node);

    // Record usage within budget
    supervisor.recordTokens(node.id, 2000);
    expect(supervisor.registry.get(node.id)?.state).toBe("running");

    // Record usage exceeding budget (total 6000 > 5000)
    supervisor.recordTokens(node.id, 4000);

    const updated = supervisor.registry.get(node.id);
    expect(updated?.state).toBe("errored");
    expect(updated?.error).toContain("Token budget limit exceeded");
    expect(events).toContain("subagent.errored");

    // Wait for background async escalation to complete and settle before teardown
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it("handles 5-rung failure escalation ladder", async () => {
    const parent = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "failing_agent",
      prompt: "Do complex task",
    });

    // 1. Retry rung
    const retryDec = await supervisor.escalateFailure(parent.subagentId, "Transient network timeout", "retry");
    expect(retryDec.rung).toBe("retry");

    // 2. Skip rung
    const skipDec = await supervisor.escalateFailure(parent.subagentId, "Cosmetic style warning", "skip");
    expect(skipDec.rung).toBe("skip");

    // 3. Degrade rung
    const degradeDec = await supervisor.escalateFailure(parent.subagentId, "Fatal build block", "degrade");
    expect(degradeDec.rung).toBe("degrade");

    // 4. Replace rung
    const replaceDec = await supervisor.escalateFailure(parent.subagentId, "Context window full", "replace");
    expect(replaceDec.rung).toBe("replace");
    expect(replaceDec.replacementSubagentId).toBeDefined();

    // 5. Redistribute rung
    const redistDec = await supervisor.escalateFailure(parent.subagentId, "Task too complex", "redistribute");
    expect(redistDec.rung).toBe("redistribute");
    expect(redistDec.replacementSubagentId).toBeDefined();
  });

  it("handles escalation failure gracefully and falls back to degrade without throwing", async () => {
    const parent = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "isolated_agent",
      prompt: "Execute within failing environment",
    });

    // Force spawn to fail during replace by mocking spawnSubagent
    const originalSpawn = supervisor.spawnSubagent.bind(supervisor);
    supervisor.spawnSubagent = async () => {
      throw new Error("Disk quota exceeded / simulated spawn failure");
    };

    const decision = await supervisor.escalateFailure(parent.subagentId, "Simulated root failure", "replace");
    expect(decision.rung).toBe("degrade");
    expect(decision.reason).toContain("Replacement failed");

    // Restore original method
    supervisor.spawnSubagent = originalSpawn;
  });

  it("supports manageSubagents tool actions (list, status, pause, resume, inspect, kill)", async () => {
    const agent = await executeInvokeSubagentTool(supervisor, {
      archetype: "qa",
      name: "qa_inspector",
      prompt: "Inspect files and run tests",
    });

    // 1. List
    const listRes = await executeManageSubagentsTool(supervisor, { action: "list" });
    expect(listRes.success).toBe(true);
    expect(listRes.subagents?.length).toBeGreaterThanOrEqual(1);

    // 2. Status
    const statusRes = await executeManageSubagentsTool(supervisor, {
      action: "status",
      subagentId: agent.subagentId,
    });
    expect(statusRes.success).toBe(true);
    expect(statusRes.detail?.name).toBe("qa_inspector");

    // 3. Pause
    const pauseRes = await executeManageSubagentsTool(supervisor, {
      action: "pause",
      subagentId: agent.subagentId,
    });
    expect(pauseRes.success).toBe(true);
    expect(supervisor.registry.get(agent.subagentId)?.state).toBe("idle");

    // 4. Resume
    const resumeRes = await executeManageSubagentsTool(supervisor, {
      action: "resume",
      subagentId: agent.subagentId,
    });
    expect(resumeRes.success).toBe(true);
    expect(supervisor.registry.get(agent.subagentId)?.state).toBe("running");

    // 5. Inspect
    const inspectRes = await executeManageSubagentsTool(supervisor, {
      action: "inspect",
      subagentId: agent.subagentId,
      inspectFile: "BRIEFING.md",
    });
    expect(inspectRes.success).toBe(true);
    expect(inspectRes.inspectedContent).toContain("qa_inspector");

    // 6. Kill
    const killRes = await executeManageSubagentsTool(supervisor, {
      action: "kill",
      subagentId: agent.subagentId,
    });
    expect(killRes.success).toBe(true);
    expect(supervisor.registry.get(agent.subagentId)?.state).toBe("errored");
  });

  it("handles send_message tool and defines dynamic subagents", async () => {
    const parent = await supervisor.spawnSubagent({
      archetype: "planner",
      name: "planner_agent",
      prompt: "Plan phases",
    });

    const child = await supervisor.spawnSubagent(
      {
        archetype: "implementer",
        name: "worker_agent",
        prompt: "Execute phases",
      },
      parent.subagentId
    );

    // Send message from parent to child
    const sendRes = await executeSendMessageTool(
      supervisor,
      {
        recipientId: child.subagentId,
        subject: "Phase 1 specification",
        body: "Here is the Phase 1 spec",
        priority: "high",
      },
      parent.subagentId
    );

    expect(sendRes.delivered).toBe(true);
    expect(supervisor.mailbox.getPendingCount(child.subagentId)).toBe(1);

    // Define custom subagent template
    const defRes = await executeDefineSubagentTool(supervisor, {
      name: "PerfOptimizer",
      description: "Profile and optimize memory usage",
      systemPromptTemplate: "You are a performance optimization expert...",
      defaultRoles: ["specialist"],
    });

    expect(defRes.registered).toBe(true);
    expect(defRes.name).toBe("PerfOptimizer");
    expect(supervisor.registry.getTemplate("PerfOptimizer")).toBeDefined();
  });
});
