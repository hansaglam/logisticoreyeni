/**
 * Step 29AG — canonical delivery risk tier / driver assignment authority (INTERNAL_TEST).
 *
 * Driver stats come from the server driver catalog (DRIVER_POOL / STARTER_DRIVER) keyed by the
 * canonical driver document poolId. Truck reliability comes from the canonical fleet template.
 * Risk reuses production calculateBreakdownChance / calculateAccidentChance / getDeliveryRiskTier.
 * Client-sent risk, driver stats, netProfit and XP are never read.
 * Pure. No React. No Firebase. No cash.
 */

import { levelConfig } from '../config/levelConfig';
import { DRIVER_POOL, STARTER_DRIVER } from '../data/drivers';
import { PRODUCT_BY_ID } from '../data/products';
import { getRoute } from '../data/routes';
import { STARTER_TRUCK, findTruckMarketItem } from '../data/trucks';
import { calculateAccidentChance, calculateBreakdownChance } from '../simulation/delivery';
import { sanitizeFuelPricePerLiter } from '../simulation/economy';
import { calculateDeliveryXp, getDeliveryRiskTier, type DeliveryRiskTier } from '../simulation/leveling';
import type { Contract, ContractType, Driver, DriverTier, Route, Truck, WorldEvent } from '../types/game';
import {
  CANONICAL_ROAD_COMPLETION_XP_AUTHORITY,
  PROGRESSION_XP_BLOCKED_INCIDENT_ECONOMICS,
  PROGRESSION_XP_BLOCKED_NET_PROFIT_AUTHORITY,
  PROGRESSION_XP_BLOCKED_RISK_POLICY_UNKNOWN,
  PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_INVALID,
  deriveCanonicalRoadProductionNetProfit,
  type CanonicalProgressionXpBlockedAuthority,
  type CanonicalDeliveryProgressionXpEvidence,
} from './canonicalCompanyProgression';
import {
  CANONICAL_DRIVER_OFFER_POLICY_VERSION,
  CANONICAL_DRIVERS_COLLECTION,
} from './canonicalCoreVehicleStaffCash';
import { CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK } from './canonicalRoadContract';
import { CANONICAL_DRIVER_RISK_FORBIDDEN_CLIENT_KEYS } from './canonicalRoadDelivery';
import {
  CANONICAL_ROAD_TRUCK_FIXTURES,
  type CanonicalRoadExecutionEconomicsSnapshot,
} from './canonicalRoadExecutionEconomics';
import type { CanonicalFleetAssetDocument } from './canonicalRoadFleet';

export { CANONICAL_DRIVERS_COLLECTION };

export const CANONICAL_ROAD_DRIVER_RISK_AUTHORITY_ENV = 'CANONICAL_ROAD_DRIVER_RISK_AUTHORITY' as const;

export const CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION =
  'canonical-road-delivery-risk-tier-v1' as const;

export const CANONICAL_ROAD_DRIVER_SNAPSHOT_POLICY_VERSION =
  'canonical-road-driver-snapshot-v1' as const;

export const CANONICAL_DRIVER_RUNTIME_POLICY_VERSION = 'canonical-driver-runtime-v1' as const;

/** Execution economics frozen with the trusted driver, server fuel price and contract type. */
export const ROAD_EXECUTION_ECONOMICS_DRIVER_POLICY_VERSION =
  'road-execution-economics-driver-v2' as const;

export const CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY_STATUS =
  'CANONICAL_DELIVERY_RISK_DRIVER_AUTHORITY_PASS_INTERNAL_ONLY' as const;

export const CANONICAL_DRIVER_LEVEL_AUTHORITY = 'DRIVER_LEVEL_AUTHORITY_CLIENT_OWNED' as const;

export const CANONICAL_DRIVER_LOCATION_AUTHORITY =
  'DRIVER_LOCATION_NOT_A_PRODUCTION_ASSIGNMENT_INPUT' as const;

export const CANONICAL_DRIVER_RECOVERY_AUTHORITY =
  'DRIVER_RECOVERY_NOT_CANONICAL_VEHICLE_RECOVERY_CLIENT_OWNED' as const;

export const CANONICAL_PUBLIC_DRIVER_READINESS =
  'PUBLIC_DRIVER_RISK_BLOCKED_LEGACY_SAVE_DRIVERS' as const;

/** Step 29AG readiness impacts on earlier authority blockers (internal snapshot paths only). */
export const CANONICAL_TIMING_DRIVER_READINESS =
  'PRODUCTION_TIMING_DRIVER_SPEED_TIER_INTERNAL_SNAPSHOT_ONLY' as const;
export const CANONICAL_FUEL_SAVING_READINESS =
  'CANONICAL_DRIVER_FUEL_SAVING_INTERNAL_SNAPSHOT_ONLY' as const;
export const CANONICAL_WEAR_DRIVER_ATTENTION_READINESS =
  'CANONICAL_WEAR_DRIVER_ATTENTION_INTERNAL_SNAPSHOT_V2_ONLY' as const;

