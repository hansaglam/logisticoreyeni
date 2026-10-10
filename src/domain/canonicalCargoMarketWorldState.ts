/**
 * Canonical cargo market / world state (Map V2 Step 29U).
 *
 * INTERNAL_TEST fixed market snapshots from CITIES_BY_ID start stock/basePrice.
 * Dynamic epoch ticks live in canonicalProductionMarketTick and do not
 * auto-advance unstamped rows. Public buy/sell remain local.
 * Pure. No React. No Firebase.
 */

import { tradingBalance } from '../config/balance';
import { CITIES, CITIES_BY_ID } from '../data/cities';
import { PRODUCT_IDS, PRODUCT_BY_ID } from '../data/products';
import type { ProductId } from '../types/game';
import { calculateTradeBuyCost, calculateTradeSellRevenue } from '../simulation/trading';
import { toProductMarket } from '../simulation/economy';
import { evaluateStorageSuitability } from '../simulation/warehouseStorage';
import type { CanonicalWarehouseDocument } from './canonicalWarehouseState';
import { deriveCanonicalWarehouseSiteOpex } from './canonicalWarehouseState';

export const CANONICAL_CARGO_MARKET_WORLD_STATE_AUTHORITY_STATUS =
  'CANONICAL_CARGO_MARKET_WORLD_STATE_AUTHORITY_PASS_INTERNAL_POLICY_ONLY' as const;

export const CARGO_MARKET_READINESS_STATUS =
  'CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED' as const;
export const PRODUCTION_MARKET_TICK_AUTHORITY =
  'PRODUCTION_MARKET_TICK_AUTHORITY_PASS_INTERNAL_ONLY' as const;
export const WORLD_EVENT_PRICE_PARITY =
  'WORLD_EVENT_PRICE_AUTHORITY_INTERNAL_EPOCH_SCHEDULE' as const;
export const LEGACY_CARGO_INVENTORY = 'LEGACY_CARGO_INVENTORY_UNVERIFIED' as const;
export const CANONICAL_ROAD_CONTRACT_WORLD_STATE =
  'ROAD_CONTRACT_MARKET_STATE_INTERNAL_ONLY' as const;
export const NO_AUTOMATIC_LEGACY_CARGO_MIGRATION = 'NO_AUTOMATIC_LEGACY_CARGO_MIGRATION' as const;

export const CANONICAL_CARGO_MARKET_ENV = 'CANONICAL_CARGO_MARKET_AUTHORITY' as const;
export const CANONICAL_WORLD_MARKETS_COLLECTION = 'canonicalWorldMarkets' as const;
export const CANONICAL_CARGO_INVENTORY_COLLECTION = 'canonicalCargoInventory' as const;
export const CANONICAL_CARGO_MARKET_RECEIPTS_COLLECTION = 'canonicalCargoMarketReceipts' as const;
export const CANONICAL_CARGO_MARKET_POLICY_VERSION = 'canonical-cargo-market-internal-v1' as const;
export const CANONICAL_CARGO_MARKET_SCHEMA_VERSION = 1 as const;
export const CANONICAL_CARGO_MARKET_AUTHORITY_VERSION = 1 as const;
export const CANONICAL_CARGO_MARKET_CLOCK_MODEL = 'INTERNAL_TEST_FIXED_MARKET_SNAPSHOT' as const;

export type CanonicalCargoMarketGate = 'OFF' | 'INTERNAL_TEST';

export function resolveCanonicalCargoMarketGate(options?: {
  envValue?: string | null;
}): CanonicalCargoMarketGate {
  const raw =
    options?.envValue === undefined
      ? String(process.env.CANONICAL_CARGO_MARKET_AUTHORITY ?? '')
      : String(options.envValue ?? '');
  return raw.trim() === 'INTERNAL_TEST' ? 'INTERNAL_TEST' : 'OFF';
}

export function isCanonicalCargoMarketAllowed(options?: {
  envValue?: string | null;
}): boolean {
  return resolveCanonicalCargoMarketGate(options) === 'INTERNAL_TEST';
}

export function isValidCanonicalCargoIntentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{8,80}$/.test(value);
}

export function isCanonicalCargoProductId(value: unknown): value is ProductId {
  return typeof value === 'string' && (PRODUCT_IDS as readonly string[]).includes(value);
}

export function isCanonicalCargoCityId(value: unknown): value is string {
  return typeof value === 'string' && Boolean(CITIES_BY_ID[value]);
}

const FORBIDDEN = [
  'price',
  'unitPrice',
  'totalPrice',
  'stock',
  'marketStock',
  'supply',
  'demand',
  'surplus',
  'shortage',
  'inventory',
  'inventoryAfter',
  'capacity',
  'cashDelta',
  'money',
  'payment',
  'amount',
] as const;

export function hasOnlyCanonicalCargoBuyKeys(data: Record<string, unknown>): boolean {
  if (FORBIDDEN.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['cityId', 'productId', 'quantity', 'warehouseId', 'purchaseIntentId', 'canonicalSchemaVersion'].includes(
      key,
    ),
  );
}

export function hasOnlyCanonicalCargoSellKeys(data: Record<string, unknown>): boolean {
  if (FORBIDDEN.some((key) => key in data)) return false;
  return Object.keys(data).every((key) =>
    ['cityId', 'productId', 'quantity', 'warehouseId', 'saleIntentId', 'canonicalSchemaVersion'].includes(
      key,
    ),
  );
}

export function hasOnlyCanonicalCargoBootstrapKeys(data: Record<string, unknown>): boolean {
  if (FORBIDDEN.some((key) => key in data)) return false;
  return Object.keys(data).every((key) => ['canonicalSchemaVersion'].includes(key));
}

export function createCanonicalWorldMarketId(cityId: string, productId: ProductId): string {
  return `${cityId}_${productId}`;
}

export function createCanonicalCargoInventoryId(warehouseId: string, productId: ProductId): string {
  return `${warehouseId}__${productId}`;
}

export function createCanonicalCargoBuyTransactionId(
  cityId: string,
  productId: ProductId,
  intentId: string,
): string {
  return `cargo:${cityId}:${productId}:buy:${intentId}`;
}

export function createCanonicalCargoSellTransactionId(
  cityId: string,
  productId: ProductId,
  intentId: string,
): string {
  return `cargo:${cityId}:${productId}:sell:${intentId}`;
}

export type CanonicalWorldMarketDocument = {
  schemaVersion: typeof CANONICAL_CARGO_MARKET_SCHEMA_VERSION;
  cityId: string;
  productId: ProductId;
  stock: number;
  basePrice: number;
  currentPrice: number;
  supplyIndex: number;
  demandIndex: number;
  marketRevision: number;
  policyVersion: typeof CANONICAL_CARGO_MARKET_POLICY_VERSION;
  lastUpdatedAtMs: number;
  authorityMode: typeof CANONICAL_CARGO_MARKET_CLOCK_MODEL;
};

export type CanonicalCargoInventoryDocument = {
  schemaVersion: typeof CANONICAL_CARGO_MARKET_SCHEMA_VERSION;
  warehouseId: string;
  productId: ProductId;
  quantity: number;
  inventoryRevision: number;
  ownerUid: string;
  updatedAtMs: number;
  authorityMode: 'INTERNAL_TEST_FIXTURE';
  /** Step 29AH: server-recorded weighted average buy price; null = untrusted/mixed. */
  costBasisPolicyVersion?: string | null;
  averageBuyPrice?: number | null;
};

