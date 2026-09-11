/**
 * Phase 7 Step 2 — Immutable season-close finalizer.
 *
 * Ranking order matches live leaderboard exactly:
 * companyScore DESC, uid ASC (document id), current scoreVersion only.
 *
 * Score-version policy: snapshot the same ranked set as live leaderboard
 * (`scoreVersion == LEADERBOARD_SCORE_VERSION`). Closing refuses when the
 * current-version filter yields 0 participants but other versioned entries
 * exist for that season (avoids silent empty closes across version bumps).
 *
 * Reward policy: frozen create-once at initializeClosingMeta via
 * resolveSeasonRewardPolicy(seasonKey). Existing meta is never overwritten.
 * No reward amounts, entitlements, or claims during close.
 */

import {
  FieldPath,
  Timestamp,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

import { LEADERBOARD_SCORE_VERSION } from './leaderboardScore';
import {
  getLeaderboardSeasonBoundsFromKey,
  getLeaderboardSeasonKey,
  getPreviousLeaderboardSeasonKey,
  isValidLeaderboardSeasonKey,
} from './leaderboardSeason';
import type {
  FinalizeSeasonResult,
  GetSeasonResultResponse,
  SeasonCloseCursor,
  SeasonCloseMetaDocument,
  SeasonCloseResultDocument,
  SeasonCloseStatus,
} from './seasonCloseTypes';
import {
  SEASON_CLOSE_PAGE_SIZE,
  SEASON_CLOSE_SNAPSHOT_VERSION,
} from './seasonCloseTypes';
import {
  freezeSeasonRewardPolicyFields,
  resolveSeasonRewardPolicy,
} from './seasonRewardPolicy';

export {
  SEASON_CLOSE_PAGE_SIZE,
  SEASON_CLOSE_SNAPSHOT_VERSION,
  getPreviousLeaderboardSeasonKey,
};

/** Backend gate — production remains false until explicitly enabled. */
export function isSeasonCloseSnapshotEnabled(): boolean {
  return process.env.SEASON_CLOSE_SNAPSHOT_ENABLED === 'true';
}

export function seasonCloseMetaRef(firestore: Firestore, seasonKey: string) {
  return firestore.doc(`seasons/${seasonKey}`);
}

export function seasonCloseResultRef(
  firestore: Firestore,
  seasonKey: string,
  uid: string,
) {
  return firestore.doc(`seasons/${seasonKey}/results/${uid}`);
}

function rankedSourceEntries(firestore: Firestore, seasonKey: string) {
  return firestore
    .collection(`leaderboards/${seasonKey}/entries`)
    .where('scoreVersion', '==', LEADERBOARD_SCORE_VERSION);
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

export function classifySeasonCloseTiming(
  seasonKey: string,
  nowMs: number,
): 'invalid' | 'future' | 'active' | 'ended' {
  if (!isValidLeaderboardSeasonKey(seasonKey)) {
    return 'invalid';
  }
  const bounds = getLeaderboardSeasonBoundsFromKey(seasonKey);
  if (!bounds) {
    return 'invalid';
  }
  if (nowMs < bounds.startsAt) {
    return 'future';
  }
  if (nowMs < bounds.endsAt) {
    return 'active';
  }
  return 'ended';
}

function readMeta(data: Record<string, unknown> | undefined): SeasonCloseMetaDocument | null {
  if (!data || typeof data !== 'object') return null;
  const status = data.status;
  if (status !== 'closing' && status !== 'closed') return null;
  const seasonKey = typeof data.seasonKey === 'string' ? data.seasonKey : '';
  const cursorRaw = data.closeCursor;
  let closeCursor: SeasonCloseCursor | null = null;
  if (
    cursorRaw &&
    typeof cursorRaw === 'object' &&
    !Array.isArray(cursorRaw) &&
    Number.isFinite((cursorRaw as SeasonCloseCursor).companyScore) &&
    typeof (cursorRaw as SeasonCloseCursor).uid === 'string'
  ) {
    closeCursor = {
      companyScore: Math.max(0, Math.floor(Number((cursorRaw as SeasonCloseCursor).companyScore))),
      uid: String((cursorRaw as SeasonCloseCursor).uid),
    };
  }
  return {
    seasonKey,
    startsAt: Math.max(0, Math.floor(Number(data.startsAt) || 0)),
    endsAt: Math.max(0, Math.floor(Number(data.endsAt) || 0)),
    status,
    participantCount: Math.max(0, Math.floor(Number(data.participantCount) || 0)),
    processedCount: Math.max(0, Math.floor(Number(data.processedCount) || 0)),
    snapshotVersion: Math.max(0, Math.floor(Number(data.snapshotVersion) || 0)),
    scoreVersion: Math.max(0, Math.floor(Number(data.scoreVersion) || 0)),
    closeCursor,
    closeStartedAt: Math.max(0, Math.floor(Number(data.closeStartedAt) || 0)),
    closedAt:
      data.closedAt == null ? null : Math.max(0, Math.floor(Number(data.closedAt) || 0)),
    // Preserve frozen reward fields when present; never rewrite on resume.
    rewardsEnabled: data.rewardsEnabled === true,
    rewardCatalogVersion:
      data.rewardCatalogVersion == null
        ? null
        : Number.isInteger(Number(data.rewardCatalogVersion))
          ? Number(data.rewardCatalogVersion)
          : null,
    rewardMaterializationComplete: data.rewardMaterializationComplete === true,
    rewardMaterializationCursorUid:
      typeof data.rewardMaterializationCursorUid === 'string'
        ? data.rewardMaterializationCursorUid
        : null,
  };
}

function resultsCompatible(
  existing: SeasonCloseResultDocument,
  expected: Omit<SeasonCloseResultDocument, 'snapshottedAt'>,
): boolean {
  return (
    existing.uid === expected.uid &&
    existing.seasonKey === expected.seasonKey &&
    existing.finalScore === expected.finalScore &&
    existing.finalRank === expected.finalRank &&
    existing.participantCount === expected.participantCount &&
    existing.snapshotVersion === expected.snapshotVersion &&
    existing.scoreVersion === expected.scoreVersion
  );
}

/**
 * Strict parse — never coerce missing/zero rank into rank 1 or invent scores.
 * Malformed docs return null (caller treats as unavailable / integrity).
 */
export function parseSeasonCloseResultDocument(
  data: Record<string, unknown> | undefined,
): SeasonCloseResultDocument | null {
  if (!data || typeof data !== 'object') return null;
  const uid = typeof data.uid === 'string' ? data.uid.trim() : '';
  const seasonKey = typeof data.seasonKey === 'string' ? data.seasonKey.trim() : '';
  if (!uid || !seasonKey) return null;

  const finalScore = Number(data.finalScore);
  const finalRank = Number(data.finalRank);
  const participantCount = Number(data.participantCount);
  const snapshottedAt = Number(data.snapshottedAt);
  const snapshotVersion = Number(data.snapshotVersion);
  const scoreVersion = Number(data.scoreVersion);

  if (!Number.isFinite(finalScore) || finalScore < 0) return null;
  if (!Number.isFinite(finalRank) || finalRank < 1) return null;
  if (!Number.isFinite(participantCount) || participantCount < 0) return null;
  if (!Number.isFinite(snapshottedAt) || snapshottedAt < 0) return null;
  if (!Number.isFinite(snapshotVersion) || snapshotVersion < 1) return null;
  if (!Number.isFinite(scoreVersion) || scoreVersion < 1) return null;

  return {
    uid,
    seasonKey,
    finalScore: Math.floor(finalScore),
    finalRank: Math.floor(finalRank),
    participantCount: Math.floor(participantCount),
    snapshottedAt: Math.floor(snapshottedAt),
    snapshotVersion: Math.floor(snapshotVersion),
    scoreVersion: Math.floor(scoreVersion),
    rewardTier: null,
    rewardAmount: null,
    rewardStatus: null,
  };
}

/** @deprecated use parseSeasonCloseResultDocument */
function parseExistingResult(
  data: Record<string, unknown> | undefined,
): SeasonCloseResultDocument | null {
  return parseSeasonCloseResultDocument(data);
}

/** Pure ordering used by finalizer / live leaderboard (score DESC, uid ASC). */
export function compareSeasonCloseEntryOrder(
  left: { companyScore: number; uid: string },
  right: { companyScore: number; uid: string },
): number {
  if (right.companyScore !== left.companyScore) {
    return right.companyScore - left.companyScore;
  }
  return left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : 0;
}

/**
 * In-memory pagination matching Firestore startAfter(companyScore, uid) semantics
 * for companyScore DESC + uid ASC. Used by verification tests.
 */
export function paginateSeasonCloseEntries<T extends { companyScore: number; uid: string }>(
  entries: readonly T[],
  pageSize: number,
  cursor: SeasonCloseCursor | null,
): { page: T[]; nextCursor: SeasonCloseCursor | null } {
  const sorted = [...entries].sort(compareSeasonCloseEntryOrder);
  let startIndex = 0;
  if (cursor) {
    startIndex = sorted.findIndex((entry) => {
      const cmp = compareSeasonCloseEntryOrder(entry, {
        companyScore: cursor.companyScore,
        uid: cursor.uid,
      });
      return cmp > 0;
    });
    if (startIndex < 0) {
      return { page: [], nextCursor: null };
    }
  }
  const page = sorted.slice(startIndex, startIndex + Math.max(1, pageSize));
  const last = page[page.length - 1];
  return {
    page,
    nextCursor: last
      ? { companyScore: last.companyScore, uid: last.uid }
      : null,
  };
}

async function createResultOnce(
  firestore: Firestore,
  seasonKey: string,
  payload: SeasonCloseResultDocument,
): Promise<'created' | 'skipped'> {
  const ref = seasonCloseResultRef(firestore, seasonKey, payload.uid);
  try {
    await ref.create({
      ...payload,
      createdAt: Timestamp.fromMillis(payload.snapshottedAt),
    });
    return 'created';
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
    const snap = await ref.get();
    const existing = parseExistingResult(snap.data() as Record<string, unknown> | undefined);
    if (!existing) {
      throw new Error(`integrity-conflict: corrupt result ${seasonKey}/${payload.uid}`);
    }
    const { snapshottedAt: _snapshottedAt, ...expected } = payload;
    void _snapshottedAt;
    if (!resultsCompatible(existing, expected)) {
      throw new Error(
        `integrity-conflict: result mismatch ${seasonKey}/${payload.uid} ` +
          `existing=${existing.finalRank}:${existing.finalScore} ` +
          `expected=${payload.finalRank}:${payload.finalScore}`,
      );
    }
    return 'skipped';
  }
}

async function initializeClosingMeta(
  firestore: Firestore,
  seasonKey: string,
  nowMs: number,
): Promise<SeasonCloseMetaDocument> {
  const bounds = getLeaderboardSeasonBoundsFromKey(seasonKey);
  if (!bounds) {
    throw new Error('invalid-season-key');
  }
  const metaRef = seasonCloseMetaRef(firestore, seasonKey);
  const existingSnap = await metaRef.get();
  if (existingSnap.exists) {
    const existing = readMeta(existingSnap.data() as Record<string, unknown> | undefined);
    if (!existing) {
      throw new Error('integrity-conflict: corrupt season meta');
    }
    return existing;
  }

  const countSnap = await rankedSourceEntries(firestore, seasonKey).count().get();
  const participantCount = countSnap.data().count;
  if (participantCount === 0) {
    // Same filter as the writer. If any entry exists under another scoreVersion,
    // refuse empty close rather than silently snapshotting zero participants.
    const anyEntry = await firestore
      .collection(`leaderboards/${seasonKey}/entries`)
      .limit(1)
      .get();
    if (!anyEntry.empty) {
      throw new Error(
        'integrity-conflict: score-version-filter-excludes-existing-entries',
      );
    }
  }

  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(metaRef);
    if (snap.exists) {
      const existing = readMeta(snap.data() as Record<string, unknown> | undefined);
      if (!existing) {
        throw new Error('integrity-conflict: corrupt season meta');
      }
      return existing;
    }
    const rewardFields = freezeSeasonRewardPolicyFields(
      resolveSeasonRewardPolicy(seasonKey),
    );
    const created: SeasonCloseMetaDocument = {
      seasonKey,
      startsAt: bounds.startsAt,
      endsAt: bounds.endsAt,
      status: 'closing',
      participantCount,
      processedCount: 0,
      snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
      scoreVersion: LEADERBOARD_SCORE_VERSION,
      closeCursor: null,
      closeStartedAt: nowMs,
      closedAt: null,
      rewardsEnabled: rewardFields.rewardsEnabled,
      rewardCatalogVersion: rewardFields.rewardCatalogVersion,
    };
    transaction.create(metaRef, {
      ...created,
      updatedAt: Timestamp.fromMillis(nowMs),
    });
    return created;
  });
}

