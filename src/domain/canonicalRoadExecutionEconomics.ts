/**
 * Canonical ROAD execution-economics snapshot (Map V2 Step 29H).
 *
 * Freezes INTERNAL_TEST fixture truck/trailer start-time inputs used later
 * for shadow settlement. Does not trust client money fields. Does not mutate cash.
 *
 * Public live fleet condition/upgrades remain save-owned — not server authority.
 */

import { STARTER_TRUCK } from '../data/trucks';
import { PRODUCT_BY_ID } from '../data/products';
import { getRoute } from '../data/routes';
import {
  calculateContractEconomics,
} from '../simulation/contractEconomics';
import {
  calculateDeliverySettlement,
  calculateFailurePenalty,
  calculateLatePenalty,
} from '../simulation/delivery';
import { classifyDeliveryPunctuality } from '../simulation/reputationSettlement';
import type { Contract, ContractType, Driver, Trailer, Truck, TruckUpgrades, WorldEvent } from '../types/game';
import { CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK } from './canonicalRoadContract';

export type CanonicalRoadExecutionContractBasis = {
  originCityId: string;
  destinationCityId: string;
  productId: string;
  amount: number;
  routeId: string;
  distanceKm: number;
  difficulty: number;
  tollCost: number;
  urgency: number;
  payment: number;
  deadlineHours: number;
};

export type CanonicalRoadExecutionOutcome = 'COMPLETED' | 'FAILED';

export const CANONICAL_ROAD_EXECUTION_ECONOMICS_STATUS =
  'CANONICAL_ROAD_EXECUTION_ECONOMICS_PASS_INTERNAL_TRUCK_POLICY_ONLY' as const;

export const TRUCK_ECONOMICS_SERVER_AUTHORITY =
  'TRUCK_ECONOMICS_SERVER_AUTHORITY_MISSING' as const;

export const TRAILER_ECONOMICS_SERVER_AUTHORITY =
  'TRAILER_ECONOMICS_SERVER_AUTHORITY_MISSING' as const;

export const DRIVER_SETTLEMENT_RELEVANCE = 'DRIVER_NOT_SETTLEMENT_RELEVANT' as const;

export const ROAD_EXECUTION_ECONOMICS_POLICY_VERSION = 'road-execution-economics-v1' as const;
export const ROAD_MAINTENANCE_POLICY_VERSION = 'road-start-maintenance-v1' as const;
export const ROAD_FRAGILE_POLICY_VERSION = 'road-fragile-surcharge-v1' as const;
export const ROAD_LATE_PENALTY_POLICY_VERSION = 'road-late-penalty-v1' as const;
export const ROAD_FAILURE_PENALTY_POLICY_VERSION = 'road-failure-penalty-v1' as const;
export const ROAD_FUEL_SETTLEMENT_POLICY_VERSION = 'road-fuel-prepaid-v1' as const;

export const CANONICAL_ROAD_EXECUTION_ECONOMICS_SCHEMA_VERSION = 1 as const;

export const CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID = 'fixture-healthy' as const;
export const CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID = 'fixture-standard' as const;

export type CanonicalRoadFuelSettlementMode = 'PREPAID_OR_EXECUTION_CONSUMED';

export type CanonicalRoadCompletionBand =
  | 'EARLY'
  | 'ON_TIME'
  | 'LATE_MINOR'
  | 'LATE_MAJOR'
  | 'FAILED';

export type CanonicalRoadContractTypeFreeze = ContractType;

/** Trusted accept-time driver inputs for calculateContractEconomics (Step 29AG v2 only). */
export type CanonicalRoadEconomicsDriverInput = {
  driverId: string;
  speed: number;
  fuelSaving: number;
  tier: Driver['tier'];
};

const ZERO_UPGRADES: TruckUpgrades = {
  engine: 0,
  fuelEfficiency: 0,
  cargo: 0,
  durability: 0,
};

function cloneStarter(overrides: Partial<Truck> & { id: string }): Truck {
  return {
    ...STARTER_TRUCK,
    upgrades: { ...ZERO_UPGRADES },
    ...overrides,
  };
}

