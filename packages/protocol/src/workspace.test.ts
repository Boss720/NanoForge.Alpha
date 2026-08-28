import { describe, expect, it } from "vitest";
import {
  workspaceBrokerConnectionSchema,
  workspaceBrokerRequestSchema,
  workspaceBrokerResponseSchema,
  workspaceControlDescriptorSchema,
  workspaceDescriptorSchema,
  workspaceOpenRequestSchema,
  workspaceReadySchema,
  workspaceErrorSchema,
  workspaceWriteRequestSchema,
  isNonRetryableWorkspaceErrorCode,
  isNonRetryableError,
} from "./workspace";

describe("workspace protocol", () => {
  const descriptor = {
    id: "workspace-0123456789abcdef",
    name: "alpha",
    displayPath: "C:\\projects\\alpha",
    generation: 2,
    capabilities: {
      read: true,
      stat: true,
      watch: true,
      search: true,
      git: true,
      terminal: true,
      subagents: true,
      memory: true,
      reviewedWrite: true,
    },
  };

  it("validates descriptors and ready frames", () => {
    expect(workspaceDescriptorSchema.parse(descriptor)).toEqual(descriptor);
    expect(workspaceReadySchema.parse({
      type: "workspace.ready",
      requestId: "req-1",
      workspace: descriptor,
      at: "2026-08-22T12:00:00.000Z",
    }).workspace.generation).toBe(2);
  });

  it("requires generation-aware open and write requests", () => {
    expect(workspaceOpenRequestSchema.safeParse({
      type: "workspace.open",
      requestId: "req-open",
      path: "C:\\projects\\alpha",
      generation: 1,
    }).success).toBe(true);
    expect(workspaceWriteRequestSchema.safeParse({
      type: "workspace.writeFile",
      requestId: "req-write",
      path: "src/index.ts",
      content: "next",
      generation: 2,
      expectedSha256: "a".repeat(64),
      expectedModified: "2026-08-22T12:00:00.000Z",
    }).success).toBe(true);
  });

  it("carries correlated structured workspace errors", () => {
    const parsed = workspaceErrorSchema.parse({
      type: "workspace.error",
      requestId: "req-2",
      code: "stale_generation",
      message: "Workspace generation is stale",
      generation: 3,
      recoverable: true,
      at: "2026-08-22T12:00:00.000Z",
    });
    expect(parsed.requestId).toBe("req-2");
  });

  describe("launcher workspace broker control frames", () => {
    const controlDescriptor = {
      workspaceId: "workspace-0123456789abcdef",
      label: "alpha",
      generation: 2,
      capabilities: descriptor.capabilities,
    };

    it("accepts opaque, display-safe control descriptors without a root path", () => {
      expect(workspaceControlDescriptorSchema.parse(controlDescriptor)).toEqual(controlDescriptor);
      expect(workspaceControlDescriptorSchema.safeParse({
        ...controlDescriptor,
        rootPath: "C:\\projects\\alpha",
      }).success).toBe(false);
    });

    it("rejects malformed broker control frames", () => {
      expect(workspaceBrokerRequestSchema.safeParse({
        type: "workspace.activate",
        requestId: "request-1",
        workspaceId: "workspace-0123456789abcdef",
      }).success).toBe(false);
      expect(workspaceBrokerResponseSchema.safeParse({
        type: "workspace.current.result",
        requestId: "request-1",
        workspace: { ...controlDescriptor, rootPath: "C:\\projects\\alpha" },
      }).success).toBe(false);
    });

    it("allows loopback connection metadata without treating it as a descriptor field", () => {
      expect(workspaceBrokerConnectionSchema.parse({
        websocketUrl: "ws://127.0.0.1:48123",
        port: 48123,
        token: "ephemeral-token",
        generation: 2,
      }).generation).toBe(2);
      expect(workspaceBrokerConnectionSchema.safeParse({
        websocketUrl: "wss://host.example.test:48123",
        generation: 2,
      }).success).toBe(false);
    });
  });

  describe("non-retryable error classification", () => {
    it("identifies non-retryable error codes", () => {
      expect(isNonRetryableWorkspaceErrorCode("permission_denied")).toBe(true);
      expect(isNonRetryableWorkspaceErrorCode("access_denied")).toBe(true);
      expect(isNonRetryableWorkspaceErrorCode("root_too_broad")).toBe(true);
      expect(isNonRetryableWorkspaceErrorCode("workspace_missing")).toBe(true);
      expect(isNonRetryableWorkspaceErrorCode("workspace_moved")).toBe(true);
      expect(isNonRetryableWorkspaceErrorCode("not_found")).toBe(true);
      expect(isNonRetryableWorkspaceErrorCode("not_directory")).toBe(true);
      expect(isNonRetryableWorkspaceErrorCode("invalid_path")).toBe(true);

      expect(isNonRetryableWorkspaceErrorCode("stale_generation")).toBe(false);
      expect(isNonRetryableWorkspaceErrorCode("reconnect_required")).toBe(false);
      expect(isNonRetryableWorkspaceErrorCode("io_error")).toBe(false);
    });

    it("classifies error objects and strings with isNonRetryableError", () => {
      expect(isNonRetryableError("permission_denied")).toBe(true);
      expect(isNonRetryableError({ code: "root_too_broad" })).toBe(true);
      expect(isNonRetryableError(new Error("EACCES: permission denied, scandir 'C:\\restricted'"))).toBe(true);
      expect(isNonRetryableError(new Error("Selected folder root is too broad"))).toBe(true);
      expect(isNonRetryableError(new Error("The workspace missing on disk"))).toBe(true);
      expect(isNonRetryableError(new Error("Directory not found"))).toBe(true);

      expect(isNonRetryableError("stale_generation")).toBe(false);
      expect(isNonRetryableError(new Error("WebSocket network glitch"))).toBe(false);
      expect(isNonRetryableError(null)).toBe(false);
      expect(isNonRetryableError(123)).toBe(false);
    });
  });
});
