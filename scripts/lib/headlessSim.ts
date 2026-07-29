/**
 * Node-safe headless oyun simülasyonu — gameStore / React Native bağımlılığı yok.
 */

import { contractGenerationBalance, operatingCostBalance, reputationBalance, timeBalance } from '../../src/config/balance';
import { HIGH_REPUTATION_SUCCESS_BONUS } from '../../src/config/contractTypes';
import { CITIES } from '../../src/data/cities';
import { STARTER_DRIVER, normalizeDriver } from '../../src/data/drivers';
import { MILESTONE_DEFINITIONS, getMilestoneById } from '../../src/data/milestones';
import { PRODUCTS } from '../../src/data/products';
import { ROUTES } from '../../src/data/routes';
import { STARTER_TRUCK } from '../../src/data/trucks';
import { createDefaultGlobalEconomy, normalizeGlobalEconomy, updateAllCitiesEconomy } from '../../src/simulation/economy';
import {
  balanceAvailableContractLevelMix,
  buildPlayerFleetCityContext,
  countPlayableContracts,
  ensurePlayableContractSupply,
  generateContracts,
  getRouteBetweenCities,
  processContractGenerationSchedule,
} from '../../src/simulation/contracts';
import { ensureStarterContracts } from '../../src/simulation/starterContracts';
import { buildContractPreview } from '../../src/simulation/contractPreview';
import { normalizeContractType, shouldGrantHighReputationBonus } from '../../src/simulation/contractTypes';
import {
  calculateDailyOperatingCostBreakdown,
  computeElapsedOperatingDays,
} from '../../src/simulation/dailyOperatingCosts';
import {
  calculateDeliverySettlement,
  calculateFailurePenalty,
  calculateLatePenalty,
  calculateTruckRepairCost,
  createDelivery,
  failDelivery,
  getContractAvailability,
  isDeliveryFuelProgressComplete,
  isDeliveryProgressComplete,
  safeCompleteDelivery,
  selectIdleTruckForContract,
  updateDeliveryProgressWithFuel,
} from '../../src/simulation/delivery';
import type { SimulationGameState } from '../../src/types/game';
import {
  applyDriverXp,
  calculateDriverDeliveryXp,
  recordDriverDeliveryStats,
} from '../../src/simulation/driverProgress';
import { applyXpToPlayer, calculateDeliveryXp, getDeliveryRiskTier } from '../../src/simulation/leveling';
import {
  applyRetentionEvent,
  claimMilestoneRewardState,
  claimWeeklyObjectiveRewardState,
  createDefaultRetentionState,
  getReadyMilestones,
  getReadyWeeklyObjectives,
  syncRetentionProgressState,
} from '../../src/simulation/retentionProgress';
import {
  applyTruckUpgrade,
  canUpgradeTruck,
  getTruckUpgradeCost,
  type TruckUpgradeType,
} from '../../src/simulation/truckUpgrades';
import {
  calculateTradeBuyCost,
  calculateTradeProfit,
  calculateTradeSellRevenue,
  getCityProductMarketPrice,
  getCityProductStock,
  getWarehouseFreeCapacityTon,
  mergeInventoryOnBuy,
  normalizeWarehouse,
  reduceInventoryOnSell,
} from '../../src/simulation/trading';
import {
  applyWorldEventImpactToFuelPrice,
  gameDayFromTime,
  getActiveWorldEvents,
  processWorldEventsForDayRange,
} from '../../src/simulation/worldEvents';
import type {
  Contract,
  FinanceLedgerEntry,
  FinanceTotals,
  GlobalEconomy,
  Player,
  RetentionState,
  StoreGameState,
} from '../../src/types/game';
import { applyMandatoryCashDeduction, canAffordVoluntaryPurchase } from '../../src/utils/cashPolicy';
import { normalizeTruckFuel } from '../../src/utils/truckFuel';
import { calculateCompanyScore } from '../../src/simulation/companyScore';
import { addFinanceLedgerEntries, createEmptyFinanceTotals } from '../../src/utils/financeLedger';
import { getProductByIdSafe } from '../../src/utils/entityLookup';
import { getWeeklySeasonKey } from '../../src/utils/leaderboardSeason';
import { randomBetween, randomIntBetween } from '../../src/utils/math';
import { getWeeklyObjectiveById } from '../../src/data/weeklyObjectives';

const HOURS_PER_DAY = timeBalance.hoursPerDay;
const REPUTATION_GAIN = reputationBalance.onTimeDeliveryGain;

export interface HeadlessSimState {
  currentTime: number;
  player: Player;
  cities: StoreGameState['cities'];
  products: StoreGameState['products'];
  routes: StoreGameState['routes'];
  contracts: StoreGameState['contracts'];
  activeDeliveries: StoreGameState['activeDeliveries'];
  globalEconomy: GlobalEconomy;
  financeLedger: FinanceLedgerEntry[];
  financeTotals: FinanceTotals;
  retention: RetentionState;
  worldEvents: StoreGameState['worldEvents'];
  lastDailyOperatingCostTime: number;
  lastEconomyTickTime: number;
  lastContractGenerationTime: number;
  lastMarketRefreshTime: number;
  lastDailyCleanupTime: number;
  lastPlayableContractGeneratedTime: number;
  lastWorldEventGeneratedDay: number;
  contractTypesCompleted: Record<string, number>;
  deliverySequence: number;
}

function citiesToRecord(cities: HeadlessSimState['cities']): Record<string, (typeof CITIES)[0]> {
  return Object.fromEntries(cities.map((city) => [city.id, city]));
}

function cloneCities(): typeof CITIES {
  return structuredClone(CITIES);
}

function ledgerId(prefix: string, time: number): string {
  return `sim_${prefix}_${Math.floor(time)}_${randomIntBetween(1, 999_999)}`;
}