export const CANONICAL_ROAD_TRUCK_FIXTURES: Record<string, Truck> = {
  'fixture-healthy': cloneStarter({
    id: CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID,
    catalogId: CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID,
    name: 'Internal fixture healthy',
    condition: STARTER_TRUCK.condition,
  }),
  'fixture-degraded': cloneStarter({
    id: 'fixture-degraded',
    catalogId: 'fixture-degraded',
    name: 'Internal fixture degraded',
    condition: 35,
  }),
  'fixture-upgraded': cloneStarter({
    id: 'fixture-upgraded',
    catalogId: 'fixture-upgraded',
    name: 'Internal fixture upgraded',
    condition: 100,
    maintenanceCost: 0.1,
    upgrades: {
      engine: 3,
      fuelEfficiency: 3,
      cargo: 3,
      durability: 3,
    },
  }),
};

export function isCanonicalRoadTruckFixtureId(value: unknown): value is string {
  return typeof value === 'string' && value in CANONICAL_ROAD_TRUCK_FIXTURES;
}

export function resolveCanonicalRoadTruckFixture(truckId?: string | null): Truck | null {
  const id = truckId && truckId.length > 0 ? truckId : CANONICAL_ROAD_DEFAULT_TRUCK_FIXTURE_ID;
  return CANONICAL_ROAD_TRUCK_FIXTURES[id] ?? null;
}

export function buildCanonicalRoadTrailerFixture(truckId: string): Trailer {
  return {
    id: CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID,
    name: 'Internal fixture trailer',
    type: 'standard',
    capacityBonusTons: 5,
    purchasePrice: 0,
    condition: 100,
    city: 'izmir',
    status: 'attached',
    attachedTruckId: truckId,
    isOwned: true,
    createdAtGameTime: 0,
  };
}

export type CanonicalRoadExecutionEconomicsSnapshot = {
  executionEconomicsSchemaVersion: typeof CANONICAL_ROAD_EXECUTION_ECONOMICS_SCHEMA_VERSION;
  createdAtPolicy: typeof ROAD_EXECUTION_ECONOMICS_POLICY_VERSION;
  maintenancePolicyVersion: typeof ROAD_MAINTENANCE_POLICY_VERSION;
  fragilePolicyVersion: typeof ROAD_FRAGILE_POLICY_VERSION;
  latePenaltyPolicyVersion: typeof ROAD_LATE_PENALTY_POLICY_VERSION;
  failurePenaltyPolicyVersion: typeof ROAD_FAILURE_PENALTY_POLICY_VERSION;
  fuelPolicyVersion: typeof ROAD_FUEL_SETTLEMENT_POLICY_VERSION;
  truckEconomicProfile: {
    truckId: string;
    source: 'INTERNAL_TEST_FIXTURE' | 'CANONICAL_FLEET_ASSET';
    catalogId: string;
    condition: number;
    maintenanceCostPerKm: number;
    fuelConsumptionPerKm: number;
    capacity: number;
    speed: number;
    vehicleClass: string | undefined;
    upgrades: TruckUpgrades;
    economicRevision: number;
  };
  trailerEconomicProfile: {
    trailerId: string | null;
    source: 'INTERNAL_TEST_FIXTURE' | 'CANONICAL_FLEET_ASSET' | 'NONE';
    type: Trailer['type'] | null;
    capacityBonusTons: number;
    economicRevision: number | null;
  };
  routeEconomicProfile: {
    routeId: string;
    distanceKm: number;
    difficulty: number;
    tollCost: number;
  };
  maintenanceSnapshot: {
    maintenance: number;
    trailer: number;
    toll: number;
    other: number;
    bundle: number;
  };
  tollSnapshot: { amount: number; source: 'CANONICAL_ROUTE' };
  fuelPolicySnapshot: {
    fuelSettlementMode: CanonicalRoadFuelSettlementMode;
    completionFuelCharge: 0;
    fuelPricePerLiter: number;
    planningFuelCost: number;
  };
  fragilityPolicySnapshot: {
    contractType: CanonicalRoadContractTypeFreeze;
    recommendedTruckCondition: number;
    frozenStartCondition: number;
    surchargeRate: 0.05;
  };
  /** After incidents, before base wear. Production completeDelivery fragile check. */
  completionTruckCondition?: number;
  acceptedTravelBasis: {
    expectedDurationHours: number;
    deadlineHours: number;
  };
  driverSettlement: typeof DRIVER_SETTLEMENT_RELEVANCE;
  selectedDriverId: string | null;
  penaltyMultiplier: number;
  /** Step 29AG: present only when frozen with a trusted canonical driver. */
  driverEconomicsPolicyVersion?: string;
  driverEconomicProfile?: { driverId: string; speed: number; fuelSaving: number; tier: Driver['tier'] };
  fuelPriceAuthority?: string;
  maintenanceEventAuthority?: string;
  maintenanceEventIds?: string[];
  createdAtMs: number;
};