export type CanonicalDriverAuthorityClass =
  | 'SERVER_CANONICAL_DRIVER'
  | 'INTERNAL_TEST_DRIVER_FIXTURE'
  | 'LEGACY_CLIENT_UNVERIFIED'
  | 'DRIVER_RUNTIME_UNINITIALIZED'
  | 'UNSUPPORTED';

export const CANONICAL_DRIVER_AUTHORITY_CLASSES: readonly CanonicalDriverAuthorityClass[] = [
  'SERVER_CANONICAL_DRIVER',
  'INTERNAL_TEST_DRIVER_FIXTURE',
  'LEGACY_CLIENT_UNVERIFIED',
  'DRIVER_RUNTIME_UNINITIALIZED',
  'UNSUPPORTED',
];

export type ProductionRiskTierAuditRow = {
  input: string;
  source: string;
  type: string;
  range: string;
  defaultValue: string;
  formulaUse: string;
  whenRead: string;
  whenMutated: string;
  clientOwned: boolean;
  serverOwned: boolean;
  canonicalStatus: string;
};

/**
 * Production risk tier: createDelivery (simulation/delivery.ts) stores breakdownChance and
 * accidentChance at start; completeDelivery reads getDeliveryRiskTier(delivery) for XP.
 */
export const PRODUCTION_RISK_TIER_AUDIT: readonly ProductionRiskTierAuditRow[] = [
  {
    input: 'truck.condition',
    source: 'save truck (client) / canonical fleet asset economicCondition',
    type: 'number',
    range: '0..100',
    defaultValue: 'none (start-time value)',
    formulaUse: 'breakdown (100-c)/100*0.18; accident (100-c)/100*0.08',
    whenRead: 'createDelivery at start, before wear',
    whenMutated: 'completion wear, repair, upgrades',
    clientOwned: true,
    serverOwned: true,
    canonicalStatus: 'CANONICAL_FLEET_ASSET_ACCEPT_TIME_PRE_WEAR',
  },
  {
    input: 'truck.reliability',
    source: 'truck catalog model (TRUCK_MARKET / STARTER_TRUCK) or fixture template',
    type: 'number',
    range: '0..100',
    defaultValue: 'none (no fallback)',
    formulaUse: 'breakdown (100-r)/100*0.12',
    whenRead: 'createDelivery at start',
    whenMutated: 'never (static catalog)',
    clientOwned: false,
    serverOwned: true,
    canonicalStatus: 'SERVER_CATALOG_OR_FIXTURE_TEMPLATE',
  },
  {
    input: 'truck.capacity',
    source: 'canonical fleet asset capacity',
    type: 'number',
    range: '>0 tons',
    defaultValue: 'none',
    formulaUse: 'load = cargo/max(capacity,1)',
    whenRead: 'createDelivery at start',
    whenMutated: 'capacity upgrades',
    clientOwned: false,
    serverOwned: true,
    canonicalStatus: 'CANONICAL_FLEET_ASSET',
  },
  {
    input: 'contract.cargoWeight ?? contract.amount',
    source: 'canonical contract snapshot',
    type: 'number',
    range: '>0 tons',
    defaultValue: 'amount when cargoWeight missing',
    formulaUse: 'breakdown load*0.06; accident load*0.04',
    whenRead: 'createDelivery at start',
    whenMutated: 'never after issuance',
    clientOwned: false,
    serverOwned: true,
    canonicalStatus: 'CANONICAL_CONTRACT_SNAPSHOT',
  },
  {
    input: 'route.difficulty',
    source: 'static route catalog getRoute(origin, destination)',
    type: 'number',
    range: '0..1',
    defaultValue: 'none (unsupported route fails)',
    formulaUse: 'breakdown d*0.1; accident d*0.11',
    whenRead: 'createDelivery at start',
    whenMutated: 'never (static catalog)',
    clientOwned: false,
    serverOwned: true,
    canonicalStatus: 'SERVER_ROUTE_CATALOG',
  },
  {
    input: 'driver.attention',
    source: 'DRIVER_POOL / STARTER_DRIVER catalog via canonical driver poolId',
    type: 'number',
    range: '0..100',
    defaultValue: 'none (no 100 default in risk)',
    formulaUse: 'breakdown (100-a)/100*0.1; accident (100-a)/100*0.14',
    whenRead: 'createDelivery at start',
    whenMutated: 'never (static catalog stat)',
    clientOwned: true,
    serverOwned: true,
    canonicalStatus: 'CANONICAL_DRIVER_CATALOG_STAT_INTERNAL_ONLY',
  },
  {
    input: 'driver.speed',
    source: 'DRIVER_POOL / STARTER_DRIVER catalog via canonical driver poolId',
    type: 'number',
    range: 'signed (negative clamped to 0 in accident)',
    defaultValue: 'none',
    formulaUse: 'accident max(0, s/100)*0.12',
    whenRead: 'createDelivery at start',
    whenMutated: 'never (static catalog stat)',
    clientOwned: true,
    serverOwned: true,
    canonicalStatus: 'CANONICAL_DRIVER_CATALOG_STAT_INTERNAL_ONLY',
  },
  {
    input: 'product',
    source: 'PRODUCT_BY_ID',
    type: 'Product',
    range: 'catalog id',
    defaultValue: 'none',
    formulaUse: 'passed to both helpers; not used by either formula',
    whenRead: 'createDelivery at start',
    whenMutated: 'never',
    clientOwned: false,
    serverOwned: true,
    canonicalStatus: 'NOT_A_RISK_FORMULA_INPUT',
  },
  {
    input: 'combinedRisk clamp / tier thresholds',
    source: 'calculateBreakdownChance / calculateAccidentChance clamp 0..0.85; getDeliveryRiskTier',
    type: 'number → low|medium|high',
    range: 'combined 0..1.7; low <0.1, medium <0.25, high otherwise',
    defaultValue: 'none',
    formulaUse: 'tier → levelConfig.deliveryXp.riskBonus 0/10/25',
    whenRead: 'completeDelivery (from start-time stored chances)',
    whenMutated: 'never after start',
    clientOwned: true,
    serverOwned: true,
    canonicalStatus: 'FROZEN_AT_ACCEPT_canonical-road-delivery-risk-tier-v1',
  },
];

