// @vitest-environment jsdom
/**
 * Comprehensive Unit and Component Tests for TerminalDock — Milestone 4 (R3).
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  TerminalDock,
  parseAnsiToSpans,
  type TerminalTabState,
} from "./TerminalDock";

afterEach(cleanup);

// Mock ResizeObserver for JSDOM test environment
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Mock navigator.clipboard
Object.defineProperty(navigator, "clipboard", {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
  configurable: true,
});

describe("parseAnsiToSpans", () => {
  it("returns plain text unchanged with default style", () => {
    const spans = parseAnsiToSpans("Hello World");
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("Hello World");
  });

  it("handles basic 16-color ANSI codes", () => {
    const raw = "Normal \x1b[31mRed Text\x1b[0m Normal Again";
    const spans = parseAnsiToSpans(raw);
    expect(spans.length).toBeGreaterThanOrEqual(3);
    expect(spans[0].text).toBe("Normal ");
    expect(spans[1].text).toBe("Red Text");
    expect(spans[1].style.color).toBe("#f87171"); // mapped red
    expect(spans[2].text).toBe(" Normal Again");
    expect(spans[2].style.color).toBeUndefined();
  });

  it("handles bold, italic, and underline modifiers", () => {
    const raw = "\x1b[1mBold\x1b[22m \x1b[3mItalic\x1b[23m \x1b[4mUnderline\x1b[0m";
    const spans = parseAnsiToSpans(raw);
    expect(spans[0].text).toBe("Bold");
    expect(spans[0].style.fontWeight).toBe("bold");

    const italicSpan = spans.find((s) => s.text === "Italic");
    expect(italicSpan?.style.fontStyle).toBe("italic");

    const underlineSpan = spans.find((s) => s.text === "Underline");
    expect(underlineSpan?.style.textDecoration).toBe("underline");
  });

  it("handles 256-color palette codes", () => {
    const raw = "\x1b[38;5;196m256-Red\x1b[0m";
    const spans = parseAnsiToSpans(raw);
    expect(spans[0].text).toBe("256-Red");
    expect(spans[0].style.color).toBeDefined();
  });

  it("handles 24-bit truecolor RGB codes", () => {
    const raw = "\x1b[38;2;120;200;250mTrueColor\x1b[0m";
    const spans = parseAnsiToSpans(raw);
    expect(spans[0].text).toBe("TrueColor");
    expect(spans[0].style.color).toBe("rgb(120, 200, 250)");
  });
});

describe("TerminalDock Component", () => {
  const sampleTabs: TerminalTabState[] = [
    {
      id: "tab-1",
      title: "Shell 1",
      status: "running",
      cols: 80,
      rows: 24,
      data: "\x1b[32m$ ready 1\x1b[0m\r\n",
    },
    {
      id: "tab-2",
      title: "Build Output",
      status: "exited",
      exitCode: 0,
      cols: 80,
      rows: 24,
      data: "\x1b[36mBuild succeeded in 2.1s\x1b[0m\r\n",
    },
  ];

  it("renders dock container and tab list", () => {
    render(<TerminalDock tabs={sampleTabs} activeTabId="tab-1" />);

    expect(screen.getByTestId("terminal-dock")).toBeInTheDocument();
    expect(screen.getByText("Shell 1")).toBeInTheDocument();
    expect(screen.getByText("Build Output")).toBeInTheDocument();
    expect(screen.getByText("$ ready 1")).toBeInTheDocument();
  });

  it("switches active tab on click", async () => {
    const onSelectTab = vi.fn();
    render(
      <TerminalDock
        tabs={sampleTabs}
        activeTabId="tab-1"
        onSelectTab={onSelectTab}
      />,
    );

    const tab2 = screen.getByText("Build Output");
    fireEvent.click(tab2);

    expect(onSelectTab).toHaveBeenCalledWith("tab-2");
  });

  it("triggers new tab creation when + is clicked", () => {
    const onCreateTab = vi.fn();
    render(
      <TerminalDock
        tabs={sampleTabs}
        activeTabId="tab-1"
        onCreateTab={onCreateTab}
      />,
    );

    const plusBtn = screen.getByTitle("Open New Terminal Tab");
    fireEvent.click(plusBtn);

    expect(onCreateTab).toHaveBeenCalled();
  });

  it("triggers tab closure and kills process when close icon is clicked", () => {
    const onCloseTab = vi.fn();
    const onKill = vi.fn();
    render(
      <TerminalDock
        tabs={sampleTabs}
        activeTabId="tab-1"
        onCloseTab={onCloseTab}
        onKill={onKill}
      />,
    );

    const closeBtn = screen.getByLabelText("Close Shell 1");
    fireEvent.click(closeBtn);

    expect(onCloseTab).toHaveBeenCalledWith("tab-1");
    expect(onKill).toHaveBeenCalledWith("tab-1");
  });

  it("forwards stdin input on Enter and sends protocol message", async () => {
    const user = userEvent.setup();
    const onInput = vi.fn();
    const onSendMessage = vi.fn();

    render(
      <TerminalDock
        tabs={sampleTabs}
        activeTabId="tab-1"
        onInput={onInput}
        onSendMessage={onSendMessage}
      />,
    );

    const input = screen.getByTestId("terminal-input");
    await user.type(input, "npm test{Enter}");

    expect(onInput).toHaveBeenCalledWith("tab-1", "npm test\r\n");
    expect(onSendMessage).toHaveBeenCalledWith({
      type: "terminal.input",
      id: "tab-1",
      sessionId: undefined,
      data: "npm test\r\n",
    });
  });

  it("handles Ctrl+C to send interrupt signal", () => {
    const onInput = vi.fn();
    render(
      <TerminalDock
        tabs={sampleTabs}
        activeTabId="tab-1"
        onInput={onInput}
      />,
    );

    const input = screen.getByTestId("terminal-input");
    fireEvent.keyDown(input, { key: "c", ctrlKey: true });

    expect(onInput).toHaveBeenCalledWith("tab-1", "\x03");
  });

  it("handles history navigation with Up and Down arrows", async () => {
    const user = userEvent.setup();
    render(<TerminalDock />);

    const input = screen.getByTestId("terminal-input") as HTMLInputElement;

    // Send first command
    await user.type(input, "git status{Enter}");
    expect(input.value).toBe("");

    // Send second command
    await user.type(input, "cargo build{Enter}");
    expect(input.value).toBe("");

    // Up arrow restores previous command
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("cargo build");

    // Up arrow again restores earlier command
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("git status");

    // Down arrow navigates back forward
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("cargo build");
  });

  it("renders process exit notification when status is exited", () => {
    render(<TerminalDock tabs={sampleTabs} activeTabId="tab-2" />);

    expect(
      screen.getByText("[Process completed with exit code 0]"),
    ).toBeInTheDocument();
    expect(screen.getByText("Restart")).toBeInTheDocument();
  });

  it("supports searching and filtering output", async () => {
    const user = userEvent.setup();
    render(<TerminalDock tabs={sampleTabs} activeTabId="tab-2" />);

    const searchBtn = screen.getByTitle("Search output");
    await user.click(searchBtn);

    const searchInput = screen.getByPlaceholderText("Find in output…");
    await user.type(searchInput, "succeeded");

    expect(screen.getByText("succeeded")).toBeInTheDocument();
  });

  it("handles clearing buffer and killing running process", () => {
    const onInput = vi.fn();
    const onKill = vi.fn();

    render(
      <TerminalDock
        tabs={sampleTabs}
        activeTabId="tab-1"
        onInput={onInput}
        onKill={onKill}
      />,
    );

    const clearBtn = screen.getByTitle("Clear scrollback buffer");
    fireEvent.click(clearBtn);
    expect(onInput).toHaveBeenCalledWith("tab-1", "\x0c");

    const killBtn = screen.getByTitle("Terminate running process");
    fireEvent.click(killBtn);
    expect(onKill).toHaveBeenCalledWith("tab-1");
  });

  it("handles fullscreen toggle and close dock button", () => {
    const onToggleFullscreen = vi.fn();
    const onClose = vi.fn();

    render(
      <TerminalDock
        tabs={sampleTabs}
        activeTabId="tab-1"
        onToggleFullscreen={onToggleFullscreen}
        onClose={onClose}
      />,
    );

    const fsBtn = screen.getByTitle("Fullscreen");
    fireEvent.click(fsBtn);
    expect(onToggleFullscreen).toHaveBeenCalled();

    const closeDockBtn = screen.getByTitle("Close Terminal Dock");
    fireEvent.click(closeDockBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
