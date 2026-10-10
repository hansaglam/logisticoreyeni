import { DEFAULT_TRUCK_CITY_ID, resolveTruckCityId } from '../../simulation/delivery';
import type { Delivery, Truck, Warehouse } from '../../types/game';
import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../domain/ids';
import { isActiveDeliveryStatus } from './cityOperation';

export const MAP_V2_CITY_PROGRESSION_MODES = [
  'LEGACY_ALL_UNLOCKED',
  'MAP_V2_PROGRESSION_PREVIEW',
  'MAP_V2_PROGRESSION_ACTIVE',
] as const;

export type MapV2CityProgressionMode = (typeof MAP_V2_CITY_PROGRESSION_MODES)[number];

/** Live / existing-save default. Never silently lock Türkiye cities. */
export const MAP_V2_CITY_PROGRESSION_DEFAULT_MODE: MapV2CityProgressionMode = 'LEGACY_ALL_UNLOCKED';

export const CITY_AVAILABILITY_STATES = ['STARTER', 'UNLOCKED', 'LOCKED', 'NOT_AVAILABLE'] as const;
export type CityAvailabilityState = (typeof CITY_AVAILABILITY_STATES)[number];

export type CityUnlockRequirement =
  | { type: 'PLAYER_LEVEL'; level: number }
  | { type: 'REPUTATION'; value: number }
  | { type: 'CASH'; amount: number }
  | { type: 'WAREHOUSE_IN_CITY'; cityId: string }
  | { type: 'CITY_UNLOCKED'; cityId: string };

export type CityUnlockPolicy = {
  cityId: string;
  /** Fixture intent. ACTIVE mode re-derives from requirements. */
  availability: CityAvailabilityState;
  requirements: readonly CityUnlockRequirement[];
  displayPriority: number;
  /** Preview numbers are not live balancing. */
  provisionalDevOnly?: boolean;
};

export type PlayerProgressionSnapshot = {
  homeCityId: string | null | undefined;
  level: number;
  reputation: number;
  money: number;
  warehouseCityIds: readonly string[];
  truckCityIds?: readonly string[];
  deliveryCityIds?: readonly string[];
};

export type RequirementRow = {
  type: CityUnlockRequirement['type'];
  met: boolean;
  required: number | string;
  current: number | string;
};

export type CityProgressionState = {
  cityId: string;
  availability: CityAvailabilityState;
  requirements: readonly CityUnlockRequirement[];
  rows: RequirementRow[];
  allRequirementsMet: boolean;
  canOpenDetail: boolean;
};

export type CountryProgressionViewModel = {
  mode: MapV2CityProgressionMode;
  totalCities: number;
  unlockedCities: number;
  lockedCities: number;
  progressRatio: number;
  nextRecommendedCityId: string | null;
  starterCityId: string;
};

export function isCityAvailabilityOpen(availability: CityAvailabilityState): boolean {
  return availability === 'STARTER' || availability === 'UNLOCKED';
}

/** Existing project fallback for missing home city is İzmir (`DEFAULT_TRUCK_CITY_ID`). */
export function resolveStarterGameplayCityId(homeCityId: string | null | undefined): string {
  if (homeCityId && (LEGACY_STABLE_GAMEPLAY_CITY_IDS as readonly string[]).includes(homeCityId)) {
    return homeCityId;
  }
  return DEFAULT_TRUCK_CITY_ID;
}

export function evaluateRequirement(
  requirement: CityUnlockRequirement,
  snapshot: PlayerProgressionSnapshot,
  openCityIds: ReadonlySet<string>,
): boolean {
  if (requirement.type === 'PLAYER_LEVEL') return snapshot.level >= requirement.level;
  if (requirement.type === 'REPUTATION') return snapshot.reputation >= requirement.value;
  if (requirement.type === 'CASH') return snapshot.money >= requirement.amount;
  if (requirement.type === 'WAREHOUSE_IN_CITY') return snapshot.warehouseCityIds.includes(requirement.cityId);
  if (requirement.type === 'CITY_UNLOCKED') return openCityIds.has(requirement.cityId);
  return false;
}

export function requirementRow(
  requirement: CityUnlockRequirement,
  snapshot: PlayerProgressionSnapshot,
  openCityIds: ReadonlySet<string>,
): RequirementRow {
  const met = evaluateRequirement(requirement, snapshot, openCityIds);
  if (requirement.type === 'PLAYER_LEVEL') {
    return { type: requirement.type, met, required: requirement.level, current: snapshot.level };
  }
  if (requirement.type === 'REPUTATION') {
    return { type: requirement.type, met, required: requirement.value, current: Math.round(snapshot.reputation) };
  }
  if (requirement.type === 'CASH') {
    return { type: requirement.type, met, required: requirement.amount, current: Math.round(snapshot.money) };
  }
  if (requirement.type === 'WAREHOUSE_IN_CITY') {
    return { type: requirement.type, met, required: requirement.cityId, current: met ? 'owned' : 'missing' };
  }
  return { type: requirement.type, met, required: requirement.cityId, current: met ? 'open' : 'locked' };
}

