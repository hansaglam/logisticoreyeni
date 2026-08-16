/**
 * Pre-assignment delivery readiness — reuses contract economics + fuel helpers.
 * Single source for ETA, deadline risk, and required fuel.
 */

import type {
  Contract,
  Driver,
  GlobalEconomy,
  Route,
  Trailer,
  Truck,
  WorldEvent,
} from '../types/game';
import { getTruckFuelReadiness, type TruckFuelReadiness } from '../utils/truckFuel';
import {
  classifyDeadlineRisk,
  type DeadlineRiskLevel,
} from '../utils/deadlineUx';
import { calculateContractEconomics } from '../simulation/contractEconomics';
import { sanitizeFuelPricePerLiter } from '../simulation/economy';

export const MIN_TRUCK_CONDITION_FOR_DELIVERY = 30;

export type DeliveryReadinessReason =
  | 'INSUFFICIENT_FUEL'
  | 'DEADLINE_IMPOSSIBLE'
  | 'DEADLINE_HIGH_RISK'
  | 'LOW_CONDITION'
  | 'MISSING_ROUTE'
  | 'MISSING_TRUCK'
  | 'MISSING_DRIVER';

export interface DeliveryReadinessResult {
  canStart: boolean;
  etaHours: number;
  deadlineHours: number;
  timeMarginHours: number;
  requiredFuel: number;
  currentFuel: number;
  fuelDeficit: number;
  deadlineRisk: DeadlineRiskLevel;
  fuelReadiness: TruckFuelReadiness | null;
  reasons: DeliveryReadinessReason[];
}

export interface EvaluateDeliveryReadinessInput {
  contract: Contract;
  truck: Truck | null | undefined;
  trailer?: Trailer | null;
  driver: Driver | null | undefined;
  route: Route | null | undefined;
  fuelPricePerLiter: number;
  activeWorldEvents?: WorldEvent[];
}

export function evaluateDeliveryReadiness(
  input: EvaluateDeliveryReadinessInput,
): DeliveryReadinessResult {
  const deadlineHours = Math.max(0, input.contract.deadlineHours ?? 0);
  const reasons: DeliveryReadinessReason[] = [];

  if (!input.truck) {
    return {
      canStart: false,
      etaHours: 0,
      deadlineHours,
      timeMarginHours: deadlineHours,
      requiredFuel: 0,
      currentFuel: 0,
      fuelDeficit: 0,
      deadlineRisk: 'normal',
      fuelReadiness: null,
      reasons: ['MISSING_TRUCK'],
    };
  }
  if (!input.driver) {
    return {
      canStart: false,
      etaHours: 0,
      deadlineHours,
      timeMarginHours: deadlineHours,
      requiredFuel: 0,
      currentFuel: input.truck.currentFuelL ?? 0,
      fuelDeficit: 0,
      deadlineRisk: 'normal',
      fuelReadiness: null,
      reasons: ['MISSING_DRIVER'],
    };
  }
  if (!input.route) {
    return {
      canStart: false,
      etaHours: 0,
      deadlineHours,
      timeMarginHours: deadlineHours,
      requiredFuel: 0,
      currentFuel: input.truck.currentFuelL ?? 0,
      fuelDeficit: 0,
      deadlineRisk: 'normal',
      fuelReadiness: null,
      reasons: ['MISSING_ROUTE'],
    };
  }

  const economics = calculateContractEconomics({
    contract: input.contract,
    truck: input.truck,
    trailer: input.trailer ?? null,
    driver: input.driver,
    route: input.route,
    globalEconomySnapshot: {
      fuelPricePerLiter: sanitizeFuelPricePerLiter(input.fuelPricePerLiter),
    },
    activeEvents: input.activeWorldEvents,
  });

  const etaHours = Math.max(0, economics.estimatedDurationHours);
  const requiredFuel = Math.max(0, economics.fuelLiters);
  const fuelReadiness = getTruckFuelReadiness(
    input.truck,
    requiredFuel,
    input.fuelPricePerLiter,
  );
  const deadlineRisk = classifyDeadlineRisk(etaHours, deadlineHours);
  const timeMarginHours = deadlineHours - etaHours;

  if (!fuelReadiness.canCompleteWithoutRefuel) {
    reasons.push('INSUFFICIENT_FUEL');
  }
  if (deadlineRisk === 'impossible') {
    reasons.push('DEADLINE_IMPOSSIBLE');
  } else if (deadlineRisk === 'risky') {
    reasons.push('DEADLINE_HIGH_RISK');
  }
  if ((input.truck.condition ?? 0) < MIN_TRUCK_CONDITION_FOR_DELIVERY) {
    reasons.push('LOW_CONDITION');
  }

  const blocking = reasons.some(
    (reason) =>
      reason === 'INSUFFICIENT_FUEL' ||
      reason === 'DEADLINE_IMPOSSIBLE' ||
      reason === 'LOW_CONDITION',
  );

  return {
    canStart: !blocking,
    etaHours,
    deadlineHours,
    timeMarginHours,
    requiredFuel: fuelReadiness.requiredFuelL,
    currentFuel: fuelReadiness.currentFuelL,
    fuelDeficit: fuelReadiness.fuelDeficitL,
    deadlineRisk,
    fuelReadiness,
    reasons,
  };
}

export function deliveryReadinessFromGlobalEconomy(
  input: Omit<EvaluateDeliveryReadinessInput, 'fuelPricePerLiter'> & {
    globalEconomy?: Pick<GlobalEconomy, 'fuelPrice'> | null;
  },
): DeliveryReadinessResult {
  return evaluateDeliveryReadiness({
    ...input,
    fuelPricePerLiter: input.globalEconomy?.fuelPrice ?? 0,
  });
}
