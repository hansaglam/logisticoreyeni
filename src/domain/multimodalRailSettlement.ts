/**
 * ROAD→RAIL→ROAD settlement (Map V2 Step 29B).
 *
 * Frozen accepted snapshots only. No offer/tariff/duration recalculation.
 * Guest/local atomic ledger apply. Signed-in server path is blocked until a
 * canonical shipment record exists (save blob is client-controlled LWW).
 */

import type { FinanceLedgerEntry, FinanceTotals } from '../types/game';
import { addFinanceLedgerEntries } from '../utils/financeLedger';
import {
  getMultimodalCompletionId,
  getMultimodalSettlementId,
} from './multimodalSettlementIdentity';
import {
  isExecutablePersistedMultimodalShipment,
  isUnreadablePersistedMultimodalShipment,
  type PersistedMultimodalShipment,
  type PersistedReadableMultimodalShipment,
} from './multimodalShipmentPersistence';

export const MULTIMODAL_RAIL_SETTLEMENT_POLICY_VERSION = 'multimodal-rail-settlement-v1' as const;

export const MULTIMODAL_RAIL_CARRIER_LEDGER_KIND = 'rail_carrier' as const;

export const MULTIMODAL_LEDGER_CATEGORY_REVENUE = 'multimodal_revenue' as const;
export const MULTIMODAL_LEDGER_CATEGORY_RAIL_CARRIER = 'rail_carrier_expense' as const;

export const ROAD_ACCESS_OPEX_SETTLEMENT_TREATMENT = 'PLANNING_ESTIMATE_NOT_CHARGED' as const;

export const SERVER_SETTLEMENT_BLOCK_REASON =
  'SERVER_SETTLEMENT_BLOCKED_MISSING_AUTHORITATIVE_SHIPMENT_STATE' as const;

export type MultimodalSettlementAuthority =
  | 'LOCAL_OFFLINE_AUTHORITATIVE'
  | 'SERVER_AUTHORITATIVE'
  | 'NOT_SETTLEABLE'
  | typeof SERVER_SETTLEMENT_BLOCK_REASON;

export type MultimodalRailSettlementStatus =
  | 'READY'
  | 'ALREADY_SETTLED'
  | 'FEATURE_DISABLED'
  | 'NOT_SETTLEABLE'
  | typeof SERVER_SETTLEMENT_BLOCK_REASON
  | 'ACTIVE_SHIPMENT'
  | 'CANCELLED_SHIPMENT'
  | 'FAILED_SHIPMENT'
  | 'NOT_COMPLETED'
  | 'UNSUPPORTED_SCHEMA'
  | 'ROUTE_UNSUPPORTED'
  | 'SEA_NOT_ACTIVATED'
  | 'AIR_NOT_ACTIVATED'
  | 'INVALID_ECONOMIC_SNAPSHOT'
  | 'INVALID_TARIFF_SNAPSHOT'
  | 'UNSUPPORTED_CURRENCY'
  | 'SETTLEMENT_STATE_CONFLICT'
  | 'LEGACY_INTERNAL_TEST_SHIPMENT_NOT_SETTLEABLE'
  | 'COMMIT_FAILED';

export type MultimodalRailSettlementReceipt = {
  shipmentId: string;
  settlementStatus: 'READY' | 'SETTLED' | 'ALREADY_SETTLED';
  authority: MultimodalSettlementAuthority;
  policyVersion: typeof MULTIMODAL_RAIL_SETTLEMENT_POLICY_VERSION;
  grossRevenue: number;
  railCarrierExpense: number;
  netCashDelta: number;
  roadAccessOpexTreatment: typeof ROAD_ACCESS_OPEX_SETTLEMENT_TREATMENT;
  estimatedRoadOperatingCost?: number;
  revenueTransactionId: string;
  expenseTransactionId: string;
  completionId: string;
  settlementId: string;
  settledAt?: number;
};

export type PrepareMultimodalRailSettlementResult =
  | {
      status: 'READY';
      reason: 'READY';
      shipmentId: string;
      receipt: MultimodalRailSettlementReceipt;
      shipment: PersistedReadableMultimodalShipment;
    }
  | {
      status: 'ALREADY_SETTLED';
      reason: 'ALREADY_SETTLED';
      shipmentId: string;
      receipt: MultimodalRailSettlementReceipt;
    }
  | {
      status: Exclude<MultimodalRailSettlementStatus, 'READY' | 'ALREADY_SETTLED'>;
      reason: string;
      shipmentId?: string;
    };

