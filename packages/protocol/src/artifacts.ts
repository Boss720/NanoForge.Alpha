import { z } from "zod";

export type ArtifactFormat =
  | "diff"
  | "markdown"
  | "mermaid"
  | "html"
  | "code"
  | "image"
  | "json";

export interface ArtifactFeedbackResponse {
  artifactId: string;
  decision: "accepted" | "modified" | "rejected";
  comment?: string;
  timestamp: string;
}

export interface ArtifactMetadata {
  id: string;
  runId?: string;
  name: string;
  mimeType?: string;
  format: ArtifactFormat;
  content: string;
  originalContent?: string; // For diffs
  relativePath?: string;
  byteLength?: number;
  sha256?: string;
  userFacing?: boolean;
  requestFeedback?: boolean;
  feedbackPrompt?: string;
  summary?: string;
  revision?: number;
  parentArtifactId?: string;
  timestamp: number;
}

export const artifactFormatSchema = z.enum([
  "diff",
  "markdown",
  "mermaid",
  "html",
  "code",
  "image",
  "json",
]);

export const artifactFeedbackResponseSchema = z.object({
  artifactId: z.string(),
  decision: z.enum(["accepted", "modified", "rejected"]),
  comment: z.string().optional(),
  timestamp: z.string(),
});

export const artifactMetadataSchema = z.object({
  id: z.string(),
  runId: z.string().optional(),
  name: z.string(),
  mimeType: z.string().optional(),
  format: artifactFormatSchema,
  content: z.string(),
  originalContent: z.string().optional(),
  relativePath: z.string().optional(),
  byteLength: z.number().optional(),
  sha256: z.string().optional(),
  userFacing: z.boolean().optional(),
  requestFeedback: z.boolean().optional(),
  feedbackPrompt: z.string().optional(),
  summary: z.string().optional(),
  revision: z.number().optional(),
  parentArtifactId: z.string().optional(),
  timestamp: z.number(),
});

export function detectArtifactFormat(name: string, mimeType?: string, content?: string): ArtifactFormat {
  if (name.endsWith(".diff") || name.endsWith(".patch") || (mimeType && mimeType.includes("diff"))) {
    return "diff";
  }
  if (name.endsWith(".mermaid") || name.endsWith(".mmd") || (content && (content.startsWith("graph ") || content.startsWith("sequenceDiagram") || content.startsWith("classDiagram") || content.startsWith("gantt") || content.startsWith("stateDiagram")))) {
    return "mermaid";
  }
  if (name.endsWith(".html") || name.endsWith(".htm") || (mimeType && mimeType.includes("html"))) {
    return "html";
  }
  if (name.endsWith(".md") || name.endsWith(".markdown") || (mimeType && mimeType.includes("markdown"))) {
    return "markdown";
  }
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".svg") || name.endsWith(".webp") || (mimeType && mimeType.startsWith("image/"))) {
    return "image";
  }
  if (name.endsWith(".json") || (mimeType && mimeType.includes("json"))) {
    return "json";
  }
  return "code";
}