function patchLedger(
  state: HeadlessSimState,
  entry: Omit<FinanceLedgerEntry, 'id'>,
): HeadlessSimState {
  const withId: FinanceLedgerEntry = { ...entry, id: ledgerId(entry.category, entry.time) };
  const patched = addFinanceLedgerEntries(state.financeLedger, state.financeTotals, [withId]);
  return { ...state, financeLedger: patched.financeLedger, financeTotals: patched.financeTotals };
}

function toSimState(state: HeadlessSimState): SimulationGameState {
  return {
    currentDay: gameDayFromTime(state.currentTime),
    currentTime: state.currentTime,
    player: {
      companyName: state.player.companyName,
      money: state.player.money,
      companyLevel: state.player.level ?? 1,
      homeCityId: state.player.homeCityId,
    },
    trucks: state.player.trucks,
    drivers: state.player.drivers,
    warehouses: state.player.warehouses,
    cities: citiesToRecord(state.cities),
    contracts: state.contracts,
    deliveries: state.activeDeliveries,
  };
}

function applySim(state: HeadlessSimState, sim: SimulationGameState, money?: number): HeadlessSimState {
  return {
    ...state,
    player: {
      ...state.player,
      money: money ?? state.player.money,
      trucks: sim.trucks,
      drivers: sim.drivers,
      warehouses: sim.warehouses,
    },
    cities: state.cities.map((city) => sim.cities[city.id] ?? city),
    contracts: sim.contracts,
    activeDeliveries: sim.deliveries,
  };
}

export function createHeadlessSimState(companyName: string): HeadlessSimState {
  const globalEconomy = createDefaultGlobalEconomy();
  const cities = cloneCities();
  const cityRecord = citiesToRecord(cities);
  const starterPlayer = {
    level: 1,
    companyLevel: 1,
    homeCityId: 'izmir' as const,
    trucks: [structuredClone(STARTER_TRUCK)],
    drivers: [structuredClone(STARTER_DRIVER)],
  };

  const rawContracts = generateContracts(cityRecord, ROUTES, PRODUCTS, globalEconomy, [], {
    currentTime: 0,
    maxNewContracts: randomIntBetween(
      contractGenerationBalance.initialContractsMin,
      contractGenerationBalance.initialContractsMax,
    ),
    playerLevel: 1,
    ownedMaxTruckCapacity: STARTER_TRUCK.capacity ?? 25,
    idleMaxTruckCapacity: STARTER_TRUCK.capacity ?? 25,
    idleTruckOriginCityIds: ['izmir'],
    fleetCityContext: buildPlayerFleetCityContext({
      idleTruckOriginCityIds: ['izmir'],
      trucks: starterPlayer.trucks,
    }),
  });

  let contracts = ensureStarterContracts({
    contracts: balanceAvailableContractLevelMix(rawContracts, 1),
    cities: cityRecord,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy,
    player: starterPlayer,
    currentTime: 0,
    minCount: contractGenerationBalance.minAvailableContractsPerIdleTruckCity,
  });

  contracts = ensurePlayableContractSupply({
    cities: cityRecord,
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy,
    contracts,
    currentTime: 0,
    playerLevel: 1,
    trucks: starterPlayer.trucks,
    drivers: starterPlayer.drivers,
    homeCityId: starterPlayer.homeCityId,
    idleTruckOriginCityIds: ['izmir'],
    forceFallback: true,
    maxNewContracts: contractGenerationBalance.maxPlayableContractsGeneratedAtOnce,
  }).contracts;

  return {
    currentTime: 0,
    player: {
      companyName,
      money: 20_000,
      companyLevel: 1,
      level: 1,
      xp: 0,
      xpToNextLevel: 100,
      totalXp: 0,
      homeCityId: 'izmir',
      reputation: reputationBalance.initial,
      completedContracts: 0,
      failedDeliveries: 0,
      lateDeliveries: 0,
      diamonds: 0,
      trucks: [structuredClone(STARTER_TRUCK)],
      drivers: [structuredClone(STARTER_DRIVER)],
      warehouses: [
        {
          id: 'warehouse-starter-1',
          cityId: 'izmir',
          capacityTons: 100,
          capacityTon: 100,
          dailyOperatingCost: operatingCostBalance.fallbackWarehouseDailyCost,
          upgradeTier: 1,
          warehouseType: 'standard',
          qualityProtection: 0.5,
          inventory: [],
          usedCapacityTon: 0,
        },
      ],
    },
    cities,
    products: structuredClone(PRODUCTS),
    routes: structuredClone(ROUTES),
    contracts,
    activeDeliveries: [],
    globalEconomy,
    financeLedger: [],
    financeTotals: createEmptyFinanceTotals(),
    retention: createDefaultRetentionState(),
    worldEvents: [],
    lastDailyOperatingCostTime: 0,
    lastEconomyTickTime: 0,
    lastContractGenerationTime: 0,
    lastMarketRefreshTime: 0,
    lastDailyCleanupTime: 0,
    lastPlayableContractGeneratedTime: 0,
    lastWorldEventGeneratedDay: 0,
    contractTypesCompleted: {},
    deliverySequence: 0,
  };
}

function syncRetention(state: HeadlessSimState): HeadlessSimState {
  const retention = syncRetentionProgressState({
    player: state.player,
    financeLedger: state.financeLedger,
    cities: state.cities,
    products: state.products,
    currentTime: state.currentTime,
    retention: state.retention,
  });
  return { ...state, retention };
}

