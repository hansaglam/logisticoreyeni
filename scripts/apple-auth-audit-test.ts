/**
 * Apple Sign-In audit / regression checks (headless, Node-only).
 * Run: node --experimental-strip-types scripts/apple-auth-audit-test.ts
 */

import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function isAccountLinkConflictError(error?: string, errorKind?: string): boolean {
  if (
    errorKind === 'credential-already-in-use' ||
    errorKind === 'account-exists-with-different-credential'
  ) {
    return true;
  }
  return (
    error === 'credential-already-in-use' ||
    error === 'account-exists-with-different-credential' ||
    error === 'auth/credential-already-in-use' ||
    error === 'auth/email-already-in-use' ||
    error === 'auth/account-exists-with-different-credential'
  );
}

function run(): void {
  console.log('\nApple Auth Audit\n');

  const nonceSrc = readSrc('src/utils/authNonce.ts');
  assert(!/\bMath\.random\s*\(/.test(nonceSrc), 'nonce helper does not use Math.random()');
  assert(nonceSrc.includes('getRandomBytesAsync'), 'nonce helper uses getRandomBytesAsync');
  assert(nonceSrc.includes('generateSecureNonceAsync'), 'secure nonce API exported');
  assert(nonceSrc.includes('digestStringAsync'), 'sha256 via expo-crypto digestStringAsync');

  const appleSrc = readSrc('src/services/appleAuthService.ts');
  assert(appleSrc.includes("Platform.OS !== 'ios'"), 'Apple auth gated to iOS');
  assert(appleSrc.includes('AppleAuthenticationScope.FULL_NAME'), 'requests FULL_NAME scope');
  assert(appleSrc.includes('AppleAuthenticationScope.EMAIL'), 'requests EMAIL scope');
  assert(appleSrc.includes("OAuthProvider('apple.com')"), 'uses apple.com OAuth provider');
  assert(appleSrc.includes('rawNonce'), 'passes rawNonce to Firebase credential');
  assert(
    appleSrc.includes('nonce: hashedNonce'),
    'sends hashed nonce to Apple signInAsync',
  );
  assert(appleSrc.includes('identityToken'), 'checks identityToken');
  assert(appleSrc.includes('APPLE_IDENTITY_TOKEN_MISSING'), 'maps missing identityToken');
  assert(
    !appleSrc.includes('idToken: appleCredential.authorizationCode') &&
      !appleSrc.includes('idToken: authorizationCode'),
    'does not use authorizationCode as idToken',
  );
  assert(appleSrc.includes('logAppleAuthFlow'), 'safe failure log present');
  assert(appleSrc.includes("logAppleAuth('nonce_generated'"), 'APPLE_AUTH nonce step wired');
  assert(appleSrc.includes("logAppleAuth('apple_request_started'"), 'APPLE_AUTH request start wired');
  assert(appleSrc.includes('[apple-auth-config]'), 'runtime config log present');
  assert(appleSrc.includes('fullName'), 'captures Apple fullName on first login');
  assert(appleSrc.includes('ERR_REQUEST_CANCELED') || appleSrc.includes("mappedError"), 'maps user cancel');
  assert(appleSrc.includes('generateSecureNonceAsync'), 'uses secure nonce helper');
  assert(appleSrc.includes('native-request-start'), 'stage native-request-start present');
  assert(appleSrc.includes('extractSafeAppleErrorFields'), 'reads non-enumerable error fields');
  assert(appleSrc.includes('config-validation'), 'stage config-validation present');
  assert(appleSrc.includes('FIREBASE_RUNTIME_CONFIG_MISMATCH'), 'runtime config mismatch guard present');

  const authSrc = readSrc('src/services/authService.ts');
  assert(authSrc.includes('linkWithCredential'), 'anonymous link uses linkWithCredential');
  assert(authSrc.includes("Platform.OS !== 'ios'"), 'Apple link entry gated to iOS');
  assert(authSrc.includes('provider-not-enabled'), 'maps provider-not-enabled');
  assert(authSrc.includes('provider-already-linked'), 'maps provider-already-linked');
  assert(authSrc.includes('updateProfile'), 'can update displayName from Apple profile');
  assert(authSrc.includes('already-linked-success'), 'treats existing Apple provider as linked');
  assert(authSrc.includes('getFirebaseAuthSafe'), 'uses Firebase Auth singleton helper');
  assert(authSrc.includes('ensureFirebaseAuthReady'), 'Apple link requires Auth readiness');
  assert(authSrc.includes('shouldContinueExistingAppleAccountSignIn'), 'existing Apple account continue helper used');
  assert(authSrc.includes('signInWithAppleAccount'), 'fresh Apple credential requested after spent token');
  assert(
    !authSrc.includes("throw new Error('auth-unavailable')") &&
      !authSrc.includes("error: 'auth-unavailable'"),
    'auth-unavailable literal is not returned from authService',
  );

  const accountCenterHook = readSrc('src/hooks/useAccountCenter.ts');
  const accountConnectionTab = readSrc('src/components/accountCenter/AccountConnectionTab.tsx');
  const accountCenterScreen = readSrc('src/screens/AccountCenterScreen.tsx');
  assert(
    accountCenterHook.includes("Platform.OS === 'ios' && appleAvailable"),
    'Apple button only on iOS when available',
  );
  assert(
    accountConnectionTab.includes('showApple') && accountConnectionTab.includes('Apple ile Devam Et'),
    'AccountConnectionTab conditionally renders Apple action',
  );
  assert(
    accountCenterHook.includes("result.error === 'cancelled'") &&
      accountCenterHook.includes('isAppleAuthCancelFailure'),
    'cancel is not shown as error modal',
  );
  assert(
    accountCenterHook.includes('isLinking') &&
      accountCenterHook.includes('linkTapLock') &&
      accountConnectionTab.includes('disabled={Boolean(isLinking)}'),
    'double-tap guard via isLinking',
  );
  assert(
    accountConnectionTab.includes('ActionButton') &&
      accountConnectionTab.includes('Apple ile Devam Et') &&
      accountConnectionTab.includes('onLinkApple') &&
      accountCenterScreen.includes("onLinkApple={() => void vm.handleLink('apple')}"),
    'Apple CTA wired through AccountConnectionTab',
  );

  const entitlements = readSrc('ios/LogistiCore/LogistiCore.entitlements');
  assert(
    entitlements.includes('com.apple.developer.applesignin'),
    'Sign in with Apple entitlement present',
  );
  assert(entitlements.includes('<string>Default</string>'), 'applesignin Default value present');

  const appConfig = readSrc('app.config.js');
  assert(appConfig.includes("bundleIdentifier: 'com.ethemsincar.logisticore'"), 'bundle id configured');
  assert(appConfig.includes('usesAppleSignIn: true'), 'usesAppleSignIn enabled');
  assert(appConfig.includes("'expo-apple-authentication'"), 'expo-apple-authentication plugin');

  const firebaseSrc = readSrc('src/services/firebase.ts');
  assert(firebaseSrc.includes('initializeAuth'), 'Auth uses initializeAuth singleton path');
  assert(!firebaseSrc.includes('getAuth('), 'Auth does not call getAuth(');

  assert(
    isAccountLinkConflictError('credential-already-in-use'),
    'conflict detector: credential-already-in-use',
  );
  assert(
    isAccountLinkConflictError(undefined, 'account-exists-with-different-credential'),
    'conflict detector: account-exists-with-different-credential',
  );
  assert(!isAccountLinkConflictError('cancelled'), 'cancel is not a conflict');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