export type FreezeCanonicalRoadExecutionEconomicsInput = {
  contract: CanonicalRoadExecutionContractBasis;
  selectedTruckId?: string | null;
  selectedTrailerId?: string | null;
  selectedDriverId?: string | null;
  fuelPricePerLiter?: number;
  contractType?: CanonicalRoadContractTypeFreeze;
  penaltyMultiplier?: number;
  recommendedTruckCondition?: number;
  createdAtMs?: number;
};

export type FreezeCanonicalRoadExecutionEconomicsResult =
  | { ok: true; snapshot: CanonicalRoadExecutionEconomicsSnapshot }
  | { ok: false; reason: string };

function resolveTrailer(
  selectedTrailerId: string | null | undefined,
  truckId: string,
): Trailer | null | 'INVALID' {
  if (selectedTrailerId == null || selectedTrailerId === '' || selectedTrailerId === 'none') {
    return null;
  }
  if (selectedTrailerId === CANONICAL_ROAD_STANDARD_TRAILER_FIXTURE_ID) {
    return buildCanonicalRoadTrailerFixture(truckId);
  }
  return 'INVALID';
}

export function freezeCanonicalRoadExecutionEconomicsFromTruckState(input: {
  contract: CanonicalRoadExecutionContractBasis;
  truck: Truck;
  trailer: Trailer | null;
  truckSource?: 'INTERNAL_TEST_FIXTURE' | 'CANONICAL_FLEET_ASSET';
  trailerSource?: 'INTERNAL_TEST_FIXTURE' | 'CANONICAL_FLEET_ASSET' | 'NONE';
  truckEconomicRevision?: number;
  trailerEconomicRevision?: number | null;
  selectedDriverId?: string | null;
  fuelPricePerLiter?: number;
  contractType?: CanonicalRoadContractTypeFreeze;
  penaltyMultiplier?: number;
  recommendedTruckCondition?: number;
  driver?: CanonicalRoadEconomicsDriverInput | null;
  activeEvents?: WorldEvent[];
  driverEconomics?: {
    policyVersion: string;
    fuelPriceAuthority: string;
    maintenanceEventAuthority: string;
  } | null;
  createdAtMs?: number;
}): FreezeCanonicalRoadExecutionEconomicsResult {
  const { truck, trailer } = input;
  const route = getRoute(input.contract.originCityId, input.contract.destinationCityId);
  if (!route) {
    return { ok: false, reason: 'UNSUPPORTED_ROUTE' };
  }
  const fuelPricePerLiter = Number.isFinite(input.fuelPricePerLiter)
    ? Number(input.fuelPricePerLiter)
    : CANONICAL_ROAD_INTERNAL_FUEL_FALLBACK;
  const contractType = input.contractType ?? 'standard';
  const penaltyMultiplier =
    Number.isFinite(input.penaltyMultiplier) && (input.penaltyMultiplier ?? 1) > 0
      ? Number(input.penaltyMultiplier)
      : 1;
  const recommendedTruckCondition = Math.round(input.recommendedTruckCondition ?? 70);
  const economics = calculateContractEconomics({
    contract: {
      payment: input.contract.payment,
      amount: input.contract.amount,
      distanceKm: input.contract.distanceKm,
      urgency: input.contract.urgency,
      contractType,
      riskLevel: 'low',
    },
    truck,
    trailer,
    driver: input.driver
      ? {
          speed: input.driver.speed,
          fuelSaving: input.driver.fuelSaving,
          tier: input.driver.tier,
          salaryPerDay: 0,
        }
      : null,
    route,
    globalEconomySnapshot: { fuelPricePerLiter },
    activeEvents: input.activeEvents ?? [],
  });
  const maintenance = economics.costs.maintenance;
  const trailerCost = economics.costs.trailer;
  const toll = economics.costs.toll;
  const other = economics.costs.other;
  const bundle = maintenance + trailerCost + toll + other;
  const snapshot: CanonicalRoadExecutionEconomicsSnapshot = {
    executionEconomicsSchemaVersion: CANONICAL_ROAD_EXECUTION_ECONOMICS_SCHEMA_VERSION,
    createdAtPolicy: ROAD_EXECUTION_ECONOMICS_POLICY_VERSION,
    maintenancePolicyVersion: ROAD_MAINTENANCE_POLICY_VERSION,
    fragilePolicyVersion: ROAD_FRAGILE_POLICY_VERSION,
    latePenaltyPolicyVersion: ROAD_LATE_PENALTY_POLICY_VERSION,
    failurePenaltyPolicyVersion: ROAD_FAILURE_PENALTY_POLICY_VERSION,
    fuelPolicyVersion: ROAD_FUEL_SETTLEMENT_POLICY_VERSION,
    truckEconomicProfile: {
      truckId: truck.id,
      source: input.truckSource ?? 'INTERNAL_TEST_FIXTURE',
      catalogId: truck.catalogId ?? truck.id,
      condition: truck.condition,
      maintenanceCostPerKm: truck.maintenanceCost,
      fuelConsumptionPerKm: truck.fuelConsumptionPerKm,
      capacity: truck.capacity,
      speed: truck.speed,
      vehicleClass: truck.vehicleClass,
      upgrades: {
        engine: truck.upgrades?.engine ?? 0,
        fuelEfficiency: truck.upgrades?.fuelEfficiency ?? 0,
        cargo: truck.upgrades?.cargo ?? 0,
        durability: truck.upgrades?.durability ?? 0,
      },
      economicRevision: input.truckEconomicRevision ?? 1,
    },
    trailerEconomicProfile: {
      trailerId: trailer?.id ?? null,
      source: input.trailerSource ?? (trailer ? 'INTERNAL_TEST_FIXTURE' : 'NONE'),
      type: trailer?.type ?? null,
      capacityBonusTons: trailer?.capacityBonusTons ?? 0,
      economicRevision: trailer ? (input.trailerEconomicRevision ?? 1) : null,
    },
    routeEconomicProfile: {
      routeId: input.contract.routeId,
      distanceKm: input.contract.distanceKm,
      difficulty: input.contract.difficulty,
      tollCost: input.contract.tollCost,
    },
    maintenanceSnapshot: {
      maintenance,
      trailer: trailerCost,
      toll,
      other,
      bundle,
    },
    tollSnapshot: {
      amount: Math.round(Math.max(0, input.contract.tollCost)),
      source: 'CANONICAL_ROUTE',
    },
    fuelPolicySnapshot: {
      fuelSettlementMode: 'PREPAID_OR_EXECUTION_CONSUMED',
      completionFuelCharge: 0,
      fuelPricePerLiter,
      planningFuelCost: economics.costs.fuel,
    },
    fragilityPolicySnapshot: {
      contractType,
      recommendedTruckCondition,
      frozenStartCondition: truck.condition,
      surchargeRate: 0.05,
    },
    acceptedTravelBasis: {
      expectedDurationHours: economics.estimatedDurationHours,
      deadlineHours: input.contract.deadlineHours,
    },
    driverSettlement: DRIVER_SETTLEMENT_RELEVANCE,
    selectedDriverId:
      typeof input.selectedDriverId === 'string' && input.selectedDriverId.length > 0
        ? input.selectedDriverId
        : null,
    penaltyMultiplier,
    ...(input.driver && input.driverEconomics
      ? {
          driverEconomicsPolicyVersion: input.driverEconomics.policyVersion,
          driverEconomicProfile: {
            driverId: input.driver.driverId,
            speed: input.driver.speed,
            fuelSaving: input.driver.fuelSaving,
            tier: input.driver.tier,
          },
          fuelPriceAuthority: input.driverEconomics.fuelPriceAuthority,
          maintenanceEventAuthority: input.driverEconomics.maintenanceEventAuthority,
          maintenanceEventIds: (input.activeEvents ?? []).map((event) => event.id),
        }
      : {}),
    createdAtMs: input.createdAtMs ?? 0,
  };
  return { ok: true, snapshot };
}

