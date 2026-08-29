// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppContextMenu } from "../AppContextMenu";

afterEach(cleanup);

describe("AppContextMenu", () => {
  it("opens on right-click and exposes shell actions", () => {
    render(
      <AppContextMenu
        sidebarCollapsed={false}
        modelCollapsed={false}
        artifactDockOpen={false}
        activeFile="src/App.tsx"
        onNewChat={vi.fn()}
        onOpenFolder={vi.fn()}
        onToggleSidebar={vi.fn()}
        onToggleModelCatalog={vi.fn()}
        onToggleArtifacts={vi.fn()}
        onResetPanelLayout={vi.fn()}
      >
        <div data-testid="context-target">workspace</div>
      </AppContextMenu>,
    );

    fireEvent.contextMenu(screen.getByTestId("context-target"), { clientX: 20, clientY: 20 });

    expect(screen.getByText("NanoForge workspace")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /New chat/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Hide navigation sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Hide model catalog" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Open artifacts dock" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Copy active file path/ })).toBeInTheDocument();
  });

  it("routes layout actions to the owning shell", () => {
    const onToggleSidebar = vi.fn();
    const onResetPanelLayout = vi.fn();
    render(
      <AppContextMenu
        sidebarCollapsed
        modelCollapsed
        artifactDockOpen
        onNewChat={vi.fn()}
        onOpenFolder={vi.fn()}
        onToggleSidebar={onToggleSidebar}
        onToggleModelCatalog={vi.fn()}
        onToggleArtifacts={vi.fn()}
        onResetPanelLayout={onResetPanelLayout}
      >
        <div data-testid="context-target">workspace</div>
      </AppContextMenu>,
    );

    fireEvent.contextMenu(screen.getByTestId("context-target"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show navigation sidebar" }));
    expect(onToggleSidebar).toHaveBeenCalledOnce();

    fireEvent.contextMenu(screen.getByTestId("context-target"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset panel layout" }));
    expect(onResetPanelLayout).toHaveBeenCalledOnce();
  });
});
