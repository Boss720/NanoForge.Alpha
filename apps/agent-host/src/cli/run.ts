/**
 * Headless Execution Runner Command Handler (`nanoforge run`).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExecutionPlan } from "@protocol/plan";
import { validatePlan } from "../planning/validatePlan";
import { DaemonClient } from "./client";
import { HumanFormatter, JsonFormatter, NdjsonFormatter } from "./formatters";
import { parseOrSynthesizePlan } from "./planner";
import { StandaloneRunner } from "./standalone";
import { EXIT_CODES, type CLIResult, type RunCommandOptions } from "./types";

export async function executeRunCommand(
  options: RunCommandOptions,
  abortSignal?: AbortSignal,
): Promise<CLIResult> {
  const prompt = options.prompt?.trim();
  const isJson = options.json || options.format === "json";
  const isNdjson = options.ndjson || options.format === "ndjson";

  const human = new HumanFormatter({ noColor: options.noColor });
  const ndjson = new NdjsonFormatter();
  const jsonFormatter = new JsonFormatter();

  if (!prompt && !options.planFile) {
    human.printError(
      "Missing required prompt or plan file. Usage: nanoforge run \"<prompt>\" [--json] [--output <dir>] [--auto-approve <none|safe|all>]",
      EXIT_CODES.CONFIG_AUTH,
    );
    return {
      exitCode: EXIT_CODES.CONFIG_AUTH,
      message: "Missing required prompt or plan file",
    };
  }

  let plan: ExecutionPlan;
  if (options.planFile) {
    try {
      const raw = readFileSync(path.resolve(options.planFile), "utf8");
      plan = JSON.parse(raw) as ExecutionPlan;
      const validation = validatePlan(plan);
      if (!validation.ok) {
        if (isJson || isNdjson) {
          jsonFormatter.format({ ok: false, error: "plan_validation_failed", errors: validation.errors });
        } else {
          human.printError("Loaded plan file failed verification:", EXIT_CODES.VERIFICATION_FAILED);
          for (const err of validation.errors) {
            process.stderr.write(`  • [${err.code}] ${err.path}: ${err.message}\n`);
          }
        }
        return {
          exitCode: EXIT_CODES.VERIFICATION_FAILED,
          message: "Plan verification failed",
          plan,
        };
      }
    } catch (err) {
      const msg = `Failed to read plan file "${options.planFile}": ${err instanceof Error ? err.message : String(err)}`;
      human.printError(msg, EXIT_CODES.CONFIG_AUTH);
      return {
        exitCode: EXIT_CODES.CONFIG_AUTH,
        message: msg,
      };
    }
  } else {
    const res = parseOrSynthesizePlan(prompt!);
    plan = res.plan;
    if (!res.validation.ok) {
      if (isJson || isNdjson) {
        jsonFormatter.format({ ok: false, error: "plan_validation_failed", errors: res.validation.errors });
      } else {
        human.printError("Synthesized plan failed verification:", EXIT_CODES.VERIFICATION_FAILED);
        for (const err of res.validation.errors) {
          process.stderr.write(`  • [${err.code}] ${err.path}: ${err.message}\n`);
        }
      }
      return {
        exitCode: EXIT_CODES.VERIFICATION_FAILED,
        message: "Plan verification failed",
        plan,
      };
    }
  }

  if (!isJson && !isNdjson) {
    human.printBanner();
    human.printPlan(plan);
  }

  const timeoutMs = options.timeout ? options.timeout * 1000 : undefined;
  const startTime = Date.now();

  const onEvent = (event: Parameters<typeof human.handleEvent>[0]) => {
    if (isNdjson) {
      ndjson.writeEvent(event);
    } else if (!isJson) {
      human.handleEvent(event);
    }
  };

  let result: CLIResult;

  if (options.host) {
    result = await DaemonClient.run({
      host: options.host,
      token: options.token ?? process.env.NANOFORGE_TOKEN ?? process.env.TOKEN,
      plan,
      autoApprove: options.autoApprove ?? "none",
      timeoutMs,
      abortSignal,
      onEvent,
    });
  } else {
    result = await StandaloneRunner.run({
      plan,
      autoApprove: options.autoApprove ?? "none",
      workspaceRoot: options.workspaceRoot,
      timeoutMs,
      abortSignal,
      onEvent,
    });
  }

  const durationMs = Date.now() - startTime;

  if (isJson) {
    jsonFormatter.format({
      ok: result.exitCode === EXIT_CODES.SUCCESS,
      exitCode: result.exitCode,
      durationMs,
      summary: result.summary,
      plan: result.plan,
      events: result.events,
    });
  } else if (!isNdjson && result.summary) {
    human.printSummary(result.summary, result.exitCode, durationMs);
  }

  if (options.output) {
    try {
      const outDir = path.resolve(options.output);
      mkdirSync(outDir, { recursive: true });

      writeFileSync(path.join(outDir, "plan.json"), JSON.stringify(plan, null, 2), "utf8");
      if (result.events) {
        const ndjsonLines = result.events.map((e) => JSON.stringify(e)).join("\n");
        writeFileSync(path.join(outDir, "events.ndjson"), ndjsonLines, "utf8");
      }
      if (result.summary) {
        writeFileSync(
          path.join(outDir, "summary.json"),
          JSON.stringify({ exitCode: result.exitCode, durationMs, summary: result.summary }, null, 2),
          "utf8",
        );
      }
    } catch (err) {
      if (!isJson && !isNdjson) {
        human.printError(`Failed to save output to "${options.output}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return result;
}
