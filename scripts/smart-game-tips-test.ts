/**
 * Akıllı Oyun İpuçları — seçim / rotasyon / navigasyon.
 * Run: npx tsx scripts/smart-game-tips-test.ts
 */

import assert from 'node:assert/strict';

import { GAME_TIPS, type GameTipDefinition } from '../src/data/gameTips';
import {
  getCriticalTips,
  getEligibleTips,
  pickNextTip,
  resolveTipNavigation,
  SMART_TIP_CRITICAL_ROTATION_MS,
  SMART_TIP_ROTATION_MS,
  type SmartTipContext,
} from '../src/simulation/smartGameTips';

function baseContext(overrides: Partial<SmartTipContext> = {}): SmartTipContext {
  return {
    minFuelPercent: 80,
    idleTruckCount: 0,
    trucksWithoutDriver: 0,
    warehouseFillRatio: 0.2,
    hasUrgentDelivery: false,
    accountLinked: true,
    reputation: 60,
    minTruckCondition: 90,
    trailerCount: 1,
    sessionAgeMs: 60 * 60 * 1000,
    money: 50_000,
    ...overrides,
  };
}

console.log('\n=== Smart Game Tips Test ===\n');

const categories = new Set(GAME_TIPS.map((tip) => tip.category));
for (const required of [
  'onboarding',
  'trucks',
  'drivers',
  'fuel',
  'contracts',
  'warehouses',
  'trailers',
  'market',
  'vehicle_marketplace',
  'reputation',
  'level',
  'cloud_save',
  'leaderboard',
  'finance',
  'route_delivery',
] as const) {
  assert.ok(categories.has(required), `category present: ${required}`);
}
console.log('  ✓ tip categories');

const normal = getEligibleTips(baseContext());
assert.ok(normal.length >= 5, 'normal tips eligible');
assert.equal(getCriticalTips(normal).length, 0, 'no critical in calm state');

const first = pickNextTip(normal, null);
assert.ok(first, 'first tip selected');
const second = pickNextTip(normal, first!.tip.id);
assert.ok(second, 'second tip selected');
assert.notEqual(second!.tip.id, first!.tip.id, 'no consecutive duplicate');
assert.equal(first!.rotationMs, SMART_TIP_ROTATION_MS, 'normal rotation 10s');
console.log('  ✓ normal rotation / no duplicate');

const lowFuel = getEligibleTips(baseContext({ minFuelPercent: 10 }));
const fuelPick = pickNextTip(lowFuel, null);
assert.ok(fuelPick?.isCritical, 'low fuel is critical');
assert.equal(fuelPick?.tip.condition, 'low_fuel', 'low fuel tip condition');
assert.equal(fuelPick?.tip.targetRoute, 'fleet', 'fuel → fleet');
assert.equal(fuelPick?.rotationMs, SMART_TIP_CRITICAL_ROTATION_MS, 'critical rotation');
console.log('  ✓ low fuel priority');

const unlinked = getEligibleTips(baseContext({ accountLinked: false }));
const accountPick = pickNextTip(unlinked, null);
assert.ok(accountPick?.isCritical, 'unlinked account critical');
assert.ok(
  accountPick?.tip.condition === 'account_unlinked',
  'account tip condition',
);
console.log('  ✓ account unlinked priority');

const fullWarehouse = getEligibleTips(baseContext({ warehouseFillRatio: 1 }));
const warehousePick = pickNextTip(fullWarehouse, null);
assert.equal(warehousePick?.tip.condition, 'warehouse_full', 'warehouse tip');
assert.equal(warehousePick?.tip.targetRoute, 'warehouse', 'warehouse route');
console.log('  ✓ warehouse full priority');

const noDriver = getEligibleTips(baseContext({ trucksWithoutDriver: 1 }));
const driverPick = pickNextTip(noDriver, null);
assert.equal(driverPick?.tip.condition, 'truck_without_driver', 'driver tip');
console.log('  ✓ truck without driver priority');

// Kritik çözülünce normal rotasyona dönüş
const afterFuel = getEligibleTips(baseContext({ minFuelPercent: 80 }));
const recovered = pickNextTip(afterFuel, 'fuel-refill');
assert.ok(recovered && !recovered.isCritical, 'critical cleared → normal');
console.log('  ✓ critical then normal rotation');

assert.deepEqual(resolveTipNavigation('fleet'), { tab: 'fleet' });
assert.deepEqual(resolveTipNavigation('warehouse'), {
  tab: 'more',
  moreSubRoute: 'warehouse',
});
assert.deepEqual(resolveTipNavigation('account'), {
  tab: 'more',
  moreSubRoute: null,
});
assert.deepEqual(resolveTipNavigation('contracts'), { tab: 'contracts' });
assert.deepEqual(resolveTipNavigation('market'), { tab: 'market' });
assert.equal(resolveTipNavigation(null), null);
console.log('  ✓ tip navigation targets');

for (const tip of GAME_TIPS as readonly GameTipDefinition[]) {
  assert.ok(tip.message.tr.length > 0, `message: ${tip.id}`);
  assert.ok(tip.message.tr.length <= 120, `short message: ${tip.id}`);
}
console.log('  ✓ messages present and compact');

console.log('\n✅ ALL PASS\n');
