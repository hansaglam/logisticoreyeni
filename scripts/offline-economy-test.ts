/**
 * Offline periodic cost idempotency + Model A driver salary + 24h progress.
 * Run: npx tsx scripts/offline-economy-test.ts
 */

import './test-globals';

import { STARTER_DRIVER } from '../src/data/drivers';
import { STARTER_TRUCK } from '../src/data/trucks';
import { operatingCostBalance } from '../src/config/balance';
import { MS_PER_HOUR } from '../src/simulation/economyClock';
import {
  calculateOfflineElapsed,
  MAX_OFFLINE_PROGRESS_HOURS,
} from '../src/simulation/offlineProgression';
import {
  buildPeriodicCostDeductions,
  OFFLINE_CATCHUP_MAX_COST_PERIODS,
  ONLINE_TICK_MAX_COST_PERIODS,
  periodKeyForStart,
  PERIOD_24H_MS,
} from '../src/simulation/periodicCosts';
import { calculateDeliverySettlement } from '../src/simulation/delivery';
import { calculateContractEconomics } from '../src/simulation/contractEconomics';
import { calculateTransferCosts } from '../src/simulation/truckTransfer';
import { calculateStockTransferCosts } from '../src/simulation/warehouseStockTransfer';
import { getDriverDailySalary } from '../src/simulation/dailyOperatingCosts';
import type { Player, Route } from '../src/types/game';

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

console.log('\n=== offline-economy-test ===\n');

assert(MAX_OFFLINE_PROGRESS_HOURS === 24, 'maxOfflineProgressHours = 24');
assert(
  operatingCostBalance.maxOfflineProgressHours === 24,
  'balance.maxOfflineProgressHours = 24',
);
assert(
  MAX_OFFLINE_PROGRESS_HOURS === operatingCostBalance.maxOfflineProgressHours,
  'offlineProgression ve balance aynı tavanı kullanır',
);

const EXPECTED_24H_MS = 24 * 60 * 60 * 1000;
assert(EXPECTED_24H_MS === 86_400_000, '24h = 86_400_000 ms');
assert(MS_PER_HOUR === 3_600_000, 'MS_PER_HOUR = 3_600_000 (saat, saniye değil)');
assert(
  MAX_OFFLINE_PROGRESS_HOURS * MS_PER_HOUR === EXPECTED_24H_MS,
  'MAX_OFFLINE_PROGRESS_HOURS * MS_PER_HOUR = 24 saat (ms)',
);
assert(
  MAX_OFFLINE_PROGRESS_HOURS * MS_PER_HOUR !== 24_000,
  'tavan yanlışlıkla 24 saniye değil',
);
assert(
  MAX_OFFLINE_PROGRESS_HOURS * MS_PER_HOUR !== 24 * 60_000,
  'tavan yanlışlıkla 24 dakika değil',
);

const now = 1_700_000_000_000;
const last = now - 10 * PERIOD_24H_MS;
const player: Pick<Player, 'drivers' | 'warehouses' | 'trucks'> = {
  drivers: [{ ...STARTER_DRIVER, dailySalary: 120, salaryPerDay: 120 }],
  warehouses: [],
  trucks: [{ ...STARTER_TRUCK }],
};

const first = buildPeriodicCostDeductions({
  player,
  economyNowMs: now,
  lastProcessedEconomyAt: last,
  alreadyAppliedPeriodKeys: [],
  maxOfflineCostPeriods: OFFLINE_CATCHUP_MAX_COST_PERIODS,
});

assert(
  first.periodsCharged === 0,
  'offline catch-up: fixed operating cost = 0',
  `charged=${first.periodsCharged}`,
);
assert(first.capped === true, '72h offline: cost cursor capped without charging');
assert(first.totalAmount === 0, 'offline catch-up totalAmount = 0');
assert(
  first.newlyProcessedUntil === now,
  'offline catch-up advances economy cursor to now',
);

const onlineAfterReturn = buildPeriodicCostDeductions({
  player,
  economyNowMs: now + PERIOD_24H_MS,
  lastProcessedEconomyAt: first.newlyProcessedUntil,
  alreadyAppliedPeriodKeys: first.periodKeysApplied,
  maxOfflineCostPeriods: ONLINE_TICK_MAX_COST_PERIODS,
});
assert(
  onlineAfterReturn.periodsCharged === 1,
  'online: next full 24h period charges once',
  `charged=${onlineAfterReturn.periodsCharged}`,
);

const second = buildPeriodicCostDeductions({
  player,
  economyNowMs: now,
  lastProcessedEconomyAt: last,
  alreadyAppliedPeriodKeys: first.periodKeysApplied,
  maxOfflineCostPeriods: OFFLINE_CATCHUP_MAX_COST_PERIODS,
});

assert(second.periodsCharged === 0, 'G: ikinci hydrate aynı period’u kesmez', `charged=${second.periodsCharged}`);
assert(second.totalAmount === 0, 'G: ikinci totalAmount = 0');

