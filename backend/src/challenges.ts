import { FieldValue, Timestamp, type Firestore, type Query, type Transaction } from 'firebase-admin/firestore';

import { CHALLENGE_CATALOG, getChallengeCatalogEntry } from './challengeCatalog';
import type { ChallengeDefinition, ChallengeProgress } from './challengeTypes';
import { getDailyPeriod, getPeriodForCadence, getSeasonDefinition, getWeeklyPeriod } from './seasonPeriods';
import { serverStateRef } from './serverState';
import type { ServerStateDocument } from './serverStateTypes';
import type { MarketplacePlayerState } from './vehicleMarketplaceTypes';

const CLAIM_SCHEMA_VERSION = 1;
const MAX_ACTIVITY_DOCS = 500;

export type ChallengeFailureReason =
  | 'auth-required'
  | 'invalid-request'
  | 'invalid-challenge-id'
  | 'challenge-disabled'
  | 'period-closed'
  | 'not-complete'
  | 'already-claimed'
  | 'server-state-not-initialized'
  | 'service-unavailable';

function safeDocumentId(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 160);
}

function claimRef(firestore: Firestore, uid: string, periodKey: string, challengeId: string) {
  return firestore.doc(
    `users/${uid}/challengeClaims/${safeDocumentId(`${periodKey}:${challengeId}`)}`,
  );
}

function seasonProgressRef(firestore: Firestore, uid: string, seasonKey: string) {
  return firestore.doc(`users/${uid}/seasonProgress/${safeDocumentId(seasonKey)}`);
}

function historyQuery(
  firestore: Firestore,
  uid: string,
  startsAt: number,
  endsAt: number,
): Query {
  return firestore
    .collection(`users/${uid}/marketplaceHistory`)
    .where('createdAt', '>=', Timestamp.fromMillis(startsAt))
    .where('createdAt', '<', Timestamp.fromMillis(endsAt))
    .orderBy('createdAt', 'asc')
    .limit(MAX_ACTIVITY_DOCS);
}

function countMetric(
  docs: Array<{ data(): Record<string, unknown> }>,
  uid: string,
  metric: ChallengeDefinition['metric'],
): number {
  if (metric === 'marketplace_purchases') {
    return docs.filter((doc) => doc.data().buyerUid === uid).length;
  }
  if (metric === 'marketplace_sales') {
    return docs.filter((doc) => doc.data().sellerUid === uid).length;
  }
  return 0;
}

function progressFor(
  definition: ChallengeDefinition,
  periodKey: string,
  rawCurrent: number,
  claimedAt?: number,
): ChallengeProgress {
  const current = Math.max(0, Math.min(definition.target, Math.floor(rawCurrent)));
  return {
    challengeId: definition.id,
    periodKey,
    current,
    target: definition.target,
    completed: current >= definition.target,
    claimed: Number.isFinite(claimedAt),
    ...(current >= definition.target ? { completedAt: claimedAt } : {}),
    ...(Number.isFinite(claimedAt) ? { claimedAt } : {}),
  };
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const result = (value as { toMillis(): number }).toMillis();
    return Number.isFinite(result) ? result : undefined;
  }
  return undefined;
}

export async function getCurrentChallengeState(
  firestore: Firestore,
  uid: string,
  nowMs = Date.now(),
) {
  const daily = getDailyPeriod(nowMs);
  const weekly = getWeeklyPeriod(nowMs);
  const definitions = CHALLENGE_CATALOG.filter((item) => item.enabled);
  const [dailyHistory, weeklyHistory, ...claimSnaps] = await Promise.all([
    historyQuery(firestore, uid, daily.startsAt, daily.endsAt).get(),
    historyQuery(firestore, uid, weekly.startsAt, weekly.endsAt).get(),
    ...definitions.map((definition) => {
      const period = definition.cadence === 'daily' ? daily : weekly;
      return claimRef(firestore, uid, period.key, definition.id).get();
    }),
  ]);
  const progress = definitions.map((definition, index) => {
    const period = definition.cadence === 'daily' ? daily : weekly;
    const history = definition.cadence === 'daily' ? dailyHistory.docs : weeklyHistory.docs;
    return progressFor(
      definition,
      period.key,
      countMetric(history, uid, definition.metric),
      timestampMs(claimSnaps[index]?.data()?.claimedAt),
    );
  });
  return {
    season: getSeasonDefinition(nowMs),
    dailyPeriod: daily,
    weeklyPeriod: weekly,
    catalogVersion: 1,
    challenges: definitions.map((definition, index) => ({
      definition,
      progress: progress[index],
    })),
  };
}

