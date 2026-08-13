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

console.log('\n=== Account Cloud Conflict Resolver ===\n');

console.log('1. Valid cloud restore path');
assert(login.includes('executeAtomicCloudSaveRestore'), 'atomic cloud restore');
assert(login.includes("stage: 'cloud-meta-fetch'"), 'cloud meta fetch stage log');
assert(login.includes("stage: 'success'"), 'success stage log');

console.log('\n2. Restore success closes modal');
assert(hook.includes('completeAccountSaveConflictSession'), 'session completed on success');
assert(hook.includes('hideDialog()'), 'dialog hidden on success');
assert(hook.includes('setPendingAccountConflict(null)'), 'pending conflict cleared');

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

console.log('\n8. Local choice still works');
assert(login.includes('uploadLocalSaveForUid'), 'local bind path');
assert(hook.includes("handleResolveAccountSaveConflict('local'"), 'local CTA wired');
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
