import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CapabilityBroker,
  digestArguments,
  type CapabilityAuditRecord,
  type CapabilityBinding,
} from "./broker";

const binding: CapabilityBinding = {
  hostInstanceId: "host-a",
  clientSessionId: "session-a",
  workspaceId: "workspace-opaque",
  workspaceGeneration: 3,
  runId: "run-a",
  stepId: "step-a",
  toolId: "tool.read",
  argsDigest: digestArguments({ path: "README.md", nested: [2, 1] }),
  scope: "workspace.read",
};

const context = { ...binding };
const makeBroker = (now = 1_000): { broker: CapabilityBroker; audit: CapabilityAuditRecord[] } => {
  const audit: CapabilityAuditRecord[] = [];
  return { broker: new CapabilityBroker({ now: () => now, auditSink: (record) => audit.push(record) }), audit };
};

describe("CapabilityBroker", () => {
  it("issues and consumes a single-use grant, then rejects replay", () => {
    const { broker, audit } = makeBroker();
    const issued = broker.issue({ binding, ttlMs: 100 });
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(JSON.stringify(issued)).not.toContain("secret");
    expect(broker.consume(issued.token, context)).toMatchObject({ allowed: true, remainingUses: 0 });
    expect(broker.consume(issued.token, context)).toMatchObject({ allowed: false, reason: "replayed" });
    expect(audit.map((item) => item.decision)).toEqual(["allow", "deny"]);
    expect(audit[1].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(audit)).not.toContain(issued.token);
  });

  it("fails closed for every binding mismatch and scope mismatch", () => {
    const { broker } = makeBroker();
    const token = broker.issue({ binding, ttlMs: 100, maxUses: 2 }).token;
    for (const change of [
      { clientSessionId: "other" },
      { workspaceId: "other" },
      { workspaceGeneration: 4 },
      { argsDigest: createHash("sha256").update("other").digest("hex") },
      { scope: "workspace.write" },
    ]) {
      expect(broker.consume(token, { ...context, ...change })).toMatchObject({ allowed: false, reason: "binding_mismatch" });
    }
  });

  it("rejects expired and revoked grants, while allowing multi-use grants", () => {
    let now = 1_000;
    const audit: CapabilityAuditRecord[] = [];
    const broker = new CapabilityBroker({ now: () => now, auditSink: (record) => audit.push(record) });
    const multi = broker.issue({ binding, ttlMs: 100, maxUses: 2 });
    expect(broker.consume(multi.token, context).allowed).toBe(true);
    expect(broker.consume(multi.token, context).allowed).toBe(true);
    expect(broker.consume(multi.token, context)).toMatchObject({ allowed: false, reason: "replayed" });
    const expiring = broker.issue({ binding, ttlMs: 10 });
    now = 1_011;
    expect(broker.consume(expiring.token, context)).toMatchObject({ allowed: false, reason: "expired" });
    const revoked = broker.issue({ binding, ttlMs: 100 });
    expect(broker.revoke(revoked.token)).toBe(true);
    expect(broker.consume(revoked.token, context)).toMatchObject({ allowed: false, reason: "revoked" });
    expect(audit.some((item) => item.reason === "expired")).toBe(true);
  });
});
