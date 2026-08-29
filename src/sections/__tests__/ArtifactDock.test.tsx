// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactDock } from "@/sections/ArtifactDock";
import type { ArtifactMetadata } from "@/types/artifacts";

afterEach(cleanup);

const sampleArtifacts: ArtifactMetadata[] = [
  {
    id: "art-diff-1",
    name: "auth-service.ts (Diff)",
    format: "diff",
    originalContent: "const auth = false;\nexport function check() {\n  return auth;\n}",
    content: "const auth = true;\nexport function check() {\n  return auth;\n}",
    timestamp: Date.now(),
    requestFeedback: true,
    feedbackPrompt: "Review auth changes",
    summary: "Refactored auth flag",
    revision: 1,
  },
  {
    id: "art-md-1",
    name: "Architecture.md",
    format: "markdown",
    content: "# System Architecture\n\n> [!NOTE]\n> Core platform layers\n\n- [x] Protocol package\n- [ ] Multi-agent coordinator",
    timestamp: Date.now(),
    summary: "System design specs",
    revision: 2,
  },
  {
    id: "art-html-1",
    name: "Preview.html",
    format: "html",
    content: "<div class='text-center p-4 font-bold'>Hello NanoForge</div>",
    timestamp: Date.now(),
  },
];

describe("ArtifactDock", () => {
  it("labels the dock and exposes tab and copy affordances", () => {
    render(<ArtifactDock artifacts={sampleArtifacts} activeArtifactId="art-diff-1" />);

    expect(screen.getByRole("tablist", { name: "Artifacts" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Open artifact auth-service.ts (Diff)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "Copy artifact content" })).toBeInTheDocument();
    expect(screen.getByText("3")).toHaveAttribute("aria-label", "3 artifacts");
  });

  it("renders a clear empty state when no artifacts are available", () => {
    render(<ArtifactDock artifacts={[]} />);

    expect(screen.getByText("No artifact selected")).toBeInTheDocument();
    expect(screen.getByText("Select an artifact tab to preview its contents.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy artifact content" })).toBeDisabled();
  });

  it("renders tabs and displays the active artifact", () => {
    render(<ArtifactDock artifacts={sampleArtifacts} activeArtifactId="art-diff-1" />);

    expect(screen.getAllByText("auth-service.ts (Diff)").length).toBeGreaterThan(0);
    expect(screen.getByText("Architecture.md")).toBeInTheDocument();
    expect(screen.getByText("Preview.html")).toBeInTheDocument();
    expect(screen.getByText("Refactored auth flag")).toBeInTheDocument();
  });

  it("switches active artifact on tab click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ArtifactDock
        artifacts={sampleArtifacts}
        activeArtifactId="art-diff-1"
        onSelectArtifact={onSelect}
      />
    );

    const mdTab = screen.getByText("Architecture.md");
    await user.click(mdTab);
    expect(onSelect).toHaveBeenCalledWith("art-md-1");
  });

  it("submits feedback when accepting an artifact", async () => {
    const user = userEvent.setup();
    const onFeedback = vi.fn();
    render(
      <ArtifactDock
        artifacts={sampleArtifacts}
        activeArtifactId="art-diff-1"
        onSendFeedback={onFeedback}
      />
    );

    expect(screen.getByText("Review auth changes")).toBeInTheDocument();
    const acceptBtn = screen.getByRole("button", { name: /accept artifact/i });
    await user.click(acceptBtn);

    expect(onFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "art-diff-1",
        decision: "accepted",
      })
    );
  });

  it("submits modifications when requested with comment", async () => {
    const user = userEvent.setup();
    const onFeedback = vi.fn();
    render(
      <ArtifactDock
        artifacts={sampleArtifacts}
        activeArtifactId="art-diff-1"
        onSendFeedback={onFeedback}
      />
    );

    const modifyBtn = screen.getByRole("button", { name: /request modifications/i });
    await user.click(modifyBtn);

    const textarea = screen.getByPlaceholderText(/describe the modifications/i);
    await user.type(textarea, "Please add tests for auth");

    const submitBtn = screen.getByRole("button", { name: /submit modifications/i });
    await user.click(submitBtn);

    expect(onFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "art-diff-1",
        decision: "modified",
        comment: "Please add tests for auth",
      })
    );
  });
});