export function buildPlayerProgressionSnapshot(input: {
  homeCityId: string | null | undefined;
  level: number | null | undefined;
  reputation: number | null | undefined;
  money: number | null | undefined;
  warehouses: readonly Warehouse[] | null | undefined;
  trucks: readonly Truck[] | null | undefined;
  deliveries: readonly Delivery[] | null | undefined;
}): PlayerProgressionSnapshot {
  const warehouseCityIds = [...new Set((input.warehouses ?? []).map((row) => row.cityId).filter(Boolean))];
  const truckCityIds = [
    ...new Set(
      (input.trucks ?? [])
        .filter((truck) => truck && truck.status !== 'marketplace_locked')
        .map((truck) => resolveTruckCityId(truck, input.homeCityId ?? undefined))
        .filter(Boolean),
    ),
  ];
  const deliveryCityIds = [
    ...new Set(
      (input.deliveries ?? []).flatMap((delivery) => {
        if (!delivery || !isActiveDeliveryStatus(delivery.status)) return [];
        return [delivery.originCityId, delivery.destinationCityId].filter(Boolean);
      }),
    ),
  ];
  return {
    homeCityId: input.homeCityId,
    level: input.level ?? 1,
    reputation: input.reputation ?? 0,
    money: input.money ?? 0,
    warehouseCityIds,
    truckCityIds,
    deliveryCityIds,
  };
}

function cityHasPlayerAssets(cityId: string, snapshot: PlayerProgressionSnapshot): boolean {
  if (snapshot.warehouseCityIds.includes(cityId)) return true;
  if (snapshot.truckCityIds?.includes(cityId)) return true;
  if (snapshot.deliveryCityIds?.includes(cityId)) return true;
  return false;
}

export function resolveCityAvailabilityForMode(
  mode: MapV2CityProgressionMode,
  policy: CityUnlockPolicy,
  starterCityId: string,
  allRequirementsMet: boolean,
  snapshot: PlayerProgressionSnapshot,
): CityAvailabilityState {
  if (!(LEGACY_STABLE_GAMEPLAY_CITY_IDS as readonly string[]).includes(policy.cityId)) {
    return 'NOT_AVAILABLE';
  }
  if (policy.cityId === starterCityId) return 'STARTER';
  if (mode === 'LEGACY_ALL_UNLOCKED') return 'UNLOCKED';
  if (mode === 'MAP_V2_PROGRESSION_PREVIEW') {
    return policy.availability === 'STARTER' ? 'UNLOCKED' : policy.availability;
  }
  if (allRequirementsMet) return 'UNLOCKED';
  if (cityHasPlayerAssets(policy.cityId, snapshot)) return 'UNLOCKED';
  return 'LOCKED';
}

export function evaluateCityProgression(input: {
  mode: MapV2CityProgressionMode;
  snapshot: PlayerProgressionSnapshot;
  policies: readonly CityUnlockPolicy[];
}): { byCityId: Record<string, CityProgressionState>; country: CountryProgressionViewModel } {
  const starterCityId = resolveStarterGameplayCityId(input.snapshot.homeCityId);
  const ordered = [...input.policies].sort((a, b) => a.displayPriority - b.displayPriority);
  const byCityId: Record<string, CityProgressionState> = {};
  const openIds = new Set<string>();

  for (const policy of ordered) {
    const rows = policy.requirements.map((requirement) => requirementRow(requirement, input.snapshot, openIds));
    const allRequirementsMet = policy.requirements.length === 0 || rows.every((row) => row.met);
    let availability = resolveCityAvailabilityForMode(
      input.mode,
      policy,
      starterCityId,
      allRequirementsMet,
      input.snapshot,
    );
    if (policy.cityId === starterCityId) availability = 'STARTER';
    if (isCityAvailabilityOpen(availability)) openIds.add(policy.cityId);
    byCityId[policy.cityId] = {
      cityId: policy.cityId,
      availability,
      requirements: policy.requirements,
      rows,
      allRequirementsMet,
      canOpenDetail: isCityAvailabilityOpen(availability),
    };
  }

  for (const cityId of LEGACY_STABLE_GAMEPLAY_CITY_IDS) {
    if (byCityId[cityId]) continue;
    const availability: CityAvailabilityState =
      input.mode === 'LEGACY_ALL_UNLOCKED'
        ? cityId === starterCityId
          ? 'STARTER'
          : 'UNLOCKED'
        : 'LOCKED';
    byCityId[cityId] = {
      cityId,
      availability,
      requirements: [],
      rows: [],
      allRequirementsMet: true,
      canOpenDetail: isCityAvailabilityOpen(availability),
    };
    if (isCityAvailabilityOpen(availability)) openIds.add(cityId);
  }

  const states = LEGACY_STABLE_GAMEPLAY_CITY_IDS.map((cityId) => byCityId[cityId]);
  const unlockedCities = states.filter((row) => isCityAvailabilityOpen(row.availability)).length;
  const lockedCities = states.filter((row) => row.availability === 'LOCKED').length;
  const next = ordered.find((policy) => byCityId[policy.cityId]?.availability === 'LOCKED');

  return {
    byCityId,
    country: {
      mode: input.mode,
      totalCities: LEGACY_STABLE_GAMEPLAY_CITY_IDS.length,
      unlockedCities,
      lockedCities,
      progressRatio: unlockedCities / LEGACY_STABLE_GAMEPLAY_CITY_IDS.length,
      nextRecommendedCityId: next?.cityId ?? null,
      starterCityId,
    },
  };
}

export function canOpenCityOperations(
  geoCityId: string | null | undefined,
  mappedGeoCityIds: ReadonlySet<string>,
  availability: CityAvailabilityState | undefined,
): boolean {
  return Boolean(geoCityId && mappedGeoCityIds.has(geoCityId) && availability && isCityAvailabilityOpen(availability));
}
