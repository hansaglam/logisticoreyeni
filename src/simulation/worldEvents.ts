/**
 * Piyasa olayı simülasyonu — Retention Pack V1 Phase 2
 */

import {
  MAX_ACTIVE_WORLD_EVENTS,
  MAX_NEW_EVENTS_PER_DAY,
  WORLD_EVENTS_VERSION,
  WORLD_EVENT_TEMPLATES,
  type WorldEventTemplate,
} from '../data/worldEvents';
import { getCityName, getProductName } from '../utils/entityLookup';
import type {
  Contract,
  ProductId,
  StoreGameState,
  WorldEvent,
  WorldEventImpact,
  WorldEventSeverity,
  WorldEventType,
} from '../types/game';
import {
  getEconomyNow,
  getMarketEpoch,
  MS_PER_24H,
  ECONOMY_CONFIG_VERSION,
} from './economyClock';

export { getMarketEpoch };

export const IMPACT_CLAMP = {
  fuelPrice: { min: 1, max: 1.35 },
  productPrice: { min: 0.65, max: 1.35 },
  contractPayment: { min: 1, max: 1.25 },
  deliveryDuration: { min: 1, max: 1.25 },
  maintenanceCost: { min: 0.75, max: 1.1 },
  contractSpawnWeight: { min: 1, max: 1.35 },
} as const;

/**
 * @deprecated Kişisel oyun günü — UI/ekonomi source of truth olmamalı.
 * Simülasyon internal timeline için tutulur; dünya olayları market epoch kullanır.
 */
export function gameDayFromTime(currentTime: number): number {
  return Math.floor(Math.max(0, currentTime) / 24) + 1;
}

/** Ortak dünya zamanı indeksi — tüm oyuncular için aynı (market epoch) */
export function getSharedWorldTimeIndex(nowMs: number = getEconomyNow()): number {
  return getMarketEpoch(nowMs);
}

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pickRange(random: () => number, range: readonly [number, number]): number {
  const [min, max] = range;
  return min + (max - min) * random();
}

function buildImpact(
  template: WorldEventTemplate,
  random: () => number,
): WorldEventImpact {
  const impact: WorldEventImpact = {};
  for (const [key, range] of Object.entries(template.impactRanges) as Array<
    [keyof WorldEventImpact, readonly [number, number]]
  >) {
    if (range) {
      impact[key] = Number(pickRange(random, range).toFixed(3));
    }
  }
  return impact;
}

function localizeDescription(
  template: WorldEventTemplate,
  cityId?: string,
  productId?: ProductId,
): string {
  let description = template.description;
  if (cityId) {
    description = description.replace('{city}', getCityName(cityId));
  }
  if (productId) {
    description = description.replace('{product}', getProductName(productId));
  }
  return description;
}

function localizeTitle(
  template: WorldEventTemplate,
  cityId?: string,
  productId?: ProductId,
): string {
  if (template.type === 'harvest_surplus' && cityId) {
    return `${getCityName(cityId)} Meyve Bolluğu`;
  }
  if (template.scope === 'city' && cityId) {
    return `${getCityName(cityId)} — ${template.title}`;
  }
  if (template.scope === 'product' && productId) {
    return `${getProductName(productId)} — ${template.title}`;
  }
  return template.title;
}

function isEventActive(
  event: WorldEvent,
  currentDay: number,
  nowMs: number = getEconomyNow(),
): boolean {
  if (
    typeof event.startsAt === 'number' &&
    Number.isFinite(event.startsAt) &&
    typeof event.endsAt === 'number' &&
    Number.isFinite(event.endsAt)
  ) {
    return nowMs >= event.startsAt && nowMs <= event.endsAt;
  }
  return currentDay >= event.startsAtDay && currentDay <= event.endsAtDay;
}

function refreshActiveFlags(
  events: WorldEvent[],
  currentDay: number,
  nowMs: number = getEconomyNow(),
): WorldEvent[] {
  return events.map((event) => ({
    ...event,
    isActive: isEventActive(event, currentDay, nowMs),
  }));
}

function eventConflictKey(event: Pick<WorldEvent, 'type' | 'cityId' | 'productId'>): string {
  return `${event.type}:${event.cityId ?? 'global'}:${event.productId ?? 'all'}`;
}