export type DriverAssignmentAuditRow = {
  concern: string;
  production: string;
  canonical: string;
  canonicalStatus: string;
};

export const PRODUCTION_DRIVER_ASSIGNMENT_AUDIT: readonly DriverAssignmentAuditRow[] = [
  {
    concern: 'driver required',
    production: 'startDelivery requires an idle driver (driverId on delivery)',
    canonical: 'gate ON: selectedDriverId required; canonical driver doc must exist',
    canonicalStatus: 'CANONICAL_DRIVER_REQUIRED',
  },
  {
    concern: 'ownership',
    production: 'save drivers array (client)',
    canonical: 'users/{uid}/canonicalDrivers/{driverId} ownerUid === uid',
    canonicalStatus: 'CANONICAL_DRIVER_NOT_OWNED',
  },
  {
    concern: 'busy / availability',
    production: 'getDriverOperationalState(...).selectableForDelivery else DRIVER_BUSY (client)',
    canonical: 'assignedCanonicalDeliveryId set atomically in accept transaction',
    canonicalStatus: 'DRIVER_NOT_AVAILABLE',
  },
  {
    concern: 'requiredDriverLevel',
    production: 'requiredDriverLevel > 1 → meetsDriverLevelRequirement(driver) (driver level client-owned)',
    canonical: 'null/1 accepted; >1 fails closed (driver level not canonical)',
    canonicalStatus: CANONICAL_DRIVER_LEVEL_AUTHORITY,
  },
  {
    concern: 'location',
    production: 'driver follows truck; not an assignment input',
    canonical: 'truck runtime location is the only location check',
    canonicalStatus: CANONICAL_DRIVER_LOCATION_AUTHORITY,
  },
  {
    concern: 'release on success',
    production: 'completeDelivery sets driver idle',
    canonical: 'completion releases in the same transaction (COMPLETED)',
    canonicalStatus: 'RELEASED_COMPLETED',
  },
  {
    concern: 'release on cancel',
    production: 'cancelDelivery sets driver idle',
    canonical: 'cancel releases in the same transaction (CANCELLED)',
    canonicalStatus: 'RELEASED_CANCELLED',
  },
  {
    concern: 'release on failure',
    production: 'failed delivery sets driver idle',
    canonical: 'server-derived failure → SERVER_DERIVED_FAILURE; client FAILED → CLIENT_UNVERIFIED_FAILURE_TERMINAL',
    canonicalStatus: 'RELEASED_FAILURE_CLASSIFIED',
  },
  {
    concern: 'out of fuel',
    production: 'delivery pauses; driver stays on route',
    canonical: 'PROGRESS_INCOMPLETE returns before release; driver stays assigned',
    canonicalStatus: 'RETAINED_OUT_OF_FUEL',
  },
  {
    concern: 'fire while assigned',
    production: 'canFireDriver blocks a driver on an active delivery',
    canonical: 'fire guard checks assignedCanonicalDeliveryId in the same transaction',
    canonicalStatus: 'DRIVER_ASSIGNED_TO_CANONICAL_DELIVERY',
  },
  {
    concern: 'legacy save driver',
    production: 'save drivers array',
    canonical: 'never imported; no canonical doc → LEGACY_DRIVER_UNVERIFIED',
    canonicalStatus: 'LEGACY_CLIENT_UNVERIFIED',
  },
];

export { CANONICAL_DRIVER_RISK_FORBIDDEN_CLIENT_KEYS };

export function containsForbiddenDriverRiskClientKeys(data: Record<string, unknown>): boolean {
  return CANONICAL_DRIVER_RISK_FORBIDDEN_CLIENT_KEYS.some((key) => key in data);
}

export function isCanonicalRoadDriverRiskAllowed(input?: { envValue?: string | null }): boolean {
  const raw =
    input && 'envValue' in input
      ? input.envValue
      : typeof process !== 'undefined'
        ? process.env[CANONICAL_ROAD_DRIVER_RISK_AUTHORITY_ENV]
        : undefined;
  return typeof raw === 'string' && raw.trim() === 'INTERNAL_TEST';
}

