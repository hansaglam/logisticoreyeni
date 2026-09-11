/**
 * Phase 7 Step 5 — Season reward entitlement materialization + claim.
 * Authority: canonical seasons/{seasonKey}/results + frozen catalog only.
 * Never reads mutable leaderboards. Never grants cash without entitlement.
 */

import {
  FieldValue,
  Timestamp,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import {
  classifySeasonCloseTiming,
  parseSeasonCloseResultDocument,
  seasonCloseMetaRef,
} from './seasonClose';
import { SEASON_CLOSE_SNAPSHOT_VERSION } from './seasonCloseTypes';
import {
  getLeaderboardSeasonKey,
  getPreviousLeaderboardSeasonKey,
  isValidLeaderboardSeasonKey,
} from './leaderboardSeason';
import type { MarketplacePlayerState } from './vehicleMarketplaceTypes';
import type { ServerStateDocument } from './serverStateTypes';
import { serverStateRef } from './serverState';
import {
  buildSeasonRewardEntitlementDraft,
  resolveSeasonReward,
} from './seasonRewardResolve';
import { SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT } from './seasonRewardCatalog';
import {
  isSeasonRewardsEnabled,
  SEASON_REWARD_CATALOG_VERSION,
  type SeasonRewardEntitlementDocument,
  type SeasonRewardTierId,
} from './seasonRewardTypes';

export const SEASON_REWARD_ENTITLEMENT_SCHEMA_VERSION = 1;
export const SEASON_REWARD_CLAIM_SCHEMA_VERSION = 1;
export const SEASON_REWARD_MATERIALIZE_PAGE_SIZE = 50;

export type SeasonRewardEntitlementDoc = SeasonRewardEntitlementDocument & {
  claimIdempotencyKey: string | null;
  version: number;
};

export type SeasonRewardClaimDocument = {
  uid: string;
  seasonKey: string;
  tierId: SeasonRewardTierId;
  cashAmount: number;
  rewardCatalogVersion: number;
  resultSnapshotVersion: number;
  finalRank: number;
  idempotencyKey: string;
  claimedAt: number;
  cashBefore: number;
  cashAfter: number;
  version: number;
};

export function seasonRewardEntitlementRef(
  firestore: Firestore,
  seasonKey: string,
  uid: string,
) {
  return firestore.doc(`seasons/${seasonKey}/rewardEntitlements/${uid}`);
}

export function seasonRewardClaimRef(
  firestore: Firestore,
  seasonKey: string,
  uid: string,
) {
  return firestore.doc(`seasons/${seasonKey}/rewardClaims/${uid}`);
}

export function frozenEntitlementFieldsMatch(
  existing: SeasonRewardEntitlementDoc,
  expected: SeasonRewardEntitlementDoc,
): boolean {
  return (
    existing.uid === expected.uid &&
    existing.seasonKey === expected.seasonKey &&
    existing.resultSnapshotVersion === expected.resultSnapshotVersion &&
    existing.rewardCatalogVersion === expected.rewardCatalogVersion &&
    existing.finalRank === expected.finalRank &&
    existing.participantCount === expected.participantCount &&
    existing.tierId === expected.tierId &&
    existing.cashAmount === expected.cashAmount &&
    existing.version === expected.version
  );
}

export function parseSeasonRewardEntitlementDocument(
  data: unknown,
): SeasonRewardEntitlementDoc | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const uid = typeof record.uid === 'string' ? record.uid : '';
  const seasonKey = typeof record.seasonKey === 'string' ? record.seasonKey : '';
  const tierId = record.tierId;
  const status = record.status;
  if (!uid || !isValidLeaderboardSeasonKey(seasonKey)) return null;
  if (
    tierId !== 'rank_1' &&
    tierId !== 'rank_2' &&
    tierId !== 'rank_3' &&
    tierId !== 'rank_4_10' &&
    tierId !== 'rank_11_25' &&
    tierId !== 'rank_26_50'
  ) {
    return null;
  }
  if (status !== 'unclaimed' && status !== 'claimed') return null;
  const finalRank = Number(record.finalRank);
  const participantCount = Number(record.participantCount);
  const cashAmount = Number(record.cashAmount);
  const resultSnapshotVersion = Number(record.resultSnapshotVersion);
  const rewardCatalogVersion = Number(record.rewardCatalogVersion);
  const createdAt = Number(record.createdAt);
  const version = Number(record.version);
  const claimedAt = record.claimedAt == null ? null : Number(record.claimedAt);
  const claimIdempotencyKey =
    record.claimIdempotencyKey == null
      ? null
      : typeof record.claimIdempotencyKey === 'string'
        ? record.claimIdempotencyKey
        : null;
  if (
    !Number.isInteger(finalRank) ||
    finalRank < 1 ||
    !Number.isInteger(participantCount) ||
    participantCount < 1 ||
    !Number.isFinite(cashAmount) ||
    cashAmount <= 0 ||
    resultSnapshotVersion !== SEASON_CLOSE_SNAPSHOT_VERSION ||
    rewardCatalogVersion !== SEASON_REWARD_CATALOG_VERSION ||
    !Number.isFinite(createdAt) ||
    version !== SEASON_REWARD_ENTITLEMENT_SCHEMA_VERSION ||
    (claimedAt != null && !Number.isFinite(claimedAt))
  ) {
    return null;
  }
  return {
    uid,
    seasonKey,
    resultSnapshotVersion,
    rewardCatalogVersion,
    finalRank,
    participantCount,
    tierId,
    cashAmount,
    status,
    createdAt,
    claimedAt,
    claimIdempotencyKey,
    version,
  };
}

