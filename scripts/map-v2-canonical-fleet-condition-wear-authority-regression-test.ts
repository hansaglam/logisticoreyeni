/**
 * Map V2 Step 29M canonical fleet condition / delivery-wear authority.
 * Run: ./node_modules/.bin/tsx scripts/map-v2-canonical-fleet-condition-wear-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { ROAD_CANONICAL_SETTLEMENT_READINESS } from '../src/domain/canonicalRoadContract';
import {
  CANONICAL_CONDITION_BOUNDS,
  CANONICAL_DELIVERY_WEAR_DRIVER_POLICY,
  CANONICAL_FLEET_CONDITION_WEAR_AUTHORITY_STATUS,
  CANONICAL_ROAD_DELIVERY_WEAR_POLICY_VERSION,
  FAILED_DELIVERY_WEAR_AUTHORITY_UNRESOLVED,
  INCIDENT_WEAR_AUTHORITY_MISSING,
  TRAILER_ROAD_WEAR_POLICY,
  applyCanonicalWearToCondition,
  canonicalDeliveryWearReadyAlias,
  classifyCanonicalDeliveryWear,
  createCanonicalDeliveryWearOperationId,
  deriveCanonicalDeliveryWear,
  hasOnlyCanonicalRoadWearKeys,
} from '../src/domain/canonicalFleetConditionWear';
import { PRODUCTION_FLEET_LEGACY_POLICY } from '../src/domain/canonicalProductionFleet';
import { calculateConditionLoss } from '../src/simulation/delivery';
import { STARTER_DRIVER } from '../src/data/drivers';
import { STARTER_TRUCK } from '../src/data/trucks';
import { getRoute } from '../src/data/routes';
import { PRODUCT_BY_ID } from '../src/data/products';
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

console.log('\n=== Map V2 Canonical Fleet Condition / Wear Authority (Step 29M) ===\n');

assert(
  CANONICAL_FLEET_CONDITION_WEAR_AUTHORITY_STATUS ===
    'CANONICAL_FLEET_CONDITION_WEAR_AUTHORITY_PASS_SUCCESS_ONLY',
  'status',
);
assert(CANONICAL_ROAD_DELIVERY_WEAR_POLICY_VERSION === 'canonical-road-delivery-wear-v1', 'C policy');
assert(CANONICAL_DELIVERY_WEAR_DRIVER_POLICY === 'CANONICAL_DELIVERY_WEAR_INTERNAL_DRIVER_POLICY_ONLY', 'F driver');
assert(FAILED_DELIVERY_WEAR_AUTHORITY_UNRESOLVED === 'FAILED_DELIVERY_WEAR_AUTHORITY_UNRESOLVED', 'V failed');
assert(INCIDENT_WEAR_AUTHORITY_MISSING === 'INCIDENT_WEAR_AUTHORITY_MISSING', 'W incident');
assert(TRAILER_ROAD_WEAR_POLICY === 'TRAILER_CONDITION_NOT_MUTATED_ON_ROAD_DELIVERY', 'J trailer');
assert(CANONICAL_CONDITION_BOUNDS.min === 0 && CANONICAL_CONDITION_BOUNDS.max === 100, 'Y floor/ceil');
assert(CANONICAL_CONDITION_BOUNDS.rounding === 'FLOAT_CLAMP_NO_INTEGER_ROUND', 'Z rounding');
assert(PRODUCTION_FLEET_LEGACY_POLICY === 'NO_AUTOMATIC_LEGACY_MIGRATION', 'AK legacy policy');

assert(read('src/store/gameStore.ts').includes('completeDeliveryById'), 'A production ROAD');
assert(!read('src/store/gameStore.ts').includes('applyCanonicalRoadDeliveryWear'), 'A store unwired');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');
assert(read('src/simulation/delivery.ts').includes('calculateConditionLoss'), 'K formula source');
assert(!read('src/store/gameStore.ts').includes('canonicalFleetAssets'), 'AG no local overlay');

assert(!hasOnlyCanonicalRoadWearKeys({ deliveryId: 'd', canonicalSchemaVersion: 1, wear: 1 }), 'F wear field');
assert(!hasOnlyCanonicalRoadWearKeys({ deliveryId: 'd', canonicalSchemaVersion: 1, conditionBefore: 1 }), 'G before');
assert(!hasOnlyCanonicalRoadWearKeys({ deliveryId: 'd', canonicalSchemaVersion: 1, conditionAfter: 1 }), 'H after');
assert(!hasOnlyCanonicalRoadWearKeys({ deliveryId: 'd', canonicalSchemaVersion: 1, conditionDelta: 1 }), 'I delta');
assert(hasOnlyCanonicalRoadWearKeys({ deliveryId: 'crd_x', canonicalSchemaVersion: 1 }), 'Y request keys');

const route = getRoute('istanbul', 'bursa')!;
const product = PRODUCT_BY_ID.steel;
const expected = calculateConditionLoss(
  {
    id: 'parity',
    originCityId: 'istanbul',
    destinationCityId: 'bursa',
    productId: 'steel',
    amount: 10,
    cargoWeight: 10,
    payment: 0,
    deadlineHours: 1,
    distanceKm: route.distanceKm,
    urgency: 0,
    status: 'active',
    createdAt: 0,
    expiresAt: 1,
    requiredLevel: 1,
    contractType: 'standard',
    riskLevel: 'low',
  },
  STARTER_TRUCK,
  { ...STARTER_DRIVER, attention: 100 },
  route,
  product,
);
const derived = deriveCanonicalDeliveryWear({
  originCityId: 'istanbul',
  destinationCityId: 'bursa',
  productId: 'steel',
  amount: 10,
  distanceKm: route.distanceKm,
  truck: STARTER_TRUCK,
});
assert(derived.ok && derived.ok && derived.wear === expected, 'J K parity');
assert(applyCanonicalWearToCondition(88, expected) === Math.max(0, Math.min(100, 88 - expected)), 'Y apply clamp');
assert(applyCanonicalWearToCondition(0.4, 1) === 0, 'Y floor');
assert(applyCanonicalWearToCondition(100, expected) <= 100, 'Y ceiling');
assert(
  createCanonicalDeliveryWearOperationId('cfa_starter_v1', 'crd_x') ===
    'fleet:cfa_starter_v1:delivery-wear:crd_x',
  'M operation id',
);

assert(
  classifyCanonicalDeliveryWear({
    delivery: { deliveryId: 'd1', lifecycleState: 'ACCEPTED', completionOutcome: null },
    asset: null,
    callerUid: 'u',
  }) === 'DELIVERY_NOT_COMPLETED',
  'U not completed',
);
assert(
  classifyCanonicalDeliveryWear({
    delivery: {
      deliveryId: 'd1',
      lifecycleState: 'FAILED',
      completionOutcome: 'FAILED',
    },
    asset: null,
    callerUid: 'u',
  }) === 'FAILED_AUTHORITY_UNRESOLVED',
  'V failed class',
);
assert(
  classifyCanonicalDeliveryWear({
    delivery: {
      deliveryId: 'd1',
      lifecycleState: 'COMPLETION_REPORTED',
      completionOutcome: 'COMPLETED',
      incidentConditionAuthority: 'UNRESOLVED',
    },
    asset: null,
    callerUid: 'u',
  }) === 'INCIDENT_AUTHORITY_UNRESOLVED',
  'W incident class',
);
assert(
  classifyCanonicalDeliveryWear({
    delivery: { deliveryId: 'd1', lifecycleState: 'CANCELLED', completionOutcome: null },
    asset: null,
    callerUid: 'u',
  }) === 'CANCELLATION_NO_WEAR',
  'X cancel',
);
assert(
  classifyCanonicalDeliveryWear({
    delivery: {
      deliveryId: 'd1',
      lifecycleState: 'COMPLETION_REPORTED',
      completionOutcome: 'COMPLETED',
      wearApplicationState: 'APPLIED',
    },
    asset: null,
    callerUid: 'u',
  }) === 'ALREADY_APPLIED',
  'O already',
);
assert(
  classifyCanonicalDeliveryWear({
    delivery: {
      deliveryId: 'd1',
      lifecycleState: 'COMPLETION_REPORTED',
      completionOutcome: 'COMPLETED',
      incidentConditionAuthority: 'NONE',
    },
    asset: { assetId: 'truck-starter-1' } as never,
    callerUid: 'u',
  }) === 'SCHEMA_UNSUPPORTED' ||
    classifyCanonicalDeliveryWear({
      delivery: {
        deliveryId: 'd1',
        lifecycleState: 'COMPLETION_REPORTED',
        completionOutcome: 'COMPLETED',
      },
      asset: { assetId: 'truck-starter-1', canonicalFleetAssetSchemaVersion: 1 } as never,
      callerUid: 'u',
    }) === 'LEGACY_FLEET_UNVERIFIED',
  'C legacy truck',
);
assert(
  canonicalDeliveryWearReadyAlias('INTERNAL_FIXTURE_READY') === 'CANONICAL_DELIVERY_WEAR_READY',
  'D E ready alias',
);

assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AH overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AI listener');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(!gate.ready && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AJ settlement false');
assert(SAVE_GAME_VERSION === 6, 'AN v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AO RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AO SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AO AIR');
assert(read('src/domain/multimodalFeatureRollout.ts').includes('MULTIMODAL_OFF'), 'AP OFF');
assert(
  ROAD_CANONICAL_SETTLEMENT_READINESS === 'ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY',
  'BK incident next',
);
assert(read('src/domain/canonicalRoadExecutionEconomics.ts').includes('fragile'), 'AL fragile still local');
assert(read('backend/src/canonicalFleetWear.ts').includes('serverState') === false, 'AD no cash in wear');
assert(!read('backend/src/canonicalFleetWear.ts').includes('applyCanonicalCash'), 'AE no cash tx');
assert(read('backend/src/index.ts').includes('applyCanonicalRoadDeliveryWear'), 'callable specific');
assert(!read('backend/src/index.ts').includes('export const setTruckCondition'), 'no setCondition');
assert(!read('backend/src/index.ts').includes('export const applyFleetDelta'), 'no delta');
assert(read('firestore.rules').includes('canonicalFleetMutationReceipts'), 'N receipts rules');

console.log(`\nPASSED ${pass}${fail ? `  FAILED ${fail}` : ''}\n`);
if (fail) process.exit(1);
