/**
 * Haftalık liderlik tablosu — Firestore V1
 *
 * Koleksiyon: leaderboards/{seasonKey}/entries/{uid}
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { getAccountStatus } from './authService';
import { getFirestoreSafe, isFirebaseEnabled } from './firebase';
import { getWeeklySeasonDocId } from '../utils/leaderboardSeason';
import { leaderboardConfig } from '../config/leaderboard';
import { sanitizeForFirestore } from '../utils/sanitizeForFirestore';

export interface LeaderboardEntry {
  uid: string;
  companyName: string;
  companyScore: number;
  level: number;
  reputation: number;
  completedContracts: number;
  updatedAt: number;
  seasonKey: string;
}

export interface LeaderboardRankedEntry extends LeaderboardEntry {
  rank: number;
}

export interface LeaderboardEntryInput {
  uid: string;
  companyName: string;
  companyScore: number;
  level: number;
  reputation: number;
  completedContracts: number;
  seasonKey?: string;
}

export interface LeaderboardFetchResult {
  ok: boolean;
  seasonKey: string;
  entries: LeaderboardRankedEntry[];
  playerEntry: LeaderboardEntry | null;
  playerRank: number | null;
  error?: string;
  errorCode?: string;
}

export function isLeaderboardEligible(): boolean {
  const account = getAccountStatus();
  if (!account.isReady || account.isAnonymous) {
    return false;
  }
  return account.provider === 'google' || account.provider === 'apple';
}

function normalizeLeaderboardEntry(
  uid: string,
  data: Record<string, unknown>,
  seasonKey: string,
): LeaderboardEntry {
  return {
    uid,
    companyName: typeof data.companyName === 'string' ? data.companyName : 'LogistiCore Lojistik',
    companyScore: typeof data.companyScore === 'number' ? data.companyScore : 0,
    level: typeof data.level === 'number' ? data.level : 1,
    reputation: typeof data.reputation === 'number' ? data.reputation : 0,
    completedContracts:
      typeof data.completedContracts === 'number' ? data.completedContracts : 0,
    updatedAt:
      typeof data.updatedAt === 'number'
        ? data.updatedAt
        : typeof (data.updatedAt as { toMillis?: () => number })?.toMillis === 'function'
          ? (data.updatedAt as { toMillis: () => number }).toMillis()
          : Date.now(),
    seasonKey: typeof data.seasonKey === 'string' ? data.seasonKey : seasonKey,
  };
}

export async function syncLeaderboardEntry(input: LeaderboardEntryInput): Promise<boolean> {
  if (!isFirebaseEnabled() || !isLeaderboardEligible()) {
    return false;
  }

  const db = getFirestoreSafe();
  if (!db) {
    return false;
  }

  const seasonKey = input.seasonKey ?? getWeeklySeasonDocId();
  const entryRef = doc(db, 'leaderboards', seasonKey, 'entries', input.uid);

  try {
    const payload = sanitizeForFirestore({
      uid: input.uid,
      companyName: input.companyName,
      companyScore: Math.max(0, Math.floor(input.companyScore)),
      level: Math.max(1, Math.floor(input.level)),
      reputation: Math.max(0, Math.min(100, Math.round(input.reputation))),
      completedContracts: Math.max(0, Math.floor(input.completedContracts)),
      seasonKey,
      updatedAt: serverTimestamp(),
    });

    await setDoc(entryRef, payload as Record<string, unknown>, { merge: true });
    return true;
  } catch (error) {
    console.warn('[leaderboard] sync failed', error);
    return false;
  }
}

export async function fetchWeeklyLeaderboard(
  uid: string | null,
  seasonKey: string = getWeeklySeasonDocId(),
): Promise<LeaderboardFetchResult> {
  if (!isFirebaseEnabled()) {
    return {
      ok: false,
      seasonKey,
      entries: [],
      playerEntry: null,
      playerRank: null,
      error: 'firebase-disabled',
    };
  }

  const db = getFirestoreSafe();
  if (!db) {
    return {
      ok: false,
      seasonKey,
      entries: [],
      playerEntry: null,
      playerRank: null,
      error: 'firestore-unavailable',
    };
  }

  try {
    const entriesRef = collection(db, 'leaderboards', seasonKey, 'entries');
    const topQuery = query(
      entriesRef,
      orderBy('companyScore', 'desc'),
      limit(leaderboardConfig.leaderboardSize),
    );
    const snapshot = await getDocs(topQuery);

    const entries: LeaderboardRankedEntry[] = snapshot.docs.map((entryDoc, index) => ({
      ...normalizeLeaderboardEntry(
        entryDoc.id,
        entryDoc.data() as Record<string, unknown>,
        seasonKey,
      ),
      rank: index + 1,
    }));

    let playerEntry: LeaderboardEntry | null = null;
    let playerRank: number | null = null;

    if (uid) {
      const inTopIndex = entries.findIndex((entry) => entry.uid === uid);
      if (inTopIndex >= 0) {
        playerEntry = entries[inTopIndex];
        playerRank = inTopIndex + 1;
      } else {
        const playerRef = doc(db, 'leaderboards', seasonKey, 'entries', uid);
        const playerSnap = await getDoc(playerRef);
        if (playerSnap.exists()) {
          playerEntry = normalizeLeaderboardEntry(
            uid,
            playerSnap.data() as Record<string, unknown>,
            seasonKey,
          );
        }
      }
    }

    return {
      ok: true,
      seasonKey,
      entries,
      playerEntry,
      playerRank,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'fetch-failed';
    const errorCode =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code ?? 'fetch-failed')
        : 'fetch-failed';
    if (__DEV__) {
      console.warn('[leaderboard] fetch failed', { errorCode, message });
    }
    return {
      ok: false,
      seasonKey,
      entries: [],
      playerEntry: null,
      playerRank: null,
      error: message,
      errorCode,
    };
  }
}
