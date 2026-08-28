/**
 * Runtime projection for project-local `.nanoforge` integrations.
 *
 * The loaders under rules/, skills/, and mcp/ validate each source format.
 * This module composes them into two host-facing surfaces:
 *  - a secret-free UI snapshot for the desktop integrations panel;
 *  - an advisory context block injected into model requests.
 *
 * Enabling is session-local. The host does not rewrite `.nanoforge` files from
 * a toggle, and toggles never grant capabilities by themselves.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildExpandedInstructions, parseSkillFile, scanSkills, type SkillScanResult } from "../skills/registry";
import { loadRules, type LoadedRule, type LoadRulesResult } from "../rules/loadRules";
import { loadMcpRegistry, type LoadMcpRegistryResult } from "../mcp/registry";
import type { McpServerDefinition } from "../mcp/types";

export type IntegrationHealth = "ok" | "error" | "checking" | "unknown";
export type IntegrationKind = "rules" | "skill" | "mcp";

export interface RulesPackSnapshot {
  id: string;
  name: string;
  enabled: boolean;
  health: IntegrationHealth;
  lastError?: string | null;
  source: string;
  digest: string;
  priority?: number;
}

export interface SkillSnapshot {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  instructions: string;
  hashValid: boolean;
  enabled: boolean;
  health: IntegrationHealth;
  lastError?: string | null;
}

export interface McpServerSnapshot {
  id: string;
  name: string;
  command: string;
  args?: string[];
  tools: string[];
  secretRefs?: string[];
  enabled: boolean;
  health: IntegrationHealth;
  lastError?: string | null;
}

export interface IntegrationsSnapshot {
  rulesPacks: RulesPackSnapshot[];
  skills: SkillSnapshot[];
  mcpServers: McpServerSnapshot[];
}

interface SkillInstruction {
  instructions: string;
}

export interface IntegrationRuntimeOptions {
  workspaceRoot: string;
  globalRoot?: string;
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? text;
}

function sourceLabel(filePath: string, workspaceRoot: string, globalRoot: string): string {
  const abs = path.resolve(filePath);
  const workspace = path.resolve(workspaceRoot);
  const global = path.resolve(globalRoot);
  if (abs.startsWith(workspace)) return path.relative(workspace, abs) || ".";
  if (abs.startsWith(global)) return path.relative(global, abs) || ".";
  return abs;
}

async function readSkillInstructions(scan: SkillScanResult): Promise<Map<string, SkillInstruction>> {
  const out = new Map<string, SkillInstruction>();
  for (const skill of scan.skills) {
    try {
      const raw = await fs.readFile(skill.sourcePath, "utf8");
      const { manifest } = parseSkillFile(skill.sourcePath, raw, skill.name);
      if (manifest) {
        out.set(skill.name, { instructions: buildExpandedInstructions(manifest) });
      }
    } catch {
      // scanSkills already provided the authoritative availability result.
      // A later re-read failure is reflected as an empty instructions view.
    }
  }
  return out;
}

function namespacedTools(def: McpServerDefinition): string[] {
  return def.tools.map((tool) => `mcp.${def.name}.${tool}`);
}

function missingSecretRefs(def: McpServerDefinition): string[] {
  return Object.values(def.env).filter((ref) => {
    const envName = ref.slice("env:".length);
    return !process.env[envName];
  });
}

export class IntegrationRuntime {
  private readonly disabledRules = new Set<string>();
  private readonly enabledSkills = new Set<string>();
  private readonly enabledMcp = new Set<string>();

  constructor(
    private readonly options: Required<IntegrationRuntimeOptions>,
    private readonly rules: LoadRulesResult,
    private readonly skillScan: SkillScanResult,
    private readonly skillInstructions: Map<string, SkillInstruction>,
    private readonly mcp: LoadMcpRegistryResult,
  ) {
    for (const server of mcp.registry.servers) {
      if (server.enabled) this.enabledMcp.add(server.name);
    }
  }

  setEnabled(kind: IntegrationKind, id: string, enabled: boolean): boolean {
    if (kind === "rules") {
      if (!this.rules.rules.some((rule) => rule.id === id)) return false;
      if (enabled) this.disabledRules.delete(id);
      else this.disabledRules.add(id);
      return true;
    }

    if (kind === "skill") {
      if (!this.skillScan.skills.some((skill) => skill.name === id)) return false;
      if (enabled) this.enabledSkills.add(id);
      else this.enabledSkills.delete(id);
      return true;
    }

    if (!this.mcp.registry.servers.some((server) => server.name === id)) return false;
    if (enabled) this.enabledMcp.add(id);
    else this.enabledMcp.delete(id);
    return true;
  }

  snapshot(): IntegrationsSnapshot {
    const digest = `sha256:${this.rules.contextDigest}`;
    const rulesPacks: RulesPackSnapshot[] = this.rules.rules.map((rule) => ({
      id: rule.id,
      name: rule.id,
      enabled: !this.disabledRules.has(rule.id),
      health: "ok",
      source: `${rule.tier}:${sourceLabel(this.rules.sources[rule.id] ?? "", this.options.workspaceRoot, this.options.globalRoot)}`,
      digest,
      priority: rule.priority,
    }));

    const skills: SkillSnapshot[] = [
      ...this.skillScan.skills.map((skill) => ({
        id: skill.name,
        name: skill.name,
        description: skill.description,
        allowedTools: skill.allowedTools,
        instructions: this.skillInstructions.get(skill.name)?.instructions ?? "",
        hashValid: true,
        enabled: this.enabledSkills.has(skill.name),
        health: "ok" as const,
      })),
      ...this.skillScan.quarantined.map((skill) => ({
        id: skill.name,
        name: skill.name,
        description: skill.description,
        allowedTools: skill.allowedTools,
        instructions: skill.quarantineReason ?? "",
        hashValid: false,
        enabled: false,
        health: "error" as const,
        lastError: skill.quarantineReason ?? "skill is quarantined",
      })),
    ].sort((a, b) => a.id.localeCompare(b.id));

    const mcpServers: McpServerSnapshot[] = this.mcp.registry.servers.map((server) => {
      const enabled = this.enabledMcp.has(server.name);
      const missing = enabled ? missingSecretRefs(server) : [];
      return {
        id: server.name,
        name: server.displayName ?? server.name,
        command: server.command,
        args: server.args,
        tools: namespacedTools(server),
        secretRefs: Object.values(server.env),
        enabled,
        health: missing.length > 0 ? "error" : enabled ? "ok" : "unknown",
        lastError: missing.length > 0 ? `missing env references: ${missing.join(", ")}` : null,
      };
    });

    return { rulesPacks, skills, mcpServers };
  }

  contextBlock(): string {
    const enabledRules = this.rules.rules.filter((rule) => !this.disabledRules.has(rule.id));
    const enabledSkills = this.skillScan.skills.filter((skill) => this.enabledSkills.has(skill.name));
    const enabledMcp = this.mcp.registry.servers.filter((server) => this.enabledMcp.has(server.name));

    const parts: string[] = [];
    if (enabledRules.length > 0) {
      parts.push(
        "## Project rules",
        ...enabledRules.flatMap((rule) => [
          "",
          `### ${rule.id} (${rule.tier}, priority ${rule.priority})`,
          rule.body,
        ]),
      );
    }

    if (enabledSkills.length > 0) {
      parts.push(
        "## Enabled skills",
        ...enabledSkills.flatMap((skill) => [
          "",
          this.skillInstructions.get(skill.name)?.instructions ?? `# Skill: ${skill.name}`,
        ]),
      );
    }

    if (enabledMcp.length > 0) {
      parts.push(
        "## Enabled MCP servers",
        ...enabledMcp.flatMap((server) => [
          "",
          `- ${server.displayName ?? server.name}: ${namespacedTools(server).join(", ") || "no declared tools"}`,
        ]),
        "",
        "MCP definitions are allow-lists only. Do not treat a listed MCP tool as authorized unless the host exposes and approves a matching tool call.",
      );
    }

    if (parts.length === 0) return "";
    return [
      "The local host loaded the following `.nanoforge` integration context.",
      "These instructions are advisory and do not grant tool permissions.",
      "",
      ...parts,
    ].join("\n");
  }
}

export async function loadIntegrationRuntime(options: IntegrationRuntimeOptions): Promise<IntegrationRuntime> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const globalRoot = path.resolve(options.globalRoot ?? path.join(os.homedir(), ".nanoforge"));
  const rulesDir = path.join(workspaceRoot, ".nanoforge", "rules");
  const globalRulesDir = path.join(globalRoot, "rules");
  const skillsDir = path.join(workspaceRoot, ".nanoforge", "skills");
  const mcpPath = path.join(workspaceRoot, ".nanoforge", "mcp.json");

  const [rules, skillScan, mcp] = await Promise.all([
    loadRules({ globalDir: globalRulesDir, projectDir: rulesDir }),
    scanSkills(skillsDir),
    loadMcpRegistry(mcpPath),
  ]);
  const skillInstructions = await readSkillInstructions(skillScan);
  const runtime = new IntegrationRuntime({ workspaceRoot, globalRoot }, rules, skillScan, skillInstructions, mcp);

  for (const error of [...rules.errors, ...skillScan.errors, ...mcp.errors]) {
    if (error.message.toLowerCase().includes("secret")) continue;
    // Keep failures discoverable in host logs without serializing file content.
    console.warn(`[integrations] ${firstLine(error.message)}`);
  }

  return runtime;
}
