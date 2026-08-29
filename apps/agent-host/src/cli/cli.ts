/**
 * NanoForge Headless CLI Argument Parser & Entrypoint.
 */

import { executePlanCommand } from "./plan";
import { executeRunCommand } from "./run";
import { HumanFormatter } from "./formatters";
import { EXIT_CODES, type AutoApproveMode, type OutputFormat, type PlanCommandOptions, type RunCommandOptions } from "./types";

export const CLI_VERSION = "0.1.0";

export interface ParsedArgs {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgv(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        flags[key] = value;
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      const char = arg.slice(1);
      // Map common short flags
      if (char === "h") flags["help"] = true;
      else if (char === "v") flags["version"] = true;
      else if (char === "j") flags["json"] = true;
      else if (char === "o" || char === "p" || char === "g" || char === "t") {
        const key = char === "o" ? "output" : char === "p" ? "prompt" : char === "g" ? "goal" : "timeout";
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      } else {
        flags[char] = true;
      }
    } else {
      positionals.push(arg);
    }
    i++;
  }

  const command = positionals[0];
  const restPositionals = positionals.slice(1);

  return {
    command,
    positionals: restPositionals,
    flags,
  };
}

export function printHelp(): void {
  const help = `
NanoForge Headless CLI - v${CLI_VERSION}

USAGE:
  nanoforge <command> [arguments] [options]

COMMANDS:
  run   "<prompt>"      Execute an agent task headlessly with policy and approval gates
  plan  "<goal>"        Synthesize and validate an execution plan DAG

GLOBAL OPTIONS:
  -h, --help            Show this help message and exit
  -v, --version         Show version information and exit
      --no-color        Disable ANSI terminal colors

RUN OPTIONS:
  -p, --prompt <text>   The prompt or goal to execute (or positional argument)
  -j, --json            Format output as structured JSON
      --ndjson          Stream realtime NDJSON events on stdout
      --format <fmt>    Output format: human (default), json, or ndjson
  -o, --output <dir>    Write execution artifacts, plan.json, and events to directory
      --auto-approve <mode>
                        Approval policy: none (default, fail-closed), safe, or all
  -t, --timeout <sec>   Maximum execution timeout in seconds
      --token <token>   Bearer token for authenticating to local agent host daemon
      --host <url>      Host daemon URL (e.g. http://127.0.0.1:4000)
      --plan <file>     Load a pre-composed ExecutionPlan JSON file

PLAN OPTIONS:
  -g, --goal <text>     The plan goal (or positional argument)
  -j, --json            Output plan JSON to stdout
  -o, --output <dir>    Write plan.json and plan.md to output directory

EXIT CODES:
  0 - Success
  1 - Failure (general error or step failure)
  2 - Policy violation (policy denied command)
  3 - Cancelled (aborted by user or signal)
  4 - Approval denied / timeout (fail-closed refusal)
  5 - Config / Auth error (missing/invalid token or options)
  6 - Verification failed (plan DAG validation error)
`;
  process.stdout.write(help.trimStart() + "\n");
}

export async function runCLI(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgv(argv);
  const human = new HumanFormatter({ noColor: Boolean(parsed.flags["no-color"]) });

  if (parsed.flags["version"]) {
    process.stdout.write(`nanoforge v${CLI_VERSION}\n`);
    return EXIT_CODES.SUCCESS;
  }

  if (parsed.flags["help"] || (!parsed.command && argv.length === 0)) {
    printHelp();
    return EXIT_CODES.SUCCESS;
  }

  const abortController = new AbortController();
  const onSigint = () => {
    abortController.abort();
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigint);

  try {
    switch (parsed.command) {
      case "run": {
        const prompt =
          (typeof parsed.flags["prompt"] === "string" ? parsed.flags["prompt"] : undefined) ??
          parsed.positionals[0] ??
          "";

        const autoApprove = (parsed.flags["auto-approve"] as AutoApproveMode) ?? "none";
        if (autoApprove !== "none" && autoApprove !== "safe" && autoApprove !== "all") {
          human.printError(
            `Invalid --auto-approve mode "${autoApprove}". Must be one of: none, safe, all.`,
            EXIT_CODES.CONFIG_AUTH,
          );
          return EXIT_CODES.CONFIG_AUTH;
        }

        const format = (parsed.flags["format"] as OutputFormat) ?? undefined;
        const timeout =
          typeof parsed.flags["timeout"] === "string"
            ? parseFloat(parsed.flags["timeout"])
            : typeof parsed.flags["timeout"] === "number"
              ? parsed.flags["timeout"]
              : undefined;

        const options: RunCommandOptions = {
          prompt,
          json: Boolean(parsed.flags["json"]),
          ndjson: Boolean(parsed.flags["ndjson"]),
          format,
          output: typeof parsed.flags["output"] === "string" ? parsed.flags["output"] : undefined,
          autoApprove,
          timeout,
          token: typeof parsed.flags["token"] === "string" ? parsed.flags["token"] : undefined,
          host: typeof parsed.flags["host"] === "string" ? parsed.flags["host"] : undefined,
          planFile: typeof parsed.flags["plan"] === "string"
            ? parsed.flags["plan"]
            : typeof parsed.flags["plan-file"] === "string"
              ? parsed.flags["plan-file"]
              : undefined,
          noColor: Boolean(parsed.flags["no-color"]),
        };

        const result = await executeRunCommand(options, abortController.signal);
        return result.exitCode;
      }

      case "plan": {
        const goal =
          (typeof parsed.flags["goal"] === "string" ? parsed.flags["goal"] : undefined) ??
          parsed.positionals[0] ??
          "";

        const options: PlanCommandOptions = {
          goal,
          json: Boolean(parsed.flags["json"]),
          output: typeof parsed.flags["output"] === "string" ? parsed.flags["output"] : undefined,
          noColor: Boolean(parsed.flags["no-color"]),
        };

        const result = await executePlanCommand(options);
        return result.exitCode;
      }

      default: {
        human.printError(`Unknown command "${parsed.command}". Run "nanoforge --help" for usage.`, EXIT_CODES.CONFIG_AUTH);
        return EXIT_CODES.CONFIG_AUTH;
      }
    }
  } catch (err) {
    human.printError(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`, EXIT_CODES.FAILURE);
    return EXIT_CODES.FAILURE;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigint);
  }
}
