/**
 * Map V2 Step 29E canonical ROAD cash operations foundation.
 * Run: npx tsx scripts/map-v2-canonical-road-cash-operations-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import {
  ACCOUNT_CASH_AUTHORITY_MIGRATION_VERSION_UNMIGRATED,
  CANONICAL_CASH_CURRENCY,
  CANONICAL_CASH_OPERATION_SPECS,
  CANONICAL_CASH_TRANSACTION_AUTHORITY_VERSION,
  CANONICAL_CASH_TRANSACTIONS_PATH,
  CANONICAL_ROAD_CASH_OPERATIONS_FOUNDATION_STATUS,
  ROAD_CASH_CANONICALIZATION_MATRIX,
  ROAD_DELIVERY_CANONICAL_STATUS,
} from '../src/domain/canonicalCashOperation';
import {
  ARBITRARY_CLIENT_CASH_DELTA_API,
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  CASH_AUTHORITY_VERSION_UNMIGRATED,
  canUseServerAuthoritativeSettlement,
  PRODUCTION_CASH_WRITE_AUDIT,
  PROFILE_MONEY_AUTHORITY,
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

console.log('\n=== Map V2 Canonical ROAD Cash Operations (Step 29E) ===\n');

const auditIds = PRODUCTION_CASH_WRITE_AUDIT.map((row) => row.id);
const matrixIds = ROAD_CASH_CANONICALIZATION_MATRIX.map((row) => row.auditId);

assert(
  CANONICAL_ROAD_CASH_OPERATIONS_FOUNDATION_STATUS ===
    'CANONICAL_ROAD_CASH_OPERATIONS_FOUNDATION_PASS',
  'foundation status',
);

for (const id of auditIds) {
  assert(matrixIds.includes(id), `A matrix covers audit ${id}`);
}
for (const id of matrixIds) {
  assert(auditIds.includes(id), `A no extra matrix id ${id}`);
}
assert(auditIds.length === matrixIds.length, 'A audit/matrix same size');
assert(new Set(auditIds).size === auditIds.length, 'B unique audit ids');
assert(
  ROAD_CASH_CANONICALIZATION_MATRIX.every((row) =>
    [
      'CANONICAL_READY_NOW',
      'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
      'BLOCKED_MISSING_SERVER_STATE',
      'BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT',
      'LOCAL_ONLY_DEBUG',
      'LEGACY_TEST_ONLY',
    ].includes(row.migrationStatus),
  ),
  'C every write has migration status',
);
assert(!auditIds.includes('UNKNOWN'), 'B no UNKNOWN');

const index = read('backend/src/index.ts');
assert(!index.includes('export const applyCashDelta'), 'D no applyCashDelta callable');
assert(!index.includes('export const updateMoney'), 'D no updateMoney callable');
assert(!index.includes('export const setCash('), 'D no setCash callable');
assert(!index.includes('export const applyCanonicalCashTransaction'), 'D no generic txn callable');
assert(!index.includes('runCanonicalCashMutation'), 'D helper not exported from index');
assert(ARBITRARY_CLIENT_CASH_DELTA_API === false, 'D flag off');

assert(
  CANONICAL_CASH_TRANSACTIONS_PATH ===
    'users/{uid}/canonicalCashTransactions/{transactionId}',
  'E namespace',
);
assert(read('backend/src/canonicalCashTransaction.ts').includes('canonicalCashTransactions'), 'E helper collection');

const helper = read('backend/src/canonicalCashTransaction.ts');
assert(helper.includes('cashAuthorityVersion'), 'K txn authority version field');
assert(helper.includes('accountCashAuthorityMigrationVersion'), 'K distinct account migration field');
assert(CANONICAL_CASH_TRANSACTION_AUTHORITY_VERSION === 1, 'K txn schema v1');
assert(ACCOUNT_CASH_AUTHORITY_MIGRATION_VERSION_UNMIGRATED === 0, 'K account unmigrated');
assert(CASH_AUTHORITY_VERSION_UNMIGRATED === 0, 'K cashAuthority unmigrated');
assert(CANONICAL_CASH_CURRENCY === 'USD_GAME_INTEGER', 'T currency');

assert(helper.includes('applyCanonicalCashMutationInTransaction'), 'L internal helper');
assert(helper.includes('NOT an HTTPS callable') || helper.includes('Not an HTTPS'), 'L not callable');
assert(helper.includes('isAuthenticatedUid'), 'M auth');
assert(helper.includes('ALREADY_APPLIED') || helper.includes('alreadyApplied'), 'O duplicate');
assert(helper.includes('CANONICAL_CASH_TRANSACTION_CONFLICT'), 'P conflict');
assert(helper.includes('INSUFFICIENT_CASH'), 'S nsf');
assert(helper.includes('SERVER_STATE_CASH_FLOOR = 0'), 'R debit floor 0');

const rules = read('firestore.rules');
assert(
  /match \/canonicalCashTransactions\/\{transactionId\}[\s\S]*?allow write: if false/.test(rules),
  'G client cannot write canonicalCashTransactions',
);
assert(/match \/serverState\/\{documentId\}[\s\S]*?allow write: if false/.test(rules), 'G serverState write false');

assert(PROFILE_MONEY_AUTHORITY === 'NONE', 'H profile money not authority');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'I HUD overlay off');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'J listener off');
assert(!read('src/store/gameStore.ts').includes('subscribeAuthoritativeCash'), 'J no HUD listener');

const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(!gate.ready && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'K settlement gate false');
assert(!index.includes('export const settleCanonicalMultimodalShipment'), 'L no multimodal settle callable');

assert(read('src/store/gameStore.ts').includes('completeDeliveryById'), 'M ROAD complete remains');
assert(read('src/store/gameStore.ts').includes('applyCashTransaction'), 'M local ROAD cash');
assert(read('src/services/cloudSaveService.ts').includes('omitMoney = isTestMoneySyncEnabled()'), 'N save unchanged');
assert(SAVE_GAME_VERSION === 6, 'O SAVE_GAME_VERSION 6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'P RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'P SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'P AIR');
assert(read('src/domain/multimodalFeatureRollout.ts').includes("return 'MULTIMODAL_OFF'"), 'Q public OFF');

assert(
  ROAD_DELIVERY_CANONICAL_STATUS ===
    'ROAD_DELIVERY_SERVER_SETTLEMENT_BLOCKED_MISSING_CANONICAL_DELIVERY',
  'ROAD delivery blocked honestly',
);
assert(
  CANONICAL_CASH_OPERATION_SPECS.find((s) => s.type === 'ROAD_DELIVERY_SETTLEMENT')
    ?.productionCallable === false,
  'no fake ROAD money callable',
);
assert(
  CANONICAL_CASH_OPERATION_SPECS.find((s) => s.type === 'MULTIMODAL_SETTLEMENT')
    ?.productionCallable === false,
  'multimodal op not callable',
);

assert(
  !read('src/domain/canonicalCashOperation.ts').includes("from 'firebase"),
  'domain no firebase',
);
assert(!read('src/domain/canonicalCashOperation.ts').includes('react'), 'domain no react');

const matrixDoc = read('docs/architecture/map-v2/ROAD_CASH_CANONICALIZATION_MATRIX.md');
assert(matrixDoc.includes('road-delivery-revenue'), 'docs matrix');
assert(matrixDoc.includes('road-delivery-incident'), 'incident in matrix doc');
const opsDoc = read('docs/architecture/map-v2/MAP_V2_CANONICAL_ROAD_CASH_OPERATIONS.md');
assert(opsDoc.includes('arbitrary delta'), 'ops doc forbids delta');
assert(read('docs/architecture/map-v2/MAP_V2_MULTIMODAL_MIGRATION_PLAN.md').includes('STEP 29E'), 'plan 29E');

assert(
  helper.includes("users/${uid}.money") === false || helper.includes('does not write users/{uid}.money') || helper.includes('Does not write users/{uid}.money'),
  'helper comment no profile money write',
);
assert(!helper.includes('saves/current'), 'helper does not touch save path');

assert(read('src/screens/DebugSimulationScreen.tsx').includes('debugAddCash'), 'guest/dev debug cash still local');
assert(!read('src/screens/DebugSimulationScreen.tsx').includes('runCanonicalCashMutation'), 'no production UI harness callable');

if (fail > 0) {
  console.log(`\nFAILED ${fail}  passed ${pass}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
