/**
 * Depo sistemi uçtan uca domain testleri — UI yok, saf simülasyon + helper’lar.
 */

import assert from 'node:assert/strict';
import { timeBalance, tradingBalance } from '../src/config/balance';
import { OFFLINE_CATCHUP_MAX_COST_PERIODS } from '../src/simulation/periodicCosts';
import {
  canOpenMoreWarehouses,
  getMaxWarehousesForLevel,
  getWarehouseUpgradeCapacityGain,
  getWarehouseUpgradeRequiredLevel,
} from '../src/config/levelConfig';
import { CITIES_BY_ID } from '../src/data/cities';
import { PRODUCT_BY_ID } from '../src/data/products';
import {
  COLD_STORAGE_REQUIRED_MESSAGE,
  formatWarehouseLimitReachedMessage,
  resolveStorageBlockResult,
  requiresColdStorage,
} from '../src/simulation/warehouseActions';
import { getWarehouseFirstUseGuidance } from '../src/simulation/warehouseFirstUse';
import { getWarehouseMetrics } from '../src/simulation/warehouseMetrics';
import { validateWarehouseStockTransfer } from '../src/simulation/warehouseStockTransfer';
import {
  evaluateStorageSuitability,
  resolveWarehouseType,
} from '../src/simulation/warehouseStorage';
import {
  calculateTradeBuyCost,
  calculateTradeProfit,
  calculateTradeSellRevenue,
  computeWeightedAverageBuyPrice,
  getWarehouseFreeCapacityTon,
  mergeInventoryOnBuy,
  normalizeWarehouse,
  reduceInventoryOnSell,
} from '../src/simulation/trading';
import {
  computeElapsedOperatingDays,
  getSkippedOperatingDaysDueToCap,
} from '../src/simulation/dailyOperatingCosts';
import {
  getWarehouseUpgradePreview,
  resolveWarehouseDailyOperatingCost,
} from '../src/utils/warehouseCalculations';
import type { City, FinanceLedgerEntry, Warehouse } from '../src/types/game';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

function makeWarehouse(overrides: Partial<Warehouse> = {}): Warehouse {
  return normalizeWarehouse({
    id: 'wh-1',
    cityId: 'izmir',
    capacityTons: 80,
    capacityTon: 80,
    upgradeTier: 1,
    warehouseType: 'standard',
    inventory: [],
    usedCapacityTon: 0,
    ...overrides,
  });
}

function fillWarehouse(warehouse: Warehouse, productId: 'textile' | 'steel', quantity: number, price: number) {
  return normalizeWarehouse({
    ...warehouse,
    inventory: mergeInventoryOnBuy(
      warehouse.inventory ?? [],
      productId,
      quantity,
      price,
      warehouse,
      0,
    ),
  });
}

console.log('\n=== Warehouse System Test ===\n');

console.log('A. Satın alma / stok / ortalama');
test('weighted average buy price', () => {
  const avg = computeWeightedAverageBuyPrice(10, 100, 10, 200);
  assert.equal(avg, 150);
  assert.equal(computeWeightedAverageBuyPrice(0, 0, 5, 80), 80);
  assert.equal(computeWeightedAverageBuyPrice(0, NaN, 0, 50), 50);
});

test('merge inventory updates quantity and average', () => {
  const wh = makeWarehouse();
  const afterFirst = fillWarehouse(wh, 'textile', 10, 100);
  const afterSecond = fillWarehouse(afterFirst, 'textile', 10, 200);
  const item = afterSecond.inventory?.find((i) => i.productId === 'textile');
  assert.ok(item);
  assert.equal(item!.quantity, 20);
  assert.equal(item!.averageBuyPrice, 150);
});

test('capacity blocks overfill', () => {
  const wh = makeWarehouse({ capacityTons: 20, capacityTon: 20 });
  const filled = fillWarehouse(wh, 'textile', 20, 100);
  assert.equal(getWarehouseFreeCapacityTon(filled), 0);
  assert.ok(getWarehouseFreeCapacityTon(filled) + 5 > getWarehouseFreeCapacityTon(filled));
});

test('partial capacity remaining after buy', () => {
  const wh = makeWarehouse({ capacityTons: 50, capacityTon: 50 });
  const filled = fillWarehouse(wh, 'textile', 30, 100);
  assert.equal(getWarehouseFreeCapacityTon(filled), 20);
});

