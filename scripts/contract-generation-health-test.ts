/**
 * Contract generation production health matrix.
 * Run: npx tsx scripts/contract-generation-health-test.ts
 */

import './test-globals';

import { contractGenerationBalance } from '../src/config/balance';
import { CITIES } from '../src/data/cities';
import { STARTER_DRIVER } from '../src/data/drivers';
import { PRODUCTS } from '../src/data/products';
import { ROUTES } from '../src/data/routes';
import { STARTER_TRUCK, TRUCK_MARKET } from '../src/data/trucks';
import {
  calculateContractEconomics,
  evaluateContractViability,
} from '../src/simulation/contractEconomics';
import { buildContractPreview } from '../src/simulation/contractPreview';
import { generateContracts } from '../src/simulation/contracts';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import type {
  City,
  Contract,
  GlobalEconomy,
  Route,
  Trailer,
  Truck,
  WorldEvent,
} from '../src/types/game';

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
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function marketFixture(demand: 'normal' | 'low' | 'high'): Record<string, City> {
  const cities = Object.fromEntries(
    CITIES.map((city) => [city.id, structuredClone(city)]),
  ) as Record<string, City>;
  const sourceIds = new Set(CITIES.slice(0, Math.max(2, Math.floor(CITIES.length / 3))).map((c) => c.id));
  for (const city of Object.values(cities)) {
    for (const product of PRODUCTS) {
      const market = city.products[product.id];
      if (!market) continue;
      const base = market.basePrice ?? product.basePrice ?? 100;
      if (sourceIds.has(city.id)) {
        market.stock = 950;
        market.targetStock = 160;
        market.currentPrice = base * 0.82;
        market.productionPerDay = 45;
        market.consumptionPerDay = 8;
      } else {
        market.stock = demand === 'low' ? 90 : demand === 'high' ? 5 : 30;
        market.targetStock = demand === 'low' ? 360 : demand === 'high' ? 850 : 620;
        market.currentPrice = base * (demand === 'low' ? 1.1 : demand === 'high' ? 1.35 : 1.22);
        market.productionPerDay = 4;
        market.consumptionPerDay = demand === 'high' ? 55 : 32;
      }
    }
  }
  return cities;
}

function event(
  id: string,
  impact: WorldEvent['impact'],
  severity: WorldEvent['severity'] = 'medium',
): WorldEvent {
  return {
    id,
    type: 'economic_crisis',
    title: id,
    description: id,
    startsAtDay: 0,
    endsAtDay: 10,
    durationDays: 10,
    impact,
    severity,
    isActive: true,
  };
}

const maintenanceCampaign = event('maintenance-campaign', {
  maintenanceCostMultiplier: 0.75,
});
const crisis = event(
  'crisis',
  {
    fuelPriceMultiplier: 1.25,
    maintenanceCostMultiplier: 1.35,
    productDemandMultiplier: 1.25,
  },
  'high',
);

const scenarios: Array<{
  name: string;
  demand: 'normal' | 'low' | 'high';
  fuelPrice: number;
  events: WorldEvent[];
}> = [
  { name: 'normal', demand: 'normal', fuelPrice: 1.72, events: [] },
  { name: 'fuel-increase', demand: 'normal', fuelPrice: 2.8, events: [] },
  { name: 'maintenance-campaign', demand: 'normal', fuelPrice: 1.72, events: [maintenanceCampaign] },
  { name: 'crisis', demand: 'high', fuelPrice: 2.5, events: [crisis] },
  { name: 'low-demand', demand: 'low', fuelPrice: 1.72, events: [] },
  { name: 'high-demand', demand: 'high', fuelPrice: 1.72, events: [] },
];

const levelFixtures: Array<{ level: number; capacity: number; truck: Truck }> = [
  { level: 1, capacity: 25, truck: STARTER_TRUCK },
  {
    level: 5,
    capacity: 30,
    truck: {
      ...(TRUCK_MARKET.find((truck) => truck.capacity === 30) ?? STARTER_TRUCK),
      id: 'health-l5',
      currentCityId: 'izmir',
      status: 'idle',
    },
  },
  {
    level: 11,
    capacity: 40,
    truck: {
      ...(TRUCK_MARKET.find((truck) => truck.capacity === 40) ?? STARTER_TRUCK),
      id: 'health-l11',
      currentCityId: 'izmir',
      status: 'idle',
    },
  },
];

