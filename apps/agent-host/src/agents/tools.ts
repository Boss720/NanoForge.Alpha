/**
 * LLM Tool Execution Handlers for Subagent Lifecycle & Shared Memory Primitives.
 */
import {
  invokeSubagentParamsSchema,
  manageSubagentsParamsSchema,
  sendMessageParamsSchema,
  defineSubagentParamsSchema,
  type InvokeSubagentResult,
  type ManageSubagentsResult,
  type SendMessageResult,
  type DefineSubagentResult,
} from "@protocol/subagents";
import {
  memorySetParamsSchema,
  memoryGetParamsSchema,
  memoryQueryParamsSchema,
  memoryDeleteParamsSchema,
  type MemorySetResult,
  type MemoryGetResult,
  type MemoryQueryResult,
  type MemoryDeleteResult,
} from "@protocol/memory";
import type { SubagentSupervisor } from "./supervisor.js";
import type { SharedMemoryEngine } from "./memory.js";

/**
 * Handles execution of `invoke_subagent`.
 */
export async function executeInvokeSubagentTool(
  supervisor: SubagentSupervisor,
  rawParams: unknown,
  parentId?: string
): Promise<InvokeSubagentResult> {
  const params = invokeSubagentParamsSchema.parse(rawParams);
  return supervisor.spawnSubagent(params, parentId);
}

/**
 * Handles execution of `manage_subagents`.
 */
export async function executeManageSubagentsTool(
  supervisor: SubagentSupervisor,
  rawParams: unknown,
  callerId?: string
): Promise<ManageSubagentsResult> {
  const params = manageSubagentsParamsSchema.parse(rawParams);
  return supervisor.manageSubagents(params, callerId);
}

/**
 * Handles execution of `send_message`.
 */
export async function executeSendMessageTool(
  supervisor: SubagentSupervisor,
  rawParams: unknown,
  senderId: string
): Promise<SendMessageResult> {
  const params = sendMessageParamsSchema.parse(rawParams);
  return supervisor.sendMessage(params, senderId);
}

/**
 * Handles execution of `define_subagent`.
 */
export async function executeDefineSubagentTool(
  supervisor: SubagentSupervisor,
  rawParams: unknown
): Promise<DefineSubagentResult> {
  const params = defineSubagentParamsSchema.parse(rawParams);
  return supervisor.defineSubagent(params);
}

/**
 * Handles execution of `memory.set`.
 */
export async function executeMemorySetTool(
  memoryEngine: SharedMemoryEngine,
  rawParams: unknown,
  authorInfo?: { id?: string; name?: string }
): Promise<MemorySetResult> {
  const params = memorySetParamsSchema.parse(rawParams);
  return memoryEngine.set(params, authorInfo);
}

/**
 * Handles execution of `memory.get`.
 */
export async function executeMemoryGetTool(
  memoryEngine: SharedMemoryEngine,
  rawParams: unknown
): Promise<MemoryGetResult> {
  const params = memoryGetParamsSchema.parse(rawParams);
  return memoryEngine.get(params);
}

/**
 * Handles execution of `memory.query`.
 */
export async function executeMemoryQueryTool(
  memoryEngine: SharedMemoryEngine,
  rawParams: unknown
): Promise<MemoryQueryResult> {
  const params = memoryQueryParamsSchema.parse(rawParams);
  return memoryEngine.query(params);
}

/**
 * Handles execution of `memory.delete`.
 */
export async function executeMemoryDeleteTool(
  memoryEngine: SharedMemoryEngine,
  rawParams: unknown
): Promise<MemoryDeleteResult> {
  const params = memoryDeleteParamsSchema.parse(rawParams);
  return memoryEngine.delete(params);
}
