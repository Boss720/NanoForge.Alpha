// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import type { HostClientLike, HostSession } from "@/lib/hostSession";
import type { HostMessage } from "@/lib/hostClient";
import type { ExecutionPlan } from "@/types";
import { STORAGE_KEY } from "@/lib/persist";

/**
 * App-level wiring tests for the agent platform (Tasks 3/7/10/14/17).
 *
 * The host client is injected as a fake via the `hostSession` wiring seam —
 * no real sockets are opened. `host.enabled` defaults to false, so the
 * default render must be byte-identical to the pre-platform UI.
 */

// jsdom does not implement window.matchMedia; App's responsive hook calls it.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 1;
    url: string;
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    constructor(url: string) {
      this.url = url;
      queueMicrotask(() => {
        this.onopen?.({ type: "open" });
      });
    }
    send(_data: string) {}
    close(code = 1000, reason = "") {
      this.readyState = 3;
      this.onclose?.({ code, reason });
    }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() {
      return true;
    }
  }

  (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
  (window as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
});

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});

/** Fake host client: records outbound calls, lets the test emit host frames. */
class FakeHostClient implements HostClientLike {
  private handlers = new Set<(msg: HostMessage) => void>();
  connect = vi.fn(async () => {});
  close = vi.fn(() => {});
  submitPlan = vi.fn(async () => {});
  grantApproval = vi.fn(async () => {});
  denyApproval = vi.fn(async () => {});
  pauseRun = vi.fn(async () => {});
  cancelRun = vi.fn(async () => {});
  readFile = vi.fn(async () => ({ path: "test.ts", content: "data", language: "typescript", size: 4, modified: "2026-08-26T20:00:00Z", sha256: "abc", generation: 1 }));
  writeFile = vi.fn(async () => ({
    type: "workspace.writeFile.result" as const,
    requestId: "mock-req",
    path: "test.ts",
    success: true as const,
    generation: 1,
    sha256: "def",
    size: 4,
    modified: "2026-08-26T20:00:00Z",
  }));
  onEvent(handler: (msg: HostMessage) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  emit(msg: HostMessage) {
    for (const h of this.handlers) h(msg);
  }
}

function renderWithHost(fake: FakeHostClient) {
  let api: HostSession | null = null;
  render(
    <App
      hostSession={{
        settings: { enabled: true, port: 4711, token: "tok" },
        createClient: () => fake,
        onApi: (a) => {
          api = a;
        },
      }}
    />,
  );
  return { getApi: () => api };
}

const plan: ExecutionPlan = {
  id: "plan-1",
  goal: "Ship the billing webhook handler",
  state: "awaiting_approval",
  steps: [
    { id: "inspect", title: "Inspect server entrypoint", dependsOn: [], status: "succeeded" },
    {
      id: "edit",
      title: "Add rate limit middleware",
      dependsOn: ["inspect"],
      status: "pending",
      approval: "required",
      sideEffecting: true,
      affectedScopes: ["src/server.ts"],
    },
  ],
};

describe("App host-absent default", () => {
  it("renders the unchanged UI: no plan rail, no permission dialog, no integrations panel", () => {
    render(<App />);
    // default chrome intact
    expect(screen.getByPlaceholderText(/Demo mode/)).toBeInTheDocument();
    expect(screen.getByText("Model catalog")).toBeInTheDocument();
    // agent-platform surfaces all absent
    expect(screen.queryByTestId("plan-rail")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Execution plan")).not.toBeInTheDocument();
    expect(screen.queryByTestId("integrations-panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("First navigation to a new origin")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /voice call/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/start voice call/i)).not.toBeInTheDocument();
  });
});

describe("App host wiring", () => {
  it("leaves the selected workspace untouched when the native picker is cancelled", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/?hostPort=4174&token=launcher-token");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).endsWith("/workspace/recent")
        ? { type: "workspace.recent.list.result", requestId: "recent-1", workspaces: [] }
        : { type: "workspace.broker.error", requestId: "choose-1", code: "picker_cancelled", message: "cancelled", recoverable: true },
    ), { status: 200 }));

    render(<App />);
    await user.click(screen.getAllByRole("button", { name: /open local folder/i })[0]);

    await waitFor(() => expect(screen.queryByRole("heading", { name: /recent folders/i })).not.toBeInTheDocument());
    expect(localStorage.getItem(STORAGE_KEY) ?? "").not.toContain("workspace-opaque");
  });

  it("opens a native folder through the broker, persists only safe metadata, and does not prompt for a path", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/?hostPort=4174&token=launcher-token");
    const nativePath = "C:\\Users\\Hp\\private-project";
    const brokerWorkspace = {
      workspaceId: "workspace-opaque-1",
      label: "private-project",
      generation: 1,
      capabilities: { read: true, stat: true, watch: true, search: true, git: true, terminal: true, subagents: true, memory: true, reviewedWrite: false },
    };
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(
      String(input).endsWith("/workspace/recent")
        ? { type: "workspace.recent.list.result", requestId: "recent-1", workspaces: [] }
        : String(input).endsWith("/workspace/activate")
          ? { type: "workspace.activate.result", requestId: "activate-1", workspace: brokerWorkspace }
          : { type: "workspace.choose.result", requestId: "choose-1", workspace: brokerWorkspace },
    ), { status: 200 }));
    const prompt = vi.spyOn(window, "prompt");

