import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseArgs } = require("../nanoforge-launcher.cjs");

describe("Launcher workspace writes configuration", () => {
  const originalEnv = process.env.NANOFORGE_ALLOW_WORKSPACE_WRITES;

  beforeEach(() => {
    delete process.env.NANOFORGE_ALLOW_WORKSPACE_WRITES;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NANOFORGE_ALLOW_WORKSPACE_WRITES = originalEnv;
    } else {
      delete process.env.NANOFORGE_ALLOW_WORKSPACE_WRITES;
    }
  });

  it("defaults allowWorkspaceWrites to false when no CLI flags or env vars are set", () => {
    const args = parseArgs([]);
    expect(args.allowWorkspaceWrites).toBe(false);
  });

  it("enables allowWorkspaceWrites when --allow-workspace-writes CLI flag is passed", () => {
    const args = parseArgs(["--allow-workspace-writes"]);
    expect(args.allowWorkspaceWrites).toBe(true);
  });

  it("enables allowWorkspaceWrites when --allow-writes alias flag is passed", () => {
    const args = parseArgs(["--allow-writes"]);
    expect(args.allowWorkspaceWrites).toBe(true);
  });

  it("enables allowWorkspaceWrites when NANOFORGE_ALLOW_WORKSPACE_WRITES=1 is in environment", () => {
    process.env.NANOFORGE_ALLOW_WORKSPACE_WRITES = "1";
    const args = parseArgs([]);
    expect(args.allowWorkspaceWrites).toBe(true);
  });

  it("disables allowWorkspaceWrites when NANOFORGE_ALLOW_WORKSPACE_WRITES=0 in environment", () => {
    process.env.NANOFORGE_ALLOW_WORKSPACE_WRITES = "0";
    const args = parseArgs([]);
    expect(args.allowWorkspaceWrites).toBe(false);
  });
});
