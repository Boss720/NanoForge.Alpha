/**
 * Non-Interactive Approval Gate & Safety Classifier Tests.
 */

import { describe, expect, it, vi } from "vitest";
import type { ToolRequest } from "../policy/policy";
import type { ApprovalRequest } from "../runs/coordinator";
import { CLIApprovalGate, isSafeToolRequest } from "./approval";

describe("isSafeToolRequest", () => {
  it("identifies read-only shell utilities as safe", () => {
    const safeExecutables = ["ls", "cat", "echo", "pwd", "grep", "find", "wc"];
    for (const exe of safeExecutables) {
      const req: ToolRequest = {
        kind: "terminal.exec",
        cwd: ".",
        executable: exe,
        args: ["somefile.txt"],
      };
      expect(isSafeToolRequest(req)).toBe(true);
    }
  });

  it("identifies git read-only subcommands as safe", () => {
    const safeGitArgs = [
      ["status"],
      ["log", "-n", "5"],
      ["diff", "HEAD~1"],
      ["show", "HEAD"],
      ["branch"],
      ["rev-parse", "HEAD"],
    ];
    for (const args of safeGitArgs) {
      const req: ToolRequest = {
        kind: "terminal.exec",
        cwd: ".",
        executable: "git",
        args,
      };
      expect(isSafeToolRequest(req)).toBe(true);
    }
  });

  it("identifies tool version checks as safe", () => {
    const versionChecks = [
      { executable: "node", args: ["--version"] },
      { executable: "npm", args: ["-v"] },
      { executable: "tsc", args: ["--version"] },
      { executable: "python", args: ["--version"] },
    ];
    for (const { executable, args } of versionChecks) {
      const req: ToolRequest = {
        kind: "terminal.exec",
        cwd: ".",
        executable,
        args,
      };
      expect(isSafeToolRequest(req)).toBe(true);
    }
  });

  it("classifies mutating or dangerous operations as NOT safe", () => {
    const dangerousRequests: ToolRequest[] = [
      { kind: "terminal.exec", cwd: ".", executable: "rm", args: ["-rf", "dist"] },
      { kind: "terminal.exec", cwd: ".", executable: "git", args: ["push", "origin", "main"] },
      { kind: "terminal.exec", cwd: ".", executable: "git", args: ["commit", "-m", "fix"] },
      { kind: "terminal.exec", cwd: ".", executable: "npm", args: ["install", "express"] },
      { kind: "terminal.exec", cwd: ".", executable: "curl", args: ["-X", "POST", "https://api.com"] },
      { kind: "terminal.exec", cwd: ".", executable: "chmod", args: ["777", "script.sh"] },
      { kind: "terminal.exec", cwd: ".", executable: "del", args: ["important.db"] },
    ];
    for (const req of dangerousRequests) {
      expect(isSafeToolRequest(req)).toBe(false);
    }
  });
});

describe("CLIApprovalGate", () => {
  const safeReq: ApprovalRequest = {
    runId: "run-1",
    stepId: "step-1",
    tool: "terminal.exec",
    reason: "git status read",
    request: {
      kind: "terminal.exec",
      cwd: ".",
      executable: "git",
      args: ["status"],
    },
  };

  const mutatingReq: ApprovalRequest = {
    runId: "run-1",
    stepId: "step-2",
    tool: "terminal.exec",
    reason: "npm install dependencies",
    request: {
      kind: "terminal.exec",
      cwd: ".",
      execu…28625 tokens truncated…e((e) => {
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
