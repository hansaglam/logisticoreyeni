import type { CountryCityPackageV1, GeoCityRecord } from '../../src/mapV2/geo/cityPackage';
import { CITY_PRESENTATION_LODS } from '../../src/mapV2/geo/cityPackage';
import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../../src/mapV2/domain/ids';

export type CityPackageIssue = { code: string; detail: string };

export function validateCountryCityPackage(pkg: CountryCityPackageV1): CityPackageIssue[] {
  const issues: CityPackageIssue[] = [];
  if (pkg.schemaVersion !== 1) issues.push({ code: 'schema', detail: String(pkg.schemaVersion) });
  if (pkg.geoCountryId !== 'country.tur') issues.push({ code: 'country', detail: pkg.geoCountryId });
  if (pkg.projection.id !== 'WEB_MERCATOR') issues.push({ code: 'projection', detail: pkg.projection.id });
  if (!pkg.contentHash.startsWith('sha256:')) issues.push({ code: 'hash', detail: pkg.contentHash });
  if (pkg.sourceManifest.productionApproved) issues.push({ code: 'approval', detail: 'must remain false' });
  if (pkg.sourceManifest.license.toLowerCase().includes('odbl') === false && !pkg.sourceManifest.license.toLowerCase().includes('public domain')) {
    issues.push({ code: 'license', detail: pkg.sourceManifest.license });
  }

  const ids = new Set<string>();
  for (const city of pkg.cities) {
    if (ids.has(city.geoCityId)) issues.push({ code: 'duplicate-id', detail: city.geoCityId });
    ids.add(city.geoCityId);
    if (!city.geoCityId.startsWith('city.tur.ne.')) issues.push({ code: 'id-scheme', detail: city.geoCityId });
    const { longitude, latitude } = city.coordinate;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) issues.push({ code: 'non-finite-wgs84', detail: city.geoCityId });
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      issues.push({ code: 'wgs84-range', detail: city.geoCityId });
    }
    if (!Number.isFinite(city.projected.x) || !Number.isFinite(city.projected.y)) {
      issues.push({ code: 'non-finite-projected', detail: city.geoCityId });
    }
    if (city.projected.x < 0 || city.projected.x > 1 || city.projected.y < 0 || city.projected.y > 1) {
      issues.push({ code: 'projected-range', detail: city.geoCityId });
    }
    if (city.geoCountryId !== 'country.tur') issues.push({ code: 'city-country', detail: city.geoCityId });
    if (city.population != null && (!Number.isFinite(city.population) || city.population < 0)) {
      issues.push({ code: 'population', detail: city.geoCityId });
    }
  }

  const overview = pkg.cities.filter((c) => c.cityLod === 'CITY_LOD_COUNTRY_OVERVIEW').length;
  const regional = pkg.cities.filter((c) =>
    c.cityLod === 'CITY_LOD_COUNTRY_OVERVIEW' || c.cityLod === 'CITY_LOD_REGIONAL',
  ).length;
  if (!(overview < regional && regional <= pkg.cities.length)) {
    issues.push({ code: 'lod-counts', detail: `${overview}/${regional}/${pkg.cities.length}` });
  }

  const mapped = new Set<string>();
  const mappedGeo = new Set<string>();
  for (const row of pkg.gameplayMappings) {
    if (row.mappingStatus !== 'VERIFIED') issues.push({ code: 'mapping-status', detail: row.gameplayCityId });
    if (mapped.has(row.gameplayCityId)) issues.push({ code: 'duplicate-gameplay-map', detail: row.gameplayCityId });
    mapped.add(row.gameplayCityId);
    if (mappedGeo.has(row.geoCityId)) issues.push({ code: 'duplicate-geo-map', detail: row.geoCityId });
    mappedGeo.add(row.geoCityId);
    const city = pkg.cities.find((c) => c.geoCityId === row.geoCityId);
    if (!city) issues.push({ code: 'mapped-missing-city', detail: row.geoCityId });
  }
  for (const id of LEGACY_STABLE_GAMEPLAY_CITY_IDS) {
    if (!mapped.has(id)) issues.push({ code: 'unmapped-gameplay', detail: id });
  }

  void CITY_PRESENTATION_LODS;
  return issues;
}

export function hashCityPackage(pkg: Omit<CountryCityPackageV1, 'contentHash'>): `sha256:${string}` {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return `sha256:${createHash('sha256').update(JSON.stringify(pkg)).digest('hex')}`;
}

export function countCitiesAtLod(cities: GeoCityRecord[], lod: GeoCityRecord['cityLod']): number {
  const rank = { CITY_LOD_COUNTRY_OVERVIEW: 0, CITY_LOD_REGIONAL: 1, CITY_LOD_LOCAL: 2 }[lod];
  return cities.filter((city) => {
    const cityRank = { CITY_LOD_COUNTRY_OVERVIEW: 0, CITY_LOD_REGIONAL: 1, CITY_LOD_LOCAL: 2 }[city.cityLod];
    return cityRank <= rank;
  }).length;
}
