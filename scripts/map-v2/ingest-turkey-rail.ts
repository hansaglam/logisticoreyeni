/**
 * OSM RAIL ingest (Türkiye-first). Fail-closed: no source → no geometry.
 *
 * Expected extract (gitignored):
 *   data/map-raw/osm/turkey-rail.geojson
 * Derived from turkey-260915.osm.pbf via:
 *   npx tsx scripts/map-v2/extract-turkey-rail-osm.ts
 *
 * Run: npx tsx scripts/map-v2/ingest-turkey-rail.ts
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { OSM_RAILWAY_EXCLUDED_DEFAULT, OSM_RAILWAY_LOGISTICS_INCLUDED, RAIL_CLASS_POLICY_ID } from '../../src/mapV2/geo/railClassPolicy';
import { TURKEY_OSM_PBF_RAW_REL, TURKEY_RAIL_GEOJSON_RAW_REL, TURKEY_RAIL_PBF_RAW_REL } from '../../src/mapV2/geo/railRawSource';
import { dequantizePolygons } from '../../src/mapV2/geo/worldBoundaryPackage';
import { getCountryRecord } from '../../src/mapV2/world/worldBoundaryLoader';
import { getTurkeyCityPackage } from '../../src/mapV2/world/countryCityLoader';
import { validateTransportNetwork } from '../../src/mapV2/geo/validateTransportNetwork';
import { sealNetwork, createManifest, hashCanonical } from './transport-package-factory';
import type { CountryCityTransportAccessPackageV1 } from '../../src/mapV2/geo/transportNetwork';
import {
  RAIL_INGEST_PROCESSING_VERSION,
  ingestOsmRailCollection,
  type OsmRailCollection,
} from './rail-ingest-core';
import { runTcddQa, TCDD_QA_STATUS } from './rail-tcdd-qa';
import { packRailDebugView } from './pack-turkey-rail-debug';
import { styleClassFromAttributes } from '../../src/mapV2/presentation/transportPaint';

const root = resolve(__dirname, '../..');
const sourcePath = resolve(root, TURKEY_RAIL_GEOJSON_RAW_REL);
const outDir = resolve(root, 'src/mapV2/generated/transport');

function printMissingSource(): void {
  console.error('RAIL_FOUNDATION_BLOCKED_RAW_SOURCE_REQUIRED');
  console.error(`Missing raw OSM extract: ${sourcePath}`);
  console.error(`Relative path: ${TURKEY_RAIL_GEOJSON_RAW_REL}`);
  console.error(`Expected PBF: ${TURKEY_RAIL_PBF_RAW_REL}`);
  console.error(`Parent PBF: ${TURKEY_OSM_PBF_RAW_REL}`);
  console.error('Do not invent railways. Generate with:');
  console.error('  npx tsx scripts/map-v2/extract-turkey-rail-osm.ts');
  console.error('Osmium:');
  console.error(`  osmium tags-filter ${TURKEY_OSM_PBF_RAW_REL} nwr/railway -o ${TURKEY_RAIL_PBF_RAW_REL} --overwrite`);
  console.error(
    `  osmium export ${TURKEY_RAIL_PBF_RAW_REL} -f geojson -c scripts/map-v2/osmium-rail-export.json -o ${TURKEY_RAIL_GEOJSON_RAW_REL} --overwrite`,
  );
  console.error('GeoJSON: FeatureCollection of Point/LineString/MultiLineString with properties.railway');
  console.error(`Logistics include: ${OSM_RAILWAY_LOGISTICS_INCLUDED.join(', ')}`);
  console.error(`Excluded by default: ${OSM_RAILWAY_EXCLUDED_DEFAULT.join(', ')}`);
  console.error(`Policy ${RAIL_CLASS_POLICY_ID} · ingest ${RAIL_INGEST_PROCESSING_VERSION}`);
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
  const collection = JSON.parse(buf.toString('utf8')) as OsmRailCollection;
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('Raw file is not a GeoJSON FeatureCollection');
  }
  const cityPkg = getTurkeyCityPackage();
  const mapped = cityPkg.gameplayMappings
    .map((row) => cityPkg.cities.find((city) => city.geoCityId === row.geoCityId))
    .filter((city): city is NonNullable<typeof city> => Boolean(city));

  const result = ingestOsmRailCollection(
    collection,
    dequantizePolygons(turkey.lods.COUNTRY_HIGH.polygons),
    mapped,
    {
      policyVersion: 1,
      datasetId: 'osm.tur.rail.prototype',
      datasetType: 'rail-network',
      sourceName: 'OpenStreetMap-derived Türkiye railways (offline extract)',
      sourceURL: 'https://www.openstreetmap.org/copyright',
      license: 'ODbL 1.0',
      licenseURL: 'https://opendatacommons.org/licenses/odbl/1-0/',
      sourceVersion: 'turkey-260915.osm.pbf',
      retrievedAt: '2026-09-16',
      sourceHash,
      originalFormat: 'GeoJSON (Osmium export of railway=* extract)',
      processedFormat: 'GeoTransportNetworkPackageV1',
      processingVersion: RAIL_INGEST_PROCESSING_VERSION,
      derivedFrom: [TURKEY_OSM_PBF_RAW_REL, TURKEY_RAIL_PBF_RAW_REL],
      attributionRequired: true,
      productionApproved: false,
      notes:
        'Prototype ingest. ODbL. OSM_TRANSFORMED_DB_LICENSE_CHECKPOINT open. TCDD QA/reference only — not bundled. Station ≠ freight terminal.',
    },
    turkey.lods.COUNTRY_HIGH.projectedBounds,
  );
  if (result.validationIssues.length > 0) {
    console.error(result.validationIssues.slice(0, 40));
    console.error('RAIL_FOUNDATION_BLOCKED_REAL_DATA_NORMALIZATION');
    throw new Error(`RAIL topology validation failed before seal (${result.validationIssues.length} issues)`);
  }
  const sealed = sealNetwork(result.network);
  const sealedIssues = validateTransportNetwork(sealed);
  if (sealedIssues.length > 0) {
    console.error(sealedIssues.slice(0, 40));
    console.error('RAIL_FOUNDATION_BLOCKED_REAL_DATA_NORMALIZATION');
    throw new Error(`RAIL topology validation failed (${sealedIssues.length} issues)`);
  }

  const fullPath = resolve(outDir, 'turkey-rail-network.json');
  await writeFile(fullPath, `${JSON.stringify(sealed)}\n`, 'utf8');

  const gameplayToGeo: Record<string, string> = {};
  for (const row of cityPkg.gameplayMappings) gameplayToGeo[row.gameplayCityId] = row.geoCityId;
  const tcdd = runTcddQa({
    gameplayToGeo,
    cityAccess: result.cityAccess,
    nodes: sealed.nodes,
    edges: sealed.edges,
  });

  const debug = packRailDebugView(sealed, result.cityAccess, cityPkg, styleClassFromAttributes);
  await writeFile(resolve(outDir, 'turkey-rail-debug.json'), `${JSON.stringify(debug)}\n`, 'utf8');

  const runtimeBody = {
    schemaVersion: 1 as const,
    packageId: 'map-v2.country.tur.transport.rail.runtime.v1',
    geoCountryId: 'country.tur',
    mode: 'RAIL' as const,
    sourceStatus: 'PROTOTYPE' as const,
    sourcePackageFile: 'turkey-rail-network.json',
    debugPackageFile: 'turkey-rail-debug.json',
    sourcePackageHash: sealed.contentHash,
    sourceManifest: sealed.sourceManifest,
    transformation: sealed.transformation,
    stats: result.stats,
    connectivity: result.componentMetrics,
    cityAccess: result.cityAccess,
    tcddQa: tcdd,
    productionApproved: false as const,
  };
  const runtime = { ...runtimeBody, contentHash: hashCanonical(runtimeBody) };
  await writeFile(resolve(outDir, 'turkey-rail-runtime-manifest.json'), `${JSON.stringify(runtime)}\n`, 'utf8');

  const existingAccess = JSON.parse(
    await readFile(resolve(outDir, 'turkey-city-access.json'), 'utf8'),
  ) as CountryCityTransportAccessPackageV1;
  const accessBody = {
    schemaVersion: existingAccess.schemaVersion,
    packageId: existingAccess.packageId,
    geoCountryId: existingAccess.geoCountryId,
    accesses: existingAccess.accesses.map((row) => {
      if (row.mode !== 'RAIL') return row;
      return result.cityAccess.find((item) => item.geoCityId === row.geoCityId) ?? row;
    }),
  };
  await writeFile(
    resolve(outDir, 'turkey-city-access.json'),
    `${JSON.stringify({ ...accessBody, contentHash: hashCanonical(accessBody) })}\n`,
    'utf8',
  );

  const manifest = createManifest();
  const current = JSON.parse(await readFile(resolve(outDir, 'turkeyTransportManifest.json'), 'utf8')) as ReturnType<
    typeof createManifest
  >;
  const manifestBody = {
    schemaVersion: manifest.schemaVersion,
    packageId: manifest.packageId,
    geoCountryId: manifest.geoCountryId,
    layout: manifest.layout,
    processingVersion: current.processingVersion,
    modes: current.modes.map((row) =>
      row.mode === 'RAIL'
        ? {
            ...row,
            source: 'OpenStreetMap-derived offline GeoJSON (Osmium railway extract)',
            status: 'PROTOTYPE' as const,
            notes: `Step 7 prototype. ODbL. TCDD ${TCDD_QA_STATUS}. Station ≠ freight. Player rail inactive.`,
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

  const geoToGameplay = new Map(cityPkg.gameplayMappings.map((row) => [row.geoCityId, row.gameplayCityId]));
  const cityLines = result.cityAccess.map((row) => {
    const name = geoToGameplay.get(row.geoCityId) ?? row.geoCityId;
    return `- ${name}: ${row.status}${row.accessNodeIds[0] ? ` (${row.accessNodeIds[0]})` : ''} — ${row.notes}`;
  });
  const qaDoc = `# Map V2 — Türkiye RAIL QA (Step 7)

**Status:** ${TCDD_QA_STATUS}  
**Not a 100% correctness claim.** TCDD materials were not copied as geometry.

## Source

- Provider: OpenStreetMap (ODbL 1.0)
- Raw: \`${TURKEY_OSM_PBF_RAW_REL}\`
- Extract: \`${TURKEY_RAIL_PBF_RAW_REL}\` / \`${TURKEY_RAIL_GEOJSON_RAW_REL}\`
- Source hash: \`${sourceHash}\`
- Package hash: \`${sealed.contentHash}\`
- Border policy: ${sealed.transformation.filtersApplied.join(', ')}

## Counts

- Raw features: ${result.stats.rawFeatureCount}
- Accepted line parts: ${result.stats.acceptedFeatureCount}
- Rejected: ${result.stats.rejectedFeatureCount}
- Nodes: ${result.stats.nodeCount}
- Edges: ${result.stats.edgeCount}
- Stations: ${result.stats.stationCount} (halt tags in extract: ${result.stats.haltCount})
- Junctions: ${result.stats.junctionCount}
- Terminal-tagged nodes: ${result.stats.terminalCount} (not VERIFIED freight)
- LOW / MEDIUM / HIGH edges: ${result.stats.edgesLow} / ${result.stats.edgesMedium} / ${result.stats.edgesHigh}
- Components: ${result.componentMetrics.componentCount}
- Largest component nodes: ${result.componentMetrics.largestComponentNodes}
- Isolated nodes: ${result.componentMetrics.isolatedNodeCount}
- OSM way/node IDs on accepted lines: ${result.stats.identityOsmId}
- Geometry-fingerprint fallback lines: ${result.stats.identityGeomFallback}

## City rail access (PROVISIONAL / UNRESOLVED only)

${cityLines.join('\n')}

## TCDD public-network checks

${tcdd.corridors.map((row) => `- ${row.id}: expected ${row.expected}; OSM same-component=${row.osmSameComponent}; ${row.cityAStatus}/${row.cityBStatus}. ${row.note}`).join('\n')}

## Unresolved issues

- OSM may omit or mis-tag operational TCDD segments.
- Construction/disused/tram/subway/light_rail excluded from logistics default.
- Freight terminals are not inferred from \`railway=station\`.
- Cross-border alignments clipped to Türkiye; short stubs may become \`BORDER_CROSSING\`.
- Player-facing rail corridors are not built in this step.
`;
  await writeFile(resolve(root, 'docs/architecture/map-v2/MAP_V2_RAIL_QA.md'), qaDoc, 'utf8');

  const { statSync } = await import('node:fs');
  console.log(
    JSON.stringify(
      {
        decision: 'RAIL_FOUNDATION_INGEST_WROTE',
        stats: result.stats,
        connectivity: result.componentMetrics,
        hash: sealed.contentHash,
        sourceHash,
        packageBytes: statSync(fullPath).size,
        debugBytes: statSync(resolve(outDir, 'turkey-rail-debug.json')).size,
        cityAccess: result.cityAccess.map((row) => ({
          geoCityId: row.geoCityId,
          gameplayCityId: geoToGameplay.get(row.geoCityId),
          status: row.status,
        })),
        tcdd,
      },
      null,
      2,
    ),
  );
}

void main();
