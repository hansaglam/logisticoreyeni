/**
 * Piyasa / depo ticaret UI — kâr/zarar metinleri ve buton validasyonu.
 */

import {
  buildTradeProfitBreakdown,
  type TradeProfitBreakdown,
} from '../simulation/trading';
import { colors, formatMoney } from '../theme';

export {
  resolveMarketBuyState,
  resolveMarketSellState,
  type MarketBuyState,
  type MarketBuyStateInput,
  type MarketSellState,
  type MarketSellStateInput,
} from './marketTradeState';

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
