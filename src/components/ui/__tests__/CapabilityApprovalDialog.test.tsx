// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CapabilityApprovalDialog } from "@/components/ui/CapabilityApprovalDialog";

const request = {
  type: "capability.approval_required" as const,
  requestId: "req-1",
  hostId: "host-1",
  sessionId: "session-1",
  workspaceId: "workspace-1",
  generation: 1,
  runId: "run-1",
  stepId: "step-1",
  toolId: "workspace.writeFile",
  argumentsDigest: `sha256:${"a".repeat(64)}`,
  scope: "write" as const,
  expiresAt: "2026-08-28T12:00:00.000Z",
  uses: "single" as const,
  reason: "Approval required for workspace.writeFile",
  at: "2026-08-28T11:59:00.000Z",
};

describe("CapabilityApprovalDialog", () => {
  it("does not render without a host-issued request", () => {
    const { container } = render(<CapabilityApprovalDialog request={null} onDecide={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("requires an explicit single-use decision", async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(<CapabilityApprovalDialog request={request} onDecide={onDecide} />);

    expect(screen.getByRole("dialog", { name: /approve reviewed local write/i })).toBeInTheDocument();
    expect(screen.getByText(/limited to this exact request and can be used once/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /approve once/i }));
    expect(onDecide).toHaveBeenCalledWith("req-1", true);
  });
});
