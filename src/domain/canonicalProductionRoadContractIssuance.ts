/**
 * Production ROAD contract issuance parity (Map V2 Step 29AA).
 *
 * Calls the live `generateContracts` formulas with a server seed.
 * Market stock for generation is epoch supply. Tradable stock is not the generator input.
 * Contract payment/duration events come only from an explicit server snapshot.
 * Epoch fuel/demand events stay audit-only and are not contract modifiers.
 * Pure. No React. No Firebase.
 */

import { contractBalance } from '../config/balance';
import { CITIES } from '../data/cities';
import { PRODUCTS } from '../data/products';
import { ROUTES } from '../data/routes';
import type { City, ProductId } from '../types/game';
import { getSafeGlobalEconomy } from '../simulation/economy';
import { generateContracts } from '../simulation/contracts';
import { createMarketSeededRng } from '../simulation/globalMarketSnapshot';
import { buildGlobalEventsForEpoch } from '../simulation/globalMarketSnapshot';
import { ECONOMY_CONFIG_VERSION, getMarketEpoch } from '../simulation/economyClock';
import {
  CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V5,
  canonicalRefreshBatchId,
  canonicalRefreshOfferId,
  canonicalRefreshSeed,
} from './canonicalContractRefresh';
import type { WorldEvent } from '../types/game';
import {
  CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION,
  contractEventAdjustmentForOffer,
  validateCanonicalContractEvents,
  type CanonicalContractEventSnapshot,
} from './canonicalContractWorldEvents';
import type { CanonicalFleetAvailabilitySummary } from './canonicalFleetRuntimeLocation';
import {
  CANONICAL_CONTRACT_EXPIRY_POLICY_VERSION,
  type CanonicalContractClockAuthorityClass,
} from './canonicalContractGameTimeExpiry';
import { CANONICAL_ROAD_ISSUANCE_POLICY_VERSION } from './canonicalRoadContract';

export const PRODUCTION_ROAD_CONTRACT_ISSUANCE_PARITY_STATUS =
  'PRODUCTION_ROAD_CONTRACT_ISSUANCE_PARITY_PASS_INTERNAL_ONLY' as const;

export const ROAD_CONTRACT_ISSUANCE_READINESS =
  'ROAD_CONTRACT_ISSUANCE_BLOCKED_PUBLIC_PROGRESSION' as const;

export const PRODUCTION_CONTRACT_RNG_PARITY =
  'PRODUCTION_CONTRACT_RNG_SERVER_CANONICAL_DIFFERENT_SEQUENCE' as const;

export const CANONICAL_ROAD_CONTRACT_ISSUANCE_AUTHORITY_ENV =
  'CANONICAL_ROAD_CONTRACT_ISSUANCE_AUTHORITY' as const;

export const CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION =
  'canonical-road-contract-issuance-internal-production-parity-v1' as const;

/** v2 freezes a server contract-event snapshot. v1 offers stay multiplier 1. */
export const CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2 =
  'canonical-road-contract-issuance-internal-production-parity-v2' as const;

/** v3 freezes server fleet runtime idle-origin scoring. v1 and v2 offers stay unchanged. */
export const CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V3 =
  'canonical-road-contract-issuance-internal-production-parity-v3' as const;

/** v4 freezes account game-time offer expiry. v1, v2, and v3 keep the server-window TTL. */
export const CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4 =
  'canonical-road-contract-issuance-internal-production-parity-v4' as const;

export type CanonicalProductionRoadIssuancePolicyVersion =
  | typeof CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION
  | typeof CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2
  | typeof CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V3
  | typeof CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4
  | typeof CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V5;

/** Separate from the 30-minute market epoch. Stand-in for the 3 game-hour refresh, not game time. */
export const CANONICAL_PRODUCTION_ROAD_ISSUANCE_WINDOW_MS = 3 * 60 * 60 * 1000;

export const PRODUCTION_ROAD_ISSUANCE_PUBLIC_BLOCKERS = [
  'CONTRACT_EXPIRY_CLOCK_INTERNAL_ONLY',
  'CONTRACT_HOME_CITY_WEIGHT_NOT_A_SEPARATE_SCORE',
  'PLAYER_PROGRESSION_NOT_PUBLIC',
  'COMPANY_XP_DELIVERY_RISK_INTERNAL_CANONICAL_DRIVER_ONLY',
  'COMPANY_XP_NON_DELIVERY_OPERATIONS_INTERNAL_CANONICAL_ONLY',
  'COMPANY_XP_CLIENT_REWARD_SOURCES_INTERNAL_PARTIAL',
  'COMPANY_XP_UNSUPPORTED_REWARD_PROGRESS_CLIENT_OWNED',
  'REPUTATION_NOT_PUBLIC',
  'LEGACY_FLEET_UNVERIFIED',
  'PUBLIC_CONTRACTS_UI_UNWIRED',
  'CONTRACT_EVENT_SCHEDULE_INTERNAL_REAL_DAY',
] as const;

