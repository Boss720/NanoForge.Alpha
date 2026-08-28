/**
 * Attachment metadata is deliberately content-free.  Message records are
 * persisted in localStorage, while the corresponding text snapshot lives in
 * the attachment snapshot store (IndexedDB in the browser).
 */
export type AttachmentSource = "upload" | "workspace";

export type AttachmentStatus = "loading" | "ready" | "error" | "stale" | "missing";

export interface ChatAttachment {
  /** Stable per-message attachment id. */
  id: string;
  /** Retained for compatibility with the existing @file mention contract. */
  type: "file";
  source: AttachmentSource;
  name: string;
  /** Workspace-relative only. Absolute filesystem paths are never accepted. */
  relativePath?: string;
  mimeType: string;
  language: string;
  byteSize: number;
  snapshotId: string;
  status: AttachmentStatus;
  error?: string;
  /** Bytes actually included in the most recent model request. */
  includedBytes?: number;
  truncated?: boolean;
}

/** Runtime-only state; `content` and `file` are never copied to Message. */
export interface ChatAttachmentDraft extends ChatAttachment {
  content?: string;
  file?: File;
}

export interface ChatSendInput {
  text: string;
  attachments?: ChatAttachmentDraft[];
}

export interface WorkspaceAttachmentContent {
  content: string;
  mimeType?: string;
  language?: string;
  byteSize?: number;
}

export type WorkspaceAttachmentResolver = (
  relativePath: string,
) => Promise<WorkspaceAttachmentContent>;
