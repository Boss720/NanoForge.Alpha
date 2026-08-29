/**
 * LLM Tool Execution Wrappers for `manage_task` and `schedule`.
 */
import {
  manageTaskParamsSchema,
  scheduleParamsSchema,
  type ManageTaskParams,
  type ManageTaskResult,
  type ScheduleParams,
  type ScheduleResult,
} from "@protocol/tasks";
import type { DaemonManager } from "./manager.js";

/**
 * Executes the `manage_task` tool with runtime schema validation.
 */
export async function executeManageTaskTool(
  manager: DaemonManager,
  rawParams: unknown
): Promise<ManageTaskResult> {
  const parsed = manageTaskParamsSchema.parse(rawParams);
  return manager.manageTask(parsed);
}

/**
 * Executes the `schedule` tool with runtime schema validation.
 */
export async function executeScheduleTool(
  manager: DaemonManager,
  rawParams: unknown,
  creatorSubagentId?: string
): Promise<ScheduleResult> {
  const parsed = scheduleParamsSchema.parse(rawParams);
  return manager.scheduleTask(parsed, creatorSubagentId);
}