function claimAllRewards(state: HeadlessSimState): HeadlessSimState {
  let next = syncRetention(state);
  for (const id of getReadyMilestones(next.retention)) {
    const def = getMilestoneById(id);
    const claim = claimMilestoneRewardState(next.retention, id, next.currentTime);
    if (!claim.ok) continue;
    const cash = def?.reward.cash ?? 0;
    const xp = def?.reward.xp ?? 0;
    const diamonds = def?.reward.diamonds ?? 0;
    const rep = def?.reward.reputation ?? 0;
    next = {
      ...next,
      retention: claim.retention,
      player: {
        ...next.player,
        money: next.player.money + cash,
        xp: (next.player.xp ?? 0) + xp,
        diamonds: (next.player.diamonds ?? 0) + diamonds,
        reputation: Math.min(100, (next.player.reputation ?? 0) + rep),
      },
    };
    if (cash > 0) {
      next = patchLedger(next, {
        time: next.currentTime,
        type: 'income',
        category: 'bonus',
        amount: cash,
        title: 'Milestone ödülü',
        description: id,
      });
    }
  }

  const seasonKey = getWeeklySeasonKey();
  for (const id of getReadyWeeklyObjectives(next.retention, seasonKey)) {
    const def = getWeeklyObjectiveById(id, seasonKey);
    const claim = claimWeeklyObjectiveRewardState(next.retention, id, seasonKey, next.currentTime);
    if (!claim.ok) continue;
    const cash = def?.reward.cash ?? 0;
    const diamonds = def?.reward.diamonds ?? 0;
    next = {
      ...next,
      retention: claim.retention,
      player: {
        ...next.player,
        money: next.player.money + cash,
        diamonds: (next.player.diamonds ?? 0) + diamonds,
      },
    };
    if (cash > 0) {
      next = patchLedger(next, {
        time: next.currentTime,
        type: 'income',
        category: 'bonus',
        amount: cash,
        title: 'Haftalık görev ödülü',
        description: id,
      });
    }
  }
  return syncRetention(next);
}

function completeDeliveryHeadless(state: HeadlessSimState, deliveryId: string): HeadlessSimState {
  const sim = toSimState(state);
  const delivery = sim.deliveries.find((d) => d.id === deliveryId);
  if (!delivery || !isDeliveryProgressComplete(delivery.progress)) return state;

  const contract = sim.contracts.find((c) => c.id === delivery.contractId);
  if (!contract) return state;

  const actualTravelHours = state.currentTime - delivery.startedAt;
  if (actualTravelHours > contract.deadlineHours * 2) {
    return failDeliveryHeadless(state, deliveryId, 'too_late');
  }

  const result = safeCompleteDelivery(sim, deliveryId);
  if (!result.success || !result.updatedState) return state;

  const product = getProductByIdSafe(delivery.productId);
  const penaltyCost = product
    ? calculateLatePenalty(contract, delivery.travelHours, actualTravelHours, product)
    : 0;
  const isLate = actualTravelHours > contract.deadlineHours;

  const settlement = calculateDeliverySettlement({
    contractPayment: contract.payment ?? 0,
    fuelCost: delivery.fuelCost ?? 0,
    maintenanceCost: delivery.maintenanceCost ?? 0,
    penaltyCost,
    fuelAlreadyPaid: true,
  });

  let next = applySim(state, result.updatedState, state.player.money + settlement.cashDeltaOnCompletion);
  next = patchLedger(next, {
    time: next.currentTime,
    type: 'income',
    category: 'delivery_income',
    amount: settlement.grossRevenue,
    description: `${contract.originCityId}-${contract.destinationCityId}`,
    meta: { deliveryId },
  });
  if (settlement.maintenanceCost > 0) {
    next = patchLedger(next, {
      time: next.currentTime,
      type: 'expense',
      category: 'maintenance',
      amount: settlement.maintenanceCost,
      description: deliveryId,
    });
  }

  const repBonus =
    !isLate && shouldGrantHighReputationBonus(contract) ? HIGH_REPUTATION_SUCCESS_BONUS : 0;
  const driverXp = calculateDriverDeliveryXp({
    contract,
    distanceKm: contract.distanceKm ?? 0,
    onTime: !isLate,
    success: true,
  });

  next = {
    ...next,
    player: {
      ...next.player,
      completedContracts: (next.player.completedContracts ?? 0) + 1,
      lateDeliveries: isLate ? (next.player.lateDeliveries ?? 0) + 1 : next.player.lateDeliveries,
      reputation: isLate
        ? next.player.reputation
        : Math.min(100, (next.player.reputation ?? 0) + REPUTATION_GAIN + repBonus),
      drivers: next.player.drivers.map((driver) => {
        if (driver.id !== delivery.driverId) return driver;
        const stats = recordDriverDeliveryStats(driver, !isLate);
        return applyDriverXp(stats, driverXp, contract).driver;
      }),
    },
  };

  const xpGain = calculateDeliveryXp(
    contract.distanceKm ?? 0,
    settlement.netProfit,
    getDeliveryRiskTier(delivery),
  );
  const xpResult = applyXpToPlayer(next.player, xpGain);
  next = { ...next, player: xpResult.player };

  const contractType = normalizeContractType(contract);
  next.contractTypesCompleted[contractType] = (next.contractTypesCompleted[contractType] ?? 0) + 1;

  let retention = applyRetentionEvent(next.retention, {
    type: 'contract_completed',
    originCityId: delivery.originCityId,
    destinationCityId: delivery.destinationCityId,
    onTime: !isLate,
    contractType,
  });
  if (contractType === 'urgent') retention = applyRetentionEvent(retention, { type: 'urgent_contract_completed' });
  if (contractType === 'fragile') retention = applyRetentionEvent(retention, { type: 'fragile_contract_completed' });
  if (contractType === 'high_reputation') {
    retention = applyRetentionEvent(retention, { type: 'high_reputation_contract_completed' });
  }

  return syncRetention({ ...next, retention });
}

