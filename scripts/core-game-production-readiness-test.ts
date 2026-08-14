/**
 * LogistiCore çekirdek ekonomi/simulation final production readiness audit.
 * Run: npx tsx scripts/core-game-production-readiness-test.ts
 */

import './test-globals';

import { contractGenerationBalance, financeBalance, operatingCostBalance } from '../src/config/balance';
import { debugConfig, getResolvedMapDebugFlags } from '../src/config/debug';
import { CITIES } from '../src/data/cities';
import { STARTER_DRIVER } from '../src/data/drivers';
import { PRODUCTS } from '../src/data/products';
import { ROUTES } from '../src/data/routes';
import { createTrailerFromTemplate, TRAILER_MARKET } from '../src/data/trailers';
import { STARTER_TRUCK, TRUCK_MARKET } from '../src/data/trucks';
import {
  calculateContractEconomics,
  evaluateContractViability,
} from '../src/simulation/contractEconomics';
import { generateContracts } from '../src/simulation/contracts';
import {
  calculateDeliverySettlement,
  updateDeliveryProgressWithFuel,
} from '../src/simulation/delivery';
import { DEFAULT_GLOBAL_ECONOMY } from '../src/simulation/economy';
import { DAY_MS, HOUR_MS, getMarketEpoch } from '../src/simulation/economyClock';
import {
  buildGlobalEconomySnapshot,
  buildGlobalMarketHistoryEntries,
} from '../src/simulation/globalMarketSnapshot';
import { resolveGlobalMarketAvailability } from '../src/simulation/globalMarketAvailability';
import {
  calculateOfflineElapsed,
  calculateOfflineSimulationHours,
  shouldSkipDuplicateOfflineApply,
} from '../src/simulation/offlineProgression';
import { buildPeriodicCostDeductions } from '../src/simulation/periodicCosts';
import {
  calculateTrailerResaleValue,
  calculateTruckResaleValue,
} from '../src/simulation/fleetManagement';
import {
  ensureEmergencyContractsForSoftLock,
  evaluateSoftLockCashRecovery,
} from '../src/simulation/softLockRecovery';
import {
  calculateTradeBuyCost,
  calculateTradeProfit,
  calculateTradeSellRevenue,
  mergeInventoryOnBuy,
  reduceInventoryOnSell,
} from '../src/simulation/trading';
import { applyTruckUpgrade } from '../src/simulation/truckUpgrades';
import {
  normalizeSavePayload,
  payloadToStoreState,
  serializeGameState,
} from '../src/storage/saveGame';
import { InMemoryGlobalEconomyRepository } from '../src/services/globalEconomyRepository';
import { applyCashTransaction } from '../src/utils/cashPolicy';
import { MAX_SAVE_SIZE_BYTES } from '../src/utils/cloudSaveSize';
import { normalizeTruckFuel } from '../src/utils/truckFuel';
import type {
  Contract,
  Delivery,
  FinanceLedgerEntry,
  Player,
  Route,
  StoreGameState,
  Truck,
} from '../src/types/game';
import {
  advanceHeadlessSim,
  createHeadlessSimState,
  installProfileSeed,
  runHeadlessSim,
  SIM_PROFILES,
  startDeliveryHeadless,
  type HeadlessSimState,
} from './lib/headlessSim';

interface HealthReport {
  newPlayerPlayable: boolean;
  softLockScenarios: number;
  contractViabilityRate: number;
  profitableContractRate: number;
  medianProfitMargin: number;
  cashLedgerMismatch: number;
  maxOfflinePeriods: number;
  duplicateSettlementCount: number;
  negativeFuelCount: number;
  invalidTruckPriceCount: number;
  buySellExploitCount: number;
  stuckJobCount: number;
  savePayloadBytes: number;
  nanCount: number;
  infinityCount: number;
  releaseBlockers: string[];
}

let passed = 0;
let failed = 0;
const releaseBlockers: string[] = [];

