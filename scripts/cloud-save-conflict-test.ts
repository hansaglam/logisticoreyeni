import assert from 'node:assert/strict';

import {
  beginCloudSaveConflictResolution,
  CloudSaveConflictError,
  endCloudSaveConflictResolution,
  executeAtomicCloudSaveRestore,
  getCloudSaveConflictErrorMessage,
  validateCloudSaveRestorePayload,
} from '../src/utils/cloudSaveConflict';
import { runDialogActionAfterDismiss } from '../src/utils/dialogActions';

async function main(): Promise<void> {
const validPayload = {
  schemaVersion: 1,
  saveVersion: 3,
  gameState: {
    player: {
      money: 62_000,
      trucks: [],
      drivers: [],
      trailers: [],
      warehouses: [],
    },
  },
};

const pressOrder: string[] = [];
runDialogActionAfterDismiss(
  () => pressOrder.push('dismiss-old'),
  () => pressOrder.push('start-restore'),
);
assert.deepEqual(
  pressOrder,
  ['dismiss-old', 'start-restore'],
  'custom action must not dismiss the dialog opened by its callback',
);

assert.equal(validateCloudSaveRestorePayload(validPayload, 3), null);
assert.equal(
  validateCloudSaveRestorePayload(
    { ...validPayload, gameState: null },
    3,
  ),
  'cloud-save-corrupted',
);
assert.equal(
  validateCloudSaveRestorePayload({ ...validPayload, saveVersion: 99 }, 3),
  'unsupported-save-version',
);

const gate = { current: false };
assert.equal(beginCloudSaveConflictResolution(gate), true);
assert.equal(beginCloudSaveConflictResolution(gate), false, 'duplicate tap must be blocked');
endCloudSaveConflictResolution(gate);
assert.equal(beginCloudSaveConflictResolution(gate), true, 'gate must reset after failure/timeout');
endCloudSaveConflictResolution(gate);

const calls: string[] = [];
let localGuestState = { cash: 5_000, truckIds: ['guest-truck'] };
let committedState = localGuestState;
const restored = await executeAtomicCloudSaveRestore({
  selectedAccountUid: 'google-uid',
  expectedAccountUid: 'google-uid',
  readMetadata: async () => {
    calls.push('metadata');
    return validPayload;
  },
  readPayload: async () => {
    calls.push('payload');
    return validPayload;
  },
  validate: (payload) => validateCloudSaveRestorePayload(payload, 3),
  migrate: () => {
    calls.push('migrate');
    return { cash: 62_000, truckIds: ['cloud-truck', 'sold-truck'] };
  },
  reconcileMarketplace: async (state) => {
    calls.push('marketplace');
    return {
      ...state,
      cash: 61_500,
      truckIds: state.truckIds.filter((id) => id !== 'sold-truck'),
    };
  },
  persistLocal: async (state) => {
    calls.push('persist');
    localGuestState = state;
    return true;
  },
  commitState: (state) => {
    calls.push('commit');
    committedState = state;
  },
});
assert.deepEqual(calls, ['metadata', 'payload', 'migrate', 'marketplace', 'persist', 'commit']);
assert.deepEqual(restored, { cash: 61_500, truckIds: ['cloud-truck'] });
assert.deepEqual(committedState, restored);
assert.deepEqual(localGuestState, restored);

let secondRestoreState = restored;
await executeAtomicCloudSaveRestore({
  selectedAccountUid: 'google-uid',
  expectedAccountUid: 'google-uid',
  readMetadata: async () => validPayload,
  readPayload: async () => validPayload,
  validate: (payload) => validateCloudSaveRestorePayload(payload, 3),
  migrate: () => ({ cash: 62_000, truckIds: ['cloud-truck', 'sold-truck'] }),
  reconcileMarketplace: async (state) => ({
    ...state,
    cash: 61_500,
    truckIds: [...new Set(state.truckIds.filter((id) => id !== 'sold-truck'))],
  }),
  persistLocal: async () => true,
  commitState: (state) => {
    secondRestoreState = state;
  },
});
assert.deepEqual(secondRestoreState, restored, 'second restore must be idempotent');

let guestPreserved = { cash: 5_000, truckIds: ['guest-truck'] };
let persistedOnFailure = false;
await assert.rejects(
  executeAtomicCloudSaveRestore({
    selectedAccountUid: 'google-uid',
    readMetadata: async () => {
      throw new CloudSaveConflictError('network-error');
    },
    readPayload: async () => validPayload,
    validate: (payload) => validateCloudSaveRestorePayload(payload, 3),
    migrate: () => ({ cash: 1, truckIds: [] }),
    reconcileMarketplace: async (state) => state,
    persistLocal: async () => {
      persistedOnFailure = true;
      return true;
    },
    commitState: (state) => {
      guestPreserved = state;
    },
  }),
  (error: unknown) =>
    error instanceof CloudSaveConflictError && error.reason === 'network-error',
);
assert.equal(persistedOnFailure, false);
assert.deepEqual(guestPreserved, { cash: 5_000, truckIds: ['guest-truck'] });

await assert.rejects(
  executeAtomicCloudSaveRestore({
    selectedAccountUid: 'wrong-uid',
    expectedAccountUid: 'google-uid',
    readMetadata: async () => validPayload,
    readPayload: async () => validPayload,
    validate: () => null,
    migrate: () => ({}),
    reconcileMarketplace: async (state) => state,
    persistLocal: async () => true,
    commitState: () => {},
  }),
  (error: unknown) =>
    error instanceof CloudSaveConflictError &&
    error.reason === 'auth-user-mismatch',
);

assert.equal(
  getCloudSaveConflictErrorMessage('timeout'),
  'Kayıt geçişi zaman aşımına uğradı. Lütfen tekrar dene.',
);
assert.equal(
  getCloudSaveConflictErrorMessage('permission-denied'),
  'Bu bulut kaydına erişim iznin bulunmuyor.',
);

console.log('[cloud-save-conflict-test] PASS', {
  buttonPress: true,
  loadingGate: true,
  atomicRestore: true,
  guestPreservedOnFailure: true,
  corruptedRejected: true,
  wrongAccountRejected: true,
  marketplaceReconciled: true,
  localSaveUpdated: true,
  secondRestoreIdempotent: true,
});
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
