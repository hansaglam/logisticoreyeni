/**
 * Map V2 Step 29AA production ROAD contract issuance parity.
 * Run: node --import tsx scripts/map-v2-production-road-contract-issuance-parity-regression-test.ts
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
import { CARGO_MARKET_READINESS_STATUS } from '../src/domain/canonicalCargoMarketWorldState';
import { CANONICAL_ROAD_ISSUANCE_POLICY_VERSION } from '../src/domain/canonicalRoadContract';
import {
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
  PRODUCTION_CONTRACT_RNG_PARITY,
  PRODUCTION_ROAD_CONTRACT_ISSUANCE_PARITY_STATUS,
  PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS,
  ROAD_CONTRACT_ISSUANCE_READINESS,
  canonicalProductionRoadOfferId,
  generateCanonicalProductionRoadOffers,
  hasOnlyCanonicalProductionRoadIssuanceKeys,
  isCanonicalProductionRoadIssuanceAllowed,
  issuanceLeavesMarketStockUnchanged,
  issuanceLeavesPlayerCashUnchanged,
} from '../src/domain/canonicalProductionRoadContractIssuance';
import { contractBalance } from '../src/config/balance';
import { getSignedInCashAuthorityCoverage } from '../src/domain/signedInCashAuthorityCoverage';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { resolveMultimodalFeatureRollout } from '../src/domain/multimodalFeatureRollout';
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

console.log('\n=== Map V2 Production ROAD Contract Issuance (Step 29AA) ===\n');

assert(
  PRODUCTION_ROAD_CONTRACT_ISSUANCE_PARITY_STATUS ===
    'PRODUCTION_ROAD_CONTRACT_ISSUANCE_PARITY_PASS_INTERNAL_ONLY',
  'status',
);
assert(read('src/store/gameStore.ts').includes('replenishContractsIfNeeded'), 'A replenish remains local');
assert(!read('src/store/gameStore.ts').includes('generateCanonicalProductionRoad'), 'A unwired');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');
assert(isCanonicalProductionRoadIssuanceAllowed({ envValue: null }) === false, 'C gate');
assert(CANONICAL_ROAD_ISSUANCE_POLICY_VERSION === 'canonical-road-contract-issuance-internal-v1', 'D old policy');
assert(read('src/domain/canonicalProductionRoadContractIssuance.ts').includes('generateContracts'), 'E production generator');
assert(read('src/domain/canonicalProductionRoadContractIssuance.ts').includes('epochSupply'), 'F epoch supply');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ stock: 1 }) === false, 'G stock');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ currentPrice: 2 }) === false, 'H price');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ eventMultiplier: 1 }) === false, 'I events');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ playerLevel: 4 }) === false, 'J level');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ fleetCapacity: 20 }) === false, 'K fleet');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ driverCount: 1 }) === false, 'L driver');
assert(hasOnlyCanonicalProductionRoadIssuanceKeys({ seed: 'no' }) === false, 'M seed');
assert(PRODUCTION_CONTRACT_RNG_PARITY.includes('DIFFERENT_SEQUENCE'), 'N rng');
assert(contractBalance.maxContractsPerTick === 10, 'AB count');
assert(ROAD_CONTRACT_ISSUANCE_READINESS === 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION', 'AP');
assert(issuanceLeavesMarketStockUnchanged() === true, 'AM');
assert(issuanceLeavesPlayerCashUnchanged() === true, 'AN');
assert(!read('backend/src/canonicalProductionRoadContractIssuance.ts').includes('applyCanonicalCashMutations'), 'AO');
assert(canonicalProductionRoadOfferId('u', 1, 0) === 'rcprod_u_1_0', 'AO slot');
assert(CARGO_MARKET_READINESS_STATUS === 'CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED', 'market');
assert(PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS.includes('PUBLIC_CONTRACTS_UI_UNWIRED'), 'BL');
assert(
  generateCanonicalProductionRoadOffers({
    uid: 'u',
    serverNowMs: 1,
    playerLevel: 0,
    playerReputation: 0,
    ownedMaxTruckCapacity: 25,
    marketRows: [],
    fuelPricePerLiter: 1.72,
  }).ok === false,
  'legacy empty',
);
const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'BN');
assert(coverage.criticalCanonicalizedCount === 0, 'BO');
assert(coverage.criticalBlockedCount === 24, 'BP');
assert(
  canUseServerAuthoritativeSettlement({
    signedInLinked: true,
    cashAuthorityVersion: 0,
    serverStateCashPresent: true,
    reconciliationActive: true,
    staleSaveProtectionActive: true,
  }).ready === false,
  'BM',
);
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AR');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AS');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AT');
assert(SAVE_GAME_VERSION === 6, 'AU');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AV');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AV sea');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AV air');
assert(resolveMultimodalFeatureRollout(null) === 'MULTIMODAL_OFF', 'AW');
assert(
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION ===
    'canonical-road-contract-issuance-internal-production-parity-v1',
  'policy',
);

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    PRODUCTION_ROAD_CONTRACT_ISSUANCE_PARITY_STATUS,
    ROAD_CONTRACT_ISSUANCE_READINESS,
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
  }),
);