/**
 * Finalize a closed UTC ISO week into immutable seasons/{seasonKey}/results/{uid}.
 * Resumable via closeCursor + processedCount. Idempotent when already closed.
 */
export async function finalizeSeason(
  firestore: Firestore,
  seasonKey: string,
  options?: {
    nowMs?: number;
    maxDurationMs?: number;
    pageSize?: number;
    /** Bypass env flag for unit/emulator tests. */
    forceEnabled?: boolean;
  },
): Promise<FinalizeSeasonResult> {
  const startedAt = Date.now();
  const nowMs = options?.nowMs ?? startedAt;
  const maxDurationMs = options?.maxDurationMs ?? 480_000;
  const pageSize = Math.min(
    SEASON_CLOSE_PAGE_SIZE,
    Math.max(1, Math.floor(options?.pageSize ?? SEASON_CLOSE_PAGE_SIZE)),
  );
  const enabled = options?.forceEnabled === true || isSeasonCloseSnapshotEnabled();

  const base = (): FinalizeSeasonResult => ({
    ok: false,
    reason: 'invalid-season-key',
    seasonKey: typeof seasonKey === 'string' ? seasonKey : '',
    status: null,
    participantCount: null,
    processedCount: null,
    closedAt: null,
    pagesProcessed: 0,
    durationMs: Date.now() - startedAt,
  });

  if (!enabled) {
    return { ...base(), reason: 'feature-disabled', seasonKey: String(seasonKey ?? '') };
  }
  if (!isValidLeaderboardSeasonKey(seasonKey)) {
    return { ...base(), reason: 'invalid-season-key' };
  }

  const timing = classifySeasonCloseTiming(seasonKey, nowMs);
  if (timing === 'invalid') {
    return { ...base(), reason: 'invalid-season-key', seasonKey };
  }
  if (timing === 'future') {
    return { ...base(), reason: 'season-future', seasonKey };
  }
  if (timing === 'active' || seasonKey === getLeaderboardSeasonKey(nowMs)) {
    return { ...base(), reason: 'season-active', seasonKey };
  }

  try {
    let meta = await initializeClosingMeta(firestore, seasonKey, nowMs);
    if (meta.status === 'closed') {
      return {
        ok: true,
        reason: 'already-closed',
        seasonKey,
        status: 'closed',
        participantCount: meta.participantCount,
        processedCount: meta.processedCount,
        closedAt: meta.closedAt,
        pagesProcessed: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    let pagesProcessed = 0;
    let processedCount = meta.processedCount;
    let cursor = meta.closeCursor;

    while (Date.now() - startedAt < maxDurationMs) {
      let query: Query = rankedSourceEntries(firestore, seasonKey)
        .orderBy('companyScore', 'desc')
        .orderBy(FieldPath.documentId(), 'asc')
        .limit(pageSize);
      if (cursor) {
        query = query.startAfter(cursor.companyScore, cursor.uid);
      }
      const page = await query.get();
      if (page.empty) {
        break;
      }

      const docs = page.docs as QueryDocumentSnapshot[];
      for (let index = 0; index < docs.length; index += 1) {
        const docSnap = docs[index]!;
        const data = docSnap.data() as Record<string, unknown>;
        const uid =
          typeof data.uid === 'string' && data.uid.trim().length > 0
            ? data.uid.trim()
            : docSnap.id;
        const finalScore = Math.max(0, Math.floor(Number(data.companyScore) || 0));
        const finalRank = processedCount + 1;
        const payload: SeasonCloseResultDocument = {
          uid,
          seasonKey,
          finalScore,
          finalRank,
          participantCount: meta.participantCount,
          snapshottedAt: nowMs,
          snapshotVersion: SEASON_CLOSE_SNAPSHOT_VERSION,
          scoreVersion: LEADERBOARD_SCORE_VERSION,
          rewardTier: null,
          rewardAmount: null,
          rewardStatus: null,
        };
        await createResultOnce(firestore, seasonKey, payload);
        processedCount += 1;
        cursor = { companyScore: finalScore, uid };
      }

      pagesProcessed += 1;
      await seasonCloseMetaRef(firestore, seasonKey).set(
        {
          processedCount,
          closeCursor: cursor,
          status: 'closing',
          updatedAt: Timestamp.fromMillis(Date.now()),
        },
        { merge: true },
      );

      if (docs.length < pageSize) {
        break;
      }
    }

    const timedOut = Date.now() - startedAt >= maxDurationMs;
    // Peek next page to know if more remain.
    let hasMore = false;
    if (cursor) {
      const peek = await rankedSourceEntries(firestore, seasonKey)
        .orderBy('companyScore', 'desc')
        .orderBy(FieldPath.documentId(), 'asc')
        .startAfter(cursor.companyScore, cursor.uid)
        .limit(1)
        .get();
      hasMore = !peek.empty;
    } else if (processedCount === 0 && meta.participantCount > 0) {
      hasMore = true;
    }

    if (hasMore || (timedOut && processedCount < meta.participantCount)) {
      return {
        ok: true,
        reason: 'timeout-partial',
        seasonKey,
        status: 'closing',
        participantCount: meta.participantCount,
        processedCount,
        closedAt: null,
        pagesProcessed,
        durationMs: Date.now() - startedAt,
      };
    }

    if (processedCount !== meta.participantCount) {
      // Recount for empty/racy boards — still must not reopen closed seasons.
      const recount = await rankedSourceEntries(firestore, seasonKey).count().get();
      const liveCount = recount.data().count;
      if (processedCount !== liveCount && liveCount !== meta.participantCount) {
        throw new Error(
          `integrity-conflict: processed=${processedCount} metaParticipants=${meta.participantCount} live=${liveCount}`,
        );
      }
      // If live shrunk to processedCount, adopt processed as authoritative participantCount.
      if (processedCount === liveCount && liveCount !== meta.participantCount) {
        await seasonCloseMetaRef(firestore, seasonKey).set(
          {
            participantCount: processedCount,
            updatedAt: Timestamp.fromMillis(Date.now()),
          },
          { merge: true },
        );
        meta = { ...meta, participantCount: processedCount };
      } else if (processedCount !== meta.participantCount) {
        throw new Error(
          `integrity-conflict: processedCount ${processedCount} != participantCount ${meta.participantCount}`,
        );
      }
    }

    const closedAt = Date.now();
    await seasonCloseMetaRef(firestore, seasonKey).set(
      {
        status: 'closed',
        processedCount,
        participantCount: meta.participantCount,
        closeCursor: null,
        closedAt,
        updatedAt: Timestamp.fromMillis(closedAt),
      },
      { merge: true },
    );

    return {
      ok: true,
      reason: 'success',
      seasonKey,
      status: 'closed',
      participantCount: meta.participantCount,
      processedCount,
      closedAt,
      pagesProcessed,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('integrity-conflict')) {
      return {
        ...base(),
        reason: 'integrity-conflict',
        seasonKey,
        durationMs: Date.now() - startedAt,
      };
    }
    console.error('[season-close-finalize]', { seasonKey, error: message });
    return {
      ...base(),
      reason: 'service-unavailable',
      seasonKey,
      durationMs: Date.now() - startedAt,
    };
  }
}

export async function ensureSeasonFinalized(
  firestore: Firestore,
  seasonKey: string,
  options?: { nowMs?: number; maxDurationMs?: number; forceEnabled?: boolean },
): Promise<FinalizeSeasonResult> {
  return finalizeSeason(firestore, seasonKey, options);
}

export async function getSeasonResultForUid(
  firestore: Firestore,
  uid: string,
  seasonKey: string,
  options?: {
    nowMs?: number;
    ensure?: boolean;
    forceEnabled?: boolean;
    maxEnsureDurationMs?: number;
  },
): Promise<GetSeasonResultResponse> {
  const nowMs = options?.nowMs ?? Date.now();
  const enabled = options?.forceEnabled === true || isSeasonCloseSnapshotEnabled();
  if (!enabled) {
    return {
      ok: false,
      reason: 'feature-disabled',
      seasonKey,
      season: null,
      result: null,
    };
  }
  if (!isValidLeaderboardSeasonKey(seasonKey)) {
    return {
      ok: false,
      reason: 'invalid-season-key',
      seasonKey,
      season: null,
      result: null,
    };
  }
  const timing = classifySeasonCloseTiming(seasonKey, nowMs);
  if (timing === 'future') {
    return {
      ok: false,
      reason: 'season-future',
      seasonKey,
      season: null,
      result: null,
    };
  }
  if (timing === 'active' || seasonKey === getLeaderboardSeasonKey(nowMs)) {
    return {
      ok: false,
      reason: 'season-active',
      seasonKey,
      season: null,
      result: null,
    };
  }

  try {
    let metaSnap = await seasonCloseMetaRef(firestore, seasonKey).get();
    let meta = readMeta(metaSnap.data() as Record<string, unknown> | undefined);
    if (!meta || meta.status !== 'closed') {
      if (options?.ensure !== false) {
        await ensureSeasonFinalized(firestore, seasonKey, {
          nowMs,
          maxDurationMs: options?.maxEnsureDurationMs ?? 20_000,
          forceEnabled: options?.forceEnabled,
        });
        metaSnap = await seasonCloseMetaRef(firestore, seasonKey).get();
        meta = readMeta(metaSnap.data() as Record<string, unknown> | undefined);
      }
    }
    if (!meta || meta.status !== 'closed') {
      return {
        ok: false,
        reason: 'finalization-pending',
        seasonKey,
        season: meta
          ? {
              seasonKey: meta.seasonKey,
              startsAt: meta.startsAt,
              endsAt: meta.endsAt,
              status: meta.status,
              participantCount: meta.participantCount,
              snapshotVersion: meta.snapshotVersion,
              closedAt: meta.closedAt,
            }
          : null,
        result: null,
      };
    }

    const resultSnap = await seasonCloseResultRef(firestore, seasonKey, uid).get();
    if (!resultSnap.exists) {
      return {
        ok: true,
        reason: 'not-participated',
        seasonKey,
        season: {
          seasonKey: meta.seasonKey,
          startsAt: meta.startsAt,
          endsAt: meta.endsAt,
          status: meta.status,
          participantCount: meta.participantCount,
          snapshotVersion: meta.snapshotVersion,
          closedAt: meta.closedAt,
        },
        result: null,
      };
    }
    const parsed = parseExistingResult(resultSnap.data() as Record<string, unknown> | undefined);
    if (!parsed || parsed.uid !== uid) {
      return {
        ok: false,
        reason: 'service-unavailable',
        seasonKey,
        season: null,
        result: null,
      };
    }
    return {
      ok: true,
      reason: 'success',
      seasonKey,
      season: {
        seasonKey: meta.seasonKey,
        startsAt: meta.startsAt,
        endsAt: meta.endsAt,
        status: meta.status as SeasonCloseStatus,
        participantCount: meta.participantCount,
        snapshotVersion: meta.snapshotVersion,
        closedAt: meta.closedAt,
      },
      result: {
        uid: parsed.uid,
        seasonKey: parsed.seasonKey,
        finalScore: parsed.finalScore,
        finalRank: parsed.finalRank,
        participantCount: parsed.participantCount,
        snapshottedAt: parsed.snapshottedAt,
        snapshotVersion: parsed.snapshotVersion,
      },
    };
  } catch (error) {
    console.error('[season-close-get-result]', {
      seasonKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      reason: 'service-unavailable',
      seasonKey,
      season: null,
      result: null,
    };
  }
}

/** Narrow account-deletion helper — deletes seasons/{seasonKey}/results/{uid} when present. */
export async function deleteSeasonCloseResultsForUid(
  firestore: Firestore,
  uid: string,
  nowMs = Date.now(),
): Promise<number> {
  let deleted = 0;
  const seasonKeys = new Set<string>();
  seasonKeys.add(getPreviousLeaderboardSeasonKey(nowMs));
  seasonKeys.add(getLeaderboardSeasonKey(nowMs));
  for (let week = 1; week <= 156; week += 1) {
    seasonKeys.add(getLeaderboardSeasonKey(nowMs - week * 7 * 86_400_000));
  }
  try {
    const listed = await firestore.collection('seasons').listDocuments();
    for (const ref of listed) {
      seasonKeys.add(ref.id);
    }
  } catch {
    // list may fail under emulator with empty root — ignore
  }
  for (const seasonKey of seasonKeys) {
    if (!isValidLeaderboardSeasonKey(seasonKey)) continue;
    const ref = seasonCloseResultRef(firestore, seasonKey, uid);
    const snap = await ref.get();
    if (!snap.exists) continue;
    await ref.delete();
    deleted += 1;
  }
  return deleted;
}
