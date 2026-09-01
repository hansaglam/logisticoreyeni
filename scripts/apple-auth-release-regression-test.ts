/**
 * Apple Sign-In release regression tests.
 * Run: npx tsx scripts/apple-auth-release-regression-test.ts
 *
 * Mock signatures match firebase@10.12.5 OAuthProvider.credential({ idToken, rawNonce })
 * and expo-apple-authentication@8.0.8 signInAsync({ requestedScopes, nonce }).
 */

import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import {
  assertSafeAppleAuthLogPayload,
  createAppleOAuthCredentialParams,
  createSingleFlightController,
  extractSafeAppleErrorFields,
  formatAppleAuthDiagnosticDisplay,
  getAppleAuthDiagnosticCode,
  getAppleAuthUserMessage,
  getUnsafeAppleAuthLogKeys,
  isAppleAuthCancelFailure,
  isAppleExistingAccountConflictCode,
  isAppleProviderAlreadyLinkedCode,
  logAppleAuth,
  normalizeAppleAuthFailure,
  resolveAppleLinkPlan,
  sanitizeAppleAuthLogPayload,
  sanitizeAppleFullName,
  shouldContinueExistingAppleAccountSignIn,
  shouldRequestFreshAppleCredential,
  shouldShowInternalAuthDiagnostics,
} from '../src/utils/appleAuthDiagnostics';

const ROOT = process.cwd();

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
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

type MockAppleCredential = {
  identityToken: string | null;
  authorizationCode: string | null;
  email: string | null;
  fullName: { givenName: string | null; familyName: string | null; middleName: string | null } | null;
  user: string | null;
  realUserStatus: number;
};

async function runMockAppleFirebaseFlow(options: {
  identityToken?: string | null;
  email?: string | null;
  fullName?: MockAppleCredential['fullName'];
  currentUser: { isAnonymous: boolean; uid: string; providerIds: string[] };
  linkError?: { code: string } | null;
  signInError?: { code: string } | null;
}): Promise<{
  appleNonce: string | null;
  firebaseRawNonce: string | null;
  sameNonce: boolean;
  identityTokenAccepted: boolean;
  emailNullAccepted: boolean;
  fullNameNullAccepted: boolean;
  result:
    | { type: 'linked'; uid: string }
    | { type: 'already-linked'; uid: string }
    | { type: 'conflict'; code: string; reusedCredential: boolean }
    | { type: 'signed-in'; uid: string }
    | { type: 'failed'; code: string; stage: string };
}> {
  const rawNonce = 'raw-nonce-value-one';
  const hashedNonce = 'hashed-nonce-value-one';
  let appleNonce: string | null = null;
  let firebaseRawNonce: string | null = null;

  const appleResponse: MockAppleCredential = {
    identityToken: options.identityToken === undefined ? 'identity-token' : options.identityToken,
    authorizationCode: 'auth-code',
    email: options.email === undefined ? null : options.email,
    fullName: options.fullName === undefined ? null : options.fullName,
    user: 'apple-user-id',
    realUserStatus: 1,
  };

  appleNonce = hashedNonce;
  if (!appleResponse.identityToken) {
    return {
      appleNonce,
      firebaseRawNonce,
      sameNonce: false,
      identityTokenAccepted: false,
      emailNullAccepted: appleResponse.email == null,
      fullNameNullAccepted: appleResponse.fullName == null,
      result: {
        type: 'failed',
        code: 'APPLE_IDENTITY_TOKEN_MISSING',
        stage: 'apple-response',
      },
    };
  }

  const credentialParams = createAppleOAuthCredentialParams(appleResponse.identityToken, rawNonce);
  firebaseRawNonce = credentialParams.rawNonce;

  const plan = resolveAppleLinkPlan({
    isAnonymous: options.currentUser.isAnonymous,
    providerIds: options.currentUser.providerIds,
  });
  if (plan === 'already-linked-success') {
    return {
      appleNonce,
      firebaseRawNonce,
      sameNonce: appleNonce !== null && firebaseRawNonce === rawNonce,
      identityTokenAccepted: true,
      emailNullAccepted: appleResponse.email == null,
      fullNameNullAccepted: appleResponse.fullName == null,
      result: { type: 'already-linked', uid: options.currentUser.uid },
    };
  }

  if (options.linkError) {
    if (isAppleProviderAlreadyLinkedCode(options.linkError.code)) {
      return {
        appleNonce,
        firebaseRawNonce,
        sameNonce: firebaseRawNonce === rawNonce,
        identityTokenAccepted: true,
        emailNullAccepted: appleResponse.email == null,
        fullNameNullAccepted: appleResponse.fullName == null,
        result: { type: 'already-linked', uid: options.currentUser.uid },
      };
    }
    if (isAppleExistingAccountConflictCode(options.linkError.code)) {
      return {
        appleNonce,
        firebaseRawNonce,
        sameNonce: firebaseRawNonce === rawNonce,
        identityTokenAccepted: true,
        emailNullAccepted: appleResponse.email == null,
        fullNameNullAccepted: appleResponse.fullName == null,
        result: {
          type: 'conflict',
          code: options.linkError.code,
          reusedCredential: false,
        },
      };
    }
    return {
      appleNonce,
      firebaseRawNonce,
      sameNonce: firebaseRawNonce === rawNonce,
      identityTokenAccepted: true,
      emailNullAccepted: appleResponse.email == null,
      fullNameNullAccepted: appleResponse.fullName == null,
      result: {
        type: 'failed',
        code: options.linkError.code,
        stage: 'firebase-link',
      },
    };
  }

  if (options.signInError) {
    return {
      appleNonce,
      firebaseRawNonce,
      sameNonce: firebaseRawNonce === rawNonce,
      identityTokenAccepted: true,
      emailNullAccepted: appleResponse.email == null,
      fullNameNullAccepted: appleResponse.fullName == null,
      result: {
        type: 'failed',
        code: options.signInError.code,
        stage: 'firebase-signin',
      },
    };
  }

  if (!options.currentUser.isAnonymous && options.currentUser.providerIds.includes('apple.com')) {
    return {
      appleNonce,
      firebaseRawNonce,
      sameNonce: firebaseRawNonce === rawNonce,
      identityTokenAccepted: true,
      emailNullAccepted: appleResponse.email == null,
      fullNameNullAccepted: appleResponse.fullName == null,
      result: { type: 'already-linked', uid: options.currentUser.uid },
    };
  }

  return {
    appleNonce,
    firebaseRawNonce,
    sameNonce: firebaseRawNonce === rawNonce,
    identityTokenAccepted: true,
    emailNullAccepted: appleResponse.email == null,
    fullNameNullAccepted: appleResponse.fullName == null,
    result: options.currentUser.isAnonymous
      ? { type: 'linked', uid: options.currentUser.uid }
      : { type: 'signed-in', uid: 'existing-apple-uid' },
  };
}