/** Production applyContractTypeToContract penaltyMultiplier (src/simulation/contractTypes.ts). */
export const PRODUCTION_CONTRACT_TYPE_PENALTY_MULTIPLIERS: Readonly<Record<ContractType, number>> = {
  standard: 1,
  urgent: 1.35,
  fragile: 1.25,
  high_reputation: 1.15,
  bulk: 1.1,
  refrigerated: 1.2,
};

export function resolveCanonicalContractTypeEconomics(contractType: unknown):
  | { ok: true; contractType: ContractType; penaltyMultiplier: number }
  | { ok: false; reason: 'CANONICAL_CONTRACT_TYPE_UNSUPPORTED' } {
  const type = contractType == null ? 'standard' : contractType;
  if (typeof type !== 'string' || !(type in PRODUCTION_CONTRACT_TYPE_PENALTY_MULTIPLIERS)) {
    return { ok: false, reason: 'CANONICAL_CONTRACT_TYPE_UNSUPPORTED' };
  }
  const key = type as ContractType;
  return { ok: true, contractType: key, penaltyMultiplier: PRODUCTION_CONTRACT_TYPE_PENALTY_MULTIPLIERS[key] };
}

export type CanonicalDriverStatTemplate = {
  poolId: string;
  attention: number;
  speed: number;
  fuelSaving: number;
  tier: DriverTier;
  statsSource: 'DRIVER_POOL_CATALOG' | 'STARTER_DRIVER_CATALOG';
};

function finiteStat(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Catalog stats only; coming-soon pool rows and unknown ids have no trusted stats. */
export function resolveCanonicalDriverStatTemplate(poolId: unknown): CanonicalDriverStatTemplate | null {
  if (typeof poolId !== 'string' || poolId.length === 0) return null;
  if (poolId === STARTER_DRIVER.poolId || poolId === STARTER_DRIVER.id) {
    return {
      poolId: STARTER_DRIVER.poolId ?? STARTER_DRIVER.id,
      attention: STARTER_DRIVER.attention,
      speed: STARTER_DRIVER.speed,
      fuelSaving: STARTER_DRIVER.fuelSaving,
      tier: STARTER_DRIVER.tier ?? 'rookie',
      statsSource: 'STARTER_DRIVER_CATALOG',
    };
  }
  const item = DRIVER_POOL.find((row) => row.id === poolId);
  if (!item || item.comingSoon) return null;
  if (!finiteStat(item.attention) || !finiteStat(item.speed) || !finiteStat(item.fuelSaving)) return null;
  return {
    poolId: item.id,
    attention: item.attention,
    speed: item.speed,
    fuelSaving: item.fuelSaving,
    tier: item.tier ?? 'rookie',
    statsSource: 'DRIVER_POOL_CATALOG',
  };
}

export type CanonicalRoadDriverSnapshot = {
  snapshotPolicyVersion: typeof CANONICAL_ROAD_DRIVER_SNAPSHOT_POLICY_VERSION;
  driverId: string;
  poolId: string;
  authorityClass: 'SERVER_CANONICAL_DRIVER' | 'INTERNAL_TEST_DRIVER_FIXTURE';
  statsSource: CanonicalDriverStatTemplate['statsSource'];
  attention: number;
  speed: number;
  fuelSaving: number;
  tier: DriverTier;
  driverLevelAuthority: typeof CANONICAL_DRIVER_LEVEL_AUTHORITY;
  driverRuntimeRevisionAtAssign: number;
  frozenAtMs: number;
};

export type CanonicalDriverAssignmentClassification =
  | {
      ok: true;
      authorityClass: 'SERVER_CANONICAL_DRIVER' | 'INTERNAL_TEST_DRIVER_FIXTURE';
      snapshot: CanonicalRoadDriverSnapshot;
    }
  | { ok: false; reason: string; authorityClass: CanonicalDriverAuthorityClass };

/**
 * Validates a canonical driver doc for a new assignment and freezes its catalog stats.
 * Mirrors production startDelivery: driver must be owned, hired and not on another delivery.
 * Production does not require the driver to be at the origin city.
 */
export function classifyCanonicalDriverForAssignment(
  data: Record<string, unknown> | null | undefined,
  input: {
    uid: string;
    driverId: string;
    deliveryId: string;
    requiredDriverLevel: unknown;
    nowMs: number;
  },
): CanonicalDriverAssignmentClassification {
  if (!data) {
    return { ok: false, reason: 'LEGACY_DRIVER_UNVERIFIED', authorityClass: 'LEGACY_CLIENT_UNVERIFIED' };
  }
  if (data.schema !== 1) {
    return { ok: false, reason: 'CANONICAL_DRIVER_SCHEMA_UNSUPPORTED', authorityClass: 'UNSUPPORTED' };
  }
  if (data.ownerUid !== input.uid) {
    return { ok: false, reason: 'CANONICAL_DRIVER_NOT_OWNED', authorityClass: 'UNSUPPORTED' };
  }
  if (data.driverId !== input.driverId) {
    return { ok: false, reason: 'CANONICAL_DRIVER_IDENTITY_MISMATCH', authorityClass: 'UNSUPPORTED' };
  }
  if (data.policyVersion !== CANONICAL_DRIVER_OFFER_POLICY_VERSION) {
    return { ok: false, reason: 'CANONICAL_DRIVER_POLICY_UNKNOWN', authorityClass: 'UNSUPPORTED' };
  }
  let authorityClass: 'SERVER_CANONICAL_DRIVER' | 'INTERNAL_TEST_DRIVER_FIXTURE';
  if (data.authoritySource === 'DRIVER_POOL_CATALOG') {
    authorityClass = 'SERVER_CANONICAL_DRIVER';
  } else if (data.authoritySource === 'INTERNAL_TEST_FIXTURE') {
    authorityClass = 'INTERNAL_TEST_DRIVER_FIXTURE';
  } else {
    return { ok: false, reason: 'CANONICAL_DRIVER_AUTHORITY_UNSUPPORTED', authorityClass: 'UNSUPPORTED' };
  }
  if (data.status !== 'hired') {
    return { ok: false, reason: 'CANONICAL_DRIVER_NOT_HIRED', authorityClass };
  }
  const template = resolveCanonicalDriverStatTemplate(data.poolId);
  if (!template) {
    return { ok: false, reason: 'CANONICAL_DRIVER_STATS_UNAVAILABLE', authorityClass };
  }
  if (data.attentionBaseline != null && data.attentionBaseline !== template.attention) {
    return { ok: false, reason: 'CANONICAL_DRIVER_STATS_MISMATCH', authorityClass };
  }
  const assigned = data.assignedCanonicalDeliveryId;
  if (assigned != null && assigned !== '' && assigned !== input.deliveryId) {
    return { ok: false, reason: 'DRIVER_NOT_AVAILABLE', authorityClass };
  }
  const requiredLevel = input.requiredDriverLevel;
  if (requiredLevel != null) {
    if (typeof requiredLevel !== 'number' || !Number.isFinite(requiredLevel)) {
      return { ok: false, reason: 'CANONICAL_DRIVER_LEVEL_REQUIREMENT_INVALID', authorityClass };
    }
    if (requiredLevel > 1) {
      return { ok: false, reason: 'CANONICAL_DRIVER_LEVEL_AUTHORITY_UNAVAILABLE', authorityClass };
    }
  }
  const runtimeRevision = finiteStat(data.driverRuntimeRevision) ? data.driverRuntimeRevision : 0;
  return {
    ok: true,
    authorityClass,
    snapshot: {
      snapshotPolicyVersion: CANONICAL_ROAD_DRIVER_SNAPSHOT_POLICY_VERSION,
      driverId: input.driverId,
      poolId: template.poolId,
      authorityClass,
      statsSource: template.statsSource,
      attention: template.attention,
      speed: template.speed,
      fuelSaving: template.fuelSaving,
      tier: template.tier,
      driverLevelAuthority: CANONICAL_DRIVER_LEVEL_AUTHORITY,
      driverRuntimeRevisionAtAssign: runtimeRevision,
      frozenAtMs: input.nowMs,
    },
  };
}

export function isValidCanonicalRoadDriverSnapshot(value: unknown): value is CanonicalRoadDriverSnapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<CanonicalRoadDriverSnapshot>;
  if (s.snapshotPolicyVersion !== CANONICAL_ROAD_DRIVER_SNAPSHOT_POLICY_VERSION) return false;
  const template = resolveCanonicalDriverStatTemplate(s.poolId);
  return (
    template != null &&
    typeof s.driverId === 'string' &&
    s.attention === template.attention &&
    s.speed === template.speed &&
    s.fuelSaving === template.fuelSaving &&
    s.tier === template.tier
  );
}

