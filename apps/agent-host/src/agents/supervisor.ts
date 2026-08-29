/**
 * Subagent Supervisor.
 *
 * Top-level coordinator integrating:
 * - Subagent Registry & Hierarchy Management (Depth <= 3, Concurrency <= 8)
 * - Actor Mailbox & SEC-SUB-03 Authorization Checks
 * - Zero-Polling Reactive Wakeup Engine
 * - Workspace Isolation (Inherit, Branch with Git worktrees, Share with scratch)
 * - Token Budget Metering (SEC-SUB-04)
 * - 5-Rung Resilient Failure Escalation Ladder (Retry -> Replace -> Skip -> Redistribute -> Degrade)
 * - Wire Protocol Lifecycle Events
 * - Cross-Agent Shared Memory Engine
 * - Token & Latency Telemetry Tracking
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  SUBAGENT_ERROR_CODES,
  invokeSubagentParamsSchema,
  type InvokeSubagentParams,
  type InvokeSubagentResult,
  manageSubagentsParamsSchema,
  type ManageSubagentsParams,
  type ManageSubagentsResult,
  manageSubagentsInspectFileSchema,
  validateSubagentName,
  sendMessageParamsSchema,
  type SendMessageParams,
  type SendMessageResult,
  defineSubagentParamsSchema,
  type DefineSubagentParams,
  type DefineSubagentResult,
  type SubagentInfo,
  type SubagentMessage,
  type SubagentLifecycleEvent,
  type SubagentTelemetry,
  createSubagentMessage,
} from "@protocol/subagents";
import type { z } from "zod";

export type InvokeSubagentInput = z.input<typeof invokeSubagentParamsSchema>;
export type SendMessageInput = z.input<typeof sendMessageParamsSchema>;
import { sanitizePathString, isWithinWorkspace } from "../policy/policy.js";
import { createWorktree, pruneWorktree } from "../workspace/gitWorktree.js";
import { SubagentRegistry } from "./registry.js";
import { SubagentMailbox } from "./mailbox.js";
import { ReactiveWakeupEngine } from "./wakeup.js";
import { HierarchyManager } from "./hierarchy.js";
import { DaemonSupervisor } from "../daemons/supervisor.js";
import { TaskScheduler } from "../daemons/scheduler.js";
import { SharedMemoryEngine } from "./memory.js";
import { TelemetryTracker, type TurnMetricsInput } from "./telemetry.js";
import type { EscalationDecision, EscalationRung, SubagentNode } from "./types.js";
import { digestArguments } from "../capabilities/broker.js";

export type SubagentMutationOperation = "spawn" | "kill" | "pause" | "resume" | "send_message" | "define";

export interface SubagentMutationAuthorizationContext {
  readonly operation: SubagentMutationOperation;
  readonly actorId?: string;
  readonly targetId?: string;
  /** Digest only; request values (including prompts and message bodies) are never retained. */
  readonly requestDigest: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export type AuthorizeSubagentMutation = (
  context: SubagentMutationAuthorizationContext,
) => boolean | Promise<boolean>;

const safeSubagentId = (value: string | undefined): string | undefined =>
  value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;

export interface SubagentSupervisorOptions {
  workspaceRoot?: string;
  registry?: SubagentRegistry;
  mailbox?: SubagentMailbox;
  wakeupEngine?: ReactiveWakeupEngine;
  hierarchyManager?: HierarchyManager;
  daemonSupervisor?: DaemonSupervisor;
  scheduler?: TaskScheduler;
  memoryEngine?: SharedMemoryEngine;
  telemetryTracker?: TelemetryTracker;
  /** When enabled, every side-effectful subagent operation requires this callback to grant it. */
  enforceMutationAuthorization?: boolean;
  authorizeMutation?: AuthorizeSubagentMutation;
}

