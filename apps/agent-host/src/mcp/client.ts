/**
 * MCP stdio client (Task 13).
 *
 * Lifecycle (`withMcpServer`):
 *   1. The server definition must be enabled in the registry.
 *   2. When a registry is supplied, the launch command must exact-match the
 *      stored registry command (`isCommandApproved`) — otherwise the launch
 *      is denied BEFORE any process is spawned.
 *   3. The caller's `approvalFn` must explicitly approve this run. Without
 *      approval nothing is spawned.
 *   4. Secret references (`env:VAR`) are resolved from the host environment
 *      and passed only to the child process environment; values never appear
 *      in return values, errors, or logs.
 *   5. After connect, `tools/list` is reconciled with the declared allow-list
 *      (`def.tools`): every advertised tool is namespaced `mcp.<server>.<tool>`;
 *      an advertised tool that was NOT declared is quarantined and can never
 *      be called through the session.
 *   6. Call arguments are validated against the tool's advertised inputSchema
 *      before anything is sent to the server.
 *   7. The server process is always terminated when the run ends, whether the
 *      callback returns or throws.
 *
 * Tool OUTPUT is untrusted content; callers must treat it as data, never as
 * instructions.
 */

import {
  Client,
} from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { getServer, isCommandApproved, type McpRegistry } from "./registry";
import type { McpServerDefinition } from "./types";

/* ------------------------------------------------------------------------ */
/* Errors                                                                    */
/* ------------------------------------------------------------------------ */

export type McpErrorCode =
  | "server_disabled"
  | "command_not_approved"
  | "approval_denied"
  | "secret_resolution_failed"
  | "tool_rejected"
  | "invalid_arguments"
  | "server_error";

export class McpError extends Error {
  readonly code: McpErrorCode;
  constructor(code: McpErrorCode, message: string) {
    super(message);
    this.name = "McpError";
    this.code = code;
  }
}

export class McpServerDisabledError extends McpError {
  constructor(name: string) {
    super("server_disabled", `MCP server "${name}" is disabled in the registry`);
    this.name = "McpServerDisabledError";
  }
}

export class McpCommandNotApprovedError extends McpError {
  constructor(message: string) {
    super("command_not_approved", message);
    this.name = "McpCommandNotApprovedError";
  }
}

export class McpApprovalDeniedError extends McpError {
  constructor(name: string) {
    super("approval_denied", `run of MCP server "${name}" was not approved`);
    this.name = "McpApprovalDeniedError";
  }
}

export class McpSecretResolutionError extends McpError {
  constructor(variable: string) {
    // Names the VARIABLE only — never any value.
    super("secret_resolution_failed", `environment variable "${variable}" is not set on the host`);
    this.name = "McpSecretResolutionError";
  }
}

export class McpToolRejectedError extends McpError {
  constructor(message: string) {
    super("tool_rejected", message);
    this.name = "McpToolRejectedError";
  }
}

/* ------------------------------------------------------------------------ */
/* Session types                                                             */
/* ------------------------------------------------------------------------ */

export interface NamespacedTool {
  /** `mcp.<server>.<tool>` — the only name this tool is callable under. */
  namespacedName: string;
  server: string;
  name: string;
  description?: string;
  /** The inputSchema exactly as advertised by the server (JSON Schema object). */
  inputSchema?: unknown;
}

export interface RejectedTool {
  name: string;
  reason: string;
}

