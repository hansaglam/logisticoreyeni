import { createHash } from 'node:crypto';

import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

import { runFirestoreTransactionWithRetry } from './firestoreTransactionUtils';
import { serverStateRef } from './serverState';
import type { ServerStateDocument } from './serverStateTypes';
import type { MarketplacePlayerState } from './vehicleMarketplaceTypes';
import {
  WEEKLY_MISSION_CATALOG,
  getEnabledWeeklyMissionTemplates,
  toWeeklyMissionSnapshot,
  validateWeeklyMissionRotationSnapshots,
} from './weeklyMissionCatalog';
import {
  WEEKLY_MISSION_CATALOG_VERSION,
  WEEKLY_MISSION_SCHEMA_VERSION,
  WEEKLY_MISSION_WEEKLY_CASH_CAP,
  isWeeklyMissionsBackendEnabled,
  type WeeklyMissionBaselineDocument,
  type WeeklyMissionClaimDocument,
  type WeeklyMissionDifficulty,
  type WeeklyMissionFailureReason,
  type WeeklyMissionRotationDocument,
  type WeeklyMissionSnapshot,
  type WeeklyMissionTemplate,
} from './weeklyMissionTypes';
import {
  getWeeklyMissionBoundsFromKey,
  getWeeklyMissionPeriod,
  isValidWeeklyMissionWeekKey,
} from './weeklyMissionWeek';

const DIFFICULTIES: readonly WeeklyMissionDifficulty[] = ['easy', 'medium', 'hard'];

export function weeklyMissionTemplateRef(firestore: Firestore, missionId: string) {
  return firestore.doc(`weeklyMissionTemplates/${missionId}`);
}

export function weeklyMissionRotationRef(firestore: Firestore, weekKey: string) {
  return firestore.doc(`weeklyMissionRotations/${weekKey}`);
}

export function weeklyMissionBaselineRef(firestore: Firestore, uid: string, weekKey: string) {
  return firestore.doc(`users/${uid}/weeklyMissionBaselines/${weekKey}`);
}

export function weeklyMissionClaimRef(
  firestore: Firestore,
  uid: string,
  weekKey: string,
  missionId: string,
) {
  return firestore.doc(`users/${uid}/weeklyMissionClaims/${weekKey}:${missionId}`);
}

function hashUInt32(seed: string): number {
  return createHash('sha256').update(seed).digest().readUInt32BE(0);
}

function pickWeighted(
  pool: readonly WeeklyMissionTemplate[],
  seed: string,
): WeeklyMissionTemplate | null {
  if (pool.length === 0) {
    return null;
  }
  const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }
  let cursor = hashUInt32(seed) % totalWeight;
  for (const item of pool) {
    cursor -= item.weight;
    if (cursor < 0) {
      return item;
    }
  }
  return pool[pool.length - 1] ?? null;
}

export function selectWeeklyMissionRotation(
  weekKey: string,
  catalogVersion: number = WEEKLY_MISSION_CATALOG_VERSION,
  catalog: readonly WeeklyMissionTemplate[] = WEEKLY_MISSION_CATALOG,
):
  | { ok: true; missions: WeeklyMissionSnapshot[]; missionIds: string[] }
  | { ok: false; reason: 'invalid-catalog' | 'invalid-week-key' } {
  if (!isValidWeeklyMissionWeekKey(weekKey)) {
    return { ok: false, reason: 'invalid-week-key' };
  }
  const enabled = getEnabledWeeklyMissionTemplates(catalog);
  const selected: WeeklyMissionTemplate[] = [];
  for (const difficulty of DIFFICULTIES) {
    const pool = enabled.filter((item) => item.difficulty === difficulty);
    const picked = pickWeighted(pool, `${weekKey}|${catalogVersion}|${difficulty}`);
    if (!picked) {
      return { ok: false, reason: 'invalid-catalog' };
    }
    selected.push(picked);
  }
  const missions = selected.map(toWeeklyMissionSnapshot);
  const valid = validateWeeklyMissionRotationSnapshots(missions);
  if (!valid.ok) {
    return valid;
  }
  return {
    ok: true,
    missions,
    missionIds: missions.map((mission) => mission.id),
  };
}

