/**
 * Offline sabit işletme gideri kaldırıldı — regression.
 * Run: npx tsx scripts/offline-operating-cost-disabled-regression-test.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { operatingCostBalance } from '../src/config/balance';
import {
  formatOperatingCostEventLogMessage,
  formatOperatingCostNotificationMessage,
} from '../src/simulation/dailyOperatingCosts';
import {
  buildPeriodicCostDeductions,
  OFFLINE_CATCHUP_MAX_COST_PERIODS,
  ONLINE_TICK_MAX_COST_PERIODS,
  PERIOD_24H_MS,
} from '../src/simulation/periodicCosts';
import { STARTER_DRIVER } from '../src/data/drivers';
import { STARTER_TRUCK } from '../src/data/trucks';
import type { Player } from '../src/types/game';

const ROOT = process.cwd();

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

function readSrc(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function run(): void {
  console.log('\noffline-operating-cost-disabled-regression-test\n');

  assert(operatingCostBalance.maxOfflineChargeDays === 0, 'maxOfflineChargeDays = 0');
  assert(
    operatingCostBalance.notifyWhenMultipleDaysCharged === false,
    'multi-day operating-cost notify disabled',
  );

  const now = 1_700_000_000_000;
  const player: Pick<Player, 'drivers' | 'warehouses' | 'trucks'> = {
    drivers: [{ ...STARTER_DRIVER, dailySalary: 120, salaryPerDay: 120 }],
    warehouses: [],
    trucks: [{ ...STARTER_TRUCK }],
  };

  const periodicDefault = buildPeriodicCostDeductions({
    player,
    economyNowMs: now,
    lastProcessedEconomyAt: now - 10 * PERIOD_24H_MS,
    alreadyAppliedPeriodKeys: [],
  });
  assert(periodicDefault.periodsCharged === 0, 'default periodic deductions charge 0 periods');
  assert(periodicDefault.totalAmount === 0, 'default periodic totalAmount = 0');

  assert(
    formatOperatingCostNotificationMessage(
      { elapsedDays: 8, chargedDays: 3, amount: 1470 },
      (n) => `$${n}`,
    ) === '',
    'notification message always empty',
  );
  assert(
    formatOperatingCostEventLogMessage({ elapsedDays: 8, chargedDays: 3 }) === '',
    'event-log message always empty',
  );
  assert(
    !formatOperatingCostNotificationMessage(
      { elapsedDays: 8, chargedDays: 3, amount: 1470 },
      (n) => `$${n}`,
    ).includes('Oyuncu dostu'),
    'friendly-limit copy gone',
  );

  const storeSrc = readSrc('src/store/gameStore.ts');
  assert(
    OFFLINE_CATCHUP_MAX_COST_PERIODS === 0 && periodicDefault.periodsCharged === 0,
    'offline path uses zero-period canonical cap',
  );
  assert(
    periodicDefault.newlyProcessedUntil === now,
    'offline cursor advances without creating deferred debt',
  );
  assert(
    storeSrc.includes("dailyCostsApplied: false"),
    'offline summary forces dailyCostsApplied false',
  );
  assert(
    !storeSrc.includes("title: 'İşletme giderleri işlendi'"),
    'İşletme giderleri işlendi toast/event removed from store',
  );
  assert(
    storeSrc.includes('offlineProgressionActive') && storeSrc.includes("reason === 'offline_skip'"),
    'processDailyOperatingCosts guards offline skip',
  );

  const costSrc = readSrc('src/simulation/dailyOperatingCosts.ts');
  assert(!costSrc.includes('Oyuncu dostu limit'), 'Oyuncu dostu limit string removed');
  assert(
    costSrc.includes('formatOperatingCostNotificationMessage') &&
      costSrc.includes("return '';"),
    'notification formatter returns empty',
  );

  const balanceSrc = readSrc('src/config/balance.ts');
  assert(balanceSrc.includes('maxOfflineChargeDays: 0'), 'balance source maxOfflineChargeDays 0');

  // Online path still charges the bounded current period when not offline.
  const periodicOnline = buildPeriodicCostDeductions({
    player,
    economyNowMs: now,
    lastProcessedEconomyAt: now - PERIOD_24H_MS,
    alreadyAppliedPeriodKeys: [],
    maxOfflineCostPeriods: ONLINE_TICK_MAX_COST_PERIODS,
  });
  assert(
    periodicOnline.periodsCharged === 1 && periodicOnline.totalAmount > 0,
    'online periodic path still charges one eligible period',
  );
  assert(
    storeSrc.includes('get().updateDeliveries(hours)'),
    'offline/online advanceTime still advances deliveries',
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