function failDeliveryHeadless(
  state: HeadlessSimState,
  deliveryId: string,
  reason: 'too_late' | 'breakdown' | 'accident',
): HeadlessSimState {
  const sim = toSimState(state);
  const delivery = sim.deliveries.find((d) => d.id === deliveryId);
  const contract = delivery ? sim.contracts.find((c) => c.id === delivery.contractId) : undefined;
  const penalty = calculateFailurePenalty(contract);
  const failed = failDelivery(sim, deliveryId, reason);
  let next = applySim(state, failed, Math.max(-5000, state.player.money - penalty));
  next = {
    ...next,
    player: {
      ...next.player,
      failedDeliveries: (next.player.failedDeliveries ?? 0) + 1,
      reputation: Math.max(0, (next.player.reputation ?? 0) - reputationBalance.failedDeliveryLoss),
    },
  };
  return patchLedger(next, {
    time: next.currentTime,
    type: 'expense',
    category: 'penalty',
    amount: penalty,
    description: reason,
  });
}

export function startDeliveryHeadless(state: HeadlessSimState, contractId: string): HeadlessSimState {
  const contract = state.contracts.find((c) => c.id === contractId && c.status === 'available');
  if (!contract) return state;

  const product = getProductByIdSafe(contract.productId);
  if (!product) return state;

  const truck = selectIdleTruckForContract(
    state.player.trucks,
    contract,
    product,
    state.currentTime,
  );
  const driver = state.player.drivers.find((d) => d.status === 'idle');
  if (!truck || !driver) return state;

  const route = getRouteBetweenCities(state.routes, contract.originCityId, contract.destinationCityId);
  if (!route) return state;

  const normalizedTruck = normalizeTruckFuel(truck);
  const quoteDelivery = createDelivery({
    contract,
    truck: normalizedTruck,
    driver,
    route,
    product,
    globalEconomy: state.globalEconomy,
    currentTime: state.currentTime,
    sequence: state.deliverySequence + 1,
    trailers: state.player.trailers ?? [],
  });
  const requiredFuelL = quoteDelivery.fuelLitersTotal ?? 0;
  const tankCapacityL = normalizedTruck.fuelTankCapacityL ?? 0;
  if (requiredFuelL > tankCapacityL + 1e-6) return state;
  const litersToBuy = Math.max(
    0,
    requiredFuelL - (normalizedTruck.currentFuelL ?? 0),
  );
  const refuelCost = Number(
    (litersToBuy * (state.globalEconomy.fuelPrice ?? 1.72)).toFixed(2),
  );
  if (
    refuelCost > 0 &&
    !canAffordVoluntaryPurchase(state.player.money, refuelCost)
  ) {
    return state;
  }
  const refueledTruck = {
    ...normalizedTruck,
    currentFuelL: (normalizedTruck.currentFuelL ?? 0) + litersToBuy,
  };
  const delivery = createDelivery({
    contract,
    truck: refueledTruck,
    driver,
    route,
    product,
    globalEconomy: state.globalEconomy,
    currentTime: state.currentTime,
    sequence: state.deliverySequence + 1,
    trailers: state.player.trailers ?? [],
  });

  let next: HeadlessSimState = {
    ...state,
    deliverySequence: state.deliverySequence + 1,
    player: {
      ...state.player,
      money: state.player.money - refuelCost,
      trucks: state.player.trucks.map((t) =>
        t.id === truck.id ? { ...refueledTruck, status: 'on_route' as const } : t,
      ),
      drivers: state.player.drivers.map((d) =>
        d.id === driver.id ? { ...d, status: 'driving' as const, assignedTruckId: truck.id } : d,
      ),
    },
    contracts: state.contracts.map((c) =>
      c.id === contractId ? { ...c, status: 'active' as const } : c,
    ),
    activeDeliveries: [...state.activeDeliveries, delivery],
  };
  if (refuelCost > 0) {
    next = patchLedger(next, {
      time: next.currentTime,
      type: 'expense',
      category: 'fuel',
      amount: refuelCost,
      description: contractId,
    });
  }
  return next;
}

function repairTruckHeadless(state: HeadlessSimState, truckId: string): HeadlessSimState {
  const truck = state.player.trucks.find((t) => t.id === truckId);
  if (!truck || truck.status !== 'idle' || (truck.condition ?? 100) >= 100) return state;
  const cost = calculateTruckRepairCost(truck);
  if (cost <= 0 || !canAffordVoluntaryPurchase(state.player.money, cost)) return state;

  let next: HeadlessSimState = {
    ...state,
    player: {
      ...state.player,
      money: state.player.money - cost,
      trucks: state.player.trucks.map((t) =>
        t.id === truckId ? { ...t, condition: 100 } : t,
      ),
    },
    retention: applyRetentionEvent(state.retention, { type: 'truck_maintained', truckId }),
  };
  next = patchLedger(next, {
    time: next.currentTime,
    type: 'expense',
    category: 'maintenance',
    amount: cost,
    title: 'Tamir',
  });
  return syncRetention(next);
}

function upgradeTruckHeadless(
  state: HeadlessSimState,
  truckId: string,
  upgradeType: TruckUpgradeType,
): HeadlessSimState {
  const truck = state.player.trucks.find((t) => t.id === truckId);
  if (!truck || !canUpgradeTruck(truck, upgradeType)) return state;
  const cost = getTruckUpgradeCost(truck, upgradeType);
  if (!canAffordVoluntaryPurchase(state.player.money, cost)) return state;

  let next: HeadlessSimState = {
    ...state,
    player: {
      ...state.player,
      money: state.player.money - cost,
      trucks: state.player.trucks.map((t) =>
        t.id === truckId ? applyTruckUpgrade(t, upgradeType) : t,
      ),
    },
    retention: applyRetentionEvent(state.retention, { type: 'truck_upgraded', truckId }),
  };
  return syncRetention(next);
}

