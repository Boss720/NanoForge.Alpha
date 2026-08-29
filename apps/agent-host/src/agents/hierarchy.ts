/**
 * Subagent Hierarchy Manager & Cascading Teardown.
 *
 * Enforces:
 * - Recursion depth limit <= 3 (SEC-SUB-05, throws `ERR_SUBAGENT_MAX_DEPTH_EXCEEDED`)
 * - Concurrency limit <= 8 active subagents
 * - Cascading post-order `killTree(rootId)` with worktree pruning and daemon/schedule cancellation
 */
import {
  MAX_CONCURRENT_SUBAGENTS,
  MAX_SUBAGENT_HIERARCHY_DEPTH,
  SUBAGENT_ERROR_CODES,
} from "@protocol/subagents";
import { pruneWorktree } from "../workspace/gitWorktree.js";
import type { SubagentRegistry } from "./registry.js";
import type { DaemonSupervisor } from "../daemons/supervisor.js";
import type { TaskScheduler } from "../daemons/scheduler.js";

export class HierarchyManager {
  /**
   * Calculates the hierarchical depth of a subagent node.
   * Root node (no parent) = Depth 1.
   * Child of Root = Depth 2.
   * Child of Depth 2 = Depth 3.
   */
  getDepth(subagentId: string, registry: SubagentRegistry): number {
    let depth = 1;
    let currentId: string | null = subagentId;

    while (currentId) {
      const node = registry.get(currentId);
      if (!node || !node.parentId) break;
      depth += 1;
      currentId = node.parentId;
      if (depth > 100) break; // Infinite loop guard
    }

    return depth;
  }

  /**
   * Validates whether a new subagent can be spawned under `parentId`:
   * - Enforces SEC-SUB-05 (Depth <= 3)
   * - Enforces Concurrency Limit (Active <= 8)
   */
  validateSpawn(parentId: string | null | undefined, registry: SubagentRegistry): void {
    // 1. Check concurrency limit
    const activeNodes = registry.getActive();
    if (activeNodes.length >= MAX_CONCURRENT_SUBAGENTS) {
      throw new Error(
        `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_CONCURRENCY_LIMIT_EXCEEDED}: Cannot spawn subagent. Active subagent count (${activeNodes.length}) has reached the maximum allowed limit of ${MAX_CONCURRENT_SUBAGENTS}.`
      );
    }

    // 2. Check depth limit
    if (parentId) {
      const parentDepth = this.getDepth(parentId, registry);
      const proposedDepth = parentDepth + 1;
      if (proposedDepth > MAX_SUBAGENT_HIERARCHY_DEPTH) {
        throw new Error(
          `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_MAX_DEPTH_EXCEEDED}: Cannot spawn child subagent. Proposed depth (${proposedDepth}) exceeds the maximum allowed hierarchy depth of ${MAX_SUBAGENT_HIERARCHY_DEPTH} (SEC-SUB-05).`
        );
      }
    }
  }

  /**
   * Collects all descendant IDs of `rootId` in post-order (children first, then root).
   */
  collectSubtreePostOrder(rootId: string, registry: SubagentRegistry): string[] {
    const result: string[] = [];

    const traverse = (currentId: string) => {
      const children = registry.getChildren(currentId);
      for (const child of children) {
        traverse(child.id);
      }
      result.push(currentId);
    };

    traverse(rootId);
    return result;
  }

  /**
   * Cascading termination of a subagent subtree:
   * - Aborts all turn execution loops
   * - Prunes Git worktrees
   * - Terminates creator-bound background tasks
   * - Cancels creator-bound scheduled timers and cron jobs
   */
  async killTree(
    rootId: string,
    registry: SubagentRegistry,
    options?: {
      workspaceRoot?: string;
      daemonSupervisor?: DaemonSupervisor;
      scheduler?: TaskScheduler;
      reason?: string;
    }
  ): Promise<string[]> {
    const postOrderIds = this.collectSubtreePostOrder(rootId, registry);
    const killedIds: string[] = [];

    for (const id of postOrderIds) {
      const node = registry.get(id);
      if (!node) continue;

      // 1. Abort turn controller
      try {
        node.abortController.abort(options?.reason ?? "Cascading killTree executed");
      } catch {
        // Ignore abort errors
      }

      // 2. Prune Git worktree if branch mode
      if (node.isolationMode === "branch" && node.worktreePath && options?.workspaceRoot) {
        try {
          await pruneWorktree(options.workspaceRoot, node.worktreePath);
        } catch (err) {
          console.error(`Failed to prune worktree for ${node.id}:`, err);
        }
      }

      // 3. Kill bound daemons
      if (options?.daemonSupervisor) {
        try {
          await options.daemonSupervisor.killAll(node.id);
        } catch (err) {
          console.error(`Failed to kill daemons for ${node.id}:`, err);
        }
      }

      // 4. Cancel bound schedules
      if (options?.scheduler) {
        try {
          options.scheduler.cancelByCreator(node.id, "Subagent terminated by supervisor");
        } catch (err) {
          console.error(`Failed to cancel schedules for ${node.id}:`, err);
        }
      }

      // 5. Update state
      if (node.state !== "errored") {
        try {
          node.state = "errored";
          node.error = options?.reason ?? "Terminated by supervisor killTree";
          node.completedAt = new Date().toISOString();
        } catch {
          // Ignore
        }
      }

      killedIds.push(id);
    }

    return killedIds;
  }
}