export type CanonicalDriverRuntimeReleaseReason =
  | 'COMPLETED'
  | 'SERVER_DERIVED_FAILURE'
  | 'CLIENT_UNVERIFIED_FAILURE_TERMINAL'
  | 'CANCELLED';

export function planCanonicalDriverAssign(
  driverDoc: Record<string, unknown>,
  deliveryId: string,
  nowMs: number,
): Record<string, unknown> {
  const revision = finiteStat(driverDoc.driverRuntimeRevision) ? driverDoc.driverRuntimeRevision : 0;
  return {
    assignedCanonicalDeliveryId: deliveryId,
    driverRuntimeRevision: revision + 1,
    driverRuntimePolicyVersion: CANONICAL_DRIVER_RUNTIME_POLICY_VERSION,
    lastAssignedAtMs: nowMs,
    updatedAt: nowMs,
  };
}

/** Returns null when the driver is not assigned to this delivery (no release, no write). */
export function planCanonicalDriverRelease(
  driverDoc: Record<string, unknown> | null | undefined,
  deliveryId: string,
  reason: CanonicalDriverRuntimeReleaseReason,
  nowMs: number,
): Record<string, unknown> | null {
  if (!driverDoc || driverDoc.assignedCanonicalDeliveryId !== deliveryId) return null;
  const revision = finiteStat(driverDoc.driverRuntimeRevision) ? driverDoc.driverRuntimeRevision : 0;
  return {
    assignedCanonicalDeliveryId: null,
    driverRuntimeRevision: revision + 1,
    driverRuntimePolicyVersion: CANONICAL_DRIVER_RUNTIME_POLICY_VERSION,
    lastReleaseReason: reason,
    lastReleasedDeliveryId: deliveryId,
    lastReleasedAtMs: nowMs,
    updatedAt: nowMs,
  };
}

