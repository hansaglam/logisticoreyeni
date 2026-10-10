import type { GeoCoordinateWgs84, ProjectedWorldPoint, WebMercatorProjectionMeta } from './webMercator';
import type { MapSourceManifest } from '../../mapData/mapSourcePolicy';

export const COUNTRY_CITY_PACKAGE_SCHEMA_VERSION = 1 as const;
export const CITY_PACKAGE_PROCESSING_VERSION = 'map-v2-cities-ne10m-1';
export const GAMEPLAY_CITY_GEO_MAPPING_VERSION_2C = 2 as const;

export const CITY_PRESENTATION_LODS = [
  'CITY_LOD_COUNTRY_OVERVIEW',
  'CITY_LOD_REGIONAL',
  'CITY_LOD_LOCAL',
] as const;

export type CityPresentationLodId = (typeof CITY_PRESENTATION_LODS)[number];

export type SettlementClass = 'CAPITAL' | 'CITY' | 'TOWN' | 'OTHER';

export type CityInCountryStatus = 'VERIFIED_INSIDE' | 'VERIFIED_SOURCE_EXCEPTION' | 'UNRESOLVED';

export type GeoCityRecord = {
  geoCityId: string;
  geoCountryId: string;
  sourceFeatureId: string;
  sourceName: string;
  sourceNameAscii: string;
  names: {
    tr?: string;
    en?: string;
  };
  nameKey: string;
  coordinate: GeoCoordinateWgs84;
  projected: ProjectedWorldPoint;
  settlementClass: SettlementClass;
  population: number | null;
  populationSourceField: 'POP_MAX' | null;
  adminLevel: string | null;
  cityLod: CityPresentationLodId;
  inCountryStatus: CityInCountryStatus;
  sourceMetadata: {
    neId: number;
    geonamesId: number | null;
    wikidataId: string | null;
    featureClass: string;
    adm0A3: string;
  };
};

export type GameplayCityGeoMappingVerified = {
  gameplayCityId: string;
  geoCityId: string;
  mappingStatus: 'VERIFIED';
  mappingVersion: typeof GAMEPLAY_CITY_GEO_MAPPING_VERSION_2C;
  verification: {
    source: string;
    verifiedAt: string;
    nameAscii: string;
    notes: string;
  };
};

export type CountryCityPackageV1 = {
  schemaVersion: typeof COUNTRY_CITY_PACKAGE_SCHEMA_VERSION;
  packageId: string;
  contentHash: `sha256:${string}`;
  geoCountryId: string;
  projection: WebMercatorProjectionMeta;
  sourceManifest: MapSourceManifest;
  transformation: {
    processingVersion: string;
    projectionVersion: number;
    inclusionPolicyId: string;
    mappingVersion: number;
  };
  cities: GeoCityRecord[];
  gameplayMappings: GameplayCityGeoMappingVerified[];
  stats: {
    cityCount: number;
    overviewCount: number;
    regionalCount: number;
    localCount: number;
    mappedGameplayCities: number;
  };
};

export function cityLodRank(lod: CityPresentationLodId): number {
  return CITY_PRESENTATION_LODS.indexOf(lod);
}

export function cityVisibleAtLod(cityLod: CityPresentationLodId, viewLod: CityPresentationLodId): boolean {
  return cityLodRank(cityLod) <= cityLodRank(viewLod);
}

export function cityLodForRelativeZoom(relZoom: number): CityPresentationLodId {
  if (relZoom < 2.4) return 'CITY_LOD_COUNTRY_OVERVIEW';
  if (relZoom < 5.5) return 'CITY_LOD_REGIONAL';
  return 'CITY_LOD_LOCAL';
}
