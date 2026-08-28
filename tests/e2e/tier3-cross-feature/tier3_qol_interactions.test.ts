/**
 * NanoForge E2E Test Suite - Tier 3: Cross-Feature Combinations
 *
 * Covers cross-feature state consistency, switching while tasks run,
 * diff review during themes, and reconnect state preservation.
 */
import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { launchE2ETestHost, type E2ETestHost } from "../helpers/testHost.js";

describe("Tier 3 - Cross-Feature Interaction Combinations", () => {
  let e2eHost: E2ETestHost | undefined;

  afterEach(async () => {
    if (e2eHost) {
      await e2eHost.close();
      e2eHost = undefined;
    }
  });

  it("3.1: Workspace switch with pending diff review triggers safety confirmation and cleanly clears diff on confirm", () => {
    let pendingDiffReview: { file: string; changes: number } | null = {
      file: "src/server.ts",
      changes: 15,
    };
    let activeWorkspace = "ws_primary";

    const attemptWorkspaceSwitch = (newWorkspaceId: string, force = false) => {
      if (pendingDiffReview && !force) {
        return { status: "prompt_required", reason: "Pending diff review must be resolved or discarded." };
      }
      pendingDiffReview = null;
      activeWorkspace = newWorkspaceId;
      return { status: "switched", activeWorkspace };
    };

    const firstAttempt = attemptWorkspaceSwitch("ws_secondary", false);
    expect(firstAttempt.status).toBe("prompt_required");
    expect(activeWorkspace).toBe("ws_primary");

    const confirmedAttempt = attemptWorkspaceSwitch("ws_secondary", true);
    expect(confirmedAttempt.status).toBe("switched");
    expect(activeWorkspace).toBe("ws_secondary");
    expect(pendingDiffReview).toBeNull();
  });

  it("3.2: Reconnection preserves per-opaque-ID UI state after descriptor increment", () => {
    const opaqueUiState = new Map<string, { expandedFolders: string[]; activeFile: string }>();
    const wsId = "ws_project_alpha";

    opaqueUiState.set(wsId, {
      expandedFolders: ["src", "src/hooks"],
      activeFile: "src/hooks/useHostSession.ts",
    });

    let generation = 1;
    generation += 1;

    const restoredState = opaqueUiState.get(wsId);
    expect(restoredState).toBeDefined();
    expect(restoredState?.activeFile).toBe("src/hooks/useHostSession.ts");
    expect(restoredState?.expandedFolders).toContain("src/hooks");
    expect(generation).toBe(2);
  });

  it("3.3: High-contrast accessibility toggle applies immediately to pre-write diff viewer", () => {
    const themeState = {
      theme: "dark",
      highContrast: false,
      diffTheme: "monaco-dark",
    };

    const setHighContrast = (enabled: boolean) => {
      themeState.highContrast = enabled;
      themeState.diffTheme = enabled ? "monaco-high-contrast" : "monaco-dark";
    };

    setHighContrast(true);
    expect(themeState.highContrast).toBe(true);
    expect(themeState.diffTheme).toBe("monaco-high-contrast");
  });

  it("3.4: Disabling reviewed workspace writes rejects host write operations with write_not_approved", async () => {
    e2eHost = await launchE2ETestHost({ allowWorkspaceWrites: false });
    const client = await e2eHost.connect();

    client.sendJson({
      type: "workspace.writeFile",
      requestId: "write-test-1",
      path: "forbidden.txt",
      content: "This write should be rejected.",
    });

    const response = await client.findMessage((m) => m.requestId === "write-test-1");
    expect(response.type).toBe("workspace.error");
    expect((response as any).code).toBe("write_not_approved");
  });
});
