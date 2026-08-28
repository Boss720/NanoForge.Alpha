import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enableSkill, scanSkills, sha256Hex } from "./registry";

let skillsDir: string;

const INSTRUCTIONS = "Always run the tests before claiming completion.\nNever print secret values.\n";

function skillMd(overrides: Record<string, unknown> = {}, instructions: string = INSTRUCTIONS): string {
  const fm: Record<string, unknown> = {
    name: "test-skill",
    description: "A test skill.",
    allowedTools: ["terminal.exec", "browser.navigate"],
    instructions,
    contentHash: createHash("sha256").update(instructions, "utf8").digest("hex"),
    ...overrides,
  };
  const lines = ["---"];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else if (key === "instructions") {
      lines.push(`instructions: |`);
      for (const line of String(value).split("\n")) lines.push(line === "" ? "" : `  ${line}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---", "", "Human documentation.", "");
  return lines.join("\n");
}

async function writeSkill(dirName: string, content: string): Promise<string> {
  const dir = path.join(skillsDir, dirName);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "SKILL.md");
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

beforeEach(async () => {
  skillsDir = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-skills-"));
});

afterEach(async () => {
  await fs.rm(skillsDir, { recursive: true, force: true });
});

describe("scanSkills", () => {
  it("returns an empty result for a missing directory", async () => {
    const result = await scanSkills(path.join(skillsDir, "does-not-exist"));
    expect(result.skills).toEqual([]);
    expect(result.quarantined).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("loads a well-formed skill with parsed allowedTools", async () => {
    const filePath = await writeSkill("test-skill", skillMd());
    const result = await scanSkills(skillsDir);
    expect(result.errors).toEqual([]);
    expect(result.quarantined).toEqual([]);
    expect(result.skills).toHaveLength(1);
    const skill = result.skills[0];
    expect(skill.name).toBe("test-skill");
    expect(skill.description).toBe("A test skill.");
    expect(skill.allowedTools).toEqual(["terminal.exec", "browser.navigate"]);
    expect(skill.status).toBe("available");
    expect(skill.sourcePath).toBe(filePath);
  });

  it("rejects malformed YAML front matter with a reason", async () => {
    await writeSkill("broken", "---\nname: [unclosed\n---\nbody\n");
    const result = await scanSkills(skillsDir);
    expect(result.skills).toEqual([]);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].status).toBe("quarantined");
    expect(result.quarantined[0].quarantineReason).toContain("front matter");
  });

  it("rejects a schema-invalid manifest with the field-level reason", async () => {
    const withoutHash = skillMd().replace(/contentHash:.*\n/, "");
    await writeSkill("test-skill", withoutHash);
    const result = await scanSkills(skillsDir);
    expect(result.skills).toEqual([]);
    const quarantined = result.quarantined.find((s) => s.sourcePath.includes("test-skill"))!;
    expect(quarantined.quarantineReason).toContain("contentHash");
  });

  it("quarantines a skill whose contentHash does not match the instructions body", async () => {
    await writeSkill("tampered", skillMd({ name: "tampered", contentHash: "0".repeat(64) }));
    const result = await scanSkills(skillsDir);
    expect(result.skills).toEqual([]);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].name).toBe("tampered");
    expect(result.quarantined[0].quarantineReason).toContain("contentHash");
  });

  it("quarantines duplicate skill names", async () => {
    await writeSkill("one", skillMd());
    await writeSkill("two", skillMd());
    const result = await scanSkills(skillsDir);
    expect(result.skills).toHaveLength(1);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0].quarantineReason).toContain("duplicate");
  });
});

describe("enableSkill", () => {
  it("returns the expanded instructions for an available skill", async () => {
    await writeSkill("test-skill", skillMd());
    const scan = await scanSkills(skillsDir);
    const enabled = await enableSkill(scan, "test-skill");
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;
    expect(enabled.expandedInstructions).toContain("# Skill: test-skill");
    expect(enabled.expandedInstructions).toContain("Always run the tests before claiming completion.");
    expect(enabled.expandedInstructions).toContain("- terminal.exec");
    expect(enabled.expandedInstructions).toContain("advisory");
    expect(enabled.allowedTools).toEqual(["terminal.exec", "browser.navigate"]);
  });

  it("never enables a quarantined skill and reports the reason", async () => {
    await writeSkill("tampered", skillMd({ name: "tampered", contentHash: "f".repeat(64) }));
    const scan = await scanSkills(skillsDir);
    const enabled = await enableSkill(scan, "tampered");
    expect(enabled.ok).toBe(false);
    if (enabled.ok) return;
    expect(enabled.reason).toContain("quarantined");
    expect(enabled.reason).toContain("contentHash");
  });

  it("never enables a skill whose file changed between scan and enable", async () => {
    const filePath = await writeSkill("test-skill", skillMd());
    const scan = await scanSkills(skillsDir);
    // Tamper with the instructions after the scan without updating the hash.
    const originalHash = createHash("sha256").update(INSTRUCTIONS, "utf8").digest("hex");
    await fs.writeFile(
      filePath,
      skillMd({ contentHash: originalHash }, "Evil replacement instructions.\n"),
      "utf8",
    );
    const enabled = await enableSkill(scan, "test-skill");
    expect(enabled.ok).toBe(false);
    if (enabled.ok) return;
    expect(enabled.reason).toContain("became invalid");
  });

  it("refuses unknown skills", async () => {
    const scan = await scanSkills(skillsDir);
    const enabled = await enableSkill(scan, "ghost");
    expect(enabled).toEqual({ ok: false, name: "ghost", reason: "unknown skill: ghost" });
  });
});

describe("sha256Hex", () => {
  it("hashes the exact string", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
