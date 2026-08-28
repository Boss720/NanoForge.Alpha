import { useCallback, useRef, useState } from "react";
import type {
  ConnectionState,
  ChatAttachment,
  ChatAttachmentDraft,
  ChatSendInput,
  GenerationPrefs,
  Message,
  Model,
  Patch,
  Session,
  ToolCall,
  UsageRun,
  UsageTotals,
  VirtualFile,
} from "@/types";
import { AGENT_SYSTEM_PROMPT } from "@/lib/catalog";
import { streamChat } from "@/lib/nanogpt";
import { formatQuote } from "@/lib/x402";
import { runDemoAgent } from "@/lib/demoAgent";
import { patchSessionMessage } from "@/lib/sessionReducer";
import { applyRunUsage, runCost } from "@/lib/usage";
import { appendRun } from "@/lib/usageLog";
import { applyPatch, revertPatch } from "@/lib/vfs";
import { buildContextWithAttachments } from "@/lib/context";
import { getAttachmentSnapshotStore, type AttachmentSnapshotStore } from "@/lib/attachments/snapshots";
import { attachmentMetadata } from "@/lib/attachments/validation";
import { extractPatch } from "@/lib/patchParse";
import { countAutoTurns, shouldAutoVerify, verificationPrompt } from "@/lib/agentLoop";

export interface UseAgentOrchestrationProps {
  session?: Session;
  connected: boolean;
  connection: ConnectionState;
  selectedModel: string;
  model?: Model;
  genPrefs: GenerationPrefs;
  files: VirtualFile[];
  setFiles: React.Dispatch<React.SetStateAction<VirtualFile[]>>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setUsage: React.Dispatch<React.SetStateAction<UsageTotals>>;
  setRuns: React.Dispatch<React.SetStateAction<UsageRun[]>>;
  artifactsManager: {
    addPatchArtifact: (p: Patch) => void;
  };
  /** Injectable for deterministic tests; defaults to IndexedDB in browsers. */
  attachmentSnapshots?: AttachmentSnapshotStore;
  /** Host-backed file reads/writes used by the reviewed local-write path. */
  readWorkspaceFile?: (path: string) => Promise<{ path: string; content: string; language: string; size?: number; modified?: string; sha256?: string; generation?: number } | null>;
  writeWorkspaceFile?: (path: string, content: string, options?: { expectedSha256?: string; expectedModified?: string }) => Promise<unknown>;
  /** Virtual patches are the safe default; App opts into disk writes explicitly. */
  workspaceWriteCapability?: "virtual" | "live";
}

interface ActiveRun {
  runId: string;
  sessionId: string;
  agentMsgId: string;
  cancelled: boolean;
  controller: AbortController;
}

