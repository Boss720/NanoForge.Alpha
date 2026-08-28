import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultClientFactory,
  McpApprovalDeniedError,
  McpCommandNotApprovedError,
  McpSecretResolutionError,
  McpServerDisabledError,
  McpToolRejectedError,
  namespaceTool,
  validateToolArgs,
  withMcpServer,
  type McpClientHandle,
  type ResolvedServerParams,
} from "./client";
import { getServer, isCommandApproved, loadMcpRegistry, type McpRegistry } from "./registry";
import type { McpServerDefinition } from "./types";

const fixturePath = fileURLToPath(new URL("./__fixtures__/fake-mcp-server.mjs", import.meta.url));

let scratch: string;

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-mcp-"));
});

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

function makeDef(overrides: Partial<McpServerDefinition> = {}): McpServerDefinition {
  return {
    name: "fake",
    command: process.execPath,
    args: [fixturePath],
    env: {},
    tools: ["echo"],
    enabled: true,
    transport: "stdio",
    ...overrides,
  };
}

/** Factory that counts spawns and fails the test if it is ever invoked. */
function forbiddenFactory() {
  const state = { spawns: 0 };
  const factory = async (_params: ResolvedServerParams): Promise<McpClientHandle> => {
    state.spawns += 1;
    throw new Error("spawn must never happen in this test");
  };
  return { state, factory };
}

async function expectProcessDead(pid: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return; // ESRCH — the process is gone
    }
    if (Date.now() > deadline) throw new Error(`process ${pid} is still alive`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const approve = () => true;

describe("registry", () => {
  it("loads a valid mcp.json and answers lookups", async () => {
    const file = path.join(scratch, "mcp.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        servers: [
          {
            name: "github-example",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_TOKEN: "env:GITHUB_TOKEN" },
            tools: ["get_file_contents"],
            enabled: false,
          },
        ],
      }),
      "utf8",
    );
    const { registry, errors } = await loadMcpRegistry(file);
    expect(errors).toEqual([]);
    expect(registry.servers).toHaveLength(1);
    const entry = getServer(registry, "github-example")!;
    expect(entry.enabled).toBe(false);
    expect(isCommandApproved(entry, "npx")).toBe(true);
    expect(isCommandApproved(entry, "npx.cmd")).toBe(false); // exact match only
  });

  it("treats a missing registry file as an empty registry without errors", async () => {
    const { registry, errors } = await loadMcpRegistry(path.join(scratch, "nope.json"));
    expect(registry.servers).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("reports invalid JSON as a structured parse error", async () => {
    const file = path.join(scratch, "mcp.json");
    await fs.writeFile(file, "{ not json", "utf8");
    const { registry, errors } = await loadMcpRegistry(file);
    expect(registry.servers).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe("parse");
    expect(errors[0].file).toBe(file);
  });

  it("skips invalid entries (literal secret values are rejected) and duplicate names", async () => {
    const file = path.join(scratch, "mcp.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        servers: [
          { name: "good", command: "npx", args: [], env: {}, tools: [], enabled: true },
          // Literal secret value instead of an "env:" reference — must be rejected.
          { name: "bad-secret", command: "npx", args: [], env: { TOKEN: "ghp_literal" }, tools: [], enabled: true },
          { name: "good", command: "other", args: [], env: {}, tools: [], enabled: true },
        ],
      }),
      "utf8",
    );
    const { registry, errors } = await loadMcpRegistry(file);
    expect(registry.servers.map((s) => s.name)).toEqual(["good"]);
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toContain("servers[1]");
    expect(errors[0].message).toContain("env:");
    expect(errors[1].message).toContain("duplicate");
  });
});

