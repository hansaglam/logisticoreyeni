import type { ViewStyle } from 'react-native';

import type { DriverMarketItem } from '../../data/drivers';
import type { TrailerMarketItem } from '../../data/trailers';
import type { TruckMarketItem } from '../../data/trucks';
import { resolveTruckMarketRequiredLevel } from '../../data/trucks';
import { getTrailerTypeLabel } from '../../simulation/trailerOps';
import type { DriverTier, TrailerType } from '../../types/game';
import { getTrailerAccentTint } from '../fleet/fleetTheme';

export const SHOP_HORIZONTAL_PADDING = 16;
export const SHOP_NARROW_BREAKPOINT = 360;
export const SHOP_NARROW_HERO_BREAKPOINT = 360;
export const SHOP_SCROLL_BOTTOM_EXTRA = 28;

/** shop-hero-warehouse.png kenar/üst boşluklarından örneklenen baskın koyu arka plan (mode rgb 0,0,12) */
export const SHOP_BACKGROUND = '#00000C';

export const SHOP_BG = '#020914';
export const SHOP_CARD_BG = '#081426';
export const SHOP_CARD_BORDER = 'rgba(50,95,150,0.38)';
export const SHOP_SEGMENT_BG = '#091423';
export const SHOP_SEGMENT_BORDER = '#18365E';
export const SHOP_CHIP_BORDER = 'rgba(50,95,150,0.30)';

export const SHOP_RESOURCE_BAR_HEIGHT = 64;
export const SHOP_RESOURCE_BAR_RADIUS = 22;
export const SHOP_RESOURCE_BAR_BG = '#081426';
export const SHOP_RESOURCE_BAR_BORDER = '#18365E';
export const SHOP_RESOURCE_BAR_PADDING_H = 14;

export const SHOP_HERO_HEIGHT = 88;
export const SHOP_HERO_HEIGHT_COMPACT = 82;
export const SHOP_HERO_PADDING_H = 16;
export const SHOP_HERO_ICON_SIZE = 44;
export const SHOP_HERO_ICON_RADIUS = 12;
export const SHOP_HERO_ICON_GLYPH = 20;
export const SHOP_HERO_ARTWORK_WIDTH = 198;
export const SHOP_HERO_ARTWORK_HEIGHT = 86;
export const SHOP_HERO_ARTWORK_WIDTH_COMPACT = 158;
export const SHOP_HERO_ARTWORK_HEIGHT_COMPACT = 76;
export const SHOP_HERO_ARTWORK_RIGHT = -2;
export const SHOP_HERO_ARTWORK_RIGHT_COMPACT = -2;
export const SHOP_HERO_ARTWORK_SCALE = 0.98;
export const SHOP_HERO_ARTWORK_TRANSLATE_X = 2;
export const SHOP_HERO_ARTWORK_TRANSLATE_Y = 2;
export const SHOP_HERO_CONTENT_PADDING_RIGHT = 155;
export const SHOP_HERO_CONTENT_PADDING_RIGHT_COMPACT = 125;
export const SHOP_HERO_TITLE_SIZE = 22;
export const SHOP_HERO_SUBTITLE_SIZE = 11;
export const SHOP_HERO_SUBTITLE_MAX_WIDTH = 185;
export const SHOP_HERO_CONTENT_GAP = 11;
export const SHOP_HERO_SUBTITLE_COLOR = '#91A0B8';
export const SHOP_HERO_TITLE_COLOR = '#F3F7FF';

export const SHOP_TAB_CONTAINER_RADIUS = 18;
export const SHOP_TAB_CONTAINER_PADDING = 4;
export const SHOP_TAB_CONTAINER_MIN_HEIGHT = 55;
export const SHOP_TAB_HEIGHT = 45;
export const SHOP_TAB_RADIUS = 14;
export const SHOP_TAB_GAP = 6;
export const SHOP_TAB_ICON_SIZE = 16;
export const SHOP_TAB_LABEL_SIZE = 12.5;
export const SHOP_TAB_ACTIVE_BG = 'rgba(35,136,255,0.09)';

export const SHOP_TITLE_COLOR = '#F4F7FF';
export const SHOP_SUBTITLE_COLOR = '#9AACBF';
export const SHOP_MUTED_COLOR = '#A9B6CC';
export const SHOP_INACTIVE_TAB = '#A0AEC0';
export const SHOP_ACTIVE_TAB = '#2F98FF';
export const SHOP_ACTIVE_TAB_BORDER = '#2388FF';
export const SHOP_PRICE_COLOR = '#11C96B';

export const SHOP_SPACING_RESOURCE_TO_HERO = 11;
export const SHOP_SPACING_HERO_TO_TABS = 8;
export const SHOP_SPACING_TABS_TO_FILTERS = 12;

export type { ShopCategory } from '../../navigation/tabTypes';

export type TruckShopClass = 'light' | 'medium' | 'tractor' | 'heavy';

const TRUCK_CLASS_BY_CATALOG: Record<string, TruckShopClass> = {
  'truck-ford-cargo': 'light',
  'truck-volvo-fh': 'tractor',
  'truck-mercedes-actros': 'tractor',
  'truck-refrigerated': 'medium',
  'truck-heavy-haul': 'heavy',
};

const TRUCK_CLASS_LABELS: Record<TruckShopClass, string> = {
  light: 'Hafif',
  medium: 'Orta',
  tractor: 'Çekici',
  heavy: 'Ağır',
};

export function resolveTruckShopClass(catalogId: string): TruckShopClass {
  return TRUCK_CLASS_BY_CATALOG[catalogId] ?? 'medium';
}

