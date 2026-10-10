/**
 * Step 29AH — company XP for canonical non-delivery operations (INTERNAL_TEST).
 * Fixed rewards reuse levelBalance.xpRewards (the values production buyTruck / hireDriver /
 * openWarehouse / upgradeWarehouse pass to addCompanyXp). Cargo-sale XP reuses production
 * calculateTradeProfit + calculateTradeSaleXp on the committed sale receipt and a
 * server-owned cost basis. XP is applied through the Step 29AF progression receipt pipeline.
 */

import { levelBalance } from '../config/balance';
import { PRODUCT_BY_ID } from '../data/products';
import { calculateTradeSaleXp } from '../simulation/leveling';
import { calculateTradeProfit } from '../simulation/trading';
import {
  calculateQualityLossForPeriod,
  computeWeightedAverageBuyPrice,
} from '../simulation/warehouseStorage';
import type { ProductId, WarehouseType } from '../types/game';
import {
  CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION,
  CANONICAL_ROAD_REPUTATION_POLICY_VERSION,
  canonicalProgressionReceiptMatches,
  type CanonicalProgressionMutationInput,
  type CanonicalProgressionReceipt,
} from './canonicalCompanyProgression';
import type { CanonicalCargoMarketReceipt } from './canonicalCargoMarketWorldState';
import type { CanonicalDriverReceipt } from './canonicalCoreVehicleStaffCash';
import type { CanonicalWarehouseReceipt } from './canonicalWarehouseState';
import type { CanonicalPurchaseReceipt } from './remainingRoadCashPathCanonicalization';

export const CANONICAL_NON_DELIVERY_XP_AUTHORITY_ENV = 'CANONICAL_NON_DELIVERY_XP_AUTHORITY' as const;

export const CANONICAL_NON_DELIVERY_XP_POLICY_VERSION = 'canonical-company-non-delivery-xp-v1' as const;

export const CANONICAL_CARGO_COST_BASIS_POLICY_VERSION = 'canonical-cargo-cost-basis-v1' as const;

export const CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY_STATUS =
  'CANONICAL_NON_DELIVERY_COMPANY_XP_AUTHORITY_PASS_PARTIAL' as const;

export const CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY =
  'CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY' as const;

/**
 * Production sale XP uses inventory quality, which decays with game time for some
 * product/warehouse pairs. Canonical cargo inventory has no quality clock.
 */
export const CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY = 'CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY' as const;

export const NON_DELIVERY_XP_BLOCKED_TRADE_PROFIT_AUTHORITY =
  'NON_DELIVERY_XP_BLOCKED_TRADE_PROFIT_AUTHORITY' as const;

export const NON_DELIVERY_XP_HISTORICAL_OPERATION_UNAPPLIED =
  'NON_DELIVERY_XP_HISTORICAL_OPERATION_UNAPPLIED' as const;

export const NON_DELIVERY_XP_POLICY_UNKNOWN = 'NON_DELIVERY_XP_POLICY_UNKNOWN' as const;

export const NON_DELIVERY_XP_PROGRESSION_RECEIPT_CONFLICT =
  'NON_DELIVERY_XP_PROGRESSION_RECEIPT_CONFLICT' as const;

export const VEHICLE_RECOVERY_XP_BLOCKED_RECOVERY_AUTHORITY =
  'VEHICLE_RECOVERY_XP_BLOCKED_RECOVERY_AUTHORITY' as const;

export const OPERATION_CHOICE_XP_CLIENT_OWNED = 'OPERATION_CHOICE_XP_CLIENT_OWNED' as const;

export type CanonicalCargoSaleXpBlockedAuthority =
  | typeof CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY
  | typeof CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY
  | typeof NON_DELIVERY_XP_BLOCKED_TRADE_PROFIT_AUTHORITY;

export type CanonicalNonDeliveryXpSourceType =
  | 'COMPANY_TRUCK_PURCHASE'
  | 'COMPANY_DRIVER_HIRE'
  | 'COMPANY_WAREHOUSE_OPEN'
  | 'COMPANY_WAREHOUSE_UPGRADE'
  | 'COMPANY_CARGO_SALE';

export type CanonicalFixedNonDeliveryXpSourceType = Exclude<
  CanonicalNonDeliveryXpSourceType,
  'COMPANY_CARGO_SALE'
>;

export type CanonicalFixedXpRewardKey = keyof typeof levelBalance.xpRewards;

export const CANONICAL_NON_DELIVERY_FIXED_XP_REWARD_KEYS: Record<
  CanonicalFixedNonDeliveryXpSourceType,
  CanonicalFixedXpRewardKey
> = {
  COMPANY_TRUCK_PURCHASE: 'truckPurchase',
  COMPANY_DRIVER_HIRE: 'driverHire',
  COMPANY_WAREHOUSE_OPEN: 'warehouseOpen',
  COMPANY_WAREHOUSE_UPGRADE: 'warehouseUpgrade',
};

