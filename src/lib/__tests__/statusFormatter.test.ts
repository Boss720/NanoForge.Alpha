import { describe, it, expect } from "vitest";
import {
  formatErrorMessage,
  getApiStatusMeta,
  getRuntimeStatusMeta,
  getToolRunStatusMeta,
} from "../statusFormatter";

describe("statusFormatter — Jargon-Free Error Formatting & Multi-Modal Status Semantics", () => {
  describe("formatErrorMessage", () => {
    it("handles null, undefined, and empty errors gracefully", () => {
      expect(formatErrorMessage(null)).toBe("An unknown error occurred.");
      expect(formatErrorMessage(undefined)).toBe("An unknown error occurred.");
      expect(formatErrorMessage("")).toBe("An unknown error occurred.");
    });

    it("redacts raw WebSocket error code 4401 and translates to friendly authentication notice", () => {
      const raw = "WebSocket connection closed with code 4401: Unauthorized";
      const formatted = formatErrorMessage(raw);
      expect(formatted).not.toContain("4401");
      expect(formatted).toContain("Authentication required");
    });

    it("redacts raw WebSocket error code 4400 and translates to invalid request notice", () => {
      const raw = "Error: WebSocket closed with 4400 invalid protocol message frame";
      const formatted = formatErrorMessage(raw);
      expect(formatted).not.toContain("4400");
      expect(formatted).toContain("Invalid request");
    });

    it("redacts raw WebSocket error code 1006 / ECONNREFUSED and translates to host unreachable notice", () => {
      const raw = "connect ECONNREFUSED 127.0.0.1:49212 (code 1006)";
      const formatted = formatErrorMessage(raw);
      expect(formatted).not.toContain("1006");
      expect(formatted).toContain("Host unreachable");
    });

    it("redacts raw WebSocket error code 1001 (Going Away) and translates to host disconnected notice", () => {
      const raw = "Connection closed (1001 Going Away): Host shutting down";
      const formatted = formatErrorMessage(raw);
      expect(formatted).not.toContain("1001");
      expect(formatted).toContain("Host disconnected");
    });

    it("redacts auth tokens and query string parameters in error messages", () => {
      const raw = "Failed connecting to ws://127.0.0.1:4040/agent?token=dry-run-token-9876543210-abcdef";
      const formatted = formatErrorMessage(raw);
      expect(formatted).not.toContain("dry-run-token-9876543210-abcdef");
      expect(formatted).toContain("token=[redacted]");
      expect(formatted).not.toContain(":4040");
    });

    it("redacts API keys in error strings", () => {
      const raw = "Provider rejected authorization with key sk-live-ultra-secret-1234567890";
      const formatted = formatErrorMessage(raw);
      expect(formatted).not.toContain("sk-live-ultra-secret-1234567890");
      expect(formatted).toContain("sk-[redacted]");
    });

    it("redacts raw Windows and Unix filesystem paths from errors", () => {
      const rawWin = "Failed to access file at C:\\Users\\Hp\\Documents\\secret-project\\src\\main.ts";
      const formattedWin = formatErrorMessage(rawWin);
      expect(formattedWin).not.toContain("C:\\Users\\Hp\\Documents");
      expect(formattedWin).toContain("[workspace folder]");

      const rawUnix = "ENOENT: no such file or directory /home/user/myproject/config.json";
      const formattedUnix = formatErrorMessage(rawUnix);
      expect(formattedUnix).not.toContain("/home/user/myproject");
      expect(formattedUnix).toContain("[workspace folder]");
    });
  });

  describe("Multi-modal status metadata", () => {
    it("provides multi-modal metadata for all API connection statuses", () => {
      const connectedMeta = getApiStatusMeta("connected");
      expect(connectedMeta.label).toBe("API live");
      expect(connectedMeta.icon).toBeDefined();
      expect(connectedMeta.colorClass).toContain("emerald");
      expect(connectedMeta.dotClass).toContain("bg-emerald");

      const errorMeta = getApiStatusMeta("error");
      expect(errorMeta.label).toBe("API error");
      expect(errorMeta.icon).toBeDefined();
      expect(errorMeta.colorClass).toContain("red");

      const demoMeta = getApiStatusMeta("disconnected");
      expect(demoMeta.label).toBe("API demo");
      expect(demoMeta.icon).toBeDefined();
    });

    it("provides multi-modal metadata for all Local Runtime statuses", () => {
      const statuses = ["ready", "connecting", "error", "unavailable", "no-workspace", "offline"] as const;
      for (const status of statuses) {
        const meta = getRuntimeStatusMeta(status);
        expect(typeof meta.label).toBe("string");
        expect(meta.label.length).toBeGreaterThan(0);
        expect(meta.icon).toBeDefined();
        expect(meta.colorClass).toBeDefined();
        expect(meta.dotClass).toBeDefined();
        expect(meta.description).toBeDefined();
      }
    });

    it("provides multi-modal metadata for tool run states", () => {
      const states = ["queued", "approval_required", "running", "done", "error", "cancelled"] as const;
      for (const state of states) {
        const meta = getToolRunStatusMeta(state);
        expect(typeof meta.label).toBe("string");
        expect(meta.icon).toBeDefined();
        expect(meta.colorClass).toBeDefined();
      }
    });
  });
});
