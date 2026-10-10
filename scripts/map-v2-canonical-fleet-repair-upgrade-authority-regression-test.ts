/**
 * Map V2 Step 29N canonical fleet repair / upgrade authority.
 * Run: ./node_modules/.bin/tsx scripts/map-v2-canonical-fleet-repair-upgrade-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { ROAD_CANONICAL_SETTLEMENT_READINESS } from '../src/domain/canonicalRoadContract';
import {
  CANONICAL_FLEET_REPAIR_POLICY_VERSION,
  CANONICAL_FLEET_REPAIR_UPGRADE_AUTHORITY_STATUS,
  CANONICAL_FLEET_UPGRADE_POLICY_VERSION,
  CANONICAL_REPAIR_AD_DISCOUNT_POLICY,
  REPAIR_SERVER_CASH_POLICY,
  TRAILER_REPAIR_UPGRADE_POLICY,
  classifyCanonicalFleetRepair,
  createCanonicalFleetRepairOperationId,
  createCanonicalFleetUpgradeOperationId,
  deriveCanonicalFleetRepair,
  deriveCanonicalFleetUpgrade,
  hasOnlyCanonicalFleetRepairKeys,
  hasOnlyCanonicalFleetUpgradeKeys,
  isCanonicalFleetMutationsAllowed,
  resolveCanonicalFleetMutationsGate,
} from '../src/domain/canonicalFleetRepairUpgrade';
import { calculateTruckRepairCost } from '../src/simulation/delivery';
import {
  applyTruckUpgrade,
  getDurabilityConditionLossReduction,
  getTruckUpgradeCost,
} from '../src/simulation/truckUpgrades';
import { STARTER_TRUCK } from '../src/data/trucks';
import { truckFromCanonicalFleetAsset } from '../src/domain/canonicalRoadFleet';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  canUseServerAuthoritativeSettlement,
  UNIFIED_CASH_BLOCK_REASON,
} from '../src/domain/cashAuthority';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
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

console.log('\n=== Map V2 Canonical Fleet Repair / Upgrade Authority (Step 29N) ===\n');

assert(
  CANONICAL_FLEET_REPAIR_UPGRADE_AUTHORITY_STATUS ===
    'CANONICAL_FLEET_REPAIR_UPGRADE_AUTHORITY_PASS_INTERNAL_ONLY',
  'status',
);
assert(CANONICAL_FLEET_REPAIR_POLICY_VERSION === 'canonical-fleet-repair-v1', 'F repair policy');
assert(CANONICAL_FLEET_UPGRADE_POLICY_VERSION === 'canonical-fleet-upgrade-v1', 'G upgrade policy');
assert(REPAIR_SERVER_CASH_POLICY === 'REPAIR_SERVER_CASH_POLICY_MATCHED', 'B cash policy');
assert(CANONICAL_REPAIR_AD_DISCOUNT_POLICY.includes('IGNORES_AD'), 'ad discount ignored');
assert(TRAILER_REPAIR_UPGRADE_POLICY.includes('NOT_IN_PRODUCTION'), 'J trailer');
assert(resolveCanonicalFleetMutationsGate({ envValue: null }) === 'OFF', 'gate off');
assert(isCanonicalFleetMutationsAllowed({ envValue: null }) === false, 'backend gate');
assert(isCanonicalFleetMutationsAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'internal');

assert(read('src/store/gameStore.ts').includes('repairTruck:'), 'A production repair');
assert(read('src/store/gameStore.ts').includes('upgradeTruck:'), 'B production upgrade');
assert(!read('src/store/gameStore.ts').includes('repairCanonicalFleetAsset'), 'A unwired');
assert(!read('src/components/fleet/FleetUpgradesPanel.tsx').includes('upgradeCanonicalFleetAsset'), 'B panel local');
assert(read('src/store/gameStore.ts').includes('Guests'), 'C guest');

assert(!hasOnlyCanonicalFleetRepairKeys({ assetId: 'a', repairIntentId: 'intent-01', canonicalSchemaVersion: 1, repairCost: 1 }), 'F cost');
assert(!hasOnlyCanonicalFleetRepairKeys({ assetId: 'a', repairIntentId: 'intent-01', canonicalSchemaVersion: 1, targetCondition: 100 }), 'G target');
assert(!hasOnlyCanonicalFleetRepairKeys({ assetId: 'a', repairIntentId: 'intent-01', canonicalSchemaVersion: 1, conditionDelta: 1 }), 'H delta');
assert(!hasOnlyCanonicalFleetUpgradeKeys({ assetId: 'a', upgradeType: 'engine', upgradeIntentId: 'intent-02', canonicalSchemaVersion: 1, upgradePrice: 1 }), 'I price');
assert(!hasOnlyCanonicalFleetUpgradeKeys({ assetId: 'a', upgradeType: 'engine', upgradeIntentId: 'intent-02', canonicalSchemaVersion: 1, upgradeModifier: 1 }), 'J modifier');
assert(hasOnlyCanonicalFleetRepairKeys({ assetId: 'a', repairIntentId: 'intent-01', canonicalSchemaVersion: 1 }), 'I request');
assert(hasOnlyCanonicalFleetUpgradeKeys({ assetId: 'a', upgradeType: 'durability', upgradeIntentId: 'intent-02', canonicalSchemaVersion: 1 }), 'upgrade keys');

const degraded = {
  ...STARTER_TRUCK,
  condition: 35,
};
assert(calculateTruckRepairCost(degraded) === Math.max(100, Math.round((100 - 35) * 35)), 'K formula or fallback');
const starterCost = getTruckUpgradeCost(STARTER_TRUCK, 'engine');
assert(starterCost === Math.round(45_000 * 0.08 * 1), 'E price L0');
assert(getDurabilityConditionLossReduction(applyTruckUpgrade(STARTER_TRUCK, 'durability')) === 0.08, 'O durability');

assert(
  createCanonicalFleetRepairOperationId('cfa_x', 'intent-aa') === 'fleet:cfa_x:repair:intent-aa',
  'Q repair op',
);
assert(
  createCanonicalFleetUpgradeOperationId('cfa_x', 'engine', 'intent-bb') ===
    'fleet:cfa_x:upgrade:engine:intent-bb',
  'R upgrade op',
);

assert(
  classifyCanonicalFleetRepair({ assetId: 'truck-starter-1' } as never, 'u') === 'SCHEMA_UNSUPPORTED' ||
    classifyCanonicalFleetRepair(null, 'u') === 'LEGACY_FLEET_UNVERIFIED',
  'D legacy',
);

assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AJ overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AK listener');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(!gate.ready && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AL settlement false');
assert(SAVE_GAME_VERSION === 6, 'AP v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AQ RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AQ SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AQ AIR');
assert(read('src/domain/multimodalFeatureRollout.ts').includes('MULTIMODAL_OFF'), 'AR OFF');
assert(
  ROAD_CANONICAL_SETTLEMENT_READINESS === 'ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY',
  'BK incident',
);
assert(read('src/domain/canonicalRoadExecutionEconomics.ts').includes('fragile'), 'AM fragile');
assert(read('backend/src/index.ts').includes('repairCanonicalFleetAsset'), 'callable');
assert(!read('backend/src/index.ts').includes('export const setTruckCondition'), 'no setCondition');
assert(read('firestore.rules').includes('canonicalFleetMutationReceipts'), 'AH receipts');

void deriveCanonicalFleetRepair;
void deriveCanonicalFleetUpgrade;
void truckFromCanonicalFleetAsset;

console.log(`\nPASSED ${pass}${fail ? `  FAILED ${fail}` : ''}\n`);
if (fail) process.exit(1);