const trailer: Trailer = {
  id: 'health-trailer',
  name: 'Health Trailer',
  type: 'refrigerated',
  capacityBonusTons: 10,
  purchasePrice: 1,
  condition: 100,
  city: 'izmir',
  status: 'attached',
  attachedTruckId: 'health-l11',
  isOwned: true,
  createdAtGameTime: 0,
};

interface Stats {
  generated: number;
  available: number;
  profitable: number;
  risky: number;
  negativeRisky: number;
  lowMargin: number;
  payments: number[];
  costs: number[];
  profits: number[];
  margins: number[];
  durations: number[];
  impossibleCapacity: number;
  routeNotFound: number;
  invalidNumber: number;
  previewMismatch: number;
  rejectedViability: number;
}

function emptyStats(): Stats {
  return {
    generated: 0,
    available: 0,
    profitable: 0,
    risky: 0,
    negativeRisky: 0,
    lowMargin: 0,
    payments: [],
    costs: [],
    profits: [],
    margins: [],
    durations: [],
    impossibleCapacity: 0,
    routeNotFound: 0,
    invalidNumber: 0,
    previewMismatch: 0,
    rejectedViability: 0,
  };
}

console.log('\n=== contract-generation-health-test ===\n');

for (const fixture of levelFixtures) {
  const stats = emptyStats();
  for (const scenario of scenarios) {
    const economy: GlobalEconomy = {
      ...DEFAULT_GLOBAL_ECONOMY,
      fuelPrice: scenario.fuelPrice,
    };
    const contracts = generateContracts(
      marketFixture(scenario.demand),
      ROUTES,
      PRODUCTS,
      economy,
      [],
      {
        currentTime: 48,
        maxNewContracts: 24,
        playerLevel: fixture.level,
        playerReputation: fixture.level >= 5 ? 70 : 20,
        maxTruckCapacity: fixture.capacity,
        ownedMaxTruckCapacity: fixture.capacity,
        idleMaxTruckCapacity: fixture.capacity,
        activeWorldEvents: scenario.events,
      },
    );
    stats.generated += contracts.length;
    stats.available += contracts.filter((contract) => contract.status === 'available').length;

    for (const contract of contracts) {
      const route = ROUTES.find(
        (candidate) =>
          candidate.fromCityId === contract.originCityId &&
          candidate.toCityId === contract.destinationCityId,
      );
      if (!route) {
        stats.routeNotFound += 1;
        continue;
      }
      if (contract.amount > fixture.capacity + 1e-6) {
        stats.impossibleCapacity += 1;
      }
      const economics = calculateContractEconomics({
        contract,
        truck: fixture.truck,
        trailer: contract.contractType === 'bulk' || contract.contractType === 'refrigerated'
          ? trailer
          : null,
        driver: STARTER_DRIVER,
        route,
        globalEconomySnapshot: { fuelPricePerLiter: economy.fuelPrice },
        activeEvents: scenario.events,
      });
      const viability = evaluateContractViability({
        contract,
        route,
        globalEconomySnapshot: { fuelPricePerLiter: economy.fuelPrice },
        activeEvents: scenario.events,
        maxFleetCapacityTons: fixture.capacity,
      });
      const preview = buildContractPreview({
        contract,
        route,
        globalEconomy: economy,
        truck: fixture.truck,
        driver: STARTER_DRIVER,
        trailers: contract.contractType === 'bulk' || contract.contractType === 'refrigerated'
          ? [trailer]
          : [],
        activeWorldEvents: scenario.events,
        companyLevel: fixture.level,
      });
      const numericValues = [
        economics.revenue,
        economics.totalCost,
        economics.estimatedProfit,
        economics.profitMarginPercent,
        economics.fuelLiters,
        economics.estimatedDurationHours,
      ];
      if (numericValues.some((value) => !Number.isFinite(value))) {
        stats.invalidNumber += 1;
      }
      if (
        preview.estimatedGrossPayment !== economics.revenue ||
        preview.estimatedTripCost !== economics.totalCost ||
        preview.estimatedOperationalProfit !== economics.estimatedProfit
      ) {
        stats.previewMismatch += 1;
      }
      if (economics.estimatedProfit > 0) stats.profitable += 1;
      if (economics.profitMarginPercent <= 25) stats.lowMargin += 1;
      const risky = (contract.riskLevel ?? 'low') === 'high';
      if (risky) stats.risky += 1;
      if (risky && economics.estimatedProfit < 0) stats.negativeRisky += 1;
      stats.payments.push(economics.revenue);
      stats.costs.push(economics.totalCost);
      stats.profits.push(economics.estimatedProfit);
      stats.margins.push(economics.profitMarginPercent);
      stats.durations.push(economics.estimatedDurationHours);
      if (!viability.accepted) stats.rejectedViability += 1;
    }
  }

  const minimumMargin = stats.margins.length ? Math.min(...stats.margins) : 0;
  const maximumMargin = stats.margins.length ? Math.max(...stats.margins) : 0;
  const negativeRiskShare =
    stats.generated > 0 ? stats.negativeRisky / stats.generated : 0;
  console.log(
    `[contract-generation-health] L${fixture.level} ` +
      `generated=${stats.generated} available=${stats.available} profitable=${stats.profitable} ` +
      `medianPayment=${Math.round(median(stats.payments))} medianCost=${Math.round(median(stats.costs))} ` +
      `medianProfit=${Math.round(median(stats.profits))} medianMargin=${median(stats.margins).toFixed(1)}% ` +
      `minMargin=${minimumMargin.toFixed(1)}% maxMargin=${maximumMargin.toFixed(1)}% ` +
      `lowMargin=${stats.lowMargin} risky=${stats.risky} negativeRisky=${stats.negativeRisky} ` +
      `impossibleCapacity=${stats.impossibleCapacity} routeNotFound=${stats.routeNotFound} ` +
      `invalid=${stats.invalidNumber} viabilityRejected=${stats.rejectedViability} ` +
      `medianDuration=${median(stats.durations).toFixed(2)}h`,
  );

  assert(stats.generated > 0, `L${fixture.level}: iş üretildi`);
  if (fixture.level === 1) {
    assert(
      stats.available >=
        contractGenerationBalance.minTotalPlayableContracts * scenarios.length,
      'L1: configured minimum oynanabilir havuz',
    );
  }
  assert(stats.profitable / Math.max(1, stats.generated) >= 0.75, `L${fixture.level}: çoğunluk pozitif`);
  assert(stats.impossibleCapacity === 0, `L${fixture.level}: impossible capacity yok`);
  assert(stats.routeNotFound === 0, `L${fixture.level}: route not found yok`);
  assert(stats.invalidNumber === 0, `L${fixture.level}: NaN/Infinity yok`);
  assert(stats.rejectedViability === 0, `L${fixture.level}: viability guard sonrası red yok`);
  assert(stats.previewMismatch === 0, `L${fixture.level}: card/helper birebir`);
  assert(
    negativeRiskShare <= contractGenerationBalance.maxRiskyNegativeShare,
    `L${fixture.level}: riskli negatif oranı limit içinde`,
  );
  assert(median(stats.durations) > 2, `L${fixture.level}: süre operasyonel olarak gerçekçi`);
  assert(maximumMargin < 90, `L${fixture.level}: ileri seviye gelir şişmesi yok`);
}

const route = ROUTES[0] as Route;
const durationProbe: Contract = {
  id: 'duration-probe',
  originCityId: route.fromCityId,
  destinationCityId: route.toCityId,
  productId: PRODUCTS[0]!.id,
  amount: 12,
  cargoWeight: 12,
  payment: 5_000,
  deadlineHours: 24,
  distanceKm: route.distanceKm,
  urgency: 0.4,
  status: 'available',
  createdAt: 0,
  expiresAt: 24,
  contractType: 'standard',
};
const durationEconomics = calculateContractEconomics({
  contract: durationProbe,
  truck: STARTER_TRUCK,
  driver: STARTER_DRIVER,
  route,
  globalEconomySnapshot: { fuelPricePerLiter: 1.72 },
});
assert(
  durationEconomics.estimatedDurationHours >
    route.distanceKm / durationEconomics.effectiveAverageSpeedKmh,
  'süreye yükleme/boşaltma ve dinlenme payı eklenir',
);

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exitCode = 1;
}
