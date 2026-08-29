/**
 * Daemon Manager Controller.
 *
 * Implements high-level action handlers for `manage_task` and `schedule`:
 * - manage_task: list, kill, status, send_input
 * - schedule: duration-based timers & 5-field cron schedules
 */
import type {
  ManageTaskParams,
  ManageTaskResult,
  ScheduleParams,
  ScheduleResult,
} from "@protocol/tasks";
import { createHash } from "node:crypto";
import path from "node:path";
import { DaemonSupervisor } from "./supervisor.js";
import { TaskScheduler } from "./scheduler.js";
import type { SpawnTaskOptions } from "./types.js";

export type DaemonMutationOperation =
  | "task.spawn"
  | "task.kill"
  | "task.send_input"
  | "schedule.create"
  | "schedule.cancel";

export interface DaemonAuthorizationContext {
  readonly operation: DaemonMutationOperation;
  /** Non-secret, normalized metadata. Values such as commands/arguments are digests only. */
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export type DaemonAuthorizationCallback =
  (context: DaemonAuthorizationContext) => boolean | Promise<boolean>;

export interface DaemonManagerOptions {
  /** Enables fail-closed authorization for all process/schedule mutations. */
  readonly enforceCapabilityAuthorization?: boolean;
  readonly authorize?: DaemonAuthorizationCallback;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class DaemonManager {
  readonly supervisor: DaemonSupervisor;
  readonly scheduler: TaskScheduler;
  readonly workspaceRoot?: string;
  private readonly enforceCapabilityAuthorization: boolean;
  private readonly authorize?: DaemonAuthorizationCallback;

  constructor(
    supervisor?: DaemonSupervisor,
    scheduler?: TaskScheduler,
    workspaceRoot?: string,
    options: DaemonManagerOptions = {},
  ) {
    this.supervisor = supervisor ?? new DaemonSupervisor(workspaceRoot);
    this.scheduler = scheduler ?? new TaskScheduler();
    this.workspaceRoot = this.supervisor.workspaceRoot;
    this.enforceCapabilityAuthorization = options.enforceCapabilityAuthorization ?? false;
    this.authorize = options.authorize;
  }

  /** Authorized process-spawn entry point for future session-owned capability grants. */
  async spawnTask(options: SpawnTaskOptions) {
    await this.requireAuthorization("task.spawn", {
      commandDigest: digest(path.basename(options.command)),
      argsDigest: digest(options.args ?? []),
      cwdDigest: digest(path.resolve(options.cwd)),
      environmentKeys: Object.keys(options.env ?? {}).sort().join(","),
      isDaemon: options.isDaemon ?? false,
    });
    return this.supervisor.spawnTask(options);
  }

  /**
   * Executes `manage_task` actions.
   */
  async manageTask(params: ManageTaskParams): Promise<ManageTaskResult> {
    switch (params.action) {
      case "list": {
        const tasks = this.supervisor.listTasks();
        return {
          action: "list",
          tasks,
          success: true,
          message: `Retrieved ${tasks.length} tasks`,
        };
      }

      case "status": {
        if (!params.taskId) {
          return {
            action: "status",
            success: false,
            message: "Missing required parameter: taskId",
          };
        }
        const task = this.supervisor.getTask(params.taskId);
        if (!task) {
          return {
            action: "status",
            success: false,
            message: `Task not found: ${params.taskId}`,
          };
        }
        return {
          action: "status",
          task,
          success: true,
        };
      }

      case "kill": {
        if (!params.taskId) {
          return {
            action: "kill",
            success: false,
            message: "Missing required parameter: taskId",
          };
        }
        if (!(await this.isAuthorized("task.kill", { taskId: params.taskId }))) {
          return { action: "kill", success: false, message: "Capability authorization denied: task.kill" };
        }
        const killResult = await this.supervisor.killTask(params.taskId);
        const task = this.supervisor.getTask(params.taskId);
        return {
          action: "kill",
          task,
          success: killResult.success,
          message: killResult.message ?? (killResult.success ? `Task ${params.taskId} terminated` : "Kill failed"),
        };
      }

      case "send_input": {
        if (!params.taskId) {
          return {
            action: "send_input",
            success: false,
            message: "Missing required parameter: taskId",
          };
        }
        if (params.input === undefined) {
          return {
            action: "send_input",
            success: false,
            message: "Missing required parameter: input",
          };
        }
        if (!(await this.isAuthorized("task.send_input", {
          taskId: params.taskId,
          inputDigest: digest(params.input),
        }))) {
          return { action: "send_input", success: false, message: "Capability authorization denied: task.send_input" };
        }
        const inputResult = await this.supervisor.sendInput(params.taskId, params.input);
        const task = this.supervisor.getTask(params.taskId);
        return {
          action: "send_input",
          task,
          success: inputResult.success,
          message: inputResult.message ?? (inputResult.success ? "Input sent to stdin" : "Failed to send input"),
        };
      }

      default:
        return {
          action: params.action,
          success: false,
          message: `Unsupported action: ${String(params.action)}`,
        };
    }
  }

  /**
   * Executes `schedule` operations.
   */
  async scheduleTask(params: ScheduleParams, creatorSubagentId?: string): Promise<ScheduleResult> {
    await this.requireAuthorization("schedule.create", {
      scheduleType: params.durationSeconds !== undefined ? "one_shot" : "cron",
      durationSeconds: params.durationSeconds ?? 0,
      cronDigest: params.cronExpression ? digest(params.cronExpression) : "",
      promptDigest: digest(params.prompt),
      isDaemon: params.isDaemon ?? false,
      creatorPresent: Boolean(creatorSubagentId),
    });
    return this.scheduler.schedule(params, creatorSubagentId);
  }

  /** Authorized schedule-cancellation entry point for future session-owned grants. */
  async cancelSchedule(scheduleId: string, reason?: string): Promise<boolean> {
    if (!(await this.isAuthorized("schedule.cancel", {
      scheduleId,
      reasonDigest: digest(reason ?? "Cancelled by user or system"),
    }))) return false;
    return this.scheduler.cancel(scheduleId, reason);
  }

  /**
   * Cleans up all managed resources.
   */
  async dispose(): Promise<void> {
    await this.supervisor.killAll();
    this.scheduler.dispose();
  }

  private async isAuthorized(
    operation: DaemonMutationOperation,
    metadata: Readonly<Record<string, string | number | boolean>>,
  ): Promise<boolean> {
    if (!this.enforceCapabilityAuthorization) return true;
    if (!this.authorize) return false;
    try {
      return (await this.authorize({ operation, metadata })) === true;
    } catch {
      return false;
    }
  }

  private async requireAuthorization(
    operation: DaemonMutationOperation,
    metadata: Readonly<Record<string, string | number | boolean>>,
  ): Promise<void> {
    if (!(await this.isAuthorized(operation, metadata))) {
      throw new Error(`Capability authorization denied: ${operation}`);
    }
  }
}
