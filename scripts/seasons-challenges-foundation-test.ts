import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CHALLENGE_CATALOG } from '../src/features/challenges/catalog';
import { evaluateChallengeProgress } from '../src/features/challenges/progress';
import {
  getDailyPeriod,
  getRemainingPeriodMs,
  getSeasonDefinition,
  getWeeklyPeriod,
} from '../src/features/seasons/periods';
import { getLeaderboardSeasonKey } from '../src/utils/leaderboardSeason';

let passed = 0;
function check(condition: unknown, label: string) {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

console.log('\n=== Seasons + Challenges Foundation ===');

const monday = Date.UTC(2026, 7, 31, 10);
const sunday = Date.UTC(2026, 8, 6, 23, 59);
check(getWeeklyPeriod(monday).key === getWeeklyPeriod(sunday).key, 'same ISO week is deterministic');
check(getWeeklyPeriod(Date.UTC(2025, 11, 31)).key === '2026-W01', 'year boundary uses ISO week-year');
let leaderboardParity = true;
for (let day = 0; day < 400; day += 1) {
  const timestamp = Date.UTC(2025, 0, 1) + day * 86_400_000 + 23 * 3_600_000;
  leaderboardParity =
    leaderboardParity &&
    getWeeklyPeriod(timestamp).key === getLeaderboardSeasonKey(new Date(timestamp));
}
check(leaderboardParity, 'season and leaderboard keys match across 400 UTC days');
check(getDailyPeriod(Date.UTC(2026, 8, 1, 23)).key === '2026-09-01', 'daily key uses UTC');
check(getDailyPeriod(Date.UTC(2026, 8, 2, 0)).key === '2026-09-02', 'daily rollover is deterministic');
check(getSeasonDefinition(monday).status === 'active', 'current season active');
check(
  getSeasonDefinition(getWeeklyPeriod(monday).startsAt - 1, monday).status === 'upcoming',
  'future season upcoming',
);
check(getSeasonDefinition(getWeeklyPeriod(monday).endsAt, monday).status === 'ended', 'expired season ended');
check(getRemainingPeriodMs(getDailyPeriod(monday), monday) > 0, 'remaining duration bounded positive');

check(CHALLENGE_CATALOG.length === 5, 'catalog is data-driven and bounded');
check(CHALLENGE_CATALOG.every((item) => item.version === 1), 'definitions versioned');
check(CHALLENGE_CATALOG.filter((item) => item.enabled).every((item) => item.metric.startsWith('marketplace_')), 'only trusted marketplace metrics enabled');

const definition = CHALLENGE_CATALOG.find((item) => item.id === 'weekly_marketplace_purchases')!;
const zero = evaluateChallengeProgress(definition, '2026-W36', 0);
const partial = evaluateChallengeProgress(definition, '2026-W36', 2);
const exact = evaluateChallengeProgress(definition, '2026-W36', 3);
const over = evaluateChallengeProgress(definition, '2026-W36', 999);
check(zero.current === 0 && !zero.completed, 'zero progress');
check(partial.current === 2 && !partial.completed, 'partial progress');
check(exact.current === 3 && exact.completed, 'exact completion');
check(over.current === definition.target && over.completed, 'over-target display is capped');

const backendIndex = readFileSync('backend/src/index.ts', 'utf8');
const backendChallenges = readFileSync('backend/src/challenges.ts', 'utf8');
const rules = readFileSync('firestore.rules', 'utf8');
const config = readFileSync('src/config/backendRoadmap.ts', 'utf8');
check(backendIndex.includes('export const getCurrentSeason'), 'current season callable exported');
check(backendIndex.includes('export const getChallengeProgress'), 'challenge progress callable exported');
check(backendIndex.includes('export const claimChallengeReward'), 'claim callable exported');
check(!backendIndex.includes('submitChallengeProgress'), 'no client-fabricated progress callable');
check(backendChallenges.includes('marketplaceHistory'), 'progress derives from trusted marketplace history');
check(backendChallenges.includes('transaction.create(claimDocument'), 'claim marking is atomic create');
check(backendChallenges.includes('canonicalCash: cashAfter'), 'cash reward uses authoritative state');
check(backendChallenges.includes('seasonPointsBefore + seasonPointsReward'), 'season points isolated by season');
check(rules.includes('match /challengeClaims/{documentId}') && rules.includes('allow write: if false'), 'direct claim writes denied');
check(config.includes('EXPO_PUBLIC_ENABLE_SEASONS') && config.includes('EXPO_PUBLIC_ENABLE_CHALLENGES'), 'production flags fail closed');

console.log(`\nResult: ${passed} passed, 0 failed`);
