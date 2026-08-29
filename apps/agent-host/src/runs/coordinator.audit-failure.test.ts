import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { ExecutionPlan } from "@protocol/plan";
import type { ModelProfile } from "@protocol/routing";
import type { Policy } from "../policy/policy";
import { InMemoryProviderRegistry } from "../providers/registry";
import type { ProviderAdapter } from "../providers/types";
import type { TerminalJobHandle, TerminalJobSpec, RunnerOptions } from "../terminal/types";
import { CapabilityBroker } from "../capabilities/broker";
import { BrokerApprovalGate } from "../capabilities/runApprovalGate";
import { RunEventLog, type RunEvent } from "./events";
import { bindRouter, RunCoordinator, type RunAuditSink } from "./coordinator";

const profile: ModelProfile = {
  id: "audit-test-model",
  provider: "audit-test-provider",
  capabilities: { planning: 1, coding: 1, vision: 0, toolCalling: 1 },
  costPer1kInputTokens: 0,
  costPer1kOutputTokens: 0,
  privacyClass: "cloud",
  maxContextTokens: 128_000,
  typicalLatencyMs: 1,
};

const policy: Policy = {
  workspaceRoot: ".",
  shells: ["cmd"],
  deniedExecutables: [],
  askExecutables: [],
  readOnly: [],
  redirectionDecision: "deny",
  compositionDecision: "deny",
  defaultDecision: "ask",
};

const plan: ExecutionPlan = {
  id: "audit-failure-plan",
  goal: "prove audit failures stop work",
  steps: [{ id: "step-1", title: "No side effect", dependsOn: [], status: "pending" }],
};

const adapter: ProviderAdapter = {
  id: profile.provider,
  capabilities: { planning: true, coding: true, vision: false, toolCalling: true },
  async *streamChat() {
    yield { type: "done" } as const;
  },
};

function runnerSpy() {
  const calls: Array<{ spec: TerminalJobSpec; options: RunnerOptions }> = [];
  return {
    calls,
    runner(spec: TerminalJobSpec, options: RunnerOptions): TerminalJobHandle {
      calls.push({ spec, options });
      return {
        id: "unexpected-tool",
        events: new EventEmitter(),
        promise: Promise.resolve({
          id: "unexpected-tool",
          code: 0,
          signal: null,
          timedOut: false,
          cancelled: false,
          truncated: false,
          stdout: "",
          stderr: "",
          durationMs: 0,
        }),
        cancel() {},
      };
    },
  };
}

function auditSink(overrides: Partial<RunAuditSink>): RunAuditSink {
  return {
    startRun() {},
    recordEvent() {},
    endRun() {},
    ...overrides,
  };
}

function coordinatorWith(auditStore: RunAuditSink) {
  const registry = new InMemoryProviderRegistry();
  registry.register(adapter);
  const runner = runnerSpy();
  const eventLog = new RunEventLog();
  const coordinator = new RunCoordinator({
    router: bindRouter([profile]),
    profiles: [profile],
    providerRegistry: registry,
    policy,
    runner: runner.runner,
    auditStore,
    approvalGate: { requestApproval: async () => ({ outcome: "granted" }) },
    eventLog,
    workspaceRoot: ".",
  });
  return { coordinator, runner };
}

describe("RunCoordinator audit failure handling", () => {
  it("fails closed before execution when starting the durable audit run fails", async () => {
    const { coordinator, runner } = coordinatorWith(auditSink({
      startRun() { throw new Error("audit store unavailable"); },
    }));

    const handle = coordinator.submitRun(plan);
    await expect(handle.done).resolves.toMatchObject({
      status: "failed",
      reason: "audit unavailable",
    });
    expect(handle.status()).toBe("failed");
    expect(runner.calls).toHaveLength(0);
  });

  it("terminates exactly once without tool execution when an in-flight audit event fails", async () => {
    const ended: Array<{ runId: string; state: string }> = [];
    const { coordinator, runner } = coordinatorWith(auditSink({
      recordEvent(_runId: string, event: RunEvent) {
        if (event.type === "route.decided") throw new Error("audit store unavailable");
      },
      endRun(input) { ended.push({ runId: input.runId, state: input.state }); },
    }));

    const handle = coordinator.submitRun(plan);
    await expect(handle.done).resolves.toMatchObject({
      status: "failed",
      reason: "audit unavailable",
    });
    expect(handle.status()).toBe("failed");
    expect(runner.calls).toHaveLength(0);
    expect(ended).toEqual([{ runId: handle.runId, state: "failed" }]);
  });

  it("does not execute an approved tool when capability decision persistence fails", async () => {
    const registry = new InMemoryProviderRegistry();
    registry.register({
      id: profile.provider,
      capabilities: { planning: true, coding: true, vision: false, toolCalling: true },
      async *streamChat() {
        yield {
          type: "tool_proposal" as const,
          name: "terminal.exec",
          args: { executable: "npm", args: ["--version"], cwd: "." },
        };
        yield { type: "done" } as const;
      },
    });
    const runner = runnerSpy();
    const broker = new CapabilityBroker({
      auditSink() { throw new Error("capability audit store unavailable"); },
    });
    const gateRef: { current?: BrokerApprovalGate } = {};
    const gate = new BrokerApprovalGate({
      broker,
      binding: {
        hostInstanceId: "host-audit-failure",
        clientSessionId: "session-audit-failure",
        workspaceId: "workspace-audit-failure",
        workspaceGeneration: 1,
      },
      present: (request) => { gateRef.current?.resolve(request.requestId, true); },
    });
    gateRef.current = gate;
    const coordinator = new RunCoordinator({
      router: bindRouter([profile]),
      profiles: [profile],
      providerRegistry: registry,
      policy: { ...policy, askExecutables: ["npm"] },
      runner: runner.runner,
      auditStore: auditSink({}),
      approvalGate: gate,
      eventLog: new RunEventLog(),
      workspaceRoot: ".",
    });

    const handle = coordinator.submitRun(plan);
    await expect(handle.done).resolves.toMatchObject({ status: "halted" });
    expect(runner.calls).toHaveLength(0);
  });

  it("settles failed rather than leaving completion pending when ending the audit run fails", async () => {
    const { coordinator } = coordinatorWith(auditSink({
      endRun() { throw new Error("audit store unavailable"); },
    }));

    const handle = coordinator.submitRun(plan);
    const result = await Promise.race([
      handle.done,
      new Promise<{ status: "timed_out" }>((resolve) => setTimeout(() => resolve({ status: "timed_out" }), 50)),
    ]);
    expect(result).toMatchObject({ status: "failed", reason: "audit unavailable" });
    expect(handle.status()).toBe("failed");
  });
});
