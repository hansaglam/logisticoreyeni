/**
 * Canonical ROAD contract world events (Map V2 Step 29AB).
 *
 * Production contract modifiers live in worldEvents.ts templates.
 * Step 29Z epoch events (fuel ×1.12 / demand ×1.08) are a different schedule
 * and are not used here. The public save still keeps its own worldEvents array.
 * Pure. No React. No Firebase.
 */

import {
  MAX_ACTIVE_WORLD_EVENTS,
  MAX_NEW_EVENTS_PER_DAY,
  WORLD_EVENT_TEMPLATES,
} from '../data/worldEvents';
import { DAY_MS } from '../simulation/economyClock';
import {
  applyWorldEventImpactToContract,
  processWorldEventsForDayRange,
} from '../simulation/worldEvents';
import type { Contract, ProductId, WorldEvent, WorldEventImpact } from '../types/game';

export const CONTRACT_WORLD_EVENT_AUTHORITY_STATUS =
  'CONTRACT_WORLD_EVENT_AUTHORITY_PASS_INTERNAL_ONLY' as const;

export const CONTRACT_WORLD_EVENT_DIAGNOSTIC =
  'CONTRACT_WORLD_EVENT_INTERNAL_ONLY' as const;

export const CONTRACT_EVENT_OWNERSHIP = 'GLOBAL_CONTRACT_EVENT' as const;

export const CONTRACT_EVENT_CLOCK = 'CONTRACT_EVENT_CLOCK_INTERNAL_REAL_DAY' as const;

export const CONTRACT_EVENT_STACKING = 'MULTIPLY_THEN_CLAMP_1_TO_1_25' as const;

export const CONTRACT_EVENT_RNG_PARITY =
  'PRODUCTION_CONTRACT_EVENT_RNG_SERVER_CANONICAL_DIFFERENT_SEQUENCE' as const;

export const CONTRACT_REFRESH_GAME_TIME_PARITY =
  'CONTRACT_REFRESH_GAME_TIME_PARITY_PASS_INTERNAL_ONLY' as const;

export const CANONICAL_CONTRACT_WORLD_EVENT_AUTHORITY_ENV =
  'CANONICAL_CONTRACT_WORLD_EVENT_AUTHORITY' as const;

export const CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION =
  'canonical-road-contract-world-event-internal-v1' as const;

export const CANONICAL_CONTRACT_WORLD_EVENT_SEED_KEY =
  CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION;

export const CANONICAL_ROAD_CONTRACT_EVENTS_DOC = 'canonicalRoadContractEvents/current' as const;

export const CONTRACT_EVENT_PAYMENT_CLAMP = { min: 1, max: 1.25 } as const;
export const CONTRACT_EVENT_DURATION_CLAMP = { min: 1, max: 1.25 } as const;

const ECONOMIC_IMPACT_KEYS = [
  'contractPaymentMultiplier',
  'deliveryDurationMultiplier',
  'contractSpawnWeightMultiplier',
  'fuelPriceMultiplier',
  'productPriceMultiplier',
  'maintenanceCostMultiplier',
] as const satisfies readonly (keyof WorldEventImpact)[];

export type CanonicalContractEventCatalogRow = {
  eventId: string;
  scope: 'global' | 'city' | 'product' | 'city_product';
  paymentMultiplier: readonly [number, number] | null;
  durationMultiplier: readonly [number, number] | null;
  spawnWeightMultiplier: readonly [number, number] | null;
  cityIds: readonly string[];
  productIds: readonly ProductId[];
  durationDays: readonly [number, number];
  weight: number;
  priority: 'MULTIPLY_THEN_CLAMP';
  policyVersion: typeof CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION;
};

export const CANONICAL_CONTRACT_EVENT_CATALOG: readonly CanonicalContractEventCatalogRow[] =
  WORLD_EVENT_TEMPLATES.map((template) => ({
    eventId: template.type,
    scope: template.scope,
    paymentMultiplier: template.impactRanges.contractPaymentMultiplier ?? null,
    durationMultiplier: template.impactRanges.deliveryDurationMultiplier ?? null,
    spawnWeightMultiplier: template.impactRanges.contractSpawnWeightMultiplier ?? null,
    cityIds: template.cityIds ?? [],
    productIds: template.productIds ?? [],
    durationDays: template.durationDays,
    weight: template.weight,
    priority: 'MULTIPLY_THEN_CLAMP' as const,
    policyVersion: CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION,
  }));