export function getTruckShopClassLabel(catalogId: string): string {
  return TRUCK_CLASS_LABELS[resolveTruckShopClass(catalogId)];
}

export function getMarketCardArtworkWidthPercent(isCompact: boolean): `${number}%` {
  return isCompact ? '40%' : '44%';
}

export function getTruckMarketArtworkLayout(
  catalogId: string,
  isCompact: boolean,
): {
  scale: number;
  translateY: number;
  imageWidth: `${number}%`;
  imageHeight: number;
  columnWidthPercent: `${number}%`;
} {
  const truckClass = resolveTruckShopClass(catalogId);

  switch (truckClass) {
    case 'heavy':
      return {
        scale: isCompact ? 1.1 : 1.14,
        translateY: isCompact ? 2 : 3,
        imageWidth: '96%',
        imageHeight: isCompact ? 118 : 126,
        columnWidthPercent: isCompact ? '42%' : '46%',
      };
    case 'tractor':
      return {
        scale: isCompact ? 1.06 : 1.1,
        translateY: isCompact ? 1 : 2,
        imageWidth: '94%',
        imageHeight: isCompact ? 114 : 124,
        columnWidthPercent: isCompact ? '40%' : '44%',
      };
    default:
      return {
        scale: 1,
        translateY: 0,
        imageWidth: '94%',
        imageHeight: isCompact ? 112 : 120,
        columnWidthPercent: isCompact ? '40%' : '44%',
      };
  }
}

export function getTrailerMarketArtworkLayout(
  trailerType: TrailerType,
  isCompact: boolean,
): {
  scale: number;
  translateX: number;
  translateY: number;
  imageHeight: number;
} {
  switch (trailerType) {
    case 'heavy':
      return {
        scale: isCompact ? 1.25 : 1.35,
        translateX: 0,
        translateY: isCompact ? 2 : 4,
        imageHeight: isCompact ? 118 : 128,
      };
    case 'container':
      return {
        scale: isCompact ? 1.14 : 1.22,
        translateX: isCompact ? 1 : 2,
        translateY: isCompact ? 2 : 3,
        imageHeight: isCompact ? 118 : 130,
      };
    case 'refrigerated':
      return {
        scale: isCompact ? 1.04 : 1.06,
        translateX: 0,
        translateY: 0,
        imageHeight: isCompact ? 114 : 124,
      };
    default:
      return {
        scale: isCompact ? 1.02 : 1.04,
        translateX: 0,
        translateY: 0,
        imageHeight: isCompact ? 114 : 124,
      };
  }
}

export function getTrailerMarketFeatureLine(template: TrailerMarketItem): string {
  switch (template.type) {
    case 'refrigerated':
      return 'Sıcaklık kontrolü';
    case 'heavy':
      return 'Ağır yük uyumu';
    case 'container':
      return 'Liman / konteyner uyumu';
    default:
      return 'Dayanıklılık 60';
  }
}

export function getTrailerMarketAccentBorder(trailerType: TrailerType): ViewStyle {
  switch (trailerType) {
    case 'heavy':
      return { borderColor: 'rgba(245,158,11,0.32)' };
    case 'refrigerated':
      return { borderColor: 'rgba(34,211,238,0.36)' };
    case 'container':
      return { borderColor: 'rgba(167,139,250,0.32)' };
    default:
      return { borderColor: SHOP_CARD_BORDER };
  }
}

export function getTrailerMarketAccentColor(trailerType: TrailerType): string {
  return getTrailerAccentTint(trailerType);
}

export function getTruckMarketFeatureLine(template: TruckMarketItem): string {
  return `Dayanıklılık ${template.reliability}`;
}

export function isExpertDriverTier(tier: DriverTier): boolean {
  return tier === 'expert' || tier === 'international';
}

export function isDriverAffordable(
  template: DriverMarketItem,
  playerMoney: number,
  playerLevel: number,
  alreadyHired: boolean,
): boolean {
  if (alreadyHired || template.comingSoon) return false;
  const requiredLevel = template.requiredLevel ?? 1;
  if (playerLevel < requiredLevel) return false;
  return playerMoney >= template.hiringFee;
}

export function formatTrailerMarketSubtitle(template: TrailerMarketItem): string {
  return `${getTrailerTypeLabel(template.type)} · +${template.capacityBonusTons} t`;
}

export function formatTruckMarketSubtitle(template: TruckMarketItem): string {
  return `${getTruckShopClassLabel(template.id)} · ${template.capacity} t`;
}

export function formatLevelRequirement(requiredLevel: number): string {
  return requiredLevel > 1 ? `Lv. ${requiredLevel}+` : 'Lv. 1+';
}

export function isTruckLevelLocked(template: TruckMarketItem, playerLevel: number): boolean {
  return playerLevel < resolveTruckMarketRequiredLevel(template);
}

export function isTrailerLevelLocked(template: TrailerMarketItem, playerLevel: number): boolean {
  const requiredLevel = template.requiredLevel ?? 1;
  return playerLevel < requiredLevel;
}

export function isDriverLevelLocked(template: DriverMarketItem, playerLevel: number): boolean {
  return playerLevel < (template.requiredLevel ?? 1);
}

/** UI sıralama: 1 işe alınabilir · 2 kilitli/yetersiz · 3 kadroda */
export function getDriverMarketSortRank(
  template: DriverMarketItem,
  playerMoney: number,
  playerLevel: number,
  alreadyHired: boolean,
): number {
  if (alreadyHired) return 3;
  if (isDriverAffordable(template, playerMoney, playerLevel, alreadyHired)) return 1;
  return 2;
}