export type MaterializeSeasonRewardsResult = {
  ok: boolean;
  reason:
    | 'success'
    | 'already-complete'
    | 'feature-disabled'
    | 'invalid-season-key'
    | 'season-not-closed'
    | 'rewards-disabled-for-season'
    | 'unsupported-catalog-version'
    | 'integrity-conflict'
    | 'timeout-partial'
    | 'service-unavailable';
  seasonKey: string;
  entitlementsCreated: number;
  entitlementsSkipped: number;
  pagesProcessed: number;
  complete: boolean;
};

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

/**
 * Create-once entitlements from canonical closed results.
 * Does not mutate player cash. Safe to retry.
 */
export async function materializeSeasonRewardEntitlements(
  firestore: Firestore,
  seasonKey: string,
  options: { nowMs?: number; maxDurationMs?: number; pageSize?: number } = {},
): Promise<MaterializeSeasonRewardsResult> {
  const nowMs = options.nowMs ?? Date.now();
  const maxDurationMs = options.maxDurationMs ?? 45_000;
  const pageSize = options.pageSize ?? SEASON_REWARD_MATERIALIZE_PAGE_SIZE;
  const base = {
    seasonKey: String(seasonKey ?? ''),
    entitlementsCreated: 0,
    entitlementsSkipped: 0,
    pagesProcessed: 0,
    complete: false,
  };

  if (!isSeasonRewardsEnabled()) {
    return { ok: false, reason: 'feature-disabled', ...base };
  }
  if (!isValidLeaderboardSeasonKey(seasonKey)) {
    return { ok: false, reason: 'invalid-season-key', ...base };
  }

  try {
    const metaRef = seasonCloseMetaRef(firestore, seasonKey);
    const metaSnap = await metaRef.get();
    if (!metaSnap.exists) {
      return { ok: false, reason: 'season-not-closed', ...base };
    }
    const meta = metaSnap.data() as Record<string, unknown>;
    if (meta.status !== 'closed') {
      return { ok: false, reason: 'season-not-closed', ...base };
    }
    const timing = classifySeasonCloseTiming(seasonKey, nowMs);
    if (timing !== 'ended') {
      return { ok: false, reason: 'season-not-closed', ...base };
    }

    if (meta.rewardsEnabled !== true) {
      return { ok: false, reason: 'rewards-disabled-for-season', ...base, complete: true };
    }
    const rewardCatalogVersion = Number(meta.rewardCatalogVersion);
    if (
      !Number.isInteger(rewardCatalogVersion) ||
      rewardCatalogVersion !== SEASON_REWARD_CATALOG_VERSION
    ) {
      return { ok: false, reason: 'unsupported-catalog-version', ...base };
    }
    if (meta.rewardMaterializationComplete === true) {
      return { ok: true, reason: 'already-complete', ...base, complete: true };
    }

    let created = 0;
    let skipped = 0;
    let pages = 0;
    let cursorUid =
      typeof meta.rewardMaterializationCursorUid === 'string'
        ? meta.rewardMaterializationCursorUid
        : null;
    const started = Date.now();

    for (;;) {
      if (Date.now() - started > maxDurationMs) {
        await metaRef.set(
          {
            rewardMaterializationCursorUid: cursorUid,
            rewardMaterializationComplete: false,
          },
          { merge: true },
        );
        return {
          ok: true,
          reason: 'timeout-partial',
          seasonKey,
          entitlementsCreated: created,
          entitlementsSkipped: skipped,
          pagesProcessed: pages,
          complete: false,
        };
      }

      let query = firestore
        .collection(`seasons/${seasonKey}/results`)
        .orderBy('__name__')
        .limit(pageSize);
      if (cursorUid) {
        query = query.startAfter(cursorUid);
      }
      const page = await query.get();
      pages += 1;
      if (page.empty) {
        await metaRef.set(
          {
            rewardMaterializationCursorUid: null,
            rewardMaterializationComplete: true,
          },
          { merge: true },
        );
        return {
          ok: true,
          reason: 'success',
          seasonKey,
          entitlementsCreated: created,
          entitlementsSkipped: skipped,
          pagesProcessed: pages,
          complete: true,
        };
      }

      for (const doc of page.docs) {
        const parsed = parseSeasonCloseResultDocument(doc.data());
        if (!parsed || parsed.uid !== doc.id) {
          return {
            ok: false,
            reason: 'integrity-conflict',
            seasonKey,
            entitlementsCreated: created,
            entitlementsSkipped: skipped,
            pagesProcessed: pages,
            complete: false,
          };
        }

        const draft = buildSeasonRewardEntitlementDraft({
          uid: parsed.uid,
          seasonKey,
          finalRank: parsed.finalRank,
          participantCount: parsed.participantCount,
          snapshotVersion: parsed.snapshotVersion,
          rewardCatalogVersion,
          nowMs,
        });

        cursorUid = doc.id;

        if (!draft.ok) {
          skipped += 1;
          continue;
        }

        const expected: SeasonRewardEntitlementDoc = {
          ...draft.entitlement,
          claimIdempotencyKey: null,
          version: SEASON_REWARD_ENTITLEMENT_SCHEMA_VERSION,
        };

        const entRef = seasonRewardEntitlementRef(firestore, seasonKey, parsed.uid);
        try {
          await entRef.create(expected);
          created += 1;
        } catch (error) {
          if (!isAlreadyExistsError(error)) {
            throw error;
          }
          const existingSnap = await entRef.get();
          const existing = parseSeasonRewardEntitlementDocument(existingSnap.data());
          if (!existing || !frozenEntitlementFieldsMatch(existing, expected)) {
            return {
              ok: false,
              reason: 'integrity-conflict',
              seasonKey,
              entitlementsCreated: created,
              entitlementsSkipped: skipped,
              pagesProcessed: pages,
              complete: false,
            };
          }
          skipped += 1;
        }
      }

      if (page.size < pageSize) {
        await metaRef.set(
          {
            rewardMaterializationCursorUid: null,
            rewardMaterializationComplete: true,
          },
          { merge: true },
        );
        return {
          ok: true,
          reason: 'success',
          seasonKey,
          entitlementsCreated: created,
          entitlementsSkipped: skipped,
          pagesProcessed: pages,
          complete: true,
        };
      }

      await metaRef.set(
        {
          rewardMaterializationCursorUid: cursorUid,
          rewardMaterializationComplete: false,
        },
        { merge: true },
      );
    }
  } catch {
    return { ok: false, reason: 'service-unavailable', ...base };
  }
}

