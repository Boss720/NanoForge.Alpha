/**
 * Task 19 — redacted, append-only audit ledger.
 *
 * Layout under `rootDir` (default `.nanoforge/runs/`, already gitignored):
 * - `audit.db` — SQLite (node:sqlite DatabaseSync) metadata: runs, events,
 *   artifacts. Only digests, sizes, and RELATIVE paths are stored — never
 *   absolute paths, never raw large payloads.
 * - `artifacts/<runId>/...` — large outputs/screenshots. The DB row carries
 *   the file's SHA-256 and byte count.
 *
 * Security contract:
 * - Every piece of text passing through `recordEvent`/`startRun`/
 *   `recordArtifact` (text artifacts) is redacted FIRST via
 *   {@link redactObject}/{@link redactText} with the injected known-secret
 *   provider — the ledger never persists secret material.
 * - The events ledger is append-only: there is deliberately NO update or
 *   delete API, and the (runId, seq) primary key rejects rewrites.
 * - Each run carries a tamper-evident digest chain: every event hash is
 *   folded into the running digest stored on the run row at `endRun`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { redactObject, redactText } from "./redact";

/* ------------------------------------------------------------------------ */
/* Types                                                                    */
/* ------------------------------------------------------------------------ */

/** Supplies the secret values that must never reach the ledger. */
export type KnownSecretsProvider = () => readonly string[];

export interface AuditStoreOptions {
  /** Ledger root, e.g. `.nanoforge/runs`. Created recursively. */
  rootDir: string;
  /** Static list or provider of known secret values to redact. */
  secrets?: readonly string[] | KnownSecretsProvider;
  clock?: () => Date;
}

export type AuditRunState =
  | "running"
  | "completed"
  | "failed"
  | "halted"
  | "cancelled";

export interface AuditRunRecord {
  id: string;
  goal: string;
  state: string;
  startedAt: string;
  endedAt: string | null;
  digest: string | null;
}

/** Minimal event shape the store accepts (structurally compatible with RunEvent). */
export interface AuditEventInput {
  seq: number;
  type: string;
  at: string;
  [key: string]: unknown;
}

export interface AuditEventRecord {
  runId: string;
  seq: number;
  type: string;
  at: string;
  /** Parsed, redacted event payload (the full event as stored). */
  payload: Record<string, unknown>;
  /** SHA-256 of the stored (redacted) payload JSON. */
  sha256: string;
}

export interface AuditArtifactRecord {
  runId: string;
  kind: string;
  /** Path relative to the store root (posix separators). Never absolute. */
  relativePath: string;
  sha256: string;
  bytes: number;
}

export type CapabilityDecision = "allow" | "deny" | "revoke";

/** Safe, host-produced identifiers/digests used to explain a capability decision. */
export interface CapabilityDecisionBinding {
  hostId?: string;
  sessionId?: string;
  workspaceId?: string;
  runId?: string;
  stepId?: string;
  toolId?: string;
  argumentsDigest?: string;
}

export interface AuditCapabilityDecisionInput {
  at?: string;
  grantId?: string;
  requestId?: string;
  decision: CapabilityDecision;
  reasonCode: string;
  remainingUses?: number;
  tokenDigest?: string;
  binding?: CapabilityDecisionBinding;
}

export interface AuditCapabilityDecisionRecord {
  id: number;
  at: string;
  grantId: string | null;
  requestId: string | null;
  decision: CapabilityDecision;
  reasonCode: string;
  remainingUses: number | null;
  tokenDigest: string | null;
  binding: CapabilityDecisionBinding;
  eventDigest: string;
}

