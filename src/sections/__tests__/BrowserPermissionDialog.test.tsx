// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  BrowserPermissionDialog,
  browserPermissionsReducer,
  initialBrowserPermissionsState,
  useBrowserPermissions,
  type BrowserPermissionDecision,
  type BrowserPermissionRequest,
} from "../BrowserPermissionDialog";

afterEach(cleanup);

/** Harness that wires the hook to the dialog exactly like PlanPanel will. */
function Harness({
  decisions,
  requests,
}: {
  decisions: BrowserPermissionDecision[];
  requests: BrowserPermissionRequest[];
}) {
  const { pending, requestPermission, decide } = useBrowserPermissions();
  return (
    <div>
      {requests.map((r, i) => (
        <button key={i} onClick={() => requestPermission(r)}>
          request-{i}
        </button>
      ))}
      <BrowserPermissionDialog
        request={pending}
        onDecide={(d) => {
          decisions.push(d);
          decide(d);
        }}
      />
    </div>
  );
}

const originReq: BrowserPermissionRequest = {
  kind: "origin",
  origin: "https://shop.example",
  url: "https://shop.example/checkout",
};
const submitReq: BrowserPermissionRequest = {
  kind: "sensitive",
  action: "submit_form",
  origin: "https://shop.example",
  detail: "form #checkout",
};
const purchaseReq: BrowserPermissionRequest = {
  kind: "sensitive",
  action: "purchase",
  origin: "https://shop.example",
};

describe("BrowserPermissionDialog", () => {
  it("renders nothing when there is no pending request", () => {
    const { container } = render(<BrowserPermissionDialog request={null} onDecide={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("origin prompt offers allow once / allow for session / deny and reports the decision", async () => {
    const user = userEvent.setup();
    const decisions: BrowserPermissionDecision[] = [];
    render(<Harness decisions={decisions} requests={[originReq]} />);

    await user.click(screen.getByText("request-0"));
    expect(screen.getByText("First navigation to a new origin")).toBeInTheDocument();
    expect(screen.getByText("https://shop.example/checkout")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "allow for session" }));
    expect(decisions).toEqual([
      { kind: "origin", origin: "https://shop.example", decision: "allow_session" },
    ]);
    // dialog closed after deciding
    expect(screen.queryByText("First navigation to a new origin")).not.toBeInTheDocument();
  });

  it("CRITICAL: granting origin permission does NOT auto-authorize a submit — it re-prompts", async () => {
    const user = userEvent.setup();
    const decisions: BrowserPermissionDecision[] = [];
    render(<Harness decisions={decisions} requests={[originReq, submitReq]} />);

    // 1) allow the origin for the whole session
    await user.click(screen.getByText("request-0"));
    await user.click(screen.getByRole("button", { name: "allow for session" }));
    expect(decisions).toHaveLength(1);

    // 2) a submit on the SAME, session-allowed origin still gets its own prompt
    await user.click(screen.getByText("request-1"));
    expect(screen.getByText("Sensitive action — explicit confirmation required")).toBeInTheDocument();
    expect(screen.getByText(/submit a form/)).toBeInTheDocument();
    expect(screen.getByText(/Origin permission does not authorize this action/)).toBeInTheDocument();
    // and there is no "session" escape hatch for sensitive actions
    expect(screen.queryByRole("button", { name: /session/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "approve once" }));
    expect(decisions[1]).toEqual({
      kind: "sensitive",
      action: "submit_form",
      origin: "https://shop.example",
      approved: true,
    });
  });

  it("deny on a sensitive action propagates approved:false", async () => {
    const user = userEvent.setup();
    const decisions: BrowserPermissionDecision[] = [];
    render(<Harness decisions={decisions} requests={[purchaseReq]} />);

    await user.click(screen.getByText("request-0"));
    expect(screen.getByText(/make a purchase/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "deny" }));
    expect(decisions).toEqual([
      { kind: "sensitive", action: "purchase", origin: "https://shop.example", approved: false },
    ]);
  });

  it("reducer: every subsequent sensitive action re-prompts even after a prior approval", () => {
    let s = initialBrowserPermissionsState;
    s = browserPermissionsReducer(s, { type: "request", request: originReq });
    s = browserPermissionsReducer(s, {
      type: "decide",
      decision: { kind: "origin", origin: originReq.origin, decision: "allow_session" },
    });
    // session-allowed origin: repeat navigation no longer prompts
    s = browserPermissionsReducer(s, { type: "request", request: originReq });
    expect(s.pending).toBeNull();
    // but a sensitive action on that origin prompts…
    s = browserPermissionsReducer(s, { type: "request", request: submitReq });
    expect(s.pending).toEqual(submitReq);
    s = browserPermissionsReducer(s, {
      type: "decide",
      decision: { kind: "sensitive", action: "submit_form", origin: submitReq.origin, approved: true },
    });
    // …and the identical action immediately after prompts AGAIN
    s = browserPermissionsReducer(s, { type: "request", request: submitReq });
    expect(s.pending).toEqual(submitReq);
  });

  it("reducer: allow-once grant is consumed by the next navigation only", () => {
    let s = initialBrowserPermissionsState;
    s = browserPermissionsReducer(s, { type: "request", request: originReq });
    s = browserPermissionsReducer(s, {
      type: "decide",
      decision: { kind: "origin", origin: originReq.origin, decision: "allow_once" },
    });
    // first repeat navigation consumes the grant without prompting
    s = browserPermissionsReducer(s, { type: "request", request: originReq });
    expect(s.pending).toBeNull();
    // second repeat navigation prompts again
    s = browserPermissionsReducer(s, { type: "request", request: originReq });
    expect(s.pending).toEqual(originReq);
  });

  it("reducer: requests queue FIFO behind the pending one", () => {
    let s = initialBrowserPermissionsState;
    s = browserPermissionsReducer(s, { type: "request", request: originReq });
    s = browserPermissionsReducer(s, { type: "request", request: submitReq });
    expect(s.pending).toEqual(originReq);
    expect(s.queue).toEqual([submitReq]);
    s = browserPermissionsReducer(s, {
      type: "decide",
      decision: { kind: "origin", origin: originReq.origin, decision: "deny" },
    });
    expect(s.pending).toEqual(submitReq);
    expect(s.deniedOrigins).toEqual(["https://shop.example"]);
  });
});
