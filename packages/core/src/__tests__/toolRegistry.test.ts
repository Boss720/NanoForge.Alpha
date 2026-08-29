import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../tools/registry";
import { PolicyGate } from "../tools/policyGate";
import { zodToJsonSchemaShim } from "../tools/types";
import { CancellationTokenSource } from "../cancellation/cancellationToken";
import {
  mockReadTool,
  mockWriteTool,
  mockCommandTool,
  mockAdminTool,
  mockFailingTool,
  mockSlowTool,
} from "./mocks/mockTools";

describe("ToolRegistry & 4-Tier Policy Gate Subsystem", () => {
  describe("ToolRegistry", () => {
    it("registers tools and prevents duplicate name collisions", () => {
      const registry = new ToolRegistry();
      registry.register(mockReadTool);
      expect(registry.has("read_file")).toBe(true);
      expect(registry.get("read_file")).toBe(mockReadTool);

      expect(() => {
        registry.register(mockReadTool);
      }).toThrow(/already registered/);
    });

    it("registers multiple tools via registerMany", () => {
      const registry = new ToolRegistry();
      registry.registerMany([mockReadTool, mockWriteTool, mockCommandTool]);
      expect(registry.list().length).toBe(3);
    });

    it("validates tool parameters with Zod schema", () => {
      const registry = new ToolRegistry();
      registry.register(mockReadTool);

      const valid = registry.validateParams<{ path: string }>("read_file", { path: "src/index.ts" });
      expect(valid.path).toBe("src/index.ts");

      expect(() => {
        registry.validateParams("read_file", { path: 123 });
      }).toThrow();

      expect(() => {
        registry.validateParams("unknown_tool", {});
      }).toThrow(/not found/);
    });

    it("generates valid ToolDefinitions via zodToJsonSchemaShim", () => {
      const schema = z.object({
        name: z.string().describe("User name"),
        count: z.number().int().optional().default(1),
        tags: z.array(z.string()),
        mode: z.enum(["fast", "accurate"]),
      });

      const jsonSchema = zodToJsonSchemaShim(schema);
      expect(jsonSchema.type).toBe("object");
      expect(jsonSchema.properties).toHaveProperty("name");
      expect(jsonSchema.properties).toHaveProperty("count");
      expect(jsonSchema.properties).toHaveProperty("tags");
      expect(jsonSchema.properties).toHaveProperty("mode");
      expect((jsonSchema.required as string[])).toContain("name");
      expect((jsonSchema.required as string[])).not.toContain("count");
    });

    it("executes tool successfully and captures execution result", async () => {
      const registry = new ToolRegistry();
      registry.register(mockReadTool);
      const cts = new CancellationTokenSource();

      const result = await registry.executeTool(
        "read_file",
        { path: "README.md" },
        {
          workspaceRoot: "/test",
          cancellationToken: cts.token,
          callId: "call_123",
          turnIndex: 1,
          sessionId: "sess_1",
        }
      );

      expect(result.status).toBe("SUCCESS");
      expect(result.output).toContain("Mock content of README.md");
      expect(result.metadata.exitCode).toBe(0);
      expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("handles tool execution failure gracefully", async () => {
      const registry = new ToolRegistry();
      registry.register(mockFailingTool);
      const cts = new CancellationTokenSource();

      const result = await registry.executeTool(
        "fail_tool",
        { msg: "Custom error message" },
        {
          workspaceRoot: "/test",
          cancellationToken: cts.token,
          callId: "call_fail",
          turnIndex: 1,
          sessionId: "sess_1",
        }
      );

      expect(result.status).toBe("EXECUTION_ERROR");
      expect(result.error).toContain("Custom error message");
      expect(result.metadata.exitCode).toBe(1);
    });

    it("handles tool cancellation during execution", async () => {
      const registry = new ToolRegistry();
      registry.register(mockSlowTool);
      const cts = new CancellationTokenSource();

      const execPromise = registry.executeTool(
        "slow_tool",
        { durationMs: 2000 },
        {
          workspaceRoot: "/test",
          cancellationToken: cts.token,
          callId: "call_slow",
          turnIndex: 1,
          sessionId: "sess_1",
        }
      );

      // Cancel after 20ms
      setTimeout(() => {
        cts.cancel("user_requested", "User stopped execution");
      }, 20);

      const result = await execPromise;
      expect(result.status).toBe("CANCELLED");
      expect(result.metadata.exitCode).toBe(130);
    });
  });

  describe("PolicyGate 4-Tier Risk Governance", () => {
    it("auto-approves T0 read-only tools under default policy", async () => {
      const gate = new PolicyGate({ autoApproveUpTo: "T0_READ_ONLY" });

      const decision = await gate.evaluate({
        callId: "c1",
        toolName: "read_file",
        riskTier: "T0_READ_ONLY",
        params: { path: "foo.txt" },
        checkpointRequired: false,
      });

      expect(decision.verdict).toBe("ALLOW_ALWAYS");
    });

    it("requires approval for T2 tools when auto-approve threshold is T0", async () => {
      const gate = new PolicyGate({ autoApproveUpTo: "T0_READ_ONLY" });

      const decision = await gate.evaluate({
        callId: "c2",
        toolName: "run_command",
        riskTier: "T2_SIDE_EFFECT_GUARDED",
        params: { command: "npm test" },
        checkpointRequired: false,
      });

      expect(decision.verdict).toBe("PROMPT_USER");
    });

    it("invokes interactive approval handler when configured", async () => {
      const interactiveHandler = vi.fn().mockResolvedValue(true);
      const gate = new PolicyGate({
        autoApproveUpTo: "T0_READ_ONLY",
        interactiveApprovalHandler: interactiveHandler,
      });

      const decision = await gate.evaluate({
        callId: "c3",
        toolName: "admin_cleanup",
        riskTier: "T3_DESTRUCTIVE_ADMIN",
        params: { target: "/tmp" },
        checkpointRequired: false,
      });

      expect(interactiveHandler).toHaveBeenCalled();
      expect(decision.verdict).toBe("ALLOW_ONCE");
    });

    it("enforces explicit tool blacklist over everything else", async () => {
      const gate = new PolicyGate({
        autoApproveUpTo: "T3_DESTRUCTIVE_ADMIN",
        deniedTools: ["admin_cleanup"],
      });

      const decision = await gate.evaluate({
        callId: "c4",
        toolName: "admin_cleanup",
        riskTier: "T3_DESTRUCTIVE_ADMIN",
        params: { target: "/" },
        checkpointRequired: false,
      });

      expect(decision.verdict).toBe("DENY");
    });

    it("enforces explicit tool whitelist", async () => {
      const gate = new PolicyGate({
        autoApproveUpTo: "T0_READ_ONLY",
        allowedTools: ["run_command"],
      });

      const decision = await gate.evaluate({
        callId: "c5",
        toolName: "run_command",
        riskTier: "T2_SIDE_EFFECT_GUARDED",
        params: { command: "ls" },
        checkpointRequired: false,
      });

      expect(decision.verdict).toBe("ALLOW_ALWAYS");
    });
  });
});