export function isCanonicalNonDeliveryXpAllowed(input?: { envValue?: string | null }): boolean {
  const raw =
    input && 'envValue' in input
      ? input.envValue
      : typeof process !== 'undefined'
        ? process.env[CANONICAL_NON_DELIVERY_XP_AUTHORITY_ENV]
        : undefined;
  return raw === 'INTERNAL_TEST';
}

export function progressionTruckPurchaseOperationId(purchaseId: string): string {
  return `progression:truck-purchase:${purchaseId}`;
}

export function progressionDriverHireOperationId(hireIntentId: string): string {
  return `progression:driver-hire:${hireIntentId}`;
}

/** Canonical warehouse ids are deterministic per city/type and cannot be reopened. */
export function progressionWarehouseOpenOperationId(warehouseId: string): string {
  return `progression:warehouse-open:${warehouseId}`;
}

export function progressionWarehouseUpgradeOperationId(
  warehouseId: string,
  fromLevel: number,
  toLevel: number,
): string {
  return `progression:warehouse-upgrade:${warehouseId}:${fromLevel}:${toLevel}`;
}

export function progressionCargoSaleOperationId(saleIntentId: string): string {
  return `progression:cargo-sale:${saleIntentId}`;
}

export const CANONICAL_NON_DELIVERY_XP_FORBIDDEN_CLIENT_KEYS = [
  'xp',
  'xpDelta',
  'experience',
  'xpReward',
  'tradeXp',
  'purchaseXp',
  'hireXp',
  'warehouseXp',
  'profit',
  'netProfit',
  'costBasis',
  'averageBuyPrice',
  'quality',
  'level',
  'newLevel',
  'totalXp',
  'companyXp',
  'xpReason',
  'reason',
  'reputation',
  'reputationDelta',
  'progressionRevision',
] as const;

export function containsForbiddenNonDeliveryXpClientKeys(record: Record<string, unknown>): boolean {
  return CANONICAL_NON_DELIVERY_XP_FORBIDDEN_CLIENT_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(record, key),
  );
}

export function deriveCanonicalFixedNonDeliveryXp(sourceType: CanonicalFixedNonDeliveryXpSourceType): {
  xp: number;
  rewardKey: CanonicalFixedXpRewardKey;
} {
  const rewardKey = CANONICAL_NON_DELIVERY_FIXED_XP_REWARD_KEYS[sourceType];
  return { xp: levelBalance.xpRewards[rewardKey], rewardKey };
}

export type CanonicalFixedNonDeliveryXpEvidence = {
  policyVersion: typeof CANONICAL_NON_DELIVERY_XP_POLICY_VERSION;
  sourceType: CanonicalFixedNonDeliveryXpSourceType;
  formula: 'FIXED';
  rewardKey: CanonicalFixedXpRewardKey;
  xp: number;
  operationReceiptId: string;
  operationPolicyVersion: string;
  cashTransactionId: string;
};

export type CanonicalCargoSaleQualityAuthority = 'ZERO_DECAY_QUALITY_100' | 'QUALITY_DECAY_UNTRACKED';

export type CanonicalCargoSaleXpEvidence = {
  policyVersion: typeof CANONICAL_NON_DELIVERY_XP_POLICY_VERSION;
  sourceType: 'COMPANY_CARGO_SALE';
  formula: 'TRADE_SALE';
  xp: number;
  operationReceiptId: string;
  operationPolicyVersion: string;
  cashTransactionId: string;
  productId: ProductId;
  warehouseId: string;
  warehouseType: WarehouseType;
  quantity: number;
  sellUnitPrice: number;
  averageBuyPrice: number | null;
  costBasisPolicyVersion: string | null;
  quality: number | null;
  qualityAuthority: CanonicalCargoSaleQualityAuthority;
  profit: number | null;
};

export type CanonicalNonDeliveryXpEvidence =
  | CanonicalFixedNonDeliveryXpEvidence
  | CanonicalCargoSaleXpEvidence;

function fixedInput(
  sourceType: CanonicalFixedNonDeliveryXpSourceType,
  operationId: string,
  sourceId: string,
  receipt: { operationReceiptId: string; operationPolicyVersion: string; cashTransactionId: string },
  nowMs: number,
): CanonicalProgressionMutationInput {
  const fixed = deriveCanonicalFixedNonDeliveryXp(sourceType);
  return {
    operationId,
    sourceType,
    sourceId,
    xpDelta: fixed.xp,
    xpAuthority: 'SERVER_DERIVED',
    reputationDelta: 0,
    reputationReasons: [],
    xpEvidence: {
      policyVersion: CANONICAL_NON_DELIVERY_XP_POLICY_VERSION,
      sourceType,
      formula: 'FIXED',
      rewardKey: fixed.rewardKey,
      xp: fixed.xp,
      ...receipt,
    },
    nowMs,
  };
}

/** Production buyTrailer grants no XP; only TRUCK catalog purchases earn truckPurchase XP. */
export function buildCanonicalTruckPurchaseProgressionInput(
  receipt: CanonicalPurchaseReceipt,
  nowMs: number,
): CanonicalProgressionMutationInput | null {
  if (receipt.assetType !== 'TRUCK') return null;
  return fixedInput(
    'COMPANY_TRUCK_PURCHASE',
    progressionTruckPurchaseOperationId(receipt.purchaseId),
    receipt.assetId,
    {
      operationReceiptId: receipt.purchaseId,
      operationPolicyVersion: receipt.policyVersion,
      cashTransactionId: receipt.transactionId,
    },
    nowMs,
  );
}

