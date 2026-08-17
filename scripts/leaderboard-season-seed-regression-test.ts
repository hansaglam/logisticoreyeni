/**
 * Leaderboard season seed regression (static).
 * Run: npx tsx scripts/leaderboard-season-seed-regression-test.ts
 */
import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

console.log('\n=== Leaderboard Season Seed Regression ===\n');

console.log('Backend wiring');
{
  const index = read('backend/src/index.ts');
  const leaderboard = read('backend/src/leaderboard.ts');
  const seed = read('backend/src/leaderboardSeasonSeed.ts');
  assert.match(index, /seedWeeklyLeaderboard/);
  assert.match(index, /seedLeaderboardSeason/);
  assert.match(leaderboard, /ensureLeaderboardSeasonSeeded/);
  assert.match(seed, /prepareLeaderboardEntryPayload/);
  assert.match(seed, /usernameSetupCompleted/);
  assert.match(seed, /seedCompletedAt/);
  console.log('  ✓ scheduled seed + get-time backfill wired');
}

console.log('Client season sync');
{
  const app = read('App.tsx');
  const sync = read('src/services/leaderboardSeasonSync.ts');
  const screen = read('src/screens/LeaderboardScreen.tsx');
  const cloud = read('src/storage/cloudSaveSync.ts');
  assert.match(app, /maybeSubmitLeaderboardForSeasonChange/);
  assert.match(sync, /getLeaderboardSeasonKey/);
  assert.match(sync, /submitCurrentLeaderboardScore/);
  assert.match(screen, /maybeSubmitLeaderboardForSeasonChange/);
  assert.match(screen, /markLeaderboardSeasonSubmitted/);
  assert.match(cloud, /maybeSubmitLeaderboardForSeasonChange/);
  console.log('  ✓ client auto-submit on season change');
}

console.log('Firestore index for user scan');
{
  const indexes = read('firestore.indexes.json');
  assert.match(indexes, /"usernameSetupCompleted"/);
  console.log('  ✓ users usernameSetupCompleted index declared');
}

console.log('\n✅ ALL PASS\n');
