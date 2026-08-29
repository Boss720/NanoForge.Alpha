import { describe, it, expect, beforeEach } from "vitest";
import { SubagentRegistry } from "./registry.js";
import type { SubagentNode } from "./types.js";

describe("SubagentRegistry", () => {
  let registry: SubagentRegistry;

  beforeEach(() => {
    registry = new SubagentRegistry();
  });

  function createMockNode(params: Partial<SubagentNode>): SubagentNode {
    const id = params.id ?? "11111111-1111-4111-8111-111111111111";
    const now = new Date().toISOString();
    return {
      id,
      parentId: params.parentId ?? null,
      name: params.name ?? "test_agent",
      archetype: params.archetype ?? "implementer",
      roles: params.roles ?? ["implementer"],
      workingDirectory: "/repo",
      metadataDir: `.agents/test_${id.slice(0, 8)}`,
      isolationMode: "inherit",
      tokensUsed: 0,
      turnCount: 0,
      state: "running",
      startedAt: now,
      lastHeartbeat: now,
      abortController: new AbortController(),
      skills: [],
      ...params,
    };
  }

  it("registers and retrieves subagent nodes", () => {
    const node = createMockNode({ id: "22222222-2222-4222-8222-222222222222", name: "explorer_1" });
    registry.register(node);

    const retrieved = registry.get(node.id);
    expect(retrieved?.name).toBe("explorer_1");

    const summary = registry.getSummary(node.id);
    expect(summary?.id).toBe(node.id);
    expect(summary?.state).toBe("running");
  });

  it("indexes parent and child relationships correctly", () => {
    const parent = createMockNode({ id: "33333333-3333-4333-8333-333333333333", parentId: null });
    const child1 = createMockNode({ id: "44444444-4444-4444-8444-444444444444", parentId: parent.id });
    const child2 = createMockNode({ id: "55555555-5555-4555-8555-555555555555", parentId: parent.id });

    registry.register(parent);
    registry.register(child1);
    registry.register(child2);

    const children = registry.getChildren(parent.id);
    expect(children.length).toBe(2);
    expect(children.map((c) => c.id)).toContain(child1.id);
    expect(children.map((c) => c.id)).toContain(child2.id);
  });

  it("validates state transitions and rejects invalid FSM transitions", () => {
    const node = createMockNode({ id: "66666666-6666-4666-8666-666666666666" });
    registry.register(node);

    // running -> idle (valid)
    expect(registry.updateState(node.id, "idle")).toBe(true);
    expect(registry.get(node.id)?.state).toBe("idle");

    // idle -> errored (valid)
    expect(registry.updateState(node.id, "errored", "Crash occurred")).toBe(true);
    expect(registry.get(node.id)?.state).toBe("errored");

    // errored -> running (invalid terminal state transition, must throw)
    expect(() => registry.updateState(node.id, "running")).toThrow(/INVALID_STATE_TRANSITION/);
  });

  it("registers and queries custom subagent templates", () => {
    const templateRes = registry.registerTemplate({
      name: "SecurityAuditor",
      archetype: "custom",
      description: "Audits AST for vulnerabilities",
      systemPromptTemplate: "You are a specialized security auditor...",
      defaultRoles: ["verifier"],
      skills: ["code-analyzer"],
      defaultTimeoutSeconds: 600,
      defaultIsolation: "inherit",
    });

    expect(templateRes.registered).toBe(true);
    expect(templateRes.name).toBe("SecurityAuditor");

    const found = registry.getTemplate("SecurityAuditor");
    expect(found?.description).toBe("Audits AST for vulnerabilities");

    const all = registry.listTemplates();
    expect(all.length).toBe(1);
  });

  it("performs liveness sweeps and detects stalled nodes", () => {
    const staleTime = new Date(Date.now() - 300_000).toISOString(); // 5 minutes ago
    const staleNode = createMockNode({
      id: "77777777-7777-4777-8777-777777777777",
      lastHeartbeat: staleTime,
      state: "running",
    });

    registry.register(staleNode);
    const staleIds = registry.livenessSweep(180_000); // 3 minutes timeout

    expect(staleIds).toContain(staleNode.id);
    expect(registry.get(staleNode.id)?.state).toBe("errored");
  });
});
