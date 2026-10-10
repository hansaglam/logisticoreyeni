/**
 * Server-safe ROAD delivery economics (Map V2 Step 29F).
 *
 * Recomputes payment/deadline/settlement from canonical route + trusted issuance
 * markets. Does not trust client final cash. No React. No Firebase. No money mutation.
 *
 * Live contract generation remains CLIENT_WORLD_STATE_DEPENDENT (stock, RNG,
 * world events, contract types). Canonical issuance is standard-type only.
 */

import { contractBalance } from '../config/balance';
import { getRequiredLevelForTonnage } from '../config/levelConfig';
import { PRODUCT_BY_ID } from '../data/products';
import { ROUTES, getRoute } from '../data/routes';
import {
  calculateBalancedContractPayment,
  calculateContractDurationHours,
  calculateContractEconomics,
} from '../simulation/contractEconomics';
import { clamp } from '../utils/math';
import type { ProductMarket } from '../types/game';
import {
  CANONICAL_ROAD_DEADLINE_POLICY_VERSION,
  CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION,
  CANONICAL_ROAD_PAYMENT_POLICY_VERSION,
  CANONICAL_ROAD_ROUTE_PACKAGE_ID,
  CANONICAL_ROAD_SETTLEMENT_POLICY_VERSION,
  amountToTenths,
  createCanonicalRoadContractId,
  createCanonicalRoadDeliveryId,
} from './canonicalRoadDelivery';
import {
  calculateCanonicalFragileSurcharge,
  classifyCanonicalRoadCompletionBand,
  type CanonicalRoadCompletionBand,
  type CanonicalRoadExecutionEconomicsSnapshot,
} from './canonicalRoadExecutionEconomics';

export const ROAD_FAILURE_PENALTY_RATIO = 0.25;
export const ROAD_FAILURE_BASE_DAMAGE_COST = 500;
export const ROAD_CRITICAL_LATE_MULTIPLIER = 2;
export const CANONICAL_ROAD_FUEL_ALREADY_PAID = true;

export type CanonicalRoadRouteRow = {
  id: string;
  fromCityId: string;
  toCityId: string;
  distanceKm: number;
  difficulty: number;
  tollCost: number;
};

export function hashCanonicalRoadRoutes(routes: readonly CanonicalRoadRowLike[]): string {
  const payload = routes
    .map((row) => `${row.id}:${row.distanceKm}:${row.difficulty}:${row.tollCost}`)
    .sort()
    .join('|');
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) + hash + payload.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

type CanonicalRoadRowLike = {
  id: string;
  distanceKm: number;
  difficulty: number;
  tollCost: number;
};

export const CANONICAL_ROAD_ROUTE_PACKAGE_HASH = hashCanonicalRoadRoutes(ROUTES);

export function lookupCanonicalRoadRoute(
  originCityId: string,
  destinationCityId: string,
): CanonicalRoadRouteRow | null {
  const route = getRoute(originCityId, destinationCityId);
  if (!route) return null;
  return {
    id: route.id,
    fromCityId: route.fromCityId,
    toCityId: route.toCityId,
    distanceKm: route.distanceKm,
    difficulty: route.difficulty,
    tollCost: route.tollCost,
  };
}

export function calculateCanonicalUrgency(destinationMarket: ProductMarket): number {
  const safeTarget = Math.max(destinationMarket.targetStock, 1);
  const shortage = Math.max(0, destinationMarket.targetStock - destinationMarket.stock);
  const shortageRatio = shortage / safeTarget;
  const consumptionPressure = clamp(destinationMarket.consumptionPerDay / safeTarget, 0, 1);
  const pricePressure = clamp(destinationMarket.currentPrice / destinationMarket.basePrice - 1, 0, 1);
  return clamp(shortageRatio * 0.5 + consumptionPressure * 0.25 + pricePressure * 0.25, 0, 1);
}

export function calculateCanonicalDeadlineHours(input: {
  distanceKm: number;
  difficulty: number;
  perishability: number;
  urgency: number;
  amount: number;
}): number {
  const duration = calculateContractDurationHours({
    distanceKm: input.distanceKm,
    cargoTons: input.amount,
    routeDifficulty: input.difficulty,
  }).durationHours;
  const urgencyBuffer = clamp(1.55 - input.urgency * 0.35, 1.15, 1.55);
  const perishabilityBuffer = clamp(1.35 - input.perishability * 0.15, 1.15, 1.35);
  const rawDeadline = duration * Math.min(urgencyBuffer, perishabilityBuffer);
  return clamp(rawDeadline, contractBalance.minDeadlineHours, contractBalance.maxDeadlineHours);
}

