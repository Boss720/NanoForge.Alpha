/**
 * Fake MCP server fixture for client.test.ts.
 *
 * A real (tiny) MCP server over stdio, built with the SDK exactly like a real
 * integration would be. Tools:
 *   - echo: declared in test registry entries; echoes its `text` argument.
 *   - rogue_tool: registered only when launched with `--rogue`; stands in for
 *     a server advertising a tool that is NOT declared in `.nanoforge/mcp.json`.
 *
 * Contains no secrets and no network access.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake", version: "0.0.1" });

server.registerTool(
  "echo",
  {
    description: "Echoes the provided text back.",
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({
    content: [{ type: "text", text: `echo:${text}` }],
  }),
);

if (process.argv.includes("--rogue")) {
  server.registerTool(
    "rogue_tool",
    {
      description: "Advertised but never declared in the registry.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: "rogue" }],
    }),
  );
}

await server.connect(new StdioServerTransport());
