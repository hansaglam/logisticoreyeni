/**
 * Delivery incidents — duration-normalized rolls, severity tiers, player decisions.
 * Offline catch-up does not generate new incidents.
 */

import type {
  Contract,
  Delivery,
  DeliveryIncident,
  DeliveryIncidentChoice,
  DeliveryIncidentEffects,
  DeliveryIncidentStatus,
  DeliveryIncidentType,
  Player,
} from '../types/game';

import { normalizeDeliveryAdBoostFields } from './deliveryAdBoost';
import {
  formatOperationChoiceEffectSummary,
  resolveDeliveryOperationChoice,
  type ResolveDeliveryOperationChoiceEffects,
} from './deliveryOperationChoice';
import {
  DELIVERY_INCIDENT_TYPES,
  isKnownIncidentType,
  toIncidentTemplate,
} from './incidentCatalog';
import {
  DELIVERY_INCIDENT_COOLDOWN_HOURS,
  INCIDENT_PROGRESS_MAX,
  INCIDENT_PROGRESS_MIN,
  MIN_COMPLETED_CONTRACTS_FOR_INCIDENT,
  MIN_TRAVEL_HOURS_FOR_INCIDENT,
  buildIncidentRollContext,
  deliveryHasMajorIncident,
  getIncidentTriggerProgress,
  getMaxIncidentsForDelivery,
  getSeverityWeights,
  getSlotFireChance,
  hashStringToUnit,
  isPerDeliveryIncidentCooldownActive,
  pickIncidentType,
  pickWeightedSeverity,
  scaleIncidentEffectsForDriver,
} from './incidentProbability';

export { DELIVERY_INCIDENT_TYPES, INCIDENT_CATEGORY_LABELS } from './incidentCatalog';
export {
  DELIVERY_INCIDENT_COOLDOWN_HOURS,
  INCIDENT_PROGRESS_MAX,
  INCIDENT_PROGRESS_MIN,
  LONG_DELIVERY_INCIDENT_THRESHOLD_HOURS,
  MIN_TRAVEL_HOURS_FOR_INCIDENT,
  PER_DELIVERY_INCIDENT_COOLDOWN_HOURS,
  PER_DELIVERY_INCIDENT_PROGRESS_COOLDOWN,
  getIncidentTriggerProgress,
  getMaxIncidentsForDelivery,
  getSlotFireChance,
  isPerDeliveryIncidentCooldownActive,
} from './incidentProbability';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getIncidentChanceForContractType(_contractType?: string): number {
  return getSlotFireChance({ travelHours: 10 } as Delivery);
}

export function getDeliveryIncidentRollIndex(delivery: Delivery): number {
  return delivery.incidentRollsAttempted ?? 0;
}

export function canAttemptDeliveryIncidentRoll(
  delivery: Delivery,
  currentGameTime?: number,
): boolean {
  if (delivery.incident?.status === 'pending' && delivery.incidentResolved !== true) {
    return false;
  }
  if (getDeliveryIncidentRollIndex(delivery) >= getMaxIncidentsForDelivery(delivery)) {
    return false;
  }
  if (currentGameTime != null && isPerDeliveryIncidentCooldownActive(delivery, currentGameTime)) {
    return false;
  }
  return true;
}

export function shouldGenerateDeliveryIncident(
  delivery: Delivery,
  player: Player,
  contract?: Contract,
): boolean {
  if (delivery.status !== 'on_route' && delivery.status !== 'preparing') {
    return false;
  }
  if ((player.completedContracts ?? 0) < MIN_COMPLETED_CONTRACTS_FOR_INCIDENT) {
    return false;
  }
  if (delivery.travelHours < MIN_TRAVEL_HOURS_FOR_INCIDENT) {
    return false;
  }
  if (delivery.progress < INCIDENT_PROGRESS_MIN || delivery.progress > INCIDENT_PROGRESS_MAX) {
    return false;
  }
  if (!contract) {
    return false;
  }
  return true;
}

export function formatIncidentChoiceEffectSummary(effects: DeliveryIncidentEffects): string {
  return formatOperationChoiceEffectSummary(effects);
}

export function generateDeliveryIncident(
  delivery: Delivery,
  player: Player,
  seed: string,
  currentGameTime: number,
  triggerProgress: number,
  excludedType?: DeliveryIncidentType,
): DeliveryIncident {
  const context = buildIncidentRollContext(delivery, player);
  const allowMajor =
    !deliveryHasMajorIncident(delivery) && (delivery.incidentResolutionHistory?.length ?? 0) === 0;
  const severity = pickWeightedSeverity(
    getSeverityWeights({
      companyLevel: context.companyLevel,
      riskTier: context.riskTier,
      allowMajor,
    }),
    hashStringToUnit(`${seed}:severity`),
  );
  const type = pickIncidentType({
    severity,
    delivery,
    player,
    truck: context.truck,
    driver: context.driver,
    riskTier: context.riskTier,
    excludedType,
    seed,
  });
  const template = toIncidentTemplate(type);
  const choices = template.choices.map((choice) => {
    const effects = scaleIncidentEffectsForDriver(choice.effects, context.driver);
    return {
      ...choice,
      effects,
      effectSummary: formatIncidentChoiceEffectSummary(effects),
    };
  });

  return {
    id: `incident_${delivery.id}_${type}_${Math.floor(triggerProgress * 100)}`,
    deliveryId: delivery.id,
    type: template.type,
    title: template.title,
    description: template.description,
    createdAtGameTime: currentGameTime,
    triggerProgress,
    status: 'pending',
    choices,
    severity: template.severity,
    polarity: template.polarity,
  };
}

