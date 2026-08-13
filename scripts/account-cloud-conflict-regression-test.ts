/**
 * Guest → existing Google/Apple cloud-save conflict resolver regression.
 * Run: npx tsx scripts/account-cloud-conflict-regression-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getCloudSaveConflictErrorMessage,
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
const auth = read('src/services/authService.ts');
const session = read('src/services/accountSaveConflictSession.ts');
const sync = read('src/storage/cloudSaveSync.ts');
const errors = read('src/utils/cloudSaveConflict.ts');

console.log('\n=== Account Cloud Conflict Resolver ===\n');

console.log('Stale React state no longer gates cloud CTA');
assert(!hook.includes("pendingAccountConflict?.provider !== provider"), 'no stale pendingAccountConflict provider check');
assert(!hook.includes("'Kayıt kullanılamıyor'"), 'generic unavailable alert title removed from handler');
assert(hook.includes('handleResolveAccountSaveConflict'), 'canonical resolve handler');
assert(hook.includes("choice: 'cloud'") || hook.includes("'cloud', provider"), 'cloud choice wired');
assert(hook.includes("void handleResolveAccountSaveConflict('cloud'"), 'Bulut Kaydı calls resolver');
assert(hook.includes("void handleResolveAccountSaveConflict('local'"), 'Bu Cihazdaki Kayıt calls resolver');

console.log('\nSession is source of truth');
assert(session.includes('beginAccountSaveConflictSession'), 'session begin');
assert(session.includes('beginConflictResolveRequest'), 'request token');
assert(hook.includes('ensureAccountSaveConflictSession'), 'press rebuilds/reuses session from credential');
assert(hook.includes('beginAccountSaveConflictSession'), 'dialog opens session synchronously');

console.log('\nCloud restore + local bind');
assert(auth.includes("choice?: 'cloud' | 'local'"), 'auth resolver accepts choice');
assert(auth.includes("choice === 'local'"), 'local bind path');
assert(auth.includes('bypassAccountConflictLock: true'), 'explicit local upload bypasses conflict lock');
assert(auth.includes('loadGameFromCloudDetailed'), 'fresh cloud fetch');
assert(
  auth.includes("typeof payload.ownerUid === 'string'") &&
    auth.includes('payload.ownerUid !== selectedAccountUid'),
  'owner mismatch only when ownerUid present and different',
);
assert(auth.includes('invalidateSaveRecoveryColdStartProbe'), 'probe cache invalidated after resolve');

console.log('\nSync lock');
assert(sync.includes('isCloudSaveAccountConflictPending()'), 'auto cloud write blocked during conflict');
assert(sync.includes('bypassAccountConflictLock'), 'explicit resolve upload can bypass');
assert(sync.includes('syncLeaderboardFromGameState') && sync.includes('isCloudSaveAccountConflictPending()'), 'leaderboard blocked during conflict');

console.log('\nError model');
assert(
  getCloudSaveConflictErrorMessage('cloud-save-fetch-failed') ===
    'Bulut kaydı şu anda yüklenemedi. Tekrar dene.',
  'transient fetch copy',
);
assert(
  getCloudSaveConflictErrorMessage('cloud-save-not-found').includes('bulunamadı'),
  'not-found copy',
);
assert(isRetryableCloudSaveConflictReason('cloud-save-fetch-failed'), 'fetch fail retryable');
assert(!isRetryableCloudSaveConflictReason('owner-mismatch'), 'owner mismatch not retryable');
assert(errors.includes('cloud-save-fetch-failed'), 'fetch-failed code');
assert(hook.includes('isRetryableCloudSaveConflictReason'), 'retry keeps conflict dialog');
assert(hook.includes('Bulut Kaydı Yükleniyor'), 'loading label on cloud CTA');

console.log('\nPayload validation still strict');
assert(
  validateCloudSaveRestorePayload(
    {
      schemaVersion: 1,
      saveVersion: 3,
      gameState: { player: { money: 1, trucks: [], drivers: [], trailers: [], warehouses: [] } },
    },
    3,
  ) === null,
  'valid payload',
);

console.log('\nShared Google/Apple resolver');
assert(hook.includes("provider: 'google' | 'apple'"), 'shared dialog for both providers');
assert(auth.includes("provider: 'google' | 'apple'"), 'shared auth switch');

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
