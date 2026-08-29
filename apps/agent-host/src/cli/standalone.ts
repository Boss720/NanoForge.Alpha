/**
 * In-Memory Standalone Coordinator Fallback.
 *
 * Runs agent execution plans directly in-process without requiring a
 * separate daemon process, maintaining identical policy gates, audit logging,
 * and approval mechanisms.
 */

import path from "node:path";
import type { ExecutionPlan } from "@protocol/plan";
import type { ModelProfile } from "@protocol/routing";
import { AuditStore } from "../audit/store";
import { loadPolicy, type Policy } from "../policy/policy";
import { OpenAICompatibleAdapter } from "../providers/openaiCompatible";
import { InMemoryProviderRegistry } from "../providers/registry";
import { bindRouter, RunCoordinator, type RunnerLike } from "../runs/coordinator";
import { RunEventLog, type RunEvent } from "../runs/events";
import { runTerminalJob } from "../terminal/runner";
import { CLIApprovalGate } from "./approval";
import { resolveExitCode } from "./exitCodes";
import { EXIT_CODES, type AutoApproveMode, type CLIResult } from "./types";

export interface StandaloneRunnerOptions {
  plan: ExecutionPlan;
  autoApprove?: AutoApproveMode;
  workspaceRoot?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  policy?: Policy;
  runner?: RunnerLike;
  profiles?: readonly ModelProfile[];
  providerRegistry?: InMemoryProviderRegistry;
  onEvent?: (event: RunEvent) => void;
}

const defaultProfile: ModelProfile = {
  id: "default-model",
  provider: "default-provider",
  capabilities: { planning: 1, coding: 1, vision: 0, toolCalling: 1 },
  costPer1kInputTokens: 0,
  costPer1kOutputTokens: 0,
  privacyClass: "cloud",
  maxContextTokens: 128_000,
  typicalLatencyMs: 500,
};

export class StandaloneRunner {
  static async run(options: StandaloneRunnerOptions): Promise<CLIResult> {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    const policy = options.policy ?? loadPolicy(workspaceRoot);
    const runner = options.runner ?? runTerminalJob;
    const profiles = options.profiles ?? [defaultProfile];

    const registry = options.providerRegistry ?? new InMemoryProviderRegistry();
    if (!options.providerRegistry) {
      registry.register(
        new OpenAICompatibleAdapter({
          id: defaultProfile.provider,
          model: defaultProfile.id,
          baseUrl: process.env.NANOFORGE_PROVIDER_BASE_URL ?? "http://127.0.0.1:9",
          apiKey: process.env.NANOFORGE_PROVIDER_API_KEY ?? process.env.OPENAI_API_KEY,
        }),
      );
    }

    const eventLog = new RunEventLog();
    const auditStore = new AuditStore({ rootDir: path.join(workspaceRoot, ".nanoforge", "runs") });
    const approvalGate = new CLIApprovalGate({
      mode: options.autoApprove ?? "none",
      policy,
      timeoutMs: options.timeoutMs,
    });

    const coordinator = new RunCoordinator({
      router: bindRouter(profiles),
      profiles,
      providerRegistry: registry,
      policy,
      runner,
      auditStore,
      approvalGate,
      eventLog,
      workspaceRoot,
      approvalTimeoutMs: options.timeoutMs,
    });

    const events: RunEvent[] = [];
    eventLog.subscribeAll((event) => {
      events.push(event);
      options.onEvent?.(event);
    });

    const handle = coordinator.submitRun(options.plan);

    let timer: NodeJS.Timeout | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        handle.cancel();
      }, options.timeoutMs);
    }

    if (options.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        handle.cancel();
      });
    }

    const summary = await handle.done;
    if (timer) clearTimeout(timer);
    auditStore.close();

    const exitCode = resolveExitCode(summary, events);

    return {
      exitCode,
      summary,
      events,
      plan: options.plan,
    };
  }
}