export function freezeCanonicalRoadExecutionEconomics(
  input: FreezeCanonicalRoadExecutionEconomicsInput,
): FreezeCanonicalRoadExecutionEconomicsResult {
  const truck = resolveCanonicalRoadTruckFixture(input.selectedTruckId);
  if (!truck) {
    return { ok: false, reason: 'INVALID_TRUCK_FIXTURE' };
  }
  const trailerOrInvalid = resolveTrailer(input.selectedTrailerId, truck.id);
  if (trailerOrInvalid === 'INVALID') {
    return { ok: false, reason: 'INVALID_TRAILER_FIXTURE' };
  }
  return freezeCanonicalRoadExecutionEconomicsFromTruckState({
    contract: input.contract,
    truck,
    trailer: trailerOrInvalid,
    selectedDriverId: input.selectedDriverId,
    fuelPricePerLiter: input.fuelPricePerLiter,
    contractType: input.contractType,
    penaltyMultiplier: input.penaltyMultiplier,
    recommendedTruckCondition: input.recommendedTruckCondition,
    createdAtMs: input.createdAtMs,
  });
}

export function classifyCanonicalRoadCompletionBand(input: {
  outcome: CanonicalRoadExecutionOutcome;
  deadlineHours: number;
  actualTravelHours: number;
  plannedTravelHours?: number;
}): CanonicalRoadCompletionBand {
  const punctuality = classifyDeliveryPunctuality({
    actualTravelHours: input.actualTravelHours,
    deadlineHours: input.deadlineHours,
    estimatedTravelHours: input.plannedTravelHours ?? input.deadlineHours,
    failed: input.outcome === 'FAILED',
  });
  switch (punctuality) {
    case 'failed':
      return 'FAILED';
    case 'early':
      return 'EARLY';
    case 'on-time':
      return 'ON_TIME';
    case 'late-minor':
      return 'LATE_MINOR';
    case 'late-major':
      return 'LATE_MAJOR';
    default:
      return 'ON_TIME';
  }
}

