import { describe, expect, it } from "vitest";
import {
  RISK_TIER_RANK,
  approvalRequestSchema,
  approvalResponseSchema,
  classifyToolRisk,
  createProposedToolCall,
  createToolExecutionResult,
  isToolExecutionSuccessful,
  permissionDecisionSchema,
  permissionVerdictSchema,
  proposedToolCallSchema,
  requiresHumanApproval,
  toolExecutionMetadataSchema,
  toolExecutionResultSchema,
  toolExecutionStatusSchema,
  toolRiskTierSchema,
  type ApprovalRequest,
  type ApprovalResponse,
  type PermissionDecision,
  type PermissionVerdict,
  type ProposedToolCall,
  type ToolExecutionMetadata,
  type ToolExecutionResult,
  type ToolExecutionStatus,
  type ToolRiskTier,
} from "../tools";

describe("Tool Governance & Execution Result Wire Protocol", () => {
  const timestamp = "2026-08-21T22:30:00.000Z";

  describe("4-Tier Risk Matrix", () => {
    it("validates all 4 risk tiers", () => {
      const tiers: ToolRiskTier[] = [
        "T0_READ_ONLY",
        "T1_WORKSPACE_WRITE",
        "T2_SIDE_EFFECT_GUARDED",
        "T3_DESTRUCTIVE_ADMIN",
      ];
      for (const tier of tiers) {
        expect(toolRiskTierSchema.parse(tier)).toBe(tier);
      }
    });

    it("maintains strict ascending numerical rank ordering", () => {
      expect(RISK_TIER_RANK.T0_READ_ONLY).toBe(0);
      expect(RISK_TIER_RANK.T1_WORKSPACE_WRITE).toBe(1);
      expect(RISK_TIER_RANK.T2_SIDE_EFFECT_GUARDED).toBe(2);
      expect(RISK_TIER_RANK.T3_DESTRUCTIVE_ADMIN).toBe(3);

      expect(RISK_TIER_RANK.T0_READ_ONLY).toBeLessThan(RISK_TIER_RANK.T1_WORKSPACE_WRITE);
      expect(RISK_TIER_RANK.T1_WORKSPACE_WRITE).toBeLessThan(RISK_TIER_RANK.T2_SIDE_EFFECT_GUARDED);
      expect(RISK_TIER_RANK.T2_SIDE_EFFECT_GUARDED).toBeLessThan(RISK_TIER_RANK.T3_DESTRUCTIVE_ADMIN);
    });

    it("correctly classifies standard tool names", () => {
      // T0 Read only
      expect(classifyToolRisk("view_file")).toBe("T0_READ_ONLY");
      expect(classifyToolRisk("list_dir")).toBe("T0_READ_ONLY");
      expect(classifyToolRisk("grep_search")).toBe("T0_READ_ONLY");
      expect(classifyToolRisk("find_by_name")).toBe("T0_READ_ONLY");
      expect(classifyToolRisk("read_url_content")).toBe("T0_READ_ONLY");
      expect(classifyToolRisk("search_web")).toBe("T0_READ_ONLY");
      expect(classifyToolRisk("memory.get")).toBe("T0_READ_ONLY");
      expect(classifyToolRisk("memory.query")).toBe("T0_READ_ONLY");

      // T1 Workspace write
      expect(classifyToolRisk("write_to_file")).toBe("T1_WORKSPACE_WRITE");
      expect(classifyToolRisk("replace_file_content")).toBe("T1_WORKSPACE_WRITE");
      expect(classifyToolRisk("notebook_edit")).toBe("T1_WORKSPACE_WRITE");
      expect(classifyToolRisk("generate_image")).toBe("T1_WORKSPACE_WRITE");
      expect(classifyToolRisk("memory.set")).toBe("T1_WORKSPACE_WRITE");
      expect(classifyToolRisk("memory.delete")).toBe("T1_WORKSPACE_WRITE");

      // T2 Side effect guarded
      expect(classifyToolRisk("run_command")).toBe("T2_SIDE_EFFECT_GUARDED");
      expect(classifyToolRisk("terminal.exec")).toBe("T2_SIDE_EFFECT_GUARDED");
      expect(classifyToolRisk("terminal.create")).toBe("T2_SIDE_EFFECT_GUARDED");
      expect(classifyToolRisk("schedule")).toBe("T2_SIDE_EFFECT_GUARDED");
      expect(classifyToolRisk("manage_task")).toBe("T2_SIDE_EFFECT_GUARDED");
      expect(classifyToolRisk("send_message")).toBe("T2_SIDE_EFFECT_GUARDED");
      expect(classifyToolRisk("invoke_subagent")).toBe("T2_SIDE_EFFECT_GUARDED");

      // T3 Destructive admin
      expect(classifyToolRisk("system_admin")).toBe("T3_DESTRUCTIVE_ADMIN");
      expect(classifyToolRisk("delete_root")).toBe("T3_DESTRUCTIVE_ADMIN");
    });

    it("safely defaults unclassified tools to T2_SIDE_EFFECT_GUARDED", () => {
      expect(classifyToolRisk("custom_plugin_tool")).toBe("T2_SIDE_EFFECT_GUARDED");
      expect(classifyToolRisk("arbitrary_action", "T3_DESTRUCTIVE_ADMIN")).toBe("T3_DESTRUCTIVE_ADMIN");
      expect(classifyToolRisk("__proto__")).toBe("T2_SIDE_EFFECT_GUARDED");
      expect(classifyToolRisk("constructor")).toBe("T2_SIDE_EFFECT_GUARDED");
      expect(classifyToolRisk("toString")).toBe("T2_SIDE_EFFECT_GUARDED");
    });

    it("evaluates requiresHumanApproval correctly against autoApproveUpTo threshold", () => {
      // Default: autoApproveUpTo = T0_READ_ONLY
      expect(requiresHumanApproval("T0_READ_ONLY")).toBe(false);
      expect(requiresHumanApproval("T1_WORKSPACE_WRITE")).toBe(true);
      expect(requiresHumanApproval("T2_SIDE_EFFECT_GUARDED")).toBe(true);
      expect(requiresHumanApproval("T3_DESTRUCTIVE_ADMIN")).toBe(true);

      // Relaxed to T1_WORKSPACE_WRITE
      expect(requiresHumanApproval("T0_READ_ONLY", "T1_WORKSPACE_WRITE")).toBe(false);
      expect(requiresHumanApproval("T1_WORKSPACE_WRITE", "T1_WORKSPACE_WRITE")).toBe(false);
      expect(requiresHumanApproval("T2_SIDE_EFFECT_GUARDED", "T1_WORKSPACE_WRITE")).toBe(true);
      expect(requiresHumanApproval("T3_DESTRUCTIVE_ADMIN", "T1_WORKSPACE_WRITE")).toBe(true);

      // Fully relaxed to T3_DESTRUCTIVE_ADMIN
      expect(requiresHumanApproval("T3_DESTRUCTIVE_ADMIN", "T3_DESTRUCTIVE_ADMIN")).toBe(false);
    });
  });

  describe("Proposed Tool Call Schema & Factory", () => {
    it("creates and parses a proposed tool call with inferred risk tier", () => {
      const call = createProposedToolCall("call-1", "write_to_file", {
        TargetFile: "/path/to/file.ts",
        CodeContent: "const a = 1;",
      });

      expect(call.callId).toBe("call-1");
      expect(call.toolName).toBe("write_to_file");
      expect(call.riskTier).toBe("T1_WORKSPACE_WRITE");
      expect(call.checkpointRequired).toBe(false);

      const parsed: ProposedToolCall = proposedToolCallSchema.parse(call);
      expect(parsed).toEqual(call);
    });

    it("supports custom options in createProposedToolCall", () => {
      const call = createProposedToolCall(
        "call-2",
        "run_command",
        { CommandLine: "cargo test" },
        {
          riskTier: "T2_SIDE_EFFECT_GUARDED",
          justification: "Run unit tests",
          checkpointRequired: true,
          timeoutMs: 30000,
        }
      );

      expect(call.justification).toBe("Run unit tests");
      expect(call.checkpointRequired).toBe(true);
      expect(call.timeoutMs).toBe(30000);
    });

    it("rejects proposed tool call with empty toolName or callId", () => {
      expect(() =>
        proposedToolCallSchema.parse({
          callId: "",
          toolName: "test",
          params: {},
        })
      ).toThrow();

      expect(() =>
        proposedToolCallSchema.parse({
          callId: "c1",
          toolName: "",
          params: {},
        })
      ).toThrow();
    });
  });

  describe("Permission Verdicts & Approval Requests", () => {
    it("validates permission verdicts", () => {
      const verdicts: PermissionVerdict[] = [
        "ALLOW_ALWAYS",
        "ALLOW_ONCE",
        "DENY",
        "PROMPT_USER",
      ];
      for (const v of verdicts) {
        expect(permissionVerdictSchema.parse(v)).toBe(v);
      }
    });

    it("validates all permission decision variants", () => {
      const decisions: PermissionDecision[] = [
        {
          verdict: "ALLOW_ALWAYS",
          reason: "Rule matched: allow all read operations",
          matchedRule: "rule-read-all",
        },
        {
          verdict: "ALLOW_ONCE",
          reason: "User confirmed single invocation",
        },
        {
          verdict: "DENY",
          reason: "Path /etc/shadow is outside allowed workspace boundary",
        },
        {
          verdict: "PROMPT_USER",
          promptMessage: "Do you want to run `npm publish`?",
          defaultAction: "DENY",
          suggestedScope: "session",
        },
      ];

      for (const d of decisions) {
        const parsed = permissionDecisionSchema.parse(d);
        expect(parsed).toEqual(d);
      }
    });

    it("round-trips approvalRequestSchema and approvalResponseSchema", () => {
      const req: ApprovalRequest = {
        requestId: "req-1",
        runId: "run-10",
        toolCall: {
          callId: "call-1",
          toolName: "run_command",
          riskTier: "T2_SIDE_EFFECT_GUARDED",
          params: { cmd: "rm -rf tmp" },
          checkpointRequired: false,
        },
        reason: "Dangerous command execution requires user approval",
        at: timestamp,
      };

      const parsedReq = approvalRequestSchema.parse(req);
      expect(parsedReq).toEqual(req);

      const resp: ApprovalResponse = {
        requestId: "req-1",
        runId: "run-10",
        approved: true,
        reason: "User approved in GUI",
        at: timestamp,
      };

      const parsedResp = approvalResponseSchema.parse(resp);
      expect(parsedResp).toEqual(resp);
    });
  });

  describe("Tool Execution Result Schemas & Outcome Helpers", () => {
    it("validates all tool execution statuses", () => {
      const statuses: ToolExecutionStatus[] = [
        "SUCCESS",
        "PERMISSION_DENIED",
        "EXECUTION_ERROR",
        "TIMEOUT",
        "CANCELLED",
      ];
      for (const status of statuses) {
        expect(toolExecutionStatusSchema.parse(status)).toBe(status);
      }
    });

    it("creates standard successful execution result", () => {
      const res = createToolExecutionResult(
        "call-1",
        "view_file",
        "SUCCESS",
        "file content here",
        { durationMs: 12.4, bytesWritten: 0 },
        undefined,
        timestamp
      );

      expect(res.status).toBe("SUCCESS");
      expect(res.metadata.exitCode).toBe(0);
      expect(res.metadata.durationMs).toBe(12.4);
      expect(isToolExecutionSuccessful(res)).toBe(true);

      const parsed = toolExecutionResultSchema.parse(res);
      expect(parsed).toEqual(res);
    });

    it("creates error execution result and handles null exitCode for cancelled processes", () => {
      const res = createToolExecutionResult(
        "call-2",
        "run_command",
        "CANCELLED",
        "",
        { durationMs: 500, exitCode: null },
        "Process terminated via SIGINT",
        timestamp
      );

      expect(res.status).toBe("CANCELLED");
      expect(res.metadata.exitCode).toBeNull();
      expect(res.error).toBe("Process terminated via SIGINT");
      expect(isToolExecutionSuccessful(res)).toBe(false);

      const parsed = toolExecutionResultSchema.parse(res);
      expect(parsed).toEqual(res);
    });

    it("validates metadata with checksum and checkpoint fields", () => {
      const meta: ToolExecutionMetadata = {
        exitCode: 0,
        durationMs: 450.2,
        bytesWritten: 1024,
        sha256Digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        truncated: true,
        checkpointId: "chk-001",
      };

      const parsed = toolExecutionMetadataSchema.parse(meta);
      expect(parsed).toEqual(meta);
    });
  });
});
