// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatComposer } from "@/sections/ChatComposer";
import type { VirtualFile } from "@/types";

afterEach(cleanup);

const mockFiles: VirtualFile[] = [
  { path: "src/server.ts", language: "typescript", content: "const server = 1;" },
  { path: "src/rate-limit.ts", language: "typescript", content: "const rateLimit = 2;" },
  { path: "README.md", language: "markdown", content: "# NanoForge" },
];

function renderComposer(overrides: Partial<Parameters<typeof ChatComposer>[0]> = {}) {
  const callbacks = {
    onSendMessage: vi.fn(),
    onTriggerPlan: vi.fn(),
    onExecuteCommand: vi.fn(),
    onStop: vi.fn(),
    onGenPrefsChange: vi.fn(),
  };

  render(
    <ChatComposer
      onSendMessage={callbacks.onSendMessage}
      onTriggerPlan={callbacks.onTriggerPlan}
      onExecuteCommand={callbacks.onExecuteCommand}
      onStop={callbacks.onStop}
      workspaceFiles={mockFiles}
      model={{ id: "gpt-5.2", name: "GPT-5.2", provider: "OpenAI", inputPrice: 1.75, outputPrice: 14.0, contextK: 400, tags: ["reasoning"] }}
      connected={true}
      budgetTokens={400000}
      usedTokens={12500}
      usedPct={3.125}
      {...overrides}
    />,
  );

  return callbacks;
}

describe("ChatComposer rendering & basic interactions", () => {
  it("renders textarea, model badge, connection status, context usage, and run button", () => {
    renderComposer();
    expect(screen.getByTestId("chat-textarea")).toBeTruthy();
    expect(screen.getByText("GPT-5.2")).toBeTruthy();
    expect(screen.getByText(/live · API connected/i)).toBeTruthy();
    expect(screen.getByText(/12\.5k \/ 400\.0k/i)).toBeTruthy();
    expect(screen.getByTestId("run-agent-button")).toBeTruthy();
  });

  it("submits typed message on run agent click", async () => {
    const user = userEvent.setup();
    const cb = renderComposer();
    const textarea = screen.getByTestId("chat-textarea") as HTMLTextAreaElement;

    await user.type(textarea, "Refactor error handlers");
    await user.click(screen.getByTestId("run-agent-button"));

    expect(cb.onSendMessage).toHaveBeenCalledWith("Refactor error handlers", undefined);
    expect(textarea.value).toBe("");
  });

  it("submits message on Enter key without shift", async () => {
    const user = userEvent.setup();
    const cb = renderComposer();
    const textarea = screen.getByTestId("chat-textarea") as HTMLTextAreaElement;

    await user.type(textarea, "Run sanity checks{Enter}");

    expect(cb.onSendMessage).toHaveBeenCalledWith("Run sanity checks", undefined);
    expect(textarea.value).toBe("");
  });

  it("renders stop button and invokes onStop when running", async () => {
    const user = userEvent.setup();
    const cb = renderComposer({ running: true });

    expect(screen.queryByTestId("run-agent-button")).toBeNull();
    const stopBtn = screen.getByTestId("stop-agent-button");
    expect(stopBtn).toBeTruthy();

    await user.click(stopBtn);
    expect(cb.onStop).toHaveBeenCalledTimes(1);
  });
});

