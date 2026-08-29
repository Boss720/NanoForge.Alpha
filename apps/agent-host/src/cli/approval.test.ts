/**
 * Non-Interactive Approval Gate & Safety Classifier Tests.
 */

import { describe, expect, it, vi } from "vitest";
import type { ToolRequest } from "../policy/policy";
import type { ApprovalRequest } from "../runs/coordinator";
import { CLIApprovalGate, isSafeToolRequest } from "./approval";

describe("isSafeToolRequest", () => {
  it("identifies read-only shell utilities as safe", () => {
    const safeExecutables = ["ls", "cat", "echo", "pwd", "grep", "find", "wc"];
    for (const exe of safeExecutables) {
      const req: ToolRequest = {
        kind: "terminal.exec",
        cwd: ".",
        executable: exe,
        args: ["somefile.txt"],
      };
      expect(isSafeToolRequest(req)).toBe(true);
    }
  });

  it("identifies git read-only subcommands as safe", () => {
    const safeGitArgs = [
      ["status"],
      ["log", "-n", "5"],
      ["diff", "HEAD~1"],
      ["show", "HEAD"],
      ["branch"],
      ["rev-parse", "HEAD"],
    ];
    for (const args of safeGitArgs) {
      const req: ToolRequest = {
        kind: "terminal.exec",
        cwd: ".",
        executable: "git",
        args,
      };
      expect(isSafeToolRequest(req)).toBe(true);
    }
  });

  it("identifies tool version checks as safe", () => {
    const versionChecks = [
      { executable: "node", args: ["--version"] },
      { executable: "npm", args: ["-v"] },
      { executable: "tsc", args: ["--version"] },
      { executable: "python", args: ["--version"] },
    ];
    for (const { executable, args } of versionChecks) {
      const req: ToolRequest = {
        kind: "terminal.exec",
        cwd: ".",
        executable,
        args,
      };
      expect(isSafeToolRequest(req)).toBe(true);
    }
  });

  it("classifies mutating or dangerous operations as NOT safe", () => {
    const dangerousRequests: ToolRequest[] = [
      { kind: "terminal.exec", cwd: ".", executable: "rm", args: ["-rf", "dist"] },
      { kind: "terminal.exec", cwd: ".", executable: "git", args: ["push", "origin", "main"] },
      { kind: "terminal.exec", cwd: ".", executable: "git", args: ["commit", "-m", "fix"] },
      { kind: "terminal.exec", cwd: ".", executable: "npm", args: ["install", "express"] },
      { kind: "terminal.exec", cwd: ".", executable: "curl", args: ["-X", "POST", "https://api.com"] },
      { kind: "terminal.exec", cwd: ".", executable: "chmod", args: ["777", "script.sh"] },
      { kind: "terminal.exec", cwd: ".", executable: "del", args: ["important.db"] },
    ];
    for (const req of dangerousRequests) {
      expect(isSafeToolRequest(req)).toBe(false);
    }
  });
});

describe("CLIApprovalGate", () => {
  const safeReq: ApprovalRequest = {
    runId: "run-1",
    stepId: "step-1",
    tool: "terminal.exec",
    reason: "git status read",
    request: {
      kind: "terminal.exec",
      cwd: ".",
      executable: "git",
      args: ["status"],
    },
  };

  const mutatingReq: ApprovalRequest = {
    runId: "run-1",
    stepId: "step-2",
    tool: "terminal.exec",
    reason: "npm install dependencies",
    request: {
      kind: "terminal.exec",
      cwd: ".",
      executable: "npm",
      args: ["install"],
    },
  };

  it("mode: none immediately denies all approval requests (fail-closed)", async () => {
    const onApproval = vi.fn();
    const gate = new CLIApprovalGate({ mode: "none", onApprovalRequest: onApproval });

    const outcome1 = await gate.requestApproval(safeReq);
    expect(outcome1.outcome).toBe("denied");
    if (outcome1.outcome === "denied") {
      expect(outcome1.reason).toContain("denied under --auto-approve=none");
    }

    const outcome2 = await gate.requestApproval(mutatingReq);
    expect(outcome2.outcome).toBe("denied");
    if (outcome2.outcome === "denied") {
      expect(outcome2.reason).toContain("denied under --auto-approve=none");
    }

    expect(onApproval).toHaveBeenCalledTimes(2);
  });

  it("mode: safe grants safe operations and denies mutating operations", async () => {
    const onApproval = vi.fn();
    const gate = new CLIApprovalGate({ mode: "safe", onApprovalRequest: onApproval });

    const safeOutcome = await gate.requestApproval(safeReq);
    expect(safeOutcome.outcome).toBe("granted");

    const mutatingOutcome = await gate.requestApproval(mutatingReq);
    expect(mutatingOutcome.outcome).toBe("denied");
    if (mutatingOutcome.outcome === "denied") {
      expect(mutatingOutcome.reason).toContain("not safe under --auto-approve=safe");
    }

    expect(onApproval).toHaveBeenCalledWith(safeReq, true);
    expect(onApproval).toHaveBeenCalledWith(mutatingReq, false, expect.any(String));
  });

  it("mode: all auto-grants all approval requests", async () => {
    const onApproval = vi.fn();
    const gate = new CLIApprovalGate({ mode: "all", onApprovalRequest: onApproval });

    const safeOutcome = await gate.requestApproval(safeReq);
    expect(safeOutcome.outcome).toBe("granted");

    const mutatingOutcome = await gate.requestApproval(mutatingReq);
    expect(mutatingOutcome.outcome).toBe("granted");

    expect(onApproval).toHaveBeenCalledWith(safeReq, true);
    expect(onApproval).toHaveBeenCalledWith(mutatingReq, true);
  });
});
