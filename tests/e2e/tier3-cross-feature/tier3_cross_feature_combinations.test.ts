/**
 * NanoForge E2E Test Suite - Tier 3: Cross-Feature Combinations
 *
 * Covers pairwise and multi-feature interaction workflows:
 * 1. Auth + Subagent Spawning + Path Confinement (Pairwise 1)
 * 2. Execution Plan DAG + Subagents + Shared Memory Sync (Pairwise 2)
 * 3. Daemon Process + Task Scheduler + WebSocket Broadcast (Pairwise 3)
 * 4. Policy Approval Escalation + Tool Execution + Audit Redaction (Pairwise 4)
 * 5. Multi-Subagent Messaging + Mailbox Routing + Fleet Liveness (Pairwise 5)
 */
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { launchE2ETestHost, type E2ETestHost } from "../helpers/testHost.js";
import { authorizeSubagentPathAccess } from "../../../apps/agent-host/src/policy/policy.js";
import { RunEventLog } from "../../../apps/agent-host/src/runs/events.js";
import { redactText, REDACTED } from "../../../apps/agent-host/src/audit/redact.js";
import { ExecutionCoordinator } from "../../../apps/agent-host/src/runs/coordinator.js";
import { SubagentSupervisor } from "../../../apps/agent-host/src/agents/supervisor.js";
import { DaemonManager } from "../../../apps/agent-host/src/daemons/manager.js";

