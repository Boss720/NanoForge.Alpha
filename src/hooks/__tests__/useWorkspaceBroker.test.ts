// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceBrokerError } from "@/lib/workspaceBrokerClient";
import { useWorkspaceBroker, type WorkspaceBrokerClientLike } from "@/hooks/useWorkspaceBroker";

const workspace = {
  workspaceId: "workspace-opaque-1",
  label: "Project alpha",
  generation: 1,
  capabilities: { read: true, stat: true, watch: true, search: true, git: true, terminal: true, subagents: true, memory: true, reviewedWrite: false },
} as const;

function fakeClient(overrides: Partial<WorkspaceBrokerClientLike> = {}): WorkspaceBrokerClientLike {
  return {
    choose: vi.fn(async () => ({ type: "workspace.choose.result" as const, requestId: "choose-1", workspace })),
    activate: vi.fn(async () => ({ type: "workspace.activate.result" as const, requestId: "activate-1", workspace })),
    listRecents: vi.fn(async () => ({ type: "workspace.recent.list.result" as const, requestId: "recent-1", workspaces: [workspace] })),
    ...overrides,
  };
}

describe("useWorkspaceBroker", () => {
  it("uses the native chooser and keeps picker cancellation non-destructive", async () => {
    const client = fakeClient({ choose: vi.fn(async () => { throw new WorkspaceBrokerError("cancelled", "picker_cancelled", { recoverable: true }); }) });
    const { result } = renderHook(() => useWorkspaceBroker({ client }));
    await waitFor(() => expect(client.listRecents).toHaveBeenCalled());

    let selection: unknown;
    await act(async () => { selection = await result.current.choose(); });

    expect(client.choose).toHaveBeenCalledOnce();
    expect(selection).toBeNull();
    expect(result.current.state).toMatchObject({ status: "ready", message: "Folder selection cancelled." });
  });

  it("activates a recent workspace by opaque ID", async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useWorkspaceBroker({ client }));

    await act(async () => { await result.current.activate("workspace-opaque-1"); });

    expect(client.activate).toHaveBeenCalledWith("workspace-opaque-1");
  });

  it("handles non-retryable broker errors with clear diagnostic messages", async () => {
    const accessDeniedClient = fakeClient({
      choose: vi.fn(async () => {
        throw new WorkspaceBrokerError("access denied", "access_denied");
      }),
    });
    const { result } = renderHook(() => useWorkspaceBroker({ client: accessDeniedClient }));

    await act(async () => {
      await result.current.choose();
    });

    expect(result.current.state.status).toBe("unavailable");
    expect(result.current.state.message).toContain("Access denied to the selected folder");

    const rootTooBroadClient = fakeClient({
      activate: vi.fn(async () => {
        throw new WorkspaceBrokerError("root too broad", "root_too_broad");
      }),
    });
    const { result: r2 } = renderHook(() => useWorkspaceBroker({ client: rootTooBroadClient }));

    await act(async () => {
      await r2.current.activate("root-id");
    });

    expect(r2.current.state.status).toBe("unavailable");
    expect(r2.current.state.message).toContain("filesystem root or too broad");
  });
});
