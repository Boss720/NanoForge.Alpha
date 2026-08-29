/**
 * Task 18 — run coordinator acceptance tests.
 *
 * Fully deterministic: fake provider adapters (scripted delta streams), a
 * runner spy (no real processes), a scripted approval gate, an in-memory
 * audit sink, and a fixed clock. The real router (`bindRouter`) and the real
 * policy engine (`authorize`) are exercised end to end.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { ExecutionPlan, PlanStep } from "@protocol/plan";
import type { ModelProfile } from "@protocol/routing";
import type { Policy } from "../policy/policy";
import type {
  RunnerOptions,
  TerminalJobHandle,
  TerminalJobResult,
  TerminalJobSpec,
} from "../terminal/types";
import type {
  ProviderAdapter,
  ProviderDelta,
} from "../providers/types";
import { InMemoryProviderRegistry } from "../providers/registry";
import { RunEventLog, type RunEvent } from "./events";
import {
  bindRouter,
  RunCoordinator,
  type ApprovalOutcome,
  type ApprovalRequest,
} from "./coordinator";

/* ------------------------------------------------------------------------ */
/* Fixtures and fakes                                                       */
/* ------------------------------------------------------------------------ */

const FIXED_NOW = new Date("2026-08-11T12:00:00.000Z");
const clock = () => FIXED_NOW;

const profileA: ModelProfile = {
  id: "model-a",
  provider: "prov-a",
  capabilities: { planning: 0.9, coding: 0.95, vision: 0, toolCalling: 0.95 },
  costPer1kInputTokens: 0.001,
  costPer1kOutputTokens: 0.002,
  privacyClass: "cloud",
  maxContextTokens: 128_000,
  typicalLatencyMs: 500,
};

const profileB: ModelProfile = {
  id: "model-b",
  provider: "prov-b",
  capabilities: { planning: 0.5, coding: 0.5, vision: 0, toolCalling: 0.5 },
  costPer1kInputTokens: 0.001,
  costPer1kOutputTokens: 0.002,
  privacyClass: "cloud",
  maxContextTokens: 128_000,
  typicalLatencyMs: 500,
};

const POLICY: Policy = {
  workspaceRoot: ".",
  shells: ["cmd", "powershell", "bash", "sh"],
  deniedExecutables: [],
  askExecutables: ["npm"],
  readOnly: [{ executable: "git", firstArgs: ["status", "log"] }],
  redirectionDecision: "ask",
  compositionDecision: "deny",
  defaultDecision: "ask",
};

const step = (id: string, dependsOn: readonly string[] = []): PlanStep => ({
  id,
  title: `Step ${id}`,
  dependsOn,
  status: "pending",
});

const planWith = (steps: PlanStep[]): ExecutionPlan => ({
  id: "plan-1",
  goal: "ship the feature",
  steps,
});

const scriptedAdapter = (id: string, script: ProviderDelta[]): ProviderAdapter => ({
  id,
  capabilities: { planning: true, coding: true, vision: false, toolCalling: true },
  streamChat: async function* (): AsyncIterable<ProviderDelta> {
    for (const delta of script) yield delta;
  },
});

const GIT_STATUS_PROPOSAL: ProviderDelta = {
  type: "tool_proposal",
  name: "terminal.exec",
  args: { executable: "git", args: ["status"], cwd: "." },
};

const NPM_INSTALL_PROPOSAL: ProviderDelta = {
  type: "tool_proposal",
  name: "terminal.exec",
  args: { executable: "npm", args: ["install"], cwd: "." },
};

function makeRunner(result: Partial<TerminalJobResult> = {}) {
  const calls: { spec: TerminalJobSpec; options: RunnerOptions }[] = [];
  let n = 0;
  const fn = (spec: TerminalJobSpec, options: RunnerOptions): TerminalJobHandle => {
    calls.push({ spec, options });
    const id = `job-${++n}`;
    return {
      id,
      events: new EventEmitter(),
      promise: Promise.resolve({
        id,
        code: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
        truncated: false,
        stdout: "all good\n",
        stderr: "",
        durationMs: 3,
        ...result,
      }),
      cancel: () => {},
    };
  };
  return { fn, calls };
}

function makeGate(outcome: ApprovalOutcome | "hang" = { outcome: "granted" }) {
  const calls: ApprovalRequest[] = [];
  return {
    calls,
    requestApproval(request: ApprovalRequest): Promise<ApprovalOutcome> {
      calls.push(request);
      if (outcome === "hang") return new Promise<ApprovalOutcome>(() => {});
      return Promise.resolve(outcome);
    },
  };
}

