/**
 * Market presentation consumes the canonical snapshot/history.
 * Run: npx tsx scripts/market-screen-consistency-test.ts
 */

import './test-globals';

import { CITIES } from '../src/data/cities';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import {
  buildGlobalEconomySnapshot,
  getSnapshotFuelPrice,
  materializeSnapshotCities,
} from '../src/simulation/globalMarketSnapshot';

let failed = 0;
function assert(condition: boolean, label: string): void {
  if (!condition) {
    failed += 1;
    console.error(`  ✗ ${label}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

console.log('\n=== market-screen-consistency-test ===\n');
const snapshot = buildGlobalEconomySnapshot({
  nowMs: 1_800_000_000_000,
  cities: CITIES,
});
const cities = materializeSnapshotCities(CITIES, snapshot, []);
for (const city of cities) {
  for (const [productId, product] of Object.entries(city.products)) {
    assert(
      product.currentPrice === snapshot.cityMarketPrices[city.id]?.[productId as keyof typeof city.products],
      `snapshot price: ${city.id}/${productId}`,
    );
    assert(product.priceHistory?.length === 0,
      `history yoksa sahte grafik yok: ${city.id}/${productId}`);
  }
}
assert(
  getSnapshotFuelPrice(snapshot, DEFAULT_GLOBAL_ECONOMY) === snapshot.fuelPricePerLiter,
  'Dashboard/Market/refuel aynı snapshot yakıt fiyatını kullanır',
);

console.log(`\nResult: ${failed === 0 ? 'passed' : `${failed} failed`}\n`);
process.exit(failed > 0 ? 1 : 0);
