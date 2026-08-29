import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TaskScheduler } from "./scheduler.js";

describe("TaskScheduler", () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = new TaskScheduler();
  });

  afterEach(() => {
    scheduler.dispose();
  });

  it("schedules and fires a one-shot timer", async () => {
    const events: string[] = [];
    scheduler.subscribe((e) => {
      if (e.type === "schedule.triggered") {
        events.push(e.prompt);
      }
    });

    // Schedule 1-second timer (simulate by mocking or short duration)
    const result = scheduler.schedule({
      prompt: "Check build status",
      durationSeconds: 1,
      timerCondition: "never",
    });

    expect(result.type).toBe("one_shot");
    expect(result.status).toBe("active");

    // Wait for timer to trigger
    await new Promise((r) => setTimeout(r, 1100));

    expect(events).toContain("Check build status");
    const rec = scheduler.getSchedule(result.scheduleId);
    expect(rec?.status).toBe("completed");
  });

  it("cancels one-shot timer early when condition is 'any' and message arrives", () => {
    const result = scheduler.schedule({
      prompt: "Check subagents",
      durationSeconds: 60,
      timerCondition: "any",
    });

    expect(result.status).toBe("active");

    const cancelledIds = scheduler.notifyMessageReceived("sender-123");
    expect(cancelledIds).toContain(result.scheduleId);

    const rec = scheduler.getSchedule(result.scheduleId);
    expect(rec?.status).toBe("cancelled");
  });

  it("cancels one-shot timer early when condition is '<senderId>' and matching message arrives", () => {
    const targetSender = "550e8400-e29b-41d4-a716-446655440000";
    const otherSender = "660e8400-e29b-41d4-a716-446655440000";

    const result = scheduler.schedule({
      prompt: "Waiting for specific subagent",
      durationSeconds: 60,
      timerCondition: targetSender,
    });

    // Non-matching sender does NOT cancel
    const uncancelled = scheduler.notifyMessageReceived(otherSender);
    expect(uncancelled).not.toContain(result.scheduleId);
    expect(scheduler.getSchedule(result.scheduleId)?.status).toBe("active");

    // Matching sender cancels
    const cancelled = scheduler.notifyMessageReceived(targetSender);
    expect(cancelled).toContain(result.scheduleId);
    expect(scheduler.getSchedule(result.scheduleId)?.status).toBe("cancelled");
  });

  it("synthesizes fallback trigger when monitored sender terminates", () => {
    const targetSender = "770e8400-e29b-41d4-a716-446655440000";
    const triggers: string[] = [];
    scheduler.subscribe((e) => {
      if (e.type === "schedule.triggered") triggers.push(e.prompt);
    });

    const result = scheduler.schedule({
      prompt: "Check task",
      durationSeconds: 600,
      timerCondition: targetSender,
    });

    const triggeredIds = scheduler.notifySenderDied(targetSender);
    expect(triggeredIds).toContain(result.scheduleId);
    expect(triggers.some((t) => t.includes("[FALLBACK: Sender"))).toBe(true);
  });

  it("registers 5-field cron recurring jobs and calculates next run time", () => {
    const result = scheduler.schedule({
      prompt: "Hourly lint check",
      cronExpression: "0 * * * *",
      maxIterations: 5,
      isDaemon: true,
    });

    expect(result.type).toBe("cron");
    expect(result.status).toBe("active");
    expect(result.nextRunAt).toBeDefined();

    const rec = scheduler.getSchedule(result.scheduleId);
    expect(rec?.cronExpression).toBe("0 * * * *");
    expect(rec?.maxIterations).toBe(5);
  });

  it("cancels all non-daemon schedules when creator subagent terminates", () => {
    const creatorId = "creator-agent-1";

    const s1 = scheduler.schedule(
      {
        prompt: "Short timer",
        durationSeconds: 300,
        isDaemon: false,
      },
      creatorId
    );

    const s2 = scheduler.schedule(
      {
        prompt: "Daemon cron",
        cronExpression: "*/10 * * * *",
        isDaemon: true,
      },
      creatorId
    );

    scheduler.cancelByCreator(creatorId);

    expect(scheduler.getSchedule(s1.scheduleId)?.status).toBe("cancelled");
    expect(scheduler.getSchedule(s2.scheduleId)?.status).toBe("active"); // Daemon persists
  });
});
