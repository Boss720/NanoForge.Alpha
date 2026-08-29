/**
 * Routing decision function — Module 5, Task 15 (host side).
 *
 * Pure decision logic over injected {@link ModelProfile} data; no I/O, no
 * provider calls. All scoring math lives in `@protocol/routing` so a decision
 * is fully reproducible from `(request, profiles, options)` alone.
 *
 * Guarantees (per the plan's security contract):
 * - A user pin always wins (`pinned: true`), even over hard filters — the
 *   user is the authority; automatic candidates still fill the fallback list.
 * - Privacy violations, missing required capabilities, context overflow, and
 *   unavailable providers are HARD exclusions, never score penalties.
 * - Every decision carries a human-readable `reason` explaining the primary,
 *   each fallback, and every exclusion.
 */

import {
  PRIMARY_CAPABILITY,
  estimateCostUsd,
  fitsContext,
  isVisionCapable,
  satisfiesPrivacy,
  scoreProfile,
  type ModelProfile,
  type RouteDecision,
  type RouteRequest,
  type ScoreBreakdown,
} from "@protocol/routing";

/** Options for a routing call. */
export interface RouteOptions {
  /**
   * Providers currently down/unreachable (e.g. `["openai"]`). Their profiles
   * are excluded and the decision falls back to the next-best provider.
   * Accepts any iterable, e.g. a `Set<string>`.
   */
  unavailableProviders?: Iterable<string>;
}

interface Scored {
  profile: ModelProfile;
  score: ScoreBreakdown;
  costUsd: number;
}

const fmtUsd = (n: number): string => `$${n.toFixed(4)}`;
const fmtScore = (s: ScoreBreakdown): string =>
  `${s.total.toFixed(2)} (capability ${s.capability.toFixed(2)}, latency ${s.latency.toFixed(2)}, cost ${s.cost.toFixed(2)})`;

/** Deterministic ordering: score desc, then cheaper, then id. */
const byScoreDesc = (a: Scored, b: Scored): number =>
  b.score.total - a.score.total ||
  a.costUsd - b.costUsd ||
  a.profile.id.localeCompare(b.profile.id);

/**
 * Hard-filter `profiles` for everything except the cost cap, recording a
 * human-readable exclusion reason for every dropped profile.
 */
function hardFilter(
  request: RouteRequest,
  profiles: readonly ModelProfile[],
  unavailable: ReadonlySet<string>,
): { eligible: ModelProfile[]; exclusions: string[] } {
  const eligible: ModelProfile[] = [];
  const exclusions: string[] = [];
  const requiredCap = PRIMARY_CAPABILITY[request.kind];

  for (const p of profiles) {
    const why: string[] = [];
    if (unavailable.has(p.provider)) why.push(`provider "${p.provider}" unavailable`);
    if (!satisfiesPrivacy(p, request.privacyRequired))
      why.push(`privacy ${p.privacyClass} below required ${request.privacyRequired}`);
    if (request.needsVision && !isVisionCapable(p)) why.push("no vision capability");
    if (p.capabilities[requiredCap] <= 0)
      why.push(`no ${requiredCap} capability for task kind "${request.kind}"`);
    if (!fitsContext(p, request.tokenEstimate))
      why.push(
        `estimated ${request.tokenEstimate.input + request.tokenEstimate.output} tokens exceed context ${p.maxContextTokens}`,
      );
    if (why.length > 0) exclusions.push(`${p.id}: ${why.join("; ")}`);
    else eligible.push(p);
  }
  return { eligible, exclusions };
}

const scoreAll = (request: RouteRequest, profiles: readonly ModelProfile[]): Scored[] =>
  profiles
    .map((profile) => ({
      profile,
      score: scoreProfile(profile, request),
      costUsd: estimateCostUsd(profile, request.tokenEstimate),
    }))
    .sort(byScoreDesc);

const decisionFrom = (
  primary: Scored,
  fallbacks: Scored[],
  pinned: boolean,
  reason: string,
): RouteDecision => ({
  primary: primary.profile.id,
  fallbacks: fallbacks.map((f) => f.profile.id),
  estimatedCostUsd: primary.costUsd,
  reason,
  pinned,
});

