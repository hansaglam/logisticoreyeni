/**
 * Canonical ROAD server-cash shadow settlement (Map V2 Step 29K).
 *
 * INTERNAL_TEST only. Mutates serverState.cash for supported canonical jobs.
 * Does not change HUD / player.money. Pure. No React. No Firebase.
 */

import type { CanonicalRoadSettlementPrepared } from './canonicalRoadEconomics';
import type { CanonicalRoadExecutionEconomicsSnapshot } from './canonicalRoadExecutionEconomics';
import { CANONICAL_ROAD_TIMING_POLICY_VERSION } from './canonicalRoadTiming';
import { CANONICAL_CASH_CURRENCY } from './canonicalCashOperation';
import { CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION } from './canonicalRoadDelivery';

export const CANONICAL_ROAD_SERVER_CASH_SHADOW_STATUS =
  'CANONICAL_ROAD_SERVER_CASH_SHADOW_SETTLEMENT_PASS' as const;

export const CANONICAL_ROAD_SETTLEMENT_SCHEMA_VERSION = 1 as const;
export const CANONICAL_ROAD_SETTLEMENTS_COLLECTION = 'canonicalRoadSettlements' as const;

export const CANONICAL_ROAD_SERVER_CASH_SHADOW_ENV_KEY =
  'EXPO_PUBLIC_CANONICAL_ROAD_SERVER_CASH_SHADOW' as const;
export const CANONICAL_ROAD_SERVER_CASH_SHADOW_BACKEND_ENV =
  'CANONICAL_ROAD_SERVER_CASH_SHADOW' as const;

export const CANONICAL_ROAD_SHADOW_AUTHORITY_MODE =
  'INTERNAL_TEST_SERVER_CASH_SHADOW' as const;

export const LOCAL_SETTLEMENT_AUTHORITY = 'LOCAL_HUD_SAVE_PLAYER_MONEY' as const;
export const SERVER_SHADOW_SETTLEMENT_AUTHORITY = 'SERVER_STATE_CASH_DIAGNOSTIC' as const;

export const SERVER_CASH_OVERDRAFT_POLICY =
  'ROAD_SERVER_SETTLEMENT_BLOCKED_OVERDRAFT_POLICY' as const;

export type CanonicalRoadServerCashShadowGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalRoadServerCashShadowGate(options?: {
  envValue?: string | null;
}): CanonicalRoadServerCashShadowGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.EXPO_PUBLIC_CANONICAL_ROAD_SERVER_CASH_SHADOW ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalRoadServerCashShadowAllowed(options?: {
  envValue?: string | null;
}): boolean {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_ROAD_SERVER_CASH_SHADOW ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST';
}

export type CanonicalRoadSettlementSupport =
  | 'SETTLEMENT_SUPPORTED_INTERNAL_STANDARD'
  | 'UNSUPPORTED_LEGACY_DELIVERY'
  | 'UNSUPPORTED_NONCANONICAL_CONTRACT'
  | 'UNSUPPORTED_PRODUCTION_FLEET'
  | 'UNSUPPORTED_FRAGILE_AUTHORITY'
  | 'UNSUPPORTED_FAILURE_AUTHORITY'
  | 'UNSUPPORTED_SCHEMA'
  | 'UNSUPPORTED_TIMING_AUTHORITY'
  | 'UNSUPPORTED_EXECUTION_SNAPSHOT'
  | 'UNSUPPORTED_COMPLETION_STATE'
  | 'UNSUPPORTED_CANCELLED'
  | 'ALREADY_SETTLED'
  | 'ACTIVE_DELIVERY'
  | 'COMPLETION_NOT_REPORTED';

export type CanonicalRoadSettlementState = 'NOT_SETTLED' | 'SETTLED';

export type CanonicalRoadShadowDeliveryView = {
  deliveryId?: string | null;
  ownerUid?: string | null;
  sourceCanonicalContractId?: string | null;
  canonicalSchemaVersion?: number | null;
  lifecycleState?: string | null;
  settlementState?: CanonicalRoadSettlementState | null;
  completionOutcome?: string | null;
  contractType?: string | null;
  failureAuthorityClass?: string | null;
  executionEconomicsSnapshot?: CanonicalRoadExecutionEconomicsSnapshot | null;
  timingSnapshot?: {
    timingPolicyVersion?: string | null;
    derivedActualTravelHours?: number | null;
    derivedTimingClassification?: string | null;
    completedAtServerMs?: number | null;
  } | null;
  derivedSettlement?: CanonicalRoadSettlementPrepared | null;
};

export function createCanonicalRoadSettlementOperationId(deliveryId: string): string {
  return `roadDelivery:${deliveryId}:settlement`;
}

