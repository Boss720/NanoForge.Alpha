/**
 * Background Task Supervisor, Daemon Engine, & Scheduler Wire Protocol.
 *
 * Provides isomorphic Zod schemas, TypeScript types, 5-field cron parsing/evaluation,
 * and helper utilities for daemon processes, one-shot timers, and interactive task management.
 *
 * ZERO Node.js runtime dependencies (pure TypeScript/Zod).
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 1. Identifiers & Enums                                             */
/* ------------------------------------------------------------------ */

export const taskIdSchema = z.string().uuid();
export type TaskId = z.infer<typeof taskIdSchema>;

export const scheduleIdSchema = z.string().uuid();
export type ScheduleId = z.infer<typeof scheduleIdSchema>;

/**
 * Task execution lifecycle status.
 */
export const taskStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "cancelled",
  "killed",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/**
 * Early cancellation condition for one-shot timers:
 * - "never": Always fire after durationSeconds unless manually cancelled.
 * - "any": Cancel early if any message is received from any sender.
 * - UUID: Cancel early if a message is received from this specific subagent ID.
 */
export const scheduleConditionSchema = z.union([
  z.literal("never"),
  z.literal("any"),
  z.string().uuid(),
]);
export type ScheduleCondition = z.infer<typeof scheduleConditionSchema>;

/**
 * Constants & Error Codes
 */
export const TASK_ERROR_CODES = {
  ERR_TASK_NOT_FOUND: "ERR_TASK_NOT_FOUND",
  ERR_TASK_ALREADY_EXITED: "ERR_TASK_ALREADY_EXITED",
  ERR_TASK_SPAWN_FAILED: "ERR_TASK_SPAWN_FAILED",
  ERR_TASK_MAX_LIMIT_EXCEEDED: "ERR_TASK_MAX_LIMIT_EXCEEDED",
  ERR_INVALID_CRON_EXPRESSION: "ERR_INVALID_CRON_EXPRESSION",
  ERR_SCHEDULE_CONDITION_CONFLICT: "ERR_SCHEDULE_CONDITION_CONFLICT",
  ERR_SCHEDULE_NOT_FOUND: "ERR_SCHEDULE_NOT_FOUND",
} as const;

export type TaskErrorCode = (typeof TASK_ERROR_CODES)[keyof typeof TASK_ERROR_CODES];

export const RING_BUFFER_DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2MB

/* ------------------------------------------------------------------ */
/* 2. 5-Field Cron Parser & Evaluation Engine                         */
/* ------------------------------------------------------------------ */

const MONTH_NAMES: Readonly<Record<string, number>> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

const DAY_NAMES: Readonly<Record<string, number>> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export interface ParsedCron {
  raw: string;
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

/**
 * Parses a single cron field expression into a Set of allowed integer values.
 */
function parseCronField(
  fieldStr: string,
  min: number,
  max: number,
  nameMap?: Readonly<Record<string, number>>,
  allowSevenAsZero: boolean = false
): Set<number> {
  const result = new Set<number>();
  const normalized = fieldStr.trim().toUpperCase();

  if (!normalized) {
    throw new Error("Cron field cannot be empty");
  }

  const parts = normalized.split(",");

  for (const part of parts) {
    if (!part) {
      throw new Error(`Invalid empty element in cron field: "${fieldStr}"`);
    }

    // Check for step: e.g. */5 or 10-30/5
    const stepSplit = part.split("/");
    if (stepSplit.length > 2) {
      throw new Error(`Invalid step syntax in cron element: "${part}"`);
    }

    let step = 1;
    if (stepSplit.length === 2) {
      const stepStr = stepSplit[1].trim();
      if (!/^\d+$/.test(stepStr)) {
        throw new Error(`Step must be a positive integer in: "${part}"`);
      }
      step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`Step must be a positive integer in: "${part}"`);
      }
    }

    const rangeStr = stepSplit[0];
    let rangeMin = min;
    let rangeMax = max;

    if (rangeStr === "*") {
      rangeMin = min;
      rangeMax = max;
    } else if (rangeStr.includes("-")) {
      const rangeParts = rangeStr.split("-");
      if (rangeParts.length !== 2 || !rangeParts[0].trim() || !rangeParts[1].trim()) {
        throw new Error(`Invalid range syntax in cron element: "${part}"`);
      }

      rangeMin = parseCronValue(rangeParts[0], min, max, nameMap);
      rangeMax = parseCronValue(rangeParts[1], min, max, nameMap);

      if (rangeMin > rangeMax) {
        throw new Error(
          `Range start (${rangeMin}) cannot be greater than range end (${rangeMax}) in "${part}"`
        );
      }
    } else {
      const singleVal = parseCronValue(rangeStr, min, max, nameMap);
      if (stepSplit.length === 2) {
        // e.g. 5/10 means starting at 5 through max with step 10
        rangeMin = singleVal;
        rangeMax = max;
      } else {
        rangeMin = singleVal;
        rangeMax = singleVal;
      }
    }

    for (let val = rangeMin; val <= rangeMax; val += step) {
      let finalVal = val;
      if (allowSevenAsZero && finalVal === 7) {
        finalVal = 0;
      }
      result.add(finalVal);
    }
  }

  return result;
}

