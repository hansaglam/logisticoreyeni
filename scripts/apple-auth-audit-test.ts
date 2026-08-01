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
    appleSrc.includes('nonce: hashedResult.hash'),
    'sends hashed nonce to Apple signInAsync',
  );
  assert(appleSrc.includes('identityToken'), 'checks identityToken');
  assert(appleSrc.includes('apple-token-missing'), 'maps missing identityToken');
  assert(
    !appleSrc.includes('idToken: appleCredential.authorizationCode') &&
      !appleSrc.includes('idToken: authorizationCode'),
    'does not use authorizationCode as idToken',
  );
  assert(appleSrc.includes('[apple-auth-failed]'), 'safe failure log present');
  assert(appleSrc.includes('fullName'), 'captures Apple fullName on first login');
  assert(appleSrc.includes('ERR_REQUEST_CANCELED'), 'maps user cancel');
  assert(appleSrc.includes('generateSecureNonceAsync'), 'uses secure nonce helper');

  const authSrc = readSrc('src/services/authService.ts');
  assert(authSrc.includes('linkWithCredential'), 'anonymous link uses linkWithCredential');
  assert(authSrc.includes("Platform.OS !== 'ios'"), 'Apple link entry gated to iOS');
  assert(authSrc.includes('provider-not-enabled'), 'maps provider-not-enabled');
  assert(authSrc.includes('provider-already-linked'), 'maps provider-already-linked');
  assert(authSrc.includes('updateProfile'), 'can update displayName from Apple profile');
  assert(authSrc.includes('already-linked'), 'blocks non-anonymous re-link');
  assert(authSrc.includes('getFirebaseAuthSafe'), 'uses Firebase Auth singleton helper');

  const accountSrc = readSrc('src/components/AccountSection.tsx');
  assert(
    accountSrc.includes("Platform.OS === 'ios' && appleAvailable"),
    'Apple button only on iOS when available',
  );
  assert(accountSrc.includes("error === 'cancelled'"), 'cancel is not shown as error modal');
  assert(accountSrc.includes('isLinking'), 'double-tap guard via isLinking');
  assert(accountSrc.includes('AuthProviderButton'), 'uses shared AuthProviderButton');

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
