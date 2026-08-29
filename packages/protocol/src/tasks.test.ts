import { describe, expect, it } from "vitest";
import {
  taskIdSchema,
  scheduleIdSchema,
  taskStatusSchema,
  scheduleConditionSchema,
  scheduleParamsSchema,
  scheduleResultSchema,
  manageTaskActionSchema,
  manageTaskParamsSchema,
  taskSummarySchema,
  manageTaskResultSchema,
  taskLifecycleEventSchema,
  parseCronExpression,
  isValidCronExpression,
  matchesCron,
  getNextCronOccurrence,
  isTaskTerminal,
  isTaskActive,
  matchesScheduleCondition,
  createTaskSummary,
  TASK_ERROR_CODES,
  RING_BUFFER_DEFAULT_MAX_BYTES,
  type TaskStatus,
  type TaskSummary,
} from "./tasks";

describe("Daemon Tasks & Scheduler Protocol Suite", () => {
  const sampleTaskId = "123e4567-e89b-12d3-a456-426614174000";
  const sampleScheduleId = "987fcdeb-51a2-43d7-9876-543210987654";
  const sampleSenderId = "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d";
  const sampleTimestamp = "2026-08-15T08:00:00.000Z";

  /* ------------------------------------------------------------------------ */
  /* 1. Schemas & Types                                                       */
  /* ------------------------------------------------------------------------ */

  describe("Schemas & Status Enums", () => {
    it("validates taskIdSchema and scheduleIdSchema with UUIDs", () => {
      expect(taskIdSchema.parse(sampleTaskId)).toBe(sampleTaskId);
      expect(scheduleIdSchema.parse(sampleScheduleId)).toBe(sampleScheduleId);
      expect(() => taskIdSchema.parse("invalid-uuid")).toThrow();
    });

    it("validates all 5 TaskStatus states", () => {
      const statuses: TaskStatus[] = [
        "running",
        "completed",
        "failed",
        "cancelled",
        "killed",
      ];
      for (const st of statuses) {
        expect(taskStatusSchema.parse(st)).toBe(st);
      }
      expect(() => taskStatusSchema.parse("pending")).toThrow();
    });

    it("validates scheduleConditionSchema (never, any, or UUID)", () => {
      expect(scheduleConditionSchema.parse("never")).toBe("never");
      expect(scheduleConditionSchema.parse("any")).toBe("any");
      expect(scheduleConditionSchema.parse(sampleSenderId)).toBe(sampleSenderId);
      expect(() => scheduleConditionSchema.parse("invalid-sender")).toThrow();
    });

    it("exports task error codes and buffer constants", () => {
      expect(TASK_ERROR_CODES.ERR_TASK_NOT_FOUND).toBe("ERR_TASK_NOT_FOUND");
      expect(TASK_ERROR_CODES.ERR_TASK_ALREADY_EXITED).toBe("ERR_TASK_ALREADY_EXITED");
      expect(TASK_ERROR_CODES.ERR_INVALID_CRON_EXPRESSION).toBe("ERR_INVALID_CRON_EXPRESSION");
      expect(RING_BUFFER_DEFAULT_MAX_BYTES).toBe(2 * 1024 * 1024);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Schedule Params Refinement & Validation                               */
  /* ------------------------------------------------------------------------ */

  describe("Schedule Params Refinement", () => {
    it("parses valid one-shot schedule with durationSeconds", () => {
      const parsed = scheduleParamsSchema.parse({
        prompt: "Check background build progress",
        durationSeconds: 300,
        timerCondition: "never",
      });
      expect(parsed.durationSeconds).toBe(300);
      expect(parsed.cronExpression).toBeUndefined();
      expect(parsed.isDaemon).toBe(false);
    });

    it("parses valid recurring cron schedule with cronExpression", () => {
      const parsed = scheduleParamsSchema.parse({
        prompt: "Poll deployment status every 5 minutes",
        cronExpression: "*/5 * * * *",
        maxIterations: 10,
        isDaemon: true,
      });
      expect(parsed.cronExpression).toBe("*/5 * * * *");
      expect(parsed.durationSeconds).toBeUndefined();
      expect(parsed.isDaemon).toBe(true);
    });

    it("rejects scheduleParamsSchema when neither durationSeconds nor cronExpression is provided", () => {
      expect(() =>
        scheduleParamsSchema.parse({
          prompt: "Empty schedule",
        })
      ).toThrow(/Must specify exactly one of durationSeconds or cronExpression/);
    });

    it("rejects scheduleParamsSchema when both durationSeconds and cronExpression are provided", () => {
      expect(() =>
        scheduleParamsSchema.parse({
          prompt: "Conflicting schedule",
          durationSeconds: 60,
          cronExpression: "*/5 * * * *",
        })
      ).toThrow(/Must specify exactly one of durationSeconds or cronExpression/);
    });

    it("rejects scheduleParamsSchema when cronExpression is syntactically invalid", () => {
      expect(() =>
        scheduleParamsSchema.parse({
          prompt: "Bad cron expression",
          cronExpression: "invalid-cron-string",
        })
      ).toThrow(/Invalid cronExpression/);

      expect(() =>
        scheduleParamsSchema.parse({
          prompt: "Out of bounds cron",
          cronExpression: "99 * * * *",
        })
      ).toThrow(/Invalid cronExpression/);
    });

    it("validates scheduleResultSchema", () => {
      const result = scheduleResultSchema.parse({
        scheduleId: sampleScheduleId,
        type: "cron",
        nextRunAt: sampleTimestamp,
        isDaemon: true,
        status: "active",
        prompt: "Poll status",
      });
      expect(result.scheduleId).toBe(sampleScheduleId);
      expect(result.status).toBe("active");
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Manage Task Schemas & Lifecycles                                      */
  /* ------------------------------------------------------------------------ */

  describe("Manage Task Schemas", () => {
    it("validates all manageTask actions", () => {
      const actions = ["list", "kill", "status", "send_input"] as const;
      for (const a of actions) {
        expect(manageTaskActionSchema.parse(a)).toBe(a);
      }
    });

    it("validates manageTaskParamsSchema for send_input and kill", () => {
      const inputParams = manageTaskParamsSchema.parse({
        action: "send_input",
        taskId: sampleTaskId,
        input: "yes\n",
      });
      expect(inputParams.action).toBe("send_input");
      expect(inputParams.input).toBe("yes\n");

      const killParams = manageTaskParamsSchema.parse({
        action: "kill",
        taskId: sampleTaskId,
      });
      expect(killParams.taskId).toBe(sampleTaskId);
    });

    it("parses valid TaskSummary and manageTaskResultSchema", () => {
      const summary: TaskSummary = {
        taskId: sampleTaskId,
        pid: 12345,
        command: "npm",
        args: ["run", "dev"],
        cwd: "c:/repo",
        isDaemon: true,
        status: "running",
        startedAt: sampleTimestamp,
        recentLogs: "Server running on port 3000\n",
        truncated: false,
      };

      const parsed = taskSummarySchema.parse(summary);
      expect(parsed.pid).toBe(12345);
      expect(parsed.isDaemon).toBe(true);

      const result = manageTaskResultSchema.parse({
        action: "list",
        tasks: [summary],
        success: true,
      });
      expect(result.tasks?.length).toBe(1);
    });

    it("validates all 6 taskLifecycleEventSchema variants", () => {
      const summary: TaskSummary = {
        taskId: sampleTaskId,
        pid: 100,
        command: "node",
        args: ["server.js"],
        cwd: "/app",
        isDaemon: false,
        status: "completed",
        startedAt: sampleTimestamp,
      };

      // 1. task.spawned
      expect(
        taskLifecycleEventSchema.parse({
          type: "task.spawned",
          task: summary,
          at: sampleTimestamp,
        }).type
      ).toBe("task.spawned");

      // 2. task.output
      expect(
        taskLifecycleEventSchema.parse({
          type: "task.output",
          taskId: sampleTaskId,
          stream: "stdout",
          chunk: "Build succeeded\n",
          at: sampleTimestamp,
        }).type
      ).toBe("task.output");

      // 3. task.completed
      expect(
        taskLifecycleEventSchema.parse({
          type: "task.completed",
          taskId: sampleTaskId,
          exitCode: 0,
          durationMs: 1250,
          at: sampleTimestamp,
        }).type
      ).toBe("task.completed");

      // 4. task.killed
      expect(
        taskLifecycleEventSchema.parse({
          type: "task.killed",
          taskId: sampleTaskId,
          signal: "SIGTERM",
          at: sampleTimestamp,
        }).type
      ).toBe("task.killed");

      // 5. schedule.triggered
      expect(
        taskLifecycleEventSchema.parse({
          type: "schedule.triggered",
          scheduleId: sampleScheduleId,
          iteration: 1,
          prompt: "Health check",
          at: sampleTimestamp,
        }).type
      ).toBe("schedule.triggered");

      // 6. schedule.cancelled
      expect(
        taskLifecycleEventSchema.parse({
          type: "schedule.cancelled",
          scheduleId: sampleScheduleId,
          reason: "Sender subagent completed early",
          at: sampleTimestamp,
        }).type
      ).toBe("schedule.cancelled");
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 4. 5-Field Cron Parser & Evaluation Engine                               */
  /* ------------------------------------------------------------------------ */

  describe("5-Field Cron Parser & Evaluation", () => {
    it("parses wildcard cron * * * * *", () => {
      const parsed = parseCronExpression("* * * * *");
      expect(parsed.minutes.size).toBe(60);
      expect(parsed.hours.size).toBe(24);
      expect(parsed.daysOfMonth.size).toBe(31);
      expect(parsed.months.size).toBe(12);
      expect(parsed.daysOfWeek.size).toBe(7);
      expect(isValidCronExpression("* * * * *")).toBe(true);
    });

    it("parses step expressions (e.g. */5 * * * *)", () => {
      const parsed = parseCronExpression("*/5 * * * *");
      expect(parsed.minutes.has(0)).toBe(true);
      expect(parsed.minutes.has(5)).toBe(true);
      expect(parsed.minutes.has(55)).toBe(true);
      expect(parsed.minutes.has(3)).toBe(false);
      expect(parsed.minutes.size).toBe(12);
    });

    it("parses ranges and day/month names (e.g. 0 9 * * MON-FRI)", () => {
      const parsed = parseCronExpression("0 9 * * MON-FRI");
      expect(parsed.minutes.has(0)).toBe(true);
      expect(parsed.minutes.size).toBe(1);
      expect(parsed.hours.has(9)).toBe(true);
      expect(parsed.hours.size).toBe(1);
      expect(parsed.daysOfWeek.has(1)).toBe(true); // Monday
      expect(parsed.daysOfWeek.has(5)).toBe(true); // Friday
      expect(parsed.daysOfWeek.has(0)).toBe(false); // Sunday
      expect(parsed.daysOfWeek.has(6)).toBe(false); // Saturday
    });

    it("parses comma-separated lists and mixed steps (e.g. 0,15,30-45/5 * 1,15 JAN-MAR SUN)", () => {
      const parsed = parseCronExpression("0,15,30-45/5 * 1,15 JAN-MAR SUN");
      expect(parsed.minutes.has(0)).toBe(true);
      expect(parsed.minutes.has(15)).toBe(true);
      expect(parsed.minutes.has(30)).toBe(true);
      expect(parsed.minutes.has(35)).toBe(true);
      expect(parsed.minutes.has(40)).toBe(true);
      expect(parsed.minutes.has(45)).toBe(true);
      expect(parsed.minutes.has(50)).toBe(false);

      expect(parsed.daysOfMonth.has(1)).toBe(true);
      expect(parsed.daysOfMonth.has(15)).toBe(true);
      expect(parsed.daysOfMonth.has(2)).toBe(false);

      expect(parsed.months.has(1)).toBe(true);
      expect(parsed.months.has(2)).toBe(true);
      expect(parsed.months.has(3)).toBe(true);
      expect(parsed.months.has(4)).toBe(false);

      expect(parsed.daysOfWeek.has(0)).toBe(true); // Sunday
      expect(parsed.daysOfWeek.has(1)).toBe(false);
    });

    it("handles day of week 7 as Sunday (0)", () => {
      const parsed = parseCronExpression("0 0 * * 7");
      expect(parsed.daysOfWeek.has(0)).toBe(true);
    });

    it("throws clear error on malformed cron expressions", () => {
      expect(() => parseCronExpression("")).toThrow();
      expect(() => parseCronExpression("* * * *")).toThrow(/must have exactly 5 fields/);
      expect(() => parseCronExpression("* * * * * *")).toThrow(/must have exactly 5 fields/);
      expect(() => parseCronExpression("60 * * * *")).toThrow(/out of bounds/);
      expect(() => parseCronExpression("* 24 * * *")).toThrow(/out of bounds/);
      expect(() => parseCronExpression("* * 32 * *")).toThrow(/out of bounds/);
      expect(() => parseCronExpression("* * * 13 *")).toThrow(/out of bounds/);
      expect(() => parseCronExpression("* * * * 8")).toThrow(/out of bounds/);
      expect(() => parseCronExpression("5-2 * * * *")).toThrow(/cannot be greater than range end/);
      expect(() => parseCronExpression("*/0 * * * *")).toThrow(/Step must be a positive integer/);

      expect(isValidCronExpression("bad-cron")).toBe(false);
      expect(isValidCronExpression("*/5 * * * *")).toBe(true);
    });

    it("evaluates matchesCron correctly", () => {
      // 2026-08-15 08:30:00 (Saturday)
      // August is month 8, Day 15, Day of week Saturday = 6
      const date = new Date(Date.UTC(2026, 7, 15, 8, 30, 0)); // month index 7 is August

      expect(matchesCron("30 8 15 8 6", date, true)).toBe(true);
      expect(matchesCron("30 8 * * *", date, true)).toBe(true);
      expect(matchesCron("*/15 8 * * *", date, true)).toBe(true);
      expect(matchesCron("0 8 * * *", date, true)).toBe(false);
      expect(matchesCron("* * * * MON-FRI", date, true)).toBe(false);
    });

    it("calculates next occurrence with getNextCronOccurrence", () => {
      // Starting date: 2026-08-15 08:00:00 UTC
      const start = new Date(Date.UTC(2026, 7, 15, 8, 0, 0));

      // Next run for "*/15 * * * *" should be 08:15:00 UTC
      const nextRun = getNextCronOccurrence("*/15 * * * *", start, { isUtc: true });
      expect(nextRun).not.toBeNull();
      expect(nextRun?.toISOString()).toBe("2026-08-15T08:15:00.000Z");

      // Next run for "0 9 * * *" should be 09:00:00 UTC
      const nextHourRun = getNextCronOccurrence("0 9 * * *", start, { isUtc: true });
      expect(nextHourRun?.toISOString()).toBe("2026-08-15T09:00:00.000Z");

      // Next run across midnight: "0 0 * * *"
      const nextDayRun = getNextCronOccurrence("0 0 * * *", start, { isUtc: true });
      expect(nextDayRun?.toISOString()).toBe("2026-08-16T00:00:00.000Z");
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Pure Helper Utilities                                                 */
  /* ------------------------------------------------------------------------ */

  describe("Pure Task Helpers", () => {
    it("checks isTaskTerminal and isTaskActive", () => {
      expect(isTaskActive("running")).toBe(true);
      expect(isTaskActive("completed")).toBe(false);
      expect(isTaskActive("failed")).toBe(false);

      expect(isTaskTerminal("completed")).toBe(true);
      expect(isTaskTerminal("failed")).toBe(true);
      expect(isTaskTerminal("cancelled")).toBe(true);
      expect(isTaskTerminal("killed")).toBe(true);
      expect(isTaskTerminal("running")).toBe(false);
    });

    it("evaluates matchesScheduleCondition correctly", () => {
      expect(matchesScheduleCondition("never", sampleSenderId)).toBe(false);
      expect(matchesScheduleCondition("any", sampleSenderId)).toBe(true);
      expect(matchesScheduleCondition("any", undefined)).toBe(true);
      expect(matchesScheduleCondition(sampleSenderId, sampleSenderId)).toBe(true);
      expect(matchesScheduleCondition(sampleSenderId, sampleTaskId)).toBe(false);
    });

    it("creates task summary with createTaskSummary", () => {
      const summary = createTaskSummary({
        pid: 9999,
        command: "vitest",
        args: ["run"],
        cwd: "c:/repo",
        isDaemon: false,
        status: "running",
      });

      expect(summary.pid).toBe(9999);
      expect(summary.command).toBe("vitest");
      expect(summary.args).toEqual(["run"]);
      expect(summary.isDaemon).toBe(false);
      expect(summary.status).toBe("running");
      expect(typeof summary.taskId).toBe("string");
      expect(typeof summary.startedAt).toBe("string");
    });
  });
});
