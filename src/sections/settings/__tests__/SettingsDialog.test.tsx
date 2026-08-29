// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "../SettingsDialog";
import type { ConnectionState } from "@/types";

afterEach(cleanup);

describe("SettingsDialog — Unified 5-Group Settings Dialog (R6)", () => {
  const connection: ConnectionState = {
    apiKey: "test-key-123",
    baseUrl: "https://nano-gpt.com/api/v1",
    status: "connected",
    liveModels: true,
  };

  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    connection,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onClearHistory: vi.fn(),
    activeWorkspaceRoot: "/workspace/my-project",
  };

  it("renders 5 structured tab categories and switches between them", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog {...defaultProps} initialTab="provider" />);

    expect(screen.getByTestId("tab-appearance")).toBeInTheDocument();
    expect(screen.getByTestId("tab-accessibility")).toBeInTheDocument();
    expect(screen.getByTestId("tab-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("tab-provider")).toBeInTheDocument();
    expect(screen.getByTestId("tab-advanced")).toBeInTheDocument();

    // Provider is active
    expect(screen.getByDisplayValue("https://nano-gpt.com/api/v1")).toBeInTheDocument();

    // Switch to Accessibility
    await user.click(screen.getByTestId("tab-accessibility"));
    expect(screen.getByText("Prefers Reduced Motion")).toBeInTheDocument();
    expect(screen.getByText("High-Contrast Mode")).toBeInTheDocument();
    expect(screen.getByText("UI Density")).toBeInTheDocument();
    expect(screen.getByText("Font Scaling")).toBeInTheDocument();

    // Switch to Workspace
    await user.click(screen.getByTestId("tab-workspace"));
    expect(screen.getByTestId("active-workspace-root-display")).toHaveTextContent("/workspace/my-project");
    expect(screen.getByText("Enable reviewed local writes")).toBeInTheDocument();

    // Switch to Advanced
    await user.click(screen.getByTestId("tab-advanced"));
    expect(screen.getByText("Local Host Diagnostics & Logging")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reset all storage & clear history/i })).toBeInTheDocument();
  });

  it("toggles accessibility preferences and updates document classes", async () => {
    const user = userEvent.setup();
    render(<SettingsDialog {...defaultProps} initialTab="accessibility" />);

    const motionToggle = screen.getByRole("checkbox", { name: /toggle reduced motion/i });
    expect(motionToggle).not.toBeChecked();

    await user.click(motionToggle);
    expect(motionToggle).toBeChecked();
    expect(document.documentElement.classList.contains("reduced-motion")).toBe(true);

    const contrastToggle = screen.getByRole("checkbox", { name: /toggle high contrast/i });
    await user.click(contrastToggle);
    expect(contrastToggle).toBeChecked();
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);

    // Switch density to compact
    const compactBtn = screen.getByRole("button", { name: /^compact$/i });
    await user.click(compactBtn);
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });

  it("handles provider connect and disconnect callbacks", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    render(
      <SettingsDialog
        {...defaultProps}
        initialTab="provider"
        onConnect={onConnect}
        onDisconnect={onDisconnect}
      />
    );

    const disconnectBtn = screen.getByRole("button", { name: /disconnect/i });
    await user.click(disconnectBtn);
    expect(onDisconnect).toHaveBeenCalledTimes(1);

    const testConnectBtn = screen.getByRole("button", { name: /test & connect/i });
    await user.click(testConnectBtn);
    expect(onConnect).toHaveBeenCalledWith("test-key-123", "https://nano-gpt.com/api/v1");
  });

  it("triggers storage reset confirmation dialog in Advanced tab", async () => {
    const user = userEvent.setup();
    const onClearHistory = vi.fn();
    render(
      <SettingsDialog
        {...defaultProps}
        initialTab="advanced"
        onClearHistory={onClearHistory}
      />
    );

    const resetBtn = screen.getByRole("button", { name: /reset all storage & clear history/i });
    await user.click(resetBtn);

    // Target-explicit modal appears
    expect(screen.getByText("Reset All Storage & History")).toBeInTheDocument();
    const confirmResetBtn = screen.getByRole("button", { name: "Reset Storage" });
    await user.click(confirmResetBtn);

    expect(onClearHistory).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Reset All Storage & History")).not.toBeInTheDocument();
  });

  it("closes dialog when pressing Escape key", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsDialog {...defaultProps} onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
