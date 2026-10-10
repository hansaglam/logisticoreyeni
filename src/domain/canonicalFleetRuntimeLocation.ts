/**
 * Canonical ROAD fleet runtime location (Map V2 Step 29AC).
 *
 * Production truck status and city rules from src/simulation/delivery.ts.
 * Home city is not a score weight. It is only a fallback when currentCityId is missing.
 * This module does not read saves. Pure. No React. No Firebase.
 */

import { contractGenerationBalance } from '../config/balance';
import { CITIES_BY_ID } from '../data/cities';
import { DEFAULT_TRUCK_CITY_ID } from '../simulation/delivery';

export const CANONICAL_FLEET_RUNTIME_LOCATION_STATUS =
  'CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY_PASS_INTERNAL_ONLY' as const;

export const CANONICAL_FLEET_RUNTIME_AUTHORITY_ENV =
  'CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY' as const;

export const CANONICAL_FLEET_RUNTIME_POLICY_VERSION =
  'canonical-fleet-runtime-location-internal-v1' as const;

export const CANONICAL_FLEET_RUNTIME_COLLECTION = 'canonicalFleetRuntime' as const;

/** Production buyTruck / starter fallback when home city is absent. Not a trusted home city. */
export const INTERNAL_FIXTURE_RUNTIME_CITY_ID = DEFAULT_TRUCK_CITY_ID;

export const FLEET_RUNTIME_INITIAL_LOCATION =
  'FLEET_RUNTIME_INITIAL_LOCATION_BLOCKED_HOME_CITY_AUTHORITY' as const;

export const FLEET_RUNTIME_TRANSFER =
  'FLEET_RUNTIME_TRANSFER_CLIENT_OWNED' as const;

export const FLEET_RUNTIME_RECOVERY =
  'VEHICLE_RECOVERY_BLOCKED_CLIENT_EXECUTION_STATE' as const;

export const CONTRACT_HOME_CITY_WEIGHT_AUTHORITY =
  'CONTRACT_HOME_CITY_WEIGHT_NOT_A_SEPARATE_SCORE' as const;

export type CanonicalFleetRuntimeStatus =
  | 'idle'
  | 'on_route'
  | 'out_of_fuel'
  | 'transferring'
  | 'maintenance'
  | 'marketplace_locked';

export type CanonicalFleetRuntimeAuthorityClass =
  | 'INTERNAL_TEST_RUNTIME_FIXTURE'
  | 'SERVER_CANONICAL_RUNTIME'
  | 'RUNTIME_UNINITIALIZED'
  | 'LEGACY_CLIENT_UNVERIFIED';

export type CanonicalFleetRuntimeState = {
  assetId: string;
  ownerUid: string;
  currentCityId: string | null;
  runtimeStatus: CanonicalFleetRuntimeStatus;
  activeCanonicalRoadDeliveryId: string | null;
  routeOriginCityId: string | null;
  routeDestinationCityId: string | null;
  runtimeRevision: number;
  lastTransitionAtServerMs: number;
  runtimePolicyVersion: typeof CANONICAL_FLEET_RUNTIME_POLICY_VERSION;
  authorityClass: CanonicalFleetRuntimeAuthorityClass;
  failureLocationClass: 'NONE' | 'CLIENT_REPORTED_UNVERIFIED' | null;
};

export type CanonicalFleetRuntimeAssetInput = {
  assetId: string;
  capacity: number;
  lifecycleStatus?: string;
  assetType?: string;
  runtime: CanonicalFleetRuntimeState | null;
};

export type CanonicalFleetAvailabilitySummary = {
  policyVersion: typeof CANONICAL_FLEET_RUNTIME_POLICY_VERSION;
  idleOriginCities: string[];
  busyOriginCities: string[];
  activeDestinationCities: string[];
  idleTruckCount: number;
  activeTruckCount: number;
  unavailableTruckCount: number;
  idleMaxCapacityTons: number;
  ownedMaxCapacityTons: number;
  summaryHash: string;
};

export type CanonicalFleetRuntimeGate = 'OFF' | 'INTERNAL_TEST';

const PRODUCTION_STATUSES: readonly CanonicalFleetRuntimeStatus[] = [
  'idle',
  'on_route',
  'out_of_fuel',
  'transferring',
  'maintenance',
  'marketplace_locked',
];