/** __DEV__ manuel test — production incident algoritmasını etkilemez. */
export function createDebugDeliveryIncident(
  delivery: Delivery,
  currentGameTime: number,
  incidentType?: DeliveryIncidentType,
): DeliveryIncident {
  const type = incidentType ?? DELIVERY_INCIDENT_TYPES[0] ?? 'traffic';
  const triggerProgress =
    delivery.progress >= INCIDENT_PROGRESS_MIN && delivery.progress <= INCIDENT_PROGRESS_MAX
      ? delivery.progress
      : getIncidentTriggerProgress(delivery);
  const template = toIncidentTemplate(type);
  return {
    id: `incident_debug_${delivery.id}_${type}_${Math.floor(currentGameTime)}`,
    deliveryId: delivery.id,
    type: template.type,
    title: template.title,
    description: template.description,
    createdAtGameTime: currentGameTime,
    triggerProgress,
    status: 'pending',
    choices: template.choices,
    severity: template.severity,
    polarity: template.polarity,
  };
}

export function tryGenerateDeliveryIncident(
  delivery: Delivery,
  _contract: Contract,
  player: Player,
  seed: string,
  currentGameTime: number,
  triggerProgress: number,
  excludedType?: DeliveryIncidentType,
): DeliveryIncident | null {
  const chance = getSlotFireChance(delivery);
  const roll = hashStringToUnit(`${seed}:roll`);
  if (roll >= chance) {
    return null;
  }
  return generateDeliveryIncident(
    delivery,
    player,
    seed,
    currentGameTime,
    triggerProgress,
    excludedType,
  );
}

export function maybeRollDeliveryIncident(
  delivery: Delivery,
  contract: Contract | undefined,
  player: Player,
  currentGameTime: number,
  excludedType?: DeliveryIncidentType,
): Delivery {
  if (!canAttemptDeliveryIncidentRoll(delivery, currentGameTime)) {
    return delivery;
  }

  const rollIndex = getDeliveryIncidentRollIndex(delivery);
  const triggerProgress = getIncidentTriggerProgress(delivery, rollIndex);
  if (delivery.progress < triggerProgress) {
    return delivery;
  }

  if (!shouldGenerateDeliveryIncident(delivery, player, contract)) {
    return delivery;
  }

  const seed = `${delivery.id}:${delivery.contractId}:${Math.floor(delivery.startedAt / 24)}:${rollIndex}`;
  const incident = tryGenerateDeliveryIncident(
    delivery,
    contract!,
    player,
    seed,
    currentGameTime,
    triggerProgress,
    excludedType,
  );

  const nextRollCount = rollIndex + 1;
  if (!incident) {
    return {
      ...delivery,
      incidentRollsAttempted: nextRollCount,
    };
  }

  return {
    ...delivery,
    incidentRollsAttempted: nextRollCount,
    incidentGenerated: true,
    incidentResolved: false,
    incident,
  };
}

function normalizeIncidentStatus(value: unknown): DeliveryIncidentStatus {
  if (value === 'pending' || value === 'resolved' || value === 'expired') {
    return value;
  }
  return 'pending';
}

function normalizeIncidentType(value: unknown): DeliveryIncidentType {
  if (typeof value === 'string' && isKnownIncidentType(value)) {
    return value;
  }
  return 'traffic';
}

export function getLatestDeliveryIncident(deliveries: Delivery[]): DeliveryIncident | undefined {
  return deliveries
    .map((delivery) => delivery.incident)
    .filter((incident): incident is DeliveryIncident => incident != null)
    .sort((left, right) => right.createdAtGameTime - left.createdAtGameTime)[0];
}

export function isDeliveryIncidentCooldownActive(
  deliveries: Delivery[],
  currentGameTime: number,
): boolean {
  const latest = getLatestDeliveryIncident(deliveries);
  if (!latest) {
    return false;
  }
  const anchor = latest.resolvedAtGameTime ?? latest.createdAtGameTime;
  return currentGameTime - anchor < DELIVERY_INCIDENT_COOLDOWN_HOURS;
}

function normalizeIncidentChoice(raw: unknown): DeliveryIncidentChoice | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.label !== 'string') {
    return null;
  }
  const effectsRaw = record.effects;
  const effects: DeliveryIncidentEffects =
    effectsRaw && typeof effectsRaw === 'object'
      ? (effectsRaw as DeliveryIncidentEffects)
      : {};

  return {
    id: record.id,
    label: record.label,
    description: typeof record.description === 'string' ? record.description : '',
    effects,
    effectSummary:
      typeof record.effectSummary === 'string'
        ? record.effectSummary
        : formatIncidentChoiceEffectSummary(effects),
  };
}

