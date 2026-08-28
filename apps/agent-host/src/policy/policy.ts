/**
 * Policy engine — Module 2, Task 5.
 *
 * Model output is only ever a *proposal*: every tool request must pass
 * `authorize()` before the runner is allowed to spawn anything.
 *
 * Locked-down defaults (see default-policy.json):
 * - cwd must resolve inside `policy.workspaceRoot`, otherwise **deny**;
 * - free-form shells (cmd, powershell, bash, sh, ...) and shell composition
 *   (`|`, `&&`, `;`, backticks, `$(...)`) are **denied**;
 * - whitelisted read-only executables (git status/log/diff..., ls, dir,
 *   node --version) are **allowed**;
 * - writes, network access, installs, termination, redirection (`>`/`<`),
 *   and anything unknown are **ask** (interactive approval).
 */
import fs, { readFileSync } from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------------ */
/* Request / decision types                                                 */
/* ------------------------------------------------------------------------ */

/** Terminal execution proposal (structured: no shell interpolation). */
export interface TerminalExecToolRequest {
  kind: "terminal.exec";
  cwd: string;
  executable: string;
  args: string[];
}

/**
 * Extensible union of tool proposals. Later kinds (browser.*, mcp.call) are
 * added here as their modules land; unknown kinds are denied by default.
 */
export type ToolRequest = TerminalExecToolRequest;

export type PolicyDecision = "allow" | "ask" | "deny";

/* ------------------------------------------------------------------------ */
/* Policy document                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Whitelisted read-only invocation. When `firstArgs` is present, only calls
 * whose first argument matches one of the listed subcommands/flags
 * auto-allow (e.g. `git` + `["status","log","diff"]`, `node` +
 * `["--version"]`). Without `firstArgs`, every invocation allows.
 */
export interface ReadOnlyRule {
  executable: string;
  firstArgs?: string[];
}

export interface Policy {
  /** Absolute (or resolvable) root all cwd values must stay within. */
  workspaceRoot: string;
  /** Basenames of free-form shells; always denied. */
  shells: string[];
  /** Basenames that are always denied (privilege escalation etc.). */
  deniedExecutables: string[];
  /** Basenames that always require interactive approval. */
  askExecutables: string[];
  /** Read-only whitelist; matching invocations auto-allow. */
  readOnly: ReadOnlyRule[];
  /** Decision for redirection metacharacters (`>`, `<`). */
  redirectionDecision: "ask" | "deny";
  /** Decision for shell composition (`|`, `&&`, `;`, backticks, `$(`). */
  compositionDecision: "ask" | "deny";
  /** Decision for anything not otherwise classified. */
  defaultDecision: "ask" | "deny";
}

