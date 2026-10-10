/**
 * Step 29AM — signed-in progression read authority.
 * Guest and pre-migration accounts stay on the local save.
 * A canonical or migrated account never displays local level, XP, or reputation
 * while the server document is loading, missing, or invalid.
 * This module does not write the save and does not touch cash.
 */

import {
  CANONICAL_COMPANY_PROGRESSION_SCHEMA_VERSION,
  classifyCanonicalCompanyProgression,
} from './canonicalCompanyProgression';

export const CANONICAL_PROGRESSION_READ_AUTHORITY_ENV = 'CANONICAL_PROGRESSION_READ_AUTHORITY' as const;
export const CANONICAL_PROGRESSION_READ_AUTHORITY_STATUS =
  'CANONICAL_PROGRESSION_READ_AUTHORITY_PASS_INTERNAL_ONLY' as const;
export const PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL = 'PROGRESSION_UI_ELIGIBILITY_STILL_LOCAL' as const;
export const POST_MIGRATION_LOCAL_PROGRESSION_WRITES_NON_AUTHORITATIVE =
  'POST_MIGRATION_LOCAL_PROGRESSION_WRITES_NON_AUTHORITATIVE' as const;
export const POST_CUTOVER_LOCAL_XP_TOAST_NON_AUTHORITATIVE =
  'POST_CUTOVER_LOCAL_XP_TOAST_NON_AUTHORITATIVE' as const;
export const CANONICAL_PROGRESSION_MISSING_AFTER_CUTOVER = 'CANONICAL_PROGRESSION_MISSING_AFTER_CUTOVER' as const;
export const CANONICAL_PROGRESSION_INVALID = 'CANONICAL_PROGRESSION_INVALID' as const;
export const CANONICAL_PROGRESSION_UNSUPPORTED_SCHEMA = 'CANONICAL_PROGRESSION_UNSUPPORTED_SCHEMA' as const;
export const PUBLIC_MIGRATION_UI_UNWIRED = 'PUBLIC_MIGRATION_UI_UNWIRED' as const;

export type ProgressionReadAuthorityClass =
  | 'GUEST_LOCAL'
  | 'SIGNED_IN_LEGACY_LOCAL'
  | 'SIGNED_IN_CANONICAL_SERVER'
  | 'SIGNED_IN_MIGRATION_PENDING'
  | 'SIGNED_IN_CANONICAL_LOADING'
  | 'SIGNED_IN_CANONICAL_UNAVAILABLE'
  | 'UNSUPPORTED';

export type EffectiveProgressionSource =
  | 'LOCAL_GUEST'
  | 'LOCAL_LEGACY'
  | 'CANONICAL_SERVER'
  | 'CANONICAL_CACHE'
  | 'UNAVAILABLE';

export type CanonicalProgressionReadSnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'error' | 'invalid' | 'unsupported';
  uid: string | null;
  doc: Record<string, unknown> | null;
  fromCache: boolean;
  previouslyCanonicalForUid: boolean;
};

export type ProgressionReadAuthorityInput = {
  gateEnabled: boolean;
  auth: 'guest' | 'signed-in' | 'loading';
  uid: string | null;
  snapshot: CanonicalProgressionReadSnapshot;
};

export type EffectiveCompanyProgression = {
  level: number | null;
  xp: number | null;
  xpToNextLevel: number | null;
  totalXp: number | null;
  reputation: number | null;
  source: EffectiveProgressionSource;
  status: 'ready' | 'loading' | 'unavailable';
  authorityClass: ProgressionReadAuthorityClass;
  revision: number | null;
  reason: string | null;
};

export function isCanonicalProgressionReadAuthorityAllowed(input?: { envValue?: string | null }): boolean {
  const raw =
    input && 'envValue' in input
      ? input.envValue
      : typeof process !== 'undefined'
        ? process.env[CANONICAL_PROGRESSION_READ_AUTHORITY_ENV]
        : undefined;
  return raw === 'INTERNAL_TEST';
}

type LocalProgression = {
  level?: number;
  companyLevel?: number;
  xp?: number;
  xpToNextLevel?: number;
  totalXp?: number;
  reputation?: number;
};

