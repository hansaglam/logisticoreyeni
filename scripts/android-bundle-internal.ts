/**
 * Local Internal Testing AAB.
 * Bakes EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC from .env.internal so Firestore
 * console cash injection works. Do not use for Play production upload.
 *
 * Run: npm run android:bundle:internal
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { loadBuildProfileEnv } from './build-env';

const ROOT = resolve(import.meta.dirname, '..');
const env = loadBuildProfileEnv(ROOT, 'internal');

if (env.EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC !== 'true') {
  console.error(
    '[android-bundle-internal] EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC must be true in .env.internal',
  );
  process.exit(1);
}

for (const [key, value] of Object.entries(env)) {
  process.env[key] = value;
}
process.env.LOGISTICORE_BUILD_PROFILE = 'internal';

console.log('[android-bundle-internal] profile=internal');
console.log('[android-bundle-internal] test money sync=true');
console.log('[android-bundle-internal] starting gradlew bundleRelease');

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
  process.exit(code ?? 1);
});
