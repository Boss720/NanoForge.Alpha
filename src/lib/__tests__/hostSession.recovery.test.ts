// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  useHostSession,
  loadHostSettings,
  resetInMemoryLauncherSettings,
  type HostClientLike,
} from "@/lib/hostSession";
import { HostOriginMismatchError } from "@/lib/hostClient";

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

function createMockClient(generation = 1, options?: { connectFn?: () => Promise<void> }) {
  let listener: ((message: any) => void) | undefined;
  const client = {
    connect: options?.connectFn ?? vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    onEvent: vi.fn((callback) => {
      listener = callback;
      return vi.fn();
    }),
    describeWorkspace: vi.fn().mockResolvedValue({
      id: `workspace-${generation}`,
      name: `Workspace ${generation}`,
      displayPath: `C:\\projects\\workspace-${generation}`,
      generation,
      capabilities,
    }),
    readDir: vi.fn().mockResolvedValue([]),
    openWorkspace: vi.fn().mockResolvedValue({
      id: `workspace-${generation}`,
      name: `Workspace ${generation}`,
      displayPath: `C:\\projects\\workspace-${generation}`,
      generation,
      capabilities,
    }),
    selectWorkspace: vi.fn().mockResolvedValue({
      id: `workspace-${generation}`,
      name: `Workspace ${generation}`,
      displayPath: `C:\\projects\\workspace-${generation}`,
      generation,
      capabilities,
    }),
    emit(message: any) {
      listener?.(message);
    },
  };
  return client as unknown as HostClientLike & { emit(message: any): void };
}

describe("HostSession Recovery & State Machine", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    resetInMemoryLauncherSettings();
  });

  afterEach(() => {
    resetInMemoryLauncherSettings();
    Object.defineProperty(window, "location", {
      writable: true,
      configurable: true,
      value: originalLocation,
    });
  });

  describe("Short-lived launcher URL handoff", () => {
    it("reads host parameters from URL, stores in memory, and scrubs query parameters via replaceState", () => {
      const replaceStateSpy = vi.spyOn(window.history, "replaceState");
      Object.defineProperty(window, "location", {
        writable: true,
        configurable: true,
        value: new URL("http://127.0.0.1:4183/?hostPort=49212&token=secret-token-123#section"),
      });

      const settings = loadHostSettings();
      expect(settings).toEqual({
        enabled: true,
        port: 49212,
        token: "secret-token-123",
      });

      expect(replaceStateSpy).toHaveBeenCalledWith({}, expect.any(String), "/#section");

      // Verify second read retrieves from in-memory cache even if location is modified
      Object.defineProperty(window, "location", {
        writable: true,
        configurable: true,
        value: new URL("http://127.0.0.1:4183/"),
      });
      const cached = loadHostSettings();
      expect(cached.token).toBe("secret-token-123");
      expect(cached.port).toBe(49212);
    });
  });

  describe("7-State Runtime State Machine & Generation-Verified Reconnection", () => {
    it("surfaces a host-issued write prompt and answers it only after an explicit UI decision", async () => {
      const mockClient = createMockClient(1) as HostClientLike & { emit(message: any): void; respondToCapabilityApproval?: ReturnType<typeof vi.fn> };
      mockClient.respondToCapabilityApproval = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useHostSession({
          settings: { enabled: true, port: 4183, token: "token-1" },
          createClient: () => mockClient,
        })
      );

      await waitFor(() => expect(result.current.runtimeState).toBe("healthy"));
      act(() => {
        mockClient.emit({
          type: "capability.approval_required",
          requestId: "req-write-1",
          hostId: "host-1",
          sessionId: "session-1",
          workspaceId: "workspace-1",
          generation: 1,
          runId: "run-1",
          stepId: "step-1",
          toolId: "workspace.writeFile",
          argumentsDigest: `sha256:${"a".repeat(64)}`,
          scope: "write",
          expiresAt: "2026-08-28T12:00:00.000Z",
          uses: "single",
          reason: "Approval required for workspace.writeFile",
          at: "2026-08-28T11:59:00.000Z",
        });
      });

      expect(result.current.capabilityApprovalPending).toMatchObject({ requestId: "req-write-1", scope: "write" });
      act(() => result.current.decideCapabilityApproval("req-write-1", true));
      expect(mockClient.respondToCapabilityApproval).toHaveBeenCalledWith("req-write-1", true);
      expect(result.current.capabilityApprovalPending).toBeNull();
    });

    it("transitions through starting -> healthy on connect", async () => {
      const mockClient = createMockClient(1);
      const { result } = renderHook(() =>
        useHostSession({
          settings: { enabled: true, port: 4183, token: "token-1" },
          createClient: () => mockClient,
        })
      );

      await waitFor(() => {
        expect(result.current.runtimeState).toBe("healthy");
        expect(result.current.isOperational).toBe(true);
        expect(result.current.status).toBe("connected");
      });
    });

    it("reconnects to workspace when prior client is null/closed", async () => {
      const candidateClient = createMockClient(3);
      const createClient = vi.fn().mockReturnValue(candidateClient);

      // Start with disabled host so clientRef.current is null
      const { result } = renderHook(() =>
        useHostSession({
          settings: { enabled: false },
          createClient,
        })
      );

      expect(result.current.runtimeState).toBe("unavailable");

      let descriptor: any = null;
      await act(async () => {
        descriptor = await result.current.reconnectToWorkspace({
          port: 4200,
          token: "new-token",
          generation: 3,
        });
      });

      expect(descriptor).toMatchObject({ id: "workspace-3", generation: 3 });
      expect(candidateClient.connect).toHaveBeenCalledOnce();
      expect(result.current.runtimeState).toBe("ready");
      expect(result.current.isOperational).toBe(true);
    });

    it("transitions to needs_attention on non-retryable workspace error while preserving session", async () => {
      const mockClient = createMockClient(1);
      mockClient.readDir = vi.fn().mockRejectedValue(new Error("EACCES: permission denied, scandir 'C:\\restricted'"));

      const { result } = renderHook(() =>
        useHostSession({
          settings: { enabled: true, port: 4183, token: "token-1" },
          createClient: () => mockClient,
        })
      );

      await waitFor(() => expect(result.current.runtimeState).toBe("healthy"));

      await act(async () => {
        const entries = await result.current.readWorkspaceDirectory("/restricted");
        expect(entries).toBeNull();
      });

      expect(result.current.runtimeState).toBe("needs_attention");
      expect(result.current.lastError).toContain("permission denied");
    });

    it("handles origin mismatch without retrying and surfaces diagnostic message", async () => {
      const mockClient = createMockClient(1, {
        connectFn: vi.fn().mockRejectedValue(new HostOriginMismatchError("origin mismatch")),
      });

      const { result } = renderHook(() =>
        useHostSession({
          settings: { enabled: true, port: 4183, token: "token-1" },
          createClient: () => mockClient,
        })
      );

      await waitFor(() => {
        expect(result.current.runtimeState).toBe("needs_attention");
        expect(result.current.lastError).toContain("Origin mismatch");
      });
    });
  });
});
