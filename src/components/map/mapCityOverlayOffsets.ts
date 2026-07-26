import { normalizeCityId } from '../../data/networkPositions';

export interface CityOverlayOffset {
  x: number;
  y: number;
}

export interface CityOverlayOffsets {
  countBadge: CityOverlayOffset;
  depot: CityOverlayOffset;
  opportunity: CityOverlayOffset;
}

const DEFAULT_OVERLAY_OFFSETS: CityOverlayOffsets = {
  countBadge: { x: 10, y: -18 },
  depot: { x: -14, y: 10 },
  opportunity: { x: -16, y: -20 },
};

/** Batı bölgesi şehirlerinde overlay çakışmasını azaltır. */
export const CITY_OVERLAY_OFFSETS: Record<string, CityOverlayOffsets> = {
  istanbul: {
    countBadge: { x: 18, y: 8 },
    depot: { x: -18, y: 16 },
    opportunity: { x: 14, y: -16 },
  },
  bursa: {
    countBadge: { x: -18, y: 12 },
    depot: { x: 16, y: -12 },
    opportunity: { x: 18, y: 12 },
  },
  izmir: {
    countBadge: { x: 16, y: -12 },
    depot: { x: -16, y: 12 },
    opportunity: { x: 18, y: 14 },
  },
  ankara: {
    countBadge: { x: 12, y: -16 },
    depot: { x: -12, y: 14 },
    opportunity: { x: 14, y: -14 },
  },
  antalya: {
    countBadge: { x: -14, y: 10 },
    depot: { x: 14, y: -10 },
    opportunity: { x: 16, y: 12 },
  },
};

export function getCityOverlayOffsets(cityId: string): CityOverlayOffsets {
  return CITY_OVERLAY_OFFSETS[normalizeCityId(cityId)] ?? DEFAULT_OVERLAY_OFFSETS;
}