function parseCronValue(
  valStr: string,
  min: number,
  max: number,
  nameMap?: Readonly<Record<string, number>>
): number {
  const trimmed = valStr.trim();
  if (nameMap && nameMap[trimmed] !== undefined) {
    return nameMap[trimmed];
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid numeric cron value: "${valStr}"`);
  }
  const num = parseInt(trimmed, 10);
  if (isNaN(num)) {
    throw new Error(`Invalid numeric cron value: "${valStr}"`);
  }
  if (num < min || num > max) {
    throw new Error(`Value ${num} is out of bounds (${min}-${max})`);
  }
  return num;
}

/**
 * Parses a standard 5-field cron expression into structured Set lookup maps.
 *
 * Supported fields:
 * 1. Minute (0-59)
 * 2. Hour (0-23)
 * 3. Day of month (1-31)
 * 4. Month (1-12 or JAN-DEC)
 * 5. Day of week (0-7 or SUN-SAT, where 0 and 7 are Sunday)
 */
export function parseCronExpression(expression: string): ParsedCron {
  if (!expression || typeof expression !== "string") {
    throw new Error("Cron expression must be a non-empty string");
  }

  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Cron expression must have exactly 5 fields (received ${fields.length}): "${expression}"`
    );
  }

  const [minStr, hourStr, domStr, monthStr, dowStr] = fields;

  const minutes = parseCronField(minStr, 0, 59);
  const hours = parseCronField(hourStr, 0, 23);
  const daysOfMonth = parseCronField(domStr, 1, 31);
  const months = parseCronField(monthStr, 1, 12, MONTH_NAMES);
  const daysOfWeek = parseCronField(dowStr, 0, 7, DAY_NAMES, true);

  return {
    raw: expression.trim(),
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
  };
}

/**
 * Validates whether a cron expression is a valid 5-field cron string.
 */
