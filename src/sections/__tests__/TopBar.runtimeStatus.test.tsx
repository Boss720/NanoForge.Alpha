// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "@/sections/TopBar";
import type { ConnectionState } from "@/types";

afterEach(cleanup);

const disconnected: ConnectionState = {
  apiKey: "",
  baseUrl: "https://nano-gpt.com/api/v1",
  status: "disconnected",
  liveModels: false,
};

const commonProps = {
  usage: { input: 0, output: 0, costUsd: 0, requests: 0 },
  onOpenSettings: vi.fn(),
  onOpenSidebar: vi.fn(),
  onOpenModels: vi.fn(),
  onExport: vi.fn(),
  canExport: false,
  onOpenCosts: vi.fn(),
  onOpenImages: vi.fn(),
};

describe("TopBar connection and runtime statuses", () => {
  it("reaches separate API and local runtime labels", () => {
    render(<TopBar {...commonProps} connection={disconnected} runtimeStatus="offline" />);

    expect(screen.getByText("API demo")).toBeInTheDocument();
    expect(screen.getByText("Host offline")).toBeInTheDocument();
    expect(screen.getByLabelText("Local runtime: Host offline")).toBeInTheDocument();
  });

  it("reports a ready workspace independently of API connectivity", () => {
    render(<TopBar {...commonProps} connection={{ ...disconnected, status: "connected", apiKey: "key" }} runtimeStatus="ready" />);

    expect(screen.getByText("API live")).toBeInTheDocument();
    expect(screen.getByText("Runtime ready")).toBeInTheDocument();
  });
});