/**
 * Pick a model for `request` from `profiles`.
 *
 * @throws if `profiles` is empty, if a pinned model id is unknown, or if no
 *   profile survives the hard filters (the error message lists why).
 */
export function route(
  request: RouteRequest,
  profiles: readonly ModelProfile[],
  options: RouteOptions = {},
): RouteDecision {
  if (profiles.length === 0) throw new Error("route: no model profiles provided");
  const unavailable = new Set(options.unavailableProviders ?? []);

  // --- User pin: always wins, even over hard filters. ---
  if (request.pinnedModelId !== undefined) {
    const pinnedProfile = profiles.find((p) => p.id === request.pinnedModelId);
    if (!pinnedProfile)
      throw new Error(
        `route: pinned model "${request.pinnedModelId}" is not in the profile list (${profiles
          .map((p) => p.id)
          .join(", ")})`,
      );
    const { eligible, exclusions } = hardFilter(
      request,
      profiles.filter((p) => p.id !== pinnedProfile.id),
      unavailable,
    );
    const fallbackPool = scoreAll(request, eligible);
    const pinnedScored: Scored = {
      profile: pinnedProfile,
      score: scoreProfile(pinnedProfile, request),
      costUsd: estimateCostUsd(pinnedProfile, request.tokenEstimate),
    };
    const reason = [
      `primary=${pinnedProfile.id} pinned by user (automatic score would be ${fmtScore(pinnedScored.score)}, est ${fmtUsd(pinnedScored.costUsd)}); the pin always wins over routing.`,
      fallbackPool.length > 0
        ? `fallbacks if the pin fails: ${fallbackPool
            .map((f) => `${f.profile.id} [${fmtScore(f.score)}, est ${fmtUsd(f.costUsd)}]`)
            .join(", ")}.`
        : "no automatic fallbacks available.",
      exclusions.length > 0 ? `excluded: ${exclusions.join(" | ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return decisionFrom(pinnedScored, fallbackPool, true, reason);
  }

  // --- Automatic routing. ---
  const { eligible, exclusions } = hardFilter(request, profiles, unavailable);
  if (eligible.length === 0)
    throw new Error(
      `route: no eligible model for ${request.kind} request. Excluded: ${exclusions.join(" | ") || "none"}`,
    );

  // Cost cap: soft filter — prefer profiles within cap; if none fit, keep all
  // and say so in the reason rather than failing the request.
  let candidates = eligible;
  let capNote = "";
  if (request.costCapUsd !== undefined) {
    const within = eligible.filter(
      (p) => estimateCostUsd(p, request.tokenEstimate) <= request.costCapUsd!,
    );
    if (within.length > 0 && within.length < eligible.length) {
      const demoted = eligible.filter((p) => !within.includes(p));
      candidates = within;
      capNote = `cost cap ${fmtUsd(request.costCapUsd)} applied: demoted ${demoted
        .map((p) => `${p.id} (est ${fmtUsd(estimateCostUsd(p, request.tokenEstimate))})`)
        .join(", ")}.`;
    } else if (within.length === 0) {
      capNote = `cost cap ${fmtUsd(request.costCapUsd)} cannot be met by any eligible profile; routing anyway.`;
    }
  }

  const ranked = scoreAll(request, candidates);
  const [primary, ...fallbacks] = ranked;
  const reason = [
    `primary=${primary.profile.id} [score ${fmtScore(primary.score)}, est ${fmtUsd(primary.costUsd)}, provider ${primary.profile.provider}].`,
    fallbacks.length > 0
      ? `fallbacks: ${fallbacks
          .map((f) => `${f.profile.id} [${fmtScore(f.score)}, est ${fmtUsd(f.costUsd)}]`)
          .join(", ")}.`
      : "no fallbacks available.",
    capNote,
    exclusions.length > 0 ? `excluded: ${exclusions.join(" | ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return decisionFrom(primary, fallbacks, false, reason);
}