export class SubagentSupervisor extends EventEmitter {
  readonly workspaceRoot: string;
  readonly registry: SubagentRegistry;
  readonly mailbox: SubagentMailbox;
  readonly wakeup: ReactiveWakeupEngine;
  readonly hierarchy: HierarchyManager;
  readonly daemons: DaemonSupervisor;
  readonly scheduler: TaskScheduler;
  readonly memory: SharedMemoryEngine;
  readonly telemetry: TelemetryTracker;
  private readonly unsubDaemons?: () => void;
  private readonly unsubScheduler?: () => void;
  private readonly enforceMutationAuthorization: boolean;
  private readonly authorizeMutation?: AuthorizeSubagentMutation;

  constructor(options: SubagentSupervisorOptions = {}) {
    super();
    this.setMaxListeners(100);
    this.workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    this.registry = options.registry ?? new SubagentRegistry();
    this.mailbox = options.mailbox ?? new SubagentMailbox();
    this.wakeup = options.wakeupEngine ?? new ReactiveWakeupEngine();
    this.hierarchy = options.hierarchyManager ?? new HierarchyManager();
    this.daemons = options.daemonSupervisor ?? new DaemonSupervisor();
    this.scheduler = options.scheduler ?? new TaskScheduler();
    this.memory = options.memoryEngine ?? new SharedMemoryEngine({ workspaceRoot: this.workspaceRoot });
    this.telemetry = options.telemetryTracker ?? new TelemetryTracker();
    this.enforceMutationAuthorization = options.enforceMutationAuthorization ?? false;
    this.authorizeMutation = options.authorizeMutation;

    // Forward daemon output/completion to wakeups
    this.unsubDaemons = this.daemons.subscribe((event) => {
      if (event.type === "task.completed") {
        this.wakeup.wakeOnTaskCompleted(
          event.taskId,
          event.exitCode,
          `Task finished in ${event.durationMs}ms`
        );
      }
    });

    // Forward scheduler trigger to wakeups
    this.unsubScheduler = this.scheduler.subscribe((event) => {
      if (event.type === "schedule.triggered") {
        this.wakeup.wakeOnTimerExpired(event.scheduleId, event.prompt);
      }
    });
  }