/** Server-only internal fixture document (never client-created). */
export function buildInternalTestCanonicalDriverFixture(input: {
  uid: string;
  poolId: string;
  nowMs: number;
}): { ok: true; driver: Record<string, unknown> } | { ok: false; reason: string } {
  const template = resolveCanonicalDriverStatTemplate(input.poolId);
  if (!template) return { ok: false, reason: 'CANONICAL_DRIVER_STATS_UNAVAILABLE' };
  return {
    ok: true,
    driver: {
      driverId: template.poolId,
      poolId: template.poolId,
      ownerUid: input.uid,
      name: `Internal fixture ${template.poolId}`,
      skill: 0,
      attentionBaseline: template.attention,
      salaryPerDay: 0,
      hiringFee: 0,
      status: 'hired',
      assignedCanonicalDeliveryId: null,
      schema: 1,
      authoritySource: 'INTERNAL_TEST_FIXTURE',
      policyVersion: CANONICAL_DRIVER_OFFER_POLICY_VERSION,
      revision: 1,
      driverRuntimeRevision: 0,
      driverRuntimePolicyVersion: CANONICAL_DRIVER_RUNTIME_POLICY_VERSION,
      createdAt: input.nowMs,
      updatedAt: input.nowMs,
    },
  };
}

export type CanonicalTruckReliabilitySource = 'INTERNAL_TEST_FIXTURE_TEMPLATE' | 'CATALOG_MODEL';

/**
 * Same template precedence as truckFromCanonicalFleetAsset (fixture key, then catalog), but with
 * no default fallback: an asset without a known template has no trusted reliability.
 */
export function resolveCanonicalTruckRiskProfile(asset: CanonicalFleetAssetDocument):
  | {
      ok: true;
      condition: number;
      reliability: number;
      capacity: number;
      reliabilitySource: CanonicalTruckReliabilitySource;
      catalogModelId: string;
    }
  | { ok: false; reason: 'CANONICAL_TRUCK_RELIABILITY_UNAVAILABLE' | 'CANONICAL_TRUCK_RISK_STATE_INVALID' } {
  const fixture = CANONICAL_ROAD_TRUCK_FIXTURES[asset.fixtureKey];
  const catalog =
    findTruckMarketItem(asset.catalogModelId) ??
    (asset.catalogModelId === STARTER_TRUCK.catalogId || asset.catalogModelId === STARTER_TRUCK.id
      ? STARTER_TRUCK
      : null);
  const template: Pick<Truck, 'reliability'> | null = fixture ?? catalog ?? null;
  const reliabilitySource: CanonicalTruckReliabilitySource | null = fixture
    ? 'INTERNAL_TEST_FIXTURE_TEMPLATE'
    : catalog
      ? 'CATALOG_MODEL'
      : null;
  if (!template || !reliabilitySource) {
    return { ok: false, reason: 'CANONICAL_TRUCK_RELIABILITY_UNAVAILABLE' };
  }
  const reliability = template.reliability;
  if (!finiteStat(reliability) || reliability < 0 || reliability > 100) {
    return { ok: false, reason: 'CANONICAL_TRUCK_RELIABILITY_UNAVAILABLE' };
  }
  if (
    !finiteStat(asset.economicCondition) ||
    asset.economicCondition < 0 ||
    asset.economicCondition > 100 ||
    !finiteStat(asset.capacity) ||
    asset.capacity <= 0
  ) {
    return { ok: false, reason: 'CANONICAL_TRUCK_RISK_STATE_INVALID' };
  }
  return {
    ok: true,
    condition: asset.economicCondition,
    reliability,
    capacity: asset.capacity,
    reliabilitySource,
    catalogModelId: asset.catalogModelId,
  };
}

export type CanonicalRoadRiskInputs = {
  truckCondition: number;
  truckReliability: number;
  truckCapacity: number;
  cargoWeightTons: number;
  routeDifficulty: number;
  driverAttention: number;
  driverSpeed: number;
};

export type CanonicalRoadRiskDerivation = {
  breakdownChance: number;
  accidentChance: number;
  combinedRisk: number;
  riskTier: DeliveryRiskTier;
  riskBonus: number;
};

const RISK_SHIM_PRODUCT = PRODUCT_BY_ID.steel;

