// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);
import {
  VisualEvidenceCard,
  type VisualAssertionResult,
  type VisualDiffResult,
} from "../VisualEvidenceCard";

const assertions: VisualAssertionResult[] = [
  {
    id: "a1",
    kind: "expect_visible",
    target: "#submit-btn",
    expected: "#submit-btn",
    actual: "#submit-btn",
    passed: true,
  },
  {
    id: "a2",
    kind: "expect_text",
    target: "h1.title",
    expected: "Order confirmed",
    actual: "Order failed",
    passed: false,
  },
  {
    id: "a3",
    kind: "expect_url",
    target: "location.href",
    expected: "https://local.test/done",
    actual: null,
    passed: false,
  },
];

const passingDiff: VisualDiffResult = {
  baselinePath: "runs/r1/baseline.png",
  currentPath: "runs/r1/current.png",
  overlayPath: "runs/r1/overlay.png",
  diffRatio: 0.004,
  threshold: 0.01,
};

const failingDiff: VisualDiffResult = { ...passingDiff, diffRatio: 0.12 };

describe("VisualEvidenceCard", () => {
  it("renders every assertion with pass/fail status and expected vs actual", () => {
    render(<VisualEvidenceCard assertions={assertions} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    // passing assertion shows its status icon and expected value
    const first = within(rows[0]);
    expect(first.getByLabelText("passed")).toBeInTheDocument();
    expect(first.getByText("visible")).toBeInTheDocument();

    // failed assertions show expected vs actual side by side
    const second = within(rows[1]);
    expect(second.getByLabelText("failed")).toBeInTheDocument();
    expect(second.getByText("Order confirmed")).toBeInTheDocument();
    expect(second.getByText("Order failed")).toBeInTheDocument();

    // unobservable actual renders an em-dash placeholder
    const third = within(rows[2]);
    expect(third.getByText("—")).toBeInTheDocument();

    expect(screen.getByText("2/3 assertions failed")).toBeInTheDocument();
  });

  it("renders baseline/current/overlay images with relative paths, ratio and threshold", () => {
    render(<VisualEvidenceCard diff={passingDiff} />);

    expect(screen.getByAltText(/baseline screenshot/)).toHaveAttribute("src", "runs/r1/baseline.png");
    expect(screen.getByAltText(/current screenshot/)).toHaveAttribute("src", "runs/r1/current.png");
    expect(screen.getByAltText(/diff overlay screenshot/)).toHaveAttribute("src", "runs/r1/overlay.png");

    expect(screen.getByText(/diff 0\.40% \/ threshold 1\.00%/)).toBeInTheDocument();
    expect(screen.getByText(/within tolerance/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "pixel diff ratio" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });

  it("visually highlights the overlay image when the diff exceeds the threshold", async () => {
    const user = userEvent.setup();
    render(<VisualEvidenceCard diff={failingDiff} />);

    expect(screen.getByText(/· failed/)).toBeInTheDocument();

    const overlay = screen.getByAltText(/diff overlay screenshot/);
    const figure = overlay.closest("figure")!;
    expect(figure).toHaveAttribute("data-highlight", "true");
    expect(figure.className).toMatch(/ring-red-500/);

    // baseline/current are NOT highlighted
    const baseline = screen.getByAltText(/baseline screenshot/).closest("figure")!;
    expect(baseline).not.toHaveAttribute("data-highlight");

    // broken images (host absent) fall back to showing the relative path
    await user.tab(); // no-op interaction sanity check
    overlay.dispatchEvent(new Event("error"));
    expect(await screen.findByText("runs/r1/overlay.png")).toBeInTheDocument();
  });

  it("renders an explicit empty state when no evidence exists", () => {
    render(<VisualEvidenceCard />);
    expect(screen.getByText("no visual evidence recorded for this run")).toBeInTheDocument();
  });
});
