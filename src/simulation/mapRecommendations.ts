/**
 * Harita ekranı alt kartı — şirket durumuna göre uygulanabilir öneri motoru.
 */

import { deliveryBalance } from '../config/balance';
import { getRoute as findRoute } from '../data/routes';
import { getProductByIdSafe } from '../utils/entityLookup';
import { clamp } from '../utils/math';
import type {
  City,
  Contract,
  Delivery,
  Driver,
  GlobalEconomy,
  MarketOpportunity,
  Player,
  ProductId,
  RecommendedMapAction,
  Truck,
  Warehouse,
} from '../types/game';
import {
  getContractAvailability,
  getContractCargoWeight,
  getIdleDrivers,
  getIdleTrucks,
  selectIdleTruckForContract,
} from './delivery';
import { getContractRequiredLevel } from './leveling';
import { calculateTradeProfit, getCityProductMarketPrice } from './trading';

const FALLBACK_FUEL_RATE_PER_KM = deliveryBalance.fuelCostEstimateMultiplier;
const FALLBACK_DRIVER_SALARY_PER_DAY = deliveryBalance.fallbackDriverSalaryPerDay;
const WAREHOUSE_TRADE_MIN_PROFIT = 500;
const MARKET_OPPORTUNITY_BONUS = 2500;
const HIGH_RISK_LOW_PROFIT_THRESHOLD = 3000;

export interface GetRecommendedMapActionParams {
  contracts: Contract[] | undefined;
  player: Player | null | undefined;
  activeDeliveries: Delivery[] | undefined;
  marketOpportunities: MarketOpportunity[] | undefined;
  cities: City[] | undefined;
  globalEconomy: GlobalEconomy | undefined;
  currentTime: number;
}

interface ScoredContract {
  contract: Contract;
  score: number;
  estimatedProfit: number;
  riskLabel: string;
  reason: string;
}

function getRiskLabel(contract: Contract): string {
  const route = findRoute(contract.originCityId, contract.destinationCityId);
  const product = getProductByIdSafe(contract.productId);
  const difficulty = route?.difficulty ?? 0.5;
  const deadlinePressure = clamp(1 - contract.deadlineHours / 48, 0, 1);
  const riskScore =
    contract.urgency * 0.35 +
    deadlinePressure * 0.25 +
    difficulty * 0.25 +
    (product?.perishability ?? 0) * 0.15;

  if (riskScore >= 0.6) return 'Yüksek risk';
  if (riskScore >= 0.35) return 'Orta risk';
  return 'Düşük risk';
}

function getRiskPenalty(riskLabel: string): number {
  if (riskLabel === 'Yüksek risk') return 3000;
  if (riskLabel === 'Orta risk') return 1000;
  return 0;
}

function getRiskMultiplier(riskLabel: string): number {
  if (riskLabel === 'Yüksek risk') return deliveryBalance.riskReserveHigh;
  if (riskLabel === 'Orta risk') return deliveryBalance.riskReserveMedium;
  return deliveryBalance.riskReserveLow;
}

function estimateContractProfit(
  contract: Contract,
  globalEconomy: GlobalEconomy,
  truck?: Truck,
  driver?: Driver,
): number {
  const route = findRoute(contract.originCityId, contract.destinationCityId);
  const routeDifficulty = route?.difficulty ?? 0.5;
  const travelHours =
    contract.distanceKm > 0 ? contract.distanceKm / deliveryBalance.defaultAverageSpeed : 0;
  const salaryPerDay = driver?.salaryPerDay ?? FALLBACK_DRIVER_SALARY_PER_DAY;
  const riskLabel = getRiskLabel(contract);

  const fuelCost = contract.distanceKm * globalEconomy.fuelPrice * FALLBACK_FUEL_RATE_PER_KM;
  const driverCost = (salaryPerDay / 24) * travelHours;
  const maintenanceCost =
    contract.distanceKm * deliveryBalance.maintenanceCostPerKm * routeDifficulty;
  const riskReserve = contract.payment * getRiskMultiplier(riskLabel);
  const totalExpense = fuelCost + driverCost + maintenanceCost + riskReserve;

  return contract.payment - totalExpense;
}

function matchesMarketOpportunity(
  contract: Contract,
  opportunities: MarketOpportunity[],
): boolean {
  return opportunities.some(
    (opportunity) =>
      opportunity.fromCityId === contract.originCityId &&
      opportunity.toCityId === contract.destinationCityId &&
      opportunity.productId === contract.productId,
  );
}

function buildContractReason(riskLabel: string, estimatedProfit: number): string {
  if (riskLabel === 'Düşük risk') {
    return 'Boşta kamyonun bu işe uygun ve kâr oranı yüksek.';
  }
  if (estimatedProfit >= 8000) {
    return 'Boşta kamyonun bu işe uygun; yüksek kâr potansiyeli var.';
  }
  return 'Boşta kamyonun bu işe uygun ve hemen başlatılabilir.';
}

