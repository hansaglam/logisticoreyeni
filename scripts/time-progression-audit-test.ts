/**
 * Canonical real-time, offline cap and periodic-cost idempotency audit.
 * Run: npx tsx scripts/time-progression-audit-test.ts
 */

import './test-globals';

import { GAME_LOOP_TICK_MS } from '../src/config/balance';
import { STARTER_DRIVER } from '../src/data/drivers';
import { STARTER_TRUCK } from '../src/data/trucks';
import {
  DAY_MS,
  HOUR_MS,
  MARKET_EPOCH_MS,
  MINUTE_MS,
  ServerEconomyClock,
} from '../src/simulation/economyClock';
import {
  buildTimeProgressionAudit,
  calculateOfflineElapsed,
  calculateOfflineSimulationHours,
  MAX_OFFLINE_PROGRESS_HOURS,
  MAX_OFFLINE_PROGRESS_MS,
  MIN_OFFLINE_PROGRESS_MS,
  resolveOfflineBaselineMs,
  shouldSkipDuplicateOfflineApply,
} from '../src/simulation/offlineProgression';
import { buildPeriodicCostDeductions, OFFLINE_CATCHUP_MAX_COST_PERIODS, ONLINE_TICK_MAX_COST_PERIODS } from '../src/simulation/periodicCosts';
import type { Player } from '../src/types/game';

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

const trustedNow = 1_800_000_000_000;
const player: Pick<Player, 'drivers' | 'warehouses' | 'trucks'> = {
  drivers: [{ ...STARTER_DRIVER, dailySalary: 120, salaryPerDay: 120 }],
  warehouses: [],
  trucks: [{ ...STARTER_TRUCK }],
};

function periodicFor(hoursOffline: number, appliedKeys: string[] = [], online = false) {
  return buildPeriodicCostDeductions({
    player,
    economyNowMs: trustedNow,
    lastProcessedEconomyAt: trustedNow - hoursOffline * HOUR_MS,
    alreadyAppliedPeriodKeys: appliedKeys,
    maxOfflineCostPeriods: online
      ? ONLINE_TICK_MAX_COST_PERIODS
      : OFFLINE_CATCHUP_MAX_COST_PERIODS,
  });
}

console.log('\n=== time-progression-audit-test ===\n');

assert(MINUTE_MS === 60_000, 'MINUTE_MS canonical');
assert(HOUR_MS === 3_600_000, 'HOUR_MS canonical');
assert(DAY_MS === 86_400_000, 'DAY_MS canonical');
assert(MARKET_EPOCH_MS === 30 * MINUTE_MS, 'MARKET_EPOCH_MS canonical');
assert(MAX_OFFLINE_PROGRESS_MS === 24 * HOUR_MS, 'MAX_OFFLINE_PROGRESS_MS = 24h');
assert(MIN_OFFLINE_PROGRESS_MS === GAME_LOOP_TICK_MS, 'minimum offline threshold = one game tick');

const belowTick = calculateOfflineElapsed(
  trustedNow - Math.max(1, MIN_OFFLINE_PROGRESS_MS - 1),
  trustedNow,
);
assert(!belowTick.shouldApply, 'sub-tick pause discarded');
assert(belowTick.reason === 'below_minimum', 'sub-tick below_minimum reason');

const oneMinute = calculateOfflineElapsed(trustedNow - MINUTE_MS, trustedNow);
const oneMinuteSimulation = calculateOfflineSimulationHours(oneMinute.appliedMs, 1);
assert(oneMinute.shouldApply, '1 dakika offline progress uygulanır');
assert(oneMinute.appliedMs === MINUTE_MS, '1 dakika elapsed tam uygulanır');
assert(oneMinuteSimulation.appliedSimulationHours > 0, '1 dakika simulation hours > 0');

const oneHour = calculateOfflineElapsed(trustedNow - HOUR_MS, trustedNow);
const oneHourSimulation = calculateOfflineSimulationHours(oneHour.appliedMs, 1);
const oneHourCosts = periodicFor(1);
assert(oneHour.shouldApply, '1 saat offline uygulanır');
assert(
  oneHourSimulation.appliedSimulationHours === MAX_OFFLINE_PROGRESS_HOURS,
  '1 saat hızlandırılmış simulation 24 saatte cap olur',
);
assert(oneHourCosts.periodsCharged === 0, '1 saat cost period üretmez');
assert(
  oneHourCosts.newlyProcessedUntil === trustedNow - HOUR_MS,
  'fractional cost süresi cursor içinde korunur',
);

const oneDay = calculateOfflineElapsed(trustedNow - DAY_MS, trustedNow);
const oneDaySimulation = calculateOfflineSimulationHours(oneDay.appliedMs, 1);
const oneDayCosts = periodicFor(24);
assert(oneDay.elapsedMs === DAY_MS, '24 saat elapsedRealHours = 24');
assert(oneDaySimulation.appliedSimulationHours === 24, '24 saat en fazla 1 oyun günü');
assert(oneDayCosts.periodsElapsed === 1, '24 saat yalnız 1 cost period elapsed');
assert(oneDayCosts.periodsCharged === 0, 'offline catch-up: 24 saat fixed cost = 0');

