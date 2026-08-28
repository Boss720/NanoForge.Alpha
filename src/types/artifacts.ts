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
  originalContent?: string;
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

export interface ArtifactDockTab {
  id: string;
  artifactId: string;
  title: string;
  format: string;
}

export interface ArtifactDockState {
  isOpen: boolean;
  activeArtifactId: string | null;
  activeRevisionIndex: number;
  viewMode: "split" | "unified";
  devicePreview: "mobile" | "tablet" | "desktop" | "responsive";
  fullscreen: boolean;
}
