// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunCard } from "@/components/agent/RunCard";

afterEach(cleanup);

describe("RunCard recovery controls", () => {
  it("shows recovery guidance and retries failed runs", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <RunCard
        runId="run-1"
        objective="Verify the local build"
        status="failed"
        recoveryHint="Reconnect the local runtime, then retry."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/Reconnect the local runtime/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry run" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
