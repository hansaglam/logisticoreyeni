import { StyleSheet, type ViewStyle } from 'react-native';

import { colors } from '../../theme';
import type { TrailerType } from '../../types/game';

export const FLEET_HORIZONTAL_PADDING = 16;
export const FLEET_SECTION_GAP = 10;
export const FLEET_SCROLL_BOTTOM_EXTRA = 16;
export const FLEET_NARROW_BREAKPOINT = 360;

export const FLEET_HEADER_HEIGHT = 58;
export const FLEET_METRIC_HEIGHT = 56;
export const FLEET_TRUCK_CARD_MIN_HEIGHT = 162;
export const FLEET_DRIVER_CARD_MIN_HEIGHT = 174;
export const FLEET_TRAILER_CARD_MIN_HEIGHT = 161;

export const FLEET_ASSIGN_BADGE_ACTIVE_BG = 'rgba(35,136,255,0.12)';
export const FLEET_ASSIGN_BADGE_ACTIVE_BORDER = 'rgba(35,136,255,0.55)';
export const FLEET_ASSIGN_BADGE_ACTIVE_TEXT = '#39A0FF';
export const FLEET_ASSIGN_BADGE_IDLE_BG = 'rgba(245,158,11,0.10)';
export const FLEET_ASSIGN_BADGE_IDLE_BORDER = 'rgba(245,158,11,0.40)';
export const FLEET_ASSIGN_BADGE_IDLE_TEXT = '#F5A623';

export const FLEET_AVATAR_BG = '#0D1A2D';
export const FLEET_AVATAR_BORDER = 'rgba(60,110,170,0.30)';
export const FLEET_SKILL_PILL_BG = '#0D1A2D';
export const FLEET_PROGRESS_TRACK = '#132238';
export const FLEET_LEVEL_COLOR = '#39A0FF';
export const FLEET_SALARY_COLOR = '#F5A623';

export const FLEET_CARD_BG = '#081426';
export const FLEET_CARD_BORDER = 'rgba(50,95,150,0.38)';
export const FLEET_SEGMENT_BG = '#081426';
export const FLEET_SEGMENT_BORDER = 'rgba(70,120,190,0.25)';

export const FLEET_RENTAL_BADGE_BG = 'rgba(245,158,11,0.13)';
export const FLEET_RENTAL_BADGE_BORDER = 'rgba(245,158,11,0.55)';
export const FLEET_RENTAL_BADGE_TEXT = '#F5A623';

export function getFleetTruckColumnWidths(screenWidth: number): {
  artworkCol: number;
  imageWidth: number;
  imageHeight: number;
  valueCol: number;
} {
  const isNarrow = screenWidth < FLEET_NARROW_BREAKPOINT;
  return {
    artworkCol: isNarrow ? 102 : 122,
    imageWidth: isNarrow ? 104 : 124,
    imageHeight: isNarrow ? 74 : 88,
    valueCol: isNarrow ? 66 : 76,
  };
}

export function getFleetDriverColumnWidths(screenWidth: number): {
  avatarSize: number;
  avatarRadius: number;
  rightCol: number;
  slotBadgeWidth: number;
} {
  const isNarrow = screenWidth < FLEET_NARROW_BREAKPOINT;
  return {
    avatarSize: isNarrow ? 50 : 58,
    avatarRadius: isNarrow ? 15 : 17,
    rightCol: isNarrow ? 66 : 76,
    slotBadgeWidth: isNarrow ? 50 : 56,
  };
}

export type TrailerArtworkLayout = {
  columnWidth: number;
  imageWidth: number;
  imageHeight: number;
  scale: number;
  translateX: number;
  translateY: number;
  statusCol: number;
};

type TrailerArtworkPreset = Omit<TrailerArtworkLayout, 'statusCol'>;

const TRAILER_ARTWORK_BY_TYPE: Record<
  TrailerType,
  { normal: TrailerArtworkPreset; compact: TrailerArtworkPreset }
> = {
  standard: {
    normal: {
      columnWidth: 112,
      imageWidth: 120,
      imageHeight: 76,
      scale: 1.03,
      translateX: 0,
      translateY: 0,
    },
    compact: {
      columnWidth: 92,
      imageWidth: 100,
      imageHeight: 64,
      scale: 1.02,
      translateX: 0,
      translateY: 0,
    },
  },
  heavy: {
    normal: {
      columnWidth: 128,
      imageWidth: 158,
      imageHeight: 86,
      scale: 1.36,
      translateX: 0,
      translateY: 3,
    },
    compact: {
      columnWidth: 102,
      imageWidth: 126,
      imageHeight: 70,
      scale: 1.22,
      translateX: 0,
      translateY: 2,
    },
  },
  refrigerated: {
    normal: {
      columnWidth: 112,
      imageWidth: 120,
      imageHeight: 76,
      scale: 1.03,
      translateX: 0,
      translateY: 0,
    },
    compact: {
      columnWidth: 92,
      imageWidth: 100,
      imageHeight: 64,
      scale: 1.02,
      translateX: 0,
      translateY: 0,
    },
  },
  container: {
    normal: {
      columnWidth: 132,
      imageWidth: 164,
      imageHeight: 92,
      scale: 1.3,
      translateX: 2,
      translateY: 3,
    },
    compact: {
      columnWidth: 110,
      imageWidth: 136,
      imageHeight: 76,
      scale: 1.22,
      translateX: 1,
      translateY: 2,
    },
  },
};

export function getTrailerArtworkLayout(
  trailerType: TrailerType,
  isCompact: boolean,
): TrailerArtworkLayout {
  const preset = TRAILER_ARTWORK_BY_TYPE[trailerType] ?? TRAILER_ARTWORK_BY_TYPE.standard;
  const layout = isCompact ? preset.compact : preset.normal;
  return {
    ...layout,
    statusCol: isCompact ? 58 : 68,
  };
}

export function getTrailerAccentBorder(trailerType: TrailerType): ViewStyle {
  switch (trailerType) {
    case 'heavy':
      return { borderColor: 'rgba(245,158,11,0.38)' };
    case 'refrigerated':
      return { borderColor: 'rgba(34,211,238,0.42)' };
    case 'container':
      return { borderColor: 'rgba(167,139,250,0.35)' };
    default:
      return { borderColor: FLEET_CARD_BORDER };
  }
}

export function getTrailerAccentTint(trailerType: TrailerType): string {
  switch (trailerType) {
    case 'heavy':
      return colors.accentAmber;
    case 'refrigerated':
      return '#22D3EE';
    case 'container':
      return '#A78BFA';
    default:
      return colors.accentBlue;
  }
}

export function getTruckAccentBorder(catalogId: string): ViewStyle {
  switch (catalogId) {
    case 'truck-refrigerated':
      return { borderColor: 'rgba(34,211,238,0.42)' };
    case 'truck-heavy-haul':
      return { borderColor: 'rgba(245,158,11,0.38)' };
    case 'truck-volvo-fh':
    case 'truck-mercedes-actros':
      return { borderColor: 'rgba(167,139,250,0.35)' };
    default:
      return { borderColor: FLEET_CARD_BORDER };
  }
}

export function getTruckAccentTint(catalogId: string): string {
  switch (catalogId) {
    case 'truck-refrigerated':
      return '#22D3EE';
    case 'truck-heavy-haul':
      return colors.accentAmber;
    case 'truck-volvo-fh':
    case 'truck-mercedes-actros':
      return '#A78BFA';
    default:
      return colors.accentBlue;
  }
}

export function stripLeaseSuffixFromTruckName(name: string): string {
  return name.replace(/\s*\(Kiralık\)\s*$/i, '').trim();
}
