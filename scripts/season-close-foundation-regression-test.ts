/**
 * Phase 7 Step 2 — season close foundation regression (no Firestore emulator).
 * Run: npx tsx scripts/season-close-foundation-regression-test.ts
 */

import './test-globals';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  getLeaderboardSeasonBoundsFromKey,
  getLeaderboardSeasonKey,
  getPreviousLeaderboardSeasonKey,
} from '../backend/src/leaderboardSeason';
import { classifySeasonCloseTiming } from '../backend/src/seasonClose';
import { SEASON_CLOSE_SNAPSHOT_VERSION } from '../backend/src/seasonCloseTypes';
import { LEADERBOARD_SCORE_VERSION } from '../backend/src/leaderboardScore';

let pass = 0;
let fail = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

console.log('\n=== Season Close Foundation Regression ===\n');

const close = read('backend/src/seasonClose.ts');
const index = read('backend/src/index.ts');
const rules = read('firestore.rules');
const types = read('backend/src/seasonCloseTypes.ts');
const deletion = read('backend/src/accountDeletion.ts');
const roadmap = read('src/config/backendRoadmap.ts');
const policy = read('src/config/storeProductionPolicy.ts');
const score = read('backend/src/leaderboardScore.ts');

console.log('Model + ranking');
check(SEASON_CLOSE_SNAPSHOT_VERSION === 1, 'snapshot version 1');
check(LEADERBOARD_SCORE_VERSION === 3, 'score formula is v3 (zero-start)');
check(
  types.includes("export type SeasonCloseStatus = 'closing' | 'closed'"),
  'status machine closing|closed',
);
check(types.includes('finalScore'), 'result has finalScore');
check(types.includes('finalRank'), 'result has finalRank');
check(types.includes('rewardTier?: null'), 'reward fields reserved null');
check(close.includes("orderBy('companyScore', 'desc')"), 'order companyScore DESC');
check(close.includes("orderBy(FieldPath.documentId(), 'asc')"), 'order uid ASC');
check(close.includes('.create(') || close.includes('ref.create'), 'create-once results');
check(close.includes('integrity-conflict'), 'integrity conflict path');

console.log('\nTiming / scheduler');
{
  const nowMs = Date.UTC(2026, 8, 9, 12, 0, 0, 0);
  check(getLeaderboardSeasonKey(nowMs) === '2026-W37', 'active week W37');
  check(getPreviousLeaderboardSeasonKey(nowMs) === '2026-W36', 'previous W36');
  check(classifySeasonCloseTiming('2026-W37', nowMs) === 'active', 'active rejected');
  check(classifySeasonCloseTiming('2026-W36', nowMs) === 'ended', 'ended allowed');
  check(classifySeasonCloseTiming('2026-W40', nowMs) === 'future', 'future rejected');
  const bounds = getLeaderboardSeasonBoundsFromKey('2026-W36');
  check(!!bounds && bounds.endsAt === bounds.startsAt + 7 * 86_400_000, 'half-open week bounds');
}
check(index.includes("schedule: '10 0 * * *'"), 'schedule 00:10 UTC daily');
check(index.includes('getPreviousLeaderboardSeasonKey'), 'scheduler uses previous key');
check(index.includes('finalizeWeeklySeasonClose'), 'scheduled export present');
check(index.includes('ensureSeasonFinalizedCallable'), 'lazy ensure callable');
check(index.includes('export const getSeasonResult'), 'getSeasonResult callable');

console.log('\nAuthority / security');
check(index.includes("'finalRank' in record"), 'ensure rejects client rank');
check(index.includes("'finalScore' in record") || index.includes("'score' in record"), 'rejects client score');
check(index.includes('auth.identity.uid'), 'result read uses auth uid');
check(rules.includes('match /seasons/{seasonKey}'), 'rules seasons path');
check(rules.includes('allow read, write: if false;'), 'seasons deny client');
check(deletion.includes('deleteSeasonCloseResultsForUid'), 'account deletion cleanup hooked');

console.log('\nFlags / no rewards');
check(roadmap.includes('SEASON_CLOSE_SNAPSHOT_ENABLED'), 'client flag present');
check(policy.includes('EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT'), 'store production forbids flag');
check(close.includes('isSeasonCloseSnapshotEnabled'), 'backend env gate');
check(!close.includes('rewardAmount:') || close.includes('rewardAmount: null'), 'no reward amounts computed');
check(!close.includes('claimSeason'), 'no claim logic');
check(!score.includes('SEASON_CLOSE'), 'score module untouched by close');

console.log('\nResume / immutability wiring');
check(close.includes('closeCursor'), 'cursor persisted');
check(close.includes('timeout-partial'), 'partial resume reason');
check(close.includes('already-closed'), 'idempotent closed');
check(close.includes('processedCount'), 'processedCount progress');
check(close.includes('score-version-filter-excludes-existing-entries'), 'scoreVersion empty guard');
check(close.includes('parseSeasonCloseResultDocument'), 'strict result parse exported');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS\n');
