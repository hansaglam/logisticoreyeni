/**
 * Canonical ROAD offer expiry clock (Map V2 Step 29AD).
 *
 * Production `currentTime` is account-global game hours.
 * Offer `expiresAt` is that same unit. Delivery `deadlineHours` is not this clock.
 * Manual refresh stays out of scope.
 * Pure. No React. No Firebase.
 */

import { realMsToGameHours, simulationTimeScale } from '../config/balance';
import {
  MAX_OFFLINE_PROGRESS_HOURS,
  MAX_OFFLINE_PROGRESS_MS,
} from '../simulation/offlineProgression';

export const CONTRACT_GAME_TIME_EXPIRY_AUTHORITY_STATUS =
  'CONTRACT_GAME_TIME_EXPIRY_AUTHORITY_PASS_INTERNAL_ONLY' as const;

export const CANONICAL_CONTRACT_EXPIRY_AUTHORITY_ENV =
  'CANONICAL_ROAD_CONTRACT_GAME_TIME_EXPIRY' as const;

export const CANONICAL_CONTRACT_EXPIRY_POLICY_VERSION =
  'canonical-road-contract-expiry-game-clock-internal-v1' as const;

export const CANONICAL_CONTRACT_CLOCK_COLLECTION = 'canonicalContractClock' as const;
export const CANONICAL_CONTRACT_CLOCK_DOC_ID = 'current' as const;
export const CANONICAL_CONTRACT_CLOCK_SCHEMA_VERSION = 1 as const;

export const CONTRACT_REFRESH_GAME_TIME_PARITY =
  'CONTRACT_REFRESH_GAME_TIME_PARITY_PASS_INTERNAL_ONLY' as const;

/** Production online pause stops accrual. Background catch-up while paused is still client app-state. */
export const CONTRACT_EXPIRY_BACKGROUND_CLASS =
  'INTERNAL_ONLINE_PAUSE_STOPS_ACCRUAL_BACKGROUND_WHILE_PAUSED_NOT_PUBLIC' as const;

export const GLOBAL_GAME_CLOCK_RECOMMENDATION = 'YES' as const;

export type CanonicalContractClockAuthorityClass = 'INTERNAL_TEST_CONTRACT_CLOCK';

export type CanonicalContractClockState = {
  schemaVersion: typeof CANONICAL_CONTRACT_CLOCK_SCHEMA_VERSION;
  policyVersion: typeof CANONICAL_CONTRACT_EXPIRY_POLICY_VERSION;
  currentGameHours: number;
  lastAdvancedAtServerMs: number;
  gameSpeed: number;
  manualPaused: boolean;
  clockRevision: number;
  authorityClass: CanonicalContractClockAuthorityClass;
};

const MIN_GAME_SPEED = 0.25;

export function resolveCanonicalContractExpiryGate(options?: {
  envValue?: string | null;
}): 'OFF' | 'INTERNAL_TEST' {
  return options?.envValue === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalContractExpiryAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalContractExpiryGate(options) === 'INTERNAL_TEST';
}

export function createInitialCanonicalContractClock(serverNowMs: number): CanonicalContractClockState {
  return {
    schemaVersion: CANONICAL_CONTRACT_CLOCK_SCHEMA_VERSION,
    policyVersion: CANONICAL_CONTRACT_EXPIRY_POLICY_VERSION,
    currentGameHours: 0,
    lastAdvancedAtServerMs: serverNowMs,
    gameSpeed: 1,
    manualPaused: false,
    clockRevision: 1,
    authorityClass: 'INTERNAL_TEST_CONTRACT_CLOCK',
  };
}

