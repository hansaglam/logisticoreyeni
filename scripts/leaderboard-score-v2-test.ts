/**
 * Leaderboard score v2 — formula audit, eligibility, and old vs new ranking.
 * Run: npx tsx scripts/leaderboard-score-v2-test.ts
 */
import './test-globals';

import assert from 'node:assert/strict';

import {
  calculateLeaderboardScore,
  isLeaderboardRankedEligible,
  LEADERBOARD_MIN_COMPLETED_DELIVERIES,
  LEADERBOARD_SCORE_VERSION,
  resolveWeeklySeasonActivity,
} from '../backend/src/leaderboardScore';
import { getCompanyScoreBreakdown } from '../src/simulation/companyScore';
import type { Player } from '../src/types/game';

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

type Profile = {
  id: string;
  label: string;
  level: number;
  reputation: number;
  completed: number;
  failed?: number;
  late?: number;
  cash: number;
  weekly?: number;
  trucks: Array<{
    purchasePrice: number;
    condition: number;
      ownershipType?: 'owned' | 'leased';
      status?: string;
      marketplaceListingId?: string | null;
    leaseExpired?: boolean;
  }>;
  warehouses: Array<{ capacityTons: number; upgradeTier: number; cityId?: string }>;
};

function v1WarehouseRaw(warehouses: Profile['warehouses']): number {
  const cities = new Set(warehouses.map((warehouse) => warehouse.cityId ?? warehouse.capacityTons));
  let capacityValue = 0;
  for (const warehouse of warehouses) {
    const tierBonus = 1 + (Math.max(1, warehouse.upgradeTier) - 1) * 0.15;
    capacityValue += warehouse.capacityTons * 120 * tierBonus;
  }
  return capacityValue + cities.size * 2_500;
}

function v1OwnedFleetValue(trucks: Profile['trucks']): number {
  return trucks.reduce((sum, truck) => {
    const ownership = truck.ownershipType ?? 'owned';
    if (ownership !== 'owned') return sum;
    return sum + truck.purchasePrice * (truck.condition / 100);
  }, 0);
}

function v1SoftCapCash(cash: number): number {
  const cap = 2_000_000;
  if (cash <= cap) return cash;
  return cap + Math.sqrt(cash - cap);
}

/** Exact v1 backend formula used when the 119,535 #1 bug was observed. */
function calculateV1Score(profile: Profile): number {
  const levelScore = profile.level * 5_000;
  const reputationScore = profile.reputation * 1_000;
  const deliveryScore = profile.completed * 1_500;
  const fleetScore = v1OwnedFleetValue(profile.trucks) * 0.85;
  const warehouseScore = v1WarehouseRaw(profile.warehouses) * 0.75;
  const financialScore = v1SoftCapCash(profile.cash);
  const penalty = (profile.failed ?? 0) * 5_000 + (profile.late ?? 0) * 2_000;
  return Math.round(
    levelScore + reputationScore + deliveryScore + fleetScore + warehouseScore + financialScore - penalty,
  );
}

function toBackendPlayer(profile: Profile): Record<string, unknown> {
  return {
    companyName: profile.label,
    money: profile.cash,
    level: profile.level,
    reputation: profile.reputation,
    completedContracts: profile.completed,
    failedDeliveries: profile.failed ?? 0,
    lateDeliveries: profile.late ?? 0,
    weeklyCompletedDeliveries: profile.weekly ?? 0,
    trucks: profile.trucks,
    warehouses: profile.warehouses.map((warehouse, index) => ({
      id: `${profile.id}-wh-${index}`,
      cityId: warehouse.cityId ?? 'izmir',
      capacityTons: warehouse.capacityTons,
      upgradeTier: warehouse.upgradeTier,
    })),
  };
}

