import { vec } from '@shopify/react-native-skia';

import type { ProjectedBoundingBox } from '../geo/webMercator';

/** Dashboard land fill. Boundary still comes from the verified country path. */
export const COUNTRY_DASHBOARD_FILL = ['#082636', '#0E4A5C', '#17687A', '#0B3A4C'] as const;
export const COUNTRY_DASHBOARD_COAST_UNDER = 'rgba(2, 8, 18, 0.9)';
export const COUNTRY_DASHBOARD_COAST = '#7EC8D4';
export const COUNTRY_DASHBOARD_INNER = 'rgba(214, 246, 238, 0.22)';
export const COUNTRY_DASHBOARD_COAST_UNDER_WIDTH = 0.00118;
export const COUNTRY_DASHBOARD_COAST_WIDTH = 0.0003;
export const COUNTRY_DASHBOARD_INNER_WIDTH = 0.00013;
export const COUNTRY_DASHBOARD_TINT = 'rgba(18, 70, 78, 0.16)';
export const COUNTRY_DASHBOARD_TINT_2 = 'rgba(28, 52, 86, 0.2)';
export const COUNTRY_DASHBOARD_TINT_COAST = 'rgba(46, 122, 118, 0.16)';
export const COUNTRY_DASHBOARD_TINT_EAST = 'rgba(20, 44, 58, 0.28)';
export const COUNTRY_DASHBOARD_HIGHLIGHT = 'rgba(196, 236, 226, 0.07)';
export const COUNTRY_DASHBOARD_RIDGE = 'rgba(186, 214, 206, 0.11)';
export const COUNTRY_DASHBOARD_RIDGE_WIDTH = 0.00028;
export const COUNTRY_DASHBOARD_OCEAN = ['#01070E', '#02111C', '#031624'] as const;

export {
  COUNTRY_CORRIDOR_BASE,
  COUNTRY_CORRIDOR_CONNECTED,
  COUNTRY_CORRIDOR_CONNECTED_TINT,
  COUNTRY_CORRIDOR_DIMMED_OPACITY,
  COUNTRY_CORRIDOR_HIGHLIGHT,
  COUNTRY_CORRIDOR_LOCKED,
  COUNTRY_CORRIDOR_LOCKED_SELECTED,
  COUNTRY_CORRIDOR_MAIN,
  COUNTRY_CORRIDOR_MIXED,
  COUNTRY_CORRIDOR_WIDTH_BASE,
  COUNTRY_CORRIDOR_WIDTH_CONNECTED,
  COUNTRY_CORRIDOR_WIDTH_HIGHLIGHT,
  COUNTRY_CORRIDOR_WIDTH_MAIN,
  corridorInteractionPaint,
} from './countryCorridorPaint';

export function countryDashboardGradientPoints(bounds: ProjectedBoundingBox) {
  return {
    start: vec(bounds.minX, bounds.minY),
    end: vec(bounds.minX + (bounds.maxX - bounds.minX) * 0.42, bounds.maxY),
  };
}

/** Decorative only — clipped to verified polygon. Not admin regions or terrain data. */
export function countryDashboardTintCenters(bounds: ProjectedBoundingBox) {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const r = Math.min(w, h) * 0.24;
  return [
    { cx: bounds.minX + w * 0.22, cy: bounds.minY + h * 0.48, r: r * 1.05, color: COUNTRY_DASHBOARD_TINT_COAST },
    { cx: bounds.minX + w * 0.46, cy: bounds.minY + h * 0.42, r: r * 0.95, color: COUNTRY_DASHBOARD_TINT_2 },
    { cx: bounds.minX + w * 0.72, cy: bounds.minY + h * 0.4, r: r * 1.15, color: COUNTRY_DASHBOARD_TINT_EAST },
    { cx: bounds.minX + w * 0.58, cy: bounds.minY + h * 0.68, r: r * 0.82, color: COUNTRY_DASHBOARD_TINT },
  ];
}

export function countryDashboardInnerHighlight(bounds: ProjectedBoundingBox) {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  return {
    cx: bounds.minX + w * 0.4,
    cy: bounds.minY + h * 0.46,
    r: Math.min(w, h) * 0.28,
    color: COUNTRY_DASHBOARD_HIGHLIGHT,
  };
}

/** Stylized ridge hints in eastern Türkiye. Not elevation data. */
export function countryDashboardRidgeBands(bounds: ProjectedBoundingBox) {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  return [
    {
      x1: bounds.minX + w * 0.6,
      y1: bounds.minY + h * 0.26,
      x2: bounds.minX + w * 0.9,
      y2: bounds.minY + h * 0.4,
    },
    {
      x1: bounds.minX + w * 0.58,
      y1: bounds.minY + h * 0.38,
      x2: bounds.minX + w * 0.92,
      y2: bounds.minY + h * 0.54,
    },
    {
      x1: bounds.minX + w * 0.64,
      y1: bounds.minY + h * 0.5,
      x2: bounds.minX + w * 0.94,
      y2: bounds.minY + h * 0.64,
    },
  ];
}
