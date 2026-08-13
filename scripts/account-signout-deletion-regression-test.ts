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
const connectionTab = read('src/components/accountCenter/AccountConnectionTab.tsx');
const danger = read('src/components/accountCenter/DangerZoneCard.tsx');

console.log('\n=== Account Sign-Out & Deletion P0 Regression ===\n');

console.log('Sign-out wiring');
assert(connectionTab.includes('onSignOut'), 'account tab exposes sign-out handler');
assert(connectionTab.includes('Çıkış Yap'), 'sign-out label present');
assert(hook.includes('handleGoogleSignOut'), 'sign-out handler exported');
assert(hook.includes('signOutGoogleAccountToGuest'), 'firebase signOut path');
assert(hook.includes('Çıkış yapmak istiyor musun?'), 'sign-out confirmation title');
assert(hook.includes('Buluta kaydedilmiş ilerlemen korunur'), 'sign-out confirmation body');
assert(hook.includes('syncBeforeSignOutBestEffort'), 'best-effort pre-sync');
assert(!hook.includes('Çıkış iptal edildi'), 'sign-out no longer hard-blocked on sync fail');
assert(hook.includes('rebindLocalSaveToAuth'), 'ownerUid rebound after sign-out');
assert(hook.includes('clearAccountScopedClientState'), 'scoped client state cleared');
assert(hook.includes('setUsernameProfile(null)'), 'username cache cleared on sign-out');
assert(hook.includes('logAccountSignOut'), 'structured sign-out logging');

console.log('\nSign-out security');
assert(auth.includes('await signOut(auth)'), 'firebase signOut awaited');
assert(auth.includes('initAnonymousAuth'), 'guest bootstrap after sign-out');
assert(hook.includes('activeMarketplaceListingIds: []'), 'marketplace cache cleared');
assert(hook.includes('resetCloudSaveSyncState'), 'cloud sync state reset');

console.log('\nDeletion wiring');
assert(danger.includes('Hesabı Sil'), 'delete CTA in danger zone');
assert(hook.includes('handleDeleteAccount'), 'delete handler in hook');
assert(hook.includes('Hesabı Kalıcı Olarak Sil'), 'second confirmation CTA');
assert(hook.includes('runAccountDeletionFlow'), 'canonical deletion runner');
assert(deletion.includes('deleteUserCloudData'), 'cloud deletion step');
assert(deletion.includes('deleteCurrentFirebaseUser'), 'auth user deletion step');
assert(deletion.includes('skipCloudDelete'), 'reauth retry can skip cloud');
assert(hook.includes('reauthenticateCurrentUser'), 'reauth on requires-recent-login');

console.log('\nBackend orchestration');
assert(cloud.includes('prepareVehicleMarketplaceAccountDeletion'), 'marketplace cleanup callable');
assert(backend.includes('releaseUsernameForUid'), 'username release on server');
assert(backend.includes('deleteLeaderboardEntriesForUid'), 'leaderboard cleanup on server');
assert(backend.includes('recursiveDelete'), 'admin recursive user delete');

console.log('\nDeletion messages');
assert(
  deletion.includes("case 'requires-recent-login':") &&
    deletion.includes('tekrar giriş yapman gerekiyor'),
  'recent-login user message',
);
assert(deletion.includes('completeAccountDeletionAfterReauth'), 'reauth helper exported');

console.log('\nDanger zone isolation');
assert(!danger.includes('onSignOut'), 'logout not in danger zone');
assert(!danger.includes('Çıkış Yap'), 'logout not in danger zone');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