export type CanonicalContractEventSnapshot = {
  policyVersion: typeof CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION;
  snapshotId: string;
  dayIndex: number;
  seedKey: string;
  activeEvents: WorldEvent[];
};

export type CanonicalContractEventState = {
  policyVersion: typeof CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION;
  snapshotId: string;
  dayIndex: number;
  seedKey: string;
  lastGeneratedDay: number;
  events: WorldEvent[];
  activeEventIds: string[];
};

export type CanonicalContractWorldEventGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalContractWorldEventGate(options?: {
  envValue?: string | null;
}): CanonicalContractWorldEventGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_CONTRACT_WORLD_EVENT_AUTHORITY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalContractWorldEventAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalContractWorldEventGate(options) === 'INTERNAL_TEST';
}

export function contractEventDayIndex(serverNowMs: number): number {
  return Math.max(1, Math.floor(Math.max(0, serverNowMs) / DAY_MS));
}

export function contractEventSnapshotId(dayIndex: number): string {
  return `cwe_${CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION}_${dayIndex}`;
}

export function contractEventNowMsForDay(day: number, serverNowMs: number, targetDay: number): number {
  if (day >= targetDay) return serverNowMs;
  return day * DAY_MS;
}

function isKnownEventType(type: string): boolean {
  return WORLD_EVENT_TEMPLATES.some((template) => template.type === type);
}

function impactMultiplierOk(value: unknown, kind: 'payment' | 'duration' | 'other'): boolean {
  if (value == null) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (kind === 'duration' && value <= 0) return false;
  if (kind === 'payment' && value <= 0) return false;
  if (kind === 'other' && value <= 0) return false;
  return value <= 10;
}

export function validateCanonicalContractEvents(
  events: unknown,
): { ok: true; events: WorldEvent[] } | { ok: false; reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' } {
  if (!Array.isArray(events)) return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
  const parsed: WorldEvent[] = [];
  for (const item of events) {
    if (!item || typeof item !== 'object') {
      return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
    }
    const record = item as WorldEvent;
    if (typeof record.type !== 'string' || !isKnownEventType(record.type)) {
      return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
    }
    if (typeof record.id !== 'string' || record.id.length === 0) {
      return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
    }
    const impact = record.impact;
    if (!impact || typeof impact !== 'object') {
      return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
    }
    if (!impactMultiplierOk(impact.contractPaymentMultiplier, 'payment')) {
      return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
    }
    if (!impactMultiplierOk(impact.deliveryDurationMultiplier, 'duration')) {
      return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
    }
    for (const key of ECONOMIC_IMPACT_KEYS) {
      if (key === 'contractPaymentMultiplier' || key === 'deliveryDurationMultiplier') continue;
      if (!impactMultiplierOk(impact[key], 'other')) {
        return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
      }
    }
    if (typeof record.startsAt === 'number' || typeof record.endsAt === 'number') {
      if (
        typeof record.startsAt !== 'number' ||
        typeof record.endsAt !== 'number' ||
        !Number.isFinite(record.startsAt) ||
        !Number.isFinite(record.endsAt) ||
        record.startsAt > record.endsAt
      ) {
        return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
      }
    }
    if (!Number.isFinite(record.durationDays) || record.durationDays <= 0) {
      return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
    }
    parsed.push(record);
  }
  return { ok: true, events: parsed };
}

function snapshotFromState(state: CanonicalContractEventState): CanonicalContractEventSnapshot {
  return {
    policyVersion: state.policyVersion,
    snapshotId: state.snapshotId,
    dayIndex: state.dayIndex,
    seedKey: state.seedKey,
    activeEvents: state.events.filter((event) => event.isActive),
  };
}

function stateFromReplay(
  events: WorldEvent[],
  lastGeneratedDay: number,
  dayIndex: number,
): CanonicalContractEventState | { ok: false; reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' } {
  const validated = validateCanonicalContractEvents(events);
  if (!validated.ok) return validated;
  const activeEventIds = validated.events.filter((event) => event.isActive).map((event) => event.id);
  return {
    policyVersion: CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION,
    snapshotId: contractEventSnapshotId(dayIndex),
    dayIndex,
    seedKey: CANONICAL_CONTRACT_WORLD_EVENT_SEED_KEY,
    lastGeneratedDay,
    events: validated.events,
    activeEventIds,
  };
}