/** Production createDelivery risk: calculateBreakdownChance + calculateAccidentChance → tier. */
export function deriveCanonicalRoadRiskFromInputs(inputs: CanonicalRoadRiskInputs): CanonicalRoadRiskDerivation {
  const contract = {
    cargoWeight: inputs.cargoWeightTons,
    amount: inputs.cargoWeightTons,
    productId: RISK_SHIM_PRODUCT.id,
  } as unknown as Contract;
  const truck = {
    condition: inputs.truckCondition,
    reliability: inputs.truckReliability,
    capacity: inputs.truckCapacity,
  } as unknown as Truck;
  const driver = { attention: inputs.driverAttention, speed: inputs.driverSpeed } as unknown as Driver;
  const route = { difficulty: inputs.routeDifficulty } as unknown as Route;
  const breakdownChance = calculateBreakdownChance(contract, truck, driver, route, RISK_SHIM_PRODUCT);
  const accidentChance = calculateAccidentChance(contract, truck, driver, route, RISK_SHIM_PRODUCT);
  const riskTier = getDeliveryRiskTier({ breakdownChance, accidentChance });
  return {
    breakdownChance,
    accidentChance,
    combinedRisk: breakdownChance + accidentChance,
    riskTier,
    riskBonus: levelConfig.deliveryXp.riskBonus[riskTier],
  };
}

export type CanonicalRoadDeliveryRiskSnapshot = CanonicalRoadRiskDerivation & {
  riskPolicyVersion: typeof CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION;
  riskSnapshotAuthority: 'SERVER_DERIVED_AT_ACCEPT';
  driverId: string;
  driverSnapshotPolicyVersion: typeof CANONICAL_ROAD_DRIVER_SNAPSHOT_POLICY_VERSION;
  truckAssetId: string;
  truckEconomicRevision: number;
  reliabilitySource: CanonicalTruckReliabilitySource;
  conditionStage: 'ACCEPT_TIME_PRE_WEAR';
  inputs: CanonicalRoadRiskInputs;
  frozenAtMs: number;
};

export function freezeCanonicalRoadDeliveryRiskSnapshot(input: {
  truckAsset: CanonicalFleetAssetDocument;
  driverSnapshot: CanonicalRoadDriverSnapshot;
  contract: { originCityId: string; destinationCityId: string; amount: number; cargoWeight?: number | null };
  nowMs: number;
}): { ok: true; snapshot: CanonicalRoadDeliveryRiskSnapshot } | { ok: false; reason: string } {
  const route = getRoute(input.contract.originCityId, input.contract.destinationCityId);
  if (!route) return { ok: false, reason: 'UNSUPPORTED_ROUTE' };
  const truck = resolveCanonicalTruckRiskProfile(input.truckAsset);
  if (!truck.ok) return truck;
  const cargo =
    input.contract.cargoWeight != null && input.contract.cargoWeight > 0
      ? input.contract.cargoWeight
      : input.contract.amount;
  if (!finiteStat(cargo) || cargo <= 0) return { ok: false, reason: 'CANONICAL_RISK_CARGO_INVALID' };
  const inputs: CanonicalRoadRiskInputs = {
    truckCondition: truck.condition,
    truckReliability: truck.reliability,
    truckCapacity: truck.capacity,
    cargoWeightTons: cargo,
    routeDifficulty: route.difficulty,
    driverAttention: input.driverSnapshot.attention,
    driverSpeed: input.driverSnapshot.speed,
  };
  const derived = deriveCanonicalRoadRiskFromInputs(inputs);
  return {
    ok: true,
    snapshot: {
      ...derived,
      riskPolicyVersion: CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION,
      riskSnapshotAuthority: 'SERVER_DERIVED_AT_ACCEPT',
      driverId: input.driverSnapshot.driverId,
      driverSnapshotPolicyVersion: CANONICAL_ROAD_DRIVER_SNAPSHOT_POLICY_VERSION,
      truckAssetId: input.truckAsset.assetId,
      truckEconomicRevision: input.truckAsset.economicRevision,
      reliabilitySource: truck.reliabilitySource,
      conditionStage: 'ACCEPT_TIME_PRE_WEAR',
      inputs,
      frozenAtMs: input.nowMs,
    },
  };
}

export function validateCanonicalRoadDeliveryRiskSnapshot(
  snapshot: unknown,
):
  | { ok: true; riskTier: DeliveryRiskTier; riskBonus: number; riskPolicyVersion: string }
  | { ok: false; xpAuthority: CanonicalProgressionXpBlockedAuthority } {
  if (snapshot == null) return { ok: false, xpAuthority: CANONICAL_ROAD_COMPLETION_XP_AUTHORITY };
  if (typeof snapshot !== 'object') return { ok: false, xpAuthority: PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_INVALID };
  const s = snapshot as Partial<CanonicalRoadDeliveryRiskSnapshot>;
  if (s.riskPolicyVersion !== CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION) {
    return { ok: false, xpAuthority: PROGRESSION_XP_BLOCKED_RISK_POLICY_UNKNOWN };
  }
  const i = s.inputs;
  if (
    !i ||
    ![
      i.truckCondition,
      i.truckReliability,
      i.truckCapacity,
      i.cargoWeightTons,
      i.routeDifficulty,
      i.driverAttention,
      i.driverSpeed,
    ].every(finiteStat)
  ) {
    return { ok: false, xpAuthority: PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_INVALID };
  }
  const recomputed = deriveCanonicalRoadRiskFromInputs(i);
  if (recomputed.riskTier !== s.riskTier || recomputed.riskBonus !== s.riskBonus) {
    return { ok: false, xpAuthority: PROGRESSION_XP_BLOCKED_RISK_SNAPSHOT_INVALID };
  }
  return {
    ok: true,
    riskTier: recomputed.riskTier,
    riskBonus: recomputed.riskBonus,
    riskPolicyVersion: CANONICAL_ROAD_DELIVERY_RISK_TIER_POLICY_VERSION,
  };
}

