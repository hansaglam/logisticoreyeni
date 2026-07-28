/**
 * Global market snapshot determinism tests.
 * Run: npx tsx scripts/global-market-snapshot-test.ts
 */

import './test-globals';

import { CITIES } from '../src/data/cities';
import { DEFAULT_GLOBAL_ECONOMY, sanitizeFuelPricePerLiter } from '../src/simulation/economy';
import {
  buildGlobalEconomySnapshot,
  buildMarketSeed,
  createMarketSeededRng,
} from '../src/simulation/globalMarketSnapshot';
import { getMarketEpoch, resetEconomyClockForTests } from '../src/simulation/economyClock';

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

console.log('\n=== global-market-snapshot-test ===\n');
resetEconomyClockForTests();

const nowMs = 1_700_000_030_000;
const cities = CITIES.slice(0, 3).map((c) => structuredClone(c));

const snapNewPlayer = buildGlobalEconomySnapshot({
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  cities,
  activeEvents: [],
  nowMs,
});
const snapOldPlayer = buildGlobalEconomySnapshot({
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  cities,
  activeEvents: [],
  nowMs,
});

assert(
  snapNewPlayer.epoch === snapOldPlayer.epoch,
  'B: yeni ve eski oyuncu aynı epoch',
  `${snapNewPlayer.epoch} vs ${snapOldPlayer.epoch}`,
);
assert(
  snapNewPlayer.fuelPricePerLiter === snapOldPlayer.fuelPricePerLiter,
  'B: aynı temel yakıt fiyatı',
);

const cityId = cities[0]?.id ?? 'izmir';
const productId = Object.keys(cities[0]?.products ?? {})[0] ?? 'wheat';
const seed = buildMarketSeed(snapNewPlayer.epoch, cityId, productId);
const rng1 = createMarketSeededRng(seed);
const rng2 = createMarketSeededRng(seed);
assert(rng1() === rng2(), 'D: market seed deterministic');

const baseFuel = DEFAULT_GLOBAL_ECONOMY.fuelPrice;
assert(
  sanitizeFuelPricePerLiter(1529.4) === baseFuel,
  'H: $1529/L → canonical base (MAX 5.0’a sabitlenmez)',
  `got=${sanitizeFuelPricePerLiter(1529.4)} base=${baseFuel}`,
);
assert(
  sanitizeFuelPricePerLiter(1529.4) !== 5,
  'H: bozuk değer 5.0’a clamp edilmez',
);
assert(
  sanitizeFuelPricePerLiter(1.72) === 1.72,
  'H: canonical fuel price korunur',
);
assert(
  sanitizeFuelPricePerLiter(6.5, { fallback: 1.9 }) === 1.9,
  'H: last-valid fallback kullanılır',
  `got=${sanitizeFuelPricePerLiter(6.5, { fallback: 1.9 })}`,
);
assert(
  sanitizeFuelPricePerLiter(null, { fallback: 2.1 }) === 2.1,
  'H: null → last-valid',
);

assert(getMarketEpoch(nowMs) === snapNewPlayer.epoch, 'Epoch snapshot ile uyumlu');

// Determinism — iki oyuncu / iki save / iki açılış
const snapSaveA = buildGlobalEconomySnapshot({
  globalEconomy: { ...DEFAULT_GLOBAL_ECONOMY },
  cities: cities.map((c) => structuredClone(c)),
  activeEvents: [],
  nowMs,
});
const snapSaveB = buildGlobalEconomySnapshot({
  globalEconomy: { ...DEFAULT_GLOBAL_ECONOMY },
  cities: cities.map((c) => structuredClone(c)),
  activeEvents: [],
  nowMs,
});
assert(
  JSON.stringify(snapSaveA.cityMarketPrices) === JSON.stringify(snapSaveB.cityMarketPrices),
  'D: iki save aynı cityMarketPrices',
);
assert(snapSaveA.fuelPricePerLiter === snapSaveB.fuelPricePerLiter, 'D: iki save aynı fuel');
assert(
  JSON.stringify(snapNewPlayer.cityMarketPrices) === JSON.stringify(snapOldPlayer.cityMarketPrices),
  'D: iki oyuncu aynı base market prices',
);

const eventA = {
  id: 'e1',
  type: 'maintenance_campaign' as const,
  title: 'Bakım',
  description: 'test',
  startsAtDay: 1,
  endsAtDay: 2,
  durationDays: 2,
  startsAt: nowMs,
  endsAt: nowMs + 3_600_000,
  globalEpoch: snapNewPlayer.epoch,
  impact: { maintenanceCostMultiplier: 0.85 },
  severity: 'medium' as const,
  isActive: true,
};

const withEvent = buildGlobalEconomySnapshot({
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  cities,
  activeEvents: [eventA],
  nowMs,
});
assert(
  withEvent.modifiers.maintenanceMultiplier === 0.85,
  'E: event modifier ortak uygulanır',
  `got=${withEvent.modifiers.maintenanceMultiplier}`,
);
assert(
  withEvent.modifiers.fuelMultiplier === 1,
  'E: bakım kampanyası yakıta yayılmaz',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