export async function claimChallengeRewardTransaction(
  firestore: Firestore,
  uid: string,
  input: { challengeId: string; periodKey: string; transactionId: string; idempotencyKey: string },
  nowMs = Date.now(),
) {
  const definition = getChallengeCatalogEntry(input.challengeId);
  if (!definition) {
    return { ok: false as const, reason: 'invalid-challenge-id' as const, ...input };
  }
  if (!definition.enabled) {
    return { ok: false as const, reason: 'challenge-disabled' as const, ...input };
  }
  const period = getPeriodForCadence(definition.cadence, nowMs);
  if (input.periodKey !== period.key || nowMs < period.startsAt || nowMs >= period.endsAt) {
    return { ok: false as const, reason: 'period-closed' as const, ...input };
  }
  try {
    return await firestore.runTransaction(async (transaction: Transaction) => {
      const claimDocument = claimRef(firestore, uid, period.key, definition.id);
      const marketplaceRef = firestore.doc(`users/${uid}/marketplaceState/current`);
      const serverRef = serverStateRef(firestore, uid);
      const season = getSeasonDefinition(nowMs);
      const seasonRef = seasonProgressRef(firestore, uid, season.key);
      const [claimSnap, marketplaceSnap, serverSnap, seasonSnap, historySnap] = await Promise.all([
        transaction.get(claimDocument),
        transaction.get(marketplaceRef),
        transaction.get(serverRef),
        transaction.get(seasonRef),
        transaction.get(historyQuery(firestore, uid, period.startsAt, period.endsAt)),
      ]);
      if (claimSnap.exists) {
        const previous = claimSnap.data();
        if (previous?.idempotencyKey === input.idempotencyKey) {
          return previous.result;
        }
        return { ok: false as const, reason: 'already-claimed' as const, ...input };
      }
      if (!marketplaceSnap.exists || !serverSnap.exists) {
        return { ok: false as const, reason: 'server-state-not-initialized' as const, ...input };
      }
      const current = countMetric(historySnap.docs, uid, definition.metric);
      if (current < definition.target) {
        return { ok: false as const, reason: 'not-complete' as const, ...input };
      }
      const marketplace = marketplaceSnap.data() as MarketplacePlayerState;
      const server = serverSnap.data() as ServerStateDocument;
      if (marketplace.ownerUid !== uid || server.ownerUid !== uid) {
        return { ok: false as const, reason: 'server-state-not-initialized' as const, ...input };
      }
      const cashReward = Math.max(0, Math.floor(definition.reward.cash ?? 0));
      const seasonPointsReward = Math.max(0, Math.floor(definition.reward.seasonPoints ?? 0));
      const cashAfter = Math.round((marketplace.canonicalCash + cashReward) * 100) / 100;
      const seasonPointsBefore = Math.max(0, Math.floor(Number(seasonSnap.data()?.points) || 0));
      const claimedAt = Timestamp.fromMillis(nowMs);
      const result = {
        ok: true as const,
        ...input,
        cashBefore: marketplace.canonicalCash,
        cashAfter,
        seasonKey: season.key,
        seasonPointsBefore,
        seasonPointsAfter: seasonPointsBefore + seasonPointsReward,
        reward: definition.reward,
      };
      transaction.update(marketplaceRef, {
        canonicalCash: cashAfter,
        stateVersion: FieldValue.increment(1),
        updatedAt: claimedAt,
      });
      transaction.update(serverRef, {
        cash: cashAfter,
        sourceVersion: FieldValue.increment(1),
        updatedAt: claimedAt,
      });
      transaction.set(seasonRef, {
        ownerUid: uid,
        seasonKey: season.key,
        points: seasonPointsBefore + seasonPointsReward,
        updatedAt: claimedAt,
        schemaVersion: 1,
      }, { merge: true });
      transaction.create(claimDocument, {
        ownerUid: uid,
        challengeId: definition.id,
        periodKey: period.key,
        seasonKey: season.key,
        transactionId: input.transactionId,
        idempotencyKey: input.idempotencyKey,
        reward: definition.reward,
        claimedAt,
        schemaVersion: CLAIM_SCHEMA_VERSION,
        result,
      });
      return result;
    });
  } catch {
    return { ok: false as const, reason: 'service-unavailable' as const, ...input };
  }
}
