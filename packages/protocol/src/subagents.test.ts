import { describe, expect, it } from "vitest";
import {
  subagentStateSchema,
  subagentArchetypeSchema,
  workspaceIsolationModeSchema,
  supervisorStrategySchema,
  messagePrioritySchema,
  subagentConfigSchema,
  subagentInfoSchema,
  subagentSummarySchema,
  subagentTelemetrySchema,
  subagentMessageSchema,
  agentMessageFrameSchema,
  subagentLifecycleEventSchema,
  invokeSubagentParamsSchema,
  invokeSubagentResultSchema,
  manageSubagentsActionSchema,
  manageSubagentsParamsSchema,
  manageSubagentsResultSchema,
  sendMessageParamsSchema,
  sendMessageResultSchema,
  defineSubagentParamsSchema,
  defineSubagentResultSchema,
  isValidStateTransition,
  canTransitionState,
  isSubagentActive,
  isSubagentWaiting,
  validateSubagentName,
  createSubagentMessage,
  formatWakeupNotification,
  createDefaultSubagentTelemetry,
  SUBAGENT_ERROR_CODES,
  MAX_SUBAGENT_HIERARCHY_DEPTH,
  MAX_CONCURRENT_SUBAGENTS,
  DEFAULT_SUBAGENT_TIMEOUT_SECONDS,
  type SubagentState,
  type SubagentInfo,
  type SubagentMessage,
  type SubagentTelemetry,
} from "./subagents";


