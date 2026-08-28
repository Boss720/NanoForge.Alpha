// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectDialog } from "../ConnectDialog";
import type { ConnectionState } from "@/types";

afterEach(cleanup);

describe("ConnectDialog reviewed local writes opt-in and confirmation", () => {
  const connection: ConnectionState = {
    apiKey: "",
    baseUrl: "https://nano-gpt.com/api/v1",
    status: "disconnected",
    liveModels: false,
  };

  const defaultProps = {
    open: true,
    onClose: () => {},
    connection,
    onConnect: () => {},
    onDisconnect: () => {},
    onClearHistory: () => {},
    activeWorkspaceRoot: "/workspace/nano-forge",
  };

  it("displays active workspace root and disabled writes toggle by default", async () => {
    render(<ConnectDialog {...defaultProps} allowWorkspaceWrites={false} initialTab="workspace" />);

    expect(screen.getByTestId("active-workspace-root-display")).toHaveTextContent("/workspace/nano-forge");
    const checkbox = screen.getByRole("checkbox", { name: /enable reviewed local writes/i });
    expect(checkbox).not.toBeChecked();
  });

  it("requires deliberate confirmation when enabling local writes", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ConnectDialog
        {...defaultProps}
        allowWorkspaceWrites={false}
        initialTab="workspace"
        onToggleWorkspaceWrites={onToggle}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /enable reviewed local writes/i });
    await user.click(checkbox);

    // Confirmation prompt appears
    expect(screen.getByText("Confirm Local Workspace Writes")).toBeInTheDocument();
    expect(
      screen.getByText(/Allow reviewed local writes\? Accepted patches will modify files in/i),
    ).toBeInTheDocument();
    expect(onToggle).not.toHaveBeenCalled();

    // Clicking Cancel dismisses without enabling
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText("Confirm Local Workspace Writes")).not.toBeInTheDocument();
    expect(onToggle).not.toHaveBeenCalled();

    // Click again and confirm
    await user.click(checkbox);
    expect(screen.getByText("Confirm Local Workspace Writes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /enable reviewed writes/i }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("disables writes immediately without confirmation when unchecking", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ConnectDialog
        {...defaultProps}
        allowWorkspaceWrites={true}
        initialTab="workspace"
        onToggleWorkspaceWrites={onToggle}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /enable reviewed local writes/i });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(screen.queryByText("Confirm Local Workspace Writes")).not.toBeInTheDocument();
  });
});
