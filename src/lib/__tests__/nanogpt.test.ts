import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModels, generateImage, NanoGptError, streamChat, toPerMillion, validateKey } from "../nanogpt";
import { X402Error } from "../x402";

describe("toPerMillion", () => {
  it("treats exactly 0.01 as already per-million (boundary)", () => {
    expect(toPerMillion(0.01)).toBe(0.01);
  });

  it("scales per-token values below 0.01 up to per-million", () => {
    expect(toPerMillion(0.0000…56221 tokens truncated…n    };
    // settings primitives only — a new settings object with the same values
    // must NOT reconnect.
  }, [connKey, settings.port, settings.token, handleHostMessage, closeActiveClient]);

  const reconnectToWorkspace = useCallback(async (connection: WorkspaceBrokerConnection): Promise<HostWorkspaceDescriptor | null> => {
    const current = clientRef.current;
    setRuntimeState("switching");

    let candidate: HostClientLike | null = null;
    try {
      candidate = (createClient ?? ((o: { port?: number; token?: string; websocketUrl?: string }) => new HostClient(o)))({
        ...(connection.websocketUrl ? { websocketUrl: connection.websocketUrl } : {}),
        ...(connection.port !== undefined ? { port: connection.port } : {}),
        ...(connection.token ? { token: connection.token } : {}),
      });
      await candidate.connect();
      if (!candidate.describeWorkspace) throw new Error("Replacement local host cannot describe its workspace");
      const descriptor = await candidate.describeWorkspace();
      if (descriptor.generation !== connection.generation) {
        throw new Error(`Replacement host generation ${descriptor.generation} does not match broker generation ${connection.generation}`);
      }

      // The candidate has proved it represents the broker-selected workspace.
      // Only now retire the old host, so a failed candidate leaves it usable.
      clientUnsubscribeRef.current?.();
      clientUnsubscribeRef.current = null;
      clientRef.current = candidate;
      clientUnsubscribeRef.current = candidate.onEvent((message) => {
        if (clientRef.current === candidate) handleHostMessage(message);
      });
      current?.close();

      // Workspace-scoped transient UI cannot cross a host generation.
      toolRunOwners.current.clear();
      pendingGrants.current.clear();
      setToolRuns([]);
      setRoute(null);
      setEvidence(null);
      setLastError(null);
      setConnectOutcome({ key: `${connection.port ?? "url"}:${connection.token ?? ""}`, error: null });
      setRuntimeState("ready");
      return descriptor;
    } catch (error) {
      candidate?.close();
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      if (current) {
        setRuntimeState("healthy");
      } else {
        setRuntimeState(isNonRetryableError(error) ? "needs_attention" : "unavailable");
      }
      return null;
    }
  }, [createClient, handleHostMessage]);

  /* ------------------------- actions ---------------------------------- */

  const setPlan = useCallback((next: ExecutionPlan | null) => {
    setPlanState(next);
    if (!next) {
      // Run evidence belongs to a plan/run; clearing the plan clears it too.
      setEvidence(null);
      setRoute(null);
    }
  }, []);

  const approveStep = useCallback(
    (planId: string, stepId: string) => {
      const current = latest.current.plan;
      const step = current && current.id === planId ? current.steps.find((s) => s.id === stepId) : undefined;
      const origin = step ? browserScopeOrigin(step) : null;
      if (origin) {
        // Task 10: the approval of a browser step routes through the origin
        // permission prompt FIRST; the host grant follows the user's decision
        // (see decidePermission). Chat text never reaches this path — only
        // PlanPanel's explicit Approve button calls it.
        requestOriginGrant(planId, stepId, origin, origin);
        return;
      }
      sendGrant(planId, stepId, true);
    },
    [requestOriginGrant, sendGrant],
  );

  const runApproved = useCallback((planId: string) => {
    const current = latest.current.plan;
    const client = clientRef.current;
    if (!current || current.id !== planId || !client) return;
    // Convention: (re)submitting the approved plan starts/resumes its run.
    void client.submitPlan(current).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
    });
  }, []);

  const pause = useCallback((planId: string) => {
    void clientRef.current?.pauseRun(planId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
    });
  }, []);

  const cancel = useCallback((planId: string) => {
    void clientRef.current?.cancelRun(planId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
    });
  }, []);

  const stopToolRun = useCallback((toolRunId: string) => {
    const client = clientRef.current;
    if (!client) return;
    // The protocol cancels whole runs; map the card back to its owning run.
    const runId = toolRunOwners.current.get(toolRunId) ?? toolRunId;
    void client.cancelRun(runId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
    });
  }, []);

  const decidePermission = useCallback(
    (decision: BrowserPermissionDecision) => {
      perms.decide(decision); // the reducer keeps the grants ledger
      const key =
        decision.kind === "origin"
          ? originGrantKey(decision.origin)
          : sensitiveGrantKey(decision.action, decision.origin);
      const pend = pendingGrants.current.get(key);
      pendingGrants.current.delete(key);
      if (!pend) return; // prompt had no host grant attached (defensive)
      const approved = decision.kind === "origin" ? decision.decision !== "deny" : decision.approved;
      sendGrant(pend.runId, pend.stepId, approved);
    },
    [perms, sendGrant],
  );

  const decideCapabilityApproval = useCallback((requestId: string, approved: boolean) => {
    const pending = capabilityApprovalPending;
    if (!pending || pending.requestId !== requestId) return;
    const client = clientRef.current;
    if (!client?.respondToCapabilityApproval) {
      setLastError("This local host cannot accept capability approvals. Reconnect and try again.");
      return;
    }
    setCapabilityApprovalPending(null);
    void client.respondToCapabilityApproval(requestId, approved).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
      setCapabilityApprovalPending(pending);
    });
  }, [capabilityApprovalPending]);

  const toggleIntegration = useCallback((kind: "rules" | "skill" | "mcp", id: string, enabled: boolean) => {
    setIntegrations((prev) => ({
      rulesPacks:
        kind === "rules" ? prev.rulesPacks.map((row) => (row.id === id ? { ...row, enabled } : row)) : prev.rulesPacks,
      skills:
        kind === "skill" ? prev.skills.map((row) => (row.id === id ? { ...row, enabled } : row)) : prev.skills,
      mcpServers:
        kind === "mcp" ? prev.mcpServers.map((row) => (row.id === id ? { ...row, enabled } : row)) : prev.mcpServers,
    }));
    const p = clientRef.current?.toggleIntegration?.(kind, id, enabled);
    void p?.catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
    });
  }, []);

  /* ------------------------- Subagent & Task RPC Dispatchers ------------------------- */

  const spawnSubagent = useCallback(
    async (params: InvokeSubagentParams, parentId?: string): Promise<InvokeSubagentResult | null> => {
      const client = clientRef.current;
      if (!client || !client.invokeSubagent) return null;
      try {
        const res = await client.invokeSubagent(params, parentId);
        setSubagents((prev) =>
          upsertSubagent(prev, {
            id: res.subagentId,
            parentId: parentId ?? null,
            name: res.name,
            archetype: res.archetype,
            roles: params.roles ?? [],
            state: res.state,
            workingDirectory: res.workingDirectory,
            isolationMode: params.workspaceIsolation ?? "inherit",
            startedAt: res.startedAt,
            lastHeartbeat: res.startedAt,
            tokensUsed: 0,
            turnCount: 0,
          }),
        );
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const manageSubagentsAction = useCallback(
    async (params: ManageSubagentsParams): Promise<ManageSubagentsResult | null> => {
      const client = clientRef.current;
      if (!client || !client.manageSubagents) return null;
      try {
        const res = await client.manageSubagents(params);
        if (params.action === "list" && res.subagents) {
          setSubagents(res.subagents);
        } else if (params.action === "status" && res.detail) {
          setSubagents((prev) => upsertSubagent(prev, res.detail!));
        } else if (params.action === "kill" && params.subagentId) {
          if (params.recursive) {
            setSubagents((prev) =>
              prev.map((s) =>
                s.id === params.subagentId || s.parentId === params.subagentId
                  ? { ...s, state: "errored", error: "Terminated by user" }
                  : s,
              ),
            );
          } else {
            setSubagents((prev) =>
              prev.map((s) =>
                s.id === params.subagentId
                  ? { ...s, state: "errored", error: "Terminated by user" }
                  : s,
              ),
            );
          }
        }
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const killSubagent = useCallback(
    async (subagentId: string): Promise<ManageSubagentsResult | null> => {
      return manageSubagentsAction({ action: "kill", subagentId, recursive: false });
    },
    [manageSubagentsAction],
  );

  const killSubagentTree = useCallback(
    async (subagentId: string): Promise<ManageSubagentsResult | null> => {
      return manageSubagentsAction({ action: "kill", subagentId, recursive: true });
    },
    [manageSubagentsAction],
  );

  const sendAgentMessage = useCallback(
    async (
      recipientId: string,
      body: string,
      options?: { subject?: string; referencedArtifacts?: string[]; priority?: "high" | "normal" | "low" },
    ): Promise<SendMessageResult | null> => {
      const client = clientRef.current;
      if (!client || !client.sendMessage) return null;
      try {
        const res = await client.sendMessage({
          recipientId,
          subject: options?.subject ?? "Direct Message",
          body,
          referencedArtifacts: options?.referencedArtifacts ?? [],
          priority: options?.priority ?? "normal",
        });
        const msgFrame: SubagentMessage = {
          messageId: res.messageId,
          senderId: "00000000-0000-0000-0000-000000000000",
          senderName: "Operator / UI",
          recipientId,
          timestamp: res.deliveryTimestamp,
          subject: options?.subject ?? "Direct Message",
          body,
          referencedArtifacts: options?.referencedArtifacts ?? [],
          priority: options?.priority ?? "normal",
        };
        setInterAgentMessages((prev) => [...prev, msgFrame]);
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const defineSubagent = useCallback(
    async (params: DefineSubagentParams): Promise<DefineSubagentResult | null> => {
      const client = clientRef.current;
      if (!client || !client.defineSubagent) return null;
      try {
        return await client.defineSubagent(params);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const executeCommand = useCallback(
    async (input: ExecuteCommandInput): Promise<CommandResultFrame> => {
      const client = clientRef.current;
      const execute = client?.executeCommand ?? client?.dispatchCommand;
      if (!execute) {
        return {
          type: "command.result",
          command: input.command,
          success: false,
          error: "Host does not support command execution",
          data: { code: "unsupported_capability" },
        };
      }
      try {
        return await execute.call(client, input);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const dispatchCommand = useCallback(
    (input: ExecuteCommandInput): Promise<CommandResultFrame> => executeCommand(input),
    [executeCommand],
  );

  const withWorkspaceClient = useCallback(async <T,>(operation: (client: HostClientLike) => Promise<T>): Promise<T | null> => {
    const client = clientRef.current;
    if (!client) {
      setLastError("Cannot perform workspace operation while the local host is unavailable");
      return null;
    }
    try {
      return await operation(client);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
      if (isNonRetryableError(err)) {
        setRuntimeState("needs_attention");
      }
      return null;
    }
  }, []);

  const readWorkspaceDirectory = useCallback((path = "") => withWorkspaceClient((client) =>
    client.readDir ? client.readDir(path) : Promise.reject(new Error("Host does not support workspace directory reads")),
  ), [withWorkspaceClient]);
  const readWorkspaceFile = useCallback((path: string) => withWorkspaceClient((client) =>
    client.readFile ? client.readFile(path) : Promise.reject(new Error("Host does not support workspace file reads")),
  ), [withWorkspaceClient]);
  const writeWorkspaceFile = useCallback(
    async (path: string, content: string, options?: { expectedSha256?: string; expectedModified?: string }): Promise<WorkspaceWriteResult | null> => {
      const client = clientRef.current;
      if (!client) return null;
      if (!client.writeFile) throw new Error("Host does not support reviewed workspace writes");
      try {
        return await client.writeFile(path, content, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );
  const statWorkspaceFile = useCallback((path: string) => withWorkspaceClient((client) =>
    client.stat ? client.stat(path) : Promise.reject(new Error("Host does not support workspace file stats")),
  ), [withWorkspaceClient]);
  const searchWorkspace = useCallback((query: string, options?: { maxResults?: number }) => withWorkspaceClient((client) =>
    client.search ? client.search(query, options) : Promise.reject(new Error("Host does not support workspace search")),
  ), [withWorkspaceClient]);
  const workspaceGitStatus = useCallback(() => withWorkspaceClient((client) =>
    client.gitStatus ? client.gitStatus() : Promise.reject(new Error("Host does not support Git status")),
  ), [withWorkspaceClient]);
  const watchWorkspace = useCallback(async () => (await withWorkspaceClient((client) =>
    client.watch ? client.watch() : Promise.reject(new Error("Host does not support workspace watching")),
  )) !== null, [withWorkspaceClient]);
  const unwatchWorkspace = useCallback(async () => (await withWorkspaceClient((client) =>
    client.unwatch ? client.unwatch() : Promise.reject(new Error("Host does not support workspace watching")),
  )) !== null, [withWorkspaceClient]);
  const selectWorkspace = useCallback((selectionToken: string) => withWorkspaceClient(async (client) => {
    if (!client.selectWorkspace && !client.openWorkspace) {
      throw new Error("This local host cannot open folders yet");
    }
    setRuntimeState("switching");
    try {
      const desc = client.selectWorkspace
        ? await client.selectWorkspace(selectionToken)
        : await client.openWorkspace!(selectionToken);
      setRuntimeState("ready");
      return desc;
    } catch (err) {
      if (isNonRetryableError(err)) {
        setRuntimeState("needs_attention");
      }
      throw err;
    }
  }), [withWorkspaceClient]);
  const openWorkspace = useCallback((path: string) => withWorkspaceClient(async (client) => {
    if (!client.openWorkspace && !client.selectWorkspace) {
      throw new Error("This local host cannot open folders yet");
    }
    setRuntimeState("switching");
    try {
      const desc = client.openWorkspace
        ? await client.openWorkspace(path)
        : await client.selectWorkspace!(path);
      setRuntimeState("ready");
      return desc;
    } catch (err) {
      if (isNonRetryableError(err)) {
        setRuntimeState("needs_attention");
      }
      throw err;
    }
  }), [withWorkspaceClient]);

  const manageTask = useCallback(
    async (params: ManageTaskParams): Promise<ManageTaskResult | null> => {
      const client = clientRef.current;
      if (!client || !client.manageTask) return null;
      try {
        const res = await client.manageTask(params);
        if (params.action === "list" && res.tasks) {
          setDaemonTasks(res.tasks);
        } else if (params.action === "status" && res.task) {
          setDaemonTasks((prev) => upsertTask(prev, res.task!));
        } else if (params.action === "kill" && params.taskId) {
          setDaemonTasks((prev) =>
            prev.map((t) => (t.taskId === params.taskId ? { ...t, status: "killed" } : t)),
          );
        }
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const createSchedule = useCallback(
    async (params: ScheduleParams): Promise<ScheduleResult | null> => {
      const client = clientRef.current;
      if (!client || !client.createSchedule) return null;
      try {
        const res = await client.createSchedule(params);
        setSchedules((prev) => {
          const idx = prev.findIndex((s) => s.scheduleId === res.scheduleId);
          if (idx === -1) return [...prev, res];
          const copy = prev.slice();
          copy[idx] = res;
          return copy;
        });
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const cancelSchedule = useCallback(
    async (scheduleId: string): Promise<ManageTaskResult | null> => {
      setSchedules((prev) =>
        prev.map((s) => (s.scheduleId === scheduleId ? { ...s, status: "cancelled" } : s)),
      );
      return manageTask({ action: "kill", taskId: scheduleId });
    },
    [manageTask],
  );

  const sendTaskInput = useCallback(
    async (taskId: string, input: string): Promise<ManageTaskResult | null> => {
      return manageTask({ action: "send_input", taskId, input });
    },
    [manageTask],
  );

  const killTask = useCallback(
    async (taskId: string): Promise<ManageTaskResult | null> => {
      return manageTask({ action: "kill", taskId });
    },
    [manageTask],
  );

  /* ------------------------- Shared Memory & Playground RPCs ------------------------- */

  const setSharedMemory = useCallback(
    async (
      key: string,
      value: unknown,
      namespace = "global",
      ttlSeconds?: number,
      tags: string[] = []
    ): Promise<MemorySetResult | null> => {
      const client = clientRef.current;
      if (!client || !client.setSharedMemory) return null;
      try {
        const res = await client.setSharedMemory({
          key,
          value: value as any,
          namespace,
          ttlSeconds,
          tags,
        });
        if (res?.entry) {
          setSharedMemoryState((prev) => upsertMemoryEntry(prev, res.entry));
        }
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const getSharedMemory = useCallback(
    async (key: string, namespace = "global"): Promise<MemoryGetResult | null> => {
      const client = clientRef.current;
      if (!client || !client.getSharedMemory) return null;
      try {
        return await client.getSharedMemory({ key, namespace });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const querySharedMemory = useCallback(
    async (params: MemoryQueryParams): Promise<MemoryQueryResult | null> => {
      const client = clientRef.current;
      if (!client || !client.querySharedMemory) return null;
      try {
        const res = await client.querySharedMemory(params);
        if (res?.entries && !params.query && !params.namespace && !params.tags?.length) {
          setSharedMemoryState(res.entries);
        }
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const deleteSharedMemory = useCallback(
    async (key: string, namespace = "global"): Promise<MemoryDeleteResult | null> => {
      const client = clientRef.current;
      if (!client || !client.deleteSharedMemory) return null;
      try {
        const res = await client.deleteSharedMemory({ key, namespace });
        setSharedMemoryState((prev) =>
          prev.filter((e) => !((e.namespace || "global") === (namespace || "global") && e.key === key))
        );
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const dispatchPlaygroundTurn = useCallback(
    async (subagentId: string, prompt: string) => {
      const client = clientRef.current;
      if (!client || !client.dispatchPlaygroundTurn) return null;
      try {
        return await client.dispatchPlaygroundTurn(subagentId, prompt);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const simulateAgentTurn = useCallback(
    async (subagentId: string, scenario: string) => {
      const client = clientRef.current;
      if (!client || !client.simulateAgentTurn) return null;
      try {
        return await client.simulateAgentTurn(subagentId, scenario);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  const injectAgentFailure = useCallback(
    async (
      subagentId: string,
      failureType: "timeout" | "crash" | "stall" | "out_of_budget",
      strategy?: "one_for_one" | "one_for_all" | "rest_for_one"
    ) => {
      const client = clientRef.current;
      if (!client || !client.injectAgentFailure) return null;
      try {
        return await client.injectAgentFailure(subagentId, failureType, strategy);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLastError(message);
        throw err;
      }
    },
    [],
  );

  /* ------------------------- derived props ---------------------------- */

  const routeDecision: RouteDecisionCardProps | null = route
    ? {
        decision: route.decision,
        pendingFallback: route.pendingFallback,
        preApprovedFallbacks: route.preApprovedFallbacks,
        onApproveFallback: (modelId) => sendGrant(route.runId, ROUTE_FALLBACK_STEP_PREFIX + modelId, true),
        onRejectFallback: (modelId) => sendGrant(route.runId, ROUTE_FALLBACK_STEP_PREFIX + modelId, false),
      }
    : null;

  const api: HostSession = {
    enabled,
    status,
    runtimeState,
    isOperational: runtimeState === "ready" || runtimeState === "healthy",
    // a stale error from a previous connection must not surface once disabled
    lastError: connKey ? lastError : null,
    plan,
    toolRuns,
    routeDecision,
    integrations,
    evidence,
    permissionPending: perms.pending,
    capabilityApprovalPending,
    subagents,
    activeSubagentId,
    interAgentMessages,
    daemonTasks,
    schedules,
    sharedMemory,
    setPlan,
    approveStep,
    runApproved,
    pause,
    cancel,
    stopToolRun,
    decidePermission,
    decideCapabilityApproval,
    toggleRulesPack: (id, enabled) => toggleIntegration("rules", id, enabled),
    toggleSkill: (id, enabled) => toggleIntegration("skill", id, enabled),
    toggleMcpServer: (id, enabled) => toggleIntegration("mcp", id, enabled),
    setActiveSubagentId,
    spawnSubagent,
    killSubagent,
    killSubagentTree,
    sendAgentMessage,
    manageSubagentsAction,
    defineSubagent,
    executeCommand,
    dispatchCommand,
    readWorkspaceDirectory,
    readWorkspaceFile,
    writeWorkspaceFile,
    statWorkspaceFile,
    searchWorkspace,
    workspaceGitStatus,
    watchWorkspace,
    unwatchWorkspace,
    selectWorkspace,
    openWorkspace,
    reconnectToWorkspace,
    manageTask,
    createSchedule,
    cancelSchedule,
    sendTaskInput,
    killTask,
    setSharedMemory,
    getSharedMemory,
    querySharedMemory,
    deleteSharedMemory,
    dispatchPlaygroundTurn,
    simulateAgentTurn,
    injectAgentFailure,
  };

  const onApi = options?.onApi;
  useEffect(() => {
    onApi?.(api);
  });

  return api;
}
