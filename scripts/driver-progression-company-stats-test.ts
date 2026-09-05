import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_DRIVER_LEVEL,
  applyDriverXp,
  calculateDriverDeliveryXp,
  computeDriverLevelFromXp,
  getDriverLifetimeXpForLevel,
  getDriverProgress,
} from '../src/simulation/driverProgress';
import {
  COMPANY_STATS_EVENT_RECEIPT_LIMIT,
  applyAuthoritativeMarketplaceSales,
  applyCompanyStatsEvent,
  captureCompanyStatsPeaks,
  createCompanyStatsBaseline,
  normalizeCompanyStats,
} from '../src/domain/companyStats';
import type { Contract, Driver, Player } from '../src/types/game';

const driver: Driver = {
  id: 'driver-v11',
  name: 'Test Şoförü',
  experience: 50,
  attention: 50,
  fuelSaving: 50,
  speed: 0,
  morale: 80,
  salaryPerDay: 100,
  hireCost: 0,
  assignedTruckId: null,
  status: 'idle',
  xp: 0,
  level: 1,
};

const contract = {
  id: 'contract-v11',
  contractType: 'standard',
} as Contract;

const player = {
  money: 20_000,
  reputation: 50,
  completedContracts: 4,
  failedDeliveries: 1,
  lateDeliveries: 1,
  trucks: [{ id: 'truck-1' }, { id: 'truck-2' }],
  warehouses: [{ id: 'warehouse-1' }],
  drivers: [driver],
} as Player;

console.log('\n=== Driver progression / CompanyStats foundation ===\n');

// Driver XP curve: shipped thresholds remain stable; post-L5 growth is integer
// and progressively slower without exponential blow-up.
assert.equal(getDriverLifetimeXpForLevel(1), 0);
assert.equal(getDriverLifetimeXpForLevel(2), 100);
assert.equal(getDriverLifetimeXpForLevel(3), 250);
assert.equal(getDriverLifetimeXpForLevel(4), 500);
assert.equal(getDriverLifetimeXpForLevel(5), 1150);
assert.equal(getDriverLifetimeXpForLevel(6), 1900);
assert.ok(getDriverLifetimeXpForLevel(20) < 100_000);
assert.equal(computeDriverLevelFromXp(99), 1);
assert.equal(computeDriverLevelFromXp(100), 2, 'exact level boundary');

const firstDeliveryXp = calculateDriverDeliveryXp({
  contract,
  distanceKm: 300,
  onTime: true,
  success: true,
});
assert.ok(firstDeliveryXp > 0, 'first successful delivery grants XP');
assert.equal(
  calculateDriverDeliveryXp({
    contract,
    distanceKm: 300,
    onTime: false,
    success: false,
  }),
  0,
  'failed delivery never grants driver XP',
);
const afterFirst = applyDriverXp(driver, firstDeliveryXp).driver;
const afterSecond = applyDriverXp(afterFirst, firstDeliveryXp).driver;
assert.equal(afterSecond.xp, firstDeliveryXp * 2, 'multiple deliveries accumulate');

const exactBoundary = applyDriverXp(driver, getDriverLifetimeXpForLevel(2));
assert.equal(exactBoundary.newLevel, 2);
assert.equal(getDriverProgress(exactBoundary.driver).xpIntoLevel, 0);

const multiLevel = applyDriverXp(driver, getDriverLifetimeXpForLevel(6));
assert.equal(multiLevel.newLevel, 6, 'one grant can cross multiple levels');
assert.equal(getDriverProgress(multiLevel.driver).lifetimeXp, 1900);
assert.equal(getDriverProgress(multiLevel.driver).xpForNextLevel, 850);
assert.ok(MAX_DRIVER_LEVEL >= 20, 'curve supports long-term progression');

const baseline = createCompanyStatsBaseline(player, 240);
assert.equal(baseline.deliveriesCompleted, 4, 'existing completed count is a conservative minimum');
assert.equal(baseline.deliveriesFailed, 1);
assert.equal(baseline.lateDeliveries, 1);
assert.equal(baseline.totalDistanceCompleted, 0, 'historical distance is not invented');
assert.equal(baseline.deliveryRevenueEarned, 0, 'historical revenue is not invented');
assert.equal(baseline.historicalDataComplete, false);

const early = applyCompanyStatsEvent(baseline, {
  type: 'delivery-success',
  eventId: 'settlement-delivery-1',
  punctuality: 'early',
  distanceKm: 300,
  revenue: 2_500,
  driverXp: firstDeliveryXp,
});
assert.equal(early.applied, true);
assert.equal(early.stats.deliveriesCompleted, 5);
assert.equal(early.stats.earlyDeliveries, 1);
assert.equal(early.stats.totalDistanceCompleted, 300);
assert.equal(early.stats.deliveryRevenueEarned, 2_500);

const duplicate = applyCompanyStatsEvent(early.stats, {
  type: 'delivery-success',
  eventId: 'settlement-delivery-1',
  punctuality: 'early',
  distanceKm: 300,
  revenue: 2_500,
  driverXp: firstDeliveryXp,
});
assert.equal(duplicate.applied, false, 'duplicate settlement is idempotent');
assert.deepEqual(duplicate.stats, early.stats);