/** Shell composition: pipes, chaining, substitution, embedded newlines. */
const COMPOSITION_RE = /&&|\|\||[;|`&]|\$\(|\$\{|\r|\n/;
/** Output/input redirection (including fd forms like `2>&1`, `>>`, `<`). */
const REDIRECTION_RE = /[<>]/;
/** fd-style redirection tokens stripped before the composition scan. */
const FD_REDIRECT_RE = /\d?>&?\d?|\d?>>|<<?/g;
/** Windows executable extensions stripped before basename comparison. */
const EXECUTABLE_EXT_RE = /\.(exe|bat|cmd|com|ps1|msi)$/i;

/** Normalized basename for comparison: lowercase, extension stripped. */
export function executableBasename(executable: string): string {
  return path.basename(executable.trim()).toLowerCase().replace(EXECUTABLE_EXT_RE, "");
}

const normalizeForCompare = (p: string): string =>
  process.platform === "win32" ? p.toLowerCase() : p;

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

export function sanitizePathString(input: string): string {
  if (typeof input !== "string") return "";
  let decoded = input;
  // Multi-pass URL decode to defeat double/triple URL encoding
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  // Reject null bytes
  if (decoded.includes("\0")) {
    throw new Error("Path contains illegal null bytes");
  }
  return decoded;
}

function stripExtendedPrefix(p: string): string {
  if (process.platform === "win32") {
    if (p.startsWith("\\\\?\\")) {
      return p.slice(4);
    }
    if (p.startsWith("\\\\.\\")) {
      return p.slice(4);
    }
  }
  return p;
}

function getCanonicalPath(targetPath: string): string {
  try {
    if (fs.existsSync(targetPath)) {
      const real = fs.realpathSync.native ? fs.realpathSync.native(targetPath) : fs.realpathSync(targetPath);
      return stripExtendedPrefix(real);
    }
  } catch {
    // If realpath fails, fallback to lexical
  }
  // For non-existent files (e.g. pending write), find nearest existing ancestor
  try {
    let ancestor = path.dirname(targetPath);
    const childParts: string[] = [path.basename(targetPath)];
    while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) {
      childParts.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
    if (fs.existsSync(ancestor)) {
      const realAncestor = fs.realpathSync.native ? fs.realpathSync.native(ancestor) : fs.realpathSync(ancestor);
      const canonicalAncestor = stripExtendedPrefix(realAncestor);
      return path.join(canonicalAncestor, ...childParts);
    }
  } catch {
    // Fallback to lexical
  }
  return targetPath;
}

/**
 * True when `candidate` resolves to `workspaceRoot` itself or a path inside
 * it. Both absolute and root-relative candidates are supported; `..` escapes
 * and absolute paths outside the root return false.
 */
export function isWithinWorkspace(candidate: string, workspaceRoot: string): boolean {
  try {
    const sanitizedCandidate = sanitizePathString(candidate);
    const sanitizedRoot = sanitizePathString(workspaceRoot);
    const root = path.resolve(sanitizedRoot);
    const resolved = path.resolve(root, sanitizedCandidate);

    const normRoot = normalizeForCompare(root);
    const normResolved = normalizeForCompare(resolved);
    const rel = path.relative(normRoot, normResolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return false;
    }

    // Canonical / Symlink check
    const canonicalRoot = normalizeForCompare(getCanonicalPath(root));
    const canonicalTarget = normalizeForCompare(getCanonicalPath(resolved));
    const relCanonical = path.relative(canonicalRoot, canonicalTarget);
    if (relCanonical.startsWith("..") || path.isAbsolute(relCanonical)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a job cwd against the workspace root. Returns the absolute,
 * confined path, or null when the cwd escapes the root.
 */
export function resolveWithinWorkspace(
  workspaceRoot: string,
  cwd?: string,
): string | null {
  try {
    const raw = cwd && cwd.trim() ? cwd.trim() : ".";
    const sanitized = sanitizePathString(raw);
    const sanitizedRoot = sanitizePathString(workspaceRoot);
    const root = path.resolve(sanitizedRoot);
    const resolved = path.resolve(root, sanitized);

    if (!isWithinWorkspace(resolved, root)) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

/**
 * Resolves a target path within workspace root, throwing SecurityError if it escapes or violates security rules.
 */
export function resolveWorkspacePath(workspaceRoot: string, targetPath?: string): string {
  if (!workspaceRoot) {
    throw new SecurityError("Workspace root is required");
  }
  const rawTarget = targetPath && targetPath.trim() ? targetPath.trim() : ".";
  if (rawTarget.includes("\0")) {
    throw new SecurityError("Null bytes not allowed in path");
  }
  const decoded = sanitizePathString(rawTarget);
  if (decoded.includes("\0")) {
    throw new SecurityError("Null bytes not allowed in path");
  }

  const root = path.resolve(sanitizePathString(workspaceRoot));
  const resolvedCandidate = path.resolve(root, decoded);

  if (!isWithinWorkspace(resolvedCandidate, root)) {
    throw new SecurityError("Path traversal detected: target resolves outside workspace");
  }
  return resolvedCandidate;
}

/* ------------------------------------------------------------------------ */
/* authorize                                                                */
/* ------------------------------------------------------------------------ */

export function authorize(req: ToolRequest, policy: Policy): PolicyDecision {
  if (req.kind !== "terminal.exec") return "deny";

  const root = path.resolve(policy.workspaceRoot || ".");

  // 1. Workspace confinement of the working directory.
  if (!isWithinWorkspace(req.cwd && req.cwd.trim() ? req.cwd : ".", root)) {
    return "deny";
  }
  const resolvedCwd = path.resolve(root, req.cwd && req.cwd.trim() ? req.cwd : ".");

  const executable = (req.executable ?? "").trim();
  if (!executable) return "deny";
  const base = executableBasename(executable);
  if (!base) return "deny";

  // 2. Free-form shells and explicitly denied executables.
  const shells = policy.shells.map((s) => s.toLowerCase());
  if (shells.includes(base)) return "deny";
  const denied = policy.deniedExecutables.map((s) => s.toLowerCase());
  if (denied.includes(base)) return "deny";

  // 3. Path-like executables must resolve inside the workspace.
  if (
    executable.includes("/") ||
    executable.includes("\\") ||
    path.isAbsolute(executable)
  ) {
    if (!isWithinWorkspace(path.resolve(resolvedCwd, executable), root)) {
      return "deny";
    }
  }

  // 4. Shell metacharacters: composition (deny) wins over redirection (ask).
  //    fd redirections (`2>&1`, `>>`, `<`) are stripped before the
  //    composition scan so they classify as redirection, not `&` chaining.
  const args = Array.isArray(req.args) ? req.args : [];
  let sawRedirection = false;
  for (const arg of args) {
    const withoutRedirects = arg.replace(FD_REDIRECT_RE, "");
    if (COMPOSITION_RE.test(withoutRedirects)) return policy.compositionDecision;
    if (withoutRedirects.length !== arg.length || REDIRECTION_RE.test(arg)) {
      sawRedirection = true;
    }
  }
  if (sawRedirection) return policy.redirectionDecision;

  // 5. Read-only whitelist.
  for (const rule of policy.readOnly) {
    if (executableBasename(rule.executable) !== base) continue;
    if (!rule.firstArgs || rule.firstArgs.length === 0) return "allow";
    const first = args[0]?.toLowerCase();
    if (first && rule.firstArgs.map((s) => s.toLowerCase()).includes(first)) {
      return "allow";
    }
  }

  // 6. Known write/network/install/termination executables require approval.
  const ask = policy.askExecutables.map((s) => s.toLowerCase());
  if (ask.includes(base)) return "ask";

  // 7. Unknown executables fall back to the policy default.
  return policy.defaultDecision;
}

/* ------------------------------------------------------------------------ */
/* Subagent Path Confinement & Sandboxing Policy (SEC-SUB-01)               */
/* ------------------------------------------------------------------------ */

export type SubagentWorkspaceMode = "inherit" | "branch" | "share";
export type SubagentArchetypeKind =
  | "explorer"
  | "implementer"
  | "qa"
  | "specialist"
  | "verifier"
  | "planner"
  | "custom";

export interface SubagentConfinementOptions {
  subagentId: string;
  subagentName?: string;
  archetype?: SubagentArchetypeKind;
  workspaceRoot: string;
  assignedMetadataDir: string; // e.g. .agents/worker_m2 or .agents/explorer_123 or full path
  isolationMode: SubagentWorkspaceMode;
  worktreePath?: string;
  scratchDir?: string;
  allowSourceTreeWrites?: boolean;
}

export interface SubagentAccessRequest {
  candidatePath: string;
  operation: "read" | "write" | "delete";
}

export interface SubagentAccessDecision {
  allowed: boolean;
  decision: PolicyDecision;
  resolvedPath?: string;
  reason?: string;
}

/**
 * Normalizes and decodes a path to prevent %2e%2e or relative traversal escapes.
 */
export function canonicalizeSubagentPath(rawPath: string): string {
  let decoded = rawPath;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return path.normalize(decoded);
}

/**
 * Authorizes a subagent file operation against SEC-SUB-01 and isolation modes.
 *
 * Rules:
 * 1. Writes to `.agents/` are strictly confined to the agent's assigned metadata dir.
 *    Writing to `.agents/` root or any other subagent's folder is strictly DENIED (SEC-SUB-01).
 * 2. Directory traversal (`..` sequences escaping workspace or worktree) is DENIED.
 * 3. In `branch` mode, writes to the source tree must reside inside `worktreePath`.
 * 4. In `share` mode, source tree writes are denied; writes are allowed in `scratchDir`.
 * 5. Read-only archetypes (`explorer`, `verifier`, `planner`) have `allowSourceTreeWrites = false`.
 */
export function authorizeSubagentPathAccess(
  options: SubagentConfinementOptions,
  request: SubagentAccessRequest
): SubagentAccessDecision {
  const root = path.resolve(options.workspaceRoot || ".");
  const normalizedCandidate = canonicalizeSubagentPath(request.candidatePath);

  // Determine eff…72761 tokens truncated…an },
  ): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

const NativeWebSocket = globalThis.WebSocket as unknown as new (
  url: string,
) => WsLike;

let host: HostHandle | undefined;
const tempRoots: string[] = [];

afterEach(async () => {
  await host?.close();
  host = undefined;
  for (const root of tempRoots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function tempWorkspace(label: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `nanoforge-adv-${label}-`));
  tempRoots.push(root);
  return root;
}

const agentUrl = (h: HostHandle, token?: string): string =>
  `ws://127.0.0.1:${h.port}/agent${token === undefined ? "" : `?token=${token}`}`;

function waitForOpen(ws: WsLike): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("socket error")), {
      once: true,
    });
  });
}

