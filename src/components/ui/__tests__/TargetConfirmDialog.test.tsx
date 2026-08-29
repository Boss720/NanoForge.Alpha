// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TargetConfirmDialog } from "../TargetConfirmDialog";

afterEach(cleanup);

describe("TargetConfirmDialog — Target-Explicit Confirmation Modal", () => {
  it("renders modal dialog with accessible title, description, and action buttons", () => {
    render(
      <TargetConfirmDialog
        open={true}
        title="Delete Workspace"
        description="Are you sure you want to delete workspace 'Demo Project'? This cannot be undone."
        targetName="Demo Project"
        confirmLabel="Delete Workspace"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delete Workspace" })).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete workspace 'Demo Project'/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete Workspace/i })).toBeInTheDocument();
  });

  it("calls onCancel when clicking Cancel button or pressing Escape", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <TargetConfirmDialog
        open={true}
        title="Delete Chat"
        description="Delete chat history"
        targetName="Chat 1"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("requires exact typing of target name when requireTypingName is enabled", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <TargetConfirmDialog
        open={true}
        title="Reset All Storage"
        description="Type RESET to confirm"
        targetName="RESET"
        requireTypingName={true}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    const confirmBtn = screen.getByRole("button", { name: /Delete/i });
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByRole("textbox", { name: /Type "RESET" to confirm/i });
    await user.type(input, "WRONG");
    expect(confirmBtn).toBeDisabled();

    await user.clear(input);
    await user.type(input, "RESET");
    expect(confirmBtn).not.toBeDisabled();

    await user.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
