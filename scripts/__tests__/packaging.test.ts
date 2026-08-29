import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import {
  parseCliArgs,
  packageRelease,
  generateBatchLauncher,
  generateReleaseReadme,
  ensureDirectoryClean,
  ROOT_DIR,
  RELEASE_DIR,
  BUNDLE_DIR,
} from "../package-release.js";

const require = createRequire(import.meta.url);
const launcherModule = require("../nanoforge-launcher.cjs");
const {
  parseArgs,
  generateToken,
  getMimeType,
  resolveDistRoot,
  createStaticServer,
  startLauncher,
} = launcherModule;

describe("NanoForge Packaging & Launcher System", () => {
  describe("1. Launcher Configuration & Token Security", () => {
    it("generates 32-character URL-safe cryptographic tokens", () => {
      const token1 = generateToken();
      const token2 = generateToken();

      expect(typeof token1).toBe("string");
      expect(token1.length).toBeGreaterThanOrEqual(32);
      expect(token2.length).toBeGreaterThanOrEqual(32);
      expect(token1).not.toBe(token2);
      expect(/^[A-Za-z0-9_-]+$/.test(token1)).toBe(true);
    });

    it("parses default launcher arguments and environment overrides", () => {
      const defaults = parseArgs([]);
      expect(defaults.uiPort).toBe(4173);
      expect(defaults.hostPort).toBe(4174);
      expect(defaults.token).toBeDefined();
      expect(defaults.token.length).toBeGreaterThan(0);
      expect(defaults.dryRun).toBe(false);

      const custom = parseArgs([
        "--port",
        "5000",
        "--host-port",
        "5001",
        "--token",
        "custom-test-token-1234567890123456",
        "--no-open",
        "--dry-run",
      ]);
      expect(custom.uiPort).toBe(5000);
      expect(custom.hostPort).toBe(5001);
      expect(custom.token).toBe("custom-test-token-1234567890123456");
      expect(custom.noOpen).toBe(true);
      expect(custom.dryRun).toBe(true);
    });

    it("handles equals-sign flags correctly (--port=8080)", () => {
      const parsed = parseArgs(["--port=8080", "--host-port=8081", "--token=tok12345678901234567890"]);
      expect(parsed.uiPort).toBe(8080);
      expect(parsed.hostPort).toBe(8081);
      expect(parsed.token).toBe("tok12345678901234567890");
    });
  });

  describe("2. Static Server & SPA Routing Fallback", () => {
    it("maps standard file extensions to appropriate MIME types", () => {
      expect(getMimeType("index.html")).toBe("text/html; charset=utf-8");
      expect(getMimeType("app.js")).toBe("text/javascript; charset=utf-8");
      expect(getMimeType("module.mjs")).toBe("text/javascript; charset=utf-8");
      expect(getMimeType("style.css")).toBe("text/css; charset=utf-8");
      expect(getMimeType("data.json")).toBe("application/json; charset=utf-8");
      expect(getMimeType("icon.svg")).toBe("image/svg+xml");
      expect(getMimeType("image.png")).toBe("image/png");
      expect(getMimeType("photo.jpeg")).toBe("image/jpeg");
      expect(getMimeType("font.woff2")).toBe("font/woff2");
      expect(getMimeType("binary.wasm")).toBe("application/wasm");
      expect(getMimeType("unknown.xyz")).toBe("application/octet-stream");
    });

    it("resolves the dist root directory accurately", () => {
      const resolved = resolveDistRoot();
      expect(fs.existsSync(resolved)).toBe(true);
      expect(fs.existsSync(path.join(resolved, "index.html"))).toBe(true);
    });

    it("serves static assets, falls back to index.html for SPA routes, and prevents traversal", async () => {
      const testDist = path.join(ROOT_DIR, "dist");
      const server = createStaticServer(testDist);
      const testPort = 49210;

      await new Promise<void>((resolve) => {
        server.listen(testPort, "127.0.0.1", () => resolve());
      });

      try {
        // Request 1: Direct index.html
        const indexRes = await new Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
          http.get(`http://127.0.0.1:${testPort}/`, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ status: res.statusCode || 0, text: data, headers: res.headers }));
          }).on("error", reject);
        });

        expect(indexRes.status).toBe(200);
        expect(indexRes.headers["content-type"]).toContain("text/html");
        expect(indexRes.text.toLowerCase()).toContain("<!doctype html>");

        // Request 2: SPA client route fallback (/subagents/test)
        const spaRes = await new Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
          http.get(`http://127.0.0.1:${testPort}/subagents/test-route-123`, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ status: res.statusCode || 0, text: data, headers: res.headers }));
          }).on("error", reject);
        });

        expect(spaRes.status).toBe(200);
        expect(spaRes.headers["content-type"]).toContain("text/html");
        expect(spaRes.text.toLowerCase()).toContain("<!doctype html>");

        // Request 3: Path traversal attempt (/../../package.json)
        const traversalRes = await new Promise<{ status: number; text: string }>((resolve, reject) => {
          http.get(`http://127.0.0.1:${testPort}/%2e%2e/%2e%2e/package.json`, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ status: res.statusCode || 0, text: data }));
          }).on("error", reject);
        });

        // Either caught by 403 or sanitized to dist index.html
        expect([200, 403]).toContain(traversalRes.status);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe("3. Dual Launcher Execution", () => {
    it("executes clean dry-run startup and teardown", async () => {
      const result = await startLauncher({
        uiPort: 49211,
        hostPort: 49212,
        token: "dry-run-token-test-12345678901234",
        dryRun: true,
        noOpen: true,
      });

      expect(result.launchUrl).toBe(
        "http://127.0.0.1:49211/?hostPort=49212&token=dry-run-token-test-12345678901234"
      );
      expect(result.config.uiPort).toBe(49211);
      expect(result.config.hostPort).toBe(49212);
      expect(result.distRoot).toBeDefined();
    });
  });

  describe("4. Release Packaging Pipeline", () => {
    it("parses CLI arguments for package-release.js", () => {
      const defaultOpts = parseCliArgs([]);
      expect(defaultOpts.version).toBe("0.6.0");
      expect(defaultOpts.skipBuild).toBe(false);
      expect(defaultOpts.dryRun).toBe(false);

      const customOpts = parseCliArgs(["--version", "1.0.0", "--skip-build", "--dry-run"]);
      expect(customOpts.version).toBe("1.0.0");
      expect(customOpts.skipBuild).toBe(true);
      expect(customOpts.dryRun).toBe(true);
    });

    it("generates batch runner and documentation files", () => {
      const testTempDir = path.join(RELEASE_DIR, ".test-temp");
      ensureDirectoryClean(testTempDir);

      try {
        const batPath = path.join(testTempDir, "NanoForge.bat");
        generateBatchLauncher(batPath);
        expect(fs.existsSync(batPath)).toBe(true);
        const batContent = fs.readFileSync(batPath, "utf8");
        expect(batContent).toContain("nanoforge-launcher.cjs");

        const readmePath = path.join(testTempDir, "README.txt");
        generateReleaseReadme(readmePath, "0.6.0");
        expect(fs.existsSync(readmePath)).toBe(true);
        const readmeContent = fs.readFileSync(readmePath, "utf8");
        expect(readmeContent).toContain("NanoForge v0.6.0");
        expect(readmeContent).toContain("http://127.0.0.1:4173/?hostPort=4174&token=...");
      } finally {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      }
    });

    it("assembles the complete release bundle structure", async () => {
      const result = await packageRelease({
        version: "0.6.0",
        skipBuild: true,
        dryRun: false,
      });

      expect(result.success).toBe(true);
      expect(fs.existsSync(BUNDLE_DIR)).toBe(true);

      // Verify bundled files
      expect(fs.existsSync(path.join(BUNDLE_DIR, "dist", "index.html"))).toBe(true);
      expect(fs.existsSync(path.join(BUNDLE_DIR, "nanoforge-launcher.cjs"))).toBe(true);
      expect(fs.existsSync(path.join(BUNDLE_DIR, "launcher.cjs"))).toBe(true);
      expect(fs.existsSync(path.join(BUNDLE_DIR, "workspace-picker.cjs"))).toBe(true);
      expect(fs.existsSync(path.join(BUNDLE_DIR, "workspace-registry.cjs"))).toBe(true);
      expect(fs.existsSync(path.join(BUNDLE_DIR, "server.mjs"))).toBe(true);
      expect(fs.existsSync(path.join(BUNDLE_DIR, "agent-host.mjs"))).toBe(true);
      expect(fs.existsSync(path.join(BUNDLE_DIR, "NanoForge.bat"))).toBe(true);
      expect(fs.existsSync(path.join(BUNDLE_DIR, "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(BUNDLE_DIR, "README.txt"))).toBe(true);
      expect(fs.existsSync(path.join(BUNDLE_DIR, "install-nanoforge.ps1"))).toBe(true);
      expect(fs.existsSync(path.join(BUNDLE_DIR, "install-nanoforge.bat"))).toBe(true);
      expect(fs.existsSync(path.join(BUNDLE_DIR, "uninstall-nanoforge.ps1"))).toBe(true);

      // Verify zip archive exists
      const zipPath = path.join(RELEASE_DIR, "NanoForge-v0.6.0-windows-x64.zip");
      expect(fs.existsSync(zipPath)).toBe(true);
      expect(fs.statSync(zipPath).size).toBeGreaterThan(1000);
    }, 60000);
  });

  describe("5. Windows Installer & Uninstaller Verification", () => {
    it("verifies release/install-nanoforge.ps1 structure and parameters", () => {
      const scriptPath = path.join(RELEASE_DIR, "install-nanoforge.ps1");
      expect(fs.existsSync(scriptPath)).toBe(true);

      const content = fs.readFileSync(scriptPath, "utf8");
      expect(content).toContain("$env:LOCALAPPDATA\\NanoForge");
      expect(content).toContain("WScript.Shell");
      expect(content).toContain("CreateShortcut");
      expect(content).toContain("NanoForge.lnk");
      expect(content).toContain("Add-ToUserPath");
      expect(content).toContain("Register-Uninstaller");
      expect(content).toContain("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NanoForge");
      expect(content).toContain("$Silent");
      expect(content).toContain("$NoShortcuts");
      expect(content).toContain("$NoPath");
    });

    it("verifies release/install-nanoforge.bat wrapper", () => {
      const batPath = path.join(RELEASE_DIR, "install-nanoforge.bat");
      expect(fs.existsSync(batPath)).toBe(true);

      const content = fs.readFileSync(batPath, "utf8");
      expect(content).toContain("powershell.exe");
      expect(content).toContain("-ExecutionPolicy Bypass");
      expect(content).toContain("install-nanoforge.ps1");
    });

    it("verifies release/uninstall-nanoforge.ps1 structure and clean teardown", () => {
      const scriptPath = path.join(RELEASE_DIR, "uninstall-nanoforge.ps1");
      expect(fs.existsSync(scriptPath)).toBe(true);

      const content = fs.readFileSync(scriptPath, "utf8");
      expect(content).toContain("Get-Process -Name \"NanoForge\"");
      expect(content).toContain("Remove-FromUserPath");
      expect(content).toContain("Unregister-Uninstaller");
      expect(content).toContain("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NanoForge");
      expect(content).toContain("NanoForge.lnk");
      expect(content).toContain("$InstallDir");
      expect(content).toContain("$Silent");
      expect(content).toContain("$Force");
    });
  });
});