export function buildCanonicalDriverHireProgressionInput(
  receipt: CanonicalDriverReceipt,
  nowMs: number,
): CanonicalProgressionMutationInput | null {
  if (receipt.operation !== 'HIRE') return null;
  return fixedInput(
    'COMPANY_DRIVER_HIRE',
    progressionDriverHireOperationId(receipt.intentId),
    receipt.driverId,
    {
      operationReceiptId: receipt.intentId,
      operationPolicyVersion: receipt.policyVersion,
      cashTransactionId: receipt.transactionId,
    },
    nowMs,
  );
}

export function buildCanonicalWarehouseProgressionInput(
  receipt: CanonicalWarehouseReceipt,
  nowMs: number,
): CanonicalProgressionMutationInput {
  const evidence = {
    operationReceiptId: receipt.operationId,
    operationPolicyVersion: receipt.policyVersion,
    cashTransactionId: receipt.cashTransactionId,
  };
  if (receipt.operationType === 'OPEN') {
    return fixedInput(
      'COMPANY_WAREHOUSE_OPEN',
      progressionWarehouseOpenOperationId(receipt.warehouseId),
      receipt.warehouseId,
      evidence,
      nowMs,
    );
  }
  return fixedInput(
    'COMPANY_WAREHOUSE_UPGRADE',
    progressionWarehouseUpgradeOperationId(receipt.warehouseId, receipt.levelBefore, receipt.levelAfter),
    receipt.warehouseId,
    evidence,
    nowMs,
  );
}

export type CanonicalCargoCostBasisRead =
  | { trusted: true; averageBuyPrice: number; costBasisPolicyVersion: typeof CANONICAL_CARGO_COST_BASIS_POLICY_VERSION }
  | { trusted: false; reason: typeof CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY };

/**
 * Trusted only when every unit in the inventory doc came from canonical buys recorded under
 * the cost-basis policy. Docs created before the policy (or mixed with untracked units)
 * carry no basis and stay untrusted until the quantity returns to zero.
 */
export function readCanonicalCargoCostBasis(
  inventory: Record<string, unknown> | null | undefined,
): CanonicalCargoCostBasisRead {
  const avg = inventory?.averageBuyPrice;
  if (
    inventory?.costBasisPolicyVersion !== CANONICAL_CARGO_COST_BASIS_POLICY_VERSION ||
    typeof avg !== 'number' ||
    !Number.isFinite(avg) ||
    avg <= 0
  ) {
    return { trusted: false, reason: CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY };
  }
  return {
    trusted: true,
    averageBuyPrice: avg,
    costBasisPolicyVersion: CANONICAL_CARGO_COST_BASIS_POLICY_VERSION,
  };
}

export type CanonicalCargoCostBasisWrite =
  | { kind: 'UNCHANGED' }
  | {
      kind: 'SET';
      fields: {
        costBasisPolicyVersion: typeof CANONICAL_CARGO_COST_BASIS_POLICY_VERSION;
        averageBuyPrice: number;
      };
    }
  | { kind: 'UNTRUSTED'; fields: { costBasisPolicyVersion: null; averageBuyPrice: null } };

const UNTRUSTED_COST_BASIS: CanonicalCargoCostBasisWrite = {
  kind: 'UNTRUSTED',
  fields: { costBasisPolicyVersion: null, averageBuyPrice: null },
};

/**
 * Production buy: new item → averageBuyPrice = unitPrice; existing item → weighted average
 * (computeWeightedAverageBuyPrice). Sells keep the average; zero quantity starts fresh.
 * With the XP gate OFF no basis is maintained, so an existing basis is invalidated.
 */
export function planCanonicalCargoCostBasisAfterBuy(input: {
  xpGateEnabled: boolean;
  inventoryBefore: number;
  existing: Record<string, unknown> | null | undefined;
  addedQuantity: number;
  unitPrice: number;
}): CanonicalCargoCostBasisWrite {
  const hasBasisFields =
    input.existing != null &&
    (input.existing.costBasisPolicyVersion != null || input.existing.averageBuyPrice != null);
  if (!input.xpGateEnabled) {
    return hasBasisFields ? UNTRUSTED_COST_BASIS : { kind: 'UNCHANGED' };
  }
  if (input.inventoryBefore <= 0) {
    return {
      kind: 'SET',
      fields: {
        costBasisPolicyVersion: CANONICAL_CARGO_COST_BASIS_POLICY_VERSION,
        averageBuyPrice: input.unitPrice,
      },
    };
  }
  const current = readCanonicalCargoCostBasis(input.existing);
  if (!current.trusted) return UNTRUSTED_COST_BASIS;
  return {
    kind: 'SET',
    fields: {
      costBasisPolicyVersion: CANONICAL_CARGO_COST_BASIS_POLICY_VERSION,
      averageBuyPrice: computeWeightedAverageBuyPrice(
        input.inventoryBefore,
        current.averageBuyPrice,
        input.addedQuantity,
        input.unitPrice,
      ),
    },
  };
}