export function resolveCanonicalFleetRuntimeGate(options?: {
  envValue?: string | null;
}): CanonicalFleetRuntimeGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_FLEET_RUNTIME_LOCATION_AUTHORITY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalFleetRuntimeAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalFleetRuntimeGate(options) === 'INTERNAL_TEST';
}

export function isCanonicalRoadCityId(cityId: string): boolean {
  return typeof cityId === 'string' && cityId in CITIES_BY_ID;
}

export function createInternalFixtureRuntime(input: {
  assetId: string;
  ownerUid: string;
  serverNowMs: number;
}): CanonicalFleetRuntimeState {
  return {
    assetId: input.assetId,
    ownerUid: input.ownerUid,
    currentCityId: INTERNAL_FIXTURE_RUNTIME_CITY_ID,
    runtimeStatus: 'idle',
    activeCanonicalRoadDeliveryId: null,
    routeOriginCityId: null,
    routeDestinationCityId: null,
    runtimeRevision: 1,
    lastTransitionAtServerMs: input.serverNowMs,
    runtimePolicyVersion: CANONICAL_FLEET_RUNTIME_POLICY_VERSION,
    authorityClass: 'INTERNAL_TEST_RUNTIME_FIXTURE',
    failureLocationClass: 'NONE',
  };
}

export function validateCanonicalFleetRuntimeState(
  raw: unknown,
): { ok: true; state: CanonicalFleetRuntimeState } | { ok: false; reason: 'FLEET_RUNTIME_STATE_INVALID' } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'FLEET_RUNTIME_STATE_INVALID' };
  const record = raw as Partial<CanonicalFleetRuntimeState>;
  if (record.runtimePolicyVersion !== CANONICAL_FLEET_RUNTIME_POLICY_VERSION) {
    return { ok: false, reason: 'FLEET_RUNTIME_STATE_INVALID' };
  }
  if (typeof record.assetId !== 'string' || typeof record.ownerUid !== 'string') {
    return { ok: false, reason: 'FLEET_RUNTIME_STATE_INVALID' };
  }
  if (!PRODUCTION_STATUSES.includes(record.runtimeStatus as CanonicalFleetRuntimeStatus)) {
    return { ok: false, reason: 'FLEET_RUNTIME_STATE_INVALID' };
  }
  if (typeof record.runtimeRevision !== 'number' || record.runtimeRevision < 1) {
    return { ok: false, reason: 'FLEET_RUNTIME_STATE_INVALID' };
  }
  if (record.currentCityId != null && !isCanonicalRoadCityId(record.currentCityId)) {
    return { ok: false, reason: 'FLEET_RUNTIME_STATE_INVALID' };
  }
  if (
    record.authorityClass !== 'INTERNAL_TEST_RUNTIME_FIXTURE' &&
    record.authorityClass !== 'SERVER_CANONICAL_RUNTIME' &&
    record.authorityClass !== 'RUNTIME_UNINITIALIZED' &&
    record.authorityClass !== 'LEGACY_CLIENT_UNVERIFIED'
  ) {
    return { ok: false, reason: 'FLEET_RUNTIME_STATE_INVALID' };
  }
  return { ok: true, state: record as CanonicalFleetRuntimeState };
}

function nextRevision(state: CanonicalFleetRuntimeState, serverNowMs: number): Pick<
  CanonicalFleetRuntimeState,
  'runtimeRevision' | 'lastTransitionAtServerMs' | 'authorityClass'
> {
  return {
    runtimeRevision: state.runtimeRevision + 1,
    lastTransitionAtServerMs: serverNowMs,
    authorityClass:
      state.authorityClass === 'INTERNAL_TEST_RUNTIME_FIXTURE'
        ? 'INTERNAL_TEST_RUNTIME_FIXTURE'
        : 'SERVER_CANONICAL_RUNTIME',
  };
}