function runEconomyTick(state: HeadlessSimState): HeadlessSimState {
  const tickDay = gameDayFromTime(state.lastEconomyTickTime || state.currentTime);
  const worldResult =
    tickDay > state.lastWorldEventGeneratedDay
      ? processWorldEventsForDayRange({
          worldEvents: state.worldEvents ?? [],
          fromDay: state.lastWorldEventGeneratedDay + 1,
          toDay: tickDay,
          seedKey: state.player.companyName,
        })
      : { worldEvents: state.worldEvents ?? [], lastWorldEventGeneratedDay: state.lastWorldEventGeneratedDay };

  const fuelChange = randomBetween(-0.06, 0.08);
  const prevFuel = state.globalEconomy.fuelPrice ?? 1.72;
  let fuelPrice = Math.max(0.8, prevFuel * (1 + fuelChange));
  fuelPrice = applyWorldEventImpactToFuelPrice(
    fuelPrice,
    getActiveWorldEvents(worldResult.worldEvents, tickDay),
  );

  const updatedCities = updateAllCitiesEconomy(citiesToRecord(state.cities), state.globalEconomy);

  return {
    ...state,
    cities: state.cities.map((c) => updatedCities[c.id] ?? c),
    globalEconomy: normalizeGlobalEconomy({ ...state.globalEconomy, fuelPrice: Number(fuelPrice.toFixed(2)) }),
    worldEvents: worldResult.worldEvents,
    lastWorldEventGeneratedDay: worldResult.lastWorldEventGeneratedDay,
    lastEconomyTickTime: state.lastEconomyTickTime + HOURS_PER_DAY,
  };
}

function processDailyCosts(state: HeadlessSimState, newTime: number): HeadlessSimState {
  const elapsed = computeElapsedOperatingDays(
    state.lastDailyOperatingCostTime,
    newTime,
    HOURS_PER_DAY,
  );
  if (elapsed <= 0) return state;

  // Headless sim uygulama-açık tick'i taklit eder — offline cap yok.
  const chargedDays = elapsed;
  const breakdown = calculateDailyOperatingCostBreakdown(state.player);
  const total = breakdown.total * chargedDays;
  if (total <= 0) {
    return {
      ...state,
      lastDailyOperatingCostTime: state.lastDailyOperatingCostTime + chargedDays * HOURS_PER_DAY,
    };
  }

  const deduction = applyMandatoryCashDeduction(state.player.money, total);
  let next: HeadlessSimState = {
    ...state,
    player: { ...state.player, money: deduction },
    lastDailyOperatingCostTime: state.lastDailyOperatingCostTime + chargedDays * HOURS_PER_DAY,
  };
  return patchLedger(next, {
    time: newTime,
    type: 'expense',
    category: 'daily_operating_cost',
    amount: total,
    description: `${chargedDays} gün`,
  });
}

function advanceContracts(state: HeadlessSimState, previousTime: number, newTime: number): HeadlessSimState {
  const playerLevel = Math.max(1, state.player.level ?? 1);
  const gameDay = gameDayFromTime(newTime);
  const activeEvents = getActiveWorldEvents(state.worldEvents ?? [], gameDay);

  const schedule = processContractGenerationSchedule({
    cities: citiesToRecord(state.cities),
    routes: state.routes,
    products: state.products,
    globalEconomy: state.globalEconomy,
    contracts: state.contracts,
    currentTime: newTime,
    previousTime,
    newTime,
    maxTruckCapacity: 25,
    ownedMaxTruckCapacity: 25,
    idleMaxTruckCapacity: 25,
    playerLevel,
    playerReputation: state.player.reputation ?? 0,
    idleTruckOriginCityIds: ['izmir'],
    lastContractGenerationTime: state.lastContractGenerationTime,
    lastMarketRefreshTime: state.lastMarketRefreshTime,
    lastDailyCleanupTime: state.lastDailyCleanupTime,
    lastPlayableContractGeneratedTime: state.lastPlayableContractGeneratedTime,
    activeWorldEvents: activeEvents,
  });

  return {
    ...state,
    contracts: balanceAvailableContractLevelMix(schedule.contracts, playerLevel),
    lastContractGenerationTime: schedule.lastContractGenerationTime,
    lastMarketRefreshTime: schedule.lastMarketRefreshTime,
    lastDailyCleanupTime: schedule.lastDailyCleanupTime,
    lastPlayableContractGeneratedTime: schedule.lastPlayableContractGeneratedTime,
  };
}

function updateDeliveriesHeadless(state: HeadlessSimState, hours: number): HeadlessSimState {
  let next = state;
  const toComplete: string[] = [];
  const toFail: string[] = [];
  let updatedTrucks = next.player.trucks;
  const updated = next.activeDeliveries.map((delivery) => {
    if (delivery.status !== 'on_route' && delivery.status !== 'preparing') return delivery;
    const progressFraction = hours / Math.max(delivery.travelHours, 0.1);
    if (randomBetween(0, 1) < delivery.breakdownChance * progressFraction * 0.15) {
      toFail.push(delivery.id);
      return delivery;
    }
    if (randomBetween(0, 1) < delivery.accidentChance * progressFraction * 0.12) {
      toFail.push(delivery.id);
      return delivery;
    }
    const truck = updatedTrucks.find((candidate) => candidate.id === delivery.truckId);
    if (!truck) return delivery;
    const tick = updateDeliveryProgressWithFuel(
      delivery,
      truck,
      hours,
      state.currentTime + hours,
    );
    updatedTrucks = updatedTrucks.map((candidate) =>
      candidate.id === truck.id ? tick.truck : candidate,
    );
    if (
      isDeliveryProgressComplete(tick.delivery.progress) &&
      isDeliveryFuelProgressComplete(tick.delivery)
    ) {
      toComplete.push(tick.delivery.id);
    }
    return tick.delivery;
  });

  next = {
    ...next,
    player: { ...next.player, trucks: updatedTrucks },
    activeDeliveries: updated,
  };
  for (const id of toFail) next = failDeliveryHeadless(next, id, 'breakdown');
  for (const id of toComplete) {
    if (!toFail.includes(id)) next = completeDeliveryHeadless(next, id);
  }
  return next;
}

