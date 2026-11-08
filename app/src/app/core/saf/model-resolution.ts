import { CAPABILITY_TAGS, type CapabilityWeights, type ModelProfile } from '../domain/organization';
import type { ModelProfileReport } from './contracts';

/**
 * The harness's `resolve-step-model` rule (def/core/spec.md, function 4, invariant 3):
 *
 *   Score(m) = Σ_tag capability_m[tag] × step.capabilities[tag]
 *
 * highest score wins; ties break toward the lower `costRank`; then the lexicographically
 * lowest slug. In production the harness is the only authority on this choice (F4-R8); SAI
 * never re-routes. This TypeScript port exists for the deterministic demo runtime and for
 * contract tests against the specification's worked examples.
 */
export function scoreProfile(step: CapabilityWeights, profile: ModelProfile): number {
  let score = 0;
  for (const tag of CAPABILITY_TAGS) {
    score += (profile.capabilities[tag] ?? 0) * (step[tag] ?? 0);
  }
  return score;
}

export function resolveModelProfile(step: CapabilityWeights, catalog: readonly ModelProfile[]): ModelProfileReport {
  if (catalog.length === 0) {
    throw new Error('unroutable: empty model catalog');
  }
  if (!CAPABILITY_TAGS.some((tag) => (step[tag] ?? 0) > 0)) {
    throw new Error('unroutable: all-zero capability weights');
  }
  const ranked = [...catalog]
    .map((profile) => ({ profile, score: scoreProfile(step, profile) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.profile.costRank !== b.profile.costRank) return a.profile.costRank - b.profile.costRank;
      return a.profile.slug < b.profile.slug ? -1 : a.profile.slug > b.profile.slug ? 1 : 0;
    });
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const reason =
    runnerUp && runnerUp.score === winner.score
      ? runnerUp.profile.costRank === winner.profile.costRank
        ? 'tie on score and cost; lexicographically lowest slug'
        : 'tie on score; lower cost rank'
      : 'highest weighted capability score';
  return {
    slug: winner.profile.slug,
    score: winner.score,
    costRank: winner.profile.costRank,
    reason,
  };
}
