/**
 * Task 19 — redacted audit ledger tests.
 *
 * Runs in per-test tmp dirs against the real node:sqlite store: round-trip
 * persistence with digests, secret redaction in the ledger AND both export
 * formats, artifact files with relative paths + digests, append-only
 * behavior, and Markdown section rendering.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REDACTED, redactObject, redactText } from "./redact";
import { AuditStore } from "./store";

const sha256Hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

const T0 = "2026-08-11T12:00:00.000Z";
const T1 = "2026-08-11T12:00:01.000Z";
const T2 = "2026-08-11T12:00:02.000Z";
const T3 = "2026-08-11T12:00:03.000Z";
const clock = () => new Date(T0);

let dir: string;
let store: AuditStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "nanoforge-audit-"));
  store = new AuditStore({ rootDir: dir, clock });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const submitted = (runId: string, seq: number, goal = "fix the bug") => ({
  seq,
  runId,
  type: "plan.submitted",
  at: T0,
  planId: "p1",
  goal,
  stepCount: 1,
  steps: [{ id: "s1", title: "Step s1", dependsOn: [] }],
});

/* ------------------------------------------------------------------------ */
/* redact.ts unit tests                                                     */
/* ------------------------------------------------------------------------ */

describe("redactText / redactObject", () => {
  it("redacts exact known secret values everywhere they occur", () => {
    const out = redactText("key=hunter2-value and again hunter2-value", ["hunter2-value"]);
    expect(out).toBe(`key=${REDACTED} and again ${REDACTED}`);
    expect(out).not.toContain("hunter2-value");
  });

  it("redacts common secret shapes without knowing the values", () => {
    const pem = `-----BEGIN PRIVATE KEY-----\nMIIabc\n+/xyz==\n-----END PRIVATE KEY-----`;
    const input = [
      "Bearer abcdef1234567890.token",
      "sk-proj-abcdef1234567890",
      `ghp_${"a".repeat(30)}`,
      `github_pat_${"A".repeat(30)}`,
      pem,
    ].join(" | ");
    const out = redactText(input);
    expect(out).not.toContain("abcdef1234567890.token");
    expect(out).not.toContain("sk-proj-abcdef1234567890");
    expect(out).not.toContain(`ghp_${"a".repeat(30)}`);
    expect(out).not.toContain("github_pat_");
    expect(out).not.toContain("MIIabc");
    expect(out.match(new RegExp(REDACTED, "g"))?.length).toBe(5);
  });

  it("redacts objects recursively and never mutates the input", () => {
    const input = {
      note: "the key is hunter2-value",
      nested: { list: ["hunter2-value", 42, null, true] },
    };
    const frozen = Object.freeze(input); // mutation would throw in strict mode
    const out = redactObject(frozen, ["hunter2-value"]);
    expect(out.note).toBe(`the key is ${REDACTED}`);
    expect((out.nested as { list: unknown[] }).list[0]).toBe(REDACTED);
    expect((out.nested as { list: unknown[] }).list[1]).toBe(42);
    // Input untouched:
    expect(input.note).toBe("the key is hunter2-value");
    expect(input.nested.list[0]).toBe("hunter2-value");
  });
});

/* ------------------------------------------------------------------------ */
/* Persistence round-trip                                                   */
/* ------------------------------------------------------------------------ */

