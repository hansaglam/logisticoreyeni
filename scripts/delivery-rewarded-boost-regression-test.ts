/**
 * Delivery rewarded ad boost regression tests.
 * Run: npx tsx scripts/delivery-rewarded-boost-regression-test.ts
 */
import './test-globals';

import {
  ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS,
  ADMOB_REWARDED_UNIT_IDS,
} from '../src/config/adMobConstants';
import {
  DELIVERY_AD_BOOST_MAX_TOTAL_RATIO,
  DELIVERY_AD_BOOST_MAX_USES,
  DELIVERY_AD_BOOST_MIN_REMAINING_MS,
  DELIVERY_AD_BOOST_REDUCTION_RATIO,
} from '../src/config/deliveryAdBoost';
import { getMsPerGameHour } from '../src/config/balance';
import {
  applyDeliveryRewardedBoost,
  calculateDeliveryBoostReductionMs,
  createDeliveryBoostRewardId,
  getDeliveryAdBoostEligibility,
  getDeliveryRemainingMs,
  normalizeDeliveryAdBoostState,
} from '../src/simulation/deliveryAdBoost';
import { normalizeDelivery } from '../src/simulation/deliveryIncidents';
import type { Delivery, Truck } from '../src/types/game';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function makeDelivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery-1',
    contractId: 'contract-1',
    truckId: 'truck-1',
    driverId: 'driver-1',
    originCityId: 'izmir',
    destinationCityId: 'bursa',
    productId: 'steel',
    amount: 10,
    distanceKm: 300,
    progress: 0.2,
    status: 'on_route',
    startedAt: 0,
    estimatedArrivalTime: 20,
    deadlineTime: 30,
    fuelCost: 100,
    fuelLitersAtStart: 200,
    fuelLitersTotal: 120,
    fuelConsumedL: 30,
    maintenanceCost: 0,
    estimatedProfit: 500,
    travelHours: 40,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 1,
    ...overrides,
  } as Delivery;
}

function makeTruck(overrides: Partial<Truck> = {}): Truck {
  return {
    id: 'truck-1',
    catalogId: 'truck-ford-cargo',
    name: 'Test Truck',
    status: 'on_route',
    currentFuelL: 150,
    fuelCapacityL: 200,
    currentCityId: 'izmir',
    homeCityId: 'izmir',
    ...overrides,
  } as Truck;
}

console.log('\n=== Delivery Rewarded Boost Regression ===\n');

console.log('Config');
assert(DELIVERY_AD_BOOST_REDUCTION_RATIO === 0.25, 'reduction ratio 25%');
assert(DELIVERY_AD_BOOST_MAX_USES === 2, 'max 2 uses per delivery');
assert(DELIVERY_AD_BOOST_MAX_TOTAL_RATIO === 0.5, 'max total 50%');
assert(DELIVERY_AD_BOOST_MIN_REMAINING_MS === 5 * 60 * 1000, 'min remaining 5 minutes');

