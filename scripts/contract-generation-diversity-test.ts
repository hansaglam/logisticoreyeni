/**
 * Contract generation variety regression guard.
 * Run: npx tsx scripts/contract-generation-diversity-test.ts
 */

import './test-globals';

import { CITIES } from '../src/data/cities';
import { PRODUCTS } from '../src/data/products';
import { ROUTES } from '../src/data/routes';
import { generateContracts } from '../src/simulation/contracts';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import type { City, Contract } from '../src/types/game';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle] ?? 0;
}

function createMarketFixture(): Record<string, City> {
  const cities = Object.fromEntries(CITIES.map((city) => [city.id, structuredClone(city)])) as Record<string, City>;
  const origins = new Set(CITIES.slice(0, Math.max(3, Math.ceil(CITIES.length / 3))).map((city) => city.id));

  for (const city of Object.values(cities)) {
    for (const product of PRODUCTS) {
      const market = city.products[product.id];
      if (!market) continue;
      const basePrice = market.basePrice ?? product.basePrice ?? 100;
      if (origins.has(city.id)) {
        market.stock = 1_000;
        market.targetStock = 160;
        market.currentPrice = basePrice * 0.82;
        market.productionPerDay = 48;
        market.consumptionPerDay = 8;
      } else {
        market.stock = 25;
        market.targetStock = 650;
        market.currentPrice = basePrice * 1.25;
        market.productionPerDay = 4;
        market.consumptionPerDay = 42;
      }
    }
  }
  return cities;
}

console.log('\n=== contract-generation-diversity-test ===\n');

const contracts: Contract[] = [];
for (let batch = 0; batch < 50; batch += 1) {
  contracts.push(
    ...generateContracts(createMarketFixture(), ROUTES, PRODUCTS, DEFAULT_GLOBAL_ECONOMY, [], {
      currentTime: 100 + batch,
      maxNewContracts: 20,
      playerLevel: 1,
      playerReputation: 10,
      ownedMaxTruckCapacity: 25,
      idleMaxTruckCapacity: 25,
      idleTruckOriginCityIds: CITIES.slice(0, 3).map((city) => city.id),
    }),
  );
}

const payments = contracts.map((contract) => contract.payment);
const routeKeys = new Set(contracts.map((contract) => `${contract.originCityId}-${contract.destinationCityId}`));
const productIds = new Set(contracts.map((contract) => contract.productId));
const amounts = new Set(contracts.map((contract) => contract.amount));
const risks = new Set(contracts.map((contract) => contract.riskLevel));
const paymentCounts = new Map<number, number>();
for (const payment of payments) paymentCounts.set(payment, (paymentCounts.get(payment) ?? 0) + 1);
const highestPaymentRepeatRate = Math.max(...paymentCounts.values()) / Math.max(contracts.length, 1);

console.log({
  generated: contracts.length,
  uniqueRouteCount: routeKeys.size,
  uniqueRouteRate: routeKeys.size / Math.max(contracts.length, 1),
  uniquePaymentCount: paymentCounts.size,
  uniquePaymentRate: paymentCounts.size / Math.max(contracts.length, 1),
  cargoDistribution: Object.fromEntries(
    [...productIds].map((productId) => [productId, contracts.filter((contract) => contract.productId === productId).length]),
  ),
  riskDistribution: Object.fromEntries(
    [...risks].map((risk) => [risk, contracts.filter((contract) => contract.riskLevel === risk).length]),
  ),
  payment: { min: Math.min(...payments), median: median(payments), max: Math.max(...payments) },
  profitableRate: contracts.filter((contract) => contract.payment > 0).length / Math.max(contracts.length, 1),
  highestPaymentRepeatRate,
});

assert(contracts.length >= 1_000, 'En az 1.000 sözleşme üretildi');
assert(routeKeys.size >= 3, 'Rota çeşitliliği korunuyor');
assert(productIds.size >= 3, 'Ürün çeşitliliği korunuyor');
assert(amounts.size >= 3, 'Tonaj çeşitliliği korunuyor');
assert(paymentCounts.size >= 3, 'Ödemeler tek bir değere sabitlenmiyor');
assert(highestPaymentRepeatRate < 0.8, 'Tek ödeme değerinin baskınlığı sınırlı');
assert(payments.every((payment) => Number.isFinite(payment) && payment > 0), 'Ödemeler sonlu ve pozitif');

console.log('\ncontract-generation-diversity-test: PASSED');
