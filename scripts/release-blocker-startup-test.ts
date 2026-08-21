/**
 * Release-blocker wiring: fingerprint, crash boundaries, local-first boot, map marker.
 * Run: npx tsx scripts/release-blocker-startup-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import './test-globals';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

const root = resolve(process.cwd());
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const app = read('App.tsx');
const index = read('index.js');
const marker = read('src/components/map/AnimatedDeliveryTruckMarker.tsx');
const canvas = read('src/components/map/WorldMapCanvas.tsx');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const config = read('app.config.js');
const fingerprint = read('src/config/buildFingerprint.ts');
const startup = read('src/domain/vehicleMarketplaceStartupReconcile.ts');
const appJson = read('app.json');

console.log('\n=== Release Blocker Startup Wiring ===\n');

assert(fingerprint.includes('[BUILD_FINGERPRINT]'), 'startup logs build fingerprint');
assert(config.includes('buildFingerprint'), 'app.config bakes git commit into extra');
assert(config.includes("expoUpdatesEnabled: false"), 'config records updates disabled');
assert(manifest.includes('expo.modules.updates.ENABLED" android:value="false"'), 'Expo Updates disabled in AndroidManifest');
assert(!appJson.includes('expo-updates'), 'no expo-updates in app.json');
assert(index.includes('[FATAL]') || index.includes('logFatalJsException'), 'fatal JS handler installed');
assert(index.includes('logUnhandledRejection'), 'unhandled rejection handler installed');
assert(app.includes('logStartupError'), 'App catches startup errors');
assert(app.includes('InteractionManager.runAfterInteractions'), 'post-ready work waits for first interactions');
assert(app.includes('runPostStartupMarketplaceReconcile'), 'marketplace reconcile is post-ready');
assert(!/await runPostStartupMarketplaceReconcile\(\);\s*markStartup\('GAME_READY'\)/.test(app), 'marketplace does not gate GAME_READY');
assert(app.includes("bootPhase === 'ready' && isGameReady"), 'UI paints from local hydrate');
assert(marker.includes('Polygon'), 'live marker uses SVG chevron');
assert(!marker.includes('GameIcon'), 'live marker has no truck pictogram');
assert(!marker.includes('truck-outline'), 'live marker has no truck-outline');
assert(canvas.includes('AnimatedDeliveryTruckMarker'), 'WorldMapCanvas renders AnimatedDeliveryTruckMarker');
assert(appJson.includes('"version": "1.0.32"'), 'app version is 1.0.32');
assert(appJson.includes('"versionCode": 33'), 'Android versionCode is 33');
assert(
  startup.includes('versionIncreased && cashOutOfSync'),
  'startup reconcile does not apply on version bump alone',
);
assert(
  !startup.includes('versionIncreased ||\n      staleLocalSoldTrucks'),
  'bare versionIncreased apply removed',
);

console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('release-blocker-startup-test: PASSED\n');
