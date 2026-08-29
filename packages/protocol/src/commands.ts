/**
 * Slash command wire protocol, definitions, and tokenizer — Module 1, Task 1.
 *
 * Provides isomorphic Zod schemas, types, parser/formatter utilities, and
 * the built-in slash command definitions for NanoForge chat interaction.
 */

import { z } from "zod";
import { jsonValueSchema } from "./json";

/* ------------------------------------------------------------------ */
/* 1. Slash Command Categories & Mentions                             */
/* ------------------------------------------------------------------ */

export const slashCommandCategorySchema = z.enum([
  "planning",
  "execution",
  "context",
  "system",
  "workspace",
  "custom",
]);
export type SlashCommandCategory = z.infer<typeof slashCommandCategorySchema>;

/** Supported operations exposed by the swarm slash-command family. */
export const swarmCommandActionSchema = z.enum([
  "run",
  "list",
  "tree",
  "inspect",
  "message",
  "pause",
  "resume",
  "stop",
  "focus",
]);
export type SwarmCommandAction = z.infer<typeof swarmCommandActionSchema>;

/** Context mentions extracted from command input: @file, @rule, #symbol, @agent. */
export const commandMentionsSchema = z.object({
  files: z.array(z.string()).default([]),
  rules: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  agents: z.array(z.string()).default([]),
});
export type CommandMentions = z.infer<typeof commandMentionsSchema>;

/* ------------------------------------------------------------------ */
/* 2. SlashCommandWire Schema & Inferred Type                         */
/* ------------------------------------------------------------------ */

/**
 * Normalized wire representation of a parsed slash command.
 */
export const slashCommandWireSchema = z.object({
  /** Canonical command name including leading slash, e.g. "/plan", "/goal". */
  command: z.string().min(1),
  /** Positional arguments in lexical order. */
  positional: z.array(z.string()).default([]),
  /** Key-value flags, e.g. { keep: 5, action: "screenshot", dryRun: true }. */
  flags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** Verbatim raw text typed by user. */
  rawInput: z.string(),
  /** Extracted context mentions. */
  mentions: commandMentionsSchema.default({ files: [], rules: [], symbols: [], agents: [] }),
});
export type SlashCommandWire = z.infer<typeof slashCommandWireSchema>;

/* ------------------------------------------------------------------ */
/* 3. WebSocket Client/Host Wire Frames                               */
/* ------------------------------------------------------------------ */

