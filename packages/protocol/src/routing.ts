/**
 * Multi-model routing contract — Module 5, Task 15.
 *
 * Pure types and scoring helpers only: this module MUST NOT import Node APIs
 * (fs, net, process…) because it is shared between the agent host and the
 * browser control plane. The host-side decision function lives in
 * `apps/agent-host/src/router/router.ts`; everything needed to explain and
 * reproduce a decision is here.
 *
 * Security contract (docs/plans/2026-08-11-agent-platform-modules.md):
 * "A decision records selected model, fallback chain, estimate, and reason;
 * a user pin overrides routing." Routing may optimize quality/cost but must
 * never bypass policy — privacy filtering here is a hard exclusion, not a
 * score penalty.
 */

/**
 * Data-residency class of a model endpoint.
 *
 * Ordered from most to least private: a request with
 * `privacyRequired: "local"` accepts only `"local"` profiles;
 * `privacyRequired: "cloud-eu"` accepts `"cloud-eu"` and `"local"`;
 * `"cloud"` (or no requirement) accepts everything.
 */
export type PrivacyClass = "local" | "cloud-eu" | "cloud";

/** Numeric privacy rank — higher means stricter/more private. */
export const PRIVACY_RANK: Readonly<Record<PrivacyClass, number>> = {
  local: 3,
  "cloud-eu": 2,
  cloud: 1,
};

/** The broad shape of a task, used to weight capability scores. */
export type TaskKind = "planning" | "coding" | "general";

/**
 * Capability tiers in the closed interval [0, 1]:
 * 0 = absent, 0.5 = partial/limited, 1 = full. Boolean tiers map to 0/1.
 *
 * A capability of exactly 0 means "hard requirement fails" when that
 * capability is explicitly needed (e.g. `vision` when `needsVision` is set).
 */
export interface ModelCapabilities {
  planning: number;
  coding: number;
  vision: number;
  toolCalling: number;
}

/** A routable model endpoint known to the host. */
export interface ModelProfile {
  /** Stable unique id, e.g. "gpt-5.2", "ollama/qwen3-coder". */
  id: string;
  /** Provider key, e.g. "openai", "anthropic", "ollama". Used for outage filtering. */
  provider: string;
  capabilities: ModelCapabilities;
  /** USD per 1k input (prompt) tokens. */
  costPer1kInputTokens: number;
  /** USD per 1k output (completion) tokens. */
  costPer1kOutputTokens: number;
  privacyClass: PrivacyClass;
  /** Maximum total context window in tokens (input + output must fit). */
  maxContextTokens: number;
  /** Typical end-to-end latency for a medium request, in milliseconds. */
  typicalLatencyMs: number;
}

/** Rough token volume of the request, used for cost and context checks. */
export interface TokenEstimate {
  input: number;
  output: number;
}

/** Everything the router needs to pick a model. */
export interface RouteRequest {
  /** Broad task shape; weights which capability matters most. */
  kind: TaskKind;
  /** Hard requirement: only profiles with `capabilities.vision > 0` are eligible. */
  needsVision?: boolean;
  tokenEstimate: TokenEstimate;
  /** Soft target: profiles at/under this latency score best; over it, proportionally worse. */
  latencyTargetMs?: number;
  /** Hard requirement: profile privacy rank must be >= this class. */
  privacyRequired?: PrivacyClass;
  /** Soft cap: if any eligible profile fits, only those are considered. */
  costCapUsd?: number;
  /** User-chosen model id; always wins over automatic scoring. */
  pinnedModelId?: string;
}

/**
 * The routing result. `primary` is the model id to call; `fallbacks` are the
 * next-best eligible ids in descending score order (a fallback requires user
 * approval unless pre-approved in the execution plan — see Task 17).
 * `reason` must fully explain the choice: why the primary won, why each
 * fallback follows, and why every excluded profile was excluded.
 */