export function classifyCanonicalRoadSettlementSupport(
  delivery: CanonicalRoadShadowDeliveryView | null | undefined,
): CanonicalRoadSettlementSupport {
  if (!delivery || !delivery.deliveryId) {
    return 'UNSUPPORTED_LEGACY_DELIVERY';
  }
  if (delivery.canonicalSchemaVersion !== CANONICAL_ROAD_DELIVERY_SCHEMA_VERSION) {
    return 'UNSUPPORTED_SCHEMA';
  }
  if (!delivery.sourceCanonicalContractId) {
    return 'UNSUPPORTED_NONCANONICAL_CONTRACT';
  }
  if (delivery.settlementState === 'SETTLED' || delivery.lifecycleState === 'SETTLED') {
    return 'ALREADY_SETTLED';
  }
  if (delivery.lifecycleState === 'CANCELLED') {
    return 'UNSUPPORTED_CANCELLED';
  }
  if (delivery.lifecycleState === 'ACCEPTED') {
    return 'ACTIVE_DELIVERY';
  }
  if (delivery.lifecycleState === 'FAILED' || delivery.completionOutcome === 'FAILED') {
    if (delivery.failureAuthorityClass !== 'SERVER_DERIVED_FAILURE') {
      return 'UNSUPPORTED_FAILURE_AUTHORITY';
    }
  } else if (delivery.lifecycleState !== 'COMPLETION_REPORTED') {
    return 'COMPLETION_NOT_REPORTED';
  } else if (delivery.completionOutcome !== 'COMPLETED') {
    return 'UNSUPPORTED_COMPLETION_STATE';
  }
  const execution = delivery.executionEconomicsSnapshot;
  if (!execution) {
    return 'UNSUPPORTED_EXECUTION_SNAPSHOT';
  }
  if (execution.truckEconomicProfile.source !== 'CANONICAL_FLEET_ASSET') {
    return 'UNSUPPORTED_PRODUCTION_FLEET';
  }
  if (execution.fragilityPolicySnapshot.contractType === 'fragile') {
    if (execution.completionTruckCondition == null) {
      return 'UNSUPPORTED_FRAGILE_AUTHORITY';
    }
  }
  const timing = delivery.timingSnapshot;
  if (
    !timing ||
    timing.timingPolicyVersion !== CANONICAL_ROAD_TIMING_POLICY_VERSION ||
    timing.derivedActualTravelHours == null ||
    timing.completedAtServerMs == null
  ) {
    return 'UNSUPPORTED_TIMING_AUTHORITY';
  }
  return 'SETTLEMENT_SUPPORTED_INTERNAL_STANDARD';
}

export function hasOnlyCanonicalRoadSettleKeys(data: Record<string, unknown>): boolean {
  const forbidden = [
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
    'transactionId',
    'transactionIds',
  ];
  if (forbidden.some((key) => key in data)) {
    return false;
  }
  return Object.keys(data).every((key) => key === 'deliveryId' || key === 'canonicalSchemaVersion');
}

export type CanonicalRoadSettlementReceipt = {
  settlementSchemaVersion: typeof CANONICAL_ROAD_SETTLEMENT_SCHEMA_VERSION;
  settlementOperationId: string;
  deliveryId: string;
  sourceContractId: string;
  ownerUid: string;
  grossRevenue: number;
  maintenanceCost: number;
  maintenanceExpense: number;
  tollExpense: number;
  latePenalty: number;
  failurePenalty: number;
  fragileSurcharge: number;
  penaltyCost: number;
  netCashDelta: number;
  cashBefore: number;
  cashAfter: number;
  currency: typeof CANONICAL_CASH_CURRENCY;
  transactionIds: string[];
  completionBand: string;
  authorityMode: typeof CANONICAL_ROAD_SHADOW_AUTHORITY_MODE;
  paymentPolicyVersion: string;
  settlementPolicyVersion: string;
  timingPolicyVersion: string;
  executionEconomicsSchemaVersion: number;
  settledAtMs: number;
};

export function canUseInternalCanonicalRoadServerCashShadow(input: {
  clientGate: CanonicalRoadServerCashShadowGate;
  backendAllowed: boolean;
  support: CanonicalRoadSettlementSupport;
  serverStateCashPresent: boolean;
}): { ready: boolean; reason: string } {
  if (input.clientGate !== 'INTERNAL_TEST' || !input.backendAllowed) {
    return { ready: false, reason: 'CANONICAL_ROAD_SERVER_CASH_SHADOW_OFF' };
  }
  if (!input.serverStateCashPresent) {
    return { ready: false, reason: 'SERVER_STATE_MISSING' };
  }
  if (input.support !== 'SETTLEMENT_SUPPORTED_INTERNAL_STANDARD') {
    return { ready: false, reason: input.support };
  }
  return { ready: true, reason: 'SETTLEMENT_SUPPORTED_INTERNAL_STANDARD' };
}

export function localShadowDomainsRemainIsolated(): {
  hudAuthority: typeof LOCAL_SETTLEMENT_AUTHORITY;
  serverAuthority: typeof SERVER_SHADOW_SETTLEMENT_AUTHORITY;
} {
  return {
    hudAuthority: LOCAL_SETTLEMENT_AUTHORITY,
    serverAuthority: SERVER_SHADOW_SETTLEMENT_AUTHORITY,
  };
}