export type CommitMultimodalRailSettlementResult =
  | {
      status: 'SETTLED';
      shipmentId: string;
      receipt: MultimodalRailSettlementReceipt;
      playerMoney: number;
      financeLedger: FinanceLedgerEntry[];
      financeTotals: FinanceTotals;
      multimodalShipments: PersistedMultimodalShipment[];
      reputation: number;
      xp: number;
    }
  | {
      status: 'ALREADY_SETTLED';
      shipmentId: string;
      receipt: MultimodalRailSettlementReceipt;
      playerMoney: number;
      financeLedger: FinanceLedgerEntry[];
      financeTotals: FinanceTotals;
      multimodalShipments: PersistedMultimodalShipment[];
      reputation: number;
      xp: number;
    }
  | {
      status: Exclude<MultimodalRailSettlementStatus, 'READY' | 'SETTLED' | 'ALREADY_SETTLED'>;
      reason: string;
      shipmentId?: string;
      playerMoney: number;
      financeLedger: FinanceLedgerEntry[];
      financeTotals: FinanceTotals;
      multimodalShipments: PersistedMultimodalShipment[];
      reputation: number;
      xp: number;
    };

const ACCEPTED_CURRENCIES = new Set(['USD_GAME', 'USD_GAME_INTEGER']);

function isSafeNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function getMultimodalRailCarrierExpenseId(shipmentId: string): string {
  return `shipment:${shipmentId}:${MULTIMODAL_RAIL_CARRIER_LEDGER_KIND}`;
}

export function resolveMultimodalSettlementAuthority(input: {
  signedInLinked?: boolean;
}): MultimodalSettlementAuthority {
  if (input.signedInLinked === true) {
    return SERVER_SETTLEMENT_BLOCK_REASON;
  }
  return 'LOCAL_OFFLINE_AUTHORITATIVE';
}

export function classifyMultimodalRailSettlement(
  input: Parameters<typeof prepareMultimodalRailSettlement>[0],
): PrepareMultimodalRailSettlementResult {
  return prepareMultimodalRailSettlement(input);
}

function ledgerHasId(ledger: readonly FinanceLedgerEntry[] | undefined, id: string): boolean {
  return (ledger ?? []).some(
    (row) => row.transactionId === id || row.referenceId === id || row.id === id,
  );
}

function isSettledShipment(shipment: PersistedReadableMultimodalShipment): boolean {
  return shipment.settlementState === 'SETTLED' || shipment.status === 'COMPLETED';
}

