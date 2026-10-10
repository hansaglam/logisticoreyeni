/**
 * Step 29AE — canonical ROAD contract refresh on the account game clock.
 * Production cooldown is currentTime - lastManualContractRefreshTime >= 3.
 * A manual refresh expires due offers and appends; it does not replace the pool.
 */

import { contractGenerationBalance } from '../config/balance';

export const CANONICAL_ROAD_CONTRACT_REFRESH_AUTHORITY_ENV =
  'CANONICAL_ROAD_CONTRACT_REFRESH_AUTHORITY' as const;

export const CANONICAL_ROAD_CONTRACT_REFRESH_POLICY_VERSION =
  'canonical-road-contract-refresh-game-time-v1' as const;

export const CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V5 =
  'canonical-road-contract-issuance-internal-production-parity-v5' as const;

export const CANONICAL_ROAD_CONTRACT_REFRESH_COLLECTION =
  'canonicalRoadContractRefresh' as const;

export const CANONICAL_ROAD_CONTRACT_REFRESH_DOC_ID = 'current' as const;

export const CANONICAL_ROAD_CONTRACT_REFRESH_RECEIPT_COLLECTION =
  'canonicalRoadContractRefreshReceipts' as const;

export const CANONICAL_ROAD_CONTRACT_REFRESH_SCHEMA_VERSION = 1 as const;

export const CONTRACT_REFRESH_GAME_TIME_PARITY_STATUS =
  'CONTRACT_REFRESH_GAME_TIME_PARITY_PASS_INTERNAL_ONLY' as const;

export const REFRESH_AD_OVERRIDE_CLASSIFICATION =
  'REFRESH_AD_OVERRIDE_BLOCKED_VERIFICATION' as const;

/** Production adds at most this many offers on a manual refresh. */
export const CANONICAL_MANUAL_REFRESH_MAX_CONTRACTS =
  contractGenerationBalance.manualRefreshMaxContracts;

export const CANONICAL_MANUAL_REFRESH_COOLDOWN_GAME_HOURS =
  contractGenerationBalance.manualRefreshCooldownHours;

export interface CanonicalRoadContractRefreshState {
  schemaVersion: typeof CANONICAL_ROAD_CONTRACT_REFRESH_SCHEMA_VERSION;
  policyVersion: typeof CANONICAL_ROAD_CONTRACT_REFRESH_POLICY_VERSION;
  refreshSequence: number;
  lastRefreshGameHours: number;
  lastBatchId: string;
  lastRefreshAtServerMs: number;
  authorityMode: 'INTERNAL_TEST';
}

export function isCanonicalRoadContractRefreshAllowed(input?: {
  envValue?: string | null;
}): boolean {
  const raw =
    input && 'envValue' in input
      ? input.envValue
      : typeof process !== 'undefined'
        ? process.env[CANONICAL_ROAD_CONTRACT_REFRESH_AUTHORITY_ENV]
        : undefined;
  return raw === 'INTERNAL_TEST';
}

export function canonicalRefreshBatchId(uid: string, refreshSequence: number): string {
  return `rcbatch_${uid}_r${refreshSequence}`;
}

export function canonicalRefreshOfferId(
  uid: string,
  refreshSequence: number,
  slotIndex: number,
): string {
  return `rcprod_${uid}_r${refreshSequence}_${slotIndex}`;
}

export function canonicalRefreshSeed(
  uid: string,
  refreshSequence: number,
  marketEpoch: number,
): string {
  return `${CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V5}|${uid}|${refreshSequence}|${marketEpoch}`;
}

/**
 * Production blocks when hoursSince < cooldown, so eligibility is inclusive at 3.
 */
export function isCanonicalRefreshEligible(input: {
  currentGameHours: number;
  lastRefreshGameHours: number;
}): boolean {
  return (
    input.currentGameHours - input.lastRefreshGameHours >=
    CANONICAL_MANUAL_REFRESH_COOLDOWN_GAME_HOURS
  );
}

export function canonicalRefreshRemainingGameHours(input: {
  currentGameHours: number;
  lastRefreshGameHours: number;
}): number {
  const elapsed = input.currentGameHours - input.lastRefreshGameHours;
  return Math.max(0, CANONICAL_MANUAL_REFRESH_COOLDOWN_GAME_HOURS - elapsed);
}

export function validateCanonicalRoadContractRefreshState(
  raw: unknown,
): { ok: true; state: CanonicalRoadContractRefreshState } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'CONTRACT_REFRESH_STATE_INVALID' };
  }
  const data = raw as Partial<CanonicalRoadContractRefreshState>;
  if (
    data.schemaVersion !== CANONICAL_ROAD_CONTRACT_REFRESH_SCHEMA_VERSION ||
    data.policyVersion !== CANONICAL_ROAD_CONTRACT_REFRESH_POLICY_VERSION ||
    typeof data.refreshSequence !== 'number' ||
    !Number.isInteger(data.refreshSequence) ||
    data.refreshSequence < 0 ||
    typeof data.lastRefreshGameHours !== 'number' ||
    !Number.isFinite(data.lastRefreshGameHours) ||
    typeof data.lastBatchId !== 'string' ||
    data.lastBatchId.length === 0 ||
    typeof data.lastRefreshAtServerMs !== 'number' ||
    data.authorityMode !== 'INTERNAL_TEST'
  ) {
    return { ok: false, reason: 'CONTRACT_REFRESH_STATE_INVALID' };
  }
  return { ok: true, state: data as CanonicalRoadContractRefreshState };
}

const REFRESH_REQUEST_KEYS = new Set(['canonicalSchemaVersion', 'refreshIntentId']);

const FORBIDDEN_REFRESH_KEYS = [
  'gameTime',
  'currentTime',
  'elapsedGameHours',
  'lastRefresh',
  'lastRefreshGameHours',
  'cooldown',
  'cooldownRemaining',
  'canRefresh',
  'eligible',
  'refreshSequence',
  'refreshIndex',
  'seed',
  'rngSeed',
  'payment',
  'deadline',
] as const;

export function hasOnlyCanonicalRoadRefreshKeys(data: Record<string, unknown>): boolean {
  if (FORBIDDEN_REFRESH_KEYS.some((key) => key in data)) return false;
  return Object.keys(data).every((key) => REFRESH_REQUEST_KEYS.has(key));
}

export function parseCanonicalRefreshIntentId(
  value: unknown,
): { ok: true; intentId: string } | { ok: false; reason: string } {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{8,80}$/.test(value)) {
    return { ok: false, reason: 'CONTRACT_REFRESH_INTENT_INVALID' };
  }
  return { ok: true, intentId: value };
}

/** Production manual refresh keeps still-valid available offers. */
export const PRODUCTION_MANUAL_REFRESH_REPLACES_AVAILABLE_OFFERS = false as const;