/**
 * Quality loss is linear in time, so a zero loss over one game day means quality stays at
 * production maxQuality (100) forever. Production openWarehouse protection (cold 1,
 * standard 0.5) equals the getWarehouseProtection defaults used here.
 */
export function resolveCanonicalCargoSaleQuality(
  productId: ProductId,
  warehouseType: WarehouseType,
): { ok: true; quality: 100; authority: 'ZERO_DECAY_QUALITY_100' } | { ok: false; authority: 'QUALITY_DECAY_UNTRACKED' } {
  const product = PRODUCT_BY_ID[productId];
  if (!product) return { ok: false, authority: 'QUALITY_DECAY_UNTRACKED' };
  const loss = calculateQualityLossForPeriod(product, warehouseType, undefined, 24);
  return loss === 0
    ? { ok: true, quality: 100, authority: 'ZERO_DECAY_QUALITY_100' }
    : { ok: false, authority: 'QUALITY_DECAY_UNTRACKED' };
}

export type CanonicalCargoSaleXpDerivation =
  | { ok: true; xp: number; xpAuthority: 'SERVER_DERIVED'; profit: number; averageBuyPrice: number; quality: 100 }
  | { ok: false; xp: 0; xpAuthority: CanonicalCargoSaleXpBlockedAuthority };

/** Production sellProductFromWarehouse: calculateTradeSaleXp(calculateTradeProfit(...)). */
export function deriveCanonicalCargoSaleXp(input: {
  productId: ProductId;
  warehouseType: WarehouseType;
  quantity: number;
  sellUnitPrice: number;
  costBasis: CanonicalCargoCostBasisRead;
}): CanonicalCargoSaleXpDerivation {
  if (!input.costBasis.trusted) {
    return { ok: false, xp: 0, xpAuthority: CARGO_SALE_XP_BLOCKED_COST_BASIS_AUTHORITY };
  }
  const quality = resolveCanonicalCargoSaleQuality(input.productId, input.warehouseType);
  if (!quality.ok) {
    return { ok: false, xp: 0, xpAuthority: CARGO_SALE_XP_BLOCKED_QUALITY_AUTHORITY };
  }
  const profit = calculateTradeProfit(
    input.sellUnitPrice,
    input.costBasis.averageBuyPrice,
    input.quantity,
    quality.quality,
  );
  if (!Number.isFinite(profit)) {
    return { ok: false, xp: 0, xpAuthority: NON_DELIVERY_XP_BLOCKED_TRADE_PROFIT_AUTHORITY };
  }
  return {
    ok: true,
    xp: calculateTradeSaleXp(profit),
    xpAuthority: 'SERVER_DERIVED',
    profit,
    averageBuyPrice: input.costBasis.averageBuyPrice,
    quality: quality.quality,
  };
}

export function buildCanonicalCargoSaleProgressionInput(
  receipt: CanonicalCargoMarketReceipt,
  context: { warehouseType: WarehouseType; costBasis: CanonicalCargoCostBasisRead },
  nowMs: number,
): CanonicalProgressionMutationInput | null {
  if (receipt.operationType !== 'SELL') return null;
  const derived = deriveCanonicalCargoSaleXp({
    productId: receipt.productId,
    warehouseType: context.warehouseType,
    quantity: receipt.quantity,
    sellUnitPrice: receipt.unitPrice,
    costBasis: context.costBasis,
  });
  const quality = resolveCanonicalCargoSaleQuality(receipt.productId, context.warehouseType);
  const evidence: CanonicalCargoSaleXpEvidence = {
    policyVersion: CANONICAL_NON_DELIVERY_XP_POLICY_VERSION,
    sourceType: 'COMPANY_CARGO_SALE',
    formula: 'TRADE_SALE',
    xp: derived.xp,
    operationReceiptId: receipt.operationId,
    operationPolicyVersion: receipt.policyVersion,
    cashTransactionId: receipt.cashTransactionId,
    productId: receipt.productId,
    warehouseId: receipt.warehouseId,
    warehouseType: context.warehouseType,
    quantity: receipt.quantity,
    sellUnitPrice: receipt.unitPrice,
    averageBuyPrice: context.costBasis.trusted ? context.costBasis.averageBuyPrice : null,
    costBasisPolicyVersion: context.costBasis.trusted ? context.costBasis.costBasisPolicyVersion : null,
    quality: quality.ok ? quality.quality : null,
    qualityAuthority: quality.authority,
    profit: derived.ok ? derived.profit : null,
  };
  return {
    operationId: progressionCargoSaleOperationId(receipt.operationId),
    sourceType: 'COMPANY_CARGO_SALE',
    sourceId: `${receipt.warehouseId}__${receipt.productId}`,
    xpDelta: derived.xp,
    xpAuthority: derived.xpAuthority,
    reputationDelta: 0,
    reputationReasons: [],
    xpEvidence: evidence,
    nowMs,
  };
}

export function isKnownCanonicalNonDeliveryXpPolicy(value: unknown): boolean {
  return value === CANONICAL_NON_DELIVERY_XP_POLICY_VERSION;
}

