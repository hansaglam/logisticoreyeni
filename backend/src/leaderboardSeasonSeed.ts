/**
 * Haftalık liderlik sezonu — kayıtlı oyuncuları yeni sezona taşır.
 * Submit yalnızca aktif oyuncuları ekler; sezon rollover'da liste boş kalmasın diye seed gerekir.
 */

import {
  FieldPath,
  Timestamp,
  type Firestore,
  type WriteBatch,
} from 'firebase-admin/firestore';

import {
  calculateLeaderboardScore,
  extractCanonicalPlayerStateFromServerState,
  LEADERBOARD_SCORE_VERSION,
  resolveWeeklySeasonActivity,
} from './leaderboardScore';
import { getLeaderboardSeasonKey } from './leaderboardSeason';
import { serverStateRef, validateServerState } from './serverState';
import type { ServerStateDocument } from './serverStateTypes';

const USERS_PAGE_SIZE = 100;
const MAX_BATCH_WRITES = 400;
const DEFAULT_MAX_DURATION_MS = 50_000;

export interface LeaderboardSeasonMeta {
  seasonKey: string;
  seedStartedAt?: Timestamp;
  seedCompletedAt?: Timestamp;
  lastSeedAt?: Timestamp;
  seededEntryCount?: number;
  skippedCount?: number;
  deletedEntryCount?: number;
  seedInProgress?: boolean;
  lastProcessedUid?: string;
}

export interface LeaderboardSeasonSeedResult {
  seasonKey: string;
  ran: boolean;
  completed: boolean;
  seeded: number;
  skipped: number;
  deleted: number;
  pagesProcessed: number;
  durationMs: number;
}

function seasonMetaRef(firestore: Firestore, seasonKey: string) {
  return firestore.doc(`leaderboards/${seasonKey}`);
}

function entryRef(firestore: Firestore, seasonKey: string, uid: string) {
  return firestore.doc(`leaderboards/${seasonKey}/entries/${uid}`);
}

export function prepareLeaderboardEntryPayload(input: {
  uid: string;
  username: string;
  serverState: ServerStateDocument;
  seasonKey: string;
  nowMs: number;
}): {
  rankedEligible: boolean;
  entry: Record<string, unknown> | null;
  serverPatch: {
    leaderboardSeasonKey: string;
    weeklySeasonBaselineCompleted: number;
    leaderboardScore: number;
    updatedAt: Timestamp;
  };
} {
  const seasonActivity = resolveWeeklySeasonActivity(input.serverState, input.seasonKey);
  const extracted = extractCanonicalPlayerStateFromServerState(input.serverState, {
    weeklyCompletedDeliveries: seasonActivity.weeklyCompletedDeliveries,
  });
  if (!extracted.ok) {
    return {
      rankedEligible: false,
      entry: null,
      serverPatch: {
        leaderboardSeasonKey: seasonActivity.leaderboardSeasonKey,
        weeklySeasonBaselineCompleted: seasonActivity.weeklySeasonBaselineCompleted,
        leaderboardScore: 0,
        updatedAt: Timestamp.fromMillis(input.nowMs),
      },
    };
  }

  const breakdown = calculateLeaderboardScore(extracted.player, extracted.gameState);
  const sourceVersion = Math.max(0, Math.floor(input.serverState.sourceVersion));
  const serverPatch = {
    leaderboardSeasonKey: seasonActivity.leaderboardSeasonKey,
    weeklySeasonBaselineCompleted: seasonActivity.weeklySeasonBaselineCompleted,
    leaderboardScore: breakdown.totalScore,
    updatedAt: Timestamp.fromMillis(input.nowMs),
  };

  if (!breakdown.rankedEligible) {
    return { rankedEligible: false, entry: null, serverPatch };
  }

  return {
    rankedEligible: true,
    entry: {
      uid: input.uid,
      username: input.username.trim().slice(0, 20),
      companyName: breakdown.companyName,
      companyScore: breakdown.totalScore,
      level: breakdown.level,
      reputation: breakdown.reputation,
      completedContracts: breakdown.completedContracts,
      weeklyCompletedDeliveries: breakdown.weeklyCompletedDeliveries,
      seasonKey: input.seasonKey,
      updatedAt: Timestamp.fromMillis(input.nowMs),
      sourceSaveVersion: sourceVersion,
      scoreVersion: LEADERBOARD_SCORE_VERSION,
    },
    serverPatch,
  };
}

