import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SubagentSupervisor } from "./supervisor.js";
import { createSubagentMessage } from "@protocol/subagents";

describe("Subagent Adversarial & Attack Vector Tests", () => {
  let tmpRoot: string;
  let supervisor: SubagentSupervisor;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-adversarial-test-"));
    supervisor = new SubagentSupervisor({ workspaceRoot: tmpRoot });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("prevents deeply nested fork bomb attempts (Depth Limit SEC-SUB-05)", async () => {
    // Level 1
    const l1 = await supervisor.spawnSubagent({
      archetype: "planner",
      name: "l1_root",
      prompt: "Level 1 agent",
    });

    // Level 2
    const l2 = await supervisor.spawnSubagent(
      {
        archetype: "implementer",
        name: "l2_child",
        prompt: "Level 2 agent",
      },
      l1.subagentId
    );

    // Level 3 (Max allowed)
    const l3 = await supervisor.spawnSubagent(
      {
        archetype: "qa",
        name: "l3_grandchild",
        prompt: "Level 3 agent",
      },
      l2.subagentId
    );

    // Level 4 (Attempt to spawn beyond max depth) -> MUST REJECT
    await expect(
      supervisor.spawnSubagent(
        {
          archetype: "verifier",
          name: "l4_unauthorized",
          prompt: "Level 4 agent",
        },
        l3.subagentId
      )
    ).rejects.toThrow(/ERR_SUBAGENT_MAX_DEPTH_EXCEEDED/);
  });

  it("prevents subagent pool exhaustion / concurrency flooding (> 8 subagents)", async () => {
    // Spawn 8 agents successfully
    const spawned: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const res = await supervisor.spawnSubagent({
        archetype: "explorer",
        name: `explorer_${i}`,
        prompt: `Scan section ${i}`,
      });
      spawned.push(res.subagentId);
    }

    // 9th agent must be rejected due to concurrency limit
    await expect(
      supervisor.spawnSubagent({
        archetype: "explorer",
        name: "explorer_9_overflow",
        prompt: "Scan overflow",
      })
    ).rejects.toThrow(/ERR_SUBAGENT_CONCURRENCY_LIMIT_EXCEEDED/);
  });

  it("blocks message spoofing / ACL breakout across non-sibling trees (SEC-SUB-03)", async () => {
    // Tree A
    const parentA = await supervisor.spawnSubagent({
      archetype: "planner",
      name: "parentA",
      prompt: "Tree A Parent",
    });
    const childA = await supervisor.spawnSubagent(
      { archetype: "implementer", name: "childA", prompt: "Tree A Child" },
      parentA.subagentId
    );

    // Tree B
    const parentB = await supervisor.spawnSubagent({
      archetype: "planner",
      name: "parentB",
      prompt: "Tree B Parent",
    });
    const childB = await supervisor.spawnSubagent(
      { archetype: "implementer", name: "childB", prompt: "Tree B Child" },
      parentB.subagentId
    );

    // childA tries to message childB (different parent -> unauthorized)
    await expect(
      supervisor.sendMessage(
        {
          recipientId: childB.subagentId,
          subject: "Illicit Communication",
          body: "Bypassing hierarchy",
        },
        childA.subagentId
      )
    ).rejects.toThrow(/ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT/);
  });

  it("handles rapid concurrent message dispatch without corruption", async () => {
    const parent = await supervisor.spawnSubagent({
      archetype: "planner",
      name: "concurrent_parent",
      prompt: "Parent",
    });

    const child = await supervisor.spawnSubagent(
      {
        archetype: "implementer",
        name: "concurrent_child",
        prompt: "Child",
      },
      parent.subagentId
    );

    // Send 50 messages in parallel
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 50; i++) {
      promises.push(
        supervisor.sendMessage(
          {
            recipientId: child.subagentId,
            subject: `Message #${i}`,
            body: `Payload content ${i}`,
            priority: i % 3 === 0 ? "high" : i % 3 === 1 ? "normal" : "low",
          },
          parent.subagentId
        )
      );
    }

    await Promise.all(promises);

    expect(supervisor.mailbox.getPendingCount(child.subagentId)).toBe(50);
    const history = supervisor.mailbox.getHistory(child.subagentId);
    expect(history.length).toBe(50);
  });

  /* ------------------------------------------------------------------------ */
  /* Subagent Name Path Confinement & Traversal Attacks                       */
  /* ------------------------------------------------------------------------ */

  it("rejects malicious subagent names attempting directory traversal during spawnSubagent", async () => {
    const hostileNames = [
      "../../outside",
      "..\\..\\windows\\system32",
      "/etc/shadow",
      "C:\\Windows\\System32",
      "agent; rm -rf /",
      "agent\0null",
      "agent name with spaces",
      "a".repeat(65),
    ];

    for (const badName of hostileNames) {
      await expect(
        supervisor.spawnSubagent({
          archetype: "explorer",
          name: badName,
          prompt: "Test traversal name",
        })
      ).rejects.toThrow();
    }

    // Verify nothing escaped into tmpRoot root outside .agents
    const rootEntries = await fs.readdir(tmpRoot);
    expect(rootEntries.filter((e) => e !== ".agents")).toEqual([]);
  });

  it("inspect action blocks traversal attempts, absolute paths, null bytes, and non-allowlisted files", async () => {
    const agent = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "secure_worker",
      prompt: "Execute secure tasks",
    });

    const hostileInspectFiles = [
      "../../../secret",
      "..\\..\\secret",
      "/etc/passwd",
      "C:\\Windows\\win.ini",
      "%2e%2e%2fsecret",
      "%252e%252e%252fsecret",
      "passwords.txt",
      "id_rsa",
      "progress.md\0.txt",
    ];

    for (const badFile of hostileInspectFiles) {
      const res = await supervisor.manageSubagents({
        action: "inspect",
        subagentId: agent.subagentId,
        // @ts-expect-error test runtime rejection of unauthorized files
        inspectFile: badFile,
      });

      expect(res.success).toBe(false);
      expect(res.message).toContain("ERR_SUBAGENT_INSPECTION_FILE_NOT_FOUND");
    }
  });

  it("inspect action successfully reads all 5 valid inspection files within subagent metadata directory", async () => {
    const agent = await supervisor.spawnSubagent({
      archetype: "implementer",
      name: "valid_worker",
      prompt: "Execute valid inspection tests",
    });

    const node = supervisor.registry.get(agent.subagentId)!;
    const metadataDir = path.resolve(tmpRoot, node.metadataDir);

    const testFiles = [
      { name: "progress.md" as const, content: "# Progress: Step 1 complete" },
      { name: "BRIEFING.md" as const, content: "# Briefing: Mission Alpha" },
      { name: "handoff.md" as const, content: "# Handoff: Findings verified" },
      { name: "DISPATCH.md" as const, content: "## Dispatch: 2026-08-26" },
      { name: "analysis.md" as const, content: "# Analysis: Codebase is secure" },
    ];

    for (const { name, content } of testFiles) {
      await fs.writeFile(path.join(metadataDir, name), content, "utf8");

      const result = await supervisor.manageSubagents({
        action: "inspect",
        subagentId: agent.subagentId,
        inspectFile: name,
      });

      expect(result.success).toBe(true);
      expect(result.inspectedContent).toBe(content);
      expect(result.detail?.name).toBe(node.name);
    }
  });
});