describe("ChatComposer Floating Slash Command Palette", () => {
  it("opens the slash popover when typing / and displays all built-in commands", async () => {
    const user = userEvent.setup();
    renderComposer();
    const textarea = screen.getByTestId("chat-textarea");

    await user.type(textarea, "/");

    const popover = screen.getByTestId("slash-popover");
    expect(popover).toBeTruthy();

    expect(screen.getByTestId("slash-item-plan")).toBeTruthy();
    expect(screen.getByTestId("slash-item-goal")).toBeTruthy();
    expect(screen.getByTestId("slash-item-schedule")).toBeTruthy();
    expect(screen.getByTestId("slash-item-browse")).toBeTruthy();
    expect(screen.getByTestId("slash-item-learn")).toBeTruthy();
    expect(screen.getByTestId("slash-item-cost")).toBeTruthy();
    expect(screen.getByTestId("slash-item-compact")).toBeTruthy();
    expect(screen.getByTestId("slash-item-clear")).toBeTruthy();
  });

  it("filters slash commands by prefix query", async () => {
    const user = userEvent.setup();
    renderComposer();
    const textarea = screen.getByTestId("chat-textarea");

    await user.type(textarea, "/pl");

    expect(screen.getByTestId("slash-item-plan")).toBeTruthy();
    expect(screen.queryByTestId("slash-item-schedule")).toBeNull();
  });

  it("supports keyboard navigation (ArrowDown, ArrowUp, Enter) to select a slash command", async () => {
    const user = userEvent.setup();
    renderComposer();
    const textarea = screen.getByTestId("chat-textarea") as HTMLTextAreaElement;

    // Type / to open palette
    await user.type(textarea, "/");

    // Arrow down to select second item (/goal)
    await user.keyboard("{ArrowDown}");
    const goalItem = screen.getByTestId("slash-item-goal");
    expect(goalItem.getAttribute("data-active")).toBe("true");

    // Press Enter to choose /goal
    await user.keyboard("{Enter}");

    expect(textarea.value).toBe("/goal ");
    expect(screen.queryByTestId("slash-popover")).toBeNull();
  });

  it("dismisses the slash command popover on Escape", async () => {
    const user = userEvent.setup();
    renderComposer();
    const textarea = screen.getByTestId("chat-textarea");

    await user.type(textarea, "/");
    expect(screen.getByTestId("slash-popover")).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("slash-popover")).toBeNull();
  });

  it("triggers onTriggerPlan when submitting /plan <goal>", async () => {
    const user = userEvent.setup();
    const cb = renderComposer();
    const textarea = screen.getByTestId("chat-textarea");

    await user.type(textarea, "/plan Refactor authentication layer{Enter}");

    expect(cb.onTriggerPlan).toHaveBeenCalledWith("Refactor authentication layer");
    expect(cb.onSendMessage).toHaveBeenCalledWith("/plan Refactor authentication layer", undefined);
  });

  it("routes swarm slash commands to the host command handler", async () => {
    const user = userEvent.setup();
    const cb = renderComposer();
    const textarea = screen.getByTestId("chat-textarea");

    await user.type(textarea, '/swarm run "Audit the auth flow"{Enter}');

    expect(cb.onExecuteCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "/swarm",
      positional: ["run", "Audit the auth flow"],
    }));
    expect(cb.onSendMessage).not.toHaveBeenCalled();
  });
});

describe("ChatComposer @file Context Mention Autocomplete", () => {
  it("opens the mention popup when typing @ and lists workspace files", async () => {
    const user = userEvent.setup();
    renderComposer();
    const textarea = screen.getByTestId("chat-textarea");

    await user.type(textarea, "@");

    const popover = screen.getByTestId("mention-popover");
    expect(popover).toBeTruthy();

    expect(screen.getByTestId("mention-item-src/server.ts")).toBeTruthy();
    expect(screen.getByTestId("mention-item-src/rate-limit.ts")).toBeTruthy();
    expect(screen.getByTestId("mention-item-README.md")).toBeTruthy();
  });

  it("filters files matching mention query", async () => {
    const user = userEvent.setup();
    renderComposer();
    const textarea = screen.getByTestId("chat-textarea");

    await user.type(textarea, "@rate");

    expect(screen.getByTestId("mention-item-src/rate-limit.ts")).toBeTruthy();
    expect(screen.queryByTestId("mention-item-README.md")).toBeNull();
  });

  it("selects a file mention with Enter, renders a context chip, and attaches it on send", async () => {
    const user = userEvent.setup();
    const cb = renderComposer();
    const textarea = screen.getByTestId("chat-textarea");

    await user.type(textarea, "Review this file @server");
    await user.keyboard("{Enter}");

    // Context chip is rendered
    const chip = screen.getByTestId("mention-chip-src/server.ts");
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain("src/server.ts");

    // Submit message
    await user.type(textarea, "for latency issues{Enter}");

    expect(cb.onSendMessage).toHaveBeenCalledWith(
      "Review this file for latency issues",
      expect.arrayContaining([
        expect.objectContaining({ type: "file", id: "src/server.ts" }),
      ]),
    );
  });

  it("allows removing a context mention chip via its remove button", async () => {
    const user = userEvent.setup();
    renderComposer();
    const textarea = screen.getByTestId("chat-textarea");

    await user.type(textarea, "@server{Enter}");
    expect(screen.getByTestId("mention-chip-src/server.ts")).toBeTruthy();

    const removeBtn = screen.getByRole("button", { name: /Remove mention src\/server\.ts/i });
    await user.click(removeBtn);

    expect(screen.queryByTestId("mention-chip-src/server.ts")).toBeNull();
  });
});
