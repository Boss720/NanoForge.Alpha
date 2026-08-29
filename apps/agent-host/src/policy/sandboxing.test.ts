import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  authorizeSubagentPathAccess,
  canonicalizeSubagentPath,
} from "./policy.js";

describe("Subagent Path Confinement & Sandboxing (SEC-SUB-01)", () => {
  const workspaceRoot = path.resolve("/app/nanoforge");

  it("allows writes to own assigned metadata directory", () => {
    const decision = authorizeSubagentPathAccess(
      {
        subagentId: "agent-123",
        subagentName: "worker_1",
        archetype: "implementer",
        workspaceRoot,
        assignedMetadataDir: ".agents/worker_1_123",
        isolationMode: "inherit",
      },
      {
        candidatePath: ".agents/worker_1_123/progress.md",
        operation: "write",
      }
    );

    expect(decision.allowed).toBe(true);
    expect(decision.decision).toBe("allow");
  });

  it("strictly DENIES write to other subagent metadata folder (SEC-SUB-01)", () => {
    const decision = authorizeSubagentPathAccess(
      {
        subagentId: "agent-123",
        subagentName: "worker_1",
        archetype: "implementer",
        workspaceRoot,
        assignedMetadataDir: ".agents/worker_1_123",
        isolationMode: "inherit",
      },
      {
        candidatePath: ".agents/other_agent_456/BRIEFING.md",
        operation: "write",
      }
    );

    expect(decision.allowed).toBe(false);
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("SEC-SUB-01 Violation");
  });

  it("strictly DENIES write to .agents root folder directly", () => {
    const decision = authorizeSubagentPathAccess(
      {
        subagentId: "agent-123",
        workspaceRoot,
        assignedMetadataDir: ".agents/worker_1_123",
        isolationMode: "inherit",
      },
      {
        candidatePath: ".agents/rogue_file.txt",
        operation: "write",
      }
    );

    expect(decision.allowed).toBe(false);
    expect(decision.decision).toBe("deny");
  });

  it("allows reading metadata from other subagent folders (cross-agent collaboration)", () => {
    const decision = authorizeSubagentPathAccess(
      {
        subagentId: "agent-123",
        workspaceRoot,
        assignedMetadataDir: ".agents/worker_1_123",
        isolationMode: "inherit",
      },
      {
        candidatePath: ".agents/other_agent_456/handoff.md",
        operation: "read",
      }
    );

    expect(decision.allowed).toBe(true);
    expect(decision.decision).toBe("allow");
  });

  it("blocks directory traversal escaping the workspace via ../ or %2e%2e", () => {
    const decision1 = authorizeSubagentPathAccess(
      {
        subagentId: "agent-123",
        workspaceRoot,
        assignedMetadataDir: ".agents/worker_1_123",
        isolationMode: "inherit",
      },
      {
        candidatePath: "../../../etc/passwd",
        operation: "read",
      }
    );
    expect(decision1.allowed).toBe(false);
    expect(decision1.decision).toBe("deny");

    const decision2 = authorizeSubagentPathAccess(
      {
        subagentId: "agent-123",
        workspaceRoot,
        assignedMetadataDir: ".agents/worker_1_123",
        isolationMode: "inherit",
      },
      {
        candidatePath: "%2e%2e%2f%2e%2e%2fetc%2fshadow",
        operation: "read",
      }
    );
    expect(decision2.allowed).toBe(false);
    expect(decision2.decision).toBe("deny");
  });

  it("blocks source code mutations for read-only archetypes (explorer, verifier, planner)", () => {
    const decision = authorizeSubagentPathAccess(
      {
        subagentId: "explorer-1",
        archetype: "explorer",
        workspaceRoot,
        assignedMetadataDir: ".agents/explorer_1",
        isolationMode: "inherit",
      },
      {
        candidatePath: "src/server.ts",
        operation: "write",
      }
    );

    expect(decision.allowed).toBe(false);
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("read-only");
  });

  it("confines writes in branch mode to the allocated worktree path", () => {
    const worktreePath = ".agents/worktrees/branch-1";

    const validDecision = authorizeSubagentPathAccess(
      {
        subagentId: "branch-agent",
        archetype: "implementer",
        workspaceRoot,
        assignedMetadataDir: ".agents/branch_agent",
        isolationMode: "branch",
        worktreePath,
      },
      {
        candidatePath: `${worktreePath}/src/feature.ts`,
        operation: "write",
      }
    );
    expect(validDecision.allowed).toBe(true);

    const outsideDecision = authorizeSubagentPathAccess(
      {
        subagentId: "branch-agent",
        archetype: "implementer",
        workspaceRoot,
        assignedMetadataDir: ".agents/branch_agent",
        isolationMode: "branch",
        worktreePath,
      },
      {
        candidatePath: path.join(workspaceRoot, "src/main_repo.ts"),
        operation: "write",
      }
    );
    expect(outsideDecision.allowed).toBe(false);
    expect(outsideDecision.decision).toBe("deny");
  });

  it("confines writes in share mode to scratch directory", () => {
    const scratchDir = ".agents/scratch_share1";

    const scratchDecision = authorizeSubagentPathAccess(
      {
        subagentId: "share-agent",
        archetype: "implementer",
        workspaceRoot,
        assignedMetadataDir: ".agents/share_agent",
        isolationMode: "share",
        scratchDir,
      },
      {
        candidatePath: `${scratchDir}/temp_build.log`,
        operation: "write",
      }
    );
    expect(scratchDecision.allowed).toBe(true);

    const sourceDecision = authorizeSubagentPathAccess(
      {
        subagentId: "share-agent",
        archetype: "implementer",
        workspaceRoot,
        assignedMetadataDir: ".agents/share_agent",
        isolationMode: "share",
        scratchDir,
      },
      {
        candidatePath: "src/index.ts",
        operation: "write",
      }
    );
    expect(sourceDecision.allowed).toBe(false);
    expect(sourceDecision.decision).toBe("deny");
  });
});
