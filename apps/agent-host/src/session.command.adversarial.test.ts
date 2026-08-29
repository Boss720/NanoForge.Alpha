import { describe, expect, it, vi } from "vitest";
import { parseSlashCommand, type CommandExecuteFrame } from "@protocol/commands";
import { dispatchCommand } from "./session";

function frame(rawText: string): CommandExecuteFrame {
  const parsed = parseSlashCommand(rawText);
  if (!parsed) throw new Error(`Expected valid slash command for input: ${rawText}`);
  return {
    type: "command.execute",
    command: parsed.command,
    args: parsed.positional,
    rawText,
    parsed,
    requestId: "req-adversarial-test",
  };
}

describe("Swarm Slash Command Adversarial & Schema Enforcement Suite", () => {
  const validUuid = "123e4567-e89b-12d3-a456-426614174000";

  /* ------------------------------------------------------------------------ */
  /* 1. /swarm inspect file allowlist & path traversal rejection             */
  /* ------------------------------------------------------------------------ */

  describe("/swarm inspect Path Traversal & Allowlist Defense", () => {
    it("rejects path traversal attempts with --file=../../../secret without invoking supervisor", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const result = await dispatchCommand(
        frame(`/swarm inspect ${validUuid} --file=../../../secret`),
        supervisor,
      );

      expect(result.success).toBe(false);
      expect(result.data).toMatchObject({ code: "invalid_command" });
      expect(result.error).toContain("Invalid /swarm inspect arguments");
      expect(supervisor.manageSubagents).not.toHaveBeenCalled();
    });

    it("rejects absolute paths (/etc/passwd, C:\\Windows\\win.ini) without invoking supervisor", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const posixResult = await dispatchCommand(
        frame(`/swarm inspect ${validUuid} --file=/etc/passwd`),
        supervisor,
      );
      expect(posixResult.success).toBe(false);
      expect(posixResult.data).toMatchObject({ code: "invalid_command" });
      expect(supervisor.manageSubagents).not.toHaveBeenCalled();

      const winResult = await dispatchCommand(
        frame(`/swarm inspect ${validUuid} --file="C:\\Windows\\win.ini"`),
        supervisor,
      );
      expect(winResult.success).toBe(false);
      expect(winResult.data).toMatchObject({ code: "invalid_command" });
      expect(supervisor.manageSubagents).not.toHaveBeenCalled();
    });

    it("rejects single and double URL-encoded traversal payloads", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const encoded1 = await dispatchCommand(
        frame(`/swarm inspect ${validUuid} --file=%2e%2e%2f%2e%2e%2fsecret`),
        supervisor,
      );
      expect(encoded1.success).toBe(false);
      expect(encoded1.data).toMatchObject({ code: "invalid_command" });

      const encoded2 = await dispatchCommand(
        frame(`/swarm inspect ${validUuid} --file=%252e%252e%252fsecret`),
        supervisor,
      );
      expect(encoded2.success).toBe(false);
      expect(encoded2.data).toMatchObject({ code: "invalid_command" });
      expect(supervisor.manageSubagents).not.toHaveBeenCalled();
    });

    it("rejects disallowed filenames not in manageSubagentsInspectFileSchema", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const disallowedFiles = ["passwords.txt", "id_rsa", "config.json", "env.local", "temp.log"];
      for (const badFile of disallowedFiles) {
        const res = await dispatchCommand(
          frame(`/swarm inspect ${validUuid} --file=${badFile}`),
          supervisor,
        );
        expect(res.success).toBe(false);
        expect(res.data).toMatchObject({ code: "invalid_command" });
        expect(supervisor.manageSubagents).not.toHaveBeenCalled();
      }
    });

    it("accepts all 5 valid inspect filenames (progress.md, BRIEFING.md, handoff.md, DISPATCH.md, analysis.md)", async () => {
      const allowedFiles = [
        "progress.md",
        "BRIEFING.md",
        "handoff.md",
        "DISPATCH.md",
        "analysis.md",
      ] as const;

      for (const goodFile of allowedFiles) {
        const supervisor = {
          spawnSubagent: vi.fn(),
          manageSubagents: vi.fn().mockResolvedValue({
            action: "inspect",
            success: true,
            inspectedContent: `# Content of ${goodFile}`,
          }),
          sendMessage: vi.fn(),
        };

        const res = await dispatchCommand(
          frame(`/swarm inspect ${validUuid} --file=${goodFile}`),
          supervisor,
        );

        expect(res.success).toBe(true);
        expect(res.output).toBe(`# Content of ${goodFile}`);
        expect(supervisor.manageSubagents).toHaveBeenCalledWith({
          action: "inspect",
          subagentId: validUuid,
          inspectFile: goodFile,
        });
      }
    });

    it("returns invalid_command if subagentId is missing for inspect", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const result = await dispatchCommand(frame("/swarm inspect"), supervisor);
      expect(result.success).toBe(false);
      expect(result.data).toMatchObject({ code: "invalid_command" });
      expect(supervisor.manageSubagents).not.toHaveBeenCalled();
    });

    it("rejects non-UUID subagentId for inspect", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const result = await dispatchCommand(frame("/swarm inspect not-a-uuid"), supervisor);
      expect(result.success).toBe(false);
      expect(result.data).toMatchObject({ code: "invalid_command" });
      expect(supervisor.manageSubagents).not.toHaveBeenCalled();
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 2. /swarm run Parameter Validation & Malicious Name Defense              */
  /* ------------------------------------------------------------------------ */

  describe("/swarm run Validation & Name Confinement", () => {
    it("rejects malicious subagent names with path traversal sequences", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const hostileNames = [
        "../../outside",
        "..\\..\\windows\\sys",
        "/etc/agent",
        "C:\\agent",
        "agent;rm -rf /",
        "agent\0null",
        "agent name with spaces",
        "a".repeat(65),
      ];

      for (const badName of hostileNames) {
        const result = await dispatchCommand(
          frame(`/swarm run "Audit" --name="${badName}"`),
          supervisor,
        );
        expect(result.success).toBe(false);
        expect(result.data).toMatchObject({ code: "invalid_command" });
        expect(supervisor.spawnSubagent).not.toHaveBeenCalled();
      }
    });

    it("rejects negative or out-of-range budget and timeout values", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const negativeBudget = await dispatchCommand(
        frame('/swarm run "Test" --budget=-100'),
        supervisor,
      );
      expect(negativeBudget.success).toBe(false);
      expect(negativeBudget.data).toMatchObject({ code: "invalid_command" });

      const overflowTimeout = await dispatchCommand(
        frame('/swarm run "Test" --timeout=999999'),
        supervisor,
      );
      expect(overflowTimeout.success).toBe(false);
      expect(overflowTimeout.data).toMatchObject({ code: "invalid_command" });
      expect(supervisor.spawnSubagent).not.toHaveBeenCalled();
    });

    it("rejects /swarm run when prompt is missing or empty", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const emptyPrompt = await dispatchCommand(frame("/swarm run"), supervisor);
      expect(emptyPrompt.success).toBe(false);
      expect(emptyPrompt.data).toMatchObject({ code: "invalid_command" });

      const whitespacePrompt = await dispatchCommand(frame('/swarm run "   "'), supervisor);
      expect(whitespacePrompt.success).toBe(false);
      expect(whitespacePrompt.data).toMatchObject({ code: "invalid_command" });
      expect(supervisor.spawnSubagent).not.toHaveBeenCalled();
    });

    it("successfully spawns a subagent with validated typed parameters", async () => {
      const supervisor = {
        spawnSubagent: vi.fn().mockResolvedValue({
          subagentId: validUuid,
          name: "security_auditor",
        }),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const result = await dispatchCommand(
        frame('/swarm run "Verify auth signatures" --name=security_auditor --archetype=verifier --timeout=1200 --budget=50000 --roles=auditor,crypto'),
        supervisor,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("Started subagent security_auditor");
      expect(supervisor.spawnSubagent).toHaveBeenCalledWith(
        {
          archetype: "verifier",
          prompt: "Verify auth signatures",
          name: "security_auditor",
          roles: ["auditor", "crypto"],
          workspaceIsolation: "inherit",
          timeoutSeconds: 1200,
          budgetTokens: 50000,
          skills: [],
        },
        undefined,
      );
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Control Commands (/swarm pause, resume, stop, message)                 */
  /* ------------------------------------------------------------------------ */

  describe("Control Commands Validation", () => {
    it("rejects control actions without valid subagent UUIDs", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      for (const act of ["pause", "resume", "stop"]) {
        const noId = await dispatchCommand(frame(`/swarm ${act}`), supervisor);
        expect(noId.success).toBe(false);
        expect(noId.data).toMatchObject({ code: "invalid_command" });

        const badId = await dispatchCommand(frame(`/swarm ${act} not-a-uuid`), supervisor);
        expect(badId.success).toBe(false);
        expect(badId.data).toMatchObject({ code: "invalid_command" });
      }
      expect(supervisor.manageSubagents).not.toHaveBeenCalled();
    });

    it("successfully executes pause, resume, and stop with validated UUID", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn().mockResolvedValue({
          action: "pause",
          success: true,
          message: `Subagent ${validUuid} paused`,
        }),
        sendMessage: vi.fn(),
      };

      const pauseRes = await dispatchCommand(frame(`/swarm pause ${validUuid}`), supervisor);
      expect(pauseRes.success).toBe(true);
      expect(supervisor.manageSubagents).toHaveBeenCalledWith({
        action: "pause",
        subagentId: validUuid,
      });

      supervisor.manageSubagents.mockResolvedValueOnce({
        action: "resume",
        success: true,
        message: `Subagent ${validUuid} resumed`,
      });
      const resumeRes = await dispatchCommand(frame(`/swarm resume ${validUuid}`), supervisor);
      expect(resumeRes.success).toBe(true);
      expect(supervisor.manageSubagents).toHaveBeenCalledWith({
        action: "resume",
        subagentId: validUuid,
      });

      supervisor.manageSubagents.mockResolvedValueOnce({
        action: "kill",
        success: true,
        message: "Killed subagent tree",
      });
      const stopRes = await dispatchCommand(frame(`/swarm stop ${validUuid} --recursive=false`), supervisor);
      expect(stopRes.success).toBe(true);
      expect(supervisor.manageSubagents).toHaveBeenCalledWith({
        action: "kill",
        subagentId: validUuid,
        recursive: false,
      });
    });

    it("rejects message command missing recipient or body", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const noBody = await dispatchCommand(frame(`/swarm message ${validUuid}`), supervisor);
      expect(noBody.success).toBe(false);
      expect(noBody.data).toMatchObject({ code: "invalid_command" });

      const badUuid = await dispatchCommand(frame('/swarm message bad-id "Hello"'), supervisor);
      expect(badUuid.success).toBe(false);
      expect(badUuid.data).toMatchObject({ code: "invalid_command" });
      expect(supervisor.sendMessage).not.toHaveBeenCalled();
    });

    it("successfully dispatches valid message with validated schema", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn().mockResolvedValue({
          messageId: "987fcdeb-51a2-43d7-9876-543210987654",
          deliveryTimestamp: "2026-08-26T12:00:00.000Z",
          delivered: true,
          recipientStatus: "running",
        }),
      };

      const result = await dispatchCommand(
        frame(`/swarm message ${validUuid} "Please review analysis.md" --priority=high --subject="Urgent Review"`),
        supervisor,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("delivered");
      expect(supervisor.sendMessage).toHaveBeenCalledWith(
        {
          recipientId: validUuid,
          subject: "Urgent Review",
          body: "Please review analysis.md",
          priority: "high",
          referencedArtifacts: [],
        },
        "root",
      );
    });
  });
});