export function planCanonicalFleetRuntimeTransition(
  state: CanonicalFleetRuntimeState,
  operation:
    | { kind: 'START'; deliveryId: string; originCityId: string; destinationCityId: string }
    | { kind: 'COMPLETE' }
    | { kind: 'CANCEL' }
    | { kind: 'FAIL_SERVER' }
    | { kind: 'FAIL_CLIENT_UNVERIFIED' }
    | { kind: 'FUEL_OUT' }
    | { kind: 'ROADSIDE_REFUEL_RESUME' },
  serverNowMs: number,
): { ok: true; state: CanonicalFleetRuntimeState } | { ok: false; reason: string } {
  const validated = validateCanonicalFleetRuntimeState(state);
  if (!validated.ok) return validated;
  const current = validated.state;
  if (current.authorityClass === 'RUNTIME_UNINITIALIZED' || current.authorityClass === 'LEGACY_CLIENT_UNVERIFIED') {
    return { ok: false, reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE' };
  }
  if (operation.kind === 'START') {
    if (!isCanonicalRoadCityId(operation.originCityId) || !isCanonicalRoadCityId(operation.destinationCityId)) {
      return { ok: false, reason: 'FLEET_RUNTIME_STATE_INVALID' };
    }
    if (current.runtimeStatus !== 'idle' || current.activeCanonicalRoadDeliveryId) {
      return { ok: false, reason: 'TRUCK_NOT_IDLE' };
    }
    if (current.currentCityId !== operation.originCityId) {
      return { ok: false, reason: 'TRUCK_NOT_AT_ORIGIN' };
    }
    return {
      ok: true,
      state: {
        ...current,
        ...nextRevision(current, serverNowMs),
        runtimeStatus: 'on_route',
        currentCityId: current.currentCityId,
        activeCanonicalRoadDeliveryId: operation.deliveryId,
        routeOriginCityId: operation.originCityId,
        routeDestinationCityId: operation.destinationCityId,
        failureLocationClass: 'NONE',
      },
    };
  }
  if (operation.kind === 'COMPLETE') {
    if (current.runtimeStatus !== 'on_route' || !current.routeDestinationCityId) {
      return { ok: false, reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE' };
    }
    return {
      ok: true,
      state: {
        ...current,
        ...nextRevision(current, serverNowMs),
        runtimeStatus: 'idle',
        currentCityId: current.routeDestinationCityId,
        activeCanonicalRoadDeliveryId: null,
        routeOriginCityId: null,
        routeDestinationCityId: null,
        failureLocationClass: 'NONE',
      },
    };
  }
  if (operation.kind === 'CANCEL' || operation.kind === 'FAIL_SERVER') {
    if (!current.routeOriginCityId) {
      return { ok: false, reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE' };
    }
    return {
      ok: true,
      state: {
        ...current,
        ...nextRevision(current, serverNowMs),
        runtimeStatus: 'idle',
        currentCityId: current.routeOriginCityId,
        activeCanonicalRoadDeliveryId: null,
        routeOriginCityId: null,
        routeDestinationCityId: null,
        failureLocationClass: 'NONE',
      },
    };
  }
  if (operation.kind === 'FAIL_CLIENT_UNVERIFIED') {
    return {
      ok: true,
      state: {
        ...current,
        ...nextRevision(current, serverNowMs),
        failureLocationClass: 'CLIENT_REPORTED_UNVERIFIED',
      },
    };
  }
  if (operation.kind === 'FUEL_OUT') {
    if (current.runtimeStatus !== 'on_route') {
      return { ok: false, reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE' };
    }
    return {
      ok: true,
      state: {
        ...current,
        ...nextRevision(current, serverNowMs),
        runtimeStatus: 'out_of_fuel',
      },
    };
  }
  return {
    ok: true,
    state: {
      ...current,
      ...nextRevision(current, serverNowMs),
      runtimeStatus: current.runtimeStatus === 'out_of_fuel' ? 'on_route' : current.runtimeStatus,
    },
  };
}

function isIdleForScoring(asset: CanonicalFleetRuntimeAssetInput): boolean {
  if (asset.assetType && asset.assetType !== 'TRUCK') return false;
  if (asset.lifecycleStatus === 'SOLD') return false;
  const runtime = asset.runtime;
  if (!runtime || runtime.authorityClass === 'RUNTIME_UNINITIALIZED') return false;
  if (runtime.authorityClass === 'LEGACY_CLIENT_UNVERIFIED') return false;
  if (runtime.failureLocationClass === 'CLIENT_REPORTED_UNVERIFIED') return false;
  return runtime.runtimeStatus === 'idle' && !runtime.activeCanonicalRoadDeliveryId && !!runtime.currentCityId;
}

export function deriveCanonicalFleetAvailabilitySummary(
  assets: readonly CanonicalFleetRuntimeAssetInput[],
): { ok: true; summary: CanonicalFleetAvailabilitySummary } | { ok: false; reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE' | 'FLEET_RUNTIME_STATE_INVALID' } {
  const trucks = [...assets]
    .filter((asset) => !asset.assetType || asset.assetType === 'TRUCK')
    .filter((asset) => asset.lifecycleStatus !== 'SOLD')
    .sort((a, b) => a.assetId.localeCompare(b.assetId));
  if (trucks.some((asset) => !asset.runtime)) {
    return { ok: false, reason: 'FLEET_RUNTIME_LOCATION_UNAVAILABLE' };
  }
  for (const asset of trucks) {
    const parsed = validateCanonicalFleetRuntimeState(asset.runtime);
    if (!parsed.ok) return parsed;
  }
  const idleCities = new Set<string>();
  const busyCities = new Set<string>();
  const destinations = new Set<string>();
  let idleTruckCount = 0;
  let activeTruckCount = 0;
  let unavailableTruckCount = 0;
  let idleMax = 0;
  let ownedMax = 0;
  for (const asset of trucks) {
    const runtime = asset.runtime!;
    if (Number.isFinite(asset.capacity) && asset.capacity > ownedMax) ownedMax = asset.capacity;
    if (isIdleForScoring(asset) && runtime.currentCityId) {
      idleTruckCount += 1;
      idleCities.add(runtime.currentCityId);
      if (asset.capacity > idleMax) idleMax = asset.capacity;
      continue;
    }
    unavailableTruckCount += 1;
    if (
      runtime.runtimeStatus === 'on_route' ||
      runtime.runtimeStatus === 'out_of_fuel' ||
      runtime.runtimeStatus === 'transferring'
    ) {
      activeTruckCount += 1;
    }
    if (runtime.currentCityId && runtime.runtimeStatus !== 'idle') {
      busyCities.add(runtime.currentCityId);
    }
    if (
      runtime.routeDestinationCityId &&
      (runtime.runtimeStatus === 'on_route' || runtime.runtimeStatus === 'out_of_fuel')
    ) {
      destinations.add(runtime.routeDestinationCityId);
    }
  }
  const idleOriginCities = [...idleCities].sort();
  const busyOriginCities = [...busyCities].sort();
  const activeDestinationCities = [...destinations].sort();
  const summaryHash = [
    idleOriginCities.join(','),
    busyOriginCities.join(','),
    activeDestinationCities.join(','),
    String(idleMax),
    String(ownedMax),
  ].join('|');
  return {
    ok: true,
    summary: {
      policyVersion: CANONICAL_FLEET_RUNTIME_POLICY_VERSION,
      idleOriginCities,
      busyOriginCities,
      activeDestinationCities,
      idleTruckCount,
      activeTruckCount,
      unavailableTruckCount,
      idleMaxCapacityTons: idleMax,
      ownedMaxCapacityTons: ownedMax,
      summaryHash,
    },
  };
}

/** Same max-bonus order as getOriginCityWeightBonus in contracts.ts. */
export function productionOriginCityWeight(
  originCityId: string,
  context: {
    idleTruckOriginCityIds: readonly string[];
    busyTruckOriginCityIds: readonly string[];
    activeDeliveryDestinationCityIds: readonly string[];
    marketOpportunityOriginCityIds: readonly string[];
  },
): number {
  const weights = contractGenerationBalance.originCityWeights;
  let bonus: number = weights.otherCity;
  if (context.marketOpportunityOriginCityIds.includes(originCityId)) {
    bonus = Math.max(bonus, weights.marketOpportunityCity);
  }
  if (context.busyTruckOriginCityIds.includes(originCityId)) {
    bonus = Math.max(bonus, weights.busyTruckCity);
  }
  if (context.activeDeliveryDestinationCityIds.includes(originCityId)) {
    bonus = Math.max(bonus, weights.activeDeliveryDestinationCity);
  }
  if (context.idleTruckOriginCityIds.includes(originCityId)) {
    bonus = Math.max(bonus, weights.idleTruckCity);
  }
  return bonus;
}
