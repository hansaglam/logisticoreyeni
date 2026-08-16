/** TruckRefuelSheet render-loop regression audit. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import './test-globals';
import { CITIES } from '../src/data/cities';
import { buildGlobalEconomySnapshot } from '../src/simulation/globalMarketSnapshot';
import { isFuelPricePurchaseReady, resolveFuelPriceQuote } from '../src/simulation/fuelPriceQuote';
import { calculateTruckRefuelQuote } from '../src/utils/truckFuel';
import type { Truck } from '../src/types/game';

let passed = 0;
function check(condition: unknown, label: string): void {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ok ${label}`);
}
function makeTruck(id: string, currentFuelL: number): Truck {
  return {
    id, name: `Render Test ${id}`, capacity: 20, fuelConsumptionPerKm: 0.3,
    fuelTankCapacityL: 180, currentFuelL, speed: 70, reliability: 90,
    maintenanceCost: 0.1, comfort: 70, condition: 100, purchasePrice: 50_000,
    currentCityId: 'izmir', homeCityId: 'izmir', status: 'idle',
  };
}
function maximumLiters(cash: number, price: number, space: number): number {
  if (!Number.isFinite(price) || price <= 0 || cash <= 0) return 0;
  return Math.min(space, Math.floor((cash / price) * 1000) / 1000);
}

console.log('\nTruckRefuelSheet render-loop regression test');
const source = readFileSync(resolve(process.cwd(), 'src/components/TruckRefuelSheet.tsx'), 'utf8');
check(source.includes("if (!visible && Platform.OS !== 'ios') return null"), 'Android closed sheet unmounts; iOS keeps Modal for dismiss');
check(source.includes('lastTruckRef'), 'iOS dismiss keeps last truck so Modal is not torn down with visible=true');
check(!source.includes('useGameStore((state) => selectFuelPriceQuote(state))'), 'fresh-object Zustand selector removed');
check(source.includes('const cachedSnapshot = useGameStore') && source.includes('const marketSyncStatus = useGameStore'), 'store inputs use stable selectors');
check(source.includes('[cachedSnapshot, cachedSnapshotTrusted, marketLastSyncedAtMs, marketSyncStatus]'), 'quote dependencies are stable');
check(source.includes('initializedTruckIdRef.current === truck?.id'), 'truck reset is idempotent');
check(source.includes("console.warn('[truck-refuel-render-loop]'") && source.includes('renderCountRef.current > 20'), 'render warning is thresholded once');

const snapshot = buildGlobalEconomySnapshot({ cities: CITIES, nowMs: 1_800_000_000_000 });
const live = resolveFuelPriceQuote({ snapshot, trusted: true, syncStatus: 'online', development: false });
const cached = resolveFuelPriceQuote({ snapshot, trusted: true, syncStatus: 'offline-cache', development: false });
const unavailable = resolveFuelPriceQuote({ snapshot: null, trusted: false, syncStatus: 'error', development: false });
check(live.source === 'live' && isFuelPricePurchaseReady(live), 'live price');
check(cached.source === 'cached' && isFuelPricePurchaseReady(cached), 'cached price');
check(unavailable.source === 'unavailable' && !isFuelPricePurchaseReady(unavailable), 'unavailable price');

const price = live.pricePerLiter ?? 0;
const truckA = makeTruck('a', 70);
const truckB = makeTruck('b', 130);
const preset = calculateTruckRefuelQuote(truckA, 25, price);
const full = calculateTruckRefuelQuote(truckA, 110, price);
const max40 = calculateTruckRefuelQuote(truckA, maximumLiters(40, price, 110), price);
const max80 = calculateTruckRefuelQuote(truckA, maximumLiters(80, price, 110), price);
check(preset.litersToAdd === 25, '25 L preset');
check(full.newFuelL === 180, 'full fill');
check(max40.totalCost <= 40, 'maximum buy');
check(max80.litersToAdd >= max40.litersToAdd, 'cash/store update recomputes derived quote');
check(calculateTruckRefuelQuote(truckB, 25, price).newFuelL === 155, 'truck change recomputes quote');
const repeated = resolveFuelPriceQuote({ snapshot, trusted: true, syncStatus: 'online', development: false });
check(repeated.source === live.source && repeated.pricePerLiter === live.pricePerLiter, 'same inputs keep primitive values stable');
check(source.includes('setErrorMessage((current) => (current == null ? current : null))'), 'same error state is not written again');
console.log(`\nResult: ${passed} passed, 0 failed`);
