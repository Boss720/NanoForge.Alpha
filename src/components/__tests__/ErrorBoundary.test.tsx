// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ErrorBoundary, AppErrorBoundary } from "../ErrorBoundary";

afterEach(() => {
  cleanup();
});

function ProblematicComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Simulated rendering explosion!");
  }
  return <div data-testid="problematic-healthy">Healthy Component Content</div>;
}

describe("ErrorBoundary Component", () => {
  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary panelName="Test Panel">
        <ProblematicComponent shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId("problematic-healthy")).toBeInTheDocument();
    expect(screen.getByText("Healthy Component Content")).toBeInTheDocument();
  });

  it("catches render errors and displays dark themed error card with panel name", () => {
    // Suppress console.error in test output for intentional crash
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary panelName="Special Inspector">
        <ProblematicComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId("error-boundary-special-inspector")).toBeInTheDocument();
    expect(screen.getByText("Special Inspector Failed to Render")).toBeInTheDocument();
    expect(screen.getByText("Simulated rendering explosion!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry component/i })).toBeInTheDocument();

    spy.mockRestore();
  });

  it("allows toggling stack trace display", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary panelName="Debug Panel">
        <ProblematicComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    const toggleBtn = screen.getByRole("button", { name: /show stack/i });
    expect(toggleBtn).toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(screen.getByText(/hide stack/i)).toBeInTheDocument();

    spy.mockRestore();
  });

  it("invokes resetErrorBoundary when retry button is clicked", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onResetMock = vi.fn();

    render(
      <ErrorBoundary panelName="Retryable Panel" onReset={onResetMock}>
        <ProblematicComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    const retryBtn = screen.getByRole("button", { name: /retry component/i });
    fireEvent.click(retryBtn);

    expect(onResetMock).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it("renders custom fallback function when provided", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary
        panelName="Custom Panel"
        fallback={({ error, resetErrorBoundary, panelName }) => (
          <div data-testid="custom-fallback">
            <span>{panelName} crashed: {error.message}</span>
            <button onClick={resetErrorBoundary}>Custom Reset</button>
          </div>
        )}
      >
        <ProblematicComponent shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId("custom-fallback")).toBeInTheDocument();
    expect(screen.getByText("Custom Panel crashed: Simulated rendering explosion!")).toBeInTheDocument();

    spy.mockRestore();
  });
});

describe("AppErrorBoundary Component", () => {
  it("renders full viewport recovery card upon fatal error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <AppErrorBoundary>
        <ProblematicComponent shouldThrow={true} />
      </AppErrorBoundary>
    );

    expect(screen.getByText("NanoForge Workbench Crash")).toBeInTheDocument();
    expect(screen.getByText("Simulated rendering explosion!")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try re-mounting/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload window/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear local state & reset/i })).toBeInTheDocument();

    spy.mockRestore();
  });
});
