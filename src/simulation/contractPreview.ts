/**
 * Sözleşme kartı tahminleri — delivery.ts simülasyon mantığıyla uyumlu, saf helper'lar.
 * State değiştirmez; teslimat oluşturmaz.
 */

import { deliveryBalance, deliveryCostBalance } from '../config/balance';
import { getRoute as findRoute } from '../data/routes';
import { getProductByIdSafe } from '../utils/entityLookup';
import { clamp } from '../utils/math';
import type {
  Contract,
  ContractAvailability,
  Driver,
  GlobalEconomy,
  Product,
  Route,
  Truck,
} from '../types/game';
import { getSafeGlobalEconomy } from './economy';
import {
  estimateContractTripCostBreakdown,
} from './contractEconomics';
import {
  calculateDeliveryProfit,
  calculateFuelCost,
  calculateMaintenanceCost,
  calculateTravelHours,
  getContractAvailability,
  getContractCargoWeight,
  getIdleDrivers,
  selectIdleTruckForContract,
} from './delivery';

const URGENT_URGENCY_THRESHOLD = 0.75;
const URGENT_DEADLINE_SLACK = 0.95;
const FALLBACK_AVERAGE_SPEED_KMH = deliveryBalance.defaultAverageSpeed;

export type ContractRiskLevel = 'low' | 'medium' | 'high';

export const CONTRACT_RISK_LABELS: Record<ContractRiskLevel, string> = {
  low: 'Düşük Risk',
  medium: 'Orta Risk',
  high: 'Yüksek Risk',
};

/** Sözleşme kartı / atama modalı bilgi metni */
export const CONTRACT_OPERATIONAL_PROFIT_INFO =
  'İş kârı, teslimata bağlı tahmini giderler düşüldükten sonraki değerdir. Günlük şoför ve depo giderleri Finans ekranında ayrı izlenir.';

/** Atama modalı kısa açıklama */
export const CONTRACT_OPERATIONAL_PROFIT_DETAIL_HINT =
  'Yakıt ve teslimat giderleri düşülmüştür. Günlük şoför/depo giderleri ayrıca işletme giderlerinde izlenir.';

export interface ContractPreview {
  estimatedTravelHours: number;
  estimatedFuelCost: number;
  estimatedMaintenanceCost: number;
  /** Yakıt + bakım tahmini — günlük sabit giderler dahil değil */
  estimatedTripCost: number;
  estimatedGrossPayment: number;
  /** Ödeme − estimatedTripCost — günlük şoför/depo giderleri dahil değil */
  estimatedOperationalProfit: number;
  excludesDailyFixedCosts: true;
  /** @deprecated `estimatedTripCost` kullanın */
  estimatedTotalCost: number;
  /** @deprecated `estimatedOperationalProfit` kullanın */
  estimatedNetProfit: number;
  estimatedMarginPercent: number;
  riskLevel: ContractRiskLevel;
  riskLabel: string;
  availability: ContractAvailability;
  isUrgent: boolean;
  suggestedTruck?: Truck;
  suggestedDriver?: Driver;
  route?: Route;
}

export interface BuildContractPreviewInput {
  contract: Contract;
  route?: Route;
  product?: Product;
  globalEconomy?: GlobalEconomy;
  trucks?: Truck[];
  drivers?: Driver[];
  companyLevel?: number;
  currentTime?: number;
  truck?: Truck;
  driver?: Driver;
}

function resolveRoute(contract: Contract, route?: Route): Route | undefined {
  if (route) {
    return route;
  }
  return findRoute(contract.originCityId, contract.destinationCityId);
}

function resolveProduct(contract: Contract, product?: Product): Product | undefined {
  if (product) {
    return product;
  }
  return getProductByIdSafe(contract.productId) ?? undefined;
}

function selectPreviewTruckAndDriver(
  contract: Contract,
  trucks: Truck[],
  drivers: Driver[],
  product: Product | undefined,
  explicitTruck?: Truck,
  explicitDriver?: Driver,
  currentTime = 0,
): { truck?: Truck; driver?: Driver } {
  if (explicitTruck && explicitDriver) {
    return { truck: explicitTruck, driver: explicitDriver };
  }

  const truck =
    explicitTruck ??
    (trucks.length > 0
      ? selectIdleTruckForContract(trucks, contract, product, currentTime)
      : undefined);
  const driver = explicitDriver ?? getIdleDrivers(drivers)[0];

  return { truck, driver };
}

export function calculateContractRiskLevel(
  contract: Contract,
  route?: Route,
  product?: Product,
): { riskLevel: ContractRiskLevel; riskLabel: string } {
  const resolvedRoute = resolveRoute(contract, route);
  const resolvedProduct = resolveProduct(contract, product);
  const difficulty = resolvedRoute?.difficulty ?? 0.5;
  const deadlineHours = contract.deadlineHours ?? 0;
  const deadlinePressure = clamp(1 - deadlineHours / 48, 0, 1);
  const urgency = contract.urgency ?? 0;

  const riskScore =
    urgency * 0.35 +
    deadlinePressure * 0.25 +
    difficulty * 0.25 +
    (resolvedProduct?.perishability ?? 0) * 0.15;

  if (riskScore >= 0.6) {
    return { riskLevel: 'high', riskLabel: CONTRACT_RISK_LABELS.high };
  }
  if (riskScore >= 0.35) {
    return { riskLevel: 'medium', riskLabel: CONTRACT_RISK_LABELS.medium };
  }
  return { riskLevel: 'low', riskLabel: CONTRACT_RISK_LABELS.low };
}

