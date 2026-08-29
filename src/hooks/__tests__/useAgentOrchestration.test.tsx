// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useAgentOrchestration, type UseAgentOrchestrationProps } from "@/hooks/useAgentOrchestration";
import type { ConnectionState, Patch, Session, UsageRun, UsageTotals, VirtualFile } from "@/types";

afterEach(() => vi.restoreAllMocks());

const connection: ConnectionState = {
  apiKey: "",
  baseUrl: "https://nano-gpt.com/api/v1",
  status: "disconnected",
  liveModels: false,
};

const patch: Patch = {
  file: "src/demo.ts",
  lines: [
    { type: "ctx", text: "const ready = false;" },
    { type: "add", text: "const live = true;" },
  ],
  status: "pending",
};

const session: Session = {
  id: "session-1",
  title: "Demo",
  model: "model-1",
  createdAt: 1,
  messages: [
    { id: "assistant-1", role: "assistant", content: "Here is a patch.", ts: 1, patch },
  ],
};

function useHarness(
  capability: UseAgentOrchestrationProps["workspaceWriteCapability"],
  readWorkspaceFile: NonNullable<UseAgentOrchestrationProps["readWorkspaceFile"]>,
  writeWorkspaceFile: NonNullable<UseAgentOrchestrationProps["writeWorkspaceFile"]>,
) {
  const [files, setFiles] = useState<VirtualFile[]>([
    { path: patch.file, language: "typescript", content: "const ready = false;" },
  ]);
  const [sessions, setSessions] = useState<Session[]>([session]);
  const [, setUsage] = useState<UsageTotals>({ input: 0, output: 0, costUsd: 0, requests: 0 });
  const [, setRuns] = useState<UsageRun[]>([]);

  return {
    files,
    sessions,
    ...useAgentOrchestration({
      session,
      connected: false,
      connection,
      selectedModel: "model-1",
      genPrefs: { temperature: 0.3, maxTokens: 100 },
      files,
      setFiles,
      setSessions,
      setUsage,
      setRuns,
      artifactsManager: { addPatchArtifact: vi.fn() },
      readWorkspaceFile,
      writeWorkspaceFile,
      workspaceWriteCapability: capability,
    }),
  };
}

describe("useAgentOrchestration workspace write gate", () => {
  it("keeps accepted patches virtual when live capability is not supplied", async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      path: patch.file,
      content: "const ready = false;",
      language: "typescript",
      size: 20,
    }));
    const writeWorkspaceFile = vi.fn(async () => undefined);
    const { result } = renderHook(() => useHarness("virtual", readWorkspaceFile, writeWorkspaceFile));

    result.current.handlePatchDecision("assistant-1", "applied");

    await waitFor(() => expect(result.current.files[0].content).toContain("const live = true;"));
    expect(readWorkspaceFile).not.toHaveBeenCalled();
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
  });

  it("writes only when App explicitly supplies the live capability", async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      path: patch.file,
      content: "const ready = false;",
      language: "typescript",
      size: 20,
      sha256: "abc123sha",
      modified: "2026-08-26T20:00:00Z",
    }));
    const writeWorkspaceFile = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() => useHarness("live", readWorkspaceFile, writeWorkspaceFile));

    result.current.handlePatchDecision("assistant-1", "applied");

    await waitFor(() =>
      expect(writeWorkspaceFile).toHaveBeenCalledWith(
        patch.file,
        "const ready = false;\nconst live = true;",
        {
          expectedSha256: "abc123sha",
          expectedModified: "2026-08-26T20:00:00Z",
        },
      ),
    );
    expect(readWorkspaceFile).toHaveBeenCalledWith(patch.file);
  });

  it("leaves patch pending and reports conflict notice if file changed since review", async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      path: patch.file,
      content: "const ready = false;",
      language: "typescript",
      size: 20,
      sha256: "old-hash",
    }));
    const writeWorkspaceFile = vi.fn(async () => {
      throw new Error("write_conflict: file changed since review");
    });
    const { result } = renderHook(() => useHarness("live", readWorkspaceFile, writeWorkspaceFile));

    result.current.handlePatchDecision("assistant-1", "applied");

    await waitFor(() => {
      const msg = result.current.sessions[0].messages.find((m) => m.id === "assistant-1");
      expect(msg?.content).toContain("File changed since review; refresh and review again.");
      expect(msg?.patch?.status).toBe("pending");
    });
  });

  it("leaves patch pending on generic write error", async () => {
    const readWorkspaceFile = vi.fn(async () => ({
      path: patch.file,
      content: "const ready = false;",
      language: "typescript",
      size: 20,
      sha256: "hash-1",
    }));
    const writeWorkspaceFile = vi.fn(async () => {
      throw new Error("EACCES: permission denied");
    });
    const { result } = renderHook(() => useHarness("live", readWorkspaceFile, writeWorkspaceFile));

    result.current.handlePatchDecision("assistant-1", "applied");

    await waitFor(() => {
      const msg = result.current.sessions[0].messages.find((m) => m.id === "assistant-1");
      expect(msg?.content).toContain("Write not applied: EACCES: permission denied");
      expect(msg?.patch?.status).toBe("pending");
    });
  });

  it("handles new-file creation through explicit reviewed path", async () => {
    const newFilePatch: Patch = {
      file: "src/newFile.ts",
      lines: [{ type: "add", text: "export const created = true;" }],
      status: "pending",
    };
    const newSession: Session = {
      id: "session-2",
      title: "New File Demo",
      model: "model-1",
      createdAt: 1,
      messages: [{ id: "assistant-2", role: "assistant", content: "Create file", ts: 1, patch: newFilePatch }],
    };

    const readWorkspaceFile = vi.fn(async () => null);
    const writeWorkspaceFile = vi.fn(async () => ({ ok: true }));

    const { result } = renderHook(() => {
      const [files, setFiles] = useState<VirtualFile[]>([]);
      const [sessions, setSessions] = useState<Session[]>([newSession]);
      const [, setUsage] = useState<UsageTotals>({ input: 0, output: 0, costUsd: 0, requests: 0 });
      const [, setRuns] = useState<UsageRun[]>([]);

      return {
        files,
        sessions,
        ...useAgentOrchestration({
          session: newSession,
          connected: false,
          connection,
          selectedModel: "model-1",
          genPrefs: { temperature: 0.3, maxTokens: 100 },
          files,
          setFiles,
          setSessions,
          setUsage,
          setRuns,
          artifactsManager: { addPatchArtifact: vi.fn() },
          readWorkspaceFile,
          writeWorkspaceFile,
          workspaceWriteCapability: "live",
        }),
      };
    });

    result.current.handlePatchDecision("assistant-2", "applied");

    await waitFor(() =>
      expect(writeWorkspaceFile).toHaveBeenCalledWith("src/newFile.ts", "export const created = true;", {
        expectedSha256: undefined,
        expectedModified: undefined,
      }),
    );
  });
});