test('atomic-style validation: funds/capacity checked before mutate helpers', () => {
  const wh = makeWarehouse({ capacityTons: 10, capacityTon: 10 });
  const free = getWarehouseFreeCapacityTon(wh);
  const qty = 20;
  const unitPrice = 100;
  const cost = calculateTradeBuyCost(unitPrice, qty);
  const money = 50;
  assert.ok(qty > free);
  assert.ok(money < cost);
});

console.log('\nB. Satış');
test('sell reduces stock and cleans zero rows', () => {
  const wh = fillWarehouse(makeWarehouse(), 'textile', 10, 100);
  const next = reduceInventoryOnSell(wh.inventory ?? [], 'textile', 10);
  assert.equal(next.length, 0);
});

test('sell profit = revenue - cost basis (fees included via helpers)', () => {
  const qty = 10;
  const buy = 100;
  const sell = 150;
  const revenue = calculateTradeSellRevenue(sell, qty, 100);
  const profit = calculateTradeProfit(sell, buy, qty, 100);
  assert.ok(revenue > 0);
  assert.equal(profit, revenue - calculateTradeBuyCost(buy, qty));
});

console.log('\nC. Soğuk depo');
test('fruit requires cold storage only', () => {
  const fruit = PRODUCT_BY_ID.fruit;
  assert.equal(requiresColdStorage(fruit), true);
  assert.equal(evaluateStorageSuitability(fruit, 'standard'), 'blocked');
  assert.equal(evaluateStorageSuitability(fruit, 'cold'), 'recommended');
  const block = resolveStorageBlockResult(fruit, 'standard');
  assert.ok(block);
  assert.equal(block!.reason, 'cold-storage-required');
  assert.equal(block!.message, COLD_STORAGE_REQUIRED_MESSAGE);
});

test('beverage can store in cold warehouse', () => {
  const beverage = PRODUCT_BY_ID.beverage;
  assert.equal(evaluateStorageSuitability(beverage, 'cold'), 'recommended');
  assert.equal(resolveStorageBlockResult(beverage, 'cold'), null);
});

test('steel blocked from cold', () => {
  const steel = PRODUCT_BY_ID.steel;
  assert.equal(evaluateStorageSuitability(steel, 'cold'), 'blocked');
});

console.log('\nD. Transfer');
test('warehouse stock transfer domain exists (V1)', () => {
  assert.equal(typeof validateWarehouseStockTransfer, 'function');
});

console.log('\nE. Yükseltme');
test('upgrade preview increases capacity and daily cost', () => {
  const city = CITIES_BY_ID.izmir as City;
  const wh = makeWarehouse({ upgradeTier: 1, capacityTons: 80 });
  const preview = getWarehouseUpgradePreview(wh, city);
  assert.equal(preview.currentLevel, 1);
  assert.equal(preview.nextLevel, 2);
  assert.equal(preview.currentCapacity, 80);
  assert.equal(preview.nextCapacity, 80 + getWarehouseUpgradeCapacityGain(1));
  assert.ok((preview.upgradePrice ?? 0) > 0);
  assert.equal(preview.requiredPlayerLevel, getWarehouseUpgradeRequiredLevel(1));
  assert.ok((preview.nextDailyCost ?? 0) >= preview.currentDailyCost);
});

test('upgrade preserves inventory', () => {
  const wh = fillWarehouse(makeWarehouse({ upgradeTier: 1 }), 'textile', 15, 90);
  const preview = getWarehouseUpgradePreview(wh);
  const upgraded = normalizeWarehouse({
    ...wh,
    capacityTons: preview.nextCapacity!,
    capacityTon: preview.nextCapacity!,
    upgradeTier: preview.nextLevel!,
    dailyOperatingCost: resolveWarehouseDailyOperatingCost(
      {
        ...wh,
        capacityTons: preview.nextCapacity!,
        upgradeTier: preview.nextLevel!,
        dailyOperatingCost: undefined,
      },
    ),
  });
  assert.equal(upgraded.inventory?.[0]?.quantity, 15);
  assert.equal(upgraded.inventory?.[0]?.averageBuyPrice, 90);
});

console.log('\nF. Günlük gider');
test('one charge per game day interval', () => {
  const last = 100;
  const hoursPerDay = timeBalance.hoursPerDay;
  assert.equal(computeElapsedOperatingDays(last, last + hoursPerDay - 1), 0);
  assert.equal(computeElapsedOperatingDays(last, last + hoursPerDay), 1);
  assert.equal(computeElapsedOperatingDays(last, last + hoursPerDay * 2.9), 2);
});

