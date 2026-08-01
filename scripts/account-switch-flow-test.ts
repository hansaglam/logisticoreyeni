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
  resolve(process.cwd(), 'src/components/AccountSection.tsx'),
  'utf8',
);
const authSource = readFileSync(
  resolve(process.cwd(), 'src/services/authService.ts'),
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
assert.match(accountSource, /Google Hesabından Çıkış Yap/);
assert.match(accountSource, /Kaydet ve Hesap Değiştir/);
assert.match(accountSource, /Farklı Hesap Seç/);
assert.match(accountSource, /handleCancelGoogleLinkConflict/);
assert.match(accountSource, /handleSelectDifferentGoogleAccount/);
assert.match(accountSource, /forceInteractivePicker:\s*true/);
assert.match(accountSource, /if \(isSwitchingAccount\) return/);
assert.match(accountSource, /isVehicleMarketplaceOperationActive/);
assert.match(accountSource, /activeMarketplaceListingIds: \[\]/);
assert.ok(
  accountSource.indexOf('syncBeforeAccountTransition()') <
    accountSource.indexOf('beginGoogleAccountSwitchSelection()'),
  'cloud sync must precede account selection',
);
assert.match(authSource, /clearGoogleSignInSessionStrict/);
assert.match(authSource, /cancelPendingGoogleLinkConflict/);
assert.match(authSource, /signOutGoogleAccountToGuest/);
assert.match(authSource, /forceInteractivePicker/);
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
assert.match(firebaseSource, /getAuth\(app\)/);
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

console.log('[account-switch-flow-test] PASS', {
  firebaseSingleton: true,
  noAuthReinitialize: true,
  safeSyncBeforeSwitch: true,
  interactivePicker: true,
  conflictCancelClearsProvider: true,
  selectDifferentAccount: true,
  noRevokeAccess: true,
  marketplaceIsolation: true,
  structuredErrors: 7,
});