/** Replay/conflict check for a non-delivery progression receipt; unknown policy fails closed. */
export function canonicalNonDeliveryProgressionReceiptMatches(
  existing: Record<string, unknown>,
  input: CanonicalProgressionMutationInput,
): boolean {
  const evidence = existing.xpEvidence as Record<string, unknown> | null | undefined;
  return (
    canonicalProgressionReceiptMatches(existing, input) &&
    isKnownCanonicalNonDeliveryXpPolicy(evidence?.policyVersion)
  );
}

export type CanonicalNonDeliveryXpApplication =
  | 'NOT_EVALUATED_GATE_OFF'
  | 'APPLIED'
  | 'ALREADY_APPLIED'
  | 'NOT_APPLIED_UNINITIALIZED'
  | 'NOT_APPLIED_NOT_SERVER_CANONICAL'
  | 'PRODUCTION_NO_XP'
  | typeof NON_DELIVERY_XP_HISTORICAL_OPERATION_UNAPPLIED;

export type CanonicalNonDeliveryXpOutcome = {
  application: CanonicalNonDeliveryXpApplication;
  operationId: string | null;
  receipt: CanonicalProgressionReceipt | null;
};

/**
 * Replay of an already committed operation. A progression receipt written with it means
 * ALREADY_APPLIED; none means the operation predates the XP gate (never backfilled).
 */
export function resolveCanonicalNonDeliveryReplayProgression(input: {
  enabled: boolean;
  operationId: string | null;
  sourceType: CanonicalNonDeliveryXpSourceType;
  existing: Record<string, unknown> | null | undefined;
}):
  | { ok: true; outcome: CanonicalNonDeliveryXpOutcome }
  | { ok: false; reason: typeof NON_DELIVERY_XP_POLICY_UNKNOWN | typeof NON_DELIVERY_XP_PROGRESSION_RECEIPT_CONFLICT } {
  if (!input.operationId) {
    return { ok: true, outcome: { application: 'PRODUCTION_NO_XP', operationId: null, receipt: null } };
  }
  if (!input.enabled) {
    return {
      ok: true,
      outcome: { application: 'NOT_EVALUATED_GATE_OFF', operationId: input.operationId, receipt: null },
    };
  }
  if (!input.existing) {
    return {
      ok: true,
      outcome: {
        application: NON_DELIVERY_XP_HISTORICAL_OPERATION_UNAPPLIED,
        operationId: input.operationId,
        receipt: null,
      },
    };
  }
  const evidence = input.existing.xpEvidence as Record<string, unknown> | null | undefined;
  if (!isKnownCanonicalNonDeliveryXpPolicy(evidence?.policyVersion)) {
    return { ok: false, reason: NON_DELIVERY_XP_POLICY_UNKNOWN };
  }
  if (
    input.existing.operationId !== input.operationId ||
    input.existing.sourceType !== input.sourceType ||
    input.existing.policyVersion !== CANONICAL_COMPANY_PROGRESSION_POLICY_VERSION ||
    input.existing.reputationPolicyVersion !== CANONICAL_ROAD_REPUTATION_POLICY_VERSION
  ) {
    return { ok: false, reason: NON_DELIVERY_XP_PROGRESSION_RECEIPT_CONFLICT };
  }
  return {
    ok: true,
    outcome: {
      application: 'ALREADY_APPLIED',
      operationId: input.operationId,
      receipt: input.existing as unknown as CanonicalProgressionReceipt,
    },
  };
}

export type CanonicalNonDeliveryXpAuditRow = {
  source: string;
  productionFunction: string;
  trigger: string;
  xpFormula: string;
  fixedOrVariable: 'FIXED' | 'VARIABLE' | 'NONE';
  inputs: string;
  rounding: string;
  clamp: string;
  clientOwnedToday: boolean;
  canonicalOperation: string | null;
  safeToCanonicalize: boolean;
  status: string;
};

