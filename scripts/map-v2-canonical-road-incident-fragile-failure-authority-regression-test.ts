/**
 * Map V2 Step 29O canonical ROAD incident / fragile / failure authority.
 * Run: ./node_modules/.bin/tsx scripts/map-v2-canonical-road-incident-fragile-failure-authority-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { ROAD_CANONICAL_SETTLEMENT_READINESS } from '../src/domain/canonicalRoadContract';
import {
  CANONICAL_INCIDENT_RNG_MODEL,
  CANONICAL_ROAD_EXECUTION_AUTHORITY_BACKEND_ENV,
  CANONICAL_ROAD_FAILURE_POLICY_VERSION,
  CANONICAL_ROAD_FRAGILE_POLICY_VERSION,
  CANONICAL_ROAD_INCIDENT_FRAGILE_FAILURE_AUTHORITY_STATUS,
  CANONICAL_ROAD_INCIDENT_POLICY_VERSION,
  CATALOG_CARGO_CONDITION_AFFECTING,
  CATALOG_FAILURE_TRIGGERING,
  PRODUCTION_INCIDENT_PARITY_BLOCKED_CLIENT_EXECUTION_STATE,
  classifyCanonicalFailureAuthority,
  classifyCatalogIncidentEffects,
  deriveCanonicalFailurePenaltyFromPayment,
  deriveCanonicalIncidentCatalogEffects,
  deriveCanonicalRoadIncidentPlan,
  hasOnlyCanonicalRoadFinalizeKeys,
  isCanonicalRoadExecutionAuthorityAllowed,
  resolveCanonicalRoadExecutionAuthorityGate,
} from '../src/domain/canonicalRoadIncidentFragileFailure';
import { calculateCanonicalFragileSurcharge } from '../src/domain/canonicalRoadExecutionEconomics';
import { calculateFailurePenalty } from '../src/simulation/delivery';
import { CANONICAL_ROAD_COST_CLASSES } from '../src/domain/canonicalRoadDelivery';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  canUseServerAuthoritativeSettlement,
} from '../src/domain/cashAuthority';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import type { Contract } from '../src/types/game';

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

console.log('\n=== Map V2 Canonical ROAD Incident / Fragile / Failure (Step 29O) ===\n');

assert(
  CANONICAL_ROAD_INCIDENT_FRAGILE_FAILURE_AUTHORITY_STATUS ===
    'CANONICAL_ROAD_INCIDENT_FRAGILE_FAILURE_AUTHORITY_PASS_INTERNAL_POLICY_ONLY',
  'status',
);
assert(CANONICAL_ROAD_INCIDENT_POLICY_VERSION === 'canonical-road-incident-v1', 'E incident policy');
assert(CANONICAL_ROAD_FRAGILE_POLICY_VERSION === 'canonical-road-fragile-v1', 'Z fragile policy');
assert(CANONICAL_ROAD_FAILURE_POLICY_VERSION === 'canonical-road-failure-v1', 'failure policy');
assert(CANONICAL_INCIDENT_RNG_MODEL === 'MODEL_B_SERVER_ISSUED_PLAN_AT_ACCEPT', 'D model B');
assert(CATALOG_FAILURE_TRIGGERING === 'NOT_PRESENT', 'M catalog fail not present');
assert(CATALOG_CARGO_CONDITION_AFFECTING === 'NOT_PRESENT', 'cargo condition not present');
assert(resolveCanonicalRoadExecutionAuthorityGate() === 'OFF', 'C gate default OFF');
assert(isCanonicalRoadExecutionAuthorityAllowed({ envValue: null }) === false, 'C backend gate off');
assert(CANONICAL_ROAD_EXECUTION_AUTHORITY_BACKEND_ENV === 'CANONICAL_ROAD_EXECUTION_AUTHORITY', 'backend env');
assert(
  PRODUCTION_INCIDENT_PARITY_BLOCKED_CLIENT_EXECUTION_STATE ===
    'PRODUCTION_INCIDENT_PARITY_BLOCKED_CLIENT_EXECUTION_STATE',
  'AT production parity blocked',
);

assert(read('src/store/gameStore.ts').includes('completeDeliveryById'), 'A production ROAD');
assert(!read('src/store/gameStore.ts').includes('finalizeCanonicalRoadExecution'), 'A unwired');
assert(read('src/store/gameStore.ts').includes('resolveDeliveryIncident'), 'production incident UI');

assert(hasOnlyCanonicalRoadFinalizeKeys({ deliveryId: 'x', canonicalSchemaVersion: 1 }), 'finalize keys');
assert(
  !hasOnlyCanonicalRoadFinalizeKeys({ deliveryId: 'x', canonicalSchemaVersion: 1, incidentType: 'traffic' }),
  'D client type rejected',
);
assert(
  !hasOnlyCanonicalRoadFinalizeKeys({ deliveryId: 'x', canonicalSchemaVersion: 1, truckConditionDelta: -3 }),
  'E client damage rejected',
);
assert(
  !hasOnlyCanonicalRoadFinalizeKeys({ deliveryId: 'x', canonicalSchemaVersion: 1, cashDelta: -90 }),
  'F client cash rejected',
);
assert(
  !hasOnlyCanonicalRoadFinalizeKeys({ deliveryId: 'x', canonicalSchemaVersion: 1, delayHours: 2 }),
  'G client delay rejected',
);
assert(
  !hasOnlyCanonicalRoadFinalizeKeys({ deliveryId: 'x', canonicalSchemaVersion: 1, fragileBonusApplied: true }),
  'X client fragile flag rejected',
);
assert(
  !hasOnlyCanonicalRoadFinalizeKeys({ deliveryId: 'x', canonicalSchemaVersion: 1, fragileSurcharge: 12 }),
  'Y client fragile amount rejected',
);
assert(
  !hasOnlyCanonicalRoadFinalizeKeys({ deliveryId: 'x', canonicalSchemaVersion: 1, failurePenalty: 800 }),
  'AD client failure money rejected',
);

const seedA = deriveCanonicalRoadIncidentPlan({ uid: 'u', deliveryId: 'crd_1', enabled: true });
const seedB = deriveCanonicalRoadIncidentPlan({ uid: 'u', deliveryId: 'crd_1', enabled: true });
assert(JSON.stringify(seedA) === JSON.stringify(seedB), 'H I J K seed stable');
assert(seedA.events.length === 1, 'plan has event when enabled');
assert(deriveCanonicalRoadIncidentPlan({ uid: 'u', deliveryId: 'crd_1', enabled: false }).events.length === 0, 'Q off empty');

const wait = deriveCanonicalIncidentCatalogEffects('loading_queue', 'wait_queue');
assert(wait.ok && classifyCatalogIncidentEffects(wait.effects) === 'TIME_ONLY', 'L time-only');
const fee = deriveCanonicalIncidentCatalogEffects('unexpected_cost', 'pay_fee');
assert(fee.ok && classifyCatalogIncidentEffects(fee.effects) === 'CASH_ONLY', 'M cash-only');
const cont = deriveCanonicalIncidentCatalogEffects('cargo_recheck', 'continue');
assert(cont.ok && classifyCatalogIncidentEffects(cont.effects) === 'CONDITION_ONLY', 'L condition-only');
const tire = deriveCanonicalIncidentCatalogEffects('tire_pressure', 'check');
assert(tire.ok && classifyCatalogIncidentEffects(tire.effects) === 'CONDITION_AND_CASH', 'condition+cash');

assert(
  classifyCanonicalFailureAuthority({
    clientOutcome: 'FAILED',
    actualTravelHours: 1,
    deadlineHours: 10,
  }) === 'CLIENT_REPORTED_UNVERIFIED_FAILURE',
  'R unverified',
);
assert(
  classifyCanonicalFailureAuthority({
    clientOutcome: 'COMPLETED',
    actualTravelHours: 25,
    deadlineHours: 10,
  }) === 'SERVER_DERIVED_FAILURE',
  'S server-derived too_late',
);
assert(
  classifyCanonicalFailureAuthority({
    clientOutcome: 'CANCELLED',
    actualTravelHours: 1,
    deadlineHours: 10,
  }) === 'MANUAL_CANCEL_NOT_FAILURE',
  'V cancel distinct',
);
assert(
  deriveCanonicalFailurePenaltyFromPayment(2000) ===
    Math.round(calculateFailurePenalty({ payment: 2000 } as Contract)),
  'T penalty derived',
);

assert(
  calculateCanonicalFragileSurcharge({
    payment: 200,
    contractType: 'fragile',
    frozenStartCondition: 90,
    recommendedTruckCondition: 70,
    completionTruckCondition: 60,
  }) === 10,
  'AA below threshold',
);
assert(
  calculateCanonicalFragileSurcharge({
    payment: 200,
    contractType: 'fragile',
    frozenStartCondition: 60,
    recommendedTruckCondition: 70,
    completionTruckCondition: 70,
  }) === 0,
  'AA at threshold',
);
assert(CANONICAL_ROAD_COST_CLASSES.fragileConditionSurcharge === 'COMPLETION_DERIVED', 'W fragile source truck completion');

assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AH overlay off');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AI listener off');
assert(
  canUseServerAuthoritativeSettlement({ signedInLinked: true }).ready === false,
  'AJ settlement false',
);
assert(SAVE_GAME_VERSION === 6, 'AK save v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AL RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AL SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AL AIR');
assert(read('src/domain/multimodalFeatureRollout.ts').includes('MULTIMODAL_OFF'), 'AM OFF');
assert(
  ROAD_CANONICAL_SETTLEMENT_READINESS ===
    'ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY',
  'readiness',
);

const index = read('backend/src/index.ts');
assert(index.includes('finalizeCanonicalRoadExecution'), 'callable');
assert(index.includes('process.env.CANONICAL_ROAD_EXECUTION_AUTHORITY'), 'backend gate');
assert(!index.includes('export const applyCashDelta'), 'no generic cash');

const rules = read('firestore.rules');
assert(/canonicalFleetAssets[\s\S]*allow write: if false/.test(rules), 'fleet write false');
assert(/canonicalCashTransactions[\s\S]*allow write: if false/.test(rules), 'cash write false');
assert(/match \/serverState\/\{documentId\}[\s\S]*allow write: if false/.test(rules), 'serverState write false');

if (fail > 0) {
  console.error(`\nFAILED ${fail}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
