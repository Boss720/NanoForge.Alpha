// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanPanel } from "@/sections/PlanPanel";
import type { ExecutionPlan } from "@/types";

afterEach(cleanup);

const basePlan: ExecutionPlan = {
  id: "plan-1",
  goal: "Add rate limiting to the server",
  state: "awaiting_approval",
  steps: [
    {
      id: "inspect",
      title: "Inspect server entrypoint",
      dependsOn: [],
      status: "succeeded",
      affectedScopes: ["src/server.ts"],
      estimate: { tokens: 1200, costUsd: 0.002, durationSec: 8 },
      artifacts: ["notes/inspect.md"],
    },
    {
      id: "edit",
      title: "Add rate limit middleware",
      dependsOn: ["inspect"],
      status: "pending",
      approval: "required",
      sideEffecting: true,
      affectedScopes: ["src/server.ts", "src/middleware/rateLimit.ts"],
      estimate: { tokens: 3400, costUsd: 0.006 },
    },
    {
      id: "verify",
      title: "Run the test suite",
      dependsOn: ["edit"],
      status: "pending",
    },
  ],
};

const phasedPlan: ExecutionPlan = {
  id: "plan-phased-1",
  goal: "Build Antigravity-Style Planning & Headless Runner",
  state: "awaiting_approval",
  phases: [
    {
      id: "p1",
      title: "Discovery & Protocol",
      description: "Define wire schemas and sync contracts",
      order: 1,
    },
    {
      id: "p2",
      title: "UI Implementation",
      description: "Upgrade plan panel and slash composer",
      order: 2,
    },
  ],
  steps: [
    {
      id: "p1-step1",
      phaseId: "p1",
      title: "Inspect protocol definitions",
      dependsOn: [],
      status: "succeeded",
    },
    {
      id: "p1-step2",
      phaseId: "p1",
      title: "Validate DAG schema",
      dependsOn: ["p1-step1"],
      status: "succeeded",
    },
    {
      id: "p2-step1",
      phaseId: "p2",
      title: "Implement phase accordions",
      dependsOn: ["p1-step2"],
      status: "pending",
      approval: "required",
      sideEffecting: true,
      affectedScopes: ["src/sections/PlanPanel.tsx"],
    },
    {
      id: "p2-step2",
      phaseId: "p2",
      title: "Add slash caret popover",
      dependsOn: ["p2-step1"],
      status: "pending",
      approval: "required",
      sideEffecting: true,
      affectedScopes: ["src/sections/ChatComposer.tsx"],
    },
  ],
};

function renderPanel(plan: ExecutionPlan = basePlan, onApprovePhaseMock = vi.fn()) {
  const callbacks = {
    onApproveStep: vi.fn(),
    onApprovePhase: onApprovePhaseMock,
    onRunApproved: vi.fn(),
    onPause: vi.fn(),
    onCancel: vi.fn(),
  };
  render(<PlanPanel plan={plan} {...callbacks} />);
  return callbacks;
}