export function prepareMultimodalRailSettlement(input: {
  shipmentId: string;
  shipments: readonly PersistedMultimodalShipment[];
  financeLedger?: readonly FinanceLedgerEntry[];
  allowSettlement?: boolean;
  signedInLinked?: boolean;
  authority?: MultimodalSettlementAuthority;
  transportPatternOverride?: string;
}): PrepareMultimodalRailSettlementResult {
  if (input.allowSettlement === false) {
    return { status: 'FEATURE_DISABLED', reason: 'INTERNAL_TEST_REQUIRED', shipmentId: input.shipmentId };
  }

  const authority =
    input.authority ?? resolveMultimodalSettlementAuthority({ signedInLinked: input.signedInLinked });
  if (authority === SERVER_SETTLEMENT_BLOCK_REASON) {
    return {
      status: SERVER_SETTLEMENT_BLOCK_REASON,
      reason: SERVER_SETTLEMENT_BLOCK_REASON,
      shipmentId: input.shipmentId,
    };
  }
  if (authority === 'NOT_SETTLEABLE' || authority === 'SERVER_AUTHORITATIVE') {
    return {
      status: 'NOT_SETTLEABLE',
      reason: authority,
      shipmentId: input.shipmentId,
    };
  }

  const pattern = input.transportPatternOverride;
  if (pattern === 'ROAD_SEA_ROAD') {
    return { status: 'SEA_NOT_ACTIVATED', reason: 'SEA_NOT_ACTIVATED', shipmentId: input.shipmentId };
  }
  if (pattern === 'ROAD_AIR_ROAD') {
    return { status: 'AIR_NOT_ACTIVATED', reason: 'AIR_NOT_ACTIVATED', shipmentId: input.shipmentId };
  }

  const raw = input.shipments.find((row) => {
    if (isUnreadablePersistedMultimodalShipment(row)) {
      return row.shipmentId === input.shipmentId;
    }
    return row.shipmentId === input.shipmentId;
  });
  if (!raw) {
    return { status: 'UNSUPPORTED_SCHEMA', reason: 'SHIPMENT_NOT_FOUND', shipmentId: input.shipmentId };
  }
  if (isUnreadablePersistedMultimodalShipment(raw)) {
    return { status: 'UNSUPPORTED_SCHEMA', reason: 'UNSUPPORTED_SCHEMA', shipmentId: input.shipmentId };
  }
  if (!isExecutablePersistedMultimodalShipment(raw)) {
    return { status: 'UNSUPPORTED_SCHEMA', reason: 'UNSUPPORTED_SCHEMA', shipmentId: input.shipmentId };
  }

  if (raw.transportPattern === 'ROAD_SEA_ROAD') {
    return { status: 'SEA_NOT_ACTIVATED', reason: 'SEA_NOT_ACTIVATED', shipmentId: raw.shipmentId };
  }
  if (raw.transportPattern === 'ROAD_AIR_ROAD') {
    return { status: 'AIR_NOT_ACTIVATED', reason: 'AIR_NOT_ACTIVATED', shipmentId: raw.shipmentId };
  }
  if (raw.transportPattern != null && raw.transportPattern !== 'ROAD_RAIL_ROAD') {
    return { status: 'ROUTE_UNSUPPORTED', reason: 'ROUTE_UNSUPPORTED', shipmentId: raw.shipmentId };
  }

  if (raw.status === 'CANCELLED') {
    return { status: 'CANCELLED_SHIPMENT', reason: 'CANCELLED_SHIPMENT', shipmentId: raw.shipmentId };
  }
  if (raw.status === 'FAILED') {
    return { status: 'FAILED_SHIPMENT', reason: 'FAILED_SHIPMENT', shipmentId: raw.shipmentId };
  }
  if (raw.status === 'ACTIVE' || raw.status === 'PLANNED' || raw.status === 'BLOCKED') {
    return { status: 'ACTIVE_SHIPMENT', reason: 'ACTIVE_SHIPMENT', shipmentId: raw.shipmentId };
  }

  const settlementId = getMultimodalSettlementId(raw.shipmentId);
  const completionId = getMultimodalCompletionId(raw.shipmentId);
  if (!settlementId.ok || !completionId.ok) {
    return { status: 'UNSUPPORTED_SCHEMA', reason: 'INVALID_IDENTITY', shipmentId: raw.shipmentId };
  }
  const expenseId = getMultimodalRailCarrierExpenseId(raw.shipmentId);
  const revenuePresent = ledgerHasId(input.financeLedger, settlementId.id);
  const expensePresent = ledgerHasId(input.financeLedger, expenseId);

  const economics = raw.economicSnapshot;
  const tariff = raw.railTariffSnapshot;
  const payment = economics?.playerPayment;
  const railFromEcon = economics?.railCarrierCost;
  const railFromTariff = tariff?.railCarrierCost;
  const currency = economics?.currency;

  const snapshotReady =
    economics != null &&
    ACCEPTED_CURRENCIES.has(String(currency ?? '')) &&
    isSafeNonNegInt(payment) &&
    payment > 0 &&
    isSafeNonNegInt(railFromEcon) &&
    (railFromTariff == null || (isSafeNonNegInt(railFromTariff) && railFromTariff === railFromEcon));

  if (isSettledShipment(raw)) {
    if (!snapshotReady) {
      return {
        status: 'SETTLEMENT_STATE_CONFLICT',
        reason: 'SETTLEMENT_STATE_CONFLICT',
        shipmentId: raw.shipmentId,
      };
    }
    const receipt = buildReceipt(raw, settlementId.id, expenseId, completionId.id, authority, payment, railFromEcon);
    return {
      status: 'ALREADY_SETTLED',
      reason: 'ALREADY_SETTLED',
      shipmentId: raw.shipmentId,
      receipt: {
        ...receipt,
        settlementStatus: 'ALREADY_SETTLED',
        settledAt: raw.settlement?.settledAt,
      },
    };
  }

  if (raw.status !== 'COMPLETED_UNSETTLED' || raw.executionStage !== 'COMPLETED_UNSETTLED') {
    return { status: 'NOT_COMPLETED', reason: 'NOT_COMPLETED', shipmentId: raw.shipmentId };
  }

  if (raw.settlementState != null && raw.settlementState !== 'NOT_SETTLED') {
    if (raw.settlementState === 'SETTLEMENT_PENDING' || raw.settlementState === 'SERVER_CONFIRMATION_PENDING') {
      return {
        status: SERVER_SETTLEMENT_BLOCK_REASON,
        reason: SERVER_SETTLEMENT_BLOCK_REASON,
        shipmentId: raw.shipmentId,
      };
    }
    if (raw.settlementState === 'SETTLEMENT_FAILED') {
      return { status: 'COMMIT_FAILED', reason: 'SETTLEMENT_FAILED', shipmentId: raw.shipmentId };
    }
  }

  if (revenuePresent || expensePresent) {
    return {
      status: 'SETTLEMENT_STATE_CONFLICT',
      reason: 'SETTLEMENT_STATE_CONFLICT',
      shipmentId: raw.shipmentId,
    };
  }

  if (!economics || payment == null || railFromEcon == null) {
    return {
      status: 'LEGACY_INTERNAL_TEST_SHIPMENT_NOT_SETTLEABLE',
      reason: 'LEGACY_INTERNAL_TEST_SHIPMENT_NOT_SETTLEABLE',
      shipmentId: raw.shipmentId,
    };
  }
  if (currency != null && !ACCEPTED_CURRENCIES.has(String(currency))) {
    return { status: 'UNSUPPORTED_CURRENCY', reason: 'UNSUPPORTED_CURRENCY', shipmentId: raw.shipmentId };
  }
  if (currency == null) {
    return { status: 'UNSUPPORTED_CURRENCY', reason: 'UNSUPPORTED_CURRENCY', shipmentId: raw.shipmentId };
  }
  if (!Number.isFinite(payment) || Number.isNaN(payment) || !Number.isFinite(railFromEcon)) {
    return { status: 'INVALID_ECONOMIC_SNAPSHOT', reason: 'INVALID_ECONOMIC_SNAPSHOT', shipmentId: raw.shipmentId };
  }
  if (payment === Number.POSITIVE_INFINITY || railFromEcon === Number.POSITIVE_INFINITY) {
    return { status: 'INVALID_ECONOMIC_SNAPSHOT', reason: 'INVALID_ECONOMIC_SNAPSHOT', shipmentId: raw.shipmentId };
  }
  if (!isSafeNonNegInt(payment) || payment <= 0) {
    return { status: 'INVALID_ECONOMIC_SNAPSHOT', reason: 'NEGATIVE_OR_UNSAFE_REVENUE', shipmentId: raw.shipmentId };
  }
  if (!isSafeNonNegInt(railFromEcon)) {
    return { status: 'INVALID_ECONOMIC_SNAPSHOT', reason: 'NEGATIVE_OR_UNSAFE_RAIL_COST', shipmentId: raw.shipmentId };
  }
  if (tariff && isSafeNonNegInt(railFromTariff) && railFromTariff !== railFromEcon) {
    return { status: 'INVALID_TARIFF_SNAPSHOT', reason: 'TARIFF_COST_MISMATCH', shipmentId: raw.shipmentId };
  }
  const net = payment - railFromEcon;
  if (!Number.isSafeInteger(net)) {
    return { status: 'INVALID_ECONOMIC_SNAPSHOT', reason: 'UNSAFE_NET', shipmentId: raw.shipmentId };
  }

  const receipt = buildReceipt(raw, settlementId.id, expenseId, completionId.id, authority, payment, railFromEcon);
  return {
    status: 'READY',
    reason: 'READY',
    shipmentId: raw.shipmentId,
    receipt,
    shipment: raw,
  };
}

