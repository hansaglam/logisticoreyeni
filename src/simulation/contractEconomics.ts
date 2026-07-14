/**
 * Sözleşme maliyet ve ödeme ekonomisi — üretim, önizleme ve debug için tek kaynak.
 */

import {
  contractBalance,
  contractPaymentBalance,
  deliveryBalance,
  deliveryCostBalance,
} from '../config/balance';
import { getRequiredLevelForTonnage } from '../config/levelConfig';
import type { GlobalEconomy, Product, ProductMarket, Route } from '../types/game';
import { clamp } from '../utils/math';

export interface ContractTripCostInput {
  amount: number;
  route: Route;
  urgency: number;
  globalEconomy: GlobalEconomy;
  /** Kamyon atanmamış tahminlerde kullanılır */
  fuelConsumptionPerKm?: number;
}

export interface ContractTripCostBreakdown {
  fuelCost: number;
  maintenanceCost: number;
  routeDifficultyCost: number;
  cargoHandlingCost: number;
  riskReserve: number;
  baseTripCost: number;
}

export interface ContractPaymentInput extends ContractTripCostInput {
  product: Product;
  originMarket: ProductMarket;
  destinationMarket: ProductMarket;
  requiredLevel?: number;
  isMarketOpportunity?: boolean;
}

export interface ContractEconomyDebugStats {
  sampleCount: number;
  averageContractPayment: number;
  averageEstimatedCost: number;
  averageEstimatedNetProfit: number;
  averageMarginPercent: number;
  level1ContractPaymentMin: number;
  level1ContractPaymentMax: number;
  level1MarginMin: number;
  level1MarginMax: number;
}

/** Ağır yüklerde maliyet çarpanı */
export function getCargoWeightCostMultiplier(cargoWeightTon: number): number {
  const weight = Math.max(0, cargoWeightTon);
  if (weight <= 15) return 1;
  if (weight <= 30) return 1.15;
  if (weight <= 60) return 1.35;
  return 1.6;
}

function resolveRiskReserveRate(urgency: number, routeDifficulty: number): number {
  const riskScore = clamp(urgency * 0.55 + routeDifficulty * 0.45, 0, 1);
  if (riskScore >= 0.65) {
    return deliveryCostBalance.riskReserveHigh;
  }
  if (riskScore >= 0.35) {
    return deliveryCostBalance.riskReserveMedium;
  }
  return deliveryCostBalance.riskReserveLow;
}

/** Tahmini sefer maliyeti — şoför maaşı dahil değil (günlük sabit gider). */
export function estimateContractTripCostBreakdown(
  input: ContractTripCostInput,
): ContractTripCostBreakdown {
  const amount = Math.max(0, input.amount);
  const distanceKm = Math.max(0, input.route.distanceKm ?? 0);
  const routeDifficulty = clamp(input.route.difficulty ?? 0.5, 0, 1);
  const urgency = clamp(input.urgency ?? 0, 0, 1);
  const weightMultiplier = getCargoWeightCostMultiplier(amount);
  const fuelPrice = Math.max(0, input.globalEconomy.fuelPrice ?? 0);
  const fuelPerKm =
    input.fuelConsumptionPerKm ??
    contractBalance.estimateFuelPerKm;

  const fuelCost = Math.round(
    distanceKm *
      fuelPerKm *
      fuelPrice *
      deliveryCostBalance.fuelCostMultiplier *
      weightMultiplier *
      (1 + amount / 40),
  );

  const maintenancePerKm = Math.max(
    contractBalance.estimateMaintenancePerKm * deliveryCostBalance.maintenanceCostMultiplier,
    deliveryBalance.maintenanceCostPerKm * deliveryCostBalance.maintenanceCostMultiplier,
  );
  const maintenanceCost = Math.round(
    distanceKm *
      maintenancePerKm *
      weightMultiplier *
      (1 + routeDifficulty * 0.4),
  );

  const routeDifficultyCost = Math.round(
    distanceKm *
      deliveryCostBalance.routeDifficultyCostPerKm *
      routeDifficulty *
      deliveryCostBalance.routeDifficultyCostMultiplier,
  );

  const cargoHandlingCost = Math.round(amount * deliveryCostBalance.cargoHandlingCostPerTon);

  const directCost = fuelCost + maintenanceCost + routeDifficultyCost + cargoHandlingCost;
  const riskReserve = Math.round(
    directCost * resolveRiskReserveRate(urgency, routeDifficulty),
  );

  return {
    fuelCost,
    maintenanceCost,
    routeDifficultyCost,
    cargoHandlingCost,
    riskReserve,
    baseTripCost: directCost + riskReserve,
  };
}

