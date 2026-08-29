/**
 * NanoForge Headless CLI Argument Parsing & Routing Tests.
 */

import { describe, expect, it, vi } from "vitest";
import { parseArgv, runCLI } from "./cli";
import { EXIT_CODES } from "./types";

describe("parseArgv", () => {
  it("parses subcommands and positionals", () => {
    const parsed = parseArgv(["run", "Build the project", "--json"]);
    expect(parsed.command).toBe("run");
    expect(parsed.positionals).toEqual(["Build the project"]);
    expect(parsed.flags["json"]).toBe(true);
  });

  it("parses --flag=value syntax", () => {
    const parsed = parseArgv(["run", "--prompt=Test Goal", "--auto-approve=safe", "--timeout=30"]);
    expect(parsed.command).toBe("run");
    expect(parsed.flags["prompt"]).toBe("Test Goal");
    expect(parsed.flags["auto-approve"]).toBe("safe");
    expect(parsed.flags["timeout"]).toBe("30");
  });

  it("parses short flags -p, -g, -o, -j, -t, -h, -v", () => {
    const parsed = parseArgv(["run", "-p", "My prompt", "-j", "-o", "./out", "-t", "60"]);
    expect(parsed.flags["prompt"]).toBe("My prompt");
    expect(parsed.flags["json"]).toBe(true);
    expect(parsed.flags["output"]).toBe("./out");
    expect(parsed.flags["timeout"]).toBe("60");

    const helpParsed = parseArgv(["-h"]);
    expect(helpParsed.flags["help"]).toBe(true);

    const versionParsed = parseArgv(["-v"]);
    expect(versionParsed.flags["version"]).toBe(true);
  });
});

describe("runCLI", () => {
  it("handles --version / -v flag with exit code 0", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await runCLI(["--version"]);
    expect(code).toBe(EXIT_CODES.SUCCESS);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("nanoforge v"));
    stdoutSpy.mockRestore();
  });

  it("handles --help / -h flag with exit code 0", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await runCLI(["--help"]);
    expect(code).toBe(EXIT_CODES.SUCCESS);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("USAGE:"));
    stdoutSpy.mockRestore();
  });

  it("returns Exit Code 5 on unknown command", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runCLI(["invalid-command"]);
    expect(code).toBe(EXIT_CODES.CONFIG_AUTH);
    stderrSpy.mockRestore();
  });

  it("returns Exit Code 5 on invalid --auto-approve option", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runCLI(["run", "Some goal", "--auto-approve", "invalid-mode"]);
    expect(code).toBe(EXIT_CODES.CONFIG_AUTH);
    stderrSpy.mockRestore();
  });

  it("returns Exit Code 5 on missing prompt for run command", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runCLI(["run"]);
    expect(code).toBe(EXIT_CODES.CONFIG_AUTH);
    stderrSpy.mockRestore();
  });

  it("returns Exit Code 5 on missing goal for plan command", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await runCLI(["plan"]);
    expect(code).toBe(EXIT_CODES.CONFIG_AUTH);
    stderrSpy.mockRestore();
  });
});
