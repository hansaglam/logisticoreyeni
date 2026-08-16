/**
 * Production / internal AAB öncesi fail-fast config doğrulaması.
 * Run: npm run validate:production-build
 */

import './test-globals';

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function resolveVehicleMarketplaceFeatureFlag(input: {
  isDevelopment: boolean;
  envValue?: string;
}): { enabled: boolean; source: 'dev' | 'env' | 'disabled' } {
  if (input.isDevelopment) return { enabled: true, source: 'dev' };
  if (input.envValue === 'true') return { enabled: true, source: 'env' };
  return { enabled: false, source: 'disabled' };
}

const ROOT = resolve(__dirname, '..');
const EXPECTED_PROJECT_ID = 'logisticore-53ab4';
const EXPECTED_PACKAGE = 'com.ethemsincar.logisticore';
const EXPECTED_REGION = 'us-central1';
const EXPECTED_WEB_CLIENT =
  '363783837598-h3ihj18c3g0c6hsmj2qoh8d2hg0i3e9i.apps.googleusercontent.com';

let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function loadDotEnv(fileName: string): Record<string, string> {
  const path = resolve(ROOT, fileName);
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

console.log('\n=== validate-production-build-config ===\n');

const env = {
  ...loadDotEnv('.env'),
  ...loadDotEnv('.env.local'),
  ...loadDotEnv('.env.production'),
};

const requiredEnv = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  'EXPO_PUBLIC_VEHICLE_MARKETPLACE_ENABLED',
] as const;

for (const key of requiredEnv) {
  assert(Boolean(env[key]), `${key} present`, 'missing/empty');
}

assert(
  env.EXPO_PUBLIC_FIREBASE_PROJECT_ID === EXPECTED_PROJECT_ID,
  `projectId === ${EXPECTED_PROJECT_ID}`,
  `got=${env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'undefined'}`,
);
assert(
  env.EXPO_PUBLIC_VEHICLE_MARKETPLACE_ENABLED === 'true',
  'marketplace flag true for release',
  `got=${env.EXPO_PUBLIC_VEHICLE_MARKETPLACE_ENABLED ?? 'undefined'}`,
);
assert(
  env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID === EXPECTED_WEB_CLIENT,
  'webClientId matches google-services type 3 client',
  `got=${env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? 'undefined'}`,
);

const flag = resolveVehicleMarketplaceFeatureFlag({
  isDevelopment: false,
  envValue: env.EXPO_PUBLIC_VEHICLE_MARKETPLACE_ENABLED,
});
assert(flag.enabled && flag.source === 'env', 'release marketplace resolves enabled via env');

const appJson = readJson(resolve(ROOT, 'app.json')) as {
  expo?: { android?: { package?: string; versionCode?: number }; version?: string };
};
assert(
  appJson.expo?.android?.package === EXPECTED_PACKAGE,
  'app.json android.package',
  `got=${appJson.expo?.android?.package}`,
);

const gradle = readFileSync(resolve(ROOT, 'android/app/build.gradle'), 'utf8');
assert(
  gradle.includes(`applicationId '${EXPECTED_PACKAGE}'`),
  'build.gradle applicationId',
);
assert(
  gradle.includes('signingConfig signingConfigs.release') ||
    gradle.includes('android.buildTypes.release.signingConfig android.signingConfigs.release'),
  'release uses release signing',
);
assert(!gradle.includes('signingConfigs.debug\n            def enableShrink'), 'release not debug-signed');

const versionCodeMatch = gradle.match(/versionCode\s+(\d+)/);
assert(
  versionCodeMatch != null && Number(versionCodeMatch[1]) >= 7,
  'versionCode >= 7 for Play upload',
  `got=${versionCodeMatch?.[1] ?? 'missing'}`,
);

const rootGsPath = resolve(ROOT, 'google-services.json');
const appGsPath = resolve(ROOT, 'android/app/google-services.json');
assert(existsSync(rootGsPath), 'root google-services.json exists');
assert(existsSync(appGsPath), 'android/app/google-services.json exists');

