/**
 * Launcher Security & Path Confinement Adversarial Stress Test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createStaticServer, isPathWithinRoot, buildChildEnvironment } = require("../nanoforge-launcher.cjs");

describe("Milestone 6 Challenger: Launcher Deep Security Boundary Checks", () => {
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

  it("rejects sibling-prefix paths with path-relative containment", () => {
    const distRoot = path.join(testDist, "assets");
    const sibling = path.join(testDist, "assets-secrets", "passwords.txt");
    expect(isPathWithinRoot(sibling, distRoot)).toBe(false);
    expect(isPathWithinRoot(path.join(distRoot, "app.js"), distRoot)).toBe(true);
  });

  it("builds launcher child environments from the runtime allowlist", () => {
    const secretName = "NANOFORGE_TEST_LAUNCHER_SECRET";
    const previousSecret = process.env[secretName];
    process.env[secretName] = "must-not-reach-child";
    try {
      const environment = buildChildEnvironment({ TOKEN: "session-token" });
      expect(environment.TOKEN).toBe("session-token");
      expect(environment[secretName]).toBeUndefined();
      expect(environment.PATH || environment.Path).toBeDefined();
      expect(buildChildEnvironment({ ELECTRON_RUN_AS_NODE: "1" }).ELECTRON_RUN_AS_NODE).toBe("1");
    } finally {
      if (previousSecret === undefined) delete process.env[secretName];
      else process.env[secretName] = previousSecret;
    }
  });

  it("returns controlled errors for malformed URI and null-byte input", async () => {
    for (const hostilePath of ["/%ZZ%FF", "/assets/%00.js"]) {
      const response = await request(hostilePath);
      expect(response.status).toBe(400);
      expect(response.text).toContain("400 Bad Request");
    }
  });

  it("contains traversal and Windows separator probes without escaping the distribution root", async () => {
    for (const hostilePath of [
      "/../../package.json",
      "/..%2f..%2fpackage.json",
      "/..%5c..%5cpackage.json",
      "/%2e%2e/%2e%2e/package.json",
      "/%2e%2e%5c%2e%2e%5cpackage.json",
    ]) {
      const response = await request(hostilePath);
      expect([200, 403, 404]).toContain(response.status);
      if (response.status === 200) {
        expect(response.text.toLowerCase()).toContain('<!doctype html>');
        expect(response.text).not.toContain('"name": "nanoforge"');
      }
    }
  });

  function request(requestPath: string): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${testPort}${requestPath}`, (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { text += chunk; });
        response.on("end", () => resolve({ status: response.statusCode || 0, text }));
      }).on("error", reject);
    });
  }
});
