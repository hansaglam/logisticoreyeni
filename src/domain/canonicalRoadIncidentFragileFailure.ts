/**
 * Canonical ROAD incident / fragile / failure authority (Map V2 Step 29O).
 *
 * INTERNAL_TEST / foundation only. Server-issued incident plan + catalog effects.
 * Client cannot supply damage, cash, delay, fragile flags, or failure penalties.
 * Pure. No React. No Firebase.
 */

import { getIncidentDefinition, isKnownIncidentType } from '../simulation/incidentCatalog';
import { getOperationChoiceNetCashDelta } from '../simulation/deliveryOperationChoice';
import { hashStringToUnit } from '../simulation/incidentProbability';
import { calculateFailurePenalty } from '../simulation/delivery';
import { clamp } from '../utils/math';
import type { DeliveryIncidentEffects, DeliveryIncidentType } from '../types/game';
import { CANONICAL_CONDITION_BOUNDS } from './canonicalFleetConditionWear';
import type { CanonicalRoadCompletionOutcome } from './canonicalRoadEconomics';
import { ROAD_CRITICAL_LATE_MULTIPLIER } from './canonicalRoadEconomics';
import type { Contract } from '../types/game';

export const CANONICAL_ROAD_INCIDENT_FRAGILE_FAILURE_AUTHORITY_STATUS =
  'CANONICAL_ROAD_INCIDENT_FRAGILE_FAILURE_AUTHORITY_PASS_INTERNAL_POLICY_ONLY' as const;

export const CANONICAL_ROAD_INCIDENT_POLICY_VERSION = 'canonical-road-incident-v1' as const;
export const CANONICAL_ROAD_FRAGILE_POLICY_VERSION = 'canonical-road-fragile-v1' as const;
export const CANONICAL_ROAD_FAILURE_POLICY_VERSION = 'canonical-road-failure-v1' as const;

export const CANONICAL_ROAD_EXECUTION_AUTHORITY_BACKEND_ENV =
  'CANONICAL_ROAD_EXECUTION_AUTHORITY' as const;
export const CANONICAL_ROAD_EXECUTION_AUTHORITY_ENV_KEY =
  'EXPO_PUBLIC_CANONICAL_ROAD_EXECUTION_AUTHORITY' as const;

export const PRODUCTION_INCIDENT_PARITY_BLOCKED_CLIENT_EXECUTION_STATE =
  'PRODUCTION_INCIDENT_PARITY_BLOCKED_CLIENT_EXECUTION_STATE' as const;

export const CANONICAL_INCIDENT_RNG_MODEL = 'MODEL_B_SERVER_ISSUED_PLAN_AT_ACCEPT' as const;

export const CANONICAL_INCIDENT_OPERATION_TYPE = 'ROAD_INCIDENT_DAMAGE' as const;

export type CanonicalRoadExecutionAuthorityGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalRoadExecutionAuthorityGate(options?: {
  envValue?: string | null;
}): CanonicalRoadExecutionAuthorityGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.EXPO_PUBLIC_CANONICAL_ROAD_EXECUTION_AUTHORITY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalRoadExecutionAuthorityAllowed(options?: {
  envValue?: string | null;
}): boolean {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_ROAD_EXECUTION_AUTHORITY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST';
}

export type CanonicalIncidentEconomicCategory =
  | 'NON_ECONOMIC'
  | 'TIME_ONLY'
  | 'CONDITION_ONLY'
  | 'CASH_ONLY'
  | 'CONDITION_AND_CASH'
  | 'FAILURE_TRIGGERING'
  | 'CARGO_CONDITION_AFFECTING';

export const CATALOG_FAILURE_TRIGGERING = 'NOT_PRESENT' as const;
export const CATALOG_CARGO_CONDITION_AFFECTING = 'NOT_PRESENT' as const;

export function classifyCatalogIncidentEffects(
  effects: DeliveryIncidentEffects,
): CanonicalIncidentEconomicCategory {
  const condition = (effects.truckConditionDelta ?? 0) !== 0;
  const cash = getOperationChoiceNetCashDelta(effects) !== 0;
  const time = (effects.deliveryTimeDeltaHours ?? 0) !== 0;
  if (condition && cash) return 'CONDITION_AND_CASH';
  if (condition) return 'CONDITION_ONLY';
  if (cash) return 'CASH_ONLY';
  if (time) return 'TIME_ONLY';
  return 'NON_ECONOMIC';
}

