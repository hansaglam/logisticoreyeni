/**
 * Delivery boost map interaction + availability regression tests.
 * Run: npx tsx scripts/delivery-boost-map-interaction-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import { DELIVERY_BOOST_MIN_REMAINING_SECONDS } from '../src/config/deliveryAdBoost';
import {
  buildDeliveryTimingSnapshot,
  getDeliveryRemainingGameHours,
} from '../src/simulation/deliveryTiming';
import {
  getDeliveryBoostAvailability,
  deliveryBoostDisabledReasonToUserMessage,
} from '../src/simulation/deliveryBoostAvailability';
import { getDeliveryAdBoostEligibility } from '../src/simulation/deliveryAdBoost';
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
    id: 'delivery-izmir-1',
    contractId: 'contract-1',
    truckId: 'truck-1',
    driverId: 'driver-1',
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'steel',
    amount: 10,
    distanceKm: 580,
    progress: 0.13,
    status: 'on_route',
    startedAt: 0,
    estimatedArrivalTime: 9.82,
    deadlineTime: 30,
    fuelCost: 100,
    fuelLitersAtStart: 200,
    fuelLitersTotal: 120,
    fuelConsumedL: 30,
    maintenanceCost: 0,
    estimatedProfit: 500,
    travelHours: 10,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 1,
    ...overrides,
  } as Delivery;
}

function makeTruck(): Truck {
  return {
    id: 'truck-1',
    catalogId: 'truck-ford-cargo',
    name: 'Test Truck',
    status: 'on_route',
    currentFuelL: 150,
    fuelCapacityL: 200,
    currentCityId: 'izmir',
    homeCityId: 'izmir',
  } as Truck;
}

console.log('\n=== Delivery Boost Map Interaction Regression ===\n');

console.log('Press structure — boost outside parent TouchableOpacity');
{
  const card = readFileSync('src/components/map/MapTruckTrackingCard.tsx', 'utf8');
  const panel = readFileSync('src/components/monetization/DeliveryBoostPanel.tsx', 'utf8');
  assert(card.includes('<TouchableOpacity'), 'card has dedicated press area');
  assert(card.includes('</TouchableOpacity>'), 'card press area closes before boost');
  assert(
    card.includes('<DeliveryBoostPanel') && card.lastIndexOf('DeliveryBoostPanel') > card.lastIndexOf('</TouchableOpacity>'),
    'DeliveryBoostPanel is sibling after card press area',
  );
  assert(!panel.includes('disabled={buttonDisabled}'), 'boost panel does not disable Pressable (no parent touch leak)');
}

console.log('\nCanonical timing — progress 13% + ETA ~7h49m');
{
  const delivery = makeDelivery({
    progress: 0.13,
    travelHours: 10,
    estimatedArrivalTime: 2 + 7 + 49 / 60,
  });
  const currentGameTime = 2;
  const timing = buildDeliveryTimingSnapshot({ delivery, currentGameTime, gameSpeed: 1 });
  const remainingGameHours = getDeliveryRemainingGameHours(delivery, currentGameTime);
  assert(remainingGameHours != null && remainingGameHours > 7, 'remaining game hours ~7h49m', String(remainingGameHours));
  assert(
    timing.remainingSeconds != null && timing.remainingSeconds > DELIVERY_BOOST_MIN_REMAINING_SECONDS,
    'remainingSeconds well above minimum',
    String(timing.remainingSeconds),
  );
  assert(timing.etaLabel.includes('7 sa'), 'eta label matches ETA source', timing.etaLabel);

  const availability = getDeliveryBoostAvailability({
    delivery,
    truck: makeTruck(),
    currentGameTime,
    gameSpeed: 1,
    isOnline: true,
    adState: { consentReady: true, adLoaded: true },
  });
  assert(availability.status === 'available', 'boost available at 13% with long ETA');
  const tooShortCopy = deliveryBoostDisabledReasonToUserMessage('remaining-time-too-short');
  assert(
    !tooShortCopy.body.includes('çok kısa'),
    'canonical too-short copy no longer uses stale phrase',
  );
}

console.log('\nPercent progress normalization regression');
{
  const delivery = makeDelivery({
    progress: 13,
    travelHours: 10,
    estimatedArrivalTime: 12,
  });
  const eligibility = getDeliveryAdBoostEligibility({
    delivery,
    truck: makeTruck(),
    currentGameTime: 2,
    gameSpeed: 1,
    adState: { adLoaded: true, consentReady: true },
  });
  assert(eligibility.eligible, 'progress=13 treated as 13% not 100%');
  assert(
    eligibility.reason !== 'remaining-time-too-short',
    'percent progress does not trigger too-short',
    eligibility.reason,
  );
}

console.log('\nMinimum remaining boundary');
{
  const minGameSeconds = DELIVERY_BOOST_MIN_REMAINING_SECONDS;
  const remainingHoursAbove = (minGameSeconds + 1) / 3600;
  const remainingHoursAt = minGameSeconds / 3600;
  const remainingHoursBelow = (minGameSeconds - 1) / 3600;

  const base = makeDelivery({ progress: 0.2, travelHours: 20 });
  const above = getDeliveryBoostAvailability({
    delivery: { ...base, estimatedArrivalTime: 5 + remainingHoursAbove },
    currentGameTime: 5,
    gameSpeed: 1,
    isOnline: true,
    adState: { consentReady: true, adLoaded: true },
  });
  const at = getDeliveryBoostAvailability({
    delivery: { ...base, estimatedArrivalTime: 5 + remainingHoursAt },
    currentGameTime: 5,
    gameSpeed: 1,
    isOnline: true,
    adState: { consentReady: true, adLoaded: true },
  });
  const below = getDeliveryBoostAvailability({
    delivery: { ...base, estimatedArrivalTime: 5 + remainingHoursBelow },
    currentGameTime: 5,
    gameSpeed: 1,
    isOnline: true,
    adState: { consentReady: true, adLoaded: true },
  });

  assert(above.status === 'available', 'remainingSeconds > min → available');
  assert(
    at.status === 'disabled' && at.reason === 'remaining-time-too-short',
    'remainingSeconds === min → too-short',
  );
  assert(
    below.status === 'disabled' && below.reason === 'remaining-time-too-short',
    'remainingSeconds < min → too-short',
  );
}

console.log('\nTiming not ready');
{
  const delivery = makeDelivery({
    estimatedArrivalTime: undefined as unknown as number,
    travelHours: undefined as unknown as number,
  });
  const availability = getDeliveryBoostAvailability({
    delivery,
    currentGameTime: undefined,
    gameSpeed: 1,
    isOnline: true,
    adState: { consentReady: true, adLoaded: true },
  });
  assert(
    availability.status === 'disabled',
    'missing timing resolves disabled',
    availability.status === 'disabled' ? availability.reason : 'available',
  );
}

console.log('\nBoost usage is per delivery id');
{
  const deliveryA = makeDelivery({ id: 'delivery-a', deliveryAdBoost: { usedCount: 2, totalReducedMs: 1000, processedRewardIds: [] } });
  const deliveryB = makeDelivery({ id: 'delivery-b', deliveryAdBoost: undefined });
  const blocked = getDeliveryBoostAvailability({
    delivery: deliveryA,
    currentGameTime: 2,
    gameSpeed: 1,
    isOnline: true,
    adState: { consentReady: true, adLoaded: true },
  });
  const fresh = getDeliveryBoostAvailability({
    delivery: deliveryB,
    truck: makeTruck(),
    currentGameTime: 2,
    gameSpeed: 1,
    isOnline: true,
    adState: { consentReady: true, adLoaded: true },
  });
  assert(blocked.status === 'disabled' && blocked.reason === 'boost-limit-reached', 'old delivery at limit');
  assert(fresh.status === 'available', 'new delivery resets boost usage');
}

console.log('\nETA + availability share remainingSeconds');
{
  const delivery = makeDelivery({ progress: 0.13, estimatedArrivalTime: 9.82 });
  const timing = buildDeliveryTimingSnapshot({ delivery, currentGameTime: 2, gameSpeed: 1 });
  const availability = getDeliveryBoostAvailability({
    delivery,
    currentGameTime: 2,
    gameSpeed: 1,
    isOnline: true,
    adState: { consentReady: true, adLoaded: true },
  });
  assert(
    availability.status === 'available' && timing.remainingSeconds === availability.remainingSeconds,
    'timing snapshot and availability use same remainingSeconds',
  );
}

console.log(`\nPASS: ${pass}`);
console.log(`FAIL: ${fail}`);
if (fail > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
