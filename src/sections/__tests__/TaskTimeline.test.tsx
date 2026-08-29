// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskTimeline } from "@/sections/TaskTimeline";
import type { TaskTimeline as TimelineModel } from "@/types/timeline";

afterEach(cleanup);

const timeline: TimelineModel = {
  id: "run-1",
  goal: "Verify the local build",
  status: "active",
  startedAt: 1,
  steps: [
    { id: "inspect", kind: "read_files", title: "Inspect files", status: "success" },
    { id: "test", kind: "run_tests", title: "Run tests", status: "running", command: "pnpm test" },
  ],
};

describe("TaskTimeline run controls", () => {
  it("shows active progress and exposes pause/cancel actions", () => {
    render(<TaskTimeline timeline={timeline} onPause={() => {}} onCancel={() => {}} />);

    expect(screen.getByTestId("timeline-status")).toHaveTextContent("Active");
    expect(screen.getByText("1 of 2 steps completed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel run" })).toBeInTheDocument();
  });

  it("surfaces recovery guidance and invokes retry for a failed run", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <TaskTimeline
        timeline={{ ...timeline, status: "failed", steps: [{ ...timeline.steps[0], status: "failed" }] }}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/run stopped with an error/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry run" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