function buildReceipt(
  shipment: PersistedReadableMultimodalShipment,
  settlementId: string,
  expenseId: string,
  completionId: string,
  authority: MultimodalSettlementAuthority,
  grossRevenue: number,
  railCarrierExpense: number,
): MultimodalRailSettlementReceipt {
  const estimated = shipment.economicSnapshot?.estimatedRoadOperatingCost;
  return {
    shipmentId: shipment.shipmentId,
    settlementStatus: 'READY',
    authority,
    policyVersion: MULTIMODAL_RAIL_SETTLEMENT_POLICY_VERSION,
    grossRevenue,
    railCarrierExpense,
    netCashDelta: grossRevenue - railCarrierExpense,
    roadAccessOpexTreatment: ROAD_ACCESS_OPEX_SETTLEMENT_TREATMENT,
    ...(typeof estimated === 'number' ? { estimatedRoadOperatingCost: estimated } : {}),
    revenueTransactionId: settlementId,
    expenseTransactionId: expenseId,
    completionId,
    settlementId,
  };
}

export function buildMultimodalRailLedgerEntries(input: {
  receipt: MultimodalRailSettlementReceipt;
  currentTime: number;
}): Array<Omit<FinanceLedgerEntry, 'id'> & { id: string }> {
  const { receipt, currentTime } = input;
  const entries: Array<Omit<FinanceLedgerEntry, 'id'> & { id: string }> = [
    {
      id: receipt.revenueTransactionId,
      time: currentTime,
      type: 'income',
      category: MULTIMODAL_LEDGER_CATEGORY_REVENUE,
      amount: receipt.grossRevenue,
      title: 'Çok modlu ödeme',
      description: 'Demiryolu sevkiyat geliri',
      transactionId: receipt.revenueTransactionId,
      referenceId: receipt.revenueTransactionId,
    },
  ];
  if (receipt.railCarrierExpense > 0) {
    entries.push({
      id: receipt.expenseTransactionId,
      time: currentTime,
      type: 'expense',
      category: MULTIMODAL_LEDGER_CATEGORY_RAIL_CARRIER,
      amount: receipt.railCarrierExpense,
      title: 'Demiryolu taşıyıcı maliyeti',
      description: 'Üçüncü taraf demiryolu taşıyıcı gideri',
      transactionId: receipt.expenseTransactionId,
      referenceId: receipt.expenseTransactionId,
    });
  }
  return entries;
}

