import { randomUUID } from "node:crypto";
import type {
  ApprovalGate,
  ApprovalOutcome,
  ApprovalRequest,
} from "../runs/coordinator";
import {
  CapabilityBroker,
  digestArguments,
  type CapabilityBinding,
} from "./broker";

/** The only information the UI/operator presenter is allowed to receive. */
export interface RunApprovalPresentation {
  readonly requestId: string;
  readonly grantId: string;
  readonly expiresAt: number;
  readonly runId: string;
  readonly stepId: string;
  readonly toolId: string;
  readonly workspaceGeneration: number;
  readonly requestDigest: string;
}

export type RunApprovalPresenter = (metadata: RunApprovalPresentation) => void;

export interface RunApprovalBinding {
  readonly hostInstanceId: string;
  readonly clientSessionId: string;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
}

export interface RunApprovalGateOptions {
  readonly broker: CapabilityBroker;
  readonly binding?: RunApprovalBinding;
  readonly hostInstanceId?: string;
  readonly clientSessionId?: string;
  readonly workspaceId?: string;
  readonly workspaceGeneration?: number;
  readonly scope?: string;
  /** Default single-use grant lifetime, in milliseconds. */
  readonly ttlMs?: number;
  readonly present?: RunApprovalPresenter;
  /** Alias retained for callers that name the callback by its role. */
  readonly presenter?: RunApprovalPresenter;
  readonly onApprovalRequest?: RunApprovalPresenter;
}

interface PendingApproval {
  readonly token: string;
  readonly binding: CapabilityBinding;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly settle: (outcome: ApprovalOutcome) => void;
  settled: boolean;
}

const DEFAULT_TTL_MS = 60_000;
const MAX_TIMER_MS = 2_147_483_647;
const DEFAULT_SCOPE = "run.approval";

function safeReason(reason: string | undefined): string | undefined {
  return reason && reason.length > 0 ? reason : undefined;
}

/**
 * ApprovalGate backed by host-local, single-use capability grants.
 *
 * Raw tool requests and grant tokens are intentionally retained only in this
 * host object. The presenter receives an opaque request/grant identifier and
 * a digest, and `resolve` is the only path that can consume the grant.
 */
export class BrokerApprovalGate implements ApprovalGate {
  private readonly broker: CapabilityBroker;
  private readonly binding: RunApprovalBinding;
  private readonly scope: string;
  private readonly ttlMs: number;
  private readonly present: RunApprovalPresenter;
  private readonly pending = new Map<string, PendingApproval>();
  private disposed = false;

