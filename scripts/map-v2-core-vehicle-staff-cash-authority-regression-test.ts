/**
 * Map V2 Step 29R core vehicle / staff cash authority.
 * Run: node --import tsx scripts/map-v2-core-vehicle-staff-cash-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  CORE_VEHICLE_STAFF_CASH_AUTHORITY_STATUS,
  DRIVER_FIRE_FAMILY_STATUS,
  DRIVER_HIRE_FAMILY_STATUS,
  DRIVER_SALARY_OPEX_STATUS,
  LEASE_FAMILY_STATUS,
  LEASE_RECURRING_COST_OWNERSHIP,
  LEASE_RETURN_STATUS,
  VEHICLE_RECOVERY_FAMILY_STATUS,
  VEHICLE_SALE_FAMILY_STATUS,
  createCanonicalDriverFireTransactionId,
  createCanonicalDriverHireTransactionId,
  createCanonicalLeaseStartTransactionId,
  createCanonicalVehicleSaleTransactionId,
  deriveCanonicalLeaseStartCost,
  deriveCanonicalMileageIncrementKm,
  hasOnlyCanonicalDriverFireKeys,
  hasOnlyCanonicalDriverHireKeys,
  hasOnlyCanonicalLeaseStartKeys,
  hasOnlyCanonicalVehicleRecoveryKeys,
  hasOnlyCanonicalVehicleSaleKeys,
  isCanonicalCoreVehicleStaffCashAllowed,
} from '../src/domain/canonicalCoreVehicleStaffCash';
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
import { FUEL_CASH_AUTHORITY_STATUS } from '../src/domain/remainingRoadCashPathCanonicalization';

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

console.log('\n=== Map V2 Core Vehicle / Staff Cash Authority (Step 29R) ===\n');

assert(
  CORE_VEHICLE_STAFF_CASH_AUTHORITY_STATUS ===
    'CORE_VEHICLE_STAFF_CASH_AUTHORITY_PASS_FOUNDATION',
  'status',
);
assert(read('src/store/gameStore.ts').includes('leaseTruck:'), 'A public lease');
assert(!read('src/store/gameStore.ts').includes('createCanonicalVehicleLease'), 'A unwired lease');
assert(read('src/store/gameStore.ts').includes('hireDriver:'), 'B public hire');
assert(!read('src/store/gameStore.ts').includes('hireCanonicalDriver'), 'B unwired hire');
assert(read('src/store/gameStore.ts').includes('fireDriver:'), 'C public fire');
assert(!read('src/store/gameStore.ts').includes('fireCanonicalDriver'), 'C unwired fire');
assert(read('src/store/gameStore.ts').includes('sellTruck:'), 'D public sale');
assert(!read('src/store/gameStore.ts').includes('sellCanonicalFleetAsset'), 'D unwired sale');
assert(read('src/store/gameStore.ts').includes('resolveVehicleStateIssue:'), 'E public recovery');
assert(!read('src/store/gameStore.ts').includes('recoverCanonicalVehicle'), 'E unwired recovery');
assert(read('src/store/gameStore.ts').includes('Guests'), 'F guest');
assert(isCanonicalCoreVehicleStaffCashAllowed({ envValue: null }) === false, 'G gate off');
assert(isCanonicalCoreVehicleStaffCashAllowed({ envValue: 'INTERNAL_TEST' }) === true, 'G internal');
assert(
  !read('backend/src/canonicalCoreVehicleStaffCash.ts').includes('operationType: data.operationType'),
  'H no arbitrary delta API',
);
assert(read('backend/src/canonicalCoreVehicleStaffCash.ts').includes('LEGACY_FLEET_UNVERIFIED'), 'I legacy fleet');
assert(read('backend/src/canonicalCoreVehicleStaffCash.ts').includes('LEGACY_DRIVER_UNVERIFIED'), 'J legacy driver');
assert(LEASE_FAMILY_STATUS === 'LEASE_START_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED', 'K lease status');
assert(LEASE_RECURRING_COST_OWNERSHIP === 'LEASE_RECURRING_COST_BELONGS_TO_DAILY_OPEX', 'K recurring opex');
assert(LEASE_RETURN_STATUS === 'LEASE_RETURN_BLOCKED_CLIENT_CLOCK', 'K return');
assert(DRIVER_HIRE_FAMILY_STATUS === 'DRIVER_HIRE_AUTHORITY_INTERNAL_POLICY_ONLY', 'L hire');
assert(DRIVER_FIRE_FAMILY_STATUS === 'DRIVER_FIRE_INTERNAL_TEST_CANONICAL_ROSTER', 'M fire');
assert(VEHICLE_SALE_FAMILY_STATUS === 'VEHICLE_SALE_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED', 'N sale');
assert(VEHICLE_RECOVERY_FAMILY_STATUS === 'VEHICLE_RECOVERY_BLOCKED_CLIENT_EXECUTION_STATE', 'O recovery');
assert(deriveCanonicalLeaseStartCost('truck-ford-cargo', 'weekly').ok === true, 'P derive lease');
assert(hasOnlyCanonicalLeaseStartKeys({ prepaidLeaseCost: 1 } as never) === false, 'R reject lease price');
assert(hasOnlyCanonicalDriverHireKeys({ hiringFee: 1 } as never) === false, 'R reject hire fee');
assert(hasOnlyCanonicalVehicleSaleKeys({ salePrice: 1 } as never) === false, 'R reject sale');
assert(hasOnlyCanonicalDriverFireKeys({ severanceCost: 1 } as never) === false, 'R reject fire');
assert(hasOnlyCanonicalVehicleRecoveryKeys({ recoveryCost: 1 } as never) === false, 'R reject recovery');
assert(
  createCanonicalLeaseStartTransactionId('cfa_lease_a', 'lease-aa1') ===
    'fleet:cfa_lease_a:lease:lease-aa1',
  'U lease id',
);
assert(
  createCanonicalDriverHireTransactionId('driver-can-t', 'hire-aa01') ===
    'driver:driver-can-t:hire:hire-aa01',
  'U hire id',
);
assert(
  createCanonicalDriverFireTransactionId('driver-can-t', 'fire-aa01') ===
    'driver:driver-can-t:fire:fire-aa01',
  'U fire id',
);
assert(
  createCanonicalVehicleSaleTransactionId('cfa_catalog_x', 'sale-aa01') ===
    'fleet:cfa_catalog_x:sale:sale-aa01',
  'U sale id',
);
assert(
  deriveCanonicalMileageIncrementKm({
    completionOutcome: 'SUCCESS',
    distanceKm: 120.4,
  }).ok === true,
  'mileage success',
);
assert(
  deriveCanonicalMileageIncrementKm({
    failureAuthorityClass: 'SERVER_DERIVED_FAILURE',
    distanceKm: 120,
  }).ok === true,
  'mileage fail 0',
);
assert(read('backend/src/canonicalCoreVehicleStaffCash.ts').includes('alreadyApplied'), 'W retry');
assert(read('src/domain/canonicalCoreVehicleStaffCash.ts').includes('CANONICAL_ASSET_RESERVED'), 'T reservation');
assert(read('src/simulation/dailyOperatingCosts.ts').includes('chargedTruckLeaseTotal = 0'), 'K no daily lease cash');
assert(DRIVER_SALARY_OPEX_STATUS === 'DRIVER_SALARY_BELONGS_TO_DAILY_OPEX', 'salary opex');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AE overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AF listener');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'AG version');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(gate.ready === false && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AH settlement');
assert(SAVE_GAME_VERSION === 6, 'AI v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AJ RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AJ SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AJ AIR');
assert(resolveMultimodalFeatureRollout({ envValue: null }) === 'MULTIMODAL_OFF', 'AK OFF');
assert(!read('backend/src/index.ts').includes('export const settleCanonicalMultimodalShipment'), 'no multimodal');
assert(read('firestore.rules').includes('canonicalVehicleLeases'), 'rules lease');
assert(read('firestore.rules').includes('canonicalDrivers'), 'rules drivers');
assert(/allow write: if false/.test(read('firestore.rules')), 'rules write false');

const coverage = getSignedInCashAuthorityCoverage();
assert(coverage.criticalSignedInCashPathsTotal === 24, 'BH 24');
assert(coverage.criticalCanonicalizedCount === 0, 'BI 0');
assert(coverage.criticalBlockedCount === 24, 'BJ 24');
assert(coverage.readiness === 'SIGNED_IN_CASH_AUTHORITY_BLOCKED_MULTIPLE_PATHS', 'BK');
assert(FUEL_CASH_AUTHORITY_STATUS.includes('INTERNAL_TEST'), 'BC fuel still blocker');
assert(coverage.rows.find((row) => row.auditId === 'truck-lease')?.hudRole === 'BLOCKS_HUD_AUTHORITY', 'lease HUD');
assert(coverage.rows.find((row) => row.auditId === 'vehicle-recovery')?.authorityStatus === 'BLOCKED_SERVER_STATE', 'recovery blocked');

if (fail > 0) {
  console.error(`\nFAILED ${fail} / ${pass + fail}`);
  process.exit(1);
}
console.log(`OK ${pass} assertions`);
console.log(
  JSON.stringify({
    CORE_VEHICLE_STAFF_CASH_AUTHORITY_STATUS,
    CRITICAL_SIGNED_IN_CASH_PATHS_TOTAL: coverage.criticalSignedInCashPathsTotal,
    CRITICAL_CANONICALIZED_COUNT: coverage.criticalCanonicalizedCount,
    CRITICAL_BLOCKED_COUNT: coverage.criticalBlockedCount,
    readiness: coverage.readiness,
  }),
);
