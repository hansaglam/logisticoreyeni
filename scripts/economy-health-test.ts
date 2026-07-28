/**
 * Economy health — L1/L5/L11 + fuel + soft-lock recovery.
 * Run: npx tsx scripts/economy-health-test.ts
 */

import './test-globals';

import { CITIES } from '../src/data/cities';
import { PRODUCTS } from '../src/data/products';
import { ROUTES } from '../src/data/routes';
import { STARTER_DRIVER } from '../src/data/drivers';
import { STARTER_TRUCK } from '../src/data/trucks';
import {
  calculateBalancedContractPayment,
  calculateContractEconomics,
  estimateContractTripCostBreakdown,
  isContractEconomicallyViable,
} from '../src/simulation/contractEconomics';
import { DEFAULT_GLOBAL_ECONOMY, sanitizeFuelPricePerLiter } from '../src/simulation/economy';
import { generateContracts } from '../src/simulation/contracts';
import {
  ensureEmergencyContractsForSoftLock,
  isSoftLockedCash,
} from '../src/simulation/softLockRecovery';
import { financeBalance } from '../src/config/balance';
import type { GlobalEconomy, Route } from '../src/types/game';

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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function runLevelFixture(level: number, label: string): void {
  console.log(`\n-- ${label} --`);
  const economy: GlobalEconomy = {
    ...DEFAULT_GLOBAL_ECONOMY,
    fuelPrice: sanitizeFuelPricePerLiter(1.72),
  };
  const cityRecord = Object.fromEntries(CITIES.map((c) => [c.id, structuredClone(c)]));
  // Stok/fiyat dengesini sözleşme üretebilir hale getir
  for (const city of Object.values(cityRecord)) {
    for (const product of PRODUCTS) {
      const market = city.products[product.id];
      if (!market) continue;
      const base = market.basePrice ?? product.basePrice ?? 100;
      if (city.id === 'izmir' || city.id === 'bursa') {
        market.stock = 900;
        market.targetStock = 150;
        market.currentPrice = base * 0.85;
        market.productionPerDay = 40;
        market.consumptionPerDay = 10;
      } else {
        market.stock = 30;
        market.targetStock = 600;
        market.currentPrice = base * 1.2;
        market.productionPerDay = 5;
        market.consumptionPerDay = 35;
      }
    }
  }

  const contracts = generateContracts(cityRecord, ROUTES, PRODUCTS, economy, [], {
    currentTime: 48,
    maxNewContracts: 24,
    playerLevel: level,
    playerReputation: 50,
    maxTruckCapacity: level <= 1 ? 12 : level <= 5 ? 25 : 40,
  });
  const available = contracts.filter((c) => c.status === 'available');
  const profits: number[] = [];
  const payments: number[] = [];
  const costs: number[] = [];
  let profitable = 0;

  for (const contract of available) {
    const route =
      ROUTES.find(
        (r) =>
          r.fromCityId === contract.originCityId &&
          r.toCityId === contract.destinationCityId,
      ) ??
      ({
        id: 'tmp',
        fromCityId: contract.originCityId,
        toCityId: contract.destinationCityId,
        distanceKm: contract.distanceKm,
        difficulty: 0.4,
        tollCost: 0,
      } satisfies Route);

    const eco = calculateContractEconomics({
      contract,
      truck: STARTER_TRUCK,
      driver: STARTER_DRIVER,
      route,
      globalEconomySnapshot: { fuelPricePerLiter: economy.fuelPrice },
      activeEvents: [],
    });
    payments.push(contract.payment);
    costs.push(eco.totalCost);
    profits.push(eco.estimatedProfit);
    if (eco.estimatedProfit > 0) profitable += 1;

    assert(
      Number.isFinite(eco.totalCost) && Number.isFinite(eco.estimatedProfit),
      `${label} finite economics ${contract.id.slice(0, 24)}`,
    );
    assert(
      !Number.isNaN(eco.totalCost) && eco.totalCost < 100_000,
      `${label} cost not catastrophic`,
      `cost=${eco.totalCost} payment=${contract.payment}`,
    );
  }

  console.log(
    `  stats available=${available.length} profitable=${profitable} medianPay=${Math.round(median(payments))} medianCost=${Math.round(median(costs))} medianProfit=${Math.round(median(profits))} fuel=${economy.fuelPrice}`,
  );

  if (level === 1) {
    assert(available.length > 0, 'I: L1 available contracts > 0');
    assert(profitable > 0, 'I: L1 profitable contracts > 0', `profitable=${profitable}`);
  }
}

