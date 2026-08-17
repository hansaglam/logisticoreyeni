/**
 * Leaderboard + marketplace screen-open performance regression (static).
 * Run: npx tsx scripts/screen-open-performance-regression-test.ts
 */
import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

console.log('\n=== Screen Open Performance Regression ===\n');

console.log('Leaderboard fetch-first + background submit');
{
  const screen = read('src/screens/LeaderboardScreen.tsx');
  assert.match(screen, /InteractionManager\.runAfterInteractions/);
  assert.match(screen, /Promise\.all\(\[\s*fetchUsernameProfile\(\)/);
  assert.match(screen, /syncLeaderboardScoreInBackground/);
  assert.match(screen, /fetchWeeklyLeaderboard\(uid\)/);
  assert.doesNotMatch(
    screen,
    /await submitCurrentLeaderboardScore\(\{ force: true \}\);\s*if \(requestSeq/,
  );
  console.log('  ✓ parallel fetch + deferred background submit');
}

console.log('Marketplace listings-first + cache');
{
  const screen = read('src/screens/VehicleMarketplaceScreen.tsx');
  const service = read('src/services/vehicleMarketplaceService.ts');
  const app = read('App.tsx');
  assert.match(screen, /peekVehicleMarketplacePublicListingsCache/);
  assert.match(screen, /InteractionManager\.runAfterInteractions/);
  assert.match(screen, /const publicResult = await loadFirstPage\(\)/);
  assert.match(screen, /force: options\?\.forceSync \?\? false/);
  assert.match(service, /rememberVehicleMarketplacePublicListingsCache/);
  assert.match(app, /vehicleMarketplace/);
  console.log('  ✓ public listings first, sync in background, tab keep-alive');
}

console.log('Backend getLeaderboard non-blocking seed');
{
  const leaderboard = read('backend/src/leaderboard.ts');
  assert.match(leaderboard, /void ensureLeaderboardSeasonSeeded/);
  assert.doesNotMatch(
    leaderboard,
    /await ensureLeaderboardSeasonSeeded\(firestore, seasonKey, nowMs/,
  );
  console.log('  ✓ seed no longer blocks getLeaderboard');
}

console.log('\n✅ ALL PASS\n');