function clampMultiplier(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function multiplyImpactValues(
  events: WorldEvent[],
  key: keyof WorldEventImpact,
  fallback = 1,
): number {
  return events.reduce((acc, event) => acc * (event.impact[key] ?? 1), fallback);
}

export function normalizeWorldEventsState(
  rawEvents: unknown,
  currentDay: number,
  rawVersion?: unknown,
  rawLastGeneratedDay?: unknown,
): Pick<StoreGameState, 'worldEvents' | 'worldEventsVersion' | 'lastWorldEventGeneratedDay'> {
  const events: WorldEvent[] = [];

  if (Array.isArray(rawEvents)) {
    for (const item of rawEvents) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const type = record.type;
      if (typeof type !== 'string' || !WORLD_EVENT_TEMPLATES.some((t) => t.type === type)) {
        continue;
      }
      const startsAtDay = Math.max(1, Number(record.startsAtDay) || 1);
      const durationDays = Math.max(1, Number(record.durationDays) || 1);
      const endsAtDay = Math.max(
        startsAtDay,
        Number(record.endsAtDay) || startsAtDay + durationDays - 1,
      );
      const startsAt =
        typeof record.startsAt === 'number' && Number.isFinite(record.startsAt)
          ? record.startsAt
          : undefined;
      const endsAt =
        typeof record.endsAt === 'number' && Number.isFinite(record.endsAt)
          ? record.endsAt
          : undefined;
      const globalEpoch =
        typeof record.globalEpoch === 'number' && Number.isFinite(record.globalEpoch)
          ? record.globalEpoch
          : undefined;
      const impactRaw = record.impact;
      const impact: WorldEventImpact =
        impactRaw && typeof impactRaw === 'object' ? (impactRaw as WorldEventImpact) : {};

      events.push({
        id: typeof record.id === 'string' ? record.id : `we_${type}_${startsAtDay}`,
        type: type as WorldEventType,
        title: typeof record.title === 'string' ? record.title : 'Piyasa Olayı',
        description: typeof record.description === 'string' ? record.description : '',
        cityId: typeof record.cityId === 'string' ? record.cityId : undefined,
        productId:
          typeof record.productId === 'string' ? (record.productId as ProductId) : undefined,
        startsAtDay,
        endsAtDay,
        durationDays,
        startsAt,
        endsAt,
        globalEpoch,
        economyConfigVersion:
          typeof record.economyConfigVersion === 'number'
            ? record.economyConfigVersion
            : undefined,
        impact,
        severity:
          record.severity === 'low' || record.severity === 'medium' || record.severity === 'high'
            ? record.severity
            : 'medium',
        isActive: false,
      });
    }
  }

  return {
    worldEvents: expireOldWorldEvents(events, currentDay),
    worldEventsVersion:
      typeof rawVersion === 'number' && rawVersion > 0 ? rawVersion : WORLD_EVENTS_VERSION,
    lastWorldEventGeneratedDay:
      typeof rawLastGeneratedDay === 'number'
        ? Math.max(0, rawLastGeneratedDay)
        : 0,
  };
}

export function initializeWorldEventsState(
  state: Pick<
    StoreGameState,
    'worldEvents' | 'worldEventsVersion' | 'lastWorldEventGeneratedDay' | 'currentTime'
  >,
): Pick<StoreGameState, 'worldEvents' | 'worldEventsVersion' | 'lastWorldEventGeneratedDay'> {
  const currentDay = gameDayFromTime(state.currentTime);
  return normalizeWorldEventsState(
    state.worldEvents,
    currentDay,
    state.worldEventsVersion,
    state.lastWorldEventGeneratedDay,
  );
}

export function expireOldWorldEvents(
  events: WorldEvent[],
  currentDay: number,
  nowMs: number = getEconomyNow(),
): WorldEvent[] {
  return refreshActiveFlags(
    events.filter((event) => {
      if (typeof event.endsAt === 'number' && Number.isFinite(event.endsAt)) {
        return event.endsAt >= nowMs - MS_PER_24H;
      }
      return event.endsAtDay >= currentDay;
    }),
    currentDay,
    nowMs,
  );
}

function pickSeverity(random: () => number, template: WorldEventTemplate): WorldEventSeverity {
  if (template.severity === 'high') {
    return 'high';
  }
  const roll = random();
  if (template.severity === 'medium') {
    return roll < 0.12 ? 'high' : 'medium';
  }
  return roll < 0.08 ? 'medium' : 'low';
}

function canSpawnTemplate(
  template: WorldEventTemplate,
  activeEvents: WorldEvent[],
  cityId?: string,
  productId?: ProductId,
): boolean {
  const key = eventConflictKey({ type: template.type, cityId, productId });
  return !activeEvents.some(
    (event) => eventConflictKey(event) === key && event.isActive,
  );
}

