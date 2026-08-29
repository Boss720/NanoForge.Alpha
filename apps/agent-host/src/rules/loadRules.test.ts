import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadRules,
  normalizeTargetPath,
  ruleAppliesTo,
  rulesForPath,
  type LoadRulesResult,
} from "./loadRules";

let scratch: string;
let globalDir: string;
let projectDir: string;

function pack(
  id: string,
  body: string,
  fm: { priority?: number; appliesTo?: string[]; enabled?: boolean } = {},
): string {
  const lines = ["---", `id: ${id}`, `priority: ${fm.priority ?? 0}`];
  if (fm.appliesTo) {
    lines.push("appliesTo:");
    for (const glob of fm.appliesTo) lines.push(`  - "${glob}"`);
  }
  lines.push(`enabled: ${fm.enabled ?? true}`, "---", "", body, "");
  return lines.join("\n");
}

async function writePack(dir: string, fileName: string, content: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

beforeEach(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "nanoforge-rules-"));
  globalDir = path.join(scratch, "global");
  projectDir = path.join(scratch, "project");
});

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

async function load(runRules?: Parameters<typeof loadRules>[0]["runRules"]): Promise<LoadRulesResult> {
  return loadRules({ globalDir, projectDir, runRules });
}

describe("loadRules", () => {
  it("returns an empty result when both tier directories are missing", async () => {
    const result = await load();
    expect(result.rules).toEqual([]);
    expect(result.sources).toEqual({});
    expect(result.errors).toEqual([]);
    expect(result.contextDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("composes tiers in deterministic precedence order run > project > global, then priority, then id", async () => {
    await writePack(globalDir, "a.md", pack("alpha", "global alpha body", { priority: 10 }));
    await writePack(globalDir, "shared.md", pack("shared", "GLOBAL shared body (must be overridden)", { priority: 90 }));
    const projectShared = await writePack(projectDir, "shared.md", pack("shared", "project shared body", { priority: 5 }));
    await writePack(projectDir, "b.md", pack("bravo", "project bravo body", { priority: 1 }));

    const result = await load([{ id: "run-pack", body: "run body", priority: 1 }]);

    // run tier first, then project (priority desc: shared=5 before bravo=1), then global (alpha).
    expect(result.rules.map((r) => r.id)).toEqual(["run-pack", "shared", "bravo", "alpha"]);
    expect(result.rules.map((r) => r.tier)).toEqual(["run", "project", "project", "global"]);

    // Project tier overrode the global pack with the same id.
    const shared = result.rules.find((r) => r.id === "shared")!;
    expect(shared.body).toBe("project shared body");
    expect(result.sources.shared).toBe(projectShared);
    expect(result.sources["run-pack"]).toBe("run:run-pack");
    expect(result.rules).toHaveLength(4); // global "shared" was dropped, not duplicated
  });

  it("breaks priority ties by id within a tier", async () => {
    await writePack(projectDir, "z.md", pack("zeta", "z", { priority: 3 }));
    await writePack(projectDir, "a.md", pack("alpha", "a", { priority: 3 }));
    const result = await load();
    expect(result.rules.map((r) => r.id)).toEqual(["alpha", "zeta"]);
  });

  it("excludes disabled rules from rules and sources", async () => {
    await writePack(projectDir, "off.md", pack("off", "disabled body", { enabled: false }));
    await writePack(projectDir, "on.md", pack("on", "enabled body"));
    const result = await load();
    expect(result.rules.map((r) => r.id)).toEqual(["on"]);
    expect(result.sources).not.toHaveProperty("off");
  });

  it("matches appliesTo globs against file paths", async () => {
    await writePack(projectDir, "ts.md", pack("ts-only", "typescript rules", { appliesTo: ["src/**/*.ts"] }));
    await writePack(projectDir, "md.md", pack("md-root", "markdown at root", { appliesTo: ["*.md"] }));
    await writePack(projectDir, "all.md", pack("everywhere", "no appliesTo = all scopes"));

    const result = await load();

    const forTs = rulesForPath(result, "src/foo/bar.ts").map((r) => r.id);
    expect(forTs).toContain("ts-only");
    expect(forTs).toContain("everywhere");
    expect(forTs).not.toContain("md-root"); // "*.md" must not match a .ts file

    const forMd = rulesForPath(result, "README.md").map((r) => r.id);
    expect(forMd).toContain("md-root");
    expect(forMd).not.toContain("ts-only");

    // "*.md" is basename-level: it does not match nested paths.
    const forNestedMd = rulesForPath(result, "docs/README.md").map((r) => r.id);
    expect(forNestedMd).not.toContain("md-root");
    expect(forNestedMd).toContain("everywhere");
  });

  it("normalizes Windows separators before glob matching", () => {
    expect(normalizeTargetPath("src\\foo\\bar.ts")).toBe("src/foo/bar.ts");
    expect(ruleAppliesTo({ appliesTo: ["src/**/*.ts"] }, "src\\foo\\bar.ts")).toBe(true);
  });

  it("reports malformed YAML front matter as a structured error naming the file", async () => {
    const bad = await writePack(projectDir, "bad.md", "---\nid: [unclosed\npriority: x\n---\nbody\n");
    await writePack(projectDir, "good.md", pack("good", "still loads"));

    const result = await load();
    expect(result.rules.map((r) => r.id)).toEqual(["good"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe(bad);
    expect(result.errors[0].kind).toBe("parse");
    expect(result.errors[0].message).toContain("front matter");
  });

  it("reports schema violations (missing id) as a structured validation error naming the file", async () => {
    const bad = await writePack(projectDir, "noid.md", "---\npriority: 1\nenabled: true\n---\nno id here\n");
    const result = await load();
    expect(result.rules).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe(bad);
    expect(result.errors[0].kind).toBe("validation");
    expect(result.errors[0].message).toContain("id");
  });

  it("contextDigest is deterministic and changes when any rule body changes", async () => {
    await writePack(projectDir, "a.md", pack("alpha", "body v1"));
    const first = await load();
    const second = await load();
    expect(second.contextDigest).toBe(first.contextDigest);

    await writePack(projectDir, "a.md", pack("alpha", "body v2"));
    const third = await load();
    expect(third.contextDigest).not.toBe(first.contextDigest);
  });

  it("run-tier packs override project and global packs with the same id", async () => {
    await writePack(globalDir, "s.md", pack("shared", "global version"));
    await writePack(projectDir, "s.md", pack("shared", "project version"));
    const result = await load([{ id: "shared", body: "run version" }]);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].body).toBe("run version");
    expect(result.rules[0].tier).toBe("run");
  });
});