export const PRODUCTION_NON_DELIVERY_XP_AUDIT: readonly CanonicalNonDeliveryXpAuditRow[] = [
  {
    source: 'truck-purchase',
    productionFunction: 'gameStore.buyTruck → addCompanyXp(levelBalance.xpRewards.truckPurchase)',
    trigger: 'catalog truck purchase committed',
    xpFormula: 'levelConfig.xpRewards.truckPurchase = 30',
    fixedOrVariable: 'FIXED',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none (applyXpToPlayer max level 30)',
    clientOwnedToday: true,
    canonicalOperation: 'purchaseCanonicalCatalogAssetTransaction (assetType TRUCK)',
    safeToCanonicalize: true,
    status: 'TRUCK_PURCHASE_XP_CANONICAL_INTERNAL',
  },
  {
    source: 'trailer-purchase',
    productionFunction: 'gameStore.buyTrailer',
    trigger: 'catalog trailer purchase',
    xpFormula: 'none',
    fixedOrVariable: 'NONE',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none',
    clientOwnedToday: false,
    canonicalOperation: 'purchaseCanonicalCatalogAssetTransaction (assetType TRAILER)',
    safeToCanonicalize: true,
    status: 'TRAILER_PURCHASE_NO_PRODUCTION_XP',
  },
  {
    source: 'vehicle-lease',
    productionFunction: 'gameStore.leaseTruck',
    trigger: 'lease start',
    xpFormula: 'none',
    fixedOrVariable: 'NONE',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none',
    clientOwnedToday: false,
    canonicalOperation: 'createCanonicalVehicleLeaseTransaction',
    safeToCanonicalize: true,
    status: 'VEHICLE_LEASE_NO_PRODUCTION_XP',
  },
  {
    source: 'marketplace-purchase',
    productionFunction: 'gameStore.applyMarketplacePurchaseResult',
    trigger: 'server marketplace purchase result applied',
    xpFormula: 'none',
    fixedOrVariable: 'NONE',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none',
    clientOwnedToday: false,
    canonicalOperation: null,
    safeToCanonicalize: true,
    status: 'MARKETPLACE_PURCHASE_NO_PRODUCTION_XP',
  },
  {
    source: 'vehicle-sale',
    productionFunction: 'gameStore.sellTruck',
    trigger: 'fleet asset sale',
    xpFormula: 'none',
    fixedOrVariable: 'NONE',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none',
    clientOwnedToday: false,
    canonicalOperation: 'sellCanonicalFleetAssetTransaction',
    safeToCanonicalize: true,
    status: 'VEHICLE_SALE_NO_PRODUCTION_XP',
  },
  {
    source: 'driver-hire',
    productionFunction: 'gameStore.hireDriver → addCompanyXp(levelBalance.xpRewards.driverHire)',
    trigger: 'driver hire committed',
    xpFormula: 'levelConfig.xpRewards.driverHire = 10',
    fixedOrVariable: 'FIXED',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none (applyXpToPlayer max level 30)',
    clientOwnedToday: true,
    canonicalOperation: 'hireCanonicalDriverTransaction',
    safeToCanonicalize: true,
    status: 'DRIVER_HIRE_XP_CANONICAL_INTERNAL',
  },
  {
    source: 'driver-fire',
    productionFunction: 'gameStore.fireDriver',
    trigger: 'driver fired',
    xpFormula: 'none',
    fixedOrVariable: 'NONE',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none',
    clientOwnedToday: false,
    canonicalOperation: 'fireCanonicalDriverTransaction',
    safeToCanonicalize: true,
    status: 'DRIVER_FIRE_NO_PRODUCTION_XP',
  },
  {
    source: 'warehouse-open',
    productionFunction: 'gameStore.openWarehouse → addCompanyXp(levelBalance.xpRewards.warehouseOpen)',
    trigger: 'warehouse opened',
    xpFormula: 'levelConfig.xpRewards.warehouseOpen = 40',
    fixedOrVariable: 'FIXED',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none (applyXpToPlayer max level 30)',
    clientOwnedToday: true,
    canonicalOperation: 'openCanonicalWarehouseTransaction',
    safeToCanonicalize: true,
    status: 'WAREHOUSE_OPEN_XP_CANONICAL_INTERNAL',
  },
  {
    source: 'warehouse-upgrade',
    productionFunction: 'gameStore.upgradeWarehouse → addCompanyXp(levelBalance.xpRewards.warehouseUpgrade)',
    trigger: 'each successful tier upgrade',
    xpFormula: 'levelConfig.xpRewards.warehouseUpgrade = 25 per tier',
    fixedOrVariable: 'FIXED',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none (applyXpToPlayer max level 30)',
    clientOwnedToday: true,
    canonicalOperation: 'upgradeCanonicalWarehouseTransaction',
    safeToCanonicalize: true,
    status: 'WAREHOUSE_UPGRADE_XP_CANONICAL_INTERNAL',
  },
  {
    source: 'cargo-buy',
    productionFunction: 'gameStore.buyProductForWarehouse',
    trigger: 'cargo bought into warehouse',
    xpFormula: 'none (updates averageBuyPrice only)',
    fixedOrVariable: 'NONE',
    inputs: 'unitPrice, quantity (cost basis)',
    rounding: 'none',
    clamp: 'none',
    clientOwnedToday: false,
    canonicalOperation: 'buyCanonicalCargoTransaction (records trusted cost basis)',
    safeToCanonicalize: true,
    status: 'CARGO_BUY_NO_PRODUCTION_XP',
  },
  {
    source: 'cargo-sale',
    productionFunction: 'gameStore.sellProductFromWarehouse → addCompanyXp(calculateTradeSaleXp(profit))',
    trigger: 'cargo sold from warehouse',
    xpFormula:
      'profit ≤ 0 → 2; else clamp(round(10 + profit / 1500), 10, 100); profit = calculateTradeProfit(sell, averageBuyPrice, qty, quality)',
    fixedOrVariable: 'VARIABLE',
    inputs: 'sell unitPrice, averageBuyPrice, quantity, quality, buy/sell fee rates',
    rounding: 'Math.round on XP; profit unrounded',
    clamp: '[10, 100]; loss/break-even sale = 2',
    clientOwnedToday: true,
    canonicalOperation: 'sellCanonicalCargoTransaction',
    safeToCanonicalize: true,
    status: 'CARGO_SALE_XP_CANONICAL_INTERNAL_ZERO_DECAY_ONLY',
  },
  {
    source: 'vehicle-recovery',
    productionFunction: 'gameStore vehicle recovery (reputation delta only)',
    trigger: 'vehicle recovered',
    xpFormula: 'none (production grants no XP; reputation delta only)',
    fixedOrVariable: 'NONE',
    inputs: 'recovery option',
    rounding: 'none',
    clamp: 'reputation clamp',
    clientOwnedToday: true,
    canonicalOperation: 'recoverCanonicalVehicleTransaction (fail-closed)',
    safeToCanonicalize: false,
    status: VEHICLE_RECOVERY_XP_BLOCKED_RECOVERY_AUTHORITY,
  },
  {
    source: 'vehicle-repair',
    productionFunction: 'gameStore.repairTruck',
    trigger: 'repair',
    xpFormula: 'none',
    fixedOrVariable: 'NONE',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none',
    clientOwnedToday: false,
    canonicalOperation: null,
    safeToCanonicalize: true,
    status: 'VEHICLE_REPAIR_NO_PRODUCTION_XP',
  },
  {
    source: 'vehicle-upgrade',
    productionFunction: 'gameStore.upgradeTruck',
    trigger: 'truck upgrade',
    xpFormula: 'none',
    fixedOrVariable: 'NONE',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none',
    clientOwnedToday: false,
    canonicalOperation: null,
    safeToCanonicalize: true,
    status: 'VEHICLE_UPGRADE_NO_PRODUCTION_XP',
  },
  {
    source: 'missions',
    productionFunction: 'gameStore.claimMissionReward → addCompanyXp(reward.xp)',
    trigger: 'mission reward claim',
    xpFormula: 'mission reward.xp',
    fixedOrVariable: 'VARIABLE',
    inputs: 'client mission catalog + progress',
    rounding: 'none',
    clamp: 'amount > 0',
    clientOwnedToday: true,
    canonicalOperation: null,
    safeToCanonicalize: false,
    status: 'MISSION_XP_CLIENT_OWNED',
  },
  {
    source: 'milestones',
    productionFunction: 'gameStore.claimMilestoneReward → addCompanyXp(reward.xp)',
    trigger: 'milestone reward claim',
    xpFormula: 'milestone reward.xp',
    fixedOrVariable: 'VARIABLE',
    inputs: 'client milestone catalog + progress',
    rounding: 'none',
    clamp: 'amount > 0',
    clientOwnedToday: true,
    canonicalOperation: null,
    safeToCanonicalize: false,
    status: 'MILESTONE_XP_CLIENT_OWNED',
  },
  {
    source: 'weekly-objectives',
    productionFunction: 'gameStore.claimWeeklyObjectiveReward → addCompanyXp(reward.xp)',
    trigger: 'local weekly objective claim',
    xpFormula: 'objective reward.xp',
    fixedOrVariable: 'VARIABLE',
    inputs: 'client weekly objective state',
    rounding: 'none',
    clamp: 'amount > 0',
    clientOwnedToday: true,
    canonicalOperation: null,
    safeToCanonicalize: false,
    status: 'WEEKLY_OBJECTIVE_XP_CLIENT_OWNED',
  },
  {
    source: 'server-weekly-missions',
    productionFunction: 'backend weeklyMissionCatalog (rejects xp rewards)',
    trigger: 'server weekly mission claim',
    xpFormula: 'none',
    fixedOrVariable: 'NONE',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none',
    clientOwnedToday: false,
    canonicalOperation: null,
    safeToCanonicalize: true,
    status: 'SERVER_WEEKLY_MISSION_NO_XP',
  },
  {
    source: 'season-challenge-achievement',
    productionFunction: 'season / challenge / achievement reward claims',
    trigger: 'reward claim',
    xpFormula: 'none',
    fixedOrVariable: 'NONE',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none',
    clientOwnedToday: false,
    canonicalOperation: null,
    safeToCanonicalize: true,
    status: 'SEASON_CHALLENGE_ACHIEVEMENT_NO_XP',
  },
  {
    source: 'operation-choice',
    productionFunction: 'gameStore.resolveDeliveryOperationChoice → applyXpToPlayer(playerXpDelta)',
    trigger: 'delivery operation choice resolved',
    xpFormula: 'effects.playerXpDelta (no current catalog option sets it)',
    fixedOrVariable: 'VARIABLE',
    inputs: 'client operation-choice effects',
    rounding: 'none',
    clamp: 'amount > 0',
    clientOwnedToday: true,
    canonicalOperation: null,
    safeToCanonicalize: false,
    status: OPERATION_CHOICE_XP_CLIENT_OWNED,
  },
  {
    source: 'ad-reward',
    productionFunction: 'gameStore.applyAdReward',
    trigger: 'rewarded ad',
    xpFormula: 'none',
    fixedOrVariable: 'NONE',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none',
    clientOwnedToday: false,
    canonicalOperation: null,
    safeToCanonicalize: true,
    status: 'AD_REWARD_NO_PRODUCTION_XP',
  },
  {
    source: 'debug-xp',
    productionFunction: 'DebugSimulationScreen +50 / +250',
    trigger: 'dev-only debug button',
    xpFormula: '50 or 250',
    fixedOrVariable: 'FIXED',
    inputs: 'none',
    rounding: 'none',
    clamp: 'none',
    clientOwnedToday: true,
    canonicalOperation: null,
    safeToCanonicalize: false,
    status: 'DEBUG_XP_DEV_ONLY_NOT_CANONICAL',
  },
  {
    source: 'delivery-completion',
    productionFunction: 'gameStore.completeDelivery → addCompanyXp(calculateDeliveryXp)',
    trigger: 'delivery completed',
    xpFormula: 'calculateDeliveryXp(distanceKm, netProfit, riskTier)',
    fixedOrVariable: 'VARIABLE',
    inputs: 'distance, netProfit, frozen risk tier',
    rounding: 'Math.round',
    clamp: 'production calculateDeliveryXp',
    clientOwnedToday: true,
    canonicalOperation: 'reportCanonicalRoadDeliveryCompletedTransaction (Step 29AF/29AG)',
    safeToCanonicalize: true,
    status: 'CANONICAL_DELIVERY_XP_INTERNAL_SERVER_DERIVED',
  },
];