export function isPlausibleCanonicalTravelHours(
  actualTravelHours: number,
  deadlineHours: number,
): boolean {
  if (!Number.isFinite(actualTravelHours) || actualTravelHours < 0) return false;
  const maxHours = Math.max(deadlineHours * 3, 168);
  return actualTravelHours <= maxHours;
}

export function calculateCanonicalFragileSurcharge(input: {
  payment: number;
  contractType: CanonicalRoadContractTypeFreeze;
  frozenStartCondition: number;
  recommendedTruckCondition: number;
  /** Production uses truck condition at complete, before base wear (after incidents). */
  completionTruckCondition?: number;
}): number {
  if (input.contractType !== 'fragile') return 0;
  const condition =
    input.completionTruckCondition != null
      ? input.completionTruckCondition
      : input.frozenStartCondition;
  if (condition >= input.recommendedTruckCondition) return 0;
  return Math.round(input.payment * 0.05);
}

export function computeLiveParityRoadCompletion(input: {
  contract: CanonicalRoadExecutionContractBasis;
  truck: Truck;
  trailer: Trailer | null;
  fuelPricePerLiter: number;
  outcome: CanonicalRoadExecutionOutcome;
  actualTravelHours: number;
  contractType: CanonicalRoadContractTypeFreeze;
  penaltyMultiplier?: number;
  recommendedTruckCondition?: number;
}): {
  grossRevenue: number;
  maintenanceCost: number;
  tollExpense: number;
  latePenalty: number;
  failurePenalty: number;
  fragileSurcharge: number;
  penaltyCost: number;
  netCashDelta: number;
  fuelChargedOnCompletion: number;
  completionBand: CanonicalRoadCompletionBand;
} {
  const route = getRoute(input.contract.originCityId, input.contract.destinationCityId);
  if (!route) {
    throw new Error('UNSUPPORTED_ROUTE');
  }
  const product = PRODUCT_BY_ID[input.contract.productId as keyof typeof PRODUCT_BY_ID];
  const economics = calculateContractEconomics({
    contract: {
      payment: input.contract.payment,
      amount: input.contract.amount,
      distanceKm: input.contract.distanceKm,
      urgency: input.contract.urgency,
      contractType: input.contractType,
      riskLevel: 'low',
    },
    truck: input.truck,
    trailer: input.trailer,
    driver: null,
    route,
    globalEconomySnapshot: { fuelPricePerLiter: input.fuelPricePerLiter },
    activeEvents: [],
  });
  const maintenanceCost =
    economics.costs.maintenance +
    economics.costs.trailer +
    economics.costs.toll +
    economics.costs.other;
  const tollExpense = economics.costs.toll;
  const completionBand = classifyCanonicalRoadCompletionBand({
    outcome: input.outcome,
    deadlineHours: input.contract.deadlineHours,
    actualTravelHours: input.actualTravelHours,
  });
  if (input.outcome === 'FAILED') {
    const failurePenalty = Math.round(
      calculateFailurePenalty({ payment: input.contract.payment } as Contract),
    );
    return {
      grossRevenue: 0,
      maintenanceCost: 0,
      tollExpense,
      latePenalty: 0,
      failurePenalty,
      fragileSurcharge: 0,
      penaltyCost: failurePenalty,
      netCashDelta: -failurePenalty,
      fuelChargedOnCompletion: 0,
      completionBand,
    };
  }
  const rawLate = product
    ? calculateLatePenalty(
        {
          payment: input.contract.payment,
          deadlineHours: input.contract.deadlineHours,
        } as Contract,
        economics.estimatedDurationHours,
        input.actualTravelHours,
        product,
      )
    : 0;
  const typePenaltyMult = input.penaltyMultiplier ?? 1;
  const latePenalty = Math.round(rawLate * typePenaltyMult);
  const fragileSurcharge = calculateCanonicalFragileSurcharge({
    payment: input.contract.payment,
    contractType: input.contractType,
    frozenStartCondition: input.truck.condition,
    recommendedTruckCondition: input.recommendedTruckCondition ?? 70,
  });
  const penaltyCost = latePenalty + fragileSurcharge;
  const settlement = calculateDeliverySettlement({
    contractPayment: input.contract.payment,
    fuelCost: economics.costs.fuel,
    maintenanceCost,
    penaltyCost,
    fuelAlreadyPaid: true,
  });
  return {
    grossRevenue: settlement.grossRevenue,
    maintenanceCost: settlement.maintenanceCost,
    tollExpense,
    latePenalty,
    failurePenalty: 0,
    fragileSurcharge,
    penaltyCost: settlement.penaltyCost,
    netCashDelta: settlement.cashDeltaOnCompletion,
    fuelChargedOnCompletion: 0,
    completionBand,
  };
}

