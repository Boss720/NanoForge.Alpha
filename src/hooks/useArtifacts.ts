import { useState, useCallback } from "react";
import type { ArtifactMetadata, ArtifactFeedbackResponse, Patch } from "@/types";

export function useArtifacts(initialArtifacts: ArtifactMetadata[] = []) {
  const [artifacts, setArtifacts] = useState<ArtifactMetadata[]>(initialArtifacts);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(
    initialArtifacts[0]?.id || null
  );
  const [isOpen, setIsOpen] = useState(false);

  const addArtifact = useCallback((art: ArtifactMetadata) => {
    setArtifacts((prev) => {
      const idx = prev.findIndex((a) => a.id === art.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = art;
        return next;
      }
      return [art, ...prev];
    });
    setActiveArtifactId(art.id);
    setIsOpen(true);
  }, []);

  const selectArtifact = useCallback((id: string) => {
    setActiveArtifactId(id);
    setIsOpen(true);
  }, []);

  const openDock = useCallback(() => setIsOpen(true), []);
  const closeDock = useCallback(() => setIsOpen(false), []);
  const toggleDock = useCallback(() => setIsOpen((prev) => !prev), []);

  const handleFeedback = useCallback((response: ArtifactFeedbackResponse) => {
    setArtifacts((prev) =>
      prev.map((art) => {
        if (art.id === response.artifactId) {
          return {
            ...art,
            requestFeedback: false,
            summary: `User ${response.decision}: ${response.comment || "No comment"}`,
          };
        }
        return art;
      })
    );
  }, []);

  // Helper to convert Patch into a diff artifact
  const addPatchArtifact = useCallback((patch: Patch) => {
    const origLines: string[] = [];
    const modLines: string[] = [];

    patch.lines.forEach((l) => {
      if (l.type === "ctx") {
        origLines.push(l.text);
        modLines.push(l.text);
      } else if (l.type === "del") {
        origLines.push(l.text);
      } else if (l.type === "add") {
        modLines.push(l.text);
      }
    });

    const art: ArtifactMetadata = {
      id: `patch-${patch.file.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}`,
      name: `${patch.file} (Patch)`,
      format: "diff",
      originalContent: origLines.join("\n"),
      content: modLines.join("\n"),
      relativePath: patch.file,
      timestamp: Date.now(),
      summary: `Patch with ${patch.lines.filter((l) => l.type === "add").length} additions and ${
        patch.lines.filter((l) => l.type === "del").length
      } deletions`,
      requestFeedback: true,
      feedbackPrompt: `Review and approve changes to ${patch.file}`,
    };

    addArtifact(art);
  }, [addArtifact]);

  return {
    artifacts,
    activeArtifactId,
    isOpen,
    addArtifact,
    addPatchArtifact,
    selectArtifact,
    openDock,
    closeDock,
    toggleDock,
    handleFeedback,
  };
}
