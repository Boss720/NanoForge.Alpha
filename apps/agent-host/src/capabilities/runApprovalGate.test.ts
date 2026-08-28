import { describe, expect, it } from "vitest";
import type { ApprovalRequest } from "../runs/coordinator";
import type { CapabilityAuditRecord } from "./broker";
import { CapabilityBroker } from "./broker";
import { BrokerApprovalGate } from "./runApprovalGate";

const request = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  runId: "run-a",
  stepId: "step-a",
  tool: "terminal.exec",
  request: { kind: "terminal.exec", cwd: "C:\\workspace", executable: "node", args: ["script.js"] },
  reason: "policy requires approval",
  ...overrides,
});

const makeGate = (nowRef: { value: number }, presented: unknown[] = [], audit: CapabilityAuditRecord[] = []) => {
  const broker = new CapabilityBroker({ now: () => nowRef.value, auditSink: (record) => audit.push(record) });
  const gate = new BrokerApprovalGate({
    broker,
    hostInstanceId: "host-a",
    clientSessionId: "session-a",
    workspaceId: "workspace-a",
    workspaceGeneration: 4,
    present: (metadata) => presented.push(metadata),
    ttlMs: 100,
  });
  return { gate, broker, presented, audit };
};

describe("BrokerApprovalGate", () => {
  it("waits for a presented request and grants exactly once", async () => {
    const now = { value: 1_000 };
    const { gate, presented, audit } = makeGate(now);
    const pending = gate.requestApproval(request());
    expect(presented).toHaveLength(1);
    const metadata = presented[0] as Record<string, unknown>;
    expect(metadata.requestId).toEqual(expect.any(String));
    expect(metadata.grantId).toEqual(expect.any(String));
    expect(JSON.stringify(metadata)).not.toContain("script.js");
    expect(metadata).not.toHaveProperty("token");
    expect(metadata).not.toHaveProperty("request");
    expect(metadata).not.toHaveProperty("arguments");
    expect(await gate.resolve(metadata.requestId as string, true)).toBe(true);
    expect(await pending).toEqual({ outcome: "granted" });
    expect(gate.resolve(metadata.requestId as string, true)).toBe(false);
    expect(JSON.stringify(audit)).not.toContain("script.js");
  });

  it("denies, rejects wrong IDs, and revokes the exact pending grant", async () => {
    const { gate, presented, audit } = makeGate({ value: 1_000 });
    const pending = gate.requestApproval(request());
    const metadata = presented[0] as Record<string, unknown>;
    expect(gate.resolve("wrong-request", true)).toBe(false);
    expect(await gate.resolve(metadata.requestId as string, false, "operator denied")).toBe(true);
    expect(await pending).toEqual({ outcome: "denied", reason: "operator denied" });
    expect(audit.some((record) => record.decision === "revoke")).toBe(true);
  });

  it("expires and fail-closes replay or duplicate resolution", async () => {
    const now = { value: 1_000 };
    const { gate, presented } = makeGate(now);
    const pending = gate.requestApproval(request({ timeoutMs: 10 }));
    const requestId = (presented[0] as Record<string, unknown>).requestId as string;
    now.value = 1_011;
    await expect(pending).resolves.toEqual({ outcome: "expired" });
    expect(gate.resolve(requestId, true)).toBe(false);
    expect(gate.resolve(requestId, false)).toBe(false);
  });

  it("binds grants to run, step, tool, and normalized request digest", async () => {
    const now = { value: 1_000 };
    const audit: CapabilityAuditRecord[] = [];
    const { gate, presented } = makeGate(now, [], audit);
    const first = gate.requestApproval(request());
    const second = gate.requestApproval(request({ runId: "run-b", stepId: "step-b", tool: "other.tool", request: { kind: "terminal.exec", cwd: "C:\\workspace", executable: "node", args: ["other.js"] } }));
    const firstId = (presented[0] as Record<string, unknown>).requestId as string;
    const secondId = (presented[1] as Record<string, unknown>).requestId as string;
    expect(audit).toHaveLength(0);
    expect(await gate.resolve(firstId, true)).toBe(true);
    expect(await gate.resolve(secondId, true)).toBe(true);
    await expect(first).resolves.toEqual({ outcome: "granted" });
    await expect(second).resolves.toEqual({ outcome: "granted" });
    const allows = audit.filter((record) => record.decision === "allow");
    expect(allows).toHaveLength(2);
    expect(allows[0].binding.runId).not.toBe(allows[1].binding.runId);
    expect(allows[0].binding.stepId).not.toBe(allows[1].binding.stepId);
    expect(allows[0].binding.toolId).not.toBe(allows[1].binding.toolId);
    expect(allows[0].binding.argsDigest).not.toBe(allows[1].binding.argsDigest);
  });

  it("revokes all pending approvals on dispose", async () => {
    const { gate, presented, audit } = makeGate({ value: 1_000 });
    const pending = gate.requestApproval(request());
    expect(gate.dispose()).toBe(1);
    await expect(pending).resolves.toEqual({ outcome: "denied", reason: "approval gate disposed" });
    expect(gate.resolve((presented[0] as Record<string, unknown>).requestId as string, true)).toBe(false);
    expect(audit.some((record) => record.decision === "revoke")).toBe(true);
  });
});
