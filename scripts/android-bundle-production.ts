/**
 * Local store-production AAB.
 * Bakes LOGISTICORE_BUILD_PROFILE=production and the current git SHA.
 * Do not use android:bundle:internal for Play production.
 *
 * Run: npm run android:bundle:production
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadBuildProfileEnv } from './build-env';
import { validateStoreProductionEnv } from '../src/config/storeProductionPolicy';

const ROOT = resolve(import.meta.dirname, '..');
const AAB_PATH = resolve(ROOT, 'android/app/build/outputs/bundle/release/app-release.aab');

function fail(message: string): never {
  console.error(`[android-bundle-production] ${message}`);
  process.exit(1);
}

function run(command: string, cwd = ROOT): string {
  return execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const status = run('git status --porcelain');
if (status.length > 0) {
  console.error(status);
  fail('working tree is dirty — commit before building the production AAB');
}

const branch = run('git branch --show-current');
if (branch !== 'main') {
  fail(`expected branch main, got ${branch}`);
}

const gitCommit = run('git rev-parse HEAD');
const env = loadBuildProfileEnv(ROOT, 'production');
env.EXPO_PUBLIC_GIT_COMMIT = gitCommit;
env.LOGISTICORE_BUILD_PROFILE = 'production';

const productionErrors = validateStoreProductionEnv({ env });
if (productionErrors.length > 0) {
  for (const error of productionErrors) {
    console.error(`  ✗ ${error}`);
  }
  fail('production env validation failed');
}

const mustBeOff = [
  'EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC',
  'EXPO_PUBLIC_ADS_USE_TEST_IDS',
  'EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED',
  'EXPO_PUBLIC_USE_FIREBASE_EMULATOR',
  'EXPO_PUBLIC_MARKET_ALARMS_ENABLED',
] as const;
for (const key of mustBeOff) {
  if (env[key] === 'true') {
    fail(`${key} must be unset/false for production`);
  }
}
if (env.EXPO_PUBLIC_LEADERBOARD_ENABLED !== 'true') {
  fail('EXPO_PUBLIC_LEADERBOARD_ENABLED must be true');
}
if (env.EXPO_PUBLIC_VEHICLE_MARKETPLACE_ENABLED !== 'true') {
  fail('EXPO_PUBLIC_VEHICLE_MARKETPLACE_ENABLED must be true');
}

for (const [key, value] of Object.entries(env)) {
  process.env[key] = value;
}

const appJson = JSON.parse(readFileSync(resolve(ROOT, 'app.json'), 'utf8')) as {
  expo?: { version?: string; android?: { versionCode?: number } };
};
const versionName = appJson.expo?.version ?? 'unknown';
const versionCode = appJson.expo?.android?.versionCode ?? 'unknown';

console.log('[android-bundle-production] profile=production');
console.log('[android-bundle-production] versionName', versionName);
console.log('[android-bundle-production] versionCode', versionCode);
console.log('[android-bundle-production] gitSha', gitCommit);
console.log('[android-bundle-production] gitShaShort', gitCommit.slice(0, 7));
console.log('[android-bundle-production] mapMarkerRevision=chevron-circle-v2');
console.log('[android-bundle-production] test money sync=OFF');
console.log('[android-bundle-production] ads test ids=OFF');

const stalePaths = [
  'android/app/build/generated/assets/createBundleReleaseJsAndAssets',
  'android/app/build/generated/sourcemaps',
  'android/app/build/intermediates',
  'android/app/build/outputs',
  'android/build',
];
for (const relative of stalePaths) {
  const target = resolve(ROOT, relative);
  try {
    rmSync(target, { recursive: true, force: true });
    console.log(`[android-bundle-production] cleaned ${relative}`);
  } catch (error) {
    fail(`could not clean ${relative}: ${String(error)}`);
  }
}

console.log('[android-bundle-production] running production validation');
execSync('npm run validate:production-build', { cwd: ROOT, stdio: 'inherit', env: process.env });

console.log('[android-bundle-production] starting gradlew bundleRelease');
const gradle = spawn('gradlew.bat', ['bundleRelease'], {
  cwd: resolve(ROOT, 'android'),
  env: process.env,
  stdio: 'inherit',
  shell: true,
});

gradle.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  if (code !== 0) {
    process.exit(code ?? 1);
  }
  if (!existsSync(AAB_PATH)) {
    fail(`AAB missing at ${AAB_PATH}`);
  }
  const sizeBytes = statSync(AAB_PATH).size;
  const buildTimestamp = new Date().toISOString();
  console.log('\n[android-bundle-production] AAB ready');
  console.log(`  path: ${AAB_PATH}`);
  console.log(`  sizeBytes: ${sizeBytes}`);
  console.log(`  versionName: ${versionName}`);
  console.log(`  versionCode: ${versionCode}`);
  console.log(`  gitSha: ${gitCommit}`);
  console.log(`  buildProfile: production`);
  console.log(`  buildTimestamp: ${buildTimestamp}`);
  console.log(`  mapMarkerRevision: chevron-circle-v2`);
  process.exit(0);
});
