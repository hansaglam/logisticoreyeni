/**
 * ROAD→RAIL→ROAD offer economics (Map V2 Step 27).
 *
 * Player payment (revenue) is not the Step 26 rail carrier cost.
 * Planning estimates only — no cash, ledger, or settlement mutation.
 */

import {
  contractBalance,
  contractPaymentBalance,
  deliveryCostBalance,
  economyBalance,
} from '../config/balance';
import { getCargoWeightCostMultiplier } from '../simulation/contractEconomics';
import { getFuelRequiredForDistance } from '../utils/truckFuel';

export const MULTIMODAL_RAIL_OFFER_ECONOMICS_POLICY_VERSION =
  'multimodal-rail-offer-economics-v1' as const;

export const MULTIMODAL_DEADLINE_POLICY_VERSION = 'multimodal-deadline-policy-v1' as const;

export const RAIL_OFFER_CURRENCY = 'USD_GAME_INTEGER' as const;

/**
 * Versioned STANDARD_ROAD_ACCESS_COST_PROFILE.
 * Fleet-independent planning truck: production estimateFuelPerKm + frozen baseFuelPrice.
 * Not a live assigned truck. Acceptance later uses real first/last-mile execution costs.
 *
 * Explicitly omitted from v1 local-access opex:
 * - city-pair routes.ts tolls (no source-backed correspondence)
 * - cargo handling (RAIL base fee covers terminal booking in Step 26)
 * - driver wages (periodic ROAD cost, not per-leg cash — Model A)
 */
export const STANDARD_ROAD_ACCESS_COST_PROFILE = {
  id: 'standard-road-access-cost-profile-v1',
  fuelPerKm: contractBalance.estimateFuelPerKm,
  fuelPricePerLiter: economyBalance.baseFuelPrice,
  fuelCostMultiplier: deliveryCostBalance.fuelCostMultiplier,
  maintenancePerKm:
    contractBalance.estimateMaintenancePerKm * deliveryCostBalance.maintenanceCostMultiplier,
  planningRouteDifficulty: 0.3,
  omitTolls: true,
  omitCargoHandling: true,
  omitDriverWages: true,
} as const;

/** GAMEPLAY_BALANCE_CONSTANT — multimodal coordination premium on estimated expenses. */
export const RAIL_OFFER_COMPLEXITY_PREMIUM = 0.22;

/** GAMEPLAY_BALANCE_CONSTANT — fixed booking/coordination dollars, not carrier cost. */
export const RAIL_OFFER_COORDINATION_FEE_DOLLARS = 180;

/**
 * GAMEPLAY_BALANCE_CONSTANT — reject rather than clamp.
 * Below L1 ROAD minNetProfit ($350) because local access + rail is a different trip shape;
 * still a real floor so READY offers are not break-even noise.
 */
export const RAIL_OFFER_MIN_GROSS_MARGIN_DOLLARS = 80;

/** GAMEPLAY_BALANCE_CONSTANT — also reject if margin/payment is thinner than this. */
export const RAIL_OFFER_MIN_GROSS_MARGIN_RATIO = 0.08;

/** Deadline: planned + max(2 game hours, 20% of planned); perishable cargo uses 12%. */
export const RAIL_OFFER_DEADLINE_MIN_BUFFER_GAME_SECONDS = 2 * 3600;
export const RAIL_OFFER_DEADLINE_BUFFER_RATIO = 0.2;
export const RAIL_OFFER_DEADLINE_PERISHABLE_BUFFER_RATIO = 0.12;
export const RAIL_OFFER_DEADLINE_PERISHABLE_THRESHOLD = 0.7;
export const RAIL_OFFER_DEADLINE_MAX_GAME_SECONDS =
  contractBalance.maxDeadlineHours * 3600;

