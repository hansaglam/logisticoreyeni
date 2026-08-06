/**
 * Monetization M0–M3 smoke test — SDK olmadan grant/limit/save akışı.
 * Run: npx tsx scripts/monetization-smoke-test.ts
 */

import './test-globals';

import { getDailyOpsBonusCash } from '../src/config/monetization';
import {
  applyAdRewardGrant,
  calculateDiscountedRepairCost,
  canGrantAdReward,
  consumeMaintenanceDiscountToken,
  createDefaultMonetizationState,
  getActiveMaintenanceDiscountToken,
  getActiveMarketAnalysisUnlock,
  getTodayResetKey,
  normalizeMonetizationState,
  resetDailyUsageIfNeeded,
} from '../src/simulation/adRewardGrants';
import { MONETIZATION_GLOBAL_DAILY_AD_CAP } from '../src/config/monetization';
import { normalizeSavePayload } from '../src/storage/saveGame';
import type { AdRewardGrantContext } from '../src/types/monetization';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function baseContext(overrides: Partial<AdRewardGrantContext> = {}): AdRewardGrantContext {
  return {
    currentGameTime: 100,
    playerLevel: 5,
    hasCompletedOnboarding: true,
    ...overrides,
  };
}

console.log('\nMonetization smoke tests (M0–M3)\n');

console.log('State bootstrap');
{
  const state = createDefaultMonetizationState();
  assert(state.monetizationVersion === 1, 'default monetizationVersion is 1');
  assert(state.dailyResetKey === getTodayResetKey(), 'default dailyResetKey is today');
  assert(state.totalRewardedAdsToday === 0, 'default totalRewardedAdsToday is 0');
  assert(state.premiumAdFree === false, 'default premiumAdFree is false');
}

console.log('\nDaily reset');
{
  const state = createDefaultMonetizationState();
  state.adRewardUsage = { daily_ops_bonus: { count: 1 } };
  state.totalRewardedAdsToday = 3;
  const reset = resetDailyUsageIfNeeded({
    ...state,
    dailyResetKey: '2000-01-01',
  });
  assert(reset.dailyResetKey === getTodayResetKey(), 'daily reset key updates');
  assert(reset.totalRewardedAdsToday === 0, 'daily reset clears totalRewardedAdsToday');
  assert(reset.adRewardUsage.daily_ops_bonus == null, 'daily reset clears slot usage');
}

console.log('\nGlobal cap');
{
  let state = createDefaultMonetizationState();
  const ctx = baseContext();
  state = applyAdRewardGrant(state, 'daily_ops_bonus', ctx).monetization;
  state = applyAdRewardGrant(state, 'contract_refresh', ctx).monetization;
  state = applyAdRewardGrant(state, 'contract_refresh', ctx).monetization;
  state = applyAdRewardGrant(
    state,
    'market_analysis',
    baseContext({ selectedProductId: 'electronics' }),
  ).monetization;
  state = applyAdRewardGrant(
    state,
    'market_analysis',
    baseContext({ selectedProductId: 'steel' }),
  ).monetization;
  assert(
    state.totalRewardedAdsToday === MONETIZATION_GLOBAL_DAILY_AD_CAP,
    'global cap reached',
    `count=${state.totalRewardedAdsToday}`,
  );
  const blocked = canGrantAdReward(state, 'daily_ops_bonus', ctx);
  assert(!blocked.ok, 'global cap blocks further grants');
}

console.log('\ndaily_ops_bonus cash grant');
{
  const player = {
    drivers: [{ id: 'd1', salaryPerDay: 120, dailySalary: 120 } as import('../src/types/game').Driver],
    warehouses: [{ id: 'w1', cityId: 'izmir', dailyOperatingCost: 250 } as import('../src/types/game').Warehouse],
    trucks: [{ id: 't1', ownershipType: 'owned' as const }],
  };
  const ctx = baseContext({ playerLevel: 1, playerFleet: player });
  const grant = applyAdRewardGrant(createDefaultMonetizationState(), 'daily_ops_bonus', ctx);
  const cashEffect = grant.effects[0];
  const cashAmount = cashEffect?.type === 'cash' ? cashEffect.amount : 0;
  assert(cashEffect?.type === 'cash', 'daily_ops_bonus grants cash');
  assert(cashAmount >= 500, 'reward respects economy minimum');
  assert(getDailyOpsBonusCash(player) === cashAmount, 'UI helper matches grant');
  const blocked = canGrantAdReward(grant.monetization, 'daily_ops_bonus', ctx);
  assert(!blocked.ok, 'daily_ops_bonus günde 1 kez');
}

