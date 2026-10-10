/**
 * Canonical ROAD delivery identity, gates, and policy versions (Map V2 Step 29F).
 *
 * Pure. No React. No Firebase. Does not mutate money.
 *
 * Live ROAD settlement remains local. This module does not enable HUD overlay.
 */

export const CANONICAL_ROAD_DELIVERY_ECONOMY_STATUS =
  'CANONICAL_ROAD_DELIVERY_ECONOMY_PASS_SHADOW_ONLY' as const;

export const CANONICAL_ROAD_CONTRACT_AUTHORITY =
  'CANONICAL_ROAD_CONTRACT_ISSUANCE_REQUIRED' as const;

export const CANONICAL_ROAD_CONTRACT_GENERATION_CLASS =
  'CLIENT_WORLD_STATE_DEPENDENT' as const;

export const CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION = 1 as const;
export const CANONICAL_ROAD_PAYMENT_POLICY_VERSION = 'road-contract-payment-v1' as const;
export const CANONICAL_ROAD_DEADLINE_POLICY_VERSION = 'road-deadline-v1' as const;
export const CANONICAL_ROAD_SETTLEMENT_POLICY_VERSION = 'road-delivery-settlement-v1' as const;
export const CANONICAL_ROAD_ROUTE_PACKAGE_ID = 'src/data/routes.ts' as const;

export const CANONICAL_ROAD_DELIVERIES_COLLECTION = 'canonicalRoadDeliveries' as const;
export const CANONICAL_ROAD_CONTRACTS_COLLECTION = 'canonicalRoadContracts' as const;

export const CANONICAL_ROAD_ECONOMY_ENV_KEY = 'EXPO_PUBLIC_CANONICAL_ROAD_ECONOMY' as const;

export type CanonicalRoadEconomyGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalRoadEconomyGate(options?: {
  envValue?: string | null;
}): CanonicalRoadEconomyGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.EXPO_PUBLIC_CANONICAL_ROAD_ECONOMY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalRoadEconomyInternalTest(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalRoadEconomyGate(options) === 'INTERNAL_TEST';
}

export type CanonicalRoadLifecycleState =
  | 'ACCEPTED'
  | 'COMPLETION_REPORTED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SETTLED';

export type CanonicalRoadCostClass =
  | 'ACCEPTANCE_FROZEN'
  | 'EXECUTION_DERIVED'
  | 'COMPLETION_DERIVED'
  | 'LOCAL_ONLY'
  | 'NOT_CHARGED';

export const CANONICAL_ROAD_COST_CLASSES = {
  fuelAtCompletion: 'NOT_CHARGED',
  maintenanceBundleAtStart: 'ACCEPTANCE_FROZEN',
  toll: 'ACCEPTANCE_FROZEN',
  driverAtCompletion: 'NOT_CHARGED',
  latePenalty: 'COMPLETION_DERIVED',
  failurePenalty: 'COMPLETION_DERIVED',
  fragileConditionSurcharge: 'COMPLETION_DERIVED',
  executionTravelHours: 'COMPLETION_DERIVED',
} as const satisfies Record<string, CanonicalRoadCostClass>;

export const LEGACY_LOCAL_ONLY_DELIVERY = 'LEGACY_LOCAL_ONLY_DELIVERY' as const;

export type CanonicalRoadAcceptRequest = {
  contractId: string;
  canonicalSchemaVersion: number;
  originCityId?: string;
  destinationCityId?: string;
  productId?: string;
  cargoAmount?: number;
  selectedTruckId?: string;
  selectedTrailerId?: string;
  selectedDriverId?: string;
  canonicalTruckAssetId?: string;
  canonicalTrailerAssetId?: string;
};

const ACCEPT_KEYS = new Set([
  'contractId',
  'originCityId',
  'destinationCityId',
  'productId',
  'cargoAmount',
  'canonicalSchemaVersion',
  'selectedTruckId',
  'selectedTrailerId',
  'selectedDriverId',
  'canonicalTruckAssetId',
  'canonicalTrailerAssetId',
]);

/** Step 29AG: risk / driver / XP inputs are server-derived; clients may never send them. */
export const CANONICAL_DRIVER_RISK_FORBIDDEN_CLIENT_KEYS = [
  'driverAttention',
  'driverSpeed',
  'driverFuelSaving',
  'driverLevel',
  'driverTier',
  'driverStats',
  'truckReliability',
  'riskTier',
  'riskBonus',
  'riskScore',
  'breakdownChance',
  'accidentChance',
  'netProfit',
  'completionXp',
  'xpReward',
] as const;

const FORBIDDEN_MONEY_KEYS = [
  'finalPayment',
  'payment',
  'netProfit',
  'profit',
  'net',
  'maintenanceCost',
  'maintenanceBundle',
  'fuelCost',
  'tollCost',
  'penalty',
  'latePenalty',
  'failurePenalty',
  'fragileSurcharge',
  'grossRevenue',
  'netCashDelta',
  'cashDelta',
  'amountDelta',
  'condition',
  'upgrades',
  'timingClassification',
  'completedAtMs',
  'elapsedGameHours',
  'clientCompletedAt',
  'expiresAt',
  'expiresAtMs',
  'expiresAtGameHours',
  'issuedAt',
  'gameTime',
  'offerAge',
  'clockRevision',
  'currentGameTime',
  ...CANONICAL_DRIVER_RISK_FORBIDDEN_CLIENT_KEYS,
];

export function hasOnlyCanonicalRoadAcceptKeys(data: Record<string, unknown>): boolean {
  if (FORBIDDEN_MONEY_KEYS.some((key) => key in data)) {
    return false;
  }
  return Object.keys(data).every((key) => ACCEPT_KEYS.has(key));
}

export function hasOnlyCanonicalRoadCompleteKeys(data: Record<string, unknown>): boolean {
  if (FORBIDDEN_MONEY_KEYS.some((key) => key in data)) {
    return false;
  }
  return Object.keys(data).every((key) =>
    ['deliveryId', 'outcome', 'actualTravelHours', 'canonicalSchemaVersion'].includes(key),
  );
}

export function isValidCanonicalRoadDocId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

export function createCanonicalRoadContractId(input: {
  originCityId: string;
  destinationCityId: string;
  productId: string;
  amountTenths: number;
  sequence: number;
}): string {
  return `crc_${input.originCityId}_${input.destinationCityId}_${input.productId}_${input.amountTenths}_${input.sequence}`;
}

export function createCanonicalRoadDeliveryId(contractId: string): string {
  return `crd_${contractId}`;
}

export function createIssuedCanonicalRoadContractId(batchId: string, sequence: number): string {
  return `crc_${batchId}_${sequence}`;
}

export function createCanonicalRoadBatchId(windowId: number): string {
  return `crb${windowId}`;
}

export function amountToTenths(amount: number): number {
  return Math.round(amount * 10);
}