const onTime = applyCompanyStatsEvent(early.stats, {
  type: 'delivery-success',
  eventId: 'settlement-delivery-2',
  punctuality: 'on-time',
  distanceKm: 100,
  revenue: 1_000,
  driverXp: 20,
}).stats;
const late = applyCompanyStatsEvent(onTime, {
  type: 'delivery-success',
  eventId: 'settlement-delivery-3',
  punctuality: 'late-minor',
  distanceKm: 50,
  revenue: 500,
  driverXp: 10,
}).stats;
assert.equal(late.onTimeDeliveries, 1);
assert.equal(late.lateDeliveries, 2, 'legacy minimum plus new late delivery');

const failed = applyCompanyStatsEvent(late, {
  type: 'delivery-failure',
  eventId: 'delivery-failure:4',
}).stats;
const cancelled = applyCompanyStatsEvent(failed, {
  type: 'delivery-failure',
  eventId: 'delivery-failure:5',
}).stats;
assert.equal(cancelled.deliveriesFailed, 3);
assert.equal(cancelled.driverLifetimeXp, late.driverLifetimeXp, 'failure/cancel grants no XP');

const purchase = applyCompanyStatsEvent(cancelled, {
  type: 'marketplace-purchase',
  eventId: 'marketplace-purchase:txn-1',
}).stats;
assert.equal(purchase.marketplacePurchases, 1);
assert.equal(
  applyCompanyStatsEvent(purchase, {
    type: 'marketplace-purchase',
    eventId: 'marketplace-purchase:txn-1',
  }).stats.marketplacePurchases,
  1,
  'marketplace purchase receipt is idempotent',
);

const salesBaseline = applyAuthoritativeMarketplaceSales(purchase, ['sold-before-v11']);
assert.equal(salesBaseline.marketplaceSales, 0, 'first tombstone snapshot is migration baseline');
const sale = applyAuthoritativeMarketplaceSales(salesBaseline, [
  'sold-before-v11',
  'sold-after-v11',
]);
assert.equal(sale.marketplaceSales, 1);
assert.equal(
  applyAuthoritativeMarketplaceSales(sale, ['sold-before-v11', 'sold-after-v11']).marketplaceSales,
  1,
  'sale reconciliation is idempotent',
);

const peaks = captureCompanyStatsPeaks(sale, {
  ...player,
  money: 45_000,
  reputation: 77,
  trucks: [...player.trucks, { id: 'truck-3' }],
  warehouses: [...player.warehouses, { id: 'warehouse-2' }],
} as Player);
assert.equal(peaks.highestCash, 45_000);
assert.equal(peaks.vehiclesOwnedPeak, 3);
assert.equal(peaks.warehousesOwnedPeak, 2);
assert.equal(peaks.reputationPeak, 77);

const cloudReload = normalizeCompanyStats(JSON.parse(JSON.stringify(peaks)), {
  player,
  currentTime: 300,
});
assert.equal(cloudReload.marketplacePurchases, 1);
assert.equal(cloudReload.marketplaceSales, 1);
assert.ok(cloudReload.appliedEventIds.includes('settlement-delivery-1'));
assert.equal(
  applyCompanyStatsEvent(cloudReload, {
    type: 'delivery-success',
    eventId: 'settlement-delivery-1',
    punctuality: 'early',
    distanceKm: 300,
    revenue: 2_500,
    driverXp: firstDeliveryXp,
  }).applied,
  false,
  'cloud reload preserves settlement receipt',
);

const accountA = normalizeCompanyStats(peaks, { player, currentTime: 300 });
const accountB = normalizeCompanyStats(undefined, {
  player: { ...player, completedContracts: 0 } as Player,
  currentTime: 0,
});
assert.notStrictEqual(accountA, accountB);
assert.equal(accountB.marketplacePurchases, 0, 'new account does not inherit stats');

let bounded = baseline;
for (let index = 0; index < COMPANY_STATS_EVENT_RECEIPT_LIMIT + 20; index += 1) {
  bounded = applyCompanyStatsEvent(bounded, {
    type: 'marketplace-purchase',
    eventId: `bounded-${index}`,
  }).stats;
}
assert.equal(bounded.appliedEventIds.length, COMPANY_STATS_EVENT_RECEIPT_LIMIT);

const storeSource = readFileSync('src/store/gameStore.ts', 'utf8');
const saveSource = readFileSync('src/storage/saveGame.ts', 'utf8');
assert.ok(storeSource.includes("eventId: settlementId"), 'delivery stats reuse settlement identity');
assert.ok(storeSource.includes("type: 'delivery-failure'"), 'failed/cancelled settlement updates stats');
assert.ok(!storeSource.includes('result.effects.driverXpDelta > 0'), 'choice taps do not grant driver XP');
assert.ok(saveSource.includes('companyStats?: CompanyStats'), 'save field remains additive');
assert.ok(saveSource.includes('normalizeCompanyStats(payload.companyStats'), 'old saves initialize safely');

console.log('PASS — driver progression and CompanyStats foundation');