function toClientPlayer(profile: Profile): Player {
  return {
    companyName: profile.label,
    money: profile.cash,
    companyLevel: profile.level,
    level: profile.level,
    xp: 0,
    xpToNextLevel: 100,
    totalXp: 0,
    homeCityId: 'izmir',
    reputation: profile.reputation,
    completedContracts: profile.completed,
    failedDeliveries: profile.failed ?? 0,
    lateDeliveries: profile.late ?? 0,
    trucks: profile.trucks.map((truck, index) => ({
      id: `${profile.id}-truck-${index}`,
      catalogId: 'truck-starter-1',
      name: 'Truck',
      type: 'truck',
      status: 'idle',
      condition: truck.condition,
      purchasePrice: truck.purchasePrice,
      ownershipType: truck.ownershipType ?? 'owned',
      status: (truck.status as Player['trucks'][number]['status']) ?? 'idle',
      leaseExpired: truck.leaseExpired,
      currentCityId: 'izmir',
      fuel: 100,
      maxFuel: 100,
    })) as Player['trucks'],
    drivers: [],
    warehouses: profile.warehouses.map((warehouse, index) => ({
      id: `${profile.id}-wh-${index}`,
      cityId: warehouse.cityId ?? 'izmir',
      capacityTons: warehouse.capacityTons,
      upgradeTier: warehouse.upgradeTier,
      inventory: [],
    })) as Player['warehouses'],
  };
}

function scoreV2(profile: Profile) {
  return calculateLeaderboardScore(toBackendPlayer(profile));
}

const starterTruck = { purchasePrice: 45_000, condition: 88, ownershipType: 'owned' as const };
const starterWarehouse = { capacityTons: 100, upgradeTier: 1, cityId: 'izmir' };

const profiles: Profile[] = [
  {
    id: 'A',
    label: 'Brand-new Internal Test',
    level: 1,
    reputation: 50,
    completed: 0,
    cash: 20_000,
    trucks: [starterTruck],
    warehouses: [starterWarehouse],
  },
  {
    id: 'B',
    label: 'Early active',
    level: 2,
    reputation: 80,
    completed: 2,
    cash: 22_000,
    weekly: 2,
    trucks: [starterTruck],
    warehouses: [starterWarehouse],
  },
  {
    id: 'C',
    label: 'Established low reputation',
    level: 6,
    reputation: 32,
    completed: 14,
    cash: 18_000,
    weekly: 6,
    trucks: [
      { purchasePrice: 120_000, condition: 90, ownershipType: 'owned' },
      { purchasePrice: 80_000, condition: 85, ownershipType: 'owned' },
    ],
    warehouses: [
      { capacityTons: 100, upgradeTier: 2, cityId: 'izmir' },
      { capacityTons: 80, upgradeTier: 1, cityId: 'istanbul' },
    ],
  },
  {
    id: 'D',
    label: 'Established high reputation',
    level: 6,
    reputation: 75,
    completed: 20,
    cash: 24_000,
    weekly: 8,
    trucks: [
      { purchasePrice: 120_000, condition: 90, ownershipType: 'owned' },
      { purchasePrice: 80_000, condition: 85, ownershipType: 'owned' },
    ],
    warehouses: [
      { capacityTons: 100, upgradeTier: 2, cityId: 'izmir' },
      { capacityTons: 80, upgradeTier: 1, cityId: 'istanbul' },
    ],
  },
  {
    id: 'E',
    label: 'Large company',
    level: 12,
    reputation: 55,
    completed: 50,
    cash: 90_000,
    weekly: 12,
    trucks: [
      { purchasePrice: 220_000, condition: 92, ownershipType: 'owned' },
      { purchasePrice: 180_000, condition: 88, ownershipType: 'owned' },
    ],
    warehouses: [{ capacityTons: 400, upgradeTier: 3, cityId: 'izmir' }],
  },
  {
    id: 'F',
    label: 'New account max reputation',
    level: 1,
    reputation: 100,
    completed: 0,
    cash: 20_000,
    trucks: [starterTruck],
    warehouses: [starterWarehouse],
  },
  {
    id: 'G',
    label: 'Admin cash whale',
    level: 8,
    reputation: 50,
    completed: 0,
    cash: 5_000_000,
    trucks: [starterTruck],
    warehouses: [starterWarehouse],
  },
  {
    id: 'H',
    label: 'Rented fleet only',
    level: 4,
    reputation: 50,
    completed: 8,
    cash: 30_000,
    weekly: 4,
    trucks: [{ purchasePrice: 300_000, condition: 100, ownershipType: 'leased' }],
    warehouses: [starterWarehouse],
  },
  {
    id: 'I',
    label: 'Marketplace-listed truck',
    level: 5,
    reputation: 50,
    completed: 10,
    cash: 40_000,
    weekly: 3,
    trucks: [
      {
        purchasePrice: 200_000,
        condition: 100,
        ownershipType: 'owned',
        status: 'marketplace_locked',
        marketplaceListingId: 'listing-1',
      },
    ],
    warehouses: [starterWarehouse],
  },
  {
    id: 'J',
    label: 'Low reputation many deliveries',
    level: 10,
    reputation: 20,
    completed: 30,
    failed: 2,
    late: 3,
    cash: 35_000,
    weekly: 9,
    trucks: [{ purchasePrice: 150_000, condition: 80, ownershipType: 'owned' }],
    warehouses: [{ capacityTons: 200, upgradeTier: 2, cityId: 'izmir' }],
  },
];