describe("withMcpServer", () => {
  it("lists declared tools namespaced as mcp.<server>.<tool> and calls them", async () => {
    const def = makeDef();
    let childPid: number | null = null;

    const result = await withMcpServer(def, approve, async (session) => {
      childPid = session.pid;
      expect(session.server).toBe("fake");
      expect(session.rejectedTools).toEqual([]);
      expect(session.missingTools).toEqual([]);
      expect(session.tools.map((t) => t.namespacedName)).toEqual(["mcp.fake.echo"]);

      const echoResult = (await session.callTool("mcp.fake.echo", { text: "hello" })) as {
        content: Array<{ type: string; text: string }>;
      };
      expect(echoResult.content[0].text).toBe("echo:hello");
      return "done";
    });

    expect(result).toBe("done");
    expect(childPid).not.toBeNull();
    await expectProcessDead(childPid!); // server terminated after the run
  });

  it("quarantines a tool the server advertises but the registry does not declare", async () => {
    const def = makeDef({ args: [fixturePath, "--rogue"] });
    let childPid: number | null = null;

    await withMcpServer(def, approve, async (session) => {
      childPid = session.pid;
      expect(session.tools.map((t) => t.namespacedName)).toEqual(["mcp.fake.echo"]);
      expect(session.rejectedTools).toHaveLength(1);
      expect(session.rejectedTools[0].name).toBe("rogue_tool");
      expect(session.rejectedTools[0].reason).toContain("not declared");

      await expect(session.callTool("mcp.fake.rogue_tool", {})).rejects.toBeInstanceOf(
        McpToolRejectedError,
      );
    });

    await expectProcessDead(childPid!);
  });

  it("denies spawn when the command differs from the registry entry (no process spawned)", async () => {
    const registry: McpRegistry = {
      sourcePath: path.join(scratch, "mcp.json"),
      servers: [makeDef({ command: "C:\\approved\\node.exe" })],
    };
    const { state, factory } = forbiddenFactory();
    const approvalFn = vi.fn(approve);

    await expect(
      withMcpServer(makeDef(), approvalFn, async () => "never", { registry, clientFactory: factory }),
    ).rejects.toBeInstanceOf(McpCommandNotApprovedError);

    expect(state.spawns).toBe(0);
    expect(approvalFn).not.toHaveBeenCalled(); // denied before approval is even requested
  });

  it("denies spawn for a server absent from the registry", async () => {
    const registry: McpRegistry = { sourcePath: "test", servers: [] };
    const { state, factory } = forbiddenFactory();
    await expect(
      withMcpServer(makeDef(), approve, async () => "never", { registry, clientFactory: factory }),
    ).rejects.toBeInstanceOf(McpCommandNotApprovedError);
    expect(state.spawns).toBe(0);
  });

  it("spawns nothing when the approval callback denies the run", async () => {
    const { state, factory } = forbiddenFactory();
    await expect(
      withMcpServer(makeDef(), () => false, async () => "never", { clientFactory: factory }),
    ).rejects.toBeInstanceOf(McpApprovalDeniedError);
    expect(state.spawns).toBe(0);
  });

  it("spawns nothing for a disabled server, even with approval", async () => {
    const { state, factory } = forbiddenFactory();
    const approvalFn = vi.fn(approve);
    await expect(
      withMcpServer(makeDef({ enabled: false }), approvalFn, async () => "never", {
        clientFactory: factory,
      }),
    ).rejects.toBeInstanceOf(McpServerDisabledError);
    expect(state.spawns).toBe(0);
    expect(approvalFn).not.toHaveBeenCalled();
  });

  it("resolves secret references via envLookup and passes them only to the child env", async () => {
    const def = makeDef({ env: { GITHUB_TOKEN: "env:NF_TEST_FAKE_SECRET" } });
    let captured: ResolvedServerParams | undefined;
    const factory = async (params: ResolvedServerParams): Promise<McpClientHandle> => {
      captured = params;
      return defaultClientFactory(params);
    };

    let childPid: number | null = null;
    await withMcpServer(
      def,
      approve,
      async (session) => {
        childPid = session.pid;
      },
      {
        clientFactory: factory,
        envLookup: (variable) => (variable === "NF_TEST_FAKE_SECRET" ? "fake-test-value" : undefined),
      },
    );

    expect(captured).toBeDefined();
    expect(captured!.env.GITHUB_TOKEN).toBe("fake-test-value");
    await expectProcessDead(childPid!);
  });

  it("fails before spawn when a referenced env var is missing", async () => {
    const def = makeDef({ env: { GITHUB_TOKEN: "env:NF_DEFINITELY_UNSET_VAR" } });
    const { state, factory } = forbiddenFactory();
    await expect(
      withMcpServer(def, approve, async () => "never", {
        clientFactory: factory,
        envLookup: () => undefined,
      }),
    ).rejects.toBeInstanceOf(McpSecretResolutionError);
    expect(state.spawns).toBe(0);
  });

  it("terminates the server even when the callback throws", async () => {
    let childPid: number | null = null;
    await expect(
      withMcpServer(makeDef(), approve, async (session) => {
        childPid = session.pid;
        throw new Error("callback exploded");
      }),
    ).rejects.toThrow("callback exploded");
    expect(childPid).not.toBeNull();
    await expectProcessDead(childPid!);
  });

  it("validates call arguments against the tool inputSchema before sending", async () => {
    let serverCalls = 0;
    const factory = async (params: ResolvedServerParams): Promise<McpClientHandle> => {
      const real = await defaultClientFactory(params);
      return {
        ...real,
        callTool: async (name, args) => {
          serverCalls += 1;
          return real.callTool(name, args);
        },
      };
    };

    let childPid: number | null = null;
    await withMcpServer(
      makeDef(),
      approve,
      async (session) => {
        childPid = session.pid;
        // Missing required "text" — must be rejected client-side.
        await expect(session.callTool("mcp.fake.echo", {})).rejects.toMatchObject({
          code: "invalid_arguments",
        });
        await expect(session.callTool("mcp.fake.echo", { text: 42 })).rejects.toMatchObject({
          code: "invalid_arguments",
        });
        // And the valid call still goes through.
        const ok = (await session.callTool("mcp.fake.echo", { text: "x" })) as {
          content: Array<{ text: string }>;
        };
        expect(ok.content[0].text).toBe("echo:x");
      },
      { clientFactory: factory },
    );

    expect(serverCalls).toBe(1); // only the valid call reached the server
    await expectProcessDead(childPid!);
  });

  it("rejects calls outside the mcp.<server> namespace and unknown tools", async () => {
    let childPid: number | null = null;
    await withMcpServer(makeDef(), approve, async (session) => {
      childPid = session.pid;
      await expect(session.callTool("mcp.other.echo", {})).rejects.toBeInstanceOf(
        McpToolRejectedError,
      );
      await expect(session.callTool("echo", {})).rejects.toBeInstanceOf(McpToolRejectedError);
      await expect(session.callTool("mcp.fake.ghost", {})).rejects.toBeInstanceOf(
        McpToolRejectedError,
      );
    });
    await expectProcessDead(childPid!);
  });
});

describe("namespaceTool / validateToolArgs", () => {
  it("namespaces tools as mcp.<server>.<tool>", () => {
    expect(namespaceTool("github", "get_file")).toBe("mcp.github.get_file");
  });

  it("enforces required, types, and additionalProperties:false", () => {
    const schema = {
      type: "object",
      properties: { text: { type: "string" }, n: { type: "integer" } },
      required: ["text"],
      additionalProperties: false,
    };
    expect(validateToolArgs(schema, { text: "a", n: 1 })).toEqual([]);
    expect(validateToolArgs(schema, { n: 1 })).toEqual(["$.text: missing required property"]);
    expect(validateToolArgs(schema, { text: "a", extra: 1 })).toEqual([
      "$.extra: property is not declared in the tool schema",
    ]);
    expect(validateToolArgs(schema, { text: 1 })).toEqual(["$.text: expected string, got integer"]);
  });
});
