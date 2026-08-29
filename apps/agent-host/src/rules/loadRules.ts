/**
 * Rules packs (Task 11).
 *
 * Rules are Markdown files with YAML front matter (`id`, `priority`,
 * `appliesTo`, `enabled`) loaded from three tiers:
 *
 *   run      — in-memory packs passed for a single run (highest precedence)
 *   project  — `<projectDir>/*.md` (typically `<workspace>/.nanoforge/rules`)
 *   global   — `<globalDir>/*.md`  (typically `<home>/.nanoforge/rules`)
 *
 * SECURITY CONTRACT: rules are an ADVISORY context layer. They are composed
 * into the model prompt and recorded via `contextDigest`, but they never
 * grant capabilities. A rule cannot authorize a tool call, widen a policy
 * decision, or bypass an approval gate — only the policy engine and explicit
 * user approvals do that.
 *
 * Deterministic composition:
 *   1. tier precedence run > project > global (same `id` in a lower tier is
 *      overridden and dropped)
 *   2. numeric priority, higher first
 *   3. `id`, ascending (stable tie-break)
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import micromatch from "micromatch";
import { z } from "zod";

export type RuleTier = "run" | "project" | "global";

/** YAML front matter contract for a rules pack file. */
export const ruleFrontMatterSchema = z.object({
  id: z.string().min(1),
  priority: z.number().int(),
  appliesTo: z.array(z.string().min(1)).default([]),
  enabled: z.boolean().default(true),
});

export type RuleFrontMatter = z.infer<typeof ruleFrontMatterSchema>;

/** In-memory run-tier pack. `body` is the Markdown rule text. */
export interface RulePackInput {
  id: string;
  body: string;
  priority?: number;
  appliesTo?: string[];
  enabled?: boolean;
}

export interface LoadedRule {
  id: string;
  /** Higher priority sorts earlier within a tier. */
  priority: number;
  /** Glob list (micromatch). Empty means "applies to every scope". */
  appliesTo: string[];
  /** Disabled rules are excluded from the composed set, so this is always true here. */
  enabled: true;
  tier: RuleTier;
  /** Markdown body of the pack (front matter stripped). */
  body: string;
}

export interface RuleLoadError {
  /** Absolute file path of the offending pack, or `run:<id>` for in-memory packs. */
  file: string;
  kind: "read" | "parse" | "validation";
  /** Human-readable reason. Never contains secret material. */
  message: string;
}

export interface LoadRulesOptions {
  globalDir: string;
  projectDir: string;
  runRules?: RulePackInput[];
}

export interface LoadRulesResult {
  /** Composed rules in deterministic order: run > project > global, priority desc, id asc. */
  rules: LoadedRule[];
  /** Rule id -> source file path (`run:<id>` for run-tier packs). One entry per composed rule. */
  sources: Record<string, string>;
  /** sha256 (hex) of the composed rule bodies, in final order. Changes when any body changes. */
  contextDigest: string;
  /** Structured per-file problems. A malformed pack never aborts the other packs. */
  errors: RuleLoadError[];
}

const TIER_RANK: Record<RuleTier, number> = { run: 0, project: 1, global: 2 };

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? text;
}

function validationMessage(issues: z.core.$ZodIssue[]): string {
  const detail = issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return `invalid rules front matter: ${detail}`;
}

/** Parse one Markdown pack file. Returns the rule, or a structured error naming the file. */
export function parseRuleFile(
  filePath: string,
  raw: string,
  tier: Exclude<RuleTier, "run">,
): { rule?: LoadedRule; error?: RuleLoadError } {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    return {
      error: {
        file: filePath,
        kind: "parse",
        message: `malformed YAML front matter: ${firstLine(err instanceof Error ? err.message : String(err))}`,
      },
    };
  }
  const checked = ruleFrontMatterSchema.safeParse(parsed.data);
  if (!checked.success) {
    return {
      error: { file: filePath, kind: "validation", message: validationMessage(checked.error.issues) },
    };
  }
  if (!checked.data.enabled) {
    return {}; // disabled packs are excluded entirely (not in rules, not in sources)
  }
  return {
    rule: {
      id: checked.data.id,
      priority: checked.data.priority,
      appliesTo: checked.data.appliesTo,
      enabled: true,
      tier,
      body: parsed.content.trim(),
    },
  };
}