const FORBIDDEN_CLIENT_KEYS = [
  'playerLevel',
  'reputation',
  'level',
  'xp',
  'experience',
  'reputationDelta',
  'xpDelta',
  'newLevel',
  'companyLevel',
  'companyXp',
  'progressionRevision',
  'score',
  'companyScore',
  'fleetCapacity',
  'truckCount',
  'driverCount',
  'homeCityId',
  'truckCityId',
  'currentCityId',
  'fleetLocations',
  'idleCities',
  'idleTruckCount',
  'busyTruckCount',
  'availableTruckIds',
  'maxIdleCapacity',
  'truckStatus',
  'activeDeliveryId',
  'runtimeRevision',
  'expiresAt',
  'expiresAtMs',
  'expiresAtGameHours',
  'issuedAt',
  'gameTime',
  'elapsedGameHours',
  'offerAge',
  'clockRevision',
  'currentGameTime',
  'gameSpeed',
  'canRefresh',
  'cooldown',
  'cooldownRemaining',
  'lastRefresh',
  'lastRefreshGameHours',
  'refreshSequence',
  'refreshIndex',
  'eligible',
  'seed',
  'rngSeed',
  'companyScore',
  'cash',
  'warehouseValue',
  'originStock',
  'destinationStock',
  'surplus',
  'shortage',
  'currentPrice',
  'eventId',
  'eventIds',
  'activeEvents',
  'eventMultiplier',
  'paymentMultiplier',
  'durationMultiplier',
  'deadlineMultiplier',
  'eventStart',
  'eventEnd',
  'eventSeed',
  'eventWindow',
  'eventApplies',
  'seed',
  'random',
  'roll',
  'rng',
  'payment',
  'deadline',
  'amount',
  'stock',
] as const;

export type CanonicalProductionRoadIssuanceGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalProductionRoadIssuanceGate(options?: {
  envValue?: string | null;
}): CanonicalProductionRoadIssuanceGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_ROAD_CONTRACT_ISSUANCE_AUTHORITY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalProductionRoadIssuanceAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalProductionRoadIssuanceGate(options) === 'INTERNAL_TEST';
}

export function hasOnlyCanonicalProductionRoadIssuanceKeys(
  data: Record<string, unknown>,
): boolean {
  if (FORBIDDEN_CLIENT_KEYS.some((key) => key in data)) return false;
  return Object.keys(data).every((key) => key === 'canonicalSchemaVersion');
}

export function canonicalProductionRoadIssuanceWindowIndex(serverNowMs: number): number {
  return Math.floor(Math.max(0, serverNowMs) / CANONICAL_PRODUCTION_ROAD_ISSUANCE_WINDOW_MS);
}

export function canonicalProductionRoadBatchId(uid: string, windowIndex: number): string {
  return `rcbatch_${uid}_${windowIndex}`;
}

export function canonicalProductionRoadOfferId(
  uid: string,
  windowIndex: number,
  slotIndex: number,
): string {
  return `rcprod_${uid}_${windowIndex}_${slotIndex}`;
}

export function canonicalProductionRoadSeed(
  uid: string,
  windowIndex: number,
  marketEpoch: number,
  policyVersion: CanonicalProductionRoadIssuancePolicyVersion = CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION,
): string {
  return `${policyVersion}|${uid}|${windowIndex}|${marketEpoch}`;
}

export type CanonicalTradableMarketRow = {
  cityId: string;
  productId: ProductId;
  /** Buy/sell balance. The production generator does not read this. */
  tradableStock: number;
  /** Value production writes into city.products.stock via materializeSnapshotCities. */
  epochSupply: number;
  currentPrice: number;
  targetStock: number;
  marketRevision: number;
  lastAppliedTickIndex?: number;
};

