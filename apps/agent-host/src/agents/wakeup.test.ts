import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { ReactiveWakeupEngine } from "./wakeup.js";
import { createSubagentMessage } from "@protocol/subagents";

describe("ReactiveWakeupEngine (Zero-Polling Resumption)", () => {
  let engine: ReactiveWakeupEngine;

  beforeEach(() => {
    engine = new ReactiveWakeupEngine();
  });

  it("dispatches structured wakeup on inbound message without polling", () => {
    const recipientId = randomUUID();
    const senderId = randomUUID();
    let receivedPayload: string | undefined;

    engine.registerWakeup(recipientId, (formatted) => {
      receivedPayload = formatted;
    });

    const msg = createSubagentMessage({
      senderId,
      senderName: "Worker_1",
      recipientId,
      subject: "Verification Complete",
      body: "All 10 tests passed successfully.",
    });

    engine.wakeOnMessage(msg);

    expect(receivedPayload).toBeDefined();
    expect(receivedPayload).toContain("<system_notification>");
    expect(receivedPayload).toContain("Reactive Wakeup Trigger: MESSAGE_RECEIVED");
    expect(receivedPayload).toContain("Verification Complete");
    expect(receivedPayload).toContain("Worker_1");
  });

  it("dispatches child completed wakeup to parent", () => {
    const parentId = randomUUID();
    const childId = randomUUID();
    let receivedSummary: string | undefined;

    engine.registerWakeup(parentId, (formatted, options) => {
      receivedSummary = options.summary;
    });

    engine.wakeOnChildCompleted(
      {
        id: childId,
        parentId,
        name: "imp_1",
        archetype: "implementer",
        roles: ["implementer"],
        state: "idle",
        workingDirectory: "/repo",
        isolationMode: "inherit",
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        tokensUsed: 1500,
        turnCount: 3,
      },
      ".agents/imp_1/handoff.md"
    );

    expect(receivedSummary).toContain("completed successfully");
    expect(receivedSummary).toContain("imp_1");
  });

  it("dispatches child errored wakeup to parent", () => {
    const parentId = randomUUID();
    const childId = randomUUID();
    let triggerType: string | undefined;

    engine.registerWakeup(parentId, (formatted, options) => {
      triggerType = options.trigger;
    });

    engine.wakeOnChildErrored(
      {
        id: childId,
        parentId,
        name: "qa_1",
        archetype: "qa",
        roles: ["qa"],
        state: "errored",
        workingDirectory: "/repo",
        isolationMode: "inherit",
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        tokensUsed: 800,
        turnCount: 2,
      },
      "SyntaxError in test file"
    );

    expect(triggerType).toBe("CHILD_ERRORED");
  });

  it("dispatches background task completed and timer expired wakeups", () => {
    const targetAgentId = randomUUID();
    const taskId = randomUUID();
    const scheduleId = randomUUID();
    const senderId = randomUUID();
    const triggers: string[] = [];

    engine.registerWakeup(targetAgentId, (formatted, options) => {
      triggers.push(options.trigger);
    });

    engine.wakeOnTaskCompleted(taskId, 0, "Build succeeded", targetAgentId);
    engine.wakeOnTimerExpired(scheduleId, "Heartbeat reminder", targetAgentId);
    engine.wakeOnSenderTerminated(targetAgentId, senderId);

    expect(triggers).toContain("TASK_COMPLETED");
    expect(triggers).toContain("TIMER_EXPIRED");
    expect(triggers).toContain("SENDER_TERMINATED");
  });
});