  /**
   * Spawns a supervised child agent under the hierarchy.
   */
  async spawnSubagent(
    rawParams: InvokeSubagentInput,
    parentId?: string
  ): Promise<InvokeSubagentResult> {
    const params = invokeSubagentParamsSchema.parse(rawParams);
    await this.requireMutationAuthorization("spawn", {
      actorId: parentId,
      request: params,
      metadata: {
        archetype: params.archetype,
        isolation: params.workspaceIsolation ?? "inherit",
      },
    });

    // 1. Validate hierarchy constraints (Depth <= 3, Active <= 8)
    this.hierarchy.validateSpawn(parentId, this.registry);

    const subagentId = randomUUID();
    const shortId = subagentId.slice(0, 8);
    const archetype = params.archetype;
    let name: string;
    if (params.name && params.name.trim()) {
      const candidateName = params.name.trim();
      if (!validateSubagentName(candidateName)) {
        throw new Error(
          `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INVALID_CONFIG}: Invalid subagent name '${candidateName}'. Subagent names must only contain alphanumeric characters, underscores, and hyphens (1-64 characters).`
        );
      }
      name = candidateName;
    } else {
      name = `${archetype}_${shortId}`;
    }

    const isolationMode = params.workspaceIsolation ?? "inherit";
    const startedAt = new Date().toISOString();

    // 2. Setup assigned metadata folder in .agents/<name>_<shortId>/
    const metadataDirName = path.posix.join(".agents", `${name}_${shortId}`);
    const agentsBaseDir = path.resolve(this.workspaceRoot, ".agents");
    const absoluteMetadataDir = path.resolve(this.workspaceRoot, metadataDirName);

    // Confinement checks
    const relMetadataDir = path.relative(agentsBaseDir, absoluteMetadataDir);
    if (relMetadataDir.startsWith("..") || path.isAbsolute(relMetadataDir) || relMetadataDir === "") {
      throw new Error(
        `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INVALID_CONFIG}: Subagent metadata directory '${metadataDirName}' escapes the .agents boundary.`
      );
    }

    if (!isWithinWorkspace(absoluteMetadataDir, this.workspaceRoot)) {
      throw new Error(
        `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INVALID_CONFIG}: Subagent metadata directory '${metadataDirName}' escapes workspace root.`
      );
    }

    await fs.mkdir(absoluteMetadataDir, { recursive: true });

    // 3. Write initial agent scaffolding (BRIEFING.md, progress.md, DISPATCH.md)
    await fs.writeFile(
      path.join(absoluteMetadataDir, "DISPATCH.md"),
      `## ${startedAt}\n\nAgent Name: ${name}\nArchetype: ${archetype}\nRoles: ${params.roles.join(", ")}\nParent ID: ${parentId ?? "root"}\n\nPrompt:\n${params.prompt}\n`,
      "utf8"
    );

    await fs.writeFile(
      path.join(absoluteMetadataDir, "BRIEFING.md"),
      `# BRIEFING — ${startedAt}\n\n## Mission\n${params.prompt.slice(0, 200)}\n\n## 🔒 My Identity\n- Archetype: ${archetype}\n- Subagent ID: ${subagentId}\n- Parent ID: ${parentId ?? "none"}\n- Working Directory: ${metadataDirName}\n`,
      "utf8"
    );

    await fs.writeFile(
      path.join(absoluteMetadataDir, "progress.md"),
      `# Progress Log — ${name}\n\nLast visited: ${startedAt}\n\n- [ ] Task initialized\n`,
      "utf8"
    );

    // 4. Handle workspace isolation modes
    let worktreePath: string | undefined;
    let scratchDir: string | undefined;
    let assignedWorkspaceRoot = this.workspaceRoot;
    let publicWorkingDirectory = ".";

    if (isolationMode === "branch") {
      const relWorktree = `.agents/worktrees/${shortId}`;
      const branchName = `nano/${shortId}`;
      const worktreeResult = await createWorktree(this.workspaceRoot, relWorktree, branchName);
      if (!worktreeResult.success) {
        throw new Error(`Failed to initialize git worktree for subagent: ${worktreeResult.error}`);
      }
      if (!isWithinWorkspace(worktreeResult.worktreePath, this.workspaceRoot)) {
        throw new Error(`${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INVALID_CONFIG}: Subagent worktree escapes workspace root.`);
      }
      worktreePath = relWorktree;
      assignedWorkspaceRoot = worktreeResult.worktreePath;
      publicWorkingDirectory = relWorktree;
    } else if (isolationMode === "share") {
      scratchDir = `.agents/scratch_${shortId}`;
      await fs.mkdir(path.resolve(this.workspaceRoot, scratchDir), { recursive: true });
    }

    // 5. Initialize telemetry tracking
    this.telemetry.initAgent(subagentId, startedAt);
    const initialTelemetry = this.telemetry.getTelemetry(subagentId);

    // 6. Create SubagentNode
    const node: SubagentNode = {
      id: subagentId,
      parentId: parentId ?? null,
      name,
      archetype,
      roles: params.roles ?? [],
      systemPrompt: params.prompt,
      model: params.model,
      assignedWorkspaceRoot,
      workingDirectory: publicWorkingDirectory,
      metadataDir: metadataDirName,
      worktreePath,
      scratchDir,
      isolationMode,
      allowedTools: params.allowedTools,
      allowedToolKinds: params.allowedToolKinds,
      budgetTokens: params.budgetTokens,
      tokensUsed: 0,
      turnCount: 0,
      telemetry: initialTelemetry,
      state: "running",
      startedAt,
      lastHeartbeat: startedAt,
      abortController: new AbortController(),
      skills: params.skills ?? [],
    };

    this.registry.register(node);

    // 7. Emit wire lifecycle events
    const summary = this.registry.getSummary(subagentId)!;
    this.emitLifecycleEvent({
      type: "subagent.spawned",
      subagent: summary,
      at: startedAt,
    });

    this.emitTreeUpdated();

    return {
      subagentId,
      name,
      archetype,
      workingDirectory: publicWorkingDirectory,
      state: "running",
      startedAt,
    };
  }

