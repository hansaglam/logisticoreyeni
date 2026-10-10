/**
 * Map V2 Step 29AH canonical non-delivery company XP authority.
 * Run: node --import tsx scripts/map-v2-canonical-non-delivery-company-xp-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';
import type { Firestore } from 'firebase-admin/firestore';

import { purchaseCanonicalCatalogAssetTransaction } from '../backend/src/canonicalCatalogPurchase';
import { hireCanonicalDriverTransaction } from '../backend/src/canonicalCoreVehicleStaffCash';
import { openCanonicalWarehouseTransaction, upgradeCanonicalWarehouseTransaction } from '../backend/src/canonicalWarehouse';
import { buyCanonicalCargoTransaction, sellCanonicalCargoTransaction } from '../backend/src/canonicalCargoMarket';
import { serverStateCurrentRef } from '../backend/src/canonicalCashTransaction';
import { initializeCanonicalCompanyProgressionForNewAccount } from '../backend/src/canonicalCompanyProgression';
import { generateCanonicalProductionRoadBatchTransaction } from '../backend/src/canonicalProductionRoadContractIssuance';
import { levelBalance, tradingBalance } from '../src/config/balance';
import { calculateXpToNextLevel, levelConfig } from '../src/config/levelConfig';
import { REPUTATION_RULES } from '../src/config/reputationRules';
import { CITIES } from '../src/data/cities';
import { PRODUCT_IDS } from '../src/data/products';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import {
  CANONICAL_PROGRESSION_READINESS,
  CANONICAL_PROGRESSION_REMAINING_CLIENT_XP_SOURCES,
  applyCanonicalCompanyXp,
  canonicalCompanyProgressionPath,
  canonicalProgressionReceiptPath,
  deriveCanonicalRoadCompletionReputation,
  deriveCanonicalRoadCompletionXp,
  type CanonicalCompanyProgressionState,
} from '../src/domain/canonicalCompanyProgression';
import {
  CANONICAL_CARGO_COST_BASIS_POLICY_VERSION,
  CANONICAL_NON_DELIVERY_ALL_SOURCES_XP_READINESS,
  CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY_STATUS,
  CANONICAL_NON_DELIVERY_OPERATION_XP_READINESS,
  CANONICAL_NON_DELIVERY_XP_POLICY_VERSION,
  CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY,
  CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY,
  NON_DELIVERY_XP_HISTORICAL_OPERATION_UNAPPLIED,
  NON_DELIVERY_XP_PROGRESSION_RECEIPT_CONFLICT,
  PRODUCTION_NON_DELIVERY_XP_AUDIT,
  containsForbiddenNonDeliveryXpClientKeys,
  isCanonicalNonDeliveryXpAllowed,
  progressionCargoSaleOperationId,
  progressionDriverHireOperationId,
  progressionTruckPurchaseOperationId,
  progressionWarehouseOpenOperationId,
  progressionWarehouseUpgradeOperationId,
} from '../src/domain/canonicalNonDeliveryCompanyXp';
import {
  PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS,
  ROAD_CONTRACT_ISSUANCE_READINESS,
} from '../src/domain/canonicalProductionRoadContractIssuance';
import { deriveCanonicalProductionMarketQuote } from '../src/domain/canonicalProductionMarketTick';
import { createInternalFixtureRuntime } from '../src/domain/canonicalFleetRuntimeLocation';
import { hasOnlyCanonicalCargoSellKeys } from '../src/domain/canonicalCargoMarketWorldState';
import { hasOnlyCanonicalCatalogPurchaseKeys } from '../src/domain/remainingRoadCashPathCanonicalization';
import { createCanonicalWarehouseId } from '../src/domain/canonicalWarehouseState';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
import { calculateDeliveryXp, calculateTradeSaleXp } from '../src/simulation/leveling';
import { calculateTradeProfit } from '../src/simulation/trading';
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
const OP = { envValue: 'INTERNAL_TEST' } as const;
const ON = { envValue: 'INTERNAL_TEST', nonDeliveryXpEnvValue: 'INTERNAL_TEST', progressionEnvValue: 'INTERNAL_TEST' } as const;
const XP_OFF = { envValue: 'INTERNAL_TEST', nonDeliveryXpEnvValue: null, progressionEnvValue: 'INTERNAL_TEST' } as const;
const TRUCK_ID = 'truck-ford-cargo';
const DRIVER_A = 'driver-can-t';
const DRIVER_B = 'driver-ayse-d';
const WH = createCanonicalWarehouseId('izmir', 'standard');

function seedAccount(db: { dump: Dump }, uid: string, cash = 50_000_000) {
  db.dump.set(serverStateCurrentRef(uid), { cash, ownerUid: uid, sourceVersion: 1, migrationSource: 'default' });
  db.dump.set(`users/${uid}`, { money: 31_337 });
}
async function init(db: Firestore & { dump: Dump }, uid: string) {
  const r = await initializeCanonicalCompanyProgressionForNewAccount(db, uid, NOW, OP);
  if (!r.ok) throw new Error(r.reason);
}
function seedMarket(db: { dump: Dump }, cityId: string, productId: string, price: number) {
  db.dump.set(`canonicalWorldMarkets/${cityId}_${productId}`, {
    cityId,
    productId,
    stock: 10_000,
    currentPrice: price,
    basePrice: price,
    marketRevision: 1,
    authorityMode: 'INTERNAL_TEST_FIXTURE',
    lastUpdatedAtMs: NOW,
  });
}
function setPrice(db: { dump: Dump }, cityId: string, productId: string, price: number) {
  const path = `canonicalWorldMarkets/${cityId}_${productId}`;
  db.dump.set(path, { ...db.dump.get(path)!, currentPrice: price });
}
function prog(db: { dump: Dump }, uid: string) {
  return db.dump.get(canonicalCompanyProgressionPath(uid)) as unknown as CanonicalCompanyProgressionState;
}
function preceipt(db: { dump: Dump }, uid: string, id: string) {
  return db.dump.get(canonicalProgressionReceiptPath(uid, id));
}
function preceiptCount(db: { dump: Dump }, uid: string) {
  return [...db.dump.keys()].filter((k) => k.startsWith(`users/${uid}/canonicalProgressionReceipts/`)).length;
}
function cashTxCount(db: { dump: Dump }, uid: string) {
  return [...db.dump.keys()].filter((k) => k.startsWith(`users/${uid}/canonicalCashTransactions/`)).length;
}
function cash(db: { dump: Dump }, uid: string) {
  return Number(db.dump.get(serverStateCurrentRef(uid))?.cash);
}
function tradeXp(sell: number, avg: number, qty: number) {
  return calculateTradeSaleXp(calculateTradeProfit(sell, avg, qty, 100));
}

async function main(): Promise<void> {
  console.log('\n=== Map V2 Canonical Non-Delivery Company XP Authority (Step 29AH) ===\n');

  const store = read('src/store/gameStore.ts');
  const index = read('backend/src/index.ts');
  const rules = read('firestore.rules');
  const contractsScreen = read('src/screens/ContractsScreen.tsx');
  const xpBackend = read('backend/src/canonicalNonDeliveryCompanyXp.ts');
  const xpDomain = read('src/domain/canonicalNonDeliveryCompanyXp.ts');

  // A public save unchanged
  assert(store.includes("get().addCompanyXp(levelBalance.xpRewards.truckPurchase, 'truck_purchase')"), 'A public truck XP local');
  assert(store.includes("get().addCompanyXp(levelBalance.xpRewards.driverHire, 'driver_hire')"), 'A public hire XP local');
  assert(store.includes("get().addCompanyXp(levelBalance.xpRewards.warehouseOpen, 'warehouse_open')"), 'A public open XP local');
  assert(store.includes("get().addCompanyXp(levelBalance.xpRewards.warehouseUpgrade, 'warehouse_upgrade')"), 'A public upgrade XP local');
  assert(store.includes("get().addCompanyXp(xpGain, 'trade_sale')"), 'A public trade XP local');
  for (const [name, source] of [['store', store], ['ContractsScreen', contractsScreen]] as const) {
    assert(!/canonicalNonDeliveryCompanyXp|canonicalProgressionReceipts|canonicalCompanyProgression/.test(source), `A ${name} not wired`);
  }

  // B guest unchanged
  const guest = await purchaseCanonicalCatalogAssetTransaction(createMemoryFirestore(), '', TRUCK_ID, 'guest-buy01', 'TRUCK', NOW, ON);
  assert(!guest.ok && guest.reason === 'UNAUTHENTICATED', 'B guest purchase rejected');
  const guestHire = await hireCanonicalDriverTransaction(createMemoryFirestore(), '', DRIVER_A, 'guest-hire1', NOW, ON);
  assert(!guestHire.ok && guestHire.reason === 'UNAUTHENTICATED', 'B guest hire rejected');

  // C gate default OFF
  assert(isCanonicalNonDeliveryXpAllowed({ envValue: undefined }) === false, 'C missing OFF');
  assert(isCanonicalNonDeliveryXpAllowed({ envValue: null }) === false, 'C null OFF');
  assert(isCanonicalNonDeliveryXpAllowed({ envValue: 'ON' }) === false, 'C other OFF');
  assert(isCanonicalNonDeliveryXpAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'C INTERNAL_TEST');
  assert(
    (index.match(/nonDeliveryXpEnvValue: process\.env\.CANONICAL_NON_DELIVERY_XP_AUTHORITY/g) ?? []).length === 6,
    'C six callables read the XP env',
  );

  // D audit has no UNKNOWN
  assert(PRODUCTION_NON_DELIVERY_XP_AUDIT.length >= 19, 'D audit rows');
  assert(
    PRODUCTION_NON_DELIVERY_XP_AUDIT.every((row) => !Object.values(row).some((v) => String(v).includes('UNKNOWN'))),
    'D no UNKNOWN',
  );
  const auditStatus = (s: string) => PRODUCTION_NON_DELIVERY_XP_AUDIT.find((row) => row.source === s)?.status;
  assert(auditStatus('vehicle-lease') === 'VEHICLE_LEASE_NO_PRODUCTION_XP', 'D lease exact');
  assert(auditStatus('marketplace-purchase') === 'MARKETPLACE_PURCHASE_NO_PRODUCTION_XP', 'D marketplace exact');
  assert(auditStatus('vehicle-sale') === 'VEHICLE_SALE_NO_PRODUCTION_XP', 'D sale exact');
  assert(auditStatus('driver-fire') === 'DRIVER_FIRE_NO_PRODUCTION_XP', 'D fire exact');
  assert(auditStatus('cargo-buy') === 'CARGO_BUY_NO_PRODUCTION_XP', 'D cargo buy exact');
  assert(auditStatus('vehicle-recovery') === 'VEHICLE_RECOVERY_XP_BLOCKED_RECOVERY_AUTHORITY', 'D recovery exact');
  assert(auditStatus('operation-choice') === 'OPERATION_CHOICE_XP_CLIENT_OWNED', 'D op choice exact');
  assert(auditStatus('missions') === 'MISSION_XP_CLIENT_OWNED', 'D missions exact');

  // E–I exact production values
  assert(levelBalance.xpRewards.truckPurchase === 30 && levelConfig.xpRewards.truckPurchase === 30, 'E truck XP 30');
  assert(levelBalance.xpRewards.driverHire === 10, 'F hire XP 10');
  assert(levelBalance.xpRewards.warehouseOpen === 40, 'G open XP 40');
  assert(levelBalance.xpRewards.warehouseUpgrade === 25, 'H upgrade XP 25');
  assert(tradeXp(2000, 2000, 10) === 2, 'I loss sale 2');
  const evenAvg = (2000 * (1 - tradingBalance.warehouseSellFeeRate)) / (1 + tradingBalance.warehouseBuyFeeRate);
  assert(tradeXp(2000, evenAvg, 10) === 2, 'I break-even 2');
  assert(tradeXp(2150, 2000, 10) === 10, 'I small profit 10');
  assert(tradeXp(50_000, 2000, 100) === 100, 'I large profit clamp 100');
  assert(tradeXp(6000, 2000, 10) === Math.round(10 + calculateTradeProfit(6000, 2000, 10, 100) / 1500), 'I mid profit formula');

  // J cost basis
  assert(CANONICAL_CARGO_COST_BASIS_POLICY_VERSION === 'canonical-cargo-cost-basis-v1', 'J cost basis policy');

  // K / L client fields rejected
  for (const key of ['xp', 'xpDelta', 'experience', 'xpReward', 'tradeXp', 'purchaseXp', 'hireXp', 'warehouseXp', 'level', 'newLevel', 'totalXp']) {
    assert(containsForbiddenNonDeliveryXpClientKeys({ [key]: 999_999 }), `K ${key} forbidden`);
    assert(!hasOnlyCanonicalCatalogPurchaseKeys({ catalogModelId: TRUCK_ID, purchaseId: 'p-aaaa0001', assetType: 'TRUCK', canonicalSchemaVersion: 1, [key]: 1 }), `K purchase rejects ${key}`);
  }
  for (const key of ['profit', 'netProfit', 'costBasis', 'averageBuyPrice', 'unitPrice', 'price']) {
    assert(!hasOnlyCanonicalCargoSellKeys({ cityId: 'izmir', productId: 'steel', quantity: 5, warehouseId: WH, saleIntentId: 's-aaaa0001', canonicalSchemaVersion: 1, [key]: 1 }), `L sell rejects ${key}`);
  }
  assert((index.match(/containsForbiddenNonDeliveryXpClientKeys\(record\)/g) ?? []).length === 6, 'K/L callables reject XP keys');

  // M no generic XP callable
  assert(!/export const (addXp|addCompanyXp|grantXp|awardXp|applyXp|grantCompanyXp|addCanonicalXp)\b/i.test(index), 'M no generic XP callable');
  assert(!/export const [A-Za-z]*NonDeliveryXp[A-Za-z]* = onCall/.test(index), 'M no non-delivery XP callable');
  assert(!/onCall|export const .* = onCall/.test(xpBackend), 'M backend helper not a callable');

  // N–P purchase
  const db = createMemoryFirestore();
  const uid = 'xp-reg';
  seedAccount(db, uid);
  await init(db, uid);
  const buy1 = await purchaseCanonicalCatalogAssetTransaction(db, uid, TRUCK_ID, 'reg-truck-1', 'TRUCK', NOW, ON);
  assert(buy1.ok && buy1.progression.application === 'APPLIED' && prog(db, uid).totalXp === 30, 'N purchase grants once');
  const buyRetry = await purchaseCanonicalCatalogAssetTransaction(db, uid, TRUCK_ID, 'reg-truck-1', 'TRUCK', NOW + 1, ON);
  assert(buyRetry.ok && buyRetry.alreadyApplied && prog(db, uid).totalXp === 30, 'O purchase retry no duplicate');
  const poor = createMemoryFirestore();
  seedAccount(poor, 'poor', 10);
  await init(poor, 'poor');
  const poorBuy = await purchaseCanonicalCatalogAssetTransaction(poor, 'poor', TRUCK_ID, 'poor-truck1', 'TRUCK', NOW, ON);
  assert(!poorBuy.ok && prog(poor, 'poor').totalXp === 0 && preceiptCount(poor, 'poor') === 0, 'P purchase failure no XP');

  // Q–S hire
  const hire = await hireCanonicalDriverTransaction(db, uid, DRIVER_A, 'reg-hire-01', NOW, ON);
  assert(hire.ok && preceipt(db, uid, progressionDriverHireOperationId('reg-hire-01'))?.xpDelta === 10 && prog(db, uid).totalXp === 40, 'Q hire grants once');
  const hireRetry = await hireCanonicalDriverTransaction(db, uid, DRIVER_A, 'reg-hire-01', NOW, ON);
  assert(hireRetry.ok && hireRetry.alreadyApplied && prog(db, uid).totalXp === 40, 'R hire retry no duplicate');
  const hireDup = await hireCanonicalDriverTransaction(db, uid, DRIVER_A, 'reg-hire-02', NOW, ON);
  const hireBad = await hireCanonicalDriverTransaction(db, uid, 'driver-unknown', 'reg-hire-03', NOW, ON);
  assert(!hireDup.ok && !hireBad.ok && prog(db, uid).totalXp === 40, 'S hire failure no XP');

  // T–X warehouse
  const open = await openCanonicalWarehouseTransaction(db, uid, 'izmir', 'standard', 'reg-open-01', NOW, ON);
  assert(open.ok && preceipt(db, uid, progressionWarehouseOpenOperationId(WH))?.xpDelta === 40 && prog(db, uid).totalXp === 80, 'T open grants once');
  const openRetry = await openCanonicalWarehouseTransaction(db, uid, 'izmir', 'standard', 'reg-open-01', NOW, ON);
  const openDup = await openCanonicalWarehouseTransaction(db, uid, 'izmir', 'standard', 'reg-open-02', NOW, ON);
  assert(openRetry.ok && openRetry.alreadyApplied && !openDup.ok && prog(db, uid).totalXp === 80, 'U open retry/duplicate no XP');
  const up12 = await upgradeCanonicalWarehouseTransaction(db, uid, WH, 'reg-upgr-01', NOW, ON);
  assert(up12.ok && preceipt(db, uid, progressionWarehouseUpgradeOperationId(WH, 1, 2))?.xpDelta === 25 && prog(db, uid).totalXp === 105, 'V upgrade 1→2 exact');
  const up23 = await upgradeCanonicalWarehouseTransaction(db, uid, WH, 'reg-upgr-02', NOW, ON);
  assert(up23.ok && preceipt(db, uid, progressionWarehouseUpgradeOperationId(WH, 2, 3))?.xpDelta === 25 && prog(db, uid).totalXp === 130, 'W upgrade 2→3 exact');
  const upRetry = await upgradeCanonicalWarehouseTransaction(db, uid, WH, 'reg-upgr-02', NOW, ON);
  assert(upRetry.ok && upRetry.alreadyApplied && prog(db, uid).totalXp === 130, 'X upgrade retry no duplicate');

  // Y–AC cargo
  seedMarket(db, 'izmir', 'steel', 2000);
  const cargoBuy = await buyCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 20, WH, 'reg-cbuy-01', NOW, ON);
  assert(cargoBuy.ok && prog(db, uid).totalXp === 130, 'Y cargo buy grants no XP');
  const quotedPrice = 2000;
  setPrice(db, 'izmir', 'steel', 9000);
  const sale = await sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 10, WH, 'reg-sell-01', NOW, ON);
  const saleXp = tradeXp(9000, 2000, 10);
  const saleReceipt = preceipt(db, uid, progressionCargoSaleOperationId('reg-sell-01'));
  assert(sale.ok && saleReceipt?.xpDelta === saleXp && prog(db, uid).totalXp === 130 + saleXp, 'Y cargo sell XP exact');
  const saleRetry = await sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 10, WH, 'reg-sell-01', NOW, ON);
  assert(saleRetry.ok && saleRetry.alreadyApplied && prog(db, uid).totalXp === 130 + saleXp, 'Z cargo sell retry no duplicate');
  const saleFail = await sellCanonicalCargoTransaction(db, uid, 'izmir', 'steel', 500, WH, 'reg-sell-02', NOW, ON);
  assert(!saleFail.ok && preceipt(db, uid, progressionCargoSaleOperationId('reg-sell-02')) === undefined, 'AA cargo sell failure no XP');
  assert(saleXp !== tradeXp(quotedPrice, 2000, 10), 'AB quote price differs from committed price');
  assert((saleReceipt?.xpEvidence as Record<string, unknown>)?.sellUnitPrice === 9000, 'AB quote cannot control XP');
  assert(
    sale.ok && sale.receipt && (saleReceipt?.xpEvidence as Record<string, unknown>)?.cashTransactionId === sale.receipt.cashTransactionId,
    'AC committed sale receipt controls XP',
  );

  // AD–AI level semantics
  const lvl = prog(db, uid);
  const expectedLvl = applyCanonicalCompanyXp({ level: 1, xp: 0, xpToNextLevel: calculateXpToNextLevel(1), totalXp: 0 }, 130 + saleXp);
  assert(lvl.level === expectedLvl.level && lvl.xp === expectedLvl.xp && lvl.level >= 2, 'AD level crossing exact');
  const jump = applyCanonicalCompanyXp({ level: 1, xp: 0, xpToNextLevel: 100, totalXp: 0 }, 1000);
  assert(jump.newLevels.length >= 2, 'AE multi-level crossing semantics (single op max 100 XP cannot jump twice)');
  const maxDb = createMemoryFirestore();
  seedAccount(maxDb, 'maxu');
  await init(maxDb, 'maxu');
  const maxPath = canonicalCompanyProgressionPath('maxu');
  maxDb.dump.set(maxPath, { ...maxDb.dump.get(maxPath)!, level: 30, xp: 0, xpToNextLevel: calculateXpToNextLevel(30), totalXp: 900_000 });
  await purchaseCanonicalCatalogAssetTransaction(maxDb, 'maxu', TRUCK_ID, 'max-truck-1', 'TRUCK', NOW, ON);
  assert(prog(maxDb, 'maxu').level === 30 && prog(maxDb, 'maxu').xp === 0, 'AF max level exact');
  assert(prog(maxDb, 'maxu').totalXp === 900_030, 'AG totalXp exact at max');
  assert(lvl.totalXp === 130 + saleXp, 'AG totalXp exact');
  assert(lvl.reputation === 50, 'AH reputation unchanged');
  assert(lvl.progressionRevision === 1 + 6, 'AI progressionRevision exact (6 changing receipts)');
  const truckReceipt = preceipt(db, uid, progressionTruckPurchaseOperationId('reg-truck-1'))!;
  assert(
    truckReceipt.sourceType === 'COMPANY_TRUCK_PURCHASE' &&
      truckReceipt.xpDelta === 30 &&
      truckReceipt.reputationDelta === 0 &&
      (truckReceipt.xpEvidence as Record<string, unknown>).policyVersion === CANONICAL_NON_DELIVERY_XP_POLICY_VERSION &&
      (truckReceipt.xpEvidence as Record<string, unknown>).operationReceiptId === 'reg-truck-1' &&
      db.dump.has(`users/${uid}/canonicalPurchaseReceipts/reg-truck-1`),
    'AJ progression receipt exact and linked to operation receipt',
  );

  // AK conflict
  const cdb = createMemoryFirestore();
  seedAccount(cdb, 'conf');
  await init(cdb, 'conf');
  cdb.dump.set(canonicalProgressionReceiptPath('conf', progressionDriverHireOperationId('conf-hire1')), { xpDelta: 999_999 });
  const conflict = await hireCanonicalDriverTransaction(cdb, 'conf', DRIVER_A, 'conf-hire1', NOW, ON);
  assert(!conflict.ok && conflict.reason === NON_DELIVERY_XP_PROGRESSION_RECEIPT_CONFLICT && prog(cdb, 'conf').totalXp === 0 && cash(cdb, 'conf') === 50_000_000, 'AK receipt conflict fails closed');

  // AL–AO two-device
  const tdb = createMemoryFirestore();
  seedAccount(tdb, 'dev');
  await init(tdb, 'dev');
  seedMarket(tdb, 'izmir', 'steel', 2000);
  const [p1, p2] = await Promise.all([
    purchaseCanonicalCatalogAssetTransaction(tdb, 'dev', TRUCK_ID, 'dev-truck-1', 'TRUCK', NOW, ON),
    purchaseCanonicalCatalogAssetTransaction(tdb, 'dev', TRUCK_ID, 'dev-truck-1', 'TRUCK', NOW, ON),
  ]);
  assert(p1.ok && p2.ok && prog(tdb, 'dev').totalXp === 30, 'AL two-device purchase safe');
  const [h1, h2] = await Promise.all([
    hireCanonicalDriverTransaction(tdb, 'dev', DRIVER_B, 'dev-hire-01', NOW, ON),
    hireCanonicalDriverTransaction(tdb, 'dev', DRIVER_B, 'dev-hire-02', NOW, ON),
  ]);
  assert([h1, h2].filter((r) => r.ok).length === 1 && prog(tdb, 'dev').totalXp === 40, 'AM two-device hire safe');
  const [o1, o2] = await Promise.all([
    openCanonicalWarehouseTransaction(tdb, 'dev', 'izmir', 'standard', 'dev-open-01', NOW, ON),
    openCanonicalWarehouseTransaction(tdb, 'dev', 'izmir', 'standard', 'dev-open-02', NOW, ON),
  ]);
  assert([o1, o2].filter((r) => r.ok).length === 1 && prog(tdb, 'dev').totalXp === 80, 'AN two-device warehouse safe');
  await buyCanonicalCargoTransaction(tdb, 'dev', 'izmir', 'steel', 10, WH, 'dev-cbuy-01', NOW, ON);
  setPrice(tdb, 'izmir', 'steel', 9000);
  const [s1, s2] = await Promise.all([
    sellCanonicalCargoTransaction(tdb, 'dev', 'izmir', 'steel', 10, WH, 'dev-sell-01', NOW, ON),
    sellCanonicalCargoTransaction(tdb, 'dev', 'izmir', 'steel', 10, WH, 'dev-sell-02', NOW, ON),
  ]);
  assert([s1, s2].filter((r) => r.ok).length === 1 && prog(tdb, 'dev').totalXp === 80 + tradeXp(9000, 2000, 10), 'AO two-device cargo sell safe');

  // AP old operation not granted
  const hdb = createMemoryFirestore();
  seedAccount(hdb, 'hist');
  await init(hdb, 'hist');
  await purchaseCanonicalCatalogAssetTransaction(hdb, 'hist', TRUCK_ID, 'hist-truck1', 'TRUCK', NOW, XP_OFF);
  const histReplay = await purchaseCanonicalCatalogAssetTransaction(hdb, 'hist', TRUCK_ID, 'hist-truck1', 'TRUCK', NOW, ON);
  assert(histReplay.ok && histReplay.progression.application === NON_DELIVERY_XP_HISTORICAL_OPERATION_UNAPPLIED && prog(hdb, 'hist').totalXp === 0, 'AP old operation not retroactively granted');

  // AQ legacy progression not imported
  const ldb = createMemoryFirestore();
  seedAccount(ldb, 'legacy');
  ldb.dump.set('users/legacy/saves/current', { player: { level: 12, xp: 400 } });
  const legacyInit = await initializeCanonicalCompanyProgressionForNewAccount(ldb, 'legacy', NOW, OP);
  assert(!legacyInit.ok && legacyInit.reason === 'CANONICAL_PROGRESSION_LEGACY_SAVE_PRESENT', 'AQ legacy save blocks init');
  ldb.dump.set(canonicalCompanyProgressionPath('legacy'), { authorityClass: 'LEGACY_CLIENT_UNVERIFIED', level: 12 });
  const legacyBuy = await purchaseCanonicalCatalogAssetTransaction(ldb, 'legacy', TRUCK_ID, 'legacy-trk1', 'TRUCK', NOW, ON);
  assert(legacyBuy.ok && legacyBuy.progression.application === 'NOT_APPLIED_NOT_SERVER_CANONICAL' && ldb.dump.get(canonicalCompanyProgressionPath('legacy'))?.level === 12, 'AQ legacy progression not imported or mutated');

  // AR save tampering
  const sdb = createMemoryFirestore();
  seedAccount(sdb, 'tamper');
  await init(sdb, 'tamper');
  sdb.dump.set('users/tamper/saves/current', { player: { level: 30, xp: 999_999, totalXp: 9_999_999 } });
  await purchaseCanonicalCatalogAssetTransaction(sdb, 'tamper', TRUCK_ID, 'tamp-truck1', 'TRUCK', NOW, ON);
  assert(prog(sdb, 'tamper').level === 1 && prog(sdb, 'tamper').totalXp === 30, 'AR local save tampering ignored');

  // AS / AT batch frozen, refresh uses level
  const edb = createMemoryFirestore();
  const euid = 'xp-e2e';
  edb.dump.set(`users/${euid}/canonicalFleetAssets/truck-1`, { assetType: 'TRUCK', capacity: 25, lifecycleStatus: 'ACTIVE', ownerUid: euid });
  edb.dump.set(`users/${euid}/canonicalFleetRuntime/truck-1`, createInternalFixtureRuntime({ assetId: 'truck-1', ownerUid: euid, serverNowMs: NOW }) as unknown as Record<string, unknown>);
  for (const city of CITIES) {
    for (const productId of PRODUCT_IDS) {
      const quote = deriveCanonicalProductionMarketQuote(100, city.id, productId);
      edb.dump.set(`canonicalWorldMarkets/${city.id}_${productId}`, {
        cityId: city.id,
        productId,
        stock: 1,
        tradableStock: 1,
        epochSupply: quote?.epochSupply ?? 0,
        currentPrice: quote?.price ?? city.products[productId].basePrice,
        targetStock: city.products[productId].targetStock,
        marketRevision: 1,
        lastAppliedTickIndex: 100,
      });
    }
  }
  edb.dump.set('globalEconomy/current', { fuelPricePerLiter: 1.72 });
  seedAccount(edb, euid);
  await init(edb, euid);
  const gates = {
    envValue: 'INTERNAL_TEST',
    runtimeEnvValue: 'INTERNAL_TEST',
    eventEnvValue: 'INTERNAL_TEST',
    expiryEnvValue: 'INTERNAL_TEST',
    refreshEnvValue: 'INTERNAL_TEST',
    progressionEnvValue: 'INTERNAL_TEST',
  } as const;
  const batch = await generateCanonicalProductionRoadBatchTransaction(edb, euid, NOW, gates);
  const batchPath = batch.ok ? `users/${euid}/canonicalRoadContractBatches/${batch.batchId}` : '';
  await hireCanonicalDriverTransaction(edb, euid, DRIVER_A, 'e2e-hire-01', NOW, ON);
  await openCanonicalWarehouseTransaction(edb, euid, 'izmir', 'standard', 'e2e-open-01', NOW, ON);
  await upgradeCanonicalWarehouseTransaction(edb, euid, WH, 'e2e-upgr-01', NOW, ON);
  await upgradeCanonicalWarehouseTransaction(edb, euid, WH, 'e2e-upgr-02', NOW, ON);
  assert(prog(edb, euid).level === 2, 'AT progression reached level 2 via non-delivery XP');
  assert(batch.ok && edb.dump.get(batchPath)?.playerLevel === 1, 'AS existing batch remains frozen');
  const refreshed = await generateCanonicalProductionRoadBatchTransaction(edb, euid, NOW + 3 * HOUR_MS, { ...gates, refreshIntentId: 'xp-refresh-1' });
  assert(refreshed.ok && edb.dump.get(`users/${euid}/canonicalRoadContractBatches/${refreshed.batchId}`)?.playerLevel === 2, 'AT next refresh uses new level');

  // AU / AV delivery XP and ROAD reputation unchanged
  const deliveryXp = deriveCanonicalRoadCompletionXp({ distanceKm: 450, netProfit: 12_000, riskTier: 'medium' });
  assert(deliveryXp.ok && deliveryXp.xp === calculateDeliveryXp(450, 12_000, 'medium'), 'AU delivery XP from 29AG unchanged');
  const rep = deriveCanonicalRoadCompletionReputation({ band: 'ON_TIME', actualTravelHours: 10, deadlineHours: 20, plannedTravelGameHours: 10, contractType: 'standard' });
  assert(rep.ok && rep.delta === REPUTATION_RULES.deliveryOnTime, 'AV ROAD reputation unchanged');

  // AW no duplicate cash transaction
  assert(cashTxCount(db, uid) === 1 + 1 + 1 + 2 + 1 + 1, 'AW one cash transaction per operation');
  assert(![...db.dump.keys()].some((k) => k.includes('/canonicalCashTransactions/progression')), 'AW XP writes no cash transaction');
  assert(!/applyCanonicalCashMutations|serverState|\.cash\b|financeLedger/.test(xpBackend), 'AW XP helper touches no cash');
  assert(!/player\.money|financeLedger|canonicalCashTransactions/.test(xpDomain), 'AW XP domain touches no cash');
  assert(db.dump.get(`users/${uid}`)?.money === 31_337, 'AW users money unchanged');

  // AX–BE invariants
  assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AX cashAuthorityVersion 0');
  assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AY HUD overlay off');
  assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AZ cash listener off');
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
  const coverage = getSignedInCashAuthorityCoverage();
  assert(coverage.criticalSignedInCashPathsTotal === 24, 'BB coverage total 24');
  assert(coverage.criticalCanonicalizedCount === 0, 'BB coverage canonical 0');
  assert(coverage.criticalBlockedCount === 24, 'BB coverage blocked 24');
  assert(SAVE_GAME_VERSION === 6, 'BC SAVE_GAME_VERSION 6');
  assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'BD rail');
  assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'BD sea');
  assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'BD air');
  assert(resolveMultimodalFeatureRollout(null) === 'MULTIMODAL_OFF', 'BE multimodal off');

  // readiness + rules + quality/cost-basis blockers
  assert(CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY_STATUS === 'CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY_PASS_PARTIAL', 'status PASS_PARTIAL');
  assert(CANONICAL_NON_DELIVERY_OPERATION_XP_READINESS === 'NON_DELIVERY_XP_INTERNAL_PARTIAL', 'operation XP readiness partial');
  assert(CANONICAL_NON_DELIVERY_ALL_SOURCES_XP_READINESS === 'NON_DELIVERY_XP_BLOCKED_MISSIONS', 'all-source readiness missions');
  assert(CANONICAL_PROGRESSION_READINESS === 'CANONICAL_PROGRESSION_BLOCKED_UNSUPPORTED_REWARD_PROGRESS', 'progression readiness narrowed (Step 29AI)');
  assert(!(CANONICAL_PROGRESSION_REMAINING_CLIENT_XP_SOURCES as readonly string[]).includes('truck-purchase'), 'truck purchase no longer client-only for canonical');
  assert(ROAD_CONTRACT_ISSUANCE_READINESS === 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION', 'issuance readiness unchanged');
  assert(PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('COMPANY_XP_CLIENT_REWARD_SOURCES_INTERNAL_PARTIAL'), 'issuance blocker narrowed (Step 29AI)');
  assert(/match \/canonicalProgressionReceipts\/\{receiptId\} \{\s*allow read: if isOwner\(userId\);\s*allow write: if false;/.test(rules), 'rules progression receipts server-only');
  assert(/match \/canonicalCargoInventory\/\{inventoryId\} \{\s*allow read: if isOwner\(userId\);\s*allow write: if false;/.test(rules), 'rules cargo inventory server-only');
  const qdb = createMemoryFirestore();
  seedAccount(qdb, 'qual');
  await init(qdb, 'qual');
  await openCanonicalWarehouseTransaction(qdb, 'qual', 'izmir', 'standard', 'qual-open-1', NOW, ON);
  seedMarket(qdb, 'izmir', 'electronics', 4000);
  await buyCanonicalCargoTransaction(qdb, 'qual', 'izmir', 'electronics', 5, WH, 'qual-buy-01', NOW, ON);
  await sellCanonicalCargoTransaction(qdb, 'qual', 'izmir', 'electronics', 5, WH, 'qual-sell-1', NOW, ON);
  assert(preceipt(qdb, 'qual', progressionCargoSaleOperationId('qual-sell-1'))?.xpAuthority === CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY, 'decaying cargo blocked on quality');
  seedMarket(qdb, 'izmir', 'steel', 2000);
  await buyCanonicalCargoTransaction(qdb, 'qual', 'izmir', 'steel', 5, WH, 'qual-buy-02', NOW, XP_OFF);
  await sellCanonicalCargoTransaction(qdb, 'qual', 'izmir', 'steel', 5, WH, 'qual-sell-2', NOW, ON);
  assert(preceipt(qdb, 'qual', progressionCargoSaleOperationId('qual-sell-2'))?.xpAuthority === CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY, 'pre-policy inventory blocked on cost basis');

  if (fail > 0) {
    console.error(`\nFAILED ${fail} / ${pass + fail}`);
    process.exit(1);
  }
  console.log(`OK ${pass} assertions`);
  console.log(
    JSON.stringify({
      CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY_STATUS,
      NON_DELIVERY_XP_POLICY: CANONICAL_NON_DELIVERY_XP_POLICY_VERSION,
      COST_BASIS_POLICY: CANONICAL_CARGO_COST_BASIS_POLICY_VERSION,
      OPERATION_XP_READINESS: CANONICAL_NON_DELIVERY_OPERATION_XP_READINESS,
      ALL_SOURCES_XP_READINESS: CANONICAL_NON_DELIVERY_ALL_SOURCES_XP_READINESS,
      PROGRESSION_READINESS: CANONICAL_PROGRESSION_READINESS,
      ISSUANCE_READINESS: ROAD_CONTRACT_ISSUANCE_READINESS,
      CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
      CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
      CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
    }),
  );
}

void main();
