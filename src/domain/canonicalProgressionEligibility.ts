/**
 * Step 29AN — client eligibility read authority for company level and reputation.
 * This is not server authorization. Guest and pre-migration accounts stay local.
 * A canonical account does not unlock from the local save while the projection
 * is loading, missing, or invalid.
 */

import {
  isCanonicalProgressionReadAuthorityAllowed,
  type EffectiveCompanyProgression,
  type EffectiveProgressionSource,
} from './canonicalProgressionReadAuthority';

export const CANONICAL_PROGRESSION_ELIGIBILITY_POLICY_VERSION =
  'canonical-progression-eligibility-read-v1' as const;

export const CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_ENV =
  'CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY' as const;

export const CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_STATUS =
  'CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_PASS_PARTIAL' as const;

export const PROGRESSION_ELIGIBILITY_READINESS = 'PROGRESSION_ELIGIBILITY_INTERNAL_PARTIAL' as const;

export const CONTRACTS_ELIGIBILITY_BLOCKED_LOCAL_CONTRACT_SOURCE =
  'CONTRACTS_ELIGIBILITY_BLOCKED_LOCAL_CONTRACT_SOURCE' as const;

export const PROGRESSION_ELIGIBILITY_BLOCKED_ECONOMY_PARITY =
  'PROGRESSION_ELIGIBILITY_BLOCKED_ECONOMY_PARITY' as const;

export const ELIGIBILITY_LOADING = 'DISABLED_LOADING' as const;
export const ELIGIBILITY_UNAVAILABLE = 'ELIGIBILITY_UNAVAILABLE' as const;

export const SHOP_ELIGIBILITY_CLIENT_GATE = 'SWITCHED_CANONICAL' as const;
export const WAREHOUSE_ELIGIBILITY_CLIENT_GATE = 'SWITCHED_CANONICAL' as const;

export type EligibilitySwitchResult =
  | 'SWITCHED_CANONICAL'
  | 'KEPT_LOCAL_LEGACY'
  | 'BLOCKED_LOCAL_DOMAIN'
  | 'BLOCKED_SERVER_PARITY'
  | 'NOT_PROGRESSION_ELIGIBILITY';

export type EffectiveProgressionEligibility = {
  level: number | null;
  reputation: number | null;
  source: EffectiveProgressionSource;
  status: 'ready' | 'loading' | 'unavailable';
  canEvaluate: boolean;
  reason: string | null;
};

export function isCanonicalProgressionEligibilityAllowed(input?: {
  envValue?: string | null;
  readGateEnabled?: boolean;
}): boolean {
  const raw =
    input && 'envValue' in input
      ? input.envValue
      : typeof process !== 'undefined'
        ? process.env[CANONICAL_PROGRESSION_ELIGIBILITY_AUTHORITY_ENV]
        : undefined;
  const readGate =
    input && 'readGateEnabled' in input
      ? input.readGateEnabled === true
      : isCanonicalProgressionReadAuthorityAllowed();
  return raw === 'INTERNAL_TEST' && readGate;
}

export function resolveProgressionEligibilityAuthority(input: {
  eligibilityGateEnabled: boolean;
  progression: EffectiveCompanyProgression;
  localLevel: number;
  localReputation: number;
}): EffectiveProgressionEligibility {
  const localLevel = Math.max(1, Number.isFinite(input.localLevel) ? input.localLevel : 1);
  const localReputation = Number.isFinite(input.localReputation) ? input.localReputation : 0;
  if (!input.eligibilityGateEnabled) {
    const source: EffectiveProgressionSource =
      input.progression.authorityClass === 'GUEST_LOCAL' ? 'LOCAL_GUEST' : 'LOCAL_LEGACY';
    return {
      level: localLevel,
      reputation: localReputation,
      source,
      status: 'ready',
      canEvaluate: true,
      reason: null,
    };
  }
  if (
    input.progression.status !== 'ready' ||
    input.progression.level == null ||
    input.progression.reputation == null
  ) {
    return {
      level: null,
      reputation: null,
      source: 'UNAVAILABLE',
      status: input.progression.status === 'loading' ? 'loading' : 'unavailable',
      canEvaluate: false,
      reason: input.progression.status === 'loading' ? ELIGIBILITY_LOADING : ELIGIBILITY_UNAVAILABLE,
    };
  }
  return {
    level: input.progression.level,
    reputation: input.progression.reputation,
    source: input.progression.source,
    status: 'ready',
    canEvaluate: true,
    reason: null,
  };
}
