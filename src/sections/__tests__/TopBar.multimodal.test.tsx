// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBar, type RuntimeStatus } from "../TopBar";
import type { ConnectionState } from "@/types";

afterEach(cleanup);

describe("TopBar — Multi-Modal Status Semantics (R6)", () => {
  const baseConnection: ConnectionState = {
    apiKey: "test-key",
    baseUrl: "https://nano-gpt.com/api/v1",
    status: "disconnected",
    liveModels: false,
  };

  const commonProps = {
    usage: { input: 1200, output: 400, costUsd: 0.005, requests: 3 },
    onOpenSettings: vi.fn(),
    onOpenSidebar: vi.fn(),
    onOpenModels: vi.fn(),
    onExport: vi.fn(),
    canExport: true,
    onOpenCosts: vi.fn(),
    onOpenImages: vi.fn(),
  };

  it("combines color, icon, and text label across all API connection statuses", () => {
    const statuses: Array<{
      status: ConnectionState["status"];
      expectedLabel: string;
      expectedAria: string;
    }> = [
      { status: "connected", expectedLabel: "API live", expectedAria: "API status: API live" },
      { status: "checking", expectedLabel: "API checking…", expectedAria: "API status: API checking…" },
      { status: "error", expectedLabel: "API error", expectedAria: "API status: API error" },
      { status: "disconnected", expectedLabel: "API demo", expectedAria: "API status: API demo" },
    ];

    for (const { status, expectedLabel, expectedAria } of statuses) {
      const { unmount } = render(
        <TopBar
          {...commonProps}
          connection={{ ...baseConnection, status }}
          runtimeStatus="ready"
        />
      );

      expect(screen.getByText(expectedLabel)).toBeInTheDocument();
      expect(screen.getByLabelText(expectedAria)).toBeInTheDocument();
      unmount();
    }
  });

  it("combines color, icon, and text label across all Local Runtime statuses", () => {
    const runtimeStatuses: Array<{
      status: RuntimeStatus;
      expectedLabel: string;
      expectedAria: string;
    }> = [
      { status: "ready", expectedLabel: "Runtime ready", expectedAria: "Local runtime: Runtime ready" },
      { status: "connecting", expectedLabel: "Host connecting", expectedAria: "Local runtime: Host connecting" },
      { status: "error", expectedLabel: "Host error", expectedAria: "Local runtime: Host error" },
      { status: "offline", expectedLabel: "Host offline", expectedAria: "Local runtime: Host offline" },
      { status: "unavailable", expectedLabel: "Workspace unavailable", expectedAria: "Local runtime: Workspace unavailable" },
      { status: "no-workspace", expectedLabel: "No workspace", expectedAria: "Local runtime: No workspace" },
    ];

    for (const { status, expectedLabel, expectedAria } of runtimeStatuses) {
      const { unmount } = render(
        <TopBar
          {...commonProps}
          connection={baseConnection}
          runtimeStatus={status}
        />
      );

      expect(screen.getByText(expectedLabel)).toBeInTheDocument();
      expect(screen.getByLabelText(expectedAria)).toBeInTheDocument();
      unmount();
    }
  });
});
