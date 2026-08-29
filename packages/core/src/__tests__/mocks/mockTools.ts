/**
 * Mock Tools across T0-T3 Risk Tiers for Testing.
 */

import { z } from "zod";
import type { Tool, ToolExecutionContext } from "../../tools/types";

export const mockReadTool: Tool<{ path: string }, { content: string }> = {
  name: "read_file",
  description: "Reads file content from workspace",
  schema: z.object({
    path: z.string().describe("Relative file path"),
  }),
  riskTier: "T0_READ_ONLY",
  async execute(params, context: ToolExecutionContext) {
    context.cancellationToken.throwIfCancelled();
    return { content: `Mock content of ${params.path}` };
  },
};

export const mockWriteTool: Tool<{ path: string; content: string }, { bytesWritten: number }> = {
  name: "write_file",
  description: "Writes content to a file in workspace",
  schema: z.object({
    path: z.string().describe("Relative file path"),
    content: z.string().describe("Text content to write"),
  }),
  riskTier: "T1_WORKSPACE_WRITE",
  async execute(params, context: ToolExecutionContext) {
    context.cancellationToken.throwIfCancelled();
    return { bytesWritten: params.content.length };
  },
};

export const mockCommandTool: Tool<{ command: string }, { stdout: string; exitCode: number }> = {
  name: "run_command",
  description: "Executes a shell command",
  schema: z.object({
    command: z.string().describe("Shell command to run"),
  }),
  riskTier: "T2_SIDE_EFFECT_GUARDED",
  async execute(params, context: ToolExecutionContext) {
    context.cancellationToken.throwIfCancelled();
    return { stdout: `Executed: ${params.command}`, exitCode: 0 };
  },
};

export const mockAdminTool: Tool<{ target: string; force?: boolean }, { success: boolean }> = {
  name: "admin_cleanup",
  description: "Destructive administrator cleanup tool",
  schema: z.object({
    target: z.string(),
    force: z.boolean().optional().default(false),
  }),
  riskTier: "T3_DESTRUCTIVE_ADMIN",
  async execute(params, context: ToolExecutionContext) {
    context.cancellationToken.throwIfCancelled();
    return { success: true };
  },
};

export const mockFailingTool: Tool<{ msg?: string }, never> = {
  name: "fail_tool",
  description: "Always fails for error recovery testing",
  schema: z.object({
    msg: z.string().optional(),
  }),
  riskTier: "T0_READ_ONLY",
  async execute(params) {
    throw new Error(params.msg || "Intentional mock tool failure");
  },
};

export const mockSlowTool: Tool<{ durationMs: number }, { completed: boolean }> = {
  name: "slow_tool",
  description: "Simulates a long-running tool with cancellation checks",
  schema: z.object({
    durationMs: z.number().default(500),
  }),
  riskTier: "T2_SIDE_EFFECT_GUARDED",
  async execute(params, context) {
    const start = Date.now();
    while (Date.now() - start < params.durationMs) {
      context.cancellationToken.throwIfCancelled();
      await new Promise((r) => setTimeout(r, 10));
    }
    return { completed: true };
  },
};