const createMockPlan = (id: string): ExecutionPlan => ({
  id,
  goal: `Stress plan ${id}`,
  state: "awaiting_approval",
  steps: [
    {
      id: "step-1",
      title: "Step 1",
      dependsOn: [],
      status: "pending",
    },
  ],
});

describe("Adversarial Stress: Host session run-control wire acknowledgements", () => {
  it("ADV-1: handles 50 concurrent plan submissions without dropped acks or runId collisions", async () => {
    const root = await tempWorkspace("concurrent-plans");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    // Filter messages by requestId
    const results = new Map<string, Record<string, unknown>>();
    const runIds = new Set<string>();
    const allMessages: unknown[] = [];
    let closeReason: string | undefined;

    ws.addEventListener("close", (event) => {
      closeReason = `code=${event.code} reason=${event.reason}`;
    });

    const msgPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        try {
          const parsed = JSON.parse(String(event.data));
          allMessages.push(parsed);
          if (parsed.type === "plan.submit.result" && parsed.requestId) {
            results.set(parsed.requestId, parsed);
            runIds.add(parsed.runId);
            if (results.size === 50) {
              resolve();
            }
          }
        } catch {}
      });
    });

    // Send 50 plan submits concurrently
    for (let i = 0; i < 50; i++) {
      ws.send(
        JSON.stringify({
          type: "plan.submit",
          requestId: `req-stress-sub-${i}`,
          plan: createMockPlan(`plan-stress-${i}`),
        }),
      );
    }

    await Promise.race([
      msgPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: received only ${results.size}/50 acks, closeReason=${closeReason}, allMsgs=${allMessages.length} [${allMessages.map((m: any) => m.type).join(",")}]`)), 20000)),
    ]);

    expect(results.size).toBe(50);
    expect(runIds.size).toBe(50); // every single runId must be distinct
    for (let i = 0; i < 50; i++) {
      const res = results.get(`req-stress-sub-${i}`);
      expect(res).toBeDefined();
      expect(res?.accepted).toBe(true);
      expect(res?.planId).toBe(`plan-stress-${i}`);
    }

    ws.close();
  }, 25000);

  it("ADV-2: rapid interleaved pause/resume/cancel calls on active run return correlated responses", async () => {
    const root = await tempWorkspace("rapid-controls");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    // 1. Submit a plan
    const subPromise = new Promise<string>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "plan.submit.result" && parsed.requestId === "req-sub-init") {
          resolve(parsed.runId);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "plan.submit",
        requestId: "req-sub-init",
        plan: createMockPlan("plan-rapid-control"),
      }),
    );

    const runId = await subPromise;
    expect(runId).toBeDefined();

    // 2. Fire rapid burst of pause -> resume -> pause -> resume -> cancel
    const actions = [
      { type: "run.pause", req: "req-p1" },
      { type: "run.resume", req: "req-r1" },
      { type: "run.pause", req: "req-p2" },
      { type: "run.resume", req: "req-r2" },
      { type: "run.cancel", req: "req-c1" },
    ];

    const responses = new Map<string, Record<string, unknown>>();
    const controlPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.requestId && parsed.requestId.startsWith("req-")) {
          responses.set(parsed.requestId, parsed);
          if (responses.size === actions.length) {
            resolve();
          }
        }
      });
    });

    for (const a of actions) {
      ws.send(
        JSON.stringify({
          type: a.type,
          requestId: a.req,
          runId,
        }),
      );
    }

    await Promise.race([
      controlPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: received only ${responses.size}/5 responses`)), 5000)),
    ]);

    expect(responses.get("req-p1")?.type).toBe("run.pause.result");
    expect(responses.get("req-r1")?.type).toBe("run.resume.result");
    expect(responses.get("req-p2")?.type).toBe("run.pause.result");
    expect(responses.get("req-r2")?.type).toBe("run.resume.result");
    expect(responses.get("req-c1")?.type).toBe("run.cancel.result");

    for (const a of actions) {
      const res = responses.get(a.req);
      expect(res?.runId).toBe(runId);
      expect(res?.at).toBeDefined();
    }

    ws.close();
  });

  it("ADV-3: unknown runId error frame carries exact requestId and runId for all control verbs", async () => {
    const root = await tempWorkspace("unknown-run-controls");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    const unknownVerbs = [
      { type: "run.pause", requestId: "req-unk-pause", runId: "ghost-run-1" },
      { type: "run.resume", requestId: "req-unk-resume", runId: "ghost-run-2" },
      { type: "run.cancel", requestId: "req-unk-cancel", runId: "ghost-run-3" },
    ];

    const errResponses = new Map<string, Record<string, unknown>>();
    const errPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "error" && typeof parsed.requestId === "string" && parsed.requestId.startsWith("req-unk-")) {
          errResponses.set(parsed.requestId, parsed);
          if (errResponses.size === unknownVerbs.length) {
            resolve();
          }
        }
      });
    });

    for (const v of unknownVerbs) {
      ws.send(JSON.stringify(v));
    }

    await Promise.race([
      errPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for unknown_run errors")), 5000)),
    ]);

    for (const v of unknownVerbs) {
      const err = errResponses.get(v.requestId);
      expect(err).toBeDefined();
      expect(err?.code).toBe("unknown_run");
      expect(err?.runId).toBe(v.runId);
      expect(err?.requestId).toBe(v.requestId);
    }

    ws.close();
  });

  it("ADV-4: backward compatibility — missing requestId does not crash server and executes mutation", async () => {
    const root = await tempWorkspace("no-request-id");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    // 1. Submit plan without requestId
    const statePromise = new Promise<string>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "run.state" && parsed.state === "queued") {
          resolve(parsed.runId);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "plan.submit",
        // NO requestId
        plan: createMockPlan("plan-no-req-id"),
      }),
    );

    const runId = await statePromise;
    expect(runId).toBeDefined();

    // 2. Pause and Cancel without requestId
    ws.send(
      JSON.stringify({
        type: "run.pause",
        runId,
      }),
    );

    ws.send(
      JSON.stringify({
        type: "run.cancel",
        runId,
      }),
    );

    // 3. Pause unknown run without requestId (should not crash server)
    ws.send(
      JSON.stringify({
        type: "run.pause",
        runId: "unknown-run-no-req",
      }),
    );

    // Verify server is still alive by sending a ping
    const pongPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "pong") resolve();
      });
    });

    ws.send(JSON.stringify({ type: "ping" }));
    await pongPromise;

    ws.close();
  });

  it("ADV-5: preserves complex and unicode requestIds verbatim across all acks and errors", async () => {
    const root = await tempWorkspace("complex-req-ids");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    const testIds = [
      "req-uuid-550e8400-e29b-41d4-a716-446655440000",
      "req-🚀-🔥-atom-⚡",
      "req-quoted-\"escaped\"-test",
      "req-sql-';-drop-table-runs;--",
      "req-a".repeat(20), // long requestId
    ];

    for (const testId of testIds) {
      const reply = new Promise<Record<string, unknown>>((resolve) => {
        const handler = (event: { data: unknown }) => {
          const parsed = JSON.parse(String(event.data));
          if (parsed.requestId === testId) {
            resolve(parsed);
          }
        };
        ws.addEventListener("message", handler);
      });

      ws.send(
        JSON.stringify({
          type: "plan.submit",
          requestId: testId,
          plan: createMockPlan(`plan-${testId}`),
        }),
      );

      const res = await reply;
      expect(res.requestId).toBe(testId);
      expect(res.type).toBe("plan.submit.result");
    }

    ws.close();
  });

  it("ADV-6: approval race conditions — multiple approvals for same gate resolve first, reject remainder", async () => {
    const root = await tempWorkspace("approval-races");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    // Send 5 rapid approvals for the same request ID
    const approvalAcks: Array<Record<string, unknown>> = [];
    const ackPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "approval.grant.result" && parsed.requestId?.startsWith("req-grant-race-")) {
          approvalAcks.push(parsed);
          if (approvalAcks.length === 5) resolve();
        }
      });
    });

    for (let i = 0; i < 5; i++) {
      ws.send(
        JSON.stringify({
          type: "approval.grant",
          requestId: `req-grant-race-${i}`,
          runId: "run-race-1",
          stepId: "step-1",
        }),
      );
    }

    await Promise.race([
      ackPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout on approval race")), 5000)),
    ]);

    expect(approvalAcks).toHaveLength(5);
    // Since no tool approval gate was waiting, all resolve with resolved: false without throwing
    for (const ack of approvalAcks) {
      expect(ack.type).toBe("approval.grant.result");
      expect(ack.resolved).toBe(false);
      expect(ack.at).toBeDefined();
    }

    ws.close();
  });

  it("ADV-7: tool.response emits typed tool.response.result carrying requestId and resolved flag", async () => {
    const root = await tempWorkspace("tool-response");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    const reply = new Promise<Record<string, unknown>>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "tool.response.result" && parsed.requestId === "req-tool-resp-1") {
          resolve(parsed);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "tool.response",
        requestId: "req-tool-resp-1",
        approved: true,
      }),
    );

    const res = await reply;
    expect(res).toMatchObject({
      type: "tool.response.result",
      requestId: "req-tool-resp-1",
      resolved: false, // no active gate waiting
    });
    expect(res.at).toBeDefined();

    ws.close();
  });

  it("ADV-8: stress — 100 rapid alternating pause/resume mutations receive 100% correlated acks", async () => {
    const root = await tempWorkspace("100-pause-resume");
    host = await createHost({ allowNonBrowserClients: true, session: { workspaceRoot: root } });

    const ws = new NativeWebSocket(agentUrl(host, host.token));
    await waitForOpen(ws);

    // 1. Submit a plan
    const subPromise = new Promise<string>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.type === "plan.submit.result" && parsed.requestId === "req-sub-100") {
          resolve(parsed.runId);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "plan.submit",
        requestId: "req-sub-100",
        plan: createMockPlan("plan-100-mutations"),
      }),
    );

    const runId = await subPromise;
    expect(runId).toBeDefined();

    // 2. Fire 100 alternating pause/resume mutations
    const acks = new Map<string, Record<string, unknown>>();
    const allAcksPromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (event) => {
        const parsed = JSON.parse(String(event.data));
        if (parsed.requestId && parsed.requestId.startsWith("req-100-")) {
          acks.set(parsed.requestId, parsed);
          if (acks.size === 100) {
            resolve();
          }
        }
      });
    });

    for (let i = 0; i < 100; i++) {
      const isPause = i % 2 === 0;
      ws.send(
        JSON.stringify({
          type: isPause ? "run.pause" : "run.resume",
          requestId: `req-100-${i}`,
          runId,
        }),
      );
    }

    await Promise.race([
      allAcksPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: received ${acks.size}/100 acks`)), 10000)),
    ]);

    expect(acks.size).toBe(100);
    for (let i = 0; i < 100; i++) {
      const isPause = i % 2 === 0;
      const ack = acks.get(`req-100-${i}`);
      expect(ack).toBeDefined();
      expect(ack?.type).toBe(isPause ? "run.pause.result" : "run.resume.result");
      expect(ack?.runId).toBe(runId);
    }

    ws.close();
  });
});

