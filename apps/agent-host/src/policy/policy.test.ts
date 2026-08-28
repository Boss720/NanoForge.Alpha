/**
 * Tests for the policy engine — Module 2, Task 5.
 */
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorize,
  isWithinWorkspace,
  loadPolicy,
  resolveWithinWorkspace,
  type ToolRequest,
} from "./policy";

const ROOT = path.join(os.tmpdir(), "nanoforge-policy-test-root");
const policy = loadPolicy(ROOT);

const exec = (
  executable: string,
  args: string[] = [],
  cwd = ".",
): ToolRequest => ({ kind: "terminal.exec", cwd, executable, args });

describe("workspace confinement", () => {
  it("allows cwd at and inside the root", () => {
    expect(isWithinWorkspace(".", ROOT)).toBe(true);
    expect(isWithinWorkspace("sub/dir", ROOT)).toBe(true);
    expect(isWithinWorkspace(path.join(ROOT, "sub"), ROOT)).toBe(true);
    expect(resolveWithinWorkspace(ROOT, "sub")).toBe(path.join(ROOT, "sub"));
  });

  it("denies cwd escaping the root via ..", () => {
    expect(authorize(exec("git", ["status"], ".."), policy)).toBe("deny");
    expect(authorize(exec("git", ["status"], "../../etc"), policy)).toBe("deny");
    expect(resolveWithinWorkspace(ROOT, "..")).toBeNull();
  });

  it("denies an absolute cwd outside the root", () => {
    const outside = path.resolve(ROOT, "..", "definitely-outside");
    expect(authorize(exec("git", ["status"], outside), policy)).toBe("deny");
  });

  it("denies an absolute executable path outside the root", () => {
    const outsideExe = path.resolve(ROOT, "..", "evil-bin", "tool");
    expect(authorize(exec(outsideExe, []), policy)).toBe("deny");
  });
});

describe("read-only whitelist", () => {
  it("allows git status inside the workspace", () => {
    expect(authorize(exec("git", ["status"]), policy)).toBe("allow");
  });

  it("allows other whitelisted git reads and bare ls/dir", () => {
    expect(authorize(exec("git", ["log", "--oneline", "-5"]), policy)).toBe("allow");
    expect(authorize(exec("git", ["diff", "HEAD~1"]), policy)).toBe("allow");
    expect(authorize(exec("ls", ["-la"], "sub"), policy)).toBe("allow");
    expect(authorize(exec("dir"), policy)).toBe("allow");
  });

  it("allows version probes (node --version, npm --version)", () => {
    expect(authorize(exec("node", ["--version"]), policy)).toBe("allow");
    expect(authorize(exec("npm", ["--version"]), policy)).toBe("allow");
  });

  it("does not auto-allow whitelisted executables with other subcommands", () => {
    expect(authorize(exec("git", ["push", "origin", "main"]), policy)).toBe("ask");
    expect(authorize(exec("git", ["clean", "-fd"]), policy)).toBe("ask");
    expect(authorize(exec("node", ["-e", "console.log(1)"]), policy)).toBe("ask");
  });
});

describe("shells and composition", () => {
  it("denies free-form shells", () => {
    expect(authorize(exec("cmd", ["/c", "dir"]), policy)).toBe("deny");
    expect(authorize(exec("cmd.exe", ["/c", "dir"]), policy)).toBe("deny");
    expect(authorize(exec("powershell", ["-Command", "ls"]), policy)).toBe("deny");
    expect(authorize(exec("bash", ["-c", "ls"]), policy)).toBe("deny");
    expect(authorize(exec("sh", ["-c", "ls"]), policy)).toBe("deny");
  });

  it("denies shell composition in arguments", () => {
    expect(authorize(exec("git", ["log", "|", "less"]), policy)).toBe("deny");
    expect(authorize(exec("git", ["status", "&&", "npm", "install"]), policy)).toBe("deny");
    expect(authorize(exec("git", ["log", ";", "rm", "-rf", "."]), policy)).toBe("deny");
    expect(authorize(exec("node", ["-e", "$(whoami)"]), policy)).toBe("deny");
  });

  it("asks on redirection", () => {
    expect(authorize(exec("git", ["status", ">", "out.txt"]), policy)).toBe("ask");
    expect(authorize(exec("node", ["script.js", "2>&1"]), policy)).toBe("ask");
  });
});

describe("writes, network, installs, termination", () => {
  it("asks for package installs and unknown executables", () => {
    expect(authorize(exec("npm", ["install"]), policy)).toBe("ask");
    expect(authorize(exec("npm", ["install", "lodash"]), policy)).toBe("ask");
    expect(authorize(exec("make", ["all"]), policy)).toBe("ask");
  });

  it("asks for deletion, network, and process termination", () => {
    expect(authorize(exec("rm", ["-rf", "dist"]), policy)).toBe("ask");
    expect(authorize(exec("del", ["f.txt"]), policy)).toBe("ask");
    expect(authorize(exec("curl", ["https://example.com"]), policy)).toBe("ask");
    expect(authorize(exec("taskkill", ["/pid", "1234"]), policy)).toBe("ask");
  });

  it("denies privilege-escalation wrappers", () => {
    expect(authorize(exec("sudo", ["ls"]), policy)).toBe("deny");
  });
});

describe("robustness", () => {
  it("denies empty executables and unknown kinds", () => {
    expect(authorize(exec("", []), policy)).toBe("deny");
    expect(
      authorize({ kind: "browser.navigate" } as unknown as ToolRequest, policy),
    ).toBe("deny");
  });

  it("matches executables case-insensitively and with extensions", () => {
    expect(authorize(exec("GIT.EXE", ["status"]), policy)).toBe("allow");
    expect(authorize(exec("NPM", ["install"]), policy)).toBe("ask");
  });
});