console.log('\nEligibility');
{
  const delivery = makeDelivery();
  const truck = makeTruck();
  const eligible = getDeliveryAdBoostEligibility({ delivery, truck, gameSpeed: 1 });
  assert(eligible.eligible, 'active delivery eligible');
  assert(eligible.estimatedReductionMs > 0, 'estimated reduction > 0');

  const completed = getDeliveryAdBoostEligibility({
    delivery: makeDelivery({ status: 'completed', progress: 1 }),
    truck,
  });
  assert(!completed.eligible, 'inactive delivery rejected');

  const incident = getDeliveryAdBoostEligibility({
    delivery: makeDelivery({
      incident: {
        id: 'inc-1',
        deliveryId: 'delivery-1',
        type: 'customs',
        title: 'Test',
        description: '',
        createdAtGameTime: 1,
        triggerProgress: 0.5,
        status: 'pending',
        choices: [
          { id: 'a', label: 'A', description: '' },
          { id: 'b', label: 'B', description: '' },
        ],
      },
    }),
    truck,
  });
  assert(incident.reason === 'incident-pending', 'incident pending rejected');

  const outOfFuel = getDeliveryAdBoostEligibility({
    delivery: makeDelivery({ status: 'paused', pausedReason: 'out-of-fuel' }),
    truck: makeTruck({ status: 'out_of_fuel' }),
  });
  assert(outOfFuel.reason === 'truck-out-of-fuel', 'out-of-fuel rejected');

  const shortRemaining = getDeliveryAdBoostEligibility({
    delivery: makeDelivery({ progress: 0.995, travelHours: 0.2 }),
    truck,
  });
  assert(shortRemaining.reason === 'remaining-time-too-short', 'remaining <5m rejected');

  const limit = getDeliveryAdBoostEligibility({
    delivery: makeDelivery({
      deliveryAdBoost: { usedCount: 2, totalReducedMs: 1000, processedRewardIds: [] },
    }),
    truck,
  });
  assert(limit.reason === 'limit-reached', 'third use rejected');

  const adNotReady = getDeliveryAdBoostEligibility({
    delivery,
    truck,
    adState: { adLoaded: false },
  });
  assert(adNotReady.reason === 'ad-not-ready', 'ad not loaded rejected');

  const consent = getDeliveryAdBoostEligibility({
    delivery,
    truck,
    adState: { consentReady: false },
  });
  assert(consent.reason === 'consent-not-ready', 'consent not ready rejected');

  const cooldown = getDeliveryAdBoostEligibility({
    delivery,
    truck,
    nowMs: 60_000,
    adState: { lastBoostAdAt: 50_000 },
  });
  assert(cooldown.reason === 'cooldown', 'cooldown rejected');

  const processing = getDeliveryAdBoostEligibility({
    delivery,
    truck,
    adState: { globalProcessing: true },
  });
  assert(processing.reason === 'already-processing', 'already-processing rejected');
}

console.log('\nReduction math');
{
  const delivery = makeDelivery({ progress: 0.5, travelHours: 30 });
  const first = calculateDeliveryBoostReductionMs({ delivery, gameSpeed: 1 });
  const remaining = getDeliveryRemainingMs(delivery, 1);
  assert(Math.abs(first - remaining * 0.25) < 5, 'first reward ~25% remaining');

  const afterFirst = makeDelivery({
    progress: 0.5,
    travelHours: 30,
    deliveryAdBoost: {
      usedCount: 1,
      totalReducedMs: first,
      processedRewardIds: ['r1'],
    },
  });
  const second = calculateDeliveryBoostReductionMs({ delivery: afterFirst, gameSpeed: 1 });
  const maxTotal = 30 * getMsPerGameHour(1) * DELIVERY_AD_BOOST_MAX_TOTAL_RATIO;
  assert(afterFirst.deliveryAdBoost!.totalReducedMs + second <= maxTotal + 1, 'total cap 50%');
}

console.log('\nReward application');
{
  const delivery = makeDelivery({ progress: 0.3 });
  const truck = makeTruck();
  const rewardId = createDeliveryBoostRewardId(delivery.id, Date.now());
  const result = applyDeliveryRewardedBoost({
    delivery,
    truck,
    rewardId,
    earnedAt: Date.now(),
    gameSpeed: 1,
    currentGameTime: 5,
    processedAt: 5,
  });
  assert(result.ok, 'EARNED_REWARD boost applies');
  assert((result.delivery?.progress ?? 0) > delivery.progress, 'progress increased');
  assert((result.delivery?.fuelConsumedL ?? 0) >= (delivery.fuelConsumedL ?? 0), 'fuel consumed');
  assert(result.delivery?.deliveryAdBoost?.usedCount === 1, 'usedCount incremented');

  if (!result.delivery || !result.truck) {
    throw new Error('boost result missing delivery/truck');
  }
  const dup = applyDeliveryRewardedBoost({
    delivery: result.delivery,
    truck: result.truck,
    rewardId,
    earnedAt: Date.now(),
    gameSpeed: 1,
  });
  assert(!dup.ok, 'duplicate rewardId blocked');
}

