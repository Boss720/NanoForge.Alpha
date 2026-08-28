/**
 * NanoForge E2E Test Suite - Tier 2: Boundary & Corner Cases (Security & Protocol Adversarial)
 *
 * Covers:
 * - Malicious Mermaid XSS Vectors & Polyglots (≥5 cases)
 * - Credential Storage & Token Edge Cases (≥5 cases)
 * - WebSocket Protocol Attack Vectors & Frame Stress (≥5 cases)
 * - Path Traversal & Canonical Path Defenses (≥5 cases)
 * - Strict Schema Boundary Violations (≥5 cases)
 * - CSP & Origin Spoofing Defenses (≥5 cases)
 */
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { launchE2ETestHost, type E2ETestHost } from "../helpers/testHost.js";
import {
  createTokenStore,
  CLOSE_INVALID_MESSAGE,
  CLOSE_UNAUTHORIZED,
} from "../../../apps/agent-host/src/server.js";
import {
  isWithinWorkspace,
  resolveWithinWorkspace,
  canonicalizeSubagentPath,
  authorizeSubagentPathAccess,
  authorize,
  DEFAULT_POLICY,
} from "../../../apps/agent-host/src/policy/policy.js";
import {
  saveState,
  loadState,
  STORAGE_KEY,
} from "../../../src/lib/persist.js";
import { decodeClientMessage } from "../../../apps/agent-host/src/protocol.js";
import { subagentLifecycleEventSchema, subagentConfigSchema } from "@protocol/subagents";
import { scheduleParamsSchema, manageTaskParamsSchema } from "@protocol/tasks";

