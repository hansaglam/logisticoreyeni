/**
 * World Events Phase 2 — smoke test harness.
 * Run: npx tsx scripts/world-events-smoke-test.ts
 */

import { readFileSync } from 'node:fs';

import { MAX_ACTIVE_WORLD_EVENTS } from '../src/data/worldEvents';
import {
  applyWorldEventImpactToContract,
  applyWorldEventImpactToFuelPrice,
  applyWorldEventImpactToProductPrice,
  expireOldWorldEvents,
  forceCreateWorldEvent,
  gameDayFromTime,
  generateWorldEventsForDay,
  getActiveWorldEvents,
  getProductPriceEventMultiplier,
  getWorldEventSummary,
  normalizeWorldEventsState,
  processWorldEventsForDayRange,
} from '../src/simulation/worldEvents';
import type { Contract, WorldEvent } from '../src/types/game';

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

console.log('\n=== World Events Phase 2 Smoke Test ===\n');

console.log('1. Yeni oyun / default state');
const legacy = normalizeWorldEventsState(undefined, 1);
assert(legacy.worldEvents.length === 0, 'worldEvents yokken [] default');
assert(legacy.worldEventsVersion === 1, 'worldEventsVersion = 1');
assert(legacy.lastWorldEventGeneratedDay === 0, 'lastWorldEventGeneratedDay = 0');

const calmSummary = getWorldEventSummary([]);
assert(calmSummary.isCalm === true, 'aktif olay yok → isCalm');
assert(calmSummary.headline === 'Piyasa sakin', 'headline = Piyasa sakin');

console.log('\n2. Gün geçişi / üretim');
let events: WorldEvent[] = [];
const seedKey = 'SmokeTestCo';
let maxActiveSeen = 0;
let anyGenerated = false;

for (let day = 1; day <= 14; day += 1) {
  const before = events.length;
  events = generateWorldEventsForDay({ worldEvents: events, currentDay: day, seedKey });
  if (events.length > before) anyGenerated = true;
  const active = getActiveWorldEvents(events, day);
  maxActiveSeen = Math.max(maxActiveSeen, active.length);
  assert(active.length <= MAX_ACTIVE_WORLD_EVENTS, `gün ${day}: aktif <= 4`, `count=${active.length}`);
}

assert(anyGenerated, '14 günde en az bir olay üretildi');
assert(maxActiveSeen > 0, 'en az bir aktif olay görüldü', `maxActive=${maxActiveSeen}`);

const rangeResult = processWorldEventsForDayRange({
  worldEvents: [],
  fromDay: 1,
  toDay: 5,
  seedKey: 'RangeTest',
});
assert(rangeResult.lastWorldEventGeneratedDay === 5, 'day range lastGeneratedDay = 5');

const expiredEvent: WorldEvent = {
  id: 'we_old',
  type: 'road_work',
  title: 'Eski olay',
  description: 'test',
  startsAtDay: 1,
  endsAtDay: 2,
  durationDays: 2,
  impact: {},
  severity: 'low',
  isActive: true,
};
const expired = expireOldWorldEvents([expiredEvent], 5);
assert(expired.length === 0, 'süresi dolan olay gün 5te temizlendi');

console.log('\n3. Debug force create');
const fuelEvent = forceCreateWorldEvent('fuel_crisis', 3);
assert(fuelEvent !== null, 'forceCreateWorldEvent fuel_crisis');
if (fuelEvent) {
  assert(fuelEvent.impact.fuelPriceMultiplier != null, 'fuel_crisis fuel multiplier var');
  assert(
    (fuelEvent.impact.fuelPriceMultiplier ?? 1) >= 1.15,
    'fuel multiplier >= 1.15',
    String(fuelEvent.impact.fuelPriceMultiplier),
  );
}

const harvest = forceCreateWorldEvent('harvest_surplus', 3, 'antalya', 'fruit');
assert(harvest?.cityId === 'antalya', 'harvest_surplus antalya');
assert(harvest?.productId === 'fruit', 'harvest_surplus fruit');

console.log('\n4. Market fiyat / trade parity');
const basePrice = 1000;
const priceHistory = [950, 980, 1000];
const fruitSurplus = forceCreateWorldEvent('harvest_surplus', 3, 'antalya', 'fruit')!;
const activeForMarket = [fruitSurplus];

