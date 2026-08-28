// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ROLE_TEMPLATES,
  SpawnSubagentModal,
  validateLaunchSettings,
} from "../SpawnSubagentModal";

afterEach(cleanup);

describe("guided subagent launch", () => {
  it("exposes role templates that apply a role", () => {
    expect(ROLE_TEMPLATES.length).toBeGreaterThan(1);

    render(
      <SpawnSubagentModal
        open
        onOpenChange={vi.fn()}
        subagents={[]}
        onSpawn={vi.fn().mockResolvedValue({})}
      />,
    );

    fireEvent.click(screen.getByTestId("role-template-qa"));

    expect(screen.getByText("qa")).toBeInTheDocument();
  });

  it("rejects unsafe launch settings before the host is called", () => {
    expect(
      validateLaunchSettings({
        missionGoal: " ",
        roles: [],
        timeoutSeconds: 30,
        budgetTokens: "0",
        workspaceIsolation: "inherit",
        concurrency: 2,
        activeCount: 7,
      }),
    ).toEqual(expect.arrayContaining([
      "Mission goal is required.",
      "Choose at least one role.",
      "Timeout must be between 60 and 7200 seconds.",
      "Token budget must be a positive whole number.",
      "Concurrency exceeds the available subagent slots.",
    ]));
  });

  it("shows a dry-run preview and requires the explicit confirm action", async () => {
    const onSpawn = vi.fn().mockResolvedValue({});

    render(
      <SpawnSubagentModal
        open
        onOpenChange={vi.fn()}
        subagents={[]}
        onSpawn={onSpawn}
      />,
    );

    fireEvent.change(screen.getByTestId("mission-goal"), {
      target: { value: "Audit code coverage" },
    });

    expect(screen.getByTestId("dry-run-preview")).toBeInTheDocument();
    expect(onSpawn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Confirm & Spawn Agent/i }));

    await waitFor(() => expect(onSpawn).toHaveBeenCalledTimes(1));
  });
});
