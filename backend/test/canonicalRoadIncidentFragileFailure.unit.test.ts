/**
 * Canonical ROAD incident / fragile / failure — in-memory tests (Step 29O).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { persistCanonicalCatalogFleetAssetTransaction } from '../src/canonicalProductionFleet';
import { finalizeCanonicalRoadExecutionTransaction } from '../src/canonicalRoadExecution';
import { applyCanonicalRoadDeliveryWearTransaction } from '../src/canonicalFleetWear';
import { repairCanonicalFleetAssetTransaction } from '../src/canonicalFleetRepairUpgrade';
import {
  acceptCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
  cancelCanonicalRoadDeliveryTransaction,
} from '../src/canonicalRoadDelivery';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import {
  CANONICAL_CASH_TRANSACTIONS_COLLECTION,
  serverStateCurrentRef,
} from '../src/canonicalCashTransaction';
import { buildFixtureMarket, calculateCanonicalFailurePenalty } from '../../src/domain/canonicalRoadEconomics';
import { CANONICAL_FLEET_ASSETS_COLLECTION } from '../../src/domain/canonicalRoadFleet';
import { CANONICAL_FLEET_MUTATION_RECEIPTS_COLLECTION } from '../../src/domain/canonicalFleetConditionWear';
import {
  classifyCanonicalFailureAuthority,
  classifyCatalogIncidentEffects,
  createCanonicalIncidentCashTransactionId,
  deriveCanonicalFailurePenaltyFromPayment,
  deriveCanonicalFailedWear,
  deriveCanonicalIncidentCatalogEffects,
  deriveCanonicalRoadIncidentPlan,
  hasOnlyCanonicalRoadFinalizeKeys,
  isCanonicalRoadExecutionAuthorityAllowed,
} from '../../src/domain/canonicalRoadIncidentFragileFailure';
import { calculateCanonicalFragileSurcharge } from '../../src/domain/canonicalRoadExecutionEconomics';
import { STARTER_TRUCK } from '../../src/data/trucks';
import { realMsForCanonicalGameHours } from '../../src/domain/canonicalRoadTiming';

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
    productionPerDay: 12,
    consumptionPerDay: 8,
  }),
  destinationMarket: buildFixtureMarket({
    currentPrice: 2500,
    basePrice: 2000,
    stock: 8,
    targetStock: 60,
    productionPerDay: 4,
    consumptionPerDay: 18,
  }),
  fuelPricePerLiter: 1.72,
  sequence: 1,
};

const GATE = { envValue: 'INTERNAL_TEST' };

test('catalog categories, keys, gate, failure classifier, fragile source', () => {
  assert.equal(isCanonicalRoadExecutionAuthorityAllowed({ envValue: null }), false);
  assert.equal(isCanonicalRoadExecutionAuthorityAllowed(GATE), true);
  assert.equal(hasOnlyCanonicalRoadFinalizeKeys({ deliveryId: 'd', canonicalSchemaVersion: 1 }), true);
  assert.equal(
    hasOnlyCanonicalRoadFinalizeKeys({ deliveryId: 'd', canonicalSchemaVersion: 1, truckConditionDelta: -2 }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalRoadFinalizeKeys({ deliveryId: 'd', canonicalSchemaVersion: 1, fragileSurcharge: 5 }),
    false,
  );
  assert.equal(
    hasOnlyCanonicalRoadFinalizeKeys({ deliveryId: 'd', canonicalSchemaVersion: 1, failurePenalty: 1 }),
    false,
  );
  const timeOnly = deriveCanonicalIncidentCatalogEffects('loading_queue', 'wait_queue');
  assert.equal(timeOnly.ok, true);
  if (timeOnly.ok) assert.equal(classifyCatalogIncidentEffects(timeOnly.effects), 'TIME_ONLY');
  const cashOnly = deriveCanonicalIncidentCatalogEffects('unexpected_cost', 'pay_fee');
  assert.equal(cashOnly.ok, true);
  if (cashOnly.ok) assert.equal(classifyCatalogIncidentEffects(cashOnly.effects), 'CASH_ONLY');
  const condOnly = deriveCanonicalIncidentCatalogEffects('cargo_recheck', 'continue');
  assert.equal(condOnly.ok, true);
  if (condOnly.ok) assert.equal(classifyCatalogIncidentEffects(condOnly.effects), 'CONDITION_ONLY');
  const both = deriveCanonicalIncidentCatalogEffects('tire_pressure', 'check');
  assert.equal(both.ok, true);
  if (both.ok) assert.equal(classifyCatalogIncidentEffects(both.effects), 'CONDITION_AND_CASH');
  const none = deriveCanonicalIncidentCatalogEffects('fast_loading', 'double_check');
  assert.equal(none.ok, true);
  if (none.ok) assert.equal(classifyCatalogIncidentEffects(none.effects), 'NON_ECONOMIC');
  assert.equal(deriveCanonicalIncidentCatalogEffects('traffic', 'not-a-choice').ok, false);
  assert.equal(
    classifyCanonicalFailureAuthority({
      clientOutcome: 'COMPLETED',
      actualTravelHours: 3,
      deadlineHours: 10,
    }),
    'NOT_A_FAILURE',
  );
  assert.equal(
    classifyCanonicalFailureAuthority({
      clientOutcome: 'COMPLETED',
      actualTravelHours: 21,
      deadlineHours: 10,
    }),
    'SERVER_DERIVED_FAILURE',
  );
  assert.equal(
    classifyCanonicalFailureAuthority({
      clientOutcome: 'FAILED',
      actualTravelHours: 3,
      deadlineHours: 10,
    }),
    'CLIENT_REPORTED_UNVERIFIED_FAILURE',
  );
  assert.equal(
    classifyCanonicalFailureAuthority({
      clientOutcome: 'CANCELLED',
      actualTravelHours: 3,
      deadlineHours: 10,
    }),
    'MANUAL_CANCEL_NOT_FAILURE',
  );
  assert.equal(deriveCanonicalFailurePenaltyFromPayment(1000), Math.round(calculateCanonicalFailurePenalty(1000)));
  assert.equal(deriveCanonicalFailedWear(4), 2);
  assert.equal(
    calculateCanonicalFragileSurcharge({
      payment: 1000,
      contractType: 'fragile',
      frozenStartCondition: 88,
      recommendedTruckCondition: 70,
      completionTruckCondition: 60,
    }),
    50,
  );
  assert.equal(
    calculateCanonicalFragileSurcharge({
      payment: 1000,
      contractType: 'fragile',
      frozenStartCondition: 60,
      recommendedTruckCondition: 70,
      completionTruckCondition: 80,
    }),
    0,
  );
  const planA = deriveCanonicalRoadIncidentPlan({ uid: 'uid-a', deliveryId: 'crd_same', enabled: true });
  const planB = deriveCanonicalRoadIncidentPlan({ uid: 'uid-a', deliveryId: 'crd_same', enabled: true });
  assert.deepEqual(planA, planB);
  assert.equal(planA.events.length, 1);
});

test('auth, gate, unverified failure, cancel distinct, reroll', async () => {
  const db = createMemoryFirestore();
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 50_000, ownerUid: 'uid-a', sourceVersion: 1 });
  await bootstrapInternalCanonicalFleetFixturesTransaction(db, 'uid-a', 1, { envValue: 'INTERNAL_TEST' });
  const unauth = await finalizeCanonicalRoadExecutionTransaction(db, '', 'crd_x', 1, GATE);
  assert.equal(unauth.ok, false);
  const off = await finalizeCanonicalRoadExecutionTransaction(db, 'uid-a', 'crd_x', 1, { envValue: null });
  assert.equal(off.ok, false);
  if (!off.ok) assert.equal(off.reason, 'CANONICAL_ROAD_EXECUTION_AUTHORITY_OFF');

  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1, selectedTruckId: 'fixture-healthy' },
    10_000,
    { executionEnvValue: 'INTERNAL_TEST' },
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const dPath = `users/uid-a/canonicalRoadDeliveries/${accepted.receipt.deliveryId}`;
  const plan1 = (db.dump.get(dPath) as { incidentPlan: { incidentSeed: string; events: unknown[] } }).incidentPlan;
  const retryAccept = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued.snapshot.contractId, canonicalSchemaVersion: 1, selectedTruckId: 'fixture-healthy' },
    10_100,
    { executionEnvValue: 'INTERNAL_TEST' },
  );
  assert.equal(retryAccept.ok, true);
  const plan2 = (db.dump.get(dPath) as { incidentPlan: { incidentSeed: string } }).incidentPlan;
  assert.equal(plan1.incidentSeed, plan2.incidentSeed);

  const failReport = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    accepted.receipt.deliveryId,
    'FAILED',
    10_000 + realMsForCanonicalGameHours(issued.snapshot.deadlineHours * 0.5),
  );
  assert.equal(failReport.ok, true);
  const failDoc = db.dump.get(dPath) as { failureAuthorityClass: string; derivedSettlement: unknown };
  assert.equal(failDoc.failureAuthorityClass, 'CLIENT_REPORTED_UNVERIFIED_FAILURE');
  assert.equal(failDoc.derivedSettlement, null);
  const failWear = await applyCanonicalRoadDeliveryWearTransaction(db, 'uid-a', accepted.receipt.deliveryId, 20_000);
  assert.equal(failWear.ok, false);
  if (!failWear.ok) assert.equal(failWear.reason, 'FAILED_AUTHORITY_UNRESOLVED');

  const issued2 = await issueCanonicalRoadContractTransaction(db, 'uid-a', { ...ISSUANCE, sequence: 2 }, 2);
  assert.equal(issued2.ok, true);
  if (!issued2.ok) return;
  const accepted2 = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    { contractId: issued2.snapshot.contractId, canonicalSchemaVersion: 1, selectedTruckId: 'fixture-upgraded' },
    30_000,
  );
  assert.equal(accepted2.ok, true);
  if (!accepted2.ok) return;
  const cancelled = await cancelCanonicalRoadDeliveryTransaction(db, 'uid-a', accepted2.receipt.deliveryId, 30_100);
  assert.equal(cancelled.ok, true);
  const finCancel = await finalizeCanonicalRoadExecutionTransaction(
    db,
    'uid-a',
    accepted2.receipt.deliveryId,
    30_200,
    GATE,
  );
  assert.equal(finCancel.ok, false);
});

test('finalize incidents once; wear after; repair; too_late failure wear', async () => {
  const db = createMemoryFirestore();
  db.dump.set(serverStateCurrentRef('uid-a'), { cash: 50_000, ownerUid: 'uid-a', sourceVersion: 1 });
  const minted = await persistCanonicalCatalogFleetAssetTransaction(
    db,
    'uid-a',
    STARTER_TRUCK.catalogId ?? STARTER_TRUCK.id,
    'inc-e2e-1',
    1,
  );
  assert.equal(minted.ok, true);
  if (!minted.ok) return;
  const aPath = `users/uid-a/${CANONICAL_FLEET_ASSETS_COLLECTION}/${minted.assetId}`;
  const issued = await issueCanonicalRoadContractTransaction(db, 'uid-a', ISSUANCE, 1);
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const accepted = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId: issued.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: minted.assetId,
    },
    10_000,
    { executionEnvValue: 'INTERNAL_TEST' },
  );
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  const dPath = `users/uid-a/canonicalRoadDeliveries/${accepted.receipt.deliveryId}`;
  const before = db.dump.get(aPath) as { economicCondition: number; economicRevision: number };
  const plan = (db.dump.get(dPath) as {
    incidentPlan: { events: Array<{ incidentType: import('../../src/types/game').DeliveryIncidentType; canonicalChoiceId: string; eventId: string }> };
  }).incidentPlan;
  const catalog = deriveCanonicalIncidentCatalogEffects(
    plan.events[0]!.incidentType,
    plan.events[0]!.canonicalChoiceId,
  );
  assert.equal(catalog.ok, true);
  const completeAt = 10_000 + realMsForCanonicalGameHours(issued.snapshot.deadlineHours * 0.9);
  await reportCanonicalRoadDeliveryCompletedTransaction(db, 'uid-a', accepted.receipt.deliveryId, 'COMPLETED', completeAt);
  const first = await finalizeCanonicalRoadExecutionTransaction(db, 'uid-a', accepted.receipt.deliveryId, completeAt + 1, GATE);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const cashBefore = Number(db.dump.get(serverStateCurrentRef('uid-a'))?.cash);
  const retry = await finalizeCanonicalRoadExecutionTransaction(db, 'uid-a', accepted.receipt.deliveryId, completeAt + 2, GATE);
  assert.equal(retry.ok, true);
  if (retry.ok) assert.equal(retry.alreadyApplied, true);
  assert.equal(Number(db.dump.get(serverStateCurrentRef('uid-a'))?.cash), cashBefore);
  const afterInc = db.dump.get(aPath) as { economicCondition: number; economicRevision: number };
  if (catalog.ok && catalog.truckConditionDelta !== 0) {
    assert.equal(afterInc.economicCondition, before.economicCondition + catalog.truckConditionDelta);
    assert.equal(afterInc.economicRevision, before.economicRevision + 1);
  }
  if (catalog.ok && Math.round(catalog.netCashDelta) !== 0) {
    const cashId = createCanonicalIncidentCashTransactionId(accepted.receipt.deliveryId, plan.events[0]!.eventId);
    const cashDoc = db.dump.get(`users/uid-a/${CANONICAL_CASH_TRANSACTIONS_COLLECTION}/${cashId}`) as {
      amountDelta: number;
    };
    assert.equal(cashDoc.amountDelta, Math.round(catalog.netCashDelta));
  }
  const worn = await applyCanonicalRoadDeliveryWearTransaction(db, 'uid-a', accepted.receipt.deliveryId, completeAt + 5);
  assert.equal(worn.ok, true);
  if (!worn.ok) return;
  const afterWear = db.dump.get(aPath) as { economicCondition: number; economicRevision: number };
  assert.ok(afterWear.economicCondition <= afterInc.economicCondition);
  const repaired = await repairCanonicalFleetAssetTransaction(
    db,
    'uid-a',
    minted.assetId,
    'repair-after-inc',
    completeAt + 6,
    GATE,
  );
  if (afterWear.economicCondition < 100) {
    assert.equal(repaired.ok, true);
    if (repaired.ok && repaired.receipt) {
      assert.equal((db.dump.get(aPath) as { economicCondition: number }).economicCondition, 100);
    }
  }
  assert.equal(db.dump.get('users/uid-a')?.money, undefined);

  const issuedLate = await issueCanonicalRoadContractTransaction(db, 'uid-a', { ...ISSUANCE, sequence: 2 }, 2);
  assert.equal(issuedLate.ok, true);
  if (!issuedLate.ok) return;
  const minted2 = await persistCanonicalCatalogFleetAssetTransaction(
    db,
    'uid-a',
    STARTER_TRUCK.catalogId ?? STARTER_TRUCK.id,
    'inc-late-1',
    2,
  );
  assert.equal(minted2.ok, true);
  if (!minted2.ok) return;
  const acceptedLate = await acceptCanonicalRoadDeliveryTransaction(
    db,
    'uid-a',
    {
      contractId: issuedLate.snapshot.contractId,
      canonicalSchemaVersion: 1,
      selectedTruckId: minted2.assetId,
    },
    80_000,
  );
  assert.equal(acceptedLate.ok, true);
  if (!acceptedLate.ok) return;
  const lateAt = 80_000 + realMsForCanonicalGameHours(issuedLate.snapshot.deadlineHours * 2.1);
  const lateReport = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    'uid-a',
    acceptedLate.receipt.deliveryId,
    'COMPLETED',
    lateAt,
  );
  assert.equal(lateReport.ok, true);
  const lateDoc = db.dump.get(
    `users/uid-a/canonicalRoadDeliveries/${acceptedLate.receipt.deliveryId}`,
  ) as { failureAuthorityClass: string; completionOutcome: string };
  assert.equal(lateDoc.failureAuthorityClass, 'SERVER_DERIVED_FAILURE');
  assert.equal(lateDoc.completionOutcome, 'FAILED');
  await finalizeCanonicalRoadExecutionTransaction(db, 'uid-a', acceptedLate.receipt.deliveryId, lateAt + 1, GATE);
  const lateWear = await applyCanonicalRoadDeliveryWearTransaction(db, 'uid-a', acceptedLate.receipt.deliveryId, lateAt + 2);
  assert.equal(lateWear.ok, true);
  if (lateWear.ok) {
    const full = lateWear.receipt.wearAmount * 2;
    assert.ok(Math.abs(lateWear.receipt.wearAmount - full * 0.5) < 1e-9);
  }

  const cross = await finalizeCanonicalRoadExecutionTransaction(db, 'uid-b', accepted.receipt.deliveryId, 1, GATE);
  assert.equal(cross.ok, false);
});

test('no generic cash; production UI unwired; rules deny writes', () => {
  const index = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  assert.match(index, /export const finalizeCanonicalRoadExecution/);
  assert.doesNotMatch(index, /export const applyCashDelta/);
  const store = readFileSync(resolve(__dirname, '../../src/store/gameStore.ts'), 'utf8');
  assert.match(store, /completeDeliveryById/);
  assert.doesNotMatch(store, /finalizeCanonicalRoadExecution/);
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');
  assert.match(rules, /canonicalFleetMutationReceipts[\s\S]*allow write: if false/);
  assert.match(rules, /canonicalCashTransactions[\s\S]*allow write: if false/);
});