export type TrustedRoadIssuanceInput = {
  originCityId: string;
  destinationCityId: string;
  productId: string;
  amount: number;
  originMarket: ProductMarket;
  destinationMarket: ProductMarket;
  fuelPricePerLiter: number;
  sequence: number;
  contractId?: string;
};

export type CanonicalRoadContractSnapshot = {
  contractId: string;
  originCityId: string;
  destinationCityId: string;
  productId: string;
  amount: number;
  cargoWeight: number;
  routeId: string;
  distanceKm: number;
  difficulty: number;
  tollCost: number;
  urgency: number;
  requiredLevel: number;
  perishability: number;
  payment: number;
  deadlineHours: number;
  planningFuelCost: number;
  planningMaintenanceBundle: number;
  canonicalSchemaVersion: typeof CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION;
  paymentPolicyVersion: typeof CANONICAL_ROAD_PAYMENT_POLICY_VERSION;
  deadlinePolicyVersion: typeof CANONICAL_ROAD_DEADLINE_POLICY_VERSION;
  settlementPolicyVersion: typeof CANONICAL_ROAD_SETTLEMENT_POLICY_VERSION;
  routePackageId: typeof CANONICAL_ROAD_ROUTE_PACKAGE_ID;
  routePackageHash: string;
};

export type IssueCanonicalRoadContractResult =
  | { ok: true; snapshot: CanonicalRoadContractSnapshot }
  | { ok: false; reason: string };

export function issueCanonicalRoadContractFromTrustedState(
  input: TrustedRoadIssuanceInput,
): IssueCanonicalRoadContractResult {
  const route = lookupCanonicalRoadRoute(input.originCityId, input.destinationCityId);
  if (!route) {
    return { ok: false, reason: 'UNSUPPORTED_ROUTE' };
  }
  const product = PRODUCT_BY_ID[input.productId as keyof typeof PRODUCT_BY_ID];
  if (!product) {
    return { ok: false, reason: 'INVALID_PRODUCT' };
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 150) {
    return { ok: false, reason: 'INVALID_CARGO_AMOUNT' };
  }
  const amount = Math.round(input.amount * 10) / 10;
  const urgency = calculateCanonicalUrgency(input.destinationMarket);
  const requiredLevel = getRequiredLevelForTonnage(amount);
  const payment = calculateBalancedContractPayment({
    amount,
    product,
    originMarket: input.originMarket,
    destinationMarket: input.destinationMarket,
    route: {
      id: route.id,
      fromCityId: route.fromCityId,
      toCityId: route.toCityId,
      distanceKm: route.distanceKm,
      difficulty: route.difficulty,
      tollCost: route.tollCost,
    },
    urgency,
    globalEconomy: {
      fuelPrice: input.fuelPricePerLiter,
      globalDemandMultiplier: 1,
      globalProductionMultiplier: 1,
      eventMultiplier: 1,
      marketVolatility: 0,
    },
    requiredLevel,
    isMarketOpportunity: false,
  });
  if (!Number.isFinite(payment) || payment <= 0) {
    return { ok: false, reason: 'PAYMENT_NOT_DERIVABLE' };
  }
  const deadlineHours = calculateCanonicalDeadlineHours({
    distanceKm: route.distanceKm,
    difficulty: route.difficulty,
    perishability: product.perishability,
    urgency,
    amount,
  });
  const economics = calculateContractEconomics({
    contract: {
      payment,
      amount,
      distanceKm: route.distanceKm,
      urgency,
      contractType: 'standard',
      riskLevel: 'low',
    },
    route: {
      id: route.id,
      fromCityId: route.fromCityId,
      toCityId: route.toCityId,
      distanceKm: route.distanceKm,
      difficulty: route.difficulty,
      tollCost: route.tollCost,
    },
    globalEconomySnapshot: { fuelPricePerLiter: input.fuelPricePerLiter },
  });
  const planningMaintenanceBundle =
    economics.costs.maintenance + economics.costs.trailer + economics.costs.toll + economics.costs.other;
  const contractId =
    input.contractId ??
    createCanonicalRoadContractId({
      originCityId: input.originCityId,
      destinationCityId: input.destinationCityId,
      productId: input.productId,
      amountTenths: amountToTenths(amount),
      sequence: input.sequence,
    });
  return {
    ok: true,
    snapshot: {
      contractId,
      originCityId: input.originCityId,
      destinationCityId: input.destinationCityId,
      productId: input.productId,
      amount,
      cargoWeight: amount,
      routeId: route.id,
      distanceKm: route.distanceKm,
      difficulty: route.difficulty,
      tollCost: route.tollCost,
      urgency,
      requiredLevel,
      perishability: product.perishability,
      payment: Math.round(payment),
      deadlineHours,
      planningFuelCost: economics.costs.fuel,
      planningMaintenanceBundle,
      canonicalSchemaVersion: CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION,
      paymentPolicyVersion: CANONICAL_ROAD_PAYMENT_POLICY_VERSION,
      deadlinePolicyVersion: CANONICAL_ROAD_DEADLINE_POLICY_VERSION,
      settlementPolicyVersion: CANONICAL_ROAD_SETTLEMENT_POLICY_VERSION,
      routePackageId: CANONICAL_ROAD_ROUTE_PACKAGE_ID,
      routePackageHash: CANONICAL_ROAD_ROUTE_PACKAGE_HASH,
    },
  };
}

