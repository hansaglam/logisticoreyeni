/**
 * Cloud save → serverState leaderboard stats sync regression.
 * Run: npx tsx scripts/leaderboard-server-state-sync-regression-test.ts
 */
import './test-globals';

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  extractCanonicalPlayerStateFromServerState,
  calculateLeaderboardScore,
} from '../backend/src/leaderboardScore';
import {
  buildDefaultServerState,
  mergeLeaderboardStatsFromCloudSave,
} from '../backend/src/serverState';

const backendRequire = createRequire(resolve(process.cwd(), 'backend', 'package.json'));
const { Timestamp } = backendRequire('firebase-admin/firestore') as {
  Timestamp: { fromMillis: (ms: number) => { toMillis: () => number } };
};

const ROOT = resolve(__dirname, '..');
const now = Timestamp.fromMillis(Date.UTC(2026, 7, 17, 12, 0, 0));

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

console.log('\n=== Leaderboard Server State Sync Regression ===\n');

console.log('Backend wiring');
{
  const leaderboard = read('backend/src/leaderboard.ts');
  const seed = read('backend/src/leaderboardSeasonSeed.ts');
  assert.match(leaderboard, /mergeLeaderboardStatsFromCloudSave/);
  assert.match(leaderboard, /pickLeaderboardServerStatePersistPatch/);
  assert.match(seed, /mergeLeaderboardStatsFromCloudSave/);
  assert.match(seed, /buildBoundedLegacyMigrationFromCloudSave/);
  console.log('  ✓ submit + seed sync from cloud save');
}

console.log('Stale serverState picks up cloud save deliveries');
{
  const uid = 'test-user-stale';
  const stale = buildDefaultServerState(uid, now);
  stale.completedDeliveries = 0;

  const save = {
    saveVersion: 42,
    gameState: {
      player: {
        completedContracts: 25,
        level: 8,
        reputation: 72,
        companyName: 'Eto Lojistik',
        failedDeliveries: 1,
        lateDeliveries: 3,
        homeCityId: 'izmir',
        trucks: [],
        warehouses: [],
      },
    },
  };

  const merged = mergeLeaderboardStatsFromCloudSave(uid, stale, save, now);
  assert.equal(merged.completedDeliveries, 25);
  assert.equal(merged.companyLevel, 8);
  assert.equal(merged.reputation, 72);
  assert.equal(merged.companyName, 'Eto Lojistik');
  assert.equal(merged.sourceVersion, 42);

  const extracted = extractCanonicalPlayerStateFromServerState(merged);
  assert.equal(extracted.ok, true);
  if (extracted.ok) {
    const breakdown = calculateLeaderboardScore(extracted.player, extracted.gameState);
    assert.equal(breakdown.completedContracts, 25);
    assert.equal(breakdown.rankedEligible, true, '≥3 deliveries → ranked eligible');
  }
  console.log('  ✓ completedDeliveries synced from save');
}

console.log('preserveAuthoritativeFleet keeps server trucks');
{
  const uid = 'test-user-fleet';
  const stale = buildDefaultServerState(uid, now);
  const serverTruckCount = stale.ownedTrucks.length;

  const save = {
    gameState: {
      player: {
        completedContracts: 10,
        trucks: [
          { id: 'extra-1', templateId: 'truck-a', currentCityId: 'ankara' },
          { id: 'extra-2', templateId: 'truck-b', currentCityId: 'ankara' },
        ],
      },
    },
  };

  const merged = mergeLeaderboardStatsFromCloudSave(uid, stale, save, now, {
    preserveAuthoritativeFleet: true,
  });
  assert.equal(merged.completedDeliveries, 10);
  assert.equal(merged.ownedTrucks.length, serverTruckCount);
  console.log('  ✓ marketplace fleet preserved when flagged');
}

console.log('\n✅ ALL PASS\n');
