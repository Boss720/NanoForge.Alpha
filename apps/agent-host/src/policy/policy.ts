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

  // Determine effective workspace root based on isolation mode
  const worktreeAbs = options.worktreePath ? path.resolve(root, options.worktreePath) : undefined;
  const scratchAbs = options.scratchDir ? path.resolve(root, options.scratchDir) : undefined;

  let effectiveRoot = root;
  if (options.isolationMode === "branch" && worktreeAbs) {
    effectiveRoot = worktreeAbs;
  }

  // Resolve absolute path: if candidate is relative and references .agents or worktree/scratch from root, resolve from root
  let resolvedTarget: string;
  if (path.isAbsolute(normalizedCandidate)) {
    resolvedTarget = path.resolve(normalizedCandidate);
  } else if (
    normalizedCandidate.startsWith(".agents") ||
    (options.worktreePath && normalizedCandidate.startsWith(options.worktreePath)) ||
    (options.scratchDir && normalizedCandidate.startsWith(options.scratchDir))
  ) {
    resolvedTarget = path.resolve(root, normalizedCandidate);
  } else {
    resolvedTarget = path.resolve(effectiveRoot, normalizedCandidate);
  }

  // 1. Check traversal out of workspace root
  // The path must reside inside workspaceRoot, worktreePath, or scratchDir
  const insideRoot = isWithinWorkspace(resolvedTarget, root);
  const insideWorktree = worktreeAbs ? isWithinWorkspace(resolvedTarget, worktreeAbs) : false;
  const insideScratch = scratchAbs ? isWithinWorkspace(resolvedTarget, scratchAbs) : false;

  if (!insideRoot && !insideWorktree && !insideScratch) {
    return {
      allowed: false,
      decision: "deny",
      reason: `Path traversal violation: "${request.candidatePath}" resolves outside allowed workspace boundaries.`,
    };
  }

  // 2. Check `.agents/` metadata confinement (SEC-SUB-01)
  const agentsRoot = path.resolve(root, ".agents");
  const isInsideAgents = isWithinWorkspace(resolvedTarget, agentsRoot);
  const isWorkspaceOverlay = insideWorktree || insideScratch;

  // Metadata isolation applies to .agents/ paths that are NOT the agent's worktree or scratch space
  if (isInsideAgents && !isWorkspaceOverlay) {
    // Resolve assigned metadata directory
    const assignedDir = path.isAbsolute(options.assignedMetadataDir)
      ? path.resolve(options.assignedMetadataDir)
      : path.resolve(root, options.assignedMetadataDir);

    if (request.operation === "write" || request.operation === "delete") {
      const isInsideOwnFolder = isWithinWorkspace(resolvedTarget, assignedDir);
      // Writing directly to .agents root or another subagent folder is prohibited
      if (!isInsideOwnFolder || normalizeForCompare(resolvedTarget) === normalizeForCompare(agentsRoot)) {
        return {
          allowed: false,
          decision: "deny",
          reason: `SEC-SUB-01 Violation: Subagent "${options.subagentId}" cannot write outside its assigned directory "${options.assignedMetadataDir}".`,
        };
      }
    }
    // Read operations inside .agents are allowed (shared metadata convention)
    return {
      allowed: true,
      decision: "allow",
      resolvedPath: resolvedTarget,
    };
  }

  // 3. For operations outside `.agents/` metadata (i.e. source tree, worktree, or scratch):
  if (request.operation === "write" || request.operation === "delete") {
    // Check isolation mode write permissions first
    if (options.isolationMode === "share") {
      // In share mode, source root is read-only. Writes only allowed in scratchDir
      if (!insideScratch) {
        return {
          allowed: false,
          decision: "deny",
          reason: `Share isolation mode: writes to repository source tree are denied. Use scratch directory.`,
        };
      }
    } else if (options.isolationMode === "branch") {
      // In branch mode, writes must be confined to worktreePath
      if (!insideWorktree) {
        return {
          allowed: false,
          decision: "deny",
          reason: `Branch isolation mode: writes outside worktree "${options.worktreePath}" are denied.`,
        };
      }
    }

    // Check archetype read-only restriction
    const isReadOnlyArchetype =
      options.archetype === "explorer" ||
      options.archetype === "verifier" ||
      options.archetype === "planner";
    if (isReadOnlyArchetype || options.allowSourceTreeWrites === false) {
      // In share mode, writing to scratch directory is still allowed for read-only agents
      if (options.isolationMode === "share" && insideScratch) {
        return {
          allowed: true,
          decision: "allow",
          resolvedPath: resolvedTarget,
        };
      }
      return {
        allowed: false,
        decision: "deny",
        reason: `Archetype "${options.archetype || 'read-only'}" (read-only archetype) is not permitted to mutate source tree files.`,
      };
    }
  }

  return {
    allowed: true,
    decision: "allow",
    resolvedPath: resolvedTarget,
  };
}


/* ------------------------------------------------------------------------ */
/* Loading                                                                  */
/* ------------------------------------------------------------------------ */

const DEFAULT_POLICY_URL = new URL("./default-policy.json", import.meta.url);

type RawPolicy = Partial<Omit<Policy, "workspaceRoot">> & { workspaceRoot?: string };

/**
 * Load the locked-down default policy (default-policy.json), optionally
 * pinning `workspaceRoot`. Unknown JSON fields are ignored; missing sections
 * fall back to deny-by-default values.
 */
export function loadPolicy(workspaceRoot?: string): Policy {
  const raw = JSON.parse(readFileSync(DEFAULT_POLICY_URL, "utf8")) as RawPolicy;
  return {
    workspaceRoot: workspaceRoot ?? raw.workspaceRoot ?? ".",
    shells: raw.shells ?? [],
    deniedExecutables: raw.deniedExecutables ?? [],
    askExecutables: raw.askExecutables ?? [],
    readOnly: raw.readOnly ?? [],
    redirectionDecision: raw.redirectionDecision ?? "ask",
    compositionDecision: raw.compositionDecision ?? "deny",
    defaultDecision: raw.defaultDecision ?? "ask",
  };
}

/** Default policy with an unpinned (".") workspace root. */
export const DEFAULT_POLICY: Policy = loadPolicy();

