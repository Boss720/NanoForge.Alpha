import { describe, expect, it } from "vitest";
import {
  parseSlashCommand,
  formatSlashCommand,
  BUILTIN_SLASH_COMMANDS,
  commandExecuteFrameSchema,
  commandResultFrameSchema,
  slashCommandWireSchema,
  slashCommandCategorySchema,
  swarmCommandActionSchema,
  swarmCommandResultSchema,
  type SlashCommandWire,
} from "./commands";

describe("Slash Command Engine Protocol & Tokenizer", () => {
  /* ------------------------------------------------------------------------ */
  /* 1. Basic Tokenization & Argument Parsing                                 */
  /* ------------------------------------------------------------------------ */

  it("parses a simple command with no arguments", () => {
    const parsed = parseSlashCommand("/plan");
    expect(parsed).toEqual({
      command: "/plan",
      positional: [],
      flags: {},
      rawInput: "/plan",
      mentions: { files: [], rules: [], symbols: [], agents: [] },
    });
  });

  it("parses positional arguments and preserves order", () => {
    const parsed = parseSlashCommand("/goal Refactor authentication subsystem");
    expect(parsed?.command).toBe("/goal");
    expect(parsed?.positional).toEqual(["Refactor", "authentication", "subsystem"]);
  });

  it("handles double-quoted strings with embedded spaces and escaped quotes", () => {
    const parsed = parseSlashCommand('/plan "Build new auth \\"super\\" gate" --fast');
    expect(parsed?.command).toBe("/plan");
    expect(parsed?.positional).toEqual(['Build new auth "super" gate']);
    expect(parsed?.flags).toEqual({ fast: true });
  });

  it("handles single-quoted strings", () => {
    const parsed = parseSlashCommand("/learn 'frontend/components/Button.tsx'");
    expect(parsed?.command).toBe("/learn");
    expect(parsed?.positional).toEqual(["frontend/components/Button.tsx"]);
  });

  /* ------------------------------------------------------------------------ */
  /* 2. Flag Parsing (Boolean, Number, String, Short flags)                   */
  /* ------------------------------------------------------------------------ */

  it("parses typed key-value flags and boolean switches", () => {
    const parsed = parseSlashCommand(
      "/compact --keep=5 --ratio=0.75 --dryRun=true --verbose --env=production -f",
    );
    expect(parsed?.command).toBe("/compact");
    expect(parsed?.flags).toEqual({
      keep: 5,
      ratio: 0.75,
      dryRun: true,
      verbose: true,
      env: "production",
      f: true,
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 3. Context Mentions Extraction                                           */
  /* ------------------------------------------------------------------------ */

  it("extracts @file, @rule, #symbol, and @agent mentions into structured fields", () => {
    const input =
      "/plan Create auth flow @file:src/auth.ts @rule:security-first #symbol:TokenValidator #LegacyHash @agent:sub-worker-1";
    const parsed = parseSlashCommand(input);

    expect(parsed?.command).toBe("/plan");
    expect(parsed?.positional).toEqual(["Create", "auth", "flow"]);
    expect(parsed?.mentions).toEqual({
      files: ["src/auth.ts"],
      rules: ["security-first"],
      symbols: ["TokenValidator", "LegacyHash"],
      agents: ["sub-worker-1"],
    });
  });

  /* ------------------------------------------------------------------------ */
  /* 4. Non-Command Rejection & Edge Cases                                    */
  /* ------------------------------------------------------------------------ */

  it("returns null for non-command strings and embedded slashes", () => {
    expect(parseSlashCommand("Hello world")).toBeNull();
    expect(parseSlashCommand("Can you run /plan for me?")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
    expect(parseSlashCommand("   ")).toBeNull();
  });

  /* ------------------------------------------------------------------------ */
  /* 5. Wire Frame Schemas & Validation                                       */
  /* ------------------------------------------------------------------------ */

  it("validates slashCommandWireSchema structure", () => {
    const wire: SlashCommandWire = {
      command: "/browse",
      positional: ["https://example.com"],
      flags: { action: "screenshot", timeout: 3000 },
      rawInput: "/browse https://example.com --action=screenshot --timeout=3000",
      mentions: { files: [], rules: [], symbols: [], agents: [] },
    };
    const validated = slashCommandWireSchema.parse(wire);
    expect(validated.command).toBe("/browse");
    expect(validated.flags.timeout).toBe(3000);
  });

  it("validates commandExecuteFrameSchema", () => {
    const frame = {
      type: "command.execute" as const,
      command: "/plan",
      args: ["Refactor database models"],
      rawText: "/plan Refactor database models",
      requestId: "req-123",
    };
    const parsed = commandExecuteFrameSchema.parse(frame);
    expect(parsed.type).toBe("command.execute");
    expect(parsed.command).toBe("/plan");
  });

  it("validates commandResultFrameSchema on success and failure", () => {
    const successFrame = {
      type: "command.result" as const,
      command: "/cost",
      success: true,
      output: "Total USD: $0.42",
      data: { totalUsd: 0.42 },
      requestId: "req-123",
    };
    expect(commandResultFrameSchema.parse(successFrame).success).toBe(true);

    const errorFrame = {
      type: "command.result" as const,
      command: "/browse",
      success: false,
      error: "Navigation timeout",
      requestId: "req-124",
    };
    expect(commandResultFrameSchema.parse(errorFrame).error).toBe("Navigation timeout");
  });

  /* ------------------------------------------------------------------------ */
  /* 6. Built-in Command Registry & Formatting Roundtrip                      */
  /* ------------------------------------------------------------------------ */

  it("registers all built-in commands with valid categories", () => {
    expect(BUILTIN_SLASH_COMMANDS).toHaveLength(11);
    const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
    expect(names).toContain("/plan");
    expect(names).toContain("/goal");
    expect(names).toContain("/schedule");
    expect(names).toContain("/browse");
    expect(names).toContain("/learn");
    expect(names).toContain("/cost");
    expect(names).toContain("/compact");
    expect(names).toContain("/clear");

    for (const cmd of BUILTIN_SLASH_COMMANDS) {
      expect(slashCommandCategorySchema.parse(cmd.category)).toBeDefined();
      expect(cmd.description.length).toBeGreaterThan(0);
      expect(cmd.usage.startsWith("/")).toBe(true);
    }
  });

  it("formats SlashCommandWire back to string roundtrip correctly", () => {
    const input = '/plan "Implement OAuth" --fast @file:src/auth.ts @rule:strict';
    const parsed = parseSlashCommand(input)!;
    expect(parsed).not.toBeNull();

    const formatted = formatSlashCommand(parsed);
    expect(formatted).toBe('/plan "Implement OAuth" --fast @file:src/auth.ts @rule:strict');
  });

  it("parses a swarm run with a quoted goal, typed flags, and agent mentions", () => {
    const input =
      '/swarm run "Refactor the auth gateway" --maxAgents=3 --parallel=true @agent:lead';
    const parsed = parseSlashCommand(input);

    expect(parsed).toEqual({
      command: "/swarm",
      positional: ["run", "Refactor the auth gateway"],
      flags: { maxAgents: 3, parallel: true },
      rawInput: input,
      mentions: { files: [], rules: [], symbols: [], agents: ["lead"] },
    });

    expect(formatSlashCommand(parsed!)).toBe(
      '/swarm run "Refactor the auth gateway" --maxAgents=3 --parallel @agent:lead',
    );
  });

  it("exposes swarm commands, operation metadata, aliases, and typed results", () => {
    expect(BUILTIN_SLASH_COMMANDS).toHaveLength(11);

    const swarm = BUILTIN_SLASH_COMMANDS.find((command) => command.name === "/swarm");
    const agents = BUILTIN_SLASH_COMMANDS.find((command) => command.name === "/agents");
    const agent = BUILTIN_SLASH_COMMANDS.find((command) => command.name === "/agent");

    expect(swarm?.aliases).toContain("/sw");
    expect(swarm?.params?.find((param) => param.name === "action")?.enumValues).toEqual([
      "run",
      "list",
      "tree",
      "inspect",
      "message",
      "pause",
      "resume",
      "stop",
      "focus",
    ]);
    expect(agents?.aliases).toEqual(["/agent-list", "/agent-tree", "/agent-inspect"]);
    expect(agent?.aliases).toEqual([
      "/a",
      "/agent-message",
      "/agent-pause",
      "/agent-resume",
      "/agent-stop",
      "/agent-focus",
    ]);

    for (const action of [
      "run",
      "list",
      "tree",
      "inspect",
      "message",
      "pause",
      "resume",
      "stop",
      "focus",
    ] as const) {
      expect(swarmCommandActionSchema.parse(action)).toBe(action);
    }

    expect(
      swarmCommandResultSchema.parse({
        action: "message",
        success: true,
        agentId: "worker-1",
        message: "Message delivered",
      }),
    ).toEqual({
      action: "message",
      success: true,
      agentId: "worker-1",
      message: "Message delivered",
    });
  });
});
