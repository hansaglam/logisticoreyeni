/**
 * Diamond/gem premium currency removal regression tests.
 * Run: npx tsx scripts/diamond-removal-regression-test.ts
 */
import './test-globals';

import assert from 'node:assert/strict';

import { leaderboardConfig, getLeaderboardPrestigeLabel } from '../src/config/leaderboard';
import { MILESTONE_DEFINITIONS } from '../src/data/milestones';
import { ALL_MISSIONS } from '../src/config/missions';
import { generateWeeklyObjectives } from '../src/data/weeklyObjectives';
import { createHeadlessSimState } from './lib/headlessSim';
import {
  SAVE_GAME_VERSION,
  migrateSavePayload,
  payloadToStoreState,
  serializeGameState,
  stripLegacyBloatedSaveFields,
} from '../src/storage/saveGame';
import type { Player } from '../src/types/game';

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function minimalLegacyPayload(version: number) {
  return {
    version,
    currentTime: 0,
    gameSpeed: 1,
    isPaused: false,
    player: {
      companyName: 'Legacy Co',
      money: 42_000,
      homeCityId: 'izmir',
      level: 3,
      companyLevel: 3,
      xp: 50,
      totalXp: 250,
      reputation: 55,
      completedContracts: 7,
      diamonds: 99,
      gems: 12,
      trucks: [],
      drivers: [],
      trailers: [],
      warehouses: [],
    },
    cities: [],
    products: [],
    routes: [],
    contracts: [],
    activeDeliveries: [],
    globalEconomy: { fuelPrice: 35 },
    marketNews: [],
    eventLog: [],
    meta: {
      savedAt: 1,
      currentTime: 0,
      cash: 42_000,
      companyName: 'Legacy Co',
      completedContracts: 7,
      level: 3,
      xp: 50,
      totalXp: 250,
      diamonds: 99,
      gems: 12,
      appVersion: '1.0.0',
      saveVersion: version,
    },
  };
}

console.log('\n=== Diamond Removal Regression Test ===\n');

console.log('Leaderboard prestige-only');
check(leaderboardConfig.rewardsEnabled === false, 'economic rewards disabled');
check(getLeaderboardPrestigeLabel(1) === 'Şampiyon', '1st prestige label');
check(getLeaderboardPrestigeLabel(2) === 'İkinci', '2nd prestige label');
check(getLeaderboardPrestigeLabel(3) === 'Üçüncü', '3rd prestige label');
check(
  !('rewards' in leaderboardConfig),
  'leaderboard diamond reward table removed',
);

console.log('\nReward configs');
check(
  MILESTONE_DEFINITIONS.every((m) => !('diamonds' in (m.reward as object))),
  'milestones have no diamond rewards',
);
check(
  ALL_MISSIONS.every((m) => !('diamonds' in (m.reward as object))),
  'missions have no diamond rewards',
);
const weekly = generateWeeklyObjectives('weekly_2026-W31');
check(
  weekly.every((w) => !('diamonds' in (w.reward as object))),
  'weekly objectives have no diamond rewards',
);

console.log('\nPlayer type / bootstrap');
{
  const sim = createHeadlessSimState('Diamond Test');
  const player = sim.player as Player & { diamonds?: number; gems?: number };
  check(!('diamonds' in player), 'headless bootstrap has no diamonds field');
  check(!('gems' in player), 'headless bootstrap has no gems field');
}

console.log('\nLegacy save migration (v3 → v4)');
{
  const migrated = migrateSavePayload(minimalLegacyPayload(3));
  check(migrated != null, 'legacy save with diamonds migrates');
  if (migrated) {
    const player = migrated.player as Player & { diamonds?: number; gems?: number };
    check(migrated.version === SAVE_GAME_VERSION, `migrated to v${SAVE_GAME_VERSION}`);
    check(!('diamonds' in player), 'player.diamonds stripped after migration');
    check(!('gems' in player), 'player.gems stripped after migration');
    check(!('diamonds' in migrated.meta), 'meta.diamonds stripped after migration');
    check(!('gems' in migrated.meta), 'meta.gems stripped after migration');
    check(migrated.player.money === 42_000, 'player money preserved');
    check(migrated.player.completedContracts === 7, 'completedContracts preserved');
    check(migrated.meta.migratedFromVersion === 3, 'migratedFromVersion recorded');
  }
}

console.log('\nstripLegacyBloatedSaveFields');
{
  const stripped = stripLegacyBloatedSaveFields(minimalLegacyPayload(3) as Record<string, unknown>);
  const player = stripped.player as Record<string, unknown>;
  const meta = stripped.meta as Record<string, unknown>;
  check(player.diamonds === undefined, 'strip removes player.diamonds');
  check(player.gems === undefined, 'strip removes player.gems');
  check(meta.diamonds === undefined, 'strip removes meta.diamonds');
  check(meta.gems === undefined, 'strip removes meta.gems');
}

console.log('\nNew save serialization');
{
  const migrated = migrateSavePayload(minimalLegacyPayload(3));
  assert.ok(migrated);
  const payload = serializeGameState(payloadToStoreState(migrated));
  const player = payload.player as Player & { diamonds?: number; gems?: number };
  const json = JSON.stringify(payload);
  check(!('diamonds' in player), 'serialized player has no diamonds');
  check(!('gems' in player), 'serialized player has no gems');
  check(!json.includes('"diamonds"'), 'serialized JSON has no diamonds key');
  check(!json.includes('"gems"'), 'serialized JSON has no gems key');
  check(payload.version === SAVE_GAME_VERSION, `new save version is v${SAVE_GAME_VERSION}`);
}

console.log(`\n=== Sonuç: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