function instantiateTemplate(
  template: WorldEventTemplate,
  currentDay: number,
  random: () => number,
  cityId?: string,
  productId?: ProductId,
  nowMs: number = getEconomyNow(),
): WorldEvent {
  const durationDays = Math.round(
    pickRange(random, template.durationDays as [number, number]),
  );
  const startsAtDay = currentDay;
  const endsAtDay = currentDay + durationDays - 1;
  const startsAt = nowMs;
  const endsAt = nowMs + durationDays * MS_PER_24H;
  const globalEpoch = getMarketEpoch(nowMs);
  const id = `we_${template.type}_${cityId ?? 'global'}_${productId ?? 'all'}_${globalEpoch}`;

  return {
    id,
    type: template.type,
    title: localizeTitle(template, cityId, productId),
    description: localizeDescription(template, cityId, productId),
    cityId,
    productId,
    startsAtDay,
    endsAtDay,
    durationDays,
    startsAt,
    endsAt,
    globalEpoch,
    economyConfigVersion: ECONOMY_CONFIG_VERSION,
    impact: buildImpact(template, random),
    severity: pickSeverity(random, template),
    isActive: true,
  };
}

function pickWeightedTemplate(
  templates: WorldEventTemplate[],
  random: () => number,
): WorldEventTemplate {
  const totalWeight = templates.reduce((sum, template) => sum + template.weight, 0);
  let roll = random() * totalWeight;
  for (const template of templates) {
    roll -= template.weight;
    if (roll <= 0) {
      return template;
    }
  }
  return templates[templates.length - 1];
}

function resolveTemplateTargets(
  template: WorldEventTemplate,
  random: () => number,
): Array<{ cityId?: string; productId?: ProductId }> {
  switch (template.scope) {
    case 'global':
      return [{}];
    case 'city': {
      const cities = template.cityIds ?? [];
      if (cities.length === 0) return [{}];
      const cityId = cities[Math.floor(random() * cities.length)];
      return [{ cityId }];
    }
    case 'product': {
      const products = template.productIds ?? [];
      if (products.length === 0) return [{}];
      const productId = products[Math.floor(random() * products.length)];
      return [{ productId }];
    }
    case 'city_product': {
      const cities = template.cityIds ?? [];
      const products = template.productIds ?? [];
      if (cities.length === 0 || products.length === 0) return [{}];
      const cityId = cities[Math.floor(random() * cities.length)];
      const productId = products[Math.floor(random() * products.length)];
      return [{ cityId, productId }];
    }
    default:
      return [{}];
  }
}

export interface GenerateWorldEventsInput {
  worldEvents: WorldEvent[];
  currentDay: number;
  seedKey: string;
}

export function generateWorldEventsForDay(input: GenerateWorldEventsInput): WorldEvent[] {
  const { currentDay, seedKey } = input;
  const nowMs = getEconomyNow();
  let events = expireOldWorldEvents(input.worldEvents, currentDay, nowMs);
  const activeCount = events.filter((event) => event.isActive).length;
  if (activeCount >= MAX_ACTIVE_WORLD_EVENTS) {
    return events;
  }

  // Ortak seed — şirket adından bağımsız global epoch
  const random = createSeededRandom(
    hashSeed(`global-market:${seedKey}:${currentDay}:spawn`),
  );
  const newEventTarget = Math.floor(random() * (MAX_NEW_EVENTS_PER_DAY + 1));
  if (newEventTarget <= 0) {
    return events;
  }

  let created = 0;
  let attempts = 0;

  while (
    created < newEventTarget &&
    events.filter((event) => event.isActive).length < MAX_ACTIVE_WORLD_EVENTS &&
    attempts < 12
  ) {
    attempts += 1;
    const template = pickWeightedTemplate(WORLD_EVENT_TEMPLATES, random);
    const targets = resolveTemplateTargets(template, random);
    const target = targets[0];

    if (!canSpawnTemplate(template, events, target.cityId, target.productId)) {
      continue;
    }

    events = [
      ...events,
      instantiateTemplate(
        template,
        currentDay,
        random,
        target.cityId,
        target.productId,
        nowMs,
      ),
    ];
    created += 1;
  }

  return refreshActiveFlags(events, currentDay, nowMs);
}