export type CanonicalCargoMarketReceipt = {
  operationId: string;
  operationType: 'BUY' | 'SELL';
  cityId: string;
  productId: ProductId;
  warehouseId: string;
  quantity: number;
  unitPrice: number;
  totalCashDelta: number;
  cashBefore: number;
  cashAfter: number;
  marketStockBefore: number;
  marketStockAfter: number;
  marketRevisionBefore: number;
  marketRevisionAfter: number;
  inventoryBefore: number;
  inventoryAfter: number;
  inventoryRevisionBefore: number;
  inventoryRevisionAfter: number;
  policyVersion: typeof CANONICAL_CARGO_MARKET_POLICY_VERSION;
  createdAtMs: number;
  authorityMode: typeof CANONICAL_CARGO_MARKET_CLOCK_MODEL;
  ownerUid: string;
  authorityVersion: typeof CANONICAL_CARGO_MARKET_AUTHORITY_VERSION;
  cashTransactionId: string;
};

export function validateCanonicalTradeQuantity(quantity: unknown):
  | { ok: true; quantity: number }
  | { ok: false; reason: string } {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || !Number.isInteger(quantity)) {
    return { ok: false, reason: 'INVALID_QUANTITY' };
  }
  if (quantity < tradingBalance.minTradeQuantity) {
    return { ok: false, reason: 'INVALID_QUANTITY' };
  }
  if (quantity > tradingBalance.maxTradeQuantity) {
    return { ok: false, reason: 'INVALID_QUANTITY' };
  }
  return { ok: true, quantity };
}

export function deriveCanonicalBuyTotal(unitPrice: number, quantity: number): number {
  return Math.round(calculateTradeBuyCost(unitPrice, quantity));
}

export function deriveCanonicalSellTotal(unitPrice: number, quantity: number): number {
  return Math.round(calculateTradeSellRevenue(unitPrice, quantity, 100));
}

export function isProductCompatibleWithWarehouseType(
  productId: ProductId,
  warehouseType: CanonicalWarehouseDocument['warehouseType'],
): boolean {
  const product = PRODUCT_BY_ID[productId];
  if (!product) return false;
  return evaluateStorageSuitability(product, warehouseType) !== 'blocked';
}

export function sumCanonicalWarehouseOccupiedTons(
  rows: readonly CanonicalCargoInventoryDocument[],
  warehouseId: string,
): number {
  return rows
    .filter((row) => row.warehouseId === warehouseId && row.quantity > 0)
    .reduce((sum, row) => sum + row.quantity, 0);
}

export function warehouseOpexUnchangedByInventory(warehouse: CanonicalWarehouseDocument): boolean {
  return (
    deriveCanonicalWarehouseSiteOpex(warehouse).operatingExpense ===
    deriveCanonicalWarehouseSiteOpex(warehouse).operatingExpense
  );
}

export function buildCanonicalWorldMarketBootstrapRecords(
  nowMs: number,
): CanonicalWorldMarketDocument[] {
  const rows: CanonicalWorldMarketDocument[] = [];
  for (const city of CITIES) {
    for (const productId of PRODUCT_IDS) {
      const state = city.products[productId];
      const market = toProductMarket(state);
      rows.push({
        schemaVersion: CANONICAL_CARGO_MARKET_SCHEMA_VERSION,
        cityId: city.id,
        productId,
        stock: Math.round(state.stock),
        basePrice: state.basePrice,
        currentPrice: Math.round(market.currentPrice),
        supplyIndex: state.productionPerDay,
        demandIndex: state.consumptionPerDay,
        marketRevision: 1,
        policyVersion: CANONICAL_CARGO_MARKET_POLICY_VERSION,
        lastUpdatedAtMs: nowMs,
        authorityMode: CANONICAL_CARGO_MARKET_CLOCK_MODEL,
      });
    }
  }
  return rows;
}

export function quoteCanonicalCargoTrade(input: {
  side: 'BUY' | 'SELL';
  market: CanonicalWorldMarketDocument;
  quantity: number;
}): { unitPrice: number; total: number; stock: number } {
  const unitPrice = input.market.currentPrice;
  const total =
    input.side === 'BUY'
      ? deriveCanonicalBuyTotal(unitPrice, input.quantity)
      : deriveCanonicalSellTotal(unitPrice, input.quantity);
  return { unitPrice, total, stock: input.market.stock };
}
