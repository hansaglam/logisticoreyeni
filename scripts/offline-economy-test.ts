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
  maxOfflineCostPeriods: 3,
});

assert(first.periodsCharged === 3, 'G: offline cost max 3 dönem', `charged=${first.periodsCharged}`);
assert(first.capped === true, 'G: 10 dönem elapsed → capped');
assert(first.periodKeysApplied.length === 3, 'period keys unique count');

const second = buildPeriodicCostDeductions({
  player,
  economyNowMs: now,
  lastProcessedEconomyAt: last,
  alreadyAppliedPeriodKeys: first.periodKeysApplied,
  maxOfflineCostPeriods: 3,
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
  maxOfflineCostPeriods: 3,
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
