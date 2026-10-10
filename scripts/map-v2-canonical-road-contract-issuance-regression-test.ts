/**
 * Map V2 Step 29G canonical ROAD contract issuance.
 * Run: npx tsx scripts/map-v2-canonical-road-contract-issuance-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  CANONICAL_ROAD_CONTRACT_ISSUANCE_STATUS,
  CANONICAL_ROAD_CONTRACT_PRODUCTION_PARITY,
  CANONICAL_ROAD_CONTRACTS_ENV_KEY,
  CANONICAL_ROAD_ISSUANCE_OFFER_COUNT,
  CANONICAL_ROAD_ISSUANCE_POLICY_VERSION,
  ROAD_CANONICAL_SETTLEMENT_READINESS,
  hasOnlyCanonicalRoadIssuanceKeys,
  prepareCanonicalRoadContractBatch,
  resolveCanonicalRoadContractsGate,
} from '../src/domain/canonicalRoadContract';
import { toRuntimeRoadContract } from '../src/domain/canonicalRoadContractPresentation';
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

console.log('\n=== Map V2 Canonical ROAD Contract Issuance (Step 29G) ===\n');

assert(
  CANONICAL_ROAD_CONTRACT_ISSUANCE_STATUS ===
    'CANONICAL_ROAD_CONTRACT_ISSUANCE_PASS_INTERNAL_POLICY_ONLY',
  'status internal policy',
);
assert(
  CANONICAL_ROAD_CONTRACT_PRODUCTION_PARITY ===
    'PRODUCTION_PARITY_BLOCKED_WORLD_STATE_AUTHORITY',
  'G production parity blocked',
);
assert(resolveCanonicalRoadContractsGate({ envValue: null }) === 'OFF', 'A gate OFF');
assert(resolveCanonicalRoadContractsGate({ envValue: 'INTERNAL_TEST' }) === 'INTERNAL_TEST', 'internal');
assert(CANONICAL_ROAD_CONTRACTS_ENV_KEY === 'EXPO_PUBLIC_CANONICAL_ROAD_CONTRACTS', 'env');
assert(CANONICAL_ROAD_ISSUANCE_POLICY_VERSION === 'canonical-road-contract-issuance-internal-v1', 'F policy');
assert(CANONICAL_ROAD_ISSUANCE_OFFER_COUNT === 8, 'M offer count');
assert(
  ROAD_CANONICAL_SETTLEMENT_READINESS ===
    'ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY',
  'settlement not ready',
);

assert(read('src/simulation/contracts.ts').includes('export function generateContracts'), 'B local generator');
assert(!read('src/screens/ContractsScreen.tsx').includes('getOrIssueCanonicalRoadContracts'), 'C no UI wire');
assert(!read('src/store/gameStore.ts').includes('getOrIssueCanonicalRoadContracts'), 'AE store unwired');

assert(!hasOnlyCanonicalRoadIssuanceKeys({ canonicalSchemaVersion: 1, payment: 1 }), 'K no payment');
assert(!hasOnlyCanonicalRoadIssuanceKeys({ canonicalSchemaVersion: 1, deadlineHours: 8 }), 'L no deadline');
assert(!hasOnlyCanonicalRoadIssuanceKeys({ canonicalSchemaVersion: 1, distanceKm: 100 }), 'M no distance');
assert(!hasOnlyCanonicalRoadIssuanceKeys({ canonicalSchemaVersion: 1, cargoAmount: 25 }), 'H no amount');

const a = prepareCanonicalRoadContractBatch({ uid: 'u1', nowMs: 1_700_000_000_000, fuelPricePerLiter: 1.72 });
const b = prepareCanonicalRoadContractBatch({ uid: 'u1', nowMs: 1_700_000_000_000, fuelPricePerLiter: 1.72 });
assert(!('ok' in a) && !('ok' in b), 'prepare ok');
if (!('ok' in a) && !('ok' in b)) {
  assert(a.batchId === b.batchId, 'K batch id');
  assert(a.contracts.length === 8, 'P count');
  assert(a.contracts.every((c) => c.payment > 0), 'F payment');
  assert(a.contracts.every((c) => c.deadlineHours >= 4), 'G deadline');
  assert(a.contracts.every((c) => c.distanceKm > 0), 'I route');
  assert(a.generationSeed === b.generationSeed, 'N seed');
  assert(a.contracts[0]!.payment === b.contracts[0]!.payment, 'N replay payment');
  assert(a.issuedAtMs === 1_700_000_000_000, 'Q issuedAt');
  assert(a.expiresAtMs > a.issuedAtMs, 'R expiresAt');
  const view = toRuntimeRoadContract(a.contracts[0]!);
  assert(view.authority === 'SERVER_CANONICAL', 'adapter');
  assert(view.contract.id === a.contracts[0]!.contractId, 'W id');
}

const index = read('backend/src/index.ts');
assert(index.includes('export const getOrIssueCanonicalRoadContracts'), 'Y callable');
assert(!index.includes('export const applyCashDelta'), 'no delta');
assert(!index.includes('export const settleCanonicalMultimodalShipment'), 'AK no multimodal settle');
assert(read('backend/src/canonicalRoadContract.ts').includes('alreadyIssued'), 'O retry');
assert(read('backend/src/canonicalRoadDelivery.ts').includes('CONTRACT_EXPIRED'), 'S expiry');
assert(read('backend/src/canonicalRoadDelivery.ts').includes("status: 'ACCEPTED'"), 'X accept status');
assert(read('backend/src/canonicalRoadDelivery.ts').includes('sourceCanonicalContractId'), 'W link');
assert(!read('backend/src/canonicalRoadContract.ts').includes('runCanonicalCashMutation'), 'Y no cash');

const rules = read('firestore.rules');
assert(/match \/canonicalRoadContracts\/\{contractId\}[\s\S]*?allow write: if false/.test(rules), 'AQ contracts');
assert(/match \/canonicalRoadContractBatches\/\{batchId\}[\s\S]*?allow write: if false/.test(rules), 'AQ batches');
assert(/match \/serverState\/\{documentId\}[\s\S]*?allow write: if false/.test(rules), 'serverState');

assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AH overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AI listener');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(!gate.ready && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AJ settlement gate');
assert(SAVE_GAME_VERSION === 6, 'AL v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AM RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AM SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AM AIR');
assert(read('src/domain/multimodalFeatureRollout.ts').includes("return 'MULTIMODAL_OFF'"), 'AN OFF');
assert(read('docs/architecture/map-v2/MAP_V2_CANONICAL_ROAD_CONTRACT_ISSUANCE.md').includes('INTERNAL_TEST'), 'docs');
assert(read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('STEP 29G'), 'plan');
assert(read('src/services/canonicalRoadContractService.ts').includes('FEATURE_DISABLED'), 'client gate');

if (fail > 0) {
  console.log(`\nFAILED ${fail}  passed ${pass}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