console.log('\n=== economy-health-test ===\n');

assert(
  sanitizeFuelPricePerLiter(1529.4) === DEFAULT_GLOBAL_ECONOMY.fuelPrice,
  'H: fuel sanitize → canonical base (not clamp 5.0)',
  `got=${sanitizeFuelPricePerLiter(1529.4)}`,
);
assert(sanitizeFuelPricePerLiter(1529.4) !== 5, 'H: fuel sanitize not pinned to max');
assert(
  sanitizeFuelPricePerLiter(9, { fallback: 1.85 }) === 1.85,
  'H: fuel sanitize uses last-valid fallback',
);
assert(financeBalance.minCashBalance === -5000, '-$5000 floor exists');

const shortRoute = ROUTES.find((r) => (r.distanceKm ?? 999) < 200) ?? ROUTES[0]!;
const product = PRODUCTS[0]!;
const paymentInput = {
  amount: 8,
  product,
  originMarket: {
    stock: 100,
    targetStock: 80,
    productionPerDay: 10,
    consumptionPerDay: 8,
    basePrice: product.basePrice,
    currentPrice: product.basePrice,
  },
  destinationMarket: {
    stock: 20,
    targetStock: 80,
    productionPerDay: 5,
    consumptionPerDay: 12,
    basePrice: product.basePrice,
    currentPrice: product.basePrice * 1.2,
  },
  route: shortRoute,
  urgency: 0.4,
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  requiredLevel: 1,
};

const payment = calculateBalancedContractPayment(paymentInput);
const cost = estimateContractTripCostBreakdown(paymentInput).baseTripCost;
assert(isContractEconomicallyViable(paymentInput), 'viable L1 short contract');
assert(payment - cost >= 0, 'payment covers cost', `pay=${payment} cost=${cost}`);

runLevelFixture(1, 'L1');
runLevelFixture(5, 'L5');
runLevelFixture(11, 'L11');

// Soft-lock recovery
assert(isSoftLockedCash(-5000), 'J: -$5000 is soft-locked');
const recovered = ensureEmergencyContractsForSoftLock({
  money: -5000,
  contracts: [],
  trucks: [{ ...STARTER_TRUCK, status: 'idle', currentCityId: 'izmir' }],
  products: PRODUCTS,
  routes: ROUTES,
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  currentTime: 10,
  homeCityId: 'izmir',
  lastEmergencyContractAtMs: 0,
  nowMs: Date.now(),
});
assert(recovered.added.length > 0, 'J: -$5000 state recoverable (emergency contracts)', `added=${recovered.added.length}`);
assert(
  recovered.added.every((c) => c.payment > 0),
  'emergency contracts have positive payment',
);

// Preview consistency — same helper
const preview = calculateContractEconomics({
  contract: {
    payment,
    amount: 8,
    distanceKm: shortRoute.distanceKm,
    urgency: 0.4,
  },
  truck: STARTER_TRUCK,
  route: shortRoute,
  globalEconomySnapshot: { fuelPricePerLiter: 1.72 },
});
const preview2 = calculateContractEconomics({
  contract: {
    payment,
    amount: 8,
    distanceKm: shortRoute.distanceKm,
    urgency: 0.4,
  },
  truck: STARTER_TRUCK,
  route: shortRoute,
  globalEconomySnapshot: { fuelPricePerLiter: 1.72 },
});
assert(
  preview.totalCost === preview2.totalCost,
  'L: preview/settlement helper consistent',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