  /**
   * Manages, pauses, resumes, kills, inspects, or lists child subagents.
   */
  async manageSubagents(
    params: ManageSubagentsParams,
    callerId?: string
  ): Promise<ManageSubagentsResult> {
    switch (params.action) {
      case "list": {
        const allNodes = this.registry.getAll();
        const subagents = allNodes
          .filter((n) => !callerId || n.parentId === callerId || n.id === callerId)
          .map((n) => this.registry.getSummary(n.id)!);

        return {
          action: "list",
          subagents,
          success: true,
          message: `Retrieved ${subagents.length} subagents`,
        };
      }

      case "status": {
        if (!params.subagentId) {
          return { action: "status", success: false, message: "Missing subagentId" };
        }
        const detail = this.registry.getSummary(params.subagentId);
        if (!detail) {
          return {
            action: "status",
            success: false,
            message: `Subagent not found: ${params.subagentId}`,
          };
        }
        return { action: "status", detail, success: true };
      }

      case "kill": {
        if (!params.subagentId) {
          return { action: "kill", success: false, message: "Missing subagentId" };
        }
        if (!(await this.isMutationAuthorized("kill", { actorId: callerId, targetId: params.subagentId, request: params }))) {
          return { action: "kill", success: false, message: "Subagent mutation denied" };
        }
        const killed = await this.hierarchy.killTree(params.subagentId, this.registry, {
          workspaceRoot: this.workspaceRoot,
          daemonSupervisor: this.daemons,
          scheduler: this.scheduler,
          reason: "Killed by manage_subagents request",
        });

        // Notify scheduler of sender terminations
        for (const kId of killed) {
          this.scheduler.notifySenderDied(kId);
        }

        this.emitTreeUpdated();

        return {
          action: "kill",
          success: true,
          message: `Killed subagent tree (${killed.length} agents terminated)`,
        };
      }

      case "pause": {
        if (!params.subagentId) {
          return { action: "pause", success: false, message: "Missing subagentId" };
        }
        if (!(await this.isMutationAuthorized("pause", { actorId: callerId, targetId: params.subagentId, request: params }))) {
          return { action: "pause", success: false, message: "Subagent mutation denied" };
        }
        const node = this.registry.get(params.subagentId);
        if (!node) {
          return { action: "pause", success: false, message: `Subagent not found: ${params.subagentId}` };
        }
        this.registry.updateState(params.subagentId, "idle", "Paused by supervisor");
        this.emitLifecycleEvent({
          type: "subagent.state_changed",
          subagentId: params.subagentId,
          previousState: node.state,
          newState: "idle",
          reason: "Paused by supervisor",
          at: new Date().toISOString(),
        });
        return { action: "pause", success: true, message: `Subagent ${params.subagentId} paused` };
      }

      case "resume": {
        if (!params.subagentId) {
          return { action: "resume", success: false, message: "Missing subagentId" };
        }
        if (!(await this.isMutationAuthorized("resume", { actorId: callerId, targetId: params.subagentId, request: params }))) {
          return { action: "resume", success: false, message: "Subagent mutation denied" };
        }
        const node = this.registry.get(params.subagentId);
        if (!node) {
          return { action: "resume", success: false, message: `Subagent not found: ${params.subagentId}` };
        }
        this.registry.updateState(params.subagentId, "running", "Resumed by supervisor");
        this.emitLifecycleEvent({
          type: "subagent.state_changed",
          subagentId: params.subagentId,
          previousState: node.state,
          newState: "running",
          reason: "Resumed by supervisor",
          at: new Date().toISOString(),
        });
        return { action: "resume", success: true, message: `Subagent ${params.subagentId} resumed` };
      }

      case "inspect": {
        if (!params.subagentId) {
          return { action: "inspect", success: false, message: "Missing subagentId" };
        }
        const node = this.registry.get(params.subagentId);
        if (!node) {
          return { action: "inspect", success: false, message: `Subagent not found: ${params.subagentId}` };
        }

        const fileToRead = params.inspectFile ?? "progress.md";

        // 1. Explicit allowlist check using manageSubagentsInspectFileSchema
        const allowlistParsed = manageSubagentsInspectFileSchema.safeParse(fileToRead);
        if (!allowlistParsed.success) {
          return {
            action: "inspect",
            success: false,
            message: `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INSPECTION_FILE_NOT_FOUND}: Invalid inspection file '${fileToRead}'. Allowed inspection files are: ${manageSubagentsInspectFileSchema.options.join(", ")}`,
          };
        }

        // 2. Multi-pass sanitize against null bytes and URL encoding
        let sanitizedFile: string;
        try {
          sanitizedFile = sanitizePathString(fileToRead);
        } catch (err) {
          return {
            action: "inspect",
            success: false,
            message: `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INSPECTION_FILE_NOT_FOUND}: Invalid file name: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        // 3. Confinement check: Ensure subagent metadata directory is inside .agents
        const agentsBaseDir = path.resolve(this.workspaceRoot, ".agents");
        const subagentDir = path.resolve(this.workspaceRoot, node.metadataDir);
        const relSubagentDir = path.relative(agentsBaseDir, subagentDir);
        if (relSubagentDir.startsWith("..") || path.isAbsolute(relSubagentDir) || relSubagentDir === "") {
          return {
            action: "inspect",
            success: false,
            message: `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INSPECTION_FILE_NOT_FOUND}: Subagent metadata directory '${node.metadataDir}' escapes the .agents boundary`,
          };
        }

        // 4. Confinement check: Ensure target path remains strictly inside subagent metadata directory
        const targetPath = path.resolve(subagentDir, sanitizedFile);
        const relFilePath = path.relative(subagentDir, targetPath);
        if (relFilePath.startsWith("..") || path.isAbsolute(relFilePath) || relFilePath !== sanitizedFile) {
          return {
            action: "inspect",
            success: false,
            message: `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INSPECTION_FILE_NOT_FOUND}: Target file escapes subagent directory: ${sanitizedFile}`,
          };
        }

        // 5. Workspace boundary check
        if (!isWithinWorkspace(targetPath, this.workspaceRoot)) {
          return {
            action: "inspect",
            success: false,
            message: `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INSPECTION_FILE_NOT_FOUND}: Target file is outside workspace: ${targetPath}`,
          };
        }

        try {
          const inspectedContent = await fs.readFile(targetPath, "utf8");
          return {
            action: "inspect",
            detail: this.registry.getSummary(node.id),
            inspectedContent,
            success: true,
          };
        } catch (err) {
          return {
            action: "inspect",
            success: false,
            message: `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_INSPECTION_FILE_NOT_FOUND}: Could not read ${sanitizedFile} for subagent ${node.id}`,
          };
        }
      }

      default:
        return {
          action: params.action,
          success: false,
          message: `Unsupported action: ${String(params.action)}`,
        };
    }
  }

  /**
   * Dispatches an inter-agent mailbox message and triggers a reactive wakeup.
   */
  async sendMessage(rawParams: SendMessageInput, senderId: string): Promise<SendMessageResult> {
    const params = sendMessageParamsSchema.parse(rawParams);
    await this.requireMutationAuthorization("send_message", {
      actorId: senderId,
      targetId: params.recipientId,
      request: params,
    });
    const sender = this.registry.get(senderId);
    const recipient = this.registry.get(params.recipientId);

    if (!recipient) {
      throw new Error(
        `${SUBAGENT_ERROR_CODES.ERR_SUBAGENT_RECIPIENT_NOT_FOUND}: Target recipient subagent "${params.recipientId}" does not exist`
      );
    }

    const message: SubagentMessage = createSubagentMessage({
      senderId,
      senderName: sender?.name ?? "orchestrator",
      recipientId: params.recipientId,
      subject: params.subject,
      body: params.body,
      referencedArtifacts: params.referencedArtifacts,
      priority: params.priority,
    });

    // 1. Enqueue with SEC-SUB-03 verification
    this.mailbox.enqueue(message, this.registry);

    // 2. Trigger reactive zero-polling wakeup
    this.wakeup.wakeOnMessage(message);

    // 3. Notify scheduler of inbound message (cancels matching one-shot timers)
    this.scheduler.notifyMessageReceived(senderId);

    // 4. Emit wire event
    this.emitLifecycleEvent({
      type: "subagent.message_sent",
      message,
      at: message.timestamp,
    });

    return {
      messageId: message.messageId,
      deliveryTimestamp: message.timestamp,
      recipientStatus: recipient.state,
      delivered: true,
    };
  }

  /**
   * Registers a dynamic custom subagent template.
   */
  async defineSubagent(params: DefineSubagentParams): Promise<DefineSubagentResult> {
    await this.requireMutationAuthorization("define", { request: params, metadata: { name: params.name } });
    return this.registry.registerTemplate(params);
  }

  private async requireMutationAuthorization(
    operation: SubagentMutationOperation,
    input: { actorId?: string; targetId?: string; request: unknown; metadata?: Record<string, string | number | boolean> },
  ): Promise<void> {
    if (!(await this.isMutationAuthorized(operation, input))) {
      throw new Error("Subagent mutation denied");
    }
  }

  private async isMutationAuthorized(
    operation: SubagentMutationOperation,
    input: { actorId?: string; targetId?: string; request: unknown; metadata?: Record<string, string | number | boolean> },
  ): Promise<boolean> {
    if (!this.enforceMutationAuthorization) return true;
    const context: SubagentMutationAuthorizationContext = Object.freeze({
      operation,
      ...(safeSubagentId(input.actorId) ? { actorId: safeSubagentId(input.actorId) } : {}),
      ...(safeSubagentId(input.targetId) ? { targetId: safeSubagentId(input.targetId) } : {}),
      requestDigest: digestArguments(input.request),
      metadata: Object.freeze(input.metadata ?? {}),
    });
    try {
      return this.authorizeMutation ? Boolean(await this.authorizeMutation(context)) : false;
    } catch {
      return false;
    }
  }

  /**
   * Records a complete LLM turn with token counts, latencies, and pricing.
   */
  recordTurnTelemetry(subagentId: string, input: TurnMetricsInput): SubagentTelemetry {
    const node = this.registry.get(subagentId);
    const tel = this.telemetry.recordTurn(subagentId, input);

    if (node) {
      node.tokensUsed = tel.totalTokens;
      node.turnCount = tel.turnCount;
      node.telemetry = tel;
      node.lastHeartbeat = new Date().toISOString();

      if (node.budgetTokens && node.tokensUsed >= node.budgetTokens) {
        node.state = "errored";
        node.error = `Token budget limit exceeded (${node.tokensUsed}/${node.budgetTokens})`;
        node.completedAt = new Date().toISOString();

        this.emitLifecycleEvent({
          type: "subagent.errored",
          subagentId,
          error: node.error,
          code: SUBAGENT_ERROR_CODES.ERR_SUBAGENT_BUDGET_EXCEEDED,
          at: node.completedAt,
        });

        // Escalate to Replace rung
        this.escalateFailure(subagentId, node.error, "replace").catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.emitLifecycleEvent({
            type: "subagent.errored",
            subagentId,
            error: `Background escalation failed: ${errorMsg}`,
            code: SUBAGENT_ERROR_CODES.ERR_SUBAGENT_BUDGET_EXCEEDED,
            at: new Date().toISOString(),
          });
        });
      }
    }

    this.emitLifecycleEvent({
      type: "subagent.telemetry_updated",
      subagentId,
      telemetry: tel,
      at: new Date().toISOString(),
    });

    return tel;
  }

  /**
   * Records token usage and enforces token budget limits (SEC-SUB-04).
   */
  recordTokens(subagentId: string, tokens: number): void {
    const node = this.registry.get(subagentId);
    if (!node) return;

    node.tokensUsed += tokens;
    node.turnCount += 1;
    node.lastHeartbeat = new Date().toISOString();

    // If telemetry exists, update it as a simple prompt/completion turn
    const tel = this.telemetry.recordTurn(subagentId, {
      promptTokens: Math.round(tokens * 0.7),
      completionTokens: Math.round(tokens * 0.3),
      turnLatencyMs: 500,
    });
    node.telemetry = tel;

    if (node.budgetTokens && node.tokensUsed >= node.budgetTokens) {
      node.state = "errored";
      node.error = `Token budget limit exceeded (${node.tokensUsed}/${node.budgetTokens})`;
      node.completedAt = new Date().toISOString();

      this.emitLifecycleEvent({
        type: "subagent.errored",
        subagentId,
        error: node.error,
        code: SUBAGENT_ERROR_CODES.ERR_SUBAGENT_BUDGET_EXCEEDED,
        at: node.completedAt,
      });

      // Escalate to Replace rung with safe catch boundary to prevent unhandled promise rejections
      this.escalateFailure(subagentId, node.error, "replace").catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.emitLifecycleEvent({
          type: "subagent.errored",
          subagentId,
          error: `Background escalation failed: ${errorMsg}`,
          code: SUBAGENT_ERROR_CODES.ERR_SUBAGENT_BUDGET_EXCEEDED,
          at: new Date().toISOString(),
        });
      });
    }
  }

  /**
   * 5-Rung Resilient Failure Escalation Ladder:
   * 1. Retry: transient error feedback loop
   * 2. Replace: spawn fresh clone with handoff context
   * 3. Skip: non-blocking step bypass
   * 4. Redistribute: decompose into multiple specialist subagents
   * 5. Degrade: pause DAG and request user intervention
   */
  async escalateFailure(
    subagentId: string,
    error: string,
    preferredRung?: EscalationRung
  ): Promise<EscalationDecision> {
    const node = this.registry.get(subagentId);
    if (!node) {
      return {
        rung: "degrade",
        subagentId,
        reason: "Subagent node not found",
        actionSummary: "Halted",
      };
    }

    const rung: EscalationRung = preferredRung ?? "retry";

    try {
      switch (rung) {
        case "retry": {
          return {
            rung: "retry",
            subagentId,
            reason: error,
            actionSummary: `Retry turn execution with diagnostic error context: "${error.slice(0, 100)}"`,
          };
        }

        case "replace": {
          try {
            // Request partial handoff, kill stalled node, spawn fresh clone
            const cloneResult = await this.spawnSubagent(
              {
                archetype: node.archetype,
                name: `${node.name}_clone`,
                roles: node.roles,
                prompt: `[REPLACEMENT CONTEXT: Previous instance failed with "${error}"]\n\nOriginal prompt:\n${node.systemPrompt ?? ""}`,
                workspaceIsolation: node.isolationMode,
                budgetTokens: node.budgetTokens,
                skills: node.skills,
                model: node.model,
              },
              node.parentId ?? undefined
            );

            // Abort old stalled node
            await this.hierarchy.killTree(subagentId, this.registry, {
              workspaceRoot: this.workspaceRoot,
              daemonSupervisor: this.daemons,
              scheduler: this.scheduler,
              reason: `Replaced by fresh instance ${cloneResult.subagentId}`,
            });

            return {
              rung: "replace",
              subagentId,
              reason: error,
              replacementSubagentId: cloneResult.subagentId,
              actionSummary: `Replaced failed agent ${subagentId} with clone ${cloneResult.subagentId}`,
            };
          } catch (replaceErr: any) {
            const msg = replaceErr instanceof Error ? replaceErr.message : String(replaceErr);
            this.registry.updateState(subagentId, "errored", `Escalation replace failed: ${msg}`);
            return {
              rung: "degrade",
              subagentId,
              reason: `Replacement failed: ${msg}`,
              actionSummary: "Failed to spawn replacement clone; degraded execution DAG.",
            };
          }
        }

        case "skip": {
          return {
            rung: "skip",
            subagentId,
            reason: error,
            actionSummary: `Skipped non-critical step failure: "${error.slice(0, 80)}"`,
          };
        }

        case "redistribute": {
          try {
            // Spawn explorer + implementer split
            const expResult = await this.spawnSubagent(
              {
                archetype: "explorer",
                name: `${node.name}_exp`,
                prompt: `Analyze context for redistributed task:\n${node.systemPrompt ?? ""}`,
              },
              node.parentId ?? undefined
            );

            return {
              rung: "redistribute",
              subagentId,
              reason: error,
              replacementSubagentId: expResult.subagentId,
              actionSummary: `Redistributed task to specialized explorer ${expResult.subagentId}`,
            };
          } catch (redistributeErr: any) {
            const msg =
              redistributeErr instanceof Error ? redistributeErr.message : String(redistributeErr);
            this.registry.updateState(
              subagentId,
              "errored",
              `Escalation redistribute failed: ${msg}`
            );
            return {
              rung: "degrade",
              subagentId,
              reason: `Redistribute failed: ${msg}`,
              actionSummary: "Failed to spawn redistribution agent; degraded execution DAG.",
            };
          }
        }

        case "degrade":
        default: {
          this.registry.updateState(subagentId, "idle", `Degraded: ${error}`);
          return {
            rung: "degrade",
            subagentId,
            reason: error,
            actionSummary: "Halted execution DAG and frozen state for human intervention.",
          };
        }
      }
    } catch (unexpectedErr: any) {
      const msg =
        unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr);
      return {
        rung: "degrade",
        subagentId,
        reason: `Escalation exception: ${msg}`,
        actionSummary: "Escalation failed with unexpected exception; degraded state.",
      };
    }
  }

  /**
   * Subscribes to subagent lifecycle events.
   */
  subscribe(listener: (event: SubagentLifecycleEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }

  /**
   * Gracefully terminates all subagents, cleans git worktrees, and releases all resources.
   */
  async dispose(): Promise<void> {
    for (const node of this.registry.getAll()) {
      if (node.state === "running" || node.state === "idle" || node.state === "waiting_for_input") {
        this.registry.updateState(node.id, "errored", "Host server shutdown");
      }
      if (node.worktreePath) {
        try {
          await pruneWorktree(this.workspaceRoot, node.worktreePath);
        } catch {
          /* ignore */
        }
      }
    }

    try {
      await this.daemons.killAll();
    } catch {
      /* ignore */
    }
    this.unsubDaemons?.();
    this.unsubScheduler?.();
    this.scheduler.dispose();
    this.memory.dispose();
    this.mailbox.clear();
    this.removeAllListeners();
  }

  private emitLifecycleEvent(event: SubagentLifecycleEvent): void {
    this.emit("event", event);
    this.emit(event.type, event);
  }

  private emitTreeUpdated(): void {
    const all = this.registry.getAll().map((n) => this.registry.getSummary(n.id)!);
    const rootId = all[0]?.id ?? randomUUID();
    this.emitLifecycleEvent({
      type: "subagent.tree_updated",
      rootId,
      activeCount: this.registry.getActive().length,
      tree: all,
      at: new Date().toISOString(),
    });
  }
}
