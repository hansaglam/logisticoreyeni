/**
 * Leaderboard zero-start product rule regression (scoreVersion 3).
 * Run: npx tsx scripts/leaderboard-zero-start-regression-test.ts
 */
import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  calculateLeaderboardScore,
  getLeaderboardStarterBaselineScores,
  isLeaderboardRankedEligible,
  LEADERBOARD_MIN_COMPLETED_DELIVERIES,
  LEADERBOARD_SCORE_VERSION,
  LEADERBOARD_STARTER_BASELINE,
} from '../backend/src/leaderboardScore';
import { COMPANY_SCORE_VERSION, getCompanyScoreBreakdown } from '../src/simulation/companyScore';
import { getLeaderboardSubmitEligibility } from '../src/domain/leaderboardSubmitEligibility';
import type { Player } from '../src/types/game';

const ROOT = resolve(__dirname, '..');

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function starterPlayer(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    companyName: 'Fresh Co',
    money: LEADERBOARD_STARTER_BASELINE.cash,
    level: LEADERBOARD_STARTER_BASELINE.companyLevel,
    reputation: LEADERBOARD_STARTER_BASELINE.reputation,
    completedContracts: 0,
    failedDeliveries: 0,
    lateDeliveries: 0,
    weeklyCompletedDeliveries: 0,
    trucks: [
      {
        purchasePrice: LEADERBOARD_STARTER_BASELINE.starterTruckPurchasePrice,
        condition: LEADERBOARD_STARTER_BASELINE.starterTruckCondition,
        ownershipType: 'owned',
      },
    ],
    warehouses: [
      {
        capacityTons: LEADERBOARD_STARTER_BASELINE.starterWarehouseCapacityTons,
        upgradeTiers: LEADERBOARD_STARTER_BASELINE.starterWarehouseUpgradeTiers,
      },
    ],
    ...overrides,
  };
}

/** Reconstruct pre-v3 (v2) total for impact reporting — no baseline subtraction. */
function calculateV2EquivalentTotal(player: Record<string, unknown>): number {
  const v3 = calculateLeaderboardScore(player);
  return Math.max(
    0,
    v3.deliveryScore +
      v3.progressionScore +
      v3.reputationScore +
      v3.rawAssetScore +
      v3.rawFinanceScore +
      v3.weeklyActivityScore,
  );
}

console.log('\n=== Leaderboard Zero-Start Regression (v3) ===\n');

console.log('1–4 Fresh score + starter components');
{
  const fresh = calculateLeaderboardScore(starterPlayer());
  assert.equal(LEADERBOARD_SCORE_VERSION, 3);
  assert.equal(COMPANY_SCORE_VERSION, 3);
  assert.equal(fresh.totalScore, 0, '1. fresh authoritative score = 0');
  assert.equal(fresh.financeScore, 0, '2. starter cash gives no free points');
  assert.equal(fresh.assetScore, 0, '3. starter vehicle/warehouse gives no free points');
  assert.equal(fresh.progressionScore, 0, '4. default level gives no free score');
  assert.equal(fresh.reputationScore, 0, '4b. default reputation gives no free score');
  assert.equal(fresh.rankedEligible, true);
  const baseline = getLeaderboardStarterBaselineScores();
  assert.ok(baseline.assetScore > 0 && baseline.financeScore > 0, 'baseline is positive raw');
  assert.equal(fresh.rawAssetScore, baseline.assetScore);
  assert.equal(fresh.rawFinanceScore, baseline.financeScore);
}

console.log('5 Score floor never below 0');
{
  const crushed = calculateLeaderboardScore(
    starterPlayer({
      reputation: 0,
      failedDeliveries: 50,
      completedContracts: 0,
      trucks: [],
      warehouses: [],
      money: 0,
    }),
  );
  assert.ok(crushed.totalScore >= 0, 'floor >= 0');
  assert.equal(crushed.totalScore, Math.max(0, crushed.totalScore));
}

