/**
 * Harita görsel katmanı — lojistik ağ renk paleti.
 */

import { normalizeCityId } from './networkPositions';

export const MAP_COLORS = {
  oceanDeep: '#020B14',
  oceanMid: '#061827',
  oceanLight: '#0C2438',
  landFill: '#1A3347',
  landHighlight: '#234A63',
  landEdge: '#4A7A9B',
  coastGlow: '#5BA3C9',
  routeIdle: '#334155',
  routeDim: '#475569',
  routeActive: '#38BDF8',
  routeHighlight: '#F59E0B',
  routeGlow: 'rgba(56, 189, 248, 0.35)',
  cityDefault: '#64748B',
  citySelected: '#F59E0B',
  cityDepot: '#F59E0B',
  labelBg: 'rgba(2, 8, 18, 0.82)',
  labelBorder: 'rgba(100, 116, 139, 0.35)',
  truckActive: '#38BDF8',
  truckIdle: '#64748B',
  truckSelected: '#F59E0B',
  success: '#22C55E',
  danger: '#EF4444',
  text: '#F8FAFC',
  muted: '#94A3B8',
} as const;

/** Bezier eğrili Türkiye ana silueti — yatay, geniş form */
export const TURKEY_OUTLINE =
  'M 132 290 C 118 210, 138 92, 268 58 C 398 24, 528 38, 648 48 C 768 58, 898 88, 938 158 C 978 228, 958 328, 868 378 C 778 428, 598 438, 418 418 C 238 398, 158 358, 132 290 Z';

/** İç plato / Anadolu vurgusu */
export const TURKEY_PLATEAU =
  'M 218 252 C 288 162, 418 132, 568 142 C 718 152, 818 202, 788 292 C 758 342, 598 362, 428 342 C 258 322, 218 282, 218 252 Z';

/** Ege kıyısı girintisi */
export const TURKEY_AEGEAN_COAST =
  'M 158 322 C 178 292, 198 262, 228 252 C 258 242, 278 272, 258 302 C 238 332, 188 342, 158 322 Z';

/** Akdeniz kıyı bandı */
export const TURKEY_MEDITERRANEAN =
  'M 298 392 C 398 412, 548 422, 668 402 C 748 386, 818 356, 838 322';

export interface MapPoint {
  x: number;
  y: number;
}

function routePairKey(cityA: string, cityB: string): string {
  return [normalizeCityId(cityA), normalizeCityId(cityB)].sort().join('|');
}

/** Rota eğrisi için kontrol noktası — tutarlı eğim yönü */
export function getRouteControlPoint(from: MapPoint, to: MapPoint, cityA: string, cityB: string): MapPoint {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const bend = 0.18 + (routePairKey(cityA, cityB).length % 5) * 0.015;
  const sign = routePairKey(cityA, cityB).charCodeAt(0) % 2 === 0 ? 1 : -1;

  return {
    x: mx - (dy / length) * length * bend * sign,
    y: my + (dx / length) * length * bend * sign,
  };
}

/** Quadratic bezier SVG path */
export function buildRoutePath(from: MapPoint, to: MapPoint, cityA: string, cityB: string): string {
  const control = getRouteControlPoint(from, to, cityA, cityB);
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

/** Bezier üzerinde t (0–1) konumu */
export function getPointOnRoute(
  from: MapPoint,
  to: MapPoint,
  cityA: string,
  cityB: string,
  t: number,
): MapPoint {
  const control = getRouteControlPoint(from, to, cityA, cityB);
  const clamped = Math.max(0, Math.min(1, t));
  const u = 1 - clamped;

  return {
    x: u * u * from.x + 2 * u * clamped * control.x + clamped * clamped * to.x,
    y: u * u * from.y + 2 * u * clamped * control.y + clamped * clamped * to.y,
  };
}

/** Rota üzerinde teğet açı (derece) */
export function getRouteAngleAt(
  from: MapPoint,
  to: MapPoint,
  cityA: string,
  cityB: string,
  t: number,
): number {
  const control = getRouteControlPoint(from, to, cityA, cityB);
  const clamped = Math.max(0, Math.min(1, t));
  const u = 1 - clamped;
  const tx = 2 * u * (control.x - from.x) + 2 * clamped * (to.x - control.x);
  const ty = 2 * u * (control.y - from.y) + 2 * clamped * (to.y - control.y);
  return (Math.atan2(ty, tx) * 180) / Math.PI;
}

export function getMapDefaultCenter(): MapPoint {
  return { x: 0.5, y: 0.5 };
}
