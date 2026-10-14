/** Geographic city markers. Availability tokens are visual only — policy lives in cityProgression. */

import { mapVisualTokens } from './mapVisualTokens';

export const CITY_NODE_DEFAULT = {
  hubRadius: 4.6,
  coreRadius: 1.35,
  ringRadius: 6.35,
  ringWidth: 1.15,
  fill: mapVisualTokens.cityDefault,
  core: '#F4FBFF',
  ring: 'rgba(126, 231, 245, 0.62)',
} as const;

export const CITY_NODE_CAPITAL = {
  hubRadius: 5.35,
  coreRadius: 1.45,
  ringRadius: 7.35,
  ringWidth: 1.2,
  goldRing: '#E4C16A',
  goldWidth: 1.25,
  motifRadius: 1.2,
  motif: '#F6E2A2',
} as const;

export const CITY_NODE_HINT = {
  home: '#E8C36A',
  warehouse: '#9BD4F0',
  active: '#5EEAD4',
} as const;

export const CITY_NODE_SELECTED = {
  haloRadiusAdd: 7.4,
  halo: mapVisualTokens.cityHalo,
  ringAdd: 3.6,
  ring: mapVisualTokens.selectionOutline,
  ringWidth: 1.55,
  stem: 'rgba(232, 248, 255, 0.34)',
} as const;

export const CITY_NODE_STARTER = {
  fill: '#5EEAD4',
  core: '#F2FFFC',
  ring: 'rgba(186, 250, 236, 0.95)',
} as const;

export const CITY_NODE_LOCKED = {
  fill: '#1A2A3A',
  core: '#6B7C8C',
  ring: 'rgba(120, 140, 160, 0.42)',
  marker: '#8A9BB0',
} as const;

export const CITY_LABEL_DEFAULT = {
  fill: mapVisualTokens.labelSecondary,
  fontSize: 12,
} as const;

export const CITY_LABEL_CAPITAL = {
  fill: '#F3E4B8',
  fontSize: 11,
} as const;

export const CITY_LABEL_SELECTED = {
  fill: mapVisualTokens.labelSelected,
  fontSize: 13,
  backplate: 'rgba(4, 12, 22, 0.72)',
} as const;

export const CITY_LABEL_LOCKED = {
  fill: '#8A9BB0',
  fontSize: 11,
} as const;

export const CITY_LABEL_CONNECTED = {
  fill: '#E2ECF2',
  fontSize: 11,
} as const;

/** Debug / non-dashboard markers. */
export const CITY_MARKER_FILL = CITY_NODE_DEFAULT.fill;
export const CITY_MARKER_GLOW = CITY_NODE_SELECTED.halo;
export const CITY_MARKER_SELECTED_RING = CITY_NODE_SELECTED.ring;
export const CITY_MARKER_LEGACY_HALO = '#FBBF24';
export const CITY_MARKER_CAPITAL_RING = CITY_NODE_CAPITAL.goldRing;
export const CITY_LABEL_FILL = CITY_LABEL_DEFAULT.fill;
export const CITY_LABEL_SELECTED_FILL = CITY_LABEL_SELECTED.fill;

export const CITY_MARKER_RADIUS_PX = 4.2;
export const CITY_MARKER_DASHBOARD_RADIUS_PX = CITY_NODE_DEFAULT.hubRadius;
export const CITY_MARKER_CAPITAL_RADIUS_PX = CITY_NODE_CAPITAL.hubRadius;
export const CITY_HIT_RADIUS_PX = 22;
export const CITY_LABEL_MIN_DISTANCE_PX = 48;
export const CITY_LABEL_OFFSET_X_PX = 10;
export const CITY_LABEL_OFFSET_Y_PX = -13;
export const CITY_LABEL_CONNECTOR_MIN_PX = 28;

/** Screen-space only. Keys are Natural Earth NAMEASCII. Does not move GeoCity coordinates. */
export const CITY_DASHBOARD_LABEL_OFFSETS: Record<string, { x: number; y: number }> = {
  Istanbul: { x: 14, y: -20 },
  Bursa: { x: 13, y: 18 },
  Izmir: { x: 16, y: 16 },
  Ankara: { x: 14, y: -22 },
  Antalya: { x: 12, y: 18 },
  Adana: { x: 14, y: 17 },
  Diyarbakir: { x: 14, y: -18 },
  Trabzon: { x: -46, y: 16 },
};

export function cityDashboardLabelOffset(city: {
  sourceNameAscii: string;
  settlementClass: string;
}): { x: number; y: number } {
  const mapped = CITY_DASHBOARD_LABEL_OFFSETS[city.sourceNameAscii];
  if (mapped) return mapped;
  if (city.settlementClass === 'CAPITAL') return { x: 11, y: -16 };
  return { x: CITY_LABEL_OFFSET_X_PX, y: CITY_LABEL_OFFSET_Y_PX };
}

export function cityDashboardLabelNeedsConnector(offset: { x: number; y: number }): boolean {
  return Math.hypot(offset.x, offset.y) >= CITY_LABEL_CONNECTOR_MIN_PX;
}

export function cityLabelFill(opts: {
  selected: boolean;
  capital: boolean;
  locked?: boolean;
  connected?: boolean;
}): string {
  if (opts.selected) return CITY_LABEL_SELECTED.fill;
  if (opts.locked) return CITY_LABEL_LOCKED.fill;
  if (opts.capital) return CITY_LABEL_CAPITAL.fill;
  if (opts.connected) return CITY_LABEL_CONNECTED.fill;
  return CITY_LABEL_DEFAULT.fill;
}

export function cityDashboardHubFill(availability: 'STARTER' | 'UNLOCKED' | 'LOCKED' | 'NOT_AVAILABLE' | undefined): string {
  if (availability === 'LOCKED' || availability === 'NOT_AVAILABLE') return CITY_NODE_LOCKED.fill;
  if (availability === 'STARTER') return CITY_NODE_STARTER.fill;
  return CITY_NODE_DEFAULT.fill;
}

export function cityDashboardCoreFill(opts: {
  availability: 'STARTER' | 'UNLOCKED' | 'LOCKED' | 'NOT_AVAILABLE' | undefined;
  capital: boolean;
}): string {
  if (opts.availability === 'LOCKED' || opts.availability === 'NOT_AVAILABLE') return CITY_NODE_LOCKED.core;
  if (opts.capital) return CITY_NODE_CAPITAL.motif;
  if (opts.availability === 'STARTER') return CITY_NODE_STARTER.core;
  return CITY_NODE_DEFAULT.core;
}