export type CanonicalFailureAuthorityClass =
  | 'NOT_A_FAILURE'
  | 'SERVER_DERIVED_FAILURE'
  | 'SERVER_VERIFIABLE_FAILURE'
  | 'CLIENT_REPORTED_UNVERIFIED_FAILURE'
  | 'MANUAL_CANCEL_NOT_FAILURE'
  | 'UNSUPPORTED_FAILURE_SOURCE';

export function classifyCanonicalFailureAuthority(input: {
  clientOutcome: CanonicalRoadCompletionOutcome | 'CANCELLED';
  actualTravelHours: number;
  deadlineHours: number;
  clientFailureReason?: string | null;
}): CanonicalFailureAuthorityClass {
  if (input.clientOutcome === 'CANCELLED') return 'MANUAL_CANCEL_NOT_FAILURE';
  if (input.actualTravelHours > input.deadlineHours * ROAD_CRITICAL_LATE_MULTIPLIER) {
    return 'SERVER_DERIVED_FAILURE';
  }
  if (input.clientOutcome === 'FAILED') {
    return 'CLIENT_REPORTED_UNVERIFIED_FAILURE';
  }
  if (input.clientOutcome === 'COMPLETED') return 'NOT_A_FAILURE';
  return 'UNSUPPORTED_FAILURE_SOURCE';
}

export function deriveCanonicalFailurePenaltyFromPayment(payment: number): number {
  return Math.round(calculateFailurePenalty({ payment } as Contract));
}

export function deriveCanonicalFailedWear(baseWear: number): number {
  return baseWear * 0.5;
}

export type CanonicalIncidentPlanEvent = {
  slot: number;
  eventId: string;
  incidentType: DeliveryIncidentType;
  canonicalChoiceId: string;
  economicCategory: CanonicalIncidentEconomicCategory;
};

export type CanonicalRoadIncidentPlan = {
  incidentPolicyVersion: typeof CANONICAL_ROAD_INCIDENT_POLICY_VERSION;
  incidentSeed: string;
  events: CanonicalIncidentPlanEvent[];
};

export function createCanonicalIncidentSeed(uid: string, deliveryId: string): string {
  return `${CANONICAL_ROAD_INCIDENT_POLICY_VERSION}:${uid}:${deliveryId}`;
}

export function createCanonicalIncidentEventId(deliveryId: string, slot: number): string {
  return `i${slot}`;
}

export function createCanonicalIncidentCashTransactionId(
  deliveryId: string,
  eventId: string,
): string {
  return `delivery:${deliveryId}:incident:${eventId}`;
}

export function createCanonicalIncidentMutationOperationId(
  assetId: string,
  deliveryId: string,
  eventId: string,
): string {
  return `fleet:${assetId}:incident:${deliveryId}:${eventId}`;
}

export function deriveCanonicalIncidentCatalogEffects(
  incidentType: DeliveryIncidentType,
  choiceId: string,
):
  | { ok: true; effects: DeliveryIncidentEffects; netCashDelta: number; truckConditionDelta: number }
  | { ok: false; reason: string } {
  if (!isKnownIncidentType(incidentType)) {
    return { ok: false, reason: 'UNSUPPORTED_PRODUCTION_INCIDENT' };
  }
  const definition = getIncidentDefinition(incidentType);
  const choice = definition.choices.find((item) => item.id === choiceId);
  if (!choice) return { ok: false, reason: 'UNSUPPORTED_PRODUCTION_INCIDENT' };
  const effects = { ...choice.effects };
  return {
    ok: true,
    effects,
    netCashDelta: getOperationChoiceNetCashDelta(effects),
    truckConditionDelta: effects.truckConditionDelta ?? 0,
  };
}

const INTERNAL_TYPE_POOL: readonly DeliveryIncidentType[] = [
  'loading_queue',
  'unexpected_cost',
  'cargo_recheck',
  'tire_pressure',
  'fast_loading',
  'roadwork',
];