console.log('\nOnboarding gate');
{
  const blocked = canGrantAdReward(createDefaultMonetizationState(), 'daily_ops_bonus', baseContext({
    hasCompletedOnboarding: false,
  }));
  assert(!blocked.ok, 'onboarding incomplete disables rewards');
}

console.log('\nLow level restriction');
{
  const blocked = canGrantAdReward(
    createDefaultMonetizationState(),
    'contract_refresh',
    baseContext({ playerLevel: 2 }),
  );
  assert(!blocked.ok, 'level <= 2 blocks contract_refresh');
  const allowed = canGrantAdReward(
    createDefaultMonetizationState(),
    'market_analysis',
    baseContext({ playerLevel: 2, selectedProductId: 'electronics' }),
  );
  assert(allowed.ok, 'level <= 2 allows market_analysis');
}

console.log('\nmarket_analysis unlock');
{
  const grant = applyAdRewardGrant(
    createDefaultMonetizationState(),
    'market_analysis',
    baseContext({ selectedProductId: 'electronics' }),
  );
  const unlock = grant.effects.find((effect) => effect.type === 'market_analysis_unlock');
  assert(unlock?.type === 'market_analysis_unlock', 'market_analysis unlock effect created');
  assert(
    getActiveMarketAnalysisUnlock(grant.monetization, 'electronics', 100) != null,
    'unlock active at grant time',
  );
  assert(
    getActiveMarketAnalysisUnlock(grant.monetization, 'electronics', 123) != null,
    'unlock active before expiry',
  );
  assert(
    getActiveMarketAnalysisUnlock(grant.monetization, 'electronics', 125) == null,
    'unlock expiry works at 24 game hours',
  );
  const blocked = canGrantAdReward(
    grant.monetization,
    'market_analysis',
    baseContext({ selectedProductId: 'electronics' }),
  );
  assert(!blocked.ok, 'same product blocked twice same day');
  const otherProduct = canGrantAdReward(
    grant.monetization,
    'market_analysis',
    baseContext({ selectedProductId: 'steel' }),
  );
  assert(otherProduct.ok, 'different product still allowed');
}

console.log('\ndelivery_boost slot eligibility');
{
  const activeCtx = baseContext({ selectedDeliveryId: 'delivery-active' });
  const allowed = canGrantAdReward(createDefaultMonetizationState(), 'delivery_boost', activeCtx);
  assert(allowed.ok, 'delivery_boost slot allows with selectedDeliveryId');

  const missingId = canGrantAdReward(
    createDefaultMonetizationState(),
    'delivery_boost',
    baseContext({ selectedDeliveryId: '' }),
  );
  assert(!missingId.ok, 'selectedDeliveryId missing disables delivery_boost slot');
}

console.log('\ndelivery_boost grant tracking');
{
  let state = createDefaultMonetizationState();
  state = applyAdRewardGrant(
    state,
    'delivery_boost',
    baseContext({ selectedDeliveryId: 'delivery-1' }),
  ).monetization;
  assert(state.lastDeliveryBoostAdAt != null, 'lastDeliveryBoostAdAt recorded');
  assert(
    state.adRewardUsage.delivery_boost?.count === 1,
    'delivery_boost slot usage incremented',
  );
  const second = canGrantAdReward(
    state,
    'delivery_boost',
    baseContext({ selectedDeliveryId: 'delivery-2' }),
  );
  assert(second.ok, 'second delivery still allowed at slot level (per-delivery limits separate)');
}

