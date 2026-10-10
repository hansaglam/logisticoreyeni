/**
 * OSM ROAD ingest (Türkiye-first). Fail-closed: no source → no geometry.
 *
 * Expected extract (gitignored):
 *   data/map-raw/osm/turkey-roads.geojson
 *
 * Observed Osmium GeoJSON (turkey-roads.geojson from turkey-260915.osm.pbf):
 * - FeatureCollection of Point (signals/junctions) then LineString ways
 * - compact JSON, no feature.id, no properties.id / osm_id / @id
 * - identity for ways is therefore geometry-hash fallback (geom.<sha25616>)
 * - tags live in properties: highway, name, ref, oneway, lanes, ...
 * LineString or MultiLineString. properties.highway required.
 * Do not invent roads. No live OSM query.
 *
 * Run: npx tsx scripts/map-v2/ingest-turkey-roads.ts
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { OSM_HIGHWAY_EXCLUDED, OSM_HIGHWAY_PROTOTYPE_INCLUDED, ROAD_CLASS_POLICY_ID } from '../../src/mapV2/geo/roadClassPolicy';
import { TURKEY_ROADS_RAW_REL } from '../../src/mapV2/geo/roadRawSource';
import { dequantizePolygons } from '../../src/mapV2/geo/worldBoundaryPackage';
import { getCountryRecord } from '../../src/mapV2/world/worldBoundaryLoader';
import { getTurkeyCityPackage } from '../../src/mapV2/world/countryCityLoader';
import { sealNetwork, createCityAccessPackage, createManifest, hashCanonical } from './transport-package-factory';
import { validateTransportNetwork } from '../../src/mapV2/geo/validateTransportNetwork';
import {
  ROAD_INGEST_PROCESSING_VERSION,
  ingestOsmRoadCollection,
  type OsmRoadCollection,
} from './road-ingest-core';

const root = resolve(__dirname, '../..');
const sourcePath = resolve(root, TURKEY_ROADS_RAW_REL);
const outDir = resolve(root, 'src/mapV2/generated/transport');

function printMissingSource(): void {
  console.error('STEP_2E_BLOCKED_RAW_SOURCE_REQUIRED');
  console.error(`Missing raw OSM extract: ${sourcePath}`);
  console.error(`Relative path: ${TURKEY_ROADS_RAW_REL}`);
  console.error('Place a GeoJSON FeatureCollection of OSM-derived Türkiye roads (ODbL).');
  console.error('Features: LineString or MultiLineString with properties.highway');
  console.error(`Prototype classes: ${OSM_HIGHWAY_PROTOTYPE_INCLUDED.join(', ')}`);
  console.error(`Excluded: ${OSM_HIGHWAY_EXCLUDED.join(', ')}`);
  console.error('Do not generate synthetic roads. SOURCE_PENDING until this file exists.');
  console.error(`Policy ${ROAD_CLASS_POLICY_ID} · ingest ${ROAD_INGEST_PROCESSING_VERSION}`);
}

async function main() {
  if (!existsSync(sourcePath)) {
    printMissingSource();
    process.exit(2);
  }
  const turkey = getCountryRecord('country.tur');
  if (!turkey) throw new Error('country.tur missing');
  const buf = await readFile(sourcePath);
  const sourceHash = `sha256:${createHash('sha256').update(buf).digest('hex')}` as const;
  const collection = JSON.parse(buf.toString('utf8')) as OsmRoadCollection;
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('Raw file is not a GeoJSON FeatureCollection');
  }
  const mapped = getTurkeyCityPackage().gameplayMappings.map((row) =>
    getTurkeyCityPackage().cities.find((city) => city.geoCityId === row.geoCityId),
  ).filter((city): city is NonNullable<typeof city> => Boolean(city));

  const result = ingestOsmRoadCollection(
    collection,
    dequantizePolygons(turkey.lods.COUNTRY_HIGH.polygons),
    mapped,
    {
      policyVersion: 1,
      datasetId: 'osm.tur.roads.prototype',
      datasetType: 'road-network',
      sourceName: 'OpenStreetMap-derived Türkiye roads (offline extract)',
      sourceURL: 'https://www.openstreetmap.org/copyright',
      license: 'ODbL 1.0',
      licenseURL: 'https://opendatacommons.org/licenses/odbl/1-0/',
      sourceVersion: 'unresolved',
      retrievedAt: 'unresolved',
      sourceHash,
      originalFormat: 'GeoJSON',
      processedFormat: 'GeoTransportNetworkPackageV1',
      processingVersion: ROAD_INGEST_PROCESSING_VERSION,
      derivedFrom: [],
      attributionRequired: true,
      productionApproved: false,
      notes: 'Prototype ingest. ODbL. OSM_TRANSFORMED_DB_LICENSE_CHECKPOINT open. Not truck-legal. KGM QA/reference only.',
    },
  );
  if (result.validationIssues.length > 0) {
    console.error(result.validationIssues.slice(0, 40));
    throw new Error(`ROAD topology validation failed before seal (${result.validationIssues.length} issues)`);
  }
  const sealed = sealNetwork(result.network);
  const sealedIssues = validateTransportNetwork(sealed);
  if (sealedIssues.length > 0) {
    console.error(sealedIssues.slice(0, 40));
    throw new Error(`ROAD topology validation failed (${sealedIssues.length} issues)`);
  }
  await writeFile(resolve(outDir, 'turkey-road-network.json'), `${JSON.stringify(sealed)}\n`, 'utf8');
  const { packTurkeyRoadRuntimeFromDisk } = await import('./pack-turkey-road-runtime');
  const packed = await packTurkeyRoadRuntimeFromDisk();

  const accessPkg = createCityAccessPackage();
  const accessBody = {
    schemaVersion: accessPkg.schemaVersion,
    packageId: accessPkg.packageId,
    geoCountryId: accessPkg.geoCountryId,
    accesses: accessPkg.accesses.map((row) => {
      if (row.mode !== 'ROAD') return row;
      return result.cityAccess.find((item) => item.geoCityId === row.geoCityId) ?? row;
    }),
  };
  await writeFile(
    resolve(outDir, 'turkey-city-access.json'),
    `${JSON.stringify({ ...accessBody, contentHash: hashCanonical(accessBody) })}\n`,
    'utf8',
  );

  const manifest = createManifest();
  const manifestBody = {
    schemaVersion: manifest.schemaVersion,
    packageId: manifest.packageId,
    geoCountryId: manifest.geoCountryId,
    layout: manifest.layout,
    processingVersion: manifest.processingVersion,
    modes: manifest.modes.map((row) =>
      row.mode === 'ROAD'
        ? {
            ...row,
            source: 'OpenStreetMap-derived offline GeoJSON (Osmium extract)',
            status: 'PROTOTYPE' as const,
            notes: 'Step 2E prototype. ODbL. Not truck-legal. KGM QA/reference only.',
          }
        : row,
    ),
    infrastructurePackageFile: manifest.infrastructurePackageFile,
    cityAccessPackageFile: manifest.cityAccessPackageFile,
    gameplaySeparation: manifest.gameplaySeparation,
  };
  await writeFile(
    resolve(outDir, 'turkeyTransportManifest.json'),
    `${JSON.stringify({ ...manifestBody, contentHash: hashCanonical(manifestBody) })}\n`,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        decision: 'STEP_2E_INGEST_WROTE_PROTOTYPE',
        stats: result.stats,
        hash: sealed.contentHash,
        unknownSourceIds: sealed.edges.filter((e) =>
          (e.sourceFeatureIds ?? []).some((id) => id.includes('unknown')) ||
          String(e.sourceMetadata.sourceFeatureIds ?? '').includes('unknown'),
        ).length,
        cityAccessProvisional: result.cityAccess.filter((row) => row.status === 'PROVISIONAL').length,
        cityAccessUnresolved: result.cityAccess.filter((row) => row.status === 'UNRESOLVED').length,
        runtimeChunks: packed.chunks.length,
        runtimeHash: packed.manifest.contentHash,
        overviewBytes: packed.sizes.low,
      },
      null,
      2,
    ),
  );
}

void main();