export function deriveCanonicalRoadIncidentPlan(input: {
  uid: string;
  deliveryId: string;
  enabled: boolean;
}): CanonicalRoadIncidentPlan {
  const incidentSeed = createCanonicalIncidentSeed(input.uid, input.deliveryId);
  if (!input.enabled) {
    return {
      incidentPolicyVersion: CANONICAL_ROAD_INCIDENT_POLICY_VERSION,
      incidentSeed,
      events: [],
    };
  }
  const typeIndex = Math.floor(
    hashStringToUnit(`${incidentSeed}:type`) * INTERNAL_TYPE_POOL.length,
  );
  const incidentType = INTERNAL_TYPE_POOL[typeIndex] ?? 'loading_queue';
  const definition = getIncidentDefinition(incidentType);
  const choiceIndex = Math.floor(
    hashStringToUnit(`${incidentSeed}:choice`) * Math.max(definition.choices.length, 1),
  );
  const canonicalChoiceId = definition.choices[choiceIndex]?.id ?? definition.choices[0]!.id;
  const derived = deriveCanonicalIncidentCatalogEffects(incidentType, canonicalChoiceId);
  const economicCategory = derived.ok
    ? classifyCatalogIncidentEffects(derived.effects)
    : 'NON_ECONOMIC';
  const eventId = createCanonicalIncidentEventId(input.deliveryId, 0);
  return {
    incidentPolicyVersion: CANONICAL_ROAD_INCIDENT_POLICY_VERSION,
    incidentSeed,
    events: [
      {
        slot: 0,
        eventId,
        incidentType,
        canonicalChoiceId,
        economicCategory,
      },
    ],
  };
}

export function applyCanonicalIncidentCondition(
  conditionBefore: number,
  truckConditionDelta: number,
): number {
  return clamp(
    conditionBefore + truckConditionDelta,
    CANONICAL_CONDITION_BOUNDS.min,
    CANONICAL_CONDITION_BOUNDS.max,
  );
}

export type CanonicalExecutionEventRecord = {
  eventId: string;
  eventType: 'ROAD_INCIDENT';
  policyVersion: typeof CANONICAL_ROAD_INCIDENT_POLICY_VERSION;
  incidentType: DeliveryIncidentType;
  canonicalChoiceId: string;
  conditionDelta: number;
  cashDelta: number;
  delayHours: number;
  economicCategory: CanonicalIncidentEconomicCategory;
  createdAtMs: number;
  authorityClass: 'SERVER_ISSUED_PLAN';
};

export function buildCanonicalIncidentExecutionEvent(input: {
  event: CanonicalIncidentPlanEvent;
  effects: DeliveryIncidentEffects;
  nowMs: number;
}): CanonicalExecutionEventRecord {
  return {
    eventId: input.event.eventId,
    eventType: 'ROAD_INCIDENT',
    policyVersion: CANONICAL_ROAD_INCIDENT_POLICY_VERSION,
    incidentType: input.event.incidentType,
    canonicalChoiceId: input.event.canonicalChoiceId,
    conditionDelta: input.effects.truckConditionDelta ?? 0,
    cashDelta: getOperationChoiceNetCashDelta(input.effects),
    delayHours: input.effects.deliveryTimeDeltaHours ?? 0,
    economicCategory: classifyCatalogIncidentEffects(input.effects),
    createdAtMs: input.nowMs,
    authorityClass: 'SERVER_ISSUED_PLAN',
  };
}

const FINALIZE_FORBIDDEN = [
  'incidentType',
  'incidentDamage',
  'truckConditionDelta',
  'conditionDelta',
  'condition',
  'cashDelta',
  'incidentCash',
  'delayHours',
  'deliveryTimeDeltaHours',
  'fragileBonusApplied',
  'fragileSurcharge',
  'failurePenalty',
  'failureReason',
  'completionCondition',
  'wear',
  'payment',
];

export function hasOnlyCanonicalRoadFinalizeKeys(data: Record<string, unknown>): boolean {
  if (FINALIZE_FORBIDDEN.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['deliveryId', 'canonicalSchemaVersion'].includes(key),
  );
}

export type CanonicalFleetIncidentMutationReceipt = {
  operationId: string;
  operationType: typeof CANONICAL_INCIDENT_OPERATION_TYPE;
  assetId: string;
  ownerUid: string;
  sourceDeliveryId: string;
  eventId: string;
  revisionBefore: number;
  revisionAfter: number;
  conditionBefore: number;
  conditionDelta: number;
  conditionAfter: number;
  cashTransactionId: string | null;
  cashDelta: number;
  policyVersion: typeof CANONICAL_ROAD_INCIDENT_POLICY_VERSION;
  createdAtMs: number;
  authoritySource: string;
};

export {
  getIncidentDefinition,
  isKnownIncidentType,
  getOperationChoiceNetCashDelta,
};