export function useAgentOrchestration({
  session,
  connected,
  connection,
  selectedModel,
  model,
  genPrefs,
  files,
  setFiles,
  setSessions,
  setUsage,
  setRuns,
  artifactsManager,
  attachmentSnapshots,
  readWorkspaceFile,
  writeWorkspaceFile,
  workspaceWriteCapability = "virtual",
}: UseAgentOrchestrationProps) {
  const [running, setRunning] = useState(false);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const snapshots = attachmentSnapshots ?? getAttachmentSnapshotStore();

  const patchMessage = useCallback(
    (sessionId: string, msgId: string, fn: (m: Message) => Message) => {
      setSessions((prev) => patchSessionMessage(prev, sessionId, msgId, fn));
    },
    [setSessions],
  );

  const finishRun = useCallback(
    (
      sessionId: string,
      msgId: string,
      out: { input: number; output: number },
      opts?: { errored?: boolean },
    ) => {
      const m = model;
      const cost = runCost(m, out.input, out.output);
      patchMessage(sessionId, msgId, (msg) => ({
        ...msg,
        streaming: false,
        usage: { input: out.input, output: out.output, costUsd: cost },
        model: m?.name ?? selectedModel,
      }));
      setUsage((u) => applyRunUsage(u, { input: out.input, output: out.output, costUsd: cost }, opts));
      setRuns((prev) =>
        appendRun(prev, {
          id: crypto.randomUUID(),
          ts: Date.now(),
          modelId: selectedModel,
          input: out.input,
          output: out.output,
          costUsd: cost,
          ...(opts?.errored ? { errored: true } : {}),
        }),
      );
      setRunning(false);
    },
    [model, selectedModel, patchMessage, setUsage, setRuns],
  );

  const handleSend = useCallback(
    (input: string | ChatSendInput, opts?: { auto?: boolean }) => {
      if (running || !session) return;
      const { text, attachments = [] } = typeof input === "string" ? { text: input, attachments: [] } : input;
      const sid = session.id;
      const auto = opts?.auto === true;
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        ts: Date.now(),
        ...(attachments.length > 0 ? { attachments: attachments.map((attachment) => attachmentMetadata(attachment)) } : {}),
        ...(auto ? { auto } : {}),
      };
      const agentMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        streaming: true,
        ts: Date.now(),
        ...(auto ? { auto } : {}),
      };

      const runId = crypto.randomUUID();
      const activeRun: ActiveRun = {
        runId,
        sessionId: sid,
        agentMsgId: agentMsg.id,
        cancelled: false,
        controller: new AbortController(),
      };
      activeRunRef.current = activeRun;

      setSessions((prev) =>
        prev.map((s) =>
          s.id !== sid
            ? s
            : {
                ...s,
                title: s.messages.length === 0 ? text.slice(0, 34) : s.title,
                model: selectedModel,
                messages: [...s.messages, userMsg, agentMsg],
              },
        ),
      );
      setRunning(true);

      void persistAttachmentSnapshots(attachments, snapshots).then(async (persisted) => {
        if (activeRun.cancelled || activeRunRef.current !== activeRun) {
          return;
        }

        if (attachments.length > 0) {
          patchMessage(sid, userMsg.id, (message) => ({ ...message, attachments: persisted }));
        }

        if (!connected) {
          runDemoAgent(
            text,
            {
              onToolCall: (t: ToolCall) => {
                if (activeRun.cancelled) return;
                patchMessage(sid, agentMsg.id, (m) => ({ ...m, toolCalls: [...(m.toolCalls ?? []), t] }));
              },
              onToolUpdate: (id, status, durationMs) => {
                if (activeRun.cancelled) return;
                patchMessage(sid, agentMsg.id, (m) => ({
                  ...m,
                  toolCalls: m.toolCalls?.map((t) => (t.id === id ? { ...t, status, durationMs } : t)),
                }));
              },
              onPatch: (p: Patch) => {
                if (activeRun.cancelled) return;
                patchMessage(sid, agentMsg.id, (m) => ({ ...m, patch: p }));
                artifactsManager.addPatchArtifact(p);
              },
              onDelta: (d) => {
                if (activeRun.cancelled) return;
                patchMessage(sid, agentMsg.id, (m) => ({ ...m, content: m.content + d }));
              },
              onDone: (u) => {
                if (activeRun.cancelled) return;
                if (activeRunRef.current === activeRun) activeRunRef.current = null;
                finishRun(sid, agentMsg.id, u);
              },
            },
            () => activeRun.cancelled,
          );
          return;
        }

        const history = session.messages.filter((m) => m.role !== "system" && m.content);
        const budgetTokens = (model?.contextK ?? 128) * 1000;
        const contextResult = await buildContextWithAttachments(
          [...history, { ...userMsg, attachments: persisted }],
          AGENT_SYSTEM_PROMPT,
          budgetTokens,
          snapshots,
        );

        if (activeRun.cancelled || activeRunRef.current !== activeRun) {
          return;
        }

        if (contextResult.updates.length > 0) {
          patchMessage(sid, userMsg.id, (message) => ({
            ...message,
            attachments: mergeAttachmentUpdates(message.attachments ?? [], contextResult.updates),
          }));
        }
        const wire = contextResult.context;
        let streamed = "";
        let x402Content: string | null = null;

        streamChat(
          connection.baseUrl,
          connection.apiKey,
          selectedModel,
          wire,
          {
            onDelta: (d) => {
              if (activeRun.cancelled) return;
              streamed += d;
              patchMessage(sid, agentMsg.id, (m) => ({ ...m, content: m.content + d }));
            },
            onDone: (u) => {
              if (activeRun.cancelled) return;
              if (activeRunRef.current === activeRun) activeRunRef.current = null;
              const patch = extractPatch(streamed);
              if (patch) {
                patchMessage(sid, agentMsg.id, (m) => ({ ...m, patch }));
                artifactsManager.addPatchArtifact(patch);
              }
              finishRun(sid, agentMsg.id, u);
            },
            onX402: (err) => {
              if (activeRun.cancelled) return;
              x402Content =
                `**Accountless payment required (HTTP 402).** This request needs a per-request payment` +
                (err.quote ? ` of **${formatQuote(err.quote)}**` : "") +
                `. Pay per request without an account, or add a subscription key in Settings to skip per-request payments.`;
            },
            onError: (err) => {
              if (activeRun.cancelled) return;
              if (activeRunRef.current === activeRun) activeRunRef.current = null;
              patchMessage(sid, agentMsg.id, (m) => ({
                ...m,
                content: m.content + (x402Content ? `\n\n${x402Content}` : `\n\n**Error:** ${err}`),
              }));
              finishRun(sid, agentMsg.id, { input: 0, output: 0 }, { errored: true });
            },
          },
          activeRun.controller.signal,
          { temperature: genPrefs.temperature, maxTokens: genPrefs.maxTokens },
        );
      }).catch((error) => {
        if (activeRun.cancelled) return;
        if (activeRunRef.current === activeRun) activeRunRef.current = null;
        patchMessage(sid, agentMsg.id, (message) => ({
          ...message,
          content: `${message.content}\n\n**Error:** ${error instanceof Error ? error.message : String(error)}`,
        }));
        finishRun(sid, agentMsg.id, { input: 0, output: 0 }, { errored: true });
      });
    },
    [
      running,
      session,
      connected,
      selectedModel,
      model,
      connection,
      patchMessage,
      finishRun,
      genPrefs,
      artifactsManager,
      setSessions,
      snapshots,
    ],
  );

  const handleStop = useCallback(() => {
    const currentRun = activeRunRef.current;
    if (currentRun) {
      currentRun.cancelled = true;
      currentRun.controller.abort();
      activeRunRef.current = null;
      setRunning(false);
      setSessions((prev) =>
        prev.map((s) =>
          s.id !== currentRun.sessionId
            ? s
            : {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === currentRun.agentMsgId || (m.streaming && m.role === "assistant")
                    ? { ...m, streaming: false, content: m.content + "\n\n*stopped by user*" }
                    : m,
                ),
              },
        ),
      );
    } else {
      setRunning(false);
    }
  }, [setSessions]);

  const handlePatchDecision = useCallback(
    (messageId: string, decision: "applied" | "rejected") => {
      if (!session) return;
      const patch = session.messages.find((m) => m.id === messageId)?.patch;
      if (!patch || patch.status === decision) return;
      void (async () => {
        let workingFiles = files;
        let currentRead: { path: string; content: string; language: string; size?: number; modified?: string; sha256?: string; generation?: number } | null = null;
        const liveWorkspaceWrite = workspaceWriteCapability === "live";
        if (liveWorkspaceWrite && writeWorkspaceFile && readWorkspaceFile) {
          currentRead = await readWorkspaceFile(patch.file);
          if (currentRead) {
            const existing = workingFiles.findIndex((file) => file.path === patch.file);
            const hydrated: VirtualFile = {
              path: currentRead.path,
              content: currentRead.content,
              language: currentRead.language,
              size: currentRead.size,
              modified: currentRead.modified,
              sha256: currentRead.sha256,
            };
            workingFiles = existing === -1
              ? [...workingFiles, hydrated]
              : workingFiles.map((file, index) => (index === existing ? hydrated : file));
          } else if (!workingFiles.some((file) => file.path === patch.file)) {
            workingFiles = [...workingFiles, { path: patch.file, content: "", language: "text" }];
          }
        }

        const nextFiles = decision === "applied"
          ? applyPatch(workingFiles, patch)
          : patch.status === "applied" ? revertPatch(workingFiles, patch) : workingFiles;
        const nextContent = nextFiles.find((file) => file.path === patch.file)?.content;
        if (liveWorkspaceWrite && writeWorkspaceFile && nextContent !== undefined) {
          await writeWorkspaceFile(patch.file, nextContent, {
            expectedSha256: currentRead?.sha256,
            expectedModified: currentRead?.modified,
          });
        }

        if (decision === "applied" || patch.status === "applied") setFiles(nextFiles);
        setSessions((prev) =>
          patchSessionMessage(prev, session.id, messageId, (m) =>
            m.patch ? { ...m, patch: { ...m.patch, status: decision } } : m,
          ),
        );

        const mode = connected ? "live" : "demo";
        const autoTurnsUsed = countAutoTurns(session.messages);
        if (decision === "applied" && shouldAutoVerify("applied", mode, autoTurnsUsed)) {
          handleSend(verificationPrompt(patch.file, nextContent ?? ""), { auto: true });
        }
      })().catch((error) => {
        const errText = error instanceof Error ? error.message : String(error);
        const isConflict =
          errText.toLowerCase().includes("write_conflict") ||
          errText.toLowerCase().includes("changed since review");
        const notice = isConflict
          ? "File changed since review; refresh and review again."
          : `Write not applied: ${errText}`;

        patchMessage(session.id, messageId, (message) => ({
          ...message,
          content: `${message.content}\n\n**${notice}**`,
        }));
      });

    },
    [
      session,
      files,
      connected,
      handleSend,
      setFiles,
      setSessions,
      patchMessage,
      readWorkspaceFile,
      writeWorkspaceFile,
      workspaceWriteCapability,
    ],
  );

  return {
    running,
    handleSend,
    handleStop,
    handlePatchDecision,
    patchMessage,
    finishRun,
  };
}

async function persistAttachmentSnapshots(
  attachments: ChatAttachmentDraft[],
  snapshots: AttachmentSnapshotStore,
): Promise<ChatAttachment[]> {
  return Promise.all(
    attachments.map(async (attachment) => {
      if (attachment.status !== "ready" || attachment.content === undefined) return attachmentMetadata(attachment);
      try {
        await snapshots.save(attachment.snapshotId, attachment.content);
        return attachmentMetadata(attachment);
      } catch (error) {
        return {
          ...attachmentMetadata(attachment),
          status: "error" as const,
          error: error instanceof Error ? error.message : "Could not save attachment snapshot.",
        };
      }
    }),
  );
}

function mergeAttachmentUpdates(
  attachments: ChatAttachment[],
  updates: Array<{ id: string; includedBytes: number; truncated?: boolean; status: ChatAttachment["status"]; error?: string }>,
): ChatAttachment[] {
  const byId = new Map(updates.map((update) => [update.id, update]));
  return attachments.map((attachment) => {
    const update = byId.get(attachment.id);
    return update ? { ...attachment, ...update } : attachment;
  });
}
