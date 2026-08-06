/**
 * Market kartı al/sat buton state — pure (RN/theme bağımlılığı yok).
 */

import { tradingBalance } from '../config/balance';
import { calculateTradeBuyCost } from '../simulation/trading';

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
  /** Market kartı CTA — kısa, tek satır */
  label: string;
  /** Uzun açıklama — a11y / dialog */
  detailLabel: string;
  disabled: boolean;
}

export function resolveMarketBuyState(input: MarketBuyStateInput): MarketBuyState {
  const minQty = input.minTradeQuantity ?? tradingBalance.minTradeQuantity;
  const minCost = calculateTradeBuyCost(Math.max(input.unitPrice, 0), minQty);

  if (!input.hasWarehouse) {
    return {
      canBuy: false,
      label: 'Depo yok',
      detailLabel: 'Bu şehirde depo yok. Önce depo açmalısın.',
      disabled: true,
    };
  }
  if (input.canStoreProduct === false) {
    return {
      canBuy: false,
      label: 'Uygun değil',
      detailLabel: 'Uygun depo bulunamadı.',
      disabled: true,
    };
  }
  if (input.marketStock < minQty) {
    return {
      canBuy: false,
      label: 'Stok yok',
      detailLabel: 'Şehir stoğu yetersiz.',
      disabled: true,
    };
  }
  if (input.freeCapacity < minQty) {
    return {
      canBuy: false,
      label: 'Yer yok',
      detailLabel: 'Depo kapasitesi yetersiz.',
      disabled: true,
    };
  }
  if (input.playerMoney < minCost) {
    return {
      canBuy: false,
      label: 'Bakiye yok',
      detailLabel: 'Bakiye yetersiz.',
      disabled: true,
    };
  }

  return {
    canBuy: true,
    label: 'Satın Al',
    detailLabel: 'Satın Al',
    disabled: false,
  };
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
