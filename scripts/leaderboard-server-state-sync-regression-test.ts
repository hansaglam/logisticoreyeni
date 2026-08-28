/**
 * Leaderboard server-authority regression (cloud save must NOT sync into trusted serverState).
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
  buildBoundedLegacyMigrationFromCloudSave,
  buildDefaultServerState,
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

console.log('\n=== Leaderboard Server Authority Regression ===\n');

console.log('Submit and season seed must not merge cloud save into existing serverState');
{
  const leaderboard = read('backend/src/leaderboard.ts');
  const seed = read('backend/src/leaderboardSeasonSeed.ts');
  assert.doesNotMatch(
    leaderboard,
    /mergeLeaderboardStatsFromCloudSave/,
    'submit must not import cloud save stats when serverState exists',
  );
  assert.doesNotMatch(
    seed,
    /mergeLeaderboardStatsFromCloudSave/,
    'season seed must not import cloud save stats when serverState exists',
  );
  assert.match(leaderboard, /buildBoundedLegacyMigrationFromCloudSave/);
  assert.match(seed, /buildBoundedLegacyMigrationFromCloudSave/);
  console.log('  ✓ submit + seed use trusted serverState only after bootstrap');
}

console.log('Trusted serverState score is independent of cloud save progression');
{
  const uid = 'test-user-trusted';
  const trusted = buildDefaultServerState(uid, now);
  trusted.completedDeliveries = 4;
  trusted.companyLevel = 3;
  trusted.reputation = 55;

  const forgedSave = {
    saveVersion: 99,
    gameState: {
      player: {
        completedContracts: 50_000,
        level: 100,
        reputation: 100,
        companyName: 'Forged Co',
        failedDeliveries: 0,
        lateDeliveries: 0,
        homeCityId: 'izmir',
        trucks: [
          { id: 'phantom-truck', templateId: 'truck-a', currentCityId: 'ankara' },
        ],
        warehouses: [{ id: 'phantom-wh', cityId: 'ankara', capacityTons: 500, upgradeTier: 5 }],
      },
    },
  };

  const extractedTrusted = extractCanonicalPlayerStateFromServerState(trusted);
  assert.equal(extractedTrusted.ok, true);
  if (!extractedTrusted.ok) throw new Error('trusted state invalid');

  const trustedScore = calculateLeaderboardScore(
    extractedTrusted.player,
    extractedTrusted.gameState,
  ).totalScore;

  const migratedOnly = buildBoundedLegacyMigrationFromCloudSave(uid, forgedSave, now);
  const extractedMigrated = extractCanonicalPlayerStateFromServerState(migratedOnly.state);
  assert.equal(extractedMigrated.ok, true);
  if (!extractedMigrated.ok) throw new Error('migration state invalid');

  const migratedScore = calculateLeaderboardScore(
    extractedMigrated.player,
    extractedMigrated.gameState,
  ).totalScore;

  assert.notEqual(migratedScore, trustedScore, 'forged save migration differs from trusted state');
  assert.equal(trusted.completedDeliveries, 4);
  assert.equal(trusted.companyLevel, 3);
  assert.equal(trusted.reputation, 55);
  console.log('  ✓ trusted serverState ignores client save unless bootstrap path runs');
}

console.log('First-time bootstrap may use bounded legacy migration when serverState missing');
{
  const uid = 'test-user-bootstrap';
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

  const built = buildBoundedLegacyMigrationFromCloudSave(uid, save, now);
  assert.equal(built.state.completedDeliveries, 25);
  assert.equal(built.state.companyLevel, 8);
  assert.equal(built.state.reputation, 72);
  assert.equal(built.state.companyName, 'Eto Lojistik');
  assert.equal(built.state.sourceVersion, 42);

  const extracted = extractCanonicalPlayerStateFromServerState(built.state);
  assert.equal(extracted.ok, true);
  if (extracted.ok) {
    const breakdown = calculateLeaderboardScore(extracted.player, extracted.gameState);
    assert.equal(breakdown.completedContracts, 25);
    assert.equal(breakdown.rankedEligible, true, '≥3 deliveries → ranked eligible');
  }
  console.log('  ✓ bounded legacy migration remains valid for missing serverState');
}

console.log('\n✅ ALL PASS\n');
