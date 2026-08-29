import { describe, expect, it, vi } from "vitest";
import { parseSlashCommand, type CommandExecuteFrame } from "@protocol/commands";
import { dispatchCommand } from "./session";

function frame(rawText: string): CommandExecuteFrame {
  const parsed = parseSlashCommand(rawText);
  if (!parsed) throw new Error("expected slash command");
  return {
    type: "command.execute",
    command: parsed.command,
    args: parsed.positional,
    rawText,
    parsed,
    requestId: "req-test",
  };
}

describe("swarm slash command dispatch", () => {
  it("treats the documented /swarm run goal as the prompt", async () => {
    const supervisor = {
      spawnSubagent: vi.fn().mockResolvedValue({ subagentId: "agent-1", name: "worker-1" }),
      manageSubagents: vi.fn(),
      sendMessage: vi.fn(),
    };

    const result = await dispatchCommand(frame('/swarm run "Audit the auth flow"'), supervisor);

    expect(result.success).toBe(true);
    expect(supervisor.spawnSubagent).toHaveBeenCalledWith(
      expect.objectContaining({ archetype: "custom", prompt: "Audit the auth flow" }),
      undefined,
    );
  });

  it("supports the /agents alias and defaults it to a list operation", async () => {
    const supervisor = {
      spawnSubagent: vi.fn(),
      manageSubagents: vi.fn().mockResolvedValue({ success: true, message: "1 agent" }),
      sendMessage: vi.fn(),
    };

    const result = await dispatchCommand(frame("/agents"), supervisor);

    expect(result.success).toBe(true);
    expect(supervisor.manageSubagents).toHaveBeenCalledWith({ action: "list" }, undefined);
  });
});