function parseRotation(
  data: Record<string, unknown> | undefined,
  weekKey: string,
): WeeklyMissionRotationDocument | null {
  if (!data) {
    return null;
  }
  if (data.weekKey !== weekKey || data.locked !== true) {
    return null;
  }
  if (!Array.isArray(data.missions) || !Array.isArray(data.missionIds)) {
    return null;
  }
  const missions = data.missions as WeeklyMissionSnapshot[];
  const valid = validateWeeklyMissionRotationSnapshots(missions);
  if (!valid.ok) {
    return null;
  }
  if (missions.map((mission) => mission.id).join('|') !== (data.missionIds as string[]).join('|')) {
    return null;
  }
  const startsAt = Number(data.startsAt);
  const endsAt = Number(data.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) {
    return null;
  }
  return {
    weekKey,
    startsAt,
    endsAt,
    version: Number(data.version) || WEEKLY_MISSION_SCHEMA_VERSION,
    catalogVersion: Number(data.catalogVersion) || WEEKLY_MISSION_CATALOG_VERSION,
    locked: true,
    createdAt: Number(data.createdAt) || startsAt,
    missionIds: missions.map((mission) => mission.id),
    missions,
  };
}

async function mirrorWeeklyMissionTemplates(firestore: Firestore): Promise<void> {
  const enabled = getEnabledWeeklyMissionTemplates();
  await Promise.all(
    enabled.map((template) =>
      weeklyMissionTemplateRef(firestore, template.id).set(
        {
          ...template,
          catalogVersion: WEEKLY_MISSION_CATALOG_VERSION,
        },
        { merge: true },
      ),
    ),
  );
}

export async function ensureWeeklyMissionRotation(
  firestore: Firestore,
  nowMs = Date.now(),
  options?: { forceEnabled?: boolean },
): Promise<
  | { ok: true; rotation: WeeklyMissionRotationDocument; created: boolean }
  | { ok: false; reason: WeeklyMissionFailureReason }
> {
  if (!options?.forceEnabled && !isWeeklyMissionsBackendEnabled()) {
    return { ok: false, reason: 'feature-disabled' };
  }
  const period = getWeeklyMissionPeriod(nowMs);
  const selected = selectWeeklyMissionRotation(period.weekKey);
  if (!selected.ok) {
    return { ok: false, reason: 'rotation-unavailable' };
  }
  const bounds = getWeeklyMissionBoundsFromKey(period.weekKey);
  if (!bounds) {
    return { ok: false, reason: 'invalid-week-key' };
  }

  try {
    await mirrorWeeklyMissionTemplates(firestore);
    const { result } = await runFirestoreTransactionWithRetry(firestore, async (transaction) => {
      const ref = weeklyMissionRotationRef(firestore, period.weekKey);
      const snap = await transaction.get(ref);
      if (snap.exists) {
        const existing = parseRotation(snap.data() as Record<string, unknown>, period.weekKey);
        if (!existing) {
          return { ok: false as const, reason: 'rotation-unavailable' as const };
        }
        return { ok: true as const, rotation: existing, created: false };
      }
      const rotation: WeeklyMissionRotationDocument = {
        weekKey: period.weekKey,
        startsAt: bounds.startsAt,
        endsAt: bounds.endsAt,
        version: WEEKLY_MISSION_SCHEMA_VERSION,
        catalogVersion: WEEKLY_MISSION_CATALOG_VERSION,
        locked: true,
        createdAt: nowMs,
        missionIds: selected.missionIds,
        missions: selected.missions,
      };
      transaction.create(ref, rotation);
      return { ok: true as const, rotation, created: true };
    });
    return result;
  } catch {
    return { ok: false, reason: 'service-unavailable' };
  }
}

function readCompletedDeliveries(state: ServerStateDocument | undefined): number {
  const raw = state?.completedDeliveries;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.floor(raw));
}

async function readOrCreateBaseline(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  weekKey: string,
  completedDeliveries: number,
  nowMs: number,
): Promise<number> {
  const ref = weeklyMissionBaselineRef(firestore, uid, weekKey);
  const snap = await transaction.get(ref);
  if (snap.exists) {
    const data = snap.data() as WeeklyMissionBaselineDocument;
    const baseline = Number(data.completedDeliveriesBaseline);
    return Number.isFinite(baseline) ? Math.max(0, Math.floor(baseline)) : completedDeliveries;
  }
  const baseline = completedDeliveries;
  const doc: WeeklyMissionBaselineDocument = {
    ownerUid: uid,
    weekKey,
    completedDeliveriesBaseline: baseline,
    createdAt: nowMs,
    schemaVersion: WEEKLY_MISSION_SCHEMA_VERSION,
  };
  transaction.create(ref, {
    ...doc,
    createdAtTs: Timestamp.fromMillis(nowMs),
  });
  return baseline;
}

export type WeeklyMissionPlayerView = WeeklyMissionSnapshot & {
  progress: number;
  completed: boolean;
  claimed: boolean;
  claimedAt: number | null;
  claimAvailable: boolean;
};