export type GetSeasonRewardEntitlementResponse = {
  ok: boolean;
  reason:
    | 'eligible_unclaimed'
    | 'claimed'
    | 'no_reward'
    | 'insufficient_participants'
    | 'rewards_disabled'
    | 'pending'
    | 'season_pending'
    | 'season_active'
    | 'season_future'
    | 'invalid-season-key'
    | 'feature-disabled'
    | 'service-unavailable';
  seasonKey: string;
  entitlement: {
    tierId: SeasonRewardTierId;
    cashAmount: number;
    finalRank: number;
    status: 'unclaimed' | 'claimed';
    claimedAt: number | null;
  } | null;
};

export async function getSeasonRewardEntitlementForUid(
  firestore: Firestore,
  uid: string,
  seasonKey: string,
  nowMs = Date.now(),
): Promise<GetSeasonRewardEntitlementResponse> {
  const empty = {
    seasonKey,
    entitlement: null as GetSeasonRewardEntitlementResponse['entitlement'],
  };
  if (!isSeasonRewardsEnabled()) {
    return { ok: false, reason: 'feature-disabled', ...empty };
  }
  if (!isValidLeaderboardSeasonKey(seasonKey)) {
    return { ok: false, reason: 'invalid-season-key', ...empty };
  }
  const timing = classifySeasonCloseTiming(seasonKey, nowMs);
  if (timing === 'active') {
    return { ok: false, reason: 'season_active', ...empty };
  }
  if (timing === 'future') {
    return { ok: false, reason: 'season_future', ...empty };
  }
  try {
    const metaSnap = await seasonCloseMetaRef(firestore, seasonKey).get();
    if (!metaSnap.exists || metaSnap.data()?.status !== 'closed') {
      return { ok: false, reason: 'season_pending', ...empty };
    }
    const meta = metaSnap.data() as Record<string, unknown>;
    if (meta.rewardsEnabled !== true) {
      return { ok: true, reason: 'rewards_disabled', ...empty };
    }
    const entSnap = await seasonRewardEntitlementRef(firestore, seasonKey, uid).get();
    if (entSnap.exists) {
      const entitlement = parseSeasonRewardEntitlementDocument(entSnap.data());
      if (!entitlement || entitlement.uid !== uid) {
        return { ok: false, reason: 'service-unavailable', ...empty };
      }
      return {
        ok: true,
        reason: entitlement.status === 'claimed' ? 'claimed' : 'eligible_unclaimed',
        seasonKey,
        entitlement: {
          tierId: entitlement.tierId,
          cashAmount: entitlement.cashAmount,
          finalRank: entitlement.finalRank,
          status: entitlement.status,
          claimedAt: entitlement.claimedAt,
        },
      };
    }
    // No entitlement yet — distinguish pending materialization vs policy no-reward.
    if (meta.rewardMaterializationComplete !== true) {
      return { ok: true, reason: 'pending', ...empty };
    }
    const resultSnap = await firestore.doc(`seasons/${seasonKey}/results/${uid}`).get();
    const result = parseSeasonCloseResultDocument(resultSnap.data());
    if (
      result &&
      result.participantCount < SEASON_REWARD_MINIMUM_PARTICIPANT_COUNT
    ) {
      return { ok: true, reason: 'insufficient_participants', ...empty };
    }
    return { ok: true, reason: 'no_reward', ...empty };
  } catch {
    return { ok: false, reason: 'service-unavailable', ...empty };
  }
}

