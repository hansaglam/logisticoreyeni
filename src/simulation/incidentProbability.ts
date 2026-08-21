/**
 * Duration-normalized incident probability, caps, cooldown, and scaling.
 */

import type {
  Contract,
  Delivery,
  Driver,
  Player,
  Truck,
} from '../types/game';
import type { DeliveryIncidentSeverity, DeliveryIncidentType } from '../types/game';
import { getDeliveryRiskTier, type DeliveryRiskTier } from './leveling';
import {
  getIncidentDefinition,
  listIncidentDefinitions,
} from './incidentCatalog';

export const INCIDENT_PROGRESS_MIN = 0.08;
export const INCIDENT_PROGRESS_MAX = 0.9;
export const MIN_TRAVEL_HOURS_FOR_INCIDENT = 1.25;
export const MIN_COMPLETED_CONTRACTS_FOR_INCIDENT = 1;

/** Fleet-wide pause after the latest incident before another truck can roll. */
export const DELIVERY_INCIDENT_COOLDOWN_HOURS = 2;
/** Same delivery: both hour and progress gates must pass. */
export const PER_DELIVERY_INCIDENT_COOLDOWN_HOURS = 1.75;
export const PER_DELIVERY_INCIDENT_PROGRESS_COOLDOWN = 0.18;

export const SHORT_DELIVERY_HOURS = 6;
export const LONG_DELIVERY_INCIDENT_THRESHOLD_HOURS = 16;

/** Target expected incidents per game hour on a typical mid-level, medium-risk job. */
export const INCIDENT_TARGET_RATE_PER_HOUR = 0.048;

export function hashStringToUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function getCompanyLevel(player: Player): number {
  const level = player.level ?? player.companyLevel ?? 1;
  return Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
}

export function getMaxIncidentsForDelivery(delivery: Delivery): number {
  const hours = delivery.travelHours ?? 0;
  if (hours < SHORT_DELIVERY_HOURS) {
    return 1;
  }
  if (hours < LONG_DELIVERY_INCIDENT_THRESHOLD_HOURS) {
    return 2;
  }
  return 3;
}

export function getExpectedIncidentsForDelivery(delivery: Delivery): number {
  const hours = Math.max(0, delivery.travelHours ?? 0);
  const max = getMaxIncidentsForDelivery(delivery);
  return Math.min(max, INCIDENT_TARGET_RATE_PER_HOUR * hours);
}

export function getSlotFireChance(delivery: Delivery): number {
  const slots = getMaxIncidentsForDelivery(delivery);
  const expected = getExpectedIncidentsForDelivery(delivery);
  if (slots <= 0) {
    return 0;
  }
  return Math.min(0.52, Math.max(0.05, expected / slots));
}

export function getIncidentTriggerProgress(delivery: Delivery, rollIndex = 0): number {
  const slots = Math.max(1, getMaxIncidentsForDelivery(delivery));
  const index = Math.max(0, Math.min(rollIndex, slots - 1));
  const window = INCIDENT_PROGRESS_MAX - INCIDENT_PROGRESS_MIN;
  const band = window / slots;
  const seed = `${delivery.id}:${delivery.contractId}:trigger:${index}`;
  const roll = hashStringToUnit(seed);
  const start = INCIDENT_PROGRESS_MIN + index * band;
  const padding = Math.min(0.04, band * 0.2);
  return start + padding + roll * Math.max(0.04, band - padding * 2);
}

export function getSeverityWeights(input: {
  companyLevel: number;
  riskTier: DeliveryRiskTier;
  allowMajor: boolean;
}): Record<DeliveryIncidentSeverity, number> {
  const level = input.companyLevel;
  let minor: number;
  let moderate: number;
  let major: number;
  if (level <= 3) {
    minor = 0.88;
    moderate = 0.11;
    major = 0.01;
  } else if (level <= 8) {
    minor = 0.7;
    moderate = 0.25;
    major = 0.05;
  } else {
    minor = 0.62;
    moderate = 0.3;
    major = 0.08;
  }

  if (input.riskTier === 'low') {
    minor += 0.08;
    moderate -= 0.05;
    major -= 0.03;
  } else if (input.riskTier === 'high') {
    minor -= 0.08;
    moderate += 0.04;
    major += 0.04;
  }

  if (!input.allowMajor) {
    minor += major;
    major = 0;
  }

  const total = Math.max(0.001, minor + moderate + major);
  return {
    minor: Math.max(0, minor) / total,
    moderate: Math.max(0, moderate) / total,
    major: Math.max(0, major) / total,
  };
}

export function pickWeightedSeverity(
  weights: Record<DeliveryIncidentSeverity, number>,
  roll: number,
): DeliveryIncidentSeverity {
  if (roll < weights.minor) {
    return 'minor';
  }
  if (roll < weights.minor + weights.moderate) {
    return 'moderate';
  }
  return weights.major > 0 ? 'major' : 'moderate';
}

export function getUsedIncidentTypes(delivery: Delivery): Set<DeliveryIncidentType> {
  const used = new Set<DeliveryIncidentType>();
  if (delivery.incident?.type) {
    used.add(delivery.incident.type);
  }
  for (const record of delivery.incidentResolutionHistory ?? []) {
    if (record.type) {
      used.add(record.type);
      continue;
    }
    const fromCode = record.outcomeCode?.split(':')[0];
    if (fromCode) {
      used.add(fromCode as DeliveryIncidentType);
    }
  }
  return used;
}

