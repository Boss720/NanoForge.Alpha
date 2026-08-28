/**
 * Safe skill registry (Task 12).
 *
 * A skill is a directory containing a `SKILL.md` file whose YAML front matter
 * is a narrow manifest: `name`, `description`, `allowedTools`,
 * `instructions`, `contentHash` (sha256 of the instructions body).
 *
 * SECURITY CONTRACT:
 *  - A skill folder NEVER authorizes a script or a tool. `allowedTools` is an
 *    ADVISORY allow-list only: at run time it is intersected with the host
 *    policy, and every tool call still needs a policy decision (and, where
 *    the policy requires, explicit user approval).
 *  - `contentHash` binds the manifest to its instructions. A mismatch means
 *    the instructions changed after the manifest was written, so the skill is
 *    QUARANTINED: listed as invalid with the reason, and impossible to enable.
 *  - Enabling is a user decision. `enableSkill` returns the expanded
 *    instructions text which MUST be displayed to the user before enabling;
 *    the display and the actual enable toggle live in the UI (another module).
 *    This registry never flips an enabled flag by itself.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";

/** Narrow manifest contract for SKILL.md front matter. */
export const skillManifestSchema = z.object({
  /** kebab-case identifier, unique within a skills directory. */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "name must be kebab-case"),
  description: z.string().min(1),
  /**
   * ADVISORY allow-list of tool names the skill asks for. Intersected with
   * host policy at run time; never an authorization by itself.
   */
  allowedTools: z.array(z.string().min(1)).default([]),
  /** The instructions body injected into the model context when enabled. */
  instructions: z.string().min(1),
  /** sha256 hex of the exact `instructions` string. */
  contentHash: z.string().regex(/^[a-f0-9]{64}$/, "contentHash must be a sha256 hex digest"),
});

export type SkillManifest = z.infer<typeof skillManifestSchema>;

export type SkillStatus = "available" | "quarantined";

export interface SkillRecord {
  name: string;
  description: string;
  /** Advisory allow-list — see module docstring. Never an authorization. */
  allowedTools: string[];
  /** Absolute path of the SKILL.md the record was loaded from. */
  sourcePath: string;
  status: SkillStatus;
  /** Present when status is "quarantined": why the skill can never be enabled. */
  quarantineReason?: string;
}

export interface SkillScanError {
  file: string;
  kind: "read" | "parse" | "validation";
  message: string;
}

export interface SkillScanResult {
  /** Well-formed, hash-verified skills. */
  skills: SkillRecord[];
  /** Invalid skills (malformed manifest or hash mismatch), with reasons. Never enableable. */
  quarantined: SkillRecord[];
  /** Directory-level read problems. */
  errors: SkillScanError[];
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? text;
}

/**
 * Parse and verify one SKILL.md. Hash mismatches and malformed manifests both
 * produce a quarantined record (never thrown, never silently dropped).
 */
export function parseSkillFile(
  filePath: string,
  raw: string,
  fallbackName: string,
): { record: SkillRecord; manifest?: SkillManifest } {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    return {
      record: {
        name: fallbackName,
        description: "",
        allowedTools: [],
        sourcePath: filePath,
        status: "quarantined",
        quarantineReason: `malformed YAML front matter: ${firstLine(err instanceof Error ? err.message : String(err))}`,
      },
    };
  }

  const checked = skillManifestSchema.safeParse(parsed.data);
  if (!checked.success) {
    const detail = checked.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    const data = parsed.data as Record<string, unknown>;
    return {
      record: {
        name: typeof data.name === "string" ? data.name : fallbackName,
        description: typeof data.description === "string" ? data.description : "",
        allowedTools: Array.isArray(data.allowedTools)
          ? data.allowedTools.filter((t): t is string => typeof t === "string")
          : [],
        sourcePath: filePath,
        status: "quarantined",
        quarantineReason: `invalid manifest: ${detail}`,
      },
    };
  }

  const manifest = checked.data;
  const actualHash = sha256Hex(manifest.instructions);
  if (actualHash !== manifest.contentHash) {
    return {
      record: {
        name: manifest.name,
        description: manifest.description,
        allowedTools: manifest.allowedTools,
        sourcePath: filePath,
        status: "quarantined",
        quarantineReason:
          "contentHash does not match the instructions body; the instructions were modified after the manifest was written",
      },
      manifest,
    };
  }

  return {
    record: {
      name: manifest.name,
      description: manifest.description,
      allowedTools: manifest.allowedTools,
      sourcePath: filePath,
      status: "available",
    },
    manifest,
  };
}