export interface McpSession {
  readonly server: string;
  /** OS pid of the spawned server process, when available. */
  readonly pid: number | null;
  /** Callable tools: advertised by the server AND declared in the registry. */
  readonly tools: NamespacedTool[];
  /** Declared in the registry but not advertised by the server. */
  readonly missingTools: string[];
  /** Advertised but NOT declared — quarantined, never callable. */
  readonly rejectedTools: RejectedTool[];
  /** Validate + call a declared tool by its namespaced name. */
  callTool(namespacedName: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Terminate the server process (idempotent; also run automatically by withMcpServer). */
  close(): Promise<void>;
}

/** Namespace a tool name as `mcp.<server>.<tool>`. */
export function namespaceTool(server: string, tool: string): string {
  return `mcp.${server}.${tool}`;
}

/* ------------------------------------------------------------------------ */
/* Argument validation (JSON Schema subset, fail-closed on what it knows)    */
/* ------------------------------------------------------------------------ */

type SchemaObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is SchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(expected: string, value: unknown): boolean {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  return actual === expected;
}

/**
 * Validate args against the common MCP inputSchema subset: `type`,
 * `properties`, `required`, `additionalProperties: false`, `items`, `enum`.
 * Unknown keywords are ignored (documented limitation). Returns a list of
 * problems using `$`-paths; values are NEVER included in the messages.
 */
export function validateToolArgs(schema: unknown, args: unknown, at = "$"): string[] {
  if (!isPlainObject(schema)) return [];
  const problems: string[] = [];

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => candidate === args)) {
    problems.push(`${at}: value is not one of the allowed enum values`);
    return problems;
  }

  const expectedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (expectedTypes.length > 0 && !expectedTypes.some((t) => typeof t === "string" && matchesType(t, args))) {
    problems.push(`${at}: expected ${expectedTypes.join(" | ")}, got ${typeOf(args)}`);
    return problems; // further checks would be meaningless
  }

  if (isPlainObject(args)) {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !(key in args)) problems.push(`${at}.${key}: missing required property`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(args)) {
        if (!(key in properties)) problems.push(`${at}.${key}: property is not declared in the tool schema`);
      }
    }
    for (const [key, subSchema] of Object.entries(properties)) {
      if (key in args) problems.push(...validateToolArgs(subSchema, args[key], `${at}.${key}`));
    }
  }

  if (Array.isArray(args) && schema.items !== undefined) {
    args.forEach((item, index) => {
      problems.push(...validateToolArgs(schema.items, item, `${at}[${index}]`));
    });
  }

  return problems;
}

/* ------------------------------------------------------------------------ */
/* Client handle + default factory                                           */
/* ------------------------------------------------------------------------ */

export interface ResolvedServerParams {
  command: string;
  args: string[];
  /** Fully resolved child environment additions (secret values resolved on the host). */
  env: Record<string, string>;
}

/** Minimal handle the session needs — injectable for tests (spawn counter). */
export interface McpClientHandle {
  readonly pid: number | null;
  listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

const HOST_CLIENT_INFO = { name: "nanoforge-agent-host", version: "0.0.0" } as const;

/**
 * Default factory: spawn the server over stdio with the real SDK client.
 * The child environment is the SDK's safe default environment plus the
 * resolved secret variables — never the whole host environment.
 */
export async function defaultClientFactory(params: ResolvedServerParams): Promise<McpClientHandle> {
  const transport = new StdioClientTransport({
    command: params.command,
    args: params.args,
    env: { ...getDefaultEnvironment(), ...params.env },
    // Captured, not inherited: server stderr is untrusted output and must not
    // leak into host logs (it may echo secret material from a buggy server).
    stderr: "pipe",
  });
  const client = new Client(HOST_CLIENT_INFO, { capabilities: {} });
  await client.connect(transport);
  return {
    pid: transport.pid,
    async listTools() {
      const result = await client.listTools();
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },
    async callTool(name, args) {
      return client.callTool({ name, arguments: args });
    },
    async close() {
      await client.close();
    },
  };
}

/* ------------------------------------------------------------------------ */
/* withMcpServer                                                             */
/* ------------------------------------------------------------------------ */

export type McpApprovalFn = (def: McpServerDefinition) => boolean | Promise<boolean>;

export type EnvLookup = (variable: string) => string | undefined;

export interface WithMcpServerDeps {
  /**
   * When provided, `def.command` must exact-match the stored registry entry
   * for `def.name` — a mismatch is denied before spawn.
   */
  registry?: Pick<McpRegistry, "servers">;
  /** Test hook: observe/replace client creation (e.g. a spawn counter). */
  clientFactory?: (params: ResolvedServerParams) => Promise<McpClientHandle>;
  /** Where secret references resolve from. Defaults to process.env. */
  envLookup?: EnvLookup;
}

function resolveSecretEnv(
  def: McpServerDefinition,
  lookup: EnvLookup,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [childVar, reference] of Object.entries(def.env)) {
    const hostVar = reference.slice("env:".length);
    const value = lookup(hostVar);
    if (value === undefined) throw new McpSecretResolutionError(hostVar);
    resolved[childVar] = value;
  }
  return resolved;
}