export type CanonicalFuelPriceAuthority = 'SERVER_GLOBAL_ECONOMY' | 'INTERNAL_FALLBACK_UNTRUSTED';

/** Production getSafeFuelPrice(globalEconomy): sanitize the server-written price. */
export function resolveCanonicalAcceptFuelPrice(globalEconomy: Record<string, unknown> | null | undefined): {
  pricePerLiter: number;
  authority: CanonicalFuelPriceAuthority;
} {
  const raw = globalEconomy?.fuelPricePerLiter;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return { pricePerLiter: sanitizeFuelPricePerLiter(raw), authority: 'SERVER_GLOBAL_ECONOMY' };
  }
  return { pricePerLiter: CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK, authority: 'INTERNAL_FALLBACK_UNTRUSTED' };
}

export type CanonicalMaintenanceEventAuthority =
  | 'CANONICAL_CONTRACT_WORLD_EVENTS'
  | 'UNRESOLVED_EVENT_AUTHORITY_OFF'
  | 'UNRESOLVED_EVENT_STATE_INVALID';

/** Production createDelivery passes activeWorldEvents to calculateContractEconomics. */
export function activeMaintenanceWorldEvents(events: readonly WorldEvent[]): WorldEvent[] {
  return events.filter((event) => event.isActive);
}

export type CanonicalRoadCompletionXpDerivation =
  | { ok: true; xp: number; xpAuthority: 'SERVER_DERIVED'; xpEvidence: CanonicalDeliveryProgressionXpEvidence }
  | { ok: false; xp: 0; xpAuthority: CanonicalProgressionXpBlockedAuthority; xpEvidence: null };

type DriverAwareEconomics = CanonicalRoadExecutionEconomicsSnapshot & {
  driverEconomicsPolicyVersion?: string;
  fuelPriceAuthority?: string;
  maintenanceEventAuthority?: string;
};

/**
 * Completion XP = production calculateDeliveryXp(distanceKm, netProfit, riskTier).
 * Blocked unless the delivery carries a valid risk snapshot and a netProfit whose inputs are
 * all trusted (driver-aware economics, server fuel price, resolved events, resolved incidents
 * when the fragile surcharge depends on completion condition).
 */
export function deriveCanonicalRoadCompletionXpForDelivery(input: {
  delivery: {
    distanceKm: number;
    deliveryRiskSnapshot?: unknown;
    executionEconomicsSnapshot?: CanonicalRoadExecutionEconomicsSnapshot | null;
    incidentConditionAuthority?: 'NONE' | 'UNRESOLVED' | 'RESOLVED' | null;
  };
  derivedSettlement: { grossRevenue: number; fuelCost: number; maintenanceCost: number; penaltyCost: number };
}): CanonicalRoadCompletionXpDerivation {
  const risk = validateCanonicalRoadDeliveryRiskSnapshot(input.delivery.deliveryRiskSnapshot);
  if (!risk.ok) return { ok: false, xp: 0, xpAuthority: risk.xpAuthority, xpEvidence: null };
  const economics = input.delivery.executionEconomicsSnapshot as DriverAwareEconomics | null | undefined;
  if (
    !economics ||
    economics.driverEconomicsPolicyVersion !== ROAD_EXECUTION_ECONOMICS_DRIVER_POLICY_VERSION ||
    economics.fuelPriceAuthority !== 'SERVER_GLOBAL_ECONOMY' ||
    economics.maintenanceEventAuthority !== 'CANONICAL_CONTRACT_WORLD_EVENTS'
  ) {
    return { ok: false, xp: 0, xpAuthority: PROGRESSION_XP_BLOCKED_NET_PROFIT_AUTHORITY, xpEvidence: null };
  }
  if (
    economics.fragilityPolicySnapshot.contractType === 'fragile' &&
    input.delivery.incidentConditionAuthority === 'UNRESOLVED'
  ) {
    return { ok: false, xp: 0, xpAuthority: PROGRESSION_XP_BLOCKED_INCIDENT_ECONOMICS, xpEvidence: null };
  }
  const netProfit = deriveCanonicalRoadProductionNetProfit(input.derivedSettlement);
  if (!Number.isFinite(netProfit) || !Number.isFinite(input.delivery.distanceKm)) {
    return { ok: false, xp: 0, xpAuthority: PROGRESSION_XP_BLOCKED_NET_PROFIT_AUTHORITY, xpEvidence: null };
  }
  return {
    ok: true,
    xp: calculateDeliveryXp(input.delivery.distanceKm, netProfit, risk.riskTier),
    xpAuthority: 'SERVER_DERIVED',
    xpEvidence: {
      distanceKm: input.delivery.distanceKm,
      netProfit,
      riskTier: risk.riskTier,
      riskBonus: risk.riskBonus,
      riskPolicyVersion: risk.riskPolicyVersion,
    },
  };
}
