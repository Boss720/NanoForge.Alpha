import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkspaceRegistry, defaultValidatePath } from "../workspace-registry.cjs";

function temporaryRegistryPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nanoforge-registry-")), "workspaces.json");
}

describe("workspace registry", () => {
  it("persists canonical workspaces, deduplicates Windows paths, and reopens them", () => {
    const registryPath = temporaryRegistryPath();
    const validatePath = (input: string) => input.replace(/\\+$/, "");
    const registry = createWorkspaceRegistry({ registryPath, platform: "win32", validatePath, now: () => "2026-08-26T12:00:00.000Z" });
    const first = registry.open("C:\\Work\\Demo\\");
    const again = registry.open("c:\\work\\demo");
    expect(again.id).toBe(first.id);
    expect(registry.list()).toEqual([{ ...first, path: "c:\\work\\demo" }]);
    expect(createWorkspaceRegistry({ registryPath, platform: "win32", validatePath }).list()).toHaveLength(1);
  });

  it("pins and removes entries by opaque identifier", () => {
    const registry = createWorkspaceRegistry({ registryPath: temporaryRegistryPath(), validatePath: (value: string) => value });
    const workspace = registry.open("/work/demo");
    expect(registry.pin(workspace.id, true)?.pinned).toBe(true);
    expect(registry.remove(workspace.id)).toBe(true);
    expect(registry.list()).toEqual([]);
  });

  it("surfaces path validation errors before persistence", () => {
    const registry = createWorkspaceRegistry({ registryPath: temporaryRegistryPath(), validatePath: () => { throw new Error("not a directory"); } });
    expect(() => registry.open("/not-a-directory")).toThrow("not a directory");
  });

  it("rejects a filesystem root as a workspace", () => {
    const root = path.parse(process.cwd()).root;
    expect(() => defaultValidatePath(root)).toThrow("workspace root is too broad");
  });

  it("writes atomically and quarantines corrupt registry content", () => {
    const registryPath = temporaryRegistryPath();
    fs.writeFileSync(registryPath, "not json", "utf8");
    const registry = createWorkspaceRegistry({ registryPath, validatePath: (value: string) => value });
    expect(registry.list()).toEqual([]);
    expect(fs.readdirSync(path.dirname(registryPath)).some((name) => name.startsWith("workspaces.json.corrupt-"))).toBe(true);
    registry.open("/work/demo");
    expect(JSON.parse(fs.readFileSync(registryPath, "utf8")).version).toBe(1);
    expect(fs.readdirSync(path.dirname(registryPath)).some((name) => name.includes(".tmp-"))).toBe(false);
  });
});
