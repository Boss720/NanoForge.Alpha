/**
 * NanoForge E2E Test Suite - Tier 4: Real-World Application Scenarios
 *
 * Implements full end-to-end user workflows matching TEST_INFRA.md:
 * - Scenario 1: Full Session Lifecycle & Streaming
 * - Scenario 2: Subagent Swarm Multi-Agent Collaboration
 * - Scenario 3: Long-Running Build & Interactive Daemon
 * - Scenario 4: Failure Escalation Ladder & Replacement Recovery
 * - Scenario 5: Programmatic SDK Automated Execution
 */
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { launchE2ETestHost, type E2ETestHost } from "../helpers/testHost.js";
import { saveState, loadState } from "../../../src/lib/persist.js";
import { RunEventLog } from "../../../apps/agent-host/src/runs/events.js";
import { SubagentSupervisor } from "../../../apps/agent-host/src/agents/supervisor.js";
import { DaemonSupervisor } from "../../../apps/agent-host/src/daemons/supervisor.js";
import { TaskScheduler } from "../../../apps/agent-host/src/daemons/scheduler.js";
import { SDK_VERSION } from "@nanoforge/sdk";

describe("Tier 4 - Real-World Application Workflows", () => {
  let e2eHost: E2ETestHost | undefined;

  afterEach(async () => {
    if (e2eHost) {
      await e2eHost.close();
      e2eHost = undefined;
    }
  });

  /* ====================================================================== */
  /* Scenario 1: Full Session Lifecycle & Streaming                         */
  /* ====================================================================== */
  it("Scenario 1: executes full session lifecycle (connect -> plan -> stream -> persist -> reload)", async () => {
    e2eHost = await launchE2ETestHost();
    const client = await e2eHost.connect();

    // 1. Receive host.ready
    const readyMsg = await client.nextMessage();
    expect(readyMsg.type).toBe("host.ready");

    // 2. Submit execution plan
    const runId = "run-workflow-scenario-1";
    const eventLog = new RunEventLog();

    const planEvent = eventLog.append({
      type: "plan.submitted",
      runId,
      planId: "plan-1",
      goal: "Analyze and refactor codebase",
      stepCount: 2,
      steps: [
        { id: "s1", title: "Analyze code", dependsOn: [] },
        { id: "s2", title: "Refactor code", dependsOn: ["s1"] },
      ],
    });
    expect(planEvent.seq).toBe(1);

    // 3. Simulate step streaming
    eventLog.append({ type: "step.ready", runId, stepId: "s1", title: "Analyze code" });
    eventLog.append({ type: "step.succeeded", runId, stepId: "s1", outputDigest: "abc123digest" });
    eventLog.append({ type: "step.ready", runId, stepId: "s2", title: "Refactor code" });
    eventLog.append({ type: "step.succeeded", runId, stepId: "s2", outputDigest: "def456digest" });
    const completedEvent = eventLog.append({ type: "run.completed", runId, stepsSucceeded: 2 });
    expect(completedEvent.stepsSucceeded).toBe(2);

    // 4. Client state persistence
    const inMemoryStorage: Record<string, string> = {};
    const mockStorage = {
      getItem: (k: string) => inMemoryStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        inMemoryStorage[k] = v;
      },
      removeItem: (k: string) => {
        delete inMemoryStorage[k];
      },
    };

    const sessionData = {
      version: 1,
      sessions: [
        {
          id: "session-1",
          name: "Refactor Session",
          turns: [
            { id: "t1", role: "user", text: "Refactor code" },
            { id: "t2", role: "assistant", text: "Refactoring completed successfully." },
          ],
        },
      ],
      usage: { inputTokens: 1500, outputTokens: 600, costUsd: 0.045 },
      files: [],
    };

    const saved = saveState(sessionData, mockStorage);
    expect(saved).toBe(true);

    // 5. Reload session and verify complete history recovery
    const reloaded = loadState(mockStorage);
    expect(reloaded).toBeDefined();
    expect(reloaded?.sessions.length).toBe(1);
    expect(reloaded?.sessions[0].name).toBe("Refactor Session");
    expect(reloaded?.usage.inputTokens).toBe(1500);

    await client.close();
  });

  /* ====================================================================== */
  /* Scenario 2: Subagent Swarm Multi-Agent Collaboration                   */
  /* ====================================================================== */
  it("Scenario 2: executes subagent swarm multi-agent collaboration (explorer -> implementer -> reviewer)", async () => {
    e2eHost = await launchE2ETestHost();
    const supervisor = e2eHost.subagentSupervisor;
    const parentId = "00000000-0000-4000-8000-000000000002";

    // 1. Spawn Explorer
    const explorer = await supervisor.spawnSubagent(
      {
        archetype: "explorer",
        name: "explorer_sc2",
        prompt: "Survey codebase and discover components",
      },
      parentId
    );

    // Explorer writes analysis to assigned directory
    const explorerNode = supervisor.registry.get(explorer.subagentId)!;
    const explorerAnalysis = path.join(
      e2eHost.workspace.root,
      explorerNode.metadataDir,
      "analysis.md"
    );
    await fs.writeFile(explorerAnalysis, "# Analysis\nFound 3 target modules.", "utf8");

    // Explorer stores findings in shared memory
    await supervisor.memory.set({
      key: "survey_summary",
      value: { modulesFound: 3, targets: ["auth", "daemons", "policy"] },
      namespace: "global",
    });

    // 2. Spawn Implementer
    const implementer = await supervisor.spawnSubagent(
      {
        archetype: "implementer",
        name: "implementer_sc2",
        prompt: "Implement required updates based on explorer findings",
      },
      parentId
    );

    // Explorer sends dispatch message to implementer
    await supervisor.sendMessage(
      {
        recipientId: implementer.subagentId,
        subject: "SURVEY_COMPLETED",
        body: "Survey is complete. Check shared memory for target modules.",
      },
      explorer.subagentId
    );

    // Implementer reads shared memory
    const findings = await supervisor.memory.get({
      key: "survey_summary",
      namespace: "global",
    });
    expect(findings.found).toBe(true);
    expect((findings.entry?.value as any).modulesFound).toBe(3);

    // 3. Spawn Reviewer/Verifier
    const reviewer = await supervisor.spawnSubagent(
      {
        archetype: "verifier",
        name: "reviewer_sc2",
        prompt: "Review implementation diffs and approve milestone",
      },
      parentId
    );

    // Implementer sends completion message to Reviewer
    await supervisor.sendMessage(
      {
        recipientId: reviewer.subagentId,
        subject: "IMPLEMENTATION_READY",
        body: "Implementation completed. Ready for verification.",
      },
      implementer.subagentId
    );

    const reviewerInbox = supervisor.mailbox.getPending(reviewer.subagentId);
    expect(reviewerInbox.length).toBe(1);
    expect(reviewerInbox[0].subject).toBe("IMPLEMENTATION_READY");

    // Reviewer updates final status in shared memory
    await supervisor.memory.set({
      key: "milestone_approved",
      value: true,
      namespace: "global",
    });

    const approved = await supervisor.memory.get({
      key: "milestone_approved",
      namespace: "global",
    });
    expect(approved.entry?.value).toBe(true);
  });

  /* ====================================================================== */
  /* Scenario 3: Long-Running Build & Interactive Daemon                     */
  /* ====================================================================== */
  it("Scenario 3: supervises long-running background daemon process with interactive STDIN", async () => {
    const supervisor = new DaemonSupervisor();

    // 1. Spawn interactive daemon process echoing input
    const task = await supervisor.spawnTask({
      command: "node",
      args: [
        "-e",
        `
        process.stdin.on('data', (data) => {
          const text = data.toString().trim();
          console.log('ECHO:' + text);
          if (text === 'SHUTDOWN') {
            process.exit(0);
          }
        });
        console.log('DAEMON_ONLINE');
        setInterval(() => {}, 1000);
      `,
      ],
      cwd: process.cwd(),
      isDaemon: true,
    });

    expect(task.status).toBe("running");
    let initialSummary = supervisor.getTask(task.taskId);
    for (let i = 0; i < 40 && !initialSummary?.recentLogs?.includes("DAEMON_ONLINE"); i++) {
      await new Promise((r) => setTimeout(r, 100));
      initialSummary = supervisor.getTask(task.taskId);
    }

    // 2. Verify initial output in ring buffer
    expect(initialSummary?.recentLogs).toContain("DAEMON_ONLINE");

    // 3. Send interactive input
    const inputRes = await supervisor.sendInput(task.taskId, "PING_COMMAND");
    expect(inputRes.success).toBe(true);
    let updatedSummary = supervisor.getTask(task.taskId);
    for (let i = 0; i < 40 && !updatedSummary?.recentLogs?.includes("ECHO:PING_COMMAND"); i++) {
      await new Promise((r) => setTimeout(r, 100));
      updatedSummary = supervisor.getTask(task.taskId);
    }

    // 4. Verify echo response
    expect(updatedSummary?.recentLogs).toContain("ECHO:PING_COMMAND");

    // 5. Send graceful shutdown command
    await supervisor.sendInput(task.taskId, "SHUTDOWN");
    let finalSummary = supervisor.getTask(task.taskId);
    for (let i = 0; i < 40 && finalSummary?.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      finalSummary = supervisor.getTask(task.taskId);
    }

    expect(["completed", "killed", "failed"]).toContain(finalSummary?.status);
    expect(finalSummary?.recentLogs).toContain("ECHO:SHUTDOWN");

    await supervisor.killAll();
  }, 20000);

  /* ====================================================================== */
  /* Scenario 4: Failure Escalation Ladder & Replacement Recovery           */
  /* ====================================================================== */
  it("Scenario 4: recovers from subagent token budget failure via 5-rung escalation replace ladder", async () => {
    const supervisor = new SubagentSupervisor();

    // 1. Spawn agent with small token budget (100 tokens)
    const agent = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "budget_constrained_agent",
      prompt: "Implement complex mathematical proofs",
      budgetTokens: 100,
    });

    expect(agent.state).toBe("running");

    // 2. Agent consumes 150 tokens, exceeding budget limit
    supervisor.recordTokens(agent.subagentId, 150);

    const erroredAgent = supervisor.registry.get(agent.subagentId);
    expect(erroredAgent?.state).toBe("errored");
    expect(erroredAgent?.error).toContain("Token budget limit exceeded");

    // 3. Trigger Failure Escalation Ladder (Rung: Replace)
    const escalation = await supervisor.escalateFailure(
      agent.subagentId,
      "Token budget exceeded during heavy calculation",
      "replace"
    );

    expect(escalation.rung).toBe("replace");
    expect(escalation.replacementSubagentId).toBeDefined();

    // 4. Verify fresh replacement clone exists and is active
    const clone = supervisor.registry.get(escalation.replacementSubagentId!);
    expect(clone).toBeDefined();
    expect(clone?.state).toBe("running");
    expect(clone?.name).toContain("_clone");
  });

  /* ====================================================================== */
  /* Scenario 5: Programmatic SDK Automated Execution                       */
  /* ====================================================================== */
  it("Scenario 5: executes programmatic SDK automation client interaction", async () => {
    e2eHost = await launchE2ETestHost();

    // 1. Verify SDK Metadata
    expect(SDK_VERSION).toBe("0.1.0");

    // 2. Query host health programmatically
    const res = await fetch(`http://127.0.0.1:${e2eHost.host.port}/health`);
    expect(res.status).toBe(200);
    const health = (await res.json()) as { ok: boolean; version: string };
    expect(health.ok).toBe(true);

    // 3. Authenticate and connect client
    const client = await e2eHost.connect();
    const ready = await client.nextMessage();
    expect(ready.type).toBe("host.ready");

    // 4. Send ping RPC and receive pong
    client.sendJson({ type: "ping" });
    const pong = await client.nextMessage();
    expect(pong.type).toBe("pong");

    // 5. Close connection cleanly
    const closeRes = await client.close();
    expect([1000, 1001, 1005, 1006]).toContain(closeRes.code);
  });
});