  public constructor(options: RunApprovalGateOptions) {
    const presenter = options.present ?? options.presenter ?? options.onApprovalRequest;
    if (!(options.broker instanceof CapabilityBroker) || typeof presenter !== "function") {
      throw new TypeError("broker and present are required");
    }
    const candidateBinding = options.binding ?? {
      hostInstanceId: options.hostInstanceId,
      clientSessionId: options.clientSessionId,
      workspaceId: options.workspaceId,
      workspaceGeneration: options.workspaceGeneration,
    };
    const hostInstanceId = candidateBinding.hostInstanceId;
    const clientSessionId = candidateBinding.clientSessionId;
    const workspaceId = candidateBinding.workspaceId;
    const workspaceGeneration = candidateBinding.workspaceGeneration;
    if (
      typeof hostInstanceId !== "string" || hostInstanceId.length === 0 ||
      typeof clientSessionId !== "string" || clientSessionId.length === 0 ||
      typeof workspaceId !== "string" || workspaceId.length === 0 ||
      typeof workspaceGeneration !== "number" || !Number.isSafeInteger(workspaceGeneration) || workspaceGeneration < 0
    ) {
      throw new TypeError("invalid approval binding");
    }
    const binding: RunApprovalBinding = {
      hostInstanceId,
      clientSessionId,
      workspaceId,
      workspaceGeneration: workspaceGeneration as number,
    };
    const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TIMER_MS) {
      throw new TypeError("invalid approval ttl");
    }
    this.broker = options.broker;
    this.binding = Object.freeze({ ...binding });
    this.scope = options.scope ?? DEFAULT_SCOPE;
    this.ttlMs = ttlMs;
    this.present = presenter;
  }

  public requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome> {
    if (this.disposed) {
      return Promise.resolve({ outcome: "denied", reason: "approval gate disposed" });
    }

    const ttlMs = request.timeoutMs ?? this.ttlMs;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TIMER_MS) {
      return Promise.resolve({ outcome: "denied", reason: "invalid approval request" });
    }

    let requestDigest: string;
    try {
      // Include the identifying request fields in the digest while relying on
      // digestArguments' stable recursive key ordering for the tool payload.
      requestDigest = digestArguments({
        runId: request.runId,
        stepId: request.stepId,
        tool: request.tool,
        request: request.request,
        reason: request.reason,
      });
    } catch {
      return Promise.resolve({ outcome: "denied", reason: "invalid approval request" });
    }

    const capabilityBinding: CapabilityBinding = {
      ...this.binding,
      runId: request.runId,
      stepId: request.stepId,
      toolId: request.tool,
      argsDigest: requestDigest,
      scope: this.scope,
    };

    let grant;
    try {
      grant = this.broker.issue({ binding: capabilityBinding, ttlMs, maxUses: 1 });
    } catch {
      return Promise.resolve({ outcome: "denied", reason: "invalid approval request" });
    }

    const requestId = randomUUID();
    const approval = new Promise<ApprovalOutcome>((resolve) => {
      const timer = setTimeout(() => this.expire(requestId), ttlMs);
      this.pending.set(requestId, {
        token: grant.token,
        binding: capabilityBinding,
        timer,
        settle: resolve,
        settled: false,
      });
    });

    const metadata = Object.freeze({
      requestId,
      grantId: grant.grantId,
      expiresAt: grant.expiresAt,
      runId: request.runId,
      stepId: request.stepId,
      toolId: request.tool,
      workspaceGeneration: this.binding.workspaceGeneration,
      requestDigest,
    });
    try {
      this.present(metadata);
    } catch {
      this.resolve(requestId, false, "approval presenter failed");
    }
    return approval;
  }

  /** Resolve one opaque request exactly once. Returns false for unknown/replay. */
  public resolve(requestId: string, approved: boolean, reason?: string): boolean {
    if (typeof requestId !== "string") return false;
    const pending = this.pending.get(requestId);
    if (!pending || pending.settled) return false;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.settled = true;

    if (!approved) {
      this.broker.revoke(pending.token);
      pending.settle({ outcome: "denied", reason: safeReason(reason) });
      return true;
    }

    const consumed = this.broker.consume(pending.token, pending.binding);
    if (consumed.allowed) {
      pending.settle({ outcome: "granted" });
    } else if (consumed.reason === "expired") {
      pending.settle({ outcome: "expired" });
    } else {
      pending.settle({ outcome: "denied", reason: `approval ${consumed.reason}` });
    }
    return true;
  }

  /** Revoke one request, or all pending requests when no ID is supplied. */
  public revokePending(requestId?: string, reason = "approval revoked"): number {
    if (requestId !== undefined) {
      return this.resolve(requestId, false, reason) ? 1 : 0;
    }
    const ids = [...this.pending.keys()];
    for (const id of ids) this.resolve(id, false, reason);
    return ids.length;
  }

  /** Stop accepting requests and fail closed for all outstanding approvals. */
  public dispose(reason = "approval gate disposed"): number {
    if (this.disposed) return 0;
    this.disposed = true;
    return this.revokePending(undefined, reason);
  }

  private expire(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending || pending.settled) return;
    this.pending.delete(requestId);
    pending.settled = true;
    clearTimeout(pending.timer);
    // Consume allows the broker to record its explicit expired decision when
    // its clock has advanced; in either case this promise is expired locally.
    const consumed = this.broker.consume(pending.token, pending.binding);
    if (consumed.allowed) this.broker.revoke(pending.token);
    pending.settle({ outcome: "expired" });
  }
}

/** Descriptive alias for callers that prefer the concrete gate name. */
export const RunApprovalGate = BrokerApprovalGate;