/**
 * Scan a skills directory: every immediate subdirectory containing a
 * `SKILL.md` is parsed and verified. A missing directory scans as empty.
 * Well-formed and quarantined skills are both returned (separate lists), each
 * sorted by name for deterministic output.
 */
export async function scanSkills(skillsDir: string): Promise<SkillScanResult> {
  const result: SkillScanResult = { skills: [], quarantined: [], errors: [] };
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return result;
    result.errors.push({
      file: skillsDir,
      kind: "read",
      message: `cannot read skills directory: ${firstLine(String(err))}`,
    });
    return result;
  }

  const seen = new Set<string>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(skillsDir, entry.name, "SKILL.md");
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        result.errors.push({ file: filePath, kind: "read", message: firstLine(String(err)) });
      }
      continue; // directories without SKILL.md are not skills
    }
    const { record } = parseSkillFile(filePath, raw, entry.name);
    if (seen.has(record.name)) {
      result.quarantined.push({
        ...record,
        status: "quarantined",
        quarantineReason: `duplicate skill name "${record.name}" in ${skillsDir}`,
      });
      continue;
    }
    seen.add(record.name);
    if (record.status === "available") result.skills.push(record);
    else result.quarantined.push(record);
  }

  result.skills.sort((a, b) => a.name.localeCompare(b.name));
  result.quarantined.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

/**
 * The full text that MUST be shown to the user before a skill is enabled.
 * This is the expanded instructions view: the exact instructions body plus
 * the advisory metadata, so the user reviews everything the skill would
 * inject into the model context.
 */
export function buildExpandedInstructions(manifest: SkillManifest): string {
  const tools =
    manifest.allowedTools.length > 0
      ? manifest.allowedTools.map((tool) => `- ${tool}`).join("\n")
      : "(none declared)";
  return [
    `# Skill: ${manifest.name}`,
    "",
    manifest.description,
    "",
    "## Instructions",
    "",
    manifest.instructions.trim(),
    "",
    "## Advisory tool allow-list",
    "",
    tools,
    "",
    "Note: allowedTools is advisory only. It is intersected with the host",
    "policy at run time, and every tool call still requires a policy decision.",
    "A skill folder never authorizes a script or a tool by itself.",
  ].join("\n");
}

export type EnableSkillResult =
  | {
      ok: true;
      name: string;
      /** Expanded instructions the UI must display before enabling. */
      expandedInstructions: string;
      /** Advisory allow-list, intersected with policy at run time. */
      allowedTools: string[];
      sourcePath: string;
    }
  | { ok: false; name: string; reason: string };

/**
 * Begin the enable flow for a scanned skill. The SKILL.md is re-read and the
 * contentHash re-verified at enable time, so a file modified between scan and
 * enable cannot slip through. Returns the expanded instructions for user
 * review. Quarantined skills can NEVER be enabled. This function only
 * prepares data; persisting the enabled state is the caller's job and must
 * happen only after explicit user confirmation of the expanded instructions.
 */
export async function enableSkill(scan: SkillScanResult, name: string): Promise<EnableSkillResult> {
  const available = scan.skills.find((skill) => skill.name === name);
  if (!available) {
    const quarantined = scan.quarantined.find((skill) => skill.name === name);
    if (quarantined) {
      return { ok: false, name, reason: `skill is quarantined: ${quarantined.quarantineReason}` };
    }
    return { ok: false, name, reason: `unknown skill: ${name}` };
  }

  let raw: string;
  try {
    raw = await fs.readFile(available.sourcePath, "utf8");
  } catch (err) {
    return { ok: false, name, reason: `cannot re-read SKILL.md: ${firstLine(String(err))}` };
  }
  const { record, manifest } = parseSkillFile(available.sourcePath, raw, available.name);
  if (record.status !== "available" || !manifest) {
    return {
      ok: false,
      name,
      reason: `skill became invalid since the scan: ${record.quarantineReason ?? "unknown reason"}`,
    };
  }
  return {
    ok: true,
    name: manifest.name,
    expandedInstructions: buildExpandedInstructions(manifest),
    allowedTools: manifest.allowedTools,
    sourcePath: available.sourcePath,
  };
}