export function normalizeDeliveryIncident(raw: unknown): DeliveryIncident | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.deliveryId !== 'string') {
    return undefined;
  }

  const choices = Array.isArray(record.choices)
    ? record.choices
        .map(normalizeIncidentChoice)
        .filter((choice): choice is DeliveryIncidentChoice => choice != null)
    : [];

  if (choices.length < 2) {
    return undefined;
  }

  const status = normalizeIncidentStatus(record.status);
  const type = normalizeIncidentType(record.type);
  const template = toIncidentTemplate(type);
  const incident: DeliveryIncident = {
    id: record.id,
    deliveryId: record.deliveryId,
    type,
    title: typeof record.title === 'string' ? record.title : template.title,
    description: typeof record.description === 'string' ? record.description : template.description,
    createdAtGameTime:
      typeof record.createdAtGameTime === 'number' ? record.createdAtGameTime : 0,
    triggerProgress:
      typeof record.triggerProgress === 'number' ? clamp(record.triggerProgress, 0, 1) : 0.5,
    status,
    choices,
    severity:
      record.severity === 'minor' || record.severity === 'moderate' || record.severity === 'major'
        ? record.severity
        : template.severity,
    polarity:
      record.polarity === 'positive' ||
      record.polarity === 'negative' ||
      record.polarity === 'neutral'
        ? record.polarity
        : template.polarity,
  };

  if (typeof record.resolvedChoiceId === 'string') {
    incident.resolvedChoiceId = record.resolvedChoiceId;
  }
  if (typeof record.resolvedAtGameTime === 'number') {
    incident.resolvedAtGameTime = record.resolvedAtGameTime;
  }

  return incident;
}

export function normalizeDelivery(delivery: Delivery): Delivery {
  const incident = delivery.incident ? normalizeDeliveryIncident(delivery.incident) : undefined;
  const incidentResolved =
    delivery.incidentResolved === true ||
    incident?.status === 'resolved' ||
    Boolean(incident?.resolvedChoiceId);

  return normalizeDeliveryAdBoostFields({
    ...delivery,
    progress: clamp(Number(delivery.progress) || 0, 0, 1),
    travelHours: Number.isFinite(delivery.travelHours) ? delivery.travelHours : 0.1,
    expectedDurationGameHours:
      delivery.expectedDurationGameHours ??
      (Number.isFinite(delivery.travelHours) ? delivery.travelHours : undefined),
    startedRealAtMs:
      delivery.startedRealAtMs != null && Number.isFinite(delivery.startedRealAtMs)
        ? delivery.startedRealAtMs
        : undefined,
    lastProgressedRealAtMs:
      delivery.lastProgressedRealAtMs != null && Number.isFinite(delivery.lastProgressedRealAtMs)
        ? delivery.lastProgressedRealAtMs
        : delivery.startedRealAtMs != null && Number.isFinite(delivery.startedRealAtMs)
          ? delivery.startedRealAtMs
          : undefined,
    settlementId:
      typeof delivery.settlementId === 'string' && delivery.settlementId.length > 0
        ? delivery.settlementId
        : undefined,
    incidentGenerated: delivery.incidentGenerated === true || Boolean(incident),
    incidentRollsAttempted:
      typeof delivery.incidentRollsAttempted === 'number' &&
      Number.isFinite(delivery.incidentRollsAttempted)
        ? Math.max(0, Math.floor(delivery.incidentRollsAttempted))
        : delivery.incidentGenerated === true || Boolean(incident)
          ? 1
          : 0,
    incidentResolved,
    lastIncidentResolvedAt:
      typeof delivery.lastIncidentResolvedAt === 'number' &&
      Number.isFinite(delivery.lastIncidentResolvedAt)
        ? delivery.lastIncidentResolvedAt
        : undefined,
    lastIncidentResolvedProgress:
      typeof delivery.lastIncidentResolvedProgress === 'number' &&
      Number.isFinite(delivery.lastIncidentResolvedProgress)
        ? clamp(delivery.lastIncidentResolvedProgress, 0, 1)
        : undefined,
    incident:
      incident && incident.status === 'pending' && !incidentResolved
        ? incident
        : incident
          ? { ...incident, status: incidentResolved ? 'resolved' : incident.status }
          : undefined,
    failureReason: delivery.status === 'failed' ? delivery.failureReason : undefined,
  });
}

export interface ResolveDeliveryIncidentEffects extends ResolveDeliveryOperationChoiceEffects {}

export interface ResolveDeliveryIncidentResult {
  ok: boolean;
  reason?: string;
  delivery?: Delivery;
  effects?: ResolveDeliveryOperationChoiceEffects;
}

export function resolveDeliveryIncident(
  delivery: Delivery,
  choiceId: string,
  currentGameTime: number,
  options?: { playerMoney?: number },
): ResolveDeliveryIncidentResult {
  return resolveDeliveryOperationChoice({
    delivery,
    choiceId,
    currentGameTime,
    playerMoney: options?.playerMoney,
  });
}
