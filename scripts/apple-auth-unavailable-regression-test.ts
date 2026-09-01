/**
 * auth-unavailable / Auth readiness regression tests.
 * Run: npx tsx scripts/apple-auth-unavailable-regression-test.ts
 */

import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import {
  formatAppleAuthDiagnosticDisplay,
  getAppleAuthDiagnosticCode,
  normalizeAppleAuthFailure,
} from '../src/utils/appleAuthDiagnostics';
import {
  AUTH_INSTANCE_UNAVAILABLE,
  AUTH_NOT_READY,
  FIREBASE_CONFIG_MISSING,
  LEGACY_AUTH_UNAVAILABLE,
  MIXED_FIREBASE_SDK_CREDENTIAL,
  assertSafeAuthReadinessLogPayload,
  createAuthReadinessLogPayload,
  isModularFirebaseAuthCredential,
  preserveAuthError,
  resolveAuthReadiness,
} from '../src/utils/authReadiness';
import { FIREBASE_RUNTIME_CONFIG_MISMATCH } from '../src/config/firebaseRuntimeContract';

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

function readyInput(overrides: Partial<Parameters<typeof resolveAuthReadiness>[0]> = {}) {
  return {
    firebaseEnabled: true,
    hasFirebaseApp: true,
    hasAuthInstance: true,
    hasCurrentUser: true,
    currentUserAnonymous: true,
    authStateResolved: true,
    anonymousBootstrapCompleted: true,
    projectMatches: true,
    bundleMatches: true,
    ...overrides,
  };
}