export type ClaimSeasonRewardResult = {
  ok: boolean;
  reason:
    | 'success'
    | 'already-claimed'
    | 'no_reward'
    | 'rewards_disabled'
    | 'feature-disabled'
    | 'invalid-season-key'
    | 'invalid-request'
    | 'season_active'
    | 'season_future'
    | 'season_pending'
    | 'server-state-not-initialized'
    | 'service-unavailable';
  seasonKey: string;
  cashBefore: number | null;
  cashAfter: number | null;
  cashAmount: number | null;
  tierId: SeasonRewardTierId | null;
  claimedAt: number | null;
};

export async function claimSeasonRewardTransaction(
  firestore: Firestore,
  uid: string,
  input: { seasonKey: string; idempotencyKey: string },
  nowMs = Date.now(),
): Promise<ClaimSeasonRewardResult> {
  const base: ClaimSeasonRewardResult = {
    ok: false,
    reason: 'service-unavailable',
    seasonKey: input.seasonKey,
    cashBefore: null,
    cashAfter: null,
    cashAmount: null,
    tierId: null,
    claimedAt: null,
  };

  if (!isSeasonRewardsEnabled()) {
    return { ...base, reason: 'feature-disabled' };
  }
  if (!isValidLeaderboardSeasonKey(input.seasonKey)) {
    return { ...base, reason: 'invalid-season-key' };
  }
  if (
    typeof input.idempotencyKey !== 'string' ||
    input.idempotencyKey.length < 8 ||
    input.idempotencyKey.length > 128
  ) {
    return { ...base, reason: 'invalid-request' };
  }

  const timing = classifySeasonCloseTiming(input.seasonKey, nowMs);
  if (timing === 'active') return { ...base, reason: 'season_active' };
  if (timing === 'future') return { ...base, reason: 'season_future' };

  try {
    return await firestore.runTransaction(async (transaction: Transaction) => {
      const metaRef = seasonCloseMetaRef(firestore, input.seasonKey);
      const entRef = seasonRewardEntitlementRef(firestore, input.seasonKey, uid);
      const claimRef = seasonRewardClaimRef(firestore, input.seasonKey, uid);
      const marketplaceRef = firestore.doc(`users/${uid}/marketplaceState/current`);
      const serverRef = serverStateRef(firestore, uid);

      const [metaSnap, entSnap, claimSnap, marketplaceSnap, serverSnap] =
        await Promise.all([
          transaction.get(metaRef),
          transaction.get(entRef),
          transaction.get(claimRef),
          transaction.get(marketplaceRef),
          transaction.get(serverRef),
        ]);

      if (!metaSnap.exists || metaSnap.data()?.status !== 'closed') {
        return { ...base, reason: 'season_pending' };
      }
      if (metaSnap.data()?.rewardsEnabled !== true) {
        return { ...base, reason: 'rewards_disabled' };
      }

      if (claimSnap.exists) {
        const previous = claimSnap.data() as SeasonRewardClaimDocument;
        if (previous.idempotencyKey === input.idempotencyKey) {
          return {
            ok: true,
            reason: 'success',
            seasonKey: input.seasonKey,
            cashBefore: previous.cashBefore,
            cashAfter: previous.cashAfter,
            cashAmount: previous.cashAmount,
            tierId: previous.tierId,
            claimedAt: previous.claimedAt,
          };
        }
        return {
          ok: false,
          reason: 'already-claimed',
          seasonKey: input.seasonKey,
          cashBefore: null,
          cashAfter: null,
          cashAmount: previous.cashAmount ?? null,
          tierId: previous.tierId ?? null,
          claimedAt: previous.claimedAt ?? null,
        };
      }

      const entitlement = parseSeasonRewardEntitlementDocument(entSnap.data());
      if (!entitlement || entitlement.uid !== uid) {
        return { ...base, reason: 'no_reward' };
      }
      if (entitlement.status === 'claimed') {
        return {
          ok: false,
          reason: 'already-claimed',
          seasonKey: input.seasonKey,
          cashBefore: null,
          cashAfter: null,
          cashAmount: entitlement.cashAmount,
          tierId: entitlement.tierId,
          claimedAt: entitlement.claimedAt,
        };
      }

      const resolve = resolveSeasonReward({
        finalRank: entitlement.finalRank,
        participantCount: entitlement.participantCount,
        snapshotVersion: entitlement.resultSnapshotVersion,
        rewardCatalogVersion: entitlement.rewardCatalogVersion,
      });
      if (
        !resolve.eligible ||
        resolve.tierId !== entitlement.tierId ||
        resolve.cashAmount !== entitlement.cashAmount
      ) {
        return { ...base, reason: 'service-unavailable' };
      }

      if (!marketplaceSnap.exists || !serverSnap.exists) {
        return { ...base, reason: 'server-state-not-initialized' };
      }
      const marketplace = marketplaceSnap.data() as MarketplacePlayerState;
      const server = serverSnap.data() as ServerStateDocument;
      if (marketplace.ownerUid !== uid || server.ownerUid !== uid) {
        return { ...base, reason: 'server-state-not-initialized' };
      }

      const cashReward = Math.max(0, Math.floor(entitlement.cashAmount));
      const cashAfter = Math.round((marketplace.canonicalCash + cashReward) * 100) / 100;
      const claimedAt = nowMs;
      const claimedAtTs = Timestamp.fromMillis(claimedAt);

      transaction.update(marketplaceRef, {
        canonicalCash: cashAfter,
        stateVersion: FieldValue.increment(1),
        updatedAt: claimedAtTs,
      });
      transaction.update(serverRef, {
        cash: cashAfter,
        sourceVersion: FieldValue.increment(1),
        updatedAt: claimedAtTs,
      });
      transaction.update(entRef, {
        status: 'claimed',
        claimedAt,
        claimIdempotencyKey: input.idempotencyKey,
      });
      transaction.create(claimRef, {
        uid,
        seasonKey: input.seasonKey,
        tierId: entitlement.tierId,
        cashAmount: cashReward,
        rewardCatalogVersion: entitlement.rewardCatalogVersion,
        resultSnapshotVersion: entitlement.resultSnapshotVersion,
        finalRank: entitlement.finalRank,
        idempotencyKey: input.idempotencyKey,
        claimedAt,
        cashBefore: marketplace.canonicalCash,
        cashAfter,
        version: SEASON_REWARD_CLAIM_SCHEMA_VERSION,
      } satisfies SeasonRewardClaimDocument);

      return {
        ok: true,
        reason: 'success',
        seasonKey: input.seasonKey,
        cashBefore: marketplace.canonicalCash,
        cashAfter,
        cashAmount: cashReward,
        tierId: entitlement.tierId,
        claimedAt,
      };
    });
  } catch {
    return { ...base, reason: 'service-unavailable' };
  }
}

