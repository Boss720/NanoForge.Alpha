import { describe, expect, it } from "vitest";
import {
  subagentStateSchema,
  subagentArchetypeSchema,
  subagentConfigSchema,
  subagentInfoSchema,
  subagentMessageSchema,
  subagentLifecycleEventSchema,
  invokeSubagentParamsSchema,
  manageSubagentsParamsSchema,
  sendMessageParamsSchema,
  defineSubagentParamsSchema,
  isValidStateTransition,
  validateSubagentName,
  formatWakeupNotification,
  type SubagentState,
} from "./subagents";
import {
  scheduleParamsSchema,
  manageTaskParamsSchema,
  taskSummarySchema,
  parseCronExpression,
  isValidCronExpression,
  matchesCron,
  getNextCronOccurrence,
  matchesScheduleCondition,
} from "./tasks";

describe("Subagents & Tasks Adversarial Stress Test Suite", () => {
  const validUuid = "123e4567-e89b-12d3-a456-426614174000";
  const validTimestamp = "2026-08-15T08:00:00.000Z";

  /* ======================================================================== */
  /* 1. Malformed UUIDs, Boundary Injections & Hostile Payloads               */
  /* ======================================================================== */

  describe("Malformed UUIDs & Boundary Injections", () => {
    const invalidUuids = [
      "",
      "123",
      "not-a-uuid",
      "123e4567-e89b-12d3-a456-42661417400Z", // bad char
      "123e4567-e89b-12d3-a456-426614174000-extra",
      "../../etc/passwd",
      "<script>alert(1)</script>",
      "SELECT * FROM agents;",
      "null",
      "undefined",
    ];

    it("rejects invalid UUIDs across subagent schemas", () => {
      for (const badUuid of invalidUuids) {
        expect(() =>
          subagentInfoSchema.parse({
            id: badUuid,
            parentId: null,
            name: "test",
            archetype: "custom",
            roles: [],
            state: "idle",
            workingDirectory: "/repo",
            isolationMode: "inherit",
            startedAt: validTimestamp,
            lastHeartbeat: validTimestamp,
          })
        ).toThrow();

        expect(() =>
          sendMessageParamsSchema.parse({
            recipientId: badUuid,
            subject: "test",
            body: "test body",
          })
        ).toThrow();

        expect(() =>
          manageTaskParamsSchema.parse({
            action: "kill",
            taskId: badUuid,
          })
        ).toThrow();
      }
    });

    it("enforces string length boundaries strictly", () => {
      // Subagent name: max 64
      expect(() =>
        subagentConfigSchema.parse({
          name: "a".repeat(65),
          archetype: "explorer",
        })
      ).toThrow();

      // SystemPrompt: max 65536
      expect(() =>
        subagentConfigSchema.parse({
          name: "valid",
          archetype: "explorer",
          systemPrompt: "a".repeat(65537),
        })
      ).toThrow();

      // Message subject: min 1, max 256
      expect(() =>
        sendMessageParamsSchema.parse({
          recipientId: validUuid,
          subject: "",
          body: "Hello",
        })
      ).toThrow();

      expect(() =>
        sendMessageParamsSchema.parse({
          recipientId: validUuid,
          subject: "a".repeat(257),
          body: "Hello",
        })
      ).toThrow();

      // Message body: min 1, max 65536
      expect(() =>
        sendMessageParamsSchema.parse({
          recipientId: validUuid,
          subject: "Valid subject",
          body: "",
        })
      ).toThrow();

      expect(() =>
        sendMessageParamsSchema.parse({
          recipientId: validUuid,
          subject: "Valid subject",
          body: "x".repeat(65537),
        })
      ).toThrow();

      // Exactly 65536 chars should succeed
      expect(() =>
        sendMessageParamsSchema.parse({
          recipientId: validUuid,
          subject: "Valid subject",
          body: "x".repeat(65536),
        })
      ).not.toThrow();
    });

    it("rejects empty strings in role and skill arrays", () => {
      expect(() =>
        subagentConfigSchema.parse({
          name: "agent",
          archetype: "implementer",
          roles: [""],
        })
      ).toThrow();

      expect(() =>
        subagentConfigSchema.parse({
          name: "agent",
          archetype: "implementer",
          skills: [""],
        })
      ).toThrow();
    });
  });

  /* ======================================================================== */
  /* 2. Subagent State Machine Hostile Transitions                            */
  /* ======================================================================== */

  describe("Subagent State Machine Boundary Violations", () => {
    const allStates: SubagentState[] = [
      "running",
      "idle",
      "waiting_for_input",
      "waiting_for_dependents",
      "waiting_for_message",
      "canceling",
      "errored",
    ];

    it("verifies errored is strictly a terminal state with no exits", () => {
      for (const target of allStates) {
        if (target === "errored") {
          expect(isValidStateTransition("errored", "errored")).toBe(true);
        } else {
          expect(isValidStateTransition("errored", target)).toBe(false);
        }
      }
    });

    it("rejects invalid transitions out of canceling", () => {
      expect(isValidStateTransition("canceling", "running")).toBe(false);
      expect(isValidStateTransition("canceling", "waiting_for_input")).toBe(false);
      expect(isValidStateTransition("canceling", "waiting_for_dependents")).toBe(false);
      expect(isValidStateTransition("canceling", "waiting_for_message")).toBe(false);

      // Allowed exits from canceling: errored or idle (cleanup finished)
      expect(isValidStateTransition("canceling", "errored")).toBe(true);
      expect(isValidStateTransition("canceling", "idle")).toBe(true);
    });

    it("rejects arbitrary or unknown state strings", () => {
      // @ts-expect-error test runtime rejection of untyped strings
      expect(isValidStateTransition("running", "zombie")).toBe(false);
      // @ts-expect-error test runtime rejection of untyped strings
      expect(isValidStateTransition("nonexistent", "running")).toBe(false);
    });
  });

  /* ======================================================================== */
  /* 3. Subagent Name Security & Path Traversal Injection Prevention          */
  /* ======================================================================== */

  describe("Subagent Name Confinement & Injection Tests", () => {
    const maliciousNames = [
      "../../etc/passwd",
      "..\\..\\windows\\system32",
      "agent/subagent",
      "agent\\subagent",
      "agent\0nullbyte",
      "agent; rm -rf /",
      "agent $(whoami)",
      "agent`id`",
      "agent | cat",
      "agent&calc.exe",
      "agent with spaces",
      "agent\nnewline",
      "agent\ttab",
      "🚀emoji-agent",
      "",
      "a".repeat(65),
    ];

    it("rejects all malicious and breakout name attempts with validateSubagentName", () => {
      for (const name of maliciousNames) {
        expect(validateSubagentName(name)).toBe(false);
      }
    });

    it("accepts strictly safe alphanumeric names with hyphens and underscores", () => {
      const safeNames = [
        "explorer_1",
        "qa-worker-2",
        "planner_root",
        "spec123",
        "A",
        "Z-9_0",
        "a".repeat(64),
      ];
      for (const name of safeNames) {
        expect(validateSubagentName(name)).toBe(true);
      }
    });
  });

  /* ======================================================================== */
  /* 4. Schedule & Cron Adversarial Syntax & Edge Cases                       */
  /* ======================================================================== */

  describe("Schedule & Cron Adversarial Syntax", () => {
    it("handles extreme whitespace in cron expressions", () => {
      const expr = "  */5    *    *   *   *  ";
      expect(isValidCronExpression(expr)).toBe(true);
      const parsed = parseCronExpression(expr);
      expect(parsed.minutes.has(0)).toBe(true);
    });

    it("rejects malicious, negative, floating-point, and overflow cron values", () => {
      const hostileCrons = [
        "-1 * * * *",
        "1.5 * * * *",
        "NaN * * * *",
        "Infinity * * * *",
        "*/-5 * * * *",
        "1-5/-2 * * * *",
        "* * * * * * *", // 7 fields
        "* * *",         // 3 fields
        "1,,2 * * * *",  // empty list element
        "1- * * * *",    // unclosed range
        "-5 * * * *",    // invalid range
        "1/ * * * *",    // empty step
        "1/2/3 * * * *", // multiple steps
        "JAN-DEC-NOV * * * *",
        "FOO * * * *",
        "1-60 * * * *",  // 60 out of bounds for minute
        "0 24 * * *",    // 24 out of bounds for hour
        "0 0 32 * *",    // 32 out of bounds for dayOfMonth
        "0 0 0 * *",     // 0 out of bounds for dayOfMonth
        "0 0 1 0 *",     // 0 out of bounds for month
        "0 0 1 13 *",    // 13 out of bounds for month
        "0 0 1 1 8",     // 8 out of bounds for dayOfWeek
      ];

      for (const cron of hostileCrons) {
        expect(isValidCronExpression(cron)).toBe(false);
        expect(() => parseCronExpression(cron)).toThrow();
      }
    });

    it("evaluates matchesScheduleCondition under adversarial parameters", () => {
      // "never" condition never matches any sender
      expect(matchesScheduleCondition("never", validUuid)).toBe(false);
      expect(matchesScheduleCondition("never", undefined)).toBe(false);
      expect(matchesScheduleCondition("never", "")).toBe(false);

      // "any" condition matches even undefined
      expect(matchesScheduleCondition("any", validUuid)).toBe(true);
      expect(matchesScheduleCondition("any", undefined)).toBe(true);

      // Specific UUID matches only exact match
      expect(matchesScheduleCondition(validUuid, validUuid)).toBe(true);
      expect(matchesScheduleCondition(validUuid, "different-uuid")).toBe(false);
      expect(matchesScheduleCondition(validUuid, undefined)).toBe(false);
    });

    it("handles leap years and month-end dates in getNextCronOccurrence", () => {
      // Test Feb 29 on leap year (2028 is leap year, 2026/2027 are not)
      // Starting from 2026-08-15
      const start = new Date(Date.UTC(2026, 7, 15, 0, 0, 0));
      const leapCron = "0 0 29 2 *"; // Feb 29 at 00:00

      const nextLeapRun = getNextCronOccurrence(leapCron, start, { isUtc: true, maxYears: 5 });
      expect(nextLeapRun).not.toBeNull();
      expect(nextLeapRun?.getUTCFullYear()).toBe(2028);
      expect(nextLeapRun?.getUTCMonth()).toBe(1); // February (0-indexed)
      expect(nextLeapRun?.getUTCDate()).toBe(29);
    });

    it("returns null if cron occurrence exceeds maxYears", () => {
      const start = new Date(Date.UTC(2026, 7, 15, 0, 0, 0));
      // Feb 29 with maxYears = 1 will not find 2028
      const nextRun = getNextCronOccurrence("0 0 29 2 *", start, { isUtc: true, maxYears: 1 });
      expect(nextRun).toBeNull();
    });
  });

  /* ======================================================================== */
  /* 5. Tool Parameter Adversarial Submissions                                 */
  /* ======================================================================== */

  describe("Tool Parameter Adversarial Submissions", () => {
    it("rejects negative token budgets and turn counts", () => {
      expect(() =>
        subagentConfigSchema.parse({
          name: "agent",
          archetype: "custom",
          budgetTokens: -500,
        })
      ).toThrow();

      expect(() =>
        subagentInfoSchema.parse({
          id: validUuid,
          parentId: null,
          name: "agent",
          archetype: "custom",
          roles: [],
          state: "running",
          workingDirectory: "/repo",
          isolationMode: "inherit",
          startedAt: validTimestamp,
          lastHeartbeat: validTimestamp,
          tokensUsed: -1,
        })
      ).toThrow();

      expect(() =>
        subagentInfoSchema.parse({
          id: validUuid,
          parentId: null,
          name: "agent",
          archetype: "custom",
          roles: [],
          state: "running",
          workingDirectory: "/repo",
          isolationMode: "inherit",
          startedAt: validTimestamp,
          lastHeartbeat: validTimestamp,
          turnCount: -1,
        })
      ).toThrow();
    });

    it("rejects invalid inspection files in manageSubagentsParamsSchema", () => {
      expect(() =>
        manageSubagentsParamsSchema.parse({
          action: "inspect",
          subagentId: validUuid,
          inspectFile: "passwords.txt",
        })
      ).toThrow();

      expect(() =>
        manageSubagentsParamsSchema.parse({
          action: "inspect",
          subagentId: validUuid,
          inspectFile: "../../../etc/shadow",
        })
      ).toThrow();
    });

    it("formats wakeup notification safely with arbitrary content", () => {
      const hostileNotification = formatWakeupNotification({
        trigger: "CHILD_COMPLETED",
        sourceId: validUuid,
        sourceName: "<script>alert('xss')</script>",
        summary: "Execution finished with status 0\n--\nDrop table agents;",
        attachedArtifact: "c:/repo/.agents/imp_1/handoff.md",
        details: { "key\nwith\nnewlines": "value\nwith\nnewlines" },
      });

      expect(hostileNotification.startsWith("<system_notification>")).toBe(true);
      expect(hostileNotification.endsWith("</system_notification>")).toBe(true);
      expect(hostileNotification).toContain("CHILD_COMPLETED");
      expect(hostileNotification).toContain(validUuid);
    });
  });
});
