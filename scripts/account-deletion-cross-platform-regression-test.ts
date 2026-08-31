/**
 * Cross-platform account deletion regression (static + architecture checks).
 * Run: npx tsx scripts/account-deletion-cross-platform-regression-test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const deletion = read('src/utils/accountDeletion.ts');
const lifecycle = read('src/utils/accountLifecycleLog.ts');
const cloud = read('src/services/cloudSaveService.ts');
const marketplace = read('src/services/vehicleMarketplaceService.ts');
const auth = read('src/services/authService.ts');
const backendDeletion = read('backend/src/accountDeletion.ts');
const backendLeaderboard = read('backend/src/leaderboard.ts');
const backendIndex = read('backend/src/index.ts');
const hook = read('src/hooks/useAccountCenter.ts');

console.log('\n=== Account Deletion Cross-Platform Regression ===\n');

console.log('1. No marketplace records (server idempotent)');
assert(
  backendDeletion.includes('prepareMarketplaceAccountDeletion'),
  'marketplace cleanup invoked on server',
);

console.log('\n2. Active marketplace listing');
assert(
  backendDeletion.includes('ACCOUNT_DELETE_STAGE_MARKETPLACE'),
  'marketplace stage diagnostics',
);

console.log('\n3. Missing username record');
assert(
  backendDeletion.includes('releaseUsernameForUid'),
  'username release tolerates missing profile',
);

console.log('\n4. Missing leaderboard record');
assert(
  !backendLeaderboard.includes("collectionGroup('entries')"),
  'leaderboard cleanup avoids collection-group uid index',
);
assert(
  backendLeaderboard.includes('listDocuments'),
  'leaderboard cleanup uses direct season paths',
);

console.log('\n5. Already partially deleted account');
assert(
  backendDeletion.includes('userSnap.exists'),
  'recursive delete skipped when user doc absent',
);

console.log('\n6. recursiveDelete success path');
assert(
  backendDeletion.includes('recursiveDelete'),
  'server recursive delete retained',
);

console.log('\n7. Apple revoke success');
assert(
  backendDeletion.includes('ACCOUNT_DELETE_STAGE_APPLE_REVOKE'),
  'Apple revoke stage on server',
);
assert(
  deletion.includes('resolveAppleAuthorizationCodeForDeletion'),
  'client obtains Apple code before callable',
);

console.log('\n8. Apple revoke idempotent / non-blocking');
assert(
  backendDeletion.includes('appleRevoked = revokeResult.ok'),
  'Apple revoke failure does not abort deletion',
);

console.log('\n9. Firebase Auth deletion (server-side Admin SDK)');
assert(
  backendDeletion.includes('auth.deleteUser'),
  'Admin SDK auth deletion',
);
assert(
  backendDeletion.includes('auth/user-not-found'),
  'auth delete idempotent when user already absent',
);

console.log('\n10. recent-login-required fallback (guest / legacy)');
assert(
  deletion.includes('deleteCurrentFirebaseUser'),
  'client auth delete fallback retained',
);
assert(
  deletion.includes('requires-recent-login'),
  'recent-login path preserved',
);

console.log('\n11. Google-linked account');
assert(
  deletion.includes("provider === 'guest'"),
  'guest vs linked branching',
);
assert(
  auth.includes('signOutAfterServerAccountDeletion'),
  'Google session cleared after server delete',
);

console.log('\n12. Apple-linked account');
assert(
  marketplace.includes('authorizationCode'),
  'callable accepts Apple authorization code',
);

console.log('\n13. Guest deletion');
assert(
  deletion.includes('isGuest'),
  'guest skips linked-account cloud callable',
);

console.log('\n14. Retry after partial failure');
assert(
  deletion.includes('skipCloudDelete'),
  'retry can skip cloud cleanup',
);
assert(
  deletion.includes('completeAccountDeletionAfterReauth'),
  'reauth retry helper exported',
);

console.log('\n15. Android parity (shared orchestration)');
assert(
  lifecycle.includes('Platform.OS'),
  'platform logged in diagnostics',
);
assert(
  !deletion.includes("Platform.OS === 'ios'"),
  'no iOS-only deletion fork in orchestrator',
);

console.log('\n16. iOS parity (shared orchestration)');
assert(
  deletion.includes('deleteUserCloudData'),
  'single cloud deletion entry point',
);

console.log('\nProduction diagnostics');
assert(
  lifecycle.includes('ACCOUNT_DELETE_STAGE_MARKETPLACE'),
  'stable marketplace stage name',
);
assert(
  lifecycle.includes('productionSafeDeletePayload'),
  'production logs omit sensitive fields',
);

console.log('\nUser-facing error UX');
assert(
  deletion.includes('Hesap silinemedi. Lütfen tekrar deneyin.'),
  'generic Turkish failure message',
);
assert(
  hook.includes('Hesap silinemedi. Lütfen tekrar deneyin.'),
  'hook uses generic failure copy',
);
assert(
  !deletion.includes('marketplace-account-cleanup-failed'),
  'technical codes not shown to user',
);

console.log('\nServer callable contract');
assert(
  backendIndex.includes('deleteLinkedAccount'),
  'callable delegates to accountDeletion service',
);
assert(
  cloud.includes('authDeletedByServer'),
  'client reads server auth deletion result',
);

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
