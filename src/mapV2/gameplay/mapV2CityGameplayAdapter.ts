import { CITIES_BY_ID } from '../../data/cities';
import { getCityName } from '../../utils/entityLookup';
import { resolveCountryDisplayName } from '../presentation/countryDisplayName';
import { gameplayIdForGeoCity } from '../world/countryCityLoader';
import { getCountryRecord } from '../world/worldBoundaryLoader';

/** Canonical player cities. IDs are gameplay authority, not display text. */
export const MAP_V2_GAMEPLAY_CITY_IDS = [
  'izmir',
  'istanbul',
  'ankara',
  'bursa',
  'antalya',
  'adana',
  'diyarbakir',
  'trabzon',
] as const;

const GAMEPLAY_CITY_ID_SET = new Set<string>(MAP_V2_GAMEPLAY_CITY_IDS);

export type MapV2CityGameplayLink = {
  mapCityId: string | null;
  gameplayCityId: string | null;
  countryId: string | null;
  displayName: string;
  countryName: string | null;
  isGameplayCity: boolean;
  operationsAvailable: boolean;
};

export type CityQuickAction = 'contracts' | 'fleet' | 'warehouses' | 'market';

/**
 * Geographic city → gameplay city. Uses the explicit Turkey package mapping.
 * Display names come from the city catalog, not from ad-hoc string folding.
 */
export function resolveMapV2CityGameplay(input: {
  geoCityId: string | null;
  geoDisplayName?: string | null;
  countryId?: string | null;
  countryName?: string | null;
}): MapV2CityGameplayLink {
  const gameplayCityId = input.geoCityId ? gameplayIdForGeoCity(input.geoCityId) ?? null : null;
  const isGameplayCity = Boolean(gameplayCityId && GAMEPLAY_CITY_ID_SET.has(gameplayCityId));
  const catalogName = isGameplayCity && gameplayCityId ? getCityName(gameplayCityId) : '';
  const catalogKnown = Boolean(gameplayCityId && CITIES_BY_ID[gameplayCityId]);
  const geoName = input.geoDisplayName?.trim() ?? '';
  const countryId = input.countryId ?? null;
  const providedCountry = input.countryName?.trim() ?? '';
  const resolvedCountry = countryId
    ? resolveCountryDisplayName(getCountryRecord(countryId), 'tr').trim()
    : '';
  return {
    mapCityId: input.geoCityId,
    gameplayCityId: isGameplayCity ? gameplayCityId : null,
    countryId,
    displayName: catalogKnown ? catalogName : geoName || catalogName || 'Şehir',
    countryName: providedCountry || resolvedCountry || null,
    isGameplayCity,
    operationsAvailable: isGameplayCity,
  };
}

/** Map-mode target for a city quick action. Never a portrait route. */
export function cityQuickActionMode(action: CityQuickAction): CityQuickAction {
  return action;
}