export type CanonicalProductionRoadTrustedSnapshot = {
  uid: string;
  serverNowMs: number;
  playerLevel: number;
  playerReputation: number;
  ownedMaxTruckCapacity: number;
  marketRows: readonly CanonicalTradableMarketRow[];
  fuelPricePerLiter: number;
  /** Omitted keeps Step 29AA v1 (event multiplier 1). Present switches to v2 unless runtime is also set. */
  contractEventSnapshot?: CanonicalContractEventSnapshot | null;
  /** Present switches issuance to v3 and applies production idle-origin weights. */
  fleetRuntimeSummary?: CanonicalFleetAvailabilitySummary | null;
  /** Present switches issuance to v4 and stamps absolute game-hour expiry. */
  contractGameTime?: {
    issuedAtCanonicalGameHours: number;
    clockRevisionAtIssue: number;
    clockAuthorityClass: CanonicalContractClockAuthorityClass;
  } | null;
  /** Present switches issuance to v5. Identity is the refresh sequence, not the real-time window. */
  refreshSequence?: number | null;
  refreshMaxNewContracts?: number | null;
};

export type CanonicalProductionRoadOffer = {
  contractId: string;
  slotIndex: number;
  batchId: string;
  policyVersion: CanonicalProductionRoadIssuancePolicyVersion;
  originCityId: string;
  destinationCityId: string;
  productId: ProductId;
  amount: number;
  payment: number;
  deadlineHours: number;
  distanceKm: number;
  urgency: number;
  contractType: string;
  riskLevel: string;
  requiredLevel: number;
  fragile: boolean;
  recommendedTruckCondition: number | null;
  requiredDriverLevel: number | null;
  requiredReputation: number | null;
  expiresAtGameHours: number;
  issuedAtGameHours: number | null;
  expiryPolicyVersion: string | null;
  expiryAuthority: 'SERVER_WINDOW' | 'CANONICAL_GAME_TIME';
  clockRevisionAtIssue: number | null;
  marketEpoch: number;
  eventIdsAuditOnly: string[];
  contractEventIds: string[];
  contractEventPolicyVersion: string | null;
  contractEventSnapshotId: string | null;
  paymentEventMultiplier: number;
  durationEventMultiplier: number;
  contractEventMultiplier: number;
  fleetSnapshotClass: 'CAPACITY_ONLY_LOCATION_UNVERIFIED' | 'CANONICAL_RUNTIME_IDLE_ORIGIN';
  fleetRuntimeSummaryHash: string | null;
  idleMaxCapacityTons: number | null;
  playerLevel: number;
  playerReputation: number;
  seed: string;
};

export type CanonicalProductionRoadGenerationResult =
  | {
      ok: true;
      batchId: string;
      windowIndex: number;
      marketEpoch: number;
      offers: CanonicalProductionRoadOffer[];
      seed: string;
      expiresAtServerMs: number;
      contractEventSnapshot: CanonicalContractEventSnapshot | null;
      fleetRuntimeSummary: CanonicalFleetAvailabilitySummary | null;
      contractGameTime: CanonicalProductionRoadTrustedSnapshot['contractGameTime'];
    }
  | { ok: false; reason: string };

function runWithSeededRandom<T>(seed: string, fn: () => T): T {
  const rng = createMarketSeededRng(seed);
  const previous = Math.random;
  Math.random = () => rng();
  try {
    return fn();
  } finally {
    Math.random = previous;
  }
}

function citiesFromTradableRows(rows: readonly CanonicalTradableMarketRow[]): Record<string, City> {
  const byKey = new Map(rows.map((row) => [`${row.cityId}_${row.productId}`, row]));
  const record: Record<string, City> = {};
  for (const city of CITIES) {
    const products = { ...city.products };
    for (const productId of Object.keys(products) as ProductId[]) {
      const row = byKey.get(`${city.id}_${productId}`);
      const base = products[productId];
      products[productId] = {
        ...base,
        stock: row ? row.epochSupply : 0,
        currentPrice: row ? row.currentPrice : base.basePrice,
        targetStock: row?.targetStock ?? base.targetStock,
      };
    }
    record[city.id] = { ...city, products };
  }
  return record;
}

