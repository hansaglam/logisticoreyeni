/**
 * Map V2 Step 29AG canonical delivery risk tier / driver assignment authority.
 * Run: node --import tsx scripts/map-v2-canonical-delivery-risk-driver-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';
import type { Firestore } from 'firebase-admin/firestore';

import {
  acceptCanonicalRoadDeliveryTransaction,
  cancelCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../backend/src/canonicalRoadDelivery';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../backend/src/canonicalFleet';
import { bootstrapInternalCanonicalDriverFixtureTransaction } from '../backend/src/canonicalDeliveryRiskDriver';
import { initializeCanonicalCompanyProgressionForNewAccount } from '../backend/src/canonicalCompanyProgression';
import { levelConfig } from '../src/config/levelConfig';
import { REPUTATION_RULES } from '../src/config/reputationRules';
import { DRIVER_POOL } from '../src/data/drivers';
import { getRoute } from '../src/data/routes';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import {
  CANONICAL_ROAD_COMPLETION_XP_AUTHORITY,
  deriveCanonicalRoadCancelReputation,
  deriveCanonicalRoadCompletionReputation,
  deriveCanonicalRoadProductionNetProfit,
  deriveCanonicalRoadServerFailureReputation,
} from '../src/domain/canonicalCompanyProgression';
import {
  CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY_STATUS,
  CANONICAL_DRIVER_LEVEL_AUTHORITY,
  CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION,
  CANONICAL_ROAD_DRIVER_SNAPSHOT_POLICY_VERSION,
  PRODUCTION_DRIVER_ASSIGNMENT_AUDIT,
  PRODUCTION_RISK_TIER_AUDIT,
  ROAD_EXECUTION_ECONOMICS_DRIVER_POLICY_VERSION,
  classifyCanonicalDriverForAssignment,
  deriveCanonicalRoadCompletionXpForDelivery,
  deriveCanonicalRoadRiskFromInputs,
  isCanonicalRoadDriverRiskAllowed,
  resolveCanonicalTruckRiskProfile,
  type CanonicalRoadDeliveryRiskSnapshot,
  type CanonicalRoadDriverSnapshot,
  type CanonicalRoadRiskInputs,
} from '../src/domain/canonicalDeliveryRiskDriver';
import { hasOnlyCanonicalRoadAcceptKeys, hasOnlyCanonicalRoadCompleteKeys } from '../src/domain/canonicalRoadDelivery';
import { buildFixtureMarket } from '../src/domain/canonicalRoadEconomics';
import { buildInternalCanonicalFleetFixtureAssets } from '../src/domain/canonicalRoadFleet';
import type { CanonicalRoadExecutionEconomicsSnapshot } from '../src/domain/canonicalRoadExecutionEconomics';
import { realMsForCanonicalGameHours } from '../src/domain/canonicalRoadTiming';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
import { calculateDeliveryXp, getDeliveryRiskTier } from '../src/simulation/leveling';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';

let pass = 0;
let fail = 0;
function assert(cond: unknown, label: string): void {
  if (cond) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`FAIL ${label}`);
}
function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8');
}

type Dump = Map<string, Record<string, unknown>>;
type Tx = {
  get: (ref: { path: string; _col?: boolean }) => Promise<{
    exists: boolean;
    data: () => Record<string, unknown> | undefined;
    docs: Array<{ id: string; data: () => Record<string, unknown> }>;
  }>;
  create: (ref: { path: string }, data: Record<string, unknown>) => void;
  update: (ref: { path: string }, data: Record<string, unknown>) => void;
  set: (ref: { path: string }, data: Record<string, unknown>) => void;
};

/** Serialized transactions with buffered writes (serializable isolation + rollback on throw). */
function createMemoryFirestore(): Firestore & { dump: Dump } {
  const dump: Dump = new Map();
  let chain: Promise<unknown> = Promise.resolve();
  const firestore = {
    dump,
    doc(path: string) {
      return { path, _col: false as const };
    },
    collection(path: string) {
      return { path, _col: true as const };
    },
    runTransaction<T>(operation: (transaction: Tx) => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        const writes: Array<() => void> = [];
        const result = await operation({
          async get(ref) {
            if (ref._col) {
              const prefix = `${ref.path.replace(/\/$/, '')}/`;
              const docs = [...dump.entries()]
                .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
                .map(([key, data]) => ({ id: key.slice(prefix.length), data: () => data }));
              return { exists: docs.length > 0, data: () => undefined, docs };
            }
            const data = dump.get(ref.path);
            return { exists: Boolean(data), data: () => (data ? { ...data } : undefined), docs: [] };
          },
          create(ref, data) {
            writes.push(() => {
              if (dump.has(ref.path)) throw new Error('already-exists');
              dump.set(ref.path, { ...data });
            });
          },
          update(ref, data) {
            writes.push(() => {
              const current = dump.get(ref.path);
              if (!current) throw new Error('missing');
              dump.set(ref.path, { ...current, ...data });
            });
          },
          set(ref, data) {
            writes.push(() => dump.set(ref.path, { ...data }));
          },
        });
        for (const write of writes) write();
        return result;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
  return firestore as unknown as Firestore & { dump: Dump };
}

const NOW = 1_700_000_000_000;
const HOUR_MS = 15_000;
const GATE = { envValue: 'INTERNAL_TEST' } as const;
const PROGRESSION = { progressionEnvValue: 'INTERNAL_TEST' } as const;
const RISK = { driverRiskEnvValue: 'INTERNAL_TEST', eventEnvValue: 'INTERNAL_TEST' } as const;
const DRIVER_A = 'driver-can-t';
const DRIVER_B = 'driver-ayse-d';
const ISSUANCE = {
  originCityId: 'istanbul',
  destinationCityId: 'bursa',
  productId: 'steel',
  amount: 10,
  originMarket: buildFixtureMarket({ currentPrice: 1900, basePrice: 2000, stock: 90, targetStock: 40 }),
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
const deliveryPath = (uid: string, id: string) => `users/${uid}/canonicalRoadDeliveries/${id}`;
const driverPath = (uid: string, id: string) => `users/${uid}/canonicalDrivers/${id}`;
const progressionPath = (uid: string) => `users/${uid}/canonicalCompanyProgression/current`;
const completionReceipt = (uid: string, id: string) =>
  `users/${uid}/canonicalProgressionReceipts/progression:delivery:${id}:completion`;
const cashKeys = (db: { dump: Dump }) =>
  [...db.dump.keys()].filter((key) => key.includes('canonicalCashTransactions') || key.includes('financeLedger'));

async function world(uid: string, drivers: string[] = [DRIVER_A]) {
  const db = createMemoryFirestore();
  db.dump.set('globalEconomy/current', { fuelPricePerLiter: 1.72 });
  db.dump.set(`users/${uid}`, { money: 31_337 });
  await bootstrapInternalCanonicalFleetFixturesTransaction(db, uid, 1, GATE);
  for (const poolId of drivers) {
    await bootstrapInternalCanonicalDriverFixtureTransaction(db, uid, poolId, NOW, {
      envValue: 'INTERNAL_TEST',
      driverRiskEnvValue: 'INTERNAL_TEST',
    });
  }
  await initializeCanonicalCompanyProgressionForNewAccount(db, uid, NOW, GATE);
  return db;
}
async function issue(db: Firestore & { dump: Dump }, uid: string, sequence: number) {
  const issued = await issueCanonicalRoadContractTransaction(db, uid, { ...ISSUANCE, sequence }, NOW);
  if (!issued.ok) throw new Error('issue');
  return issued.snapshot.contractId;
}
function accept(
  db: Firestore & { dump: Dump },
  uid: string,
  contractId: string,
  atMs: number,
  request: Record<string, unknown> = {},
  options: Record<string, string | null> = RISK,
) {
  return acceptCanonicalRoadDeliveryTransaction(db, uid, { contractId, canonicalSchemaVersion: 1, ...request }, atMs, options);
}
function plannedHours(db: { dump: Dump }, uid: string, deliveryId: string): number {
  return (db.dump.get(deliveryPath(uid, deliveryId)) as { timingSnapshot: { plannedTravelGameHours: number } })
    .timingSnapshot.plannedTravelGameHours;
}

const BASE: CanonicalRoadRiskInputs = {
  truckCondition: 100,
  truckReliability: 100,
  truckCapacity: 25,
  cargoWeightTons: 1,
  routeDifficulty: 0,
  driverAttention: 100,
  driverSpeed: -10,
};

async function main(): Promise<void> {
  console.log('\n=== Map V2 Canonical Delivery Risk / Driver Authority (Step 29AG) ===\n');

  const store = read('src/store/gameStore.ts');
  const contractsScreen = read('src/screens/ContractsScreen.tsx');
  const fleetScreen = read('src/screens/FleetScreen.tsx');
  const index = read('backend/src/index.ts');
  const rules = read('firestore.rules');
  const riskBackend = read('backend/src/canonicalDeliveryRiskDriver.ts');
  const riskDomain = read('src/domain/canonicalDeliveryRiskDriver.ts');

  for (const [name, source] of [
    ['store', store],
    ['ContractsScreen', contractsScreen],
    ['FleetScreen', fleetScreen],
  ] as const) {
    assert(!/deliveryRiskSnapshot|canonicalDriverSnapshot|canonicalDeliveryRiskDriver/.test(source), `A ${name} not wired`);
  }
  assert(store.includes('getDeliveryRiskTier(delivery)'), 'A public XP path still local production');
  assert(rules.includes('match /canonicalDrivers/{driverId}'), 'A rules canonicalDrivers present');
  assert(/match \/canonicalDrivers\/\{driverId\} \{\s*allow read: if isOwner\(userId\);\s*allow write: if false;/.test(rules), 'A client write false');
  assert(!/export const (setDriverBusy|assignDriver|releaseDriver)\b/.test(index), 'A no generic driver busy callable');

  const guest = await acceptCanonicalRoadDeliveryTransaction(
    createMemoryFirestore(),
    '',
    { contractId: 'rc_x', canonicalSchemaVersion: 1, selectedDriverId: DRIVER_A },
    NOW,
    RISK,
  );
  assert(!guest.ok && guest.reason === 'UNAUTHENTICATED', 'B guest cannot accept');

  assert(isCanonicalRoadDriverRiskAllowed({ envValue: undefined }) === false, 'C gate missing OFF');
  assert(isCanonicalRoadDriverRiskAllowed({ envValue: null }) === false, 'C gate null OFF');
  assert(isCanonicalRoadDriverRiskAllowed({ envValue: 'ON' }) === false, 'C gate other OFF');
  assert(isCanonicalRoadDriverRiskAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'C gate INTERNAL_TEST');
  assert(index.includes('driverRiskEnvValue: process.env.CANONICAL_ROAD_DRIVER_RISK_AUTHORITY ?? null'), 'C callable reads env');

  const auditColumns = [
    'input',
    'source',
    'type',
    'range',
    'defaultValue',
    'formulaUse',
    'whenRead',
    'whenMutated',
    'clientOwned',
    'serverOwned',
    'canonicalStatus',
  ];
  assert(PRODUCTION_RISK_TIER_AUDIT.length >= 8, 'D risk audit rows');
  for (const row of PRODUCTION_RISK_TIER_AUDIT) {
    assert(auditColumns.every((column) => column in row), `D ${row.input} columns`);
    assert(!JSON.stringify(row).includes('UNKNOWN'), `D ${row.input} not UNKNOWN`);
  }
  for (const input of ['truck.condition', 'truck.reliability', 'driver.attention', 'driver.speed', 'route.difficulty']) {
    assert(PRODUCTION_RISK_TIER_AUDIT.some((row) => row.input === input), `D audit ${input}`);
  }
  for (const row of PRODUCTION_DRIVER_ASSIGNMENT_AUDIT) {
    assert(!JSON.stringify(row).includes('UNKNOWN'), `D driver audit ${row.concern}`);
  }
  assert(riskDomain.includes('calculateBreakdownChance(contract, truck, driver, route, RISK_SHIM_PRODUCT)'), 'D reuses production helpers');

  const forbidden: Array<[string, string]> = [
    ['riskTier', 'E'],
    ['riskScore', 'E'],
    ['riskBonus', 'F'],
    ['driverAttention', 'G'],
    ['driverStats', 'G'],
    ['driverLevel', 'G'],
    ['driverTier', 'G'],
    ['driverSpeed', 'H'],
    ['driverFuelSaving', 'H'],
    ['truckReliability', 'I'],
    ['completionXp', 'J'],
    ['xpReward', 'J'],
    ['netProfit', 'J'],
  ];
  for (const [key, id] of forbidden) {
    assert(!hasOnlyCanonicalRoadAcceptKeys({ contractId: 'c', canonicalSchemaVersion: 1, [key]: 1 }), `${id} accept rejects ${key}`);
    assert(!hasOnlyCanonicalRoadCompleteKeys({ deliveryId: 'd', outcome: 'COMPLETED', [key]: 1 }), `${id} complete rejects ${key}`);
  }

  const uid = 'rg-accept';
  const db = await world(uid, [DRIVER_A, DRIVER_B]);
  const c1 = await issue(db, uid, 1);
  const noDriver = await accept(db, uid, c1, NOW + 1);
  assert(!noDriver.ok && noDriver.reason === 'CANONICAL_DRIVER_REQUIRED', 'K trusted driver required');
  const legacy = await accept(db, uid, c1, NOW + 1, { selectedDriverId: 'driver-starter-1' });
  assert(!legacy.ok && legacy.reason === 'LEGACY_DRIVER_UNVERIFIED', 'L legacy driver rejected');
  const legacyClass = classifyCanonicalDriverForAssignment(null, {
    uid,
    driverId: DRIVER_A,
    deliveryId: 'rd_x',
    requiredDriverLevel: null,
    nowMs: NOW,
  });
  assert(!legacyClass.ok && legacyClass.authorityClass === 'LEGACY_CLIENT_UNVERIFIED', 'L LEGACY_CLIENT_UNVERIFIED');

  const baseDoc = { ...db.dump.get(driverPath(uid, DRIVER_A))! };
  const classify = (doc: Record<string, unknown>, requiredDriverLevel: unknown = null) =>
    classifyCanonicalDriverForAssignment(doc, { uid, driverId: DRIVER_A, deliveryId: 'rd_x', requiredDriverLevel, nowMs: NOW });
  const fixtureClass = classify(baseDoc);
  assert(fixtureClass.ok && fixtureClass.authorityClass === 'INTERNAL_TEST_DRIVER_FIXTURE', 'M fixture INTERNAL only');
  const notOwned = classify({ ...baseDoc, ownerUid: 'someone-else' });
  assert(!notOwned.ok && notOwned.reason === 'CANONICAL_DRIVER_NOT_OWNED', 'N ownership');
  const busyClass = classify({ ...baseDoc, assignedCanonicalDeliveryId: 'rd_other' });
  assert(!busyClass.ok && busyClass.reason === 'DRIVER_NOT_AVAILABLE', 'O availability');
  const fired = classify({ ...baseDoc, status: 'fired' });
  assert(!fired.ok && fired.reason === 'CANONICAL_DRIVER_NOT_HIRED', 'O fired unavailable');
  const lvl2 = classify(baseDoc, 2);
  assert(!lvl2.ok && lvl2.reason === 'CANONICAL_DRIVER_LEVEL_AUTHORITY_UNAVAILABLE', 'P level>1 fails closed');
  const lvlBad = classify(baseDoc, 'x');
  assert(!lvlBad.ok && lvlBad.reason === 'CANONICAL_DRIVER_LEVEL_REQUIREMENT_INVALID', 'P invalid level');
  assert(classify(baseDoc, 1).ok, 'P level 1 accepted');
  assert(CANONICAL_DRIVER_LEVEL_AUTHORITY === 'DRIVER_LEVEL_AUTHORITY_CLIENT_OWNED', 'P driver level still client-owned');

  const ok = await accept(db, uid, c1, NOW + 2, { selectedDriverId: DRIVER_A });
  assert(ok.ok, 'Q accept with fixture driver');
  if (!ok.ok) throw new Error(ok.reason);
  const d1 = ok.receipt.deliveryId;
  const doc1 = db.dump.get(deliveryPath(uid, d1))!;
  const risk1 = doc1.deliveryRiskSnapshot as CanonicalRoadDeliveryRiskSnapshot;
  const drv1 = doc1.canonicalDriverSnapshot as CanonicalRoadDriverSnapshot;
  assert(
    db.dump.get(driverPath(uid, DRIVER_A))?.assignedCanonicalDeliveryId === d1 && doc1.driverAssignmentState === 'ASSIGNED',
    'Q assignment atomic with delivery start',
  );
  assert(drv1.snapshotPolicyVersion === CANONICAL_ROAD_DRIVER_SNAPSHOT_POLICY_VERSION, 'Q driver snapshot policy');
  const c2 = await issue(db, uid, 2);
  const busy = await accept(db, uid, c2, NOW + 3, { selectedDriverId: DRIVER_A, canonicalTruckAssetId: 'fixture-degraded' });
  assert(!busy.ok && busy.reason === 'DRIVER_NOT_AVAILABLE', 'R same driver not in two deliveries');
  assert(db.dump.get(`users/${uid}/canonicalRoadContracts/${c2}`)?.status === 'AVAILABLE', 'R losing contract untouched');

  const race = await world('rg-race');
  const [r1, r2] = [await issue(race, 'rg-race', 1), await issue(race, 'rg-race', 2)];
  const raced = await Promise.all([
    accept(race, 'rg-race', r1, NOW + 1, { selectedDriverId: DRIVER_A, canonicalTruckAssetId: 'fixture-healthy' }),
    accept(race, 'rg-race', r2, NOW + 1, { selectedDriverId: DRIVER_A, canonicalTruckAssetId: 'fixture-degraded' }),
  ]);
  assert(raced.filter((r) => r.ok).length === 1, 'R concurrent accepts assign once');

  const [healthyAsset] = buildInternalCanonicalFleetFixtureAssets(uid, 1);
  const truckProfile = resolveCanonicalTruckRiskProfile(healthyAsset!);
  assert(truckProfile.ok && truckProfile.reliability === 75 && risk1.inputs.truckReliability === 75, 'X reliability server-derived');
  const unknownTruck = resolveCanonicalTruckRiskProfile({ ...healthyAsset!, fixtureKey: 'none', catalogModelId: 'made-up' });
  assert(!unknownTruck.ok && unknownTruck.reason === 'CANONICAL_TRUCK_RELIABILITY_UNAVAILABLE', 'X no default reliability');
  const acceptAsset = db.dump.get(`users/${uid}/canonicalFleetAssets/fixture-healthy`)!;
  assert(
    risk1.conditionStage === 'ACCEPT_TIME_PRE_WEAR' && risk1.inputs.truckCondition === acceptAsset.economicCondition,
    'Y condition read at accept before wear',
  );
  assert(risk1.inputs.routeDifficulty === getRoute('istanbul', 'bursa')!.difficulty, 'Y route difficulty');
  assert(risk1.riskPolicyVersion === CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION, 'Z risk snapshot frozen at accept');
  assert(risk1.riskTier === getDeliveryRiskTier(risk1) && risk1.frozenAtMs === NOW + 2, 'Z tier from frozen chances');
  const frozen = JSON.stringify(risk1);

  db.dump.set(driverPath(uid, DRIVER_A), { ...db.dump.get(driverPath(uid, DRIVER_A))!, attention: 1, speed: 99, attentionBaseline: 1 });
  db.dump.set(`users/${uid}/canonicalFleetAssets/fixture-healthy`, { ...acceptAsset, economicCondition: 5, reliability: 1 });
  const completeAt = NOW + 2 + realMsForCanonicalGameHours(plannedHours(db, uid, d1) * 0.5);
  const done = await reportCanonicalRoadDeliveryCompletedTransaction(db, uid, d1, 'COMPLETED', completeAt, null, PROGRESSION);
  assert(done.ok, 'S completion ok');
  const after1 = db.dump.get(deliveryPath(uid, d1))!;
  assert(JSON.stringify(after1.deliveryRiskSnapshot) === frozen, 'AA driver stat change does not change snapshot');
  assert(JSON.stringify(after1.deliveryRiskSnapshot) === frozen, 'AB truck condition change does not change snapshot');
  assert(db.dump.get(driverPath(uid, DRIVER_A))?.assignedCanonicalDeliveryId === null, 'S released on success');
  assert(after1.driverReleaseReason === 'COMPLETED', 'S release reason COMPLETED');

  const receipt1 = db.dump.get(completionReceipt(uid, d1))!;
  if (done.ok && done.derivedSettlement) {
    const netProfit = deriveCanonicalRoadProductionNetProfit(done.derivedSettlement);
    const expected = calculateDeliveryXp(Number(doc1.distanceKm), netProfit, risk1.riskTier);
    assert(receipt1.xpAuthority === 'SERVER_DERIVED' && receipt1.xpDelta === expected, 'AG completion XP exact');
    assert((receipt1.xpEvidence as { riskTier: string }).riskTier === risk1.riskTier, 'AG XP uses frozen tier');
  } else {
    assert(false, 'AG derived settlement present');
  }
  const economics1 = doc1.executionEconomicsSnapshot as Record<string, unknown>;
  assert(economics1.driverEconomicsPolicyVersion === ROAD_EXECUTION_ECONOMICS_DRIVER_POLICY_VERSION, 'AG netProfit economics v2');
  assert(receipt1.reputationDelta === 3, 'AO completion reputation +3 early');

  const xpBefore = db.dump.get(progressionPath(uid))?.totalXp;
  const retry = await reportCanonicalRoadDeliveryCompletedTransaction(db, uid, d1, 'COMPLETED', completeAt + 1_000, null, PROGRESSION);
  assert(retry.ok && retry.alreadyReported && db.dump.get(progressionPath(uid))?.totalXp === xpBefore, 'AM retry no duplicate XP');
  const device2 = await reportCanonicalRoadDeliveryCompletedTransaction(db, uid, d1, 'COMPLETED', completeAt + 2_000, 0, PROGRESSION);
  assert(device2.ok && device2.alreadyReported && db.dump.get(progressionPath(uid))?.totalXp === xpBefore, 'AN two-device no duplicate');
  const receiptKeys = [...db.dump.keys()].filter((key) => key.startsWith(`users/${uid}/canonicalProgressionReceipts/`));
  assert(receiptKeys.length === 1, 'AL completion receipt exactly once');
  assert(db.dump.get(driverPath(uid, DRIVER_A))?.driverRuntimeRevision === 2, 'AL driver revision assign + release only');

  const cancelDb = await world('rg-cancel');
  const cancelAccepted = await accept(cancelDb, 'rg-cancel', await issue(cancelDb, 'rg-cancel', 1), NOW, { selectedDriverId: DRIVER_A });
  if (cancelAccepted.ok) {
    await cancelCanonicalRoadDeliveryTransaction(cancelDb, 'rg-cancel', cancelAccepted.receipt.deliveryId, NOW + HOUR_MS, PROGRESSION);
  }
  const cancelDriver = cancelDb.dump.get(driverPath('rg-cancel', DRIVER_A))!;
  assert(cancelDriver.assignedCanonicalDeliveryId === null && cancelDriver.lastReleaseReason === 'CANCELLED', 'T released on cancel');
  assert(cancelDb.dump.get(progressionPath('rg-cancel'))?.reputation === 44, 'AP cancel reputation -6');

  const lateDb = await world('rg-late');
  const lateAccepted = await accept(lateDb, 'rg-late', await issue(lateDb, 'rg-late', 1), NOW, { selectedDriverId: DRIVER_A });
  if (lateAccepted.ok) {
    const lateReport = await reportCanonicalRoadDeliveryCompletedTransaction(
      lateDb,
      'rg-late',
      lateAccepted.receipt.deliveryId,
      'COMPLETED',
      NOW + realMsForCanonicalGameHours(lateAccepted.receipt.deadlineHours * 2.5),
      null,
      PROGRESSION,
    );
    assert(lateReport.ok && lateReport.lifecycleState === 'FAILED', 'U server-derived failure');
  }
  assert(lateDb.dump.get(driverPath('rg-late', DRIVER_A))?.lastReleaseReason === 'SERVER_DERIVED_FAILURE', 'U release exact');
  assert(lateDb.dump.get(progressionPath('rg-late'))?.reputation === 44, 'AQ failure reputation -6');

  const clientDb = await world('rg-client');
  const clientAccepted = await accept(clientDb, 'rg-client', await issue(clientDb, 'rg-client', 1), NOW, { selectedDriverId: DRIVER_A });
  if (clientAccepted.ok) {
    await reportCanonicalRoadDeliveryCompletedTransaction(
      clientDb,
      'rg-client',
      clientAccepted.receipt.deliveryId,
      'FAILED',
      NOW + realMsForCanonicalGameHours(plannedHours(clientDb, 'rg-client', clientAccepted.receipt.deliveryId) * 0.5),
      null,
      PROGRESSION,
    );
  }
  const clientDriver = clientDb.dump.get(driverPath('rg-client', DRIVER_A))!;
  assert(clientDriver.lastReleaseReason === 'CLIENT_UNVERIFIED_FAILURE_TERMINAL', 'W client FAILED classified release');
  assert(
    clientDb.dump.get(progressionPath('rg-client'))?.reputation === 50 &&
      clientDb.dump.get(progressionPath('rg-client'))?.totalXp === 0,
    'W client FAILED grants nothing trusted',
  );

  const fuelDb = await world('rg-fuel');
  const fuelAccepted = await accept(fuelDb, 'rg-fuel', await issue(fuelDb, 'rg-fuel', 1), NOW, { selectedDriverId: DRIVER_A }, {
    ...RISK,
    progressiveEnvValue: 'INTERNAL_TEST',
    timingEnvValue: 'INTERNAL_TEST',
  });
  if (fuelAccepted.ok) {
    const truckPath = 'users/rg-fuel/canonicalFleetAssets/fixture-healthy';
    fuelDb.dump.set(truckPath, { ...fuelDb.dump.get(truckPath)!, currentFuelL: 0.5 });
    const stranded = await reportCanonicalRoadDeliveryCompletedTransaction(
      fuelDb, 'rg-fuel', fuelAccepted.receipt.deliveryId, 'COMPLETED', NOW + 48 * HOUR_MS, null, PROGRESSION,
    );
    assert(!stranded.ok && stranded.reason === 'PROGRESS_INCOMPLETE', 'V stalled out of fuel');
    assert(
      fuelDb.dump.get(driverPath('rg-fuel', DRIVER_A))?.assignedCanonicalDeliveryId === fuelAccepted.receipt.deliveryId,
      'V out-of-fuel retains assignment',
    );
  } else {
    assert(false, 'V fuel accept');
  }

  const lowest = deriveCanonicalRoadRiskFromInputs(BASE);
  assert(lowest.riskTier === 'low' && lowest.riskBonus === 0, 'AC lowest tier exact');
  const exactFirst = deriveCanonicalRoadRiskFromInputs({ ...BASE, routeDifficulty: 0.2, driverAttention: 90 });
  const belowFirst = deriveCanonicalRoadRiskFromInputs({ ...BASE, routeDifficulty: 0.2, driverAttention: 95 });
  assert(belowFirst.riskTier === 'low' && exactFirst.riskTier === 'medium', 'AD first boundary exact (0.1 → medium)');
  assert(getDeliveryRiskTier({ breakdownChance: 0.125, accidentChance: 0.125 }) === 'high', 'AD 0.25 → high');
  assert(getDeliveryRiskTier({ breakdownChance: 0.125, accidentChance: 0.1249 }) === 'medium', 'AD below 0.25 → medium');
  const highest = deriveCanonicalRoadRiskFromInputs({
    ...BASE,
    truckCondition: 0,
    truckReliability: 0,
    routeDifficulty: 1,
    driverAttention: 0,
    driverSpeed: 100,
    cargoWeightTons: 25,
  });
  assert(highest.riskTier === 'high' && highest.breakdownChance === 0.58 && highest.accidentChance === 0.5, 'AE highest exact');
  assert(
    levelConfig.deliveryXp.riskBonus.low === 0 &&
      levelConfig.deliveryXp.riskBonus.medium === 10 &&
      levelConfig.deliveryXp.riskBonus.high === 25 &&
      highest.riskBonus === 25 &&
      exactFirst.riskBonus === 10,
    'AF risk bonus exact',
  );

  const trustedEconomics = {
    driverEconomicsPolicyVersion: ROAD_EXECUTION_ECONOMICS_DRIVER_POLICY_VERSION,
    fuelPriceAuthority: 'SERVER_GLOBAL_ECONOMY',
    maintenanceEventAuthority: 'CANONICAL_CONTRACT_WORLD_EVENTS',
    fragilityPolicySnapshot: { contractType: 'standard' },
  } as unknown as CanonicalRoadExecutionEconomicsSnapshot;
  const lowSnapshot = { ...lowest, riskPolicyVersion: CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION, inputs: BASE };
  const xpFor = (distanceKm: number, gross: number, costs: number) =>
    deriveCanonicalRoadCompletionXpForDelivery({
      delivery: { distanceKm, deliveryRiskSnapshot: lowSnapshot, executionEconomicsSnapshot: trustedEconomics },
      derivedSettlement: { grossRevenue: gross, fuelCost: costs, maintenanceCost: 0, penaltyCost: 0 },
    });
  const negative = xpFor(400, 1_000, 6_000);
  assert(negative.ok && negative.xp === 45 && negative.xpEvidence?.netProfit === -5_000, 'AH negative netProfit XP exact');
  const positive = xpFor(400, 13_000, 1_000);
  assert(positive.ok && positive.xp === 57, 'AI positive netProfit XP exact');
  const minClamp = xpFor(0, 0, 1_000_000);
  assert(minClamp.ok && minClamp.xp === 25 && levelConfig.deliveryXp.min === 20, 'AJ min clamp inert (floor 25)');
  const maxClamp = xpFor(5_000, 600_000, 0);
  assert(maxClamp.ok && maxClamp.xp === levelConfig.deliveryXp.max, 'AK max clamp exact');

  const rep = (band: 'EARLY' | 'ON_TIME' | 'LATE_MINOR' | 'LATE_MAJOR', actual: number, contractType = 'standard') =>
    deriveCanonicalRoadCompletionReputation({ band, actualTravelHours: actual, deadlineHours: 10, plannedTravelGameHours: 8, contractType });
  const early = rep('EARLY', 7);
  const onTime = rep('ON_TIME', 9);
  const highRep = rep('ON_TIME', 9, 'high_reputation');
  const lateMinor = rep('LATE_MINOR', 10.5);
  const lateMajor = rep('LATE_MAJOR', 15);
  assert(early.ok && early.delta === REPUTATION_RULES.deliveryEarly && early.delta === 3, 'AO early +3');
  assert(onTime.ok && onTime.delta === 2, 'AO on-time +2');
  assert(highRep.ok && highRep.delta === 2 + REPUTATION_RULES.highRiskDeliverySuccess, 'AO high-reputation +1');
  assert(lateMinor.ok && lateMinor.delta === -2, 'AO late-minor -2');
  assert(lateMajor.ok && lateMajor.delta === -4, 'AO late-major -4');
  assert(deriveCanonicalRoadCancelReputation().delta === -6, 'AP cancel -6');
  assert(deriveCanonicalRoadServerFailureReputation().delta === -6, 'AQ failed -6');

  const oldDb = await world('rg-old');
  const old = await accept(oldDb, 'rg-old', await issue(oldDb, 'rg-old', 1), NOW, {}, {});
  if (old.ok) {
    await reportCanonicalRoadDeliveryCompletedTransaction(
      oldDb,
      'rg-old',
      old.receipt.deliveryId,
      'COMPLETED',
      NOW + realMsForCanonicalGameHours(plannedHours(oldDb, 'rg-old', old.receipt.deliveryId) * 0.5),
      null,
      PROGRESSION,
    );
    const oldReceipt = oldDb.dump.get(completionReceipt('rg-old', old.receipt.deliveryId))!;
    assert(
      oldReceipt.xpAuthority === CANONICAL_ROAD_COMPLETION_XP_AUTHORITY && oldReceipt.xpDelta === 0,
      'AR old delivery without snapshot stays blocked',
    );
    assert(oldDb.dump.get(deliveryPath('rg-old', old.receipt.deliveryId))?.deliveryRiskSnapshot === undefined, 'AR no retro snapshot');
  } else {
    assert(false, 'AR old accept');
  }

  for (const [name, target] of [
    ['accept', db],
    ['cancel', cancelDb],
    ['late', lateDb],
    ['client', clientDb],
    ['old', oldDb],
  ] as const) {
    assert(cashKeys(target).length === 0, `AS/AT/AW ${name} no cash transaction or ledger`);
  }
  assert(db.dump.get(`users/${uid}`)?.money === 31_337, 'AU users money unchanged');
  assert(!/\.money|money:|serverState\.cash|financeLedger|applyCanonicalCash/.test(riskBackend), 'AS backend risk no cash');
  assert(!riskDomain.includes('player.money'), 'AV no player.money');
  assert(!/financeLedger|canonicalCashTransactions/.test(riskDomain), 'AW domain no ledger');

  assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AX HUD overlay off');
  assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AY cash listener off');
  assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AZ cashAuthorityVersion 0');
  assert(
    canUseServerAuthoritativeSettlement({
      signedInLinked: true,
      cashAuthorityVersion: 0,
      serverStateCashPresent: true,
      reconciliationActive: true,
      staleSaveProtectionActive: true,
    }).ready === false,
    'BA settlement false',
  );
  assert(SAVE_GAME_VERSION === 6, 'BB SAVE_GAME_VERSION 6');
  assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'BC rail');
  assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'BC sea');
  assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'BC air');
  assert(resolveMultimodalFeatureRollout(null) === 'MULTIMODAL_OFF', 'BD multimodal off');

  const coverage = getSignedInCashAuthorityCoverage();
  assert(coverage.criticalSignedInCashPathsTotal === 24, 'coverage total 24');
  assert(coverage.criticalCanonicalizedCount === 0, 'coverage canonical 0');
  assert(coverage.criticalBlockedCount === 24, 'coverage blocked 24');
  assert(
    CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY_STATUS === 'CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY_PASS_INTERNAL_ONLY',
    'status PASS_INTERNAL_ONLY',
  );
  assert(DRIVER_POOL.some((row) => row.id === DRIVER_A && !row.comingSoon), 'fixture driver from catalog');

  if (fail > 0) {
    console.error(`\nFAILED ${fail} / ${pass + fail}`);
    process.exit(1);
  }
  console.log(`OK ${pass} assertions`);
  console.log(
    JSON.stringify({
      CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY_STATUS,
      RISK_POLICY: CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION,
      DRIVER_SNAPSHOT_POLICY: CANONICAL_ROAD_DRIVER_SNAPSHOT_POLICY_VERSION,
      CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
      CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
      CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
    }),
  );
}

void main();
