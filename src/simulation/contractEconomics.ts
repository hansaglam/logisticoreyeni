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
import type {
  Contract,
  Driver,
  GlobalEconomy,
  Product,
  ProductMarket,
  Route,
  Trailer,
  Truck,
  WorldEvent,
} from '../types/game';
import { clamp } from '../utils/math';
import { sanitizeFuelPricePerLiter } from './economy';
import { resolveActiveEventModifiers } from './globalMarketSnapshot';

export interface ContractTripCostInput {
  amount: number;
  route: Route;
  urgency: number;
  globalEconomy: GlobalEconomy;
  /** Kamyon atanmamış tahminlerde kullanılır */
  fuelConsumptionPerKm?: number;
  /** Event bakımı çarpanı — yalnız maintenance */
  maintenanceCostMultiplier?: number;
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

export interface ContractEconomicsResult {
  revenue: number;
  costs: {
    fuel: number;
    /** Bilgilendirici allocated maaş payı — nakit kesilmez (Model A) */
    driver: number;
    maintenance: number;
    trailer: number;
    toll: number;
    penaltyReserve: number;
    other: number;
  };
  /** Nakit hizalı toplam maliyet — şoför maaşı hariç */
  totalCost: number;
  estimatedProfit: number;
  profitMarginPercent: number;
  requiredStartingCash: number;
  fuelPricePerLiter: number;
  fuelLiters: number;
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

function resolveFuelPrice(globalEconomy: GlobalEconomy): number {
  return sanitizeFuelPricePerLiter(globalEconomy.fuelPrice);
}

/**
 * Tahmini sefer maliyeti — şoför maaşı dahil değil (periyodik sabit gider).
 * NOT: weightMultiplier ile amount/40 çift uygulanmaz.
 */
export function estimateContractTripCostBreakdown(
  input: ContractTripCostInput,
): ContractTripCostBreakdown {
  const amount = Math.max(0, input.amount);
  const distanceKm = Math.max(0, input.route.distanceKm ?? 0);
  const routeDifficulty = clamp(input.route.difficulty ?? 0.5, 0, 1);
  const urgency = clamp(input.urgency ?? 0, 0, 1);
  const weightMultiplier = getCargoWeightCostMultiplier(amount);
  const fuelPrice = resolveFuelPrice(input.globalEconomy);
  const fuelPerKm =
    input.fuelConsumptionPerKm ??
    contractBalance.estimateFuelPerKm;

  const fuelLiters = distanceKm * fuelPerKm * weightMultiplier;
  const fuelCost = Math.round(
    fuelLiters * fuelPrice * deliveryCostBalance.fuelCostMultiplier,
  );

  const maintenancePerKm = Math.max(
    contractBalance.estimateMaintenancePerKm * deliveryCostBalance.maintenanceCostMultiplier,
    deliveryBalance.maintenanceCostPerKm * deliveryCostBalance.maintenanceCostMultiplier,
  );
  const maintenanceEventMult = clamp(input.maintenanceCostMultiplier ?? 1, 0.5, 1.5);
  const maintenanceCost = Math.round(
    distanceKm *
      maintenancePerKm *
      weightMultiplier *
      (1 + routeDifficulty * 0.4) *
      maintenanceEventMult,
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

  const blend = clamp(urgency * 0.4 + difficulty * 0.35 + (amount / 80) * 0.25, 0, 1);
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

/**
 * Maliyet tabanlı sözleşme ödemesi ($).
 * Seviye tavanı maliyetin altına düşürürse: tavan içinde mümkün olan max kârı koru
 * (negatif kâr üretme). Üretim tarafı isContractEconomicallyViable ile filtreler.
 */
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
  const maxPayment = urgency >= 0.65 ? levelCap.urgentPaymentMax : levelCap.paymentMax;

  // Maliyet tavanı aşıyorsa: tavan ödemeyi kullan (üretim filtresi bu işi eleyebilir)
  const affordableCostCeiling = Math.max(1, maxPayment - levelCap.minNetProfit);
  const effectiveCost = Math.min(baseTripCost, affordableCostCeiling);
  payment = Math.round(effectiveCost * (1 + margin));

  const minPaymentForProfit = effectiveCost + levelCap.minNetProfit;
  if (payment < minPaymentForProfit) {
    payment = minPaymentForProfit;
  }

  payment = clamp(payment, levelCap.paymentMin, maxPayment);
  payment = applyHighPaymentGuard(payment, amount, requiredLevel);
  payment = Math.min(payment, contractPaymentBalance.absolutePaymentMax);

  return Math.max(0, payment);
}

/** Üretim filtresi — tavan sonrası net kâr pozitif olmalı (standart işler) */
export function isContractEconomicallyViable(input: ContractPaymentInput): boolean {
  const payment = calculateBalancedContractPayment(input);
  const cost = estimateContractTripCostBreakdown(input).baseTripCost;
  const urgency = clamp(input.urgency ?? 0, 0, 1);
  // Acil/özel işlerde küçük negatif marja izin (config min margin'in yarısı)
  const minProfit =
    urgency >= 0.65
      ? -Math.round(cost * 0.05)
      : 0;
  return payment - cost >= minProfit;
}

/**
 * Kart / detay / assignment / acceptance için ortak ekonomi helper.
 *
 * Ürün kararı — Model A (sabit maaş):
 * - Gerçek nakit kesintisi yalnız periodic salaryPer24h (dailySalary) ile yapılır.
 * - costs.driver = bilgilendirici allocated cost (süre oranı); settlement/cash'e girmez.
 * - totalCost / estimatedProfit nakit kalemleriyle hizalıdır (şoför hariç).
 */
export function calculateContractEconomics(params: {
  contract: Pick<Contract, 'payment' | 'amount' | 'distanceKm' | 'urgency'>;
  truck?: Pick<Truck, 'fuelConsumptionPerKm' | 'capacity'> | null;
  trailer?: Trailer | null;
  driver?: Pick<Driver, 'fuelSaving' | 'dailySalary' | 'salaryPerDay'> | null;
  route: Route;
  globalEconomySnapshot: {
    fuelPricePerLiter: number;
    modifiers?: { maintenanceMultiplier?: number };
  };
  activeEvents?: WorldEvent[];
  playerModifiers?: { costMultiplier?: number };
  estimatedDurationHours?: number;
}): ContractEconomicsResult {
  const fuelPricePerLiter = sanitizeFuelPricePerLiter(
    params.globalEconomySnapshot.fuelPricePerLiter,
  );
  const eventMods = resolveActiveEventModifiers(params.activeEvents);
  const maintenanceMult =
    params.globalEconomySnapshot.modifiers?.maintenanceMultiplier ??
    eventMods.maintenanceMultiplier;

  const fuelPerKm =
    params.truck?.fuelConsumptionPerKm ?? contractBalance.estimateFuelPerKm;
  const breakdown = estimateContractTripCostBreakdown({
    amount: params.contract.amount,
    route: params.route,
    urgency: params.contract.urgency ?? 0.4,
    globalEconomy: { fuelPrice: fuelPricePerLiter } as GlobalEconomy,
    fuelConsumptionPerKm: fuelPerKm,
    maintenanceCostMultiplier: maintenanceMult,
  });

  const durationHours = Math.max(
    1,
    params.estimatedDurationHours ??
      params.contract.distanceKm / Math.max(1, contractBalance.averageSpeedKmh),
  );

  // Bilgilendirici allocated cost — settlement / ledger / offline cash'e dahil edilmez
  const dailySalary =
    params.driver?.dailySalary ?? params.driver?.salaryPerDay ?? 0;
  const allocatedDriverCost = Math.round(
    (Math.max(0, dailySalary) * durationHours) / 24,
  );

  const playerMult = clamp(params.playerModifiers?.costMultiplier ?? 1, 0.5, 1.5);
  const fuel = Math.round(breakdown.fuelCost * playerMult);
  const maintenance = Math.round(breakdown.maintenanceCost * playerMult);
  const other = Math.round(
    (breakdown.routeDifficultyCost + breakdown.cargoHandlingCost) * playerMult,
  );
  const penaltyReserve = Math.round(breakdown.riskReserve * playerMult);
  const trailer = 0;
  const toll = 0;

  // Nakit hizalı toplam — şoför maaşı periodic cost'ta kesilir
  const totalCost = fuel + maintenance + trailer + toll + penaltyReserve + other;
  const revenue = Math.max(0, params.contract.payment);
  const estimatedProfit = revenue - totalCost;
  const profitMarginPercent =
    revenue > 0 ? Math.round((estimatedProfit / revenue) * 1000) / 10 : 0;

  const fuelLiters =
    params.contract.distanceKm *
    fuelPerKm *
    getCargoWeightCostMultiplier(params.contract.amount);

  return {
    revenue,
    costs: {
      fuel,
      driver: allocatedDriverCost,
      maintenance,
      trailer,
      toll,
      penaltyReserve,
      other,
    },
    totalCost,
    estimatedProfit,
    profitMarginPercent,
    requiredStartingCash: Math.max(0, fuel + Math.round(maintenance * 0.25)),
    fuelPricePerLiter,
    fuelLiters: Math.round(fuelLiters * 10) / 10,
  };
}
