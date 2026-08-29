import { describe, it, expect, beforeEach } from "vitest";
import { HierarchyManager } from "./hierarchy.js";
import { SubagentRegistry } from "./registry.js";
import type { SubagentNode } from "./types.js";

describe("HierarchyManager (Depth Limits, Concurrency, and Cascading Abort)", () => {
  let hierarchy: HierarchyManager;
  let registry: SubagentRegistry;

  function createNode(id: string, parentId: string | null, name: string): SubagentNode {
    const now = new Date().toISOString();
    return {
      id,
      parentId,
      name,
      archetype: "implementer",
      roles: ["implementer"],
      workingDirectory: "/repo",
      metadataDir: `.agents/${name}`,
      isolationMode: "inherit",
      tokensUsed: 0,
      turnCount: 0,
      state: "running",
      startedAt: now,
      lastHeartbeat: now,
      abortController: new AbortController(),
      skills: [],
    };
  }

  beforeEach(() => {
    hierarchy = new HierarchyManager();
    registry = new SubagentRegistry();
  });

  it("calculates node depth accurately", () => {
    const rootId = "root-node-id";
    const l1Id = "l1-child-id";
    const l2Id = "l2-child-id";

    registry.register(createNode(rootId, null, "root"));
    registry.register(createNode(l1Id, rootId, "l1"));
    registry.register(createNode(l2Id, l1Id, "l2"));

    expect(hierarchy.getDepth(rootId, registry)).toBe(1);
    expect(hierarchy.getDepth(l1Id, registry)).toBe(2);
    expect(hierarchy.getDepth(l2Id, registry)).toBe(3);
  });

  it("permits spawning at depth 1, 2, and 3", () => {
    const rootId = "root-1";
    const l1Id = "l1-1";

    registry.register(createNode(rootId, null, "root"));
    registry.register(createNode(l1Id, rootId, "l1"));

    // Spawning under null parent (Depth 1) -> ok
    expect(() => hierarchy.validateSpawn(null, registry)).not.toThrow();

    // Spawning under root (Depth 2) -> ok
    expect(() => hierarchy.validateSpawn(rootId, registry)).not.toThrow();

    // Spawning under L1 (Depth 3) -> ok
    expect(() => hierarchy.validateSpawn(l1Id, registry)).not.toThrow();
  });

  it("strictly THROWS ERR_SUBAGENT_MAX_DEPTH_EXCEEDED when attempting to spawn at Depth 4 (SEC-SUB-05)", () => {
    const rootId = "root-1";
    const l1Id = "l1-1";
    const l2Id = "l2-1";

    registry.register(createNode(rootId, null, "root"));
    registry.register(createNode(l1Id, rootId, "l1"));
    registry.register(createNode(l2Id, l1Id, "l2"));

    // l2Id is already at depth 3. Spawning under l2Id would be depth 4 -> MUST THROW
    expect(() => hierarchy.validateSpawn(l2Id, registry)).toThrow(
      /ERR_SUBAGENT_MAX_DEPTH_EXCEEDED/
    );
  });

  it("enforces maximum concurrency limit of 8 active subagents", () => {
    // Register 8 active subagents
    for (let i = 1; i <= 8; i++) {
      registry.register(createNode(`active-${i}`, null, `agent_${i}`));
    }

    // 9th spawn must throw concurrency error
    expect(() => hierarchy.validateSpawn(null, registry)).toThrow(
      /ERR_SUBAGENT_CONCURRENCY_LIMIT_EXCEEDED/
    );
  });

  it("executes post-order cascading killTree across nested subagent tree", async () => {
    const rootId = "root-kill";
    const child1Id = "child-1-kill";
    const grandChildId = "grandchild-1-kill";
    const child2Id = "child-2-kill";

    const rootNode = createNode(rootId, null, "root");
    const c1Node = createNode(child1Id, rootId, "child_1");
    const gcNode = createNode(grandChildId, child1Id, "grandchild");
    const c2Node = createNode(child2Id, rootId, "child_2");

    registry.register(rootNode);
    registry.register(c1Node);
    registry.register(gcNode);
    registry.register(c2Node);

    const postOrder = hierarchy.collectSubtreePostOrder(rootId, registry);
    // grandChild before child1, and all before root
    expect(postOrder.indexOf(grandChildId)).toBeLessThan(postOrder.indexOf(child1Id));
    expect(postOrder.indexOf(child1Id)).toBeLessThan(postOrder.indexOf(rootId));
    expect(postOrder.indexOf(child2Id)).toBeLessThan(postOrder.indexOf(rootId));

    const killedIds = await hierarchy.killTree(rootId, registry);
    expect(killedIds.length).toBe(4);
    expect(rootNode.state).toBe("errored");
    expect(c1Node.state).toBe("errored");
    expect(gcNode.state).toBe("errored");
    expect(c2Node.state).toBe("errored");
  });
});