function localProjection(
  authorityClass: 'GUEST_LOCAL' | 'SIGNED_IN_LEGACY_LOCAL',
  source: 'LOCAL_GUEST' | 'LOCAL_LEGACY',
  local: LocalProgression | null,
): EffectiveCompanyProgression {
  const level = Math.max(1, local?.level ?? local?.companyLevel ?? 1);
  return {
    level,
    xp: local?.xp ?? 0,
    xpToNextLevel: local?.xpToNextLevel ?? 0,
    totalXp: local?.totalXp ?? local?.xp ?? 0,
    reputation: local?.reputation ?? 0,
    source,
    status: 'ready',
    authorityClass,
    revision: null,
    reason: null,
  };
}

function withheld(
  authorityClass: ProgressionReadAuthorityClass,
  reason: string,
  status: 'loading' | 'unavailable',
): EffectiveCompanyProgression {
  return {
    level: null,
    xp: null,
    xpToNextLevel: null,
    totalXp: null,
    reputation: null,
    source: 'UNAVAILABLE',
    status,
    authorityClass,
    revision: null,
    reason,
  };
}

export function resolveEffectiveCompanyProgression(
  input: ProgressionReadAuthorityInput,
  local: LocalProgression | null,
): EffectiveCompanyProgression {
  if (!input.gateEnabled) {
    return input.auth === 'guest'
      ? localProjection('GUEST_LOCAL', 'LOCAL_GUEST', local)
      : localProjection('SIGNED_IN_LEGACY_LOCAL', 'LOCAL_LEGACY', local);
  }
  if (input.auth === 'guest') return localProjection('GUEST_LOCAL', 'LOCAL_GUEST', local);
  if (input.auth === 'loading' || !input.uid) {
    return withheld('SIGNED_IN_CANONICAL_LOADING', 'AUTH_UNRESOLVED', 'loading');
  }

  const snapshot = input.snapshot.uid === input.uid ? input.snapshot : { ...input.snapshot, status: 'loading' as const, doc: null };
  if (snapshot.status === 'idle' || snapshot.status === 'loading') {
    return withheld('SIGNED_IN_CANONICAL_LOADING', 'CANONICAL_PROGRESSION_LOADING', 'loading');
  }
  if (snapshot.status === 'missing') {
    if (snapshot.previouslyCanonicalForUid) {
      return withheld('SIGNED_IN_CANONICAL_UNAVAILABLE', CANONICAL_PROGRESSION_MISSING_AFTER_CUTOVER, 'unavailable');
    }
    return localProjection('SIGNED_IN_LEGACY_LOCAL', 'LOCAL_LEGACY', local);
  }
  if (snapshot.status === 'error') {
    return withheld('SIGNED_IN_CANONICAL_UNAVAILABLE', 'CANONICAL_PROGRESSION_READ_ERROR', 'unavailable');
  }
  if (snapshot.status === 'unsupported') {
    return withheld('UNSUPPORTED', CANONICAL_PROGRESSION_UNSUPPORTED_SCHEMA, 'unavailable');
  }
  if (snapshot.status === 'invalid' || !snapshot.doc) {
    return withheld('SIGNED_IN_CANONICAL_UNAVAILABLE', CANONICAL_PROGRESSION_INVALID, 'unavailable');
  }

  const classified = classifyCanonicalCompanyProgression(snapshot.doc, input.uid);
  if (classified.authorityClass !== 'SERVER_CANONICAL_PROGRESSION') {
    const reason =
      snapshot.doc.schemaVersion !== CANONICAL_COMPANY_PROGRESSION_SCHEMA_VERSION
        ? CANONICAL_PROGRESSION_UNSUPPORTED_SCHEMA
        : CANONICAL_PROGRESSION_INVALID;
    return withheld('UNSUPPORTED', reason, 'unavailable');
  }
  const state = classified.state;
  return {
    level: state.level,
    xp: state.xp,
    xpToNextLevel: state.xpToNextLevel,
    totalXp: state.totalXp,
    reputation: state.reputation,
    source: snapshot.fromCache ? 'CANONICAL_CACHE' : 'CANONICAL_SERVER',
    status: 'ready',
    authorityClass: 'SIGNED_IN_CANONICAL_SERVER',
    revision: state.progressionRevision,
    reason: null,
  };
}