const adjustedFruit = applyWorldEventImpactToProductPrice(
  basePrice,
  'fruit',
  'antalya',
  activeForMarket,
  3,
);
assert(adjustedFruit < basePrice, 'meyve bolluğu fiyatı düşürür', `${adjustedFruit} vs ${basePrice}`);
assert(
  getProductPriceEventMultiplier('fruit', 'antalya', activeForMarket, 3) < 1,
  'fruit multiplier < 1',
);

const uiDisplayPrice = adjustedFruit;
const tradePrice = applyWorldEventImpactToProductPrice(
  basePrice,
  'fruit',
  'antalya',
  activeForMarket,
  gameDayFromTime(48),
);
assert(tradePrice === uiDisplayPrice, 'trade fiyatı UI displayPrice ile aynı');
assert(priceHistory.length === 3 && priceHistory[2] === 1000, 'priceHistory array dokunulmadı');

console.log('\n5. Yakıt');
const baseFuel = 1.2;
const fuelCrisis = forceCreateWorldEvent('fuel_crisis', 3)!;
const adjustedFuel = applyWorldEventImpactToFuelPrice(baseFuel, [fuelCrisis]);
assert(adjustedFuel > baseFuel, 'yakıt krizi fiyat artırır', `${adjustedFuel} vs ${baseFuel}`);
assert(adjustedFuel <= baseFuel * 1.35, 'yakıt max +35% clamp');

console.log('\n6. Contract impact');
const portEvent = forceCreateWorldEvent('port_congestion', 3, 'istanbul')!;
const roadEvent = forceCreateWorldEvent('road_work', 3, 'ankara')!;
const contract = {
  id: 'c1',
  originCityId: 'istanbul',
  destinationCityId: 'ankara',
  productId: 'steel',
  payment: 10_000,
} as Contract;

const portAdj = applyWorldEventImpactToContract(contract, [portEvent], 10_000, 20);
assert(portAdj.durationMultiplier > 1, 'liman yoğunluğu süre artırır');
assert(portAdj.paymentMultiplier > 1, 'liman yoğunluğu ödeme artırır');
assert(portAdj.labels.includes('Yoğunluk Bonusu'), 'liman label Yoğunluk Bonusu');

const roadAdj = applyWorldEventImpactToContract(contract, [roadEvent], 10_000, 20);
assert(roadAdj.durationMultiplier > 1, 'yol çalışması süre artırır');
assert(roadAdj.paymentMultiplier === 1, 'yol çalışması ödeme değiştirmez');

const paymentBonus = 10_000 * portAdj.paymentMultiplier - 10_000;
assert(paymentBonus > 0, 'baz ödeme + olay bonusu pozitif', String(paymentBonus));

console.log('\n7. Save/load');
const activeSaved = normalizeWorldEventsState([fuelCrisis, portEvent], 3);
assert(activeSaved.worldEvents.length === 2, 'aktif olaylar normalize edildi');

const loadedExpired = normalizeWorldEventsState([expiredEvent], 5);
assert(loadedExpired.worldEvents.length === 0, 'expired load sonrası temiz');

const legacyLoad = normalizeWorldEventsState(null, 10);
assert(legacyLoad.worldEvents.length === 0, 'eski save (null) açılır');

const roundtrip = normalizeWorldEventsState(activeSaved.worldEvents, 3);
assert(roundtrip.worldEvents.length === 2, 'roundtrip aktif korundu');

console.log('\n8. Production debug guard (statik)');
const gameStoreSource = readFileSync('src/store/gameStore.ts', 'utf8');
assert(gameStoreSource.includes('if (!__DEV__)'), 'forceGenerateWorldEvent __DEV__ guard var');
assert(gameStoreSource.includes('getEffectiveTradeUnitPrice'), 'trade effective price helper var');

const moreScreenSource = readFileSync('src/screens/MoreScreen.tsx', 'utf8');
assert(moreScreenSource.includes("route === 'debug' && __DEV__"), 'debug route __DEV__ guard');

console.log(`\n=== Sonuç: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