export function advanceHeadlessSim(state: HeadlessSimState, hours: number): HeadlessSimState {
  if (hours <= 0) return state;
  const previousTime = state.currentTime;
  let next = updateDeliveriesHeadless(state, hours);
  const newTime = previousTime + hours;
  next = { ...next, currentTime: newTime };
  next = processDailyCosts(next, newTime);

  let lastEconomy = next.lastEconomyTickTime;
  while (lastEconomy + HOURS_PER_DAY <= newTime) {
    next = runEconomyTick({ ...next, lastEconomyTickTime: lastEconomy + HOURS_PER_DAY });
    lastEconomy = next.lastEconomyTickTime;
  }

  next = advanceContracts(next, previousTime, newTime);
  return next;
}

export interface SimPlayerProfile {
  id: 'casual' | 'average' | 'optimized';
  label: string;
  seed: number;
  repairThreshold: number;
  tradeChance: number;
  minTradeProfit: number;
  upgradeMinCash: number;
  maxUpgradesPerDay: number;
  riskTolerance: 'low' | 'medium' | 'high';
  preferStandardMultiplier: number;
}

function scoreContractForProfile(
  state: HeadlessSimState,
  contract: Contract,
  profile: SimPlayerProfile,
): number {
  const truck = state.player.trucks.find((t) => t.status === 'idle') ?? state.player.trucks[0];
  const driver = state.player.drivers.find((d) => d.status === 'idle') ?? state.player.drivers[0];
  if (!truck || !driver) return -Infinity;

  const preview = buildContractPreview({
    contract,
    globalEconomy: state.globalEconomy,
    trucks: state.player.trucks,
    drivers: state.player.drivers,
    companyLevel: state.player.level ?? 1,
    currentTime: state.currentTime,
    truck,
    driver,
    playerReputation: state.player.reputation ?? 0,
    activeWorldEvents: getActiveWorldEvents(state.worldEvents ?? [], gameDayFromTime(state.currentTime)),
  });

  const type = normalizeContractType(contract);
  let score = preview.estimatedNetProfit;
  if (profile.riskTolerance === 'low') {
    if (type !== 'standard') score *= 0.55;
    if (preview.riskLevel === 'high') score *= 0.4;
    if (type === 'standard') score *= profile.preferStandardMultiplier;
  } else if (profile.riskTolerance === 'medium') {
    if (type === 'standard') score *= profile.preferStandardMultiplier;
    if (preview.riskLevel === 'high') score *= 0.75;
  } else {
    score = preview.estimatedNetProfit / Math.max(1, preview.estimatedTravelHours);
    if (type !== 'standard') score *= 1.08;
  }
  return preview.estimatedNetProfit > 0 ? score : -Infinity;
}

function pickContract(state: HeadlessSimState, profile: SimPlayerProfile): Contract | null {
  const level = state.player.level ?? 1;
  const rep = state.player.reputation ?? 0;
  let best: Contract | null = null;
  let bestScore = -Infinity;
  for (const contract of state.contracts) {
    if (contract.status !== 'available') continue;
    const product = getProductByIdSafe(contract.productId);
    if (!product) continue;
    const truck = selectIdleTruckForContract(
      state.player.trucks,
      contract,
      product,
      state.currentTime,
    );
    const driver = state.player.drivers.find((d) => d.status === 'idle');
    if (!truck || !driver) continue;
    const avail = getContractAvailability(contract, [truck], [driver], level, state.currentTime, rep);
    if (!avail.canStart) continue;
    const score = scoreContractForProfile(state, contract, profile);
    if (score > bestScore) {
      bestScore = score;
      best = contract;
    }
  }
  return best;
}

function tryStartDeliveries(state: HeadlessSimState, profile: SimPlayerProfile): HeadlessSimState {
  let next = state;
  for (let i = 0; i < next.player.trucks.length; i += 1) {
    const contract = pickContract(next, profile);
    if (!contract) break;
    next = startDeliveryHeadless(next, contract.id);
  }
  return next;
}

function returnIdleTrucksHome(state: HeadlessSimState): HeadlessSimState {
  const home = state.player.homeCityId ?? 'izmir';
  let next = state;
  for (const truck of state.player.trucks) {
    if (truck.status !== 'idle') continue;
    if ((truck.currentCityId ?? home) === home) continue;
    const fuelCost = Math.round(150 + (truck.fuelConsumptionPerKm ?? 0.3) * 120);
    if (!canAffordVoluntaryPurchase(next.player.money, fuelCost)) continue;
    next = {
      ...next,
      player: {
        ...next.player,
        money: next.player.money - fuelCost,
        trucks: next.player.trucks.map((t) =>
          t.id === truck.id ? { ...t, currentCityId: home } : t,
        ),
      },
    };
    next = patchLedger(next, {
      time: next.currentTime,
      type: 'expense',
      category: 'fuel',
      amount: fuelCost,
      description: 'return_home',
    });
  }
  return next;
}

function tryRepair(state: HeadlessSimState, profile: SimPlayerProfile): HeadlessSimState {
  let next = state;
  for (const truck of next.player.trucks) {
    if ((truck.condition ?? 100) < profile.repairThreshold) {
      next = repairTruckHeadless(next, truck.id);
    }
  }
  return next;
}