export type RailOfferRoadAccessOperatingCost = {
  firstMileDollars: number;
  lastMileDollars: number;
  totalDollars: number;
  profileId: typeof STANDARD_ROAD_ACCESS_COST_PROFILE.id;
  omitted: {
    tolls: true;
    cargoHandling: true;
    driverWages: true;
    routesTsCityPair: true;
  };
};

export type RailOfferEconomicsBreakdown = {
  policyVersion: typeof MULTIMODAL_RAIL_OFFER_ECONOMICS_POLICY_VERSION;
  currency: typeof RAIL_OFFER_CURRENCY;
  railCarrierCost: number;
  estimatedRoadOperatingCost: number;
  estimatedExpenses: number;
  playerPayment: number;
  expectedGrossMargin: number;
  expectedGrossMarginRatio: number;
  complexityPremium: typeof RAIL_OFFER_COMPLEXITY_PREMIUM;
  coordinationFeeDollars: typeof RAIL_OFFER_COORDINATION_FEE_DOLLARS;
  roadAccess: RailOfferRoadAccessOperatingCost;
};

export type RailOfferEconomicsStatus =
  | 'READY'
  | 'INVALID_INPUT'
  | 'NON_POSITIVE_MARGIN'
  | 'UNSAFE_ECONOMICS';

export type RailOfferEconomicsResult =
  | { status: 'READY'; economics: RailOfferEconomicsBreakdown }
  | { status: Exclude<RailOfferEconomicsStatus, 'READY'>; reason: string; economics: null };

function roundDollars(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded) || rounded < 0) return null;
  return rounded;
}

export function estimateRoadAccessOperatingCostDollars(
  distanceMeters: number,
  cargoTonnes: number,
): number | null {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;
  if (!Number.isFinite(cargoTonnes) || cargoTonnes <= 0) return null;
  const km = distanceMeters / 1000;
  const weight = getCargoWeightCostMultiplier(cargoTonnes);
  const liters = getFuelRequiredForDistance({
    distanceKm: km,
    fuelConsumptionPerKm: STANDARD_ROAD_ACCESS_COST_PROFILE.fuelPerKm,
    loadMultiplier: weight,
    routeDifficulty: STANDARD_ROAD_ACCESS_COST_PROFILE.planningRouteDifficulty,
  });
  const fuel = roundDollars(
    liters *
      STANDARD_ROAD_ACCESS_COST_PROFILE.fuelPricePerLiter *
      STANDARD_ROAD_ACCESS_COST_PROFILE.fuelCostMultiplier,
  );
  const maint = roundDollars(
    km *
      STANDARD_ROAD_ACCESS_COST_PROFILE.maintenancePerKm *
      weight *
      (1 + STANDARD_ROAD_ACCESS_COST_PROFILE.planningRouteDifficulty * 0.4),
  );
  if (fuel == null || maint == null) return null;
  const total = fuel + maint;
  return Number.isSafeInteger(total) ? total : null;
}

