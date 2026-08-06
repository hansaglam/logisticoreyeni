/**
 * Daily Operation Support economy + idempotency regression tests.
 * Run: npx tsx scripts/daily-operation-support-economy-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  calculateDailyMandatoryOperatingCost,
  calculateDailyOperationSupportReward,
  DAILY_OPERATION_SUPPORT_REWARD_MULTIPLIER,
  estimateStarterPlayerMandatoryDailyCost,
  MIN_DAILY_OPERATION_SUPPORT_REWARD,
  roundUpToNearest,
} from '../src/domain/dailyOperationSupportReward';
import {
  applyAdRewardGrant,
  canGrantAdReward,
  createDefaultMonetizationState,
} from '../src/simulation/adRewardGrants';
import { operatingCostBalance } from '../src/config/balance';
import type { Player } from '../src/types/game';
import { getDailyOpsBonusCash } from '../src/config/monetization';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

import type { AdRewardGrantContext } from '../src/types/monetization';

function starterPlayer(): Pick<Player, 'drivers' | 'warehouses' | 'trucks'> {
  return {
    drivers: [{ id: 'd1', salaryPerDay: 120, dailySalary: 120 } as Player['drivers'][number]],
    trucks: [{ id: 't1', ownershipType: 'owned' } as Player['trucks'][number]],
    warehouses: [
      {
        id: 'w1',
        cityId: 'izmir',
        capacityTons: 100,
        dailyOperatingCost: operatingCostBalance.fallbackWarehouseDailyCost,
      } as Player['warehouses'][number],
    ],
  };
}

function baseContext(
  overrides: Partial<AdRewardGrantContext> = {},
): AdRewardGrantContext {
  return {
    currentGameTime: 100,
    playerLevel: 1,
    hasCompletedOnboarding: true,
    playerFleet: starterPlayer(),
    ...overrides,
  };
}

console.log('\n=== Daily Operation Support Economy ===\n');

console.log('Mandatory cost + reward formula');
{
  const player = starterPlayer();
  const mandatory = calculateDailyMandatoryOperatingCost(player);
  const reward = calculateDailyOperationSupportReward(player);
  const expectedRaw = mandatory * DAILY_OPERATION_SUPPORT_REWARD_MULTIPLIER;
  const expectedRounded = Math.max(
    MIN_DAILY_OPERATION_SUPPORT_REWARD,
    roundUpToNearest(expectedRaw, 50),
  );

  assert(mandatory >= 400, 'starter mandatory daily cost is meaningful');
  assert(reward >= mandatory, 'reward covers at least one day mandatory cost');
  assert(reward <= mandatory * 1.5, 'reward stays within ~1.25× band (+ rounding)');
  assert(reward === expectedRounded, 'reward uses canonical rounding + minimum');
  assert(reward % 50 === 0, 'reward rounds to $50 increments');
  assert(reward >= MIN_DAILY_OPERATION_SUPPORT_REWARD, 'minimum reward floor applies');
  assert(estimateStarterPlayerMandatoryDailyCost() === mandatory, 'starter estimate matches player');
}

console.log('\nCanonical single source');
{
  const player = starterPlayer();
  const reward = calculateDailyOperationSupportReward(player);
  assert(getDailyOpsBonusCash(player) === reward, 'getDailyOpsBonusCash delegates to canonical helper');

  const grant = applyAdRewardGrant(
    createDefaultMonetizationState(),
    'daily_ops_bonus',
    baseContext(),
  );
  const cashEffect = grant.effects.find((effect) => effect.type === 'cash');
  assert(cashEffect?.type === 'cash' && cashEffect.amount === reward, 'grant uses same reward as UI');
}

console.log('\nClaim rules');
{
  const first = applyAdRewardGrant(
    createDefaultMonetizationState(),
    'daily_ops_bonus',
    baseContext(),
  );
  const blocked = canGrantAdReward(first.monetization, 'daily_ops_bonus', baseContext());
  assert(blocked.ok === false, 'daily limit blocks second claim same day');

  const hero = readFileSync('src/components/monetization/DashboardDailyOpsBonusCard.tsx', 'utf8');
  assert(hero.includes('calculateDailyOperationSupportReward'), 'dashboard card uses canonical reward');
  assert(hero.includes('applyAdReward'), 'reward only via applyAdReward after ad');
  assert(hero.includes('Ödülü Al'), 'ready CTA uses Ödülü Al');
  assert(hero.includes('Hazırlanıyor'), 'loading CTA copy');
  assert(hero.includes('Tekrar Dene'), 'retry only on failure path');

  const gameStore = readFileSync('src/store/gameStore.ts', 'utf8');
  assert(gameStore.includes("category: 'ad_reward_daily_ops'"), 'finance history uses ad_reward_daily_ops');
  assert(gameStore.includes('Günlük Operasyon Desteği'), 'finance history title is readable');
  assert(gameStore.includes('showRewardedAd(slotId)'), 'ad must complete before grant');
  assert(gameStore.includes('transactionId'), 'cash grant uses idempotency transactionId');
}

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
