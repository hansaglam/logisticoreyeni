/**
 * Canonical non-delivery company XP authority — in-memory tests (Step 29AH).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';

import { purchaseCanonicalCatalogAssetTransaction } from '../src/canonicalCatalogPurchase';
import { hireCanonicalDriverTransaction } from '../src/canonicalCoreVehicleStaffCash';
import { openCanonicalWarehouseTransaction, upgradeCanonicalWarehouseTransaction } from '../src/canonicalWarehouse';
import { buyCanonicalCargoTransaction, sellCanonicalCargoTransaction } from '../src/canonicalCargoMarket';
import { serverStateCurrentRef } from '../src/canonicalCashTransaction';
import { initializeCanonicalCompanyProgressionForNewAccount } from '../src/canonicalCompanyProgression';
import { generateCanonicalProductionRoadBatchTransaction } from '../src/canonicalProductionRoadContractIssuance';
import { CITIES } from '../../src/data/cities';
import { PRODUCT_IDS } from '../../src/data/products';
import { calculateXpToNextLevel, levelConfig } from '../../src/config/levelConfig';
import { levelBalance } from '../../src/config/balance';
import { applyXpToPlayer, calculateTradeSaleXp } from '../../src/simulation/leveling';
import { calculateTradeProfit } from '../../src/simulation/trading';
import { tradingBalance } from '../../src/config/balance';
import {
  CANONICAL_PROGRESSION_READINESS,
  CANONICAL_PROGRESSION_REMAINING_CLIENT_XP_SOURCES,
  applyCanonicalCompanyXp,
  canonicalCompanyProgressionPath,
  canonicalProgressionReceiptPath,
  createInitialCanonicalCompanyProgression,
  planCanonicalProgressionMutation,
  type CanonicalCompanyProgressionState,
} from '../../src/domain/canonicalCompanyProgression';
import {
  CANONICAL_CARGO_COST_BASIS_POLICY_VERSION,
  CANONICAL_NON_DELIVERY_ALL_SOURCES_XP_READINESS,
  CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY_STATUS,
  CANONICAL_NON_DELIVERY_OPERATION_XP_READINESS,
  CANONICAL_NON_DELIVERY_XP_AUTHORITY_ENV,
  CANONICAL_NON_DELIVERY_XP_FORBIDDEN_CLIENT_KEYS,
  CANONICAL_NON_DELIVERY_XP_POLICY_VERSION,
  CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY,
  CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY,
  CURRENT_NON_DELIVERY_XP_READINESS_FACTS,
  NON_DELIVERY_XP_HISTORICAL_OPERATION_UNAPPLIED,
  NON_DELIVERY_XP_POLICY_UNKNOWN,
  NON_DELIVERY_XP_PROGRESSION_RECEIPT_CONFLICT,
  OPERATION_CHOICE_XP_CLIENT_OWNED,
  PRODUCTION_NON_DELIVERY_XP_AUDIT,
  VEHICLE_RECOVERY_XP_BLOCKED_RECOVERY_AUTHORITY,
  classifyCanonicalNonDeliveryXpReadiness,
  containsForbiddenNonDeliveryXpClientKeys,
  deriveCanonicalCargoSaleXp,
  deriveCanonicalFixedNonDeliveryXp,
  isCanonicalNonDeliveryXpAllowed,
  planCanonicalCargoCostBasisAfterBuy,
  progressionCargoSaleOperationId,
  progressionDriverHireOperationId,
  progressionTruckPurchaseOperationId,
  progressionWarehouseOpenOperationId,
  progressionWarehouseUpgradeOperationId,
  readCanonicalCargoCostBasis,
  resolveCanonicalCargoSaleQuality,
} from '../../src/domain/canonicalNonDeliveryCompanyXp';
import { hasOnlyCanonicalCatalogPurchaseKeys } from '../../src/domain/remainingRoadCashPathCanonicalization';
import { hasOnlyCanonicalDriverHireKeys } from '../../src/domain/canonicalCoreVehicleStaffCash';
import {
  createCanonicalWarehouseId,
  hasOnlyCanonicalWarehouseOpenKeys,
  hasOnlyCanonicalWarehouseUpgradeKeys,
} from '../../src/domain/canonicalWarehouseState';
import {
  hasOnlyCanonicalCargoBuyKeys,
  hasOnlyCanonicalCargoSellKeys,
} from '../../src/domain/canonicalCargoMarketWorldState';
import { PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS } from '../../src/domain/canonicalProductionRoadContractIssuance';
import { deriveCanonicalProductionMarketQuote } from '../../src/domain/canonicalProductionMarketTick';
import { createInternalFixtureRuntime } from '../../src/domain/canonicalFleetRuntimeLocation';
import type { Player } from '../../src/types/game';

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
const OP = { envValue: 'INTERNAL_TEST' } as const;
const XP = { nonDeliveryXpEnvValue: 'INTERNAL_TEST', progressionEnvValue: 'INTERNAL_TEST' } as const;
const ON = { ...OP, ...XP } as const;
const XP_OFF = { ...OP, nonDeliveryXpEnvValue: null, progressionEnvValue: 'INTERNAL_TEST' } as const;
const PROGRESSION_OFF = { ...OP, nonDeliveryXpEnvValue: 'INTERNAL_TEST', progressionEnvValue: null } as const;
const TRUCK_ID = 'truck-ford-cargo';
const TRAILER_ID = 'trailer-standard';
const DRIVER_A = 'driver-can-t';
const DRIVER_B = 'driver-ayse-d';
const STEEL_WH = createCanonicalWarehouseId('izmir', 'standard');

function seedAccount(db: { dump: Dump }, uid: string, cash = 5_000_000) {
  db.dump.set(serverStateCurrentRef(uid), { cash, ownerUid: uid, sourceVersion: 1, migrationSource: 'default' });
  db.dump.set(`users/${uid}`, { money: 22_000 });
}

async function initProgression(db: Firestore & { dump: Dump }, uid: string) {
  const init = await initializeCanonicalCompanyProgressionForNewAccount(db, uid, NOW, OP);
  assert.equal(init.ok, true, init.ok ? '' : init.reason);
}

function seedMarket(db: { dump: Dump }, cityId: string, productId: string, currentPrice: number, stock = 10_000) {
  db.dump.set(`canonicalWorldMarkets/${cityId}_${productId}`, {
    cityId,
    productId,
    stock,
    currentPrice,
    basePrice: currentPrice,
    marketRevision: 1,
    authorityMode: 'INTERNAL_TEST_FIXTURE',
    lastUpdatedAtMs: NOW,
  });
}

function setPrice(db: { dump: Dump }, cityId: string, productId: string, currentPrice: number) {
  const path = `canonicalWorldMarkets/${cityId}_${productId}`;
  db.dump.set(path, { ...db.dump.get(path)!, currentPrice });
}

function progression(db: { dump: Dump }, uid: string) {
  return db.dump.get(canonicalCompanyProgressionPath(uid)) as unknown as CanonicalCompanyProgressionState;
}

function progressionReceipt(db: { dump: Dump }, uid: string, operationId: string) {
  return db.dump.get(canonicalProgressionReceiptPath(uid, operationId));
}

function progressionReceiptCount(db: { dump: Dump }, uid: string) {
  return [...db.dump.keys()].filter((key) => key.startsWith(`users/${uid}/canonicalProgressionReceipts/`)).length;
}

function cashTransactionIds(db: { dump: Dump }, uid: string) {
  return [...db.dump.keys()]
    .filter((key) => key.startsWith(`users/${uid}/canonicalCashTransactions/`))
    .map((key) => key.slice(`users/${uid}/canonicalCashTransactions/`.length));
}

function cash(db: { dump: Dump }, uid: string) {
  return Number(db.dump.get(serverStateCurrentRef(uid))?.cash);
}

function tradeXp(sell: number, avg: number, qty: number) {
  return calculateTradeSaleXp(calculateTradeProfit(sell, avg, qty, 100));
}

async function openSteelWarehouse(db: Firestore & { dump: Dump }, uid: string, options: Record<string, unknown> = ON) {
  const opened = await openCanonicalWarehouseTransaction(db, uid, 'izmir', 'standard', `open-${uid}-1`, NOW, options);
  assert.equal(opened.ok, true, opened.ok ? '' : opened.reason);
  return opened;
}

test('gate, policy, statuses, forbidden client keys, allow-lists', () => {
  assert.equal(CANONICAL_NON_DELIVERY_XP_AUTHORITY_ENV, 'CANONICAL_NON_DELIVERY_XP_AUTHORITY');
  assert.equal(isCanonicalNonDeliveryXpAllowed({ envValue: undefined }), false);
  assert.equal(isCanonicalNonDeliveryXpAllowed({ envValue: null }), false);
  assert.equal(isCanonicalNonDeliveryXpAllowed({ envValue: 'ON' }), false);
  assert.equal(isCanonicalNonDeliveryXpAllowed({ envValue: 'INTERNAL_TEST' }), true);
  assert.equal(isCanonicalNonDeliveryXpAllowed(), process.env.CANONICAL_NON_DELIVERY_XP_AUTHORITY === 'INTERNAL_TEST');
  assert.equal(CANONICAL_NON_DELIVERY_XP_POLICY_VERSION, 'canonical-company-non-delivery-xp-v1');
  assert.equal(CANONICAL_CARGO_COST_BASIS_POLICY_VERSION, 'canonical-cargo-cost-basis-v1');
  assert.equal(
    CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY_STATUS,
    'CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY_PASS_PARTIAL',
  );
  assert.equal(CANONICAL_PROGRESSION_READINESS, 'CANONICAL_PROGRESSION_BLOCKED_UNSUPPORTED_REWARD_PROGRESS');
  for (const done of ['truck-purchase', 'driver-hire', 'warehouse-open', 'warehouse-upgrade', 'trade-sale']) {
    assert.equal((CANONICAL_PROGRESSION_REMAINING_CLIENT_XP_SOURCES as readonly string[]).includes(done), false, done);
  }
  for (const left of ['trade-sale-quality-decay', 'missions-unsupported-progress', 'operation-choices']) {
    assert.ok((CANONICAL_PROGRESSION_REMAINING_CLIENT_XP_SOURCES as readonly string[]).includes(left), left);
  }
  assert.ok(PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('COMPANY_XP_CLIENT_REWARD_SOURCES_INTERNAL_PARTIAL'));
  assert.ok(PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('COMPANY_XP_NON_DELIVERY_OPERATIONS_INTERNAL_CANONICAL_ONLY'));
  assert.equal(
    (PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS as readonly string[]).includes('COMPANY_XP_NON_DELIVERY_SOURCES_CLIENT_OWNED'),
    false,
  );
  const required = [
    'xp', 'xpDelta', 'experience', 'xpReward', 'tradeXp', 'purchaseXp', 'hireXp', 'warehouseXp',
    'profit', 'netProfit', 'costBasis', 'level', 'newLevel', 'totalXp',
  ];
  const bases: Array<[string, (record: Record<string, unknown>) => boolean, Record<string, unknown>]> = [
    ['purchase', hasOnlyCanonicalCatalogPurchaseKeys, { catalogModelId: TRUCK_ID, purchaseId: 'p-aaaa0001', assetType: 'TRUCK', canonicalSchemaVersion: 1 }],
    ['hire', hasOnlyCanonicalDriverHireKeys, { poolId: DRIVER_A, hireIntentId: 'h-aaaa0001', canonicalSchemaVersion: 1 }],
    ['open', hasOnlyCanonicalWarehouseOpenKeys, { cityId: 'izmir', warehouseType: 'standard', openIntentId: 'o-aaaa0001', canonicalSchemaVersion: 1 }],
    ['upgrade', hasOnlyCanonicalWarehouseUpgradeKeys, { warehouseId: STEEL_WH, upgradeIntentId: 'u-aaaa0001', canonicalSchemaVersion: 1 }],
    ['buy', hasOnlyCanonicalCargoBuyKeys, { cityId: 'izmir', productId: 'steel', quantity: 5, warehouseId: STEEL_WH, purchaseIntentId: 'b-aaaa0001', canonicalSchemaVersion: 1 }],
    ['sell', hasOnlyCanonicalCargoSellKeys, { cityId: 'izmir', productId: 'steel', quantity: 5, warehouseId: STEEL_WH, saleIntentId: 's-aaaa0001', canonicalSchemaVersion: 1 }],
  ];
  for (const [name, allow, base] of bases) {
    assert.equal(allow(base), true, `${name} base allowed`);
    assert.equal(containsForbiddenNonDeliveryXpClientKeys(base), false, `${name} base clean`);
    for (const key of required) {
      assert.ok((CANONICAL_NON_DELIVERY_XP_FORBIDDEN_CLIENT_KEYS as readonly string[]).includes(key), key);
      assert.equal(allow({ ...base, [key]: 1 }), false, `${name} rejects ${key}`);
      assert.equal(containsForbiddenNonDeliveryXpClientKeys({ ...base, [key]: 1 }), true, `${name} forbidden ${key}`);
    }
  }
});

test('audit table: every source classified with exact columns and production fixed rewards', () => {
  const sources = PRODUCTION_NON_DELIVERY_XP_AUDIT.map((row) => row.source);
  for (const source of [
    'truck-purchase', 'trailer-purchase', 'vehicle-lease', 'marketplace-purchase', 'vehicle-sale',
    'driver-hire', 'driver-fire', 'warehouse-open', 'warehouse-upgrade', 'cargo-buy', 'cargo-sale',
    'vehicle-recovery', 'missions', 'milestones', 'weekly-objectives', 'server-weekly-missions',
    'season-challenge-achievement', 'operation-choice', 'delivery-completion',
  ]) {
    assert.ok(sources.includes(source), source);
  }
  assert.equal(new Set(sources).size, sources.length);
  for (const row of PRODUCTION_NON_DELIVERY_XP_AUDIT) {
    for (const value of Object.values(row)) {
      assert.equal(String(value).includes('UNKNOWN'), false, `${row.source} has no UNKNOWN`);
    }
    assert.ok(row.productionFunction && row.trigger && row.xpFormula && row.status, row.source);
  }
  const status = (source: string) => PRODUCTION_NON_DELIVERY_XP_AUDIT.find((row) => row.source === source)!.status;
  assert.equal(status('vehicle-recovery'), VEHICLE_RECOVERY_XP_BLOCKED_RECOVERY_AUTHORITY);
  assert.equal(status('operation-choice'), OPERATION_CHOICE_XP_CLIENT_OWNED);
  assert.equal(status('marketplace-purchase'), 'MARKETPLACE_PURCHASE_NO_PRODUCTION_XP');
  assert.equal(status('vehicle-lease'), 'VEHICLE_LEASE_NO_PRODUCTION_XP');
  assert.equal(status('cargo-sale'), 'CARGO_SALE_XP_CANONICAL_INTERNAL_ZERO_DECAY_ONLY');
  assert.deepEqual(
    {
      truck: deriveCanonicalFixedNonDeliveryXp('COMPANY_TRUCK_PURCHASE').xp,
      hire: deriveCanonicalFixedNonDeliveryXp('COMPANY_DRIVER_HIRE').xp,
      open: deriveCanonicalFixedNonDeliveryXp('COMPANY_WAREHOUSE_OPEN').xp,
      upgrade: deriveCanonicalFixedNonDeliveryXp('COMPANY_WAREHOUSE_UPGRADE').xp,
    },
    { truck: 30, hire: 10, open: 40, upgrade: 25 },
  );
  assert.deepEqual(levelBalance.xpRewards, levelConfig.xpRewards);
  assert.deepEqual(levelConfig.tradeXp, { base: 10, profitDivisor: 1500, min: 10, max: 100, lossSale: 2 });
});

test('operation identities are deterministic', () => {
  assert.equal(progressionTruckPurchaseOperationId('p1'), 'progression:truck-purchase:p1');
  assert.equal(progressionDriverHireOperationId('h1'), 'progression:driver-hire:h1');
  assert.equal(progressionWarehouseOpenOperationId('wh_izmir_standard'), 'progression:warehouse-open:wh_izmir_standard');
  assert.equal(
    progressionWarehouseUpgradeOperationId('wh_izmir_standard', 1, 2),
    'progression:warehouse-upgrade:wh_izmir_standard:1:2',
  );
  assert.equal(progressionCargoSaleOperationId('s1'), 'progression:cargo-sale:s1');
});

test('cargo golden vectors: loss, break-even, small, medium and large profit match production', () => {
  const basis = (avg: number) => ({
    trusted: true as const,
    averageBuyPrice: avg,
    costBasisPolicyVersion: CANONICAL_CARGO_COST_BASIS_POLICY_VERSION,
  });
  const sell = (price: number, avg: number, qty: number) =>
    deriveCanonicalCargoSaleXp({ productId: 'steel', warehouseType: 'standard', quantity: qty, sellUnitPrice: price, costBasis: basis(avg) });
  const loss = sell(2000, 2000, 10);
  assert.equal(loss.ok && loss.profit < 0, true);
  assert.equal(loss.xp, 2);
  const breakEvenAvg = (2000 * (1 - tradingBalance.warehouseSellFeeRate)) / (1 + tradingBalance.warehouseBuyFeeRate);
  const even = sell(2000, breakEvenAvg, 10);
  assert.ok(even.ok && Math.abs(even.profit) < 1e-6);
  assert.equal(even.xp, 2);
  const small = sell(2150, 2000, 10);
  assert.ok(small.ok && small.profit > 0 && small.profit < 750, 'small profit rounds to the floor');
  assert.equal(small.xp, 10);
  const medium = sell(6000, 2000, 10);
  assert.equal(medium.ok && medium.xp, tradeXp(6000, 2000, 10));
  assert.ok(medium.xp > 10 && medium.xp < 100);
  const large = sell(50_000, 2000, 100);
  assert.equal(large.xp, 100);
  for (const [p, a, q] of [[2000, 2000, 10], [2300, 2000, 10], [6000, 2000, 10], [50_000, 2000, 100], [2150.5, 1999.25, 7]]) {
    assert.equal(sell(p, a, q).xp, tradeXp(p, a, q), `${p}/${a}/${q}`);
  }
});

test('cargo quality authority: zero-decay pairs only', () => {
  assert.equal(resolveCanonicalCargoSaleQuality('steel', 'standard').ok, true);
  assert.equal(resolveCanonicalCargoSaleQuality('fruit', 'cold').ok, true);
  assert.equal(resolveCanonicalCargoSaleQuality('beverage', 'cold').ok, true);
  for (const productId of ['electronics', 'machinery', 'textile', 'furniture'] as const) {
    assert.equal(resolveCanonicalCargoSaleQuality(productId, 'standard').ok, false, productId);
    const blocked = deriveCanonicalCargoSaleXp({
      productId,
      warehouseType: 'standard',
      quantity: 1,
      sellUnitPrice: 5000,
      costBasis: { trusted: true, averageBuyPrice: 1000, costBasisPolicyVersion: CANONICAL_CARGO_COST_BASIS_POLICY_VERSION },
    });
    assert.deepEqual(blocked, { ok: false, xp: 0, xpAuthority: CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY });
  }
  const noBasis = deriveCanonicalCargoSaleXp({
    productId: 'steel',
    warehouseType: 'standard',
    quantity: 1,
    sellUnitPrice: 5000,
    costBasis: readCanonicalCargoCostBasis({ quantity: 5 }),
  });
  assert.deepEqual(noBasis, { ok: false, xp: 0, xpAuthority: CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY });
});

test('cost basis planner: fresh, weighted, untrusted mix, gate-off invalidation, zero reset', () => {
  const fresh = planCanonicalCargoCostBasisAfterBuy({ xpGateEnabled: true, inventoryBefore: 0, existing: null, addedQuantity: 10, unitPrice: 2000 });
  assert.deepEqual(fresh, { kind: 'SET', fields: { costBasisPolicyVersion: CANONICAL_CARGO_COST_BASIS_POLICY_VERSION, averageBuyPrice: 2000 } });
  const weighted = planCanonicalCargoCostBasisAfterBuy({
    xpGateEnabled: true,
    inventoryBefore: 10,
    existing: { quantity: 10, costBasisPolicyVersion: CANONICAL_CARGO_COST_BASIS_POLICY_VERSION, averageBuyPrice: 2000 },
    addedQuantity: 30,
    unitPrice: 3000,
  });
  assert.equal(weighted.kind === 'SET' && weighted.fields.averageBuyPrice, (10 * 2000 + 30 * 3000) / 40);
  const mixed = planCanonicalCargoCostBasisAfterBuy({ xpGateEnabled: true, inventoryBefore: 5, existing: { quantity: 5 }, addedQuantity: 5, unitPrice: 2000 });
  assert.deepEqual(mixed, { kind: 'UNTRUSTED', fields: { costBasisPolicyVersion: null, averageBuyPrice: null } });
  const offNoBasis = planCanonicalCargoCostBasisAfterBuy({ xpGateEnabled: false, inventoryBefore: 5, existing: { quantity: 5 }, addedQuantity: 5, unitPrice: 2000 });
  assert.deepEqual(offNoBasis, { kind: 'UNCHANGED' });
  const offWithBasis = planCanonicalCargoCostBasisAfterBuy({
    xpGateEnabled: false,
    inventoryBefore: 5,
    existing: { quantity: 5, costBasisPolicyVersion: CANONICAL_CARGO_COST_BASIS_POLICY_VERSION, averageBuyPrice: 2000 },
    addedQuantity: 5,
    unitPrice: 2000,
  });
  assert.equal(offWithBasis.kind, 'UNTRUSTED');
  const reset = planCanonicalCargoCostBasisAfterBuy({
    xpGateEnabled: true,
    inventoryBefore: 0,
    existing: { quantity: 0, costBasisPolicyVersion: null, averageBuyPrice: null },
    addedQuantity: 4,
    unitPrice: 1800,
  });
  assert.equal(reset.kind === 'SET' && reset.fields.averageBuyPrice, 1800);
  assert.equal(readCanonicalCargoCostBasis({ costBasisPolicyVersion: 'other-v9', averageBuyPrice: 10 }).trusted, false);
});

test('readiness classifier: every status reachable, current facts partial / blocked by missions', () => {
  const base = { ...CURRENT_NON_DELIVERY_XP_READINESS_FACTS, scope: 'OPERATIONS' as const };
  assert.equal(CANONICAL_NON_DELIVERY_OPERATION_XP_READINESS, 'NON_DELIVERY_XP_INTERNAL_PARTIAL');
  assert.equal(CANONICAL_NON_DELIVERY_ALL_SOURCES_XP_READINESS, 'NON_DELIVERY_XP_BLOCKED_MISSIONS');
  assert.equal(classifyCanonicalNonDeliveryXpReadiness({ ...base, legacyProgressionState: true }), 'NON_DELIVERY_XP_BLOCKED_LEGACY_STATE');
  assert.equal(classifyCanonicalNonDeliveryXpReadiness({ ...base, cargoSale: 'BLOCKED_COST_BASIS' }), 'NON_DELIVERY_XP_BLOCKED_CARGO_COST_BASIS');
  assert.equal(classifyCanonicalNonDeliveryXpReadiness({ ...base, marketplacePurchaseGrantsXp: true }), 'NON_DELIVERY_XP_BLOCKED_MARKETPLACE_PURCHASE');
  assert.equal(classifyCanonicalNonDeliveryXpReadiness({ ...base, recoveryGrantsXp: true }), 'NON_DELIVERY_XP_BLOCKED_RECOVERY');
  assert.equal(classifyCanonicalNonDeliveryXpReadiness({ ...base, scope: 'ALL_SOURCES' }), 'NON_DELIVERY_XP_BLOCKED_MISSIONS');
  assert.equal(
    classifyCanonicalNonDeliveryXpReadiness({ ...base, cargoSale: 'SERVER_DERIVED_ALL', publicAuthority: true }),
    'NON_DELIVERY_XP_CANONICAL_READY',
  );
});

test('truck purchase: +30 atomically, receipt evidence, retry never double-awards, trailer earns nothing', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-truck';
  seedAccount(db, uid);
  await initProgression(db, uid);
  const first = await purchaseCanonicalCatalogAssetTransaction(db, uid, TRUCK_ID, 'truckbuy01', 'TRUCK', NOW, ON);
  assert.equal(first.ok, true, first.ok ? '' : first.reason);
  if (!first.ok) return;
  assert.equal(first.progression.application, 'APPLIED');
  const opId = progressionTruckPurchaseOperationId('truckbuy01');
  const receipt = progressionReceipt(db, uid, opId)!;
  assert.equal(receipt.sourceType, 'COMPANY_TRUCK_PURCHASE');
  assert.equal(receipt.sourceId, first.receipt.assetId);
  assert.equal(receipt.xpDelta, 30);
  assert.equal(receipt.xpAuthority, 'SERVER_DERIVED');
  assert.equal(receipt.reputationDelta, 0);
  assert.deepEqual(receipt.xpEvidence, {
    policyVersion: CANONICAL_NON_DELIVERY_XP_POLICY_VERSION,
    sourceType: 'COMPANY_TRUCK_PURCHASE',
    formula: 'FIXED',
    rewardKey: 'truckPurchase',
    xp: 30,
    operationReceiptId: 'truckbuy01',
    operationPolicyVersion: first.receipt.policyVersion,
    cashTransactionId: first.receipt.transactionId,
  });
  assert.equal(progression(db, uid).totalXp, 30);
  assert.equal(progression(db, uid).reputation, 50);
  const cashAfter = cash(db, uid);
  const retry = await purchaseCanonicalCatalogAssetTransaction(db, uid, TRUCK_ID, 'truckbuy01', 'TRUCK', NOW + 5, ON);
  assert.equal(retry.ok && retry.alreadyApplied, true);
  assert.equal(retry.ok && retry.progression.application, 'ALREADY_APPLIED');
  assert.equal(progression(db, uid).totalXp, 30);
  assert.equal(cash(db, uid), cashAfter);
  const trailer = await purchaseCanonicalCatalogAssetTransaction(db, uid, TRAILER_ID, 'trailer001', 'TRAILER', NOW, ON);
  assert.equal(trailer.ok && trailer.progression.application, 'PRODUCTION_NO_XP');
  assert.equal(progression(db, uid).totalXp, 30);
  assert.equal(progressionReceiptCount(db, uid), 1);
  assert.deepEqual(cashTransactionIds(db, uid).sort(), [first.receipt.transactionId, trailer.ok ? trailer.receipt.transactionId : ''].sort());
});

test('driver hire +10; duplicate hire and fire earn nothing', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-hire';
  seedAccount(db, uid);
  await initProgression(db, uid);
  const hired = await hireCanonicalDriverTransaction(db, uid, DRIVER_A, 'hire-xp-01', NOW, ON);
  assert.equal(hired.ok, true, hired.ok ? '' : hired.reason);
  if (!hired.ok) return;
  assert.equal(hired.progression.application, 'APPLIED');
  const receipt = progressionReceipt(db, uid, progressionDriverHireOperationId('hire-xp-01'))!;
  assert.equal(receipt.xpDelta, 10);
  assert.equal(receipt.sourceId, DRIVER_A);
  assert.equal((receipt.xpEvidence as { rewardKey: string }).rewardKey, 'driverHire');
  const again = await hireCanonicalDriverTransaction(db, uid, DRIVER_A, 'hire-xp-02', NOW, ON);
  assert.deepEqual(again, { ok: false, reason: 'DRIVER_ALREADY_HIRED' });
  const replay = await hireCanonicalDriverTransaction(db, uid, DRIVER_A, 'hire-xp-01', NOW, ON);
  assert.equal(replay.ok && replay.progression.application, 'ALREADY_APPLIED');
  assert.equal(progression(db, uid).totalXp, 10);
  assert.equal(progressionReceiptCount(db, uid), 1);
});

test('warehouse open +40, upgrades +25 per tier with distinct identities, duplicate/max earn nothing', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-wh';
  seedAccount(db, uid, 50_000_000);
  await initProgression(db, uid);
  const opened = await openSteelWarehouse(db, uid);
  assert.equal(opened.ok && opened.progression.application, 'APPLIED');
  assert.equal(progressionReceipt(db, uid, progressionWarehouseOpenOperationId(STEEL_WH))?.xpDelta, 40);
  const dup = await openCanonicalWarehouseTransaction(db, uid, 'izmir', 'standard', 'open-dup-001', NOW, ON);
  assert.deepEqual(dup, { ok: false, reason: 'DUPLICATE_WAREHOUSE' });
  let level = 1;
  let upgrades = 0;
  for (let i = 0; i < 10; i += 1) {
    const up = await upgradeCanonicalWarehouseTransaction(db, uid, STEEL_WH, `upgrade-${i}-xp`, NOW + i, ON);
    if (!up.ok) {
      assert.equal(up.reason, 'MAX_LEVEL');
      break;
    }
    assert.equal(up.progression.application, 'APPLIED');
    const id = progressionWarehouseUpgradeOperationId(STEEL_WH, level, level + 1);
    assert.equal(up.progression.operationId, id);
    assert.equal(progressionReceipt(db, uid, id)?.xpDelta, 25);
    level += 1;
    upgrades += 1;
    const replay = await upgradeCanonicalWarehouseTransaction(db, uid, STEEL_WH, `upgrade-${i}-xp`, NOW + i, ON);
    assert.equal(replay.ok && replay.progression.application, 'ALREADY_APPLIED');
  }
  assert.ok(upgrades >= 1);
  assert.equal(progression(db, uid).totalXp, 40 + 25 * upgrades);
  assert.equal(progressionReceiptCount(db, uid), 1 + upgrades);
});

test('gates: XP off, progression off, uninitialized progression, operation off', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-gates';
  seedAccount(db, uid);
  const uninit = await hireCanonicalDriverTransaction(db, uid, DRIVER_A, 'hire-gate-1', NOW, ON);
  assert.equal(uninit.ok && uninit.progression.application, 'NOT_APPLIED_UNINITIALIZED');
  assert.equal(db.dump.has(canonicalCompanyProgressionPath(uid)), false);
  assert.equal(progressionReceiptCount(db, uid), 0);

  const db2 = createMemoryFirestore();
  seedAccount(db2, uid);
  await initProgression(db2, uid);
  const off = await hireCanonicalDriverTransaction(db2, uid, DRIVER_A, 'hire-gate-2', NOW, XP_OFF);
  assert.equal(off.ok && off.progression.application, 'NOT_EVALUATED_GATE_OFF');
  const progOff = await hireCanonicalDriverTransaction(db2, uid, DRIVER_B, 'hire-gate-3', NOW, PROGRESSION_OFF);
  assert.equal(progOff.ok && progOff.progression.application, 'NOT_EVALUATED_GATE_OFF');
  assert.equal(progression(db2, uid).totalXp, 0);
  assert.equal(progressionReceiptCount(db2, uid), 0);
  const opOff = await purchaseCanonicalCatalogAssetTransaction(db2, uid, TRUCK_ID, 'truck-off-1', 'TRUCK', NOW, {
    ...XP,
    envValue: null,
  });
  assert.equal(opOff.ok, false);
  assert.equal(progression(db2, uid).totalXp, 0);
});

test('historical operations are never backfilled when the gate turns on', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-history';
  seedAccount(db, uid);
  await initProgression(db, uid);
  const old = await purchaseCanonicalCatalogAssetTransaction(db, uid, TRUCK_ID, 'truck-old-1', 'TRUCK', NOW, XP_OFF);
  assert.equal(old.ok && old.progression.application, 'NOT_EVALUATED_GATE_OFF');
  const replay = await purchaseCanonicalCatalogAssetTransaction(db, uid, TRUCK_ID, 'truck-old-1', 'TRUCK', NOW + 9, ON);
  assert.equal(replay.ok && replay.progression.application, NON_DELIVERY_XP_HISTORICAL_OPERATION_UNAPPLIED);
  assert.equal(progression(db, uid).totalXp, 0);
  assert.equal(progressionReceiptCount(db, uid), 0);
});

test('conflicts: forged progression receipt blocks the operation; unknown policy fails closed on replay', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-conflict';
  seedAccount(db, uid);
  await initProgression(db, uid);
  const opId = progressionDriverHireOperationId('hire-forge1');
  db.dump.set(canonicalProgressionReceiptPath(uid, opId), { operationId: opId, xpDelta: 5000 });
  const before = cash(db, uid);
  const forged = await hireCanonicalDriverTransaction(db, uid, DRIVER_A, 'hire-forge1', NOW, ON);
  assert.deepEqual(forged, { ok: false, reason: NON_DELIVERY_XP_PROGRESSION_RECEIPT_CONFLICT });
  assert.equal(cash(db, uid), before);
  assert.equal(db.dump.has(`users/${uid}/canonicalDrivers/${DRIVER_A}`), false);
  assert.equal(progression(db, uid).totalXp, 0);

  const ok = await hireCanonicalDriverTransaction(db, uid, DRIVER_B, 'hire-real-1', NOW, ON);
  assert.equal(ok.ok, true);
  const realId = progressionDriverHireOperationId('hire-real-1');
  const stored = progressionReceipt(db, uid, realId)!;
  db.dump.set(canonicalProgressionReceiptPath(uid, realId), {
    ...stored,
    xpEvidence: { ...(stored.xpEvidence as Record<string, unknown>), policyVersion: 'canonical-company-non-delivery-xp-v9' },
  });
  const replay = await hireCanonicalDriverTransaction(db, uid, DRIVER_B, 'hire-real-1', NOW, ON);
  assert.deepEqual(replay, { ok: false, reason: NON_DELIVERY_XP_POLICY_UNKNOWN });
});

test('cargo: trusted cost basis from canonical buys, sale XP from committed receipt, no XP on buy', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-cargo';
  seedAccount(db, uid, 50_000_000);
  await initProgression(db, uid);
  await openSteelWarehouse(db, uid);
  seedMarket(db, 'izmir', 'steel', 2000);
  const baseXp = progression(db, uid).totalXp;
  const buy1 = await buyCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 10, STEEL_WH, 'cargo-buy-1', NOW, ON);
  assert.equal(buy1.ok && buy1.progression?.application, 'PRODUCTION_NO_XP');
  setPrice(db, 'izmir', 'steel', 3000);
  const buy2 = await buyCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 30, STEEL_WH, 'cargo-buy-2', NOW, ON);
  assert.equal(buy2.ok, true);
  const inventory = db.dump.get(`users/${uid}/canonicalCargoInventory/${STEEL_WH}__steel`)!;
  assert.equal(inventory.costBasisPolicyVersion, CANONICAL_CARGO_COST_BASIS_POLICY_VERSION);
  assert.equal(inventory.averageBuyPrice, (10 * 2000 + 30 * 3000) / 40);
  assert.equal(progression(db, uid).totalXp, baseXp);
  setPrice(db, 'izmir', 'steel', 9000);
  const sale = await sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 20, STEEL_WH, 'cargo-sell-1', NOW, ON);
  assert.equal(sale.ok, true, sale.ok ? '' : sale.reason);
  if (!sale.ok || !sale.receipt) return;
  const expected = tradeXp(sale.receipt.unitPrice, 2750, 20);
  const receipt = progressionReceipt(db, uid, progressionCargoSaleOperationId('cargo-sell-1'))!;
  assert.equal(receipt.xpDelta, expected);
  const evidence = receipt.xpEvidence as Record<string, unknown>;
  assert.equal(evidence.sellUnitPrice, sale.receipt.unitPrice);
  assert.equal(evidence.averageBuyPrice, 2750);
  assert.equal(evidence.quantity, 20);
  assert.equal(evidence.quality, 100);
  assert.equal(evidence.profit, calculateTradeProfit(9000, 2750, 20, 100));
  assert.equal(evidence.cashTransactionId, sale.receipt.cashTransactionId);
  assert.equal(progression(db, uid).totalXp, baseXp + expected);
  const replay = await sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 20, STEEL_WH, 'cargo-sell-1', NOW, ON);
  assert.equal(replay.ok && replay.progression?.application, 'ALREADY_APPLIED');
  assert.equal(progression(db, uid).totalXp, baseXp + expected);
  const afterSaleInventory = db.dump.get(`users/${uid}/canonicalCargoInventory/${STEEL_WH}__steel`)!;
  assert.equal(afterSaleInventory.averageBuyPrice, 2750, 'sell keeps average (production reduceInventoryOnSell)');
});

test('cargo: pre-policy / mixed inventory is untrusted until quantity returns to zero', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-mixed';
  seedAccount(db, uid, 50_000_000);
  await initProgression(db, uid);
  await openSteelWarehouse(db, uid);
  seedMarket(db, 'izmir', 'steel', 2000);
  const baseXp = progression(db, uid).totalXp;
  await buyCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 5, STEEL_WH, 'mixed-buy-1', NOW, XP_OFF);
  const legacyDoc = db.dump.get(`users/${uid}/canonicalCargoInventory/${STEEL_WH}__steel`)!;
  assert.equal('averageBuyPrice' in legacyDoc, false);
  await buyCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 5, STEEL_WH, 'mixed-buy-2', NOW, ON);
  assert.equal(db.dump.get(`users/${uid}/canonicalCargoInventory/${STEEL_WH}__steel`)?.averageBuyPrice, null);
  setPrice(db, 'izmir', 'steel', 9000);
  const sale = await sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 10, STEEL_WH, 'mixed-sell-1', NOW, ON);
  assert.equal(sale.ok, true);
  const receipt = progressionReceipt(db, uid, progressionCargoSaleOperationId('mixed-sell-1'))!;
  assert.equal(receipt.xpDelta, 0);
  assert.equal(receipt.xpAuthority, CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY);
  assert.equal((receipt.xpEvidence as Record<string, unknown>).averageBuyPrice, null);
  assert.equal(progression(db, uid).totalXp, baseXp);
  setPrice(db, 'izmir', 'steel', 2000);
  const rebuy = await buyCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 5, STEEL_WH, 'mixed-buy-3', NOW, ON);
  assert.equal(rebuy.ok, true, rebuy.ok ? '' : rebuy.reason);
  assert.equal(db.dump.get(`users/${uid}/canonicalCargoInventory/${STEEL_WH}__steel`)?.averageBuyPrice, 2000);
  setPrice(db, 'izmir', 'steel', 9000);
  const trusted = await sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 5, STEEL_WH, 'mixed-sell-2', NOW, ON);
  assert.equal(trusted.ok, true);
  assert.equal(progressionReceipt(db, uid, progressionCargoSaleOperationId('mixed-sell-2'))?.xpDelta, tradeXp(9000, 2000, 5));
});

test('cargo: decaying product sale is blocked on quality authority', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-decay';
  seedAccount(db, uid, 50_000_000);
  await initProgression(db, uid);
  await openSteelWarehouse(db, uid);
  seedMarket(db, 'izmir', 'electronics', 4000);
  const baseXp = progression(db, uid).totalXp;
  const buy = await buyCanonicalCargoTransaction(db, uid, 'izmir', 'electronics', 5, STEEL_WH, 'decay-buy-1', NOW, ON);
  assert.equal(buy.ok, true, buy.ok ? '' : buy.reason);
  setPrice(db, 'izmir', 'electronics', 9000);
  const sale = await sellCanonicalCargoTransaction(db, uid, 'izmir', 'electronics', 5, STEEL_WH, 'decay-sell-1', NOW, ON);
  assert.equal(sale.ok, true);
  const receipt = progressionReceipt(db, uid, progressionCargoSaleOperationId('decay-sell-1'))!;
  assert.equal(receipt.xpAuthority, CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY);
  assert.equal(receipt.xpDelta, 0);
  assert.equal((receipt.xpEvidence as Record<string, unknown>).qualityAuthority, 'QUALITY_DECAY_UNTRACKED');
  assert.equal(progression(db, uid).totalXp, baseXp);
});

test('market race: XP comes from each committed receipt price', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-race';
  seedAccount(db, uid, 50_000_000);
  await initProgression(db, uid);
  await openSteelWarehouse(db, uid);
  seedMarket(db, 'izmir', 'steel', 2000);
  await buyCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 40, STEEL_WH, 'race-buy-01', NOW, ON);
  const tick = (price: number) =>
    db.runTransaction(async (transaction) => {
      const ref = db.doc('canonicalWorldMarkets/izmir_steel');
      const snap = await transaction.get(ref);
      transaction.update(ref, { currentPrice: price, marketRevision: Number(snap.data()?.marketRevision) + 1 });
    });
  const [a, , b, , c] = await Promise.all([
    sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 10, STEEL_WH, 'race-sell-a', NOW, ON),
    tick(12_000),
    sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 10, STEEL_WH, 'race-sell-b', NOW, ON),
    tick(60_000),
    sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 10, STEEL_WH, 'race-sell-c', NOW, ON),
  ]);
  const prices = [a, b, c].map((row) => (row.ok && row.receipt ? row.receipt.unitPrice : -1));
  assert.deepEqual(prices, [2000, 12_000, 60_000]);
  for (const [id, price] of [['race-sell-a', 2000], ['race-sell-b', 12_000], ['race-sell-c', 60_000]] as const) {
    const receipt = progressionReceipt(db, uid, progressionCargoSaleOperationId(id))!;
    assert.equal((receipt.xpEvidence as Record<string, unknown>).sellUnitPrice, price);
    assert.equal(receipt.xpDelta, tradeXp(price, 2000, 10), id);
  }
});

test('two devices: same intent applies once; different intents both apply', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-devices';
  seedAccount(db, uid);
  await initProgression(db, uid);
  const [d1, d2] = await Promise.all([
    purchaseCanonicalCatalogAssetTransaction(db, uid, TRUCK_ID, 'truck-dual1', 'TRUCK', NOW, ON),
    purchaseCanonicalCatalogAssetTransaction(db, uid, TRUCK_ID, 'truck-dual1', 'TRUCK', NOW + 1, ON),
  ]);
  const applications = [d1, d2].map((row) => (row.ok ? row.progression.application : row.reason)).sort();
  assert.deepEqual(applications, ['ALREADY_APPLIED', 'APPLIED']);
  assert.equal(progression(db, uid).totalXp, 30);
  const [h1, h2] = await Promise.all([
    hireCanonicalDriverTransaction(db, uid, DRIVER_A, 'hire-dev-01', NOW, ON),
    hireCanonicalDriverTransaction(db, uid, DRIVER_B, 'hire-dev-02', NOW, ON),
  ]);
  assert.equal(h1.ok && h2.ok, true);
  assert.equal(progression(db, uid).totalXp, 50);
  assert.equal(progression(db, uid).progressionRevision, 4);
});

test('cross-user isolation and save tampering do not influence XP', async () => {
  const db = createMemoryFirestore();
  seedAccount(db, 'user-a');
  seedAccount(db, 'user-b');
  await initProgression(db, 'user-a');
  await initProgression(db, 'user-b');
  db.dump.set('users/user-b/saves/current', { player: { level: 30, xp: 99_999, totalXp: 999_999, money: 1e9 } });
  db.dump.set('users/user-b', { money: 1e9, level: 30, xp: 99_999 });
  const b = await purchaseCanonicalCatalogAssetTransaction(db, 'user-b', TRUCK_ID, 'truck-crossb', 'TRUCK', NOW, ON);
  assert.equal(b.ok, true);
  assert.equal(progression(db, 'user-b').totalXp, 30);
  assert.equal(progression(db, 'user-b').level, 1);
  assert.equal(progression(db, 'user-a').totalXp, 0);
  assert.equal(progressionReceiptCount(db, 'user-a'), 0);
  const a = await purchaseCanonicalCatalogAssetTransaction(db, 'user-a', TRUCK_ID, 'truck-crossb', 'TRUCK', NOW, ON);
  assert.equal(a.ok && a.progression.application, 'APPLIED', 'same intent id under another uid is independent');
  assert.equal(progression(db, 'user-a').totalXp, 30);
  assert.equal(db.dump.get('users/user-b/saves/current')?.player && (db.dump.get('users/user-b/saves/current')!.player as { level: number }).level, 30);
});

test('level semantics: level-up, max level 30, multi-level jump reuse applyXpToPlayer; no reputation change', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-max';
  seedAccount(db, uid);
  await initProgression(db, uid);
  const path = canonicalCompanyProgressionPath(uid);
  db.dump.set(path, { ...db.dump.get(path)!, level: 1, xp: 95, totalXp: 95 });
  await purchaseCanonicalCatalogAssetTransaction(db, uid, TRUCK_ID, 'truck-lvl01', 'TRUCK', NOW, ON);
  const leveled = progression(db, uid);
  assert.deepEqual(
    { level: leveled.level, xp: leveled.xp, totalXp: leveled.totalXp, next: leveled.xpToNextLevel },
    { level: 2, xp: 25, totalXp: 125, next: calculateXpToNextLevel(2) },
  );
  db.dump.set(path, {
    ...db.dump.get(path)!,
    level: levelConfig.maxLevel,
    xp: 0,
    xpToNextLevel: calculateXpToNextLevel(levelConfig.maxLevel),
    totalXp: 500_000,
  });
  await hireCanonicalDriverTransaction(db, uid, DRIVER_A, 'hire-max-01', NOW, ON);
  const max = progression(db, uid);
  assert.equal(max.level, 30);
  assert.equal(max.xp, 0);
  assert.equal(max.totalXp, 500_010);
  assert.equal(max.reputation, 50);
  const start = { level: 1, xp: 0, xpToNextLevel: calculateXpToNextLevel(1), totalXp: 0 };
  const jump = applyCanonicalCompanyXp(start, 500);
  const production = applyXpToPlayer({ ...start, companyLevel: 1 } as unknown as Player, 500).player;
  assert.deepEqual(
    { level: jump.level, xp: jump.xp, totalXp: jump.totalXp },
    { level: production.level, xp: production.xp, totalXp: production.totalXp },
  );
  assert.ok(jump.newLevels.length >= 2, 'multi-level jump');
});

test('order independence: any order of the same operations reaches the same progression', async () => {
  const amounts = [30, 10, 40, 25, tradeXp(9000, 2000, 10)];
  const permutations = [amounts, [...amounts].reverse(), [amounts[2]!, amounts[4]!, amounts[0]!, amounts[3]!, amounts[1]!]];
  const finals = permutations.map((order) => {
    let state = createInitialCanonicalCompanyProgression('uid-o', NOW);
    order.forEach((xp, i) => {
      state = planCanonicalProgressionMutation(state, {
        operationId: `op-${i}`,
        sourceType: 'COMPANY_TRUCK_PURCHASE',
        sourceId: 's',
        xpDelta: xp,
        xpAuthority: 'SERVER_DERIVED',
        reputationDelta: 0,
        reputationReasons: [],
        nowMs: NOW,
      }).next;
    });
    return { level: state.level, xp: state.xp, totalXp: state.totalXp, rev: state.progressionRevision };
  });
  assert.deepEqual(finals[0], finals[1]);
  assert.deepEqual(finals[0], finals[2]);

  async function run(order: string[]) {
    const db = createMemoryFirestore();
    const uid = 'xp-order';
    seedAccount(db, uid, 50_000_000);
    await initProgression(db, uid);
    seedMarket(db, 'izmir', 'steel', 2000);
    const steps: Record<string, () => Promise<unknown>> = {
      purchase: () => purchaseCanonicalCatalogAssetTransaction(db, uid, TRUCK_ID, 'truck-ord01', 'TRUCK', NOW, ON),
      hire: () => hireCanonicalDriverTransaction(db, uid, DRIVER_A, 'hire-ord-01', NOW, ON),
      open: () => openCanonicalWarehouseTransaction(db, uid, 'izmir', 'standard', 'open-ord-01', NOW, ON),
    };
    for (const step of order) await steps[step]!();
    await upgradeCanonicalWarehouseTransaction(db, uid, STEEL_WH, 'upgr-ord-01', NOW, ON);
    await buyCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 10, STEEL_WH, 'buy-ord-001', NOW, ON);
    setPrice(db, 'izmir', 'steel', 9000);
    await sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 10, STEEL_WH, 'sell-ord-01', NOW, ON);
    const p = progression(db, uid);
    return { level: p.level, xp: p.xp, totalXp: p.totalXp };
  }
  const x = await run(['purchase', 'hire', 'open']);
  const y = await run(['open', 'hire', 'purchase']);
  assert.deepEqual(x, y);
  assert.equal(x.totalXp, 30 + 10 + 40 + 25 + tradeXp(9000, 2000, 10));
});

function seedIssuanceWorld(db: { dump: Dump }, uid: string) {
  db.dump.set(`users/${uid}/canonicalFleetAssets/truck-1`, {
    assetType: 'TRUCK',
    capacity: 25,
    lifecycleStatus: 'ACTIVE',
    ownerUid: uid,
  });
  db.dump.set(
    `users/${uid}/canonicalFleetRuntime/truck-1`,
    createInternalFixtureRuntime({ assetId: 'truck-1', ownerUid: uid, serverNowMs: NOW }) as unknown as Record<string, unknown>,
  );
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

test('end-to-end: init → purchase → hire → open → upgrade → cargo buy/sell → frozen batch → refresh sees level', async () => {
  const db = createMemoryFirestore();
  const uid = 'xp-e2e';
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
  db.dump.set(serverStateCurrentRef(uid), { cash: 50_000_000, ownerUid: uid, sourceVersion: 1, migrationSource: 'default' });
  await initProgression(db, uid);
  const batch = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW, gates);
  assert.equal(batch.ok, true, batch.ok ? '' : batch.reason);
  if (!batch.ok) return;
  const batchPath = `users/${uid}/canonicalRoadContractBatches/${batch.batchId}`;
  assert.equal(db.dump.get(batchPath)?.playerLevel, 1);

  const cashStart = cash(db, uid);
  const purchase = await purchaseCanonicalCatalogAssetTransaction(db, uid, TRUCK_ID, 'e2e-truck-1', 'TRUCK', NOW + 1, ON);
  const hire = await hireCanonicalDriverTransaction(db, uid, DRIVER_A, 'e2e-hire-01', NOW + 2, ON);
  const open = await openCanonicalWarehouseTransaction(db, uid, 'izmir', 'standard', 'e2e-open-01', NOW + 3, ON);
  const upgrade = await upgradeCanonicalWarehouseTransaction(db, uid, STEEL_WH, 'e2e-upgr-01', NOW + 4, ON);
  for (const [name, row] of Object.entries({ purchase, hire, open, upgrade })) {
    assert.equal(row.ok, true, row.ok ? '' : `${name}: ${row.reason}`);
  }
  if (purchase.ok) {
    const assetId = purchase.receipt.assetId;
    db.dump.set(
      `users/${uid}/canonicalFleetRuntime/${assetId}`,
      createInternalFixtureRuntime({ assetId, ownerUid: uid, serverNowMs: NOW }) as unknown as Record<string, unknown>,
    );
  }
  db.dump.set('canonicalWorldMarkets/izmir_steel', {
    ...db.dump.get('canonicalWorldMarkets/izmir_steel')!,
    stock: 1000,
    authorityMode: 'INTERNAL_TEST_FIXTURE',
  });
  const buyPrice = Number(db.dump.get('canonicalWorldMarkets/izmir_steel')?.currentPrice);
  const buy = await buyCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 20, STEEL_WH, 'e2e-buy-001', NOW + 5, ON);
  assert.equal(buy.ok, true, buy.ok ? '' : buy.reason);
  setPrice(db, 'izmir', 'steel', buyPrice * 3);
  const sell = await sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 20, STEEL_WH, 'e2e-sell-01', NOW + 6, ON);
  assert.equal(sell.ok, true, sell.ok ? '' : sell.reason);
  const saleXp = tradeXp(buyPrice * 3, buyPrice, 20);
  const expectedTotal = 30 + 10 + 40 + 25 + saleXp;
  const expected = applyCanonicalCompanyXp({ level: 1, xp: 0, xpToNextLevel: calculateXpToNextLevel(1), totalXp: 0 }, expectedTotal);
  const p = progression(db, uid);
  assert.deepEqual(
    { level: p.level, xp: p.xp, totalXp: p.totalXp, reputation: p.reputation },
    { level: expected.level, xp: expected.xp, totalXp: expectedTotal, reputation: 50 },
  );
  assert.ok(p.level >= 2, 'non-delivery XP levels the company');
  assert.equal(progressionReceiptCount(db, uid), 5);
  assert.equal(cashTransactionIds(db, uid).length, 6, 'one cash transaction per operation, none for XP');
  assert.equal(
    cash(db, uid),
    cashStart - (purchase.ok ? purchase.receipt.price : 0) - (hire.ok ? hire.receipt.amount : 0)
      + (open.ok ? open.receipt.cashDelta : 0) + (upgrade.ok ? upgrade.receipt.cashDelta : 0)
      + (buy.ok && buy.receipt ? buy.receipt.totalCashDelta : 0) + (sell.ok && sell.receipt ? sell.receipt.totalCashDelta : 0),
  );

  assert.equal(db.dump.get(batchPath)?.playerLevel, 1, 'existing batch frozen');
  const refreshed = await generateCanonicalProductionRoadBatchTransaction(db, uid, NOW + 3 * HOUR_MS, {
    ...gates,
    refreshIntentId: 'xp-refresh-1',
  });
  assert.equal(refreshed.ok, true, refreshed.ok ? '' : refreshed.reason);
  if (!refreshed.ok) return;
  const refreshedBatch = db.dump.get(`users/${uid}/canonicalRoadContractBatches/${refreshed.batchId}`)!;
  assert.equal(refreshedBatch.playerLevel, p.level);
  assert.equal(refreshedBatch.playerReputation, 50);
});