console.log('\n=== Leaderboard Score V2 ===\n');

console.log('Audit: why 0-delivery ranked #1 under v1');
{
  const fresh = profiles[0]!;
  const v1 = calculateV1Score(fresh);
  check(v1 === 119_535, `v1 starter score is 119,535 (got ${v1})`);
  const v2 = scoreV2(fresh);
  check(v2.rankedEligible === false, 'v2 starter is not ranked eligible');
  check(v2.reputationScore === 0, 'v2 reputation 50 contributes 0');
  check(v2.progressionScore === 0, 'v2 level 1 contributes 0 progression');
  check(v2.deliveryScore === 0, 'v2 0 deliveries contribute 0');
  check(v2.totalScore < 15_000, `v2 starter total is modest (got ${v2.totalScore})`);
}

console.log('\nEligibility');
{
  check(LEADERBOARD_MIN_COMPLETED_DELIVERIES === 3, 'min completed deliveries is 3');
  check(LEADERBOARD_SCORE_VERSION === 2, 'score version is 2');
  check(isLeaderboardRankedEligible(0) === false, '0 deliveries ineligible');
  check(isLeaderboardRankedEligible(2) === false, '2 deliveries ineligible');
  check(isLeaderboardRankedEligible(3) === true, '3 deliveries eligible');
}

console.log('\nWeekly season activity');
{
  const rollover = resolveWeeklySeasonActivity(
    {
      completedDeliveries: 14,
      leaderboardSeasonKey: '2026-W32',
      weeklySeasonBaselineCompleted: 4,
    },
    '2026-W33',
  );
  check(rollover.weeklyCompletedDeliveries === 0, 'new ISO week starts weekly activity at 0');
  check(rollover.weeklySeasonBaselineCompleted === 14, 'new week baselines current completed count');
  const midWeek = resolveWeeklySeasonActivity(
    {
      completedDeliveries: 20,
      leaderboardSeasonKey: '2026-W33',
      weeklySeasonBaselineCompleted: 14,
    },
    '2026-W33',
  );
  check(midWeek.weeklyCompletedDeliveries === 6, 'same week weekly = completed - baseline');
}

console.log('\nRequired ranking order (v2)');
{
  const a = scoreV2(profiles[0]!);
  const b = scoreV2(profiles[1]!);
  const c = scoreV2(profiles[2]!);
  const d = scoreV2(profiles[3]!);
  const e = scoreV2(profiles[4]!);
  check(a.rankedEligible === false, 'Player A unranked');
  check(b.rankedEligible === false, 'Player B still unranked at 2 deliveries');
  check(c.rankedEligible === true, 'Player C ranked');
  check(c.totalScore > a.totalScore, `C (${c.totalScore}) above A (${a.totalScore})`);
  check(d.totalScore > c.totalScore, `D (${d.totalScore}) above C (${c.totalScore})`);
  check(e.totalScore > d.totalScore, `E (${e.totalScore}) above D (${d.totalScore})`);
}

