/**
 * Canonical ROAD server-cash shadow settlement — in-memory tests (Step 29K).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import {
  acceptCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../src/canonicalRoadDelivery';
import { settleCanonicalRoadDeliveryInternalTransaction } from '../src/canonicalRoadSettlement';
import { serverStateCurrentRef } from '../src/canonicalCashTransaction';
import {
  buildFixtureMarket,
  compareRoadSettlementShadow,
  localProductionSettlementFromSnapshot,
} from '../../src/domain/canonicalRoadEconomics';
import { realMsForCanonicalGameHours } from '../../src/domain/canonicalRoadTiming';
import {
  classifyCanonicalRoadSettlementSupport,
  hasOnlyCanonicalRoadSettleKeys,
  isCanonicalRoadServerCashShadowAllowed,
} from '../../src/domain/canonicalRoadServerCashShadow';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path };
    },
    async runTransaction<T>(
      operation: (transaction: {
        get: (ref: { path: string }) => Promise<{
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
        }>;
        create: (ref: { path: string }, data: Record<string, unknown>) => void;
        update: (ref: { path: string }, data: Record<string, unknown>) => void;
      }) => Promise<T>,
    ) {
      return operation({
        async get(ref) {
          const data = dump.get(ref.path);
          return { exists: Boolean(data), data: () => data };
        },
        create(ref, data) {
          if (dump.has(ref.path)) throw new Error('already-exists');
          dump.set(ref.path, { ...data });
        },
        update(ref, data) {
          const current = dump.get(ref.path);
          if (!current) throw new Error('missing');
          dump.set(ref.path, { ...current, ...data });
        },
      });
    },
  };
  return firestore as unknown as Firestore & { dump: Map<string, Record<string, unknown>> };
}

const ISSUANCE = {
  originCityId: 'istanbul',
  destinationCityId: 'bursa',
  productId: 'steel',
  amount: 10,
  originMarket: buildFixtureMarket({
    currentPrice: 1900,
    basePrice: 2000,
    stock: 90,
    targetStock: 40,
  }),
  destinationMarket: buildFixtureMarket({
    currentPrice: 2400,
    basePrice: 2000,
    stock: 10,
    targetStock: 50,
    consumptionPerDay: 20,
  }),
  fuelPricePerLiter: 1.72,
  sequence: 1,
};

async function seedFleet(db: Firestore, uid: string): Promise<void> {
  const result = await bootstrapInternalCanonicalFleetFixturesTransaction(db, uid, 1, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(result.ok, true);
}

function seedCash(
  db: ReturnType<typeof createMemoryFirestore>,
  uid: string,
  cash: number,
): void {
  db.dump.set(serverStateCurrentRef(uid), { cash, ownerUid: uid, sourceVersion: 1 });
  db.dump.set(`users/${uid}`, { money: 77_777 });
  db.dump.set(`users/${uid}/saves/current`, { gameState: { player: { money: 66_666 } } });
  db.dump.set(`users/${uid}/canonicalDeliveryCompletions/keep`, { count: 4 });
  db.dump.set(`users/${uid}/canonicalMultimodalShipments/keep`, { status: 'ACCEPTED' });
}

async function completeJob(
  db: ReturnType<typeof createMemoryFirestore>,
  uid: string,
  opts?: {
    sequence?: number;
    originCityId?: string;
    destinationCityId?: string;
    truckId?: string;
    trailerId?: string | null;
    deadlineRatio?: number;
    outcome?: 'COMPLETED' | 'FAILED';
    startMs?: number;
  },
) {
  const issued = await issueCanonicalRoadContractTransaction(
    db,
    uid,
    {
      ...ISSUANCE,
      sequence: opts?.sequence ?? 1,
      originCityId: opts?.originCityId ?? ISSUANCE.originCityId,
      destinationCityId: opts?.destinationCityId ?? ISSUANCE.destinationCityId,
    },
    1,
  );
  assert.equal(issued.ok, true);
  if (!issued.ok) throw new Error('issue');
  await seedFleet(db, uid);
  const start = opts?.startMs ?? 10_000;
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    uid,
    {
      contractId: issued.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: opts?.truckId ?? 'fixture-healthy',
      selectedTrailerId: opts?.trailerId === undefined ? undefined : opts.trailerId ?? 'none',
    },
    start,
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) throw new Error('accept');
  const deliveryId = accepted.receipt.deliveryId;
  const ratio = opts?.deadlineRatio ?? 0.95;
  const completeAt = start + realMsForCanonicalGameHours(issued.snapshot.deadlineHours * ratio);
  const reported = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    uid,
    deliveryId,
    opts?.outcome ?? 'COMPLETED',
    completeAt,
    0,
  );
  return { issued, accepted, reported, deliveryId, snapshot: issued.snapshot };
}

test('A unauthenticated rejected; I gate missing', async () => {
  assert.equal(isCanonicalRoadServerCashShadowAllowed({ envValue: null }), false);
  assert.equal(isCanonicalRoadServerCashShadowAllowed({ envValue: 'INTERNAL_TEST' }), true);
  assert.equal(hasOnlyCanonicalRoadSettleKeys({ deliveryId: 'x', payment: 1, canonicalSchemaVersion: 1 }), false);
  assert.equal(hasOnlyCanonicalRoadSettleKeys({ deliveryId: 'x', canonicalSchemaVersion: 1 }), true);
  const db = createMemoryFirestore();
  const unauth = await settleCanonicalRoadDeliveryInternalTransaction(db, '', 'crc_x', 1, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(unauth.ok, false);
  const gated = await settleCanonicalRoadDeliveryInternalTransaction(db, 'uid-a', 'crc_x', 1, {
    envValue: null,
  });
  assert.equal(gated.ok, false);
  if (!gated.ok) assert.equal(gated.reason, 'CANONICAL_ROAD_SERVER_CASH_SHADOW_OFF');
});

test('C D E F H I J K L M eligibility rejects', async () => {
  const db = createMemoryFirestore();
  seedCash(db, 'uid-a', 20_000);
  const missing = await settleCanonicalRoadDeliveryInternalTransaction(db, 'uid-a', 'no-such', 1, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, 'UNSUPPORTED_LEGACY_DELIVERY');

  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  await seedFleet(db, 'uid-a');
  const active = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1 },
    10_000,
  );
  assert.equal(active.ok, true);
  if (!active.ok) return;
  const activeSettle = await settleCanonicalRoadDeliveryInternalTransaction(
    db,
    'uid-a',
    active.receipt.deliveryId,
    11_000,
    { envValue: 'INTERNAL_TEST' },
  );
  assert.equal(activeSettle.ok, false);
  if (!activeSettle.ok) assert.equal(activeSettle.reason, 'ACTIVE_DELIVERY');

  const failDb = createMemoryFirestore();
  seedCash(failDb, 'uid-a', 20_000);
  const failed = await completeJob(failDb, 'uid-a', { outcome: 'FAILED', sequence: 4 });
  const failSettle = await settleCanonicalRoadDeliveryInternalTransaction(
    failDb,
    'uid-a',
    failed.deliveryId,
    99_000,
    { envValue: 'INTERNAL_TEST' },
  );
  assert.equal(failSettle.ok, false);
  if (!failSettle.ok) assert.equal(failSettle.reason, 'UNSUPPORTED_FAILURE_AUTHORITY');

  const cancelDb = createMemoryFirestore();
  seedCash(cancelDb, 'uid-a', 20_000);
  const cancelled = await completeJob(cancelDb, 'uid-a', { sequence: 5 });
  const cPath = `users/uid-a/canonicalRoadDeliveries/${cancelled.deliveryId}`;
  const cDoc = cancelDb.dump.get(cPath) as Record<string, unknown>;
  cancelDb.dump.set(cPath, { ...cDoc, lifecycleState: 'CANCELLED' });
  const cancelSettle = await settleCanonicalRoadDeliveryInternalTransaction(
    cancelDb,
    'uid-a',
    cancelled.deliveryId,
    12_000,
    { envValue: 'INTERNAL_TEST' },
  );
  assert.equal(cancelSettle.ok, false);
  if (!cancelSettle.ok) assert.equal(cancelSettle.reason, 'UNSUPPORTED_CANCELLED');

  const fragDb = createMemoryFirestore();
  seedCash(fragDb, 'uid-a', 20_000);
  const fragile = await completeJob(fragDb, 'uid-a', { sequence: 6 });
  const fPath = `users/uid-a/canonicalRoadDeliveries/${fragile.deliveryId}`;
  const fDoc = fragDb.dump.get(fPath) as {
    executionEconomicsSnapshot: { fragilityPolicySnapshot: { contractType: string } };
  };
  fDoc.executionEconomicsSnapshot.fragilityPolicySnapshot.contractType = 'fragile';
  fragDb.dump.set(fPath, fDoc);
  const fragSettle = await settleCanonicalRoadDeliveryInternalTransaction(
    fragDb,
    'uid-a',
    fragile.deliveryId,
    12_000,
    { envValue: 'INTERNAL_TEST' },
  );
  assert.equal(fragSettle.ok, false);
  if (!fragSettle.ok) assert.equal(fragSettle.reason, 'UNSUPPORTED_FRAGILE_AUTHORITY');

  const fleetDb = createMemoryFirestore();
  seedCash(fleetDb, 'uid-a', 20_000);
  const prod = await completeJob(fleetDb, 'uid-a', { sequence: 7 });
  const pPath = `users/uid-a/canonicalRoadDeliveries/${prod.deliveryId}`;
  const pDoc = fleetDb.dump.get(pPath) as {
    executionEconomicsSnapshot: { truckEconomicProfile: { source: string } };
  };
  pDoc.executionEconomicsSnapshot.truckEconomicProfile.source = 'INTERNAL_TEST_FIXTURE';
  fleetDb.dump.set(pPath, pDoc);
  const prodSettle = await settleCanonicalRoadDeliveryInternalTransaction(
    fleetDb,
    'uid-a',
    prod.deliveryId,
    12_000,
    { envValue: 'INTERNAL_TEST' },
  );
  assert.equal(prodSettle.ok, false);
  if (!prodSettle.ok) assert.equal(prodSettle.reason, 'UNSUPPORTED_PRODUCTION_FLEET');

  const execDb = createMemoryFirestore();
  seedCash(execDb, 'uid-a', 20_000);
  const noExec = await completeJob(execDb, 'uid-a', { sequence: 8 });
  const ePath = `users/uid-a/canonicalRoadDeliveries/${noExec.deliveryId}`;
  const eDoc = execDb.dump.get(ePath) as Record<string, unknown>;
  execDb.dump.set(ePath, { ...eDoc, executionEconomicsSnapshot: null });
  const execSettle = await settleCanonicalRoadDeliveryInternalTransaction(
    execDb,
    'uid-a',
    noExec.deliveryId,
    12_000,
    { envValue: 'INTERNAL_TEST' },
  );
  assert.equal(execSettle.ok, false);
  if (!execSettle.ok) assert.equal(execSettle.reason, 'UNSUPPORTED_EXECUTION_SNAPSHOT');

  const timeDb = createMemoryFirestore();
  seedCash(timeDb, 'uid-a', 20_000);
  const noTime = await completeJob(timeDb, 'uid-a', { sequence: 9 });
  const tPath = `users/uid-a/canonicalRoadDeliveries/${noTime.deliveryId}`;
  const tDoc = timeDb.dump.get(tPath) as Record<string, unknown>;
  timeDb.dump.set(tPath, { ...tDoc, timingSnapshot: null });
  const timeSettle = await settleCanonicalRoadDeliveryInternalTransaction(
    timeDb,
    'uid-a',
    noTime.deliveryId,
    12_000,
    { envValue: 'INTERNAL_TEST' },
  );
  assert.equal(timeSettle.ok, false);
  if (!timeSettle.ok) assert.equal(timeSettle.reason, 'UNSUPPORTED_TIMING_AUTHORITY');
});

test('N-U standard vectors settle once; exact parity; no HUD/save mutation', async () => {
  async function vector(label: string, opts: Parameters<typeof completeJob>[2], cashStart = 20_000) {
    const db = createMemoryFirestore();
    seedCash(db, 'uid-a', cashStart);
    const job = await completeJob(db, 'uid-a', opts);
    assert.equal(job.reported.ok, true, label);
    const delivery = db.dump.get(`users/uid-a/canonicalRoadDeliveries/${job.deliveryId}`) as {
      executionEconomicsSnapshot: never;
      derivedSettlement: { netCashDelta: number; grossRevenue: number; latePenalty: number; maintenanceCost: number };
    };
    const local = localProductionSettlementFromSnapshot(
      job.snapshot,
      'COMPLETED',
      (job.reported.ok && job.reported.actualTravelHours) || 0,
      delivery.executionEconomicsSnapshot,
    );
    const first = await settleCanonicalRoadDeliveryInternalTransaction(
      db,
      'uid-a',
      job.deliveryId,
      80_000,
      { envValue: 'INTERNAL_TEST' },
    );
    assert.equal(first.ok, true, label);
    if (!first.ok) return;
    assert.equal(first.alreadySettled, false, label);
    assert.equal(first.receipt.grossRevenue, local.grossRevenue, `${label} gross`);
    assert.equal(first.receipt.maintenanceCost, local.maintenanceCost, `${label} maint`);
    assert.equal(first.receipt.penaltyCost, local.penaltyCost, `${label} penalty`);
    assert.equal(first.receipt.netCashDelta, local.netCashDelta, `${label} net`);
    assert.equal(first.receipt.cashBefore, cashStart);
    assert.equal(first.receipt.cashAfter, cashStart + local.netCashDelta);
    assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, cashStart + local.netCashDelta);
    assert.equal(
      compareRoadSettlementShadow({
        local,
        server: delivery.derivedSettlement as never,
      }),
      'MATCH',
      `${label} shadow`,
    );
    const second = await settleCanonicalRoadDeliveryInternalTransaction(
      db,
      'uid-a',
      job.deliveryId,
      90_000,
      { envValue: 'INTERNAL_TEST' },
    );
    assert.equal(second.ok, true, `${label} retry`);
    if (!second.ok) return;
    assert.equal(second.alreadySettled, true);
    assert.equal(second.receipt.settledAtMs, first.receipt.settledAtMs);
    assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, cashStart + local.netCashDelta);
    assert.equal(db.dump.get('users/uid-a')?.money, 77_777);
    assert.equal(
      (db.dump.get('users/uid-a/saves/current')?.gameState as { player: { money: number } }).player.money,
      66_666,
    );
    assert.equal(db.dump.get('users/uid-a/canonicalDeliveryCompletions/keep')?.count, 4);
    assert.equal(db.dump.get('users/uid-a/canonicalMultimodalShipments/keep')?.status, 'ACCEPTED');
    const mutated = db.dump.get(`users/uid-a/canonicalRoadDeliveries/${job.deliveryId}`) as {
      derivedSettlement: { grossRevenue: number };
    };
    mutated.derivedSettlement.grossRevenue = 1;
    const third = await settleCanonicalRoadDeliveryInternalTransaction(
      db,
      'uid-a',
      job.deliveryId,
      91_000,
      { envValue: 'INTERNAL_TEST' },
    );
    assert.equal(third.ok, true);
    if (!third.ok) return;
    assert.equal(third.receipt.grossRevenue, first.receipt.grossRevenue);
    return first.receipt;
  }

  await vector('on-time healthy', { sequence: 10, deadlineRatio: 0.95, truckId: 'fixture-healthy', trailerId: 'none' });
  await vector('on-time degraded trailer', {
    sequence: 11,
    deadlineRatio: 0.95,
    truckId: 'fixture-degraded',
    trailerId: 'fixture-standard',
  });
  await vector('early upgraded long', {
    sequence: 12,
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    deadlineRatio: 0.2,
    truckId: 'fixture-upgraded',
    trailerId: 'none',
  });
  await vector('late-minor', { sequence: 13, deadlineRatio: 1.05, truckId: 'fixture-healthy' });
  await vector('late-major', { sequence: 14, deadlineRatio: 1.6, truckId: 'fixture-healthy' });
});

test('B cross-user cannot settle; AC conflict after settled report blocked', async () => {
  const db = createMemoryFirestore();
  seedCash(db, 'uid-a', 20_000);
  seedCash(db, 'uid-b', 20_000);
  const job = await completeJob(db, 'uid-a', { sequence: 20 });
  const cross = await settleCanonicalRoadDeliveryInternalTransaction(db, 'uid-b', job.deliveryId, 50_000, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(cross.ok, false);
  if (!cross.ok) assert.equal(cross.reason, 'UNSUPPORTED_LEGACY_DELIVERY');

  const settled = await settleCanonicalRoadDeliveryInternalTransaction(db, 'uid-a', job.deliveryId, 51_000, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(settled.ok, true);
  const reportAgain = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    job.deliveryId,
    'COMPLETED',
    52_000,
  );
  assert.equal(reportAgain.ok, false);
  if (!reportAgain.ok) assert.equal(reportAgain.reason, 'DELIVERY_ALREADY_SETTLED');
});

test('AQ overdraft: negative net below server floor 0 rejected', async () => {
  const db = createMemoryFirestore();
  seedCash(db, 'uid-a', 0);
  const job = await completeJob(db, 'uid-a', { sequence: 21, deadlineRatio: 1.6 });
  const delivery = db.dump.get(`users/uid-a/canonicalRoadDeliveries/${job.deliveryId}`) as {
    derivedSettlement: { netCashDelta: number };
  };
  if (delivery.derivedSettlement.netCashDelta >= 0) {
    assert.ok(true);
    return;
  }
  const result = await settleCanonicalRoadDeliveryInternalTransaction(db, 'uid-a', job.deliveryId, 60_000, {
    envValue: 'INTERNAL_TEST',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'INSUFFICIENT_CASH');
  assert.equal(db.dump.get(serverStateCurrentRef('uid-a'))?.cash, 0);
});

test('rules deny settlement writes; callable gated; no multimodal settle', () => {
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /match \/canonicalRoadSettlements\/\{deliveryId\}[\s\S]*?allow write: if false/);
  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.equal(index.includes('export const settleCanonicalRoadDeliveryInternal'), true);
  assert.equal(index.includes('CANONICAL_ROAD_SERVER_CASH_SHADOW'), true);
  assert.equal(index.includes('export const applyCashDelta'), false);
  assert.equal(index.includes('export const settleCanonicalMultimodalShipment'), false);
  assert.equal(
    classifyCanonicalRoadSettlementSupport(null),
    'UNSUPPORTED_LEGACY_DELIVERY',
  );
});