/** Client -> Host frame requesting slash command execution. */
export const commandExecuteFrameSchema = z.object({
  type: z.literal("command.execute"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  rawText: z.string(),
  parsed: slashCommandWireSchema.optional(),
  requestId: z.string().optional(),
});
export type CommandExecuteFrame = z.infer<typeof commandExecuteFrameSchema>;

/** Host -> Client frame returning slash command execution outcome. */
export const commandResultFrameSchema = z.object({
  type: z.literal("command.result"),
  command: z.string().min(1),
  success: z.boolean(),
  output: z.string().optional(),
  error: z.string().optional(),
  data: jsonValueSchema.optional(),
  requestId: z.string().optional(),
});
export type CommandResultFrame = z.infer<typeof commandResultFrameSchema>;

/** Small typed payload for hosts returning a swarm command outcome. */
export const swarmCommandResultSchema = z.object({
  action: swarmCommandActionSchema,
  success: z.boolean(),
  agentId: z.string().min(1).optional(),
  message: z.string().optional(),
  data: jsonValueSchema.optional(),
});
export type SwarmCommandResult = z.infer<typeof swarmCommandResultSchema>;

/* ------------------------------------------------------------------ */
/* 4. Slash Command Definition Contracts                              */
/* ------------------------------------------------------------------ */

export interface SlashCommandParam {
  name: string;
  description: string;
  required?: boolean;
  type?: "string" | "number" | "boolean" | "file" | "enum";
  enumValues?: string[];
  defaultValue?: unknown;
}

export interface SlashCommandDefinition {
  name: string; // e.g. "/plan"
  aliases?: string[];
  description: string;
  usage: string;
  category: SlashCommandCategory;
  params?: SlashCommandParam[];
  clientOnly?: boolean;
  requiresHost?: boolean;
}

/* ------------------------------------------------------------------ */
/* 5. Built-in Command Definitions                                      */
/* ------------------------------------------------------------------ */

export const BUILTIN_SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  {
    name: "/plan",
    aliases: ["/p"],
    description: "Switch to Planning Mode, open visual DAG composer, and initialize plan",
    usage: "/plan [goal description] [@file:<path>]",
    category: "planning",
    params: [
      {
        name: "goal",
        description: "Natural language goal for the execution plan",
        required: false,
        type: "string",
      },
    ],
  },
  {
    name: "/goal",
    aliases: ["/g"],
    description: "Set or update the active workspace objective banner",
    usage: "/goal <objective description>",
    category: "planning",
    params: [
      {
        name: "objective",
        description: "Active objective text displayed in header banner",
        required: true,
        type: "string",
      },
    ],
  },
  {
    name: "/schedule",
    aliases: ["/cron"],
    description: "Schedule a one-shot timer or recurring background cron daemon",
    usage: "/schedule <interval|cron> <prompt>",
    category: "system",
    params: [
      {
        name: "timeOrCron",
        description: "Duration (e.g. 300s, 10m) or 5-field cron expression",
        required: true,
        type: "string",
      },
      {
        name: "prompt",
        description: "Instruction prompt executed upon trigger",
        required: true,
        type: "string",
      },
    ],
    requiresHost: true,
  },
  {
    name: "/browse",
    aliases: ["/b"],
    description: "Launch managed Playwright browser session for visual inspection",
    usage: "/browse <url> [--action=screenshot|dom|crawl]",
    category: "execution",
    params: [
      {
        name: "url",
        description: "Target URL to navigate and inspect",
        required: true,
        type: "string",
      },
    ],
    requiresHost: true,
  },
  {
    name: "/learn",
    description: "Extract repository conventions and distill into reusable skill definition",
    usage: "/learn [topic or directory path]",
    category: "context",
    params: [
      {
        name: "topicOrPath",
        description: "Target workspace directory or concept to synthesize into a skill",
        required: false,
        type: "string",
      },
    ],
  },
  {
    name: "/cost",
    aliases: ["/usage"],
    description: "Open Token and Provider Cost Analytics modal dashboard",
    usage: "/cost [--by-model] [--by-day]",
    category: "system",
    clientOnly: true,
  },
  {
    name: "/compact",
    description: "Compress conversation context memory window preserving critical state",
    usage: "/compact [--keep=N] [--summary]",
    category: "context",
    params: [
      {
        name: "keep",
        description: "Number of most recent turns to preserve uncompressed (default: 4)",
        required: false,
        type: "number",
        defaultValue: 4,
      },
    ],
  },
  {
    name: "/clear",
    aliases: ["/reset"],
    description: "Clear active chat transcript and reset scratch state",
    usage: "/clear",
    category: "system",
    clientOnly: true,
  },
  {
    name: "/swarm",
    aliases: ["/sw"],
    description: "Run or manage a coordinated group of supervised agents",
    usage: "/swarm <run|list|tree|inspect|message|pause|resume|stop|focus> [arguments]",
    category: "execution",
    params: [
      {
        name: "action",
        description: "Swarm operation to perform",
        required: true,
        type: "enum",
        enumValues: [
          "run",
          "list",
          "tree",
          "inspect",
          "message",
          "pause",
          "resume",
          "stop",
          "focus",
        ],
      },
      {
        name: "goal",
        description: "Quoted goal used by the run operation",
        required: false,
        type: "string",
      },
      {
        name: "agentId",
        description: "Target agent identifier; @agent mentions are also extracted by the parser",
        required: false,
        type: "string",
      },
    ],
    requiresHost: true,
  },
  {
    name: "/agents",
    aliases: ["/agent-list", "/agent-tree", "/agent-inspect"],
    description: "List agents, show their supervision tree, or inspect an agent",
    usage: "/agents <list|tree|inspect> [agentId] [--recursive]",
    category: "execution",
    params: [
      {
        name: "action",
        description: "Read-only agent operation (defaults to list when omitted)",
        required: false,
        type: "enum",
        enumValues: ["list", "tree", "inspect"],
        defaultValue: "list",
      },
      {
        name: "agentId",
        description: "Agent identifier to inspect",
        required: false,
        type: "string",
      },
      {
        name: "recursive",
        description: "Include descendants when listing or displaying the tree",
        required: false,
        type: "boolean",
        defaultValue: false,
      },
    ],
    requiresHost: true,
  },
  {
    name: "/agent",
    aliases: [
      "/a",
      "/agent-message",
      "/agent-pause",
      "/agent-resume",
      "/agent-stop",
      "/agent-focus",
    ],
    description: "Inspect or control one supervised agent",
    usage: "/agent <inspect|message|pause|resume|stop|focus> <agentId> [message]",
    category: "execution",
    params: [
      {
        name: "action",
        description: "Operation to perform on the target agent",
        required: true,
        type: "enum",
        enumValues: ["inspect", "message", "pause", "resume", "stop", "focus"],
      },
      {
        name: "agentId",
        description: "Target agent identifier; @agent mentions are also extracted by the parser",
        required: true,
        type: "string",
      },
      {
        name: "message",
        description: "Message body for the message operation",
        required: false,
        type: "string",
      },
    ],
    requiresHost: true,
  },
] as const;

/* ------------------------------------------------------------------ */
/* 6. POSIX Tokenizer & Slash Command Lexer                           */
/* ------------------------------------------------------------------ */

