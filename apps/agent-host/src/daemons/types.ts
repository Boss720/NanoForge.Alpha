/**
 * Background Daemon Task Supervisor & Scheduler — Internal Types & Interfaces.
 */
import type {
  TaskId,
  ScheduleId,
  TaskStatus,
  ScheduleCondition,
  TaskSummary,
  ScheduleParams,
  ScheduleResult,
  ManageTaskParams,
  ManageTaskResult,
  TaskLifecycleEvent,
} from "@protocol/tasks";
import type { ChildProcess } from "node:child_process";

export interface SpawnTaskOptions {
  taskId?: TaskId;
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  isDaemon?: boolean;
  creatorSubagentId?: string;
  maxBufferBytes?: number;
  timeoutMs?: number;
}

export interface SupervisedTaskRecord {
  taskId: TaskId;
  pid: number;
  command: string;
  args: string[];
  cwd: string;
  isDaemon: boolean;
  creatorSubagentId?: string;
  status: TaskStatus;
  startedAt: string;
  completedAt?: string;
  exitCode?: number | null;
  childProcess?: ChildProcess;
  ringBuffer: CircularRingBufferInterface;
  durationMs?: number;
  timeoutTimer?: NodeJS.Timeout;
}

export interface CircularRingBufferInterface {
  append(chunk: string | Buffer): void;
  readLogs(): string;
  isTruncated(): boolean;
  clear(): void;
  readonly byteLength: number;
  readonly maxBytes: number;
}

export interface SupervisedScheduleRecord {
  scheduleId: ScheduleId;
  type: "one_shot" | "cron";
  prompt: string;
  targetAt?: string;
  nextRunAt?: string;
  durationSeconds?: number;
  cronExpression?: string;
  timerCondition: ScheduleCondition;
  maxIterations?: number;
  currentIteration: number;
  isDaemon: boolean;
  creatorSubagentId?: string;
  status: "active" | "completed" | "cancelled";
  timerHandle?: NodeJS.Timeout;
  createdAt: string;
}

export type TaskEventListener = (event: TaskLifecycleEvent) => void;
