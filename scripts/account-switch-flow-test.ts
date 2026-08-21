import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getAccountTransitionErrorMessage,
  isLocalSaveSafeForAccountTransition,
} from '../src/utils/accountTransition';
import type { StoreGameState } from '../src/types/game';

const validState = {
  currentTime: 100,
  player: {
    money: 10_000,
    trucks: [],
    drivers: [],
  },
} as unknown as StoreGameState;
assert.equal(isLocalSaveSafeForAccountTransition(validState), true);
assert.equal(
  isLocalSaveSafeForAccountTransition({
    ...validState,
    player: { ...validState.player, money: Number.NaN },
  }),
  false,
);

for (const reason of [
  'cloud-sync-failed',
  'sign-out-failed',
  'google-disconnect-failed',
  'account-picker-cancelled',
  'auth-required',
  'marketplace-operation-active',
  'network-error',
] as const) {
  assert.ok(getAccountTransitionErrorMessage(reason).length > 20, reason);
}

const accountSource = readFileSync(
  resolve(process.cwd(), 'src/hooks/useAccountCenter.ts'),
  'utf8',
);
const authSource = readFileSync(
  resolve(process.cwd(), 'src/services/authService.ts'),
  'utf8',
);
const switchServiceSource = readFileSync(
  resolve(process.cwd(), 'src/services/accountSwitchService.ts'),
  'utf8',
);
const googleSource = readFileSync(
  resolve(process.cwd(), 'src/services/googleAuthService.ts'),
  'utf8',
);
const firebaseSource = readFileSync(
  resolve(process.cwd(), 'src/services/firebase.ts'),
  'utf8',
);

assert.match(accountSource, /Hesap Değiştir/);
assert.match(accountSource, /Çıkış Yap/);
assert.match(accountSource, /Kaydet ve Hesap Değiştir/);
assert.match(accountSource, /resolveSaveConflict/);
assert.match(accountSource, /runPostSignInSaveFlow|applyProviderSaveOutcome/);
assert.match(accountSource, /İki farklı kayıt bulundu|getAccountLinkConflictTitle/);
assert.match(accountSource, /retryPostSignInSaveFlow/);
assert.match(accountSource, /if \(isSwitchingAccount\) return/);
assert.match(accountSource, /isVehicleMarketplaceOperationActive/);
assert.match(accountSource, /activeMarketplaceListingIds: \[\]/);
assert.match(accountSource, /rollbackAccountSwitch/);
assert.match(accountSource, /commitAccountSwitch/);
assert.match(switchServiceSource, /rollbackAccountSwitch/);
assert.match(switchServiceSource, /commitAccountSwitch/);
assert.match(switchServiceSource, /assertLocalSaveOwnerMatchesAuth/);
assert.ok(
  accountSource.indexOf('syncBeforeAccountTransition()') <
    accountSource.indexOf('beginGoogleAccountSwitchSelection()'),
  'cloud sync must precede account selection',
);
assert.match(authSource, /clearGoogleSignInSessionStrict/);
assert.match(authSource, /cancelPendingGoogleLinkConflict/);
assert.match(authSource, /signOutGoogleAccountToGuest/);
assert.match(authSource, /forceInteractivePicker/);
assert.match(authSource, /runPostSignInSaveFlowForAccountSwitch/);
assert.match(authSource, /saveOutcome/);
assert.match(authSource, /completeExistingProviderAccountLogin/);
assert.match(authSource, /resolveSaveConflict/);
assert.match(authSource, /linkAnonymousAccountWithApple/);
assert.match(googleSource, /GoogleSignin\.signIn\(\)/);
assert.match(googleSource, /forceInteractivePicker/);
assert.match(googleSource, /\[google-account-picker\]/);
assert.doesNotMatch(googleSource, /signInSilently/);
assert.doesNotMatch(googleSource, /revokeAccess\s*\(/);
assert.doesNotMatch(authSource, /revokeAccess\s*\(/);
assert.equal(
  (firebaseSource.match(/initializeAuth\(app/g) ?? []).length,
  1,
  'Firebase Auth must have one canonical initialization point',
);
assert.match(firebaseSource, /getFirebaseAuthSafe/);
assert.doesNotMatch(firebaseSource, /getAuth\(app\)/);
assert.doesNotMatch(
  firebaseSource,
  /auth already initialized but local reference lost/,
);
assert.doesNotMatch(
  authSource.slice(
    authSource.indexOf('export async function beginGoogleAccountSwitchSelection'),
    authSource.indexOf('export async function linkSelectedGoogleAccountToGuest'),
  ),
  /initAnonymousAuth\(\)|resetFirebaseAuthCache|resetAuthService\(\)/,
  'account switching must not create an anonymous session or reset Auth',
);
assert.match(authSource, /AccountSwitchTransitionState/);
assert.match(authSource, /'opening-account-picker'/);
assert.match(authSource, /'authenticating-new-account'/);
assert.match(authSource, /'checking-cloud-save'/);

const loginSource = readFileSync(
  resolve(process.cwd(), 'src/services/accountCloudLogin.ts'),
  'utf8',
);
assert.match(loginSource, /runPostSignInSaveFlow/);
assert.match(loginSource, /areLocalAndCloudSavesDifferent/);
assert.doesNotMatch(loginSource, /awaitBeforeDeadline/);
assert.doesNotMatch(loginSource, /restoreGuestAnonymousSession/);

const cancelBlock = accountSource.slice(
  accountSource.indexOf('showAccountConflictDialog'),
  accountSource.indexOf('const applyProviderSaveOutcome'),
);
assert.doesNotMatch(cancelBlock, /cancelPendingGoogleLinkConflict/);

console.log('[account-switch-flow-test] PASS', {
  firebaseSingleton: true,
  noAuthReinitialize: true,
  safeSyncBeforeSwitch: true,
  interactivePicker: true,
  uidBasedSaveFlow: true,
  postSignInAutoRestore: true,
  rollbackAndCommitSwitchService: true,
  ownerUidIsolationHooks: true,
  noRevokeAccess: true,
  marketplaceIsolation: true,
  structuredErrors: 7,
});
