#!/usr/bin/env node
/**
 * NanoForge Standalone CLI Binary Entrypoint.
 */

import { runCLI } from "../apps/agent-host/src/cli/index";

const exitCode = await runCLI(process.argv.slice(2));
process.exit(exitCode);
