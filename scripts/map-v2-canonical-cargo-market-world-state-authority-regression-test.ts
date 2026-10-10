/**
 * Map V2 Step 29U canonical cargo market / world-state authority.
 * Run: node --import tsx scripts/map-v2-canonical-cargo-market-world-state-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  CANONICAL_CARGO_MARKET_POLICY_VERSION,
  CANONICAL_CARGO_MARKET_WORLD_STATE_AUTHORITY_STATUS,
  CANONICAL_ROAD_CONTRACT_WORLD_STATE,
  CARGO_MARKET_READINESS_STATUS,
  LEGACY_CARGO_INVENTORY,
  NO_AUTOMATIC_LEGACY_CARGO_MIGRATION,
  PRODUCTION_MARKET_TICK_AUTHORITY,
  WORLD_EVENT_PRICE_PARITY,
  createCanonicalCargoBuyTransactionId,
  createCanonicalCargoSellTransactionId,
  deriveCanonicalBuyTotal,
  deriveCanonicalSellTotal,
  hasOnlyCanonicalCargoBuyKeys,
  hasOnlyCanonicalCargoSellKeys,
  isCanonicalCargoCityId,
  isCanonicalCargoMarketAllowed,
  isCanonicalCargoProductId,
} from '../src/domain/canonicalCargoMarketWorldState';
import { CARGO_BUY_CASH_STATUS, CARGO_SELL_CASH_STATUS } from '../src/domain/remainingRoadCashPathCanonicalization';
import { DAILY_OPEX_READINESS_STATUS, OVERDRAFT_OPEX_AUTHORITY } from '../src/domain/canonicalDailyOpexStaffState';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  UNIFIED_CASH_BLOCK_REASON,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import { CITIES_BY_ID } from '../src/data/cities';
import { PRODUCT_IDS } from '../src/data/products';
import { toProductMarket } from '../src/simulation/economy';

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

console.log('\n=== Map V2 Canonical Cargo Market World State (Step 29U) ===\n');

assert(
  CANONICAL_CARGO_MARKET_WORLD_STATE_AUTHORITY_STATUS ===
    'CANONICAL_CARGO_MARKET_WORLD_STATE_AUTHORITY_PASS_INTERNAL_POLICY_ONLY',
  'status',
);
assert(read('src/store/gameStore.ts').includes('buyProductForWarehouse:'), 'A public buy');
assert(read('src/store/gameStore.ts').includes('sellProductFromWarehouse:'), 'A public sell');
assert(!read('src/store/gameStore.ts').includes('buyCanonicalCargo'), 'A unwired buy');
assert(!read('src/screens/MapScreen.tsx').includes('buyCanonicalCargo'), 'A MapScreen unwired');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');
assert(isCanonicalCargoMarketAllowed({ envValue: null }) === false, 'C gate off');
assert(isCanonicalCargoMarketAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'C internal');
assert(isCanonicalCargoProductId('steel') === true, 'D product');
assert(isCanonicalCargoProductId('uranium') === false, 'D unknown product');
assert(isCanonicalCargoCityId('izmir') === true, 'E city');
assert(isCanonicalCargoCityId('paris') === false, 'E unknown city');
assert(read('backend/src/canonicalCargoMarket.ts').includes('bootstrapInternalCanonicalCargoMarketTransaction'), 'F bootstrap');
assert(
  hasOnlyCanonicalCargoBuyKeys({
    cityId: 'izmir',
    productId: 'steel',
    quantity: 5,
    warehouseId: 'wh_izmir_standard',
    purchaseIntentId: 'buy-aaaa1',
    canonicalSchemaVersion: 1,
    price: 9,
  }) === false,
  'G client price',
);
assert(
  hasOnlyCanonicalCargoBuyKeys({
    cityId: 'izmir',
    productId: 'steel',
    quantity: 5,
    warehouseId: 'wh_izmir_standard',
    purchaseIntentId: 'buy-aaaa1',
    canonicalSchemaVersion: 1,
    stock: 1,
  }) === false,
  'H client stock',
);
assert(
  hasOnlyCanonicalCargoSellKeys({
    cityId: 'izmir',
    productId: 'steel',
    quantity: 5,
    warehouseId: 'wh_izmir_standard',
    saleIntentId: 'sell-aaa1',
    canonicalSchemaVersion: 1,
    demand: 1,
  }) === false,
  'I client demand',
);
assert(LEGACY_CARGO_INVENTORY === 'LEGACY_CARGO_INVENTORY_UNVERIFIED', 'J legacy');
assert(NO_AUTOMATIC_LEGACY_CARGO_MIGRATION.includes('NO_AUTOMATIC'), 'J no import');
assert(read('src/domain/canonicalCargoMarketWorldState.ts').includes("canonicalCargoInventory"), 'K inventory path');
assert(read('backend/src/canonicalCargoMarket.ts').includes('INSUFFICIENT_CAPACITY'), 'L capacity');
assert(read('src/domain/canonicalCargoMarketWorldState.ts').includes('sumCanonicalWarehouseOccupiedTons'), 'M occupancy tons');
const unit = Math.round(toProductMarket(CITIES_BY_ID.izmir!.products.steel).currentPrice);
assert(Number.isSafeInteger(unit) && unit > 0, 'N unit');
assert(deriveCanonicalBuyTotal(unit, 5) === Math.round(unit * 5 * 1.03), 'O buy total');
assert(read('backend/src/canonicalCargoMarket.ts').includes("operationType: 'CANONICAL_CARGO_BUY'"), 'P debit');
assert(read('backend/src/canonicalCargoMarket.ts').includes('stock: market.stock - qty.quantity'), 'Q stock down');
assert(read('backend/src/canonicalCargoMarket.ts').includes('inventoryAfter = inventoryBefore + qty.quantity'), 'R inventory up');
assert(read('src/domain/canonicalCargoMarketWorldState.ts').includes('canonicalCargoMarketReceipts'), 'S receipt');
assert(
  createCanonicalCargoBuyTransactionId('izmir', 'steel', 'buy-steel1') ===
    'cargo:izmir:steel:buy:buy-steel1',
  'T id',
);
assert(read('backend/src/canonicalCargoMarket.ts').includes('alreadyApplied: true'), 'T retry');
assert(read('backend/src/canonicalCashTransaction.ts').includes('INSUFFICIENT_CASH'), 'U cash');
assert(read('backend/src/canonicalCargoMarket.ts').includes('INSUFFICIENT_STOCK'), 'V stock');
assert(read('backend/src/canonicalCargoMarket.ts').includes('INSUFFICIENT_CAPACITY'), 'W capacity');
assert(deriveCanonicalSellTotal(unit, 5) === Math.round(unit * 5 * 0.97), 'X sell total');
assert(read('backend/src/canonicalCargoMarket.ts').includes("operationType: 'CANONICAL_CARGO_SELL'"), 'Z sell credit');
assert(read('backend/src/canonicalCargoMarket.ts').includes('stock: market.stock + qty.quantity'), 'AA stock up');
assert(read('backend/src/canonicalCargoMarket.ts').includes('inventoryAfter = inventory.quantity - qty.quantity'), 'AB inventory down');
assert(
  createCanonicalCargoSellTransactionId('izmir', 'steel', 'sell-steel1') ===
    'cargo:izmir:steel:sell:sell-steel1',
  'AJ sell id',
);
assert(read('backend/src/canonicalCargoMarket.ts').includes('INSUFFICIENT_INVENTORY'), 'AN oversell');
assert(read('backend/src/canonicalCargoMarket.ts').includes('marketRevision + 1'), 'AH revision');
assert(read('backend/src/canonicalCargoMarket.ts').includes('inventoryRevision'), 'AI inv rev');
assert(read('src/domain/canonicalCargoMarketWorldState.ts').includes('quoteCanonicalCargoTrade'), 'AJ quote');
assert(read('backend/src/canonicalCargoMarket.ts').includes('unitPrice = market.currentPrice'), 'AK txn price');
assert(read('src/domain/canonicalCargoMarketWorldState.ts').includes('warehouseOpexUnchangedByInventory'), 'AL opex');
assert(!read('backend/src/canonicalCargoMarket.ts').includes('users/{uid}.money'), 'AM no profile');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AQ overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AR listener');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AS version');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(gate.ready === false && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AT settlement');
assert(OVERDRAFT_OPEX_AUTHORITY === 'CANONICAL_MANDATORY_EXPENSE_PARITY', 'AU overdraft');
assert(DAILY_OPEX_READINESS_STATUS === 'DAILY_OPEX_INTERNAL_CLOCK_ONLY_LEGACY_STATE_BLOCKED', 'AU opex');
assert(SAVE_GAME_VERSION === 6, 'AV v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AW RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AW SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AW AIR');
assert(resolveMultimodalFeatureRollout({ envValue: null }) === 'MULTIMODAL_OFF', 'AX OFF');
assert(
  PRODUCTION_MARKET_TICK_AUTHORITY === 'PRODUCTION_MARKET_TICK_AUTHORITY_PASS_INTERNAL_ONLY',
  'tick',
);
assert(WORLD_EVENT_PRICE_PARITY === 'WORLD_EVENT_PRICE_AUTHORITY_INTERNAL_EPOCH_SCHEDULE', 'events');
assert(CANONICAL_ROAD_CONTRACT_WORLD_STATE === 'ROAD_CONTRACT_MARKET_STATE_INTERNAL_ONLY', 'contracts');
assert(CARGO_MARKET_READINESS_STATUS === 'CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED', 'BG');
assert(CARGO_BUY_CASH_STATUS === CARGO_MARKET_READINESS_STATUS, 'buy align');
assert(CARGO_SELL_CASH_STATUS === CARGO_MARKET_READINESS_STATUS, 'sell align');
assert(CANONICAL_CARGO_MARKET_POLICY_VERSION === 'canonical-cargo-market-internal-v1', 'policy');
assert(PRODUCT_IDS.length === 7, '7 products');
assert(read('firestore.rules').includes('canonicalWorldMarkets'), 'rules markets');
assert(read('firestore.rules').includes('canonicalCargoInventory'), 'rules inventory');
assert(!read('backend/src/index.ts').includes('export const settleCanonicalMultimodalShipment'), 'no multimodal');
assert(!read('backend/src/canonicalCargoMarket.ts').includes('importMarketFromSave'), 'no import');

const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'BH 24');
assert(coverage.criticalCanonicalizedCount === 0, 'BI 0');
assert(coverage.criticalBlockedCount === 24, 'BJ 24');
assert(coverage.readiness === 'SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS', 'BK');
assert(coverage.rows.find((row) => row.auditId === 'cargo-buy')?.hudRole === 'BLOCKS_HUD_AUTHORITY', 'HUD buy');
assert(
  coverage.rows.find((row) => row.auditId === 'cargo-buy')?.authorityStatus ===
    'CANONICAL_READY_WITH_SMALL_PORT',
  'internal small port',
);

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    CANONICAL_CARGO_MARKET_WORLD_STATE_AUTHORITY_STATUS,
    CARGO_MARKET_READINESS_STATUS,
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
  }),
);
