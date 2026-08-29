import { describe, expect, it } from "vitest";
import {
  artifactMetadataSchema,
  artifactFeedbackResponseSchema,
  detectArtifactFormat,
  type ArtifactMetadata,
} from "./artifacts";

describe("artifact schemas and format detection", () => {
  it("detects diff format from filename and mimeType", () => {
    expect(detectArtifactFormat("server.patch")).toBe("diff");
    expect(detectArtifactFormat("code.ts", "text/x-diff")).toBe("diff");
  });

  it("detects mermaid format from filename and content headers", () => {
    expect(detectArtifactFormat("arch.mermaid")).toBe("mermaid");
    expect(detectArtifactFormat("arch.txt", undefined, "graph TD\nA-->B")).toBe("mermaid");
    expect(detectArtifactFormat("flow.txt", undefined, "sequenceDiagram\nAlice->Bob: Hi")).toBe("mermaid");
  });

  it("detects markdown, html, image, and json formats", () => {
    expect(detectArtifactFormat("README.md")).toBe("markdown");
    expect(detectArtifactFormat("index.html")).toBe("html");
    expect(detectArtifactFormat("preview.png")).toBe("image");
    expect(detectArtifactFormat("config.json")).toBe("json");
    expect(detectArtifactFormat("script.py")).toBe("code");
  });

  it("validates valid artifact metadata", () => {
    const valid: ArtifactMetadata = {
      id: "art-1",
      name: "auth-service.ts",
      format: "code",
      content: "export const auth = true;",
      timestamp: Date.now(),
      requestFeedback: true,
      feedbackPrompt: "Review this change",
    };
    const parsed = artifactMetadataSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("validates feedback response schemas", () => {
    const feedback = {
      artifactId: "art-1",
      decision: "accepted",
      comment: "Looks great",
      timestamp: new Date().toISOString(),
    };
    const parsed = artifactFeedbackResponseSchema.safeParse(feedback);
    expect(parsed.success).toBe(true);
  });
});