export function processWorldEventsForDayRange(input: {
  worldEvents: WorldEvent[];
  fromDay: number;
  toDay: number;
  seedKey: string;
}): { worldEvents: WorldEvent[]; lastWorldEventGeneratedDay: number } {
  let events = input.worldEvents;
  const startDay = Math.max(1, input.fromDay);
  const endDay = Math.max(startDay, input.toDay);

  for (let day = startDay; day <= endDay; day += 1) {
    events = generateWorldEventsForDay({
      worldEvents: events,
      currentDay: day,
      seedKey: input.seedKey,
    });
  }

  return {
    worldEvents: refreshActiveFlags(events, endDay),
    lastWorldEventGeneratedDay: endDay,
  };
}

export function getActiveWorldEvents(events: WorldEvent[], currentDay: number): WorldEvent[] {
  return refreshActiveFlags(events, currentDay).filter((event) => event.isActive);
}

export function getGlobalEvents(events: WorldEvent[], currentDay: number): WorldEvent[] {
  return getActiveWorldEvents(events, currentDay).filter(
    (event) => !event.cityId && !event.productId,
  );
}

export function getEventsForCity(
  events: WorldEvent[],
  cityId: string,
  currentDay: number,
): WorldEvent[] {
  return getActiveWorldEvents(events, currentDay).filter(
    (event) => !event.cityId || event.cityId === cityId,
  );
}

export function getEventsForProduct(
  events: WorldEvent[],
  productId: ProductId,
  currentDay: number,
  cityId?: string,
): WorldEvent[] {
  return getActiveWorldEvents(events, currentDay).filter((event) => {
    const productMatch = !event.productId || event.productId === productId;
    const cityMatch = !event.cityId || !cityId || event.cityId === cityId;
    return productMatch && cityMatch;
  });
}

export function applyWorldEventImpactToFuelPrice(
  baseFuelPrice: number,
  activeEvents: WorldEvent[],
): number {
  const multiplier = clampMultiplier(
    multiplyImpactValues(activeEvents, 'fuelPriceMultiplier'),
    IMPACT_CLAMP.fuelPrice.min,
    IMPACT_CLAMP.fuelPrice.max,
  );
  return Number(Math.max(0.5, baseFuelPrice * multiplier).toFixed(2));
}

export function applyWorldEventImpactToProductPrice(
  basePrice: number,
  productId: ProductId,
  cityId: string,
  activeEvents: WorldEvent[],
  currentDay: number,
): number {
  const relevant = getEventsForProduct(activeEvents, productId, currentDay, cityId).filter(
    (event) => event.impact.productPriceMultiplier,
  );
  const multiplier = clampMultiplier(
    multiplyImpactValues(relevant, 'productPriceMultiplier'),
    IMPACT_CLAMP.productPrice.min,
    IMPACT_CLAMP.productPrice.max,
  );
  return Number(Math.max(1, basePrice * multiplier).toFixed(2));
}

export function getProductPriceEventMultiplier(
  productId: ProductId,
  cityId: string,
  activeEvents: WorldEvent[],
  currentDay: number,
): number {
  const relevant = getEventsForProduct(activeEvents, productId, currentDay, cityId).filter(
    (event) => event.impact.productPriceMultiplier,
  );
  return clampMultiplier(
    multiplyImpactValues(relevant, 'productPriceMultiplier'),
    IMPACT_CLAMP.productPrice.min,
    IMPACT_CLAMP.productPrice.max,
  );
}

function eventMatchesContractSpawnScope(
  event: WorldEvent,
  originCityId: string,
  destinationCityId: string,
  productId: ProductId,
): boolean {
  if (event.cityId) {
    const cityOk =
      event.cityId === originCityId || event.cityId === destinationCityId;
    if (!cityOk) {
      return false;
    }
  }
  if (event.productId && event.productId !== productId) {
    return false;
  }
  return Boolean(event.cityId || event.productId);
}

/**
 * Sözleşme aday skoru için spawn ağırlığı — aktif olay yoksa 1 döner.
 */
export function getContractSpawnWeightMultiplier(
  originCityId: string,
  destinationCityId: string,
  productId: ProductId,
  activeEvents: WorldEvent[],
): number {
  if (!activeEvents.length) {
    return 1;
  }

  let multiplier = 1;
  for (const event of activeEvents) {
    const spawnMult = event.impact.contractSpawnWeightMultiplier;
    if (!spawnMult || spawnMult <= 1) {
      continue;
    }
    if (!eventMatchesContractSpawnScope(event, originCityId, destinationCityId, productId)) {
      continue;
    }
    multiplier *= spawnMult;
  }

  return clampMultiplier(
    multiplier,
    IMPACT_CLAMP.contractSpawnWeight.min,
    IMPACT_CLAMP.contractSpawnWeight.max,
  );
}

