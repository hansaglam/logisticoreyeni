/**
 * Canonical delivery risk tier / driver assignment authority — in-memory tests (Step 29AG).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import {
  acceptCanonicalRoadDeliveryTransaction,
  cancelCanonicalRoadDeliveryTransaction,
  issueCanonicalRoadContractTransaction,
  reportCanonicalRoadDeliveryCompletedTransaction,
} from '../src/canonicalRoadDelivery';
import { bootstrapInternalCanonicalFleetFixturesTransaction } from '../src/canonicalFleet';
import { bootstrapInternalCanonicalDriverFixtureTransaction } from '../src/canonicalDeliveryRiskDriver';
import { applyCanonicalRoadDeliveryWearTransaction } from '../src/canonicalFleetWear';
import {
  fireCanonicalDriverTransaction,
  hireCanonicalDriverTransaction,
} from '../src/canonicalCoreVehicleStaffCash';
import { serverStateCurrentRef } from '../src/canonicalCashTransaction';
import { generateCanonicalProductionRoadBatchTransaction } from '../src/canonicalProductionRoadContractIssuance';
import { initializeCanonicalCompanyProgressionForNewAccount } from '../src/canonicalCompanyProgression';
import { CITIES } from '../../src/data/cities';
import { DRIVER_POOL, STARTER_DRIVER } from '../../src/data/drivers';
import { PRODUCT_BY_ID, PRODUCT_IDS } from '../../src/data/products';
import { getRoute } from '../../src/data/routes';
import { levelConfig } from '../../src/config/levelConfig';
import { calculateDeliveryXp, getDeliveryRiskTier } from '../../src/simulation/leveling';
import { calculateConditionLoss } from '../../src/simulation/delivery';
import {
  CANONICAL_COMPANY_PROGRESSION_AUTHORITY_STATUS,
  CANONICAL_PROGRESSION_READINESS,
  CANONICAL_PROGRESSION_REMAINING_CLIENT_XP_SOURCES,
  CANONICAL_ROAD_COMPLETION_XP_AUTHORITY,
  PROGRESSION_XP_BLOCKED_INCIDENT_ECONOMICS,
  PROGRESSION_XP_BLOCKED_NET_PROFIT_AUTHORITY,
  PROGRESSION_XP_BLOCKED_RISK_POLICY_UNKNOWN,
  PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_INVALID,
  deriveCanonicalRoadProductionNetProfit,
} from '../../src/domain/canonicalCompanyProgression';
import {
  CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY_STATUS,
  CANONICAL_DRIVER_RISK_FORBIDDEN_CLIENT_KEYS,
  CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION,
  CANONICAL_ROAD_DRIVER_SNAPSHOT_POLICY_VERSION,
  PRODUCTION_CONTRACT_TYPE_PENALTY_MULTIPLIERS,
  ROAD_EXECUTION_ECONOMICS_DRIVER_POLICY_VERSION,
  classifyCanonicalDriverForAssignment,
  containsForbiddenDriverRiskClientKeys,
  deriveCanonicalRoadCompletionXpForDelivery,
  deriveCanonicalRoadRiskFromInputs,
  isCanonicalRoadDriverRiskAllowed,
  resolveCanonicalAcceptFuelPrice,
  resolveCanonicalDriverStatTemplate,
  resolveCanonicalTruckRiskProfile,
  validateCanonicalRoadDeliveryRiskSnapshot,
  type CanonicalRoadDeliveryRiskSnapshot,
  type CanonicalRoadDriverSnapshot,
  type CanonicalRoadRiskInputs,
} from '../../src/domain/canonicalDeliveryRiskDriver';
import { hasOnlyCanonicalRoadAcceptKeys, hasOnlyCanonicalRoadCompleteKeys } from '../../src/domain/canonicalRoadDelivery';
import {
  CANONICAL_ROAD_DELIVERY_WEAR_POLICY_VERSION,
  CANONICAL_ROAD_DELIVERY_WEAR_POLICY_VERSION_V2,
} from '../../src/domain/canonicalFleetConditionWear';
import { buildFixtureMarket } from '../../src/domain/canonicalRoadEconomics';
import { deriveCanonicalRoadFuelRequirement } from '../../src/domain/canonicalFuelTankPrice';
import { buildInternalCanonicalFleetFixtureAssets } from '../../src/domain/canonicalRoadFleet';
import { realMsForCanonicalGameHours } from '../../src/domain/canonicalRoadTiming';
import { createInternalFixtureRuntime } from '../../src/domain/canonicalFleetRuntimeLocation';
import { deriveCanonicalProductionMarketQuote } from '../../src/domain/canonicalProductionMarketTick';
import { PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS } from '../../src/domain/canonicalProductionRoadContractIssuance';
import { PRODUCTION_TIMING_DRIVER_STATUS } from '../../src/domain/canonicalRoadExecutionTiming';

type Dump = Map<string, Record<string, unknown>>;

/** Serialized transactions with buffered writes (Firestore serializable isolation + rollback). */
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
    runTransaction<T>(operation: (transaction: {
      get: (ref: { path: string; _col?: boolean }) => Promise<{
        exists: boolean;
        data: () => Record<string, unknown> | undefined;
        docs: Array<{ id: string; data: () => Record<string, unknown> }>;
      }>;
      create: (ref: { path: string }, data: Record<string, unknown>) => void;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<T>): Promise<T> {
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

function deliveryPath(uid: string, deliveryId: string) {
  return `users/${uid}/canonicalRoadDeliveries/${deliveryId}`;
}
function driverPath(uid: string, driverId: string) {
  return `users/${uid}/canonicalDrivers/${driverId}`;
}
function progressionPath(uid: string) {
  return `users/${uid}/canonicalCompanyProgression/current`;
}
function completionReceiptPath(uid: string, deliveryId: string) {
  return `users/${uid}/canonicalProgressionReceipts/progression:delivery:${deliveryId}:completion`;
}

async function setupWorld(
  db: Firestore & { dump: Dump },
  uid: string,
  options: { economy?: boolean; drivers?: string[]; progression?: boolean } = {},
) {
  if (options.economy !== false) db.dump.set('globalEconomy/current', { fuelPricePerLiter: 1.72 });
  const fleet = await bootstrapInternalCanonicalFleetFixturesTransaction(db, uid, 1, GATE);
  assert.equal(fleet.ok, true);
  for (const poolId of options.drivers ?? [DRIVER_A]) {
    const fixture = await bootstrapInternalCanonicalDriverFixtureTransaction(db, uid, poolId, NOW, {
      envValue: 'INTERNAL_TEST',
      driverRiskEnvValue: 'INTERNAL_TEST',
    });
    assert.equal(fixture.ok, true);
  }
  if (options.progression !== false) {
    const init = await initializeCanonicalCompanyProgressionForNewAccount(db, uid, NOW, GATE);
    assert.equal(init.ok, true);
  }
}

async function issue(db: Firestore & { dump: Dump }, uid: string, sequence: number, startMs = NOW) {
  const issued = await issueCanonicalRoadContractTransaction(db, uid, { ...ISSUANCE, sequence }, startMs);
  assert.equal(issued.ok, true);
  if (!issued.ok) throw new Error('issue failed');
  return issued.snapshot.contractId;
}

async function accept(
  db: Firestore & { dump: Dump },
  uid: string,
  contractId: string,
  startMs: number,
  request: Record<string, unknown> = {},
  options: Record<string, string | null> = RISK,
) {
  return acceptCanonicalRoadDeliveryTransaction(
    db,
    uid,
    { contractId, canonicalSchemaVersion: 1, ...request },
    startMs,
    options,
  );
}

function expectedRisk(i: CanonicalRoadRiskInputs) {
  const load = i.cargoWeightTons / Math.max(i.truckCapacity, 1);
  const clamp = (v: number) => Math.min(0.85, Math.max(0, v));
  const breakdown = clamp(
    0.02 +
      ((100 - i.truckCondition) / 100) * 0.18 +
      ((100 - i.truckReliability) / 100) * 0.12 +
      i.routeDifficulty * 0.1 +
      load * 0.06 +
      ((100 - i.driverAttention) / 100) * 0.1,
  );
  const accident = clamp(
    0.01 +
      Math.max(0, i.driverSpeed / 100) * 0.12 +
      ((100 - i.driverAttention) / 100) * 0.14 +
      i.routeDifficulty * 0.11 +
      ((100 - i.truckCondition) / 100) * 0.08 +
      load * 0.04,
  );
  return { breakdown, accident, combined: breakdown + accident };
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

test('gate, policies, statuses and forbidden client keys', () => {
  assert.equal(isCanonicalRoadDriverRiskAllowed({ envValue: undefined }), false);
  assert.equal(isCanonicalRoadDriverRiskAllowed({ envValue: null }), false);
  assert.equal(isCanonicalRoadDriverRiskAllowed({ envValue: 'ON' }), false);
  assert.equal(isCanonicalRoadDriverRiskAllowed({ envValue: 'INTERNAL_TEST' }), true);
  assert.equal(CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION, 'canonical-road-delivery-risk-tier-v1');
  assert.equal(CANONICAL_ROAD_DRIVER_SNAPSHOT_POLICY_VERSION, 'canonical-road-driver-snapshot-v1');
  assert.equal(CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY_STATUS, 'CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY_PASS_INTERNAL_ONLY');
  assert.equal(CANONICAL_COMPANY_PROGRESSION_AUTHORITY_STATUS, 'CANONICAL_COMPANY_PROGRESSION_AUTHORITY_PASS_INTERNAL_ONLY');
  assert.equal(CANONICAL_PROGRESSION_READINESS, 'CANONICAL_PROGRESSION_BLOCKED_UNSUPPORTED_REWARD_PROGRESS');
  assert.equal(CANONICAL_ROAD_COMPLETION_XP_AUTHORITY, 'PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_MISSING');
  assert.ok(CANONICAL_PROGRESSION_REMAINING_CLIENT_XP_SOURCES.includes('missions-unsupported-progress'));
  assert.ok(PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('COMPANY_XP_UNSUPPORTED_REWARD_PROGRESS_CLIENT_OWNED'));
  assert.equal(
    (PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS as readonly string[]).includes('COMPANY_XP_DELIVERY_RISK_TIER_UNTRUSTED'),
    false,
  );
  assert.equal(PRODUCTION_TIMING_DRIVER_STATUS, 'PRODUCTION_TIMING_DRIVER_AUTHORITY_INTERNAL_SNAPSHOT_ONLY');
  for (const key of [
    'driverAttention',
    'driverSpeed',
    'driverFuelSaving',
    'driverLevel',
    'driverTier',
    'driverStats',
    'truckReliability',
    'riskTier',
    'riskBonus',
    'riskScore',
    'netProfit',
    'completionXp',
    'xpReward',
  ]) {
    assert.ok((CANONICAL_DRIVER_RISK_FORBIDDEN_CLIENT_KEYS as readonly string[]).includes(key), key);
    assert.equal(hasOnlyCanonicalRoadAcceptKeys({ contractId: 'c', canonicalSchemaVersion: 1, [key]: 1 }), false, key);
    assert.equal(hasOnlyCanonicalRoadCompleteKeys({ deliveryId: 'd', outcome: 'COMPLETED', [key]: 1 }), false, key);
    assert.equal(containsForbiddenDriverRiskClientKeys({ [key]: 1 }), true, key);
  }
  assert.equal(hasOnlyCanonicalRoadAcceptKeys({ contractId: 'c', canonicalSchemaVersion: 1, selectedDriverId: DRIVER_A }), true);
  assert.deepEqual(PRODUCTION_CONTRACT_TYPE_PENALTY_MULTIPLIERS, {
    standard: 1,
    urgent: 1.35,
    fragile: 1.25,
    high_reputation: 1.15,
    bulk: 1.1,
    refrigerated: 1.2,
  });
});

test('golden risk vectors match production formulas and tier thresholds', () => {
  const vectors: Array<{ label: string; inputs: CanonicalRoadRiskInputs; tier: 'low' | 'medium' | 'high' }> = [
    { label: 'lowest', inputs: BASE, tier: 'low' },
    { label: 'below-first', inputs: { ...BASE, routeDifficulty: 0.2, driverAttention: 95 }, tier: 'low' },
    { label: 'exact-first', inputs: { ...BASE, routeDifficulty: 0.2, driverAttention: 90 }, tier: 'medium' },
    { label: 'middle', inputs: { ...BASE, routeDifficulty: 0.4, driverAttention: 80, driverSpeed: 10 }, tier: 'medium' },
    { label: 'near-second', inputs: { ...BASE, routeDifficulty: 0.6, driverAttention: 70, driverSpeed: 10 }, tier: 'medium' },
    {
      label: 'highest',
      inputs: { ...BASE, truckCondition: 0, truckReliability: 0, routeDifficulty: 1, driverAttention: 0, driverSpeed: 100, cargoWeightTons: 25 },
      tier: 'high',
    },
  ];
  for (const { label, inputs, tier } of vectors) {
    const derived = deriveCanonicalRoadRiskFromInputs(inputs);
    const expected = expectedRisk(inputs);
    assert.equal(derived.breakdownChance, expected.breakdown, label);
    assert.equal(derived.accidentChance, expected.accident, label);
    assert.equal(derived.combinedRisk, expected.combined, label);
    assert.equal(derived.riskTier, tier, `${label} ${expected.combined}`);
    assert.equal(derived.riskBonus, levelConfig.deliveryXp.riskBonus[tier], label);
  }
  assert.equal(getDeliveryRiskTier({ breakdownChance: 0.05, accidentChance: 0.05 }), 'medium');
  assert.equal(getDeliveryRiskTier({ breakdownChance: 0.05, accidentChance: 0.0499 }), 'low');
  assert.equal(getDeliveryRiskTier({ breakdownChance: 0.125, accidentChance: 0.125 }), 'high');
  assert.equal(getDeliveryRiskTier({ breakdownChance: 0.125, accidentChance: 0.1249 }), 'medium');

  const mid: CanonicalRoadRiskInputs = { ...BASE, routeDifficulty: 0.3, driverAttention: 80, driverSpeed: 10, truckReliability: 80 };
  const base = deriveCanonicalRoadRiskFromInputs(mid).combinedRisk;
  const attentionOnly = deriveCanonicalRoadRiskFromInputs({ ...mid, driverAttention: 60 }).combinedRisk - base;
  assert.ok(Math.abs(attentionOnly - 0.2 * (0.1 + 0.14)) < 1e-12, 'attention only');
  const speedOnly = deriveCanonicalRoadRiskFromInputs({ ...mid, driverSpeed: 30 }).combinedRisk - base;
  assert.ok(Math.abs(speedOnly - 0.2 * 0.12) < 1e-12, 'speed only');
  const reliabilityOnly = deriveCanonicalRoadRiskFromInputs({ ...mid, truckReliability: 60 }).combinedRisk - base;
  assert.ok(Math.abs(reliabilityOnly - 0.2 * 0.12) < 1e-12, 'reliability only');
  const negativeSpeed = deriveCanonicalRoadRiskFromInputs({ ...mid, driverSpeed: -8 }).accidentChance;
  const zeroSpeed = deriveCanonicalRoadRiskFromInputs({ ...mid, driverSpeed: 0 }).accidentChance;
  assert.equal(negativeSpeed, zeroSpeed, 'negative speed clamps to 0');
  const combined = deriveCanonicalRoadRiskFromInputs({ ...mid, driverAttention: 60, driverSpeed: 30, truckReliability: 60 });
  assert.ok(Math.abs(combined.combinedRisk - (base + attentionOnly + speedOnly + reliabilityOnly)) < 1e-12);
});

test('golden XP and netProfit vectors reuse production calculateDeliveryXp', () => {
  assert.equal(deriveCanonicalRoadProductionNetProfit({ grossRevenue: 10_000, fuelCost: 1_200, maintenanceCost: 800, penaltyCost: 300 }), 7_700);
  assert.equal(deriveCanonicalRoadProductionNetProfit({ grossRevenue: 500, fuelCost: 400, maintenanceCost: 300, penaltyCost: 0 }), -200);
  assert.equal(calculateDeliveryXp(400, -5_000, 'low'), 45);
  assert.equal(calculateDeliveryXp(400, 0, 'low'), 45);
  assert.equal(calculateDeliveryXp(400, 12_000, 'low'), 57);
  assert.equal(calculateDeliveryXp(400, 12_000, 'medium'), 67);
  assert.equal(calculateDeliveryXp(400, 12_000, 'high'), 82);
  assert.equal(calculateDeliveryXp(5_000, 500_000, 'high'), levelConfig.deliveryXp.max);
  assert.equal(levelConfig.deliveryXp.min, 20);
  assert.equal(calculateDeliveryXp(0, -1_000_000, 'low'), 25, 'min clamp 20 is inert: base 25 floor');
  assert.equal(calculateDeliveryXp(155, 3_000, 'medium') - calculateDeliveryXp(155, 3_000, 'low'), 10);
  assert.equal(calculateDeliveryXp(155, 3_000, 'high') - calculateDeliveryXp(155, 3_000, 'low'), 25);
});

test('driver identity: catalog stats only, legacy/fixture/level/availability classification', () => {
  const starter = resolveCanonicalDriverStatTemplate(STARTER_DRIVER.poolId);
  assert.deepEqual(
    [starter?.attention, starter?.speed, starter?.fuelSaving, starter?.tier],
    [70, 10, 45, 'rookie'],
  );
  const can = resolveCanonicalDriverStatTemplate(DRIVER_A);
  const pool = DRIVER_POOL.find((row) => row.id === DRIVER_A)!;
  assert.deepEqual([can?.attention, can?.speed, can?.fuelSaving], [pool.attention, pool.speed, pool.fuelSaving]);
  const comingSoon = DRIVER_POOL.find((row) => row.comingSoon);
  if (comingSoon) assert.equal(resolveCanonicalDriverStatTemplate(comingSoon.id), null);
  assert.equal(resolveCanonicalDriverStatTemplate('driver-made-up'), null);

  const base = {
    driverId: DRIVER_A,
    poolId: DRIVER_A,
    ownerUid: 'u1',
    attentionBaseline: pool.attention,
    status: 'hired',
    assignedCanonicalDeliveryId: null,
    schema: 1,
    authoritySource: 'DRIVER_POOL_CATALOG',
    policyVersion: 'canonical-driver-offer-v1',
  };
  const input = { uid: 'u1', driverId: DRIVER_A, deliveryId: 'rd_x', requiredDriverLevel: null, nowMs: NOW };
  const legacy = classifyCanonicalDriverForAssignment(null, input);
  assert.equal(legacy.ok, false);
  if (!legacy.ok) {
    assert.equal(legacy.authorityClass, 'LEGACY_CLIENT_UNVERIFIED');
    assert.equal(legacy.reason, 'LEGACY_DRIVER_UNVERIFIED');
  }
  const server = classifyCanonicalDriverForAssignment(
    { ...base, attention: 100, speed: -50, fuelSaving: 100 },
    input,
  );
  assert.equal(server.ok, true);
  if (server.ok) {
    assert.equal(server.authorityClass, 'SERVER_CANONICAL_DRIVER');
    assert.equal(server.snapshot.attention, pool.attention, 'doc attention field ignored');
    assert.equal(server.snapshot.speed, pool.speed);
    assert.equal(server.snapshot.fuelSaving, pool.fuelSaving);
  }
  const fixture = classifyCanonicalDriverForAssignment({ ...base, authoritySource: 'INTERNAL_TEST_FIXTURE' }, input);
  assert.equal(fixture.ok && fixture.authorityClass, 'INTERNAL_TEST_DRIVER_FIXTURE');
  const cases: Array<[Record<string, unknown>, Partial<typeof input>, string]> = [
    [{ ...base, ownerUid: 'u2' }, {}, 'CANONICAL_DRIVER_NOT_OWNED'],
    [{ ...base, status: 'fired' }, {}, 'CANONICAL_DRIVER_NOT_HIRED'],
    [{ ...base, attentionBaseline: 99 }, {}, 'CANONICAL_DRIVER_STATS_MISMATCH'],
    [{ ...base, assignedCanonicalDeliveryId: 'rd_other' }, {}, 'DRIVER_NOT_AVAILABLE'],
    [{ ...base, authoritySource: 'CLIENT' }, {}, 'CANONICAL_DRIVER_AUTHORITY_UNSUPPORTED'],
    [{ ...base, policyVersion: 'x' }, {}, 'CANONICAL_DRIVER_POLICY_UNKNOWN'],
    [{ ...base, schema: 2 }, {}, 'CANONICAL_DRIVER_SCHEMA_UNSUPPORTED'],
    [{ ...base, poolId: 'driver-made-up' }, {}, 'CANONICAL_DRIVER_STATS_UNAVAILABLE'],
    [base, { requiredDriverLevel: 2 as never }, 'CANONICAL_DRIVER_LEVEL_AUTHORITY_UNAVAILABLE'],
    [base, { requiredDriverLevel: 'x' as never }, 'CANONICAL_DRIVER_LEVEL_REQUIREMENT_INVALID'],
  ];
  for (const [doc, override, reason] of cases) {
    const result = classifyCanonicalDriverForAssignment(doc, { ...input, ...override });
    assert.equal(result.ok, false, reason);
    if (!result.ok) assert.equal(result.reason, reason);
  }
  assert.equal(classifyCanonicalDriverForAssignment(base, { ...input, requiredDriverLevel: 1 as never }).ok, true);
  assert.equal(
    classifyCanonicalDriverForAssignment({ ...base, assignedCanonicalDeliveryId: 'rd_x' }, input).ok,
    true,
    'same delivery retry is not a conflict',
  );
});

test('truck reliability comes from the fleet template with no default fallback', () => {
  const [healthy, degraded] = buildInternalCanonicalFleetFixtureAssets('u1', NOW);
  const h = resolveCanonicalTruckRiskProfile(healthy!);
  assert.equal(h.ok, true);
  if (h.ok) {
    assert.equal(h.reliabilitySource, 'INTERNAL_TEST_FIXTURE_TEMPLATE');
    assert.equal(h.reliability, 75);
    assert.equal(h.condition, healthy!.economicCondition);
  }
  const d = resolveCanonicalTruckRiskProfile(degraded!);
  assert.equal(d.ok && d.condition, 35);
  const catalog = resolveCanonicalTruckRiskProfile({ ...healthy!, fixtureKey: 'none', catalogModelId: 'truck-rota-3' });
  if (catalog.ok) assert.equal(catalog.reliabilitySource, 'CATALOG_MODEL');
  const unknown = resolveCanonicalTruckRiskProfile({ ...healthy!, fixtureKey: 'none', catalogModelId: 'made-up' });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.reason, 'CANONICAL_TRUCK_RELIABILITY_UNAVAILABLE');
  assert.deepEqual(resolveCanonicalAcceptFuelPrice(null), { pricePerLiter: 1.72, authority: 'INTERNAL_FALLBACK_UNTRUSTED' });
  assert.equal(resolveCanonicalAcceptFuelPrice({ fuelPricePerLiter: 1.9 }).authority, 'SERVER_GLOBAL_ECONOMY');
});

test('risk snapshot validation: missing, unknown policy and tampered tier fail closed', () => {
  const inputs = { ...BASE, routeDifficulty: 0.4, driverAttention: 80, driverSpeed: 10 };
  const derived = deriveCanonicalRoadRiskFromInputs(inputs);
  const valid = { ...derived, riskPolicyVersion: CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION, inputs };
  assert.equal(validateCanonicalRoadDeliveryRiskSnapshot(valid).ok, true);
  const missing = validateCanonicalRoadDeliveryRiskSnapshot(undefined);
  assert.equal(!missing.ok && missing.xpAuthority, CANONICAL_ROAD_COMPLETION_XP_AUTHORITY);
  const unknown = validateCanonicalRoadDeliveryRiskSnapshot({ ...valid, riskPolicyVersion: 'canonical-road-delivery-risk-tier-v9' });
  assert.equal(!unknown.ok && unknown.xpAuthority, PROGRESSION_XP_BLOCKED_RISK_POLICY_UNKNOWN);
  const tampered = validateCanonicalRoadDeliveryRiskSnapshot({ ...valid, riskTier: 'high', riskBonus: 25 });
  assert.equal(!tampered.ok && tampered.xpAuthority, PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_INVALID);
  const settlement = { grossRevenue: 5_000, fuelCost: 300, maintenanceCost: 400, penaltyCost: 0 };
  const noEconomics = deriveCanonicalRoadCompletionXpForDelivery({
    delivery: { distanceKm: 155, deliveryRiskSnapshot: valid, executionEconomicsSnapshot: null },
    derivedSettlement: settlement,
  });
  assert.equal(noEconomics.xpAuthority, PROGRESSION_XP_BLOCKED_NET_PROFIT_AUTHORITY);
});

test('accept: gate off unchanged, gate on requires trusted driver, legacy rejected, fixture assigned once', async () => {
  const db = createMemoryFirestore();
  const uid = 'risk-accept';
  await setupWorld(db, uid, { drivers: [DRIVER_A, DRIVER_B] });

  const off = await accept(db, uid, await issue(db, uid, 1), NOW, { selectedDriverId: DRIVER_A }, {});
  assert.equal(off.ok, true);
  if (!off.ok) return;
  const offDoc = db.dump.get(deliveryPath(uid, off.receipt.deliveryId))!;
  assert.equal(offDoc.deliveryRiskSnapshot, undefined);
  assert.equal(offDoc.canonicalDriverSnapshot, undefined);
  assert.equal(db.dump.get(driverPath(uid, DRIVER_A))?.assignedCanonicalDeliveryId, null);
  await cancelCanonicalRoadDeliveryTransaction(db, uid, off.receipt.deliveryId, NOW + 1);

  const c2 = await issue(db, uid, 2);
  const noDriver = await accept(db, uid, c2, NOW + 2);
  assert.equal(!noDriver.ok && noDriver.reason, 'CANONICAL_DRIVER_REQUIRED');
  const legacy = await accept(db, uid, c2, NOW + 2, { selectedDriverId: 'driver-starter-1' });
  assert.equal(!legacy.ok && legacy.reason, 'LEGACY_DRIVER_UNVERIFIED');
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContracts/${c2}`)?.status, 'AVAILABLE');

  const ok = await accept(db, uid, c2, NOW + 3, { selectedDriverId: DRIVER_A });
  assert.equal(ok.ok, true, ok.ok ? '' : ok.reason);
  if (!ok.ok) return;
  const doc = db.dump.get(deliveryPath(uid, ok.receipt.deliveryId))!;
  const driverSnapshot = doc.canonicalDriverSnapshot as CanonicalRoadDriverSnapshot;
  const risk = doc.deliveryRiskSnapshot as CanonicalRoadDeliveryRiskSnapshot;
  const pool = DRIVER_POOL.find((row) => row.id === DRIVER_A)!;
  assert.equal(driverSnapshot.authorityClass, 'INTERNAL_TEST_DRIVER_FIXTURE');
  assert.equal(driverSnapshot.attention, pool.attention);
  assert.equal(driverSnapshot.speed, pool.speed);
  assert.equal(risk.riskPolicyVersion, CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION);
  assert.equal(risk.inputs.driverAttention, pool.attention);
  assert.equal(risk.inputs.truckReliability, 75);
  assert.equal(risk.inputs.routeDifficulty, getRoute('istanbul', 'bursa')!.difficulty);
  assert.equal(risk.riskTier, getDeliveryRiskTier(risk));
  assert.equal(doc.driverAssignmentState, 'ASSIGNED');
  const economics = doc.executionEconomicsSnapshot as Record<string, unknown>;
  assert.equal(economics.driverEconomicsPolicyVersion, ROAD_EXECUTION_ECONOMICS_DRIVER_POLICY_VERSION);
  assert.equal(economics.fuelPriceAuthority, 'SERVER_GLOBAL_ECONOMY');
  assert.equal(economics.maintenanceEventAuthority, 'CANONICAL_CONTRACT_WORLD_EVENTS');
  const driverDoc = db.dump.get(driverPath(uid, DRIVER_A))!;
  assert.equal(driverDoc.assignedCanonicalDeliveryId, ok.receipt.deliveryId);
  assert.equal(driverDoc.driverRuntimeRevision, 1);

  const retry = await accept(db, uid, c2, NOW + 4, { selectedDriverId: DRIVER_A });
  assert.equal(retry.ok && retry.receipt.alreadyAccepted, true);
  const device2 = await accept(db, uid, c2, NOW + 5, { selectedDriverId: DRIVER_B });
  assert.equal(device2.ok && device2.receipt.alreadyAccepted, true);
  assert.equal(db.dump.get(driverPath(uid, DRIVER_A))?.driverRuntimeRevision, 1);
  assert.equal(db.dump.get(driverPath(uid, DRIVER_B))?.assignedCanonicalDeliveryId, null);

  const c3 = await issue(db, uid, 3);
  const busy = await accept(db, uid, c3, NOW + 6, { selectedDriverId: DRIVER_A, canonicalTruckAssetId: 'fixture-degraded' });
  assert.equal(!busy.ok && busy.reason, 'DRIVER_NOT_AVAILABLE');
  assert.equal(db.dump.get(`users/${uid}/canonicalRoadContracts/${c3}`)?.status, 'AVAILABLE');
  assert.equal([...db.dump.keys()].some((key) => key.includes('canonicalCashTransactions')), false);
});

test('concurrent accepts with one driver assign it exactly once; fire race never double-books', async () => {
  const db = createMemoryFirestore();
  const uid = 'risk-race';
  await setupWorld(db, uid);
  const [c1, c2] = [await issue(db, uid, 1), await issue(db, uid, 2)];
  const results = await Promise.all([
    accept(db, uid, c1, NOW + 1, { selectedDriverId: DRIVER_A, canonicalTruckAssetId: 'fixture-healthy' }),
    accept(db, uid, c2, NOW + 1, { selectedDriverId: DRIVER_A, canonicalTruckAssetId: 'fixture-degraded' }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  const loser = results.find((r) => !r.ok);
  assert.equal(loser && !loser.ok && loser.reason, 'DRIVER_NOT_AVAILABLE');
  const winner = results.find((r) => r.ok)!;
  assert.equal(
    db.dump.get(driverPath(uid, DRIVER_A))?.assignedCanonicalDeliveryId,
    winner.ok ? winner.receipt.deliveryId : null,
  );

  const fdb = createMemoryFirestore();
  const fuid = 'risk-fire';
  fdb.dump.set(serverStateCurrentRef(fuid), { cash: 200_000, ownerUid: fuid, sourceVersion: 1 });
  fdb.dump.set('globalEconomy/current', { fuelPricePerLiter: 1.72 });
  await bootstrapInternalCanonicalFleetFixturesTransaction(fdb, fuid, 1, GATE);
  assert.equal((await hireCanonicalDriverTransaction(fdb, fuid, DRIVER_A, 'hire-a0001', NOW, GATE)).ok, true);
  assert.equal((await hireCanonicalDriverTransaction(fdb, fuid, DRIVER_B, 'hire-b0001', NOW, GATE)).ok, true);
  const cashAfterHire = fdb.dump.get(serverStateCurrentRef(fuid))?.cash;
  const fc = await issue(fdb, fuid, 1);
  const [accepted, fired] = await Promise.all([
    accept(fdb, fuid, fc, NOW + 1, { selectedDriverId: DRIVER_A }),
    fireCanonicalDriverTransaction(fdb, fuid, DRIVER_A, 'fire-a0001', NOW + 1, GATE),
  ]);
  const driver = fdb.dump.get(driverPath(fuid, DRIVER_A))!;
  assert.notEqual(accepted.ok && fired.ok, true, 'accept and fire cannot both win');
  if (accepted.ok) {
    assert.equal(!fired.ok && fired.reason, 'DRIVER_ASSIGNED_TO_CANONICAL_DELIVERY');
    assert.equal(driver.status, 'hired');
    assert.equal(driver.assignedCanonicalDeliveryId, accepted.receipt.deliveryId);
    const fireAgain = await fireCanonicalDriverTransaction(fdb, fuid, DRIVER_A, 'fire-a0002', NOW + 2, GATE);
    assert.equal(!fireAgain.ok && fireAgain.reason, 'DRIVER_ASSIGNED_TO_CANONICAL_DELIVERY');
    assert.equal(fdb.dump.get(serverStateCurrentRef(fuid))?.cash, cashAfterHire, 'risk path writes no cash');
    const cancel = await cancelCanonicalRoadDeliveryTransaction(fdb, fuid, accepted.receipt.deliveryId, NOW + 3);
    assert.equal(cancel.ok, true);
    const fireAfter = await fireCanonicalDriverTransaction(fdb, fuid, DRIVER_A, 'fire-a0003', NOW + 4, GATE);
    assert.equal(fireAfter.ok, true);
  } else {
    assert.equal(fired.ok, true);
    assert.equal(driver.status, 'fired');
    assert.equal(driver.assignedCanonicalDeliveryId, null);
  }
});

async function completeWithDriver(uid: string, options: { economy?: boolean; events?: boolean } = {}) {
  const db = createMemoryFirestore();
  await setupWorld(db, uid, { economy: options.economy });
  const contractId = await issue(db, uid, 1);
  const accepted = await accept(
    db,
    uid,
    contractId,
    NOW,
    { selectedDriverId: DRIVER_A },
    { driverRiskEnvValue: 'INTERNAL_TEST', eventEnvValue: options.events === false ? null : 'INTERNAL_TEST' },
  );
  assert.equal(accepted.ok, true, accepted.ok ? '' : accepted.reason);
  if (!accepted.ok) throw new Error(accepted.reason);
  const deliveryId = accepted.receipt.deliveryId;
  const doc = db.dump.get(deliveryPath(uid, deliveryId)) as { timingSnapshot: { plannedTravelGameHours: number } };
  return { db, deliveryId, plannedHours: doc.timingSnapshot.plannedTravelGameHours, deadlineHours: accepted.receipt.deadlineHours };
}

test('completion grants server-derived XP once; snapshot stays frozen after driver/truck changes', async () => {
  const uid = 'risk-xp';
  const { db, deliveryId, plannedHours } = await completeWithDriver(uid);
  const acceptedDoc = db.dump.get(deliveryPath(uid, deliveryId))!;
  const frozenRisk = { ...(acceptedDoc.deliveryRiskSnapshot as CanonicalRoadDeliveryRiskSnapshot) };
  db.dump.set(driverPath(uid, DRIVER_A), { ...db.dump.get(driverPath(uid, DRIVER_A))!, attention: 1, speed: 99 });
  db.dump.set(`users/${uid}/canonicalFleetAssets/fixture-healthy`, {
    ...db.dump.get(`users/${uid}/canonicalFleetAssets/fixture-healthy`)!,
    reliability: 1,
  });

  const completeAt = NOW + realMsForCanonicalGameHours(plannedHours * 0.5);
  const report = await reportCanonicalRoadDeliveryCompletedTransaction(db, uid, deliveryId, 'COMPLETED', completeAt, null, PROGRESSION);
  assert.equal(report.ok, true, report.ok ? '' : report.reason);
  if (!report.ok || !report.derivedSettlement) return;
  const netProfit = deriveCanonicalRoadProductionNetProfit(report.derivedSettlement);
  const expectedXp = calculateDeliveryXp(Number(acceptedDoc.distanceKm), netProfit, frozenRisk.riskTier);
  const receipt = db.dump.get(completionReceiptPath(uid, deliveryId))!;
  assert.equal(receipt.xpAuthority, 'SERVER_DERIVED');
  assert.equal(receipt.xpDelta, expectedXp);
  assert.ok(expectedXp > 0);
  assert.deepEqual(receipt.xpEvidence, {
    distanceKm: acceptedDoc.distanceKm,
    netProfit,
    riskTier: frozenRisk.riskTier,
    riskBonus: frozenRisk.riskBonus,
    riskPolicyVersion: CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION,
  });
  assert.equal(receipt.reputationDelta, 3);
  const progression = db.dump.get(progressionPath(uid))!;
  assert.equal(progression.totalXp, expectedXp);
  assert.equal(progression.reputation, 53);
  const after = db.dump.get(deliveryPath(uid, deliveryId))!;
  assert.deepEqual(after.deliveryRiskSnapshot, frozenRisk);
  assert.equal(after.driverAssignmentState, 'RELEASED');
  assert.equal(after.driverReleaseReason, 'COMPLETED');
  const driver = db.dump.get(driverPath(uid, DRIVER_A))!;
  assert.equal(driver.assignedCanonicalDeliveryId, null);
  assert.equal(driver.driverRuntimeRevision, 2);

  for (const at of [completeAt + 1_000, completeAt + 2_000]) {
    const again = await reportCanonicalRoadDeliveryCompletedTransaction(db, uid, deliveryId, 'COMPLETED', at, null, PROGRESSION);
    assert.equal(again.ok && again.alreadyReported, true);
  }
  assert.equal(db.dump.get(progressionPath(uid))?.totalXp, expectedXp);
  assert.equal(db.dump.get(driverPath(uid, DRIVER_A))?.driverRuntimeRevision, 2);
  assert.equal(
    [...db.dump.keys()].filter((key) => key.startsWith(`users/${uid}/canonicalProgressionReceipts/`)).length,
    1,
  );
  assert.equal([...db.dump.keys()].some((key) => key.includes('canonicalCashTransactions')), false);

  const wear = await applyCanonicalRoadDeliveryWearTransaction(db, uid, deliveryId, completeAt + 3_000);
  assert.equal(wear.ok, true, wear.ok ? '' : wear.reason);
  if (!wear.ok) return;
  assert.equal(wear.receipt.policyVersion, CANONICAL_ROAD_DELIVERY_WEAR_POLICY_VERSION_V2);
  assert.equal(wear.receipt.wearDriverAttention, DRIVER_POOL.find((row) => row.id === DRIVER_A)!.attention);
  const route = getRoute('istanbul', 'bursa')!;
  const product = PRODUCT_BY_ID.steel;
  const [healthy] = buildInternalCanonicalFleetFixtureAssets(uid, 1);
  const wearFor = (attention: number) =>
    calculateConditionLoss(
      { cargoWeight: 10, amount: 10, distanceKm: acceptedDoc.distanceKm, productId: 'steel' } as never,
      { capacity: healthy!.capacity, upgrades: healthy!.economicUpgradeIds } as never,
      { ...STARTER_DRIVER, attention } as never,
      route,
      product,
    );
  assert.equal(wear.receipt.wearAmount, wearFor(wear.receipt.wearDriverAttention!));
  assert.ok(wearFor(wear.receipt.wearDriverAttention!) >= wearFor(100));
});

test('netProfit and incident authority gaps keep XP blocked with exact classifications', async () => {
  const noEconomy = await completeWithDriver('risk-noeco', { economy: false });
  let report = await reportCanonicalRoadDeliveryCompletedTransaction(
    noEconomy.db, 'risk-noeco', noEconomy.deliveryId, 'COMPLETED',
    NOW + realMsForCanonicalGameHours(noEconomy.plannedHours * 0.5), null, PROGRESSION,
  );
  assert.equal(report.ok, true);
  assert.equal(noEconomy.db.dump.get(completionReceiptPath('risk-noeco', noEconomy.deliveryId))?.xpAuthority, PROGRESSION_XP_BLOCKED_NET_PROFIT_AUTHORITY);
  assert.equal(noEconomy.db.dump.get(progressionPath('risk-noeco'))?.totalXp, 0);
  assert.equal(noEconomy.db.dump.get(progressionPath('risk-noeco'))?.reputation, 53, 'reputation still applies');

  const noEvents = await completeWithDriver('risk-noev', { events: false });
  report = await reportCanonicalRoadDeliveryCompletedTransaction(
    noEvents.db, 'risk-noev', noEvents.deliveryId, 'COMPLETED',
    NOW + realMsForCanonicalGameHours(noEvents.plannedHours * 0.5), null, PROGRESSION,
  );
  assert.equal(report.ok, true);
  assert.equal(noEvents.db.dump.get(completionReceiptPath('risk-noev', noEvents.deliveryId))?.xpAuthority, PROGRESSION_XP_BLOCKED_NET_PROFIT_AUTHORITY);

  const fragile = await completeWithDriver('risk-frag');
  const fragilePath = deliveryPath('risk-frag', fragile.deliveryId);
  const fragileDoc = fragile.db.dump.get(fragilePath)!;
  const economics = fragileDoc.executionEconomicsSnapshot as Record<string, Record<string, unknown>>;
  fragile.db.dump.set(fragilePath, {
    ...fragileDoc,
    incidentConditionAuthority: 'UNRESOLVED',
    executionEconomicsSnapshot: {
      ...economics,
      fragilityPolicySnapshot: { ...economics.fragilityPolicySnapshot, contractType: 'fragile' },
    },
  });
  report = await reportCanonicalRoadDeliveryCompletedTransaction(
    fragile.db, 'risk-frag', fragile.deliveryId, 'COMPLETED',
    NOW + realMsForCanonicalGameHours(fragile.plannedHours * 0.5), null, PROGRESSION,
  );
  assert.equal(report.ok, true);
  assert.equal(fragile.db.dump.get(completionReceiptPath('risk-frag', fragile.deliveryId))?.xpAuthority, PROGRESSION_XP_BLOCKED_INCIDENT_ECONOMICS);

  const unknown = await completeWithDriver('risk-unk');
  const unknownPath = deliveryPath('risk-unk', unknown.deliveryId);
  const unknownDoc = unknown.db.dump.get(unknownPath)!;
  unknown.db.dump.set(unknownPath, {
    ...unknownDoc,
    deliveryRiskSnapshot: { ...(unknownDoc.deliveryRiskSnapshot as object), riskPolicyVersion: 'canonical-road-delivery-risk-tier-v2' },
  });
  report = await reportCanonicalRoadDeliveryCompletedTransaction(
    unknown.db, 'risk-unk', unknown.deliveryId, 'COMPLETED',
    NOW + realMsForCanonicalGameHours(unknown.plannedHours * 0.5), null, PROGRESSION,
  );
  assert.equal(report.ok, true);
  assert.equal(unknown.db.dump.get(completionReceiptPath('risk-unk', unknown.deliveryId))?.xpAuthority, PROGRESSION_XP_BLOCKED_RISK_POLICY_UNKNOWN);

  const db = createMemoryFirestore();
  const uid = 'risk-old';
  await setupWorld(db, uid);
  const old = await accept(db, uid, await issue(db, uid, 1), NOW, {}, {});
  assert.equal(old.ok, true);
  if (!old.ok) return;
  const plannedHours = (db.dump.get(deliveryPath(uid, old.receipt.deliveryId)) as { timingSnapshot: { plannedTravelGameHours: number } }).timingSnapshot.plannedTravelGameHours;
  report = await reportCanonicalRoadDeliveryCompletedTransaction(
    db, uid, old.receipt.deliveryId, 'COMPLETED',
    NOW + realMsForCanonicalGameHours(plannedHours * 0.5), null, PROGRESSION,
  );
  assert.equal(report.ok, true);
  const oldReceipt = db.dump.get(completionReceiptPath(uid, old.receipt.deliveryId))!;
  assert.equal(oldReceipt.xpAuthority, CANONICAL_ROAD_COMPLETION_XP_AUTHORITY);
  assert.equal(oldReceipt.xpDelta, 0);
  assert.equal(db.dump.get(deliveryPath(uid, old.receipt.deliveryId))?.deliveryRiskSnapshot, undefined);
  assert.equal(db.dump.get(driverPath(uid, DRIVER_A))?.driverRuntimeRevision, 0, 'old delivery never touches drivers');
});

test('driver release: cancel, server failure, client FAILED; out-of-fuel keeps the driver', async () => {
  const cancelled = await completeWithDriver('risk-cancel');
  const cancel = await cancelCanonicalRoadDeliveryTransaction(cancelled.db, 'risk-cancel', cancelled.deliveryId, NOW + HOUR_MS, PROGRESSION);
  assert.equal(cancel.ok, true);
  assert.equal(cancelled.db.dump.get(driverPath('risk-cancel', DRIVER_A))?.assignedCanonicalDeliveryId, null);
  assert.equal(cancelled.db.dump.get(driverPath('risk-cancel', DRIVER_A))?.lastReleaseReason, 'CANCELLED');
  assert.equal(cancelled.db.dump.get(progressionPath('risk-cancel'))?.reputation, 44);
  const cancelRetry = await cancelCanonicalRoadDeliveryTransaction(cancelled.db, 'risk-cancel', cancelled.deliveryId, NOW + 2 * HOUR_MS, PROGRESSION);
  assert.equal(cancelRetry.ok && cancelRetry.alreadyCancelled, true);
  assert.equal(cancelled.db.dump.get(driverPath('risk-cancel', DRIVER_A))?.driverRuntimeRevision, 2);

  const late = await completeWithDriver('risk-late');
  const failed = await reportCanonicalRoadDeliveryCompletedTransaction(
    late.db, 'risk-late', late.deliveryId, 'COMPLETED',
    NOW + realMsForCanonicalGameHours(late.deadlineHours * 2.5), null, PROGRESSION,
  );
  assert.equal(failed.ok && failed.lifecycleState, 'FAILED');
  assert.equal(late.db.dump.get(driverPath('risk-late', DRIVER_A))?.lastReleaseReason, 'SERVER_DERIVED_FAILURE');
  assert.equal(late.db.dump.get(driverPath('risk-late', DRIVER_A))?.assignedCanonicalDeliveryId, null);
  assert.equal(late.db.dump.get(progressionPath('risk-late'))?.reputation, 44);

  const client = await completeWithDriver('risk-client');
  const clientFailed = await reportCanonicalRoadDeliveryCompletedTransaction(
    client.db, 'risk-client', client.deliveryId, 'FAILED',
    NOW + realMsForCanonicalGameHours(client.plannedHours * 0.5), null, PROGRESSION,
  );
  assert.equal(clientFailed.ok, true);
  assert.equal(client.db.dump.get(driverPath('risk-client', DRIVER_A))?.lastReleaseReason, 'CLIENT_UNVERIFIED_FAILURE_TERMINAL');
  assert.equal(client.db.dump.get(progressionPath('risk-client'))?.reputation, 50);
  assert.equal(client.db.dump.get(progressionPath('risk-client'))?.totalXp, 0);

  const db = createMemoryFirestore();
  const uid = 'risk-fuel';
  await setupWorld(db, uid);
  const accepted = await accept(db, uid, await issue(db, uid, 1), NOW, { selectedDriverId: DRIVER_A }, {
    ...RISK,
    progressiveEnvValue: 'INTERNAL_TEST',
    timingEnvValue: 'INTERNAL_TEST',
  });
  assert.equal(accepted.ok, true, accepted.ok ? '' : accepted.reason);
  if (!accepted.ok) return;
  const truckPath = `users/${uid}/canonicalFleetAssets/fixture-healthy`;
  db.dump.set(truckPath, { ...db.dump.get(truckPath)!, currentFuelL: 0.5 });
  const stranded = await reportCanonicalRoadDeliveryCompletedTransaction(
    db, uid, accepted.receipt.deliveryId, 'COMPLETED', NOW + 48 * HOUR_MS, null, PROGRESSION,
  );
  assert.equal(!stranded.ok && stranded.reason, 'PROGRESS_INCOMPLETE');
  const fuelState = db.dump.get(deliveryPath(uid, accepted.receipt.deliveryId))?.progressiveFuel as {
    progress: number;
    cumulativeFuelConsumedL: number;
    fuelLitersTotal: number;
  };
  assert.ok(fuelState.progress < 1, 'stalled');
  assert.equal(fuelState.cumulativeFuelConsumedL, 0.5, 'tank exhausted');
  const withoutDriverSaving = deriveCanonicalRoadFuelRequirement({
    truckAsset: buildInternalCanonicalFleetFixtureAssets(uid, 1)[0]!,
    trailerAsset: null,
    originCityId: 'istanbul',
    destinationCityId: 'bursa',
    amount: 10,
    payment: 0,
  });
  assert.ok(withoutDriverSaving.ok && fuelState.fuelLitersTotal < withoutDriverSaving.requiredFuelL, 'fuelSaving applied');
  assert.equal(db.dump.get(driverPath(uid, DRIVER_A))?.assignedCanonicalDeliveryId, accepted.receipt.deliveryId);
  assert.equal(db.dump.get(deliveryPath(uid, accepted.receipt.deliveryId))?.driverAssignmentState, 'ASSIGNED');
});

function seedIssuanceWorld(db: { dump: Dump }, uid: string) {
  db.dump.set(`users/${uid}/canonicalFleetAssets/truck-1`, {
    assetType: 'TRUCK',
    capacity: 25,
    lifecycleStatus: 'ACTIVE',
    ownerUid: uid,
  });
  db.dump.set(`users/${uid}`, { money: 22_000 });
  for (const city of CITIES) {
    for (const productId of PRODUCT_IDS) {
      const product = city.products[productId];
      const quote = deriveCanonicalProductionMarketQuote(100, city.id, productId);
      db.dump.set(`canonicalWorldMarkets/${city.id}_${productId}`, {
        cityId: city.id,
        productId,
        stock: 1,
        tradableStock: 1,
        epochSupply: quote?.epochSupply ?? 0,
        currentPrice: quote?.price ?? product.basePrice,
        targetStock: product.targetStock,
        marketRevision: 1,
        lastAppliedTickIndex: 100,
      });
    }
  }
}

test('end-to-end INTERNAL vector: batch → accept with hired driver → frozen risk → XP → refresh sees progression', async () => {
  const db = createMemoryFirestore();
  const uid = 'risk-e2e';
  const gates = {
    envValue: 'INTERNAL_TEST',
    runtimeEnvValue: 'INTERNAL_TEST',
    eventEnvValue: 'INTERNAL_TEST',
    expiryEnvValue: 'INTERNAL_TEST',
    refreshEnvValue: 'INTERNAL_TEST',
    progressionEnvValue: 'INTERNAL_TEST',
  } as const;
  seedIssuanceWorld(db, uid);
  db.dump.set('globalEconomy/current', { fuelPricePerLiter: 1.72 });
  db.dump.set(serverStateCurrentRef(uid), { cash: 200_000, ownerUid: uid, sourceVersion: 1, migrationSource: 'default' });
  db.dump.set(
    `users/${uid}/canonicalFleetRuntime/truck-1`,
    createInternalFixtureRuntime({ assetId: 'truck-1', ownerUid: uid, serverNowMs: NOW }) as unknown as Record<string, unknown>,
  );
  await bootstrapInternalCanonicalFleetFixturesTransaction(db, uid, 1, GATE);
  for (const assetId of ['fixture-healthy', 'fixture-degraded', 'fixture-upgraded']) {
    db.dump.set(
      `users/${uid}/canonicalFleetRuntime/${assetId}`,
      createInternalFixtureRuntime({ assetId, ownerUid: uid, serverNowMs: NOW }) as unknown as Record<string, unknown>,
    );
  }
  const hire = await hireCanonicalDriverTransaction(db, uid, DRIVER_B, 'hire-e2e01', NOW, GATE);
  assert.equal(hire.ok, true, hire.ok ? '' : hire.reason);
  const cashAfterHire = db.dump.get(serverStateCurrentRef(uid))?.cash;
  const init = await initializeCanonicalCompanyProgressionForNewAccount(db, uid, NOW, GATE);
  assert.equal(init.ok, true, init.ok ? '' : init.reason);

  const batch = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW, gates);
  assert.equal(batch.ok, true, batch.ok ? '' : batch.reason);
  if (!batch.ok) return;
  const offers = [...db.dump.entries()]
    .filter(([key]) => key.startsWith(`users/${uid}/canonicalRoadContracts/rcprod_`))
    .map(([, value]) => value as Record<string, unknown>);
  const offer = offers.find(
    (row) =>
      (row.requiredDriverLevel == null || Number(row.requiredDriverLevel) <= 1) &&
      Number(row.amount) <= 25 &&
      getRoute(String(row.originCityId), String(row.destinationCityId)),
  );
  assert.ok(offer, 'eligible offer');
  if (!offer) return;
  db.dump.set(`users/${uid}/canonicalFleetRuntime/fixture-healthy`, {
    ...(createInternalFixtureRuntime({ assetId: 'fixture-healthy', ownerUid: uid, serverNowMs: NOW }) as unknown as Record<string, unknown>),
    currentCityId: offer.originCityId,
  });

  const accepted = await accept(db, uid, String(offer.contractId), NOW + 1, { selectedDriverId: DRIVER_B }, {
    ...RISK,
    runtimeEnvValue: 'INTERNAL_TEST',
    expiryEnvValue: 'INTERNAL_TEST',
  });
  assert.equal(accepted.ok, true, accepted.ok ? '' : accepted.reason);
  if (!accepted.ok) return;
  const deliveryId = accepted.receipt.deliveryId;
  const doc = db.dump.get(deliveryPath(uid, deliveryId))!;
  const driverSnapshot = doc.canonicalDriverSnapshot as CanonicalRoadDriverSnapshot;
  const risk = doc.deliveryRiskSnapshot as CanonicalRoadDeliveryRiskSnapshot;
  assert.equal(driverSnapshot.authorityClass, 'SERVER_CANONICAL_DRIVER');
  assert.equal(driverSnapshot.statsSource, 'DRIVER_POOL_CATALOG');
  const economics = doc.executionEconomicsSnapshot as Record<string, Record<string, unknown>>;
  assert.equal(economics.fragilityPolicySnapshot.contractType, offer.contractType ?? 'standard');
  assert.equal(
    economics.penaltyMultiplier,
    PRODUCTION_CONTRACT_TYPE_PENALTY_MULTIPLIERS[(offer.contractType ?? 'standard') as 'standard'],
  );

  const plannedHours = (doc.timingSnapshot as { plannedTravelGameHours: number }).plannedTravelGameHours;
  const completeAt = NOW + 1 + realMsForCanonicalGameHours(plannedHours * 0.5);
  const report = await reportCanonicalRoadDeliveryCompletedTransaction(db, uid, deliveryId, 'COMPLETED', completeAt, null, {
    runtimeEnvValue: 'INTERNAL_TEST',
    progressionEnvValue: 'INTERNAL_TEST',
  });
  assert.equal(report.ok, true, report.ok ? '' : report.reason);
  if (!report.ok || !report.derivedSettlement) return;
  const netProfit = deriveCanonicalRoadProductionNetProfit(report.derivedSettlement);
  const receipt = db.dump.get(completionReceiptPath(uid, deliveryId))!;
  const incidentBlocked =
    economics.fragilityPolicySnapshot.contractType === 'fragile' && doc.incidentConditionAuthority === 'UNRESOLVED';
  const expectedXp = incidentBlocked ? 0 : calculateDeliveryXp(Number(doc.distanceKm), netProfit, risk.riskTier);
  assert.equal(receipt.xpAuthority, incidentBlocked ? PROGRESSION_XP_BLOCKED_INCIDENT_ECONOMICS : 'SERVER_DERIVED');
  assert.equal(receipt.xpDelta, expectedXp);
  const progression = db.dump.get(progressionPath(uid))!;
  assert.equal(progression.totalXp, expectedXp);
  assert.equal(progression.reputation, 50 + Number(receipt.reputationDelta));
  assert.equal(db.dump.get(driverPath(uid, DRIVER_B))?.assignedCanonicalDeliveryId, null);
  assert.equal(db.dump.get(serverStateCurrentRef(uid))?.cash, cashAfterHire, 'risk/XP writes no cash');

  const refreshed = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + 3 * HOUR_MS, {
    ...gates,
    refreshIntentId: 'risk-refresh-1',
  });
  assert.equal(refreshed.ok, true, refreshed.ok ? '' : refreshed.reason);
  if (!refreshed.ok) return;
  const refreshedBatch = db.dump.get(`users/${uid}/canonicalRoadContractBatches/${refreshed.batchId}`)!;
  assert.equal(refreshedBatch.playerLevel, progression.level);
  assert.equal(refreshedBatch.playerReputation, progression.reputation);

  const wear = await applyCanonicalRoadDeliveryWearTransaction(db, uid, deliveryId, completeAt + 1);
  assert.equal(wear.ok, true, wear.ok ? '' : wear.reason);
  assert.equal(db.dump.get(`users/${uid}/canonicalFleetRuntime/fixture-healthy`)?.currentCityId, offer.destinationCityId);
  const refreshedOffers = [...db.dump.entries()]
    .filter(([key, value]) => key.startsWith(`users/${uid}/canonicalRoadContracts/rcprod_`) && value.batchId === refreshed.batchId)
    .map(([, value]) => value as Record<string, unknown>);
  const next = refreshedOffers.find(
    (row) => (row.requiredDriverLevel == null || Number(row.requiredDriverLevel) <= 1) && Number(row.amount) <= 25,
  );
  assert.ok(next, 'eligible refreshed offer');
  if (!next) return;
  const nextTruck = 'fixture-upgraded';
  const idleRuntimePath = `users/${uid}/canonicalFleetRuntime/${nextTruck}`;
  assert.equal(db.dump.get(idleRuntimePath)?.runtimeStatus, 'idle');
  db.dump.set(idleRuntimePath, { ...db.dump.get(idleRuntimePath)!, currentCityId: next.originCityId });
  const secondStart = NOW + 3 * HOUR_MS + 1;
  const second = await accept(db, uid, String(next.contractId), secondStart, {
    selectedDriverId: DRIVER_B,
    canonicalTruckAssetId: nextTruck,
  }, {
    ...RISK,
    runtimeEnvValue: 'INTERNAL_TEST',
    expiryEnvValue: 'INTERNAL_TEST',
  });
  assert.equal(second.ok, true, second.ok ? '' : second.reason);
  if (!second.ok) return;
  const secondDoc = db.dump.get(deliveryPath(uid, second.receipt.deliveryId))!;
  const secondHours = (secondDoc.timingSnapshot as { plannedTravelGameHours: number }).plannedTravelGameHours;
  const secondReport = await reportCanonicalRoadDeliveryCompletedTransaction(
    db,
    uid,
    second.receipt.deliveryId,
    'COMPLETED',
    secondStart + realMsForCanonicalGameHours(secondHours * 0.5),
    null,
    { runtimeEnvValue: 'INTERNAL_TEST', progressionEnvValue: 'INTERNAL_TEST' },
  );
  assert.equal(secondReport.ok, true, secondReport.ok ? '' : secondReport.reason);
  const secondReceipt = db.dump.get(completionReceiptPath(uid, second.receipt.deliveryId))!;
  const afterTwo = db.dump.get(progressionPath(uid))!;
  assert.equal(afterTwo.totalXp, Number(progression.totalXp) + Number(secondReceipt.xpDelta));
  assert.equal(secondReceipt.xpAuthority, 'SERVER_DERIVED');
  assert.ok(Number(afterTwo.totalXp) >= 100, 'two trusted deliveries cross level 2');
  assert.equal(afterTwo.level, 2);
  assert.equal(afterTwo.xp, Number(afterTwo.totalXp) - 100);
  assert.equal(afterTwo.xpToNextLevel, 273);
  assert.equal(secondReceipt.levelBefore, 1);
  assert.equal(secondReceipt.levelAfter, 2);
  const refreshed2 = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + 6 * HOUR_MS + 2, {
    ...gates,
    refreshIntentId: 'risk-refresh-2',
  });
  assert.equal(refreshed2.ok, true, refreshed2.ok ? '' : refreshed2.reason);
  if (!refreshed2.ok) return;
  const batch2 = db.dump.get(`users/${uid}/canonicalRoadContractBatches/${refreshed2.batchId}`)!;
  assert.equal(batch2.playerLevel, afterTwo.level);
  assert.equal(batch2.playerReputation, afterTwo.reputation);
  assert.equal(db.dump.get(serverStateCurrentRef(uid))?.cash, cashAfterHire);
});