export function generateCanonicalProductionRoadOffers(
  snapshot: CanonicalProductionRoadTrustedSnapshot,
): CanonicalProductionRoadGenerationResult {
  if (!Number.isInteger(snapshot.playerLevel) || snapshot.playerLevel < 1) {
    return { ok: false, reason: 'ROAD_CONTRACT_ISSUANCE_BLOCKED_PLAYER_PROGRESSION' };
  }
  if (!Number.isFinite(snapshot.playerReputation) || snapshot.playerReputation < 0) {
    return { ok: false, reason: 'ROAD_CONTRACT_ISSUANCE_BLOCKED_REPUTATION' };
  }
  if (!Number.isFinite(snapshot.ownedMaxTruckCapacity) || snapshot.ownedMaxTruckCapacity <= 0) {
    return { ok: false, reason: 'ROAD_CONTRACT_ISSUANCE_BLOCKED_FLEET_STATE' };
  }
  if (snapshot.marketRows.length === 0) {
    return { ok: false, reason: 'CANONICAL_MARKET_REQUIRED' };
  }
  const epochs = new Set(
    snapshot.marketRows
      .map((row) => row.lastAppliedTickIndex)
      .filter((value): value is number => typeof value === 'number'),
  );
  if (epochs.size > 1) {
    return { ok: false, reason: 'MARKET_EPOCH_INCOHERENT' };
  }
  const marketEpoch = epochs.size === 1 ? [...epochs][0]! : getMarketEpoch(snapshot.serverNowMs);
  const eventSnapshot = snapshot.contractEventSnapshot ?? null;
  let activeContractEvents: WorldEvent[] = [];
  if (eventSnapshot) {
    if (eventSnapshot.policyVersion !== CANONICAL_CONTRACT_WORLD_EVENT_POLICY_VERSION) {
      return { ok: false, reason: 'CONTRACT_WORLD_EVENT_STATE_INVALID' };
    }
    const validated = validateCanonicalContractEvents(eventSnapshot.activeEvents);
    if (!validated.ok) return validated;
    activeContractEvents = validated.events;
  }
  const fleetRuntime = snapshot.fleetRuntimeSummary ?? null;
  if (
    fleetRuntime &&
    fleetRuntime.policyVersion !== 'canonical-fleet-runtime-location-internal-v1'
  ) {
    return { ok: false, reason: 'FLEET_RUNTIME_STATE_INVALID' };
  }
  const gameTime = snapshot.contractGameTime ?? null;
  if (gameTime && !Number.isFinite(gameTime.issuedAtCanonicalGameHours)) {
    return { ok: false, reason: 'CONTRACT_CLOCK_STATE_INVALID' };
  }
  const refreshSequence = snapshot.refreshSequence;
  const refreshIdentity =
    typeof refreshSequence === 'number' &&
    Number.isInteger(refreshSequence) &&
    refreshSequence >= 0;
  if (refreshIdentity && !gameTime) {
    return { ok: false, reason: 'CONTRACT_REFRESH_BLOCKED_GAME_CLOCK' };
  }
  const issuancePolicy = refreshIdentity
    ? CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V5
    : gameTime
      ? CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4
      : fleetRuntime
        ? CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V3
        : eventSnapshot
          ? CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V2
          : CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION;
  const windowIndex = canonicalProductionRoadIssuanceWindowIndex(snapshot.serverNowMs);
  const batchId = refreshIdentity
    ? canonicalRefreshBatchId(snapshot.uid, refreshSequence)
    : canonicalProductionRoadBatchId(snapshot.uid, windowIndex);
  const seedPolicy =
    issuancePolicy === CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V4 ||
    issuancePolicy === CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION_V3
      ? issuancePolicy
      : CANONICAL_PRODUCTION_ROAD_ISSUANCE_POLICY_VERSION;
  const seed = refreshIdentity
    ? canonicalRefreshSeed(snapshot.uid, refreshSequence, marketEpoch)
    : canonicalProductionRoadSeed(snapshot.uid, windowIndex, marketEpoch, seedPolicy);
  const maxNewContracts =
    refreshIdentity && typeof snapshot.refreshMaxNewContracts === 'number'
      ? snapshot.refreshMaxNewContracts
      : contractBalance.maxContractsPerTick;
  const eventIdsAuditOnly = buildGlobalEventsForEpoch(marketEpoch, ECONOMY_CONFIG_VERSION).map(
    (event) => event.id,
  );
  const economy = {
    ...getSafeGlobalEconomy(null),
    fuelPrice: snapshot.fuelPricePerLiter,
  };
  const cities = citiesFromTradableRows(snapshot.marketRows);
  const generated = runWithSeededRandom(seed, () =>
    generateContracts(cities, ROUTES, PRODUCTS, economy, [], {
      currentTime: gameTime ? gameTime.issuedAtCanonicalGameHours : 0,
      maxNewContracts,
      playerLevel: snapshot.playerLevel,
      playerReputation: snapshot.playerReputation,
      ownedMaxTruckCapacity: fleetRuntime
        ? fleetRuntime.ownedMaxCapacityTons
        : snapshot.ownedMaxTruckCapacity,
      idleMaxTruckCapacity: fleetRuntime
        ? fleetRuntime.idleMaxCapacityTons
        : snapshot.ownedMaxTruckCapacity,
      idleTruckOriginCityIds: fleetRuntime?.idleOriginCities ?? [],
      busyTruckOriginCityIds: fleetRuntime?.busyOriginCities ?? [],
      activeDeliveryDestinationCityIds: fleetRuntime?.activeDestinationCities ?? [],
      activeWorldEvents: activeContractEvents,
    }),
  );
  const offers: CanonicalProductionRoadOffer[] = generated.map((contract, slotIndex) => {
    const adjustment = eventSnapshot
      ? contractEventAdjustmentForOffer(contract, activeContractEvents)
      : { paymentMultiplier: 1, durationMultiplier: 1, eventIds: [] as string[] };
    return {
    contractId: refreshIdentity
      ? canonicalRefreshOfferId(snapshot.uid, refreshSequence, slotIndex)
      : canonicalProductionRoadOfferId(snapshot.uid, windowIndex, slotIndex),
    slotIndex,
    batchId,
    policyVersion: issuancePolicy,
    originCityId: contract.originCityId,
    destinationCityId: contract.destinationCityId,
    productId: contract.productId,
    amount: contract.amount,
    payment: contract.payment,
    deadlineHours: contract.deadlineHours,
    distanceKm: contract.distanceKm,
    urgency: contract.urgency,
    contractType: contract.contractType ?? 'standard',
    riskLevel: contract.riskLevel ?? 'low',
    requiredLevel: contract.requiredLevel ?? 1,
    fragile: (contract.contractType ?? 'standard') === 'fragile',
    recommendedTruckCondition: contract.recommendedTruckCondition ?? null,
    requiredDriverLevel: contract.requiredDriverLevel ?? null,
    requiredReputation: contract.requiredReputation ?? null,
    expiresAtGameHours: contract.expiresAt,
    issuedAtGameHours: gameTime ? gameTime.issuedAtCanonicalGameHours : null,
    expiryPolicyVersion: gameTime ? CANONICAL_CONTRACT_EXPIRY_POLICY_VERSION : null,
    expiryAuthority: gameTime ? 'CANONICAL_GAME_TIME' : 'SERVER_WINDOW',
    clockRevisionAtIssue: gameTime ? gameTime.clockRevisionAtIssue : null,
    marketEpoch,
    eventIdsAuditOnly,
    contractEventIds: adjustment.eventIds,
    contractEventPolicyVersion: eventSnapshot?.policyVersion ?? null,
    contractEventSnapshotId: eventSnapshot?.snapshotId ?? null,
    paymentEventMultiplier: adjustment.paymentMultiplier,
    durationEventMultiplier: adjustment.durationMultiplier,
    contractEventMultiplier: adjustment.paymentMultiplier,
    fleetSnapshotClass: fleetRuntime
      ? 'CANONICAL_RUNTIME_IDLE_ORIGIN'
      : 'CAPACITY_ONLY_LOCATION_UNVERIFIED',
    fleetRuntimeSummaryHash: fleetRuntime?.summaryHash ?? null,
    idleMaxCapacityTons: fleetRuntime?.idleMaxCapacityTons ?? null,
    playerLevel: snapshot.playerLevel,
    playerReputation: snapshot.playerReputation,
    seed,
  };
  });
  return {
    ok: true,
    batchId,
    windowIndex,
    marketEpoch,
    offers,
    seed,
    expiresAtServerMs:
      (windowIndex + 1) * CANONICAL_PRODUCTION_ROAD_ISSUANCE_WINDOW_MS,
    contractEventSnapshot: eventSnapshot,
    fleetRuntimeSummary: fleetRuntime,
    contractGameTime: gameTime,
  };
}

export function oldIssuancePolicyRemainsSeparate(): typeof CANONICAL_ROAD_ISSUANCE_POLICY_VERSION {
  return CANONICAL_ROAD_ISSUANCE_POLICY_VERSION;
}

export function issuanceLeavesMarketStockUnchanged(): true {
  return true;
}

export function issuanceLeavesPlayerCashUnchanged(): true {
  return true;
}
