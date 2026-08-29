/**
 * High-Precision Reactive Task Scheduler & 5-Field Cron Parser.
 *
 * Supports:
 * - One-shot timers (`durationSeconds`) with conditional early termination:
 *   - "never": executes unconditionally at expiry
 *   - "any": cancels early on any inbound message
 *   - "<sender-id>": cancels early on message from specific subagent ID
 * - Fallback wakeup synthesis when monitored target sender terminates
 * - 5-field cron recurring jobs (`cronExpression`) with `maxIterations`
 * - Automatic teardown of non-daemon schedules when creator terminates
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  parseCronExpression,
  getNextCronOccurrence,
  matchesScheduleCondition,
  scheduleParamsSchema,
  TASK_ERROR_CODES,
  type ScheduleId,
  type ScheduleParams,
  type ScheduleResult,
  type TaskLifecycleEvent,
} from "@protocol/tasks";
import type { z } from "zod";
import type { SupervisedScheduleRecord, TaskEventListener } from "./types.js";

export type ScheduleInput = z.input<typeof scheduleParamsSchema>;

export class TaskScheduler extends EventEmitter {
  private readonly schedules = new Map<ScheduleId, SupervisedScheduleRecord>();
  private cronTickerHandle?: NodeJS.Timeout;

  constructor() {
    super();
    this.setMaxListeners(100);
    this.startCronTicker();
  }

  /**
   * Creates a one-shot timer or recurring cron schedule.
   */
  schedule(rawParams: ScheduleInput, creatorSubagentId?: string): ScheduleResult {
    const params = scheduleParamsSchema.parse(rawParams);
    const scheduleId = randomUUID();
    const createdAt = new Date().toISOString();
    const isDaemon = params.isDaemon ?? false;

    if (params.durationSeconds !== undefined) {
      // One-shot timer
      const durationMs = params.durationSeconds * 1000;
      const targetTime = new Date(Date.now() + durationMs);
      const targetAt = targetTime.toISOString();

      const record: SupervisedScheduleRecord = {
        scheduleId,
        type: "one_shot",
        prompt: params.prompt,
        targetAt,
        durationSeconds: params.durationSeconds,
        timerCondition: params.timerCondition ?? "never",
        currentIteration: 0,
        isDaemon,
        creatorSubagentId,
        status: "active",
        createdAt,
      };

      const timer = setTimeout(() => {
        this.triggerSchedule(scheduleId);
      }, durationMs);

      // Don't keep Node process alive if only non-daemon timers are pending
      if (!isDaemon && timer.unref) {
        timer.unref();
      }

      record.timerHandle = timer;
      this.schedules.set(scheduleId, record);

      return {
        scheduleId,
        type: "one_shot",
        targetAt,
        isDaemon,
        status: "active",
        prompt: params.prompt,
        message: `One-shot timer scheduled to fire in ${params.durationSeconds}s (condition: ${record.timerCondition})`,
      };
    } else if (params.cronExpression !== undefined) {
      // Recurring Cron
      const parsedCron = parseCronExpression(params.cronExpression);
      const nextRun = getNextCronOccurrence(parsedCron, new Date());
      const nextRunAt = nextRun ? nextRun.toISOString() : undefined;

      const record: SupervisedScheduleRecord = {
        scheduleId,
        type: "cron",
        prompt: params.prompt,
        cronExpression: params.cronExpression,
        nextRunAt,
        timerCondition: "never",
        maxIterations: params.maxIterations,
        currentIteration: 0,
        isDaemon,
        creatorSubagentId,
        status: "active",
        createdAt,
      };

      this.schedules.set(scheduleId, record);

      return {
        scheduleId,
        type: "cron",
        nextRunAt,
        isDaemon,
        status: "active",
        prompt: params.prompt,
        message: `Cron schedule registered: "${params.cronExpression}" (next: ${nextRunAt ?? 'none'})`,
      };
    } else {
      throw new Error("Must specify either durationSeconds or cronExpression");
    }
  }

  /**
   * Cancels a schedule by ID.
   */
  cancel(scheduleId: ScheduleId, reason: string = "Cancelled by user or system"): boolean {
    const record = this.schedules.get(scheduleId);
    if (!record || record.status !== "active") {
      return false;
    }

    if (record.timerHandle) {
      clearTimeout(record.timerHandle);
      record.timerHandle = undefined;
    }

    record.status = "cancelled";

    this.emitLifecycleEvent({
      type: "schedule.cancelled",
      scheduleId,
      reason,
      at: new Date().toISOString(),
    });

    return true;
  }

  /**
   * Cancels all non-daemon schedules belonging to a creator subagent when it terminates.
   */
  cancelByCreator(creatorSubagentId: string, reason: string = "Creator subagent terminated"): void {
    for (const record of this.schedules.values()) {
      if (record.creatorSubagentId === creatorSubagentId && !record.isDaemon && record.status === "active") {
        this.cancel(record.scheduleId, reason);
      }
    }
  }

  /**
   * Notifies scheduler that a message was received from senderId.
   * Cancels any one-shot timer with matching condition ("any" or "<senderId>").
   */
  notifyMessageReceived(senderId?: string): ScheduleId[] {
    const cancelledIds: ScheduleId[] = [];
    for (const record of this.schedules.values()) {
      if (record.status === "active" && record.type === "one_shot") {
        if (matchesScheduleCondition(record.timerCondition, senderId)) {
          this.cancel(
            record.scheduleId,
            `Early cancellation: message received matching condition "${record.timerCondition}"`
          );
          cancelledIds.push(record.scheduleId);
        }
      }
    }
    return cancelledIds;
  }

  /**
   * Notifies scheduler that a sender terminated/crashed.
   * Synthesizes immediate fallback trigger if a timer was waiting for it.
   */
  notifySenderDied(senderId: string): ScheduleId[] {
    const triggeredIds: ScheduleId[] = [];
    for (const record of this.schedules.values()) {
      if (record.status === "active" && record.type === "one_shot") {
        if (record.timerCondition === senderId) {
          // Clear timer and trigger immediately as fallback
          if (record.timerHandle) {
            clearTimeout(record.timerHandle);
            record.timerHandle = undefined;
          }
          this.triggerSchedule(record.scheduleId, `[FALLBACK: Sender ${senderId} terminated]`);
          triggeredIds.push(record.scheduleId);
        }
      }
    }
    return triggeredIds;
  }

  /**
   * Retrieves a schedule record by ID.
   */
  getSchedule(scheduleId: ScheduleId): SupervisedScheduleRecord | undefined {
    return this.schedules.get(scheduleId);
  }

  /**
   * Lists schedules filtered by criteria.
   */
  listSchedules(filter?: {
    isDaemon?: boolean;
    status?: "active" | "completed" | "cancelled";
    creatorSubagentId?: string;
  }): SupervisedScheduleRecord[] {
    const results: SupervisedScheduleRecord[] = [];
    for (const record of this.schedules.values()) {
      if (filter?.isDaemon !== undefined && record.isDaemon !== filter.isDaemon) continue;
      if (filter?.status !== undefined && record.status !== filter.status) continue;
      if (filter?.creatorSubagentId !== undefined && record.creatorSubagentId !== filter.creatorSubagentId) continue;
      results.push(record);
    }
    return results;
  }

  /**
   * Subscribes to wire schedule events.
   */
  subscribe(listener: TaskEventListener): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }

  /**
   * Shuts down all timers and tickers.
   */
  dispose(): void {
    if (this.cronTickerHandle) {
      clearInterval(this.cronTickerHandle);
      this.cronTickerHandle = undefined;
    }
    for (const record of this.schedules.values()) {
      if (record.timerHandle) {
        clearTimeout(record.timerHandle);
        record.timerHandle = undefined;
      }
    }
    this.schedules.clear();
  }

  private triggerSchedule(scheduleId: ScheduleId, prefix?: string): void {
    const record = this.schedules.get(scheduleId);
    if (!record || record.status !== "active") return;

    record.currentIteration += 1;
    const prompt = prefix ? `${prefix} ${record.prompt}` : record.prompt;

    this.emitLifecycleEvent({
      type: "schedule.triggered",
      scheduleId,
      iteration: record.currentIteration,
      prompt,
      at: new Date().toISOString(),
    });

    if (record.type === "one_shot") {
      record.status = "completed";
    } else if (record.type === "cron") {
      if (record.maxIterations && record.currentIteration >= record.maxIterations) {
        record.status = "completed";
      } else if (record.cronExpression) {
        const next = getNextCronOccurrence(record.cronExpression, new Date());
        record.nextRunAt = next ? next.toISOString() : undefined;
      }
    }
  }

  private startCronTicker(): void {
    // Check every 10 seconds for cron schedule activations
    this.cronTickerHandle = setInterval(() => {
      const now = new Date();
      for (const record of this.schedules.values()) {
        if (record.status === "active" && record.type === "cron" && record.nextRunAt) {
          const nextRunDate = new Date(record.nextRunAt);
          if (now.getTime() >= nextRunDate.getTime()) {
            this.triggerSchedule(record.scheduleId);
          }
        }
      }
    }, 10_000);

    if (this.cronTickerHandle.unref) {
      this.cronTickerHandle.unref();
    }
  }

  private emitLifecycleEvent(event: TaskLifecycleEvent): void {
    this.emit("event", event);
    this.emit(event.type, event);
  }
}
