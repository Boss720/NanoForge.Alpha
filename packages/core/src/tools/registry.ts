/**
 * Tool Registry & Execution Dispatcher.
 *
 * Provides thread-safe tool registration, parameter validation, and execution
 * with telemetry, timing, and error normalization.
 */

import {
  createToolExecutionResult,
  type ToolExecutionResult,
} from "@nanoforge/protocol";
import {
  zodToJsonSchemaShim,
  type Tool,
  type ToolDefinition,
  type ToolExecutionContext,
} from "./types";
import { CancellationError } from "../cancellation/types";

export class ToolRegistry {
  private readonly _tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (!tool || typeof tool.name !== "string" || !tool.name.trim()) {
      throw new Error("Invalid tool definition: missing name.");
    }
    if (this._tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this._tools.set(tool.name, tool);
  }

  registerMany(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): Tool | undefined {
    return this._tools.get(name);
  }

  has(name: string): boolean {
    return this._tools.has(name);
  }

  list(): Tool[] {
    return Array.from(this._tools.values());
  }

  validateParams<T = any>(name: string, rawParams: unknown): T {
    const tool = this._tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found in registry.`);
    }
    const params = typeof rawParams === "object" && rawParams !== null ? rawParams : {};
    return tool.schema.parse(params) as T;
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchemaShim(tool.schema),
    }));
  }

  async executeTool(
    name: string,
    rawParams: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const start = Date.now();
    const tool = this._tools.get(name);

    if (!tool) {
      return createToolExecutionResult(
        context.callId,
        name,
        "EXECUTION_ERROR",
        `Tool "${name}" not found in registry.`,
        { exitCode: 1, durationMs: Date.now() - start },
        `Tool "${name}" not found in registry.`
      );
    }

    try {
      context.cancellationToken.throwIfCancelled();

      // 1. Validate parameters
      let validatedParams: any;
      try {
        validatedParams = tool.schema.parse(
          typeof rawParams === "object" && rawParams !== null ? rawParams : {}
        );
      } catch (err: any) {
        return createToolExecutionResult(
          context.callId,
          name,
          "EXECUTION_ERROR",
          `Parameter validation failed for tool "${name}": ${err.message || String(err)}`,
          { exitCode: 1, durationMs: Date.now() - start },
          err.message || String(err)
        );
      }

      context.cancellationToken.throwIfCancelled();

      // 2. Execute tool
      const result = await tool.execute(validatedParams, context);
      const durationMs = Date.now() - start;

      const outputStr =
        typeof result === "string"
          ? result
          : typeof result === "object" && result !== null
          ? JSON.stringify(result, null, 2)
          : String(result ?? "");

      return createToolExecutionResult(
        context.callId,
        name,
        "SUCCESS",
        outputStr,
        { exitCode: 0, durationMs }
      );
    } catch (err: any) {
      const durationMs = Date.now() - start;
      if (err instanceof CancellationError || context.cancellationToken.isCancellationRequested) {
        return createToolExecutionResult(
          context.callId,
          name,
          "CANCELLED",
          `Execution cancelled: ${err.message || "Operation aborted"}`,
          { exitCode: 130, durationMs },
          err.message || "Operation aborted"
        );
      }

      return createToolExecutionResult(
        context.callId,
        name,
        "EXECUTION_ERROR",
        `Tool execution failed: ${err.message || String(err)}`,
        { exitCode: 1, durationMs },
        err.message || String(err)
      );
    }
  }
}