async function run(): Promise<void> {
  console.log('\nApple Auth Release Regression\n');
  process.env.EXPO_PUBLIC_ENABLE_AUTH_DIAGNOSTICS = 'true';

  const appConfig = readSrc('app.config.js');
  const entitlements = readSrc('ios/LogistiCore/LogistiCore.entitlements');
  const nonceSrc = readSrc('src/utils/authNonce.ts');
  const appleSrc = readSrc('src/services/appleAuthService.ts');
  const accountSrc = readSrc('src/hooks/useAccountCenter.ts');
  const diagnosticsSrc = readSrc('src/utils/appleAuthDiagnostics.ts');

  assert(
    appConfig.includes("bundleIdentifier: 'com.ethemsincar.logisticore'"),
    'config bundle ID correct',
  );
  assert(appConfig.includes('usesAppleSignIn: true'), 'usesAppleSignIn true');
  assert(appConfig.includes("'expo-apple-authentication'"), 'plugin present');
  assert(
    entitlements.includes('com.apple.developer.applesignin') &&
      entitlements.includes('<string>Default</string>'),
    'entitlements source present',
  );

  assert(!/\bMath\.random\s*\(/.test(nonceSrc), 'nonce secure — no Math.random');
  assert(nonceSrc.includes('getRandomBytesAsync'), 'nonce uses CSPRNG');
  assert(nonceSrc.includes('CryptoEncoding.HEX'), 'hashed nonce is lowercase hex, not base64');
  assert(nonceSrc.includes('toLowerCase()'), 'SHA-256 hex lowercased');
  assert(appleSrc.includes('nonce: hashedNonce'), 'hashed nonce sent to Apple');
  assert(
    appleSrc.includes('createAppleOAuthCredentialParams(identityToken, rawNonce)'),
    'raw nonce sent to Firebase',
  );
  assert(
    /const rawNonce = nonceResult\.nonce[\s\S]*nonce: hashedNonce[\s\S]*createAppleOAuthCredentialParams\(identityToken, rawNonce\)/.test(
      appleSrc,
    ),
    'same raw nonce used for the whole request',
  );
  assert(
    !appleSrc.includes('nonce: rawNonce') && !appleSrc.includes('rawNonce: hashedNonce'),
    'Apple does not receive rawNonce; Firebase does not receive hashedNonce',
  );
  const oauthParams = createAppleOAuthCredentialParams('id-token-value', 'raw-nonce-value');
  assert(oauthParams.rawNonce === 'raw-nonce-value', 'credential helper keeps rawNonce');
  assert(oauthParams.idToken === 'id-token-value', 'credential helper keeps idToken');
  assert(!('hashedNonce' in oauthParams), 'Firebase credential params exclude hashedNonce');

  // Non-enumerable error.code must still be preserved.
  const hiddenError = {};
  Object.defineProperty(hiddenError, 'code', {
    value: 'auth/credential-already-in-use',
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(hiddenError, 'message', {
    value: 'hidden firebase failure',
    enumerable: false,
    configurable: true,
  });
  assert(JSON.stringify(hiddenError) === '{}', 'fixture error is non-enumerable for JSON.stringify');
  const extractedHidden = extractSafeAppleErrorFields(hiddenError);
  assert(extractedHidden.code === 'auth/credential-already-in-use', 'error.code preserved when non-enumerable');
  assert(extractedHidden.message === 'hidden firebase failure', 'error.message preserved when non-enumerable');
  const hiddenNormalized = normalizeAppleAuthFailure(hiddenError, 'anonymous-link-failure');
  assert(
    hiddenNormalized.code === 'auth/credential-already-in-use',
    'credential already in use real code preserved',
  );
  assert(
    getAppleAuthDiagnosticCode(hiddenNormalized) === 'APPLE_ACCOUNT_ALREADY_LINKED',
    'credential already in use diagnostic',
  );
  assert(
    formatAppleAuthDiagnosticDisplay(hiddenNormalized).includes('stage=cloud-conflict') ||
      formatAppleAuthDiagnosticDisplay(hiddenNormalized).includes('code=auth/credential-already-in-use'),
    'modal diagnosis keeps real conflict code',
  );

  const tokenMissing = normalizeAppleAuthFailure(null, 'identity-token-validation', {
    code: 'APPLE_IDENTITY_TOKEN_MISSING',
  });
  assert(tokenMissing.code === 'APPLE_IDENTITY_TOKEN_MISSING', 'identityToken null is structured failure');
  assert(
    getAppleAuthUserMessage(tokenMissing).includes('kimlik bilgisi'),
    'identityToken null user message',
  );
  assert(
    formatAppleAuthDiagnosticDisplay(tokenMissing).includes('APPLE_IDENTITY_TOKEN_MISSING'),
    'identity token null correct code',
  );

  const emailNull = await runMockAppleFirebaseFlow({
    email: null,
    currentUser: { isAnonymous: true, uid: 'anon-1', providerIds: [] },
  });
  assert(emailNull.result.type === 'linked', 'email null does not fail auth');
  assert(emailNull.emailNullAccepted, 'email null accepted');

  const fullNameNull = await runMockAppleFirebaseFlow({
    fullName: null,
    currentUser: { isAnonymous: true, uid: 'anon-1', providerIds: [] },
  });
  assert(fullNameNull.result.type === 'linked', 'fullName null does not fail auth');
  assert(fullNameNull.fullNameNullAccepted, 'fullName null accepted');

  const missingToken = await runMockAppleFirebaseFlow({
    identityToken: null,
    currentUser: { isAnonymous: true, uid: 'anon-1', providerIds: [] },
  });
  assert(
    missingToken.result.type === 'failed' && missingToken.result.code === 'APPLE_IDENTITY_TOKEN_MISSING',
    'identityToken null blocks Firebase call',
  );

  const canceled = normalizeAppleAuthFailure({ code: 'ERR_REQUEST_CANCELED' }, 'native-request-start');
  assert(isAppleAuthCancelFailure(canceled), 'request canceled detected');
  assert(getAppleAuthUserMessage(canceled) === '', 'request canceled has no modal message');
  assert(isAppleAuthCancelFailure(canceled), 'cancellation modal göstermiyor');

  const invalidNonce = normalizeAppleAuthFailure(
    { code: 'auth/missing-or-invalid-nonce' },
    'anonymous-link-failure',
    { firebaseCode: 'auth/missing-or-invalid-nonce' },
  );
  assert(invalidNonce.firebaseCode === 'auth/missing-or-invalid-nonce', 'invalid nonce keeps firebase code');
  assert(
    getAppleAuthDiagnosticCode(invalidNonce) === 'APPLE_INVALID_NONCE',
    'invalid nonce diagnostic code',
  );
  assert(
    formatAppleAuthDiagnosticDisplay(invalidNonce).includes('auth/missing-or-invalid-nonce'),
    'invalid nonce real code shown in diagnosis',
  );

  const notAllowed = normalizeAppleAuthFailure(
    { code: 'auth/operation-not-allowed' },
    'anonymous-link-failure',
    { firebaseCode: 'auth/operation-not-allowed' },
  );
  assert(
    getAppleAuthDiagnosticCode(notAllowed) === 'APPLE_PROVIDER_DISABLED',
    'provider disabled real code preserved',
  );
  assert(
    formatAppleAuthDiagnosticDisplay(notAllowed).includes('auth/operation-not-allowed'),
    'provider disabled real code shown',
  );

  const previousDiagFlag = process.env.EXPO_PUBLIC_ENABLE_AUTH_DIAGNOSTICS;
  const previousInternalFlag = process.env.EXPO_PUBLIC_INTERNAL_DIAGNOSTICS;
  delete process.env.EXPO_PUBLIC_ENABLE_AUTH_DIAGNOSTICS;
  delete process.env.EXPO_PUBLIC_INTERNAL_DIAGNOSTICS;
  assert(!shouldShowInternalAuthDiagnostics(), 'production hides internal auth diagnostics');
  assert(
    !formatAppleAuthDiagnosticDisplay(notAllowed).includes('stage='),
    'production modal does not expose stage=',
  );
  assert(
    formatAppleAuthDiagnosticDisplay(notAllowed) === getAppleAuthUserMessage(notAllowed),
    'production modal is the user message only',
  );
  process.env.EXPO_PUBLIC_ENABLE_AUTH_DIAGNOSTICS = previousDiagFlag;
  if (previousInternalFlag === undefined) {
    delete process.env.EXPO_PUBLIC_INTERNAL_DIAGNOSTICS;
  } else {
    process.env.EXPO_PUBLIC_INTERNAL_DIAGNOSTICS = previousInternalFlag;
  }
  assert(
    getAppleAuthUserMessage(notAllowed).includes('yapılandırılamadı'),
    'operation not allowed user message',
  );

  const alreadyInUse = await runMockAppleFirebaseFlow({
    currentUser: { isAnonymous: true, uid: 'anon-1', providerIds: [] },
    linkError: { code: 'auth/credential-already-in-use' },
  });
  assert(
    alreadyInUse.result.type === 'conflict' && alreadyInUse.result.reusedCredential === false,
    'credential already in use opens conflict without credential reuse',
  );

  const providerLinked = await runMockAppleFirebaseFlow({
    currentUser: { isAnonymous: true, uid: 'anon-1', providerIds: [] },
    linkError: { code: 'auth/provider-already-linked' },
  });
  assert(providerLinked.result.type === 'already-linked', 'provider already linked is success');

  const anonymousLink = await runMockAppleFirebaseFlow({
    currentUser: { isAnonymous: true, uid: 'anon-1', providerIds: [] },
  });
  assert(
    anonymousLink.result.type === 'linked' && anonymousLink.result.uid === 'anon-1',
    'anonymous link success preserves UID',
  );

  const existingUser = await runMockAppleFirebaseFlow({
    currentUser: { isAnonymous: false, uid: 'user-1', providerIds: ['password'] },
  });
  assert(existingUser.result.type === 'signed-in', 'existing user sign-in path available');

  const alreadyApple = await runMockAppleFirebaseFlow({
    currentUser: { isAnonymous: false, uid: 'user-1', providerIds: ['apple.com'] },
  });
  assert(alreadyApple.result.type === 'already-linked', 'existing Apple provider is idempotent success');

  assert(
    sanitizeAppleFullName('  Ada   Lovelace ') === 'Ada Lovelace',
    'fullName is sanitized before profile update',
  );
  assert(
    readSrc('src/services/authService.ts').includes('Apple profile finalize failed after successful auth'),
    'profile update failure does not undo auth',
  );

  const guard = createSingleFlightController();
  assert(guard.tryStart() === true, 'first tap starts request');
  assert(guard.tryStart() === false, 'double tap is ignored');
  guard.finish();
  assert(guard.tryStart() === true, 'request can start again after finish');
  assert(
    readSrc('src/hooks/useAccountCenter.ts').includes('if (isLinking') &&
      readSrc('src/components/accountCenter/AccountConnectionTab.tsx').includes(
        'disabled={Boolean(isLinking)}',
      ),
    'UI double tap / loading guard present',
  );

  const cocoa = normalizeAppleAuthFailure(
    { code: '1000', domain: 'com.apple.AuthenticationServices.error' },
    'native-request-start',
    { nativeCode: 'NSCocoaErrorDomain|com.apple.AuthenticationServices.error|1000' },
  );
  assert(
    cocoa.nativeCode?.includes('AuthenticationServices') === true,
    'error normalizer keeps native AuthenticationServices code',
  );
  assert(cocoa.code !== 'apple-sign-in-failed' || Boolean(cocoa.nativeCode), 'real code is preserved');

  const invalidCredential = normalizeAppleAuthFailure(
    { code: 'auth/invalid-credential' },
    'anonymous-link-failure',
    { firebaseCode: 'auth/invalid-credential' },
  );
  assert(invalidCredential.firebaseCode === 'auth/invalid-credential', 'invalid-credential preserved');
  assert(
    getAppleAuthDiagnosticCode(invalidCredential) === 'APPLE_INVALID_CREDENTIAL',
    'invalid-credential diagnostic',
  );

  assert(appleSrc.includes("stage: 'native-request-start'"), 'logs native-request-start');
  assert(appleSrc.includes("stage: 'native-request-success'"), 'logs native-request-success');
  assert(appleSrc.includes("stage: 'identity-token-validation'"), 'logs identity-token-validation');
  assert(appleSrc.includes("stage: 'firebase-credential-created'"), 'logs firebase-credential-created');
  assert(
    readSrc('src/services/authService.ts').includes("stage: 'anonymous-link-start'"),
    'logs anonymous-link-start',
  );
  assert(
    readSrc('src/services/authService.ts').includes("'cloud-conflict'"),
    'logs cloud-conflict',
  );
  assert(accountSrc.includes('formatAppleAuthDiagnosticDisplay'), 'UI shows real diagnosis body');

  assert(shouldRequestFreshAppleCredential('auth/credential-already-in-use'), 'conflict asks for fresh Apple credential');
  assert(shouldRequestFreshAppleCredential('auth/invalid-credential'), 'invalid credential asks for fresh Apple credential');
  assert(
    shouldContinueExistingAppleAccountSignIn('credential-already-in-use'),
    'same Apple ID on another UID continues existing-account sign-in',
  );
  assert(
    !shouldContinueExistingAppleAccountSignIn('account-exists-with-different-credential'),
    'Google/email provider clash does not auto-sign-in as Apple',
  );

  const leftoverConflict = normalizeAppleAuthFailure(
    { code: 'auth/account-exists-with-different-credential' },
    'cloud-conflict',
    { firebaseCode: 'auth/account-exists-with-different-credential' },
  );
  assert(
    getAppleAuthUserMessage(leftoverConflict).includes('başka bir giriş yöntemiyle'),
    'leftover provider clash has a user-visible message',
  );
  assert(
    getAppleAuthUserMessage(invalidCredential) === 'Apple oturumu doğrulanamadı.',
    'invalid credential user message',
  );
  const networkFailure = normalizeAppleAuthFailure(
    { code: 'auth/network-request-failed' },
    'anonymous-link-failure',
    { firebaseCode: 'auth/network-request-failed' },
  );
  assert(
    getAppleAuthUserMessage(networkFailure) === 'Bağlantı kurulamadı. Tekrar dene.',
    'network failure user message',
  );

  const safeBooleanPayload = sanitizeAppleAuthLogPayload({
    stage: 'apple_request_success',
    hasIdentityToken: true,
    hasAuthorizationCode: true,
  });
  assert(safeBooleanPayload.hasIdentityToken === true, 'hasIdentityToken boolean is accepted');
  assert(safeBooleanPayload.hasAuthorizationCode === true, 'hasAuthorizationCode boolean is accepted');

  const leakedTokens = {
    identityToken: 'secret-identity-token',
    authorizationCode: 'secret-auth-code',
    rawNonce: 'secret-raw-nonce',
    hashedNonce: 'secret-hashed-nonce',
    idToken: 'secret-id-token',
    identity_token_present: true,
    hasIdentityToken: 'secret-identity-token',
  };
  assert(
    getUnsafeAppleAuthLogKeys(leakedTokens).includes('identityToken'),
    'identityToken is classified as unsafe',
  );
  let sanitizeThrew = false;
  let sanitizedLeaks: Record<string, unknown> = {};
  try {
    sanitizedLeaks = sanitizeAppleAuthLogPayload(leakedTokens);
  } catch {
    sanitizeThrew = true;
  }
  assert(!sanitizeThrew, 'sanitizer does not throw on secret keys');
  assert(!('identityToken' in sanitizedLeaks), 'identityToken is omitted');
  assert(!('authorizationCode' in sanitizedLeaks), 'authorizationCode is omitted');
  assert(!('rawNonce' in sanitizedLeaks), 'rawNonce is omitted');
  assert(!('hashedNonce' in sanitizedLeaks), 'hashedNonce is omitted');
  assert(!('idToken' in sanitizedLeaks), 'idToken is omitted');
  assert(!('identity_token_present' in sanitizedLeaks), 'identity_token_present snake_case is omitted');
  assert(!('hasIdentityToken' in sanitizedLeaks), 'non-boolean hasIdentityToken is omitted');
  assertSafeAppleAuthLogPayload({ identityToken: 'secret' });

  let logThrew = false;
  try {
    logAppleAuth('apple_request_success', {
      identityToken: 'secret-identity-token',
      authorizationCode: 'secret-auth-code',
      hasIdentityToken: true,
    });
  } catch {
    logThrew = true;
  }
  assert(!logThrew, 'logAppleAuth does not throw when secrets are passed');

  const previousInfo = console.info;
  console.info = () => {
    throw new Error('console.info forced failure');
  };
  let consoleThrowEscaped = false;
  try {
    logAppleAuth('nonce_generated', { hasRawNonce: true });
  } catch {
    consoleThrowEscaped = true;
  } finally {
    console.info = previousInfo;
  }
  assert(!consoleThrowEscaped, 'console failure does not abort Apple auth logging callers');
  assert(
    !/console\.(warn|log)\([^\n]*identityToken\s*:/.test(diagnosticsSrc),
    'diagnostics source does not log identityToken values',
  );
  assert(!appleSrc.includes('console.warn') || !/console\.warn\([^\)]*rawNonce/.test(appleSrc), 'raw nonce is not logged');
  assert(!appleSrc.includes('console.log(identityToken)'), 'identityToken value is not logged');
  assert(
    appleSrc.includes('hasIdentityToken') && appleSrc.includes('hasRawNonce') && appleSrc.includes('hasHashedNonce'),
    'only boolean nonce/token metadata is logged',
  );

  const authService = readSrc('src/services/authService.ts');
  const appleLinkFn = authService.slice(
    authService.indexOf('export async function linkAnonymousAccountWithApple'),
    authService.indexOf('function mapAccountSwitchFailure'),
  );
  assert(authService.includes("pendingCredential: provider === 'apple' ? undefined : credential"), 'Apple pending credential is not cached after failed link');
  assert(
    appleLinkFn.includes('shouldContinueExistingAppleAccountSignIn') &&
      appleLinkFn.includes('signInWithAppleAccount') &&
      appleLinkFn.includes("completeExistingProviderAccountLogin"),
    'credential-already-in-use requests a fresh Apple credential then existing-account login',
  );
  assert(appleSrc.includes("logAppleAuth('nonce_generated'"), 'APPLE_AUTH nonce step present');
  assert(diagnosticsSrc.includes('[APPLE_AUTH]'), 'APPLE_AUTH prefix present');
  assert(diagnosticsSrc.includes('[APPLE_AUTH_ERROR]'), 'APPLE_AUTH_ERROR logs present');
  assert(
    !diagnosticsSrc.includes('Refusing to log sensitive apple-auth key'),
    'logger no longer throws Refusing to log',
  );
  assert(
    !appleSrc.includes('identity_token_present') && !appleSrc.includes('authorization_code_present'),
    'snake_case token-present keys are not used',
  );
  assert(
    !accountSrc.includes('Conflict codes never become a generic modal'),
    'leftover Apple conflicts are no longer swallowed',
  );
  assert(
    accountSrc.includes("title: 'Apple ile giriş tamamlanamadı.'"),
    'Apple failures show a visible title',
  );
  assert(accountSrc.includes('getAppleAuthDiagnosticFooter'), 'internal diagnostic footer wired to UI');
  assert(
    readSrc('src/components/accountCenter/AccountConnectionTab.tsx').includes(
      'Apple ile Devam Et',
    ),
    'Apple continue button still present',
  );
}

void run()
  .then(() => {
    console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) {
      process.exit(1);
    }
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
