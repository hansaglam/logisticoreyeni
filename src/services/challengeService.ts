import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { CHALLENGES_ENABLED, SEASONS_ENABLED } from '../config/backendRoadmap';
import type {
  ChallengeProgressItem,
  ChallengeClaimSuccess,
  PeriodDefinition,
  SeasonDefinition,
} from '../features/seasons/types';
import type { SeasonHistoryEntry } from '../domain/progressionFoundation';
import { getSeasonDefinitionFromKey } from '../features/seasons/periods';
import { waitForInitialAuthState } from './authService';
import {
  FIREBASE_FUNCTIONS_REGION,
  getFirebaseAuthSafe,
  getFirebaseFunctionsSafe,
  getFirestoreSafe,
} from './firebase';

export type ChallengeServiceReason =
  | 'feature-disabled'
  | 'auth-required'
  | 'invalid-request'
  | 'invalid-challenge-id'
  | 'challenge-disabled'
  | 'period-closed'
  | 'not-complete'
  | 'already-claimed'
  | 'server-state-not-initialized'
  | 'service-unavailable';

async function getCallableContext() {
  await waitForInitialAuthState();
  const user = getFirebaseAuthSafe()?.currentUser;
  const functions = getFirebaseFunctionsSafe(FIREBASE_FUNCTIONS_REGION);
  if (!user || user.isAnonymous) return { ok: false as const, reason: 'auth-required' as const };
  if (!functions) return { ok: false as const, reason: 'service-unavailable' as const };
  return { ok: true as const, functions };
}

export async function getCurrentSeason() {
  if (!SEASONS_ENABLED) return { ok: false as const, reason: 'feature-disabled' as const };
  const context = await getCallableContext();
  if (!context.ok) return context;
  try {
    const call = httpsCallable<Record<string, never>, { ok: boolean; season?: SeasonDefinition; reason?: ChallengeServiceReason }>(context.functions, 'getCurrentSeason');
    return (await call({})).data;
  } catch {
    return { ok: false as const, reason: 'service-unavailable' as const };
  }
}

export async function getChallengeProgress() {
  if (!CHALLENGES_ENABLED) return { ok: false as const, reason: 'feature-disabled' as const };
  const context = await getCallableContext();
  if (!context.ok) return context;
  try {
    const call = httpsCallable<Record<string, never>, {
      ok: boolean;
      reason?: ChallengeServiceReason;
      season?: SeasonDefinition;
      dailyPeriod?: PeriodDefinition;
      weeklyPeriod?: PeriodDefinition;
      challenges?: ChallengeProgressItem[];
    }>(context.functions, 'getChallengeProgress');
    return (await call({})).data;
  } catch {
    return { ok: false as const, reason: 'service-unavailable' as const };
  }
}

/** Owner-readable canonical season points. Challenge claims remain backend-only. */
export async function getSeasonPoints(seasonKey: string) {
  if (!SEASONS_ENABLED) return { ok: false as const, reason: 'feature-disabled' as const };
  const context = await getCallableContext();
  if (!context.ok) return context;
  const user = getFirebaseAuthSafe()?.currentUser;
  const firestore = getFirestoreSafe();
  if (!user || user.isAnonymous) return { ok: false as const, reason: 'auth-required' as const };
  if (!firestore || !seasonKey.trim()) {
    return { ok: false as const, reason: 'service-unavailable' as const };
  }
  try {
    const snapshot = await getDoc(doc(firestore, 'users', user.uid, 'seasonProgress', seasonKey));
    if (!snapshot.exists()) return { ok: true as const, points: 0 };
    const data = snapshot.data();
    if (data.ownerUid !== user.uid) {
      return { ok: false as const, reason: 'service-unavailable' as const };
    }
    const points = Number(data.points);
    return {
      ok: true as const,
      points: Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0,
    };
  } catch {
    return { ok: false as const, reason: 'service-unavailable' as const };
  }
}

/**
 * Owner-readable projection of completed canonical seasons. Rank/score stay
 * absent until the backend persists a trustworthy final leaderboard snapshot.
 */
export async function getCanonicalSeasonHistory(activeSeasonKey: string) {
  if (!SEASONS_ENABLED) return { ok: false as const, reason: 'feature-disabled' as const };
  const context = await getCallableContext();
  if (!context.ok) return context;
  const user = getFirebaseAuthSafe()?.currentUser;
  const firestore = getFirestoreSafe();
  if (!user || user.isAnonymous) return { ok: false as const, reason: 'auth-required' as const };
  if (!firestore) return { ok: false as const, reason: 'service-unavailable' as const };
  try {
    const [progressSnapshot, claimsSnapshot] = await Promise.all([
      getDocs(query(
        collection(firestore, 'users', user.uid, 'seasonProgress'),
        orderBy('updatedAt', 'desc'),
        limit(53),
      )),
      getDocs(query(
        collection(firestore, 'users', user.uid, 'challengeClaims'),
        orderBy('claimedAt', 'desc'),
        limit(500),
      )),
    ]);
    const claimsBySeason = new Map<string, number>();
    for (const claim of claimsSnapshot.docs) {
      const data = claim.data();
      if (data.ownerUid !== user.uid || typeof data.seasonKey !== 'string') continue;
      claimsBySeason.set(data.seasonKey, (claimsBySeason.get(data.seasonKey) ?? 0) + 1);
    }
    const entries: SeasonHistoryEntry[] = [];
    for (const progress of progressSnapshot.docs) {
      const data = progress.data();
      const seasonKey = typeof data.seasonKey === 'string' ? data.seasonKey : progress.id;
      if (data.ownerUid !== user.uid || seasonKey === activeSeasonKey) continue;
      const season = getSeasonDefinitionFromKey(seasonKey);
      if (!season) continue;
      const points = Number(data.points);
      entries.push({
        seasonKey,
        displayName: season.displayName,
        seasonPoints: Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0,
        challengeCompletionCount: claimsBySeason.get(seasonKey) ?? 0,
        endedAt: season.endsAt,
        readOnly: true,
      });
    }
    return { ok: true as const, entries: entries.sort((a, b) => b.endedAt - a.endedAt) };
  } catch {
    return { ok: false as const, reason: 'service-unavailable' as const };
  }
}

export async function claimChallengeReward(input: {
  challengeId: string;
  periodKey: string;
  transactionId: string;
  idempotencyKey: string;
}) {
  if (!CHALLENGES_ENABLED) return { ok: false as const, reason: 'feature-disabled' as const };
  const context = await getCallableContext();
  if (!context.ok) return context;
  try {
    const call = httpsCallable<
      typeof input,
      ChallengeClaimSuccess | { ok: false; reason: ChallengeServiceReason }
    >(context.functions, 'claimChallengeReward');
    return (await call(input)).data;
  } catch {
    return { ok: false as const, reason: 'service-unavailable' as const };
  }
}