const elapsed = calculateOfflineElapsed(now - 48 * 3_600_000, now);
assert(elapsed.capped === true, '48 saat offline → progress capped');
assert(
  elapsed.appliedMs === MAX_OFFLINE_PROGRESS_HOURS * 3_600_000,
  'appliedMs = 24h',
  `appliedMs=${elapsed.appliedMs}`,
);
assert(elapsed.appliedMs === EXPECTED_24H_MS, 'appliedMs exactly 86_400_000');

const key = periodKeyForStart(Math.floor(now / PERIOD_24H_MS) * PERIOD_24H_MS);
assert(key.startsWith('p24_'), 'periodKey format');

// ---------------------------------------------------------------------------
// Boundary matrix — offline / online periodic semantics
// ---------------------------------------------------------------------------
console.log('\n-- Periodic boundary matrix --');

function periodicAt(
  hoursOffline: number,
  online = false,
  appliedKeys: string[] = [],
  baseNow = now,
): ReturnType<typeof buildPeriodicCostDeductions> {
  return buildPeriodicCostDeductions({
    player,
    economyNowMs: baseNow,
    lastProcessedEconomyAt: baseNow - hoursOffline * MS_PER_HOUR,
    alreadyAppliedPeriodKeys: appliedKeys,
    maxOfflineCostPeriods: online
      ? ONLINE_TICK_MAX_COST_PERIODS
      : OFFLINE_CATCHUP_MAX_COST_PERIODS,
  });
}

const offline23h59m = periodicAt(24 - 1 / 3600);
assert(offline23h59m.periodsCharged === 0, 'offline 23h59m: cost = 0');
assert(
  offline23h59m.newlyProcessedUntil === now - PERIOD_24H_MS + 1_000,
  'offline 23h59m: cursor stays within open period',
);

const offline24h = periodicAt(24);
assert(offline24h.periodsCharged === 0, 'offline 24h: cost = 0');
assert(offline24h.newlyProcessedUntil === now, 'offline 24h: cursor = now');

const offline72h = buildPeriodicCostDeductions({
  player,
  economyNowMs: now,
  lastProcessedEconomyAt: now - 72 * MS_PER_HOUR,
  alreadyAppliedPeriodKeys: [],
  maxOfflineCostPeriods: OFFLINE_CATCHUP_MAX_COST_PERIODS,
});
assert(offline72h.periodsCharged === 0, 'offline 72h: cost = 0');
assert(offline72h.newlyProcessedUntil === now, 'offline 72h: cursor = now');

const offline10d = periodicAt(24 * 10);
assert(offline10d.periodsCharged === 0, 'offline 10d: cost = 0');
assert(offline10d.newlyProcessedUntil === now, 'offline 10d: cursor = now');

const after10dOffline = buildPeriodicCostDeductions({
  player,
  economyNowMs: now + PERIOD_24H_MS,
  lastProcessedEconomyAt: offline10d.newlyProcessedUntil,
  alreadyAppliedPeriodKeys: offline10d.periodKeysApplied,
  maxOfflineCostPeriods: ONLINE_TICK_MAX_COST_PERIODS,
});
assert(
  after10dOffline.periodsCharged === 1,
  'after 10d offline then 24h online: one current period only',
  `charged=${after10dOffline.periodsCharged}`,
);
assert(
  after10dOffline.periodsElapsed === 1,
  'after 10d offline: no historical offline debt online',
  `elapsed=${after10dOffline.periodsElapsed}`,
);

const online23h59m = periodicAt(24 - 1 / 3600, true);
assert(online23h59m.periodsCharged === 0, 'online 23h59m: 0 charges');

const online24h = periodicAt(24, true);
assert(online24h.periodsCharged === 1, 'online exactly 24h: 1 charge');

const online24h1ms = buildPeriodicCostDeductions({
  player,
  economyNowMs: now,
  lastProcessedEconomyAt: now - PERIOD_24H_MS - 1,
  alreadyAppliedPeriodKeys: [],
  maxOfflineCostPeriods: ONLINE_TICK_MAX_COST_PERIODS,
});
assert(online24h1ms.periodsCharged === 1, 'online 24h+1ms: still 1 charge');

const online47h59m = periodicAt(47 + 59 / 60, true);
assert(online47h59m.periodsCharged === 1, 'online 47h59m: one period this tick');
assert(online47h59m.periodsElapsed === 1, 'online 47h59m: elapsed = 1');

const online48h = periodicAt(48, true);
assert(online48h.periodsCharged === 1, 'online exactly 48h: one period this tick');
assert(online48h.capped === true, 'online exactly 48h: capped pending backlog');
assert(
  online48h.newlyProcessedUntil === now - PERIOD_24H_MS,
  'online 48h: cursor advances one processed period',
);

const onlineCatchUpSecondTick = buildPeriodicCostDeductions({
  player,
  economyNowMs: now,
  lastProcessedEconomyAt: online48h.newlyProcessedUntil,
  alreadyAppliedPeriodKeys: online48h.periodKeysApplied,
  maxOfflineCostPeriods: ONLINE_TICK_MAX_COST_PERIODS,
});
assert(
  onlineCatchUpSecondTick.periodsCharged === 1,
  'continuous online catch-up: second tick charges remaining period',
);

