/**
 * Piyasa / depo ticaret UI — kâr/zarar metinleri ve buton validasyonu.
 */

import { tradingBalance } from '../config/balance';
import {
  buildTradeProfitBreakdown,
  calculateTradeBuyCost,
  type TradeProfitBreakdown,
} from '../simulation/trading';
import { colors, formatMoney } from '../theme';

export const TRADE_FEE_NEGATIVE_PROFIT_NOTE =
  'Komisyon nedeniyle anlık zarar normal. Fiyat yükselirse kâra geçebilir.';

export interface TradeProfitDisplay {
  label: string;
  sublabel: string | null;
  feeNote: string | null;
  color: string;
}

export function formatTradeProfitDisplay(netProfit: number): TradeProfitDisplay {
  if (!Number.isFinite(netProfit) || Math.abs(netProfit) < 1) {
    return {
      label: 'Başabaş',
      sublabel: 'Komisyon sonrası',
      feeNote: null,
      color: colors.textMuted,
    };
  }

  if (netProfit > 0) {
    return {
      label: `Net kâr: +${formatMoney(netProfit)}`,
      sublabel: null,
      feeNote: null,
      color: colors.success,
    };
  }

  return {
    label: `Anlık zarar: ${formatMoney(netProfit)}`,
    sublabel: 'İşlem gideri dahil',
    feeNote: TRADE_FEE_NEGATIVE_PROFIT_NOTE,
    color: colors.danger,
  };
}

/** Market / depo — aynı stok için tek kâr hesabı ve format */
export function resolveInventoryTradeProfit(
  sellUnitPrice: number,
  averageBuyPrice: number,
  quantity: number,
  quality = 100,
): { breakdown: TradeProfitBreakdown; display: TradeProfitDisplay } {
  const breakdown = buildTradeProfitBreakdown(
    sellUnitPrice,
    averageBuyPrice,
    quantity,
    quality,
  );
  return {
    breakdown,
    display: formatTradeProfitDisplay(breakdown.netProfit),
  };
}

export interface MarketBuyStateInput {
  hasWarehouse: boolean;
  marketStock: number;
  freeCapacity: number;
  playerMoney: number;
  unitPrice: number;
  canStoreProduct?: boolean;
  minTradeQuantity?: number;
}

export interface MarketBuyState {
  canBuy: boolean;
  label: string;
  disabled: boolean;
}

export function resolveMarketBuyState(input: MarketBuyStateInput): MarketBuyState {
  const minQty = input.minTradeQuantity ?? tradingBalance.minTradeQuantity;
  const minCost = calculateTradeBuyCost(Math.max(input.unitPrice, 0), minQty);

  if (!input.hasWarehouse) {
    return { canBuy: false, label: 'Depo gerekli', disabled: true };
  }
  if (input.canStoreProduct === false) {
    return { canBuy: false, label: 'Depo uygun değil', disabled: true };
  }
  if (input.marketStock < minQty) {
    return { canBuy: false, label: 'Stok yetersiz', disabled: true };
  }
  if (input.freeCapacity < minQty) {
    return { canBuy: false, label: 'Depoda yer yok', disabled: true };
  }
  if (input.playerMoney < minCost) {
    return { canBuy: false, label: 'Nakit yetersiz', disabled: true };
  }

  return { canBuy: true, label: 'Satın Al', disabled: false };
}

export interface MarketSellStateInput {
  hasWarehouse: boolean;
  inventoryQuantity: number;
  minTradeQuantity?: number;
}

export interface MarketSellState {
  canSell: boolean;
  showSellButton: boolean;
  label: string;
  disabled: boolean;
}

export function resolveMarketSellState(input: MarketSellStateInput): MarketSellState {
  const minQty = input.minTradeQuantity ?? tradingBalance.minTradeQuantity;

  if (!input.hasWarehouse || input.inventoryQuantity <= 0) {
    return {
      canSell: false,
      showSellButton: false,
      label: 'Sat',
      disabled: true,
    };
  }

  if (input.inventoryQuantity < minQty) {
    return {
      canSell: false,
      showSellButton: true,
      label: `Min. ${minQty} ton`,
      disabled: true,
    };
  }

  return {
    canSell: true,
    showSellButton: true,
    label: 'Sat',
    disabled: false,
  };
}
