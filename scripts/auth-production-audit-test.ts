import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { mapFirebaseAuthError } from '../src/utils/authErrors';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const firebase = read('src/services/firebase.ts');
const auth = read('src/services/authService.ts');
const google = read('src/services/googleAuthService.ts');
const apple = read('src/services/appleAuthService.ts');
const account = read('src/hooks/useAccountCenter.ts');

assert.equal((firebase.match(/initializeApp\(/g) ?? []).length, 1);
assert.equal((firebase.match(/initializeAuth\(app/g) ?? []).length, 1);
assert.match(firebase, /getAuth\(app\)/);
assert.match(firebase, /FIREBASE_FUNCTIONS_REGION = 'us-central1'/);
assert.match(firebase, /getFirebaseFunctionsSafe/);
assert.match(firebase, /getFirebaseStorageSafe/);
assert.doesNotMatch(firebase, /local reference lost/);

assert.equal(
  (auth.match(/onAuthStateChanged\(/g) ?? []).length,
  1,
  'Auth must use one app-lifetime Firebase listener',
);
assert.match(auth, /__logisticoreAuthListenerHub/);
assert.match(auth, /AuthLifecycleState/);
for (const state of [
  'idle',
  'initializing',
  'anonymous',
  'authenticated',
  'switching-account',
  'linking-provider',
  'checking-cloud-save',
  'resolving-conflict',
  'signing-out',
  'failed',
]) {
  assert.match(auth, new RegExp(`'${state}'`), state);
}

assert.match(google, /GoogleSignin\.signIn\(\)/);
assert.doesNotMatch(google, /signInSilently/);
assert.match(google, /GoogleSignin\.signOut\(\)/);
assert.match(google, /IN_PROGRESS/);

assert.match(apple, /Platform\.OS !== 'ios'/);
assert.match(apple, /isAvailableAsync\(\)/);
assert.match(apple, /FULL_NAME/);
assert.match(apple, /EMAIL/);
assert.match(apple, /rawNonce/);
assert.match(apple, /identityToken/);
assert.match(apple, /apple-token-missing/);
assert.match(apple, /apple-signin-cancelled/);
assert.match(apple, /displayName/);
assert.doesNotMatch(read('src/utils/authNonce.ts'), /Math\.random/);

assert.match(auth, /linkWithCredential\(currentUser, credential\)/);
assert.match(auth, /provider-already-linked/);
assert.match(auth, /credential-already-in-use/);
assert.match(auth, /account-exists-with-different-credential/);

const switchBody = auth.slice(
  auth.indexOf('export async function beginGoogleAccountSwitchSelection'),
  auth.indexOf('export async function linkSelectedGoogleAccountToGuest'),
);
assert.doesNotMatch(switchBody, /signInAnonymously|initAnonymousAuth\(\)/);
assert.match(switchBody, /signInWithCredential\(auth, google\.credential\)/);
assert.match(auth, /signOutGoogleAccountToGuest/);
assert.match(account, /finally \{\s*setIsSwitchingAccount\(false\)/);

assert.equal(mapFirebaseAuthError({ code: 'auth/network-request-failed' }), 'network-error');
assert.equal(
  mapFirebaseAuthError({ code: 'auth/credential-already-in-use' }),
  'credential-already-in-use',
);
assert.equal(
  mapFirebaseAuthError({ code: 'auth/account-exists-with-different-credential' }),
  'account-exists-with-different-credential',
);
assert.equal(
  mapFirebaseAuthError({ code: 'auth/provider-already-linked' }),
  'provider-already-linked',
);

console.log('[auth-production-audit-test] PASS', {
  appInitializationPoints: 1,
  authInitializationPoints: 1,
  firebaseAuthListeners: 1,
  googleInteractive: true,
  appleNonceSecure: true,
  crossProviderLinking: true,
});