function scoreEligibleContract(
  contract: Contract,
  playerLevel: number,
  trucks: Truck[],
  drivers: Driver[],
  globalEconomy: GlobalEconomy,
  marketOpportunities: MarketOpportunity[],
  trailers?: import('../types/game').Trailer[],
  playerReputation = 0,
  homeCityId?: string,
): ScoredContract | null {
  const availability = getContractAvailability(
    contract,
    trucks,
    drivers,
    playerLevel,
    0,
    playerReputation,
    homeCityId,
    trailers,
  );
  if (!availability.canStart) {
    return null;
  }

  const product = getProductByIdSafe(contract.productId);
  const suggestedTruck = selectIdleTruckForContract(
    trucks,
    contract,
    product ?? undefined,
    0,
    homeCityId,
    trailers,
  );
  const suggestedDriver = getIdleDrivers(drivers)[0];
  const estimatedProfit = estimateContractProfit(
    contract,
    globalEconomy,
    suggestedTruck,
    suggestedDriver,
  );

  if (estimatedProfit <= 0) {
    return null;
  }

  const riskLabel = getRiskLabel(contract);
  if (riskLabel === 'Yüksek risk' && estimatedProfit < HIGH_RISK_LOW_PROFIT_THRESHOLD) {
    return null;
  }

  let score = estimatedProfit + contract.payment * 0.2;
  score -= getRiskPenalty(riskLabel);
  score -= contract.distanceKm * 2;

  if (matchesMarketOpportunity(contract, marketOpportunities)) {
    score += MARKET_OPPORTUNITY_BONUS;
  }

  return {
    contract,
    score,
    estimatedProfit,
    riskLabel,
    reason: buildContractReason(riskLabel, estimatedProfit),
  };
}

function findBestEligibleContract(
  contracts: Contract[],
  playerLevel: number,
  trucks: Truck[],
  drivers: Driver[],
  globalEconomy: GlobalEconomy,
  marketOpportunities: MarketOpportunity[],
  trailers?: import('../types/game').Trailer[],
  playerReputation = 0,
  homeCityId?: string,
): ScoredContract | null {
  let best: ScoredContract | null = null;

  for (const contract of contracts) {
    if (contract.status !== 'available') continue;
    if (getContractRequiredLevel(contract) > playerLevel) continue;

    const scored = scoreEligibleContract(
      contract,
      playerLevel,
      trucks,
      drivers,
      globalEconomy,
      marketOpportunities,
      trailers,
      playerReputation,
      homeCityId,
    );
    if (!scored) continue;
    if (!best || scored.score > best.score) {
      best = scored;
    }
  }

  return best;
}

function findNearestActiveDelivery(
  deliveries: Delivery[],
  currentTime: number,
): Delivery | undefined {
  const active = deliveries.filter(
    (delivery) => delivery.status === 'preparing' || delivery.status === 'on_route',
  );
  if (active.length === 0) return undefined;

  return [...active].sort(
    (a, b) =>
      a.estimatedArrivalTime - currentTime - (b.estimatedArrivalTime - currentTime) ||
      b.progress - a.progress,
  )[0];
}

function findBestWarehouseTradeOpportunity(
  warehouses: Warehouse[],
  cities: City[],
): { warehouseId: string; productId: ProductId; profit: number } | null {
  let best: { warehouseId: string; productId: ProductId; profit: number } | null = null;

  for (const warehouse of warehouses) {
    const city = cities.find((candidate) => candidate.id === warehouse.cityId);
    if (!city) continue;

    for (const item of warehouse.inventory ?? []) {
      if (item.quantity <= 0) continue;

      const currentPrice = getCityProductMarketPrice(city, item.productId);
      const profit = calculateTradeProfit(
        currentPrice,
        item.averageBuyPrice ?? currentPrice,
        item.quantity,
        item.quality ?? 100,
      );

      if (profit < WAREHOUSE_TRADE_MIN_PROFIT) continue;
      if (!best || profit > best.profit) {
        best = {
          warehouseId: warehouse.id,
          productId: item.productId,
          profit,
        };
      }
    }
  }

  return best;
}

function hasCapacityBlockedContracts(
  contracts: Contract[],
  playerLevel: number,
  trucks: Truck[],
  drivers: Driver[],
  trailers?: import('../types/game').Trailer[],
  playerReputation = 0,
  homeCityId?: string,
): boolean {
  const idleTrucks = getIdleTrucks(trucks);
  const idleDrivers = getIdleDrivers(drivers);
  if (idleTrucks.length === 0 || idleDrivers.length === 0) {
    return false;
  }

  return contracts.some((contract) => {
    if (contract.status !== 'available') return false;
    if (getContractRequiredLevel(contract) > playerLevel) return false;

    const availability = getContractAvailability(
      contract,
      trucks,
      drivers,
      playerLevel,
      0,
      playerReputation,
      homeCityId,
      trailers,
    );
    return (
      availability.reason === 'NO_TRUCK_WITH_CAPACITY' ||
      availability.reason === 'CAPACITY_INSUFFICIENT'
    );
  });
}