export type CanonicalRoadCompletionOutcome = 'COMPLETED' | 'FAILED';

export type CanonicalRoadSettlementPrepared = {
  deliveryId: string;
  grossRevenue: number;
  fuelCost: number;
  fuelChargedOnCompletion: number;
  maintenanceCost: number;
  maintenanceExpense: number;
  tollExpense: number;
  latePenalty: number;
  failurePenalty: number;
  fragileSurcharge: number;
  penaltyCost: number;
  netCashDelta: number;
  completionBand: CanonicalRoadCompletionBand;
  ledger: Array<{ transactionId: string; amountDelta: number }>;
};

function safeAmount(value: number | undefined | null): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function calculateCanonicalLatePenalty(input: {
  payment: number;
  deadlineHours: number;
  actualTravelHours: number;
  perishability: number;
}): number {
  const hoursLate = Math.max(0, input.actualTravelHours - input.deadlineHours);
  if (hoursLate <= 0) return 0;
  const latenessRatio = hoursLate / Math.max(input.deadlineHours, 1);
  const perishabilityFactor = 0.25 + input.perishability * 0.55;
  return input.payment * latenessRatio * perishabilityFactor;
}

export function calculateCanonicalFailurePenalty(payment: number): number {
  return payment * ROAD_FAILURE_PENALTY_RATIO + ROAD_FAILURE_BASE_DAMAGE_COST;
}

