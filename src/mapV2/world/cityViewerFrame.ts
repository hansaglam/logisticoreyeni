import { cityVisibleAtLod, type CityPresentationLodId, type GeoCityRecord } from '../geo/cityPackage';
import type { ProjectedBoundingBox } from '../geo/webMercator';
import { worldToScreen } from '../geo/worldCamera';
import { CITY_HIT_RADIUS_PX, CITY_LABEL_MIN_DISTANCE_PX } from '../presentation/cityPaint';

export const CITY_LABEL_MAX: Record<CityPresentationLodId, number> = {
  CITY_LOD_COUNTRY_OVERVIEW: 8,
  CITY_LOD_REGIONAL: 10,
  CITY_LOD_LOCAL: 12,
};

/** Camera LOD from visible world span, not package inclusion LOD. */
export function cityLodForVisibleWorldSpan(bounds: ProjectedBoundingBox): CityPresentationLodId {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  if (span >= 0.055) return 'CITY_LOD_COUNTRY_OVERVIEW';
  if (span >= 0.028) return 'CITY_LOD_REGIONAL';
  return 'CITY_LOD_LOCAL';
}

export function cityInViewport(
  city: GeoCityRecord,
  bounds: ProjectedBoundingBox,
): boolean {
  return (
    city.projected.x >= bounds.minX &&
    city.projected.x <= bounds.maxX &&
    city.projected.y >= bounds.minY &&
    city.projected.y <= bounds.maxY
  );
}

export function cityLabelPriority(
  city: GeoCityRecord,
  mappedGeoIds: ReadonlySet<string>,
  selectedCityId: string | null = null,
): number {
  let score = 0;
  if (city.geoCityId === selectedCityId) score += 5_000_000;
  if (mappedGeoIds.has(city.geoCityId)) score += 1_000_000;
  if (city.cityLod === 'CITY_LOD_COUNTRY_OVERVIEW') score += 100_000;
  if (city.settlementClass === 'CAPITAL') score += 80_000;
  if (city.sourceNameAscii === 'Istanbul') score += 60_000;
  if (city.settlementClass === 'CITY') score += 10_000;
  score += city.population ?? 0;
  return score;
}

export function filterVisibleCities(
  cities: GeoCityRecord[],
  viewLod: CityPresentationLodId,
  bounds: ProjectedBoundingBox,
  selectedCityId: string | null,
  mappedGeoIds: ReadonlySet<string> = new Set(),
): GeoCityRecord[] {
  return cities.filter((city) => {
    if (city.geoCityId === selectedCityId) return true;
    if (!cityInViewport(city, bounds)) return false;
    if (viewLod === 'CITY_LOD_COUNTRY_OVERVIEW' && mappedGeoIds.size > 0) {
      return mappedGeoIds.has(city.geoCityId);
    }
    return cityVisibleAtLod(city.cityLod, viewLod);
  });
}

export function selectCityLabelIds(
  visible: GeoCityRecord[],
  viewLod: CityPresentationLodId,
  selectedCityId: string | null,
  mappedGeoIds: ReadonlySet<string>,
  translateX: number,
  translateY: number,
  scale: number,
): string[] {
  const max = CITY_LABEL_MAX[viewLod];
  const ranked = [...visible].sort(
    (a, b) => cityLabelPriority(b, mappedGeoIds, selectedCityId) - cityLabelPriority(a, mappedGeoIds, selectedCityId),
  );
  const placed: Array<{ id: string; x: number; y: number }> = [];
  const tryPlace = (city: GeoCityRecord, force: boolean): void => {
    if (placed.some((row) => row.id === city.geoCityId)) return;
    const screen = worldToScreen(city.projected.x, city.projected.y, translateX, translateY, scale);
    const tooClose = placed.some((row) => {
      const dx = row.x - screen.x;
      const dy = row.y - screen.y;
      return Math.hypot(dx, dy) < CITY_LABEL_MIN_DISTANCE_PX;
    });
    if (!force && tooClose) return;
    if (!force && placed.length >= max) return;
    placed.push({ id: city.geoCityId, x: screen.x, y: screen.y });
  };
  const selected = selectedCityId ? ranked.find((city) => city.geoCityId === selectedCityId) : undefined;
  if (selected) tryPlace(selected, true);
  for (const city of ranked) {
    tryPlace(city, false);
  }
  return placed.map((row) => row.id);
}

export function hitTestCity(
  screenX: number,
  screenY: number,
  visible: GeoCityRecord[],
  translateX: number,
  translateY: number,
  scale: number,
): string | null {
  let bestId: string | null = null;
  let bestDist = CITY_HIT_RADIUS_PX;
  for (const city of visible) {
    const screen = worldToScreen(city.projected.x, city.projected.y, translateX, translateY, scale);
    const dist = Math.hypot(screen.x - screenX, screen.y - screenY);
    if (dist <= bestDist) {
      bestDist = dist;
      bestId = city.geoCityId;
    }
  }
  return bestId;
}