async function flushBatch(
  firestore: Firestore,
  batch: WriteBatch,
  batchOps: number,
): Promise<{ batch: WriteBatch; batchOps: number }> {
  if (batchOps === 0) {
    return { batch, batchOps: 0 };
  }
  await batch.commit();
  return { batch: firestore.batch(), batchOps: 0 };
}

export async function seedLeaderboardSeason(
  firestore: Firestore,
  seasonKey: string = getLeaderboardSeasonKey(),
  options?: {
    nowMs?: number;
    force?: boolean;
    maxDurationMs?: number;
    resumeFromUid?: string | null;
  },
): Promise<LeaderboardSeasonSeedResult> {
  const startedAt = Date.now();
  const nowMs = options?.nowMs ?? startedAt;
  const maxDurationMs = options?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const metaRef = seasonMetaRef(firestore, seasonKey);
  const metaSnap = await metaRef.get();
  const existingMeta = (metaSnap.data() ?? {}) as LeaderboardSeasonMeta;

  if (
    !options?.force &&
    existingMeta.seedCompletedAt &&
    existingMeta.seasonKey === seasonKey
  ) {
    return {
      seasonKey,
      ran: false,
      completed: true,
      seeded: existingMeta.seededEntryCount ?? 0,
      skipped: existingMeta.skippedCount ?? 0,
      deleted: existingMeta.deletedEntryCount ?? 0,
      pagesProcessed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  if (existingMeta.seedInProgress && !options?.force) {
    return {
      seasonKey,
      ran: false,
      completed: false,
      seeded: existingMeta.seededEntryCount ?? 0,
      skipped: existingMeta.skippedCount ?? 0,
      deleted: existingMeta.deletedEntryCount ?? 0,
      pagesProcessed: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  let seeded = existingMeta.seededEntryCount ?? 0;
  let skipped = existingMeta.skippedCount ?? 0;
  let deleted = existingMeta.deletedEntryCount ?? 0;
  let pagesProcessed = 0;
  let lastProcessedUid = options?.resumeFromUid ?? existingMeta.lastProcessedUid ?? null;
  let batch = firestore.batch();
  let batchOps = 0;

  const commitIfNeeded = async () => {
    if (batchOps === 0) {
      return;
    }
    const next = await flushBatch(firestore, batch, batchOps);
    batch = next.batch;
    batchOps = next.batchOps;
  };

  await metaRef.set(
    {
      seasonKey,
      seedInProgress: true,
      seedStartedAt: existingMeta.seedStartedAt ?? Timestamp.fromMillis(nowMs),
      lastSeedAt: Timestamp.fromMillis(nowMs),
    },
    { merge: true },
  );

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() - startedAt >= maxDurationMs) {
        await commitIfNeeded();
        await metaRef.set(
          {
            seasonKey,
            seedInProgress: false,
            lastProcessedUid,
            seededEntryCount: seeded,
            skippedCount: skipped,
            deletedEntryCount: deleted,
            lastSeedAt: Timestamp.fromMillis(Date.now()),
          },
          { merge: true },
        );
        return {
          seasonKey,
          ran: true,
          completed: false,
          seeded,
          skipped,
          deleted,
          pagesProcessed,
          durationMs: Date.now() - startedAt,
        };
      }

      let query = firestore
        .collection('users')
        .where('usernameSetupCompleted', '==', true)
        .orderBy(FieldPath.documentId())
        .limit(USERS_PAGE_SIZE);
      if (lastProcessedUid) {
        query = query.startAfter(lastProcessedUid);
      }

      const usersSnap = await query.get();
      if (usersSnap.empty) {
        break;
      }

      pagesProcessed += 1;

      for (const userDoc of usersSnap.docs) {
        lastProcessedUid = userDoc.id;
        const userData = userDoc.data();
        const usernameRaw = userData.username;
        const username =
          typeof usernameRaw === 'string' ? usernameRaw.trim().slice(0, 20) : '';
        if (!username) {
          skipped += 1;
          continue;
        }

        const serverSnap = await serverStateRef(firestore, userDoc.id).get();
        if (!serverSnap.exists) {
          skipped += 1;
          continue;
        }

        const serverState = serverSnap.data() as ServerStateDocument;
        const stateReason = validateServerState(userDoc.id, serverState);
        if (stateReason) {
          skipped += 1;
          continue;
        }

        const prepared = prepareLeaderboardEntryPayload({
          uid: userDoc.id,
          username,
          serverState,
          seasonKey,
          nowMs,
        });

        batch.set(
          serverStateRef(firestore, userDoc.id),
          prepared.serverPatch,
          { merge: true },
        );
        batchOps += 1;

        if (prepared.entry) {
          batch.set(entryRef(firestore, seasonKey, userDoc.id), prepared.entry, {
            merge: true,
          });
          batchOps += 1;
          seeded += 1;
        } else {
          batch.delete(entryRef(firestore, seasonKey, userDoc.id));
          batchOps += 1;
          deleted += 1;
        }

        if (batchOps >= MAX_BATCH_WRITES) {
          await commitIfNeeded();
        }
      }

      if (usersSnap.size < USERS_PAGE_SIZE) {
        break;
      }
    }

    await commitIfNeeded();

    await metaRef.set(
      {
        seasonKey,
        seedInProgress: false,
        seedCompletedAt: Timestamp.fromMillis(Date.now()),
        lastProcessedUid: null,
        seededEntryCount: seeded,
        skippedCount: skipped,
        deletedEntryCount: deleted,
        lastSeedAt: Timestamp.fromMillis(Date.now()),
      },
      { merge: true },
    );

    return {
      seasonKey,
      ran: true,
      completed: true,
      seeded,
      skipped,
      deleted,
      pagesProcessed,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    await commitIfNeeded().catch(() => undefined);
    await metaRef.set(
      {
        seasonKey,
        seedInProgress: false,
        lastProcessedUid,
        seededEntryCount: seeded,
        skippedCount: skipped,
        deletedEntryCount: deleted,
        lastSeedAt: Timestamp.fromMillis(Date.now()),
      },
      { merge: true },
    );
    throw error;
  }
}

/**
 * Aktif sezon boş veya seed tamamlanmamışsa arka planda doldur.
 */
export async function ensureLeaderboardSeasonSeeded(
  firestore: Firestore,
  seasonKey: string,
  nowMs = Date.now(),
  options?: { force?: boolean; maxDurationMs?: number },
): Promise<LeaderboardSeasonSeedResult> {
  const metaSnap = await seasonMetaRef(firestore, seasonKey).get();
  const meta = (metaSnap.data() ?? {}) as LeaderboardSeasonMeta;

  if (
    !options?.force &&
    meta.seedCompletedAt &&
    meta.seasonKey === seasonKey
  ) {
    return {
      seasonKey,
      ran: false,
      completed: true,
      seeded: meta.seededEntryCount ?? 0,
      skipped: meta.skippedCount ?? 0,
      deleted: meta.deletedEntryCount ?? 0,
      pagesProcessed: 0,
      durationMs: 0,
    };
  }

  return seedLeaderboardSeason(firestore, seasonKey, {
    nowMs,
    force: options?.force,
    maxDurationMs: options?.maxDurationMs ?? 25_000,
    resumeFromUid: meta.lastProcessedUid ?? null,
  });
}