export function prepareCanonicalRoadDeliverySettlement(input: {
  snapshot: CanonicalRoadContractSnapshot;
  deliveryId: string;
  outcome: CanonicalRoadCompletionOutcome;
  actualTravelHours: number;
  executionEconomics?: CanonicalRoadExecutionEconomicsSnapshot | null;
}): CanonicalRoadSettlementPrepared {
  const execution = input.executionEconomics ?? null;
  const fuelCost = safeAmount(
    execution?.fuelPolicySnapshot.planningFuelCost ?? input.snapshot.planningFuelCost,
  );
  const maintenanceCost = Math.round(
    safeAmount(execution?.maintenanceSnapshot.bundle ?? input.snapshot.planningMaintenanceBundle),
  );
  const tollExpense = Math.round(
    safeAmount(execution?.tollSnapshot.amount ?? input.snapshot.tollCost),
  );
  const maintenanceExpense = maintenanceCost - tollExpense;
  const completionBand = classifyCanonicalRoadCompletionBand({
    outcome: input.outcome,
    deadlineHours: input.snapshot.deadlineHours,
    actualTravelHours: input.actualTravelHours,
    plannedTravelHours: execution?.acceptedTravelBasis.expectedDurationHours,
  });
  if (input.outcome === 'FAILED') {
    const penaltyCost = Math.round(calculateCanonicalFailurePenalty(input.snapshot.payment));
    return {
      deliveryId: input.deliveryId,
      grossRevenue: 0,
      fuelCost,
      fuelChargedOnCompletion: 0,
      maintenanceCost: 0,
      maintenanceExpense: 0,
      tollExpense,
      latePenalty: 0,
      failurePenalty: penaltyCost,
      fragileSurcharge: 0,
      penaltyCost,
      netCashDelta: -penaltyCost,
      completionBand,
      ledger: [
        {
          transactionId: `delivery:${input.deliveryId}:failure-penalty`,
          amountDelta: -penaltyCost,
        },
      ],
    };
  }

  const rawPenalty = calculateCanonicalLatePenalty({
    payment: input.snapshot.payment,
    deadlineHours: input.snapshot.deadlineHours,
    actualTravelHours: input.actualTravelHours,
    perishability: input.snapshot.perishability,
  });
  const typePenaltyMult = execution?.penaltyMultiplier ?? 1;
  const latePenalty = Math.round(rawPenalty * typePenaltyMult);
  const fragileSurcharge = execution
    ? calculateCanonicalFragileSurcharge({
        payment: input.snapshot.payment,
        contractType: execution.fragilityPolicySnapshot.contractType,
        frozenStartCondition: execution.fragilityPolicySnapshot.frozenStartCondition,
        recommendedTruckCondition: execution.fragilityPolicySnapshot.recommendedTruckCondition,
        completionTruckCondition: execution.completionTruckCondition,
      })
    : 0;
  const penaltyCost = latePenalty + fragileSurcharge;
  const grossRevenue = Math.round(input.snapshot.payment);
  const netCashDelta = grossRevenue - maintenanceCost - penaltyCost;
  const ledger: CanonicalRoadSettlementPrepared['ledger'] = [
    {
      transactionId: `delivery:${input.deliveryId}:revenue`,
      amountDelta: grossRevenue,
    },
  ];
  const completionExpenses = maintenanceCost + penaltyCost;
  if (completionExpenses > 0) {
    ledger.push({
      transactionId: `delivery:${input.deliveryId}:completion-expenses`,
      amountDelta: -completionExpenses,
    });
  }
  return {
    deliveryId: input.deliveryId,
    grossRevenue,
    fuelCost,
    fuelChargedOnCompletion: 0,
    maintenanceCost,
    maintenanceExpense,
    tollExpense,
    latePenalty,
    failurePenalty: 0,
    fragileSurcharge,
    penaltyCost,
    netCashDelta,
    completionBand,
    ledger,
  };
}

export type RoadSettlementShadowParity =
  | 'MATCH'
  | 'MISMATCH'
  | 'SERVER_CANNOT_DERIVE';

export function compareRoadSettlementShadow(input: {
  local: {
    grossRevenue: number;
    maintenanceCost: number;
    penaltyCost: number;
    netCashDelta: number;
    fuelChargedOnCompletion: number;
  };
  server: CanonicalRoadSettlementPrepared | null;
}): RoadSettlementShadowParity {
  if (!input.server) return 'SERVER_CANNOT_DERIVE';
  const l = input.local;
  const s = input.server;
  if (
    l.grossRevenue === s.grossRevenue &&
    l.maintenanceCost === s.maintenanceCost &&
    l.penaltyCost === s.penaltyCost &&
    l.netCashDelta === s.netCashDelta &&
    l.fuelChargedOnCompletion === s.fuelChargedOnCompletion
  ) {
    return 'MATCH';
  }
  return 'MISMATCH';
}

export function localProductionSettlementFromSnapshot(
  snapshot: CanonicalRoadContractSnapshot,
  outcome: CanonicalRoadCompletionOutcome,
  actualTravelHours: number,
  executionEconomics?: CanonicalRoadExecutionEconomicsSnapshot | null,
): {
  grossRevenue: number;
  maintenanceCost: number;
  penaltyCost: number;
  netCashDelta: number;
  fuelChargedOnCompletion: number;
} {
  const deliveryId = createCanonicalRoadDeliveryId(snapshot.contractId);
  const prepared = prepareCanonicalRoadDeliverySettlement({
    snapshot,
    deliveryId,
    outcome,
    actualTravelHours,
    executionEconomics,
  });
  return {
    grossRevenue: prepared.grossRevenue,
    maintenanceCost: prepared.maintenanceCost,
    penaltyCost: prepared.penaltyCost,
    netCashDelta: prepared.netCashDelta,
    fuelChargedOnCompletion: prepared.fuelChargedOnCompletion,
  };
}

export function buildFixtureMarket(overrides: Partial<ProductMarket> & Pick<ProductMarket, 'currentPrice' | 'basePrice'>): ProductMarket {
  return {
    currentPrice: overrides.currentPrice,
    basePrice: overrides.basePrice,
    stock: overrides.stock ?? 80,
    targetStock: overrides.targetStock ?? 40,
    productionPerDay: overrides.productionPerDay ?? 10,
    consumptionPerDay: overrides.consumptionPerDay ?? 12,
  };
}