function parseFlagValue(val: string): string | number | boolean {
  if (val === "") return "";
  if (val.toLowerCase() === "true") return true;
  if (val.toLowerCase() === "false") return false;
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    return val.slice(1, -1);
  }
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(val) || /^0x[0-9a-fA-F]+$/i.test(val)) {
    const num = Number(val);
    return isNaN(num) ? val : num;
  }
  return val;
}

/**
 * POSIX argument tokenizer with quote and escape support.
 */
function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  const len = input.length;
  let i = 0;

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(input[i])) {
      i++;
    }
    if (i >= len) break;

    let token = "";
    let inQuote: '"' | "'" | null = null;
    let quoteOpenedAt = -1;
    let hadQuote = false;

    while (i < len) {
      const ch = input[i];

      if (inQuote) {
        if (ch === "\\" && i + 1 < len) {
          const next = input[i + 1];
          if (next === inQuote) {
            token += next;
            i += 2;
            continue;
          }
        }
        if (ch === inQuote) {
          inQuote = null;
          hadQuote = true;
          i++;
          if (i >= len || /\s/.test(input[i])) {
            break;
          }
          continue;
        }
        token += ch;
        i++;
      } else {
        if (/\s/.test(ch)) {
          break;
        }
        if (ch === '"' || ch === "'") {
          inQuote = ch;
          quoteOpenedAt = i;
          hadQuote = true;
          i++;
          continue;
        }
        token += ch;
        i++;
      }
    }

    // If quote was left unclosed at end of input, fall back to whitespace tokenization
    if (inQuote !== null) {
      const unclosedText = input.slice(quoteOpenedAt + 1);
      const splitTokens = unclosedText.trim().split(/\s+/).filter(Boolean);
      tokens.push(...splitTokens);
      break;
    }

    if (token.length > 0 || hadQuote) {
      tokens.push(token);
    }
  }

  return tokens;
}

/**
 * Parse raw user input into a structured SlashCommandWire object.
 * Returns null if the input is not a slash command (does not start with '/').
 */
export function parseSlashCommand(input: string): SlashCommandWire | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const tokens = tokenizeCommand(trimmed);
  if (tokens.length === 0) {
    return null;
  }

  const command = tokens[0].toLowerCase();
  const positional: string[] = [];
  const flags: Record<string, string | number | boolean> = {};
  const mentions: CommandMentions = {
    files: [],
    rules: [],
    symbols: [],
    agents: [],
  };

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    // Long flag: --key=val or --flag
    if (token.startsWith("--")) {
      const eqIdx = token.indexOf("=");
      if (eqIdx !== -1) {
        const key = token.slice(2, eqIdx);
        const rawVal = token.slice(eqIdx + 1);
        flags[key] = parseFlagValue(rawVal);
      } else {
        flags[token.slice(2)] = true;
      }
    }
    // Short flag: -f
    else if (token.startsWith("-") && token.length === 2) {
      flags[token.slice(1)] = true;
    }
    // Context mention: @file:<path>
    else if (token.startsWith("@file:")) {
      mentions.files.push(token.slice(6));
    }
    // Context mention: @rule:<name>
    else if (token.startsWith("@rule:")) {
      mentions.rules.push(token.slice(6));
    }
    // Symbol mention: #symbol:<name> or #<name>
    else if (token.startsWith("#symbol:")) {
      mentions.symbols.push(token.slice(8));
    } else if (token.startsWith("#") && token.length > 1) {
      mentions.symbols.push(token.slice(1));
    }
    // Agent mention: @agent:<id>
    else if (token.startsWith("@agent:")) {
      mentions.agents.push(token.slice(7));
    }
    // Positional argument
    else {
      positional.push(token);
    }
  }

  return {
    command,
    positional,
    flags,
    rawInput: trimmed,
    mentions,
  };
}

/**
 * Format a SlashCommandWire back into a canonical invocation string.
 */
export function formatSlashCommand(wire: SlashCommandWire): string {
  const parts: string[] = [wire.command];

  for (const pos of wire.positional) {
    if (pos.includes(" ") || pos.includes('"')) {
      parts.push(`"${pos.replace(/"/g, '\\"')}"`);
    } else {
      parts.push(pos);
    }
  }

  for (const [k, v] of Object.entries(wire.flags)) {
    if (typeof v === "boolean") {
      if (v) parts.push(`--${k}`);
    } else {
      parts.push(`--${k}=${v}`);
    }
  }

  for (const file of wire.mentions.files) parts.push(`@file:${file}`);
  for (const rule of wire.mentions.rules) parts.push(`@rule:${rule}`);
  for (const sym of wire.mentions.symbols) parts.push(`#symbol:${sym}`);
  for (const ag of wire.mentions.agents) parts.push(`@agent:${ag}`);

  return parts.join(" ");
}
