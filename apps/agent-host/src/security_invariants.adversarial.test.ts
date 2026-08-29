/**
 * NanoForge Backend Security Invariants & Adversarial Penetration Test Suite
 * 
 * Challenger 1 Verification:
 * - Invariant 2: WebSocket Origin Validation (Unauthorized origins rejected with 4401 / 403)
 * - Invariant 3: Path Traversal & Symlink Escapes (Strict workspace confinement & SecurityError)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { WebSocket as NativeWebSocket } from "ws";

import {
  isAllowedOrigin,
  createHost,
  CLOSE_UNAUTHORIZED,
  type HostHandle,
} from "./server";

import {
  resolveWorkspacePath,
  isWithinWorkspace,
  resolveWithinWorkspace,
  SecurityError,
  sanitizePathString,
  DEFAULT_POLICY,
  authorize,
} from "./policy/policy";

function waitForClose(ws: NativeWebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.on("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

function agentUrl(host: HostHandle, token = host.token): string {
  return `ws://127.0.0.1:${host.port}/agent?token=${encodeURIComponent(token)}`;
}

describe("Challenger 1 — Backend Security Invariants", () => {
  /* ======================================================================== */
  /* Invariant 2: WebSocket Origin Validation & Unauthorized Rejections       */
  /* ======================================================================== */
  describe("Invariant 2: WebSocket Origin Validation", () => {
    let host: HostHandle | undefined;

    afterEach(async () => {
      if (host) {
        await host.close(500);
        host = undefined;
      }
    });

    it("2.1: isAllowedOrigin strictly evaluates origin strings against allowlist", () => {
      // 1. Legitimate exact allowed origins
      expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
      expect(isAllowedOrigin("http://127.0.0.1:3000")).toBe(true);
      expect(isAllowedOrigin("http://localhost:4173")).toBe(true);
      expect(isAllowedOrigin("http://127.0.0.1:4173")).toBe(true);
      expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
      expect(isAllowedOrigin("http://127.0.0.1:4040")).toBe(true);
      expect(isAllowedOrigin("https://nano-gpt.com")).toBe(true);

      // 2. Reject missing / null / CLI origins by default unless explicit transport mode is requested
      expect(isAllowedOrigin(undefined)).toBe(false);
      expect(isAllowedOrigin("null")).toBe(false);
      expect(isAllowedOrigin(undefined, undefined, true)).toBe(true); // explicit CLI transport mode
      expect(isAllowedOrigin("null", undefined, true)).toBe(true);

      // 3. Reject wrong ports and unrelated localhost-like origins
      expect(isAllowedOrigin("http://localhost:9999")).toBe(false);
      expect(isAllowedOrigin("http://127.0.0.1:8080")).toBe(false);
      expect(isAllowedOrigin("http://localhost.evil.com")).toBe(false);
      expect(isAllowedOrigin("http://127.0.0.1.evil.com")).toBe(false);

      // 4. Reject arbitrary *.nano-gpt.com subdomains
      expect(isAllowedOrigin("https://staging.nano-gpt.com")).toBe(false);
      expect(isAllowedOrigin("https://app.nano-gpt.com")).toBe(false);
      expect(isAllowedOrigin("https://evil.nano-gpt.com")).toBe(false);
      expect(isAllowedOrigin("http://attacker-nano-gpt.com")).toBe(false);
      expect(isAllowedOrigin("https://nano-gpt.com.attacker.com")).toBe(false);

      // 5. Malicious and external origins
      expect(isAllowedOrigin("http://malicious-site.com")).toBe(false);
      expect(isAllowedOrigin("https://evil-attacker.io")).toBe(false);
      expect(isAllowedOrigin("http://pwned.org")).toBe(false);

      // 6. Non-HTTP / malformed origins
      expect(isAllowedOrigin("javascript:void(0)")).toBe(false);
      expect(isAllowedOrigin("data:text/html,bad")).toBe(false);
      expect(isAllowedOrigin(":::malformed")).toBe(false);
    });

    it("2.2: Live WebSocket server actively rejects connections with unauthorized Origin header (code 4401)", async () => {
      host = await createHost({ logger: false });

      const attackOrigins = [
        "http://malicious-site.com",
        "https://evil-attacker.io",
        "http://attacker-nano-gpt.com",
        "https://nano-gpt.com.attacker.com",
        "http://127.0.0.1.evil.com",
        "https://evil.nano-gpt.com",
        "http://localhost:9999",
      ];

      for (const attackOrigin of attackOrigins) {
        const freshToken = host.tokenStore.issue();
        const ws = new NativeWebSocket(agentUrl(host, freshToken), {
          headers: { Origin: attackOrigin },
        });

        const { code, reason } = await waitForClose(ws);
        expect(code).toBe(CLOSE_UNAUTHORIZED); // 4401
        expect(reason).toContain("unauthorized origin");
      }
    });

    it("2.3: Live WebSocket server accepts connections with valid authorized Origin headers", async () => {
      host = await createHost({ logger: false });

      const validOrigins = [
        "https://nano-gpt.com",
        "http://localhost:3000",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:5173",
        "http://127.0.0.1:4040",
      ];

      for (const origin of validOrigins) {
        const freshToken = host.tokenStore.issue();
        const ws = new NativeWebSocket(agentUrl(host, freshToken), {
          headers: { Origin: origin },
        });

        const opened = await new Promise<boolean>((resolve) => {
          ws.on("open", () => resolve(true));
          ws.on("close", () => resolve(false));
        });

        expect(opened).toBe(true);
        ws.close();
      }
    });
  });

  /* ======================================================================== */
  /* Invariant 3: Path Traversal, Encoding Bypasses & Symlink Escapes          */
  /* ======================================================================== */
  describe("Invariant 3: Path Traversal & Symlink Escapes", () => {
    let workspaceRoot: string;

    beforeEach(() => {
      workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nanoforge-sec-test-"));
      fs.mkdirSync(path.join(workspaceRoot, "subfolder"), { recursive: true });
      fs.writeFileSync(path.join(workspaceRoot, "subfolder", "valid.txt"), "hello world", "utf-8");
    });

    afterEach(() => {
      try {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
      } catch {}
    });

    it("3.1: Blocks standard dot-dot relative path traversal", () => {
      const escapeAttempts = [
        "../outside.txt",
        "../../etc/passwd",
        "..\\..\\Windows\\System32",
        "subfolder/../../outside.txt",
        "./subfolder/../../../outside.txt",
      ];

      for (const attempt of escapeAttempts) {
        expect(() => resolveWorkspacePath(workspaceRoot, attempt)).toThrow(SecurityError);
        expect(isWithinWorkspace(attempt, workspaceRoot)).toBe(false);
        expect(resolveWithinWorkspace(workspaceRoot, attempt)).toBeNull();
      }
    });

    it("3.2: Blocks single, double, and multi-URL-encoded traversal bypasses", () => {
      const encodedVectors = [
        "%2e%2e%2foutside.txt",
        "%2e%2e%5coutside.txt",
        "%252e%252e%252foutside.txt", // double-encoded
        "%252e%252e%255coutside.txt",
        "%25252e%25252e%25252fsecret.txt", // triple-encoded
        "subfolder%2f..%2f..%2foutside.txt",
        "subfolder%252f%252e%252e%252f%252e%252e%252foutside.txt",
      ];

      for (const vector of encodedVectors) {
        expect(() => resolveWorkspacePath(workspaceRoot, vector)).toThrow(SecurityError);
      }
    });

    it("3.3: Rejects null-byte injection attempts in path resolution", () => {
      const rawNullVectors = [
        "valid.txt\0/../../outside.txt",
        "\0../outside.txt",
      ];

      for (const vector of rawNullVectors) {
        expect(() => resolveWorkspacePath(workspaceRoot, vector)).toThrow(SecurityError);
      }

      const encodedNullVectors = [
        "subfolder/valid.txt%00.png",
        "subfolder%2500/escape.txt",
      ];

      for (const vector of encodedNullVectors) {
        expect(() => resolveWorkspacePath(workspaceRoot, vector)).toThrow(/null bytes/i);
      }
    });

    it("3.4: Blocks absolute paths pointing outside the workspace", () => {
      const outsidePath = path.resolve(workspaceRoot, "..", "attacker_dir");
      expect(() => resolveWorkspacePath(workspaceRoot, outsidePath)).toThrow(SecurityError);
      expect(isWithinWorkspace(outsidePath, workspaceRoot)).toBe(false);

      if (process.platform === "win32") {
        expect(() => resolveWorkspacePath(workspaceRoot, "C:\\Windows\\System32\\calc.exe")).toThrow(SecurityError);
        expect(() => resolveWorkspacePath(workspaceRoot, "D:\\Secret\\Data")).toThrow(SecurityError);
      } else {
        expect(() => resolveWorkspacePath(workspaceRoot, "/etc/shadow")).toThrow(SecurityError);
      }
    });

    it("3.5: Prevents symlink breakout attacks pointing outside the workspace", () => {
      const externalTargetDir = fs.mkdtempSync(path.join(os.tmpdir(), "nanoforge-ext-secret-"));
      fs.writeFileSync(path.join(externalTargetDir, "confidential.key"), "CONFIDENTIAL_KEY_DATA", "utf-8");

      const symlinkPathInWorkspace = path.join(workspaceRoot, "symlink_dir");

      try {
        // Create symlink inside workspace pointing to external directory
        fs.symlinkSync(externalTargetDir, symlinkPathInWorkspace, "junction");

        // Attempting to resolve paths through the symlink to read/write external target
        expect(() => resolveWorkspacePath(workspaceRoot, "symlink_dir/confidential.key")).toThrow(SecurityError);
        expect(isWithinWorkspace(path.join(symlinkPathInWorkspace, "confidential.key"), workspaceRoot)).toBe(false);
      } catch (err: any) {
        // Windows non-admin without Developer Mode might fail symlink creation with EPERM
        if (err.code !== "EPERM") {
          throw err;
        }
      } finally {
        try {
          fs.rmSync(externalTargetDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it("3.6: Successfully allows and canonicalizes legitimate in-workspace paths and internal symlinks", () => {
      const resolved = resolveWorkspacePath(workspaceRoot, "subfolder/valid.txt");
      expect(resolved).toBe(path.resolve(workspaceRoot, "subfolder", "valid.txt"));
      expect(isWithinWorkspace("subfolder/valid.txt", workspaceRoot)).toBe(true);

      const target = resolveWithinWorkspace(workspaceRoot, "subfolder");
      expect(target).toBe(path.resolve(workspaceRoot, "subfolder"));
    });

    it("3.7: Policy engine strictly denies tool execution proposals with escaped working directories", () => {
      const deniedExec = authorize(
        {
          kind: "terminal.exec",
          cwd: "../../escaped",
          executable: "git",
          args: ["status"],
        },
        DEFAULT_POLICY
      );
      expect(deniedExec).toBe("deny");
    });
  });
});