console.log('\nM1 contract_refresh regression');
{
  const grant = applyAdRewardGrant(createDefaultMonetizationState(), 'contract_refresh', baseContext());
  assert(
    grant.effects.some((effect) => effect.type === 'contract_refresh_bypass'),
    'contract_refresh returns bypass effect',
  );
  assert(!grant.effects.some((effect) => effect.type === 'cash'), 'contract_refresh gives no cash');
  const second = canGrantAdReward(grant.monetization, 'contract_refresh', baseContext());
  assert(second.ok, 'contract_refresh allows second daily use');
  const third = canGrantAdReward(
    applyAdRewardGrant(grant.monetization, 'contract_refresh', baseContext()).monetization,
    'contract_refresh',
    baseContext(),
  );
  assert(!third.ok, 'contract_refresh daily limit is 2');
}

console.log('\nM1 maintenance_discount regression');
{
  const grant = applyAdRewardGrant(
    createDefaultMonetizationState(),
    'maintenance_discount',
    baseContext({ selectedTruckId: 'truck-1', currentRepairCost: 450 }),
  );
  const token = grant.monetization.maintenanceDiscountTokens?.['truck-1'];
  assert(!!token, 'maintenance token created');
  const { discountAmount, finalCost } = calculateDiscountedRepairCost(450, token ?? null);
  assert(discountAmount === 135, '30% discount on $450');
  assert(finalCost === 315, 'discounted repair cost correct');
  const capped = calculateDiscountedRepairCost(2000, token ?? null);
  assert(capped.discountAmount === 500, 'max $500 discount cap preserved');
  let state = grant.monetization;
  assert(!!getActiveMaintenanceDiscountToken(state, 'truck-1', 100), 'token active before repair');
  state = consumeMaintenanceDiscountToken(state, 'truck-1');
  assert(!state.maintenanceDiscountTokens?.['truck-1'], 'token consumed after repair');
}

console.log('\nrecentGrants max 20');
{
  let state = createDefaultMonetizationState();
  for (let i = 0; i < 25; i += 1) {
    state = resetDailyUsageIfNeeded({
      ...state,
      dailyResetKey: `2099-01-${String((i % 28) + 1).padStart(2, '0')}`,
    });
    state = applyAdRewardGrant(state, 'market_analysis', {
      ...baseContext(),
      selectedProductId: `product-${i}`,
    }).monetization;
  }
  assert((state.recentGrants?.length ?? 0) <= 20, 'recentGrants capped at 20');
}

console.log('\nSave/load normalize');
{
  const payload = normalizeSavePayload({
    version: 2,
    currentTime: 50,
    player: {
      companyName: 'Test Co',
      money: 1000,
      level: 3,
      companyLevel: 3,
      xp: 0,
      totalXp: 0,
      homeCityId: 'izmir',
      trucks: [],
      drivers: [],
      warehouses: [],
      completedContracts: 0,
    },
    monetization: {
      monetizationVersion: 1,
      dailyResetKey: getTodayResetKey(),
      totalRewardedAdsToday: 999,
      adRewardUsage: {
        daily_ops_bonus: { count: -3 },
        invalid_slot: { count: 2 },
      },
      maintenanceDiscountTokens: {
        expired: {
          truckId: 'expired',
          discountRate: 0.3,
          maxDiscountCash: 500,
          expiresAtGameTime: 10,
        },
        active: {
          truckId: 'active',
          discountRate: 0.3,
          maxDiscountCash: 500,
          expiresAtGameTime: 200,
        },
      },
      marketAnalysisUnlocks: {
        stale: {
          productId: 'fruit',
          expiresAtGameTime: 20,
        },
        fresh: {
          productId: 'steel',
          expiresAtGameTime: 120,
        },
      },
    },
  } as never);

  const normalized = normalizeMonetizationState(payload.monetization, payload.currentTime);
  assert(
    normalized.totalRewardedAdsToday === MONETIZATION_GLOBAL_DAILY_AD_CAP,
    'totalRewardedAdsToday clamped on normalize',
  );
  assert(normalized.adRewardUsage.invalid_slot == null, 'invalid slot usage removed');
  assert(!!normalized.maintenanceDiscountTokens?.active, 'valid maintenance token kept');
  assert(!normalized.maintenanceDiscountTokens?.expired, 'expired maintenance token removed');
  assert(!normalized.marketAnalysisUnlocks?.stale, 'expired market unlock removed');
  assert(!!normalized.marketAnalysisUnlocks?.fresh, 'valid market unlock kept');
}

console.log(`\n${'='.repeat(48)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
