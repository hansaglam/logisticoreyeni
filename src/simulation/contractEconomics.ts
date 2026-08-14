/**
 * Sözleşme maliyet ve ödeme ekonomisi — üretim, önizleme ve debug için tek kaynak.
 */

import {
  contractBalance,
  contractGenerationBalance,
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
import {
  calculateFuelUsed as calculateCanonicalFuelUsed,
  getFuelRequiredForDistance,
  getTruckFuelConsumptionPerKm,
} from '../utils/truckFuel';
import { calculateVehicleSpeed } from '../utils/vehiclePerformance';
import { sanitizeFuelPricePerLiter } from './economy';
import { resolveActiveEventModifiers } from './globalMarketSnapshot';
import { getEngineSpeedMultiplier } from './truckUpgrades';

export interface ContractTripCostInput {
  amount: number;
  route: Route;
  urgency: number;
  globalEconomy: GlobalEconomy;
  /** Kamyon atanmamış tahminlerde kullanılır */
  fuelConsumptionPerKm?: number;
  truck?: Pick<Truck, 'fuelConsumptionPerKm' | 'upgrades'>;
  /** Event bakımı çarpanı — yalnız maintenance */
  maintenanceCostMultiplier?: number;
}

export interface ContractTripCostBreakdown {
  fuelCost: number;
  maintenanceCost: number;
  tollCost: number;
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
  estimatedDurationHours: number;
  effectiveAverageSpeedKmh: number;
}

export interface ContractViabilityResult {
  accepted: boolean;
  reason:
    | 'viable'
    | 'margin-below-minimum'
    | 'capacity-impossible'
    | 'invalid-economics';
  minimumMarginPercent: number;
  economics: ContractEconomicsResult;
}

export function calculateContractDurationHours(params: {
  distanceKm: number;
  cargoTons: number;
  truckCapacityTons?: number;
  routeDifficulty?: number;
  truckSpeedKmh?: number;
  truckCondition?: number;
  truckVehicleClass?: Truck['vehicleClass'];
  truckCatalogId?: string;
  driverSpeed?: number;
  driverTier?: Driver['tier'];
  trailerType?: Trailer['type'];
  trailerCapacityBonusTons?: number;
  eventSpeedMultiplier?: number;
  truck?: Pick<Truck, 'speed' | 'capacity' | 'condition' | 'vehicleClass' | 'catalogId' | 'upgrades'>;
}): {
  durationHours: number;
  effectiveAverageSpeedKmh: number;
  travelHours: number;
  handlingHours: number;
  restHours: number;
} {
  const distanceKm = Math.max(0, Number(params.distanceKm) || 0);
  const speed = calculateVehicleSpeed({
    truck: {
      speed: Number(params.truckSpeedKmh) || contractBalance.averageSpeedKmh,
      capacity: Math.max(
        1,
        Number(params.truckCapacityTons) || Number(params.cargoTons) || 25,
      ),
      condition: params.truckCondition ?? 100,
      vehicleClass: params.truckVehicleClass,
      catalogId: params.truckCatalogId,
    },
    driver: { speed: params.driverSpeed ?? 0, tier: params.driverTier },
    route: { difficulty: params.routeDifficulty ?? 0 },
    cargoWeightTons: params.cargoTons,
    trailer: params.trailerType
      ? {
          type: params.trailerType,
          capacityBonusTons: params.trailerCapacityBonusTons,
        }
      : null,
    eventSpeedMultiplier:
      (params.eventSpeedMultiplier ?? 1) *
      (params.truck ? getEngineSpeedMultiplier(params.truck as Truck) : 1),
  });
  const effectiveAverageSpeedKmh = speed.effectiveSpeedKmh;
  const travelHours = distanceKm / effectiveAverageSpeedKmh;
  const handlingHours =
    contractBalance.baseHandlingHours +
    Math.max(0, Number(params.cargoTons) || 0) *
      contractBalance.handlingHoursPerTon;
  const completedDrivingBlocks = Math.floor(
    travelHours / contractBalance.drivingBlockHours,
  );
  const restHours =
    completedDrivingBlocks * contractBalance.restHoursPerDrivingBlock;
  return {
    durationHours: Math.max(0.25, travelHours + handlingHours + restHours),
    effectiveAverageSpeedKmh,
    travelHours,
    handlingHours,
    restHours,
  };
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

function estimateContractFuelLiters(input: ContractTripCostInput): number {
  const fuelPerKm =
    input.truck != null
      ? getTruckFuelConsumptionPerKm(input.truck)
      : input.fuelConsumptionPerKm ?? contractBalance.estimateFuelPerKm;
  return getFuelRequiredForDistance({
    distanceKm: input.route.distanceKm,
    fuelConsumptionPerKm: fuelPerKm,
    loadMultiplier: getCargoWeightCostMultiplier(input.amount),
  });
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
  const fuelLiters = estimateContractFuelLiters(input);
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
  const tollCost = Math.round(Math.max(0, input.route.tollCost ?? 0));
  const riskReserve = Math.round(
    (directCost + tollCost) * resolveRiskReserveRate(urgency, routeDifficulty),
  );

  return {
    fuelCost,
    maintenanceCost,
    tollCost,
    routeDifficultyCost,
    cargoHandlingCost,
    riskReserve,
    baseTripCost: directCost + tollCost + riskReserve,
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

  // paymentMin erken oyunda güvenlik tabanı olarak tasarlanmıştı; ancak tüm düşük
  // maliyetli işleri aynı değere ($2.000) kilitliyordu. Net kâr tabanı zaten
  // sürdürülebilirliği koruyor; alt sınırı maliyete bağlı bırakarak mesafe, tonaj
  // ve ürün değerinin fiyatı gerçekten ayırmasına izin veriyoruz.
  payment = clamp(payment, minPaymentForProfit, maxPayment);
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
  contract: Pick<
    Contract,
    'payment' | 'amount' | 'distanceKm' | 'urgency' | 'contractType' | 'riskLevel'
  >;
  truck?: Pick<
    Truck,
    | 'id'
    | 'catalogId'
    | 'name'
    | 'vehicleClass'
    | 'fuelConsumptionPerKm'
    | 'capacity'
    | 'maintenanceCost'
    | 'condition'
    | 'speed'
  > | null;
  trailer?: Trailer | null;
  driver?: Pick<
    Driver,
    'fuelSaving' | 'dailySalary' | 'salaryPerDay' | 'speed' | 'tier'
  > | null;
  route: Route;
  globalEconomySnapshot: {
    fuelPricePerLiter: number;
    modifiers?: { maintenanceMultiplier?: number };
  };
  activeEvents?: WorldEvent[];
  playerModifiers?: { costMultiplier?: number };
  estimatedDurationHours?: number;
  /** Üretim sırasında ödeme de bu helper içinden hesaplanır. */
  pricingContext?: {
    product: Product;
    originMarket: ProductMarket;
    destinationMarket: ProductMarket;
    requiredLevel?: number;
    isMarketOpportunity?: boolean;
  };
}): ContractEconomicsResult {
  const fuelPricePerLiter = sanitizeFuelPricePerLiter(
    params.globalEconomySnapshot.fuelPricePerLiter,
  );
  const eventMods = resolveActiveEventModifiers(params.activeEvents);
  const maintenanceMult =
    params.globalEconomySnapshot.modifiers?.maintenanceMultiplier ??
    eventMods.maintenanceMultiplier;

  const fuelPerKm =
    params.truck != null
      ? getTruckFuelConsumptionPerKm(params.truck)
      : contractBalance.estimateFuelPerKm;
  const breakdown = estimateContractTripCostBreakdown({
    amount: params.contract.amount,
    route: params.route,
    urgency: params.contract.urgency ?? 0.4,
    globalEconomy: { fuelPrice: fuelPricePerLiter } as GlobalEconomy,
    fuelConsumptionPerKm: fuelPerKm,
    truck: params.truck ?? undefined,
    maintenanceCostMultiplier: maintenanceMult,
  });

  const duration = calculateContractDurationHours({
    distanceKm: params.route.distanceKm,
    cargoTons: params.contract.amount,
    routeDifficulty: params.route.difficulty,
    truckSpeedKmh: params.truck?.speed,
    truckCapacityTons: params.truck?.capacity,
    truckCondition: params.truck?.condition,
    truckVehicleClass: params.truck?.vehicleClass,
    truckCatalogId: params.truck?.catalogId,
    driverSpeed: params.driver?.speed,
    driverTier: params.driver?.tier,
    trailerType: params.trailer?.type,
    trailerCapacityBonusTons: params.trailer?.capacityBonusTons,
    truck: params.truck ?? undefined,
  });
  const durationHours = Math.max(
    0.25,
    params.estimatedDurationHours ?? duration.durationHours,
  );

  // Bilgilendirici allocated cost — settlement / ledger / offline cash'e dahil edilmez
  const dailySalary =
    params.driver?.dailySalary ?? params.driver?.salaryPerDay ?? 0;
  const allocatedDriverCost = Math.round(
    (Math.max(0, dailySalary) * durationHours) / 24,
  );

  const playerMult = clamp(params.playerModifiers?.costMultiplier ?? 1, 0.5, 1.5);
  const fuelLiters = params.truck
    ? calculateCanonicalFuelUsed({
        distanceKm: params.route.distanceKm,
        truck: params.truck,
        cargoWeightTons: params.contract.amount,
        routeDifficulty: params.route.difficulty,
        driverFuelSaving: params.driver?.fuelSaving ?? 0,
      })
    : estimateContractFuelLiters({
        amount: params.contract.amount,
        route: params.route,
        urgency: params.contract.urgency ?? 0,
        globalEconomy: { fuelPrice: fuelPricePerLiter } as GlobalEconomy,
        fuelConsumptionPerKm: fuelPerKm,
      });
  const fuel = Math.round(
    fuelLiters * fuelPricePerLiter * deliveryCostBalance.fuelCostMultiplier * playerMult,
  );
  const routeDifficulty = clamp(params.route.difficulty ?? 0.5, 0, 1);
  const weightMultiplier = getCargoWeightCostMultiplier(params.contract.amount);
  const conditionFactor =
    1 + Math.max(0, (100 - (params.truck?.condition ?? 100)) / 100) * 0.15;
  const maintenancePerKm = Math.max(
    (params.truck?.maintenanceCost ?? contractBalance.estimateMaintenancePerKm) *
      deliveryCostBalance.maintenanceCostMultiplier,
    deliveryBalance.maintenanceCostPerKm *
      deliveryCostBalance.maintenanceCostMultiplier,
  );
  const maintenance = Math.round(
    params.route.distanceKm *
      maintenancePerKm *
      weightMultiplier *
      (1 + routeDifficulty * 0.4) *
      conditionFactor *
      deliveryCostBalance.routeDifficultyCostMultiplier *
      maintenanceMult *
      playerMult,
  );
  const other = Math.round(
    (breakdown.routeDifficultyCost + breakdown.cargoHandlingCost) * playerMult,
  );
  const penaltyReserve = Math.round(breakdown.riskReserve * playerMult);
  const contractType = params.contract.contractType ?? 'standard';
  const trailerRatePerKm =
    contractType === 'refrigerated'
      ? 0.08
      : contractType === 'bulk'
        ? 0.05
        : params.trailer
          ? 0.025
          : 0;
  const trailer = Math.round(
    params.route.distanceKm * trailerRatePerKm * playerMult,
  );
  const toll = Math.round(Math.max(0, params.route.tollCost ?? 0) * playerMult);

  // Nakit hizalı toplam — şoför maaşı periodic, penaltyReserve ise yalnız risk bilgisidir.
  const totalCost = fuel + maintenance + trailer + toll + other;
  const revenue = params.pricingContext
    ? calculateBalancedContractPayment({
        amount: params.contract.amount,
        product: params.pricingContext.product,
        originMarket: params.pricingContext.originMarket,
        destinationMarket: params.pricingContext.destinationMarket,
        route: params.route,
        urgency: params.contract.urgency,
        globalEconomy: { fuelPrice: fuelPricePerLiter } as GlobalEconomy,
        requiredLevel: params.pricingContext.requiredLevel,
        isMarketOpportunity: params.pricingContext.isMarketOpportunity,
      })
    : Math.max(0, params.contract.payment);
  const estimatedProfit = revenue - totalCost;
  const profitMarginPercent =
    revenue > 0 ? Math.round((estimatedProfit / revenue) * 1000) / 10 : 0;

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
    estimatedDurationHours: Math.round(durationHours * 100) / 100,
    effectiveAverageSpeedKmh:
      Math.round(duration.effectiveAverageSpeedKmh * 10) / 10,
  };
}

export function evaluateContractViability(params: {
  contract: Contract;
  route: Route;
  globalEconomySnapshot: {
    fuelPricePerLiter: number;
    modifiers?: { maintenanceMultiplier?: number };
  };
  activeEvents?: WorldEvent[];
  maxFleetCapacityTons?: number;
}): ContractViabilityResult {
  const economics = calculateContractEconomics({
    contract: params.contract,
    route: params.route,
    globalEconomySnapshot: params.globalEconomySnapshot,
    activeEvents: params.activeEvents,
  });
  const values = [
    economics.revenue,
    economics.totalCost,
    economics.estimatedProfit,
    economics.profitMarginPercent,
    economics.estimatedDurationHours,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    return {
      accepted: false,
      reason: 'invalid-economics',
      minimumMarginPercent: 0,
      economics,
    };
  }
  if (
    params.maxFleetCapacityTons != null &&
    params.contract.amount > params.maxFleetCapacityTons
  ) {
    return {
      accepted: false,
      reason: 'capacity-impossible',
      minimumMarginPercent: 0,
      economics,
    };
  }
  const isStandard = (params.contract.contractType ?? 'standard') === 'standard';
  const minimumMargin = isStandard
    ? contractGenerationBalance.standardMinimumMargin
    : contractGenerationBalance.specialMinimumMargin;
  const accepted = economics.profitMarginPercent / 100 >= minimumMargin;
  return {
    accepted,
    reason: accepted ? 'viable' : 'margin-below-minimum',
    minimumMarginPercent: minimumMargin * 100,
    economics,
  };
}
