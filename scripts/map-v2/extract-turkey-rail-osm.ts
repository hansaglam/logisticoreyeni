/**
 * Offline Osmium extract for Türkiye railway features.
 * Does not download. Requires data/map-raw/osm/turkey-260915.osm.pbf.
 *
 * Run: npx tsx scripts/map-v2/extract-turkey-rail-osm.ts
 *
 * Equivalent CLI:
 *   osmium tags-filter turkey-260915.osm.pbf nwr/railway -o turkey-rail.osm.pbf --overwrite
 *   osmium export turkey-rail.osm.pbf -f geojson -c scripts/map-v2/osmium-rail-export.json \
 *     -o turkey-rail.geojson --overwrite
 *
 * Export config sets attributes.id + attributes.type so GeoJSON features can carry OSM object IDs.
 * If a given Osmium build still omits IDs, ingest falls back to geometry fingerprints (does not invent OSM IDs).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TURKEY_OSM_PBF_RAW_REL,
  TURKEY_RAIL_GEOJSON_RAW_REL,
  TURKEY_RAIL_PBF_RAW_REL,
} from '../../src/mapV2/geo/railRawSource';

const root = resolve(__dirname, '../..');
const pbfIn = resolve(root, TURKEY_OSM_PBF_RAW_REL);
const pbfOut = resolve(root, TURKEY_RAIL_PBF_RAW_REL);
const geoOut = resolve(root, TURKEY_RAIL_GEOJSON_RAW_REL);
const exportConfig = resolve(__dirname, 'osmium-rail-export.json');

function run(args: string[]): void {
  const result = spawnSync('osmium', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`osmium ${args[0]} failed (${result.status})`);
  }
}

function main(): void {
  if (!existsSync(pbfIn)) {
    console.error('RAIL_FOUNDATION_BLOCKED_RAW_SOURCE_REQUIRED');
    console.error(`Missing ${TURKEY_OSM_PBF_RAW_REL}`);
    process.exit(2);
  }
  run(['tags-filter', pbfIn, 'nwr/railway', '-o', pbfOut, '--overwrite']);
  run(['export', pbfOut, '-f', 'geojson', '-c', exportConfig, '-o', geoOut, '--overwrite']);
  console.log(
    JSON.stringify(
      {
        decision: 'RAIL_OSM_EXTRACT_WROTE',
        pbf: TURKEY_RAIL_PBF_RAW_REL,
        geojson: TURKEY_RAIL_GEOJSON_RAW_REL,
        idConfig: 'osmium-rail-export.json attributes.type+id',
      },
      null,
      2,
    ),
  );
}

main();
