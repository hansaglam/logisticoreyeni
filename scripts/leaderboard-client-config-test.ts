/**
 * Leaderboard season + client config smoke tests (no emulator).
 */
import assert from 'node:assert/strict';

import { leaderboardConfig, getLeaderboardPrestigeLabel } from '../src/config/leaderboard';
import {
  getLeaderboardSeasonKey,
  getWeeklySeasonKey,
  getWeeklySeasonLabel,
} from '../src/utils/leaderboardSeason';

console.log('\n=== Leaderboard Client Config Test ===\n');

assert.match(getLeaderboardSeasonKey(new Date('2026-07-28T12:00:00Z')), /^\d{4}-W\d{2}$/);
assert.equal(getWeeklySeasonKey(new Date('2026-07-28T12:00:00Z')).startsWith('weekly_'), true);
assert.ok(getWeeklySeasonLabel().includes('–'));
assert.equal(leaderboardConfig.leaderboardSize, 100);
assert.equal(leaderboardConfig.rewardsEnabled, false);
assert.equal(getLeaderboardPrestigeLabel(1), 'Şampiyon');

console.log('  ✓ season key formats');
console.log('  ✓ rewards disabled for V1');
console.log('  ✓ top size bounded to 100');
console.log('\n✅ ALL PASS\n');
