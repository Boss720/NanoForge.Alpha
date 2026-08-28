// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelPanel } from "../ModelPanel";
import { ConnectDialog } from "../ConnectDialog";
import type { ConnectionState, NanoModel } from "@/types";

afterEach(cleanup);

const models: NanoModel[] = [
  {
    id: "openai/gpt-5.2",
    name: "GPT-5.2",
    provider: "openai",
    inputPrice: 1.5,
    outputPrice: 10,
    contextK: 400,
    tags: ["reasoning"],
  },
];

describe("ModelPanel route decision surfacing", () => {
  it("renders the unchanged catalog when no routeDecision prop is given (host absent)", () => {
    render(<ModelPanel models={models} selected="openai/gpt-5.2" onSelect={() => {}} live={false} />);
    expect(screen.getByText("Model catalog")).toBeInTheDocument();
    expect(screen.getByText("GPT-5.2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Route decision")).not.toBeInTheDocument();
  });

  it("surfaces the RouteDecisionCard when a route decision is available", () => {
    render(
      <ModelPanel
        models={models}
        selected="openai/gpt-5.2"
        onSelect={() => {}}
        live={false}
        routeDecision={{
          decision: {
            primary: "openai/gpt-5.2",
            fallbacks: ["anthropic/claude-sonnet-4.6"],
            estimatedCostUsd: 0.01,
            reason: "test reason",
            pinned: true,
          },
        }}
      />,
    );
    expect(screen.getByLabelText("Route decision")).toBeInTheDocument();
    expect(screen.getByText("pinned")).toBeInTheDocument();
    // catalog still intact alongside the card
    expect(screen.getByText("GPT-5.2")).toBeInTheDocument();
  });
});

describe("ConnectDialog integrations entry point", () => {
  const connection: ConnectionState = {
    apiKey: "",
    baseUrl: "https://nano-gpt.com/api/v1",
    status: "disconnected",
    liveModels: false,
  };

  const baseProps = {
    open: true,
    onClose: () => {},
    connection,
    onConnect: () => {},
    onDisconnect: () => {},
    onClearHistory: () => {},
  };

  it("omits the entry point when onOpenIntegrations is not provided (no host)", () => {
    render(<ConnectDialog {...baseProps} initialTab="advanced" />);
    expect(screen.getByText("Settings & Preferences")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open integrations/i })).not.toBeInTheDocument();
  });

  it("renders an integrations button that fires the callback", async () => {
    const user = userEvent.setup();
    const onOpenIntegrations = vi.fn();
    render(<ConnectDialog {...baseProps} initialTab="advanced" onOpenIntegrations={onOpenIntegrations} />);
    await user.click(screen.getByRole("button", { name: /open integrations/i }));
    expect(onOpenIntegrations).toHaveBeenCalledTimes(1);
  });
});