export function getRecommendedMapAction(params: GetRecommendedMapActionParams): RecommendedMapAction {
  const contracts = params.contracts ?? [];
  const player = params.player;
  const trucks = player?.trucks ?? [];
  const drivers = player?.drivers ?? [];
  const trailers = player?.trailers ?? [];
  const warehouses = player?.warehouses ?? [];
  const activeDeliveries = params.activeDeliveries ?? [];
  const marketOpportunities = params.marketOpportunities ?? [];
  const cities = params.cities ?? [];
  const globalEconomy = params.globalEconomy;
  const playerLevel = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
  const playerReputation = player?.reputation ?? 0;
  const homeCityId = player?.homeCityId;

  const availableContracts = contracts.filter((contract) => contract.status === 'available');
  const idleTrucks = getIdleTrucks(trucks);
  const idleDrivers = getIdleDrivers(drivers);
  const runningDeliveries = activeDeliveries.filter(
    (delivery) => delivery.status === 'preparing' || delivery.status === 'on_route',
  );

  if (globalEconomy) {
    const bestContract = findBestEligibleContract(
      availableContracts,
      playerLevel,
      trucks,
      drivers,
      globalEconomy,
      marketOpportunities,
      trailers,
      playerReputation,
      homeCityId,
    );

    if (bestContract) {
      return {
        type: 'contract',
        contractId: bestContract.contract.id,
        title: 'Önerilen İş',
        reason: bestContract.reason,
        estimatedProfit: bestContract.estimatedProfit,
        riskLabel: bestContract.riskLabel,
        buttonLabel: 'İşi Gör',
      };
    }
  }

  if (runningDeliveries.length > 0 && idleTrucks.length === 0) {
    const nearestDelivery = findNearestActiveDelivery(runningDeliveries, params.currentTime);
    if (nearestDelivery) {
      return {
        type: 'active_delivery',
        deliveryId: nearestDelivery.id,
        title: 'Aktif Teslimat',
        reason: 'Tüm kamyonların görevde. En yakın teslimatı takip edebilirsin.',
        buttonLabel: "Dashboard'a Git",
      };
    }

    return {
      type: 'fleet_upgrade',
      title: 'Teslimatlar Yolda',
      reason:
        'Tüm kamyonların görevde. Yeni iş almak için teslimatın bitmesini bekle veya yeni kamyon satın al.',
      buttonLabel: "Filo'yu Aç",
      fleetTarget: 'shop',
    };
  }

  if (trucks.length > 0 && idleTrucks.length === 0) {
    return {
      type: 'fleet_upgrade',
      title: 'Teslimatlar Yolda',
      reason:
        'Tüm kamyonların görevde. Yeni iş almak için teslimatın bitmesini bekle veya yeni kamyon satın al.',
      buttonLabel: "Filo'yu Aç",
      fleetTarget: 'trucks',
    };
  }

  if (drivers.length > 0 && idleDrivers.length === 0) {
    return {
      type: 'fleet_upgrade',
      title: 'Şoför Gerekli',
      reason: 'Yeni teslimat için boşta şoförün yok.',
      buttonLabel: 'Şoför Havuzu',
      fleetTarget: 'hire_drivers',
    };
  }

  if (
    globalEconomy &&
    hasCapacityBlockedContracts(
      availableContracts,
      playerLevel,
      trucks,
      drivers,
      trailers,
      playerReputation,
      homeCityId,
    )
  ) {
    return {
      type: 'fleet_upgrade',
      title: 'Daha Büyük Kamyon Gerekli',
      reason: 'Mevcut işler için daha yüksek kapasiteli kamyon gerekiyor.',
      buttonLabel: 'Kamyon Mağazası',
      fleetTarget: 'shop',
    };
  }

  const warehouseTrade = findBestWarehouseTradeOpportunity(warehouses, cities);
  if (warehouseTrade) {
    return {
      type: 'warehouse_trade',
      title: 'Ticaret Fırsatı',
      reason: 'Depodaki ürünlerden biri kârlı satış seviyesine ulaştı.',
      buttonLabel: 'Depoları Aç',
      warehouseId: warehouseTrade.warehouseId,
      productId: warehouseTrade.productId,
    };
  }

  return {
    type: 'none',
    title: 'Fırsat Bekleniyor',
    reason: 'Piyasa yeni sözleşmeler oluşturdukça burada öneriler görünür.',
    buttonLabel: 'Piyasayı Gör',
  };
}

export function getRecommendedContractById(
  contracts: Contract[] | undefined,
  contractId: string,
): Contract | undefined {
  return (contracts ?? []).find((contract) => contract.id === contractId);
}

export function getRecommendedDeliveryById(
  deliveries: Delivery[] | undefined,
  deliveryId: string,
): Delivery | undefined {
  return (deliveries ?? []).find((delivery) => delivery.id === deliveryId);
}

/** Öneri kartında gösterilecek ton bilgisi */
export function getRecommendedContractTons(contract: Contract): number {
  const product = getProductByIdSafe(contract.productId);
  return getContractCargoWeight(contract, product ?? undefined);
}