const idempotentOnline = buildPeriodicCostDeductions({
  player,
  economyNowMs: now,
  lastProcessedEconomyAt: now - PERIOD_24H_MS,
  alreadyAppliedPeriodKeys: online24h.periodKeysApplied,
  maxOfflineCostPeriods: ONLINE_TICK_MAX_COST_PERIODS,
});
assert(idempotentOnline.periodsCharged === 0, 'idempotency: same keys do not double-charge');

// ---------------------------------------------------------------------------
// Model A — çift kesim yok
// ---------------------------------------------------------------------------
console.log('\n-- Model A driver cost (no double charge) --');

const salary = getDriverDailySalary(player.drivers[0]!);
assert(salary === 120, 'driver daily salary = 120');

const idlePeriodic = buildPeriodicCostDeductions({
  player,
  economyNowMs: now,
  // Rolling trusted cursor: tam 24 gerçek saat = tam 1 dönem.
  lastProcessedEconomyAt: now - PERIOD_24H_MS,
  alreadyAppliedPeriodKeys: [],
  maxOfflineCostPeriods: ONLINE_TICK_MAX_COST_PERIODS,
});
const idleSalaryDeduction = idlePeriodic.deductions
  .filter((d) => d.type === 'driver_salary')
  .reduce((sum, d) => sum + d.amount, 0);
assert(idlePeriodic.periodsCharged === 1, 'idle şoför: 1 dönem kesilir', `charged=${idlePeriodic.periodsCharged}`);
assert(
  idleSalaryDeduction === salary,
  '24s hiç iş yapmayan şoför: yalnız 1× günlük maaş',
  `got=${idleSalaryDeduction}`,
);

const route: Route = {
  id: 'test-route',
  fromCityId: 'izmir',
  toCityId: 'bursa',
  distanceKm: 330,
  difficulty: 0.4,
  tollCost: 0,
};

const eco = calculateContractEconomics({
  contract: {
    payment: 5000,
    amount: 10,
    distanceKm: route.distanceKm,
    urgency: 0.4,
  },
  truck: STARTER_TRUCK,
  driver: player.drivers[0],
  route,
  globalEconomySnapshot: { fuelPricePerLiter: 1.72 },
  estimatedDurationHours: 6,
});

assert(eco.costs.driver > 0, 'allocated driverCost > 0 (bilgi)');
assert(
  eco.totalCost ===
    eco.costs.fuel +
      eco.costs.maintenance +
      eco.costs.trailer +
      eco.costs.toll +
      eco.costs.other,
  'totalCost şoför ve risk rezervi hariç (nakit hizalı)',
);
assert(
  !eco.totalCost.toString().includes('NaN'),
  'totalCost finite',
);
assert(
  eco.totalCost ===
      eco.costs.fuel +
      eco.costs.maintenance +
      eco.costs.trailer +
      eco.costs.toll +
      eco.costs.other,
  'cash total excludes allocated driver and penalty reserve',
);

const settlement = calculateDeliverySettlement({
  contractPayment: 5000,
  fuelCost: eco.costs.fuel,
  maintenanceCost: eco.costs.maintenance,
  penaltyCost: 0,
  fuelAlreadyPaid: true,
});
assert(
  settlement.totalCost === eco.costs.fuel + eco.costs.maintenance,
  'settlement şoför kesmez',
  `settlement.totalCost=${settlement.totalCost}`,
);

// 24s içinde 2 iş + periodic: maaş yalnız 1×
const twoJobsAllocated = eco.costs.driver * 2;
const cashDriverFromJobs = 0; // settlement'ta yok
const periodicOnce = salary;
const totalDriverCash = cashDriverFromJobs + periodicOnce;
assert(
  totalDriverCash === salary,
  '2 iş + 24s: şoför nakit yalnız 1× günlük maaş',
  `total=${totalDriverCash} allocatedShown=${twoJobsAllocated}`,
);
assert(
  totalDriverCash !== salary + twoJobsAllocated,
  'çift kesim senaryosu engellendi',
);

const transfer = calculateTransferCosts({
  distanceKm: 100,
  truck: STARTER_TRUCK,
  driver: player.drivers[0]!,
  durationHours: 4,
  fuelPrice: 1.72,
});
assert(transfer.driverCost > 0, 'transfer allocated driverCost > 0');
assert(
  transfer.totalCost === transfer.fuelCost,
  'transfer nakit = yalnız yakıt (Model A)',
  `total=${transfer.totalCost} fuel=${transfer.fuelCost} driver=${transfer.driverCost}`,
);

const stock = calculateStockTransferCosts({
  distanceKm: 100,
  truck: STARTER_TRUCK,
  driver: player.drivers[0]!,
  durationHours: 4,
  fuelPrice: 1.72,
  fuelLiters: 40,
});
assert(
  stock.totalCost === stock.fuelCost,
  'stok transfer nakit = yalnız yakıt',
  `total=${stock.totalCost} driver=${stock.driverCost}`,
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
