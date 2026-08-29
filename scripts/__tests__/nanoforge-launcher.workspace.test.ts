import { describe, expect, it, afterEach } from "vitest";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createStaticServer } = require("../nanoforge-launcher.cjs");
const servers: http.Server[] = [];

afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });

describe("launcher workspace control plane", () => {
  it("rejects unauthenticated workspace recent-list access", async () => {
    const server = createStaticServer(path.resolve(__dirname, "../../dist"), { token: "secret", workspaceRegistry: { list: () => [] } });
    servers.push(server);
    const response = await request(server, "GET", "/api/workspace/recent");
    expect(response.status).toBe(401);
    expect(JSON.parse(response.text)).toEqual({ error: "unauthorized" });
  });

  it("exposes authenticated recent-workspace controls", async () => {
    const calls: string[] = [];
    const server = createStaticServer(path.resolve(__dirname, "../../dist"), {
      token: "secret",
      workspaceRegistry: { list: () => [{ id: "ws_opaque", path: "C:\\Work", pinned: false }], pin: (id: string, pinned: boolean) => { calls.push(`${id}:${pinned}`); return { id, pinned }; } },
    });
    servers.push(server);
    const listed = await request(server, "GET", "/api/workspace/recent", undefined, "Bearer secret");
    expect(JSON.parse(listed.text).workspaces).toHaveLength(1);
    const pinned = await request(server, "PATCH", "/api/workspace/recent/ws_opaque", JSON.stringify({ pinned: true }), "Bearer secret");
    expect(JSON.parse(pinned.text)).toEqual({ id: "ws_opaque", pinned: true });
    expect(calls).toEqual(["ws_opaque:true"]);
  });
});

function request(server: http.Server, method: string, requestPath: string, body?: string, authorization?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const address = server.address() as { port: number } | null;
    if (!address) { server.listen(0, "127.0.0.1", () => request(server, method, requestPath, body, authorization).then(resolve, reject)); return; }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (authorization) headers.authorization = authorization;
    const req = http.request({ host: "127.0.0.1", port: address.port, path: requestPath, method, headers }, (response) => {
      let text = ""; response.setEncoding("utf8"); response.on("data", (chunk) => { text += chunk; }); response.on("end", () => resolve({ status: response.statusCode || 0, text }));
    });
    req.on("error", reject); req.end(body);
  });
}
