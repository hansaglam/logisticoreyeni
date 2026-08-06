/**
 * Firebase iOS runtime-config regression tests.
 * Run: npx tsx scripts/ios-firebase-config-regression-test.ts
 */

import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import {
  assertSafeFirebaseRuntimeLogPayload,
  createFirebaseRuntimeLogPayload,
  evaluateFirebaseRuntimeConfig,
  EXPECTED_FIREBASE_PROJECT_ID,
  EXPECTED_IOS_BUNDLE_ID,
  FIREBASE_RUNTIME_CONFIG_MISMATCH,
  isFirebaseRuntimeConfigValid,
  isForbiddenIosBundleId,
  shouldBlockAppleAuthForRuntimeConfig,
  toFirebaseAppIdPrefix,
} from '../src/config/firebaseRuntimeContract';
import {
  formatAppleAuthDiagnosticDisplay,
  getAppleAuthDiagnosticCode,
  getAppleAuthUserMessage,
  normalizeAppleAuthFailure,
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

function validSnapshot() {
  return evaluateFirebaseRuntimeConfig({
    firebaseAppName: '[DEFAULT]',
    firebaseProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    firebaseAppId: '1:363783837598:ios:d813853d3ada916ca6288f',
    authDomain: 'logisticore-53ab4.firebaseapp.com',
    currentBundleId: EXPECTED_IOS_BUNDLE_ID,
    firebaseAppsCount: 1,
    authAppName: '[DEFAULT]',
    authProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    authAppId: '1:363783837598:ios:d813853d3ada916ca6288f',
    currentUserIsAnonymous: true,
    currentUserProviderIds: [],
  });
}

function run(): void {
  console.log('\nios-firebase-config-regression-test\n');

  const ok = validSnapshot();
  assert(ok.projectMatches, 'correct project ID matches');
  assert(ok.bundleMatches, 'correct bundle ID matches');
  assert(ok.firebaseAppsCount === 1, 'single Firebase app accepted');
  assert(isFirebaseRuntimeConfigValid(ok), 'canonical snapshot is valid');
  assert(!shouldBlockAppleAuthForRuntimeConfig(ok), 'canonical snapshot allows Apple auth');
  assert(ok.authAppName === '[DEFAULT]', 'Auth instance bound to default app name');
  assert(ok.authProjectId === EXPECTED_FIREBASE_PROJECT_ID, 'Auth instance bound to canonical project');

  const wrongProject = evaluateFirebaseRuntimeConfig({
    ...ok,
    firebaseProjectId: 'some-other-project',
    authProjectId: 'some-other-project',
    firebaseAppsCount: 1,
    firebaseAppName: '[DEFAULT]',
    authAppName: '[DEFAULT]',
    currentBundleId: EXPECTED_IOS_BUNDLE_ID,
  });
  assert(!wrongProject.projectMatches, 'wrong project ID is detected');
  assert(shouldBlockAppleAuthForRuntimeConfig(wrongProject), 'wrong project ID blocks Apple auth');

  const wrongBundle = evaluateFirebaseRuntimeConfig({
    ...ok,
    currentBundleId: 'com.anonymous.logisticore',
    firebaseProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    authProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    firebaseAppsCount: 1,
    firebaseAppName: '[DEFAULT]',
    authAppName: '[DEFAULT]',
  });
  assert(!wrongBundle.bundleMatches, 'wrong bundle ID is detected');
  assert(isForbiddenIosBundleId(wrongBundle.currentBundleId), 'anonymous bundle is forbidden');
  assert(shouldBlockAppleAuthForRuntimeConfig(wrongBundle), 'wrong bundle ID blocks Apple auth');

  const echoespeak = evaluateFirebaseRuntimeConfig({
    ...ok,
    currentBundleId: 'com.ethemsincar.echoespeak',
    firebaseProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    authProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    firebaseAppsCount: 1,
    firebaseAppName: '[DEFAULT]',
    authAppName: '[DEFAULT]',
  });
  assert(isForbiddenIosBundleId(echoespeak.currentBundleId), 'echoespeak bundle is forbidden');
  assert(shouldBlockAppleAuthForRuntimeConfig(echoespeak), 'echoespeak bundle blocks Apple auth');

  const duplicateApps = evaluateFirebaseRuntimeConfig({
    ...ok,
    firebaseAppsCount: 2,
    firebaseProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    authProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    currentBundleId: EXPECTED_IOS_BUNDLE_ID,
    firebaseAppName: '[DEFAULT]',
    authAppName: '[DEFAULT]',
  });
  assert(duplicateApps.firebaseAppsCount === 2, 'multiple Firebase apps counted');
  assert(shouldBlockAppleAuthForRuntimeConfig(duplicateApps), 'multiple Firebase apps block Apple auth');

  const unboundAuth = evaluateFirebaseRuntimeConfig({
    ...ok,
    firebaseAppsCount: 1,
    firebaseProjectId: EXPECTED_FIREBASE_PROJECT_ID,
    currentBundleId: EXPECTED_IOS_BUNDLE_ID,
    firebaseAppName: '[DEFAULT]',
    authAppName: null,
    authProjectId: null,
  });
  assert(shouldBlockAppleAuthForRuntimeConfig(unboundAuth), 'missing Auth app binding blocks Apple auth');

  const mismatchFailure = normalizeAppleAuthFailure(null, 'config-validation', {
    code: FIREBASE_RUNTIME_CONFIG_MISMATCH,
  });
  mismatchFailure.projectId = 'wrong-project';
  mismatchFailure.bundleId = 'com.anonymous.logisticore';
  assert(
    getAppleAuthDiagnosticCode(mismatchFailure) === FIREBASE_RUNTIME_CONFIG_MISMATCH,
    'runtime mismatch diagnostic code',
  );
  assert(
    getAppleAuthUserMessage(mismatchFailure).includes('Firebase yapılandırması eşleşmiyor'),
    'runtime mismatch user message',
  );
  const mismatchDisplay = formatAppleAuthDiagnosticDisplay(mismatchFailure);
  assert(mismatchDisplay.includes('stage=config-validation'), 'mismatch modal keeps stage');
  assert(
    mismatchDisplay.includes(`code=${FIREBASE_RUNTIME_CONFIG_MISMATCH}`),
    'mismatch modal keeps code',
  );
  assert(mismatchDisplay.includes('project=wrong-project'), 'mismatch modal shows project');
  assert(
    mismatchDisplay.includes('bundle=com.anonymous.logisticore'),
    'mismatch modal shows bundle',
  );

  const prefix = toFirebaseAppIdPrefix('1:363783837598:ios:d813853d3ada916ca6288f');
  assert(prefix === '1:363783837598:ios:d81385…', 'app ID is logged as a safe prefix', prefix ?? undefined);

  const safePayload = createFirebaseRuntimeLogPayload(ok);
  assert(!JSON.stringify(safePayload).includes('AIza'), 'runtime log payload has no API key');
  assert(
    !JSON.stringify(safePayload).includes('d813853d3ada916ca6288f'),
    'runtime log payload does not include full app ID',
  );
  assertSafeFirebaseRuntimeLogPayload(safePayload);

  let threw = false;
  try {
    assertSafeFirebaseRuntimeLogPayload({
      apiKey: 'AIzaSyCCWDdBsbK5B0ObQa5fTlFG6pQBIPtFZSQ',
    });
  } catch {
    threw = true;
  }
  assert(threw, 'unsafe apiKey log payload is rejected');

  const appleSrc = readSrc('src/services/appleAuthService.ts');
  assert(appleSrc.includes('guardAppleAuthRuntimeConfig'), 'Apple auth calls runtime guard');
  assert(appleSrc.includes('shouldBlockAppleAuthForRuntimeConfig'), 'Apple auth blocks on mismatch');
  assert(
    /guardAppleAuthRuntimeConfig[\s\S]*AppleAuthentication\.signInAsync/.test(appleSrc),
    'runtime guard runs before native Apple sign-in',
  );

  const firebaseSrc = readSrc('src/services/firebase.ts');
  assert(firebaseSrc.includes('getApps().length > 0'), 'singleton uses getApps');
  assert(firebaseSrc.includes('? getApp()'), 'singleton reuses getApp');
  assert(!firebaseSrc.includes('@react-native-firebase'), 'JS Firebase path does not import RN Firebase');

  const pbxproj = readSrc('ios/LogistiCore.xcodeproj/project.pbxproj');
  const resourcesPhase =
    pbxproj.match(/Begin PBXResourcesBuildPhase section[\s\S]*?End PBXResourcesBuildPhase section/)?.[0] ??
    '';
  const resourceCount = (resourcesPhase.match(/GoogleService-Info\.plist in Resources/g) ?? []).length;
  assert(resourceCount === 1, 'Xcode copies GoogleService-Info.plist once', `count=${resourceCount}`);
  assert(
    pbxproj.includes('path = "LogistiCore/GoogleService-Info.plist"'),
    'active target plist membership is ios/LogistiCore/GoogleService-Info.plist',
  );

  const rootPlist = readSrc('GoogleService-Info.plist');
  const iosPlist = readSrc('ios/LogistiCore/GoogleService-Info.plist');
  assert(rootPlist.includes(EXPECTED_FIREBASE_PROJECT_ID), 'root plist has expected project');
  assert(iosPlist.includes(EXPECTED_IOS_BUNDLE_ID), 'ios plist has expected bundle');
  assert(!rootPlist.includes('com.anonymous.logisticore'), 'root plist is not anonymous target');
  assert(!iosPlist.includes('com.ethemsincar.echoespeak'), 'ios plist is not echoespeak target');

  const appConfig = readSrc('app.config.js');
  assert(appConfig.includes("bundleIdentifier: 'com.ethemsincar.logisticore'"), 'app config bundle ID');
  assert(appConfig.includes('firebase.public.json'), 'app config uses public firebase fallback');

  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
