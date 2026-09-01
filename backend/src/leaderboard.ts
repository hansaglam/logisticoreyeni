import {
  FieldPath,
  Timestamp,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

import {
  getLeaderboardSeasonEndMs,
  getLeaderboardSeasonKey,
  getLeaderboardSeasonStartMs,
  isValidLeaderboardSeasonKey,
} from './leaderboardSeason';
import {
  buildBoundedLegacyMigrationFromCloudSave,
  buildDefaultServerState,
  buildServerStateFromMarketplaceState,
  pickLeaderboardServerStatePersistPatch,
  serverStateRef,
  validateServerState,
} from './serverState';
import { ensureLeaderboardSeasonSeeded } from './leaderboardSeasonSeed';
import type { ServerStateDocument } from './serverStateTypes';
import type { MarketplacePlayerState } from './vehicleMarketplaceTypes';
import {
  calculateLeaderboardScore,
  extractCanonicalPlayerStateFromServerState,
  LEADERBOARD_SCORE_VERSION,
  resolveWeeklySeasonActivity,
} from './leaderboardScore';
import type {
  GetLeaderboardInput,
  GetLeaderboardResult,
  LeaderboardActionIdentity,
  LeaderboardCursor,
  LeaderboardFailureReason,
  LeaderboardPublicEntry,
  SubmitLeaderboardScoreInput,
  SubmitLeaderboardScoreResult,
} from './leaderboardTypes';

export const LEADERBOARD_PAGE_SIZE_DEFAULT = 50;
export const LEADERBOARD_PAGE_SIZE_MAX = 100;
export { LEADERBOARD_SCORE_VERSION };

const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function entryRef(firestore: Firestore, seasonKey: string, uid: string) {
  return firestore.doc(`leaderboards/${seasonKey}/entries/${uid}`);
}

function idempotencyRef(firestore: Firestore, uid: string, idempotencyKey: string) {
  return firestore.doc(`leaderboardIdempotency/${uid}_${idempotencyKey}`);
}

function failure(
  input: SubmitLeaderboardScoreInput,
  reason: LeaderboardFailureReason,
): SubmitLeaderboardScoreResult {
  return {
    ok: false,
    reason,
    transactionId: input.transactionId,
    idempotencyKey: input.idempotencyKey,
  };
}

function isCurrentScoreVersion(data: Record<string, unknown> | undefined): boolean {
  return Math.max(0, Math.floor(Number(data?.scoreVersion) || 0)) === LEADERBOARD_SCORE_VERSION;
}

function rankedEntriesCollection(firestore: Firestore, seasonKey: string) {
  return firestore
    .collection(`leaderboards/${seasonKey}/entries`)
    .where('scoreVersion', '==', LEADERBOARD_SCORE_VERSION);
}

function toPublicEntry(
  data: Record<string, unknown>,
  rank: number,
  seasonKey: string,
): LeaderboardPublicEntry {
  const updatedAt = data.updatedAt as { toMillis?: () => number } | number | undefined;
  const updatedAtMs =
    typeof updatedAt === 'number'
      ? updatedAt
      : typeof updatedAt?.toMillis === 'function'
        ? updatedAt.toMillis()
        : 0;
  const username =
    typeof data.username === 'string' && data.username.trim().length > 0
      ? data.username.trim().slice(0, 20)
      : '';
  return {
    uid: typeof data.uid === 'string' ? data.uid : '',
    username,
    companyName:
      typeof data.companyName === 'string' && data.companyName.trim().length > 0
        ? data.companyName.trim().slice(0, 48)
        : 'LogistiCore Lojistik',
    companyScore: Math.max(0, Math.floor(Number(data.companyScore) || 0)),
    level: Math.max(1, Math.floor(Number(data.level) || 1)),
    reputation: Math.max(0, Math.min(100, Number(data.reputation) || 0)),
    completedContracts: Math.max(0, Math.floor(Number(data.completedContracts) || 0)),
    rank,
    seasonKey: typeof data.seasonKey === 'string' ? data.seasonKey : seasonKey,
    updatedAtMs,
  };
}

async function countBetterScores(
  firestore: Firestore,
  seasonKey: string,
  score: number,
  uid: string,
): Promise<number> {
  const higher = await rankedEntriesCollection(firestore, seasonKey)
    .where('companyScore', '>', score)
    .count()
    .get();
  const tied = await rankedEntriesCollection(firestore, seasonKey)
    .where('companyScore', '==', score)
    .where(FieldPath.documentId(), '<', uid)
    .count()
    .get();
  return higher.data().count + tied.data().count;
}

export async function submitLeaderboardScoreTransaction(
  firestore: Firestore,
  identity: LeaderboardActionIdentity,
  input: SubmitLeaderboardScoreInput,
  nowMs = Date.now(),
): Promise<SubmitLeaderboardScoreResult> {
  const seasonKey = getLeaderboardSeasonKey(nowMs);
  let transactionAttempts = 0;

  try {
    const result = await firestore.runTransaction(async (transaction) => {
      transactionAttempts += 1;
      const idemRef = idempotencyRef(firestore, identity.uid, input.idempotencyKey);
      const serverRef = serverStateRef(firestore, identity.uid);
      const userRef = firestore.doc(`users/${identity.uid}`);
      const entryDocumentRef = entryRef(firestore, seasonKey, identity.uid);
      const marketplaceRef = firestore.doc(
        `users/${identity.uid}/marketplaceState/current`,
      );
      const saveRef = firestore.doc(`users/${identity.uid}/saves/current`);
      const [idemSnap, serverSnap, userSnap, existingSnap, marketplaceSnap, saveSnap] =
        await Promise.all([
          transaction.get(idemRef),
          transaction.get(serverRef),
          transaction.get(userRef),
          transaction.get(entryDocumentRef),
          transaction.get(marketplaceRef),
          transaction.get(saveRef),
        ]);
      if (idemSnap.exists) {
        const previous = idemSnap.data()?.result as SubmitLeaderboardScoreResult | undefined;
        if (previous && typeof previous === 'object') {
          return previous;
        }
      }

      let serverStateCreated = false;
      let serverState: ServerStateDocument;
      if (serverSnap.exists) {
        serverState = serverSnap.data() as ServerStateDocument;
      } else if (marketplaceSnap.exists) {
        serverState = buildServerStateFromMarketplaceState(
          identity.uid,
          marketplaceSnap.data() as MarketplacePlayerState,
          Timestamp.fromMillis(nowMs),
        );
        serverStateCreated = true;
      } else if (saveSnap.exists) {
        const built = buildBoundedLegacyMigrationFromCloudSave(
          identity.uid,
          saveSnap.data() ?? {},
          Timestamp.fromMillis(nowMs),
        );
        serverState = built.state;
        serverStateCreated = true;
      } else {
        serverState = buildDefaultServerState(
          identity.uid,
          Timestamp.fromMillis(nowMs),
        );
        serverStateCreated = true;
      }

      // Authoritative serverState is never refreshed from client cloud save on submit.
      // First-time bootstrap only: marketplaceState, bounded legacy migration, or default.

      const usernameRaw = userSnap.data()?.username;
      const username =
        typeof usernameRaw === 'string' ? usernameRaw.trim().slice(0, 20) : '';
      if (!username || userSnap.data()?.usernameSetupCompleted !== true) {
        return failure(input, 'username-required');
      }

      const stateReason = validateServerState(identity.uid, serverState);
      if (stateReason) {
        return failure(input, stateReason === 'server-state-not-initialized'
          ? 'server-state-not-initialized'
          : 'invalid-player-state');
      }

      const seasonActivity = resolveWeeklySeasonActivity(serverState, seasonKey);
      const extracted = extractCanonicalPlayerStateFromServerState(serverState, {
        weeklyCompletedDeliveries: seasonActivity.weeklyCompletedDeliveries,
      });
      if (!extracted.ok) {
        return failure(input, extracted.reason === 'server-state-not-initialized'
          ? 'server-state-not-initialized'
          : 'invalid-player-state');
      }

      const sourceVersion = Math.max(0, Math.floor(serverState.sourceVersion));
      if (
        input.clientSaveVersion != null &&
        Number.isInteger(input.clientSaveVersion) &&
        input.clientSaveVersion !== sourceVersion
      ) {
        // Client save may diverge from server-owned canonical state; score from serverState only.
      }

      const breakdown = calculateLeaderboardScore(extracted.player, extracted.gameState);
      if (!Number.isFinite(breakdown.totalScore) || breakdown.totalScore < 0) {
        return failure(input, 'invalid-player-state');
      }

      const ref = entryDocumentRef;
      const existingScoreVersion = existingSnap.exists
        ? Math.max(0, Math.floor(Number(existingSnap.data()?.scoreVersion) || 0))
        : 0;

      const entryPayload = {
        uid: identity.uid,
        username,
        companyName: breakdown.companyName,
        companyScore: breakdown.totalScore,
        level: breakdown.level,
        reputation: breakdown.reputation,
        completedContracts: breakdown.completedContracts,
        weeklyCompletedDeliveries: breakdown.weeklyCompletedDeliveries,
        seasonKey,
        updatedAt: Timestamp.fromMillis(nowMs),
        sourceSaveVersion: sourceVersion,
        scoreVersion: LEADERBOARD_SCORE_VERSION,
      };

      let updated = false;
      let reason: 'score-not-improved' | 'not-ranked-eligible' | undefined;
      if (serverStateCreated) {
        transaction.create(serverRef, {
          ...serverState,
          leaderboardSeasonKey: seasonActivity.leaderboardSeasonKey,
          weeklySeasonBaselineCompleted: seasonActivity.weeklySeasonBaselineCompleted,
          leaderboardScore: breakdown.totalScore,
        });
      } else {
        transaction.set(
          serverRef,
          {
            ...pickLeaderboardServerStatePersistPatch(serverState),
            leaderboardSeasonKey: seasonActivity.leaderboardSeasonKey,
            weeklySeasonBaselineCompleted: seasonActivity.weeklySeasonBaselineCompleted,
            leaderboardScore: breakdown.totalScore,
            updatedAt: Timestamp.fromMillis(nowMs),
          },
          { merge: true },
        );
      }

      if (!breakdown.rankedEligible) {
        reason = 'not-ranked-eligible';
        if (existingSnap.exists) {
          transaction.delete(ref);
          updated = true;
        }
      } else {
        transaction.set(ref, entryPayload, { merge: true });
        const previous = existingSnap.exists
          ? Math.max(0, Math.floor(Number(existingSnap.data()?.companyScore) || 0))
          : null;
        updated =
          previous !== breakdown.totalScore || existingScoreVersion !== LEADERBOARD_SCORE_VERSION;
        if (!updated) {
          reason = 'score-not-improved';
        }
      }

      const success: SubmitLeaderboardScoreResult = {
        ok: true,
        transactionId: input.transactionId,
        idempotencyKey: input.idempotencyKey,
        seasonKey,
        score: breakdown.totalScore,
        updated,
        rankedEligible: breakdown.rankedEligible,
        ...(reason ? { reason } : {}),
        entry: {
          username,
          companyName: breakdown.companyName,
          companyScore: breakdown.totalScore,
          level: breakdown.level,
          reputation: breakdown.reputation,
          completedContracts: breakdown.completedContracts,
        },
      };

      transaction.set(idemRef, {
        uid: identity.uid,
        idempotencyKey: input.idempotencyKey,
        transactionId: input.transactionId,
        createdAt: Timestamp.fromMillis(nowMs),
        expiresAt: Timestamp.fromMillis(nowMs + IDEMPOTENCY_TTL_MS),
        result: success,
      });

      return success;
    });

    return { ...result, retryCount: Math.max(0, transactionAttempts - 1) };
  } catch (error) {
    console.error('[leaderboard-submit-failed]', {
      uidHash: identity.uid.slice(0, 6),
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ...failure(input, 'service-unavailable'),
      retryCount: Math.max(0, transactionAttempts - 1),
    };
  }
}

export async function getLeaderboardSnapshot(
  firestore: Firestore,
  identity: LeaderboardActionIdentity,
  input: GetLeaderboardInput,
  nowMs = Date.now(),
): Promise<GetLeaderboardResult> {
  const seasonKey =
    input.seasonKey && isValidLeaderboardSeasonKey(input.seasonKey)
      ? input.seasonKey
      : getLeaderboardSeasonKey(nowMs);

  // V1: yalnız aktif sezon. Geçmiş sezonlar closed.
  if (seasonKey !== getLeaderboardSeasonKey(nowMs)) {
    return { ok: false, reason: 'season-closed', seasonKey };
  }

  try {
    void ensureLeaderboardSeasonSeeded(firestore, seasonKey, nowMs, {
      maxDurationMs: 20_000,
    }).catch((error) => {
      console.error('[leaderboard-seed-on-get-failed]', {
        seasonKey,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    console.error('[leaderboard-seed-on-get-failed]', {
      seasonKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const limit = Math.min(
    LEADERBOARD_PAGE_SIZE_MAX,
    Math.max(1, Math.floor(input.limit ?? LEADERBOARD_PAGE_SIZE_DEFAULT)),
  );

  try {
    let query: Query = rankedEntriesCollection(firestore, seasonKey)
      .orderBy('companyScore', 'desc')
      .orderBy(FieldPath.documentId(), 'asc');

    const cursor = input.cursor;
    if (
      cursor &&
      Number.isFinite(cursor.companyScore) &&
      typeof cursor.uid === 'string' &&
      cursor.uid.length > 0
    ) {
      query = query.startAfter(cursor.companyScore, cursor.uid);
    }

    const snapshot = await query.limit(limit + 1).get();
    const pageDocs = snapshot.docs.slice(0, limit) as QueryDocumentSnapshot[];
    const offset =
      cursor && Number.isFinite(cursor.companyScore)
        ? await countBetterScores(
            firestore,
            seasonKey,
            Number(cursor.companyScore),
            String(cursor.uid),
          ) + 1
        : 0;

    const entries = pageDocs.map((doc, index) =>
      toPublicEntry(doc.data() as Record<string, unknown>, offset + index + 1, seasonKey),
    );

    let playerEntry: LeaderboardPublicEntry | null = null;
    let playerRank: number | null = null;
    const inPage = entries.find((entry) => entry.uid === identity.uid);
    if (inPage) {
      playerEntry = inPage;
      playerRank = inPage.rank;
    } else {
      const playerSnap = await entryRef(firestore, seasonKey, identity.uid).get();
      if (playerSnap.exists) {
        const data = playerSnap.data() as Record<string, unknown>;
        if (isCurrentScoreVersion(data)) {
          const score = Math.max(0, Math.floor(Number(data.companyScore) || 0));
          playerRank = (await countBetterScores(firestore, seasonKey, score, identity.uid)) + 1;
          playerEntry = toPublicEntry(data, playerRank, seasonKey);
        }
      }
    }

    const last = pageDocs.at(-1);
    const nextCursor: LeaderboardCursor | null =
      snapshot.docs.length > limit && last
        ? {
            companyScore: Math.max(0, Math.floor(Number(last.data().companyScore) || 0)),
            uid: last.id,
          }
        : null;

    const totalParticipantsSnap = await rankedEntriesCollection(firestore, seasonKey)
      .count()
      .get();

    return {
      ok: true,
      seasonKey,
      seasonStartMs: getLeaderboardSeasonStartMs(nowMs),
      seasonEndMs: getLeaderboardSeasonEndMs(nowMs),
      entries,
      playerEntry,
      playerRank,
      hasMore: Boolean(nextCursor),
      nextCursor,
      totalParticipants: totalParticipantsSnap.data().count,
    };
  } catch (error) {
    console.error('[leaderboard-get-failed]', {
      uidHash: identity.uid.slice(0, 6),
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: 'service-unavailable', seasonKey };
  }
}

const LEADERBOARD_ENTRY_CLEANUP_WEEKS = 156;
const MS_PER_WEEK = 7 * 86_400_000;

/** Account deletion — tüm sezon entry'lerini Admin SDK ile temizle. */
export async function deleteLeaderboardEntriesForUid(
  firestore: Firestore,
  uid: string,
  nowMs = Date.now(),
): Promise<number> {
  let deleted = 0;
  const seasonKeys = new Set<string>();
  seasonKeys.add(getLeaderboardSeasonKey(nowMs));
  for (let week = 0; week < LEADERBOARD_ENTRY_CLEANUP_WEEKS; week += 1) {
    seasonKeys.add(getLeaderboardSeasonKey(nowMs - week * MS_PER_WEEK));
  }

  const seasonRefs = await firestore.collection('leaderboards').listDocuments();
  for (const seasonRef of seasonRefs) {
    seasonKeys.add(seasonRef.id);
  }

  for (const seasonKey of seasonKeys) {
    const snap = await entryRef(firestore, seasonKey, uid).get();
    if (!snap.exists) continue;
    await snap.ref.delete();
    deleted += 1;
  }

  // Idempotency docs for this uid (paginated, idempotent)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const idemSnap = await firestore
      .collection('leaderboardIdempotency')
      .where('uid', '==', uid)
      .limit(400)
      .get();
    if (idemSnap.empty) break;
    const batch = firestore.batch();
    for (const doc of idemSnap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    if (idemSnap.size < 400) break;
  }

  return deleted;
}
