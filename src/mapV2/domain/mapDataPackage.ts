import { MAP_DATA_RELEASE_VERSION, MAP_DATA_SCHEMA_VERSION } from '../../mapData/mapSourcePolicy';
import type { GeoCity, GeoCountry, GeoRegion } from './geo';
import type { GeoInfrastructure } from './infrastructure';
import type { GeographicTransportNetwork } from './transport';

export { MAP_DATA_RELEASE_VERSION, MAP_DATA_SCHEMA_VERSION };

export interface MapDataPackage {
  schemaVersion: number;
  /** Null until the first license-approved geographic package exists. */
  releaseVersion: string | null;
  generatedAt: string | null;
  sourceManifestRefs: string[];
  countries: GeoCountry[];
  regions: GeoRegion[];
  cities: GeoCity[];
  infrastructure: GeoInfrastructure[];
  networks: GeographicTransportNetwork[];
  metadata: Record<string, string>;
}

export function createEmptyMapDataPackage(): MapDataPackage {
  return {
    schemaVersion: MAP_DATA_SCHEMA_VERSION,
    releaseVersion: MAP_DATA_RELEASE_VERSION,
    generatedAt: null,
    sourceManifestRefs: [],
    countries: [],
    regions: [],
    cities: [],
    infrastructure: [],
    networks: [],
    metadata: {},
  };
}

export type MapDataValidationIssue =
  | 'schema-mismatch'
  | 'release-premature'
  | 'entity-unapproved'
  | 'invented-iso'
  | 'ok';

/**
 * Structural checks only. Cannot validate geographic facts before ingestion.
 */
export function validateMapDataPackage(pkg: MapDataPackage): MapDataValidationIssue[] {
  const issues: MapDataValidationIssue[] = [];
  if (pkg.schemaVersion !== MAP_DATA_SCHEMA_VERSION) {
    issues.push('schema-mismatch');
  }
  if (pkg.releaseVersion != null && pkg.releaseVersion !== '') {
    issues.push('release-premature');
  }
  const entities = [
    ...pkg.countries,
    ...pkg.regions,
    ...pkg.cities,
    ...pkg.infrastructure,
    ...pkg.networks,
  ];
  if (entities.some((entity) => entity.productionApproved)) {
    issues.push('entity-unapproved');
  }
  if (pkg.countries.some((country) => Boolean(country.iso2) || Boolean(country.iso3))) {
    issues.push('invented-iso');
  }
  return issues.length > 0 ? issues : ['ok'];
}

export function validateGameplayMappingsUnresolved(
  mappings: ReadonlyArray<{ geoCityId: string | null; mappingStatus: string }>,
): boolean {
  return mappings.every((row) => row.mappingStatus === 'UNRESOLVED' && row.geoCityId == null);
}