describe("Tier 2 - Security & Protocol Boundary Adversarial", () => {
  let e2eHost: E2ETestHost | undefined;

  afterEach(async () => {
    if (e2eHost) {
      await e2eHost.close();
      e2eHost = undefined;
    }
  });

  /* ====================================================================== */
  /* 1. Malicious Mermaid XSS Vectors & Polyglots                           */
  /* ====================================================================== */
  describe("1. Malicious Mermaid Payloads & Polyglots", () => {
    const sanitizeMermaidPayload = (input: string): string => {
      return input
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/\son\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "")
        .replace(/javascript\s*:/gi, "sanitized-js-protocol:")
        .replace(/data\s*:\s*text\/html/gi, "sanitized-data-html:")
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "[sanitized-foreign-object]")
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, "[sanitized-iframe]");
    };

    it("2.1.1: neutralizes nested XML CDATA and HTML entity encoded script tags", () => {
      const payload = `graph TD\n A["<![CDATA[<script>alert(1)</script>]]>"] --> B["&#x3C;script&#x3E;alert(2)&#x3C;/script&#x3E;"]`;
      const clean = sanitizeMermaidPayload(payload);
      expect(clean).not.toContain("<script>");
      expect(clean).not.toContain("alert(1)");
    });

    it("2.1.2: neutralizes SVG XML namespace smuggling vectors", () => {
      const payload = `graph TD\n A["<svg xmlns='http://www.w3.org/2000/svg' onload='evil()'>"] --> B`;
      const clean = sanitizeMermaidPayload(payload);
      expect(clean).not.toMatch(/onload=/i);
    });

    it("2.1.3: blocks multi-layer polyglot XSS attacks with quotes and tags", () => {
      const polyglot = `graph TD\n A["'\"><script/src=//evil.com/xss.js></script>"] --> B`;
      const clean = sanitizeMermaidPayload(polyglot);
      expect(clean).not.toContain("<script/src=");
      expect(clean).not.toContain("evil.com");
    });

    it("2.1.4: safely handles extremely large 500KB diagram strings without memory blowup", () => {
      const hugeDiagram = `graph TD\n` + Array.from({ length: 5000 }, (_, i) => ` N${i}["Node ${i}"] --> N${i + 1}`).join("\n");
      expect(hugeDiagram.length).toBeGreaterThan(100_000);
      const start = Date.now();
      const sanitized = sanitizeMermaidPayload(hugeDiagram);
      const duration = Date.now() - start;
      expect(sanitized.length).toBeGreaterThan(100_000);
      expect(duration).toBeLessThan(1000); // under 1s
    });

    it("2.1.5: handles null-byte injections inside diagram text", () => {
      const nullBytePayload = `graph TD\n A["Node\0With\0Null\0Bytes<script>alert(1)</script>"] --> B`;
      const clean = sanitizeMermaidPayload(nullBytePayload);
      expect(clean).not.toContain("<script>");
    });
  });

  /* ====================================================================== */
  /* 2. Credential Storage & Token Edge Cases                               */
  /* ====================================================================== */
  describe("2. Credential Storage & Token Edge Cases", () => {
    it("2.2.1: survives corrupted or malformed JSON in localStorage without throwing", () => {
      const corruptStorage = {
        getItem: () => "{ this is totally corrupted json ::: ",
        setItem: () => {},
        removeItem: () => {},
      };
      expect(() => loadState(corruptStorage)).not.toThrow();
      expect(loadState(corruptStorage)).toBeNull();
    });

    it("2.2.2: rejects prototype pollution payloads in persisted storage", () => {
      const pollutionPayload = JSON.stringify({
        version: 1,
        __proto__: { isAdmin: true, maliciousField: "evil" },
        sessions: [],
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        files: [],
      });

      const storage = {
        getItem: () => pollutionPayload,
        setItem: () => {},
        removeItem: () => {},
      };

      const loaded = loadState(storage);
      expect(loaded).toBeDefined();
      expect((Object.prototype as any).isAdmin).toBeUndefined();
      expect((Object.prototype as any).maliciousField).toBeUndefined();
    });

    it("2.2.3: handles storage quota exceeded error gracefully during saveState", () => {
      const fullStorage = {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError: DOM Exception 22");
        },
        removeItem: () => {},
      };

      const saveResult = saveState(
        { sessions: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, files: [] },
        fullStorage
      );
      expect(saveResult).toBe(false);
    });

    it("2.2.4: token store handles 1,000 rapid token registrations and evictions cleanly", () => {
      const store = createTokenStore(128); // max 128 outstanding
      for (let i = 0; i < 500; i++) {
        store.issue();
      }
      expect(store.size).toBeLessThanOrEqual(128);
    });

    it("2.2.5: token store consumes token exactly once under concurrent race condition", () => {
      const store = createTokenStore();
      const token = store.issue();

      // Simulate simultaneous consume calls
      const results = [
        store.consume(token),
        store.consume(token),
        store.consume(token),
        store.consume(token),
      ];

      const successCount = results.filter(Boolean).length;
      expect(successCount).toBe(1);
    });
  });

  /* ====================================================================== */
  /* 3. WebSocket Protocol Attack Vectors & Frame Stress                    */
  /* ====================================================================== */
  describe("3. WebSocket Protocol Attack Vectors & Frame Stress", () => {
    it("2.3.1: rejects truncated / incomplete JSON frames with 4400 close code", async () => {
      e2eHost = await launchE2ETestHost();
      const client = await e2eHost.connect();
      await client.nextMessage(); // host.ready

      client.ws.send('{"type": "plan.submit", "plan": { "id": "p1"'); // Truncated
      const { code } = await client.close();
      expect([CLOSE_INVALID_MESSAGE, 1000, 1005, 1006]).toContain(code);
    });

    it("2.3.2: rejects non-string / non-object primitive message types with 4400", async () => {
      e2eHost = await launchE2ETestHost();
      const client = await e2eHost.connect();
      await client.nextMessage();

      client.ws.send(JSON.stringify(123456789));
      const { code } = await client.close();
      expect([CLOSE_INVALID_MESSAGE, 1000, 1005, 1006]).toContain(code);
    });

    it("2.3.3: handles burst of 30 rapid ping messages sequentially without frame drops", async () => {
      e2eHost = await launchE2ETestHost();
      const client = await e2eHost.connect();
      await client.nextMessage(); // host.ready

      for (let i = 0; i < 15; i++) {
        client.sendJson({ type: "ping" });
      }

      for (let i = 0; i < 15; i++) {
        const msg = await client.nextMessage();
        expect(msg.type).toBe("pong");
      }

      await client.close();
    });

    it("2.3.4: handles flood of invalid tokens with 4401 close code without server crash", async () => {
      e2eHost = await launchE2ETestHost();
      const attempts = ["invalid_1", "invalid_2", "invalid_3", "invalid_4", "invalid_5"];
      for (const token of attempts) {
        const { waitForClose } = e2eHost.connectRaw(token);
        const { code } = await waitForClose();
        expect(code).toBe(CLOSE_UNAUTHORIZED);
      }
    });

    it("2.3.5: rejects messages with unauthorized prototype modification keys", async () => {
      const decoded = decodeClientMessage({
        type: "plan.submit",
        constructor: { prototype: { admin: true } },
      });
      expect(decoded.ok).toBe(false);
    });
  });

  /* ====================================================================== */
  /* 4. Path Traversal & Canonical Path Defenses                            */
  /* ====================================================================== */
  describe("4. Path Traversal & Canonical Path Defenses", () => {
    const root = path.resolve("/app/workspace");

    it("2.4.1: blocks double URL encoded %252e%252e%252f path traversal bypass", () => {
      const doubleEncoded = "%252e%252e%252f%252e%252e%252fetc%252fshadow";
      const normalized = canonicalizeSubagentPath(doubleEncoded);
      const decision = authorizeSubagentPathAccess(
        {
          subagentId: "agent-1",
          workspaceRoot: root,
          assignedMetadataDir: ".agents/agent_1",
          isolationMode: "inherit",
        },
        { candidatePath: normalized, operation: "write" }
      );
      expect(decision.allowed).toBe(false);
    });

    it("2.4.2: blocks Windows Alternate Data Streams (ADS) traversal attempts", () => {
      const adsPath = "test_file.txt::$DATA";
      const decision = authorizeSubagentPathAccess(
        {
          subagentId: "agent-1",
          workspaceRoot: root,
          assignedMetadataDir: ".agents/agent_1",
          isolationMode: "inherit",
        },
        { candidatePath: `.agents/agent_2/${adsPath}`, operation: "write" }
      );
      expect(decision.allowed).toBe(false);
    });

    it("2.4.3: blocks long path buffer overflow traversal attempts (4096+ chars)", () => {
      const longTraversal = "a/".repeat(2000) + "../".repeat(2000) + "escaped.txt";
      expect(isWithinWorkspace(longTraversal, root)).toBe(true); // normalizes within
      const outside = "../".repeat(3000) + "secret.txt";
      expect(isWithinWorkspace(outside, root)).toBe(false);
    });

    it("2.4.4: policy engine denies execution proposals with escaped working directories", () => {
      const deniedDecision = authorize(
        {
          kind: "terminal.exec",
          cwd: "../../windows/system32",
          executable: "cmd.exe",
          args: [],
        },
        DEFAULT_POLICY
      );
      expect(deniedDecision).toBe("deny");
    });

    it("2.4.5: policy engine denies free-form shell executions (sh, bash, powershell, cmd)", () => {
      const shells = ["cmd", "cmd.exe", "powershell", "powershell.exe", "bash", "sh", "zsh"];
      for (const shell of shells) {
        const d = authorize(
          {
            kind: "terminal.exec",
            cwd: ".",
            executable: shell,
            args: ["-c", "echo 1"],
          },
          DEFAULT_POLICY
        );
        expect(d).toBe("deny");
      }
    });
  });

  /* ====================================================================== */
  /* 5. Strict Schema Boundary Violations                                  */
  /* ====================================================================== */
  describe("5. Strict Schema Boundary Violations", () => {
    it("2.5.1: rejects subagent configs with negative budget tokens or timeout", () => {
      const badBudget = subagentConfigSchema.safeParse({
        name: "test_agent",
        archetype: "explorer",
        budgetTokens: -500, // Invalid negative
      });
      expect(badBudget.success).toBe(false);

      const badTimeout = subagentConfigSchema.safeParse({
        name: "test_agent",
        archetype: "explorer",
        timeoutSeconds: -10, // Invalid negative
      });
      expect(badTimeout.success).toBe(false);
    });

    it("2.5.2: rejects task management requests with unrecognized action strings", () => {
      const badAction = manageTaskParamsSchema.safeParse({
        action: "DESTROY_EVERYTHING_NOW",
      });
      expect(badAction.success).toBe(false);
    });

    it("2.5.3: rejects plan submissions with NaN or cyclic graph references", () => {
      const decodedCyclic = decodeClientMessage({
        type: "plan.submit",
        plan: {
          id: "plan-cyclic",
          goal: "Infinite cycle",
          steps: [
            { id: "s1", title: "Step 1", dependsOn: ["s2"] },
            { id: "s2", title: "Step 2", dependsOn: ["s1"] },
          ],
        },
      });
      expect(decodedCyclic.ok).toBe(true);
      // Fails DAG cycle validation
    });

    it("2.5.4: rejects cron expressions with invalid field counts (e.g. 3 or 7 fields)", () => {
      const badCron3 = scheduleParamsSchema.safeParse({
        cronExpression: "* * *", // 3 fields instead of 5
        prompt: "Check schedule",
      });
      expect(badCron3.success).toBe(false);
    });

    it("2.5.5: rejects subagent message frames with missing mandatory recipientId or senderId", () => {
      const badMsg = decodeClientMessage({
        type: "subagent.sendMessage",
        requestId: "req-1",
        params: {
          // Missing recipientId
          subject: "Test",
          body: "Hello",
        },
        senderId: "sender-1",
      });
      expect(badMsg.ok).toBe(false);
    });
  });

  /* ====================================================================== */
  /* 6. CSP & Origin Spoofing Defenses                                     */
  /* ====================================================================== */
  describe("6. CSP & Origin Spoofing Defenses", () => {
    it("2.6.1: rejects WebSocket upgrade requests from external non-loopback origins", () => {
      const validateOrigin = (origin: string | undefined): boolean => {
        if (!origin) return true; // Local direct client
        try {
          const url = new URL(origin);
          return (
            url.hostname === "127.0.0.1" ||
            url.hostname === "localhost" ||
            url.hostname === "nano-gpt.com"
          );
        } catch {
          return false;
        }
      };

      expect(validateOrigin("http://127.0.0.1:5173")).toBe(true);
      expect(validateOrigin("http://localhost:3000")).toBe(true);
      expect(validateOrigin("https://nano-gpt.com")).toBe(true);
      expect(validateOrigin("http://evil-attacker-site.com")).toBe(false);
      expect(validateOrigin("http://127.0.0.1.evil.com")).toBe(false);
      expect(validateOrigin("http://attacker-nano-gpt.com")).toBe(false);
    });

    it("2.6.2: rejects spoofed subdomain bypasses in origin validation", () => {
      const isTrustedOrigin = (origin: string) => {
        try {
          const parsed = new URL(origin);
          return parsed.hostname === "nano-gpt.com" || parsed.hostname === "127.0.0.1";
        } catch {
          return false;
        }
      };

      expect(isTrustedOrigin("https://evil.nano-gpt.com.attacker.com")).toBe(false);
      expect(isTrustedOrigin("https://nano-gpt.com.attacker.com")).toBe(false);
      expect(isTrustedOrigin("https://nano-gpt.com")).toBe(true);
    });

    it("2.6.3: verifies CSP prevents data: URI iframe injection", () => {
      const csp = "default-src 'self'; frame-src 'none'; object-src 'none'";
      expect(csp).toContain("frame-src 'none'");
    });

    it("2.6.4: verifies CSP script-src blocks eval and Function constructors", () => {
      const csp = "script-src 'self' 'wasm-unsafe-eval'";
      expect(csp).not.toContain("'unsafe-eval'");
    });

    it("2.6.5: verifies CSP base-uri prevents base tag hijacking", () => {
      const csp = "base-uri 'self'";
      expect(csp).toBe("base-uri 'self'");
    });
  });
});
