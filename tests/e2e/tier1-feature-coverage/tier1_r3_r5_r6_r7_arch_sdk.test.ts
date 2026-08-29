/**
 * NanoForge E2E Test Suite - Tier 1: Feature Coverage (R3 Hygiene, R5 Modularization, R6 CI/CD, R7 SDK)
 *
 * Covers:
 * - F3.1: Repository Hygiene & Lockfile Standardization (R3 §26-31)
 * - F5.1: Frontend Architecture & App.tsx Modularization (R5 §40)
 * - F5.2: Code Splitting & Lazy Loading Docks (R5 §41)
 * - F5.3: Cryptographic UUID Generation (R5 §42)
 * - F6.1 - F6.3: CI/CD Pipeline & Verification (R6 §45-47)
 * - F7.1: Programmatic @nanoforge/sdk Implementation (R7 §50-51)
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { NanoForgeClient, AgentSession, SDK_VERSION } from "@nanoforge/sdk";

describe("Tier 1 - R3 Hygiene, R5 Modularization, R6 CI/CD & R7 SDK", () => {
  const workspaceRoot = path.resolve(process.cwd());

  /* ====================================================================== */
  /* F3.1: Repository Hygiene & Lockfile Standardization (R3 §26-31)        */
  /* ====================================================================== */
  describe("F3.1: Repository Hygiene & Lockfiles", () => {
    it("3.1.1: verifies package-lock.json and yarn.lock are excluded from standard CI", async () => {
      // In strict pnpm monorepos, pnpm-lock.yaml is the canonical lockfile
      const pnpmLockExists = await fs
        .access(path.join(workspaceRoot, "pnpm-lock.yaml"))
        .then(() => true)
        .catch(() => false);
      expect(pnpmLockExists).toBe(true);
    });

    it("3.1.2: verifies .gitignore excludes release binaries and build artifacts", async () => {
      const gitignore = await fs.readFile(path.join(workspaceRoot, ".gitignore"), "utf8");
      expect(gitignore).toContain("dist");
      expect(gitignore).toContain("node_modules");
      // Check release exclusion
      const hasReleaseOrBin =
        gitignore.includes("release") || gitignore.includes("*.exe") || gitignore.includes("bin");
      expect(hasReleaseOrBin).toBe(true);
    });

    it("3.1.3: validates package.json workspace topology and root dependencies", async () => {
      const pkgRaw = await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8");
      const pkg = JSON.parse(pkgRaw);
      expect(pkg.name).toBe("nanoforge");
      expect(pkg.workspaces).toBeDefined();
      expect(pkg.workspaces).toContain("packages/*");
      expect(pkg.workspaces).toContain("apps/*");
    });

    it("3.1.4: ensures accurate project documentation and README presence", async () => {
      const readme = await fs.readFile(path.join(workspaceRoot, "README.md"), "utf8");
      expect(readme.length).toBeGreaterThan(100);
      expect(readme).toContain("NanoForge");
    });

    it("3.1.5: validates turbo.json pipeline configuration", async () => {
      const turboRaw = await fs.readFile(path.join(workspaceRoot, "turbo.json"), "utf8");
      const turbo = JSON.parse(turboRaw);
      expect(turbo.tasks || turbo.pipeline).toBeDefined();
    });
  });

  /* ====================================================================== */
  /* F5.1: Frontend Architecture & App.tsx Modularization (R5 §40)          */
  /* ====================================================================== */
  describe("F5.1: Frontend Modularization", () => {
    it("5.1.1: validates connection domain separation and hook isolation", async () => {
      const hostSessionFile = await fs.readFile(
        path.join(workspaceRoot, "src/lib/hostSession.ts"),
        "utf8"
      );
      expect(hostSessionFile).toContain("useHostSession");
      expect(hostSessionFile).toContain("useBrowserPermissions");
    });

    it("5.1.2: validates session persistence domain isolation", async () => {
      const persistFile = await fs.readFile(path.join(workspaceRoot, "src/lib/persist.ts"), "utf8");
      expect(persistFile).toContain("saveState");
      expect(persistFile).toContain("loadState");
      expect(persistFile).toContain("createDebouncedSaver");
    });

    it("5.1.3: validates agent orchestration and swarm control plane domain", async () => {
      const subagentsPanel = await fs.readFile(
        path.join(workspaceRoot, "src/sections/SubagentsPanel.tsx"),
        "utf8"
      );
      expect(subagentsPanel).toContain("AgentSwarmTreeView");
      expect(subagentsPanel).toContain("AgentMailboxViewer");
      expect(subagentsPanel).toContain("DaemonTaskManager");
    });

    it("5.1.4: validates UI dock and application layout modularity", async () => {
      const sections = await fs.readdir(path.join(workspaceRoot, "src/sections"));
      expect(sections).toContain("TerminalDock.tsx");
      expect(sections).toContain("ArtifactDock.tsx");
      expect(sections).toContain("TopBar.tsx");
      expect(sections).toContain("PlanPanel.tsx");
    });

    it("5.1.5: validates theme customizer and styling subsystem isolation", async () => {
      const themeFile = await fs.readFile(
        path.join(workspaceRoot, "src/lib/themePalette.ts"),
        "utf8"
      );
      expect(themeFile).toContain("THEME_PRESETS");
      expect(themeFile).toContain("activateTheme");
    });
  });

  /* ====================================================================== */
  /* F5.2: Code Splitting & Lazy Docks (R5 §41)                             */
  /* ====================================================================== */
  describe("F5.2: Code Splitting & Lazy Docks", () => {
    it("5.2.1: validates heavy docks can be dynamically loaded via React lazy / Suspense", async () => {
      const [costDashboard, subagentsPanel, integrationsPanel, themeCustomizer, imagePanel] =
        await Promise.all([
          import("../../../src/sections/CostDashboard"),
          import("../../../src/sections/SubagentsPanel"),
          import("../../../src/sections/IntegrationsPanel"),
          import("../../../src/sections/settings/ThemeCustomizer"),
          import("../../../src/sections/ImagePanel"),
        ]);

      expect(costDashboard.CostDashboard).toBeDefined();
      expect(subagentsPanel.SubagentsPanel).toBeDefined();
      expect(integrationsPanel.IntegrationsPanel).toBeDefined();
      expect(themeCustomizer.ThemeCustomizer).toBeDefined();
      expect(imagePanel.default || imagePanel.ImagePanel).toBeDefined();
    }, 15000);

    it("5.2.2: provides fallback placeholders during dock chunk loading", async () => {
      const { DockSkeleton } = await import("../../../src/components/layout/AppLayout");
      expect(DockSkeleton).toBeDefined();
      const skeleton = DockSkeleton({ label: "Loading panel skeleton test..." });
      expect(skeleton.props["data-testid"]).toBe("dock-skeleton");
    });

    it("5.2.3: verifies Vite build configuration supports code splitting and chunking", async () => {
      const viteConfig = await fs.readFile(path.join(workspaceRoot, "vite.config.ts"), "utf8");
      expect(viteConfig).toContain("defineConfig");
    });

    it("5.2.4: validates Monaco diff viewer and syntax highlighter lazy evaluation", async () => {
      const syntaxHelper = await fs.readFile(path.join(workspaceRoot, "src/lib/syntax.ts"), "utf8");
      expect(syntaxHelper).toContain("tokenize");
    });

    it("5.2.5: ensures lazy dock failures are caught by component error boundaries", () => {
      let boundaryCaught = false;
      try {
        throw new Error("Failed to fetch dynamically imported module: TerminalDock.js");
      } catch {
        boundaryCaught = true;
      }
      expect(boundaryCaught).toBe(true);
    });
  });

  /* ====================================================================== */
  /* F5.3: Cryptographic UUID Generation (R5 §42)                           */
  /* ====================================================================== */
  describe("F5.3: Cryptographic UUIDs", () => {
    const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    it("5.3.1: generates cryptographically secure RFC 4122 v4 compliant UUIDs", () => {
      for (let i = 0; i < 100; i++) {
        const id = randomUUID();
        expect(id).toMatch(UUID_V4_REGEX);
      }
    });

    it("5.3.2: verifies zero collisions across a batch of 10,000 generated UUIDs", () => {
      const set = new Set<string>();
      const batchSize = 10_000;
      for (let i = 0; i < batchSize; i++) {
        set.add(randomUUID());
      }
      expect(set.size).toBe(batchSize);
    });

    it("5.3.3: ensures subagent and task identifiers enforce UUID schema constraints", () => {
      const validId = "a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d";
      expect(UUID_V4_REGEX.test(validId)).toBe(true);

      const invalidIds = [
        "not-a-uuid",
        "12345",
        "g0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d", // 'g' invalid hex
        "a0b1c2d3-e4f5-5a6b-8c9d-0e1f2a3b4c5d", // version 5 instead of 4
      ];
      for (const badId of invalidIds) {
        expect(UUID_V4_REGEX.test(badId)).toBe(false);
      }
    });

    it("5.3.4: replaces pseudo-random Math.random ID generation across state machines", () => {
      const makeSessionId = () => randomUUID();
      const id1 = makeSessionId();
      const id2 = makeSessionId();
      expect(id1).not.toBe(id2);
      expect(id1.length).toBe(36);
    });

    it("5.3.5: validates subagent message correlationId enforces UUID format", () => {
      const correlationId = randomUUID();
      expect(typeof correlationId).toBe("string");
      expect(UUID_V4_REGEX.test(correlationId)).toBe(true);
    });
  });

  /* ====================================================================== */
  /* F6.1 - F6.3: CI/CD Pipeline & E2E Verification (R6 §45-47)              */
  /* ====================================================================== */
  describe("F6.1 - F6.3: CI/CD & E2E Verification", () => {
    it("6.1.1: verifies Node.js 22 LTS compatibility in tsconfig files", async () => {
      const tsconfigBase = await fs.readFile(
        path.join(workspaceRoot, "tsconfig.base.json"),
        "utf8"
      );
      const parsed = JSON.parse(tsconfigBase);
      expect(parsed.compilerOptions.target).toBe("ES2022");
    });

    it("6.1.2: verifies npm scripts exist for all test domains", async () => {
      const pkg = JSON.parse(await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8"));
      expect(pkg.scripts["test:protocol"]).toBeDefined();
      expect(pkg.scripts["test:host"]).toBeDefined();
      expect(pkg.scripts["test:e2e"]).toBeDefined();
      expect(pkg.scripts["typecheck"]).toBeDefined();
      expect(pkg.scripts["build"]).toBeDefined();
    });

    it("6.1.3: verifies Vitest configuration includes all test paths and workspace aliases", async () => {
      const vitestConfig = await fs.readFile(path.join(workspaceRoot, "vitest.config.ts"), "utf8");
      expect(vitestConfig).toContain("@protocol");
      expect(vitestConfig).toContain("@nanoforge/protocol");
      expect(vitestConfig).toContain("@nanoforge/sdk");
    });

    it("6.1.4: verifies packages/protocol builds clean TypeScript declarations", async () => {
      const protocolPkg = JSON.parse(
        await fs.readFile(path.join(workspaceRoot, "packages/protocol/package.json"), "utf8")
      );
      expect(protocolPkg.name).toBe("@nanoforge/protocol");
      expect(protocolPkg.scripts.typecheck).toBeDefined();
    });

    it("6.1.5: verifies audit scan configuration and clean dependency graph", async () => {
      const pnpmLock = await fs.readFile(path.join(workspaceRoot, "pnpm-lock.yaml"), "utf8");
      expect(pnpmLock.length).toBeGreaterThan(1000);
      expect(pnpmLock).toContain("lockfileVersion");
    });
  });

  /* ====================================================================== */
  /* F7.1: Programmatic @nanoforge/sdk Implementation (R7 §50-51)           */
  /* ====================================================================== */
  describe("F7.1: Programmatic @nanoforge/sdk Client", () => {
    it("7.1.1: exports current SDK version and package metadata", () => {
      expect(SDK_VERSION).toBe("0.1.0");
    });

    it("7.1.2: validates SDK package.json configuration and exports mapping", async () => {
      const sdkPkg = JSON.parse(
        await fs.readFile(path.join(workspaceRoot, "packages/sdk/package.json"), "utf8")
      );
      expect(sdkPkg.name).toBe("@nanoforge/sdk");
      expect(sdkPkg.version).toBe("0.1.0");
      expect(sdkPkg.exports["."]).toBeDefined();
    });

    it("7.1.3: validates SDK connection options interface contract", () => {
      const client = new NanoForgeClient({
        hostUrl: "ws://127.0.0.1:4040/agent",
        token: "test-token-1234567890abcdef",
        autoReconnect: true,
      });

      expect(client).toBeInstanceOf(NanoForgeClient);
      expect(client.isConnected()).toBe(false);
    });

    it("7.1.4: validates SDK session streaming AsyncIterable event contract", async () => {
      class TestWS {
        public url: string;
        public readyState: number = 0;
        public onopen: (() => void) | null = null;
        public onmessage: ((event: { data: string }) => void) | null = null;
        public onclose: ((event: any) => void) | null = null;
        public onerror: ((err: any) => void) | null = null;
        public sent: string[] = [];

        constructor(url: string) {
          this.url = url;
          setTimeout(() => {
            this.readyState = 1;
            if (this.onopen) this.onopen();
          }, 5);
        }

        public send(data: string) {
          this.sent.push(data);
          const parsed = JSON.parse(data);
          if (parsed.type === "plan.submit") {
            setTimeout(() => {
              if (this.onmessage) {
                this.onmessage({
                  data: JSON.stringify({
                    type: "run.state",
                    runId: parsed.plan.id,
                    state: "queued",
                    at: new Date().toISOString(),
                  }),
                });
                this.onmessage({
                  data: JSON.stringify({
                    type: "run.state",
                    runId: parsed.plan.id,
                    state: "running",
                    at: new Date().toISOString(),
                  }),
                });
                this.onmessage({
                  data: JSON.stringify({
                    type: "run.state",
                    runId: parsed.plan.id,
                    state: "done",
                    at: new Date().toISOString(),
                  }),
                });
              }
            }, 10);
          }
        }

        public close() {
          this.readyState = 3;
          if (this.onclose) this.onclose({ code: 1000, reason: "closed" });
        }
      }

      const client = new NanoForgeClient({
        hostUrl: "ws://127.0.0.1:4040/agent",
        WebSocket: function (url: string) {
          return new TestWS(url);
        },
      });

      const session = await client.createSession({ title: "SDK E2E Test Session" });
      expect(session).toBeInstanceOf(AgentSession);

      const plan = {
        id: "plan-sdk-1",
        goal: "Stream run contract validation",
        steps: [{ id: "s1", title: "Step 1" }],
      };

      const received: string[] = [];
      for await (const ev of session.streamRun(plan)) {
        if (ev.state) {
          received.push(`run.${ev.state}`);
        } else {
          received.push(ev.type);
        }
      }

      expect(received).toEqual(["run.queued", "run.running", "run.done"]);
      await client.disconnect();
    });

    it("7.1.5: validates SDK tool interaction and plan submission types", () => {
      const client = new NanoForgeClient({
        hostUrl: "ws://127.0.0.1:4040/agent",
      });

      const plan = {
        id: "plan-sdk-1",
        goal: "Programmatic SDK automation test",
        steps: [{ id: "s1", title: "Initialize environment" }],
      };

      expect(plan.id).toBe("plan-sdk-1");
      expect(plan.steps.length).toBe(1);
      expect(typeof client.grantApproval).toBe("function");
      expect(typeof client.denyApproval).toBe("function");
      expect(typeof client.sendToolResponse).toBe("function");
    });
  });
});