export interface ContractWorldEventAdjustment {
  paymentMultiplier: number;
  durationMultiplier: number;
  maintenanceMultiplier: number;
  labels: string[];
  paymentBonus: number;
  durationBonusHours: number;
}

function getContractRelevantEvents(contract: Contract, activeEvents: WorldEvent[]): WorldEvent[] {
  return activeEvents.filter((event) => {
    const cityMatch =
      !event.cityId ||
      event.cityId === contract.originCityId ||
      event.cityId === contract.destinationCityId;
    const productMatch = !event.productId || event.productId === contract.productId;
    return cityMatch && productMatch;
  });
}

export function applyWorldEventImpactToContract(
  contract: Contract,
  activeEvents: WorldEvent[],
  basePayment: number,
  baseTravelHours: number,
): ContractWorldEventAdjustment {
  const relevant = getContractRelevantEvents(contract, activeEvents);
  const paymentMultiplier = clampMultiplier(
    multiplyImpactValues(relevant, 'contractPaymentMultiplier'),
    IMPACT_CLAMP.contractPayment.min,
    IMPACT_CLAMP.contractPayment.max,
  );
  const durationMultiplier = clampMultiplier(
    multiplyImpactValues(relevant, 'deliveryDurationMultiplier'),
    IMPACT_CLAMP.deliveryDuration.min,
    IMPACT_CLAMP.deliveryDuration.max,
  );
  const maintenanceMultiplier = clampMultiplier(
    multiplyImpactValues(
      activeEvents.filter((event) => event.impact.maintenanceCostMultiplier),
      'maintenanceCostMultiplier',
    ),
    IMPACT_CLAMP.maintenanceCost.min,
    IMPACT_CLAMP.maintenanceCost.max,
  );

  const adjustedPayment = basePayment * paymentMultiplier;
  const adjustedHours = baseTravelHours * durationMultiplier;

  const labels = relevant
    .filter(
      (event) =>
        event.impact.contractPaymentMultiplier ||
        event.impact.deliveryDurationMultiplier ||
        event.impact.maintenanceCostMultiplier,
    )
    .map(
      (event) =>
        WORLD_EVENT_TEMPLATES.find((t) => t.type === event.type)?.uiLabel ?? event.title,
    );

  return {
    paymentMultiplier,
    durationMultiplier,
    maintenanceMultiplier,
    labels: [...new Set(labels)],
    paymentBonus: adjustedPayment - basePayment,
    durationBonusHours: adjustedHours - baseTravelHours,
  };
}

export function formatWorldEventImpactPercent(multiplier: number): string {
  const delta = (multiplier - 1) * 100;
  if (Math.abs(delta) < 0.5) {
    return 'Etkisiz';
  }
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(0)}%`;
}

export function getPrimaryWorldEventLabel(event: WorldEvent): string {
  return WORLD_EVENT_TEMPLATES.find((t) => t.type === event.type)?.uiLabel ?? 'Olay Etkisi';
}

export function getWorldEventSummary(activeEvents: WorldEvent[]): {
  activeCount: number;
  headline: string;
  topEvents: WorldEvent[];
  isCalm: boolean;
} {
  const activeCount = activeEvents.length;
  if (activeCount === 0) {
    return {
      activeCount: 0,
      headline: 'Piyasa sakin',
      topEvents: [],
      isCalm: true,
    };
  }

  const severityScore = (event: WorldEvent) => {
    if (event.severity === 'high') return 0;
    if (event.severity === 'medium') return 1;
    return 2;
  };

  const topEvents = [...activeEvents]
    .sort((a, b) => severityScore(a) - severityScore(b))
    .slice(0, 2);

  return {
    activeCount,
    headline: `${activeCount} aktif olay`,
    topEvents,
    isCalm: false,
  };
}

export function forceCreateWorldEvent(
  type: WorldEventType,
  currentDay: number,
  cityId?: string,
  productId?: ProductId,
): WorldEvent | null {
  const template = WORLD_EVENT_TEMPLATES.find((item) => item.type === type);
  if (!template) {
    return null;
  }
  const random = createSeededRandom(hashSeed(`${type}:${currentDay}:debug`));
  const targets =
    cityId || productId ? [{ cityId, productId }] : resolveTemplateTargets(template, random);
  const target = targets[0];
  return instantiateTemplate(template, currentDay, random, target.cityId, target.productId);
}