/** Structured (already redacted) JSON export of one run. */
export interface AuditRunExport {
  run: AuditRunRecord;
  events: AuditEventRecord[];
  artifacts: AuditArtifactRecord[];
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

const sha256Hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

/** Strip anything path-like or unsafe from an artifact file name. */
const sanitizeName = (name: string): string => {
  const cleaned = name
    .replace(/[/\\]/g, "_")
    .replace(/\.\.+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : "artifact.bin";
};

const asString = (v: unknown): string => String(v);
const asStringOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);
const asNumber = (v: unknown): number => Number(v);

const normalizeDigest = (value: string, field: string): string => {
  const hex = value.startsWith("sha256:") ? value.slice(7) : value;
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new TypeError(`invalid ${field}`);
  return `sha256:${hex.toLowerCase()}`;
};

const safeBinding = (binding: CapabilityDecisionBinding | undefined, secrets: readonly string[]): CapabilityDecisionBinding => {
  if (!binding) return {};
  const out: CapabilityDecisionBinding = {};
  for (const key of ["hostId", "sessionId", "workspaceId", "runId", "stepId", "toolId"] as const) {
    const value = binding[key];
    if (value !== undefined) {
      if (typeof value !== "string" || value.length === 0 || value.length > 256) throw new TypeError(`invalid binding ${key}`);
      out[key] = redactText(value, secrets);
    }
  }
  if (binding.argumentsDigest !== undefined) out.argumentsDigest = normalizeDigest(binding.argumentsDigest, "argumentsDigest");
  return out;
};

/* ------------------------------------------------------------------------ */
/* AuditStore                                                               */
/* ------------------------------------------------------------------------ */

export class AuditStore {
  private readonly rootDir: string;
  private readonly clock: () => Date;
  private readonly secretsSource?: readonly string[] | KnownSecretsProvider;
  private readonly db: DatabaseSync;
  private readonly digests = new Map<string, string>();
  private readonly artifactCounters = new Map<string, number>();