const gs = readJson(rootGsPath) as {
  project_info?: { project_id?: string };
  client?: Array<{
    client_info?: { android_client_info?: { package_name?: string }; mobilesdk_app_id?: string };
    oauth_client?: Array<{ client_type?: number; client_id?: string; android_info?: { certificate_hash?: string } }>;
  }>;
};
assert(gs.project_info?.project_id === EXPECTED_PROJECT_ID, 'google-services project_id');
const ethemClient = (gs.client ?? []).find(
  (c) => c.client_info?.android_client_info?.package_name === EXPECTED_PACKAGE,
);
assert(Boolean(ethemClient), 'google-services has com.ethemsincar.logisticore client');
const hasWebOauth = (ethemClient?.oauth_client ?? []).some(
  (o) => o.client_type === 3 && o.client_id === EXPECTED_WEB_CLIENT,
);
assert(hasWebOauth, 'android client includes WEB oauth client type 3');

const androidHashes = (ethemClient?.oauth_client ?? [])
  .filter((o) => o.client_type === 1)
  .map((o) => o.android_info?.certificate_hash ?? '');
assert(androidHashes.length > 0, 'at least one Android OAuth SHA registered in google-services');
const debugHash = '5e8f16062ea3cd2c4a0d547876baa6f38cabf625';
const uploadHash = 'eef506407d800e6c418df2f26c9584b8e3039f78';
const playAppSigningHash = '6434734c38ca710c99d837b7e993c1928ff4e9bf';
const playPostQuantumSha1Candidate = 'c71bd7a22a55ba0bef2a97208018af46f0d313d4';
assert(
  androidHashes.includes(uploadHash),
  'google-services includes upload key SHA',
  `hashes=${androidHashes.join(',')}`,
);
assert(
  androidHashes.includes(playAppSigningHash),
  'google-services includes Play App Signing SHA',
  `hashes=${androidHashes.join(',')}`,
);
assert(
  androidHashes.includes(playPostQuantumSha1Candidate),
  'google-services includes 3rd Android OAuth SHA (post-quantum candidate)',
  `hashes=${androidHashes.join(',')}`,
);
assert(
  androidHashes.length >= 3,
  'at least 3 Android OAuth clients for Play Classical + Post-quantum + Upload',
  `count=${androidHashes.length}`,
);
const extraSha = '2fbb2c21c780a98838677d7884ef84d77164a51f';
if (androidHashes.includes(extraSha)) {
  console.log('  ✓ google-services includes additional Android OAuth SHA (2fbb2c21…)');
}
if (!androidHashes.includes(debugHash)) {
  console.warn(
    '  ! NOTE: debug SHA not in google-services (ok for Play release; local debug Google Sign-In may need it)',
  );
}

const firebaseTs = readFileSync(resolve(ROOT, 'src/services/firebase.ts'), 'utf8');
assert(
  firebaseTs.includes(`FIREBASE_FUNCTIONS_REGION = '${EXPECTED_REGION}'`),
  `functions region ${EXPECTED_REGION}`,
);
assert(!firebaseTs.includes('connectFunctionsEmulator'), 'firebase.ts has no emulator connect');
assert(!firebaseTs.includes('connectAuthEmulator'), 'firebase.ts has no auth emulator');
assert(!firebaseTs.includes('connectFirestoreEmulator'), 'firebase.ts has no firestore emulator');

const srcRoot = resolve(ROOT, 'src');
function scanForEmulatorCalls(dir: string): string[] {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
  const hits: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      hits.push(...scanForEmulatorCalls(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const text = readFileSync(full, 'utf8');
    if (
      /connect(Auth|Firestore|Functions|Storage)Emulator\s*\(/.test(text) ||
      /USE_EMULATOR\s*=\s*true/.test(text)
    ) {
      hits.push(full.replace(ROOT, ''));
    }
  }
  return hits;
}
const emulatorHits = scanForEmulatorCalls(srcRoot);
assert(emulatorHits.length === 0, 'no emulator connect calls in src', emulatorHits.join(','));

const appTsx = readFileSync(resolve(ROOT, 'App.tsx'), 'utf8');
assert(
  appTsx.includes('probeSaveRecoveryOnColdStart') &&
    appTsx.includes('await useGameStore.getState().initializeGame()') &&
    appTsx.includes('Local-first'),
  'App loads local save and initializeGame without blocking the UI on auth',
);
assert(
  !/await initAnonymousAuth\(\);\s*if \(cancelled\) return;\s*logProductionBuildConfigOnce/.test(appTsx),
  'Firebase Auth restore no longer gates first render',
);

console.log(`\nResult: ${failed === 0 ? 'PASS' : 'FAIL'} (${failed} failed)\n`);
process.exit(failed > 0 ? 1 : 0);