describe("Subagent Protocol & Schemas Suite", () => {
  const sampleUuid1 = "123e4567-e89b-12d3-a456-426614174000";
  const sampleUuid2 = "987fcdeb-51a2-43d7-9876-543210987654";
  const sampleTimestamp = "2026-08-15T08:00:00.000Z";

  /* ------------------------------------------------------------------------ */
  /* 1. Enums, Constants & State Machine                                      */
  /* ------------------------------------------------------------------------ */

  describe("Enums & State Machine", () => {
    it("validates all 7 canonical SubagentState values", () => {
      const states: SubagentState[] = [
        "running",
        "idle",
        "waiting_for_input",
        "waiting_for_dependents",
        "waiting_for_message",
        "canceling",
        "errored",
      ];
      for (const s of states) {
        expect(subagentStateSchema.parse(s)).toBe(s);
      }
      expect(() => subagentStateSchema.parse("sleeping")).toThrow();
      expect(() => subagentStateSchema.parse("stopped")).toThrow();
    });

    it("validates all 7 SubagentArchetypes", () => {
      const archetypes = [
        "explorer",
        "implementer",
        "qa",
        "specialist",
        "verifier",
        "planner",
        "custom",
      ];
      for (const a of archetypes) {
        expect(subagentArchetypeSchema.parse(a)).toBe(a);
      }
      expect(() => subagentArchetypeSchema.parse("unknown")).toThrow();
    });

    it("validates WorkspaceIsolationMode values", () => {
      expect(workspaceIsolationModeSchema.parse("inherit")).toBe("inherit");
      expect(workspaceIsolationModeSchema.parse("branch")).toBe("branch");
      expect(workspaceIsolationModeSchema.parse("share")).toBe("share");
      expect(() => workspaceIsolationModeSchema.parse("isolated")).toThrow();
    });

    it("validates SupervisorStrategy values", () => {
      expect(supervisorStrategySchema.parse("one_for_one")).toBe("one_for_one");
      expect(supervisorStrategySchema.parse("one_for_all")).toBe("one_for_all");
      expect(supervisorStrategySchema.parse("rest_for_one")).toBe("rest_for_one");
      expect(() => supervisorStrategySchema.parse("all_for_one")).toThrow();
    });

    it("validates message priorities", () => {
      expect(messagePrioritySchema.parse("high")).toBe("high");
      expect(messagePrioritySchema.parse("normal")).toBe("normal");
      expect(messagePrioritySchema.parse("low")).toBe("low");
      expect(() => messagePrioritySchema.parse("urgent")).toThrow();
    });

    it("exports standard constants & error codes", () => {
      expect(MAX_SUBAGENT_HIERARCHY_DEPTH).toBe(3);
      expect(MAX_CONCURRENT_SUBAGENTS).toBe(8);
      expect(DEFAULT_SUBAGENT_TIMEOUT_SECONDS).toBe(600);
      expect(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_MAX_DEPTH_EXCEEDED).toBe(
        "ERR_SUBAGENT_MAX_DEPTH_EXCEEDED"
      );
      expect(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT).toBe(
        "ERR_SUBAGENT_UNAUTHORIZED_RECIPIENT"
      );
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 2. SubagentConfig & SubagentInfo                                         */
  /* ------------------------------------------------------------------------ */

  describe("SubagentConfig & SubagentInfo", () => {
    it("parses valid SubagentConfig with defaults", () => {
      const raw = {
        name: "test-explorer",
        archetype: "explorer",
      };
      const config = subagentConfigSchema.parse(raw);
      expect(config.name).toBe("test-explorer");
      expect(config.archetype).toBe("explorer");
      expect(config.workspaceIsolation).toBe("inherit");
      expect(config.timeoutSeconds).toBe(600);
      expect(config.roles).toEqual([]);
      expect(config.skills).toEqual([]);
    });

    it("parses complete SubagentConfig with all optional fields", () => {
      const raw = {
        name: "imp_worker_1",
        archetype: "implementer",
        roles: ["coder", "refactorer"],
        systemPrompt: "You are an expert implementer.",
        model: "openai/gpt-4o",
        workspaceIsolation: "branch",
        allowedTools: ["run_command", "view_file"],
        allowedToolKinds: ["filesystem", "terminal"],
        timeoutSeconds: 1200,
        budgetTokens: 50000,
        skills: ["fastify", "typescript"],
        environmentVariables: { NODE_ENV: "test" },
      };
      const config = subagentConfigSchema.parse(raw);
      expect(config.name).toBe("imp_worker_1");
      expect(config.budgetTokens).toBe(50000);
      expect(config.workspaceIsolation).toBe("branch");
    });

    it("rejects SubagentConfig with invalid timeout or empty name", () => {
      expect(() =>
        subagentConfigSchema.parse({
          name: "",
          archetype: "explorer",
        })
      ).toThrow();

      expect(() =>
        subagentConfigSchema.parse({
          name: "valid-name",
          archetype: "explorer",
          timeoutSeconds: -10,
        })
      ).toThrow();

      expect(() =>
        subagentConfigSchema.parse({
          name: "valid-name",
          archetype: "explorer",
          timeoutSeconds: 10000, // exceeds max 7200
        })
      ).toThrow();
    });

    it("parses valid SubagentInfo and alias SubagentSummary", () => {
      const raw: SubagentInfo = {
        id: sampleUuid1,
        parentId: sampleUuid2,
        name: "qa_agent",
        archetype: "qa",
        roles: ["tester"],
        state: "running",
        workingDirectory: "/repo/.agents/qa_1",
        worktreePath: "/repo/.agents/worktrees/qa_1",
        isolationMode: "branch",
        startedAt: sampleTimestamp,
        lastHeartbeat: sampleTimestamp,
        tokensUsed: 1500,
        turnCount: 3,
        lastProgressSummary: "Running vitest suites",
      };

      const info = subagentInfoSchema.parse(raw);
      expect(info.id).toBe(sampleUuid1);
      expect(info.parentId).toBe(sampleUuid2);
      expect(info.state).toBe("running");

      const summary = subagentSummarySchema.parse(raw);
      expect(summary.tokensUsed).toBe(1500);
    });

    it("parses valid SubagentTelemetry with defaults and custom metrics", () => {
      const defaultTelem = subagentTelemetrySchema.parse({});
      expect(defaultTelem.promptTokens).toBe(0);
      expect(defaultTelem.completionTokens).toBe(0);
      expect(defaultTelem.totalTokens).toBe(0);
      expect(defaultTelem.estimatedCostUsd).toBe(0);
      expect(defaultTelem.tokensPerSecond).toBe(0);
      expect(defaultTelem.turnCount).toBe(0);
      expect(defaultTelem.avgTurnLatencyMs).toBe(0);
      expect(defaultTelem.lastTurnLatencyMs).toBe(0);
      expect(defaultTelem.p95TurnLatencyMs).toBe(0);
      expect(defaultTelem.totalDurationMs).toBe(0);
      expect(defaultTelem.toolDurationMs).toBe(0);

      const customTelem: SubagentTelemetry = {
        promptTokens: 12000,
        completionTokens: 3500,
        totalTokens: 15500,
        estimatedCostUsd: 0.045,
        tokensPerSecond: 42.5,
        turnCount: 6,
        avgTurnLatencyMs: 1250,
        lastTurnLatencyMs: 980,
        p95TurnLatencyMs: 1800,
        totalDurationMs: 65000,
        toolDurationMs: 14200,
      };
      const parsed = subagentTelemetrySchema.parse(customTelem);
      expect(parsed.totalTokens).toBe(15500);
      expect(parsed.estimatedCostUsd).toBe(0.045);
      expect(parsed.p95TurnLatencyMs).toBe(1800);
    });

    it("parses valid SubagentInfo with telemetry", () => {
      const raw = {
        id: sampleUuid1,
        parentId: sampleUuid2,
        name: "qa_agent",
        archetype: "qa" as const,
        roles: ["tester"],
        state: "running" as const,
        workingDirectory: "/repo/.agents/qa_1",
        worktreePath: "/repo/.agents/worktrees/qa_1",
        isolationMode: "branch" as const,
        startedAt: sampleTimestamp,
        lastHeartbeat: sampleTimestamp,
        tokensUsed: 1500,
        turnCount: 3,
        telemetry: {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
          estimatedCostUsd: 0.005,
          tokensPerSecond: 30,
          turnCount: 3,
          avgTurnLatencyMs: 800,
          lastTurnLatencyMs: 750,
          p95TurnLatencyMs: 900,
          totalDurationMs: 5000,
          toolDurationMs: 1200,
        },
        lastProgressSummary: "Running vitest suites",
      };

      const info = subagentInfoSchema.parse(raw);
      expect(info.id).toBe(sampleUuid1);
      expect(info.telemetry?.totalTokens).toBe(1500);
      expect(info.telemetry?.estimatedCostUsd).toBe(0.005);
    });

    it("handles SubagentInfo with null parentId and terminal state", () => {
      const raw = {
        id: sampleUuid1,
        parentId: null,
        name: "root_agent",
        archetype: "planner",
        roles: ["lead"],
        state: "errored",
        workingDirectory: "/repo",
        isolationMode: "inherit",
        startedAt: sampleTimestamp,
        completedAt: sampleTimestamp,
        lastHeartbeat: sampleTimestamp,
        tokensUsed: 12000,
        turnCount: 8,
        exitCode: 1,
        error: "Budget tokens exceeded",
      };

      const info = subagentInfoSchema.parse(raw);
      expect(info.parentId).toBeNull();
      expect(info.error).toBe("Budget tokens exceeded");
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Mailbox Messages & Lifecycle Events                                   */
  /* ------------------------------------------------------------------------ */

  describe("Mailbox Messages & Lifecycle Events", () => {
    it("parses SubagentMessage and defaults priority to normal", () => {
      const raw = {
        messageId: sampleUuid1,
        senderId: sampleUuid2,
        recipientId: sampleUuid1,
        timestamp: sampleTimestamp,
        subject: "Task Handoff",
        body: "Completed implementation of Fastify router.",
      };

      const msg = subagentMessageSchema.parse(raw);
      expect(msg.priority).toBe("normal");
      expect(msg.referencedArtifacts).toEqual([]);
      expect(agentMessageFrameSchema.parse(raw).subject).toBe("Task Handoff");
    });

    it("validates all 8 subagentLifecycleEvent variants", () => {
      const info: SubagentInfo = {
        id: sampleUuid1,
        parentId: null,
        name: "worker",
        archetype: "custom",
        roles: [],
        state: "idle",
        workingDirectory: "/repo",
        isolationMode: "inherit",
        startedAt: sampleTimestamp,
        lastHeartbeat: sampleTimestamp,
        tokensUsed: 0,
        turnCount: 0,
      };

      const msg: SubagentMessage = {
        messageId: sampleUuid1,
        senderId: sampleUuid2,
        recipientId: sampleUuid1,
        timestamp: sampleTimestamp,
        subject: "Hello",
        body: "World",
        referencedArtifacts: [],
        priority: "high",
      };

      // 1. subagent.spawned
      expect(
        subagentLifecycleEventSchema.parse({
          type: "subagent.spawned",
          subagent: info,
          at: sampleTimestamp,
        }).type
      ).toBe("subagent.spawned");

      // 2. subagent.state_changed
      expect(
        subagentLifecycleEventSchema.parse({
          type: "subagent.state_changed",
          subagentId: sampleUuid1,
          previousState: "running",
          newState: "idle",
          reason: "Turn completed",
          at: sampleTimestamp,
        }).type
      ).toBe("subagent.state_changed");

      // 3. subagent.message_sent
      expect(
        subagentLifecycleEventSchema.parse({
          type: "subagent.message_sent",
          message: msg,
          at: sampleTimestamp,
        }).type
      ).toBe("subagent.message_sent");

      // 4. subagent.heartbeat
      expect(
        subagentLifecycleEventSchema.parse({
          type: "subagent.heartbeat",
          subagentId: sampleUuid1,
          lastVisited: sampleTimestamp,
          progressSummary: "Compiling protocol",
          at: sampleTimestamp,
        }).type
      ).toBe("subagent.heartbeat");

      // 5. subagent.completed
      expect(
        subagentLifecycleEventSchema.parse({
          type: "subagent.completed",
          subagentId: sampleUuid1,
          tokensUsed: 3500,
          turnCount: 4,
          handoffArtifact: "/repo/.agents/worker/handoff.md",
          at: sampleTimestamp,
        }).type
      ).toBe("subagent.completed");

      // 6. subagent.errored
      expect(
        subagentLifecycleEventSchema.parse({
          type: "subagent.errored",
          subagentId: sampleUuid1,
          error: "Process crashed",
          code: "SIGKILL",
          at: sampleTimestamp,
        }).type
      ).toBe("subagent.errored");

      // 7. subagent.tree_updated
      expect(
        subagentLifecycleEventSchema.parse({
          type: "subagent.tree_updated",
          rootId: sampleUuid1,
          activeCount: 1,
          tree: [info],
          at: sampleTimestamp,
        }).type
      ).toBe("subagent.tree_updated");

      // 8. subagent.telemetry_updated
      expect(
        subagentLifecycleEventSchema.parse({
          type: "subagent.telemetry_updated",
          subagentId: sampleUuid1,
          telemetry: {
            promptTokens: 2000,
            completionTokens: 800,
            totalTokens: 2800,
            estimatedCostUsd: 0.009,
            tokensPerSecond: 45,
            turnCount: 5,
            avgTurnLatencyMs: 650,
            lastTurnLatencyMs: 600,
            p95TurnLatencyMs: 800,
            totalDurationMs: 12000,
            toolDurationMs: 3000,
          },
          at: sampleTimestamp,
        }).type
      ).toBe("subagent.telemetry_updated");
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Tool Schemas (invoke, manage, send, define)                           */
  /* ------------------------------------------------------------------------ */

  describe("Tool Schemas", () => {
    it("validates invokeSubagentParamsSchema & invokeSubagentResultSchema", () => {
      const params = invokeSubagentParamsSchema.parse({
        archetype: "implementer",
        name: "worker_1",
        prompt: "Implement fastify handler",
        workspaceIsolation: "branch",
        timeoutSeconds: 300,
      });
      expect(params.archetype).toBe("implementer");
      expect(params.roles).toEqual([]);
      expect(params.skills).toEqual([]);

      const result = invokeSubagentResultSchema.parse({
        subagentId: sampleUuid1,
        name: "worker_1",
        archetype: "implementer",
        workingDirectory: "/repo/.agents/worker_1",
        state: "running",
        startedAt: sampleTimestamp,
      });
      expect(result.subagentId).toBe(sampleUuid1);
    });

    it("validates manageSubagentsParamsSchema for all actions and recursive options", () => {
      const actions = ["list", "status", "kill", "pause", "resume", "inspect"] as const;
      for (const action of actions) {
        expect(manageSubagentsActionSchema.parse(action)).toBe(action);
      }

      // list action with omitted recursive
      const listParams = manageSubagentsParamsSchema.parse({ action: "list" });
      expect(listParams.recursive).toBeUndefined();

      // list action with explicit recursive: true
      const recursiveParams = manageSubagentsParamsSchema.parse({
        action: "list",
        recursive: true,
      });
      expect(recursiveParams.recursive).toBe(true);

      // list action with explicit recursive: false
      const nonRecursiveParams = manageSubagentsParamsSchema.parse({
        action: "list",
        recursive: false,
      });
      expect(nonRecursiveParams.recursive).toBe(false);


      // inspect action
      const inspectParams = manageSubagentsParamsSchema.parse({
        action: "inspect",
        subagentId: sampleUuid1,
        inspectFile: "BRIEFING.md",
      });
      expect(inspectParams.inspectFile).toBe("BRIEFING.md");

      // manage result
      const result = manageSubagentsResultSchema.parse({
        action: "inspect",
        success: true,
        inspectedContent: "# Briefing content",
      });
      expect(result.success).toBe(true);
      expect(result.inspectedContent).toBe("# Briefing content");
    });

    it("validates sendMessageParamsSchema & sendMessageResultSchema", () => {
      const params = sendMessageParamsSchema.parse({
        recipientId: sampleUuid2,
        subject: "Unit Test Passed",
        body: "All 151 unit tests passed.",
        priority: "high",
        referencedArtifacts: ["/repo/report.md"],
      });
      expect(params.priority).toBe("high");

      const result = sendMessageResultSchema.parse({
        messageId: sampleUuid1,
        deliveryTimestamp: sampleTimestamp,
        recipientStatus: "idle",
        delivered: true,
      });
      expect(result.delivered).toBe(true);
      expect(result.recipientStatus).toBe("idle");
    });

    it("validates defineSubagentParamsSchema & defineSubagentResultSchema", () => {
      const params = defineSubagentParamsSchema.parse({
        name: "security_auditor",
        description: "Static security analyzer",
        systemPromptTemplate: "Audit codebase for security vulnerabilities.",
      });
      expect(params.archetype).toBe("custom");
      expect(params.defaultIsolation).toBe("inherit");
      expect(params.defaultTimeoutSeconds).toBe(600);

      const result = defineSubagentResultSchema.parse({
        definitionId: sampleUuid1,
        name: "security_auditor",
        archetype: "custom",
        registered: true,
      });
      expect(result.registered).toBe(true);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Pure Helper Utilities                                                 */
  /* ------------------------------------------------------------------------ */

  describe("Pure Helper Utilities", () => {
    it("validates state transitions with isValidStateTransition / canTransitionState", () => {
      // Valid transitions from running
      expect(isValidStateTransition("running", "idle")).toBe(true);
      expect(isValidStateTransition("running", "waiting_for_input")).toBe(true);
      expect(isValidStateTransition("running", "canceling")).toBe(true);
      expect(isValidStateTransition("running", "errored")).toBe(true);

      // Valid transitions from idle
      expect(isValidStateTransition("idle", "running")).toBe(true);
      expect(isValidStateTransition("idle", "waiting_for_message")).toBe(true);

      // Idempotent self-transition
      expect(isValidStateTransition("running", "running")).toBe(true);
      expect(isValidStateTransition("idle", "idle")).toBe(true);

      // Invalid transitions from errored (terminal)
      expect(isValidStateTransition("errored", "running")).toBe(false);
      expect(isValidStateTransition("errored", "idle")).toBe(false);

      // Alias check
      expect(canTransitionState("waiting_for_input", "running")).toBe(true);
    });

    it("checks isSubagentActive and isSubagentWaiting", () => {
      expect(isSubagentActive("running")).toBe(true);
      expect(isSubagentActive("idle")).toBe(true);
      expect(isSubagentActive("waiting_for_input")).toBe(true);
      expect(isSubagentActive("canceling")).toBe(true);
      expect(isSubagentActive("errored")).toBe(false);

      expect(isSubagentWaiting("idle")).toBe(true);
      expect(isSubagentWaiting("waiting_for_input")).toBe(true);
      expect(isSubagentWaiting("waiting_for_dependents")).toBe(true);
      expect(isSubagentWaiting("waiting_for_message")).toBe(true);
      expect(isSubagentWaiting("running")).toBe(false);
      expect(isSubagentWaiting("errored")).toBe(false);
    });

    it("validates subagent names with validateSubagentName", () => {
      expect(validateSubagentName("explorer_1")).toBe(true);
      expect(validateSubagentName("qa-worker-2")).toBe(true);
      expect(validateSubagentName("agent123")).toBe(true);

      expect(validateSubagentName("")).toBe(false);
      expect(validateSubagentName("agent with space")).toBe(false);
      expect(validateSubagentName("agent/slash")).toBe(false);
      expect(validateSubagentName("a".repeat(65))).toBe(false);
    });

    it("creates message with createSubagentMessage", () => {
      const msg = createSubagentMessage({
        senderId: sampleUuid1,
        senderName: "sender",
        recipientId: sampleUuid2,
        subject: "Hello",
        body: "How are you?",
      });

      expect(msg.senderId).toBe(sampleUuid1);
      expect(msg.senderName).toBe("sender");
      expect(msg.recipientId).toBe(sampleUuid2);
      expect(msg.priority).toBe("normal");
      expect(msg.referencedArtifacts).toEqual([]);
      expect(typeof msg.messageId).toBe("string");
      expect(typeof msg.timestamp).toBe("string");
    });

    it("formats wakeup notification with formatWakeupNotification", () => {
      const formatted = formatWakeupNotification({
        trigger: "MESSAGE_RECEIVED",
        sourceId: sampleUuid1,
        sourceName: "Implementer_1",
        summary: "Step completed with 100% tests",
        attachedArtifact: "/repo/.agents/imp_1/handoff.md",
        details: { turn: 4, exitCode: 0 },
      });

      expect(formatted).toContain("<system_notification>");
      expect(formatted).toContain("## Reactive Wakeup Trigger: MESSAGE_RECEIVED");
      expect(formatted).toContain(sampleUuid1);
      expect(formatted).toContain("Implementer_1");
      expect(formatted).toContain("Step completed with 100% tests");
      expect(formatted).toContain("/repo/.agents/imp_1/handoff.md");
      expect(formatted).toContain("</system_notification>");
    });

    it("creates default zeroed telemetry with createDefaultSubagentTelemetry", () => {
      const telem = createDefaultSubagentTelemetry();
      expect(telem.promptTokens).toBe(0);
      expect(telem.completionTokens).toBe(0);
      expect(telem.totalTokens).toBe(0);
      expect(telem.estimatedCostUsd).toBe(0);
      expect(telem.tokensPerSecond).toBe(0);
      expect(telem.turnCount).toBe(0);
      expect(telem.avgTurnLatencyMs).toBe(0);
      expect(telem.lastTurnLatencyMs).toBe(0);
      expect(telem.p95TurnLatencyMs).toBe(0);
      expect(telem.totalDurationMs).toBe(0);
      expect(telem.toolDurationMs).toBe(0);
    });
  });
});

