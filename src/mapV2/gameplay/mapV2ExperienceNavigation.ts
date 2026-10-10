import { boundsOfPolygons } from '../geo/geometry';
import type { GeometryLodId } from '../geo/geometry';
import type { ProjectedBoundingBox } from '../geo/webMercator';
import { dequantizePolygons, type WorldCountryRecord } from '../geo/worldBoundaryPackage';
import { getRenderableCountries } from '../world/worldBoundaryLoader';
import { isCountryOpenable, type CountryGameplayAvailability } from './mapV2CountryAvailability.fixture';

export type MapV2ExperienceMode = 'WORLD' | 'COUNTRY' | 'CITY_DETAIL';

export type MapV2SelectionState = {
  selectedCountryId: string | null;
};

export function canEnterCountryMode(availability: CountryGameplayAvailability): boolean {
  return isCountryOpenable(availability);
}

export function canEnterCityDetail(geoCityId: string | null | undefined, mappedGeoCityIds: ReadonlySet<string>): boolean {
  return Boolean(geoCityId && mappedGeoCityIds.has(geoCityId));
}

/** Hardware/header back inside the Map V2 experience. City selection is not cleared on CITY_DETAIL → COUNTRY. */
export function mapV2BackAction(
  mode: MapV2ExperienceMode,
  opts: { selectedCityId: string | null; selectedCountryId: string | null },
): 'EXIT_CITY_DETAIL' | 'CLEAR_CITY_SELECTION' | 'EXIT_COUNTRY' | 'CLEAR_COUNTRY_SELECTION' | 'CLOSE_EXPERIENCE' {
  if (mode === 'CITY_DETAIL') return 'EXIT_CITY_DETAIL';
  if (mode === 'COUNTRY') {
    if (opts.selectedCityId) return 'CLEAR_CITY_SELECTION';
    return 'EXIT_COUNTRY';
  }
  if (opts.selectedCountryId) return 'CLEAR_COUNTRY_SELECTION';
  return 'CLOSE_EXPERIENCE';
}

export function expandProjectedBounds(
  bounds: ProjectedBoundingBox,
  pad: number,
): ProjectedBoundingBox {
  return {
    minX: bounds.minX - pad,
    minY: bounds.minY - pad,
    maxX: bounds.maxX + pad,
    maxY: bounds.maxY + pad,
  };
}

export function countryFocusBounds(country: WorldCountryRecord, lod: GeometryLodId): ProjectedBoundingBox {
  const overall = country.lods[lod].projectedBounds;
  const spanX = overall.maxX - overall.minX;
  const spanY = overall.maxY - overall.minY;
  if (spanX < 0.4 && spanY < 0.4) return overall;
  const polygons = dequantizePolygons(country.lods[lod].polygons);
  let best = overall;
  let bestArea = 0;
  for (const polygon of polygons) {
    const box = boundsOfPolygons([polygon]);
    if (!box) continue;
    const area = (box.maxX - box.minX) * (box.maxY - box.minY);
    if (area > bestArea) {
      bestArea = area;
      best = box;
    }
  }
  return best;
}

/**
 * Largest-polygon / primary-landmass policy:
 * If a country's overall projected bbox is world-wide (overseas fragments),
 * initial COUNTRY framing uses the largest polygon. All polygons stay in the
 * package; they are not deleted. Türkiye uses its overall ADM0 bbox (compact).
 */
export const COUNTRY_WORKING_PAD_FRACTION = 0.1;

export function expandBoundsByFraction(
  bounds: ProjectedBoundingBox,
  fraction: number,
): ProjectedBoundingBox {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6);
  return {
    minX: bounds.minX - spanX * fraction,
    minY: bounds.minY - spanY * fraction,
    maxX: bounds.maxX + spanX * fraction,
    maxY: bounds.maxY + spanY * fraction,
  };
}

export function countryWorkingBounds(country: WorldCountryRecord, lod: GeometryLodId): ProjectedBoundingBox {
  return expandBoundsByFraction(countryFocusBounds(country, lod), COUNTRY_WORKING_PAD_FRACTION);
}

export function neighborCountryIds(focusCountryId: string, lod: GeometryLodId): string[] {
  const countries = getRenderableCountries();
  const focus = countries.find((country) => country.geoCountryId === focusCountryId);
  if (!focus) return [];
  const pad = expandProjectedBounds(countryFocusBounds(focus, lod), 0.035);
  return countries
    .filter((country) => {
      if (country.geoCountryId === focusCountryId) return false;
      const b = country.lods[lod].projectedBounds;
      return b.minX <= pad.maxX && b.maxX >= pad.minX && b.minY <= pad.maxY && b.maxY >= pad.minY;
    })
    .map((country) => country.geoCountryId);
}
