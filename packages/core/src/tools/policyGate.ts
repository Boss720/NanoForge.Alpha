/**
 * 4-Tier Risk Policy Gate & Approval Engine.
 *
 * Enforces permission checks across T0 (Read-only), T1 (Workspace write),
 * T2 (Side-effect guarded), and T3 (Destructive admin), with interactive approval hooks.
 */

import {
  RISK_TIER_RANK,
  type ApprovalRequest,
  type PermissionDecision,
  type ProposedToolCall,
  type ToolRiskTier,
} from "@nanoforge/protocol";

export interface PolicyGateOptions {
  autoApproveUpTo?: ToolRiskTier;
  allowedTools?: string[];
  deniedTools?: string[];
  interactiveApprovalHandler?: (request: ApprovalRequest) => Promise<boolean>;
  checkpointHook?: (call: ProposedToolCall) => Promise<string | void>;
}

export class PolicyGate {
  private readonly _autoApproveUpTo: ToolRiskTier;
  private readonly _allowedTools: Set<string>;
  private readonly _deniedTools: Set<string>;
  private readonly _interactiveApprovalHandler?: (request: ApprovalRequest) => Promise<boolean>;
  private readonly _checkpointHook?: (call: ProposedToolCall) => Promise<string | void>;

  constructor(options: PolicyGateOptions = {}) {
    this._autoApproveUpTo = options.autoApproveUpTo ?? "T0_READ_ONLY";
    this._allowedTools = new Set(options.allowedTools ?? []);
    this._deniedTools = new Set(options.deniedTools ?? []);
    this._interactiveApprovalHandler = options.interactiveApprovalHandler;
    this._checkpointHook = options.checkpointHook;
  }

  get autoApproveUpTo(): ToolRiskTier {
    return this._autoApproveUpTo;
  }

  isAutoApproved(tier: ToolRiskTier): boolean {
    return RISK_TIER_RANK[tier] <= RISK_TIER_RANK[this._autoApproveUpTo];
  }

  async evaluate(call: ProposedToolCall, runId = "run_default"): Promise<PermissionDecision> {
    const toolName = call.toolName;

    // 1. Explicit deny list (highest priority)
    if (this._deniedTools.has(toolName)) {
      return {
        verdict: "DENY",
        reason: `Tool "${toolName}" is explicitly prohibited by security policy.`,
      };
    }

    // 2. Explicit allow list
    if (this._allowedTools.has(toolName)) {
      return {
        verdict: "ALLOW_ALWAYS",
        reason: `Tool "${toolName}" is explicitly allowed by whitelist.`,
        matchedRule: "whitelist",
      };
    }

    // 3. Check risk tier threshold
    const tier = call.riskTier;
    if (this.isAutoApproved(tier)) {
      // Check if checkpointing is required for T1 writes
      if (tier === "T1_WORKSPACE_WRITE" && this._checkpointHook && call.checkpointRequired) {
        try {
          await this._checkpointHook(call);
        } catch {
          // Checkpoint failure shouldn't crash if non-fatal
        }
      }

      return {
        verdict: "ALLOW_ALWAYS",
        reason: `Risk tier "${tier}" is auto-approved under threshold "${this._autoApproveUpTo}".`,
        matchedRule: `auto_approve_${this._autoApproveUpTo}`,
      };
    }

    // 4. Higher risk tier requires interactive authorization
    if (this._interactiveApprovalHandler) {
      const request: ApprovalRequest = {
        requestId: `appr_${crypto.randomUUID()}`,
        runId,
        toolCall: call,
        reason: `Tool "${toolName}" (Tier: ${tier}) exceeds auto-approval threshold "${this._autoApproveUpTo}".`,
        at: new Date().toISOString(),
      };

      try {
        const approved = await this._interactiveApprovalHandler(request);
        if (approved) {
          return {
            verdict: "ALLOW_ONCE",
            reason: `User granted approval for tool "${toolName}".`,
          };
        } else {
          return {
            verdict: "DENY",
            reason: `User denied approval for tool "${toolName}".`,
          };
        }
      } catch (err: any) {
        return {
          verdict: "DENY",
          reason: `Interactive approval handler failed: ${err.message || String(err)}`,
        };
      }
    }

    // Default when no interactive handler is configured
    return {
      verdict: "PROMPT_USER",
      promptMessage: `Tool "${toolName}" with risk level ${tier} requires confirmation.`,
      defaultAction: "DENY",
      suggestedScope: "turn",
    };
  }
}
