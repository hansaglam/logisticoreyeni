/**
 * Phase 7 Step 3.5 — Backend verification / canary readiness regression (no emulator).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

let pass = 0;
let fail = 0;
function check(cond: boolean, label: string) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`);
  }
}

console.log('\n=== Season Close Canary Readiness Regression ===\n');

const seasonClose = read('backend/src/seasonClose.ts');
const types = read('backend/src/seasonCloseTypes.ts');
const index = read('backend/src/index.ts');
const rules = read('firestore.rules');
const deletion = read('backend/src/accountDeletion.ts');
const indexes = read('firestore.indexes.json');
const firebaserc = read('.firebaserc');
const unit = read('backend/test/seasonClose.unit.test.ts');
const emulator = read('backend/test/seasonClose.emulator.test.ts');
const clientService = read('src/services/seasonCloseService.ts');
const screen = read('src/features/progression/ProgressHistoryScreen.tsx');
const policy = read('src/config/storeProductionPolicy.ts');
const roadmap = read('src/config/backendRoadmap.ts');

console.log('Idempotency / finalizer');
check(seasonClose.includes('already-closed'), 'already-closed short-circuit');
check(seasonClose.includes('createResultOnce'), 'create-once results');
check(seasonClose.includes('integrity-conflict'), 'integrity conflict path');
check(seasonClose.includes('timeout-partial'), 'timeout-partial resume');
check(seasonClose.includes('closeCursor'), 'cursor persisted');
check(seasonClose.includes("status: 'closing'"), 'closing state');
check(seasonClose.includes("status: 'closed'"), 'closed state');
check(!seasonClose.includes("status: 'open'"), 'no reopen status');

console.log('\nPagination / order');
check(seasonClose.includes(".orderBy('companyScore', 'desc')"), 'score DESC');
check(seasonClose.includes("orderBy(FieldPath.documentId(), 'asc')"), 'uid ASC');
check(seasonClose.includes('startAfter(cursor.companyScore, cursor.uid)'), 'cursor dual fields');
check(seasonClose.includes('paginateSeasonCloseEntries'), 'pure pagination helper');
check(unit.includes('pagination cursor'), 'pagination unit coverage');
check(
  indexes.includes('"fieldPath": "scoreVersion"') &&
    indexes.includes('"fieldPath": "companyScore"') &&
    indexes.includes('"fieldPath": "__name__"'),
  'composite index present',
);

console.log('\nParticipant count / scoreVersion');
check(seasonClose.includes("where('scoreVersion', '==', LEADERBOARD_SCORE_VERSION)"), 'count uses current scoreVersion');
check(
  seasonClose.includes('score-version-filter-excludes-existing-entries'),
  'refuse empty close when other versions exist',
);
check(seasonClose.includes('rankedSourceEntries'), 'shared source filter for count+write');

console.log('\nTrusted read safety');
check(seasonClose.includes('parseSeasonCloseResultDocument'), 'strict result parse');
check(unit.includes('rejects fake rank 0'), 'rank 0 rejected in unit');
check(seasonClose.includes('not-participated'), 'not-participated reason');
check(seasonClose.includes('finalization-pending'), 'pending reason');
check(index.includes("auth.identity.uid"), 'getSeasonResult uses auth uid');
check(index.includes("hasOnlyKeys(record, ['seasonKey'])"), 'seasonKey-only request');

console.log('\nLazy fallback safety');
check(index.includes('ensureSeasonFinalizedCallable'), 'ensure callable');
check(index.includes("seasonCloseEnsure"), 'ensure rate limit key');
check(index.includes("maxRequests: 20"), 'ensure rate bounded');
check(index.includes('maxDurationMs: 45_000'), 'ensure duration capped');
check(index.includes("'finalRank' in record"), 'rejects client rank');
check(index.includes("'uid' in record"), 'rejects client uid');

console.log('\nScheduler / flags');
check(index.includes("schedule: '10 0 * * *'"), '00:10 UTC schedule');
check(index.includes('getPreviousLeaderboardSeasonKey'), 'scheduler previous week');
check(index.includes('isSeasonCloseSnapshotEnabled()'), 'scheduler gated');
check(index.includes("reason: 'feature-disabled'"), 'flag off no-op path');
check(roadmap.includes('SEASON_CLOSE_SNAPSHOT_ENABLED'), 'client flag');
check(policy.includes('EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT must remain false'), 'prod fail-closed');

console.log('\nSecurity / deletion');
check(rules.includes('match /seasons/{seasonKey}'), 'seasons rules');
check(rules.includes('allow read, write: if false'), 'deny client R/W');
check(deletion.includes('deleteSeasonCloseResultsForUid'), 'deletion hook');
check(seasonClose.includes('listDocuments'), 'deletion lists seasons');
check(seasonClose.includes('await ref.delete()'), 'deletes result docs only');
check(!seasonClose.includes("metaRef.delete"), 'does not delete season meta');

console.log('\nRewards posture (Step 6: UI gated; production flags OFF)');
check(!seasonClose.includes('rewardAmount:') || seasonClose.includes('rewardAmount: null'), 'no reward amounts on results');
check(index.includes('claimSeasonReward'), 'claim callable source present');
check(index.includes('SEASON_REWARDS') || read('backend/src/seasonRewardTypes.ts').includes('SEASON_REWARDS_ENABLED'), 'rewards flag module');
check(!screen.includes('Ödül Talep'), 'no legacy Ödül Talep label');
check(screen.includes('SEASON_REWARDS_ENABLED'), 'reward UI gated by client flag');
check(!index.includes('materializeSeasonRewardEntitlementsCallable'), 'no public materialize callable');
check(!clientService.includes("collection(firestore, 'leaderboards'"), 'client no leaderboard fallback');

console.log('\nEnvironment / canary posture');
check(firebaserc.includes('logisticore-53ab4'), 'default project present');
check(!firebaserc.includes('staging') && !firebaserc.includes('internal'), 'no separate staging alias');
check(emulator.includes('clients cannot write season close docs'), 'emulator rules test present');
check(unit.includes('UTC week edges'), 'UTC boundary unit tests');
check(types.includes('rewardsEnabled?: boolean'), 'rewardsEnabled typed on meta');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exitCode = 1;
} else {
  console.log('✅ ALL PASS\n');
}
