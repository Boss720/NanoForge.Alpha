import { z } from "zod";

const workspaceIdSchema = z.string().min(1).max(128);
const requestIdSchema = z.string().min(1).max(128);
const workspacePathSchema = z.string().min(1).max(4096);
const generationSchema = z.number().int().positive();
const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const displaySafeLabelSchema = z.string().trim().min(1).max(255)
  .regex(/^[^<>:"/\\|?*\x00-\x1F]+$/, "Expected a display-safe workspace label");

export const workspaceCapabilitiesSchema = z.object({
  read: z.boolean(),
  stat: z.boolean(),
  watch: z.boolean(),
  search: z.boolean(),
  git: z.boolean(),
  terminal: z.boolean(),
  subagents: z.boolean(),
  memory: z.boolean(),
  reviewedWrite: z.boolean(),
});
export type WorkspaceCapabilities = z.infer<typeof workspaceCapabilitiesSchema>;

export const workspaceDescriptorSchema = z.object({
  id: workspaceIdSchema,
  name: z.string().min(1).max(255),
  displayPath: workspacePathSchema,
  generation: generationSchema,
  capabilities: workspaceCapabilitiesSchema,
});
export type WorkspaceDescriptor = z.infer<typeof workspaceDescriptorSchema>;

/**
 * Browser-safe workspace identity used by the stable launcher broker.  This is
 * deliberately separate from WorkspaceDescriptor: it never contains a
 * canonical root or a display path, so it is safe to keep in browser state.
 */
export const workspaceControlDescriptorSchema = z.object({
  workspaceId: workspaceIdSchema,
  label: displaySafeLabelSchema,
  generation: generationSchema,
  capabilities: workspaceCapabilitiesSchema,
}).strict();
export type WorkspaceControlDescriptor = z.infer<typeof workspaceControlDescriptorSchema>;

const loopbackWebsocketUrlSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" && (url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}, "Expected a loopback ws:// URL");

/** Ephemeral handoff metadata. Consumers must not persist this object. */
export const workspaceBrokerConnectionSchema = z.object({
  websocketUrl: loopbackWebsocketUrlSchema.optional(),
  port: z.number().int().min(1).max(65535).optional(),
  token: z.string().min(1).max(4096).optional(),
  generation: generationSchema,
}).strict();
export type WorkspaceBrokerConnection = z.infer<typeof workspaceBrokerConnectionSchema>;

const idempotencyKeySchema = z.string().min(1).max(256);
const brokerRequestFields = { requestId: requestIdSchema };

export const workspaceChooseRequestSchema = z.object({
  type: z.literal("workspace.choose"),
  ...brokerRequestFields,
}).strict();
export const workspaceActivateRequestSchema = z.object({
  type: z.literal("workspace.activate"),
  ...brokerRequestFields,
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();
export const workspaceCurrentRequestSchema = z.object({
  type: z.literal("workspace.current"),
  ...brokerRequestFields,
}).strict();
export const workspaceRecentListRequestSchema = z.object({
  type: z.literal("workspace.recent.list"),
  ...brokerRequestFields,
}).strict();
export const workspaceRecentRemoveRequestSchema = z.object({
  type: z.literal("workspace.recent.remove"),
  ...brokerRequestFields,
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();
export const workspaceRecentPinRequestSchema = z.object({
  type: z.literal("workspace.recent.pin"),
  ...brokerRequestFields,
  workspaceId: workspaceIdSchema,
  pinned: z.boolean(),
  idempotencyKey: idempotencyKeySchema,
}).strict();
export const workspaceRevealRequestSchema = z.object({
  type: z.literal("workspace.reveal"),
  ...brokerRequestFields,
  workspaceId: workspaceIdSchema,
  relativePath: z.string().min(1).max(4096),
}).strict();
export const workspaceSwitchStatusRequestSchema = z.object({
  type: z.literal("workspace.switch.status"),
  ...brokerRequestFields,
}).strict();

export const workspaceBrokerRequestSchema = z.discriminatedUnion("type", [
  workspaceChooseRequestSchema,
  workspaceActivateRequestSchema,
  workspaceCurrentRequestSchema,
  workspaceRecentListRequestSchema,
  workspaceRecentRemoveRequestSchema,
  workspaceRecentPinRequestSchema,
  workspaceRevealRequestSchema,
  workspaceSwitchStatusRequestSchema,
]);
export type WorkspaceBrokerRequest = z.infer<typeof workspaceBrokerRequestSchema>;

const workspaceConnectionResultFields = {
  workspace: workspaceControlDescriptorSchema,
  connection: workspaceBrokerConnectionSchema.optional(),
};

export const workspaceChooseResultSchema = z.object({
  type: z.literal("workspace.choose.result"),
  requestId: requestIdSchema,
  ...workspaceConnectionResultFields,
}).strict();
export type WorkspaceChooseResult = z.infer<typeof workspaceChooseResultSchema>;
export const workspaceActivateResultSchema = z.object({
  type: z.literal("workspace.activate.result"),
  requestId: requestIdSchema,
  ...workspaceConnectionResultFields,
}).strict();
export type WorkspaceActivateResult = z.infer<typeof workspaceActivateResultSchema>;
export const workspaceCurrentResultSchema = z.object({
  type: z.literal("workspace.current.result"),
  requestId: requestIdSchema,
  workspace: workspaceControlDescriptorSchema.optional(),
  connection: workspaceBrokerConnectionSchema.optional(),
}).strict();
export type WorkspaceCurrentResult = z.infer<typeof workspaceCurrentResultSchema>;
export const workspaceRecentListResultSchema = z.object({
  type: z.literal("workspace.recent.list.result"),
  requestId: requestIdSchema,
  workspaces: z.array(workspaceControlDescriptorSchema).max(1000),
}).strict();
export type WorkspaceRecentListResult = z.infer<typeof workspaceRecentListResultSchema>;
export const workspaceRecentRemoveResultSchema = z.object({
  type: z.literal("workspace.recent.remove.result"),
  requestId: requestIdSchema,
  workspaceId: workspaceIdSchema,
  removed: z.literal(true),
}).strict();
export type WorkspaceRecentRemoveResult = z.infer<typeof workspaceRecentRemoveResultSchema>;
export const workspaceRecentPinResultSchema = z.object({
  type: z.literal("workspace.recent.pin.result"),
  requestId: requestIdSchema,
  workspace: workspaceControlDescriptorSchema,
  pinned: z.boolean(),
}).strict();
export type WorkspaceRecentPinResult = z.infer<typeof workspaceRecentPinResultSchema>;
export const workspaceRevealResultSchema = z.object({
  type: z.literal("workspace.reveal.result"),
  requestId: requestIdSchema,
  revealed: z.literal(true),
}).strict();
export type WorkspaceRevealResult = z.infer<typeof workspaceRevealResultSchema>;
export const workspaceSwitchStateSchema = z.enum([
  "idle", "choosing", "validating", "preparing", "connecting", "activating", "active", "failed",
]);
export const workspaceSwitchStatusResultSchema = z.object({
  type: z.literal("workspace.switch.status.result"),
  requestId: requestIdSchema,
  state: workspaceSwitchStateSchema,
  workspace: workspaceControlDescriptorSchema.optional(),
  message: z.string().min(1).max(4096).optional(),
}).strict();
export type WorkspaceSwitchStatusResult = z.infer<typeof workspaceSwitchStatusResultSchema>;

export const workspaceBrokerErrorCodeSchema = z.enum([
  "picker_cancelled", "workspace_missing", "workspace_moved", "access_denied", "root_too_broad", "active_work",
  "host_start_failed", "reconnect_failed", "unknown_workspace", "registry_corrupt", "invalid_request",
]);
export type WorkspaceBrokerErrorCode = z.infer<typeof workspaceBrokerErrorCodeSchema>;
export const workspaceBrokerErrorSchema = z.object({
  type: z.literal("workspace.broker.error"),
  requestId: requestIdSchema.optional(),
  code: workspaceBrokerErrorCodeSchema,
  message: z.string().min(1).max(4096),
  recoverable: z.boolean(),
}).strict();

export const workspaceBrokerResponseSchema = z.discriminatedUnion("type", [
  workspaceChooseResultSchema,
  workspaceActivateResultSchema,
  workspaceCurrentResultSchema,
  workspaceRecentListResultSchema,
  workspaceRecentRemoveResultSchema,
  workspaceRecentPinResultSchema,
  workspaceRevealResultSchema,
  workspaceSwitchStatusResultSchema,
  workspaceBrokerErrorSchema,
]);
export type WorkspaceBrokerResponse = z.infer<typeof workspaceBrokerResponseSchema>;

const generationAwareFields = {
  requestId: requestIdSchema,
  generation: generationSchema.optional(),
};

export const workspaceDescribeRequestSchema = z.object({
  type: z.literal("workspace.describe"),
  requestId: requestIdSchema,
});

export const workspaceOpenRequestSchema = z.object({
  type: z.literal("workspace.open"),
  requestId: requestIdSchema,
  path: workspacePathSchema,
  generation: generationSchema,
});

export const workspaceReadDirRequestSchema = z.object({
  type: z.literal("workspace.readDir"),
  ...generationAwareFields,
  path: z.string().max(4096),
});

export const workspaceReadFileRequestSchema = z.object({
  type: z.literal("workspace.readFile"),
  ...generationAwareFields,
  path: workspacePathSchema,
});

export const workspaceWriteRequestSchema = z.object({
  type: z.literal("workspace.writeFile"),
  ...generationAwareFields,
  path: workspacePathSchema,
  content: z.string().max(1024 * 1024),
  expectedSha256: sha256Schema.optional(),
  expectedModified: timestampSchema.optional(),
});

export const workspaceStatRequestSchema = z.object({
  type: z.literal("workspace.stat"),
  ...generationAwareFields,
  path: workspacePathSchema,
});

export const workspaceSearchRequestSchema = z.object({
  type: z.literal("workspace.search"),
  ...generationAwareFields,
  query: z.string().min(1).max(4096),
  options: z.object({
    caseSensitive: z.boolean().optional(),
    includes: z.array(z.string().max(512)).max(64).optional(),
    maxResults: z.number().int().min(1).max(1000).optional(),
  }).optional(),
});

export const workspaceGitStatusRequestSchema = z.object({
  type: z.literal("workspace.gitStatus"),
  ...generationAwareFields,
});

export const workspaceWatchRequestSchema = z.object({
  type: z.literal("workspace.watch"),
  requestId: requestIdSchema.optional(),
  generation: generationSchema.optional(),
  enabled: z.boolean(),
});

export const workspaceUnwatchRequestSchema = z.object({
  type: z.literal("workspace.unwatch"),
  ...generationAwareFields,
});

export const workspaceClientRequestSchema = z.discriminatedUnion("type", [
  workspaceDescribeRequestSchema,
  workspaceOpenRequestSchema,
  workspaceReadDirRequestSchema,
  workspaceReadFileRequestSchema,
  workspaceWriteRequestSchema,
  workspaceStatRequestSchema,
  workspaceSearchRequestSchema,
  workspaceGitStatusRequestSchema,
  workspaceWatchRequestSchema,
  workspaceUnwatchRequestSchema,
]);
export type WorkspaceClientRequest = z.infer<typeof workspaceClientRequestSchema>;

export const workspaceReadySchema = z.object({
  type: z.literal("workspace.ready"),
  requestId: requestIdSchema.optional(),
  workspace: workspaceDescriptorSchema,
  at: timestampSchema,
});

export const workspaceErrorCodeSchema = z.enum([
  "invalid_path",
  "not_found",
  "not_directory",
  "permission_denied",
  "root_too_broad",
  "stale_generation",
  "active_work",
  "reconnect_required",
  "path_outside_workspace",
  "file_too_large",
  "binary_file",
  "write_conflict",
  "write_not_approved",
  "invalid_search",
  "io_error",
]);
export type WorkspaceErrorCode = z.infer<typeof workspaceErrorCodeSchema>;

export const workspaceErrorSchema = z.object({
  type: z.literal("workspace.error"),
  requestId: requestIdSchema.optional(),
  code: workspaceErrorCodeSchema,
  message: z.string().min(1).max(4096),
  generation: generationSchema,
  recoverable: z.boolean(),
  requestedWorkspace: workspaceDescriptorSchema.optional(),
  at: timestampSchema,
});

export const workspaceWatchResultSchema = z.object({
  type: z.literal("workspace.watch.result"),
  requestId: requestIdSchema.optional(),
  enabled: z.boolean(),
  generation: generationSchema,
});

export const workspaceWriteResultSchema = z.object({
  type: z.literal("workspace.writeFile.result"),
  requestId: requestIdSchema,
  path: z.string(),
  success: z.literal(true),
  generation: generationSchema,
  sha256: sha256Schema,
  size: z.number().int().nonnegative(),
  modified: timestampSchema,
});

export type WorkspaceOpenRequest = z.infer<typeof workspaceOpenRequestSchema>;
export type WorkspaceReady = z.infer<typeof workspaceReadySchema>;
export type WorkspaceError = z.infer<typeof workspaceErrorSchema>;
export type WorkspaceWriteRequest = z.infer<typeof workspaceWriteRequestSchema>;
export type WorkspaceWriteResult = z.infer<typeof workspaceWriteResultSchema>;

export const NON_RETRYABLE_WORKSPACE_ERROR_CODES: ReadonlySet<string> = new Set([
  "permission_denied",
  "access_denied",
  "root_too_broad",
  "workspace_missing",
  "workspace_moved",
  "not_found",
  "not_directory",
  "invalid_path",
  "binary_file",
  "file_too_large",
  "write_not_approved",
  "unknown_workspace",
]);

export function isNonRetryableWorkspaceErrorCode(code: string): boolean {
  return NON_RETRYABLE_WORKSPACE_ERROR_CODES.has(code);
}

export function isNonRetryableError(error: unknown): boolean {
  if (typeof error === "string") return isNonRetryableWorkspaceErrorCode(error);
  if (typeof error === "object" && error !== null) {
    if ("code" in error && typeof (error as { code: unknown }).code === "string") {
      if (isNonRetryableWorkspaceErrorCode((error as { code: string }).code)) return true;
    }
    if ("message" in error && typeof (error as { message: unknown }).message === "string") {
      const msg = (error as { message: string }).message.toLowerCase();
      return (
        msg.includes("permission denied") ||
        msg.includes("access denied") ||
        msg.includes("eacces") ||
        msg.includes("eperm") ||
        msg.includes("too broad") ||
        msg.includes("root_too_broad") ||
        msg.includes("missing") ||
        msg.includes("workspace_missing") ||
        msg.includes("workspace_moved") ||
        msg.includes("not a directory") ||
        msg.includes("not found") ||
        msg.includes("invalid_path") ||
        msg.includes("unknown_workspace")
      );
    }
  }
  return false;
}