function run(): void {
  console.log('\napple-auth-unavailable-regression-test\n');
  process.env.EXPO_PUBLIC_ENABLE_AUTH_DIAGNOSTICS = 'true';

  const authSrc = readSrc('src/services/authService.ts');
  const appleSrc = readSrc('src/services/appleAuthService.ts');
  const firebaseSrc = readSrc('src/services/firebase.ts');
  const packageJson = readSrc('package.json');

  assert(
    authSrc.includes("error: 'auth-unavailable'") === false &&
      authSrc.includes("throw new Error('auth-unavailable')") === false &&
      authSrc.includes('return { ok: false, error: \'auth-unavailable\' }') === false,
    'authService no longer emits auth-unavailable literal',
  );
  assert(authSrc.includes('ensureFirebaseAuthReady'), 'ensureFirebaseAuthReady exists');
  assert(
    /ensureFirebaseAuthReady\([\s\S]*linkWithAppleAccount/.test(authSrc) ||
      /const ready = await ensureFirebaseAuthReady\(\);[\s\S]*linkWithAppleAccount/.test(authSrc),
    'Apple link waits for Auth readiness before native Apple',
  );
  assert(authSrc.includes('linkWithCredential(currentUser, credential)'), 'uses modular linkWithCredential(user, credential)');
  assert(authSrc.includes("from 'firebase/auth'"), 'authService imports firebase/auth');
  assert(!authSrc.includes('@react-native-firebase'), 'authService does not import RN Firebase');
  assert(firebaseSrc.includes("from 'firebase/app'"), 'firebase.ts uses firebase/app');
  assert(firebaseSrc.includes("from 'firebase/auth'"), 'firebase.ts uses firebase/auth');
  assert(!packageJson.includes('@react-native-firebase/'), 'package.json has no RN Firebase SDK');
  assert(appleSrc.includes('ensureFirebaseAuthReady'), 'native Apple path checks auth ready');
  assert(
    /ensureFirebaseAuthReady[\s\S]*AppleAuthentication\.signInAsync/.test(appleSrc),
    'Auth ready is required before Apple signInAsync',
  );
  assert(authSrc.includes('lastAnonymousAuthError'), 'anonymous bootstrap errors are retained');
  assert(authSrc.includes('[auth-readiness]'), 'readiness snapshot is logged');
  assert(authSrc.includes('createAuthReadinessLogPayload'), 'readiness log uses safe payload helper');

  const ready = resolveAuthReadiness(readyInput());
  assert(ready.ready && ready.shouldStartApple, 'ready snapshot allows Apple');

  const noApp = resolveAuthReadiness(readyInput({ hasFirebaseApp: false, hasAuthInstance: false, hasCurrentUser: false }));
  assert(!noApp.ready && noApp.code === AUTH_INSTANCE_UNAVAILABLE, 'Firebase app missing → AUTH_INSTANCE_UNAVAILABLE');
  assert(!noApp.shouldStartApple, 'Firebase app missing blocks Apple');

  const noAuth = resolveAuthReadiness(readyInput({ hasAuthInstance: false, hasCurrentUser: false }));
  assert(!noAuth.ready && noAuth.code === AUTH_INSTANCE_UNAVAILABLE, 'Auth instance missing → AUTH_INSTANCE_UNAVAILABLE');

  const missingConfig = resolveAuthReadiness(
    readyInput({
      firebaseEnabled: false,
      hasFirebaseApp: false,
      hasAuthInstance: false,
      hasCurrentUser: false,
      missingConfigKeys: ['apiKey', 'projectId'],
    }),
  );
  assert(missingConfig.code === FIREBASE_CONFIG_MISSING, 'empty Firebase config → FIREBASE_CONFIG_MISSING');
  assert(!missingConfig.shouldStartApple, 'empty config blocks Apple before native sheet');

  const noUser = resolveAuthReadiness(readyInput({ hasCurrentUser: false, currentUserAnonymous: null }));
  assert(!noUser.ready && noUser.code === AUTH_NOT_READY, 'currentUser null after bootstrap → AUTH_NOT_READY');
  assert(!noUser.shouldStartApple, 'currentUser null blocks Apple link');

  const waiting = resolveAuthReadiness(
    readyInput({
      hasCurrentUser: false,
      authStateResolved: false,
      anonymousBootstrapCompleted: false,
      currentUserAnonymous: null,
    }),
  );
  assert(waiting.code === AUTH_NOT_READY, 'incomplete anonymous bootstrap → AUTH_NOT_READY');

  const anonFailed = resolveAuthReadiness(
    readyInput({
      hasCurrentUser: false,
      currentUserAnonymous: null,
      anonymousAuthError: { code: 'auth/operation-not-allowed', message: 'Anonymous provider disabled' },
    }),
  );
  assert(anonFailed.code === 'auth/operation-not-allowed', 'anonymous Firebase error code is preserved');
  assert(anonFailed.firebaseCode === 'auth/operation-not-allowed', 'anonymous Firebase code exposed');
  assert(!anonFailed.usedFallback, 'real Firebase error is not replaced by fallback');

  const preserved = preserveAuthError(
    { code: 'auth/network-request-failed', message: 'network down' },
    AUTH_INSTANCE_UNAVAILABLE,
  );
  assert(preserved.code === 'auth/network-request-failed', 'preserveAuthError keeps Firebase code');
  assert(!preserved.usedFallback, 'preserveAuthError does not fallback when error object exists');

  const fallback = preserveAuthError(null, AUTH_INSTANCE_UNAVAILABLE);
  assert(fallback.usedFallback && fallback.code === AUTH_INSTANCE_UNAVAILABLE, 'fallback only when error object missing');

  const legacy = preserveAuthError(new Error(LEGACY_AUTH_UNAVAILABLE), AUTH_INSTANCE_UNAVAILABLE);
  assert(legacy.code === AUTH_INSTANCE_UNAVAILABLE, 'legacy auth-unavailable Error becomes AUTH_INSTANCE_UNAVAILABLE');

  const mismatch = resolveAuthReadiness(readyInput({ projectMatches: false }));
  assert(mismatch.stage === 'config-validation', 'config mismatch stays a separate stage');
  assert(mismatch.code === FIREBASE_RUNTIME_CONFIG_MISMATCH, 'config mismatch uses distinct code');

  assert(
    isModularFirebaseAuthCredential({ providerId: 'apple.com', signInMethod: 'oauth' }),
    'modular Firebase credential accepted',
  );
  assert(
    !isModularFirebaseAuthCredential({ providerId: 'apple.com', _auth: {} }),
    'RN-style mixed credential rejected',
  );
  assert(!isModularFirebaseAuthCredential(null), 'null credential rejected');
  assert(!isModularFirebaseAuthCredential({ native: true }), 'native-wrapped credential rejected');

  const mixedFailure = normalizeAppleAuthFailure(null, 'anonymous-link-failure', {
    code: MIXED_FIREBASE_SDK_CREDENTIAL,
  });
  assert(
    getAppleAuthDiagnosticCode(mixedFailure) === MIXED_FIREBASE_SDK_CREDENTIAL,
    'mixed SDK diagnostic code',
  );

  const readinessFailure = normalizeAppleAuthFailure(null, 'auth-readiness', {
    code: AUTH_NOT_READY,
  });
  assert(getAppleAuthDiagnosticCode(readinessFailure) === AUTH_NOT_READY, 'AUTH_NOT_READY diagnostic');
  assert(
    formatAppleAuthDiagnosticDisplay(readinessFailure).includes('stage=auth-readiness'),
    'readiness modal keeps stage',
  );
  assert(
    formatAppleAuthDiagnosticDisplay(readinessFailure).includes(`code=${AUTH_NOT_READY}`),
    'readiness modal keeps code',
  );

  const firebaseDuringReady = normalizeAppleAuthFailure(
    { code: 'auth/operation-not-allowed', message: 'disabled' },
    'auth-readiness',
    { firebaseCode: 'auth/operation-not-allowed' },
  );
  assert(
    formatAppleAuthDiagnosticDisplay(firebaseDuringReady).includes('auth/operation-not-allowed'),
    'real Firebase code shown instead of AUTH_NOT_READY when present',
  );

  const payload = createAuthReadinessLogPayload({
    hasFirebaseApp: true,
    hasAuthInstance: true,
    hasCurrentUser: true,
    currentUserAnonymous: true,
    providerIds: ['anonymous' as never].filter(() => true) && [],
    authAppName: '[DEFAULT]',
    authProjectId: 'logisticore-53ab4',
  });
  assert(!JSON.stringify(payload).includes('uid'), 'readiness log has no uid');
  assert(!JSON.stringify(payload).includes('token'), 'readiness log has no token');
  assertSafeAuthReadinessLogPayload(payload);

  let threw = false;
  try {
    assertSafeAuthReadinessLogPayload({ uid: 'user-123' });
  } catch {
    threw = true;
  }
  assert(threw, 'uid key is rejected from readiness logs');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