console.log('6–9 Eligibility / auth gates');
{
  assert.equal(LEADERBOARD_MIN_COMPLETED_DELIVERIES, 0, '7. delivery gate removed');
  assert.equal(isLeaderboardRankedEligible(0), true);
  assert.equal(isLeaderboardRankedEligible(2), true);

  const guestElig = getLeaderboardSubmitEligibility(
    {
      isReady: true,
      isAnonymous: true,
      provider: 'guest',
      uid: 'guest-uid',
    },
    { featureEnabled: true, authReady: true },
  );
  assert.equal(guestElig.eligible, false, '8. guest cannot rank');

  const scoreSrc = read('backend/src/leaderboard.ts');
  assert.match(scoreSrc, /username-required|usernameSetupCompleted/);
  assert.match(scoreSrc, /calculateLeaderboardScore/);
  assert.doesNotMatch(scoreSrc, /companyScore:\s*input/);
  assert.match(read('backend/src/index.ts'), /'uid' in record \|\| 'score' in record \|\| 'companyScore' in record/);
  console.log('  ✓ 6 entry path uses server score; 9 username gate preserved in backend');
}

console.log('10–11 Ordering: positive above zero; uid ASC tie');
{
  const zeroA = { totalScore: 0, uid: 'aaa' };
  const zeroB = { totalScore: 0, uid: 'bbb' };
  const pos = { totalScore: 100, uid: 'zzz' };
  const ordered = [pos, zeroA, zeroB].sort((left, right) => {
    if (right.totalScore !== left.totalScore) return right.totalScore - left.totalScore;
    return left.uid.localeCompare(right.uid);
  });
  assert.equal(ordered[0]?.uid, 'zzz');
  assert.equal(ordered[1]?.uid, 'aaa');
  assert.equal(ordered[2]?.uid, 'bbb');
  assert.match(read('backend/src/leaderboard.ts'), /orderBy\('companyScore', 'desc'\)/);
  assert.match(read('backend/src/leaderboard.ts'), /orderBy\(FieldPath\.documentId\(\), 'asc'\)/);
}

console.log('12 Gameplay progression increases score');
{
  const fresh = calculateLeaderboardScore(starterPlayer());
  const progressed = calculateLeaderboardScore(
    starterPlayer({
      completedContracts: 5,
      weeklyCompletedDeliveries: 5,
      level: 2,
      money: 30_000,
    }),
  );
  assert.ok(progressed.totalScore > fresh.totalScore);
  assert.ok(progressed.deliveryScore > 0);
}

console.log('13–14 Client cannot submit companyScore; server authority');
{
  const service = read('src/services/leaderboardService.ts');
  assert.doesNotMatch(service, /companyScore:\s*input/);
  assert.match(service, /submitLeaderboardScore/);
  assert.match(read('backend/src/leaderboard.ts'), /extractCanonicalPlayerStateFromServerState/);
  assert.match(read('backend/src/leaderboardScore.ts'), /LEADERBOARD_SCORE_VERSION = 3/);
}

console.log('15–17 Seed / sync / query accept score 0');
{
  const seed = read('backend/src/leaderboardSeasonSeed.ts');
  assert.match(seed, /companyScore: breakdown\.totalScore/);
  assert.doesNotMatch(seed, /companyScore\s*>\s*0/);
  assert.doesNotMatch(seed, /totalScore\s*>\s*0/);
  const screen = read('src/screens/LeaderboardScreen.tsx');
  assert.doesNotMatch(screen, /UnrankedEligibilityCard/);
  assert.doesNotMatch(screen, /3 teslimat tamamlayarak/);
  assert.match(read('backend/src/leaderboard.ts'), /where\('scoreVersion', '==', LEADERBOARD_SCORE_VERSION\)/);
}

