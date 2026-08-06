/**
 * Market ürün kartı kolon ölçüleri — platform-agnostic responsive layout.
 */

export const MARKET_HORIZONTAL_PADDING = 16;
export const MARKET_NARROW_BREAKPOINT = 360;
export const MARKET_PRODUCT_CARD_MIN_HEIGHT = 110;
export const MARKET_PRODUCT_CARD_MIN_HEIGHT_NARROW = 104;
/** Kart içi yatay gap (productCardInner gap) × 2 kolon arası */
export const MARKET_PRODUCT_CARD_COLUMN_GAP_TOTAL = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Ürün kartı kolonları — ekran genişliğine göre responsive.
 * Platform.OS hardcode yok; iOS/Android aynı hesap.
 */
export function getMarketProductColumnWidths(screenWidth: number): {
  leftCol: number;
  actionCol: number;
  chartMinWidth: number;
  contentWidth: number;
} {
  const isNarrow = screenWidth < MARKET_NARROW_BREAKPOINT;
  const contentWidth = Math.max(0, screenWidth - MARKET_HORIZONTAL_PADDING * 2 - 22);

  // Kısa CTA label'ları için 100–128 px yeterli.
  let actionCol = clamp(
    Math.round(contentWidth * 0.24),
    isNarrow ? 100 : 108,
    isNarrow ? 112 : 128,
  );
  let leftCol = clamp(
    Math.round(contentWidth * 0.32),
    isNarrow ? 100 : 112,
    isNarrow ? 128 : 148,
  );

  const gapBudget = MARKET_PRODUCT_CARD_COLUMN_GAP_TOTAL;
  let remaining = contentWidth - leftCol - actionCol - gapBudget;

  // Küçük ekranda sparkline + açıklama için minimum alan koru.
  const minChart = isNarrow ? 64 : 72;
  if (remaining < minChart) {
    const deficit = minChart - remaining;
    const leftShrink = Math.min(deficit, Math.max(0, leftCol - (isNarrow ? 96 : 104)));
    leftCol -= leftShrink;
    remaining += leftShrink;
    if (remaining < minChart) {
      const actionShrink = Math.min(
        minChart - remaining,
        Math.max(0, actionCol - (isNarrow ? 100 : 108)),
      );
      actionCol -= actionShrink;
      remaining += actionShrink;
    }
  }

  const chartMinWidth = clamp(remaining, minChart, 96);

  return {
    leftCol,
    actionCol,
    chartMinWidth,
    contentWidth,
  };
}
