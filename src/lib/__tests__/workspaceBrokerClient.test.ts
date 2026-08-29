import { describe, expect, it, vi } from "vitest";
import { WorkspaceBrokerClient, WorkspaceBrokerError } from "../workspaceBrokerClient";

const capabilities = {
  read: true,
  stat: true,
  watch: true,
  search: true,
  git: true,
  terminal: true,
  subagents: true,
  memory: true,
  reviewedWrite: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("WorkspaceBrokerClient", () => {
  it("activates by opaque ID with bearer auth and idempotency", async () => {
    const fetcher = vi.fn<(...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>>(
      async (_input, _init) => jsonResponse({
        type: "workspace.activate.result",
        requestId: "request-1",
        workspace: { workspaceId: "workspace-1", label: "Project Alpha", generation: 3, capabilities },
        connection: { websocketUrl: "ws://127.0.0.1:48123", port: 48123, token: "fresh", generation: 3 },
      }),
    );
    const client = new WorkspaceBrokerClient({
      baseUrl: "http://127.0.0.1:4173",
      token: "broker-token",
      fetcher,
      createRequestId: () => "request-1",
      createIdempotencyKey: () => "idem-1",
    });

    const result = await client.activate("workspace-1");

    expect(result.workspace.label).toBe("Project Alpha");
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:4173/workspace/activate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer broker-token",
          "Idempotency-Key": "idem-1",
        }),
      }),
    );
    expect(JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      type: "workspace.activate",
      requestId: "request-1",
      workspaceId: "workspace-1",
      idempotencyKey: "idem-1",
    });
  });

  it("validates successful JSON responses", async () => {
    const client = new WorkspaceBrokerClient({
      baseUrl: "http://127.0.0.1:4173",
      token: "broker-token",
      fetcher: vi.fn(async () => jsonResponse({ type: "workspace.current.result", requestId: "request-1", workspace: { rootPath: "C:\\secret" } })),
      createRequestId: () => "request-1",
    });

    await expect(client.current()).rejects.toMatchObject({ name: "WorkspaceBrokerError", code: "invalid_response" });
  });

  it("preserves cancellation and maps structured broker errors", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn<(...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>>(
      async (_input, _init) => jsonResponse({}),
    );
    const client = new WorkspaceBrokerClient({ baseUrl: "http://127.0.0.1:4173", token: "broker-token", fetcher });
    await expect(client.current({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();

    const failingClient = new WorkspaceBrokerClient({
      baseUrl: "http://127.0.0.1:4173",
      token: "broker-token",
      fetcher: vi.fn(async () => jsonResponse({
        type: "workspace.broker.error",
        requestId: "request-1",
        code: "workspace_missing",
        message: "Folder is no longer available",
        recoverable: true,
      }, 404)),
      createRequestId: () => "request-1",
    });
    await expect(failingClient.current()).rejects.toEqual(expect.objectContaining({
      code: "workspace_missing",
      status: 404,
    } satisfies Partial<WorkspaceBrokerError>));
  });
});
