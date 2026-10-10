/**
 * Ingest Natural Earth 10m populated places for Türkiye into a Map V2 city package.
 * Raw GeoJSON stays in data/map-raw/ (gitignored).
 *
 * Run: npx tsx scripts/map-v2/ingest-country-cities.ts
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../../src/mapV2/domain/ids';
import { pointInProjectedPolygons } from '../../src/mapV2/geo/geometry';
import {
  CITY_PACKAGE_PROCESSING_VERSION,
  COUNTRY_CITY_PACKAGE_SCHEMA_VERSION,
  GAMEPLAY_CITY_GEO_MAPPING_VERSION_2C,
  type CityPresentationLodId,
  type CountryCityPackageV1,
  type GeoCityRecord,
  type SettlementClass,
} from '../../src/mapV2/geo/cityPackage';
import { WEB_MERCATOR_PROJECTION_META, WEB_MERCATOR_PROJECTION_VERSION, projectWgs84ToNormalizedMercator } from '../../src/mapV2/geo/webMercator';
import { dequantizePolygons } from '../../src/mapV2/geo/worldBoundaryPackage';
import { getCountryRecord, getWorldBoundaryPackage } from '../../src/mapV2/world/worldBoundaryLoader';
import { CITY_INCLUSION_POLICY, CITY_INCLUSION_POLICY_ID, LEGACY_GAMEPLAY_CITY_SOURCE_ASCII } from './city-inclusion-policy';
import { mapLegacyGameplayCities } from './map-legacy-cities';
import { hashCityPackage, validateCountryCityPackage } from './validate-city-package';

const root = resolve(__dirname, '../..');
const sourcePath = resolve(root, 'data/map-raw/natural-earth/ne_10m_populated_places.geojson');
const outDir = resolve(root, 'src/mapV2/generated/cities');

type NeProps = {
  NAME?: string;
  NAMEASCII?: string;
  NAME_TR?: string;
  NAME_EN?: string;
  FEATURECLA?: string;
  POP_MAX?: number;
  NE_ID?: number;
  GEONAMESID?: number;
  WIKIDATAID?: string;
  ADM0_A3?: string;
};

function sha256Bytes(buf: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}

function optionalName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function settlementClass(featureClass: string): SettlementClass {
  if (featureClass === 'Admin-0 capital') return 'CAPITAL';
  if (featureClass === 'Admin-1 capital') return 'CITY';
  if (featureClass === 'Populated place') return 'TOWN';
  return 'OTHER';
}

function assignCityLod(
  featureClass: string,
  population: number | null,
  mappedGameplay: boolean,
): CityPresentationLodId {
  if (
    mappedGameplay ||
    featureClass === 'Admin-0 capital' ||
    (population != null && population >= CITY_INCLUSION_POLICY.overview.minPopulation)
  ) {
    return 'CITY_LOD_COUNTRY_OVERVIEW';
  }
  if (
    featureClass === 'Admin-1 capital' ||
    (population != null && population >= CITY_INCLUSION_POLICY.regional.minPopulation)
  ) {
    return 'CITY_LOD_REGIONAL';
  }
  return 'CITY_LOD_LOCAL';
}

function parsePopulation(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

async function main() {
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing Natural Earth source at ${sourcePath}`);
  }
  const sourceBuf = await readFile(sourcePath);
  const sourceHash = sha256Bytes(sourceBuf);
  const gj = JSON.parse(sourceBuf.toString('utf8')) as {
    features: Array<{ geometry: { type: string; coordinates: number[] }; properties: NeProps }>;
  };

  const turkey = getCountryRecord('country.tur');
  if (!turkey) throw new Error('country.tur missing from world package');
  const turkeyPolygons = dequantizePolygons(turkey.lods.COUNTRY_HIGH.polygons);
  const mappedAscii = new Set(Object.values(LEGACY_GAMEPLAY_CITY_SOURCE_ASCII).map((s) => s.toLowerCase()));

  const cities: GeoCityRecord[] = [];
  for (const feature of gj.features) {
    const props = feature.properties;
    if (props.ADM0_A3 !== 'TUR') continue;
    if (!feature.geometry || feature.geometry.type !== 'Point') continue;
    const [lon, lat] = feature.geometry.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error(`non-finite coordinate for NE_ID ${props.NE_ID}`);
    }
    const neId = props.NE_ID;
    if (typeof neId !== 'number' || !Number.isFinite(neId)) {
      throw new Error('missing NE_ID');
    }
    const ascii = String(props.NAMEASCII ?? '').trim();
    if (!ascii) throw new Error(`missing NAMEASCII for NE_ID ${neId}`);
    const projected = projectWgs84ToNormalizedMercator(lon, lat);
    const inside = pointInProjectedPolygons(projected, turkeyPolygons);
    const population = parsePopulation(props.POP_MAX);
    const featureClass = String(props.FEATURECLA ?? 'Populated place');
    const mappedGameplay = mappedAscii.has(ascii.toLowerCase());
    cities.push({
      geoCityId: `city.tur.ne.${neId}`,
      geoCountryId: CITY_INCLUSION_POLICY.geoCountryId,
      sourceFeatureId: String(neId),
      sourceName: String(props.NAME ?? ascii),
      sourceNameAscii: ascii,
      names: {
        tr: optionalName(props.NAME_TR) ?? optionalName(props.NAME),
        en: optionalName(props.NAME_EN) ?? ascii,
      },
      nameKey: `mapV2.city.tur.ne.${neId}`,
      coordinate: { longitude: lon, latitude: lat },
      projected,
      settlementClass: settlementClass(featureClass),
      population,
      populationSourceField: population == null ? null : 'POP_MAX',
      adminLevel: featureClass.startsWith('Admin-0') ? '0' : featureClass.startsWith('Admin-1') ? '1' : null,
      cityLod: assignCityLod(featureClass, population, mappedGameplay),
      inCountryStatus: inside ? 'VERIFIED_INSIDE' : 'VERIFIED_SOURCE_EXCEPTION',
      sourceMetadata: {
        neId,
        geonamesId: typeof props.GEONAMESID === 'number' && Number.isFinite(props.GEONAMESID) ? props.GEONAMESID : null,
        wikidataId: optionalName(props.WIKIDATAID) ?? null,
        featureClass,
        adm0A3: 'TUR',
      },
    });
  }

  cities.sort((a, b) => a.geoCityId.localeCompare(b.geoCityId));
  if (cities.length === 0) throw new Error('no Türkiye cities ingested');

  const verifiedAt = '2026-09-16';
  const mappings = mapLegacyGameplayCities(
    cities,
    'Natural Earth 10m populated places v5.1.2 NAMEASCII+ADM0_A3=TUR',
    verifiedAt,
  );
  if (mappings.length !== LEGACY_STABLE_GAMEPLAY_CITY_IDS.length) {
    throw new Error('legacy mapping incomplete');
  }

  const unsigned: Omit<CountryCityPackageV1, 'contentHash'> = {
    schemaVersion: COUNTRY_CITY_PACKAGE_SCHEMA_VERSION,
    packageId: 'country-cities-tur-ne10m-v1',
    geoCountryId: 'country.tur',
    projection: WEB_MERCATOR_PROJECTION_META,
    sourceManifest: {
      policyVersion: 1,
      datasetId: 'naturalearth.10m.populated_places.tur',
      datasetType: 'settlement',
      sourceName: 'Natural Earth 10m Populated Places',
      sourceURL: 'https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2/geojson',
      license: 'Public Domain',
      licenseURL: 'https://www.naturalearthdata.com/about/terms-of-use/',
      sourceVersion: 'natural-earth-vector-v5.1.2',
      retrievedAt: verifiedAt,
      sourceHash,
      originalFormat: 'GeoJSON',
      processedFormat: 'CountryCityPackageV1',
      processingVersion: CITY_PACKAGE_PROCESSING_VERSION,
      derivedFrom: [],
      attributionRequired: false,
      productionApproved: false,
      notes:
        'Türkiye-first city points from Natural Earth 10m populated places (public domain). Coordinates copied from source geometry. Not OSM. Not Google. Not AI. Not a production MapData release. OSM remains planned for transport networks (ODbL checkpoint). HGM is QA/reference only and is not bundled.',
    },
    transformation: {
      processingVersion: CITY_PACKAGE_PROCESSING_VERSION,
      projectionVersion: WEB_MERCATOR_PROJECTION_VERSION,
      inclusionPolicyId: CITY_INCLUSION_POLICY_ID,
      mappingVersion: GAMEPLAY_CITY_GEO_MAPPING_VERSION_2C,
    },
    cities,
    gameplayMappings: mappings,
    stats: {
      cityCount: cities.length,
      overviewCount: cities.filter((c) => c.cityLod === 'CITY_LOD_COUNTRY_OVERVIEW').length,
      regionalCount: cities.filter((c) => c.cityLod !== 'CITY_LOD_LOCAL').length,
      localCount: cities.length,
      mappedGameplayCities: mappings.length,
    },
  };

  const contentHash = hashCityPackage(unsigned);
  const pkg: CountryCityPackageV1 = { ...unsigned, contentHash };
  const issues = validateCountryCityPackage(pkg);
  if (issues.length > 0) {
    console.error(issues);
    throw new Error(`city package validation failed: ${issues.length}`);
  }

  await mkdir(outDir, { recursive: true });
  const pkgPath = resolve(outDir, 'turkeyCityPackage.json');
  await writeFile(pkgPath, JSON.stringify(pkg));
  await writeFile(
    resolve(outDir, 'turkeyCityBuildMeta.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        contentHash,
        stats: pkg.stats,
        inCountry: {
          VERIFIED_INSIDE: cities.filter((c) => c.inCountryStatus === 'VERIFIED_INSIDE').length,
          VERIFIED_SOURCE_EXCEPTION: cities.filter((c) => c.inCountryStatus === 'VERIFIED_SOURCE_EXCEPTION').length,
        },
        mappings: mappings.map((row) => ({
          gameplayCityId: row.gameplayCityId,
          geoCityId: row.geoCityId,
          status: row.mappingStatus,
        })),
      },
      null,
      2,
    ),
  );
  console.log('Wrote', pkgPath);
  console.log(pkg.stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