    render(<App />);
    await user.click(screen.getAllByRole("button", { name: /open local folder/i })[0]);

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      `${window.location.origin}/workspace/choose`,
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      `${window.location.origin}/workspace/activate`,
      expect.objectContaining({ method: "POST" }),
    ));
    expect(localStorage.getItem(STORAGE_KEY) ?? "").not.toContain(nativePath);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("shows PlanPanel once a plan is set via the wiring seam and flows approve/run to the host", async () => {
    const user = userEvent.setup();
    const fake = new FakeHostClient();
    const { getApi } = renderWithHost(fake);
    await waitFor(() => expect(fake.connect).toHaveBeenCalledTimes(1));

    // no plan → no rail, even with the host connected
    expect(screen.queryByLabelText("Execution plan")).not.toBeInTheDocument();

    act(() => getApi()!.setPlan(plan));
    expect(screen.getByLabelText("Execution plan")).toBeInTheDocument();
    expect(screen.getByText("Ship the billing webhook handler")).toBeInTheDocument();

    // explicit Approve click → approval.grant(planId, stepId)
    await user.click(screen.getByRole("button", { name: /Approve step Add rate limit middleware/i }));
    expect(fake.grantApproval).toHaveBeenCalledWith("plan-1", "edit");

    // Run (enabled once approvals are complete) → resubmits the approved plan
    await user.click(screen.getByRole("button", { name: /^run$/i }));
    expect(fake.submitPlan).toHaveBeenCalledWith(plan);
  });

  it("renders a terminal tool card in ChatPanel on tool.approval_required", async () => {
    const fake = new FakeHostClient();
    renderWithHost(fake);
    await waitFor(() => expect(fake.connect).toHaveBeenCalled());

    act(() =>
      fake.emit({
        type: "tool.approval_required",
        runId: "run-1",
        toolId: "tool-1",
        executable: "npm",
        args: ["install"],
        cwd: "C:\\workspace",
        policyReason: "installation requires approval",
      }),
    );

    const card = screen.getByTestId("tool-run-tool-1");
    expect(card).toBeInTheDocument();
    expect(card.getAttribute("data-state")).toBe("approval_required");
    expect(card.textContent).toContain("npm");
    expect(card.textContent).toContain("install");
  });

  it("still prompts for a sensitive action after the origin was allowed for the session", async () => {
    const user = userEvent.setup();
    const fake = new FakeHostClient();
    renderWithHost(fake);
    await waitFor(() => expect(fake.connect).toHaveBeenCalled());

    // host asks to navigate → origin prompt → allow for session → grant sent
    act(() =>
      fake.emit({
        type: "run.event",
        runId: "run-1",
        event: "browser.origin",
        detail: JSON.stringify({ origin: "https://shop.example", url: "https://shop.example/checkout" }),
      }),
    );
    expect(screen.getByText("First navigation to a new origin")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "allow for session" }));
    expect(fake.grantApproval).toHaveBeenCalledWith("run-1", "browser/origin/https://shop.example");
    expect(screen.queryByText("First navigation to a new origin")).not.toBeInTheDocument();

    // repeat navigation to the session-allowed origin auto-resolves: no prompt, instant grant
    act(() =>
      fake.emit({
        type: "run.event",
        runId: "run-1",
        event: "browser.origin",
        detail: JSON.stringify({ origin: "https://shop.example" }),
      }),
    );
    expect(screen.queryByText("First navigation to a new origin")).not.toBeInTheDocument();
    expect(fake.grantApproval).toHaveBeenCalledTimes(2);

    // …but a sensitive action on that SAME origin still gets its own prompt
    act(() =>
      fake.emit({
        type: "run.event",
        runId: "run-1",
        event: "browser.sensitive",
        detail: JSON.stringify({ action: "submit_form", origin: "https://shop.example", detail: "form #checkout" }),
      }),
    );
    expect(screen.getByText("Sensitive action — explicit confirmation required")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "approve once" }));
    expect(fake.grantApproval).toHaveBeenCalledWith("run-1", "browser/sensitive/submit_form@https://shop.example");
  });

  it("routes approval of a browser plan step through the origin prompt first (Task 10)", async () => {
    const user = userEvent.setup();
    const fake = new FakeHostClient();
    const { getApi } = renderWithHost(fake);
    await waitFor(() => expect(fake.connect).toHaveBeenCalled());

    const browserPlan: ExecutionPlan = {
      id: "plan-browser",
      goal: "Check the shop checkout",
      state: "awaiting_approval",
      steps: [
        {
          id: "browse",
          title: "Open the checkout page",
          dependsOn: [],
          status: "pending",
          approval: "required",
          // Task 10 convention: a `browser:<origin>` scope marks a browser step
          affectedScopes: ["browser:https://shop.example"],
        },
      ],
    };
    act(() => getApi()!.setPlan(browserPlan));

    // the Approve click does NOT reach the host yet — the origin prompt gates it
    await user.click(screen.getByRole("button", { name: /Approve step Open the checkout page/i }));
    expect(fake.grantApproval).not.toHaveBeenCalled();
    expect(screen.getByText("First navigation to a new origin")).toBeInTheDocument();
    expect(screen.getAllByText("https://shop.example").length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("button", { name: "allow once" }));
    expect(fake.grantApproval).toHaveBeenCalledWith("plan-browser", "browse");
  });

  it("denies the host grant when the origin prompt is denied", async () => {
    const user = userEvent.setup();
    const fake = new FakeHostClient();
    const { getApi } = renderWithHost(fake);
    await waitFor(() => expect(fake.connect).toHaveBeenCalled());

    const browserPlan: ExecutionPlan = {
      id: "plan-browser",
      goal: "Check the shop checkout",
      state: "awaiting_approval",
      steps: [
        {
          id: "browse",
          title: "Open the checkout page",
          dependsOn: [],
          status: "pending",
          approval: "required",
          affectedScopes: ["browser:https://shop.example"],
        },
      ],
    };
    act(() => getApi()!.setPlan(browserPlan));

    await user.click(screen.getByRole("button", { name: /Approve step Open the checkout page/i }));
    await user.click(screen.getByRole("button", { name: "deny" }));
    expect(fake.denyApproval).toHaveBeenCalledWith("plan-browser", "browse");
    expect(fake.grantApproval).not.toHaveBeenCalled();
  });

  it("provides user-facing reviewed workspace writes toggle in settings defaulting to disabled", async () => {
    const user = userEvent.setup();
    const fake = new FakeHostClient();
    renderWithHost(fake);
    await waitFor(() => expect(fake.connect).toHaveBeenCalled());

    // Open settings dialog via TopBar settings button
    const settingsBtn = screen.getByRole("button", { name: "Settings" });
    await user.click(settingsBtn);

    // Switch to Workspace tab
    const workspaceTabBtn = screen.getByTestId("tab-workspace");
    await user.click(workspaceTabBtn);

    const checkbox = screen.getByRole("checkbox", { name: /enable reviewed local writes/i });
    expect(checkbox).not.toBeChecked();

    // Toggling requires deliberate confirmation
    await user.click(checkbox);
    expect(screen.getByText("Confirm Local Workspace Writes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /enable reviewed writes/i }));
    expect(checkbox).toBeChecked();
  });
});
