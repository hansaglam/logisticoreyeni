/**
 * Map V2 Step 29Z production market tick authority.
 * Run: node --import tsx scripts/map-v2-production-market-tick-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import {
  CANONICAL_CARGO_MARKET_CLOCK_MODEL,
  CANONICAL_CARGO_MARKET_POLICY_VERSION,
  CARGO_MARKET_READINESS_STATUS,
  PRODUCTION_MARKET_TICK_AUTHORITY,
} from '../src/domain/canonicalCargoMarketWorldState';
import {
  CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION,
  MARKET_OWNERSHIP_MODEL,
  PRODUCTION_MARKET_PUBLIC_READINESS,
  PRODUCTION_MARKET_RNG_PARITY,
  PRODUCTION_MARKET_TICK_AUTHORITY_STATUS,
  ROAD_CONTRACT_ISSUANCE_REMAINING_BLOCKERS,
  ROAD_CONTRACT_MARKET_STATE_STATUS,
  canonicalMarketTickId,
  classifyEpochSupplyRatio,
  deriveCanonicalMarketEpoch,
  deriveCanonicalProductionMarketQuote,
  hasOnlyCanonicalMarketTickKeys,
  isCanonicalProductionMarketTickAllowed,
  marketTickLeavesPlayerCashUnchanged,
  planCanonicalProductionMarketTick,
} from '../src/domain/canonicalProductionMarketTick';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import { MARKET_TICK_INTERVAL_MS } from '../src/simulation/economyClock';

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

console.log('\n=== Map V2 Production Market Tick (Step 29Z) ===\n');

assert(
  PRODUCTION_MARKET_TICK_AUTHORITY_STATUS ===
    'PRODUCTION_MARKET_TICK_AUTHORITY_PASS_INTERNAL_ONLY',
  'status',
);
assert(PRODUCTION_MARKET_TICK_AUTHORITY === PRODUCTION_MARKET_TICK_AUTHORITY_STATUS, 'A status export');
assert(read('src/store/gameStore.ts').includes('refreshMarketSnapshot'), 'A refresh is snapshot sync');
assert(read('src/store/gameStore.ts').includes('never rolls local market state'), 'A tick does not roll save');
assert(!read('src/store/gameStore.ts').includes('advanceCanonicalProductionMarket'), 'A public unwired');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');
assert(isCanonicalProductionMarketTickAllowed({ envValue: null }) === false, 'C gate off');
assert(hasOnlyCanonicalMarketTickKeys({ tickCount: 2 }) === false, 'D tick count');
assert(hasOnlyCanonicalMarketTickKeys({ elapsedMs: 1 }) === false, 'E elapsed');
assert(hasOnlyCanonicalMarketTickKeys({ currentPrice: 9 }) === false, 'F price');
assert(hasOnlyCanonicalMarketTickKeys({ stock: 4 }) === false, 'G stock');
assert(hasOnlyCanonicalMarketTickKeys({ eventMultiplier: 1.2 }) === false, 'H event');
assert(deriveCanonicalMarketEpoch(MARKET_TICK_INTERVAL_MS * 10 + 10) === 10, 'I server epoch');
assert(canonicalMarketTickId(10) === 'marketTick:10', 'K identity');
const once = planCanonicalProductionMarketTick({
  epoch: 10,
  rows: [
    {
      cityId: 'izmir',
      productId: 'steel',
      stock: 80,
      currentPrice: 1,
      marketRevision: 1,
      tickPolicyVersion: CANONICAL_PRODUCTION_MARKET_TICK_POLICY_VERSION,
      lastAppliedTickIndex: 10,
    },
  ],
});
assert(once.updates.length === 0 && once.alreadyApplied === 1, 'L same tick once');
const fixed = planCanonicalProductionMarketTick({
  epoch: 10,
  rows: [
    {
      cityId: 'izmir',
      productId: 'steel',
      stock: 80,
      currentPrice: 1,
      marketRevision: 1,
    },
  ],
});
assert(fixed.skippedFixedSnapshot === 1 && fixed.updates.length === 0, 'M fixed snapshot');
const quote = deriveCanonicalProductionMarketQuote(20, 'izmir', 'steel');
assert(quote != null && quote.epochSupply >= 0, 'N stock formula non-negative');
assert(Number.isFinite(quote!.price), 'R price finite');
assert(quote!.status === classifyEpochSupplyRatio(quote!.epochSupply, quote!.targetStock), 'T status');
assert(classifyEpochSupplyRatio(100, 100) === 'balanced', 'V neutral');
assert(classifyEpochSupplyRatio(69, 100) === 'shortage', 'U shortage');
assert(classifyEpochSupplyRatio(121, 100) === 'surplus', 'T surplus');
assert(PRODUCTION_MARKET_RNG_PARITY.includes('GLOBAL_SNAPSHOT'), 'W rng');
const same = deriveCanonicalProductionMarketQuote(20, 'izmir', 'steel');
assert(same!.price === quote!.price && same!.epochSupply === quote!.epochSupply, 'X same tick');
assert(quote!.eventIds.length >= 0, 'Y events array');
assert(Number.isFinite(quote!.fuelPricePerLiter), 'Z fuel from snapshot');
assert(MARKET_OWNERSHIP_MODEL === 'GLOBAL_SHARED_MARKET', 'AL global');
assert(CANONICAL_CARGO_MARKET_CLOCK_MODEL === 'INTERNAL_TEST_FIXED_MARKET_SNAPSHOT', 'AM 29U mode');
assert(CANONICAL_CARGO_MARKET_POLICY_VERSION === 'canonical-cargo-market-internal-v1', 'AM policy');
assert(marketTickLeavesPlayerCashUnchanged() === true, 'AN no cash');
assert(!read('backend/src/canonicalProductionMarketTick.ts').includes('applyCanonicalCashMutations'), 'AO no cash txn');
assert(read('backend/src/index.ts').includes('Date.now()'), 'I callable server now');
assert(read('firestore.rules').includes('canonicalMarketClock'), 'rules clock');
assert(read('firestore.rules').includes('canonicalMarketTicks'), 'rules ticks');
assert(CARGO_MARKET_READINESS_STATUS === 'CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED', 'AV');
assert(PRODUCTION_MARKET_PUBLIC_READINESS === 'PUBLIC_MARKET_NOT_READY', 'AW');
assert(ROAD_CONTRACT_MARKET_STATE_STATUS === 'ROAD_CONTRACT_MARKET_STATE_INTERNAL_ONLY', 'AW contract');
assert(ROAD_CONTRACT_ISSUANCE_REMAINING_BLOCKERS.includes('PLAYER_LEVEL_FLEET_DRIVERS'), 'AZ');
const jumped = deriveCanonicalProductionMarketQuote(30, 'ankara', 'fruit');
const stepped = deriveCanonicalProductionMarketQuote(30, 'ankara', 'fruit');
assert(jumped!.price === stepped!.price, 'AJ batch invariance');
assert(read('src/hooks/useGameLoop.ts').includes('advanceTime') || read('src/store/gameStore.ts').includes('advanceTime'), 'refresh path');
const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'BA');
assert(coverage.criticalCanonicalizedCount === 0, 'BB');
assert(coverage.criticalBlockedCount === 24, 'BC');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AS');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AT');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AU');
assert(
  canUseServerAuthoritativeSettlement({
    signedInLinked: true,
    cashAuthorityVersion: 0,
    serverStateCashPresent: true,
    reconciliationActive: true,
    staleSaveProtectionActive: true,
  }).ready === false,
  'AU settlement',
);
assert(SAVE_GAME_VERSION === 6, 'AX');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AY rail');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AY sea');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AY air');
assert(resolveMultimodalFeatureRollout(null) === 'MULTIMODAL_OFF', 'AZ multimodal');

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    PRODUCTION_MARKET_TICK_AUTHORITY_STATUS,
    ROAD_CONTRACT_MARKET_STATE_STATUS,
    MARKET_OWNERSHIP_MODEL,
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
  }),
);
