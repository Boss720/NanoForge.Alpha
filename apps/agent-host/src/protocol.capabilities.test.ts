import { describe, expect, it } from "vitest";
import {
  capabilityApprovalDecisionSchema,
  capabilityApprovalRequestSchema,
  capabilityGrantSchema,
  capabilityResultSchema,
} from "./protocol";

const grant = {
  grantId: "grant-01",
  hostId: "host-01",
  sessionId: "session-01",
  workspaceId: "workspace-01",
  generation: 3,
  runId: "run-01",
  stepId: "step-01",
  toolId: "terminal.exec",
  argumentsDigest: `sha256:${"a".repeat(64)}`,
  scope: "execute",
  issuedAt: "2026-08-27T10:00:00.000Z",
  expiresAt: "2026-08-27T10:05:00.000Z",
  uses: "single",
};

const request = {
  type: "capability.approval_required",
  requestId: "approval-01",
  hostId: grant.hostId,
  sessionId: grant.sessionId,
  workspaceId: grant.workspaceId,
  generation: grant.generation,
  runId: grant.runId,
  stepId: grant.stepId,
  toolId: grant.toolId,
  argumentsDigest: grant.argumentsDigest,
  scope: grant.scope,
  expiresAt: grant.expiresAt,
  uses: grant.uses,
  reason: "Terminal command requires approval",
  at: grant.issuedAt,
};

describe("capability approval protocol", () => {
  it("accepts a host-issued grant, approval request, client decision, and host result", () => {
    expect(capabilityGrantSchema.parse(grant)).toEqual(grant);
    expect(capabilityApprovalRequestSchema.parse(request)).toEqual(request);
    expect(
      capabilityApprovalDecisionSchema.parse({
        type: "capability.approval",
        requestId: request.requestId,
        approved: true,
      }),
    ).toEqual({
      type: "capability.approval",
      requestId: request.requestId,
      approved: true,
    });
    expect(
      capabilityApprovalDecisionSchema.parse({
        type: "capability.approval",
        requestId: request.requestId,
        approved: false,
        reason: "User declined terminal access",
      }),
    ).toEqual({
      type: "capability.approval",
      requestId: request.requestId,
      approved: false,
      reason: "User declined terminal access",
    });
    expect(
      capabilityResultSchema.parse({
        type: "capability.result",
        requestId: request.requestId,
        ok: true,
        grant,
        at: grant.issuedAt,
      }),
    ).toMatchObject({ ok: true, grant });
  });

  it("rejects a client decision that injects a grant or binding data", () => {
    expect(
      capabilityApprovalDecisionSchema.safeParse({
        type: "capability.approval",
        requestId: request.requestId,
        approved: true,
        grant,
      }).success,
    ).toBe(false);
    expect(
      capabilityApprovalDecisionSchema.safeParse({
        type: "capability.approval",
        requestId: request.requestId,
        approved: true,
        hostId: grant.hostId,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["missing run binding", { runId: undefined }],
    ["invalid digest", { argumentsDigest: "sha256:not-a-digest" }],
    ["bad scope", { scope: "admin" }],
    ["unexpected key", { extra: true }],
    ["malformed expiry", { expiresAt: "tomorrow" }],
    ["malformed uses", { uses: "forever" }],
  ])("rejects %s", (_name, override) => {
    const candidate = { ...grant, ...override };
    expect(capabilityGrantSchema.safeParse(candidate).success).toBe(false);
  });
});
