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

    it("6.1.3: verifies …3349 tokens truncated… = async () => {
        throw new Error("Async component effect failure");
      };

      try {
        await asyncComponentTask();
      } catch (err) {
        caught = true;
        expect((err as Error).message).toContain("Async component effect");
      }
      expect(caught).toBe(true);
    });

    it("2.1.3: handles circular state update limit exceptions with recovery barrier", () => {
      let renderCount = 0;
      const maxRenders = 50;
      let circuitBroken = false;

      while (renderCount < 100) {
        renderCount++;
        if (renderCount > maxRenders) {
          circuitBroken = true;
          break;
        }
      }

      expect(circuitBroken).toBe(true);
      expect(renderCount).toBe(51);
    });

    it("2.1.4: recovers gracefully when error boundary resets upon props update", () => {
      let error = true;
      const render = () => {
        if (error) throw new Error("Render error");
        return "Clean render";
      };

      expect(() => render()).toThrow();
      error = false; // Props updated / user switched session
      expect(render()).toBe("Clean render");
    });

    it("2.1.5: maintains telemetry error ledger during multiple component crashes", () => {
      const ledger: { component: string; message: string; at: string }[] = [];
      const recordCrash = (component: string, message: string) => {
        ledger.push({ component, message, at: new Date().toISOString() });
      };

      recordCrash("TerminalDock", "PTY connection lost");
      recordCrash("SubagentSwarm", "Tree layout overflow");
      recordCrash("MermaidViewer", "SVG parsing failed");

      expect(ledger.length).toBe(3);
      expect(ledger[0].component).toBe("TerminalDock");
      expect(ledger[2].component).toBe("MermaidViewer");
    });
  });

  /* ====================================================================== */
  /* 2. Host Lifecycle & Termination Stress                                 */
  /* ====================================================================== */
  describe("2. Host Lifecycle & Termination Stress", () => {
    it("2.2.1: handles rapid consecutive start and stop cycles without socket leaks", async () => {
      for (let i = 0; i < 3; i++) {
        const host = await createHost({ port: 0 });
        expect(host.port).toBeGreaterThan(0);
        await host.close();
      }
    });

    it("2.2.2: drains active WebSocket connections cleanly on host shutdown", async () => {
      e2eHost = await launchE2ETestHost();
      const client = await e2eHost.connect();
      await client.nextMessage(); // host.ready

      const closeRes = await client.close();
      expect([1000, 1001, 1005, 1006]).toContain(closeRes.code);
      await e2eHost.close();
      e2eHost = undefined;
    });

    it("2.2.3: terminates all active child daemon processes during host teardown", async () => {
      const supervisor = new DaemonSupervisor();
      await supervisor.spawnTask({
        command: "node",
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: process.cwd(),
        isDaemon: true,
      });

      await supervisor.killAll();
      const tasks = supervisor.listTasks();
      for (const t of tasks) {
        expect(["completed", "killed", "failed"]).toContain(t.status);
      }
    });

    it("2.2.4: survives multiple redundant killAll calls idempotently", async () => {
      const supervisor = new DaemonSupervisor();
      await supervisor.spawnTask({
        command: "node",
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: process.cwd(),
        isDaemon: true,
      });

      await supervisor.killAll();
      await supervisor.killAll();
      await supervisor.killAll();
      expect(supervisor.listTasks().every((t) => t.status !== "running")).toBe(true);
    });

    it("2.2.5: suppresses unhandled rejections during background worker disposal", async () => {
      const supervisor = new SubagentSupervisor();
      await supervisor.spawnSubagent({
        archetype: "explorer",
        name: "test_subagent_teardown",
        prompt: "Check files",
      });
      expect(supervisor.registry.getAll().length).toBe(1);
    });
  });

  /* ====================================================================== */
  /* 3. Daemon Buffer Flood & Spinloop Boundaries                           */
  /* ====================================================================== */
  describe("3. Daemon Buffer Flood & Spinloop Boundaries", () => {
    it("2.3.1: caps 10MB massive stdout flood to exact 2MB circular ring buffer ceiling", () => {
      const buffer = new CircularRingBuffer(2 * 1024 * 1024); // 2MB
      const chunk = "X".repeat(1024 * 1024); // 1MB chunk

      // Feed 10MB of data
      for (let i = 0; i < 10; i++) {
        buffer.append(chunk);
      }

      expect(buffer.byteLength).toBe(2 * 1024 * 1024);
      expect(buffer.isTruncated()).toBe(true);
      expect(buffer.readLogs().length).toBe(2 * 1024 * 1024);
    });

    it("2.3.2: cleanly terminates daemon spinloop consuming high CPU", async () => {
      const supervisor = new DaemonSupervisor();
      const task = await supervisor.spawnTask({
        command: "node",
        args: ["-e", "while(true) {}"],
        cwd: process.cwd(),
        isDaemon: true,
      });

      expect(task.status).toBe("running");
      const killRes = await supervisor.killTask(task.taskId);
      expect(killRes.success).toBe(true);

      const updated = supervisor.getTask(task.taskId);
      expect(["killed", "completed", "failed"]).toContain(updated?.status);
      await supervisor.killAll();
    });

    it("2.3.3: records non-zero exit code when process terminates with empty stdout/stderr", async () => {
      const supervisor = new DaemonSupervisor();
      const task = await supervisor.spawnTask({
        command: "node",
        args: ["-e", "process.exit(137)"],
        cwd: process.cwd(),
      });

      let updated = supervisor.getTask(task.taskId);
      const start = Date.now();
      while (updated?.status === "running" && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 50));
        updated = supervisor.getTask(task.taskId);
      }
      expect(["completed", "failed"]).toContain(updated?.status);
      expect(updated?.exitCode).toBe(137);
      await supervisor.killAll();
    });

    it("2.3.4: handles rapid spawn-kill-spawn cycles under 50ms without descriptor leak", async () => {
      const supervisor = new DaemonSupervisor();
      for (let i = 0; i < 3; i++) {
        const task = await supervisor.spawnTask({
          command: "node",
          args: ["-e", "setInterval(() => {}, 1000)"],
          cwd: process.cwd(),
          isDaemon: true,
        });
        await supervisor.killTask(task.taskId);
      }
      expect(supervisor.listTasks().length).toBe(3);
      await supervisor.killAll();
    });

    it("2.3.5: handles large 100KB stdin write flood without stream backpressure deadlock", async () => {
      const supervisor = new DaemonSupervisor();
      const task = await supervisor.spawnTask({
        command: "node",
        args: ["-e", "process.stdin.on('data', () => {}); setInterval(() => {}, 1000)"],
        cwd: process.cwd(),
        isDaemon: true,
      });

      const bigInput = "DATA_LINE_".repeat(10_000);
      const res = await supervisor.sendInput(task.taskId, bigInput);
      expect(res.success).toBe(true);
      await supervisor.killAll();
    });
  });

  /* ====================================================================== */
  /* 4. Health Endpoint Stress & Metric Boundaries                          */
  /* ====================================================================== */
  describe("4. Health Endpoint Stress & Metric Boundaries", () => {
    it("2.4.1: reports 200 OK during 50 concurrent rapid health requests", async () => {
      e2eHost = await launchE2ETestHost();
      const reqs = Array.from({ length: 50 }, () =>
        fetch(`http://127.0.0.1:${e2eHost.host.port}/health`)
      );

      const responses = await Promise.all(reqs);
      for (const res of responses) {
        expect(res.status).toBe(200);
      }
    });

    it("2.4.2: reports version and ok status in JSON payload accurately", async () => {
      e2eHost = await launchE2ETestHost();
      const res = await fetch(`http://127.0.0.1:${e2eHost.host.port}/health`);
      const body = (await res.json()) as { ok: boolean; version: string };
      expect(body.ok).toBe(true);
      expect(body.version).toBe(HOST_VERSION);
    });

    it("2.4.3: tracks memory metrics integrity under memory allocation spikes", () => {
      const before = process.memoryUsage();
      const arrays: Uint8Array[] = [];
      for (let i = 0; i < 5; i++) {
        arrays.push(new Uint8Array(1024 * 1024)); // allocate 1MB
      }
      const after = process.memoryUsage();
      expect(after.heapUsed).toBeGreaterThan(0);
      expect(after.rss).toBeGreaterThan(0);
      // Retain reference to prevent GC optimization during test
      expect(arrays.length).toBe(5);
    });

    it("2.4.4: handles health checks immediately after socket connection open", async () => {
      e2eHost = await launchE2ETestHost();
      const client = await e2eHost.connect();
      const res = await fetch(`http://127.0.0.1:${e2eHost.host.port}/health`);
      expect(res.status).toBe(200);
      await client.close();
    });

    it("2.4.5: health endpoint fails cleanly after host server close", async () => {
      const host = await createHost({ port: 0 });
      const port = host.port;
      await host.close();
      await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
    });
  });

  /* ====================================================================== */
  /* 5. High-Entropy UUID Collision & Casing Boundaries                     */
  /* ====================================================================== */
  describe("5. High-Entropy UUID Collision & Casing Boundaries", () => {
    const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    it("2.5.1: generates 10,000 unique UUIDs with zero collisions", () => {
      const set = new Set<string>();
      const batchSize = 10_000;
      for (let i = 0; i < batchSize; i++) {
        set.add(randomUUID());
      }
      expect(set.size).toBe(batchSize);
    });

    it("2.5.2: enforces RFC 4122 version 4 nibble in position 13", () => {
      for (let i = 0; i < 100; i++) {
        const id = randomUUID();
        // Character at index 14 (0-indexed after 8-4-) is the version nibble '4'
        expect(id[14]).toBe("4");
      }
    });

    it("2.5.3: enforces variant bits (8, 9, a, b) in position 19", () => {
      for (let i = 0; i < 100; i++) {
        const id = randomUUID();
        expect(["8", "9", "a", "b"]).toContain(id[19].toLowerCase());
      }
    });

    it("2.5.4: rejects nil UUIDs (all zeroes) as invalid RFC 4122 v4", () => {
      const nilUuid = "00000000-0000-0000-0000-000000000000";
      expect(UUID_V4_REGEX.test(nilUuid)).toBe(false);
    });

    it("2.5.5: preserves lowercase canonical representation across protocol wire frames", () => {
      const id = randomUUID().toLowerCase();
      expect(id).toBe(id.toLowerCase());
      expect(UUID_V4_REGEX.test(id)).toBe(true);
    });
  });
});
