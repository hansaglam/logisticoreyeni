/**
 * OS/local gameplay notification expansion — domain, dedupe, market-off, wiring.
 * Run: npx tsx scripts/os-notifications-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import {
  MARKET_OS_NOTIFICATIONS_ENABLED,
  OS_NOTIFICATION_DEDUPE_MAX,
  appendOsDedupeKey,
  buildCompletedOsNotification,
  buildDeadlineRiskOsKey,
  buildFailedOsNotification,
  buildIncidentOsKey,
  buildIncidentOsNotification,
  buildLateOsKey,
  buildLevelOsKey,
  buildOutOfFuelOsKey,
  buildOutOfFuelOsNotification,
  classifyDeliveryDeadlineOsState,
  collectHydrationOsDedupeKeys,
  deadlineOsTransitions,
  hasOsDedupeKey,
  listNewlyReadyWeeklyObjectiveIds,
  nextFuelOutEventCount,
} from '../src/domain/osNotifications';
import { resumeRoadsideJob } from '../src/simulation/roadsideFuel';
import type { Delivery } from '../src/types/game';

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

const notificationsSrc = readFileSync('src/services/notifications.ts', 'utf8');
const gameStoreSrc = readFileSync('src/store/gameStore.ts', 'utf8');
const appSrc = readFileSync('App.tsx', 'utf8');
const rentalSrc = readFileSync('src/simulation/rentalTruckLifecycle.ts', 'utf8');
const saveSrc = readFileSync('src/storage/saveGame.ts', 'utf8');

console.log('\nMarket OS remains disabled');
{
  assert(MARKET_OS_NOTIFICATIONS_ENABLED === false, 'MARKET_OS_NOTIFICATIONS_ENABLED is false');
  assert(
    notificationsSrc.includes('if (!MARKET_OS_NOTIFICATIONS_ENABLED)') &&
      notificationsSrc.includes('scheduleMarketAlertNotification') &&
      notificationsSrc.includes('sendLocalMarketAlertNotification'),
    'market send/schedule paths gated',
  );
  assert(
    gameStoreSrc.includes('sendLocal = false'),
    'checkMarketPriceAlerts defaults sendLocal false',
  );
  assert(
    gameStoreSrc.includes('sendLocal && MARKET_OS_NOTIFICATIONS_ENABLED'),
    'in-game market tick cannot emit OS even if sendLocal is passed',
  );
  assert(
    notificationsSrc.includes("typeof __DEV__ === 'undefined' || !__DEV__"),
    'test market notification blocked outside debug',
  );
}

console.log('\n1-3. Out of fuel transition');
{
  const first = nextFuelOutEventCount(false, true, 0);
  assert(first.transitioned && first.count === 1, 'not-out → out increments and transitions');
  const stayed = nextFuelOutEventCount(true, true, first.count);
  assert(!stayed.transitioned && stayed.count === 1, 'still out does not increment');
  const refueled = nextFuelOutEventCount(true, false, stayed.count);
  assert(!refueled.transitioned && refueled.count === 1, 'refuel keeps event count');
  const again = nextFuelOutEventCount(false, true, refueled.count);
  assert(again.transitioned && again.count === 2, 'second run-out allowed');
  const spec1 = buildOutOfFuelOsNotification({
    deliveryId: 'd1',
    vehicleId: 't1',
    truckName: 'İzmir Express',
    fuelOutEventCount: 1,
  });
  const spec2 = buildOutOfFuelOsNotification({
    deliveryId: 'd1',
    vehicleId: 't1',
    truckName: 'İzmir Express',
    fuelOutEventCount: 2,
  });
  assert(spec1.title === 'Aracın yakıtsız kaldı', 'out-of-fuel title');
  assert(spec1.body.includes('İzmir Express ilerlemiyor'), 'out-of-fuel body names truck');
  assert(spec1.dedupeKey === buildOutOfFuelOsKey('d1', 1), 'out-of-fuel key uses event count');
  assert(spec1.dedupeKey !== spec2.dedupeKey, 'later run-out uses a new key');
  assert(spec1.data.type === 'delivery_out_of_fuel', 'out-of-fuel payload type');
  const resumed = resumeRoadsideJob(
    {
      id: 'd1',
      status: 'paused',
      pausedReason: 'out-of-fuel',
      fuelWarningsEmitted: ['out-of-fuel', 'low-fuel'],
      fuelLitersAtStart: 10,
      progress: 0.4,
    } as Delivery,
    'delivery',
    { litersAdded: 20 },
  );
  assert(
    resumed.status === 'on_route' &&
      resumed.pausedReason == null &&
      !(resumed.fuelWarningsEmitted ?? []).includes('out-of-fuel'),
    'refuel/resume clears out-of-fuel warning so a later run-out can toast again',
  );
}

console.log('\n4-5. Pending incident');
{
  const spec = buildIncidentOsNotification({ deliveryId: 'd1', incidentId: 'inc-9' });
  assert(spec.title === 'Operasyon kararı gerekiyor', 'incident title');
  assert(spec.dedupeKey === buildIncidentOsKey('d1', 'inc-9'), 'incident key includes incident id');
  assert(spec.data.type === 'delivery_incident' && spec.data.incidentId === 'inc-9', 'incident payload');
  assert(
    hasOsDedupeKey([spec.dedupeKey], spec.dedupeKey),
    'same pending incident is deduped',
  );
}

console.log('\n6. Deadline risk / late');
{
  const safe = classifyDeliveryDeadlineOsState({
    currentTime: 10,
    estimatedArrivalTime: 20,
    deadlineTime: 30,
  });
  const risk = classifyDeliveryDeadlineOsState({
    currentTime: 10,
    estimatedArrivalTime: 31,
    deadlineTime: 30,
  });
  const late = classifyDeliveryDeadlineOsState({
    currentTime: 31,
    estimatedArrivalTime: 32,
    deadlineTime: 30,
  });
  assert(safe === 'safe' && risk === 'at_risk' && late === 'late', 'reuses existing deadline formula');
  const safeToRisk = deadlineOsTransitions('safe', 'at_risk');
  assert(safeToRisk.notifyRisk && !safeToRisk.notifyLate, 'SAFE → AT_RISK notifies once');
  const riskStay = deadlineOsTransitions('at_risk', 'at_risk');
  assert(!riskStay.notifyRisk && !riskStay.notifyLate, 'remaining at risk does not spam');
  const riskToLate = deadlineOsTransitions('at_risk', 'late');
  assert(!riskToLate.notifyRisk && riskToLate.notifyLate, 'AT_RISK → LATE notifies once');
  const jump = deadlineOsTransitions('safe', 'late');
  assert(
    !jump.notifyRisk && jump.notifyLate && jump.persistRiskKey,
    'SAFE → LATE sends late only and persists risk key',
  );
  assert(buildDeadlineRiskOsKey('d1') !== buildLateOsKey('d1'), 'risk and late keys are distinct');
}

console.log('\n7. Delivery complete');
{
  const early = buildCompletedOsNotification({
    deliveryId: 'd1',
    revenue: 4250,
    punctuality: 'early',
  });
  const onTime = buildCompletedOsNotification({
    deliveryId: 'd1',
    revenue: 4250,
    punctuality: 'on-time',
  });
  const delayed = buildCompletedOsNotification({
    deliveryId: 'd1',
    revenue: 4250,
    punctuality: 'late-minor',
  });
  assert(early?.title === 'Teslimat tamamlandı', 'complete title');
  assert(early?.body === 'Teslimat erken tamamlandı. +$4.250', 'early complete body');
  assert(onTime?.body === 'Teslimat zamanında tamamlandı. +$4.250', 'on-time complete body');
  assert(delayed?.body === 'Teslimat gecikmeli tamamlandı. +$4.250', 'late complete body');
  assert(early?.data.type === 'delivery_completed', 'complete payload type');
}

console.log('\n8-9. Delivery failure reasons');
{
  const tooLate = buildFailedOsNotification({ deliveryId: 'd1', reason: 'too_late' });
  const breakdown = buildFailedOsNotification({ deliveryId: 'd1', reason: 'breakdown' });
  const accident = buildFailedOsNotification({ deliveryId: 'd1', reason: 'accident' });
  const cancelled = buildFailedOsNotification({ deliveryId: 'd1', reason: 'cancelled' });
  assert(tooLate?.body === 'Son teslim süresi kritik seviyede aşıldı.', 'too_late reason copy');
  assert(breakdown?.body === 'Araç arızası nedeniyle teslimat tamamlanamadı.', 'breakdown reason copy');
  assert(accident?.body === 'Kaza nedeniyle teslimat tamamlanamadı.', 'accident reason copy');
  assert(cancelled == null, 'manual cancel does not send OS');
  assert(tooLate?.title === 'Teslimat başarısız', 'failure title');
}

console.log('\n10. Rental fleet notifications still wired');
{
  assert(rentalSrc.includes('Kiralık aracın süresi bitiyor'), 'rental expiring copy');
  assert(rentalSrc.includes('Kiralık araç iade edildi'), 'rental returned copy');
  assert(gameStoreSrc.includes('processExpiredRentalTrucks'), 'rental processor still used');
  assert(notificationsSrc.includes('sendFleetRentalLocalNotification'), 'fleet OS helper remains');
  assert(notificationsSrc.includes("'fleet-updates'"), 'fleet Android channel');
}

console.log('\n11. Level up');
{
  assert(buildLevelOsKey(7) === 'level:7', 'level dedupe key');
  assert(gameStoreSrc.includes('buildLevelUpOsNotification'), 'level-up OS wired');
}

console.log('\n12. Offline progression still emits OS');
{
  assert(
    gameStoreSrc.includes('allowWhenForeground: offlineProgressionActive'),
    'offline catch-up may emit OS even after reopen',
  );
}

console.log('\n13. Relaunch / hydrate dedupe');
{
  const keys = collectHydrationOsDedupeKeys({
    currentTime: 40,
    companyLevel: 7,
    activeDeliveries: [
      {
        id: 'd-fuel',
        status: 'paused',
        pausedReason: 'out-of-fuel',
        fuelOutEventCount: 1,
        estimatedArrivalTime: 50,
        deadlineTime: 60,
      },
      {
        id: 'd-inc',
        status: 'on_route',
        estimatedArrivalTime: 50,
        deadlineTime: 60,
        incident: { id: 'inc-1', status: 'pending' },
      },
    ],
    settlementHistory: [
      { deliveryId: 'd-done', punctualityResult: 'on-time' },
      { deliveryId: 'd-fail', punctualityResult: 'failed' },
    ],
    completedTransferIds: ['tr-1'],
    readyWeeklyMissionIds: ['weekly_1'],
  });
  assert(keys.includes(buildOutOfFuelOsKey('d-fuel', 1)), 'hydrate seeds current out-of-fuel');
  assert(keys.includes(buildIncidentOsKey('d-inc', 'inc-1')), 'hydrate seeds pending incident');
  assert(keys.includes('delivery:d-done:completed'), 'hydrate seeds completed delivery');
  assert(keys.includes('delivery:d-fail:failed'), 'hydrate seeds failed delivery');
  assert(keys.includes(buildLevelOsKey(7)), 'hydrate seeds current company level');
  assert(saveSrc.includes('osNotificationDedupeKeys'), 'dedupe keys persist in save payload');
  assert(gameStoreSrc.includes('collectHydrationOsDedupeKeys'), 'loadGame seeds hydration keys');
}

console.log('\n14. Market price changes do not send OS');
{
  assert(
    !gameStoreSrc.includes('checkMarketPriceAlerts({ sendLocal: true })'),
    'no production tick forces market OS on',
  );
}

console.log('\nChannels, foreground, permission, deep links');
{
  assert(notificationsSrc.includes("'critical-operations'"), 'critical operations channel');
  assert(notificationsSrc.includes("'progress-rewards'"), 'progress rewards channel');
  assert(notificationsSrc.includes('AndroidImportance.HIGH'), 'critical channel is HIGH');
  assert(notificationsSrc.includes('shouldShowBanner: !foreground'), 'no OS banner while foregrounded');
  assert(
    gameStoreSrc.includes('maybeRequestGameplayNotificationPermission'),
    'permission asked from first delivery, not ticks',
  );
  assert(appSrc.includes('getGameplayNotificationOpenFromResponse'), 'tap routing for gameplay payloads');
  assert(appSrc.includes("pendingMoreSubRoute: gameplayOpen.moreSubRoute"), 'missions/warehouse deep link');
}

console.log('\nWeekly + spam guards');
{
  const newly = listNewlyReadyWeeklyObjectiveIds(
    { a: { progress: 2, isClaimed: false } },
    { a: { progress: 5, isClaimed: false } },
    { a: 5 },
  );
  const again = listNewlyReadyWeeklyObjectiveIds(
    { a: { progress: 5, isClaimed: false } },
    { a: { progress: 5, isClaimed: false } },
    { a: 5 },
  );
  assert(newly.includes('a') && again.length === 0, 'weekly ready notifies once');
  let keys: string[] = [];
  for (let i = 0; i < OS_NOTIFICATION_DEDUPE_MAX + 10; i += 1) {
    keys = appendOsDedupeKey(keys, `k:${i}`);
  }
  assert(keys.length === OS_NOTIFICATION_DEDUPE_MAX, 'dedupe list is capped');
  assert(
    gameStoreSrc.includes("title: 'İtibar güncellendi'") &&
      !gameStoreSrc.includes('buildReputationOsNotification'),
    'reputation remains in-app only',
  );
}

console.log(`\nResults: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
console.log('os-notifications-test: PASSED\n');
