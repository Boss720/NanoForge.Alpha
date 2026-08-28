// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteDecisionCard, type RouteDecision } from "../RouteDecisionCard";

afterEach(cleanup);

const decision: RouteDecision = {
  primary: "openai/gpt-5.2",
  fallbacks: ["anthropic/claude-sonnet-4.6", "google/gemini-3-pro"],
  estimatedCostUsd: 0.0123,
  reason: "Picked the strongest planning+coding profile under the $0.05 cost cap.",
  pinned: false,
};

describe("RouteDecisionCard", () => {
  it("shows model, ordered fallbacks, reason, and cost estimate", () => {
    render(<RouteDecisionCard decision={decision} />);
    expect(screen.getByText("openai/gpt-5.2")).toBeInTheDocument();
    expect(screen.getByText("est. $0.0123")).toBeInTheDocument();
    expect(screen.getByText(/strongest planning\+coding profile/)).toBeInTheDocument();
    // ordered chain with ordinal markers
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("1.");
    expect(items[0]).toHaveTextContent("anthropic/claude-sonnet-4.6");
    expect(items[1]).toHaveTextContent("2.");
    expect(items[1]).toHaveTextContent("google/gemini-3-pro");
    // automatic (unpinned) state badge
    expect(screen.getByText("automatic")).toBeInTheDocument();
  });

  it("shows a pinned badge when the user pinned the model", () => {
    render(<RouteDecisionCard decision={{ ...decision, pinned: true }} />);
    expect(screen.getByText("pinned")).toBeInTheDocument();
    expect(screen.queryByText("automatic")).not.toBeInTheDocument();
  });

  it("gates an unapproved fallback behind explicit user approval", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const view = render(
      <RouteDecisionCard
        decision={decision}
        pendingFallback="anthropic/claude-sonnet-4.6"
        onApproveFallback={onApprove}
        onRejectFallback={onReject}
      />,
    );

    expect(screen.getByText(/did not pre-approve this fallback/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "approve fallback" }));
    expect(onApprove).toHaveBeenCalledWith("anthropic/claude-sonnet-4.6");

    view.unmount();

    render(
      <RouteDecisionCard
        decision={decision}
        pendingFallback="anthropic/claude-sonnet-4.6"
        onApproveFallback={onApprove}
        onRejectFallback={onReject}
      />,
    );
    await user.click(screen.getByRole("button", { name: "reject" }));
    expect(onReject).toHaveBeenCalledWith("anthropic/claude-sonnet-4.6");
  });

  it("pre-approved fallback shows NO approval gate", () => {
    render(
      <RouteDecisionCard
        decision={decision}
        pendingFallback="anthropic/claude-sonnet-4.6"
        preApprovedFallbacks={["anthropic/claude-sonnet-4.6"]}
      />,
    );
    expect(screen.queryByRole("button", { name: "approve fallback" })).not.toBeInTheDocument();
    expect(screen.getByText(/pre-approved in the execution plan/)).toBeInTheDocument();
  });

  it("no pending fallback → no gate, no pre-approved note", () => {
    render(<RouteDecisionCard decision={decision} />);
    expect(screen.queryByRole("button", { name: "approve fallback" })).not.toBeInTheDocument();
    expect(screen.queryByText(/pre-approved in the execution plan/)).not.toBeInTheDocument();
  });
});