const twoDays = calculateOfflineElapsed(trustedNow - 48 * HOUR_MS, trustedNow);
const twoDayCosts = periodicFor(48);
assert(twoDays.capped && twoDays.appliedMs === DAY_MS, '48 saat progress penceresi 24h cap');
assert(twoDayCosts.periodsElapsed === 2, '48 saat = 2 cost period elapsed');
assert(twoDayCosts.periodsCharged === 0, 'offline catch-up: 48 saat fixed cost = 0');

const sevenDays = calculateOfflineElapsed(trustedNow - 7 * DAY_MS, trustedNow);
const sevenDayCosts = periodicFor(7 * 24);
assert(sevenDays.capped, '7 gün progress capped');
assert(sevenDayCosts.periodsElapsed === 7, '7 gün elapsed period doğru');
assert(sevenDayCosts.periodsCharged === 0, 'offline catch-up: 72h+ fixed cost = 0');
assert(sevenDayCosts.newlyProcessedUntil === trustedNow, 'cap sonrası cursor trustedNow');

const onlineDay = periodicFor(24, [], true);
assert(onlineDay.periodsCharged === 1, 'online tick: 24 saat geçince 1 period kesilir');

const secondHydrate = buildPeriodicCostDeductions({
  player,
  economyNowMs: trustedNow,
  lastProcessedEconomyAt: sevenDayCosts.newlyProcessedUntil,
  alreadyAppliedPeriodKeys: sevenDayCosts.periodKeysApplied,
  maxOfflineCostPeriods: OFFLINE_CATCHUP_MAX_COST_PERIODS,
});
assert(secondHydrate.periodsCharged === 0, 'aynı save ikinci hydrate deduction 0');
assert(secondHydrate.totalAmount === 0, 'ikinci hydrate toplam gider 0');

const firstForegroundTick = buildPeriodicCostDeductions({
  player,
  economyNowMs: trustedNow + 1_000,
  lastProcessedEconomyAt: sevenDayCosts.newlyProcessedUntil,
  alreadyAppliedPeriodKeys: sevenDayCosts.periodKeysApplied,
  maxOfflineCostPeriods: ONLINE_TICK_MAX_COST_PERIODS,
});
assert(firstForegroundTick.periodsCharged === 0, 'hydrate sonrası ilk tick duplicate kesmez');
assert(
  shouldSkipDuplicateOfflineApply(trustedNow, trustedNow, trustedNow),
  'aynı timestamp offline apply idempotent',
);

const backwardCostCursor = buildPeriodicCostDeductions({
  player,
  economyNowMs: trustedNow,
  lastProcessedEconomyAt: trustedNow + HOUR_MS,
  alreadyAppliedPeriodKeys: [],
  maxOfflineCostPeriods: OFFLINE_CATCHUP_MAX_COST_PERIODS,
});
assert(
  backwardCostCursor.newlyProcessedUntil === trustedNow + HOUR_MS,
  'cihaz saati geri: cost cursor geriye taşınmaz',
);

const backwardBaseline = resolveOfflineBaselineMs({
  stateLastSimulated: trustedNow + DAY_MS,
  metaLastSimulated: trustedNow + HOUR_MS,
  stateLastSeen: trustedNow - HOUR_MS,
  nowMs: trustedNow,
});
assert(backwardBaseline === trustedNow - HOUR_MS, 'cihaz saati geri: future cursor kullanılmaz');

const originalDateNow = Date.now;
const serverClock = new ServerEconomyClock(trustedNow);
const beforeDeviceJump = serverClock.now();
Date.now = () => trustedNow + 365 * DAY_MS;
const afterDeviceForward = serverClock.now();
Date.now = () => trustedNow - 365 * DAY_MS;
const afterDeviceBackward = serverClock.now();
Date.now = originalDateNow;
assert(
  Math.abs(afterDeviceForward - beforeDeviceJump) < MINUTE_MS,
  'cihaz saati ileri: trusted clock sıçramaz',
);
assert(afterDeviceBackward >= afterDeviceForward, 'cihaz saati geri: trusted clock geriye gitmez');

const invalidElapsed = calculateOfflineElapsed(Number.NaN, Number.POSITIVE_INFINITY);
const invalidSimulation = calculateOfflineSimulationHours(Number.POSITIVE_INFINITY, 1);
const invalidAudit = buildTimeProgressionAudit({
  trustedNow: Number.NaN,
  savedAt: Number.POSITIVE_INFINITY,
  lastProcessedAt: Number.NEGATIVE_INFINITY,
  elapsedMs: Number.NaN,
  elapsedHours: Number.POSITIVE_INFINITY,
  cappedProgressHours: Number.NaN,
  costPeriods: Number.POSITIVE_INFINITY,
  deliveryTicksApplied: Number.NaN,
  transferTicksApplied: Number.POSITIVE_INFINITY,
  processedUntil: Number.NaN,
});
assert(!invalidElapsed.shouldApply, 'NaN timestamp progress üretmez');
assert(invalidSimulation.appliedSimulationHours === 0, 'Infinity simulation üretmez');
assert(
  Object.values(invalidAudit).every(
    (value) => value == null || (typeof value === 'number' && Number.isFinite(value)),
  ),
  'audit NaN/Infinity içermez',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