export type GetWeeklyMissionsResult =
  | {
      ok: true;
      weekKey: string;
      startsAt: number;
      endsAt: number;
      remainingMs: number;
      claimAvailableForAccount: boolean;
      missions: WeeklyMissionPlayerView[];
    }
  | {
      ok: false;
      reason: WeeklyMissionFailureReason;
    };

export async function getWeeklyMissionsState(
  firestore: Firestore,
  input: { uid: string | null; linkedAccount: boolean },
  nowMs = Date.now(),
): Promise<GetWeeklyMissionsResult> {
  if (!isWeeklyMissionsBackendEnabled()) {
    return { ok: false, reason: 'feature-disabled' };
  }
  const ensured = await ensureWeeklyMissionRotation(firestore, nowMs);
  if (!ensured.ok) {
    return ensured;
  }
  const { rotation } = ensured;
  const remainingMs = Math.max(0, rotation.endsAt - nowMs);

  if (!input.linkedAccount || !input.uid) {
    return {
      ok: true,
      weekKey: rotation.weekKey,
      startsAt: rotation.startsAt,
      endsAt: rotation.endsAt,
      remainingMs,
      claimAvailableForAccount: false,
      missions: rotation.missions.map((mission) => ({
        ...mission,
        progress: 0,
        completed: false,
        claimed: false,
        claimedAt: null,
        claimAvailable: false,
      })),
    };
  }

  const uid = input.uid;
  try {
    const { result } = await runFirestoreTransactionWithRetry(firestore, async (transaction) => {
      const serverRef = serverStateRef(firestore, uid);
      const claimRefs = rotation.missionIds.map((missionId) =>
        weeklyMissionClaimRef(firestore, uid, rotation.weekKey, missionId),
      );
      const [serverSnap, ...claimSnaps] = await Promise.all([
        transaction.get(serverRef),
        ...claimRefs.map((ref) => transaction.get(ref)),
      ]);
      const server = serverSnap.exists
        ? (serverSnap.data() as ServerStateDocument)
        : undefined;
      const completedDeliveries = readCompletedDeliveries(server);
      const baseline = serverSnap.exists
        ? await readOrCreateBaseline(
            transaction,
            firestore,
            uid,
            rotation.weekKey,
            completedDeliveries,
            nowMs,
          )
        : completedDeliveries;
      const weeklyProgress = Math.max(0, completedDeliveries - baseline);
      const missions: WeeklyMissionPlayerView[] = rotation.missions.map((mission, index) => {
        const claimSnap = claimSnaps[index];
        const claimed = Boolean(claimSnap?.exists);
        const claimedAt = claimed ? Number(claimSnap?.data()?.claimedAt) || null : null;
        const progress = Math.min(mission.target, weeklyProgress);
        const completed = weeklyProgress >= mission.target;
        return {
          ...mission,
          progress,
          completed,
          claimed,
          claimedAt: Number.isFinite(claimedAt) ? claimedAt : null,
          claimAvailable:
            Boolean(serverSnap.exists) && completed && !claimed,
        };
      });
      return {
        ok: true as const,
        weekKey: rotation.weekKey,
        startsAt: rotation.startsAt,
        endsAt: rotation.endsAt,
        remainingMs,
        claimAvailableForAccount: Boolean(serverSnap.exists),
        missions,
      };
    });
    return result;
  } catch {
    return { ok: false, reason: 'service-unavailable' };
  }
}

export type ClaimWeeklyMissionResult =
  | {
      ok: true;
      weekKey: string;
      missionId: string;
      cashBefore: number;
      cashAfter: number;
      cashAmount: number;
      claimedAt: number;
    }
  | {
      ok: false;
      reason: WeeklyMissionFailureReason;
      weekKey: string;
      missionId: string;
    };

