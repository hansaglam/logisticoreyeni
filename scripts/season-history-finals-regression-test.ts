/**
 * Phase 7 Step 3 — Season history trusted finals regression.
 * Run: npx tsx scripts/season-history-finals-regression-test.ts
 */

import './test-globals';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  mergeCanonicalSeasonHistory,
  normalizeProgressionFoundationState,
  type SeasonHistoryEntry,
} from '../src/domain/progressionFoundation';
import {
  mapSeasonResultToFinalLeaderboard,
  SEASON_CLOSE_CALLABLES,
  SEASON_HISTORY_FINALS_ENRICH_LIMIT,
  type GetSeasonResultClientResponse,
} from '../src/services/seasonCloseService';

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

console.log('\n=== Season History Finals Regression ===\n');

const service = read('src/services/seasonCloseService.ts');
const screen = read('src/features/progression/ProgressHistoryScreen.tsx');
const domain = read('src/domain/progressionFoundation.ts');
const roadmap = read('src/config/backendRoadmap.ts');
const policy = read('src/config/storeProductionPolicy.ts');
const appConfig = read('app.config.js');
const challengeService = read('src/services/challengeService.ts');

console.log('Trusted API wiring');
check(service.includes("getSeasonResult: 'getSeasonResult'"), 'callable name getSeasonResult');
check(service.includes('call({ seasonKey: key })'), 'request seasonKey only');
check(!service.includes('call({ seasonKey: key, uid'), 'no uid in callable payload');
check(!service.includes("call({ seasonKey: key, finalRank"), 'no rank in request');
check(!service.includes("doc(`leaderboards/"), 'service never reads leaderboards path');
check(!service.includes("collection(firestore, 'leaderboards'"), 'no mutable leaderboard fallback');
check(service.includes('NEVER falls back'), 'no-fallback documented in service');
check(SEASON_CLOSE_CALLABLES.getSeasonResult === 'getSeasonResult', 'callable constant');
check(SEASON_HISTORY_FINALS_ENRICH_LIMIT === 6, 'enrich limit bounded');

console.log('\nDomain model');
check(domain.includes('SeasonHistoryFinalLeaderboard'), 'finalLeaderboard type');
check(domain.includes("'available'"), 'available state');
check(domain.includes("'not_ranked'"), 'not_ranked state');
check(domain.includes("'pending'"), 'pending state');
check(domain.includes("'unavailable'"), 'unavailable state');
check(domain.includes('normalizeFinalLeaderboard'), 'normalize finals');

{
  const available = mapSeasonResultToFinalLeaderboard({
    ok: true,
    reason: 'success',
    seasonKey: '2026-W36',
    season: null,
    result: {
      uid: 'u1',
      seasonKey: '2026-W36',
      finalScore: 1840,
      finalRank: 12,
      participantCount: 248,
      snapshottedAt: 1,
      snapshotVersion: 1,
    },
  } satisfies GetSeasonResultClientResponse);
  check(available.state === 'available', 'map success → available');
  check(available.finalRank === 12, 'map preserves finalRank');
  check(available.finalScore === 1840, 'map preserves finalScore');
  check(available.participantCount === 248, 'map preserves participantCount');

  check(
    mapSeasonResultToFinalLeaderboard({
      ok: true,
      reason: 'not-participated',
      seasonKey: '2026-W36',
      season: null,
      result: null,
    }).state === 'not_ranked',
    'not-participated → not_ranked',
  );
  check(
    mapSeasonResultToFinalLeaderboard({
      ok: false,
      reason: 'finalization-pending',
      seasonKey: '2026-W36',
      season: null,
      result: null,
    }).state === 'pending',
    'pending → pending',
  );
  check(
    mapSeasonResultToFinalLeaderboard({
      ok: false,
      reason: 'service-unavailable',
      seasonKey: '2026-W36',
      season: null,
      result: null,
    }).state === 'unavailable',
    'error → unavailable',
  );
}