describe("PlanPanel rendering", () => {
  it("renders the goal, plan state, and every step with its status", () => {
    renderPanel();
    expect(screen.getByText("Add rate limiting to the server")).toBeTruthy();
    expect(screen.getByText("awaiting approval")).toBeTruthy();
    expect(screen.getByText("Inspect server entrypoint")).toBeTruthy();
    expect(screen.getByText("Add rate limit middleware")).toBeTruthy();
    expect(screen.getByText("Run the test suite")).toBeTruthy();
  });

  it("renders dependency edges as badges", () => {
    renderPanel();
    expect(screen.getAllByText("depends on")).toHaveLength(2);
    const editStep = screen.getByTestId("plan-step-edit");
    expect(editStep.textContent).toContain("inspect");
    const verifyStep = screen.getByTestId("plan-step-verify");
    expect(verifyStep.textContent).toContain("edit");
  });

  it("renders exact affected scopes, estimates, and artifacts", () => {
    renderPanel();
    expect(screen.getByText("src/middleware/rateLimit.ts")).toBeTruthy();
    expect(screen.getAllByText("src/server.ts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/~1,200 tok/)).toBeTruthy();
    expect(screen.getByText(/≈\$0\.0060/)).toBeTruthy();
    expect(screen.getByText("notes/inspect.md")).toBeTruthy();
  });

  it("marks approval-required steps and flags that chat text never counts", () => {
    renderPanel();
    expect(screen.getByText(/chat text never counts/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Approve step Add rate limit middleware/i })).toBeTruthy();
  });
});

describe("PlanPanel approval gate", () => {
  it("disables Run until every required approval is granted by an explicit click", async () => {
    const user = userEvent.setup();
    const cb = renderPanel();
    const run = screen.getByRole("button", { name: /^run$/i }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: /Approve step Add rate limit middleware/i }));
    expect(cb.onApproveStep).toHaveBeenCalledWith("plan-1", "edit");
    expect((screen.getByRole("button", { name: /^run$/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("approved")).toBeTruthy();
  });

  it("never shows an approval-required step as running before the explicit click, even if props say running", () => {
    // A compromised/buggy parent or host stream marks the step running; the
    // panel's own state machine must downgrade it to a blocked display.
    const roguePlan: ExecutionPlan = {
      ...basePlan,
      state: "executing",
      steps: basePlan.steps.map((s) =>
        s.id === "edit" ? { ...s, status: "running" as const } : s,
      ),
    };
    renderPanel(roguePlan);
    const step = screen.getByTestId("plan-step-edit");
    expect(step.getAttribute("data-status")).toBe("blocked");
    expect(step.textContent).toContain("awaiting approval");
    expect(step.textContent).not.toContain("running");
  });

  it("keeps the gate when approvals arrive out of band — only the button satisfies them", () => {
    // same plan re-rendered with state changes but no click: still gated
    const cb = renderPanel({ ...basePlan, state: "paused" });
    const run = screen.getByRole("button", { name: /^run$/i }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(cb.onApproveStep).not.toHaveBeenCalled();
  });
});

describe("PlanPanel controls", () => {
  it("fires onRunApproved with the plan id once approvals are complete", async () => {
    const user = userEvent.setup();
    const cb = renderPanel();
    await user.click(screen.getByRole("button", { name: /Approve step Add rate limit middleware/i }));
    await user.click(screen.getByRole("button", { name: /^run$/i }));
    expect(cb.onRunApproved).toHaveBeenCalledWith("plan-1");
  });

  it("fires onPause only while executing", async () => {
    const user = userEvent.setup();
    const cb = renderPanel({ ...basePlan, state: "executing" });
    await user.click(screen.getByRole("button", { name: /^pause$/i }));
    expect(cb.onPause).toHaveBeenCalledWith("plan-1");
  });

  it("disables Pause when the plan is not executing", () => {
    renderPanel();
    expect((screen.getByRole("button", { name: /^pause$/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("fires onCancel and disables it for completed plans", async () => {
    const user = userEvent.setup();
    const cb = renderPanel();
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(cb.onCancel).toHaveBeenCalledWith("plan-1");
  });

  it("disables Cancel when the plan is completed", () => {
    renderPanel({ ...basePlan, state: "completed" });
    expect((screen.getByRole("button", { name: /^cancel$/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("PlanPanel Visual Phase Accordions & Batch Approval", () => {
  it("renders phase accordions with phase numbers, titles, descriptions, and step completion counters", () => {
    renderPanel(phasedPlan);

    expect(screen.getByText("Phase 1")).toBeTruthy();
    expect(screen.getByText("Discovery & Protocol")).toBeTruthy();
    expect(screen.getByText("Define wire schemas and sync contracts")).toBeTruthy();
    expect(screen.getByTestId("phase-counter-p1").textContent).toContain("2/2 complete");

    expect(screen.getByText("Phase 2")).toBeTruthy();
    expect(screen.getByText("UI Implementation")).toBeTruthy();
    expect(screen.getByText("Upgrade plan panel and slash composer")).toBeTruthy();
    expect(screen.getByTestId("phase-counter-p2").textContent).toContain("0/2 complete");
  });

  it("toggles collapsible phase accordion visibility on click", async () => {
    const user = userEvent.setup();
    renderPanel(phasedPlan);

    // Initial state: steps are visible
    expect(screen.getByTestId("plan-step-p1-step1")).toBeTruthy();

    // Click accordion header for Phase 1 to collapse
    const phase1Header = screen.getByRole("button", { name: /Phase 1: Discovery & Protocol/i });
    await user.click(phase1Header);

    // Steps for Phase 1 should now be collapsed
    expect(screen.queryByTestId("plan-step-p1-step1")).toBeNull();

    // Click again to re-expand
    await user.click(phase1Header);
    expect(screen.getByTestId("plan-step-p1-step1")).toBeTruthy();
  });

  it("supports batch Approve Phase to approve all required steps in the phase", async () => {
    const user = userEvent.setup();
    const approvePhaseSpy = vi.fn();
    const cb = renderPanel(phasedPlan, approvePhaseSpy);

    const runBtn = screen.getByRole("button", { name: /^run$/i }) as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);

    const approvePhase2Btn = screen.getByRole("button", { name: /Approve phase UI Implementation/i });
    expect(approvePhase2Btn).toBeTruthy();

    await user.click(approvePhase2Btn);

    // Both steps in Phase 2 should have onApproveStep called
    expect(cb.onApproveStep).toHaveBeenCalledWith("plan-phased-1", "p2-step1");
    expect(cb.onApproveStep).toHaveBeenCalledWith("plan-phased-1", "p2-step2");
    expect(approvePhaseSpy).toHaveBeenCalledWith("plan-phased-1", "p2");

    // All steps are now approved -> Run button becomes enabled
    expect(runBtn.disabled).toBe(false);
  });

  it("renders DAG dependency badges with accurate status indicators", () => {
    const dagPlan: ExecutionPlan = {
      id: "dag-plan",
      goal: "DAG Dependency Test",
      state: "executing",
      steps: [
        { id: "step-a", title: "Step A", dependsOn: [], status: "succeeded" },
        { id: "step-b", title: "Step B", dependsOn: ["step-a"], status: "running" },
        { id: "step-c", title: "Step C", dependsOn: ["step-b"], status: "pending" },
      ],
    };

    renderPanel(dagPlan);

    const depBadgeA = screen.getByTestId("dep-badge-step-a");
    expect(depBadgeA.getAttribute("data-status")).toBe("succeeded");

    const depBadgeB = screen.getByTestId("dep-badge-step-b");
    expect(depBadgeB.getAttribute("data-status")).toBe("running");
  });
});
