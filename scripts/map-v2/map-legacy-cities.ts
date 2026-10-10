import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../../src/mapV2/domain/ids';
import type { GeoCityRecord, GameplayCityGeoMappingVerified } from '../../src/mapV2/geo/cityPackage';
import { GAMEPLAY_CITY_GEO_MAPPING_VERSION_2C } from '../../src/mapV2/geo/cityPackage';
import {
  LEGACY_CITY_PLAUSIBILITY_WGS84,
  LEGACY_GAMEPLAY_CITY_SOURCE_ASCII,
} from './city-inclusion-policy';

export function mapLegacyGameplayCities(
  cities: GeoCityRecord[],
  sourceLabel: string,
  verifiedAt: string,
): GameplayCityGeoMappingVerified[] {
  const mappings: GameplayCityGeoMappingVerified[] = [];
  const usedGeo = new Set<string>();
  for (const gameplayCityId of LEGACY_STABLE_GAMEPLAY_CITY_IDS) {
    const ascii = LEGACY_GAMEPLAY_CITY_SOURCE_ASCII[gameplayCityId];
    const matches = cities.filter(
      (city) =>
        city.sourceMetadata.adm0A3 === 'TUR' && city.sourceNameAscii.toLowerCase() === ascii.toLowerCase(),
    );
    if (matches.length !== 1) {
      throw new Error(`legacy mapping ${gameplayCityId}: expected 1 TUR source row for ${ascii}, got ${matches.length}`);
    }
    const city = matches[0];
    if (usedGeo.has(city.geoCityId)) {
      throw new Error(`duplicate GeoCity mapping ${city.geoCityId}`);
    }
    usedGeo.add(city.geoCityId);
    const box = LEGACY_CITY_PLAUSIBILITY_WGS84[gameplayCityId];
    const { longitude, latitude } = city.coordinate;
    if (
      longitude < box.minLon ||
      longitude > box.maxLon ||
      latitude < box.minLat ||
      latitude > box.maxLat
    ) {
      throw new Error(
        `legacy mapping ${gameplayCityId}: source point ${longitude},${latitude} outside plausibility envelope ${box.region}`,
      );
    }
    mappings.push({
      gameplayCityId,
      geoCityId: city.geoCityId,
      mappingStatus: 'VERIFIED',
      mappingVersion: GAMEPLAY_CITY_GEO_MAPPING_VERSION_2C,
      verification: {
        source: sourceLabel,
        verifiedAt,
        nameAscii: ascii,
        notes: `Exact NAMEASCII match in ADM0_A3=TUR. Envelope ${box.region}. Source coords used as-is.`,
      },
    });
  }
  return mappings;
}