export function validateCanonicalContractClockState(
  value: unknown,
): { ok: true; state: CanonicalContractClockState } | { ok: false; reason: 'CONTRACT_CLOCK_STATE_INVALID' } {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
  const row = value as Partial<CanonicalContractClockState>;
  if (row.schemaVersion !== CANONICAL_CONTRACT_CLOCK_SCHEMA_VERSION) {
    return { ok: false, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
  }
  if (row.policyVersion !== CANONICAL_CONTRACT_EXPIRY_POLICY_VERSION) {
    return { ok: false, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
  }
  if (row.authorityClass !== 'INTERNAL_TEST_CONTRACT_CLOCK') {
    return { ok: false, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
  }
  if (!Number.isFinite(row.currentGameHours) || (row.currentGameHours ?? -1) < 0) {
    return { ok: false, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
  }
  if (!Number.isFinite(row.lastAdvancedAtServerMs)) {
    return { ok: false, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
  }
  if (!Number.isFinite(row.gameSpeed) || (row.gameSpeed ?? 0) < MIN_GAME_SPEED || (row.gameSpeed ?? 0) > simulationTimeScale.maxGameSpeed) {
    return { ok: false, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
  }
  if (typeof row.manualPaused !== 'boolean') return { ok: false, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
  if (!Number.isInteger(row.clockRevision) || (row.clockRevision ?? 0) < 1) {
    return { ok: false, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
  }
  return { ok: true, state: row as CanonicalContractClockState };
}

function nextClock(
  state: CanonicalContractClockState,
  patch: Partial<CanonicalContractClockState>,
): CanonicalContractClockState {
  return {
    ...state,
    ...patch,
    clockRevision: state.clockRevision + 1,
  };
}

/**
 * Lazy advance from the last server timestamp.
 * Paused intervals add no game hours.
 * A gap uses the production offline cap: 24 real hours, then 24 game hours.
 * A server timestamp behind the cursor does not rewind game time.
 */
export function advanceCanonicalContractClock(
  state: CanonicalContractClockState,
  serverNowMs: number,
): { ok: true; state: CanonicalContractClockState } | { ok: false; reason: 'CONTRACT_CLOCK_STATE_INVALID' } {
  const validated = validateCanonicalContractClockState(state);
  if (!validated.ok) return validated;
  if (!Number.isFinite(serverNowMs)) return { ok: false, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
  const current = validated.state;
  if (serverNowMs <= current.lastAdvancedAtServerMs) return { ok: true, state: current };
  if (current.manualPaused) {
    return {
      ok: true,
      state: nextClock(current, { lastAdvancedAtServerMs: serverNowMs }),
    };
  }
  const rawMs = serverNowMs - current.lastAdvancedAtServerMs;
  const appliedMs = Math.min(rawMs, MAX_OFFLINE_PROGRESS_MS);
  const gameHours = Math.min(
    realMsToGameHours(appliedMs, current.gameSpeed),
    MAX_OFFLINE_PROGRESS_HOURS,
  );
  return {
    ok: true,
    state: nextClock(current, {
      currentGameHours: current.currentGameHours + gameHours,
      lastAdvancedAtServerMs: serverNowMs,
    }),
  };
}

export function setCanonicalContractClockSpeed(
  state: CanonicalContractClockState,
  gameSpeed: number,
  serverNowMs: number,
): { ok: true; state: CanonicalContractClockState } | { ok: false; reason: string } {
  if (!Number.isFinite(gameSpeed) || gameSpeed < MIN_GAME_SPEED || gameSpeed > simulationTimeScale.maxGameSpeed) {
    return { ok: false, reason: 'UNSUPPORTED_GAME_SPEED' };
  }
  const settled = advanceCanonicalContractClock(state, serverNowMs);
  if (!settled.ok) return settled;
  if (settled.state.gameSpeed === gameSpeed) return settled;
  return {
    ok: true,
    state: nextClock(settled.state, { gameSpeed, lastAdvancedAtServerMs: serverNowMs }),
  };
}

export function setCanonicalContractClockPaused(
  state: CanonicalContractClockState,
  manualPaused: boolean,
  serverNowMs: number,
): { ok: true; state: CanonicalContractClockState } | { ok: false; reason: string } {
  if (typeof manualPaused !== 'boolean') return { ok: false, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
  const settled = advanceCanonicalContractClock(state, serverNowMs);
  if (!settled.ok) return settled;
  if (settled.state.manualPaused === manualPaused) return settled;
  return {
    ok: true,
    state: nextClock(settled.state, {
      manualPaused,
      lastAdvancedAtServerMs: serverNowMs,
    }),
  };
}

/** Production comparison is `currentTime >= contract.expiresAt`. */
export function isCanonicalOfferExpiredAtGameHours(
  currentGameHours: number,
  expiresAtGameHours: number,
): boolean {
  return currentGameHours >= expiresAtGameHours;
}

export function hasOnlyCanonicalContractClockSpeedKeys(data: Record<string, unknown>): boolean {
  const allowed = new Set(['canonicalSchemaVersion', 'gameSpeed']);
  return Object.keys(data).every((key) => allowed.has(key)) && !('serverNowMs' in data) && !('elapsedGameHours' in data);
}

export function hasOnlyCanonicalContractClockPauseKeys(data: Record<string, unknown>): boolean {
  const allowed = new Set(['canonicalSchemaVersion', 'paused']);
  return Object.keys(data).every((key) => allowed.has(key)) && !('serverNowMs' in data);
}
