import { StyleSheet, type ViewStyle } from 'react-native';

import { colors } from '../../theme';
import {
  getMarketProductColumnWidths,
  MARKET_HORIZONTAL_PADDING as LAYOUT_HORIZONTAL_PADDING,
  MARKET_NARROW_BREAKPOINT as LAYOUT_NARROW_BREAKPOINT,
  MARKET_PRODUCT_CARD_MIN_HEIGHT as LAYOUT_CARD_MIN_HEIGHT,
  MARKET_PRODUCT_CARD_MIN_HEIGHT_NARROW as LAYOUT_CARD_MIN_HEIGHT_NARROW,
} from '../../utils/marketCardLayout';

export { getMarketProductColumnWidths } from '../../utils/marketCardLayout';

/** Market ekranı layout token'ları */
export const MARKET_HORIZONTAL_PADDING = LAYOUT_HORIZONTAL_PADDING;
export const MARKET_SECTION_GAP = 11;
export const MARKET_SECTION_GAP_TIGHT = 7;
export const MARKET_SCROLL_BOTTOM_EXTRA = 16;
export const MARKET_NARROW_BREAKPOINT = LAYOUT_NARROW_BREAKPOINT;

export const MARKET_HEADER_HEIGHT = 60;
export const MARKET_METRIC_HEIGHT = 58;
export const MARKET_WORLD_EVENT_HEIGHT = 72;
export const MARKET_SUMMARY_STRIP_HEIGHT = 58;
/** Kart içeriği büyüyebilir; sabit height yerine minHeight kullan. */
export const MARKET_PRODUCT_CARD_MIN_HEIGHT = LAYOUT_CARD_MIN_HEIGHT;
export const MARKET_PRODUCT_CARD_MIN_HEIGHT_NARROW = LAYOUT_CARD_MIN_HEIGHT_NARROW;
/** @deprecated Use MARKET_PRODUCT_CARD_MIN_HEIGHT */
export const MARKET_PRODUCT_CARD_HEIGHT = MARKET_PRODUCT_CARD_MIN_HEIGHT;
/** @deprecated Use MARKET_PRODUCT_CARD_MIN_HEIGHT_NARROW */
export const MARKET_PRODUCT_CARD_HEIGHT_NARROW = MARKET_PRODUCT_CARD_MIN_HEIGHT_NARROW;

export const MARKET_CARD_BG = '#081426';
export const MARKET_CARD_BORDER = 'rgba(50,95,150,0.30)';
export const MARKET_SEGMENT_BG = '#081426';
export const MARKET_SEGMENT_BORDER = 'rgba(70,120,190,0.25)';
export const MARKET_REFRESH_BG = '#0C1830';
export const MARKET_REFRESH_BORDER = 'rgba(57,160,255,0.30)';

export const marketStyles = StyleSheet.create({
  screenSections: {
    gap: MARKET_SECTION_GAP,
  },
  screenSectionsTight: {
    gap: MARKET_SECTION_GAP_TIGHT,
  },
});

export function getProductAccentColor(productId: string): string {
  switch (productId) {
    case 'fruit':
      return '#38BDF8';
    case 'steel':
      return '#22D3EE';
    case 'beverage':
      return colors.accentBlue;
    case 'electronics':
      return colors.info;
    default:
      return colors.info;
  }
}

export const marketCityChipActive = {
  backgroundColor: 'rgba(255,170,0,0.10)',
  borderColor: '#FFAA00',
  textColor: '#FFAA00',
} as const;

export const marketCityChipInactive = {
  backgroundColor: '#0A1627',
  borderColor: 'rgba(70,120,190,0.28)',
  textColor: '#8795AA',
} as const;

export function getWorldEventAccent(type: string): string {
  switch (type) {
    case 'harvest_surplus':
      return colors.accentAmber;
    case 'port_congestion':
    case 'road_work':
      return '#22D3EE';
    case 'fuel_crisis':
      return colors.danger;
    default:
      return colors.accentBlue;
  }
}

export function getWorldEventBorderAccent(type: string): ViewStyle {
  const accent = getWorldEventAccent(type);
  return {
    borderColor: `${accent}55`,
    backgroundColor: `${accent}0D`,
  };
}