export type CanonicalNonDeliveryXpReadiness =
  | 'NON_DELIVERY_XP_CANONICAL_READY'
  | 'NON_DELIVERY_XP_INTERNAL_PARTIAL'
  | 'NON_DELIVERY_XP_BLOCKED_CARGO_COST_BASIS'
  | 'NON_DELIVERY_XP_BLOCKED_MARKETPLACE_PURCHASE'
  | 'NON_DELIVERY_XP_BLOCKED_RECOVERY'
  | 'NON_DELIVERY_XP_BLOCKED_MISSIONS'
  | 'NON_DELIVERY_XP_BLOCKED_LEGACY_STATE';

export type CanonicalNonDeliveryXpReadinessInput = {
  scope: 'OPERATIONS' | 'ALL_SOURCES';
  legacyProgressionState: boolean;
  fixedOperationsCanonical: boolean;
  cargoSale: 'SERVER_DERIVED_ALL' | 'SERVER_DERIVED_ZERO_DECAY_ONLY' | 'BLOCKED_COST_BASIS';
  marketplacePurchaseGrantsXp: boolean;
  marketplacePurchaseCanonicalXp: boolean;
  recoveryGrantsXp: boolean;
  recoveryCanonical: boolean;
  rewardXpSourcesClientOwned: boolean;
  publicAuthority: boolean;
};

