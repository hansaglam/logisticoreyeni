/**
 * Türkiye Lojistik Ağı — mobil tycoon network layout (normalized 0–1).
 * Gerçek coğrafya yok; tüm cihazlarda aynı oranlarla ölçeklenir.
 */

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export const NETWORK_PADDING = {
  paddingX: 32,
  paddingY: 32,
} as const;

/** Mobil network layout — İstanbul üstte, İzmir sol-alt, Antalya alt-orta */
export const NETWORK_CITY_POSITIONS: Record<string, NormalizedPoint> = {
  istanbul: { x: 0.5, y: 0.12 },
  bursa: { x: 0.42, y: 0.3 },
  ankara: { x: 0.7, y: 0.34 },
  izmir: { x: 0.22, y: 0.56 },
  antalya: { x: 0.55, y: 0.78 },
};

export const NODE_CARD_WIDTH = 72;
export const NODE_CARD_HEIGHT = 44;

export function getRoutePairKey(cityA: string, cityB: string): string {
  return [normalizeCityId(cityA), normalizeCityId(cityB)].sort().join('|');
}

export function normalizeCityId(cityId: string): string {
  return cityId.toLowerCase().trim();
}

export function getNetworkCityPosition(cityId: string): NormalizedPoint | undefined {
  return NETWORK_CITY_POSITIONS[normalizeCityId(cityId)];
}

export function normalizedToPixel(
  norm: NormalizedPoint,
  width: number,
  height: number,
): PixelPoint {
  const { paddingX, paddingY } = NETWORK_PADDING;
  const innerW = Math.max(1, width - paddingX * 2);
  const innerH = Math.max(1, height - paddingY * 2);
  return {
    x: paddingX + norm.x * innerW,
    y: paddingY + norm.y * innerH,
  };
}

export function getCityPixelPosition(
  cityId: string,
  width: number,
  height: number,
): PixelPoint | undefined {
  const norm = getNetworkCityPosition(cityId);
  if (!norm) return undefined;
  return normalizedToPixel(norm, width, height);
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerpPoint(a: PixelPoint, b: PixelPoint, t: number): PixelPoint {
  const clamped = clampValue(t, 0, 1);
  return {
    x: a.x + (b.x - a.x) * clamped,
    y: a.y + (b.y - a.y) * clamped,
  };
}

export function getPointOnLine(a: PixelPoint, b: PixelPoint, t: number): PixelPoint {
  return lerpPoint(a, b, t);
}

export function getDeliveryPixelPosition(
  delivery: { originCityId: string; destinationCityId: string; progress: number; status: string },
  width: number,
  height: number,
): PixelPoint | undefined {
  const start = getCityPixelPosition(delivery.originCityId, width, height);
  const end = getCityPixelPosition(delivery.destinationCityId, width, height);
  if (!start || !end) return undefined;

  if (delivery.status === 'preparing') {
    return start;
  }

  return lerpPoint(start, end, delivery.progress);
}

export function routesMatchCityPair(
  cityA: string,
  cityB: string,
  fromCityId: string,
  toCityId: string,
): boolean {
  const a = normalizeCityId(cityA);
  const b = normalizeCityId(cityB);
  const from = normalizeCityId(fromCityId);
  const to = normalizeCityId(toCityId);
  return (a === from && b === to) || (a === to && b === from);
}