export function estimateRailOfferEconomics(input: {
  railCarrierCost: number;
  firstMileDistanceMeters: number;
  lastMileDistanceMeters: number;
  cargoTonnes: number;
}): RailOfferEconomicsResult {
  const rail = input.railCarrierCost;
  if (!Number.isFinite(rail) || rail < 0 || !Number.isSafeInteger(rail)) {
    return { status: 'INVALID_INPUT', reason: 'INVALID_RAIL_CARRIER_COST', economics: null };
  }
  const first = estimateRoadAccessOperatingCostDollars(
    input.firstMileDistanceMeters,
    input.cargoTonnes,
  );
  const last = estimateRoadAccessOperatingCostDollars(
    input.lastMileDistanceMeters,
    input.cargoTonnes,
  );
  if (first == null || last == null) {
    return { status: 'INVALID_INPUT', reason: 'INVALID_ROAD_ACCESS_OPERATING_COST', economics: null };
  }
  const estimatedRoadOperatingCost = first + last;
  const estimatedExpenses = rail + estimatedRoadOperatingCost;
  if (!Number.isSafeInteger(estimatedExpenses) || estimatedExpenses < 0) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'EXPENSE_OVERFLOW', economics: null };
  }

  const rawPayment =
    estimatedExpenses * (1 + RAIL_OFFER_COMPLEXITY_PREMIUM) + RAIL_OFFER_COORDINATION_FEE_DOLLARS;
  const playerPayment = roundDollars(rawPayment);
  if (playerPayment == null || playerPayment <= 0) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'INVALID_PLAYER_PAYMENT', economics: null };
  }
  if (playerPayment > contractPaymentBalance.absolutePaymentMax) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'PAYMENT_EXCEEDS_ABSOLUTE_MAX', economics: null };
  }
  if (playerPayment === rail) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'PAYMENT_EQUALS_CARRIER_COST', economics: null };
  }

  const expectedGrossMargin = playerPayment - estimatedExpenses;
  if (!Number.isSafeInteger(expectedGrossMargin)) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'MARGIN_OVERFLOW', economics: null };
  }
  if (expectedGrossMargin <= 0) {
    return { status: 'NON_POSITIVE_MARGIN', reason: 'EXPECTED_GROSS_MARGIN_NOT_POSITIVE', economics: null };
  }
  const expectedGrossMarginRatio = expectedGrossMargin / playerPayment;
  if (
    expectedGrossMargin < RAIL_OFFER_MIN_GROSS_MARGIN_DOLLARS ||
    expectedGrossMarginRatio < RAIL_OFFER_MIN_GROSS_MARGIN_RATIO
  ) {
    return { status: 'UNSAFE_ECONOMICS', reason: 'MARGIN_TOO_THIN', economics: null };
  }

  return {
    status: 'READY',
    economics: {
      policyVersion: MULTIMODAL_RAIL_OFFER_ECONOMICS_POLICY_VERSION,
      currency: RAIL_OFFER_CURRENCY,
      railCarrierCost: rail,
      estimatedRoadOperatingCost,
      estimatedExpenses,
      playerPayment,
      expectedGrossMargin,
      expectedGrossMarginRatio,
      complexityPremium: RAIL_OFFER_COMPLEXITY_PREMIUM,
      coordinationFeeDollars: RAIL_OFFER_COORDINATION_FEE_DOLLARS,
      roadAccess: {
        firstMileDollars: first,
        lastMileDollars: last,
        totalDollars: estimatedRoadOperatingCost,
        profileId: STANDARD_ROAD_ACCESS_COST_PROFILE.id,
        omitted: {
          tolls: true,
          cargoHandling: true,
          driverWages: true,
          routesTsCityPair: true,
        },
      },
    },
  };
}

export function estimateRailOfferDeadlineGameSeconds(input: {
  plannedDurationGameSeconds: number;
  perishability?: number;
}): number | null {
  const planned = input.plannedDurationGameSeconds;
  if (!Number.isFinite(planned) || planned <= 0 || !Number.isSafeInteger(planned)) {
    return null;
  }
  const perishable =
    typeof input.perishability === 'number' &&
    input.perishability >= RAIL_OFFER_DEADLINE_PERISHABLE_THRESHOLD;
  const ratio = perishable
    ? RAIL_OFFER_DEADLINE_PERISHABLE_BUFFER_RATIO
    : RAIL_OFFER_DEADLINE_BUFFER_RATIO;
  const buffer = Math.max(
    RAIL_OFFER_DEADLINE_MIN_BUFFER_GAME_SECONDS,
    Math.round(planned * ratio),
  );
  const deadline = planned + buffer;
  if (!Number.isSafeInteger(deadline) || deadline <= planned) {
    return null;
  }
  if (deadline > RAIL_OFFER_DEADLINE_MAX_GAME_SECONDS) {
    if (RAIL_OFFER_DEADLINE_MAX_GAME_SECONDS <= planned) return null;
    return RAIL_OFFER_DEADLINE_MAX_GAME_SECONDS;
  }
  return deadline;
}