function tryUpgrades(state: HeadlessSimState, profile: SimPlayerProfile): HeadlessSimState {
  if (profile.maxUpgradesPerDay <= 0 || state.player.money < profile.upgradeMinCash) return state;
  const priority: TruckUpgradeType[] = ['engine', 'fuelEfficiency', 'durability', 'cargo'];
  let next = state;
  let done = 0;
  for (const truck of next.player.trucks) {
    if (done >= profile.maxUpgradesPerDay) break;
    for (const type of priority) {
      if (done >= profile.maxUpgradesPerDay) break;
      const before = next.player.money;
      next = upgradeTruckHeadless(next, truck.id, type);
      if (next.player.money < before) done += 1;
    }
  }
  return next;
}

function tryTrade(state: HeadlessSimState, profile: SimPlayerProfile): HeadlessSimState {
  if (Math.random() > profile.tradeChance) return state;
  const warehouse = state.player.warehouses[0];
  if (!warehouse) return state;

  let next = state;
  const city = next.cities.find((c) => c.id === warehouse.cityId) ?? next.cities[0];
  if (!city) return state;

  // Satış: depoda stok + fiyat alış ortalamasının üstünde
  for (const item of warehouse.inventory ?? []) {
    if (item.quantity < 1) continue;
    const product = getProductByIdSafe(item.productId);
    if (!product) continue;
    const unitPrice = getCityProductMarketPrice(city, item.productId);
    const profit = calculateTradeProfit(item.averageBuyPrice ?? unitPrice, unitPrice, Math.min(5, item.quantity));
    if (profit < profile.minTradeProfit) continue;

    const qty = Math.min(5, item.quantity);
    const revenue = calculateTradeSellRevenue(unitPrice, qty);
    const wh = normalizeWarehouse(warehouse, next.currentTime);
    const inventory = reduceInventoryOnSell(wh.inventory ?? [], item.productId, qty);
    const usedCapacityTon = inventory.reduce((s, i) => s + i.quantity, 0);
    next = {
      ...next,
      player: {
        ...next.player,
        money: next.player.money + revenue,
        warehouses: next.player.warehouses.map((w) =>
          w.id === warehouse.id ? { ...w, inventory, usedCapacityTon } : w,
        ),
      },
      retention: applyRetentionEvent(next.retention, {
        type: 'trade_completed',
        profit,
        productId: item.productId,
        side: 'sell',
      }),
    };
    next = patchLedger(next, {
      time: next.currentTime,
      type: 'income',
      category: 'trade_sale',
      amount: revenue,
      meta: { profit, productId: item.productId },
    });
    return syncRetention(next);
  }

  if (profile.id === 'casual') return state;

  // Alım: şehirde ucuz ürün + depo kapasitesi
  for (const product of next.products) {
    const unitPrice = getCityProductMarketPrice(city, product.id);
    const base = city.products[product.id]?.basePrice ?? unitPrice;
    if (unitPrice > base * 0.92) continue;
    const stock = getCityProductStock(city, product.id);
    const qty = profile.id === 'optimized' ? 8 : 4;
    if (stock < qty || next.player.money < 12_000) continue;
    const cost = calculateTradeBuyCost(unitPrice, qty);
    if (!canAffordVoluntaryPurchase(next.player.money, cost)) continue;
    const wh = normalizeWarehouse(warehouse, next.currentTime);
    if (getWarehouseFreeCapacityTon(wh) < qty) continue;
    const inventory = mergeInventoryOnBuy(
      wh.inventory ?? [],
      product.id,
      qty,
      unitPrice,
      wh,
      next.currentTime,
    );
    const usedCapacityTon = inventory.reduce((s, i) => s + i.quantity, 0);
    next = {
      ...next,
      player: {
        ...next.player,
        money: next.player.money - cost,
        warehouses: next.player.warehouses.map((w) =>
          w.id === warehouse.id ? { ...w, inventory, usedCapacityTon } : w,
        ),
      },
      retention: applyRetentionEvent(next.retention, {
        type: 'trade_completed',
        profit: 0,
        productId: product.id,
        side: 'buy',
      }),
    };
    next = patchLedger(next, {
      time: next.currentTime,
      type: 'expense',
      category: 'trade_purchase',
      amount: cost,
    });
    return syncRetention(next);
  }

  return next;
}

export interface SimRunMetrics {
  profile: SimPlayerProfile['id'];
  startCash: number;
  cashDay7: number;
  cashDay14: number;
  cashDay30: number;
  startCompanyScore: number;
  companyScoreDay30: number;
  startReputation: number;
  reputationDay30: number;
  completedDeliveries: number;
  failedDeliveries: number;
  lateDeliveries: number;
  avgContractNet: number;
  totalTradeProfit: number;
  totalFuelCost: number;
  totalMaintenanceCost: number;
  totalDailyOpsCost: number;
  truckCount: number;
  driverLevels: Record<number, number>;
  maxDriverLevel: number;
  upgradeCount: number;
  warehouseUsagePct: number;
  contractTypesCompleted: Record<string, number>;
  milestonesClaimed: number;
  milestonesRemaining: number;
  weeklyObjectivesClaimed: number;
  retentionReadyRewards: number;
  avgWorldEventsActive: number;
  playableContractLowDays: number;
  negativeCashDays: number;
  playerLevel: number;
}

function sumLedger(state: HeadlessSimState, category: string, type: 'income' | 'expense' = 'expense'): number {
  const lifetimeTotals =
    type === 'income'
      ? state.financeTotals.incomeByCategory
      : state.financeTotals.expenseByCategory;
  const lifetimeAmount = lifetimeTotals[category];
  if (Number.isFinite(lifetimeAmount)) {
    return lifetimeAmount;
  }
  return state.financeLedger
    .filter((e) => e.category === category && e.type === type)
    .reduce((s, e) => s + e.amount, 0);
}

function sumTradeProfit(state: HeadlessSimState): number {
  return state.financeLedger
    .filter((e) => e.type === 'income' && e.category === 'trade_sale')
    .reduce((s, e) => s + (typeof e.meta?.profit === 'number' ? e.meta.profit : 0), 0);
}

