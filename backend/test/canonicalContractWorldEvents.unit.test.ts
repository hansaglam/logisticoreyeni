/**
 * Contract world-event authority — in-memory tests (Step 29AB).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { generateCanonicalProductionRoadBatchTransaction } from '../src/canonicalProductionRoadContractIssuance';
import { contractBalance, contractPaymentBalance } from '../../src/config/balance';
import { CITIES } from '../../src/data/cities';
import { PRODUCT_IDS } from '../../src/data/products';
import { WORLD_EVENT_TEMPLATES } from '../../src/data/worldEvents';
import {
  CANONICAL_CONTRACT_EVENT_CATALOG,
  CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION,
  CANONICAL_CONTRACT_WORLD_EVENT_SEED_KEY,
  CANONICAL_ROAD_CONTRACT_EVENTS_DOC,
  CONTRACT_EVENT_CLOCK,
  CONTRACT_EVENT_OWNERSHIP,
  CONTRACT_EVENT_RNG_PARITY,
  CONTRACT_EVENT_STACKING,
  activeContractEventSnapshot,
  contractEventAdjustmentForOffer,
  isCanonicalContractWorldEventAllowed,
  planCanonicalContractEventAdvance,
  validateCanonicalContractEvents,
} from '../../src/domain/canonicalContractWorldEvents';
import {
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2,
  generateCanonicalProductionRoadOffers,
  type CanonicalTradableMarketRow,
} from '../../src/domain/canonicalProductionRoadContractIssuance';
import { deriveCanonicalProductionMarketQuote } from '../../src/domain/canonicalProductionMarketTick';
import { buildGlobalEventsForEpoch } from '../../src/simulation/globalMarketSnapshot';
import { applyWorldEventImpactToContract, isWorldEventActiveAt } from '../../src/simulation/worldEvents';
import type { Contract, ProductId, WorldEvent } from '../../src/types/game';

function createMemoryFirestore(): Firestore & { dump: Map<string, Record<string, unknown>> } {
  const dump = new Map<string, Record<string, unknown>>();
  const firestore = {
    dump,
    doc(path: string) {
      return { path, _col: false as const };
    },
    collection(path: string) {
      return { path, _col: true as const };
    },
    async runTransaction<T>(operation: (transaction: {
      get: (ref: { path: string; _col?: boolean }) => Promise<{
        exists: boolean;
        data: () => Record<string, unknown> | undefined;
        docs: Array<{ data: () => Record<string, unknown> | undefined }>;
      }>;
      create: (ref: { path: string }, data: Record<string, unknown>) => void;
      update: (ref: { path: string }, data: Record<string, unknown>) => void;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<T>) {
      return operation({
        async get(ref) {
          if (ref._col) {
            const prefix = `${ref.path.replace(/\/$/, '')}/`;
            const docs = [...dump.entries()]
              .filter(([key]) => {
                if (!key.startsWith(prefix)) return false;
                const rest = key.slice(prefix.length);
                return rest.length > 0 && !rest.includes('/');
              })
              .map(([, data]) => ({ data: () => data }));
            return { exists: docs.length > 0, data: () => undefined, docs };
          }
          const data = dump.get(ref.path);
          return { exists: Boolean(data), data: () => data, docs: [] };
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
        set(ref, data) {
          dump.set(ref.path, { ...data });
        },
      });
    },
  };
  return firestore as unknown as Firestore & { dump: Map<string, Record<string, unknown>> };
}

const DAY = 86_400_000;
const NOW = 4 * DAY + 3_600_000;
const GATE = { envValue: 'INTERNAL_TEST' as const, eventEnvValue: 'INTERNAL_TEST' as const };

function catalogRows(): CanonicalTradableMarketRow[] {
  const rows: CanonicalTradableMarketRow[] = [];
  for (const city of CITIES) {
    for (const productId of PRODUCT_IDS) {
      const product = city.products[productId];
      const quote = deriveCanonicalProductionMarketQuote(100, city.id, productId);
      rows.push({
        cityId: city.id,
        productId,
        tradableStock: 1,
        epochSupply: quote?.epochSupply ?? 0,
        currentPrice: quote?.price ?? product.basePrice,
        targetStock: product.targetStock,
        marketRevision: 1,
        lastAppliedTickIndex: 100,
      });
    }
  }
  return rows;
}

function event(overrides: Partial<WorldEvent> & Pick<WorldEvent, 'id' | 'type'>): WorldEvent {
  return {
    title: 't',
    description: 'd',
    startsAtDay: 1,
    endsAtDay: 3,
    durationDays: 2,
    startsAt: 0,
    endsAt: 10 * DAY,
    impact: {},
    severity: 'medium',
    isActive: true,
    ...overrides,
  };
}

function snapshotFor(events: WorldEvent[]) {
  return {
    policyVersion: CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION,
    snapshotId: 'cwe_test',
    dayIndex: 4,
    seedKey: CANONICAL_CONTRACT_WORLD_EVENT_SEED_KEY,
    activeEvents: events,
  };
}

function offerInput(events?: WorldEvent[]) {
  return {
    uid: 'uid-a',
    serverNowMs: NOW,
    playerLevel: 1,
    playerReputation: 0,
    ownedMaxTruckCapacity: 25,
    marketRows: catalogRows(),
    fuelPricePerLiter:
      deriveCanonicalProductionMarketQuote(100, 'izmir', 'steel')?.fuelPricePerLiter ?? 1.72,
    contractEventSnapshot: events ? snapshotFor(events) : undefined,
  };
}

function seedAccount(db: ReturnType<typeof createMemoryFirestore>, uid = 'uid-a') {
  db.dump.set(`users/${uid}/canonicalCompanyProgression/current`, {
    level: 1,
    reputation: 0,
    ownerUid: uid,
  });
  db.dump.set(`users/${uid}/canonicalFleetAssets/truck-1`, {
    assetType: 'TRUCK',
    capacity: 25,
    lifecycleStatus: 'ACTIVE',
    ownerUid: uid,
  });
  db.dump.set(`users/${uid}`, { money: 22_000 });
  for (const row of catalogRows()) {
    db.dump.set(`canonicalWorldMarkets/${row.cityId}_${row.productId}`, {
      cityId: row.cityId,
      productId: row.productId,
      stock: row.tradableStock,
      epochSupply: row.epochSupply,
      currentPrice: row.currentPrice,
      marketRevision: row.marketRevision,
      lastAppliedTickIndex: row.lastAppliedTickIndex,
    });
  }
}

test('catalog, clock, ownership, and gate stay explicit', () => {
  assert.equal(isCanonicalContractWorldEventAllowed({ envValue: null }), false);
  assert.equal(isCanonicalContractWorldEventAllowed({ envValue: 'INTERNAL_TEST' }), true);
  assert.equal(CANONICAL_CONTRACT_EVENT_CATALOG.length, WORLD_EVENT_TEMPLATES.length);
  assert.equal(CANONICAL_CONTRACT_EVENT_CATALOG.length, 10);
  assert.equal(CONTRACT_EVENT_OWNERSHIP, 'GLOBAL_CONTRACT_EVENT');
  assert.equal(CONTRACT_EVENT_CLOCK, 'CONTRACT_EVENT_CLOCK_INTERNAL_REAL_DAY');
  assert.equal(CONTRACT_EVENT_STACKING, 'MULTIPLY_THEN_CLAMP_1_TO_1_25');
  assert.equal(
    CONTRACT_EVENT_RNG_PARITY,
    'PRODUCTION_CONTRACT_EVENT_RNG_SERVER_CANONICAL_DIFFERENT_SEQUENCE',
  );
  assert.equal(
    CANONICAL_CONTRACT_EVENT_CATALOG.some((row) => row.eventId === 'port_congestion' && row.paymentMultiplier),
    true,
  );
  assert.equal(
    CANONICAL_CONTRACT_EVENT_CATALOG.some((row) => row.eventId === 'road_work' && row.durationMultiplier),
    true,
  );
  const epochEvents = buildGlobalEventsForEpoch(100);
  assert.equal(
    epochEvents.every((row) => row.impact.contractPaymentMultiplier == null),
    true,
  );
});

test('schedule is global, deterministic, and does not reroll inside a day', () => {
  const first = planCanonicalContractEventAdvance(null, NOW);
  const secondUser = planCanonicalContractEventAdvance(null, NOW);
  assert.equal(first.ok, true);
  assert.equal(secondUser.ok, true);
  if (!first.ok || !secondUser.ok) return;
  assert.equal(first.advanced, true);
  assert.deepEqual(first.state.activeEventIds, secondUser.state.activeEventIds);
  assert.equal(first.state.activeEventIds.length <= 4, true);
  const restarted = planCanonicalContractEventAdvance(first.state, NOW + 60_000);
  assert.equal(restarted.ok, true);
  if (!restarted.ok) return;
  assert.equal(restarted.advanced, false);
  assert.deepEqual(restarted.state.events, first.state.events);
  const nextDay = planCanonicalContractEventAdvance(first.state, NOW + DAY);
  assert.equal(nextDay.ok, true);
  if (!nextDay.ok) return;
  assert.equal(nextDay.advanced, true);
  assert.equal(nextDay.state.dayIndex, first.state.dayIndex + 1);
});

test('unknown and malformed event state fails closed', () => {
  const unknown = validateCanonicalContractEvents([
    event({ id: 'bad', type: 'not_a_real_event' as WorldEvent['type'] }),
  ]);
  assert.equal(unknown.ok, false);
  const malformed = validateCanonicalContractEvents([
    event({
      id: 'bad-mult',
      type: 'port_congestion',
      impact: { contractPaymentMultiplier: Number.NaN },
    }),
  ]);
  assert.equal(malformed.ok, false);
  const badDuration = validateCanonicalContractEvents([
    event({
      id: 'bad-duration',
      type: 'road_work',
      impact: { deliveryDurationMultiplier: 0 },
    }),
  ]);
  assert.equal(badDuration.ok, false);
  const backwards = planCanonicalContractEventAdvance(
    {
      policyVersion: CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION,
      seedKey: CANONICAL_CONTRACT_WORLD_EVENT_SEED_KEY,
      dayIndex: 99,
      lastGeneratedDay: 99,
      events: [],
    },
    NOW,
  );
  assert.equal(backwards.ok, false);
  const generated = generateCanonicalProductionRoadOffers(
    offerInput([event({ id: 'bad', type: 'mystery' as WorldEvent['type'] })]),
  );
  assert.equal(generated.ok, false);
});

test('payment, duration, scope, stacking, and boundaries match production', () => {
  const base = generateCanonicalProductionRoadOffers(offerInput());
  const port = event({
    id: 'port',
    type: 'port_congestion',
    cityId: 'izmir',
    impact: { contractPaymentMultiplier: 1.1, deliveryDurationMultiplier: 1.1 },
  });
  const withPort = generateCanonicalProductionRoadOffers(offerInput([port]));
  assert.equal(base.ok, true);
  assert.equal(withPort.ok, true);
  if (!base.ok || !withPort.ok) return;
  assert.equal(base.offers[0]?.policyVersion, CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION);
  assert.equal(withPort.offers[0]?.policyVersion, CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2);
  assert.equal(base.seed, withPort.seed);
  assert.equal(base.offers.length, withPort.offers.length);
  let matched = 0;
  for (let index = 0; index < base.offers.length; index += 1) {
    const plain = base.offers[index]!;
    const adjusted = withPort.offers[index]!;
    const cityMatch =
      plain.originCityId === 'izmir' ||
      plain.destinationCityId === 'izmir';
    assert.equal(adjusted.originCityId, plain.originCityId);
    assert.equal(adjusted.productId, plain.productId);
    if (cityMatch) {
      matched += 1;
      assert.equal(adjusted.paymentEventMultiplier, 1.1);
      assert.equal(adjusted.durationEventMultiplier, 1.1);
      assert.equal(
        adjusted.payment,
        Math.min(contractPaymentBalance.absolutePaymentMax, Math.round(plain.payment * 1.1)),
      );
      assert.equal(
        adjusted.deadlineHours,
        Math.min(
          contractBalance.maxDeadlineHours,
          Math.max(contractBalance.minDeadlineHours, plain.deadlineHours * 1.1),
        ),
      );
      assert.deepEqual(adjusted.contractEventIds, ['port']);
    } else {
      assert.equal(adjusted.payment, plain.payment);
      assert.equal(adjusted.deadlineHours, plain.deadlineHours);
      assert.equal(adjusted.paymentEventMultiplier, 1);
    }
  }
  assert.ok(matched > 0);

  const fruit = event({
    id: 'cold',
    type: 'cold_chain_demand',
    productId: 'fruit',
    impact: { contractPaymentMultiplier: 1.2 },
  });
  const fruitHit = contractEventAdjustmentForOffer(
    { originCityId: 'ankara', destinationCityId: 'bursa', productId: 'fruit' },
    [fruit],
  );
  const steelMiss = contractEventAdjustmentForOffer(
    { originCityId: 'ankara', destinationCityId: 'bursa', productId: 'steel' },
    [fruit],
  );
  assert.equal(fruitHit.paymentMultiplier, 1.2);
  assert.equal(steelMiss.paymentMultiplier, 1);

  const stacked = applyWorldEventImpactToContract(
    { originCityId: 'izmir', destinationCityId: 'ankara', productId: 'steel' } as Contract,
    [
      event({ id: 'a', type: 'port_congestion', impact: { contractPaymentMultiplier: 1.2 } }),
      event({ id: 'b', type: 'cold_chain_demand', impact: { contractPaymentMultiplier: 1.2 } }),
    ],
    1000,
    10,
  );
  assert.equal(stacked.paymentMultiplier, 1.25);
  assert.equal(Math.min(contractPaymentBalance.absolutePaymentMax, Math.round(1000 * 1.25)), 1250);

  const road = event({
    id: 'road',
    type: 'road_work',
    cityId: 'izmir',
    impact: { deliveryDurationMultiplier: 1.2 },
  });
  const durationOnly = contractEventAdjustmentForOffer(
    { originCityId: 'antalya', destinationCityId: 'izmir', productId: 'beverage' },
    [road],
  );
  assert.equal(durationOnly.paymentMultiplier, 1);
  assert.equal(durationOnly.durationMultiplier, 1.2);

  const boundary = event({
    id: 'edge',
    type: 'road_work',
    startsAt: 1_000,
    endsAt: 2_000,
    durationDays: 1,
  });
  assert.equal(isWorldEventActiveAt(boundary, 999), false);
  assert.equal(isWorldEventActiveAt(boundary, 1_000), true);
  assert.equal(isWorldEventActiveAt(boundary, 1_500), true);
  assert.equal(isWorldEventActiveAt(boundary, 2_000), true);
  assert.equal(isWorldEventActiveAt(boundary, 2_001), false);
});

test('batch freezes the event snapshot across retry and later event changes', async () => {
  const db = createMemoryFirestore();
  seedAccount(db);
  const cashBefore = db.dump.get('users/uid-a')!.money;
  await assert.rejects(
    () => generateCanonicalProductionRoadBatchTransaction(db, 'uid-a', NOW, { ...GATE, failAfterOffers: 1 }),
    /TEST_PARTIAL_ROAD_ISSUANCE/,
  );
  const batchKey = [...db.dump.keys()].find((key) => key.includes('canonicalRoadContractBatches'));
  assert.ok(batchKey);
  const partialBatch = db.dump.get(batchKey!)!;
  assert.equal(partialBatch.status, 'PARTIAL');
  const snapshot = partialBatch.contractEventSnapshot;
  assert.ok(snapshot);
  const firstOfferKey = [...db.dump.keys()].find((key) => key.includes('canonicalRoadContracts/'));
  assert.ok(firstOfferKey);
  const firstPayment = db.dump.get(firstOfferKey!)!.payment;
  const firstDeadline = db.dump.get(firstOfferKey!)!.deadlineHours;
  seedAccount(db, 'uid-b');
  const otherUser = await generateCanonicalProductionRoadBatchTransaction(db, 'uid-b', NOW, GATE);
  assert.equal(otherUser.ok, true);
  const otherBatch = [...db.dump.entries()].find(
    ([key, value]) => key.includes('uid-b') && key.includes('canonicalRoadContractBatches') && value.status === 'COMPLETE',
  );
  assert.ok(otherBatch);
  assert.deepEqual(otherBatch![1].contractEventIds, partialBatch.contractEventIds);
  db.dump.set(CANONICAL_ROAD_CONTRACT_EVENTS_DOC, {
    ...(db.dump.get(CANONICAL_ROAD_CONTRACT_EVENTS_DOC) ?? {}),
    events: [
      event({
        id: 'replaced',
        type: 'port_congestion',
        impact: { contractPaymentMultiplier: 1.25, deliveryDurationMultiplier: 1.25 },
      }),
    ],
    dayIndex: 1,
  });
  const resumed = await generateCanonicalProductionRoadBatchTransaction(db, 'uid-a', NOW, GATE);
  assert.equal(resumed.ok, true);
  if (resumed.ok) {
    assert.equal(
      resumed.policyVersion,
      CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2,
    );
  }
  assert.equal(db.dump.get(firstOfferKey!)!.payment, firstPayment);
  assert.equal(db.dump.get(firstOfferKey!)!.deadlineHours, firstDeadline);
  const expected = generateCanonicalProductionRoadOffers({
    ...offerInput(),
    contractEventSnapshot: snapshot as ReturnType<typeof snapshotFor>,
  });
  assert.equal(expected.ok, true);
  if (!expected.ok) return;
  for (const offer of expected.offers) {
    const stored = db.dump.get(`users/uid-a/canonicalRoadContracts/${offer.contractId}`);
    assert.ok(stored);
    assert.equal(stored!.payment, offer.payment);
    assert.equal(stored!.deadlineHours, offer.deadlineHours);
    assert.equal(stored!.paymentEventMultiplier, offer.paymentEventMultiplier);
    assert.equal(stored!.durationEventMultiplier, offer.durationEventMultiplier);
  }
  assert.equal(db.dump.get('users/uid-a')!.money, cashBefore);
  assert.equal([...db.dump.keys()].some((key) => key.includes('canonicalCashTransactions')), false);
  const again = await generateCanonicalProductionRoadBatchTransaction(db, 'uid-a', NOW, GATE);
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.alreadyApplied, true);
});

test('v1 offers stay multiplier 1 when the event gate is off', () => {
  const legacy = generateCanonicalProductionRoadOffers(offerInput());
  assert.equal(legacy.ok, true);
  if (!legacy.ok) return;
  assert.equal(legacy.offers[0]?.contractEventMultiplier, 1);
  assert.equal(legacy.offers[0]?.paymentEventMultiplier, 1);
  assert.equal(legacy.offers[0]?.contractEventPolicyVersion, null);
  assert.equal(legacy.contractEventSnapshot, null);
  const planned = planCanonicalContractEventAdvance(null, NOW);
  assert.equal(planned.ok, true);
  if (!planned.ok) return;
  const active = activeContractEventSnapshot(planned.state);
  assert.equal(active.policyVersion, CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION);
});
