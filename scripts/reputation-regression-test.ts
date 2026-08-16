/**
 * Reputation system regression tests.
 * Run: npx tsx scripts/reputation-regression-test.ts
 */
import './test-globals';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  INITIAL_REPUTATION,
  REPUTATION_HISTORY_MAX,
  REPUTATION_MAX,
  REPUTATION_MIN,
  REPUTATION_RULES,
} from '../src/config/reputationRules';
import {
  clampReputation,
  resolveReputationTier,
  selectReputationSummary,
} from '../src/domain/reputationModel';
import { getCompanyScoreBreakdown } from '../src/simulation/companyScore';
import {
  applyReputationChange,
  hasReputationIdempotencyKey,
  mergeReputationIntoStore,
  normalizeReputationHistory,
} from '../src/simulation/reputationService';
import {
  buildDeliverySettlementIdempotencyKey,
  calculateDeliveryReputationResult,
  classifyDeliveryPunctuality,
  deliveryFailureReasonToReputationDelta,
} from '../src/simulation/reputationSettlement';
import type { Contract, Delivery, Player } from '../src/types/game';

let pass = 0;
let fail = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}`);
  }
}

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'contract-1',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'steel',
    amount: 10,
    payment: 5000,
    deadlineHours: 20,
    distanceKm: 300,
    contractType: 'standard',
    ...overrides,
  } as Contract;
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery-1',
    contractId: 'contract-1',
    truckId: 'truck-1',
    driverId: 'driver-1',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'steel',
    amount: 10,
    distanceKm: 300,
    progress: 1,
    status: 'on_route',
    startedAt: 0,
    travelHours: 18,
    ...overrides,
  } as Delivery;
}

function makePlayer(reputation = 61): Player {
  return {
    companyName: 'Test Co',
    money: 10000,
    companyLevel: 3,
    level: 3,
    xp: 0,
    xpToNextLevel: 100,
    totalXp: 0,
    homeCityId: 'izmir',
    reputation,
    completedContracts: 5,
    trucks: [],
    drivers: [],
    warehouses: [],
  };
}

console.log('\n=== Reputation Regression ===\n');

console.log('Bounds');
{
  check(clampReputation(-5) === REPUTATION_MIN, 'does not drop below 0');
  check(clampReputation(150) === REPUTATION_MAX, 'does not exceed 100');
  check(clampReputation(61) === 61, 'preserves in-range value');
}

console.log('\nDelivery settlement');
{
  const onTime = calculateDeliveryReputationResult({
    contract: makeContract({ deadlineHours: 20 }),
    delivery: makeDelivery({ travelHours: 18, startedAt: 0 }),
    actualTravelHours: 18,
  });
  check(onTime.delta === REPUTATION_RULES.deliveryOnTime, 'on-time delta');

  const early = calculateDeliveryReputationResult({
    contract: makeContract({ deadlineHours: 20 }),
    delivery: makeDelivery({ travelHours: 18 }),
    actualTravelHours: 14,
  });
  check(early.delta === REPUTATION_RULES.deliveryEarly, 'early delta higher than on-time');
  check(early.delta > onTime.delta, 'early beats on-time');

  const lateMinor = calculateDeliveryReputationResult({
    contract: makeContract({ deadlineHours: 20 }),
    delivery: makeDelivery({ travelHours: 18 }),
    actualTravelHours: 21,
  });
  check(lateMinor.delta === REPUTATION_RULES.deliveryLateMinor, 'late minor penalty');

  const lateMajor = calculateDeliveryReputationResult({
    contract: makeContract({ deadlineHours: 20 }),
    delivery: makeDelivery({ travelHours: 18 }),
    actualTravelHours: 26,
  });
  check(lateMajor.delta === REPUTATION_RULES.deliveryLateMajor, 'late major penalty');
  check(lateMajor.delta < lateMinor.delta, 'major penalty worse than minor');
}

console.log('\nFailure + cancellation');
{
  const cancelled = deliveryFailureReasonToReputationDelta('cancelled');
  check(cancelled.delta === REPUTATION_RULES.contractCancelled, 'contract cancelled penalty');

  const failed = deliveryFailureReasonToReputationDelta('breakdown');
  check(failed.delta === REPUTATION_RULES.deliveryFailed, 'delivery failed penalty');
}

console.log('\nIdempotency');
{
  const player = makePlayer(50);
  const key = buildDeliverySettlementIdempotencyKey('delivery-1');
  const first = applyReputationChange(player, [], {
    source: 'delivery-settlement',
    delta: 2,
    reason: 'delivery-on-time',
    idempotencyKey: key,
    createdAt: 10,
  });
  const second = applyReputationChange(first.player, first.reputationHistory, {
    source: 'delivery-settlement',
    delta: 2,
    reason: 'delivery-on-time',
    idempotencyKey: key,
    createdAt: 11,
  });
  check(first.applied, 'first change applies');
  check(!second.applied, 'duplicate settlement blocked');
  check(second.player.reputation === first.player.reputation, 'score unchanged on duplicate');
  check(hasReputationIdempotencyKey(first.reputationHistory, key), 'history stores idempotency key');
}

console.log('\nHistory + save');
{
  const entries = Array.from({ length: 25 }, (_, index) => ({
    id: `entry-${index}`,
    delta: 1,
    reason: 'test',
    source: 'delivery-settlement' as const,
    createdAt: index,
  }));
  check(normalizeReputationHistory(entries).length <= REPUTATION_HISTORY_MAX, 'history capped');
}

console.log('\nTier labels');
{
  check(resolveReputationTier(61) === 'respected', '61 is respected');
  check(resolveReputationTier(15) === 'critical', '15 is critical');
  check(resolveReputationTier(85) === 'elite', '85 is elite');
  const summary = selectReputationSummary({
    player: makePlayer(61),
    reputationHistory: [{ id: 'a', delta: 2, reason: 'test', source: 'delivery-settlement', createdAt: 1 }],
  });
  check(summary.tierLabel === 'Saygın', 'dashboard tier label');
  check(summary.score === 61, 'dashboard summary score');
  check(summary.recentChange === 2, 'recent change from history');
}

console.log('\nCompany score integration');
{
  const breakdown = getCompanyScoreBreakdown({
    player: makePlayer(61),
    cities: [],
    products: [],
    financeLedger: [],
    currentTime: 0,
  });
  check(breakdown.reputationScore === 1_584, 'reputation 61 is a modest quality bonus vs 50 baseline');
}

console.log('\nLegacy preservation');
{
  const legacy = mergeReputationIntoStore(
    { player: makePlayer(73), reputationHistory: [] },
    {
      source: 'migration',
      delta: 0,
      reason: 'legacy-migration',
      idempotencyKey: 'reputation:legacy:test',
      createdAt: 0,
    },
  );
  check(legacy.player.reputation === 73, 'legacy reputation value preserved');
}

console.log('\nUI wiring');
{
  const hero = readFileSync('src/components/dashboard/DashboardHeroCard.tsx', 'utf8');
  const dashboard = readFileSync('src/screens/DashboardScreen.tsx', 'utf8');
  const sheet = readFileSync('src/components/dashboard/ReputationDetailSheet.tsx', 'utf8');
  check(hero.includes('reputationSummary'), 'hero uses reputation summary');
  check(hero.includes('onReputationPress'), 'hero reputation tile pressable');
  check(dashboard.includes('selectReputationSummary'), 'dashboard uses canonical selector');
  check(sheet.includes('REPUTATION_INCREASE_BEHAVIORS'), 'detail sheet uses config behaviors');
  check(!hero.includes('Gizlilik'), 'hero not confused with privacy copy');
}

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
if (fail > 0) {
  process.exit(1);
}
