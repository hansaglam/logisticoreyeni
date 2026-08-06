/**
 * Warehouse upgrade functional regression.
 * Run: npx tsx scripts/warehouse-upgrade-regression-test.ts
 */
import './test-globals';

import fs from 'node:fs';
import path from 'node:path';

import { levelConfig } from '../src/config/levelConfig';
import { operatingCostBalance, warehouseBalance } from '../src/config/balance';
import {
  estimateWarehouseUpgradeCost,
  getWarehouseUpgradePreview,
  getWarehouseUpgradeTier,
  resolveWarehouseDailyOperatingCost,
} from '../src/utils/warehouseCalculations';
import type { City, Warehouse } from '../src/types/game';

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

function makeWarehouse(overrides: Partial<Warehouse> = {}): Warehouse {
  return {
    id: 'wh_izmir_1',
    cityId: 'izmir',
    capacityTons: 80,
    capacityTon: 80,
    upgradeTier: 1,
    warehouseType: 'standard',
    inventory: [
      {
        productId: 'fruit',
        quantity: 40,
        averageBuyPrice: 100,
        quality: 100,
      },
    ],
    ...overrides,
  };
}

function run(): void {
  console.log('\nwarehouse-upgrade-regression-test\n');

  assert(operatingCostBalance.maxOfflineChargeDays === 0, 'offline fixed costs stay disabled');

  const city = { warehouseCostModifier: 1 } as Pick<City, 'warehouseCostModifier'>;
  const warehouse = makeWarehouse();
  const money = 50_000;
  const preview = getWarehouseUpgradePreview(warehouse, city, money);

  assert(preview.currentLevel === 1, 'level 1 warehouse');
  assert(preview.nextLevel === 2, 'next level is 2');
  assert(preview.isValid, 'preview is valid');
  assert(!preview.isMaxLevel, 'not max level');
  assert(preview.canAfford, 'can afford with 50k');
  assert(
    preview.nextCapacity === preview.currentCapacity + levelConfig.warehouseUnlocks.mediumUpgradeCapacity,
    'capacity gain matches config',
  );
  assert(
    (preview.nextDailyCost ?? 0) > preview.currentDailyCost,
    'daily cost increases after upgrade',
  );
  assert(
    preview.upgradeCost === estimateWarehouseUpgradeCost(city, warehouse.cityId),
    'upgrade cost matches estimate helper',
  );
  assert(preview.upgradeCost === preview.upgradePrice, 'upgradeCost aliases upgradePrice');

  const stockQty = warehouse.inventory?.[0]?.quantity ?? 0;
  assert(stockQty === 40, 'existing stock baseline');

  // Simulate immutable upgrade result shape
  const upgraded: Warehouse = {
    ...warehouse,
    capacityTons: preview.nextCapacity!,
    capacityTon: preview.nextCapacity!,
    upgradeTier: preview.nextLevel!,
    dailyOperatingCost: preview.nextDailyCost!,
  };
  assert(upgraded.upgradeTier === 2, 'level 1 → 2');
  assert(upgraded.capacityTons === 120, '80 + 40 capacity');
  assert(upgraded.inventory?.[0]?.quantity === 40, 'stock preserved');
  assert(upgraded.cityId === 'izmir', 'city preserved');
  assert(upgraded.warehouseType === 'standard', 'type preserved');
  assert(upgraded.id === warehouse.id, 'id preserved');
  assert(getWarehouseUpgradeTier(upgraded) === 2, 'tier helper reads upgraded level');

  const occupancyBefore = 40 / 80;
  const occupancyAfter = 40 / (upgraded.capacityTons ?? 1);
  assert(occupancyAfter < occupancyBefore, 'occupancy decreases after capacity up');

  const poor = getWarehouseUpgradePreview(warehouse, city, 100);
  assert(!poor.canAfford, 'insufficient funds detected');
  assert(poor.failureReason === 'insufficient-funds', 'insufficient-funds reason');
  assert(poor.missingMoney > 0, 'missing money > 0');

  const maxed = makeWarehouse({
    upgradeTier: levelConfig.warehouseUnlocks.maxUpgradeTier,
    capacityTons: 180,
  });
  const maxPreview = getWarehouseUpgradePreview(maxed, city, money);
  assert(maxPreview.isMaxLevel, 'max level detected');
  assert(maxPreview.nextLevel == null, 'no next level at max');

  const cost = warehouseBalance.baseOpenCost * warehouseBalance.upgradeCostRatio;
  assert(estimateWarehouseUpgradeCost(city) === Math.round(cost), 'upgrade cost from balance');

  const cardSrc = readSrc('src/components/warehouse/OwnedWarehouseCard.tsx');
  assert(cardSrc.includes('onUpgrade'), 'card receives onUpgrade');
  assert(cardSrc.includes('handleUpgradePress'), 'upgrade press wired');
  assert(!cardSrc.includes('onUpgrade: _onUpgrade'), 'onUpgrade no longer discarded');
  assert(cardSrc.includes('styles.upgradeBtn'), 'upgrade button style present');

  const dialogSrc = readSrc('src/components/ui/AppDialog.tsx');
  assert(dialogSrc.includes('queueMicrotask'), 'nested dialog safe dismiss');
  assert(
    dialogSrc.includes('handleDismiss();\n                    // Nested dialog') ||
      dialogSrc.includes('queueMicrotask(() => fn())'),
    'action dismiss-before-press',
  );

  const storeSrc = readSrc('src/store/gameStore.ts');
  assert(storeSrc.includes('upgradeInProgressWarehouseIds'), 'double-tap guard');
  assert(storeSrc.includes('[warehouse-upgrade]'), 'dev upgrade log');
  assert(storeSrc.includes("reason: 'offline_skip'") || storeSrc.includes('maxOfflineCostPeriods: 0'), 'offline costs stay off');
  assert(storeSrc.includes('upgradeTier: nextTier'), 'store writes upgradeTier');
  assert(storeSrc.includes('dailyOperatingCost: nextDailyCost'), 'store writes daily cost');

  const screenSrc = readSrc('src/screens/WarehouseScreen.tsx');
  assert(screenSrc.includes('Depo Yükseltme'), 'confirm modal title');
  assert(screenSrc.includes('Bakiye yetersiz') || screenSrc.includes('Bakiye Yetersiz'), 'insufficient funds UX');
  assert(screenSrc.includes('onUpgrade={handleUpgrade}'), 'screen wires upgrade');

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run();