export function classifyCanonicalNonDeliveryXpReadiness(
  input: CanonicalNonDeliveryXpReadinessInput,
): CanonicalNonDeliveryXpReadiness {
  if (input.legacyProgressionState) return 'NON_DELIVERY_XP_BLOCKED_LEGACY_STATE';
  if (input.cargoSale === 'BLOCKED_COST_BASIS') return 'NON_DELIVERY_XP_BLOCKED_CARGO_COST_BASIS';
  if (input.marketplacePurchaseGrantsXp && !input.marketplacePurchaseCanonicalXp) {
    return 'NON_DELIVERY_XP_BLOCKED_MARKETPLACE_PURCHASE';
  }
  if (input.recoveryGrantsXp && !input.recoveryCanonical) return 'NON_DELIVERY_XP_BLOCKED_RECOVERY';
  if (input.scope === 'ALL_SOURCES' && input.rewardXpSourcesClientOwned) {
    return 'NON_DELIVERY_XP_BLOCKED_MISSIONS';
  }
  if (
    !input.fixedOperationsCanonical ||
    input.cargoSale !== 'SERVER_DERIVED_ALL' ||
    !input.publicAuthority
  ) {
    return 'NON_DELIVERY_XP_INTERNAL_PARTIAL';
  }
  return 'NON_DELIVERY_XP_CANONICAL_READY';
}

export const CURRENT_NON_DELIVERY_XP_READINESS_FACTS: Omit<CanonicalNonDeliveryXpReadinessInput, 'scope'> = {
  legacyProgressionState: false,
  fixedOperationsCanonical: true,
  cargoSale: 'SERVER_DERIVED_ZERO_DECAY_ONLY',
  marketplacePurchaseGrantsXp: false,
  marketplacePurchaseCanonicalXp: false,
  recoveryGrantsXp: false,
  recoveryCanonical: false,
  rewardXpSourcesClientOwned: true,
  publicAuthority: false,
};

export const CANONICAL_NON_DELIVERY_OPERATION_XP_READINESS = classifyCanonicalNonDeliveryXpReadiness({
  ...CURRENT_NON_DELIVERY_XP_READINESS_FACTS,
  scope: 'OPERATIONS',
});

export const CANONICAL_NON_DELIVERY_ALL_SOURCES_XP_READINESS = classifyCanonicalNonDeliveryXpReadiness({
  ...CURRENT_NON_DELIVERY_XP_READINESS_FACTS,
  scope: 'ALL_SOURCES',
});