interface TierEntry {
  rule: LoadedRule;
  filePath: string;
}

async function loadTier(
  dir: string,
  tier: Exclude<RuleTier, "run">,
  errors: RuleLoadError[],
): Promise<TierEntry[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return []; // a missing tier directory is fine
    errors.push({ file: dir, kind: "read", message: `cannot read rules directory: ${firstLine(String(err))}` });
    return [];
  }
  const out: TierEntry[] = [];
  for (const entry of entries.sort()) {
    if (!entry.toLowerCase().endsWith(".md")) continue;
    const filePath = path.join(dir, entry);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (err) {
      errors.push({ file: filePath, kind: "read", message: firstLine(String(err)) });
      continue;
    }
    const { rule, error } = parseRuleFile(filePath, raw, tier);
    if (error) errors.push(error);
    if (rule) out.push({ rule, filePath });
  }
  return out;
}

function normalizeRunPack(pack: RulePackInput, errors: RuleLoadError[]): LoadedRule | null {
  const checked = ruleFrontMatterSchema.safeParse({
    id: pack.id,
    priority: pack.priority ?? 0,
    appliesTo: pack.appliesTo ?? [],
    enabled: pack.enabled ?? true,
  });
  const source = `run:${pack.id}`;
  if (!checked.success) {
    errors.push({ file: source, kind: "validation", message: validationMessage(checked.error.issues) });
    return null;
  }
  if (!checked.data.enabled) return null;
  return {
    id: checked.data.id,
    priority: checked.data.priority,
    appliesTo: checked.data.appliesTo,
    enabled: true,
    tier: "run",
    body: pack.body.trim(),
  };
}

/** sha256 hex of the composed rule bodies in final order. */
export function computeContextDigest(rules: readonly LoadedRule[]): string {
  const hash = createHash("sha256");
  for (const rule of rules) {
    hash.update(rule.id);
    hash.update("\0");
    hash.update(rule.body);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Load and compose rules from the three tiers. Missing directories yield an
 * empty tier, not an error. Malformed files are reported in `errors` and
 * skipped; they never abort the remaining packs.
 */
export async function loadRules(options: LoadRulesOptions): Promise<LoadRulesResult> {
  const errors: RuleLoadError[] = [];
  const byId = new Map<string, LoadedRule>();
  const sources = new Map<string, string>();

  // Lowest precedence first so higher tiers override by id.
  const tiers: Array<{ tier: Exclude<RuleTier, "run">; dir: string }> = [
    { tier: "global", dir: options.globalDir },
    { tier: "project", dir: options.projectDir },
  ];
  for (const { tier, dir } of tiers) {
    for (const { rule, filePath } of await loadTier(dir, tier, errors)) {
      byId.set(rule.id, rule);
      sources.set(rule.id, filePath);
    }
  }
  for (const pack of options.runRules ?? []) {
    const rule = normalizeRunPack(pack, errors);
    if (rule) {
      byId.set(rule.id, rule);
      sources.set(rule.id, `run:${rule.id}`);
    }
  }

  const rules = [...byId.values()].sort(
    (a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      b.priority - a.priority ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const orderedSources: Record<string, string> = {};
  for (const rule of rules) orderedSources[rule.id] = sources.get(rule.id)!;

  return { rules, sources: orderedSources, contextDigest: computeContextDigest(rules), errors };
}

/** Normalize Windows path separators so globs behave the same on every OS. */
export function normalizeTargetPath(targetPath: string): string {
  return targetPath.replace(/\\/g, "/");
}

/** True when a rule applies to the given file path / scope. Empty appliesTo = every scope. */
export function ruleAppliesTo(rule: Pick<LoadedRule, "appliesTo">, targetPath: string): boolean {
  if (rule.appliesTo.length === 0) return true;
  return micromatch.isMatch(normalizeTargetPath(targetPath), rule.appliesTo, { dot: true });
}

/** The subset of composed rules applying to a file path / scope. */
export function rulesForPath(result: Pick<LoadRulesResult, "rules">, targetPath: string): LoadedRule[] {
  return result.rules.filter((rule) => ruleAppliesTo(rule, targetPath));
}