export function commitMultimodalRailSettlement(input: {
  prepared: PrepareMultimodalRailSettlementResult;
  shipments: readonly PersistedMultimodalShipment[];
  financeLedger: readonly FinanceLedgerEntry[];
  financeTotals?: FinanceTotals;
  playerMoney: number;
  reputation: number;
  xp: number;
  currentTime: number;
  nowMs: number;
  simulateFailure?: boolean;
}): CommitMultimodalRailSettlementResult {
  const unchanged = {
    playerMoney: input.playerMoney,
    financeLedger: [...input.financeLedger],
    financeTotals: input.financeTotals ?? {
      totalIncome: 0,
      totalExpense: 0,
      netProfit: 0,
      incomeByCategory: {},
      expenseByCategory: {},
    },
    multimodalShipments: [...input.shipments],
    reputation: input.reputation,
    xp: input.xp,
  };

  if (input.prepared.status === 'ALREADY_SETTLED') {
    return {
      status: 'ALREADY_SETTLED',
      shipmentId: input.prepared.shipmentId,
      receipt: input.prepared.receipt,
      ...unchanged,
    };
  }
  if (input.prepared.status !== 'READY') {
    return {
      status: input.prepared.status,
      reason: input.prepared.reason,
      shipmentId: input.prepared.shipmentId,
      ...unchanged,
    };
  }

  if (input.simulateFailure) {
    return {
      status: 'COMMIT_FAILED',
      reason: 'SIMULATED_FAILURE',
      shipmentId: input.prepared.shipmentId,
      ...unchanged,
    };
  }

  const receipt = input.prepared.receipt;
  const nextMoney = input.playerMoney + receipt.netCashDelta;
  if (!Number.isFinite(nextMoney) || !Number.isSafeInteger(nextMoney)) {
    return {
      status: 'INVALID_ECONOMIC_SNAPSHOT',
      reason: 'UNSAFE_MONEY_DELTA',
      shipmentId: receipt.shipmentId,
      ...unchanged,
    };
  }

  const ledgerEntries = buildMultimodalRailLedgerEntries({
    receipt,
    currentTime: input.currentTime,
  });
  const patched = addFinanceLedgerEntries(
    [...input.financeLedger],
    input.financeTotals,
    ledgerEntries,
  );

  const settledAt = input.nowMs;
  const nextReceipt: MultimodalRailSettlementReceipt = {
    ...receipt,
    settlementStatus: 'SETTLED',
    settledAt,
  };

  const nextShipments = input.shipments.map((row) => {
    if (!isExecutablePersistedMultimodalShipment(row) || row.shipmentId !== receipt.shipmentId) {
      return row;
    }
    return {
      ...row,
      status: 'COMPLETED' as const,
      settlementState: 'SETTLED' as const,
      completedAt: row.completedAt ?? input.currentTime,
      settlement: {
        ...(row.settlement ?? {}),
        settlementId: receipt.settlementId,
        settledAt,
        settlementAuthority: 'LOCAL_OFFLINE_AUTHORITATIVE',
        revenueTransactionId: receipt.revenueTransactionId,
        expenseTransactionId: receipt.expenseTransactionId,
        completionId: receipt.completionId,
      },
    };
  });

  return {
    status: 'SETTLED',
    shipmentId: receipt.shipmentId,
    receipt: nextReceipt,
    playerMoney: nextMoney,
    financeLedger: patched.financeLedger,
    financeTotals: patched.financeTotals,
    multimodalShipments: nextShipments,
    reputation: input.reputation,
    xp: input.xp,
  };
}