describe("useAgentOrchestration run-scoped cancellation", () => {
  it("stops cleanly while attachment persistence is unresolved", async () => {
    let resolveSnapshot: ((val: unknown) => void) | undefined;
    const attachmentSnapshots = {
      get: vi.fn(),
      put: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveSnapshot = resolve;
          }),
      ),
      has: vi.fn(async () => false),
      clear: vi.fn(),
    };

    const sessionA: Session = {
      id: "session-a",
      title: "Chat A",
      model: "model-1",
      createdAt: 1,
      messages: [],
    };

    const { result } = renderHook(() => {
      const [files, setFiles] = useState<VirtualFile[]>([]);
      const [sessions, setSessions] = useState<Session[]>([sessionA]);
      const [, setUsage] = useState<UsageTotals>({ input: 0, output: 0, costUsd: 0, requests: 0 });
      const [, setRuns] = useState<UsageRun[]>([]);

      return {
        sessions,
        ...useAgentOrchestration({
          session: sessionA,
          connected: false,
          connection,
          selectedModel: "model-1",
          genPrefs: { temperature: 0.3, maxTokens: 100 },
          files,
          setFiles,
          setSessions,
          setUsage,
          setRuns,
          artifactsManager: { addPatchArtifact: vi.fn() },
          attachmentSnapshots: attachmentSnapshots as any,
        }),
      };
    });

    result.current.handleSend({
      text: "Hello with file",
      attachments: [{ path: "test.txt", content: "data", kind: "inline" } as any],
    });

    await waitFor(() => expect(result.current.running).toBe(true));

    // Stop before snapshot persistence resolves
    result.current.handleStop();
    await waitFor(() => expect(result.current.running).toBe(false));

    // Now resolve snapshot persistence
    resolveSnapshot?.({ id: "snap-1", path: "test.txt", size: 4, sha256: "h", kind: "text", truncated: false });

    // Ensure session messages were stopped and not revived
    await waitFor(() => {
      const agentMsg = result.current.sessions[0].messages.find((m) => m.role === "assistant");
      expect(agentMsg?.streaming).toBe(false);
      expect(agentMsg?.content).toContain("*stopped by user*");
    });
  });

  it("stops in one chat without marking another chat's stream stopped", async () => {
    const session1: Session = {
      id: "session-1",
      title: "Chat 1",
      model: "model-1",
      createdAt: 1,
      messages: [],
    };
    const session2: Session = {
      id: "session-2",
      title: "Chat 2",
      model: "model-1",
      createdAt: 2,
      messages: [{ id: "agent-2", role: "assistant", content: "Stream 2...", streaming: true, ts: 2 }],
    };

    const { result } = renderHook(() => {
      const [files, setFiles] = useState<VirtualFile[]>([]);
      const [sessions, setSessions] = useState<Session[]>([session1, session2]);
      const [, setUsage] = useState<UsageTotals>({ input: 0, output: 0, costUsd: 0, requests: 0 });
      const [, setRuns] = useState<UsageRun[]>([]);

      return {
        sessions,
        ...useAgentOrchestration({
          session: session1,
          connected: false,
          connection,
          selectedModel: "model-1",
          genPrefs: { temperature: 0.3, maxTokens: 100 },
          files,
          setFiles,
          setSessions,
          setUsage,
          setRuns,
          artifactsManager: { addPatchArtifact: vi.fn() },
        }),
      };
    });

    // Start a send on session1
    result.current.handleSend("Run chat 1");
    await waitFor(() => expect(result.current.sessions[0].messages.length).toBe(2));

    // Stop session1
    result.current.handleStop();

    // Verify session 2's streaming state is preserved untouched
    await waitFor(() => {
      const s2 = result.current.sessions.find((s) => s.id === "session-2");
      expect(s2?.messages[0].streaming).toBe(true);
      expect(s2?.messages[0].content).toBe("Stream 2...");

      // Verify session 1's active message is marked stopped
      const s1 = result.current.sessions.find((s) => s.id === "session-1");
      const stoppedMsg = s1?.messages.find((m) => m.content.includes("*stopped by user*"));
      expect(stoppedMsg?.streaming).toBe(false);
    });
  });
});
