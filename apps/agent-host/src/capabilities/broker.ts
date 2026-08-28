import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface CapabilityBinding {
  readonly hostInstanceId: string;
  readonly clientSessionId: string;
  readonly workspaceId: string;
  readonly workspaceGeneration: number;
  readonly runId: string;
  readonly stepId: string;
  readonly toolId: string;
  /** SHA-256 digest of the canonical tool arguments. */
  readonly argsDigest: string;
  readonly scope: string;
}

export interface CapabilityGrant {
  readonly grantId: string;
  readonly expiresAt: number;
  readonly maxUses: number;
  readonly token: string;
}

export type CapabilityDecisionReason =
  | "allowed"
  | "binding_mismatch"
  | "expired"
  | "replayed"
  | "revoked"
  | "unknown_grant"
  | "invalid_request"
  | "audit_unavailable";

export interface CapabilityAuditRecord {
  readonly at: number;
  readonly grantId: string;
  readonly tokenHash: string;
  readonly decision: "allow" | "deny" | "revoke";
  readonly reason: CapabilityDecisionReason;
  readonly remainingUses?: number;
  readonly binding: CapabilityBinding;
}

export interface CapabilityBrokerOptions {
  readonly now?: () => number;
  readonly auditSink: (record: CapabilityAuditRecord) => void;
}

export interface ConsumeResult {
  readonly allowed: boolean;
  readonly reason: CapabilityDecisionReason;
  readonly grantId?: string;
  readonly remainingUses?: number;
}

interface StoredGrant {
  readonly grantId: string;
  readonly tokenHash: string;
  readonly binding: CapabilityBinding;
  readonly expiresAt: number;
  readonly maxUses: number;
  uses: number;
  revoked: boolean;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const TOKEN_HASH_BYTES = 32;

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function validBinding(binding: CapabilityBinding): boolean {
  return Boolean(binding) &&
    [binding.hostInstanceId, binding.clientSessionId, binding.workspaceId, binding.runId, binding.stepId, binding.toolId, binding.scope]
      .every((value) => typeof value === "string" && value.length > 0 && value.length <= 512) &&
    Number.isSafeInteger(binding.workspaceGeneration) && binding.workspaceGeneration >= 0 &&
    typeof binding.argsDigest === "string" && SHA256_HEX.test(binding.argsDigest);
}

function sameBinding(a: CapabilityBinding, b: CapabilityBinding): boolean {
  return a.hostInstanceId === b.hostInstanceId &&
    a.clientSessionId === b.clientSessionId &&
    a.workspaceId === b.workspaceId &&
    a.workspaceGeneration === b.workspaceGeneration &&
    a.runId === b.runId && a.stepId === b.stepId && a.toolId === b.toolId &&
    a.argsDigest === b.argsDigest && a.scope === b.scope;
}

function cloneBinding(binding: CapabilityBinding): CapabilityBinding {
  return Object.freeze({ ...binding });
}

/** Deterministically hash JSON-compatible arguments without retaining them. */
export function digestArguments(value: unknown): string {
  const canonicalize = (input: unknown): unknown => {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new TypeError("arguments must contain finite numbers");
      return input;
    }
    if (Array.isArray(input)) return input.map(canonicalize);
    if (typeof input === "object") {
      const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
      return Object.fromEntries(entries.map(([key, item]) => [key, canonicalize(item)]));
    }
    throw new TypeError("arguments must be JSON-compatible");
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

export class CapabilityBroker {
  private readonly grants = new Map<string, StoredGrant>();
  private readonly now: () => number;
  private readonly auditSink: (record: CapabilityAuditRecord) => void;

  public constructor(options: CapabilityBrokerOptions) {
    if (typeof options.auditSink !== "function") throw new TypeError("auditSink is required");
    this.now = options.now ?? (() => Date.now());
    this.auditSink = options.auditSink;
  }

  public issue(input: { binding: CapabilityBinding; ttlMs: number; maxUses?: number }): CapabilityGrant {
    const maxUses = input.maxUses ?? 1;
    if (!validBinding(input.binding) || !Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0 ||
      !Number.isSafeInteger(maxUses) || maxUses < 1) throw new TypeError("invalid capability grant request");
    const token = randomBytes(32).toString("base64url");
    const grantId = randomBytes(16).toString("hex");
    const stored: StoredGrant = {
      grantId, tokenHash: tokenHash(token), binding: cloneBinding(input.binding),
      expiresAt: this.now() + input.ttlMs, maxUses, uses: 0, revoked: false,
    };
    this.grants.set(stored.tokenHash, stored);
    return Object.freeze({ grantId, expiresAt: stored.expiresAt, maxUses, token });
  }

  public consume(token: string, context: CapabilityBinding): ConsumeResult {
    const hash = typeof token === "string" ? tokenHash(token) : "";
    const stored = this.find(hash);
    if (!stored) return this.recordUnknown(hash, context, "unknown_grant");
    let reason: CapabilityDecisionReason = "allowed";
    let allowed = true;
    if (stored.revoked) { allowed = false; reason = "revoked"; }
    else if (this.now() >= stored.expiresAt) { allowed = false; reason = "expired"; }
    else if (stored.uses >= stored.maxUses) { allowed = false; reason = "replayed"; }
    else if (!validBinding(context) || !sameBinding(stored.binding, context)) { allowed = false; reason = "binding_mismatch"; }
    const remainingUses = Math.max(0, stored.maxUses - stored.uses - (allowed ? 1 : 0));
    try {
      this.auditSink({ at: this.now(), grantId: stored.grantId, tokenHash: stored.tokenHash, decision: allowed ? "allow" : "deny", reason, remainingUses, binding: stored.binding });
    } catch {
      // A capability decision is not valid unless it is durable. Revoke before
      // returning so a retry cannot dispatch work after an audit outage.
      stored.revoked = true;
      return { allowed: false, reason: "audit_unavailable", grantId: stored.grantId, remainingUses: 0 };
    }
    if (allowed) stored.uses += 1;
    return { allowed, reason, grantId: stored.grantId, remainingUses };
  }

  public revoke(token: string): boolean {
    if (typeof token !== "string") return false;
    const stored = this.find(tokenHash(token));
    if (!stored || stored.revoked) return false;
    stored.revoked = true;
    try {
      this.auditSink({ at: this.now(), grantId: stored.grantId, tokenHash: stored.tokenHash, decision: "revoke", reason: "revoked", binding: stored.binding });
      return true;
    } catch {
      return false;
    }
  }

  private find(hash: string): StoredGrant | undefined {
    const stored = this.grants.get(hash);
    if (!stored || !SHA256_HEX.test(hash)) return undefined;
    // Keep equality explicit so future alternate map implementations cannot accidentally use prefix matches.
    return timingSafeEqual(Buffer.from(stored.tokenHash, "hex"), Buffer.from(hash, "hex")) ? stored : undefined;
  }

  private recordUnknown(hash: string, context: CapabilityBinding, reason: CapabilityDecisionReason): ConsumeResult {
    const safeBinding = validBinding(context)
      ? cloneBinding(context)
      : Object.freeze({ ...(context && typeof context === "object" ? context : {}) } as CapabilityBinding);
    try {
      this.auditSink({ at: this.now(), grantId: "unknown", tokenHash: SHA256_HEX.test(hash) ? hash : "", decision: "deny", reason, binding: safeBinding });
    } catch {
      return { allowed: false, reason: "audit_unavailable" };
    }
    return { allowed: false, reason };
  }
}