export function planCanonicalContractEventAdvance(
  stored: unknown,
  serverNowMs: number,
):
  | { ok: true; state: CanonicalContractEventState; advanced: boolean }
  | { ok: false; reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' | 'CONTRACT_EVENT_CLOCK_REGRESSION' } {
  if (!Number.isFinite(serverNowMs)) {
    return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
  }
  const dayIndex = contractEventDayIndex(serverNowMs);
  if (stored == null) {
    const replayed = processWorldEventsForDayRange({
      worldEvents: [],
      fromDay: 1,
      toDay: dayIndex,
      seedKey: CANONICAL_CONTRACT_WORLD_EVENT_SEED_KEY,
      nowMsForDay: (day) => contractEventNowMsForDay(day, serverNowMs, dayIndex),
    });
    const state = stateFromReplay(replayed.worldEvents, replayed.lastWorldEventGeneratedDay, dayIndex);
    if ('ok' in state) return state;
    return { ok: true, state, advanced: true };
  }
  if (!stored || typeof stored !== 'object') {
    return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
  }
  const record = stored as Partial<CanonicalContractEventState>;
  if (record.policyVersion !== CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION) {
    return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
  }
  if (record.seedKey !== CANONICAL_CONTRACT_WORLD_EVENT_SEED_KEY) {
    return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
  }
  if (typeof record.dayIndex !== 'number' || typeof record.lastGeneratedDay !== 'number') {
    return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
  }
  const validated = validateCanonicalContractEvents(record.events);
  if (!validated.ok) return validated;
  if (record.dayIndex > dayIndex) {
    return { ok: false, reason: 'CONTRACT_EVENT_CLOCK_REGRESSION' };
  }
  if (record.dayIndex === dayIndex) {
    const state = stateFromReplay(validated.events, record.lastGeneratedDay, dayIndex);
    if ('ok' in state) return state;
    return { ok: true, state, advanced: false };
  }
  const replayed = processWorldEventsForDayRange({
    worldEvents: validated.events,
    fromDay: record.lastGeneratedDay + 1,
    toDay: dayIndex,
    seedKey: CANONICAL_CONTRACT_WORLD_EVENT_SEED_KEY,
    nowMsForDay: (day) => contractEventNowMsForDay(day, serverNowMs, dayIndex),
  });
  const state = stateFromReplay(replayed.worldEvents, replayed.lastWorldEventGeneratedDay, dayIndex);
  if ('ok' in state) return state;
  return { ok: true, state, advanced: true };
}

export function activeContractEventSnapshot(
  state: CanonicalContractEventState,
): CanonicalContractEventSnapshot {
  return snapshotFromState(state);
}

export function parseCanonicalContractEventSnapshot(
  raw: unknown,
):
  | { ok: true; snapshot: CanonicalContractEventSnapshot }
  | { ok: false; reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
  }
  const record = raw as Partial<CanonicalContractEventSnapshot>;
  if (record.policyVersion !== CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION) {
    return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
  }
  if (typeof record.snapshotId !== 'string' || typeof record.dayIndex !== 'number') {
    return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
  }
  if (record.seedKey !== CANONICAL_CONTRACT_WORLD_EVENT_SEED_KEY) {
    return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
  }
  const events = validateCanonicalContractEvents(record.activeEvents);
  if (!events.ok) return events;
  return {
    ok: true,
    snapshot: {
      policyVersion: CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION,
      snapshotId: record.snapshotId,
      dayIndex: record.dayIndex,
      seedKey: CANONICAL_CONTRACT_WORLD_EVENT_SEED_KEY,
      activeEvents: events.events,
    },
  };
}

export function contractEventAdjustmentForOffer(
  contract: Pick<Contract, 'originCityId' | 'destinationCityId' | 'productId'>,
  activeEvents: readonly WorldEvent[],
): { paymentMultiplier: number; durationMultiplier: number; eventIds: string[] } {
  const adjustment = applyWorldEventImpactToContract(
    contract as Contract,
    [...activeEvents],
    1,
    1,
  );
  const eventIds = activeEvents
    .filter((event) => {
      const cityMatch =
        !event.cityId ||
        event.cityId === contract.originCityId ||
        event.cityId === contract.destinationCityId;
      const productMatch = !event.productId || event.productId === contract.productId;
      return cityMatch && productMatch;
    })
    .map((event) => event.id);
  return {
    paymentMultiplier: adjustment.paymentMultiplier,
    durationMultiplier: adjustment.durationMultiplier,
    eventIds,
  };
}

export function contractEventScheduleLimits(): {
  maxActive: number;
  maxNewPerDay: number;
} {
  return {
    maxActive: MAX_ACTIVE_WORLD_EVENTS,
    maxNewPerDay: MAX_NEW_EVENTS_PER_DAY,
  };
}