describe("AuditStore persistence", () => {
  it("records capability decisions as safe append-only rows", () => {
    const token = "grant-token-raw-must-never-persist";
    const rec = store.recordCapabilityDecision({
      at: T0,
      grantId: "grant-01",
      requestId: "request-01",
      decision: "allow",
      reasonCode: "approved",
      remainingUses: 2,
      tokenDigest: sha256Hex(token),
      binding: {
        sessionId: "session-01",
        workspaceId: "workspace-01",
        runId: "run-01",
        stepId: "step-01",
        toolId: "tool-01",
        argumentsDigest: `sha256:${"ab".repeat(32)}`,
      },
    });
    expect(rec).toMatchObject({ grantId: "grant-01", requestId: "request-01", decision: "allow", remainingUses: 2 });
    expect(rec.eventDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(store.listCapabilityDecisions())).not.toContain(token);
    expect(() => store.recordCapabilityDecision({ decision: "deny", reasonCode: "x", token } as never)).toThrow(/raw token/i);
  });

  it("persists capability decisions across reopen in insertion order", () => {
    store.recordCapabilityDecision({ at: T2, grantId: "g-2", decision: "deny", reasonCode: "expired" });
    store.recordCapabilityDecision({ at: T1, requestId: "q-1", decision: "revoke", reasonCode: "revoked" });
    store.close();
    store = new AuditStore({ rootDir: dir, clock });
    expect(store.listCapabilityDecisions().map((row) => row.decision)).toEqual(["deny", "revoke"]);
    expect(store.listCapabilityDecisions().map((row) => row.at)).toEqual([T2, T1]);
    const raw = new DatabaseSync(path.join(dir, "audit.db"));
    const rows = raw.prepare("SELECT * FROM capability_decisions ORDER BY id").all() as Record<string, unknown>[];
    raw.close();
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain("grant-token-raw-must-never-persist");
    expect(rows[0].eventDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("round-trips events with correct per-event digests and run digest chain", () => {
    store.startRun({ id: "r1", goal: "fix the bug", startedAt: T0 });
    store.recordEvent("r1", submitted("r1", 1));
    store.recordEvent("r1", {
      seq: 2,
      runId: "r1",
      type: "route.decided",
      at: T1,
      stepId: "s1",
      decision: {
        primary: "model-a",
        fallbacks: ["model-b"],
        estimatedCostUsd: 0.012,
        reason: "primary=model-a [best score]",
        pinned: false,
      },
    });
    store.recordEvent("r1", {
      seq: 3,
      runId: "r1",
      type: "tool.finished",
      at: T2,
      stepId: "s1",
      jobId: "job-1",
      code: 0,
      signal: null,
      timedOut: false,
      cancelled: false,
      truncated: false,
      durationMs: 12,
    });
    store.endRun({ runId: "r1", state: "completed", endedAt: T3 });

    const run = store.getRun("r1");
    expect(run).toMatchObject({
      id: "r1",
      goal: "fix the bug",
      state: "completed",
      startedAt: T0,
      endedAt: T3,
    });
    expect(run?.digest).toMatch(/^[0-9a-f]{64}$/);

    const events = store.listEvents("r1");
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events.map((e) => e.type)).toEqual([
      "plan.submitted",
      "route.decided",
      "tool.finished",
    ]);
    // Per-event digest = sha256 of the stored payload JSON.
    for (const e of events) {
      expect(e.sha256).toBe(sha256Hex(JSON.stringify(e.payload)));
    }
    // Run digest = fold of event hashes over the genesis seed.
    let digest = sha256Hex("nanoforge-run:r1");
    for (const e of events) digest = sha256Hex(digest + e.sha256);
    expect(run?.digest).toBe(digest);

    // Payload content survives intact.
    expect(events[1].payload.decision).toMatchObject({ primary: "model-a", pinned: false });
  });

  it("is append-only: duplicate (runId, seq) is rejected and there is no update API", () => {
    store.startRun({ id: "r1", goal: "g" });
    store.recordEvent("r1", submitted("r1", 1));
    expect(() => store.recordEvent("r1", submitted("r1", 1))).toThrow();
    // The ledger still holds exactly one event — the original was not replaced.
    expect(store.listEvents("r1")).toHaveLength(1);

    const asAny = store as unknown as Record<string, unknown>;
    expect(asAny.updateEvent).toBeUndefined();
    expect(asAny.deleteEvent).toBeUndefined();
    expect(asAny.updateRun).toBeUndefined();
    expect(asAny.deleteRun).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------ */
/* Redaction in ledger and exports                                          */
/* ------------------------------------------------------------------------ */

describe("AuditStore redaction", () => {
  it("keeps secrets out of DB rows and both export formats", () => {
    const SECRET = "hunter2-exact-value"; // matches no pattern: exact-value redaction only
    const SK = "sk-testsecret-abc1234567890"; // pattern + exact
    const secrets = () => [SECRET, SK];
    store.close();
    store = new AuditStore({ rootDir: dir, clock, secrets });

    store.startRun({ id: "r1", goal: `deploy with ${SECRET}` });
    store.recordEvent("r1", submitted("r1", 1, `goal mentions ${SECRET} and ${SK}`));
    store.recordEvent("r1", {
      seq: 2,
      runId: "r1",
      type: "policy.decision",
      at: T1,
      stepId: "s1",
      tool: "terminal.exec",
      decision: "deny",
      reason: `token ${SECRET} appeared in args`,
      request: { kind: "terminal.exec", cwd: ".", executable: "curl", args: [SECRET] },
    });
    store.endRun({ runId: "r1", state: "halted", endedAt: T2 });

    // 1. Store API surface is clean.
    const run = store.getRun("r1")!;
    expect(run.goal).toBe(`deploy with ${REDACTED}`);
    const eventsJson = JSON.stringify(store.listEvents("r1"));
    for (const s of [SECRET, SK]) expect(eventsJson).not.toContain(s);
    expect(eventsJson).toContain(REDACTED);

    // 2. Raw DB rows are clean (separate read connection).
    const raw = new DatabaseSync(path.join(dir, "audit.db"));
    const goalRows = raw.prepare("SELECT goal FROM runs").all() as { goal: string }[];
    const eventRows = raw.prepare("SELECT payloadJson FROM events").all() as {
      payloadJson: string;
    }[];
    raw.close();
    const allText = goalRows.map((r) => r.goal).join() + eventRows.map((r) => r.payloadJson).join();
    for (const s of [SECRET, SK]) expect(allText).not.toContain(s);

    // 3. Both export formats are clean.
    const jsonExport = store.exportRun("r1", { format: "json" });
    const jsonText = JSON.stringify(jsonExport);
    const markdown = store.exportRun("r1", { format: "markdown" });
    for (const s of [SECRET, SK]) {
      expect(jsonText).not.toContain(s);
      expect(markdown).not.toContain(s);
    }
    expect(markdown).toContain(REDACTED);
  });
});

/* ------------------------------------------------------------------------ */
/* Artifacts                                                                */
/* ------------------------------------------------------------------------ */

describe("AuditStore artifacts", () => {
  it("writes text artifacts redacted, with relative path + digest in the DB", () => {
    const SECRET = "sk-testsecret-abc1234567890";
    store.close();
    store = new AuditStore({ rootDir: dir, clock, secrets: [SECRET] });
    store.startRun({ id: "r1", goal: "g" });

    const rec = store.recordArtifact({
      runId: "r1",
      kind: "tool-output",
      name: "job-1 output.txt", // unsafe chars sanitized
      data: `all good, key was ${SECRET}\n`,
    });

    // Relative, confined path.
    expect(path.isAbsolute(rec.relativePath)).toBe(false);
    expect(rec.relativePath).not.toContain("..");
    expect(rec.relativePath.startsWith(`artifacts/r1/`)).toBe(true);
    expect(rec.relativePath).toBe("artifacts/r1/001-job-1_output.txt");

    // File on disk is redacted and matches the recorded digest/bytes.
    const absolute = path.join(dir, rec.relativePath);
    expect(existsSync(absolute)).toBe(true);
    const content = readFileSync(absolute, "utf8");
    expect(content).not.toContain(SECRET);
    expect(content).toBe(`all good, key was ${REDACTED}\n`);
    expect(rec.sha256).toBe(sha256Hex(content));
    expect(rec.bytes).toBe(Buffer.byteLength(content));

    const rows = store.listArtifacts("r1");
    expect(rows).toEqual([rec]);
  });

  it("writes binary artifacts as-is and sequences names per run", () => {
    store.startRun({ id: "r1", goal: "g" });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const a = store.recordArtifact({ runId: "r1", kind: "screenshot", name: "shot.png", data: bytes });
    const b = store.recordArtifact({ runId: "r1", kind: "screenshot", name: "shot2.png", data: bytes });

    expect(a.relativePath).toBe("artifacts/r1/001-shot.png");
    expect(b.relativePath).toBe("artifacts/r1/002-shot2.png");
    expect(readFileSync(path.join(dir, a.relativePath))).toEqual(Buffer.from(bytes));
    expect(a.sha256).toBe(sha256Hex(bytes));
    expect(a.bytes).toBe(bytes.byteLength);
  });
});

/* ------------------------------------------------------------------------ */
/* Export                                                                   */
/* ------------------------------------------------------------------------ */

describe("AuditStore export", () => {
  it("renders all Markdown sections and a structured JSON bundle", () => {
    store.startRun({ id: "r1", goal: "verify the build", startedAt: T0 });
    store.recordEvent("r1", submitted("r1", 1, "verify the build"));
    store.recordEvent("r1", {
      seq: 2, runId: "r1", type: "route.decided", at: T0, stepId: "s1",
      decision: {
        primary: "model-a",
        fallbacks: ["model-b"],
        estimatedCostUsd: 0.0123,
        reason: "primary=model-a [score 0.91]",
        pinned: false,
      },
    });
    store.recordEvent("r1", {
      seq: 3, runId: "r1", type: "route.fallback", at: T0, stepId: "s1",
      from: "model-a", to: "model-b", reason: "503 from upstream",
    });
    store.recordEvent("r1", {
      seq: 4, runId: "r1", type: "policy.decision", at: T0, stepId: "s1",
      tool: "terminal.exec", decision: "ask", reason: "npm is an ask executable",
    });
    store.recordEvent("r1", {
      seq: 5, runId: "r1", type: "approval.requested", at: T0, stepId: "s1",
      requestId: "req-1", tool: "terminal.exec", reason: "npm is an ask executable",
    });
    store.recordEvent("r1", {
      seq: 6, runId: "r1", type: "approval.granted", at: T1, stepId: "s1", requestId: "req-1",
    });
    store.recordEvent("r1", {
      seq: 7, runId: "r1", type: "tool.started", at: T1, stepId: "s1",
      jobId: "job-1", tool: "terminal.exec", executable: "git", args: ["status"], cwd: ".",
    });
    store.recordEvent("r1", {
      seq: 8, runId: "r1", type: "tool.output_digest", at: T2, stepId: "s1",
      jobId: "job-1", sha256: "ab".repeat(32), bytes: 128, truncated: false,
    });
    store.recordEvent("r1", {
      seq: 9, runId: "r1", type: "tool.finished", at: T2, stepId: "s1",
      jobId: "job-1", code: 0, signal: null, timedOut: false, cancelled: false,
      truncated: false, durationMs: 9,
    });
    store.recordArtifact({ runId: "r1", kind: "tool-output", name: "job-1.txt", data: "ok\n" });
    store.endRun({ runId: "r1", state: "completed", endedAt: T3 });

    const md = store.exportRun("r1", { format: "markdown" });
    for (const section of [
      "# Run audit: r1",
      "**Goal:** verify the build",
      "**State:** completed",
      "## Route decisions",
      "## Policy decisions",
      "## Approvals",
      "## Tool runs",
      "## Artifacts",
    ]) {
      expect(md).toContain(section);
    }
    expect(md).toContain("**model-a** (fallbacks: model-b)");
    expect(md).toContain("fell back from **model-a** to **model-b**");
    expect(md).toContain("`terminal.exec` → **ask**");
    expect(md).toContain("**granted**");
    expect(md).toContain("`git status`");
    expect(md).toContain("exit 0");
    expect(md).toContain(`artifacts/r1/001-job-1.txt`);

    const json = store.exportRun("r1", { format: "json" });
    expect(json.run).toMatchObject({ id: "r1", state: "completed" });
    expect(json.events).toHaveLength(9);
    expect(json.artifacts).toHaveLength(1);
    expect(json.events[2].type).toBe("route.fallback");

    expect(() => store.exportRun("nope", { format: "json" })).toThrow(/unknown run id/);
  });
});
