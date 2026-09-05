import type { ChallengeDefinition, ChallengeProgress } from '../seasons/types';

/** Display-only projection. Canonical claim eligibility is always recomputed by backend. */
export function evaluateChallengeProgress(
  definition: ChallengeDefinition,
  periodKey: string,
  rawCurrent: number,
  claimedAt?: number,
): ChallengeProgress {
  const current = Math.max(
    0,
    Math.min(definition.target, Math.floor(Number.isFinite(rawCurrent) ? rawCurrent : 0)),
  );
  return {
    challengeId: definition.id,
    periodKey,
    current,
    target: definition.target,
    completed: current >= definition.target,
    claimed: Number.isFinite(claimedAt),
    ...(Number.isFinite(claimedAt) ? { claimedAt } : {}),
  };
}
