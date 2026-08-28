import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseSlashCommand, type CommandExecuteFrame } from "@protocol/commands";
import {
  manageSubagentsInspectFileSchema,
  validateSubagentName,
  SUBAGENT_ERROR_CODES,
  invokeSubagentParamsSchema,
} from "@protocol/subagents";
import { dispatchCommand, formatZodIssues, serializeZodIssues } from "./session.js";
import { SubagentSupervisor } from "./agents/supervisor.js";

function frame(rawText: string, requestId = "req-challenger-phase2"): CommandExecuteFrame {
  const parsed = parseSlashCommand(rawText);
  if (!parsed) throw new Error(`Expected valid slash command for: ${rawText}`);
  return {
    type: "command.execute",
    command: parsed.command,
    args: parsed.positional,
    rawText,
    parsed,
    requestId,
  };
}

describe("Phase 2 Empirical Challenger Stress Harness", () => {
  const validUuid = "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d";
  const validUuid2 = "b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e";

  /* ------------------------------------------------------------------------ */
  /* 1. Traversal & Evasion Matrix for /swarm inspect                         */
  /* ------------------------------------------------------------------------ */
  describe("1. Traversal & Evasion Attack Matrix on /swarm inspect", () => {
    const hostileInspectPayloads = [
      // Basic relative traversal
      "../secret",
      "../../secret",
      "../../../secret",
      "../../../../../../../../../../windows/system.ini",
      "..\\secret",
      "..\\..\\secret",
      "..\\..\\..\\secret",
      "..\\..\\..\\windows\\system32\\drivers\\etc\\hosts",
      "..\\../..\\../secret",
      "./../../secret",
      "subdir/../../../secret",

      // Absolute paths (POSIX & Windows)
      "/etc/passwd",
      "/etc/shadow",
      "/var/log/syslog",
      "C:\\Windows\\win.ini",
      "C:/Windows/win.ini",
      "D:\\data\\passwords.txt",
      "\\\\?\\C:\\secret",
      "\\\\127.0.0.1\\c$\\secret",
      "\\\\localhost\\share\\file",

      // Single URL encodings
      "%2e%2e%2fsecret",
      "%2e%2e%5csecret",
      "..%2f..%2fpackage.json",
      "..%5c..%5cpackage.json",
      "%2fetc%2fpasswd",
      "%43%3a%5csecret",

      // Double & Triple URL encodings
      "%252e%252e%252fsecret",
      "%25252e%25252e%25252fsecret",
      "%252e%252e%255csecret",
      "progress.md%2500.txt",

      // Null bytes and control character injections
      "progress.md\0.secret",
      "progress.md\0",
      "BRIEFING.md%00.exe",
      "progress.md\n/etc/passwd",
      "progress.md\r\n/etc/passwd",

      // Non-allowlisted sensitive files
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      ".env",
      ".env.local",
      ".env.production",
      "id_rsa",
      "id_rsa.pub",
      "id_ed25519",
      ".npmrc",
      ".netrc",
      "config.json",
      "secrets.yaml",
      "credentials.db",

      // Case sensitivity mismatches
      "PROGRESS.MD",
      "Progress.md",
      "briefing.md",
      "Briefing.MD",
      "HANDOFF.MD",
      "Handoff.md",
      "dispatch.md",
      "Dispatch.MD",
      "ANALYSIS.MD",
      "Analysis.md",

      // File variations & homoglyphs
      "progress.md.bak",
      "progress.md.tmp",
      "progress.md~",
      ".progress.md",
      "progress.md ",
      " progress.md",
      "progress.md\t",
      "progress.markdown",
      "BRIEFING.txt",
      "analysis.json",
      "handoff.pdf",

      // Windows device names
      "CON",
      "PRN",
      "AUX",
      "NUL",
      "COM1",
      "LPT1",
    ];

    it.each(hostileInspectPayloads)(
      "blocks inspect flag payload '%s' at command dispatcher and returns invalid_command",
      async (payload) => {
        const supervisor = {
          spawnSubagent: vi.fn(),
          manageSubagents: vi.fn(),
          sendMessage: vi.fn(),
        };

        // Format command safely for tokenizer
        const safePayload = payload.replace(/"/g, '\\"');
        const cmdText = `/swarm inspect ${validUuid} --file="${safePayload}"`;
        const cmdFrame = frame(cmdText);
        const result = await dispatchCommand(cmdFrame, supervisor);

        expect(result.success).toBe(false);
        expect(result.data).toMatchObject({ code: "invalid_command" });
        expect(result.error).toContain("Invalid /swarm inspect arguments");
        expect(supervisor.manageSubagents).not.toHaveBeenCalled();
      }
    );

    it.each(hostileInspectPayloads)(
      "blocks inspect positional payload '%s' at command dispatcher",
      async (payload) => {
        const supervisor = {
          spawnSubagent: vi.fn(),
          manageSubagents: vi.fn(),
          sendMessage: vi.fn(),
        };

        const safePayload = payload.replace(/"/g, '\\"');
        const cmdText = `/swarm inspect ${validUuid} "${safePayload}"`;
        const cmdFrame = frame(cmdText);
        const result = await dispatchCommand(cmdFrame, supervisor);

        expect(result.success).toBe(false);
        expect(result.data).toMatchObject({ code: "invalid_command" });
        expect(supervisor.manageSubagents).not.toHaveBeenCalled();
      }
    );
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Subagent Name Confinement & Malicious Identifier Matrix               */
  /* ------------------------------------------------------------------------ */
  describe("2. Subagent Name Confinement Matrix on /swarm run", () => {
    const hostileNames = [
      // Directory traversals
      "../outside",
      "../../outside",
      "../../../root",
      "..\\outside",
      "..\\..\\outside",
      "..\\..\\system32",
      "subdir/agent",
      "subdir\\agent",
      "a/b/c",
      "a\\b\\c",

      // Absolute paths & drives
      "/etc/agent",
      "C:\\agent",
      "C:/agent",
      "D:\\agent",
      "\\\\server\\share\\agent",

      // Control characters and zero bytes
      "agent\0null",
      "agent\nnewline",
      "agent\rcarriage",
      "agent\ttab",
      "agent\x1b[31mcolor",
      "agent\x08backspace",

      // Unicode, symbols, homoglyphs & RTL overrides
      "agent föö",
      "agent_你好",
      "agent\u202e_reversed",
      "agent\uFEFF_bom",
      "agent\uff0e\uff0edotdot",
      "agent\u2215slash",

      // Shell & command metacharacters
      "agent;rm -rf /",
      "agent && whoami",
      "agent || true",
      "agent|cat",
      "agent>output.txt",
      "agent<input.txt",
      "agent`id`",
      "agent$(whoami)",
      "agent${HOME}",
      "agent!bang",
      "agent@at",
      "agent#hash",
      "agent$dollar",
      "agent%percent",
      "agent^caret",
      "agent&amp",
      "agent*star",
      "agent(paren)",
      "agent+plus",
      "agent=equal",
      "agent[bracket]",
      "agent{brace}",
      "agent|pipe",
      "agent\\backslash",
      "agent:colon",
      "agent;semicolon",
      "agent'quote",
      "agent,comma",
      "agent<lt",
      "agent>gt",
      "agent?question",
      "agent/slash",

      // Whitespace
      "agent with spaces",
      " agent_leading_space",
      "agent_trailing_space ",
      "agent\t_tab",
      "   ",
      "",

      // Length boundary violations
      "a".repeat(65),
      "a".repeat(100),
      "a".repeat(1000),
    ];

    it.each(hostileNames)(
      "rejects hostile subagent name '%s' in validateSubagentName",
      (name) => {
        expect(validateSubagentName(name)).toBe(false);
      }
    );

    const hostileNamesForDispatcher = hostileNames.filter((n) => n.trim().length > 0);

    it.each(hostileNamesForDispatcher)(
      "rejects /swarm run with hostile name '%s' at dispatcher with invalid_command",
      async (name) => {
        const supervisor = {
          spawnSubagent: vi.fn().mockResolvedValue({
            subagentId: validUuid,
            name: "fallback",
            archetype: "custom",
            workingDirectory: "/tmp",
            state: "running",
            startedAt: new Date().toISOString(),
          }),
          manageSubagents: vi.fn(),
          sendMessage: vi.fn(),
        };

        const safeName = name.replace(/"/g, '\\"');
        const cmdText = `/swarm run "Test task" --name="${safeName}"`;
        const cmdFrame = frame(cmdText);
        const result = await dispatchCommand(cmdFrame, supervisor);

        expect(result.success).toBe(false);
        expect(result.data).toMatchObject({ code: "invalid_command" });
        expect(supervisor.spawnSubagent).not.toHaveBeenCalled();
      }
    );

    const validNames = [
      "a",
      "A",
      "0",
      "worker",
      "WORKER",
      "worker_1",
      "worker-2",
      "Subagent_Specialist-09",
      "a".repeat(64),
      "alpha_beta_gamma-123_456-789",
    ];

    it.each(validNames)("accepts valid safe subagent name '%s'", (name) => {
      expect(validateSubagentName(name)).toBe(true);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Structured invalid_command Schema Rejections Across All Operations    */
  /* ------------------------------------------------------------------------ */
  describe("3. Structured invalid_command Schema Rejections Across All Swarm Actions", () => {
    it("returns structured issues for invalid /swarm run parameters (budget, timeout, isolation)", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const invalidScenarios = [
        {
          cmd: '/swarm run "Test" --budget=0',
          desc: "zero budget",
        },
        {
          cmd: '/swarm run "Test" --budget=-500',
          desc: "negative budget",
        },
        {
          cmd: '/swarm run "Test" --timeout=0',
          desc: "zero timeout",
        },
        {
          cmd: '/swarm run "Test" --timeout=-10',
          desc: "negative timeout",
        },
        {
          cmd: '/swarm run "Test" --timeout=7201',
          desc: "timeout exceeding 7200 max",
        },
        {
          cmd: '/swarm run "Test" --isolation=unsupported_isolation_mode',
          desc: "invalid workspace isolation mode",
        },
        {
          cmd: '/swarm run "Test" --archetype=nonexistent_archetype',
          desc: "invalid archetype",
        },
      ];

      for (const scenario of invalidScenarios) {
        const result = await dispatchCommand(frame(scenario.cmd), supervisor);
        expect(result.success, `Failed on ${scenario.desc}`).toBe(false);
        expect(result.data).toMatchObject({
          code: "invalid_command",
          issues: expect.any(Array),
        });
        const issues = (result.data as { issues: Array<{ path: string; message: string; code: string }> }).issues;
        expect(issues.length).toBeGreaterThan(0);
        expect(supervisor.spawnSubagent).not.toHaveBeenCalled();
      }
    });

    it("returns structured issues for invalid /swarm message parameters", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      const invalidMessageScenarios = [
        {
          cmd: '/swarm message not-a-uuid "Hello agent"',
          desc: "non-UUID recipient",
        },
        {
          cmd: `/swarm message ${validUuid} --priority=super_urgent "Hello"`,
          desc: "invalid priority",
        },
      ];

      for (const scenario of invalidMessageScenarios) {
        const result = await dispatchCommand(frame(scenario.cmd), supervisor);
        expect(result.success, `Failed on ${scenario.desc}`).toBe(false);
        expect(result.data).toMatchObject({
          code: "invalid_command",
          issues: expect.any(Array),
        });
        expect(supervisor.sendMessage).not.toHaveBeenCalled();
      }
    });

    it("returns structured issues for invalid /swarm pause, resume, stop with non-UUID agent IDs", async () => {
      const supervisor = {
        spawnSubagent: vi.fn(),
        manageSubagents: vi.fn(),
        sendMessage: vi.fn(),
      };

      for (const action of ["pause", "resume", "stop"] as const) {
        const result = await dispatchCommand(frame(`/swarm ${action} invalid-uuid-1234`), supervisor);
        expect(result.success).toBe(false);
        expect(result.data).toMatchObject({
          code: "invalid_command",
          issues: expect.any(Array),
        });
        expect(supervisor.manageSubagents).not.toHaveBeenCalled();
      }
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Slash Command Aliases & Embedded Actions                              */
  /* ------------------------------------------------------------------------ */
  describe("4. Slash Command Aliases & Embedded Actions Verification", () => {
    it("correctly routes alias commands to corresponding supervisor actions", async () => {
      const supervisor = {
        spawnSubagent: vi.fn().mockResolvedValue({
          subagentId: validUuid,
          name: "agent_alias",
          archetype: "custom",
          workingDirectory: "/workspace",
          state: "running",
          startedAt: new Date().toISOString(),
        }),
        manageSubagents: vi.fn().mockResolvedValue({
          action: "list",
          success: true,
          subagents: [],
          message: "0 subagents",
        }),
        sendMessage: vi.fn().mockResolvedValue({
          messageId: validUuid2,
          deliveryTimestamp: new Date().toISOString(),
          recipientStatus: "running",
          delivered: true,
        }),
      };

      // /sw run
      const swRunRes = await dispatchCommand(frame('/sw run "Task 1"'), supervisor);
      expect(swRunRes.success).toBe(true);
      expect(supervisor.spawnSubagent).toHaveBeenCalledTimes(1);

      // /agents list
      const agentsListRes = await dispatchCommand(frame("/agents"), supervisor);
      expect(agentsListRes.success).toBe(true);
      expect(supervisor.manageSubagents).toHaveBeenCalledWith({ action: "list" }, undefined);

      // /agent-inspect
      supervisor.manageSubagents.mockResolvedValueOnce({
        action: "inspect",
        success: true,
        inspectedContent: "# Content",
      });
      const inspectRes = await dispatchCommand(
        frame(`/agent-inspect ${validUuid} --file=progress.md`),
        supervisor
      );
      expect(inspectRes.success).toBe(true);
      expect(supervisor.manageSubagents).toHaveBeenCalledWith({
        action: "inspect",
        subagentId: validUuid,
        inspectFile: "progress.md",
      });

      // /swarm.inspect
      supervisor.manageSubagents.mockResolvedValueOnce({
        action: "inspect",
        success: true,
        inspectedContent: "# Briefing",
      });
      const dotInspectRes = await dispatchCommand(
        frame(`/swarm.inspect ${validUuid} BRIEFING.md`),
        supervisor
      );
      expect(dotInspectRes.success).toBe(true);
      expect(supervisor.manageSubagents).toHaveBeenCalledWith({
        action: "inspect",
        subagentId: validUuid,
        inspectFile: "BRIEFING.md",
      });

      // /agent-message
      const msgRes = await dispatchCommand(
        frame(`/agent-message ${validUuid} "Message text"`),
        supervisor
      );
      expect(msgRes.success).toBe(true);
      expect(supervisor.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: validUuid,
          body: "Message text",
        }),
        "root"
      );

      // /agent-stop
      supervisor.manageSubagents.mockResolvedValueOnce({
        action: "kill",
        success: true,
        message: "Stopped",
      });
      const stopRes = await dispatchCommand(frame(`/agent-stop ${validUuid}`), supervisor);
      expect(stopRes.success).toBe(true);
      expect(supervisor.manageSubagents).toHaveBeenCalledWith({
        action: "kill",
        subagentId: validUuid,
        recursive: true,
      });
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 5. End-to-End Filesystem Inspection Isolation in Real Subagent Directory */
  /* ------------------------------------------------------------------------ */
  describe("5. End-to-End Real Filesystem Inspection Isolation", () => {
    let tmpDir: string;
    let supervisor: SubagentSupervisor;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-challenger-stress-"));
      supervisor = new SubagentSupervisor({ workspaceRoot: tmpDir });
    });

    afterEach(async () => {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    it("verifies all 5 allowed inspection files are generated, populated, and read correctly", async () => {
      const agent = await supervisor.spawnSubagent({
        archetype: "qa",
        name: "test_inspector",
        prompt: "Stress testing metadata files",
      });

      const allowedFiles = [
        "progress.md",
        "BRIEFING.md",
        "handoff.md",
        "DISPATCH.md",
        "analysis.md",
      ] as const;

      const node = supervisor.registry.get(agent.subagentId)!;
      const metadataDir = path.resolve(tmpDir, node.metadataDir);

      for (const fileName of allowedFiles) {
        const testContent = `# Content of ${fileName}\nCreated at ${new Date().toISOString()}`;
        await fs.writeFile(path.join(metadataDir, fileName), testContent, "utf8");

        // Inspect through manageSubagents
        const result = await supervisor.manageSubagents({
          action: "inspect",
          subagentId: agent.subagentId,
          inspectFile: fileName,
        });

        expect(result.success).toBe(true);
        expect(result.inspectedContent).toBe(testContent);
        expect(result.detail?.name).toBe("test_inspector");

        // Inspect through slash command dispatcher
        const cmdResult = await dispatchCommand(
          frame(`/swarm inspect ${agent.subagentId} --file=${fileName}`),
          supervisor
        );
        expect(cmdResult.success).toBe(true);
        expect(cmdResult.output).toBe(testContent);
      }
    });

    it("prevents reading cross-subagent metadata or workspace root files via direct manageSubagents calls", async () => {
      // Create agent A and agent B
      const agentA = await supervisor.spawnSubagent({
        archetype: "planner",
        name: "agent_a",
        prompt: "Agent A",
      });
      const agentB = await supervisor.spawnSubagent({
        archetype: "implementer",
        name: "agent_b",
        prompt: "Agent B",
      });

      // Write secret outside in workspace root
      const rootSecretPath = path.join(tmpDir, "root-secret.txt");
      await fs.writeFile(rootSecretPath, "SUPER_SECRET_KEY=12345", "utf8");

      // Write secret in agent B's directory
      const nodeB = supervisor.registry.get(agentB.subagentId)!;
      const bSecretPath = path.join(tmpDir, nodeB.metadataDir, "analysis.md");
      await fs.writeFile(bSecretPath, "Agent B Private Analysis", "utf8");

      // Attempt to inspect root file from agent A
      const rootInspect = await supervisor.manageSubagents({
        action: "inspect",
        subagentId: agentA.subagentId,
        // @ts-expect-error test illegal file
        inspectFile: "../../root-secret.txt",
      });
      expect(rootInspect.success).toBe(false);
      expect(rootInspect.message).toContain(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INSPECTION_FILE_NOT_FOUND);

      // Attempt to inspect agent B's file by traversing from agent A
      const nodeA = supervisor.registry.get(agentA.subagentId)!;
      const relPathToB = `../${path.basename(nodeB.metadataDir)}/analysis.md`;
      const crossInspect = await supervisor.manageSubagents({
        action: "inspect",
        subagentId: agentA.subagentId,
        // @ts-expect-error test cross-agent traversal
        inspectFile: relPathToB,
      });
      expect(crossInspect.success).toBe(false);
      expect(crossInspect.message).toContain(SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INSPECTION_FILE_NOT_FOUND);
    });

    it("verifies direct spawnSubagent rejects malicious metadata dir or name traversal", async () => {
      const maliciousNames = [
        "../../escape_agents",
        "..\\..\\escape_agents",
        "/absolute/agent",
        "C:\\Windows\\System32",
      ];

      for (const badName of maliciousNames) {
        await expect(
          supervisor.spawnSubagent({
            archetype: "custom",
            name: badName,
            prompt: "malicious spawn",
          })
        ).rejects.toThrow();
      }

      // Check that .agents contains only valid directories
      const agentsDir = path.join(tmpDir, ".agents");
      const exists = await fs.stat(agentsDir).then(() => true).catch(() => false);
      if (exists) {
        const entries = await fs.readdir(agentsDir);
        for (const entry of entries) {
          expect(entry).toMatch(/^[a-zA-Z0-9_\-]+_[a-f0-9]{8}$/);
        }
      }
    });
  });
});
