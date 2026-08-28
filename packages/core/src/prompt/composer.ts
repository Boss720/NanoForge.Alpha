/**
 * Context Synthesizer & Prompt Composer.
 *
 * Deterministically constructs structured XML prompts including:
 * - <system> instructions & rules
 * - <workspace_context> (cwd, git branch, environment)
 * - <pinned_files> (critical repository files & schemas)
 * - <scratchpad> (goals, hypotheses, milestones, dirty files)
 * - <tool_output> blocks with status attributes
 */

import type { ToolExecutionResult } from "@nanoforge/protocol";
import type { ChatMessage } from "../providers/types";
import { formatXmlTag, escapeXml } from "./xmlFormatter";
import { serializeScratchpad, type ScratchpadState } from "../compaction/scratchpad";

export interface PinnedFile {
  path: string;
  content: string;
}

export interface PromptContext {
  workspaceRoot?: string;
  systemPrompt?: string;
  defaultRules?: string[];
  pinnedFiles?: PinnedFile[];
  gitBranch?: string;
  scratchpad?: ScratchpadState | string;
  customContext?: Record<string, string>;
}

export const DEFAULT_NANOFORGE_SYSTEM_PROMPT = `You are NanoForge, an expert autonomous AI software engineer and terminal execution kernel.
You solve complex software engineering tasks methodically using reasoning and tools.

Core Operating Principles:
1. ReAct Execution: Reason carefully about each step, formulate hypotheses, take targeted actions, and observe results.
2. Minimal Change: Modify only files and lines necessary to achieve the goal.
3. Verification: Always run tests and verify changes before reporting completion.
4. Scratchpad Maintenance: Keep active goals, milestones, and hypotheses up-to-date.
5. Error Recovery: If a tool execution fails or tests error out, diagnose the root cause and self-correct.`;

export class PromptComposer {
  private readonly _defaultSystemPrompt: string;
  private readonly _defaultRules: string[];
  private readonly _workspaceRoot?: string;

  constructor(options: { workspaceRoot?: string; systemPrompt?: string; defaultRules?: string[] } = {}) {
    this._workspaceRoot = options.workspaceRoot;
    this._defaultSystemPrompt = options.systemPrompt || DEFAULT_NANOFORGE_SYSTEM_PROMPT;
    this._defaultRules = options.defaultRules || [];
  }

  composeSystemPrompt(context: PromptContext = {}): string {
    const blocks: string[] = [];

    // 1. Base System Prompt & Rules
    const systemPromptText = context.systemPrompt || this._defaultSystemPrompt;
    const rules = [...this._defaultRules, ...(context.defaultRules || [])];
    const rulesXml = rules.length > 0
      ? `\n\n<rules>\n${rules.map((r, i) => `  <rule id="${i + 1}">${escapeXml(r)}</rule>`).join("\n")}\n</rules>`
      : "";

    blocks.push(`<system>\n${systemPromptText}${rulesXml}\n</system>`);

    // 2. Workspace Context
    const wsRoot = context.workspaceRoot || this._workspaceRoot;
    if (wsRoot || context.gitBranch || context.customContext) {
      const wsInner: string[] = [];
      if (wsRoot) wsInner.push(`  <cwd>${escapeXml(wsRoot)}</cwd>`);
      if (context.gitBranch) wsInner.push(`  <git_branch>${escapeXml(context.gitBranch)}</git_branch>`);
      if (context.customContext) {
        for (const [k, v] of Object.entries(context.customContext)) {
          wsInner.push(`  <${k}>${escapeXml(v)}</${k}>`);
        }
      }
      blocks.push(`<workspace_context>\n${wsInner.join("\n")}\n</workspace_context>`);
    }

    // 3. Pinned Files Context (@pinned)
    if (context.pinnedFiles && context.pinnedFiles.length > 0) {
      const filesXml = context.pinnedFiles
        .map(
          (f) =>
            `  <file path="${escapeXml(f.path)}">\n${escapeXml(f.content)}\n  </file>`
        )
        .join("\n");
      blocks.push(`<pinned_files>\n${filesXml}\n</pinned_files>`);
    }

    // 4. Scratchpad Context
    if (context.scratchpad) {
      const scratchpadXml = typeof context.scratchpad === "string"
        ? context.scratchpad
        : serializeScratchpad(context.scratchpad);
      blocks.push(scratchpadXml);
    }

    return blocks.join("\n\n");
  }

  formatToolOutput(result: ToolExecutionResult): string {
    const status = result.status;
    const output = result.output || "";
    const error = result.error ? `\n<error>${escapeXml(result.error)}</error>` : "";

    return [
      `<tool_output call_id="${escapeXml(result.callId)}" name="${escapeXml(result.toolName)}" status="${escapeXml(status)}"${result.metadata?.exitCode !== undefined ? ` exit_code="${result.metadata.exitCode}"` : ""}>`,
      output,
      error,
      `</tool_output>`,
    ].filter(Boolean).join("\n");
  }

  assembleTurnMessages(
    history: ChatMessage[],
    currentTurnContext: PromptContext = {}
  ): ChatMessage[] {
    const systemPrompt = this.composeSystemPrompt(currentTurnContext);

    const hasSystem = history.length > 0 && history[0].role === "system";
    if (hasSystem) {
      return [
        { role: "system", content: systemPrompt, cacheControl: { type: "ephemeral" } },
        ...history.slice(1),
      ];
    }

    return [
      { role: "system", content: systemPrompt, cacheControl: { type: "ephemeral" } },
      ...history,
    ];
  }
}
