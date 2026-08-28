/**
 * MCP types (Task 13).
 *
 * Shared contracts for the MCP registry and stdio client.
 *
 * SECURITY CONTRACT (mirrors docs/plans/2026-08-11-agent-platform-modules.md):
 *  - Explicit command/args/env/tool allow-list per server.
 *  - Secrets are stored as REFERENCES only (`env:VAR_NAME`); the value is
 *    resolved from the host process environment at spawn time and never
 *    written to disk, fixtures, logs, or the DOM.
 *  - MCP tool output is untrusted content.
 *  - The server process is terminated after the run.
 *  - A registry entry is configuration, not authorization: a run starts only
 *    after explicit user approval, and the declared `tools` list caps which
 *    tools can ever be called.
 */

import { z } from "zod";

/**
 * A secret reference. Only `env:VARIABLE_NAME` is supported — the value is
 * read from the host process environment at spawn time. Literal secret values
 * are rejected by the schema, so they can never be persisted in mcp.json.
 */
export const secretReferenceSchema = z
  .string()
  .regex(/^env:[A-Za-z_][A-Za-z0-9_]*$/, 'secret references must look like "env:VARIABLE_NAME"');

export type SecretReference = z.infer<typeof secretReferenceSchema>;

/** One server entry in `.nanoforge/mcp.json`. */
export const mcpServerDefinitionSchema = z.object({
  /** kebab-case server identifier; used in tool namespacing `mcp.<name>.<tool>`. */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "name must be kebab-case"),
  displayName: z.string().optional(),
  icon: z.string().optional(),
  version: z.string().optional(),
  transport: z.enum(["stdio", "sse"]).default("stdio"),
  /**
   * The approved executable: an absolute path or a PATH-resolved executable.
   * Exact-match checked against the registry at spawn time — a launch whose
   * command differs from the stored registry entry is denied before spawn.
   */
  command: z.string().min(1),
  /** Fixed argument array. No user input is ever interpolated into it. */
  args: z.array(z.string()).default([]),
  /** Map of child-process variable name -> secret reference ("env:VAR"). */
  env: z.record(z.string(), secretReferenceSchema).default({}),
  /**
   * Declared tool allow-list. After `tools/list`, any tool the server
   * advertises that is NOT in this list is quarantined and never callable.
   */
  tools: z.array(z.string().min(1)).default([]),
  /** Disabled servers are never started, even with an approval callback. */
  enabled: z.boolean().default(false),
});

export type McpServerDefinition = z.infer<typeof mcpServerDefinitionSchema>;

/** Top-level shape of `.nanoforge/mcp.json`. */
export const mcpRegistryFileSchema = z.object({
  servers: z.array(mcpServerDefinitionSchema).default([]),
});

export type McpRegistryFile = z.infer<typeof mcpRegistryFileSchema>;

export type McpHealth = "unknown" | "ok" | "error";

/**
 * The per-server shape the IntegrationsPanel renders. Contains NO secret
 * material: `env` is reduced to variable names only.
 */
export interface McpServerStatus {
  name: string;
  displayName?: string;
  icon?: string;
  version?: string;
  transport: "stdio" | "sse";
  enabled: boolean;
  health: McpHealth;
  /** Last error string, if any. Never contains secret values. */
  lastError?: string;
  command: string;
  args: string[];
  /** Declared tool allow-list from the registry. */
  tools: string[];
  /** Names of the env vars the server expects (references only, never values). */
  envKeys: string[];
}

/** Project a registry definition into the UI-facing status shape. */
export function toServerStatus(
  def: McpServerDefinition,
  health: McpHealth = "unknown",
  lastError?: string,
): McpServerStatus {
  return {
    name: def.name,
    displayName: def.displayName,
    icon: def.icon,
    version: def.version,
    transport: def.transport,
    enabled: def.enabled,
    health,
    lastError,
    command: def.command,
    args: [...def.args],
    tools: [...def.tools],
    envKeys: Object.keys(def.env),
  };
}
