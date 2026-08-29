import { describe, it, expect, beforeEach } from "vitest";
import { SubagentMailbox } from "./mailbox.js";
import { SubagentRegistry } from "./registry.js";
import { createSubagentMessage } from "@protocol/subagents";
import type { SubagentNode } from "./types.js";

describe("SubagentMailbox & Message Authorization (SEC-SUB-03)", () => {
  let mailbox: SubagentMailbox;
  let registry: SubagentRegistry;

  const rootParentId = "11111111-1111-4111-8111-111111111111";
  const child1Id = "22222222-2222-4222-8222-222222222222";
  const child2Id = "33333333-3333-4333-8333-333333333333";
  const outsiderId = "99999999-9999-4999-8999-999999999999";

  function createNode(id: string, parentId: string | null, name: string): SubagentNode {
    const now = new Date().toISOString();
    return {
      id,
      parentId,
      name,
      archetype: "implementer",
      roles: ["implementer"],
      workingDirectory: "/repo",
      metadataDir: `.agents/${name}`,
      isolationMode: "inherit",
      tokensUsed: 0,
      turnCount: 0,
      state: "running",
      startedAt: now,
      lastHeartbeat: now,
      abortController: new AbortController(),
      skills: [],
    };
  }

  beforeEach(() => {
    mailbox = new SubagentMailbox();
    registry = new SubagentRegistry();

    registry.register(createNode(rootParentId, null, "orchestrator"));
    registry.register(createNode(child1Id, rootParentId, "child_1"));
    registry.register(createNode(child2Id, rootParentId, "child_2"));
    registry.register(createNode(outsiderId, "88888888-8888-4888-8888-888888888888", "outsider"));
  });

  it("allows parent to message direct child", () => {
    const msg = createSubagentMessage({
      senderId: rootParentId,
      recipientId: child1Id,
      subject: "Assign task",
      body: "Implement module 2",
    });

    expect(() => mailbox.enqueue(msg, registry)).not.toThrow();
    expect(mailbox.getPendingCount(child1Id)).toBe(1);
  });

  it("allows child to message direct parent", () => {
    const msg = createSubagentMessage({
      senderId: child1Id,
      recipientId: rootParentId,
      subject: "Task complete",
      body: "All tests pass",
    });

    expect(() => mailbox.enqueue(msg, registry)).not.toThrow();
    expect(mailbox.getPendingCount(rootParentId)).toBe(1);
  });

  it("allows sibling to message sibling under same parent", () => {
    const msg = createSubagentMessage({
      senderId: child1Id,
      recipientId: child2Id,
      subject: "Handing off schema",
      body: "Please verify types",
    });

    expect(() => mailbox.enqueue(msg, registry)).not.toThrow();
    expect(mailbox.getPendingCount(child2Id)).toBe(1);
  });

  it("rejects unauthorized message crossing supervision boundaries (SEC-SUB-03)", () => {
    const msg = createSubagentMessage({
      senderId: outsiderId,
      recipientId: child1Id,
      subject: "Infiltrate",
      body: "Unauthorized message",
    });

    expect(() => mailbox.enqueue(msg, registry)).toThrow(/ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT/);
    expect(mailbox.getPendingCount(child1Id)).toBe(0);
  });

  it("rejects messaging nonexistent recipient", () => {
    const msg = createSubagentMessage({
      senderId: child1Id,
      recipientId: "00000000-0000-4000-8000-000000000000",
      subject: "Ghost",
      body: "Hello?",
    });

    expect(() => mailbox.enqueue(msg, registry)).toThrow(/ERR_SUBAGENT_RECIPIENT_NOT_FOUND/);
  });

  it("orders messages by priority (high > normal > low)", () => {
    const lowMsg = createSubagentMessage({
      senderId: rootParentId,
      recipientId: child1Id,
      subject: "Low priority background info",
      body: "FYI only",
      priority: "low",
    });

    const normalMsg = createSubagentMessage({
      senderId: rootParentId,
      recipientId: child1Id,
      subject: "Normal instruction",
      body: "Do this next",
      priority: "normal",
    });

    const highMsg = createSubagentMessage({
      senderId: rootParentId,
      recipientId: child1Id,
      subject: "URGENT ABORT",
      body: "Stop immediately",
      priority: "high",
    });

    mailbox.enqueue(lowMsg);
    mailbox.enqueue(normalMsg);
    mailbox.enqueue(highMsg);

    // Dequeue should yield high first, then normal, then low
    const first = mailbox.dequeue(child1Id);
    const second = mailbox.dequeue(child1Id);
    const third = mailbox.dequeue(child1Id);

    expect(first?.subject).toBe("URGENT ABORT");
    expect(second?.subject).toBe("Normal instruction");
    expect(third?.subject).toBe("Low priority background info");
  });

  it("maintains an audit history ledger", () => {
    const msg = createSubagentMessage({
      senderId: child1Id,
      recipientId: child2Id,
      subject: "Test audit",
      body: "Audited body",
    });

    mailbox.enqueue(msg);
    mailbox.dequeue(child2Id);

    const history = mailbox.getHistory(child1Id);
    expect(history.length).toBe(1);
    expect(history[0].subject).toBe("Test audit");
  });
});