export interface RouteDecision {
  primary: string;
  fallbacks: string[];
  estimatedCostUsd: number;
  reason: string;
  pinned: boolean;
}

/** Clamp a number into [0, 1]. */
export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Estimated request cost in USD for a profile/token-volume pair. */
export const estimateCostUsd = (
  profile: ModelProfile,
  estimate: TokenEstimate,
): number =>
  (estimate.input / 1000) * profile.costPer1kInputTokens +
  (estimate.output / 1000) * profile.costPer1kOutputTokens;

/** True when the profile's privacy class satisfies the request's requirement. */
export const satisfiesPrivacy = (
  profile: ModelProfile,
  required?: PrivacyClass,
): boolean =>
  required === undefined ||
  PRIVACY_RANK[profile.privacyClass] >= PRIVACY_RANK[required];

/** True when the profile can handle vision input. */
export const isVisionCapable = (profile: ModelProfile): boolean =>
  profile.capabilities.vision > 0;

/** True when the whole estimated request fits the profile's context window. */
export const fitsContext = (
  profile: ModelProfile,
  estimate: TokenEstimate,
): boolean => estimate.input + estimate.output <= profile.maxContextTokens;

/** The capability a task kind leans on most. */
export const PRIMARY_CAPABILITY: Readonly<
  Record<TaskKind, keyof ModelCapabilities>
> = {
  planning: "planning",
  coding: "coding",
  general: "planning",
};

/**
 * Weighted capability score in [0, 1] for a task kind.
 * The kind's primary capability dominates; tool calling always matters
 * because every agent task proposes tools. Vision is only blended in when
 * the request needs it (it is a hard filter there anyway).
 */
export const capabilityScore = (
  caps: ModelCapabilities,
  kind: TaskKind,
  needsVision = false,
): number => {
  const base =
    kind === "coding"
      ? 0.6 * caps.coding + 0.25 * caps.toolCalling + 0.15 * caps.planning
      : kind === "planning"
        ? 0.6 * caps.planning + 0.25 * caps.toolCalling + 0.15 * caps.coding
        : 0.4 * caps.planning + 0.3 * caps.coding + 0.3 * caps.toolCalling;
  return needsVision ? clamp01(0.5 * base + 0.5 * caps.vision) : clamp01(base);
};

/**
 * Latency score in [0, 1]: 1 when at/under the target (or no target given),
 * otherwise proportional overage penalty (`target / typical`).
 */
export const latencyScore = (
  profile: ModelProfile,
  targetMs?: number,
): number =>
  targetMs === undefined || profile.typicalLatencyMs <= targetMs
    ? 1
    : clamp01(targetMs / profile.typicalLatencyMs);

/** Cost score in (0, 1]: 1 for free, decaying hyperbolically with USD cost. */
export const costScore = (
  profile: ModelProfile,
  estimate: TokenEstimate,
): number => 1 / (1 + estimateCostUsd(profile, estimate));

/** Per-factor breakdown of a profile's total score — the explainability unit. */
export interface ScoreBreakdown {
  /** Weighted capability fit for the task kind, [0, 1]. */
  capability: number;
  /** Latency-target fit, [0, 1]. */
  latency: number;
  /** Cheapness fit, (0, 1]. */
  cost: number;
  /** Weighted total, [0, 1]: 60% capability, 20% latency, 20% cost. */
  total: number;
}

/** Composite routing score for an eligible profile. */
export const scoreProfile = (
  profile: ModelProfile,
  request: RouteRequest,
): ScoreBreakdown => {
  const capability = capabilityScore(
    profile.capabilities,
    request.kind,
    request.needsVision,
  );
  const latency = latencyScore(profile, request.latencyTargetMs);
  const cost = costScore(profile, request.tokenEstimate);
  return {
    capability,
    latency,
    cost,
    total: 0.6 * capability + 0.2 * latency + 0.2 * cost,
  };
};