export function runHeadlessSim(profile: SimPlayerProfile, days: number): SimRunMetrics {
  let state = createHeadlessSimState(`Sim ${profile.label}`);
  const startCash = state.player.money;
  const startScore = calculateCompanyScore(state);
  const startRep = state.player.reputation ?? 0;

  const cashSnapshots: Record<number, number> = {};
  let playableLowDays = 0;
  let negativeCashDays = 0;
  let worldEventTotal = 0;
  let worldEventSamples = 0;

  for (let day = 1; day <= days; day += 1) {
    state = returnIdleTrucksHome(state);
    state = claimAllRewards(state);
    state = tryRepair(state, profile);
    state = tryTrade(state, profile);
    state = tryStartDeliveries(state, profile);

    for (let step = 0; step < HOURS_PER_DAY / 4; step += 1) {
      state = advanceHeadlessSim(state, 4);
      state = tryStartDeliveries(state, profile);
    }

    state = tryUpgrades(state, profile);
    state = claimAllRewards(state);

    if (day === 7) cashSnapshots[7] = state.player.money;
    if (day === 14) cashSnapshots[14] = state.player.money;
    if (day === 30) cashSnapshots[30] = state.player.money;

    const gameDay = gameDayFromTime(state.currentTime);

    const playable = countPlayableContracts(
      state.contracts,
      state.player.trucks,
      state.player.drivers,
      state.player.level ?? 1,
      state.currentTime,
      { playerMoney: state.player.money, globalEconomy: state.globalEconomy },
    );
    if (playable < 2) playableLowDays += 1;
    if (state.player.money < 0) negativeCashDays += 1;

    const active = getActiveWorldEvents(state.worldEvents ?? [], gameDay);
    worldEventTotal += active.length;
    worldEventSamples += 1;
  }

  state = syncRetention(state);
  const msClaimed = Object.values(state.retention.milestones).filter((m) => m.isClaimed).length;
  const weeklyClaimed = Object.values(state.retention.weeklyObjectives).filter((o) => o.isClaimed).length;
  const driverLevels: Record<number, number> = {};
  let maxDriverLevel = 1;
  for (const d of state.player.drivers) {
    const lvl = d.level ?? 1;
    driverLevels[lvl] = (driverLevels[lvl] ?? 0) + 1;
    maxDriverLevel = Math.max(maxDriverLevel, lvl);
  }

  const wh = state.player.warehouses[0];
  const cap = wh?.capacityTons ?? 100;
  const usage = cap > 0 ? ((wh?.usedCapacityTon ?? 0) / cap) * 100 : 0;

  const deliveryIncome = sumLedger(state, 'contract_income', 'income');
  const fuel = sumLedger(state, 'fuel', 'expense');
  const maint = sumLedger(state, 'maintenance', 'expense');
  const completed = state.player.completedContracts ?? 0;

  return {
    profile: profile.id,
    startCash,
    cashDay7: cashSnapshots[7] ?? state.player.money,
    cashDay14: cashSnapshots[14] ?? state.player.money,
    cashDay30: cashSnapshots[30] ?? state.player.money,
    startCompanyScore: startScore,
    companyScoreDay30: calculateCompanyScore(state),
    startReputation: startRep,
    reputationDay30: state.player.reputation ?? 0,
    completedDeliveries: completed,
    failedDeliveries: state.player.failedDeliveries ?? 0,
    lateDeliveries: state.player.lateDeliveries ?? 0,
    avgContractNet: completed > 0 ? (deliveryIncome - fuel - maint) / completed : 0,
    totalTradeProfit: sumTradeProfit(state),
    totalFuelCost: fuel,
    totalMaintenanceCost: maint,
    totalDailyOpsCost: sumLedger(state, 'daily_operating_cost', 'expense'),
    truckCount: state.player.trucks.length,
    driverLevels,
    maxDriverLevel,
    upgradeCount: state.retention.lifetimeStats.truckUpgradeCount ?? 0,
    warehouseUsagePct: usage,
    contractTypesCompleted: state.contractTypesCompleted,
    milestonesClaimed: msClaimed,
    milestonesRemaining: MILESTONE_DEFINITIONS.length - msClaimed,
    weeklyObjectivesClaimed: weeklyClaimed,
    retentionReadyRewards: getReadyMilestones(state.retention).length + getReadyWeeklyObjectives(state.retention, getWeeklySeasonKey()).length,
    avgWorldEventsActive: worldEventSamples > 0 ? worldEventTotal / worldEventSamples : 0,
    playableContractLowDays: playableLowDays,
    negativeCashDays,
    playerLevel: state.player.level ?? 1,
  };
}

export const SIM_PROFILES: SimPlayerProfile[] = [
  {
    id: 'casual',
    label: 'Yeni / Casual',
    seed: 42_001,
    repairThreshold: 50,
    tradeChance: 0.12,
    minTradeProfit: 800,
    upgradeMinCash: 35_000,
    maxUpgradesPerDay: 0,
    riskTolerance: 'low',
    preferStandardMultiplier: 1.35,
  },
  {
    id: 'average',
    label: 'Ortalama',
    seed: 42_002,
    repairThreshold: 60,
    tradeChance: 0.38,
    minTradeProfit: 400,
    upgradeMinCash: 28_000,
    maxUpgradesPerDay: 1,
    riskTolerance: 'medium',
    preferStandardMultiplier: 1.0,
  },
  {
    id: 'optimized',
    label: 'Optimize',
    seed: 42_003,
    repairThreshold: 70,
    tradeChance: 0.72,
    minTradeProfit: 150,
    upgradeMinCash: 22_000,
    maxUpgradesPerDay: 2,
    riskTolerance: 'high',
    preferStandardMultiplier: 0.85,
  },
];

export function installProfileSeed(profile: SimPlayerProfile): void {
  let s = profile.seed >>> 0;
  Math.random = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