export function isValidCronExpression(expression: string): boolean {
  try {
    parseCronExpression(expression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a given Date matches the parsed cron expression.
 */
export function matchesCron(
  cron: ParsedCron | string,
  date: Date = new Date(),
  isUtc: boolean = false
): boolean {
  const parsed = typeof cron === "string" ? parseCronExpression(cron) : cron;
  const minute = isUtc ? date.getUTCMinutes() : date.getMinutes();
  const hour = isUtc ? date.getUTCHours() : date.getHours();
  const dayOfMonth = isUtc ? date.getUTCDate() : date.getDate();
  const month = (isUtc ? date.getUTCMonth() : date.getMonth()) + 1;
  const dayOfWeek = isUtc ? date.getUTCDay() : date.getDay();

  if (!parsed.minutes.has(minute)) return false;
  if (!parsed.hours.has(hour)) return false;
  if (!parsed.daysOfMonth.has(dayOfMonth)) return false;
  if (!parsed.months.has(month)) return false;
  if (!parsed.daysOfWeek.has(dayOfWeek)) return false;

  return true;
}

/**
 * Calculates the next occurrence of a cron expression strictly after `afterDate`.
 */
export function getNextCronOccurrence(
  cron: ParsedCron | string,
  afterDate: Date = new Date(),
  options: { maxYears?: number; isUtc?: boolean } = {}
): Date | null {
  const parsed = typeof cron === "string" ? parseCronExpression(cron) : cron;
  const isUtc = options.isUtc ?? false;
  const maxYears = options.maxYears ?? 5;

  const current = new Date(afterDate.getTime());
  // Move to next minute boundary (zeroing seconds and milliseconds)
  if (isUtc) {
    current.setUTCSeconds(0, 0);
    current.setUTCMinutes(current.getUTCMinutes() + 1);
  } else {
    current.setSeconds(0, 0);
    current.setMinutes(current.getMinutes() + 1);
  }

  const maxTimestamp = new Date(afterDate.getTime()).setFullYear(
    (isUtc ? afterDate.getUTCFullYear() : afterDate.getFullYear()) + maxYears
  );

  while (current.getTime() <= maxTimestamp) {
    const month = (isUtc ? current.getUTCMonth() : current.getMonth()) + 1;
    if (!parsed.months.has(month)) {
      // Advance to next month
      if (isUtc) {
        current.setUTCMonth(current.getUTCMonth() + 1, 1);
        current.setUTCHours(0, 0, 0, 0);
      } else {
        current.setMonth(current.getMonth() + 1, 1);
        current.setHours(0, 0, 0, 0);
      }
      continue;
    }

    const dayOfMonth = isUtc ? current.getUTCDate() : current.getDate();
    const dayOfWeek = isUtc ? current.getUTCDay() : current.getDay();

    if (!parsed.daysOfMonth.has(dayOfMonth) || !parsed.daysOfWeek.has(dayOfWeek)) {
      // Advance to next day
      if (isUtc) {
        current.setUTCDate(current.getUTCDate() + 1);
        current.setUTCHours(0, 0, 0, 0);
      } else {
        current.setDate(current.getDate() + 1);
        current.setHours(0, 0, 0, 0);
      }
      continue;
    }

    const hour = isUtc ? current.getUTCHours() : current.getHours();
    if (!parsed.hours.has(hour)) {
      // Advance to next hour
      if (isUtc) {
        current.setUTCHours(current.getUTCHours() + 1, 0, 0, 0);
      } else {
        current.setHours(current.getHours() + 1, 0, 0, 0);
      }
      continue;
    }

    const minute = isUtc ? current.getUTCMinutes() : current.getMinutes();
    if (!parsed.minutes.has(minute)) {
      // Advance 1 minute
      if (isUtc) {
        current.setUTCMinutes(current.getUTCMinutes() + 1);
      } else {
        current.setMinutes(current.getMinutes() + 1);
      }
      continue;
    }

    return new Date(current.getTime());
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* 3. Schedule Tool Schemas                                           */
/* ------------------------------------------------------------------ */

export const scheduleParamsSchema = z
  .object({
    prompt: z.string().min(1).max(4096),
    durationSeconds: z.number().int().positive().optional(),
    cronExpression: z.string().min(9).max(64).optional(),
    timerCondition: scheduleConditionSchema.default("never"),
    maxIterations: z.number().int().positive().optional(),
    isDaemon: z.boolean().default(false),
  })
  .refine(
    (data) => (data.durationSeconds !== undefined) !== (data.cronExpression !== undefined),
    {
      message: "Must specify exactly one of durationSeconds or cronExpression",
      path: ["durationSeconds"],
    }
  )
  .superRefine((data, ctx) => {
    if (data.cronExpression !== undefined) {
      try {
        parseCronExpression(data.cronExpression);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid cronExpression: ${err instanceof Error ? err.message : String(err)}`,
          path: ["cronExpression"],
        });
      }
    }
  });
export type ScheduleParams = z.infer<typeof scheduleParamsSchema>;

export const scheduleResultSchema = z.object({
  scheduleId: z.string().uuid(),
  type: z.enum(["one_shot", "cron"]),
  targetAt: z.string().datetime().optional(),
  nextRunAt: z.string().datetime().optional(),
  isDaemon: z.boolean(),
  status: z.enum(["active", "completed", "cancelled"]),
  prompt: z.string(),
  message: z.string().optional(),
});
export type ScheduleResult = z.infer<typeof scheduleResultSchema>;

/* ------------------------------------------------------------------ */
/* 4. Manage Task Tool Schemas                                        */
/* ------------------------------------------------------------------ */

export const manageTaskActionSchema = z.enum(["list", "kill", "status", "send_input"]);
export type ManageTaskAction = z.infer<typeof manageTaskActionSchema>;

export const manageTaskParamsSchema = z.object({
  action: manageTaskActionSchema,
  taskId: z.string().uuid().optional(),
  input: z.string().optional(),
});
export type ManageTaskParams = z.infer<typeof manageTaskParamsSchema>;

export const taskSummarySchema = z.object({
  taskId: z.string().uuid(),
  pid: z.number().int().positive(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  cwd: z.string(),
  isDaemon: z.boolean().default(false),
  status: taskStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  exitCode: z.number().int().nullable().optional(),
  recentLogs: z.string().optional(),
  truncated: z.boolean().optional(),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

export const manageTaskResultSchema = z.object({
  action: manageTaskActionSchema,
  tasks: z.array(taskSummarySchema).optional(),
  task: taskSummarySchema.optional(),
  success: z.boolean(),
  message: z.string().optional(),
});
export type ManageTaskResult = z.infer<typeof manageTaskResultSchema>;

/* ------------------------------------------------------------------ */
/* 5. Wire Protocol Task Lifecycle Events                             */
/* ------------------------------------------------------------------ */

export const taskLifecycleEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("task.spawned"),
    task: taskSummarySchema,
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("task.output"),
    taskId: z.string().uuid(),
    stream: z.enum(["stdout", "stderr"]),
    chunk: z.string(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("task.completed"),
    taskId: z.string().uuid(),
    exitCode: z.number().int().nullable(),
    durationMs: z.number().nonnegative(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("task.killed"),
    taskId: z.string().uuid(),
    signal: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("schedule.triggered"),
    scheduleId: z.string().uuid(),
    iteration: z.number().int().positive(),
    prompt: z.string(),
    at: z.string().datetime(),
  }),
  z.object({
    type: z.literal("schedule.cancelled"),
    scheduleId: z.string().uuid(),
    reason: z.string(),
    at: z.string().datetime(),
  }),
]);
export type TaskLifecycleEvent = z.infer<typeof taskLifecycleEventSchema>;

/* ------------------------------------------------------------------ */
/* 6. Pure Helper Utilities                                           */
/* ------------------------------------------------------------------ */

/**
 * Returns true if a task status represents a terminal state.
 */
export function isTaskTerminal(status: TaskStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "killed"
  );
}

/**
 * Returns true if a task status represents an active process.
 */
export function isTaskActive(status: TaskStatus): boolean {
  return status === "running";
}

/**
 * Evaluates whether a schedule timer condition is met by an incoming sender ID.
 */
export function matchesScheduleCondition(
  condition: ScheduleCondition,
  senderId?: string
): boolean {
  if (condition === "never") return false;
  if (condition === "any") return true;
  return condition === senderId;
}

/**
 * Helper to construct a validated TaskSummary object.
 */
export function createTaskSummary(params: {
  taskId?: string;
  pid: number;
  command: string;
  args?: string[];
  cwd: string;
  isDaemon?: boolean;
  status: TaskStatus;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  recentLogs?: string;
  truncated?: boolean;
}): TaskSummary {
  const taskId = params.taskId ?? crypto.randomUUID();
  const startedAt = params.startedAt ?? new Date().toISOString();

  return taskSummarySchema.parse({
    taskId,
    pid: params.pid,
    command: params.command,
    args: params.args ?? [],
    cwd: params.cwd,
    isDaemon: params.isDaemon ?? false,
    status: params.status,
    startedAt,
    completedAt: params.completedAt,
    exitCode: params.exitCode,
    recentLogs: params.recentLogs,
    truncated: params.truncated,
  });
}