/**
 * Run `fn` against an approved MCP server over stdio, then ALWAYS terminate
 * the server. No process is spawned unless every gate passes: enabled in
 * registry, command exact-match against the registry (when supplied), and an
 * explicit truthy approval from `approvalFn`.
 */
export async function withMcpServer<T>(
  def: McpServerDefinition,
  approvalFn: McpApprovalFn,
  fn: (session: McpSession) => T | Promise<T>,
  deps: WithMcpServerDeps = {},
): Promise<T> {
  // Gate 1: the registry entry must be enabled.
  if (!def.enabled) throw new McpServerDisabledError(def.name);

  // Gate 2: command exact-match against the stored registry entry.
  if (deps.registry) {
    const entry = getServer(deps.registry, def.name);
    if (!entry) {
      throw new McpCommandNotApprovedError(
        `MCP server "${def.name}" is not present in the registry; spawn denied`,
      );
    }
    if (!isCommandApproved(entry, def.command)) {
      throw new McpCommandNotApprovedError(
        `command for MCP server "${def.name}" does not match the approved registry command; spawn denied`,
      );
    }
  }

  // Gate 3: explicit per-run approval.
  if (!(await approvalFn(def))) throw new McpApprovalDeniedError(def.name);

  // Secrets resolve on the host, immediately before spawn, and travel only
  // into the child process environment.
  const envLookup: EnvLookup = deps.envLookup ?? ((variable) => process.env[variable]);
  const env = resolveSecretEnv(def, envLookup);

  const factory = deps.clientFactory ?? defaultClientFactory;
  const handle = await factory({ command: def.command, args: [...def.args], env });

  let fnThrew = false;
  try {
    const advertised = await handle.listTools();
    const declared = new Set(def.tools);
    const advertisedNames = new Set(advertised.map((tool) => tool.name));

    const tools: NamespacedTool[] = [];
    const rejectedTools: RejectedTool[] = [];
    for (const tool of advertised) {
      if (declared.has(tool.name)) {
        tools.push({
          namespacedName: namespaceTool(def.name, tool.name),
          server: def.name,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      } else {
        rejectedTools.push({
          name: tool.name,
          reason: `tool "${tool.name}" is not declared in the registry entry for "${def.name}"; quarantined`,
        });
      }
    }
    const missingTools = def.tools.filter((name) => !advertisedNames.has(name));

    const prefix = `mcp.${def.name}.`;
    let closed = false;
    const session: McpSession = {
      server: def.name,
      pid: handle.pid,
      tools,
      missingTools,
      rejectedTools,
      async callTool(namespacedName, args = {}) {
        if (closed) throw new McpError("server_error", "session is closed");
        if (typeof namespacedName !== "string" || !namespacedName.startsWith(prefix)) {
          throw new McpToolRejectedError(
            `tool name "${String(namespacedName)}" is not in the "${prefix}*" namespace`,
          );
        }
        const toolName = namespacedName.slice(prefix.length);
        const rejected = rejectedTools.find((tool) => tool.name === toolName);
        if (rejected) {
          throw new McpToolRejectedError(
            `tool "${namespacedName}" was advertised by the server but is not declared in the registry; it is quarantined and can never be called`,
          );
        }
        const tool = tools.find((candidate) => candidate.name === toolName);
        if (!tool) {
          throw new McpToolRejectedError(`unknown tool "${namespacedName}" for MCP server "${def.name}"`);
        }
        const problems = validateToolArgs(tool.inputSchema, args);
        if (problems.length > 0) {
          throw new McpError(
            "invalid_arguments",
            `invalid arguments for ${namespacedName}: ${problems.join("; ")}`,
          );
        }
        return handle.callTool(toolName, args);
      },
      async close() {
        if (closed) return;
        closed = true;
        await handle.close();
      },
    };

    return await fn(session);
  } catch (err) {
    fnThrew = true;
    throw err;
  } finally {
    // The server process must not outlive the run, whatever happened above.
    try {
      await handle.close();
    } catch (closeErr) {
      if (!fnThrew) throw closeErr; // do not mask the callback's own error
    }
  }
}
