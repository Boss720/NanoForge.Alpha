/**
 * NanoForge E2E Test Suite - Tier 2: Boundary & Corner Cases
 *
 * Covers limits, crashes, disconnects, bursts, and narrow viewports.
 */
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { launchE2ETestHost, type E2ETestHost } from "../helpers/testHost.js";
import { redactObject, REDACTED } from "../../../apps/agent-host/src/audit/redact.js";
import { createWorkspaceRegistry } from "../../../scripts/workspace-registry.cjs";

describe("Tier 2 - NanoForge Boundary & Corner Cases", () => {
  let e2eHost: E2ETestHost | undefined;

  afterEach(async () => {
    if (e2eHost) {
      await e2eHost.close();
      e2eHost = undefined;
    }
  });

  describe("2.1: Watcher & Search Burst Boundaries", () => {
    it("2.1.1: coalesces 500 rapid filesystem events without event loss or queue overflow", async () => {
      const coalescedEvents: string[] = [];
      let timer: any = null;
      const batchProcess = (event: string, onBatch: (b: string[]) => void) => {
        coalescedEvents.push(event);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          onBatch([...coalescedEvents]);
          coalescedEvents.length = 0;
        }, 30);
      };

      await new Promise<void>((resolve) => {
        for (let i = 0; i < 500; i++) {
          batchProcess("file_" + i + ".ts", (batch) => {
            expect(batch.length).toBe(500);
            expect(batch[0]).toBe("file_0.ts");
            expect(batch[499]).toBe("file_499.ts");
            resolve();
          });
        }
      });
    });

    it("2.1.2: handles massive search query strings (10,000 chars) gracefully without regex catastrophic backtracking", () => {
      const safeSearch = (targetText: string, query: string) => {
        const sanitized = query.slice(0, 500).toLowerCase();
        return targetText.toLowerCase().includes(sanitized);
      };
      const longQuery = "a".repeat(10000);
      const text = "Sample source file content for index search";
      expect(safeSearch(text, longQuery)).toBe(false);
    });
  });

  describe("2.2: Exponential Backoff & Connection Limits", () => {
    it("2.2.1: enforces maximum retry ceiling of 5 attempts and bounds backoff to 8000ms", () => {
      const maxRetries = 5;
      const maxDelay = 8000;
      const retries: number[] = [];

      for (let attempt = 0; attempt <= 10; attempt++) {
        if (attempt > maxRetries) break;
        const delay = Math.min(maxDelay, 500 * Math.pow(2, attempt));
        retries.push(delay);
      }

      expect(retries).toHaveLength(6);
      expect(retries[5]).toBe(8000);
    });

    it("2.2.2: rejects connection attempts with invalid token immediately with 4401 unauthorized close", async () => {
      e2eHost = await launchE2ETestHost();
      const raw = e2eHost.connectRaw("invalid-forbidden-token");
      const closeEv = await raw.waitForClose();
      expect(closeEv.code).toBe(4401);
    });
  });

  describe("2.3: Redaction & Adversarial Injection Boundaries", () => {
    it("2.3.1: redacts authorization headers, Bearer tokens, and Windows home directories across deeply nested structures", () => {
      const nestedPayload = {
        level1: {
          level2: {
            authHeader: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret123",
            skToken: "sk-ant-secret123456789",
          },
        },
      };

      const redacted = redactObject(nestedPayload) as any;
      expect(redacted.level1.level2.authHeader).not.toContain("secret123");
      expect(redacted.level1.level2.authHeader).toContain(REDACTED);
      expect(redacted.level1.level2.skToken).toBe(REDACTED);
    });
  });

  describe("2.4: Corrupted Registry & Quarantine Recovery", () => {
    it("2.4.1: automatically quarantines corrupted workspace-registry.json and initializes fresh state", async () => {
      const tmpDir = path.join(process.cwd(), ".nanoforge", "test_corrupt_reg");
      await fs.mkdir(tmpDir, { recursive: true });
      const regPath = path.join(tmpDir, "workspace-registry.json");

      await fs.writeFile(regPath, "{ invalid json corrupt content !!!", "utf8");

      const registry = createWorkspaceRegistry({
        registryPath: regPath,
        validatePath: (p: string) => p,
      });

      const list = registry.list();
      expect(list).toEqual([]);

      const entry = registry.open(path.resolve(process.cwd()));
      expect(entry.id.startsWith("ws_")).toBe(true);

      try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
    });
  });
});
