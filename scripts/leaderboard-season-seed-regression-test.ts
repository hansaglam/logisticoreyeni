/**
 * Leaderboard season seed / season-change sync regression (static).
 * Run: npx tsx scripts/leaderboard-season-seed-regression-test.ts
 *
 * Architecture (current):
 * - SERVER seeds weekly leaderboard entries (schedule + lazy ensure).
 * - CLIENT never seeds the board; it may auto-submit the local player's
 *   trusted score when the ISO week rolls (lifecycle / screen / cloud sync).
 * - App.tsx composes useAppStateLifecycle; season-change submit lives there
 *   after Phase 2C lifecycle extraction (not inlined in App.tsx).
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

console.log('Backend wiring (server authority)');
{
  const index = read('backend/src/index.ts');
  const leaderboard = read('backend/src/leaderboard.ts');
  const seed = read('backend/src/leaderboardSeasonSeed.ts');
  assert.match(index, /seedWeeklyLeaderboard/);
  assert.match(index, /seedLeaderboardSeason/);
  assert.match(index, /schedule:\s*'5 0 \* \* \*'/);
  assert.match(leaderboard, /ensureLeaderboardSeasonSeeded/);
  assert.match(seed, /prepareLeaderboardEntryPayload/);
  assert.match(seed, /usernameSetupCompleted/);
  assert.match(seed, /seedCompletedAt/);
  assert.match(
    index,
    /hasOnlyKeys\(record,\s*\['transactionId',\s*'idempotencyKey',\s*'clientSaveVersion'\]\)/,
  );
  assert.match(index, /'uid' in record \|\| 'score' in record \|\| 'companyScore' in record/);
  console.log('  ✓ scheduled seed + get-time backfill wired');
  console.log('  ✓ submitLeaderboardScore rejects client-authored score fields');
}

console.log('Client season sync (extracted lifecycle)');
{
  const app = read('App.tsx');
  const appState = read('src/hooks/useAppStateLifecycle.ts');
  const sync = read('src/services/leaderboardSeasonSync.ts');
  const screen = read('src/screens/LeaderboardScreen.tsx');
  const cloud = read('src/storage/cloudSaveSync.ts');
  const service = read('src/services/leaderboardService.ts');

  assert.match(app, /useAppStateLifecycle\(\)/);
  assert.doesNotMatch(
    app,
    /maybeSubmitLeaderboardForSeasonChange/,
    'App.tsx must not re-inline season-change submit after lifecycle extraction',
  );
  assert.match(appState, /maybeSubmitLeaderboardForSeasonChange/);
  assert.match(appState, /!wasActive && isActive/);
  assert.match(sync, /getLeaderboardSeasonKey/);
  assert.match(sync, /submitCurrentLeaderboardScore/);
  assert.match(sync, /lastSubmittedSeasonKey|STORAGE_KEY/);
  assert.match(sync, /if \(inFlight\)/);
  assert.match(sync, /lastSeasonKey === currentSeasonKey/);
  assert.match(screen, /maybeSubmitLeaderboardForSeasonChange/);
  assert.match(screen, /markLeaderboardSeasonSubmitted/);
  assert.match(cloud, /maybeSubmitLeaderboardForSeasonChange/);
  assert.match(service, /Client raw score göndermez/);
  assert.match(
    service,
    /fn\(\{\s*transactionId,\s*idempotencyKey,/s,
  );
  assert.doesNotMatch(
    service,
    /fn\(\{[^}]*companyScore/s,
    'submit callable payload must not include companyScore',
  );
  console.log('  ✓ App mounts lifecycle hook; season-change submit on foreground');
  console.log('  ✓ duplicate in-flight + same-season skip remain');
  console.log('  ✓ LeaderboardScreen + cloudSaveSync still invoke sync');
  console.log('  ✓ client submit path remains non-authoritative for score');
}

console.log('Firestore index for user seed scan');
{
  const indexes = read('firestore.indexes.json');
  const seed = read('backend/src/leaderboardSeasonSeed.ts');
  assert.match(seed, /\.where\('usernameSetupCompleted',\s*'==',\s*true\)/);
  assert.match(seed, /orderBy\(FieldPath\.documentId\(\)\)/);
  // Firebase rejects a composite (usernameSetupCompleted + __name__) as unnecessary —
  // equality + documentId order uses automatic single-field indexes.
  assert.doesNotMatch(
    indexes,
    /"collectionGroup":\s*"users"/,
    'do not declare rejected users composite; single-field indexes cover seed query',
  );
  console.log('  ✓ seed query uses usernameSetupCompleted + documentId (single-field index path)');
}

console.log('\n✅ ALL PASS\n');