console.log('\nPartial fuel');
{
  const delivery = makeDelivery({ progress: 0.2, fuelLitersTotal: 200, fuelConsumedL: 195 });
  const truck = makeTruck({ currentFuelL: 5 });
  const rewardId = createDeliveryBoostRewardId('fuel-cap', Date.now());
  const result = applyDeliveryRewardedBoost({
    delivery,
    truck,
    rewardId,
    earnedAt: Date.now(),
    gameSpeed: 1,
  });
  assert(result.ok, 'partial fuel boost applies without completion');
  if (result.delivery?.status === 'paused') {
    assert(result.delivery.pausedReason === 'out-of-fuel', 'out-of-fuel after partial boost');
  }
  assert(result.shouldComplete !== true, 'no completion when fuel exhausted');
}

console.log('\nSecond reward');
{
  const delivery = makeDelivery({ progress: 0.05, travelHours: 60 });
  const truck = makeTruck();
  const firstId = createDeliveryBoostRewardId(delivery.id, 1000);
  const first = applyDeliveryRewardedBoost({
    delivery,
    truck,
    rewardId: firstId,
    earnedAt: 1000,
    gameSpeed: 1,
  });
  assert(first.ok, 'first boost ok');
  const remainingAfterFirst = getDeliveryRemainingMs(first.delivery!, 1);
  const secondEstimate = calculateDeliveryBoostReductionMs({
    delivery: first.delivery!,
    gameSpeed: 1,
  });
  assert(
    Math.abs(secondEstimate - remainingAfterFirst * 0.25) < 5,
    'second reward ~25% of new remaining',
  );
  const secondId = createDeliveryBoostRewardId(delivery.id, 2000);
  const second = applyDeliveryRewardedBoost({
    delivery: first.delivery!,
    truck: first.truck!,
    rewardId: secondId,
    earnedAt: 2000,
    gameSpeed: 1,
  });
  assert(second.ok, 'second boost ok');
  const thirdBlocked = getDeliveryAdBoostEligibility({
    delivery: second.delivery!,
    truck: second.truck!,
  });
  assert(thirdBlocked.reason === 'limit-reached', 'third reward rejected after 2 uses');
}

console.log('\nSave/load migration');
{
  const legacy = normalizeDelivery(
    makeDelivery({
      deliveryAdBoost: undefined,
    }),
  );
  assert(legacy.deliveryAdBoost == null, 'legacy save without boost field');

  const withBoost = normalizeDelivery(
    makeDelivery({
      deliveryAdBoost: {
        usedCount: 1,
        totalReducedMs: 5000,
        processedRewardIds: ['reward-a'],
      },
    }),
  );
  assert(withBoost.deliveryAdBoost?.usedCount === 1, 'save preserves usedCount');
  assert(withBoost.deliveryAdBoost?.totalReducedMs === 5000, 'save preserves totalReducedMs');
  assert(
    withBoost.deliveryAdBoost?.processedRewardIds.includes('reward-a'),
    'save preserves processedRewardIds',
  );
}

console.log('\nSave normalization');
{
  const normalized = normalizeDeliveryAdBoostState({
    usedCount: 99,
    totalReducedMs: -5,
    processedRewardIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
  });
  assert(normalized.usedCount === DELIVERY_AD_BOOST_MAX_USES, 'usedCount bounded');
  assert(normalized.totalReducedMs === 0, 'negative totalReducedMs clamped');
  assert(normalized.processedRewardIds.length <= 10, 'processedRewardIds bounded');
}

console.log('\nAdMob placement');
{
  assert(
    ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS.android.startsWith('ca-app-pub-'),
    'android delivery boost unit configured',
  );
  assert(
    ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS.ios.startsWith('ca-app-pub-'),
    'ios delivery boost unit configured',
  );
  assert(
    ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS.android !== '3940256099942544',
    'production test ID not used for android placement',
  );
  assert(
    ADMOB_REWARDED_UNIT_IDS.android.startsWith('ca-app-pub-'),
    'general rewarded unit still configured',
  );
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) process.exit(1);
console.log('✅ ALL PASS\n');
