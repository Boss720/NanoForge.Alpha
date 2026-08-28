// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../ChatPanel";
import type { Message, NanoModel, ToolRun } from "@/types";

afterEach(cleanup);

describe("ChatPanel — First-Run Onboarding Hero Card & Actionable States (R1)", () => {
  const model: NanoModel = {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    contextK: 128,
    inputPrice: 2.5,
    outputPrice: 10,
    tags: [],
  };

  const defaultProps = {
    messages: [] as Message[],
    running: false,
    model,
    connected: false,
    onSend: vi.fn(),
    onStop: vi.fn(),
    onPatchDecision: vi.fn(),
    genPrefs: { temperature: 0.2, maxTokens: 4096 },
    onGenPrefsChange: vi.fn(),
    onOpenFolder: vi.fn(),
  };

  it("renders first-run onboarding hero card with open local folder, guided demo, and security guarantees", async () => {
    const user = userEvent.setup();
    const onOpenFolder = vi.fn();
    const onSend = vi.fn();
    render(
      <ChatPanel
        {...defaultProps}
        messages={[]}
        onOpenFolder={onOpenFolder}
        onSend={onSend}
      />
    );

    expect(screen.getByTestId("onboarding-hero-card")).toBeInTheDocument();
    expect(screen.getByText("FORGE A CHANGE")).toBeInTheDocument();

    // Plain-language security & privacy boundaries
    expect(screen.getByText("Local Security & Privacy Guarantees")).toBeInTheDocument();
    expect(screen.getByText(/1\. Local-First/i)).toBeInTheDocument();
    expect(screen.getByText(/2\. Reviewed Writes/i)).toBeInTheDocument();
    expect(screen.getByText(/3\. Secret Protection/i)).toBeInTheDocument();

    // Primary action buttons
    const openFolderBtn = screen.getByRole("button", { name: /open local folder/i });
    expect(openFolderBtn).toBeInTheDocument();
    await user.click(openFolderBtn);
    expect(onOpenFolder).toHaveBeenCalledTimes(1);

    const guidedDemoBtn = screen.getByRole("button", { name: /use a guided demo/i });
    expect(guidedDemoBtn).toBeInTheDocument();
    await user.click(guidedDemoBtn);
    expect(onSend).toHaveBeenCalledWith("Add rate limiting to the server");
  });

  it("renders quick starters and allows one-click prompt submission", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ChatPanel {...defaultProps} messages={[]} onSend={onSend} />);

    const starterBtn = screen.getByText("Document the API in README.md");
    await user.click(starterBtn);
    expect(onSend).toHaveBeenCalledWith("Document the API in README.md");
  });

  it("renders multi-modal status tool runs and patch decisions", async () => {
    const user = userEvent.setup();
    const onPatchDecision = vi.fn();
    const onToolStop = vi.fn();

    const toolRuns: ToolRun[] = [
      {
        id: "tr-1",
        executable: "pnpm",
        args: ["test"],
        cwd: "C:\\Users\\Hp\\Documents\\nano-forge",
        state: "running",
      },
    ];

    const messages: Message[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: "Here is a proposed patch",
        ts: Date.now(),
        patch: {
          file: "src/server.ts",
          status: "pending",
          lines: [
            { type: "add", text: "import { rateLimit } from './routes';" },
            { type: "del", text: "const server = null;" },
          ],
        },
      },
    ];

    render(
      <ChatPanel
        {...defaultProps}
        messages={messages}
        toolRuns={toolRuns}
        onToolStop={onToolStop}
        onPatchDecision={onPatchDecision}
      />
    );

    // Multi-modal tool run card (shows executable, status text, and stop button)
    expect(screen.getByTestId("tool-run-tr-1")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();

    const stopBtn = screen.getByRole("button", { name: /stop pnpm/i });
    await user.click(stopBtn);
    expect(onToolStop).toHaveBeenCalledWith("tr-1");

    // Patch card apply/reject buttons
    const applyBtn = screen.getByRole("button", { name: /apply/i });
    await user.click(applyBtn);
    expect(onPatchDecision).toHaveBeenCalledWith("msg-1", "applied");
  });
});
