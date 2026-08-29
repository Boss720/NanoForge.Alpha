/**
 * NanoForge Phase 4 & 5 Empirical Adversarial Stress Test Suite
 * Executed by Challenger 1.
 *
 * Verification of 5 Critical Attack Vectors:
 * 1. Max recursion depth violations (> 3) and concurrency limits (> 8).
 * 2. Path traversal, symlink escapes, and cross-agent metadata write attempts (.agents/<other_id>/).
 * 3. Deadlock prevention on sender crashes with conditional timers (<sender-id>).
 * 4. 2MB circular ring buffer truncation under heavy output stream.
 * 5. Mailbox ACL violations across unauthorized branches and generations.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SubagentSupervisor } from "./supervisor.js";
import { HierarchyManager } from "./hierarchy.js";
import { SubagentMailbox } from "./mailbox.js";
import { SubagentRegistry } from "./registry.js";
import { TaskScheduler } from "../daemons/scheduler.js";
import { CircularRingBuffer } from "../daemons/supervisor.js";
import {
  authorizeSubagentPathAccess,
  canonicalizeSubagentPath,
} from "../policy/policy.js";
import {
  RING_BUFFER_DEFAULT_MAX_BYTES,
  MAX_CONCURRENT_SUBAGENTS,
  MAX_SUBAGENT_HIERARCHY_DEPTH,
  SUBAGENT_ERROR_CODES,
} from "@protocol/index";

describe("Adversarial Stress Target 1: Max Recursion Depth & Concurrency Limits", () => {
  let tmpRoot: string;
  let supervisor: SubagentSupervisor;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-stress-target1-"));
    supervisor = new SubagentSupervisor({ workspaceRoot: tmpRoot });
  });

  afterEach(async () => {
    const activeNodes = supervisor.registry.getAll();
    for (const node of activeNodes) {
      if (node.parentId === null) {
        await supervisor.hierarchy.killTree(node.id, supervisor.registry);
      }
    }
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("strictly prohibits spawning at recursion depth > 3 (SEC-SUB-05)", async () => {
    // Level 1: Root subagent
    const l1 = await supervisor.spawnSubagent({
      name: "l1_lead",
      archetype: "planner",
      prompt: "Root lead agent",
    });
    expect(supervisor.hierarchy.getDepth(l1.subagentId, supervisor.registry)).toBe(1);

    // Level 2: Child subagent
    const l2 = await supervisor.spawnSubagent(
      {
        name: "l2_worker",
        archetype: "implementer",
        prompt: "Level 2 worker",
      },
      l1.subagentId
    );
    expect(supervisor.hierarchy.getDepth(l2.subagentId, supervisor.registry)).toBe(2);

    // Level 3: Grandchild subagent (Max allowed)
    const l3 = await supervisor.spawnSubagent(
      {
        name: "l3_subtask",
        archetype: "qa",
        prompt: "Level 3 QA agent",
      },
      l2.subagentId
    );
    expect(supervisor.hierarchy.getDepth(l3.subagentId, supervisor.registry)).toBe(3);

    // Level 4: Attempt spawn at Depth 4 -> MUST FAIL
    await expect(
      supervisor.spawnSubagent(
        {
          name: "l4_illegal",
          archetype: "specialist",
          prompt: "Level 4 illegal agent",
        },
        l3.subagentId
      )
    ).rejects.toThrow(
      new RegExp(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_MAX_DEPTH_EXCEEDED)
    );
  });

  it("strictly enforces global active concurrency limit (<= 8) and reclaims slots on termination", async () => {
    const spawnedIds: string[] = [];

    // Fill pool to exact max concurrency (8 agents)
    for (let i = 1; i <= MAX_CONCURRENT_SUBAGENTS; i++) {
      const res = await supervisor.spawnSubagent({
        name: `worker_concurrent_${i}`,
        archetype: "implementer",
        prompt: `Execute worker ${i}`,
      });
      spawnedIds.push(res.subagentId);
    }

    expect(supervisor.registry.getActive().length).toBe(8);

    // 9th spawn must be rejected
    await expect(
      supervisor.spawnSubagent({
        name: "worker_overflow_9",
        archetype: "implementer",
        prompt: "Execute worker 9",
      })
    ).rejects.toThrow(
      new RegExp(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_CONCURRENCY_LIMIT_EXCEEDED)
    );

    // Terminate 1 agent via manageSubagents
    const victimId = spawnedIds[0];
    const killResult = await supervisor.manageSubagents({
      action: "kill",
      subagentId: victimId,
    });
    expect(killResult.success).toBe(true);

    // Concurrency is now 7 active agents
    expect(supervisor.registry.getActive().length).toBe(7);

    // Now 9th (slot replacement) succeeds
    const replacement = await supervisor.spawnSubagent({
      name: "worker_replacement_9",
      archetype: "implementer",
      prompt: "Execute worker replacement",
    });

    expect(replacement.subagentId).toBeDefined();
    expect(supervisor.registry.getActive().length).toBe(8);
  });

  it("performs cascading subtree teardown in post-order and frees all concurrency slots", async () => {
    // Build tree: Root (L1) -> Child A (L2) -> Grandchild A1 (L3)
    //                      -> Child B (L2)
    const root = await supervisor.spawnSubagent({
      name: "tree_root",
      archetype: "planner",
      prompt: "Root",
    });
    const childA = await supervisor.spawnSubagent(
      { name: "child_a", archetype: "implementer", prompt: "Child A" },
      root.subagentId
    );
    const grandchildA1 = await supervisor.spawnSubagent(
      { name: "grandchild_a1", archetype: "qa", prompt: "Grandchild A1" },
      childA.subagentId
    );
    const childB = await supervisor.spawnSubagent(
      { name: "child_b", archetype: "implementer", prompt: "Child B" },
      root.subagentId
    );

    expect(supervisor.registry.getActive().length).toBe(4);

    // Kill entire tree starting at root via hierarchy manager
    const killedIds = await supervisor.hierarchy.killTree(root.subagentId, supervisor.registry, {
      workspaceRoot: tmpRoot,
      daemonSupervisor: supervisor.daemons,
      scheduler: supervisor.scheduler,
      reason: "Subtree abort",
    });
    expect(killedIds).toEqual([grandchildA1.subagentId, childA.subagentId, childB.subagentId, root.subagentId]);
    expect(supervisor.registry.getActive().length).toBe(0);
  });

  it("defends against circular parent loops gracefully without stack overflow", () => {
    const registry = new SubagentRegistry();
    const hierarchy = new HierarchyManager();

    // Fabricate malicious cycle A -> B -> C -> A
    const mockNodeA: any = { id: "agent-a", parentId: "agent-c", state: "running" };
    const mockNodeB: any = { id: "agent-b", parentId: "agent-a", state: "running" };
    const mockNodeC: any = { id: "agent-c", parentId: "agent-b", state: "running" };

    registry.register(mockNodeA);
    registry.register(mockNodeB);
    registry.register(mockNodeC);

    // getDepth must terminate due to infinite loop guard (> 100)
    const depth = hierarchy.getDepth("agent-a", registry);
    expect(depth).toBeGreaterThan(3);

    // validateSpawn should reject because depth > 3
    expect(() => hierarchy.validateSpawn("agent-a", registry)).toThrow(
      new RegExp(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_MAX_DEPTH_EXCEEDED)
    );
  });
});

describe("Adversarial Stress Target 2: Path Traversal, Symlink Escapes & Cross-Agent Confinement", () => {
  const workspaceRoot = path.resolve("/app/workspace");

  it("strictly DENIES cross-agent metadata write attempts (.agents/<other_id>/) (SEC-SUB-01)", () => {
    const attackingAgent = {
      subagentId: "11111111-1111-4111-a111-111111111111",
      subagentName: "attacker_agent",
      archetype: "implementer" as const,
      workspaceRoot,
      assignedMetadataDir: ".agents/attacker_agent",
      isolationMode: "inherit" as const,
    };

    // 1. Direct write to other agent's folder
    const decision1 = authorizeSubagentPathAccess(attackingAgent, {
      candidatePath: ".agents/victim_agent/handoff.md",
      operation: "write",
    });
    expect(decision1.allowed).toBe(false);
    expect(decision1.decision).toBe("deny");
    expect(decision1.reason).toContain("SEC-SUB-01 Violation");

    // 2. Traversal out of own folder into other agent's folder
    const decision2 = authorizeSubagentPathAccess(attackingAgent, {
      candidatePath: ".agents/attacker_agent/../victim_agent/secret.key",
      operation: "write",
    });
    expect(decision2.allowed).toBe(false);
    expect(decision2.decision).toBe("deny");
    expect(decision2.reason).toContain("SEC-SUB-01 Violation");

    // 3. Write directly into .agents root directory
    const decision3 = authorizeSubagentPathAccess(attackingAgent, {
      candidatePath: ".agents/global_override.json",
      operation: "write",
    });
    expect(decision3.allowed).toBe(false);
    expect(decision3.decision).toBe("deny");
    expect(decision3.reason).toContain("SEC-SUB-01 Violation");

    // 4. Delete operation on victim metadata
    const decision4 = authorizeSubagentPathAccess(attackingAgent, {
      candidatePath: ".agents/victim_agent/progress.md",
      operation: "delete",
    });
    expect(decision4.allowed).toBe(false);
    expect(decision4.decision).toBe("deny");
  });

  it("allows reading cross-agent metadata for handoff collaboration while protecting writes", () => {
    const readingAgent = {
      subagentId: "11111111-1111-4111-a111-111111111111",
      subagentName: "reader_agent",
      archetype: "implementer" as const,
      workspaceRoot,
      assignedMetadataDir: ".agents/reader_agent",
      isolationMode: "inherit" as const,
    };

    const readDecision = authorizeSubagentPathAccess(readingAgent, {
      candidatePath: ".agents/peer_agent/handoff.md",
      operation: "read",
    });
    expect(readDecision.allowed).toBe(true);
    expect(readDecision.decision).toBe("allow");
  });

  it("blocks directory traversal escaping the workspace via ../, ..\\, and %2e%2e", () => {
    const agent = {
      subagentId: "11111111-1111-4111-a111-111111111111",
      workspaceRoot,
      assignedMetadataDir: ".agents/agent_1",
      isolationMode: "inherit" as const,
    };

    const hostilePaths = [
      "../../../../../../etc/passwd",
      "..\\..\\..\\..\\windows\\system32\\cmd.exe",
      "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fshadow",
      "src/../../../outside.txt",
      "/etc/hosts",
      "C:\\Windows\\System32\\drivers\\etc\\hosts",
      ".agents/agent_1/../../../../etc/passwd",
    ];

    for (const badPath of hostilePaths) {
      const decision = authorizeSubagentPathAccess(agent, {
        candidatePath: badPath,
        operation: "read",
      });
      expect(decision.allowed).toBe(false);
      expect(decision.decision).toBe("deny");
    }
  });

  it("enforces branch isolation mode: writes strictly confined to worktreePath", () => {
    const worktreePath = ".agents/worktrees/isolated_branch_1";
    const branchAgent = {
      subagentId: "branch-worker",
      archetype: "implementer" as const,
      workspaceRoot,
      assignedMetadataDir: ".agents/branch_worker",
      isolationMode: "branch" as const,
      worktreePath,
    };

    // Write inside worktree -> Allowed
    const allowed = authorizeSubagentPathAccess(branchAgent, {
      candidatePath: `${worktreePath}/src/feature.ts`,
      operation: "write",
    });
    expect(allowed.allowed).toBe(true);

    // Write to main repository outside worktree -> Denied
    const denied = authorizeSubagentPathAccess(branchAgent, {
      candidatePath: path.join(workspaceRoot, "src/main_repo.ts"),
      operation: "write",
    });
    expect(denied.allowed).toBe(false);
    expect(denied.decision).toBe("deny");
  });

  it("enforces share isolation mode: writes strictly confined to scratch directory", () => {
    const scratchDir = ".agents/scratch_share_1";
    const shareAgent = {
      subagentId: "share-worker",
      archetype: "implementer" as const,
      workspaceRoot,
      assignedMetadataDir: ".agents/share_worker",
      isolationMode: "share" as const,
      scratchDir,
    };

    // Write inside scratch -> Allowed
    const allowed = authorizeSubagentPathAccess(shareAgent, {
      candidatePath: `${scratchDir}/output.log`,
      operation: "write",
    });
    expect(allowed.allowed).toBe(true);

    // Write to source tree -> Denied
    const denied = authorizeSubagentPathAccess(shareAgent, {
      candidatePath: "src/main.ts",
      operation: "write",
    });
    expect(denied.allowed).toBe(false);
    expect(denied.decision).toBe("deny");
  });
});

describe("Adversarial Stress Target 3: Deadlock Prevention on Sender Crashes & Conditional Timers", () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = new TaskScheduler();
  });

  afterEach(() => {
    scheduler.dispose();
  });

  it("prevents deadlock when monitored sender crashes by synthesizing immediate fallback trigger", () => {
    const crashedSenderId = "99999999-9999-4999-a999-999999999999";
    const triggers: Array<{ prompt: string; iteration: number }> = [];

    scheduler.subscribe((event) => {
      if (event.type === "schedule.triggered") {
        triggers.push({ prompt: event.prompt, iteration: event.iteration });
      }
    });

    // Schedule a 10-minute timer waiting on a subagent
    const scheduleRes = scheduler.schedule({
      prompt: "Await subagent completion",
      durationSeconds: 600,
      timerCondition: crashedSenderId,
    });

    expect(scheduleRes.status).toBe("active");

    // Subagent crashes without sending message -> notifySenderDied called
    const triggeredIds = scheduler.notifySenderDied(crashedSenderId);

    // Verify immediate fallback trigger without waiting 600s
    expect(triggeredIds).toContain(scheduleRes.scheduleId);
    expect(triggers.length).toBe(1);
    expect(triggers[0].prompt).toContain("[FALLBACK: Sender");
    expect(triggers[0].prompt).toContain(crashedSenderId);

    // Status is marked completed
    const record = scheduler.getSchedule(scheduleRes.scheduleId);
    expect(record?.status).toBe("completed");
  });

  it("cancels conditional timer early on expected inbound message", () => {
    const senderId = "88888888-8888-4888-a888-888888888888";
    const scheduleRes = scheduler.schedule({
      prompt: "Await subagent response",
      durationSeconds: 300,
      timerCondition: senderId,
    });

    expect(scheduleRes.status).toBe("active");

    const cancelledIds = scheduler.notifyMessageReceived(senderId);
    expect(cancelledIds).toContain(scheduleRes.scheduleId);

    const record = scheduler.getSchedule(scheduleRes.scheduleId);
    expect(record?.status).toBe("cancelled");
  });

  it("cleans up non-daemon timers automatically when creator subagent terminates", () => {
    const creatorId = "creator-agent-123";

    const t1 = scheduler.schedule(
      { prompt: "Timer 1", durationSeconds: 60, isDaemon: false },
      creatorId
    );
    const t2 = scheduler.schedule(
      { prompt: "Timer 2", durationSeconds: 120, isDaemon: false },
      creatorId
    );
    const tDaemon = scheduler.schedule(
      { prompt: "Daemon Timer", durationSeconds: 300, isDaemon: true },
      creatorId
    );

    // Creator terminates
    scheduler.cancelByCreator(creatorId);

    expect(scheduler.getSchedule(t1.scheduleId)?.status).toBe("cancelled");
    expect(scheduler.getSchedule(t2.scheduleId)?.status).toBe("cancelled");
    expect(scheduler.getSchedule(tDaemon.scheduleId)?.status).toBe("active");
  });
});

describe("Adversarial Stress Target 4: 2MB Circular Ring Buffer Under Heavy Streaming", () => {
  it("enforces strict 2MB memory cap (2,097,152 bytes) under 10MB heavy throughput stream", () => {
    const ring = new CircularRingBuffer(RING_BUFFER_DEFAULT_MAX_BYTES);
    expect(ring.maxBytes).toBe(2097152);

    // Stream 100 chunks of 100KB each (total 10MB)
    const chunkSize = 100 * 1024; // 102400 bytes
    const totalChunks = 100;

    for (let i = 0; i < totalChunks; i++) {
      const tag = `[CHUNK_${i.toString().padStart(3, "0")}]`;
      const fill = "X".repeat(chunkSize - tag.length);
      const chunk = Buffer.from(tag + fill, "utf8");

      ring.append(chunk);

      // Memory boundary invariant: MUST never exceed 2MB
      expect(ring.byteLength).toBeLessThanOrEqual(RING_BUFFER_DEFAULT_MAX_BYTES);
    }

    expect(ring.byteLength).toBe(RING_BUFFER_DEFAULT_MAX_BYTES);
    expect(ring.isTruncated()).toBe(true);

    const logs = ring.readLogs();
    expect(Buffer.byteLength(logs, "utf8")).toBe(RING_BUFFER_DEFAULT_MAX_BYTES);

    // Verify logs contain latest chunks (e.g. CHUNK_099) and evicted older ones (CHUNK_000)
    expect(logs).toContain("[CHUNK_099]");
    expect(logs).toContain("[CHUNK_090]");
    expect(logs).not.toContain("[CHUNK_000]");
    expect(logs).not.toContain("[CHUNK_050]");
  });

  it("handles giant single-chunk overflow (> 2MB in a single write) safely", () => {
    const ring = new CircularRingBuffer(RING_BUFFER_DEFAULT_MAX_BYTES);

    // 4MB single chunk
    const giantChunk = Buffer.alloc(4 * 1024 * 1024, "A");
    giantChunk.write("TAIL_MARKER_END", giantChunk.length - 15, "utf8");

    ring.append(giantChunk);

    expect(ring.byteLength).toBe(RING_BUFFER_DEFAULT_MAX_BYTES);
    expect(ring.isTruncated()).toBe(true);

    const logs = ring.readLogs();
    expect(Buffer.byteLength(logs, "utf8")).toBe(RING_BUFFER_DEFAULT_MAX_BYTES);
    expect(logs.endsWith("TAIL_MARKER_END")).toBe(true);
  });

  it("verifies exact boundary behavior on exact capacity write", () => {
    const ring = new CircularRingBuffer(100);
    const exactBuf = Buffer.alloc(100, "B");

    ring.append(exactBuf);
    expect(ring.byteLength).toBe(100);
    expect(ring.isTruncated()).toBe(true); // >= maxBytes triggers truncation flag

    // Append 1 byte
    ring.append("C");
    expect(ring.byteLength).toBe(100);
    expect(ring.isTruncated()).toBe(true);
    expect(ring.readLogs().endsWith("C")).toBe(true);
  });

  it("handles multi-byte UTF-8 sequences and emojis safely across eviction boundaries", () => {
    const ring = new CircularRingBuffer(50);
    for (let i = 0; i < 20; i++) {
      ring.append(`🚀 Step ${i}: 日本語テキスト\n`);
    }

    expect(ring.byteLength).toBeLessThanOrEqual(50);
    expect(ring.isTruncated()).toBe(true);

    const logs = ring.readLogs();
    expect(typeof logs).toBe("string");
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe("Adversarial Stress Target 5: Mailbox ACL Violations Across Branches & Generations", () => {
  let tmpRoot: string;
  let supervisor: SubagentSupervisor;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-stress-target5-"));
    supervisor = new SubagentSupervisor({ workspaceRoot: tmpRoot });
  });

  afterEach(async () => {
    const activeNodes = supervisor.registry.getAll();
    for (const node of activeNodes) {
      if (node.parentId === null) {
        await supervisor.hierarchy.killTree(node.id, supervisor.registry);
      }
    }
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("enforces SEC-SUB-03 Mailbox ACL across complex hierarchical swarm topology", async () => {
    // TOPOLOGY:
    // Root Orchestrator
    // ├── Branch A (Parent A)
    // │   ├── Worker A1
    // │   └── Worker A2
    // │       └── Sub-worker A2_1
    // └── Branch B (Parent B)
    //     └── Worker B1

    const parentA = await supervisor.spawnSubagent({
      name: "parent_a",
      archetype: "planner",
      prompt: "Lead A",
    });

    const workerA1 = await supervisor.spawnSubagent(
      { name: "worker_a1", archetype: "implementer", prompt: "Worker A1" },
      parentA.subagentId
    );

    const workerA2 = await supervisor.spawnSubagent(
      { name: "worker_a2", archetype: "implementer", prompt: "Worker A2" },
      parentA.subagentId
    );

    const subWorkerA2_1 = await supervisor.spawnSubagent(
      { name: "sub_worker_a2_1", archetype: "qa", prompt: "Sub-worker A2_1" },
      workerA2.subagentId
    );

    const parentB = await supervisor.spawnSubagent({
      name: "parent_b",
      archetype: "planner",
      prompt: "Lead B",
    });

    const workerB1 = await supervisor.spawnSubagent(
      { name: "worker_b1", archetype: "implementer", prompt: "Worker B1" },
      parentB.subagentId
    );

    // ==========================================
    // 1. PERMITTED COMMUNICATIONS (SEC-SUB-03)
    // ==========================================

    // Parent <-> Child (Parent A -> Worker A1)
    await expect(
      supervisor.sendMessage(
        { recipientId: workerA1.subagentId, subject: "Task dispatch", body: "Start work" },
        parentA.subagentId
      )
    ).resolves.toBeDefined();

    // Child <-> Parent (Worker A1 -> Parent A)
    await expect(
      supervisor.sendMessage(
        { recipientId: parentA.subagentId, subject: "Progress report", body: "50% done" },
        workerA1.subagentId
      )
    ).resolves.toBeDefined();

    // Siblings (Worker A1 <-> Worker A2, both have parentA)
    await expect(
      supervisor.sendMessage(
        { recipientId: workerA2.subagentId, subject: "Sync lock", body: "Shared cache updated" },
        workerA1.subagentId
      )
    ).resolves.toBeDefined();

    // Parent <-> Child (Worker A2 <-> Sub-worker A2_1)
    await expect(
      supervisor.sendMessage(
        { recipientId: subWorkerA2_1.subagentId, subject: "Verify unit", body: "Run test" },
        workerA2.subagentId
      )
    ).resolves.toBeDefined();

    // ==========================================
    // 2. FORBIDDEN COMMUNICATIONS (SEC-SUB-03)
    // ==========================================

    // Cross-Branch Cousin (Worker A1 -> Worker B1) -> MUST FAIL
    await expect(
      supervisor.sendMessage(
        { recipientId: workerB1.subagentId, subject: "Cross leak", body: "Unauthorized" },
        workerA1.subagentId
      )
    ).rejects.toThrow(
      new RegExp(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT)
    );

    // Cross-Branch Uncle (Worker A1 -> Parent B) -> MUST FAIL
    await expect(
      supervisor.sendMessage(
        { recipientId: parentB.subagentId, subject: "Cross tree", body: "Unauthorized" },
        workerA1.subagentId
      )
    ).rejects.toThrow(
      new RegExp(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT)
    );

    // Cross-Generation Niece (Worker A1 -> Sub-worker A2_1) -> MUST FAIL
    await expect(
      supervisor.sendMessage(
        { recipientId: subWorkerA2_1.subagentId, subject: "Niece skip", body: "Unauthorized" },
        workerA1.subagentId
      )
    ).rejects.toThrow(
      new RegExp(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT)
    );

    // Grandparent -> Grandchild (Parent A -> Sub-worker A2_1) -> MUST FAIL (skipping intermediate parent)
    await expect(
      supervisor.sendMessage(
        { recipientId: subWorkerA2_1.subagentId, subject: "Grandchild direct", body: "Unauthorized" },
        parentA.subagentId
      )
    ).rejects.toThrow(
      new RegExp(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT)
    );

    // Grandchild -> Grandparent (Sub-worker A2_1 -> Parent A) -> MUST FAIL
    await expect(
      supervisor.sendMessage(
        { recipientId: parentA.subagentId, subject: "Grandparent direct", body: "Unauthorized" },
        subWorkerA2_1.subagentId
      )
    ).rejects.toThrow(
      new RegExp(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT)
    );
  });

  it("prioritizes messages strictly: high > normal > low across high-volume burst", async () => {
    const parent = await supervisor.spawnSubagent({
      name: "parent",
      archetype: "planner",
      prompt: "Parent",
    });

    const child = await supervisor.spawnSubagent(
      { name: "child", archetype: "implementer", prompt: "Child" },
      parent.subagentId
    );

    // Send 30 messages in mixed order (10 low, 10 normal, 10 high)
    const priorities: Array<"high" | "normal" | "low"> = [
      "low", "normal", "high", "low", "high", "normal", "low", "high", "normal", "low",
      "normal", "high", "low", "high", "normal", "low", "normal", "high", "high", "low",
      "normal", "low", "high", "normal", "high", "low", "normal", "high", "low", "normal",
    ];

    for (let i = 0; i < priorities.length; i++) {
      await supervisor.sendMessage(
        {
          recipientId: child.subagentId,
          subject: `Msg ${i}`,
          body: `Content ${i}`,
          priority: priorities[i],
        },
        parent.subagentId
      );
    }

    expect(supervisor.mailbox.getPendingCount(child.subagentId)).toBe(30);

    // Dequeue all and verify priority ordering: ALL 'high' first, then ALL 'normal', then ALL 'low'
    const priorityWeights = { high: 3, normal: 2, low: 1 };
    let lastWeight = 3;

    for (let i = 0; i < 30; i++) {
      const msg = supervisor.mailbox.dequeue(child.subagentId);
      expect(msg).toBeDefined();
      const currentWeight = priorityWeights[msg!.priority];
      expect(currentWeight).toBeLessThanOrEqual(lastWeight);
      lastWeight = currentWeight;
    }
  });
});
