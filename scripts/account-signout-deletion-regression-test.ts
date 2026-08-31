/**
 * Account sign-out and deletion P0 regression.
 * Run: npx tsx scripts/account-signout-deletion-regression-test.ts
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

const hook = read('src/hooks/useAccountCenter.ts');
const auth = read('src/services/authService.ts');
const deletion = read('src/utils/accountDeletion.ts');
const cloud = read('src/services/cloudSaveService.ts');
const backend = read('backend/src/index.ts');
const backendDeletion = read('backend/src/accountDeletion.ts');
const connectionTab = read('src/components/accountCenter/AccountConnectionTab.tsx');

console.log('\n=== Account Sign-Out & Deletion P0 Regression ===\n');

console.log('Sign-out wiring');
assert(connectionTab.includes('onSignOut'), 'account tab exposes sign-out handler');
assert(connectionTab.includes('Çıkış Yap'), 'sign-out label present');
assert(hook.includes('handleGoogleSignOut'), 'sign-out handler exported');
assert(hook.includes('signOutGoogleAccountToGuest'), 'firebase signOut path');
assert(hook.includes('Çıkış yapmak istiyor musun?'), 'sign-out confirmation title');
assert(
  hook.includes('bu cihazdaki oyun sıfırlanır'),
  'sign-out confirmation explains local reset',
);
assert(hook.includes('syncBeforeSignOutBestEffort'), 'best-effort pre-sync');
assert(!hook.includes('Çıkış iptal edildi'), 'sign-out no longer hard-blocked on sync fail');
assert(
  hook.includes('resetLocalSessionAfterLinkedAccountSignOut'),
  'local session reset after linked sign-out',
);
assert(hook.includes('clearAccountScopedClientState'), 'scoped client state cleared');
assert(hook.includes('setUsernameProfile(null)'), 'username cache cleared on sign-out');
assert(hook.includes('logAccountSignOut'), 'structured sign-out logging');

console.log('\nSign-out security');
assert(auth.includes('await signOut(auth)'), 'firebase signOut awaited');
assert(auth.includes('initAnonymousAuth'), 'guest bootstrap after sign-out');
assert(hook.includes('activeMarketplaceListingIds: []'), 'marketplace cache cleared');
assert(hook.includes('resetCloudSaveSyncState'), 'cloud sync state reset');

console.log('\nDeletion wiring');
assert(connectionTab.includes('Hesap ve Gizlilik'), 'delete section on account tab');
assert(connectionTab.includes('Hesabı Sil'), 'delete CTA on account tab');
assert(hook.includes('handleDeleteAccount'), 'delete handler in hook');
assert(hook.includes('Hesabı Kalıcı Olarak Sil'), 'second confirmation CTA');
assert(hook.includes('runAccountDeletionFlow'), 'canonical deletion runner');
assert(deletion.includes('deleteUserCloudData'), 'cloud deletion step');
assert(deletion.includes('signOutAfterServerAccountDeletion'), 'server auth delete sign-out path');
assert(deletion.includes('deleteCurrentFirebaseUser'), 'client auth fallback for guest');
assert(deletion.includes('skipCloudDelete'), 'reauth retry can skip cloud');
assert(deletion.includes('resolveAppleAuthorizationCodeForDeletion'), 'Apple code passed to callable');
assert(deletion.includes("provider === 'guest'"), 'guest skips linked-account cloud cleanup');
assert(hook.includes('reauthenticateCurrentUser'), 'reauth on requires-recent-login');

console.log('\nBackend orchestration');
assert(cloud.includes('prepareVehicleMarketplaceAccountDeletion'), 'trusted deletion callable client');
assert(backend.includes('deleteLinkedAccount'), 'server account deletion service');
assert(backendDeletion.includes('releaseUsernameForUid'), 'username release on server');
assert(backendDeletion.includes('deleteLeaderboardEntriesForUid'), 'leaderboard cleanup on server');
assert(backend.includes('revokeAppleSignInTokens'), 'Apple revoke callable on server');
assert(backendDeletion.includes('recursiveDelete'), 'admin recursive user delete');
assert(backendDeletion.includes('auth.deleteUser'), 'Admin SDK auth deletion');

console.log('\nDeletion messages');
assert(
  deletion.includes("case 'requires-recent-login':") &&
    deletion.includes('tekrar giriş yapman gerekiyor'),
  'recent-login user message',
);
assert(deletion.includes('completeAccountDeletionAfterReauth'), 'reauth helper exported');
assert(
  deletion.includes('Hesap silinemedi. Lütfen tekrar deneyin.'),
  'generic failure message',
);

console.log('\nAccount deletion placement');
assert(connectionTab.includes('Hesap ve Gizlilik'), 'dedicated privacy/delete section');
assert(!connectionTab.includes('Tehlikeli İşlemler'), 'no collapsed danger accordion on account tab');
assert(connectionTab.includes('onDeleteAccount'), 'delete handler prop on account tab');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
