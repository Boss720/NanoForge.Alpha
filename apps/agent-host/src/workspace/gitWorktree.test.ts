import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import {
  createWorktree,
  pruneWorktree,
  listWorktrees,
} from "./gitWorktree.js";

describe("gitWorktree isolation manager", () => {
  let tmpRepo: string;

  beforeEach(async () => {
    tmpRepo = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-worktree-test-"));
    // Initialize a real git repo
    await execa("git", ["init", "-b", "main"], { cwd: tmpRepo });
    await execa("git", ["config", "user.name", "Test Runner"], { cwd: tmpRepo });
    await execa("git", ["config", "user.email", "test@nanoforge.local"], { cwd: tmpRepo });
    await fs.writeFile(path.join(tmpRepo, "README.md"), "# Test Workspace\n", "utf8");
    await execa("git", ["add", "README.md"], { cwd: tmpRepo });
    await execa("git", ["commit", "-m", "Initial commit"], { cwd: tmpRepo });
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpRepo, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it("creates an isolated git worktree on a dedicated branch", async () => {
    const relWorktree = ".agents/worktrees/agent-1";
    const branchName = "nano/agent-1";

    const result = await createWorktree(tmpRepo, relWorktree, branchName);
    expect(result.success).toBe(true);
    expect(result.branch).toBe(branchName);

    const exists = await fs.stat(result.worktreePath).then((s) => s.isDirectory()).catch(() => false);
    expect(exists).toBe(true);

    const fileInWorktree = path.join(result.worktreePath, "README.md");
    const content = await fs.readFile(fileInWorktree, "utf8");
    expect(content).toContain("# Test Workspace");
  });

  it("lists active worktrees", async () => {
    const relWorktree = ".agents/worktrees/agent-list";
    const branchName = "nano/agent-list";

    await createWorktree(tmpRepo, relWorktree, branchName);
    const worktrees = await listWorktrees(tmpRepo);

    expect(worktrees.length).toBeGreaterThanOrEqual(2); // main + new worktree
    const found = worktrees.some((w) => w.branch.includes("nano/agent-list"));
    expect(found).toBe(true);
  });

  it("forcefully prunes and removes a worktree", async () => {
    const relWorktree = ".agents/worktrees/agent-prune";
    const branchName = "nano/agent-prune";

    const createRes = await createWorktree(tmpRepo, relWorktree, branchName);
    expect(createRes.success).toBe(true);

    const pruneRes = await pruneWorktree(tmpRepo, relWorktree);
    expect(pruneRes.success).toBe(true);

    const exists = await fs.stat(createRes.worktreePath).catch(() => null);
    expect(exists).toBeNull();
  });
});
