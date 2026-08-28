// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useHostSession, type HostClientLike } from "@/lib/hostSession";

const capabilities = {
  read: true,
  stat: true,
  watch: true,
  search: true,
  git: true,
  terminal: true,
  subagents: true,
  memory: true,
  reviewedWrite: true,
};

function clientFor(generation: number, connect = vi.fn().mockResolvedValue(undefined)) {
  let listener: ((message: any) => void) | undefined;
  const client = {
    connect,
    close: vi.fn(),
    onEvent: vi.fn((callback) => {
      listener = callback;
      return vi.fn();
    }),
    describeWorkspace: vi.fn().mockResolvedValue({
      id: `workspace-${generation}`,
      name: `Workspace ${generation}`,
      displayPath: `Workspace ${generation}`,
      generation,
      capabilities,
    }),
    readDir: vi.fn().mockResolvedValue([]),
    emit(message: any) { listener?.(message); },
  } satisfies Partial<HostClientLike> & { emit(message: any): void };
  return client as unknown as HostClientLike & { emit(message: any): void };
}

describe("useHostSession workspace reconnection", () => {
  it("validates a candidate generation, swaps clients, and ignores stale old events without reloading", async () => {
    const oldClient = clientFor(1);
    const nextClient = clientFor(2);
    const createClient = vi.fn()
      .mockReturnValueOnce(oldClient)
      .mockReturnValueOnce(nextClient);
    const { result } = renderHook(() => useHostSession({
      settings: { enabled: true, port: 4100, token: "startup-token" },
      createClient,
    }));
    await waitFor(() => expect(result.current.status).toBe("connected"));

    await act(async () => {
      await expect(result.current.reconnectToWorkspace({
        websocketUrl: "ws://127.0.0.1:4200/agent?token=next-token",
        generation: 2,
      })).resolves.toMatchObject({ id: "workspace-2", generation: 2 });
    });

    expect(nextClient.connect).toHaveBeenCalledOnce();
    expect(nextClient.describeWorkspace).toHaveBeenCalledOnce();
    expect(oldClient.close).toHaveBeenCalledOnce();
    oldClient.emit({ type: "error", code: "stale", message: "old host" });
    expect(result.current.lastError).toBeNull();
    // A successful swap is observed in-place through the existing hook; no
    // navigation or browser reload API is involved.
  });

  it("retains the connected client when the replacement cannot connect", async () => {
    const oldClient = clientFor(1);
    const nextClient = clientFor(2, vi.fn().mockRejectedValue(new Error("candidate unavailable")));
    const createClient = vi.fn().mockReturnValueOnce(oldClient).mockReturnValueOnce(nextClient);
    const { result } = renderHook(() => useHostSession({
      settings: { enabled: true, port: 4100, token: "startup-token" },
      createClient,
    }));
    await waitFor(() => expect(result.current.status).toBe("connected"));

    await act(async () => {
      await expect(result.current.reconnectToWorkspace({ port: 4200, token: "next-token", generation: 2 }))
        .resolves.toBeNull();
    });
    await act(async () => { await result.current.readWorkspaceDirectory(); });

    expect(oldClient.close).not.toHaveBeenCalled();
    expect(oldClient.readDir).toHaveBeenCalledOnce();
    expect(nextClient.close).toHaveBeenCalledOnce();
    expect(result.current.lastError).toContain("candidate unavailable");
  });
});