  constructor(options: AuditStoreOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.clock = options.clock ?? (() => new Date());
    this.secretsSource = options.secrets;
    mkdirSync(path.join(this.rootDir, "artifacts"), { recursive: true });
    this.db = new DatabaseSync(path.join(this.rootDir, "audit.db"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        state TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        endedAt TEXT,
        digest TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        runId TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        at TEXT NOT NULL,
        payloadJson TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        PRIMARY KEY (runId, seq)
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        runId TEXT NOT NULL,
        kind TEXT NOT NULL,
        relativePath TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS capability_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        grantId TEXT,
        requestId TEXT,
        decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny', 'revoke')),
        reasonCode TEXT NOT NULL,
        remainingUses INTEGER,
        tokenDigest TEXT,
        bindingJson TEXT NOT NULL,
        eventDigest TEXT NOT NULL
      );
    `);
  }

  /** Current known secrets (static list or live provider). */
  private secrets(): readonly string[] {
    if (this.secretsSource === undefined) return [];
    return typeof this.secretsSource === "function"
      ? this.secretsSource()
      : this.secretsSource;
  }

  private genesisDigest(runId: string): string {
    return sha256Hex(`nanoforge-run:${runId}`);
  }

  /* ------------------------------ writing ------------------------------ */

  /** Open a run. The goal is redacted before it is persisted. */
  startRun(input: { id: string; goal: string; startedAt?: string }): void {
    const goal = redactText(input.goal, this.secrets());
    this.db
      .prepare("INSERT INTO runs (id, goal, state, startedAt) VALUES (?, ?, ?, ?)")
      .run(input.id, goal, "running", input.startedAt ?? this.clock().toISOString());
    this.digests.set(input.id, this.genesisDigest(input.id));
  }

  /**
   * Append one event. The payload is redacted, serialized, hashed, and the
   * hash folded into the run's digest chain. Same (runId, seq) twice throws.
   */
  recordEvent(runId: string, event: AuditEventInput): void {
    const redacted = redactObject(event, this.secrets());
    const payloadJson = JSON.stringify(redacted);
    const sha256 = sha256Hex(payloadJson);
    const prev = this.digests.get(runId) ?? this.genesisDigest(runId);
    this.digests.set(runId, sha256Hex(prev + sha256));
    this.db
      .prepare(
        "INSERT INTO events (runId, seq, type, at, payloadJson, sha256) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(runId, event.seq, event.type, event.at, payloadJson, sha256);
  }

  /**
   * Write a large payload to the per-run artifact dir and record only its
   * digest + relative path in the DB. Text payloads are redacted before
   * they touch disk; binary payloads (Uint8Array) are written as-is.
   */
  recordArtifact(input: {
    runId: string;
    kind: string;
    name: string;
    data: string | Uint8Array;
  }): AuditArtifactRecord {
    const seq = (this.artifactCounters.get(input.runId) ?? 0) + 1;
    this.artifactCounters.set(input.runId, seq);

    const content =
      typeof input.data === "string"
        ? redactText(input.data, this.secrets())
        : input.data;
    const fileName = `${String(seq).padStart(3, "0")}-${sanitizeName(input.name)}`;
    const relativePath = path.posix.join("artifacts", input.runId, fileName);
    const absolutePath = path.join(this.rootDir, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);

    const sha256 = sha256Hex(content);
    const bytes =
      typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
    this.db
      .prepare(
        "INSERT INTO artifacts (runId, kind, relativePath, sha256, bytes) VALUES (?, ?, ?, ?, ?)",
      )
      .run(input.runId, input.kind, relativePath, sha256, bytes);
    return { runId: input.runId, kind: input.kind, relativePath, sha256, bytes };
  }

  /**
   * Append a capability decision. Only opaque identifiers and digests are
   * accepted; sensitive request material is rejected before touching SQLite.
   */
  recordCapabilityDecision(input: AuditCapabilityDecisionInput): AuditCapabilityDecisionRecord {
    const forbidden = ["token", "rawToken", "tokenValue", "canonicalPath", "arguments", "content", "prompt", "command", "env"];
    const supplied = input as unknown as Record<string, unknown>;
    if (forbidden.some((key) => Object.prototype.hasOwnProperty.call(supplied, key))) {
      throw new TypeError("raw token or request material is not accepted by capability audit");
    }
    if (!input.grantId && !input.requestId) throw new TypeError("capability decision requires grantId or requestId");
    if (!/^(allow|deny|revoke)$/.test(input.decision)) throw new TypeError("invalid capability decision");
    if (!input.reasonCode || input.reasonCode.length > 128) throw new TypeError("invalid capability reason code");
    if (input.remainingUses !== undefined && (!Number.isSafeInteger(input.remainingUses) || input.remainingUses < 0)) {
      throw new TypeError("invalid remaining uses");
    }
    const tokenDigest = input.tokenDigest === undefined ? null : normalizeDigest(input.tokenDigest, "tokenDigest");
    const secrets = this.secrets();
    const binding = safeBinding(input.binding, secrets);
    const safe = {
      at: input.at ?? this.clock().toISOString(), grantId: input.grantId === undefined ? null : redactText(input.grantId, secrets),
      requestId: input.requestId === undefined ? null : redactText(input.requestId, secrets), decision: input.decision, reasonCode: redactText(input.reasonCode, secrets),
      remainingUses: input.remainingUses ?? null, tokenDigest, binding,
    };
    const eventDigest = `sha256:${sha256Hex(JSON.stringify(safe))}`;
    const result = this.db.prepare(
      "INSERT INTO capability_decisions (at, grantId, requestId, decision, reasonCode, remainingUses, tokenDigest, bindingJson, eventDigest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(safe.at, safe.grantId, safe.requestId, safe.decision, safe.reasonCode, safe.remainingUses, safe.tokenDigest, JSON.stringify(binding), eventDigest);
    return { id: Number(result.lastInsertRowid), ...safe, decision: safe.decision as CapabilityDecision, eventDigest };
  }

  /**
   * Close a run: record its terminal state, end time, and final digest.
   * (Run metadata transitions; the event ledger itself is append-only.)
   */
  endRun(input: { runId: string; state: AuditRunState | string; endedAt?: string }): void {
    this.db
      .prepare("UPDATE runs SET state = ?, endedAt = ?, digest = ? WHERE id = ?")
      .run(
        input.state,
        input.endedAt ?? this.clock().toISOString(),
        this.digests.get(input.runId) ?? null,
        input.runId,
      );
  }

  /* ------------------------------ reading ------------------------------ */

  getRun(runId: string): AuditRunRecord | undefined {
    const row = this.db
      .prepare("SELECT id, goal, state, startedAt, endedAt, digest FROM runs WHERE id = ?")
      .get(runId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: asString(row.id),
      goal: asString(row.goal),
      state: asString(row.state),
      startedAt: asString(row.startedAt),
      endedAt: asStringOrNull(row.endedAt),
      digest: asStringOrNull(row.digest),
    };
  }

  /** All stored events of a run, in seq order, with parsed redacted payloads. */
  listEvents(runId: string): AuditEventRecord[] {
    const rows = this.db
      .prepare(
        "SELECT runId, seq, type, at, payloadJson, sha256 FROM events WHERE runId = ? ORDER BY seq ASC",
      )
      .all(runId) as unknown as Record<string, unknown>[];
    return rows.map((row) => ({
      runId: asString(row.runId),
      seq: asNumber(row.seq),
      type: asString(row.type),
      at: asString(row.at),
      payload: JSON.parse(asString(row.payloadJson)) as Record<string, unknown>,
      sha256: asString(row.sha256),
    }));
  }

  listArtifacts(runId: string): AuditArtifactRecord[] {
    const rows = this.db
      .prepare(
        "SELECT runId, kind, relativePath, sha256, bytes FROM artifacts WHERE runId = ? ORDER BY relativePath ASC",
      )
      .all(runId) as unknown as Record<string, unknown>[];
    return rows.map((row) => ({
      runId: asString(row.runId),
      kind: asString(row.kind),
      relativePath: asString(row.relativePath),
      sha256: asString(row.sha256),
      bytes: asNumber(row.bytes),
    }));
  }

  listCapabilityDecisions(): AuditCapabilityDecisionRecord[] {
    const rows = this.db.prepare("SELECT id, at, grantId, requestId, decision, reasonCode, remainingUses, tokenDigest, bindingJson, eventDigest FROM capability_decisions ORDER BY id ASC").all() as unknown as Record<string, unknown>[];
    return rows.map((row) => ({
      id: asNumber(row.id), at: asString(row.at), grantId: asStringOrNull(row.grantId), requestId: asStringOrNull(row.requestId),
      decision: asString(row.decision) as CapabilityDecision, reasonCode: asString(row.reasonCode), remainingUses: row.remainingUses === null ? null : asNumber(row.remainingUses),
      tokenDigest: asStringOrNull(row.tokenDigest), binding: JSON.parse(asString(row.bindingJson)) as CapabilityDecisionBinding, eventDigest: asString(row.eventDigest),
    }));
  }

  /* ------------------------------ export ------------------------------- */

  exportRun(runId: string, options: { format: "json" }): AuditRunExport;
  exportRun(runId: string, options: { format: "markdown" }): string;
  exportRun(
    runId: string,
    options: { format: "json" | "markdown" },
  ): AuditRunExport | string {
    const run = this.getRun(runId);
    if (!run) throw new Error(`exportRun: unknown run id "${runId}"`);
    const events = this.listEvents(runId);
    const artifacts = this.listArtifacts(runId);
    const secrets = this.secrets();

    if (options.format === "json") {
      // Stored data is redacted at write time; redact again at the boundary
      // so exports stay clean even if the secret set grew since.
      return redactObject({ run, events, artifacts }, secrets);
    }
    return redactText(renderMarkdown(run, events, artifacts), secrets);
  }

  close(): void {
    this.db.close();
  }
}

/* ------------------------------------------------------------------------ */
/* Markdown rendering                                                       */
/* ------------------------------------------------------------------------ */

const payloadStr = (e: AuditEventRecord, key: string): string =>
  typeof e.payload[key] === "string" ? (e.payload[key] as string) : "";
function renderMarkdown(
  run: AuditRunRecord,
  events: AuditEventRecord[],
  artifacts: AuditArtifactRecord[],
): string {
  const lines: string[] = [
    `# Run audit: ${run.id}`,
    "",
    `- **Goal:** ${run.goal}`,
    `- **State:** ${run.state}`,
    `- **Started:** ${run.startedAt}`,
    `- **Ended:** ${run.endedAt ?? "—"}`,
    `- **Digest:** \`${run.digest ?? "—"}\``,
    "",
  ];

  /* Route decisions */
  lines.push("## Route decisions", "");
  const routeEvents = events.filter(
    (e) => e.type === "route.decided" || e.type === "route.fallback",
  );
  if (routeEvents.length === 0) lines.push("- (none)");
  for (const e of routeEvents) {
    if (e.type === "route.decided") {
      const d = e.payload.decision as
        | {
            primary?: unknown;
            fallbacks?: unknown;
            estimatedCostUsd?: unknown;
            reason?: unknown;
            pinned?: unknown;
          }
      | undefined;
      const fallbacks = Array.isArray(d?.fallbacks)
        ? (d.fallbacks as unknown[]).map(String).join(", ")
        : "";
      lines.push(
        `- Step \`${payloadStr(e, "stepId")}\`: **${String(d?.primary ?? "?")}**` +
          (fallbacks ? ` (fallbacks: ${fallbacks})` : "") +
          (typeof d?.estimatedCostUsd === "number"
            ? ` — est $${d.estimatedCostUsd.toFixed(4)}`
            : "") +
          (d?.pinned === true ? " — pinned by user" : "") +
          (typeof d?.reason === "string" ? `\n  - ${d.reason}` : ""),
      );
    } else {
      lines.push(
        `- Step \`${payloadStr(e, "stepId")}\`: fell back from **${payloadStr(e, "from")}** to **${payloadStr(e, "to")}** — ${payloadStr(e, "reason")}`,
      );
    }
  }
  lines.push("");

  /* Policy decisions */
  lines.push("## Policy decisions", "");
  const policyEvents = events.filter((e) => e.type === "policy.decision");
  if (policyEvents.length === 0) lines.push("- (none)");
  for (const e of policyEvents) {
    lines.push(
      `- Step \`${payloadStr(e, "stepId")}\`: \`${payloadStr(e, "tool")}\` → **${payloadStr(e, "decision")}** — ${payloadStr(e, "reason")}`,
    );
  }
  lines.push("");

  /* Approvals */
  lines.push("## Approvals", "");
  const approvalEvents = events.filter((e) => e.type.startsWith("approval."));
  if (approvalEvents.length === 0) lines.push("- (none)");
  for (const e of approvalEvents) {
    const step = payloadStr(e, "stepId");
    if (e.type === "approval.requested") {
      lines.push(
        `- Step \`${step}\`: approval requested for \`${payloadStr(e, "tool")}\` — ${payloadStr(e, "reason")}`,
      );
    } else if (e.type === "approval.granted") {
      lines.push(`- Step \`${step}\`: **granted**`);
    } else {
      lines.push(`- Step \`${step}\`: **denied** — ${payloadStr(e, "reason")}`);
    }
  }
  lines.push("");

  /* Tool runs */
  lines.push("## Tool runs", "");
  const startedByJob = new Map<string, AuditEventRecord>();
  const digestByJob = new Map<string, AuditEventRecord>();
  for (const e of events) {
    if (e.type === "tool.started") startedByJob.set(payloadStr(e, "jobId"), e);
    if (e.type === "tool.output_digest") digestByJob.set(payloadStr(e, "jobId"), e);
  }
  const finished = events.filter((e) => e.type === "tool.finished");
  if (finished.length === 0) lines.push("- (none)");
  for (const e of finished) {
    const jobId = payloadStr(e, "jobId");
    const started = startedByJob.get(jobId);
    const digest = digestByJob.get(jobId);
    const command = started
      ? `\`${[payloadStr(started, "executable"), ...((started.payload.args as string[]) ?? [])].join(" ")}\` (cwd \`${payloadStr(started, "cwd")}\`)`
      : `\`${payloadStr(e, "tool")}\``;
    const outcome =
      e.payload.errorMessage !== undefined
        ? `error: ${String(e.payload.errorMessage)}`
        : e.payload.timedOut === true
          ? "timed out"
          : e.payload.cancelled === true
            ? "cancelled"
            : `exit ${String(e.payload.code)}`;
    lines.push(
      `- Step \`${payloadStr(e, "stepId")}\`: ${command} — ${outcome} in ${String(e.payload.durationMs)} ms` +
        (digest
          ? `; output sha256 \`${payloadStr(digest, "sha256")}\` (${String(digest.payload.bytes)} bytes${digest.payload.truncated === true ? ", truncated" : ""})`
          : ""),
    );
  }
  lines.push("");

  /* Artifacts */
  lines.push("## Artifacts", "");
  if (artifacts.length === 0) lines.push("- (none)");
  for (const a of artifacts) {
    lines.push(
      `- \`${a.kind}\` ${a.relativePath} — sha256 \`${a.sha256}\`, ${a.bytes} bytes`,
    );
  }
  lines.push("");

  return lines.join("\n");
}