function makeAuditSink() {
  const started: { id: string; goal: string }[] = [];
  const events: RunEvent[] = [];
  const artifacts: { runId: string; kind: string; name: string; data: string | Uint8Array }[] = [];
  const ended: { runId: string; state: string }[] = [];
  return {
    started,
    events,
    artifacts,
    ended,
    startRun(input: { id: string; goal: string }) {
      started.push(input);
    },
    recordEvent(_runId: string, event: RunEvent) {
      events.push(event);
    },
    recordArtifact(input: { runId: string; kind: string; name: string; data: string | Uint8Array }) {
      artifacts.push(input);
    },
    endRun(input: { runId: string; state: string }) {
      ended.push(input);
    },
  };
}

function setup(adapters: ProviderAdapter[], opts: { gateOutcome?: ApprovalOutcome | "hang"; runnerResult?: Partial<TerminalJobResult> } = {}) {
  const eventLog = new RunEventLog({ clock });
  const events: RunEvent[] = [];
  eventLog.subscribeAll((e) => events.push(e));

  const registry = new InMemoryProviderRegistry();
  for (const adapter of adapters) registry.register(adapter);

  const runner = makeRunner(opts.runnerResult);
  const gate = makeGate(opts.gateOutcome);
  const audit = makeAuditSink();

  const coordinator = new RunCoordinator({
    router: bindRouter([profileA, profileB]),
    profiles: [profileA, profileB],
    providerRegistry: registry,
    policy: POLICY,
    runner: runner.fn,
    auditStore: audit,
    approvalGate: gate,
    eventLog,
    workspaceRoot: ".",
    clock,
  });

  const waitForType = async (type: string): Promise<void> => {
    for (let i = 0; i < 200; i++) {
      if (events.some((e) => e.type === type)) return;
      await new Promise((r) => setTimeout(r, 1));
    }
    throw new Error(`timeout waiting for event "${type}"`);
  };

  return { coordinator, eventLog, events, registry, runner, gate, audit, waitForType };
}

const types = (events: readonly RunEvent[]): string[] => events.map((e) => e.type);

const waitFor = async (events: readonly RunEvent[], type: string): Promise<void> => {
  for (let i = 0; i < 200; i++) {
    if (events.some((e) => e.type === type)) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`timeout waiting for event "${type}"`);
};

/* ------------------------------------------------------------------------ */
/* Tests                                                                    */
/* ------------------------------------------------------------------------ */

