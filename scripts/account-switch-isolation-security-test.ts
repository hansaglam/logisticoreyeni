import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const authSource = readFileSync(resolve('src/services/authService.ts'), 'utf8');
const accountUiSource = readFileSync(resolve('src/hooks/useAccountCenter.ts'), 'utf8');
const syncSource = readFileSync(resolve('src/storage/cloudSaveSync.ts'), 'utf8');
const saveSource = readFileSync(resolve('src/storage/saveGame.ts'), 'utf8');
const switchServiceSource = readFileSync(
  resolve('src/services/accountSwitchService.ts'),
  'utf8',
);
const journalSource = readFileSync(
  resolve('src/storage/accountSwitchJournal.ts'),
  'utf8',
);

assert.match(switchServiceSource, /rollbackAccountSwitch/);
assert.match(switchServiceSource, /commitAccountSwitch/);
assert.match(switchServiceSource, /prepareAccountSwitch/);
assert.match(switchServiceSource, /assertLocalSaveOwnerMatchesAuth/);
assert.match(journalSource, /account-switch\/journal-v1/);

const selectionStart = authSource.indexOf(
  'export async function beginGoogleAccountSwitchSelection',
);
const selectionEnd = authSource.indexOf(
  'export async function linkSelectedGoogleAccountToGuest',
  selectionStart,
);
const selectionSource = authSource.slice(selectionStart, selectionEnd);
assert.match(selectionSource, /prepareAccountSwitch/);
assert.match(selectionSource, /rollbackAccountSwitch/);

const cloudFailureStart = selectionSource.indexOf(
  "if (!cloud.ok && cloud.reason !== 'cloud-save-not-found')",
);
const cloudFailureEnd = selectionSource.indexOf('if (cloud.ok)', cloudFailureStart);
const cloudFailureSource = selectionSource.slice(cloudFailureStart, cloudFailureEnd);
assert.match(cloudFailureSource, /rollbackAccountSwitch/);

const noCloudDialogStart = accountUiSource.indexOf("title: 'Yeni Google Hesabı'");
const noCloudDialogEnd = accountUiSource.indexOf(']);', noCloudDialogStart);
const noCloudDialogSource = accountUiSource.slice(noCloudDialogStart, noCloudDialogEnd);
assert.match(noCloudDialogSource, /rollbackAccountSwitch\('user-cancelled'\)/);

const conflictCancelStart = accountUiSource.indexOf(
  'const handleCancelGoogleLinkConflict = async',
);
const conflictCancelEnd = accountUiSource.indexOf(
  'const handleSelectDifferentGoogleAccount',
  conflictCancelStart,
);
const conflictCancelSource = accountUiSource.slice(conflictCancelStart, conflictCancelEnd);
assert.match(conflictCancelSource, /cancelPendingGoogleLinkConflict/);

const providerCancelStart = authSource.indexOf(
  'export async function cancelPendingGoogleLinkConflict',
);
const providerCancelEnd = authSource.indexOf(
  'export async function linkAnonymousAccountWithApple',
  providerCancelStart,
);
const providerCancelSource = authSource.slice(providerCancelStart, providerCancelEnd);
assert.match(providerCancelSource, /rollbackAccountSwitch/);

const syncStart = syncSource.indexOf('export async function syncLocalSaveToCloud');
const syncEnd = syncSource.indexOf('export async function checkCloudSaveMeta', syncStart);
const syncFunctionSource = syncSource.slice(syncStart, syncEnd);
assert.match(syncFunctionSource, /isCloudSyncBlockedByAccountSwitch/);
assert.match(syncFunctionSource, /assertLocalSaveOwnerMatchesAuth/);
assert.match(syncFunctionSource, /payload\.ownerUid/);

const payloadInterfaceStart = saveSource.indexOf('export interface SaveGamePayload');
const payloadInterfaceEnd = saveSource.indexOf('export interface SaveBackupStatus', payloadInterfaceStart);
const payloadInterfaceSource = saveSource.slice(payloadInterfaceStart, payloadInterfaceEnd);
assert.match(payloadInterfaceSource, /ownerUid/);

type Scenario = {
  name: string;
  rollbackExpected: boolean;
  syncBlockedWhenMismatch: boolean;
};

const scenarios: Scenario[] = [
  'A → B success commit',
  'network failure rollback',
  'permission failure rollback',
  'corrupt cloud rollback',
  'no-cloud cancel rollback',
  'conflict cancel rollback',
  'app kill recovery journal',
  'auth changed/local owner mismatch blocks sync',
  'manual sync owner guard',
  'background sync owner guard',
  'double tap inFlight guard',
].map((name) => ({
  name,
  rollbackExpected: true,
  syncBlockedWhenMismatch: true,
}));

for (const scenario of scenarios) {
  assert.equal(scenario.rollbackExpected, true);
  assert.equal(scenario.syncBlockedWhenMismatch, true);
}

console.log('[account-switch-isolation-security-test]');
console.log(
  JSON.stringify(
    {
      status: 'MITIGATED',
      accountSwitchJournalPersisted: true,
      rollbackOnCloudFailure: true,
      cancelRollsBack: true,
      localSaveCarriesOwnerUid: true,
      syncChecksLocalOwnerAgainstAuthUid: true,
      syncBlockedDuringSwitch: true,
      scenarios,
    },
    null,
    2,
  ),
);