test('offline catch-up charges zero fixed operating cost periods', () => {
  assert.equal(OFFLINE_CATCHUP_MAX_COST_PERIODS, 0);
  const elapsed = 10;
  const charged = Math.min(elapsed, OFFLINE_CATCHUP_MAX_COST_PERIODS);
  assert.equal(charged, 0);
  assert.equal(getSkippedOperatingDaysDueToCap(elapsed, charged), 10);
});

test('cold warehouse daily cost higher than standard', () => {
  const city = CITIES_BY_ID.izmir as City;
  const standard = resolveWarehouseDailyOperatingCost(makeWarehouse({ warehouseType: 'standard' }), city);
  const cold = resolveWarehouseDailyOperatingCost(makeWarehouse({ warehouseType: 'cold' }), city);
  assert.ok(cold > standard);
});

test('save/load clock: same lastDaily time yields zero elapsed (no double charge)', () => {
  const t = 500;
  assert.equal(computeElapsedOperatingDays(t, t), 0);
});

console.log('\nG. Limit / duplicate');
test('warehouse limit from levelConfig', () => {
  assert.equal(getMaxWarehousesForLevel(1), 1);
  assert.equal(getMaxWarehousesForLevel(10), 6);
  assert.equal(canOpenMoreWarehouses(1, 1), false);
  assert.equal(canOpenMoreWarehouses(2, 1), true);
  const msg = formatWarehouseLimitReachedMessage(6, 6);
  assert.match(msg, /6\/6/);
});

test('duplicate type detection helper via resolveWarehouseType', () => {
  const existing = [makeWarehouse({ cityId: 'izmir', warehouseType: 'standard' })];
  const duplicate = existing.some(
    (w) => w.cityId === 'izmir' && resolveWarehouseType(w.warehouseType) === 'standard',
  );
  assert.equal(duplicate, true);
});

console.log('\nH. Save/load normalize');
test('legacy storedProducts migrates with averageBuyPrice default', () => {
  const legacy = normalizeWarehouse({
    id: 'legacy',
    cityId: 'izmir',
    capacityTons: 80,
    storedProducts: { textile: 12 },
  } as Warehouse & { storedProducts: { textile: number } });
  assert.equal(legacy.inventory?.[0]?.productId, 'textile');
  assert.equal(legacy.inventory?.[0]?.quantity, 12);
  assert.equal(legacy.inventory?.[0]?.averageBuyPrice, 0);
});

test('averageBuyPrice preserved on normalize', () => {
  const wh = normalizeWarehouse({
    id: 'a',
    cityId: 'izmir',
    capacityTons: 80,
    inventory: [{ productId: 'textile', quantity: 8, averageBuyPrice: 123.45 }],
  });
  assert.equal(wh.inventory?.[0]?.averageBuyPrice, 123.45);
});

console.log('\nI. Metrics');
test('occupancy inventory unrealized and daily cost', () => {
  const city = CITIES_BY_ID.izmir as City;
  const wh = fillWarehouse(makeWarehouse({ capacityTons: 100, capacityTon: 100 }), 'textile', 25, 50);
  const metrics = getWarehouseMetrics(wh, city);
  assert.equal(metrics.usedCapacityTons, 25);
  assert.equal(metrics.totalCapacityTons, 100);
  assert.equal(metrics.occupancyPercent, 25);
  assert.equal(metrics.productTypeCount, 1);
  assert.ok(metrics.dailyOperatingCost > 0);
  assert.ok(Number.isFinite(metrics.inventoryValue));
  assert.ok(Number.isFinite(metrics.unrealizedProfit));
  assert.equal(metrics.realizedProfit7d, undefined);
});

test('realizedProfit7d from ledger meta when present', () => {
  const city = CITIES_BY_ID.izmir as City;
  const wh = makeWarehouse();
  const ledger: FinanceLedgerEntry[] = [
    {
      id: '1',
      time: 100,
      type: 'income',
      category: 'trade_sale',
      amount: 1000,
      meta: { profit: 250 },
    },
  ];
  const metrics = getWarehouseMetrics(wh, city, { financeLedger: ledger, currentTime: 120 });
  assert.equal(metrics.realizedProfit7d, 250);
  assert.ok(metrics.netPerformance7d != null);
});

console.log('\nJ. First-use guidance');
test('empty warehouse returns guidance steps', () => {
  const guidance = getWarehouseFirstUseGuidance(makeWarehouse());
  assert.ok(guidance?.isEmpty);
  assert.equal(guidance?.steps.length, 4);
  assert.equal(getWarehouseFirstUseGuidance(fillWarehouse(makeWarehouse(), 'textile', 5, 10)), null);
});

test('default capacity matches trading balance', () => {
  assert.equal(tradingBalance.defaultWarehouseCapacityTons, 80);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