describe("RunCoordinator", () => {
  it("runs the full happy path emitting the ordered event chain", async () => {
    const adapter = scriptedAdapter("prov-a", [
      { type: "text", text: "checking the tree" },
      GIT_STATUS_PROPOSAL,
      { type: "usage", inputTokens: 100, outputTokens: 20 },
      { type: "done" },
    ]);
    const { coordinator, events, runner, audit } = setup([adapter]);

    const handle = coordinator.submitRun(planWith([step("s1"), step("s2", ["s1"])]));
    const summary = await handle.done;

    expect(summary.status).toBe("completed");
    expect(types(events)).toEqual([
      "plan.submitted",
      "plan.validated",
      "step.ready", // s1
      "route.decided",
      "model.proposal",
      "policy.decision",
      "tool.started",
      "tool.output_digest",
      "tool.finished",
      "step.succeeded",
      "step.ready", // s2
      "route.decided",
      "model.proposal",
      "policy.decision",
      "tool.started",
      "tool.output_digest",
      "tool.finished",
      "step.succeeded",
      "run.completed",
    ]);

    // Monotonic per-run seq, timestamps, immutability.
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.every((e) => e.at === FIXED_NOW.toISOString())).toBe(true);
    expect(events.every((e) => Object.isFrozen(e))).toBe(true);
    const routeEvent = events.find((e) => e.type === "route.decided");
    expect(routeEvent && Object.isFrozen((routeEvent as { decision: unknown }).decision)).toBe(true);

    // Policy allowed the whitelisted read-only command without approval.
    const policyEvents = events.filter((e) => e.type === "policy.decision");
    expect(policyEvents.map((e) => (e as { decision: string }).decision)).toEqual(["allow", "allow"]);
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0].spec).toMatchObject({ executable: "git", args: ["status"] });

    // The route decision is recorded with its full explanation.
    const decision = (routeEvent as unknown as { decision: { primary: string; reason: string } }).decision;
    expect(decision.primary).toBe("model-a");
    expect(decision.reason).toContain("primary=model-a");

    // Audit sink saw the whole lifecycle, including an output artifact.
    expect(audit.started).toHaveLength(1);
    expect(audit.events).toHaveLength(events.length);
    expect(audit.artifacts).toHaveLength(2);
    expect(audit.ended).toMatchObject([{ runId: handle.runId, state: "completed" }]);
  });

  it("denied approval results in NO tool call and halts the run", async () => {
    const adapter = scriptedAdapter("prov-a", [NPM_INSTALL_PROPOSAL, { type: "done" }]);
    const { coordinator, events, runner, gate, audit } = setup([adapter], {
      gateOutcome: { outcome: "denied", reason: "no installs today" },
    });

    const handle = coordinator.submitRun(planWith([step("s1"), step("s2", ["s1"])]));
    const summary = await handle.done;

    expect(summary.status).toBe("halted");
    // The runner spy was NEVER invoked — no child process exists.
    expect(runner.calls).toHaveLength(0);
    expect(gate.calls).toHaveLength(1);
    expect(gate.calls[0].tool).toBe("terminal.exec");

    expect(types(events)).toEqual([
      "plan.submitted",
      "plan.validated",
      "step.ready",
      "route.decided",
      "model.proposal",
      "policy.decision", // ask
      "approval.requested",
      "approval.denied",
      "step.failed",
      "run.halted",
    ]);
    expect((events.find((e) => e.type === "policy.decision") as { decision: string }).decision).toBe("ask");
    // No tool events, and the dependent step never started.
    expect(events.some((e) => e.type === "tool.started")).toBe(false);
    expect(events.filter((e) => e.type === "step.ready")).toHaveLength(1);
    expect(audit.ended).toMatchObject([{ runId: handle.runId, state: "halted" }]);
  });

  it("approval expiry halts the run without any tool call", async () => {
    const adapter = scriptedAdapter("prov-a", [NPM_INSTALL_PROPOSAL, { type: "done" }]);
    const { coordinator, events, runner } = setup([adapter], {
      gateOutcome: { outcome: "expired" },
    });

    const handle = coordinator.submitRun(planWith([step("s1")]));
    const summary = await handle.done;

    expect(summary.status).toBe("halted");
    expect(summary.reason).toContain("expired");
    expect(runner.calls).toHaveLength(0);
    const denied = events.find((e) => e.type === "approval.denied") as { reason: string };
    expect(denied.reason).toBe("approval expired");
    expect(types(events).at(-1)).toBe("run.halted");
  });

  it("cancellation mid-run stops further steps and emits run.cancelled", async () => {
    const adapter = scriptedAdapter("prov-a", [NPM_INSTALL_PROPOSAL, { type: "done" }]);
    const { coordinator, events, runner, waitForType } = setup([adapter], {
      gateOutcome: "hang", // approval never resolves on its own
    });

    const handle = coordinator.submitRun(planWith([step("s1"), step("s2", ["s1"])]));
    await waitForType("approval.requested");
    handle.cancel();
    const summary = await handle.done;

    expect(summary.status).toBe("cancelled");
    expect(runner.calls).toHaveLength(0);
    expect(types(events)).toEqual([
      "plan.submitted",
      "plan.validated",
      "step.ready",
      "route.decided",
      "model.proposal",
      "policy.decision",
      "approval.requested",
      "run.cancelled",
    ]);
    expect(events.some((e) => e.type === "step.succeeded")).toBe(false);
  });

  it("a failed dependency blocks downstream steps and fails the run", async () => {
    const adapter = scriptedAdapter("prov-a", [GIT_STATUS_PROPOSAL, { type: "done" }]);
    const { coordinator, events, runner } = setup([adapter], {
      runnerResult: { code: 1, stderr: "fatal: not a git repository" },
    });

    const handle = coordinator.submitRun(planWith([step("s1"), step("s2", ["s1"])]));
    const summary = await handle.done;

    expect(summary.status).toBe("failed");
    expect(runner.calls).toHaveLength(1);
    expect(types(events)).toEqual([
      "plan.submitted",
      "plan.validated",
      "step.ready",
      "route.decided",
      "model.proposal",
      "policy.decision",
      "tool.started",
      "tool.output_digest",
      "tool.finished",
      "step.failed",
      "step.blocked", // s2 can never start
      "run.failed",
    ]);
    const blocked = events.find((e) => e.type === "step.blocked") as { stepId: string };
    expect(blocked.stepId).toBe("s2");
    // Downstream step: no step.ready, no route decision, no tool call.
    expect(events.filter((e) => e.type === "step.ready")).toHaveLength(1);
    expect(events.filter((e) => e.type === "route.decided")).toHaveLength(1);
  });

  it("provider outage walks the fallback chain and records both route events", async () => {
    const down = scriptedAdapter("prov-a", [
      { type: "error", code: "server_error", message: "503 from upstream", retryable: true },
    ]);
    const up = scriptedAdapter("prov-b", [GIT_STATUS_PROPOSAL, { type: "done" }]);
    const { coordinator, events, registry, runner } = setup([down, up]);

    const handle = coordinator.submitRun(planWith([step("s1")]));
    const summary = await handle.done;

    expect(summary.status).toBe("completed");
    const decided = events.find((e) => e.type === "route.decided") as {
      decision: { primary: string; fallbacks: string[] };
    };
    expect(decided.decision.primary).toBe("model-a");
    expect(decided.decision.fallbacks).toEqual(["model-b"]);

    const fallback = events.find((e) => e.type === "route.fallback") as {
      from: string;
      to: string;
      reason: string;
    };
    expect(fallback).toMatchObject({ from: "model-a", to: "model-b" });
    expect(fallback.reason).toContain("503");

    // The outage was marked on the registry and the fallback did the work.
    expect(registry.get("prov-a")?.health.status).toBe("unavailable");
    const modelError = events.find((e) => e.type === "model.error") as { model: string };
    expect(modelError.model).toBe("model-a");
    expect(runner.calls).toHaveLength(1);
    expect(types(events).at(-1)).toBe("run.completed");
  });

  it("halts as run.failed when every routed provider is unavailable", async () => {
    const down = scriptedAdapter("prov-a", [
      { type: "error", code: "server_error", message: "down", retryable: true },
    ]);
    const alsoDown = scriptedAdapter("prov-b", [
      { type: "error", code: "server_error", message: "down too", retryable: true },
    ]);
    const { coordinator, events, runner } = setup([down, alsoDown]);

    const handle = coordinator.submitRun(planWith([step("s1")]));
    const summary = await handle.done;

    expect(summary.status).toBe("failed");
    expect(runner.calls).toHaveLength(0);
    expect(events.filter((e) => e.type === "route.fallback")).toHaveLength(1);
    expect(events.filter((e) => e.type === "model.error")).toHaveLength(2);
    expect(types(events).at(-1)).toBe("run.failed");
  });

  it("rejects an invalid plan before anything executes", async () => {
    const adapter = scriptedAdapter("prov-a", [GIT_STATUS_PROPOSAL, { type: "done" }]);
    const { coordinator, events, runner } = setup([adapter]);
    const invalid = planWith([step("dup"), step("dup")]);

    const handle = coordinator.submitRun(invalid);
    const summary = await handle.done;

    expect(summary.status).toBe("failed");
    expect(summary.reason).toContain("validation failed");
    expect(types(events)).toEqual(["plan.submitted", "plan.validated", "run.failed"]);
    const validated = events.find((e) => e.type === "plan.validated") as {
      ok: boolean;
      errors?: { code: string }[];
    };
    expect(validated.ok).toBe(false);
    expect(validated.errors?.[0]?.code).toBe("duplicate_step_id");
    expect(runner.calls).toHaveLength(0);
  });

  it("halts immediately when policy denies a proposed tool", async () => {
    const shellProposal: ProviderDelta = {
      type: "tool_proposal",
      name: "terminal.exec",
      args: { executable: "cmd", args: ["/c", "dir"], cwd: "." },
    };
    const adapter = scriptedAdapter("prov-a", [shellProposal, { type: "done" }]);
    const { coordinator, events, runner, gate } = setup([adapter]);

    const handle = coordinator.submitRun(planWith([step("s1")]));
    const summary = await handle.done;

    expect(summary.status).toBe("halted");
    expect(runner.calls).toHaveLength(0);
    expect(gate.calls).toHaveLength(0); // deny never reaches the approval gate
    expect((events.find((e) => e.type === "policy.decision") as { decision: string }).decision).toBe("deny");
    expect(types(events).at(-1)).toBe("run.halted");
  });

  it("pauses between steps and resumes without losing events", async () => {
    const adapter = scriptedAdapter("prov-a", [GIT_STATUS_PROPOSAL, { type: "done" }]);
    const { coordinator, eventLog, events, runner } = setup([adapter]);

    // Pause synchronously inside the step.succeeded emit — before the drive
    // loop regains control and could start s2.
    // The subscription needs the handle before submitRun returns.
    // eslint-disable-next-line prefer-const
    let handle: ReturnType<typeof coordinator.submitRun>;
    let pausedOnce = false;
    eventLog.subscribeAll((e) => {
      if (e.type === "step.succeeded" && !pausedOnce) {
        pausedOnce = true;
        handle.pause();
      }
    });
    handle = coordinator.submitRun(planWith([step("s1"), step("s2", ["s1"])]));
    await waitFor(events, "run.paused");

    // Give the loop a chance to (wrongly) start s2.
    await new Promise((r) => setTimeout(r, 25));
    expect(handle.status()).toBe("paused");
    expect(events.filter((e) => e.type === "step.ready")).toHaveLength(1);
    expect(runner.calls).toHaveLength(1);
    expect(types(events).at(-1)).toBe("run.paused");

    handle.resume();
    const summary = await handle.done;
    expect(summary.status).toBe("completed");
    expect(runner.calls).toHaveLength(2);

    const tail = types(events);
    expect(tail.indexOf("run.paused")).toBeLessThan(tail.indexOf("run.resumed"));
    expect(tail.at(-1)).toBe("run.completed");
  });
});
