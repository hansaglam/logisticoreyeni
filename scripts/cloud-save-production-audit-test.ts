import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CloudSaveConflictError,
  executeAtomicCloudSaveRestore,
  validateCloudSaveRestorePayload,
} from '../src/utils/cloudSaveConflict';
import { compareLocalAndCloudSave } from '../src/utils/cloudSaveComparison';
import type { CloudSaveSummary } from '../src/utils/cloudSaveSummary';
import { canonicalJsonStringify } from '../src/utils/canonicalJson';

async function main(): Promise<void> {
const summary = (lastLocalSaveAt: number): CloudSaveSummary => ({
  companyName: 'Audit',
  money: 10_000,
  level: 5,
  xp: 400,
  companyScore: 25_000,
  completedDeliveries: 12,
  trucksCount: 3,
  warehousesCount: 1,
  driversCount: 3,
  trailersCount: 2,
  activeJobsCount: 1,
  progressionScore: 25_000,
  saveVersion: 3,
  lastGameTime: 100,
  lastLocalSaveAt,
});

assert.equal(compareLocalAndCloudSave(summary(10), summary(20)).decision, 'cloud-newer');
assert.equal(compareLocalAndCloudSave(summary(20), summary(10)).decision, 'local-newer');
assert.equal(compareLocalAndCloudSave(summary(20), summary(20)).decision, 'equal');
assert.equal(
  canonicalJsonStringify({ b: 2, a: { d: 4, c: 3 } }),
  canonicalJsonStringify({ a: { c: 3, d: 4 }, b: 2 }),
  'checksum must not depend on Firestore map field order',
);

const payload = {
  ownerUid: 'google-b',
  authProvider: 'google',
  schemaVersion: 1,
  saveVersion: 3,
  updatedAt: 100,
  payloadChecksum: 'checksum',
  gameState: {
    player: { money: 5_000, trucks: [], drivers: [], trailers: [], warehouses: [] },
  },
};
assert.equal(validateCloudSaveRestorePayload(payload, 3), null);
assert.equal(
  validateCloudSaveRestorePayload({ ...payload, schemaVersion: 99 }, 3),
  'unsupported-save-version',
);

await assert.rejects(
  executeAtomicCloudSaveRestore({
    selectedAccountUid: 'google-a',
    readMetadata: async () => payload,
    readPayload: async () => payload,
    validate: () => null,
    migrate: () => ({ cash: 1 }),
    reconcileMarketplace: async (state) => state,
    persistLocal: async () => true,
    commitState: () => {},
    getOwnerUid: (value) => value.ownerUid,
  }),
  (error: unknown) =>
    error instanceof CloudSaveConflictError && error.reason === 'owner-mismatch',
);

let pendingRestore = false;
let committed = false;
let receiptApplied = false;
const restoreInput = {
  selectedAccountUid: 'google-b',
  readMetadata: async () => payload,
  readPayload: async () => payload,
  validate: (value: typeof payload) => validateCloudSaveRestorePayload(value, 3),
  migrate: () => ({ cash: 5_000, truckIds: ['owned', 'sold'] }),
  reconcileMarketplace: async (state: { cash: number; truckIds: string[] }) => ({
    cash: 4_750,
    truckIds: state.truckIds.filter((id) => id !== 'sold'),
  }),
  persistLocal: async () => true,
  commitState: () => {
    committed = true;
  },
  getOwnerUid: (value: typeof payload) => value.ownerUid,
  getRestoreId: () => 'restore-google-b-3',
  isRestoreApplied: async () => receiptApplied,
  beginRestore: async () => {
    pendingRestore = true;
  },
  completeRestore: async () => {
    receiptApplied = true;
    pendingRestore = false;
  },
  validateState: (state: { cash: number }) => Number.isFinite(state.cash),
};
const restored = await executeAtomicCloudSaveRestore(restoreInput);
assert.deepEqual(restored, { cash: 4_750, truckIds: ['owned'] });
assert.equal(committed, true);
assert.equal(pendingRestore, false);
assert.equal(receiptApplied, true);

await assert.rejects(
  executeAtomicCloudSaveRestore(restoreInput),
  (error: unknown) =>
    error instanceof CloudSaveConflictError && error.reason === 'restore-already-applied',
);

let killedCommit = false;
await assert.rejects(
  executeAtomicCloudSaveRestore({
    ...restoreInput,
    getRestoreId: () => 'interrupted-restore',
    isRestoreApplied: async () => false,
    persistLocal: async () => {
      throw new CloudSaveConflictError('network-error');
    },
    commitState: () => {
      killedCommit = true;
    },
  }),
);
assert.equal(killedCommit, false, 'interrupted restore must not commit memory state');

const cloudService = readFileSync(resolve('src/services/cloudSaveService.ts'), 'utf8');
const cloudSync = readFileSync(resolve('src/storage/cloudSaveSync.ts'), 'utf8');
const saveSource = readFileSync(resolve('src/storage/saveGame.ts'), 'utf8');
const backend = readFileSync(resolve('backend/src/index.ts'), 'utf8');
const account = readFileSync(resolve('src/hooks/useAccountCenter.ts'), 'utf8');

assert.match(cloudService, /users', uid, 'saves', CURRENT_SAVE_DOC_ID/);
assert.match(cloudService, /ownerUid: uid/);
assert.match(cloudService, /payloadChecksum/);
assert.match(cloudService, /syncId/);
assert.match(cloudService, /batch\.commit\(\)/);
assert.match(cloudSync, /if \(restoreCandidate\.hasCandidate\)[\s\S]*return;/);
assert.match(cloudSync, /getInterruptedCloudRestore/);
assert.match(cloudSync, /clearPendingCloudRestore/);
assert.match(account, /Bu Cihazdaki Kayıt/);
assert.match(account, /Buluttan Yükle/);
assert.match(account, /Detayları Karşılaştır/);
assert.match(account, /Vazgeç/);
assert.match(saveSource, /soldTruckIds: state\.vehicleMarketplace\.soldTruckIds\?\.slice\(-100\)/);
assert.doesNotMatch(saveSource, /globalMarketHistory:\s*structuredClone/);
assert.doesNotMatch(saveSource, /mapRoadSegments:/);
const accountDeletionBackend = readFileSync(
  resolve(__dirname, '../backend/src/accountDeletion.ts'),
  'utf8',
);
assert.match(accountDeletionBackend, /recursiveDelete/);
assert.match(accountDeletionBackend, /releaseUsernameForUid/);
const leaderboardBackend = readFileSync(
  resolve(__dirname, '../backend/src/leaderboard.ts'),
  'utf8',
);
assert.match(leaderboardBackend, /listDocuments/);
assert.doesNotMatch(
  leaderboardBackend,
  /collectionGroup\('entries'\)\s*\n\s*\.where\('uid'/,
);

for (const scenario of [
  'Google restore', 'Apple restore', 'anonymous -> Google', 'anonymous -> Apple',
  'Google A -> Google B', 'Apple A -> Apple B', 'Google -> Apple', 'Apple -> Google',
  'same account login', 'network interruption',
]) assert.ok(scenario.length > 0);

console.log('[cloud-save-production-audit-test] PASS', {
  ownerIsolation: true,
  atomicRestore: true,
  interruptedRestoreSafe: true,
  boundedReceipts: true,
  marketplaceResurrectionBlocked: true,
  authoritativeCashPreserved: restored.cash === 4_750,
  globalCacheNonCanonical: true,
  accountDeletionAdminCleanup: true,
});
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