console.log('\nExploit guards');
{
  const a = scoreV2(profiles[0]!);
  const f = scoreV2(profiles[5]!);
  const g = scoreV2(profiles[6]!);
  const h = scoreV2(profiles[7]!);
  const i = scoreV2(profiles[8]!);
  const j = scoreV2(profiles[9]!);
  const c = scoreV2(profiles[2]!);
  check(f.rankedEligible === false, 'max default reputation still unranked without deliveries');
  check(f.totalScore < c.totalScore, 'max reputation new account below established Player C');
  check(g.financeScore <= 8_000, `admin 5M cash finance capped (got ${g.financeScore})`);
  check(g.rankedEligible === false, 'cash whale with 0 deliveries is unranked');
  check(g.totalScore < c.totalScore, 'admin cash does not beat 14-delivery company');
  check(h.assetScore < 4_000, `leased fleet is not full asset value (got ${h.assetScore})`);
  check(i.assetScore < 4_000, `listed truck is not counted as owned asset (got ${i.assetScore})`);
  check(j.totalScore > a.totalScore, 'low reputation with 30 deliveries still outranks new account');
  check(j.reputationScore < 0, 'reputation 20 is a penalty, not a huge base');
}

console.log('\nClient / backend parity');
{
  for (const profile of profiles) {
    const backend = scoreV2(profile);
    const client = getCompanyScoreBreakdown({
      player: toClientPlayer(profile),
      cities: [],
      products: [],
      financeLedger: [],
      currentTime: 0,
      weeklyCompletedDeliveries: profile.weekly ?? 0,
    });
    check(
      backend.totalScore === client.totalScore,
      `${profile.id} total ${backend.totalScore} == client ${client.totalScore}`,
    );
    check(
      backend.rankedEligible === client.rankedEligible,
      `${profile.id} eligibility matches`,
    );
  }
}

const comparison = profiles.map((profile) => {
  const oldScore = calculateV1Score(profile);
  const next = scoreV2(profile);
  return {
    player: profile.id,
    label: profile.label,
    level: profile.level,
    reputation: profile.reputation,
    deliveries: profile.completed,
    assets: Math.round(v1OwnedFleetValue(profile.trucks) + profile.warehouses.reduce((sum, warehouse) => sum + warehouse.capacityTons * 80, 0)),
    cash: profile.cash,
    oldScore,
    newScore: next.totalScore,
    rankedEligible: next.rankedEligible,
    deliveryScore: next.deliveryScore,
    progressionScore: next.progressionScore,
    reputationScore: next.reputationScore,
    assetScore: next.assetScore,
    financeScore: next.financeScore,
    weeklyActivityScore: next.weeklyActivityScore,
  };
});

const oldRanked = [...comparison].sort((left, right) => right.oldScore - left.oldScore);
const newRanked = [...comparison]
  .filter((row) => row.rankedEligible)
  .sort((left, right) => right.newScore - left.newScore);

console.log('\nOld vs new comparison');
console.log(
  [
    'Player',
    'Lvl',
    'Rep',
    'Del',
    'Old',
    'New',
    'OldRank',
    'NewRank',
    'Eligible',
  ].join('\t'),
);
for (const row of comparison) {
  const oldRank = oldRanked.findIndex((item) => item.player === row.player) + 1;
  const newRankIndex = newRanked.findIndex((item) => item.player === row.player);
  const newRank = newRankIndex >= 0 ? String(newRankIndex + 1) : 'unranked';
  console.log(
    [
      row.player,
      row.level,
      row.reputation,
      row.deliveries,
      row.oldScore,
      row.newScore,
      oldRank,
      newRank,
      row.rankedEligible,
    ].join('\t'),
  );
}

check(oldRanked[0]?.player === 'A' || oldRanked[0]?.player === 'F' || oldRanked[0]?.player === 'G', 'v1 lets a no-delivery or cash profile sit at or near #1');
check(newRanked[0]?.player === 'E', `v2 #1 is large active company E (got ${newRanked[0]?.player})`);
check(newRanked.some((row) => row.player === 'C'), 'Player C is ranked in v2');
check(!newRanked.some((row) => row.player === 'A'), 'Player A is not in v2 ranked list');

if (fail > 0) {
  console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
  process.exit(1);
}

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
console.log('COMPARISON_JSON', JSON.stringify({ comparison, oldRanked: oldRanked.map((row) => row.player), newRanked: newRanked.map((row) => row.player) }));