export function isUrgentContractPreview(
  contract: Contract,
  estimatedTravelHours: number,
): boolean {
  if ((contract.urgency ?? 0) >= URGENT_URGENCY_THRESHOLD) {
    return true;
  }

  if (estimatedTravelHours <= 0) {
    return false;
  }

  return (contract.deadlineHours ?? 0) < estimatedTravelHours * URGENT_DEADLINE_SLACK;
}

function estimateTravelHoursFallback(contract: Contract): number {
  const distanceKm = contract.distanceKm ?? 0;
  if (distanceKm > 0) {
    return distanceKm / FALLBACK_AVERAGE_SPEED_KMH;
  }
  return 0;
}

function estimateFuelCostFallback(
  contract: Contract,
  globalEconomy?: GlobalEconomy,
): number {
  const route = findRoute(contract.originCityId, contract.destinationCityId);
  if (!route) {
    const distanceKm = contract.distanceKm ?? 0;
    const fuelPrice = getSafeGlobalEconomy(globalEconomy).fuelPrice;
    return Math.round(
      distanceKm *
        fuelPrice *
        deliveryBalance.fuelCostEstimateMultiplier *
        deliveryCostBalance.fuelCostMultiplier,
    );
  }

  const breakdown = estimateContractTripCostBreakdown({
    amount: contract.cargoWeight ?? contract.amount ?? 0,
    route,
    urgency: contract.urgency ?? 0,
    globalEconomy: getSafeGlobalEconomy(globalEconomy),
  });
  return breakdown.fuelCost;
}

function estimateMaintenanceCostFallback(
  contract: Contract,
  route?: Route,
  globalEconomy?: GlobalEconomy,
): number {
  const resolvedRoute = route ?? findRoute(contract.originCityId, contract.destinationCityId);
  if (!resolvedRoute) {
    const distanceKm = contract.distanceKm ?? 0;
    const routeDifficulty = 0.5;
    return Math.round(
      distanceKm *
        deliveryBalance.maintenanceCostPerKm *
        routeDifficulty *
        deliveryCostBalance.maintenanceCostMultiplier,
    );
  }

  const breakdown = estimateContractTripCostBreakdown({
    amount: contract.cargoWeight ?? contract.amount ?? 0,
    route: resolvedRoute,
    urgency: contract.urgency ?? 0,
    globalEconomy: getSafeGlobalEconomy(globalEconomy),
  });
  return breakdown.maintenanceCost + breakdown.routeDifficultyCost + breakdown.cargoHandlingCost;
}

export function buildContractPreview(input: BuildContractPreviewInput): ContractPreview {
  const contract = input.contract;
  const trucks = input.trucks ?? [];
  const drivers = input.drivers ?? [];
  const companyLevel = Math.max(1, input.companyLevel ?? 1);
  const currentTime = Math.max(0, input.currentTime ?? 0);
  const route = resolveRoute(contract, input.route);
  const product = resolveProduct(contract, input.product);
  const payment = contract.payment ?? 0;
  const safeEconomy = getSafeGlobalEconomy(input.globalEconomy);

  const availability = getContractAvailability(
    contract,
    trucks,
    drivers,
    companyLevel,
    currentTime,
  );
  const { truck, driver } = selectPreviewTruckAndDriver(
    contract,
    trucks,
    drivers,
    product,
    input.truck,
    input.driver,
    currentTime,
  );

  let estimatedTravelHours = 0;
  let estimatedFuelCost = 0;
  let estimatedMaintenanceCost = 0;

  if (truck && driver && route && product) {
    estimatedTravelHours = calculateTravelHours(contract, truck, driver, route, product);
    estimatedFuelCost = calculateFuelCost(contract, truck, driver, route, product, safeEconomy);
    estimatedMaintenanceCost = calculateMaintenanceCost(truck, route, contract, product);
  } else {
    estimatedTravelHours = estimateTravelHoursFallback(contract);
    estimatedFuelCost = estimateFuelCostFallback(contract, safeEconomy);
    estimatedMaintenanceCost = estimateMaintenanceCostFallback(contract, route, safeEconomy);
  }

  const estimatedTripCost =
    estimatedFuelCost +
    estimatedMaintenanceCost +
    (truck && route && product
      ? Math.round(
          (contract.cargoWeight ?? contract.amount ?? 0) *
            deliveryCostBalance.cargoHandlingCostPerTon,
        )
      : 0);
  const estimatedOperationalProfit = calculateDeliveryProfit(
    contract,
    estimatedFuelCost,
    estimatedMaintenanceCost,
    0,
  );
  const estimatedMarginPercent = payment > 0 ? estimatedOperationalProfit / payment : 0;

  const { riskLevel, riskLabel } = calculateContractRiskLevel(contract, route, product);
  const isUrgent = isUrgentContractPreview(contract, estimatedTravelHours);

  return {
    estimatedTravelHours,
    estimatedFuelCost,
    estimatedMaintenanceCost,
    estimatedTripCost,
    estimatedGrossPayment: payment,
    estimatedOperationalProfit,
    excludesDailyFixedCosts: true,
    estimatedTotalCost: estimatedTripCost,
    estimatedNetProfit: estimatedOperationalProfit,
    estimatedMarginPercent,
    riskLevel,
    riskLabel,
    availability,
    isUrgent,
    suggestedTruck: input.truck ? undefined : truck,
    suggestedDriver: input.driver ? undefined : driver,
    route,
  };
}
