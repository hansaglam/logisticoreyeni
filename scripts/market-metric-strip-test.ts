/**
 * Market metric strip movement/opportunity selectors.
 * Run: npx tsx scripts/market-metric-strip-test.ts
 */

import './test-globals';

import type { GlobalEconomySnapshot } from '../src/types/game';
import {
  MARKET_MOVEMENT_THRESHOLD_PERCENT,
  selectMarketMovementSummary,
  snapshotsAreEquivalentForMovement,
  STABLE_MARKET_MOVEMENT_SUMMARY,
} from '../src/simulation/marketMovementSummary';
import { selectActiveMarketOpportunityCount } from '../src/simulation/marketOpportunitySummary';

let failed = 0;

function check(condition: boolean, label: string): void {
  if (!condition) {
    failed += 1;
    console.error(`  ✗ ${label}`);
    return;
  }
  console.log(`  ✓ ${label}`);
}

function baseSnapshot(
  overrides: Partial<GlobalEconomySnapshot> = {},
): GlobalEconomySnapshot {
  return {
    version: 2,
    configVersion: 1,
    economyConfigVersion: 1,
    epoch: 10,
    generatedAt: 1_000,
    validUntil: 2_000,
    fuelPricePerLiter: 1.2,
    cityMarketPrices: {
      izmir: { fruit: 100 },
    },
    supplyDemandState: {
      izmir: {
        fruit: { supply: 100, demand: 80, status: 'balanced' },
      },
    },
    marketMovements: [],
    opportunities: [],
    marketMovementCount: 0,
    globalOpportunityCount: 0,
    worldStatus: 'stable',
    activeEvents: [],
    modifiers: {
      fuelMultiplier: 1,
      maintenanceMultiplier: 1,
      demandMultiplier: 1,
    },
    ...overrides,
  };
}

console.log('\n=== market-metric-strip-test ===\n');
console.log(`threshold: ${MARKET_MOVEMENT_THRESHOLD_PERCENT}%`);

const same = baseSnapshot();
check(
  selectMarketMovementSummary(same, same).total === 0,
  'aynı snapshot → hareket 0',
);
check(
  snapshotsAreEquivalentForMovement(same, { ...same }),
  'equivalent snapshot helper',
);

const previous = baseSnapshot();
const increased = baseSnapshot({
  epoch: 11,
  generatedAt: 2_000,
  cityMarketPrices: { izmir: { fruit: 103 } },
});
const increaseSummary = selectMarketMovementSummary(increased, previous);
check(increaseSummary.total === 1, 'bir ürün %3 yükselirse total=1');
check(increaseSummary.increases === 1, 'bir ürün %3 yükselirse increases=1');

const decreased = baseSnapshot({
  epoch: 12,
  generatedAt: 3_000,
  cityMarketPrices: { izmir: { fruit: 97 } },
});
const decreaseSummary = selectMarketMovementSummary(decreased, previous);
check(decreaseSummary.total === 1, 'bir ürün %3 düşerse total=1');
check(decreaseSummary.decreases === 1, 'bir ürün %3 düşerse decreases=1');

const tinyMove = baseSnapshot({
  epoch: 13,
  generatedAt: 4_000,
  cityMarketPrices: { izmir: { fruit: 101 } },
});
check(
  selectMarketMovementSummary(tinyMove, previous).total === 0,
  '%1 değişim hareket sayılmaz',
);

const statusChanged = baseSnapshot({
  epoch: 14,
  generatedAt: 5_000,
  supplyDemandState: {
    izmir: {
      fruit: { supply: 40, demand: 80, status: 'shortage' },
    },
  },
});
check(
  selectMarketMovementSummary(statusChanged, previous).total === 1,
  'arz durumu değişirse hareket sayılır',
);

check(
  selectMarketMovementSummary(null, previous).dominantDirection === 'stable',
  'önceki snapshot yoksa stable fallback',
);

const cachedReload = baseSnapshot({ epoch: 15, generatedAt: 6_000 });
check(
  selectMarketMovementSummary(cachedReload, cachedReload).total === 0,
  'cached veri tekrar yüklenirse sahte hareket oluşmaz',
);

const opportunitySnapshot = baseSnapshot({
  globalOpportunityCount: 7,
  opportunities: Array.from({ length: 7 }, (_, index) => ({
    id: `opp-${index}`,
    fromCityId: 'izmir',
    toCityId: 'ankara',
    productId: 'fruit',
    buyPrice: 90,
    sellPrice: 110,
    marginPercent: 12,
  })),
});
check(
  selectActiveMarketOpportunityCount(opportunitySnapshot) === 7,
  'fırsat sayısı canonical selector ile 7',
);
check(
  STABLE_MARKET_MOVEMENT_SUMMARY.total === 0,
  'stable summary default',
);

console.log(`\nResult: ${failed === 0 ? 'passed' : `${failed} failed`}\n`);
process.exit(failed > 0 ? 1 : 0);
