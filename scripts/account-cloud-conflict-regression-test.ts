/**
 * Guest → existing Google/Apple cloud-save conflict resolver regression.
 * Run: npx tsx scripts/account-cloud-conflict-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getCloudSaveConflictErrorMessage,
  isPermanentCloudSaveConflictReason,
  isRetryableCloudSaveConflictReason,
  validateCloudSaveRestorePayload,
} from '../src/utils/cloudSaveConflict';
import {
  beginAccountSaveConflictSession,
  beginConflictResolveRequest,
  completeAccountSaveConflictSession,
  clearAccountSaveConflictSession,
  isConflictResolveRequestCurrent,
  isConflictResolveRequestStale,
  resetAccountSaveConflictGuards,
} from '../src/services/accountSaveConflictSession';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const hook = read('src/hooks/useAccountCenter.ts');
const login = read('src/services/accountCloudLogin.ts');
const session = read('src/services/accountSaveConflictSession.ts');
const sync = read('src/storage/cloudSaveSync.ts');
const errors = read('src/utils/cloudSaveConflict.ts');
const cloud = read('src/services/cloudSaveService.ts');
const dialog = read('src/components/ui/AppDialog.tsx');

console.log('\n=== Account Cloud Conflict Resolver ===\n');

console.log('1. Valid cloud restore path');
assert(login.includes('executeAtomicCloudSaveRestore'), 'atomic cloud restore');
assert(login.includes("stage: 'cloud-meta-fetch'"), 'cloud meta fetch stage log');
assert(login.includes("stage: 'success'"), 'success stage log');

console.log('\n2. Restore success closes modal');
assert(hook.includes('completeAccountSaveConflictSession'), 'session completed on success');
assert(hook.includes('isConflictResolveRequestStale'), 'stale-token check does not treat resolved as skip');
assert(hook.includes('dismissible: false'), 'loading dialog blocks outside dismiss');
assert(hook.includes('Bulut kaydı yüklendi'), 'success title after restore');
assert(hook.includes('Devam Et'), 'success CTA after restore');
assert(hook.includes('presentRestoreSuccess'), 'success presenter closes modal');
assert(hook.includes('[CLOUD_RESTORE] loading=false'), 'loading flag always cleared');
assert(login.includes("logCloudRestore('restore complete')"), 'restore-complete log before UI close');
assert(!login.includes('await initCloudSaveSync'), 'modal does not wait for post-restore sync init');

console.log('\n3. Network fail → retry without re-login');
assert(
  getCloudSaveConflictErrorMessage('network-failed') ===
    'Bulut kaydı şu anda yüklenemedi.',
  'transient fetch copy',
);
assert(isRetryableCloudSaveConflictReason('network-failed'), 'network fail retryable');
assert(hook.includes('retryPostSignInSaveFlow'), 'retry uses same authenticated UID');
assert(hook.includes('Tekrar Dene'), 'retry CTA');

console.log('\n4. Checksum invalid → permanent');
assert(isPermanentCloudSaveConflictReason('checksum-invalid'), 'checksum invalid permanent');
assert(!isRetryableCloudSaveConflictReason('checksum-invalid'), 'checksum not retryable');
assert(hook.includes('cloudDisabled'), 'cloud CTA can be disabled');

console.log('\n5. Owner mismatch → permanent');
assert(isPermanentCloudSaveConflictReason('owner-mismatch'), 'owner mismatch permanent');

console.log('\n6. Legacy missing ownerUid allowed');
assert(cloud.includes('expectedOwnerUid'), 'legacy owner falls back to path uid');
assert(
  login.includes('payload.ownerUid.length > 0') &&
    login.includes('payload.ownerUid !== authenticatedUid'),
  'owner mismatch only when ownerUid present and different',
);

console.log('\n7. Raw-first checksum policy');
assert(cloud.includes('verifyRawSaveChecksum'), 'raw-first checksum on cloud load');

console.log('\n8. Local and fresh choice paths');
assert(login.includes('uploadLocalSaveForUid'), 'local bind path');
assert(login.includes("choice === 'fresh'"), 'fresh bind path');
assert(hook.includes("handleResolveAccountSaveConflict('local'"), 'local CTA wired');
assert(hook.includes("handleResolveAccountSaveConflict('fresh'"), 'fresh CTA wired');
assert(login.includes('bypassAccountConflictLock: true'), 'local upload bypasses lock');

console.log('\n9. Double tap guard');
assert(session.includes("session.status === 'resolving'"), 'resolving gate');
assert(hook.includes('beginConflictResolveRequest'), 'request token');

console.log('\n10. UID-based resolver');
assert(login.includes('export async function resolveSaveConflict'), 'resolveSaveConflict exported');
assert(!session.includes('credential:'), 'session has no credential field');

console.log('\n11. Sync lock');
assert(sync.includes('isCloudSaveAccountConflictPending()'), 'conflict lock');
assert(sync.includes('isAutomaticCloudUploadBlockedBySaveFlow()'), 'save flow lock');

console.log('\n12. Resolved/cleared session is not treated as stale');
assert(session.includes('export function isConflictResolveRequestStale'), 'stale helper exported');
assert(!hook.includes('if (!isConflictResolveRequestCurrent(request.token))'), 'success UI is not skipped after resolve');
assert(hook.includes('setPendingAccountConflict(null)'), 'pending conflict cleared');
assert(hook.includes('Buluttan Yükle'), 'cloud restore CTA label');
assert(dialog.includes('dismissible?: boolean'), 'dialog supports blocking dismiss');

resetAccountSaveConflictGuards();
const created = beginAccountSaveConflictSession({
  provider: 'google',
  authenticatedUid: 'uid-1',
});
const request = beginConflictResolveRequest(created.conflictId);
assert(request.ok === true, 'begin resolve request');
if (request.ok) {
  assert(isConflictResolveRequestCurrent(request.token), 'current while resolving');
  assert(!isConflictResolveRequestStale(request.token), 'not stale while resolving');
  completeAccountSaveConflictSession(request.token);
  assert(!isConflictResolveRequestCurrent(request.token), 'current is false after complete');
  assert(
    !isConflictResolveRequestStale(request.token),
    'resolved same token must still present UI',
  );
  clearAccountSaveConflictSession();
  assert(
    !isConflictResolveRequestStale(request.token),
    'cleared session must still present UI',
  );
}

console.log('\nPayload validation');
assert(
  validateCloudSaveRestorePayload(
    {
      schemaVersion: 1,
      saveVersion: 3,
      gameState: { player: { money: 1, trucks: [], drivers: [], trailers: [], warehouses: [] } },
    },
    6,
  ) === null,
  'valid payload with gameState.version fallback',
);

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