{
  const base: SeasonHistoryEntry = {
    seasonKey: '2026-W36',
    displayName: '2026-W36',
    seasonPoints: 120,
    challengeCompletionCount: 2,
    endedAt: 1_000,
    readOnly: true,
    finalLeaderboard: {
      state: 'available',
      finalRank: 12,
      finalScore: 1840,
      participantCount: 248,
      snapshotVersion: 1,
    },
    finalLeaderboardRank: 12,
    finalLeaderboardScore: 1840,
  };
  const normalized = normalizeProgressionFoundationState({
    schemaVersion: 1,
    achievementCompletedAt: {},
    seasonHistory: [base],
    inbox: [],
  });
  check(normalized.seasonHistory[0]?.finalLeaderboard?.state === 'available', 'normalize keeps available');
  check(normalized.seasonHistory[0]?.finalLeaderboardRank === 12, 'normalize keeps rank');
  check(normalized.seasonHistory[0]?.finalLeaderboardScore === 1840, 'normalize keeps score');

  const missingRank = normalizeProgressionFoundationState({
    schemaVersion: 1,
    achievementCompletedAt: {},
    seasonHistory: [
      {
        ...base,
        finalLeaderboard: { state: 'available', finalScore: 10 } as SeasonHistoryEntry['finalLeaderboard'],
        finalLeaderboardRank: undefined,
        finalLeaderboardScore: undefined,
      },
    ],
    inbox: [],
  });
  check(
    missingRank.seasonHistory[0]?.finalLeaderboard === undefined,
    'malformed available without rank stripped',
  );
  check(missingRank.seasonHistory[0]?.finalLeaderboardRank == null, 'no fabricated rank 0');

  const notRanked = normalizeProgressionFoundationState({
    schemaVersion: 1,
    achievementCompletedAt: {},
    seasonHistory: [
      {
        ...base,
        finalLeaderboard: { state: 'not_ranked' },
        finalLeaderboardRank: undefined,
        finalLeaderboardScore: undefined,
      },
    ],
    inbox: [],
  });
  check(notRanked.seasonHistory[0]?.finalLeaderboard?.state === 'not_ranked', 'not_ranked preserved');
  check(notRanked.seasonHistory[0]?.finalLeaderboardRank == null, 'not_ranked has no rank');

  const merged = mergeCanonicalSeasonHistory(
    { schemaVersion: 1, achievementCompletedAt: {}, seasonHistory: [], inbox: [] },
    [base],
    '2026-W37',
    Date.now(),
  );
  check(merged.seasonHistory.every((e) => e.seasonKey !== '2026-W37'), 'active season excluded');
  check(merged.seasonHistory[0]?.finalLeaderboard?.finalRank === 12, 'merge preserves finals');
}

console.log('\nUI / flags');
check(screen.includes('enrichSeasonHistoryWithCloseResults'), 'history screen enriches finals');
check(screen.includes('SEASON_CLOSE_SNAPSHOT_ENABLED'), 'UI gated by flag');
check(screen.includes('Final Skor'), 'shows Final Skor');
check(screen.includes('Sıralama'), 'shows Sıralama');
check(screen.includes('Bu sezon sıralamaya girmedin'), 'not ranked copy');
check(screen.includes('Sıralama sonucu hazırlanıyor'), 'pending copy');
check(!screen.includes('rewardTier'), 'no reward tier authority field in UI');
check(screen.includes('SEASON_REWARDS_ENABLED'), 'reward UI gated independently');
check(
  screen.includes('Ödülü Al') ? screen.includes('SEASON_REWARDS_ENABLED') : true,
  'claim CTA only when reward flag wiring present',
);
check(!screen.includes('getLeaderboard('), 'history UI does not call getLeaderboard');
check(roadmap.includes('SEASON_CLOSE_SNAPSHOT_ENABLED'), 'client flag defined');
check(policy.includes('EXPO_PUBLIC_ENABLE_SEASON_CLOSE_SNAPSHOT'), 'prod fail-closed');
check(appConfig.includes('seasonCloseSnapshotEnabled'), 'app.config extras wired');

console.log('\nAuthority guarantees');
check(challengeService.includes('finalLeaderboardRank') === false || challengeService.includes('until a trusted'), 'history assembly does not invent rank');
check(!challengeService.includes('finalRank'), 'canonical history fetch does not set finalRank');
check(service.includes('NEVER falls back'), 'no-fallback documented in service');

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS\n');