export type RoadSettlementMismatchCode =
  | 'GROSS_MISMATCH'
  | 'MAINTENANCE_MISMATCH'
  | 'TOLL_MISMATCH'
  | 'FRAGILE_SURCHARGE_MISMATCH'
  | 'LATE_PENALTY_MISMATCH'
  | 'FAILURE_PENALTY_MISMATCH'
  | 'FUEL_COMPLETION_MISMATCH'
  | 'NET_MISMATCH';

export function diagnoseRoadSettlementMismatch(input: {
  local: {
    grossRevenue: number;
    maintenanceCost: number;
    tollExpense?: number;
    latePenalty?: number;
    failurePenalty?: number;
    fragileSurcharge?: number;
    penaltyCost: number;
    netCashDelta: number;
    fuelChargedOnCompletion: number;
  };
  server: {
    grossRevenue: number;
    maintenanceCost: number;
    tollExpense?: number;
    latePenalty?: number;
    failurePenalty?: number;
    fragileSurcharge?: number;
    penaltyCost: number;
    netCashDelta: number;
    fuelChargedOnCompletion: number;
  } | null;
}): RoadSettlementMismatchCode[] {
  if (!input.server) return ['NET_MISMATCH'];
  const codes: RoadSettlementMismatchCode[] = [];
  const l = input.local;
  const s = input.server;
  if (l.grossRevenue !== s.grossRevenue) codes.push('GROSS_MISMATCH');
  if (l.maintenanceCost !== s.maintenanceCost) codes.push('MAINTENANCE_MISMATCH');
  if (l.tollExpense != null && s.tollExpense != null && l.tollExpense !== s.tollExpense) {
    codes.push('TOLL_MISMATCH');
  }
  if (l.fragileSurcharge != null && s.fragileSurcharge !== l.fragileSurcharge) {
    codes.push('FRAGILE_SURCHARGE_MISMATCH');
  }
  if (l.latePenalty != null && s.latePenalty !== l.latePenalty) {
    codes.push('LATE_PENALTY_MISMATCH');
  }
  if (l.failurePenalty != null && s.failurePenalty !== l.failurePenalty) {
    codes.push('FAILURE_PENALTY_MISMATCH');
  }
  if (l.fuelChargedOnCompletion !== s.fuelChargedOnCompletion) {
    codes.push('FUEL_COMPLETION_MISMATCH');
  }
  if (l.netCashDelta !== s.netCashDelta) codes.push('NET_MISMATCH');
  return codes;
}
