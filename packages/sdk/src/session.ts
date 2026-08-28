import type { ExecutionPlan } from "@nanoforge/protocol";
import type { NanoForgeClient } from "./client";
import type { RunEvent, SessionOptions, SubmittedPlan, ToolResponse } from "./types";

/**
 * Represents an active agent session in the NanoForge ecosystem.
 */
export class AgentSession {
  public readonly id: string;
  public readonly model?: string;
  public title: string;
  public readonly isolation?: "inherit" | "branch";
  public readonly workspaceRoot?: string;
  private readonly _client: NanoForgeClient;

  constructor(client: NanoForgeClient, options: SessionOptions = {}) {
    this._client = client;
    this.id = options.id || crypto.randomUUID();
    this.model = options.model;
    this.title = options.title || "Agent Session";
    this.isolation = options.isolation || "inherit";
    this.workspaceRoot = options.workspaceRoot;
  }

  /**
   * Submit an execution plan for this session.
   */
  public async submitPlan(plan: SubmittedPlan | ExecutionPlan): Promise<string> {
    return this._client.submitPlan(plan);
  }

  /**
   * Submit a plan and stream the real-time execution events.
   */
  public streamRun(plan: SubmittedPlan | ExecutionPlan): AsyncIterable<RunEvent> {
    return this._client.streamRun(plan);
  }

  /**
   * Pause a running plan execution.
   */
  public async pause(runId: string): Promise<void> {
    await this._client.pauseRun(runId);
  }

  /**
   * Resume a paused plan execution.
   */
  public async resume(runId: string): Promise<void> {
    await this._client.resumeRun(runId);
  }

  /**
   * Cancel an active plan run.
   */
  public async cancel(runId: string, reason?: string): Promise<void> {
    await this._client.cancelRun(runId, reason);
  }

  /**
   * Grant user approval for a pending tool execution.
   */
  public async grantApproval(requestId: string): Promise<void> {
    await this._client.grantApproval(requestId);
  }

  /**
   * Deny user approval for a pending tool execution.
   */
  public async denyApproval(requestId: string, reason?: string): Promise<void> {
    await this._client.denyApproval(requestId, reason);
  }

  /**
   * Respond to a tool execution request.
   */
  public async sendToolResponse(response: ToolResponse): Promise<void> {
    await this._client.sendToolResponse(response.requestId, response.approved, response.reason);
  }
}