export async function claimWeeklyMissionRewardTransaction(
  firestore: Firestore,
  uid: string,
  input: { weekKey: string; missionId: string; idempotencyKey: string },
  nowMs = Date.now(),
): Promise<ClaimWeeklyMissionResult> {
  const base = {
    weekKey: typeof input.weekKey === 'string' ? input.weekKey : '',
    missionId: typeof input.missionId === 'string' ? input.missionId : '',
  };
  if (!isWeeklyMissionsBackendEnabled()) {
    return { ok: false, reason: 'feature-disabled', ...base };
  }
  if (
    !isValidWeeklyMissionWeekKey(input.weekKey) ||
    typeof input.missionId !== 'string' ||
    input.missionId.length < 1 ||
    input.missionId.length > 80 ||
    typeof input.idempotencyKey !== 'string' ||
    input.idempotencyKey.length < 8 ||
    input.idempotencyKey.length > 128
  ) {
    return { ok: false, reason: 'invalid-request', ...base };
  }

  const period = getWeeklyMissionPeriod(nowMs);
  if (input.weekKey !== period.weekKey || nowMs < period.startsAt || nowMs >= period.endsAt) {
    return { ok: false, reason: 'week-not-current', ...base };
  }

  const ensured = await ensureWeeklyMissionRotation(firestore, nowMs);
  if (!ensured.ok) {
    return { ok: false, reason: ensured.reason, ...base };
  }
  const { rotation } = ensured;
  const mission = rotation.missions.find((item) => item.id === input.missionId);
  if (!mission) {
    return { ok: false, reason: 'invalid-mission-id', ...base };
  }

  try {
    const { result } = await runFirestoreTransactionWithRetry(firestore, async (transaction) => {
      const claimRef = weeklyMissionClaimRef(firestore, uid, rotation.weekKey, mission.id);
      const marketplaceRef = firestore.doc(`users/${uid}/marketplaceState/current`);
      const serverRef = serverStateRef(firestore, uid);
      const siblingRefs = rotation.missionIds
        .filter((missionId) => missionId !== mission.id)
        .map((missionId) =>
          weeklyMissionClaimRef(firestore, uid, rotation.weekKey, missionId),
        );
      const [claimSnap, marketplaceSnap, serverSnap, ...siblingSnaps] = await Promise.all([
        transaction.get(claimRef),
        transaction.get(marketplaceRef),
        transaction.get(serverRef),
        ...siblingRefs.map((ref) => transaction.get(ref)),
      ]);

      if (claimSnap.exists) {
        const previous = claimSnap.data() as WeeklyMissionClaimDocument;
        if (previous.idempotencyKey === input.idempotencyKey) {
          return {
            ok: true as const,
            weekKey: rotation.weekKey,
            missionId: mission.id,
            cashBefore: previous.cashBefore,
            cashAfter: previous.cashAfter,
            cashAmount: previous.reward.cash,
            claimedAt: previous.claimedAt,
          };
        }
        return { ok: false as const, reason: 'already-claimed' as const, ...base };
      }

      if (!marketplaceSnap.exists || !serverSnap.exists) {
        return { ok: false as const, reason: 'server-state-not-initialized' as const, ...base };
      }

      const marketplace = marketplaceSnap.data() as MarketplacePlayerState;
      const server = serverSnap.data() as ServerStateDocument;
      if (marketplace.ownerUid !== uid || server.ownerUid !== uid) {
        return { ok: false as const, reason: 'server-state-not-initialized' as const, ...base };
      }

      const completedDeliveries = readCompletedDeliveries(server);
      const baseline = await readOrCreateBaseline(
        transaction,
        firestore,
        uid,
        rotation.weekKey,
        completedDeliveries,
        nowMs,
      );
      const weeklyProgress = Math.max(0, completedDeliveries - baseline);
      if (weeklyProgress < mission.target) {
        return { ok: false as const, reason: 'not-complete' as const, ...base };
      }

      let paidThisWeek = 0;
      for (const sibling of siblingSnaps) {
        if (!sibling.exists) continue;
        paidThisWeek += Math.max(0, Math.floor(Number(sibling.data()?.reward?.cash) || 0));
      }
      const cashReward = Math.max(0, Math.floor(mission.reward.cash));
      if (paidThisWeek + cashReward > WEEKLY_MISSION_WEEKLY_CASH_CAP) {
        return { ok: false as const, reason: 'weekly-cap-exceeded' as const, ...base };
      }

      const cashBefore = marketplace.canonicalCash;
      const cashAfter = Math.round((cashBefore + cashReward) * 100) / 100;
      const claimedAt = nowMs;
      const claimedAtTs = Timestamp.fromMillis(claimedAt);
      const claimDoc: WeeklyMissionClaimDocument = {
        ownerUid: uid,
        weekKey: rotation.weekKey,
        missionId: mission.id,
        idempotencyKey: input.idempotencyKey,
        reward: { cash: cashReward },
        claimedAt,
        schemaVersion: WEEKLY_MISSION_SCHEMA_VERSION,
        cashBefore,
        cashAfter,
      };

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
      transaction.create(claimRef, claimDoc);
      return {
        ok: true as const,
        weekKey: rotation.weekKey,
        missionId: mission.id,
        cashBefore,
        cashAfter,
        cashAmount: cashReward,
        claimedAt,
      };
    });
    return result;
  } catch {
    return { ok: false, reason: 'service-unavailable', ...base };
  }
}