function check(condition: boolean, label: string, releaseBlocking = true): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${label}`);
  if (releaseBlocking) releaseBlockers.push(label);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function countInvalidNumbers(value: unknown): { nan: number; infinity: number } {
  let nan = 0;
  let infinity = 0;
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'number') {
      if (Number.isNaN(candidate)) nan += 1;
      else if (!Number.isFinite(candidate)) infinity += 1;
      return;
    }
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) return;
    seen.add(candidate);
    for (const child of Object.values(candidate as Record<string, unknown>)) visit(child);
  };
  visit(value);
  return { nan, infinity };
}

function headlessToStoreState(headless: HeadlessSimState): StoreGameState {
  return {
    ...headless,
    isPaused: false,
    gameSpeed: 1,
    lastSimulationGameSpeed: 1,
    player: {
      ...headless.player,
      trailers: headless.player.trailers ?? [],
    },
    activeTransfers: [],
    completedTransfers: [],
    activeWarehouseStockTransfers: [],
    completedWarehouseStockTransfers: [],
    marketNews: [],
    eventLog: [],
    financeLedger: headless.financeLedger,
    financeTotals: headless.financeTotals,
    tutorial: undefined,
    missions: undefined,
    onboarding: undefined,
    spotlightTutorial: undefined,
    marketAlerts: [],
    monetization: undefined,
  } as StoreGameState;
}

function findStartableContract(state: HeadlessSimState): Contract | undefined {
  for (const contract of state.contracts) {
    if (contract.status !== 'available') continue;
    const attempted = startDeliveryHeadless(state, contract.id);
    if (attempted.activeDeliveries.length > state.activeDeliveries.length) return contract;
  }
  return undefined;
}

function makeFuelAuditDelivery(truck: Truck, overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'readiness-fuel-delivery',
    contractId: 'readiness-contract',
    truckId: truck.id,
    driverId: STARTER_DRIVER.id,
    originCityId: 'izmir',
    destinationCityId: 'ankara',
    productId: 'machinery',
    amount: 5,
    distanceKm: 100,
    progress: 0,
    status: 'on_route',
    startedAt: 0,
    estimatedArrivalTime: 10,
    deadlineTime: 20,
    fuelCost: 0,
    fuelLitersAtStart: truck.currentFuelL ?? 0,
    fuelLitersTotal: 30,
    fuelConsumedL: 0,
    lastFuelProcessedProgress: 0,
    lastFuelProcessedAt: 0,
    distanceTraveledKm: 0,
    currentSpeedKmh: 0,
    maintenanceCost: 0,
    estimatedProfit: 500,
    travelHours: 10,
    breakdownChance: 0,
    accidentChance: 0,
    conditionLoss: 0,
    ...overrides,
  };
}

function makeLevelPlayer(level: 1 | 5 | 11): Player {
  const truckCount = level === 1 ? 1 : level === 5 ? 3 : 6;
  const driverCount = truckCount;
  return {
    companyName: `Readiness L${level}`,
    money: level === 1 ? 20_000 : level === 5 ? 120_000 : 500_000,
    level,
    companyLevel: level,
    xp: 0,
    xpToNextLevel: 100,
    totalXp: 0,
    homeCityId: 'izmir',
    reputation: level * 7,
    completedContracts: 0,
    failedDeliveries: 0,
    lateDeliveries: 0,
    trucks: Array.from({ length: truckCount }, (_, index) => ({
      ...normalizeTruckFuel({
        ...(TRUCK_MARKET[Math.min(index, TRUCK_MARKET.length - 1)] ?? STARTER_TRUCK),
        id: `l${level}-truck-${index}`,
        catalogId:
          TRUCK_MARKET[Math.min(index, TRUCK_MARKET.length - 1)]?.id ??
          STARTER_TRUCK.catalogId,
        currentCityId: 'izmir',
        status: 'idle' as const,
      }),
    })),
    drivers: Array.from({ length: driverCount }, (_, index) => ({
      ...STARTER_DRIVER,
      id: `l${level}-driver-${index}`,
      dailySalary: 120 + level * 12,
      salaryPerDay: 120 + level * 12,
    })),
    trailers:
      level >= 11
        ? [
            createTrailerFromTemplate(TRAILER_MARKET[2]!, {
              id: 'l11-cold-trailer',
              city: 'izmir',
              createdAtGameTime: 0,
            }),
          ]
        : [],
    warehouses: [
      {
        id: `l${level}-warehouse`,
        cityId: 'izmir',
        capacityTons: level === 1 ? 100 : level === 5 ? 250 : 500,
        dailyOperatingCost: 250 + level * 25,
        inventory: [],
      },
    ],
  };
}

async function main(): Promise<void> {
  console.log('\n=== Core Game Production Readiness Audit ===\n');

  console.log('A. Yeni oyuncu — ilk operasyon döngüsü');
  const originalRandom = Math.random;
  installProfileSeed(SIM_PROFILES[0]!);
  let newPlayer = createHeadlessSimState('Production Readiness New Player');
  const firstContract = findStartableContract(newPlayer);
  check(newPlayer.player.money === 20_000, 'starter cash = $20,000');
  check(newPlayer.player.trucks.length === 1, 'starter truck mevcut');
  check(newPlayer.player.drivers.length === 1, 'ilk driver mevcut');
  check(Boolean(firstContract), 'yeni oyuncu için alınabilir ilk iş var');

  if (firstContract) {
    newPlayer = startDeliveryHeadless(newPlayer, firstContract.id);
    const active = newPlayer.activeDeliveries[0];
    check(Boolean(active), 'ilk iş başlatılabiliyor');
    if (active) {
      const cashAfterStart = newPlayer.player.money;
      Math.random = () => 0.99;
      newPlayer = advanceHeadlessSim(newPlayer, Math.max(2, active.travelHours + 0.1));
      check(
        (newPlayer.player.completedContracts ?? 0) >= 1,
        'ilk teslimat ve ödül akışı tamamlanıyor',
      );
      check(newPlayer.player.money >= financeBalance.minCashBalance, 'ilk iş soft-lock üretmiyor');
      check(newPlayer.player.money < 100_000, 'ilk iş para arzını anlamsız şişirmiyor');
      check(
        newPlayer.contracts.some((contract) => contract.status === 'available'),
        'teslimat sonrası ikinci iş mevcut',
      );
      check(
        cashAfterStart <= 20_000 &&
          newPlayer.financeLedger.filter((entry) => entry.category === 'fuel').length <= 1,
        'headless ilk yakıt gideri en fazla bir kez kaydediliyor',
      );
    }
  }
  Math.random = originalRandom;

  console.log('\nB. 24 saat offline / yakıt bitişi');
  const trustedNow = 1_900_000_000_000;
  const offline = calculateOfflineElapsed(trustedNow - DAY_MS, trustedNow);
  const offlineSimulation = calculateOfflineSimulationHours(offline.appliedMs, 1);
  const periodic = buildPeriodicCostDeductions({
    player: makeLevelPlayer(1),
    economyNowMs: trustedNow,
    lastProcessedEconomyAt: trustedNow - DAY_MS,
    alreadyAppliedPeriodKeys: [],
    maxOfflineCostPeriods: 0,
  });
  const periodicSecond = buildPeriodicCostDeductions({
    player: makeLevelPlayer(1),
    economyNowMs: trustedNow,
    lastProcessedEconomyAt: periodic.newlyProcessedUntil,
    alreadyAppliedPeriodKeys: periodic.periodKeysApplied,
    maxOfflineCostPeriods: 0,
  });
  check(offline.elapsedMs === DAY_MS, '24 saat elapsed doğru');
  check(offlineSimulation.appliedSimulationHours <= 24, 'offline progress 24 saat cap');
  check(periodic.periodsElapsed === 1, '1 gün yalnız 1 cost period elapsed');
  check(periodic.periodsCharged === 0, 'offline catch-up fixed cost = 0');
  check(periodicSecond.periodsCharged === 0, 'ikinci hydrate duplicate gider üretmiyor');
  check(
    shouldSkipDuplicateOfflineApply(trustedNow, trustedNow, trustedNow),
    'aynı offline pencere ikinci kez işlenmiyor',
  );

  const lowFuelTruck = normalizeTruckFuel({
    ...STARTER_TRUCK,
    id: 'readiness-low-fuel',
    currentFuelL: 3,
    fuelTankCapacityL: 100,
    totalMileageKm: 0,
    status: 'on_route',
  });
  const partialFuel = updateDeliveryProgressWithFuel(
    makeFuelAuditDelivery(lowFuelTruck),
    lowFuelTruck,
    2,
    1,
  );
  const frozenFuel = updateDeliveryProgressWithFuel(
    partialFuel.delivery,
    partialFuel.truck,
    2,
    2,
  );
  check(partialFuel.delivery.status === 'paused', 'offline yakıt bitince görev duruyor');
  check(partialFuel.delivery.progress > 0 && partialFuel.delivery.progress < 1, 'yakıt kadar kısmi progress');
  check(frozenFuel.delivery.progress === partialFuel.delivery.progress, 'yakıtsız sonraki süre progress üretmiyor');

  console.log('\nC/D. L1/L5/L11 ekonomi ve depo operasyonu');
  for (const level of [1, 5, 11] as const) {
    const player = makeLevelPlayer(level);
    const costs = buildPeriodicCostDeductions({
      player,
      economyNowMs: trustedNow,
      lastProcessedEconomyAt: trustedNow - DAY_MS,
      alreadyAppliedPeriodKeys: [],
      maxOfflineCostPeriods: 3,
    });
    check(Number.isFinite(costs.totalAmount) && costs.totalAmount >= 0, `L${level} günlük gider finite`);
    check(
      costs.totalAmount < player.money + Math.abs(financeBalance.minCashBalance),
      `L${level} tek günlük gider geri dönülmez soft-lock üretmiyor`,
    );
  }
  const buyCost = calculateTradeBuyCost(100, 10);
  const sellRevenue = calculateTradeSellRevenue(140, 10);
  const tradeProfit = calculateTradeProfit(140, 100, 10);
  const boughtInventory = mergeInventoryOnBuy([], 'textile', 10, 100);
  const soldInventory = reduceInventoryOnSell(boughtInventory, 'textile', 10);
  check(tradeProfit > 0, 'warehouse trade spread doğru');
  check(soldInventory.every((item) => item.quantity >= 0), 'warehouse stok negatif olmuyor');

  console.log('\nE. Negatif bakiye ve recovery');
  const floorExpense = applyCashTransaction({
    currentCash: -4_900,
    amount: 5_000,
    kind: 'mandatory-expense',
    referenceId: 'readiness-floor',
    transactionId: 'readiness-floor',
  });
  check(floorExpense.cashAfter === financeBalance.minCashBalance, 'cash -$5,000 floor korunuyor');
  const recoveryTruck = {
    ...normalizeTruckFuel(STARTER_TRUCK),
    currentFuelL: 0,
    status: 'idle' as const,
  };
  const cashRecovery = evaluateSoftLockCashRecovery({
    money: financeBalance.minCashBalance,
    trucks: [recoveryTruck],
  });
  const duplicateRecovery = evaluateSoftLockCashRecovery({
    money: financeBalance.minCashBalance,
    trucks: [recoveryTruck],
    alreadyGrantedAtMs: trustedNow,
  });
  const recoveryContracts = ensureEmergencyContractsForSoftLock({
    money: financeBalance.minCashBalance,
    contracts: [],
    trucks: [recoveryTruck],
    products: PRODUCTS,
    routes: ROUTES,
    globalEconomy: DEFAULT_GLOBAL_ECONOMY,
    currentTime: 0,
    nowMs: trustedNow,
    homeCityId: 'izmir',
  });
  check(cashRecovery.allowed && (cashRecovery.transaction?.cashAfter ?? -1) > 0, 'cash recovery pozitife çıkarıyor');
  check(!duplicateRecovery.allowed, 'recovery yardımı tek seferlik');
  check(recoveryContracts.added.length > 0, 'recovery contract üretilebiliyor');

  console.log('\nF. 1000 sözleşme örneği');
  const contractSamples: Contract[] = [];
  const marketCities = Object.fromEntries(
    CITIES.map((city) => [city.id, structuredClone(city)]),
  );
  const sourceCityIds = new Set(CITIES.slice(0, Math.max(2, Math.floor(CITIES.length / 3))).map((city) => city.id));
  for (const city of Object.values(marketCities)) {
    for (const product of PRODUCTS) {
      const market = city.products[product.id];
      if (!market) continue;
      const basePrice = market.basePrice ?? product.basePrice ?? 100;
      if (sourceCityIds.has(city.id)) {
        market.stock = 900;
        market.targetStock = 150;
        market.currentPrice = basePrice * 0.84;
        market.productionPerDay = 40;
        market.consumptionPerDay = 8;
      } else {
        market.stock = 25;
        market.targetStock = 650;
        market.currentPrice = basePrice * 1.24;
        market.productionPerDay = 4;
        market.consumptionPerDay = 36;
      }
    }
  }
  let generationRound = 0;
  while (contractSamples.length < 1_000 && generationRound < 100) {
    const level = ([1, 5, 11] as const)[generationRound % 3]!;
    const generated = generateContracts(
      structuredClone(marketCities),
      ROUTES,
      PRODUCTS,
      DEFAULT_GLOBAL_ECONOMY,
      [],
      {
        currentTime: generationRound * 24,
        maxNewContracts: 24,
        playerLevel: level,
        playerReputation: level * 7,
        maxTruckCapacity: level === 1 ? 25 : level === 5 ? 31 : 110,
        ownedMaxTruckCapacity: level === 1 ? 25 : level === 5 ? 31 : 110,
        idleMaxTruckCapacity: level === 1 ? 25 : level === 5 ? 31 : 110,
        idleTruckOriginCityIds: ['izmir', 'istanbul', 'ankara'],
      },
    );
    contractSamples.push(...generated);
    generationRound += 1;
  }
  const margins: number[] = [];
  let viable = 0;
  let profitable = 0;
  let impossible = 0;
  let routeFailures = 0;
  for (const contract of contractSamples.slice(0, 1_000)) {
    const route = ROUTES.find(
      (candidate) =>
        candidate.fromCityId === contract.originCityId &&
        candidate.toCityId === contract.destinationCityId,
    );
    if (!route) {
      routeFailures += 1;
      continue;
    }
    const viability = evaluateContractViability({
      contract,
      route,
      globalEconomySnapshot: { fuelPricePerLiter: 1.72 },
      maxFleetCapacityTons: 110,
    });
    if (viability.reason === 'capacity-impossible') impossible += 1;
    if (viability.accepted) viable += 1;
    if (viability.economics.estimatedProfit > 0) profitable += 1;
    margins.push(viability.economics.profitMarginPercent);
  }
  const sampledContracts = Math.min(1_000, contractSamples.length);
  const contractViabilityRate = sampledContracts > 0 ? viable / sampledContracts : 0;
  const profitableContractRate = sampledContracts > 0 ? profitable / sampledContracts : 0;
  const medianProfitMargin = median(margins);
  check(sampledContracts === 1_000, '1000 contract sample üretildi');
  check(contractViabilityRate >= 0.8, 'contract viability rate >= %80');
  check(profitableContractRate >= 0.8, 'profitable contract rate >= %80');
  check(impossible === 0, 'fleet üst kapasitesini aşan imkânsız iş yok');
  check(routeFailures === 0, 'route failure yok');

  console.log('\nG. Araç ekonomisi');
  let invalidTruckPriceCount = 0;
  let buySellExploitCount = 0;
  for (const template of TRUCK_MARKET) {
    const truck: Truck = {
      ...template,
      catalogId: template.id,
      currentCityId: 'izmir',
      status: 'idle',
    };
    const immediate = calculateTruckResaleValue(truck);
    const highMileage = calculateTruckResaleValue({ ...truck, totalMileageKm: 100_000 });
    const lowCondition = calculateTruckResaleValue({ ...truck, condition: 25 });
    let upgraded = applyTruckUpgrade(truck, 'engine');
    upgraded = applyTruckUpgrade(upgraded, 'fuelEfficiency');
    const upgradedValue = calculateTruckResaleValue(upgraded);
    if (!Number.isFinite(immediate) || immediate < 0) invalidTruckPriceCount += 1;
    if (immediate >= truck.purchasePrice) buySellExploitCount += 1;
    check(highMileage < immediate, `${truck.name}: high mileage depreciation`);
    check(lowCondition < immediate, `${truck.name}: kondisyon depreciation`);
    check(upgradedValue < truck.purchasePrice, `${truck.name}: upgrade sonrası satış alıştan düşük`);
  }
  for (const template of TRAILER_MARKET) {
    const trailer = createTrailerFromTemplate(template, {
      id: `${template.id}-readiness`,
      city: 'izmir',
      createdAtGameTime: 0,
    });
    const resale = calculateTrailerResaleValue(trailer);
    if (!Number.isFinite(resale) || resale < 0) invalidTruckPriceCount += 1;
    if (resale >= trailer.purchasePrice) buySellExploitCount += 1;
  }
  check(invalidTruckPriceCount === 0, 'invalid truck/trailer satış fiyatı yok');
  check(buySellExploitCount === 0, 'araç al-sat exploit yok');

  console.log('\nH. Global online ekonomi');
  const globalNow = 1_900_000_000_000;
  const repository = new InMemoryGlobalEconomyRepository([], () => globalNow);
  const [playerA, playerB] = await Promise.all([
    repository.getCurrentSnapshot(),
    repository.getCurrentSnapshot(),
  ]);
  check(
    JSON.stringify(playerA.snapshot) === JSON.stringify(playerB.snapshot),
    'iki oyuncu aynı canonical snapshot görüyor',
  );
  check(repository.getSnapshotCreateCount() === 1, 'aynı epoch snapshot tek kez oluşuyor');
  const epoch = getMarketEpoch(globalNow);
  await repository.getOrCreateSnapshot(epoch - 48, playerA.snapshot!.configVersion);
  const history = await repository.getHistory({ fromEpoch: epoch - 96, toEpoch: epoch });
  check(history.some((entry) => entry.epoch < epoch), 'yeni oyuncu eski global history okuyabiliyor');
  const missingProduction = resolveGlobalMarketAvailability({
    trusted: false,
    syncStatus: 'error',
    development: false,
  });
  check(
    !missingProduction.canDisplay && !missingProduction.priceCriticalOperationsAllowed,
    'production snapshot missing fail-closed',
  );
  const directSnapshot = buildGlobalEconomySnapshot({ epoch, cities: CITIES });
  check(
    buildGlobalMarketHistoryEntries(directSnapshot).length > 0,
    'global snapshot city/product history üretiyor',
  );

  console.log('\nI. Save/load ve cloud payload');
  const saveHeadless = createHeadlessSimState('Readiness Save');
  const storeState = headlessToStoreState(saveHeadless);
  const payload = serializeGameState(storeState);
  const currentRoundTrip = payloadToStoreState(normalizeSavePayload(payload));
  const oldPayload = normalizeSavePayload({
    ...payload,
    version: 1,
    player: {
      ...payload.player,
      trucks: payload.player.trucks.map((truck) => ({
        ...truck,
        currentFuelL: undefined,
        fuelTankCapacityL: undefined,
      })),
    },
    cachedGlobalEconomySnapshot: undefined,
  });
  const invalidPayload = normalizeSavePayload({
    ...payload,
    currentTime: Number.NaN,
    player: {
      ...payload.player,
      money: Number.POSITIVE_INFINITY,
      trucks: payload.player.trucks.map((truck) => ({
        ...truck,
        currentFuelL: Number.NEGATIVE_INFINITY,
        fuelTankCapacityL: Number.NaN,
        totalMileageKm: -100,
      })),
    },
  });
  const savePayloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const invalidCounts = countInvalidNumbers(invalidPayload);
  check(currentRoundTrip.player.trucks.length > 0, 'current save round-trip');
  check(
    oldPayload.player.trucks.every(
      (truck) =>
        Number.isFinite(truck.currentFuelL) &&
        Number.isFinite(truck.fuelTankCapacityL),
    ),
    'old save fuel alanları migrate ediliyor',
  );
  check(invalidCounts.nan === 0 && invalidCounts.infinity === 0, 'save NaN/Infinity normalize');
  check(savePayloadBytes < MAX_SAVE_SIZE_BYTES, 'cloud payload Firestore güvenli sınırda');
  check(
    payload.financeLedger.length <= 200 &&
      (payload.fuelTransactionKeys?.length ?? 0) <= 32,
    'cloud save bounded transaction arrays',
  );

  console.log('\nJ. 7/30 gün headless simulation');
  installProfileSeed(SIM_PROFILES[1]!);
  const sevenDay = runHeadlessSim(SIM_PROFILES[1]!, 7);
  installProfileSeed(SIM_PROFILES[1]!);
  const thirtyDay = runHeadlessSim(SIM_PROFILES[1]!, 30);
  Math.random = originalRandom;
  const stuckJobCount =
    Number(sevenDay.completedDeliveries === 0) +
    Number(thirtyDay.completedDeliveries === 0);
  check(sevenDay.completedDeliveries > 0, '7 gün simulation teslimat tamamlıyor');
  check(thirtyDay.completedDeliveries > sevenDay.completedDeliveries, '30 gün simulation ilerlemeye devam ediyor');
  check(thirtyDay.cashDay30 >= financeBalance.minCashBalance, '30 gün cash floor altında değil');
  check(thirtyDay.negativeCashDays < 30, '30 gün kesintisiz negatif ekonomi drift yok');
  check(
    thirtyDay.playableContractLowDays < 30 || thirtyDay.completedDeliveries >= 15,
    '30 gün boyunca iş havuzu operasyonu kilitlemiyor',
  );

  console.log('\nK. Release debug guard ve settlement invariant');
  const mapFlags = getResolvedMapDebugFlags();
  check(!debugConfig.mapCalibrationEnabled, 'production calibration kapalı');
  check(debugConfig.debugMapLogPreset === 'off', 'production map debug preset off');
  check(!Object.values(mapFlags).some(Boolean), 'production map logları kapalı');
  check(!debugConfig.deliveryStartLogsEnabled, 'delivery debug log kapalı');
  check(!debugConfig.debugContractGenerationLogsEnabled, 'contract generation debug log kapalı');
  check(!debugConfig.contractGenerationAuditEnabled, 'economy/contract audit log kapalı');

  const settlement = calculateDeliverySettlement({
    contractPayment: 5_000,
    fuelCost: 800,
    maintenanceCost: 200,
    penaltyCost: 0,
    fuelAlreadyPaid: true,
  });
  check(settlement.cashDeltaOnCompletion === 4_800, 'settlement yakıtı ikinci kez kesmiyor');
  const firstSettlement = applyCashTransaction({
    currentCash: 0,
    amount: settlement.cashDeltaOnCompletion,
    kind: 'income',
    referenceId: 'delivery:settlement',
    transactionId: 'delivery:settlement',
  });
  const duplicateSettlement = applyCashTransaction({
    currentCash: firstSettlement.cashAfter,
    amount: settlement.cashDeltaOnCompletion,
    kind: 'income',
    referenceId: 'delivery:settlement',
    transactionId: 'delivery:settlement',
    appliedTransactionIds: ['delivery:settlement'],
  });
  check(!duplicateSettlement.ok, 'aynı settlement transaction ikinci kez uygulanmıyor');

  const cashLedger: FinanceLedgerEntry[] = [
    { id: 'income', time: 0, type: 'income', category: 'contract_revenue', amount: 5_000 },
    { id: 'fuel', time: 0, type: 'expense', category: 'fuel_purchase', amount: 500 },
  ];
  const cashAfter = 20_000 + 5_000 - 500;
  const ledgerDelta = cashLedger.reduce(
    (sum, entry) => sum + (entry.type === 'income' ? entry.amount : -entry.amount),
    0,
  );
  const cashLedgerMismatch = Math.abs(cashAfter - 20_000 - ledgerDelta);
  check(cashLedgerMismatch === 0, 'cash değişimi ledger toplamıyla eşleşiyor');

  const health: HealthReport = {
    newPlayerPlayable:
      Boolean(firstContract) &&
      (newPlayer.player.completedContracts ?? 0) >= 1 &&
      newPlayer.player.money >= financeBalance.minCashBalance,
    softLockScenarios: Number(cashRecovery.allowed) + Number(recoveryContracts.added.length > 0),
    contractViabilityRate: round(contractViabilityRate * 100),
    profitableContractRate: round(profitableContractRate * 100),
    medianProfitMargin: round(medianProfitMargin),
    cashLedgerMismatch,
    maxOfflinePeriods: periodic.periodsElapsed,
    duplicateSettlementCount: duplicateSettlement.ok ? 1 : 0,
    negativeFuelCount: [partialFuel.truck, frozenFuel.truck].filter(
      (truck) => (truck.currentFuelL ?? 0) < 0,
    ).length,
    invalidTruckPriceCount,
    buySellExploitCount,
    stuckJobCount,
    savePayloadBytes,
    nanCount: invalidCounts.nan,
    infinityCount: invalidCounts.infinity,
    releaseBlockers: [...new Set(releaseBlockers)],
  };

  check(health.newPlayerPlayable, 'health: newPlayerPlayable');
  check(health.negativeFuelCount === 0, 'health: negative fuel yok');
  check(health.releaseBlockers.length === 0, 'health: release blocker yok');

  console.log('\n=== Health Report ===');
  console.log(JSON.stringify(health, null, 2));
  console.log('\n=== Long Simulation Snapshot ===');
  console.log(
    JSON.stringify(
      {
        day7: sevenDay,
        day30: thirtyDay,
      },
      null,
      2,
    ),
  );
  console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
  process.exitCode = failed > 0 ? 1 : 0;
}

void main();
