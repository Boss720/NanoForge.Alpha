/**
 * Subagent Registry.
 *
 * In-memory state index maintaining:
 * - Subagent nodes and telemetry
 * - Instantaneous parent-to-children hierarchy indexing
 * - Archetype indexing for fleet metrics
 * - Dynamic template definitions
 * - Heartbeat & liveness tracking
 */
import {
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  SUBAGENT_ERROR_CODES,
  canTransitionState,
  subagentInfoSchema,
  type SubagentArchetype,
  type SubagentInfo,
  type SubagentState,
  type DefineSubagentParams,
  type DefineSubagentResult,
} from "@protocol/subagents";
import { randomUUID } from "node:crypto";
import type { SubagentNode } from "./types.js";

export class SubagentRegistry {
  private readonly nodes = new Map<string, SubagentNode>();
  private readonly parentToChildren = new Map<string, Set<string>>();
  private readonly archetypeIndex = new Map<SubagentArchetype, Set<string>>();
  private readonly templateRegistry = new Map<string, DefineSubagentParams>();

  /**
   * Registers a newly spawned subagent node.
   */
  register(node: SubagentNode): void {
    this.nodes.set(node.id, node);

    // Index parent -> children
    if (node.parentId) {
      if (!this.parentToChildren.has(node.parentId)) {
        this.parentToChildren.set(node.parentId, new Set());
      }
      this.parentToChildren.get(node.parentId)!.add(node.id);
    }

    // Index archetype
    if (!this.archetypeIndex.has(node.archetype)) {
      this.archetypeIndex.set(node.archetype, new Set());
    }
    this.archetypeIndex.get(node.archetype)!.add(node.id);
  }

  /**
   * Gets the runtime node for a subagent by ID.
   */
  get(id: string): SubagentNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Converts a runtime node to a public wire SubagentInfo / SubagentSummary.
   */
  getSummary(id: string): SubagentInfo | undefined {
    const node = this.nodes.get(id);
    if (!node) return undefined;

    return subagentInfoSchema.parse({
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      archetype: node.archetype,
      roles: node.roles,
      state: node.state,
      workingDirectory: node.workingDirectory,
      worktreePath: node.worktreePath,
      isolationMode: node.isolationMode,
      startedAt: node.startedAt,
      completedAt: node.completedAt,
      lastHeartbeat: node.lastHeartbeat,
      tokensUsed: node.tokensUsed,
      turnCount: node.turnCount,
      telemetry: node.telemetry,
      lastProgressSummary: node.lastProgressSummary,
      exitCode: node.exitCode,
      error: node.error,
    });
  }

  /**
   * Updates state transition respecting FSM validity.
   */
  updateState(id: string, newState: SubagentState, reason?: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    if (!canTransitionState(node.state, newState)) {
      throw new Error(
        `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INVALID_STATE_TRANSITION}: Cannot transition from "${node.state}" to "${newState}" for subagent ${id}`
      );
    }

    node.state = newState;
    node.lastHeartbeat = new Date().toISOString();

    if (newState === "errored" || newState === "idle") {
      if (reason && !node.error) {
        node.error = reason;
      }
    }

    if (newState === "errored" || (newState === "idle" && node.completedAt === undefined)) {
      if (newState === "errored") {
        node.completedAt = new Date().toISOString();
      }
    }

    return true;
  }

  /**
   * Updates heartbeat timestamp and optional progress summary.
   */
  recordHeartbeat(id: string, progressSummary?: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.lastHeartbeat = new Date().toISOString();
    if (progressSummary) {
      node.lastProgressSummary = progressSummary;
    }
  }

  /**
   * Returns direct children of a parent subagent.
   */
  getChildren(parentId: string): SubagentNode[] {
    const childIds = this.parentToChildren.get(parentId);
    if (!childIds) return [];

    const children: SubagentNode[] = [];
    for (const childId of childIds) {
      const child = this.nodes.get(childId);
      if (child) children.push(child);
    }
    return children;
  }

  /**
   * Returns all registered subagents.
   */
  getAll(): SubagentNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Alias for getAll().
   */
  listSubagents(): SubagentNode[] {
    return this.getAll();
  }

  /**
   * Returns all active (non-errored) subagents.
   */
  getActive(): SubagentNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.state !== "errored");
  }

  /**
   * Registers a dynamic subagent template definition.
   */
  registerTemplate(template: DefineSubagentParams): DefineSubagentResult {
    this.templateRegistry.set(template.name, template);
    return {
      definitionId: randomUUID(),
      name: template.name,
      archetype: template.archetype,
      registered: true,
    };
  }

  /**
   * Retrieves a template definition by name.
   */
  getTemplate(name: string): DefineSubagentParams | undefined {
    return this.templateRegistry.get(name);
  }

  /**
   * Lists all registered custom templates.
   */
  listTemplates(): DefineSubagentParams[] {
    return Array.from(this.templateRegistry.values());
  }

  /**
   * Sweeps nodes for stale heartbeats.
   */
  livenessSweep(staleThresholdMs: number = DEFAULT_HEARTBEAT_TIMEOUT_MS): string[] {
    const now = Date.now();
    const staleIds: string[] = [];

    for (const node of this.nodes.values()) {
      if (node.state === "running") {
        const lastHb = new Date(node.lastHeartbeat).getTime();
        if (now - lastHb > staleThresholdMs) {
          node.state = "errored";
          node.error = `Heartbeat timeout: no activity for ${Math.round((now - lastHb) / 1000)}s`;
          node.completedAt = new Date().toISOString();
          staleIds.push(node.id);
        }
      }
    }

    return staleIds;
  }

  /**
   * Cleans up node from index when aborted.
   */
  unregister(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    if (node.parentId) {
      const set = this.parentToChildren.get(node.parentId);
      if (set) set.delete(id);
    }

    const archSet = this.archetypeIndex.get(node.archetype);
    if (archSet) archSet.delete(id);

    return this.nodes.delete(id);
  }
}