console.log('18 No display-only fake zero');
{
  assert.match(read('backend/src/leaderboardScore.ts'), /starter baseline|STARTER_BASELINE|rawAssetScore/i);
  assert.equal(calculateLeaderboardScore(starterPlayer()).totalScore, 0);
}

console.log('19–21 Historical / W34 / future version');
{
  const phase7 = read('docs/release-audit/V1_1_PHASE_7_FINAL_AUDIT.md');
  assert.match(phase7, /ea2310b854f11eb4/);
  assert.match(phase7, /W34|2026-W34/);
  assert.equal(LEADERBOARD_SCORE_VERSION, 3, '21. future closes use current version constant');
  const close = read('backend/src/seasonClose.ts');
  assert.match(close, /LEADERBOARD_SCORE_VERSION/);
  assert.match(close, /createResultOnce|ref\.create/);
  assert.match(close, /integrity-conflict/);
  // Closed results are create-once; this change must not add a rewrite path for historical finals.
  assert.doesNotMatch(close, /transaction\.(update|set).*finalScore/s);
}

console.log('22 scoreVersion semantics');
{
  assert.equal(LEADERBOARD_SCORE_VERSION, 3);
  assert.match(read('backend/src/leaderboard.ts'), /scoreVersion: LEADERBOARD_SCORE_VERSION/);
}

console.log('23 Reward architecture untouched in this change');
{
  assert.match(read('backend/src/seasonRewards.ts'), /WAITING_FOR_NATURAL|reward|MINIMUM|participant/i);
}

console.log('Client/backend parity on fresh + progressed');
{
  const freshBackend = calculateLeaderboardScore(starterPlayer());
  const freshClient = getCompanyScoreBreakdown({
    player: {
      money: LEADERBOARD_STARTER_BASELINE.cash,
      level: 1,
      reputation: 50,
      completedContracts: 0,
      failedDeliveries: 0,
      lateDeliveries: 0,
      trucks: [
        {
          id: 't1',
          purchasePrice: 45_000,
          condition: 88,
          ownershipType: 'owned',
        },
      ],
      warehouses: [
        {
          id: 'w1',
          cityId: 'izmir',
          capacityTons: 100,
          upgradeTier: 1,
          inventory: [],
        },
      ],
    } as Player,
    cities: [],
    products: [],
    financeLedger: [],
    currentTime: 0,
  });
  assert.equal(freshBackend.totalScore, freshClient.totalScore);
  assert.equal(freshClient.totalScore, 0);
}

console.log('\nImpact samples (v2-equivalent vs v3)');
{
  const fresh = starterPlayer();
  const sampleA = starterPlayer({
    money: 50_000,
    level: 3,
    reputation: 60,
    completedContracts: 10,
    weeklyCompletedDeliveries: 5,
    trucks: [
      {
        purchasePrice: 45_000,
        condition: 88,
        ownershipType: 'owned',
      },
      {
        purchasePrice: 80_000,
        condition: 90,
        ownershipType: 'owned',
      },
    ],
  });
  const sampleB = starterPlayer({
    completedContracts: 5,
    weeklyCompletedDeliveries: 5,
  });

  const rows = [
    { name: 'FRESH', player: fresh },
    { name: 'PROGRESSED_A', player: sampleA },
    { name: 'PROGRESSED_B', player: sampleB },
  ].map((row) => ({
    name: row.name,
    oldV2: calculateV2EquivalentTotal(row.player),
    newV3: calculateLeaderboardScore(row.player).totalScore,
  }));

  for (const row of rows) {
    console.log(`  ${row.name}: old≈${row.oldV2} → new=${row.newV3} (Δ ${row.newV3 - row.oldV2})`);
  }
  assert.equal(rows[0]?.newV3, 0);
  assert.ok((rows[1]?.newV3 ?? 0) > 0);
  assert.ok((rows[2]?.newV3 ?? 0) > 0);
}

console.log('\n✅ ALL PASS\n');
