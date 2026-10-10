/**
 * Server mutations for the INTERNAL contract-offer clock.
 * The client cannot send a timestamp or elapsed hours.
 */
import type { Firestore } from 'firebase-admin/firestore';

import {
  CANONICAL_CONTRACT_CLOCK_COLLECTION,
  CANONICAL_CONTRACT_CLOCK_DOC_ID,
  CANONICAL_CONTRACT_CLOCK_SCHEMA_VERSION,
  advanceCanonicalContractClock,
  createInitialCanonicalContractClock,
  isCanonicalContractExpiryAllowed,
  setCanonicalContractClockPaused,
  setCanonicalContractClockSpeed,
  validateCanonicalContractClockState,
} from '../../src/domain/canonicalContractGameTimeExpiry';
import { isAuthenticatedUid } from './canonicalCashTransaction';

function clockPath(uid: string): string {
  return `users/${uid}/${CANONICAL_CONTRACT_CLOCK_COLLECTION}/${CANONICAL_CONTRACT_CLOCK_DOC_ID}`;
}

export async function advanceCanonicalContractClockTransaction(
  firestore: Firestore,
  uid: string,
  schemaVersion: number,
  serverNowMs: number,
  options?: { envValue?: string | null },
): Promise<{ ok: true; currentGameHours: number; clockRevision: number } | { ok: false; reason: string }> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalContractExpiryAllowed(options)) {
    return { ok: false, reason: 'CONTRACT_GAME_TIME_EXPIRY_AUTHORITY_OFF' };
  }
  if (schemaVersion !== CANONICAL_CONTRACT_CLOCK_SCHEMA_VERSION) {
    return { ok: false, reason: 'UNSUPPORTED_SCHEMA_VERSION' };
  }
  return firestore.runTransaction(async (transaction) => {
    const ref = firestore.doc(clockPath(uid));
    const snap = await transaction.get(ref);
    const parsed = snap.exists
      ? validateCanonicalContractClockState(snap.data())
      : { ok: true as const, state: createInitialCanonicalContractClock(serverNowMs) };
    if (!parsed.ok) return { ok: false as const, reason: parsed.reason };
    const advanced = advanceCanonicalContractClock(parsed.state, serverNowMs);
    if (!advanced.ok) return advanced;
    transaction.set(ref, { ...advanced.state });
    return {
      ok: true as const,
      currentGameHours: advanced.state.currentGameHours,
      clockRevision: advanced.state.clockRevision,
    };
  });
}

export async function setCanonicalContractClockSpeedTransaction(
  firestore: Firestore,
  uid: string,
  gameSpeed: number,
  schemaVersion: number,
  serverNowMs: number,
  options?: { envValue?: string | null },
): Promise<{ ok: true; currentGameHours: number; gameSpeed: number } | { ok: false; reason: string }> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalContractExpiryAllowed(options)) {
    return { ok: false, reason: 'CONTRACT_GAME_TIME_EXPIRY_AUTHORITY_OFF' };
  }
  if (schemaVersion !== CANONICAL_CONTRACT_CLOCK_SCHEMA_VERSION) {
    return { ok: false, reason: 'UNSUPPORTED_SCHEMA_VERSION' };
  }
  return firestore.runTransaction(async (transaction) => {
    const ref = firestore.doc(clockPath(uid));
    const snap = await transaction.get(ref);
    const parsed = snap.exists
      ? validateCanonicalContractClockState(snap.data())
      : { ok: true as const, state: createInitialCanonicalContractClock(serverNowMs) };
    if (!parsed.ok) return { ok: false as const, reason: parsed.reason };
    const next = setCanonicalContractClockSpeed(parsed.state, gameSpeed, serverNowMs);
    if (!next.ok) return next;
    transaction.set(ref, { ...next.state });
    return { ok: true as const, currentGameHours: next.state.currentGameHours, gameSpeed: next.state.gameSpeed };
  });
}

export async function setCanonicalContractClockPausedTransaction(
  firestore: Firestore,
  uid: string,
  paused: boolean,
  schemaVersion: number,
  serverNowMs: number,
  options?: { envValue?: string | null },
): Promise<{ ok: true; currentGameHours: number; manualPaused: boolean } | { ok: false; reason: string }> {
  if (!isAuthenticatedUid(uid)) return { ok: false, reason: 'UNAUTHENTICATED' };
  if (!isCanonicalContractExpiryAllowed(options)) {
    return { ok: false, reason: 'CONTRACT_GAME_TIME_EXPIRY_AUTHORITY_OFF' };
  }
  if (schemaVersion !== CANONICAL_CONTRACT_CLOCK_SCHEMA_VERSION) {
    return { ok: false, reason: 'UNSUPPORTED_SCHEMA_VERSION' };
  }
  return firestore.runTransaction(async (transaction) => {
    const ref = firestore.doc(clockPath(uid));
    const snap = await transaction.get(ref);
    const parsed = snap.exists
      ? validateCanonicalContractClockState(snap.data())
      : { ok: true as const, state: createInitialCanonicalContractClock(serverNowMs) };
    if (!parsed.ok) return { ok: false as const, reason: parsed.reason };
    const next = setCanonicalContractClockPaused(parsed.state, paused, serverNowMs);
    if (!next.ok) return next;
    transaction.set(ref, { ...next.state });
    return { ok: true as const, currentGameHours: next.state.currentGameHours, manualPaused: next.state.manualPaused };
  });
}
