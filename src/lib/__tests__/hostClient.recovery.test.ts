import { describe, expect, it, vi } from "vitest";
import {
  HostClient,
  HostAuthError,
  HostOriginMismatchError,
  calculateBackoffDelay,
  type WebSocketLike,
} from "@/lib/hostClient";

describe("HostClient Recovery & Diagnostics", () => {
  describe("calculateBackoffDelay", () => {
    it("calculates exponential growth with upper bounds", () => {
      const fixedRandom = () => 0; // zero jitter for exact base checks
      expect(calculateBackoffDelay(0, 500, 10000, 0.25, fixedRandom)).toBe(500);
      expect(calculateBackoffDelay(1, 500, 10000, 0.25, fixedRandom)).toBe(1000);
      expect(calculateBackoffDelay(2, 500, 10000, 0.25, fixedRandom)).toBe(2000);
      expect(calculateBackoffDelay(3, 500, 10000, 0.25, fixedRandom)).toBe(4000);
      expect(calculateBackoffDelay(4, 500, 10000, 0.25, fixedRandom)).toBe(8000);
      // Capped at 10000ms max
      expect(calculateBackoffDelay(5, 500, 10000, 0.25, fixedRandom)).toBe(10000);
      expect(calculateBackoffDelay(10, 500, 10000, 0.25, fixedRandom)).toBe(10000);
      expect(calculateBackoffDelay(50, 500, 10000, 0.25, fixedRandom)).toBe(10000);
    });

    it("applies jitter bounded within jitterFactor", () => {
      const maxRandom = () => 1.0; // max jitter
      const delay = calculateBackoffDelay(0, 500, 10000, 0.25, maxRandom);
      // 500 + 500 * 0.25 * 1.0 = 625
      expect(delay).toBe(625);

      const halfRandom = () => 0.5;
      const delayHalf = calculateBackoffDelay(1, 500, 10000, 0.25, halfRandom);
      // 1000 + 1000 * 0.25 * 0.5 = 1125
      expect(delayHalf).toBe(1125);
    });
  });

  describe("HostOriginMismatchError", () => {
    it("provides clear user-facing diagnostics without exposing raw tokens or secrets", () => {
      const err = new HostOriginMismatchError("unauthorized origin: origin mismatch");
      expect(err).toBeInstanceOf(HostAuthError);
      expect(err.name).toBe("HostOriginMismatchError");
      expect(err.code).toBe(4401);
      expect(err.message).toContain("Origin mismatch");
      expect(err.message).toContain("authorized launcher origin");
      expect(err.message).not.toContain("token=");
      expect(err.message).not.toContain("secret");
    });

    it("detects origin mismatch on close with code 4401 and origin reason", async () => {
      const mockWs: WebSocketLike = {
        readyState: 0,
        send: vi.fn(),
        close: vi.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };

      const factory = () => {
        setTimeout(() => {
          mockWs.onclose?.({ code: 4401, reason: "unauthorized origin: origin mismatch" });
        }, 10);
        return mockWs;
      };

      const client = new HostClient({
        port: 4183,
        token: "test-token",
        WebSocketImpl: factory,
      });

      const events: any[] = [];
      client.onEvent((ev) => events.push(ev));

      await expect(client.connect()).rejects.toThrow(HostOriginMismatchError);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "error",
          code: "origin_mismatch",
        })
      );
    });
  });

  describe("connectWithRetry", () => {
    it("retries on transient connection errors with backoff", async () => {
      let attempts = 0;
      const retryLog: { attempt: number; delay: number }[] = [];

      const mockWs: WebSocketLike = {
        readyState: 0,
        send: vi.fn(),
        close: vi.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };

      const factory = () => {
        attempts++;
        const socket = { ...mockWs };
        setTimeout(() => {
          if (attempts < 3) {
            socket.onclose?.({ code: 1006, reason: "Connection refused" });
          } else {
            socket.readyState = 1;
            socket.onopen?.({});
          }
        }, 5);
        return socket;
      };

      const client = new HostClient({
        port: 4183,
        token: "test-token",
        WebSocketImpl: factory,
        initialBackoffMs: 10,
        maxBackoffMs: 50,
      });

      await client.connectWithRetry({
        maxAttempts: 4,
        initialDelayMs: 10,
        maxDelayMs: 50,
        onRetry: (att, delay) => retryLog.push({ attempt: att, delay }),
      });

      expect(attempts).toBe(3);
      expect(retryLog.length).toBe(2);
      expect(client.connected).toBe(true);
    });

    it("fails immediately on HostOriginMismatchError without retrying", async () => {
      let attempts = 0;
      const mockWs: WebSocketLike = {
        readyState: 0,
        send: vi.fn(),
        close: vi.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };

      const factory = () => {
        attempts++;
        const socket = { ...mockWs };
        setTimeout(() => {
          socket.onclose?.({ code: 4401, reason: "unauthorized origin: mismatch" });
        }, 5);
        return socket;
      };

      const client = new HostClient({
        port: 4183,
        token: "test-token",
        WebSocketImpl: factory,
      });

      await expect(client.connectWithRetry({ maxAttempts: 5 })).rejects.toThrow(
        HostOriginMismatchError
      );
      expect(attempts).toBe(1); // No retries for origin mismatch
    });
  });

  describe("verifyWorkspaceGeneration", () => {
    it("returns descriptor when generation matches expected", async () => {
      const mockWs: WebSocketLike = {
        readyState: 1, // WS_OPEN
        send: vi.fn((data: string) => {
          const parsed = JSON.parse(data);
          if (parsed.type === "workspace.describe") {
            setTimeout(() => {
              mockWs.onmessage?.({
                data: JSON.stringify({
                  type: "workspace.ready",
                  requestId: parsed.requestId,
                  workspace: {
                    id: "workspace-123",
                    name: "test-workspace",
                    displayPath: "/test/path",
                    generation: 4,
                    capabilities: { read: true, stat: true, watch: true, search: true, git: true, terminal: true, subagents: true, memory: true, reviewedWrite: true },
                  },
                }),
              });
            }, 5);
          }
        }),
        close: vi.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };

      const client = new HostClient({
        port: 4183,
        token: "test-token",
        WebSocketImpl: () => mockWs,
      });

      const pConnect = client.connect();
      mockWs.onopen?.({});
      await pConnect;

      const descriptor = await client.verifyWorkspaceGeneration(4);
      expect(descriptor.generation).toBe(4);
      expect(descriptor.id).toBe("workspace-123");
    });

    it("rejects when generation does not match expected", async () => {
      const mockWs: WebSocketLike = {
        readyState: 1,
        send: vi.fn((data: string) => {
          const parsed = JSON.parse(data);
          if (parsed.type === "workspace.describe") {
            setTimeout(() => {
              mockWs.onmessage?.({
                data: JSON.stringify({
                  type: "workspace.ready",
                  requestId: parsed.requestId,
                  workspace: {
                    id: "workspace-123",
                    name: "test-workspace",
                    displayPath: "/test/path",
                    generation: 3, // Stale generation
                    capabilities: { read: true, stat: true, watch: true, search: true, git: true, terminal: true, subagents: true, memory: true, reviewedWrite: true },
                  },
                }),
              });
            }, 5);
          }
        }),
        close: vi.fn(),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };

      const client = new HostClient({
        port: 4183,
        token: "test-token",
        WebSocketImpl: () => mockWs,
      });

      const pConnect = client.connect();
      mockWs.onopen?.({});
      await pConnect;

      await expect(client.verifyWorkspaceGeneration(4)).rejects.toThrow(
        /Workspace generation mismatch: expected generation 4, got 3/
      );
    });
  });
});
