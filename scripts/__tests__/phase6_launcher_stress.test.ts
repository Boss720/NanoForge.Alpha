/**
 * Phase 6 Launcher Static Server Adversarial & Stress Test Suite
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const launcherModule = require("../nanoforge-launcher.cjs");
const { createStaticServer } = launcherModule;

describe("Milestone 6 Challenger: Launcher Static Server Path Traversal & Port Checks", () => {
  let server: http.Server;
  let testPort: number;
  const testDist = path.resolve(__dirname, "../../dist");

  beforeEach(async () => {
    server = createStaticServer(testDist);

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        testPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("strictly prevents path traversal outside the dist root directory for dot-dot sequences", async () => {
    const hostilePaths = [
      "/../../../../etc/passwd",
      "/..%2f..%2f..%2fpackage.json",
      "/..%5c..%5c..%5cpackage.json",
      "/%2e%2e/%2e%2e/package.json",
      "/%2e%2e%2f%2e%2e%2fpackage.json",
      "/....//....//package.json",
      "/dist/../../package.json",
    ];

    for (const hPath of hostilePaths) {
      const res = await new Promise<{ status: number; text: string }>((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${testPort}${hPath}`, (res: http.IncomingMessage) => {
            let data = "";
            res.on("data", (chunk: Buffer | string) => {
              data += chunk.toString();
            });
            res.on("end", () => resolve({ status: res.statusCode || 0, text: data }));
          })
          .on("error", reject);
      });

      // Must either be 403 Forbidden or SPA fallback index.html (NEVER external files)
      expect([200, 403, 404]).toContain(res.status);

      if (res.status === 200) {
        expect(res.text.toLowerCase()).toContain("<!doctype html>");
        expect(res.text).not.toContain('"name": "nanoforge"');
        expect(res.text).not.toContain("root:x:0:0:");
      }
    }
  });

  it("serves valid SPA routes with index.html fallback and proper Content-Type headers", async () => {
    const spaRoutes = ["/", "/subagents", "/settings", "/playground", "/mailbox/subagent-1"];

    for (const route of spaRoutes) {
      const res = await new Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }>(
        (resolve, reject) => {
          http
            .get(`http://127.0.0.1:${testPort}${route}`, (res: http.IncomingMessage) => {
              let data = "";
              res.on("data", (chunk: Buffer | string) => {
                data += chunk.toString();
              });
              res.on("end", () => resolve({ status: res.statusCode || 0, text: data, headers: res.headers }));
            })
            .on("error", reject);
        }
      );

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.text.toLowerCase()).toContain("<!doctype html>");
    }
  });

  it("detects port conflict on busy ports during static server listen", async () => {
    const duplicateServer = createStaticServer(testDist);

    await expect(
      new Promise<void>((resolve, reject) => {
        duplicateServer.once("error", reject);
        duplicateServer.listen(testPort, "127.0.0.1", () => resolve());
      })
    ).rejects.toThrow(/EADDRINUSE/);

    await new Promise<void>((resolve) => duplicateServer.close(() => resolve())).catch(() => {});
  });
});