/** Account deletion helper — removes caller's reward entitlement + claim docs. */
export async function deleteSeasonRewardDataForUid(
  firestore: Firestore,
  uid: string,
  nowMs = Date.now(),
): Promise<{ entitlementsDeleted: number; claimsDeleted: number }> {
  let entitlementsDeleted = 0;
  let claimsDeleted = 0;
  const seasonKeys = new Set<string>();
  seasonKeys.add(getPreviousLeaderboardSeasonKey(nowMs));
  seasonKeys.add(getLeaderboardSeasonKey(nowMs));
  for (let week = 1; week <= 156; week += 1) {
    seasonKeys.add(getLeaderboardSeasonKey(nowMs - week * 7 * 86_400_000));
  }
  try {
    const listed = await firestore.collection('seasons').listDocuments();
    for (const ref of listed) seasonKeys.add(ref.id);
  } catch {
    // ignore list failures
  }

  for (const seasonKey of seasonKeys) {
    if (!isValidLeaderboardSeasonKey(seasonKey)) continue;
    const entRef = seasonRewardEntitlementRef(firestore, seasonKey, uid);
    const claimRef = seasonRewardClaimRef(firestore, seasonKey, uid);
    const [entSnap, claimSnap] = await Promise.all([entRef.get(), claimRef.get()]);
    if (entSnap.exists) {
      await entRef.delete();
      entitlementsDeleted += 1;
    }
    if (claimSnap.exists) {
      await claimRef.delete();
      claimsDeleted += 1;
    }
  }
  return { entitlementsDeleted, claimsDeleted };
}
