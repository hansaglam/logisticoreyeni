/**
 * Market history fetch + materialize performance guards.
 * Run: npx tsx scripts/market-history-performance-regression-test.ts
 */
import './test-globals';

import { readFileSync } from 'node:fs';

import { CITIES } from '../src/data/cities';
import {
  buildGlobalMarketHistoryPriceIndex,
  buildGlobalEconomySnapshot,
  materializeSnapshotCities,
} from '../src/simulation/globalMarketSnapshot';
import type { GlobalMarketHistoryEntry } from '../src/types/game';

let failed = 0;

function assert(condition: boolean, label: string): void {
  if (!condition) {
    failed += 1;
    console.error(`  ✗ ${label}`);
    return;
  }
  console.log(`  ✓ ${label}`);
}

function materializeSnapshotCitiesLegacy(
  catalog: typeof CITIES,
  snapshot: ReturnType<typeof buildGlobalEconomySnapshot>,
  history: GlobalMarketHistoryEntry[] = [],
) {
  return catalog.map((city) => ({
    ...city,
    products: Object.fromEntries(
      Object.entries(city.products).map(([rawProductId, product]) => {
        const productId = rawProductId;
        const sd = snapshot.supplyDemandState[city.id]?.[productId as keyof typeof snapshot.supplyDemandState[string]];
        const prices = history
          .filter((entry) => entry.cityId === city.id && entry.productId === productId)
          .sort((a, b) => a.epoch - b.epoch)
          .map((entry) => entry.price);
        return [
          productId,
          {
            ...product,
            stock: sd?.supply ?? product.stock,
            currentPrice:
              snapshot.cityMarketPrices[city.id]?.[productId as keyof typeof snapshot.cityMarketPrices[string]] ??
              product.basePrice,
            priceHistory: prices,
          },
        ];
      }),
    ),
  }));
}

console.log('\n=== market-history-performance-regression-test ===\n');

const snapshot = buildGlobalEconomySnapshot({
  cities: CITIES,
  nowMs: 1_800_000_000_000,
});

const history: GlobalMarketHistoryEntry[] = [];
for (let epoch = 1; epoch <= 120; epoch += 1) {
  for (const city of CITIES) {
    for (const productId of Object.keys(city.products)) {
      history.push({
        epoch,
        generatedAt: epoch * 60_000,
        cityId: city.id,
        productId: productId as GlobalMarketHistoryEntry['productId'],
        price: 100 + epoch + city.id.length,
        supply: 10,
        demand: 12,
        movementPercent: 1,
        activeEventIds: [],
        configVersion: snapshot.configVersion,
      });
    }
  }
}

const optimized = materializeSnapshotCities(CITIES, snapshot, history);
const legacy = materializeSnapshotCitiesLegacy(CITIES, snapshot, history);

for (const city of CITIES) {
  for (const productId of Object.keys(city.products)) {
    const left = optimized.find((item) => item.id === city.id)?.products[productId as keyof typeof city.products];
    const right = legacy.find((item) => item.id === city.id)?.products[productId as keyof typeof city.products];
    assert(
      JSON.stringify(left?.priceHistory) === JSON.stringify(right?.priceHistory),
      `priceHistory parity ${city.id}/${productId}`,
    );
    assert(left?.currentPrice === right?.currentPrice, `currentPrice parity ${city.id}/${productId}`);
    assert(left?.stock === right?.stock, `stock parity ${city.id}/${productId}`);
  }
}

const index = buildGlobalMarketHistoryPriceIndex(history);
assert(index.size === CITIES.length * Object.keys(CITIES[0]!.products).length, 'history index covers all pairs');

const gameStore = readFileSync('src/store/gameStore.ts', 'utf8');
const marketScreen = readFileSync('src/screens/MarketScreen.tsx', 'utf8');

assert(gameStore.includes('maybeRefreshMarketHistory'), 'deferred market history helper exists');
assert(gameStore.includes('includeHistory: false'), 'screen-open snapshot refresh skips inline history');
assert(
  gameStore.includes('InteractionManager.runAfterInteractions') &&
    gameStore.includes('maybeRefreshMarketHistory'),
  'market open defers history until after interactions',
);
assert(
  marketScreen.includes('marketGameDayAnchor'),
  'product cards use game-day trend anchor',
);
assert(
  !marketScreen.includes('Math.floor(state.currentTime * 4) / 4'),
  'removed quarter-hour market screen clock subscription',
);

console.log(`\n=== Results: ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