export function deliveryHasMajorIncident(delivery: Delivery): boolean {
  if (delivery.incident?.severity === 'major') {
    return true;
  }
  return (delivery.incidentResolutionHistory ?? []).some((item) => item.severity === 'major');
}

export function isPerDeliveryIncidentCooldownActive(
  delivery: Delivery,
  currentGameTime: number,
): boolean {
  const resolvedAt = delivery.lastIncidentResolvedAt;
  const resolvedProgress = delivery.lastIncidentResolvedProgress;
  if (resolvedAt == null && resolvedProgress == null) {
    const last = delivery.incidentResolutionHistory?.at(-1);
    if (!last) {
      return false;
    }
    const hoursOk = currentGameTime - last.resolvedAt >= PER_DELIVERY_INCIDENT_COOLDOWN_HOURS;
    const progressOk =
      (delivery.progress ?? 0) - (last.resolvedAtProgress ?? last.triggeredAtProgress ?? 0) >=
      PER_DELIVERY_INCIDENT_PROGRESS_COOLDOWN;
    return !(hoursOk && progressOk);
  }
  const hoursOk =
    resolvedAt == null || currentGameTime - resolvedAt >= PER_DELIVERY_INCIDENT_COOLDOWN_HOURS;
  const progressOk =
    resolvedProgress == null ||
    (delivery.progress ?? 0) - resolvedProgress >= PER_DELIVERY_INCIDENT_PROGRESS_COOLDOWN;
  return !(hoursOk && progressOk);
}

export function getTypeSelectionWeight(input: {
  type: DeliveryIncidentType;
  truck?: Truck;
  driver?: Driver;
  player: Player;
  riskTier: DeliveryRiskTier;
}): number {
  const definition = getIncidentDefinition(input.type);
  let weight = 1;
  const condition = input.truck?.condition ?? 100;
  if (definition.mechanical) {
    if (condition < 55) {
      weight *= 1.7;
    } else if (condition >= 80) {
      weight *= 0.45;
    }
  }
  if (definition.polarity === 'positive' && input.riskTier === 'high') {
    weight *= 1.25;
  }
  if (definition.polarity === 'negative' && input.riskTier === 'low') {
    weight *= 0.85;
  }
  const attention = input.driver?.attention ?? 50;
  if ((input.type === 'cargo_risk' || input.type === 'severe_weather') && attention >= 70) {
    weight *= 0.65;
  }
  if ((input.player.warehouses?.length ?? 0) === 0 && input.type === 'warehouse_issue') {
    weight *= 0.35;
  }
  if ((input.player.money ?? 0) < 400 && input.type === 'discount_fuel') {
    weight *= 0.4;
  }
  return weight;
}

export function pickIncidentType(input: {
  severity: DeliveryIncidentSeverity;
  delivery: Delivery;
  player: Player;
  truck?: Truck;
  driver?: Driver;
  riskTier: DeliveryRiskTier;
  excludedType?: DeliveryIncidentType;
  seed: string;
}): DeliveryIncidentType {
  const used = getUsedIncidentTypes(input.delivery);
  if (input.excludedType) {
    used.add(input.excludedType);
  }
  const pool = listIncidentDefinitions(input.severity).filter((item) => !used.has(item.type));
  const source = pool.length > 0 ? pool : listIncidentDefinitions(input.severity);
  const weighted = source.map((item) => ({
    type: item.type,
    weight: getTypeSelectionWeight({
      type: item.type,
      truck: input.truck,
      driver: input.driver,
      player: input.player,
      riskTier: input.riskTier,
    }),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = hashStringToUnit(`${input.seed}:type`) * Math.max(total, 0.001);
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item.type;
    }
  }
  return weighted[0]?.type ?? 'roadwork';
}

export function scaleIncidentEffectsForDriver<
  T extends { deliveryTimeDeltaHours?: number; truckConditionDelta?: number },
>(effects: T, driver?: Driver): T {
  if (!driver) {
    return effects;
  }
  const experience = Math.max(0, Math.min(100, driver.experience ?? 0));
  const morale = Math.max(0, Math.min(100, driver.morale ?? 50));
  const time = effects.deliveryTimeDeltaHours ?? 0;
  const next = { ...effects };
  if (time > 0) {
    next.deliveryTimeDeltaHours = time * (1 - experience / 450);
  }
  if ((effects.truckConditionDelta ?? 0) < 0) {
    next.truckConditionDelta = (effects.truckConditionDelta ?? 0) * (1 - (morale - 50) / 280);
  }
  return next;
}

export function buildIncidentRollContext(
  delivery: Delivery,
  player: Player,
  _contract?: Contract,
): {
  companyLevel: number;
  riskTier: DeliveryRiskTier;
  truck?: Truck;
  driver?: Driver;
} {
  return {
    companyLevel: getCompanyLevel(player),
    riskTier: getDeliveryRiskTier(delivery),
    truck: player.trucks.find((item) => item.id === delivery.truckId),
    driver: player.drivers?.find((item) => item.id === delivery.driverId),
  };
}