function resolveLevelPaymentCap(requiredLevel: number) {
  const caps = contractPaymentBalance.levelCaps;
  const safeLevel = Math.max(1, Math.min(requiredLevel, 10));
  const direct = caps[safeLevel as keyof typeof caps];
  if (direct) {
    return direct;
  }
  const tier5 = caps[5];
  const extraLevels = safeLevel - 5;
  const scale = 1 + extraLevels * contractPaymentBalance.highLevelCapScalePerLevel;
  return {
    paymentMin: Math.round(tier5.paymentMin * scale),
    paymentMax: Math.round(tier5.paymentMax * scale),
    urgentPaymentMax: Math.round(tier5.urgentPaymentMax * scale),
    minNetProfit: Math.round(tier5.minNetProfit * scale),
    maxTypicalNetProfit: Math.round(tier5.maxTypicalNetProfit * scale),
  };
}

function resolveTargetProfitMargin(input: ContractPaymentInput): number {
  const { amount, route, urgency, isMarketOpportunity } = input;
  const difficulty = route.difficulty ?? 0.5;
  const isLarge = amount >= contractBalance.largeContractTonnage;
  const isRisky = urgency >= 0.65 || difficulty >= 0.7;
  const isEasy = urgency < 0.35 && difficulty < 0.4 && (route.distanceKm ?? 0) < 400;

  let minMargin: number;
  let maxMargin: number;

  if (isLarge) {
    minMargin = contractBalance.profitMarginLargeMin;
    maxMargin = contractBalance.profitMarginLargeMax;
  } else if (isRisky) {
    minMargin = contractBalance.profitMarginRiskyMin;
    maxMargin = contractBalance.profitMarginRiskyMax;
  } else if (isEasy) {
    minMargin = contractBalance.profitMarginEasyMin;
    maxMargin = contractBalance.profitMarginEasyMax;
  } else {
    minMargin = contractBalance.profitMarginMediumMin;
    maxMargin = contractBalance.profitMarginMediumMax;
  }

  const blend = clamp(urgency * 0.4 + difficulty * 0.35 + (amount / 40) * 0.25, 0, 1);
  let margin = minMargin + (maxMargin - minMargin) * blend;

  if (urgency >= 0.55) {
    const urgentBlend = clamp((urgency - 0.55) / 0.45, 0, 1);
    margin +=
      deliveryCostBalance.urgentMarginBonusMin +
      (deliveryCostBalance.urgentMarginBonusMax - deliveryCostBalance.urgentMarginBonusMin) *
        urgentBlend;
  }

  if (isMarketOpportunity) {
    margin +=
      deliveryCostBalance.marketOpportunityMarginBonusMin +
      (deliveryCostBalance.marketOpportunityMarginBonusMax -
        deliveryCostBalance.marketOpportunityMarginBonusMin) *
        clamp(urgency * 0.5 + difficulty * 0.5, 0, 1);
  }

  return clamp(margin, contractPaymentBalance.minProfitMargin, contractPaymentBalance.maxProfitMargin);
}

function applyHighPaymentGuard(
  payment: number,
  amount: number,
  requiredLevel: number,
): number {
  const threshold = contractPaymentBalance.highPaymentThreshold;
  if (payment < threshold) {
    return payment;
  }
  if (
    requiredLevel >= contractPaymentBalance.highPaymentMinRequiredLevel &&
    amount >= contractPaymentBalance.highPaymentMinTonnage
  ) {
    return payment;
  }
  return Math.min(payment, threshold - 1);
}

/** Maliyet tabanlı sözleşme ödemesi ($) */
export function calculateBalancedContractPayment(input: ContractPaymentInput): number {
  const amount = Math.max(0, input.amount);
  const requiredLevel = Math.max(
    1,
    input.requiredLevel ?? getRequiredLevelForTonnage(amount),
  );
  const urgency = clamp(input.urgency ?? 0, 0, 1);
  const breakdown = estimateContractTripCostBreakdown(input);
  const baseTripCost = Math.max(breakdown.baseTripCost, 1);
  const margin = resolveTargetProfitMargin(input);
  let payment = Math.round(baseTripCost * (1 + margin));

  const levelCap = resolveLevelPaymentCap(requiredLevel);
  const minNetProfit = levelCap.minNetProfit;
  const minPaymentForProfit = baseTripCost + minNetProfit;
  if (payment < minPaymentForProfit) {
    payment = minPaymentForProfit;
  }

  const maxPayment = urgency >= 0.65 ? levelCap.urgentPaymentMax : levelCap.paymentMax;
  payment = clamp(payment, levelCap.paymentMin, maxPayment);
  payment = applyHighPaymentGuard(payment, amount, requiredLevel);
  payment = Math.min(payment, contractPaymentBalance.absolutePaymentMax);

  return Math.max(0, payment);
}
