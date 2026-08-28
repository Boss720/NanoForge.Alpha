/**
 * MCP registry (Task 13): loads and validates `.nanoforge/mcp.json`.
 *
 * The registry is the allow-list of MCP servers the host may ever start.
 * `isCommandApproved` is the exact-match gate used by the client before any
 * spawn: a launch whose command differs from the stored registry entry is
 * denied before a process exists.
 */

import { promises as fs } from "node:fs";
import {
  mcpServerDefinitionSchema,
  type McpServerDefinition,
} from "./types";

export interface McpRegistryError {
  /** Path of the registry file the error refers to. */
  file: string;
  kind: "read" | "parse" | "validation";
  /** Human-readable reason. Never contains secret values. */
  message: string;
}

export interface McpRegistry {
  /** Validated server definitions, in file order. */
  servers: McpServerDefinition[];
  /** Absolute path the registry was loaded from. */
  sourcePath: string;
}

export interface LoadMcpRegistryResult {
  registry: McpRegistry;
  errors: McpRegistryError[];
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? text;
}

/**
 * Load `.nanoforge/mcp.json`. A missing file yields an empty registry (not an
 * error). Invalid JSON invalidates the whole file; individual invalid server
 * entries are skipped with a structured error each, keeping valid entries
 * usable. Duplicate names are rejected (first entry wins).
 */
export async function loadMcpRegistry(filePath: string): Promise<LoadMcpRegistryResult> {
  const errors: McpRegistryError[] = [];
  const registry: McpRegistry = { servers: [], sourcePath: filePath };

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      errors.push({ file: filePath, kind: "read", message: firstLine(String(err)) });
    }
    return { registry, errors };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    errors.push({
      file: filePath,
      kind: "parse",
      message: `invalid JSON: ${firstLine(err instanceof Error ? err.message : String(err))}`,
    });
    return { registry, errors };
  }

  const serversRaw = (json as { servers?: unknown })?.servers;
  if (serversRaw === undefined) return { registry, errors };
  if (!Array.isArray(serversRaw)) {
    errors.push({ file: filePath, kind: "validation", message: '"servers" must be an array' });
    return { registry, errors };
  }

  const seen = new Set<string>();
  serversRaw.forEach((entry, index) => {
    const checked = mcpServerDefinitionSchema.safeParse(entry);
    if (!checked.success) {
      const detail = checked.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      errors.push({
        file: filePath,
        kind: "validation",
        message: `servers[${index}]: ${detail}`,
      });
      return;
    }
    if (seen.has(checked.data.name)) {
      errors.push({
        file: filePath,
        kind: "validation",
        message: `servers[${index}]: duplicate server name "${checked.data.name}"`,
      });
      return;
    }
    seen.add(checked.data.name);
    registry.servers.push(checked.data);
  });

  return { registry, errors };
}

/** Look up a server definition by name. */
export function getServer(
  registry: Pick<McpRegistry, "servers">,
  name: string,
): McpServerDefinition | undefined {
  return registry.servers.find((server) => server.name === name);
}

/**
 * Load multiple registry files (e.g. global and plugin-level) and merge them.
 * Duplicate server names are rejected across all files (first one wins).
 */
export async function loadMcpRegistries(filePaths: string[]): Promise<LoadMcpRegistryResult> {
  const mergedRegistry: McpRegistry = { servers: [], sourcePath: filePaths.join(",") };
  const allErrors: McpRegistryError[] = [];
  const seen = new Set<string>();

  for (const filePath of filePaths) {
    const { registry, errors } = await loadMcpRegistry(filePath);
    allErrors.push(...errors);
    
    for (const server of registry.servers) {
      if (seen.has(server.name)) {
        allErrors.push({
          file: filePath,
          kind: "validation",
          message: `duplicate server name "${server.name}" across registries`,
        });
        continue;
      }
      seen.add(server.name);
      mergedRegistry.servers.push(server);
    }
  }

  return { registry: mergedRegistry, errors: allErrors };
}

/**
 * Exact-match command approval. A launch command is approved only when it is
 * byte-for-byte identical to the command stored in the registry entry. Any
 * difference — different path, different spelling, symlinked alias — is
 * denied before spawn.
 */
export function isCommandApproved(entry: McpServerDefinition, command: string): boolean {
  return entry.command === command;
}