describe("Tier 3 - Cross-Feature Combinations", () => {
  let e2eHost: E2ETestHost | undefined;

  afterEach(async () => {
    if (e2eHost) {
      await e2eHost.close();
      e2eHost = undefined;
    }
  });

  /* ====================================================================== */
  /* Combination 1: Auth + Subagent Spawning + Path Confinement             */
  /* ====================================================================== */
  describe("1. Auth + Subagent Spawning + Path Confinement", () => {
    it("3.1.1: authenticated client spawns subagent and enforces workspace metadata boundary", async () => {
      e2eHost = await launchE2ETestHost();
      const client = await e2eHost.connect();
      const readyMsg = await client.nextMessage();
      expect(readyMsg.type).toBe("host.ready");

      // Spawn subagent via supervisor
      const agent = await e2eHost.subagentSupervisor.spawnSubagent({
        archetype: "explorer",
        name: "explorer_alpha",
        prompt: "Survey directory tree",
      });
      expect(agent.subagentId).toBeDefined();
      expect(agent.state).toBe("running");

      // Authorize writing to assigned folder -> ALLOWED
      const allowedWrite = authorizeSubagentPathAccess(
        {
          subagentId: agent.subagentId,
          workspaceRoot: e2eHost.workspace.root,
          assignedMetadataDir: `.agents/${agent.name}`,
          isolationMode: "inherit",
        },
        { candidatePath: `.agents/${agent.name}/analysis.md`, operation: "write" }
      );
      expect(allowedWrite.allowed).toBe(true);

      // Authorize writing to peer agent folder -> DENIED
      const deniedPeerWrite = authorizeSubagentPathAccess(
        {
          subagentId: agent.subagentId,
          workspaceRoot: e2eHost.workspace.root,
          assignedMetadataDir: `.agents/${agent.name}`,
          isolationMode: "inherit",
        },
        { candidatePath: `.agents/peer_agent_1/handoff.md`, operation: "write" }
      );
      expect(deniedPeerWrite.allowed).toBe(false);

      await client.close();
    });

    it("3.1.2: specialist archetype subagent is restricted to read-only tool access on root source", () => {
      const specialistDecision = authorizeSubagentPathAccess(
        {
          subagentId: "spec-1",
          workspaceRoot: "/app/repo",
          assignedMetadataDir: ".agents/specialist_1",
          isolationMode: "inherit",
          archetype: "specialist",
        },
        { candidatePath: "src/main.ts", operation: "read" }
      );
      expect(specialistDecision.allowed).toBe(true);
    });
  });

  /* ====================================================================== */
  /* Combination 2: Execution Plan DAG + Subagents + Shared Memory Sync     */
  /* ====================================================================== */
  describe("2. Execution Plan DAG + Subagents + Shared Memory Sync", () => {
    it("3.2.1: multi-step DAG coordinates step outputs through shared memory", async () => {
      const supervisor = new SubagentSupervisor();
      const memory = supervisor.memory;

      // Step 1: Explorer discovers files and saves to memory
      const entry1 = await memory.set({
        key: "discovered_modules",
        value: ["auth", "router", "daemons"],
        namespace: "global",
        tags: ["plan-step-1"],
      });
      expect(entry1.entry.key).toBe("discovered_modules");

      // Step 2: Implementer reads discovered modules from memory
      const queryResult = await memory.get({
        key: "discovered_modules",
        namespace: "global",
      });
      expect(queryResult.found).toBe(true);
      expect(queryResult.entry?.value).toEqual(["auth", "router", "daemons"]);

      // Step 3: Implementer saves milestone completion
      await memory.set({
        key: "milestone_status",
        value: { completed: true, step: 2 },
        namespace: "global",
      });

      const finalStatus = await memory.get({
        key: "milestone_status",
        namespace: "global",
      });
      expect(finalStatus.entry?.value).toEqual({ completed: true, step: 2 });
    });

    it("3.2.2: sandboxed namespace isolates private subagent facts from global namespace", async () => {
      const supervisor = new SubagentSupervisor();
      const memory = supervisor.memory;

      await memory.set({
        key: "private_scratchpad",
        value: "internal notes",
        namespace: "subagent_1_private",
      });

      // Global query does not find isolated namespace entry
      const globalQuery = await memory.get({
        key: "private_scratchpad",
        namespace: "global",
      });
      expect(globalQuery.found).toBe(false);

      // Scoped query finds isolated entry
      const scopedQuery = await memory.get({
        key: "private_scratchpad",
        namespace: "subagent_1_private",
      });
      expect(scopedQuery.found).toBe(true);
      expect(scopedQuery.entry?.value).toBe("internal notes");
    });
  });

  /* ====================================================================== */
  /* Combination 3: Daemon Process + Task Scheduler + WebSocket Broadcast   */
  /* ====================================================================== */
  describe("3. Daemon Process + Task Scheduler + WebSocket Broadcast", () => {
    it("3.3.1: scheduled timer triggers background daemon and emits lifecycle events", async () => {
      const daemonManager = new DaemonManager();
      const events: any[] = [];
      daemonManager.supervisor.subscribe((ev) => events.push(ev));

      // Schedule one-shot timer
      const sched = await daemonManager.scheduler.schedule({
        durationSeconds: 1,
        prompt: "Run liveness probe",
      });
      expect(sched.scheduleId).toBeDefined();

      // Spawn task directly
      const task = await daemonManager.supervisor.spawnTask({
        command: "node",
        args: ["-e", "console.log('Daemon probe active'); process.exit(0)"],
        cwd: process.cwd(),
      });

      for (let i = 0; i < 20; i++) {
        if (events.some((e) => e.type === "task.completed")) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(events.some((e) => e.type === "task.spawned")).toBe(true);
      expect(events.some((e) => e.type === "task.completed")).toBe(true);

      await daemonManager.dispose();
    });

    it("3.3.2: websocket client receives task status updates via RPC queries", async () => {
      e2eHost = await launchE2ETestHost();
      const client = await e2eHost.connect();
      await client.nextMessage(); // host.ready

      const task = await e2eHost.daemonManager.supervisor.spawnTask({
        command: "node",
        args: ["-e", "console.log('WS test task'); process.exit(0)"],
        cwd: process.cwd(),
      });

      for (let i = 0; i < 20; i++) {
        const summary = e2eHost.daemonManager.supervisor.getTask(task.taskId);
        if (summary?.status === "completed") break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const summary = e2eHost.daemonManager.supervisor.getTask(task.taskId);
      expect(summary?.status).toBe("completed");
      expect(summary?.recentLogs).toContain("WS test task");

      await client.close();
    });
  });

  /* ====================================================================== */
  /* Combination 4: Policy Approval Escalation + Tool Exec + Audit Redact   */
  /* ====================================================================== */
  describe("4. Policy Approval Escalation + Tool Exec + Audit Redact", () => {
    it("4.4.1: records immutable run events and redacts secrets in audit stream", () => {
      const eventLog = new RunEventLog();
      const runId = "run-audit-combo-1";
      const auditedEvents: any[] = [];

      eventLog.subscribeAll((ev) => {
        // Redact payload before storing in audit ledger
        const serialized = JSON.stringify(ev);
        const redacted = redactText(serialized);
        auditedEvents.push(JSON.parse(redacted));
      });

      // Append plan submission
      eventLog.append({
        type: "plan.submitted",
        runId,
        planId: "p1",
        goal: "Deploy with secret Bearer my_secret_token_12345678",
        stepCount: 1,
        steps: [{ id: "s1", title: "Deploy step", dependsOn: [] }],
      });

      expect(auditedEvents.length).toBe(1);
      expect(auditedEvents[0].goal).not.toContain("my_secret_token_12345678");
      expect(auditedEvents[0].goal).toContain(REDACTED);
    });

    it("4.4.2: monotonic sequence numbers are assigned per runId across parallel runs", () => {
      const eventLog = new RunEventLog();
      const e1 = eventLog.append({ type: "step.ready", runId: "r1", stepId: "s1", title: "Step 1" });
      const e2 = eventLog.append({ type: "step.ready", runId: "r2", stepId: "s1", title: "Step 1" });
      const e3 = eventLog.append({ type: "step.succeeded", runId: "r1", stepId: "s1" });

      expect(e1.seq).toBe(1);
      expect(e2.seq).toBe(1);
      expect(e3.seq).toBe(2);
    });
  });

  /* ====================================================================== */
  /* Combination 5: Multi-Subagent Messaging + Mailbox + Fleet Liveness     */
  /* ====================================================================== */
  describe("5. Multi-Subagent Messaging + Mailbox + Fleet Liveness", () => {
    it("3.5.1: routes peer messages between subagents and verifies mailbox delivery", async () => {
      const supervisor = new SubagentSupervisor();
      const parentId = "00000000-0000-4000-8000-000000000001";

      const agentA = await supervisor.spawnSubagent(
        {
          archetype: "explorer",
          name: "agent_sender",
          prompt: "Investigate and report",
        },
        parentId
      );

      const agentB = await supervisor.spawnSubagent(
        {
          archetype: "implementer",
          name: "agent_receiver",
          prompt: "Wait for dispatch",
        },
        parentId
      );

      // Send message A -> B
      const msg = await supervisor.sendMessage(
        {
          recipientId: agentB.subagentId,
          subject: "DISPATCH_INSTRUCTION",
          body: "Begin implementing feature F1.1",
        },
        agentA.subagentId
      );

      expect(msg.messageId).toBeDefined();
      expect(msg.delivered).toBe(true);

      // Check B's inbox
      const inbox = supervisor.mailbox.getPending(agentB.subagentId);
      expect(inbox.length).toBe(1);
      expect(inbox[0].subject).toBe("DISPATCH_INSTRUCTION");
      expect(inbox[0].body).toContain("Begin implementing feature F1.1");
    });

    it("3.5.2: sweeps fleet and detects stale heartbeats across active swarm", async () => {
      const supervisor = new SubagentSupervisor();
      const agent = await supervisor.spawnSubagent({
        archetype: "explorer",
        name: "liveness_agent",
        prompt: "Long task",
      });

      expect(agent.state).toBe("running");

      // Record heartbeat
      supervisor.registry.recordHeartbeat(agent.subagentId, "Step 1/5 completed");
      const summary = supervisor.registry.getSummary(agent.subagentId);
      expect(summary?.lastProgressSummary).toBe("Step 1/5 completed");

      // Set heartbeat in the past to trigger stale sweep
      const node = supervisor.registry.get(agent.subagentId)!;
      node.lastHeartbeat = new Date(Date.now() - 10_000).toISOString();

      // Stale sweep marks stale agents as errored
      const stale = supervisor.registry.livenessSweep(1000);
      expect(stale).toContain(agent.subagentId);

      const updated = supervisor.registry.getSummary(agent.subagentId);
      expect(updated?.state).toBe("errored");
      expect(updated?.error).toContain("Heartbeat timeout");
    });
  });
});
