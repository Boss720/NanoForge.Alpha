/**
 * Git Worktree Isolation & Sandboxing Manager.
 *
 * Implements isolated Git worktrees for subagents running in "branch" mode:
 * - createWorktree: creates a new worktree on a dedicated branch (e.g. nano/<subagentId>)
 * - pruneWorktree: forces removal of the worktree and cleans up stale git references
 * - listWorktrees: inspects active worktrees in the repository
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";

export interface CreateWorktreeResult {
  success: boolean;
  worktreePath: string;
  branch: string;
  error?: string;
}

export interface PruneWorktreeResult {
  success: boolean;
  error?: string;
}

export interface WorktreeEntry {
  path: string;
  head: string;
  branch: string;
}

/**
 * Creates an isolated Git worktree at `worktreePath` checkout on `branchName`.
 * If the branch doesn't exist, `-B` creates/resets it based on HEAD.
 */
export async function createWorktree(
  workspaceRoot: string,
  worktreePath: string,
  branchName: string
): Promise<CreateWorktreeResult> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedWorktree = path.resolve(resolvedRoot, worktreePath);

  try {
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(resolvedWorktree), { recursive: true });

    // Execute git worktree add
    const { exitCode, stderr } = await execa(
      "git",
      ["-C", resolvedRoot, "worktree", "add", "-B", branchName, resolvedWorktree, "HEAD"],
      { reject: false }
    );

    if (exitCode !== 0) {
      return {
        success: false,
        worktreePath: resolvedWorktree,
        branch: branchName,
        error: stderr || `git worktree add failed with exit code ${exitCode}`,
      };
    }

    return {
      success: true,
      worktreePath: resolvedWorktree,
      branch: branchName,
    };
  } catch (err) {
    return {
      success: false,
      worktreePath: resolvedWorktree,
      branch: branchName,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Forcefully removes a Git worktree and prunes git worktree records.
 */
export async function pruneWorktree(
  workspaceRoot: string,
  worktreePath: string
): Promise<PruneWorktreeResult> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedWorktree = path.resolve(resolvedRoot, worktreePath);

  try {
    const { exitCode, stderr } = await execa(
      "git",
      ["-C", resolvedRoot, "worktree", "remove", "--force", resolvedWorktree],
      { reject: false }
    );

    // Also run prune to clean up metadata
    await execa("git", ["-C", resolvedRoot, "worktree", "prune"], { reject: false });

    // If directory still exists on disk, forcefully remove it
    try {
      await fs.rm(resolvedWorktree, { recursive: true, force: true });
    } catch {
      // Ignore if already deleted
    }

    if (exitCode !== 0) {
      return {
        success: false,
        error: stderr || `git worktree remove failed with exit code ${exitCode}`,
      };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Lists all active git worktrees in the repository.
 */
export async function listWorktrees(workspaceRoot: string): Promise<WorktreeEntry[]> {
  const resolvedRoot = path.resolve(workspaceRoot);
  try {
    const { stdout, exitCode } = await execa(
      "git",
      ["-C", resolvedRoot, "worktree", "list", "--porcelain"],
      { reject: false }
    );

    if (exitCode !== 0 || !stdout) return [];

    const entries: WorktreeEntry[] = [];
    const blocks = stdout.split("\n\n");

    for (const block of blocks) {
      if (!block.trim()) continue;
      const lines = block.trim().split("\n");
      let worktree = "";
      let head = "";
      let branch = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          worktree = line.slice("worktree ".length).trim();
        } else if (line.startsWith("HEAD ")) {
          head = line.slice("HEAD ".length).trim();
        } else if (line.startsWith("branch ")) {
          branch = line.slice("branch ".length).trim();
        }
      }

      if (worktree) {
        entries.push({ path: worktree, head, branch });
      }
    }

    return entries;
  } catch {
    return [];
  }
}
