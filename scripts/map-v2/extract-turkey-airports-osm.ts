/**
 * Offline Osmium extract for Türkiye aeroway infrastructure.
 * Does not download. Requires data/map-raw/osm/turkey-260915.osm.pbf.
 *
 * Run: npx tsx scripts/map-v2/extract-turkey-airports-osm.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TURKEY_AIRPORTS_GEOJSON_RAW_REL,
  TURKEY_AIRPORTS_PBF_RAW_REL,
  TURKEY_OSM_PBF_RAW_REL,
} from '../../src/mapV2/geo/airportRawSource';
import { OSM_AIRPORT_TAGS_FILTER } from './osmium-airport-filter';

const root = resolve(__dirname, '../..');
const pbfIn = resolve(root, TURKEY_OSM_PBF_RAW_REL);
const pbfOut = resolve(root, TURKEY_AIRPORTS_PBF_RAW_REL);
const geoOut = resolve(root, TURKEY_AIRPORTS_GEOJSON_RAW_REL);
const exportConfig = resolve(__dirname, 'osmium-port-export.json');

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
    console.error('AIRPORT_FOUNDATION_BLOCKED_SOURCE');
    console.error(`Missing ${TURKEY_OSM_PBF_RAW_REL}`);
    process.exit(2);
  }
  run(['tags-filter', pbfIn, ...OSM_AIRPORT_TAGS_FILTER, '-o', pbfOut, '--overwrite']);
  run(['export', pbfOut, '-f', 'geojson', '-c', exportConfig, '-o', geoOut, '--overwrite']);
  console.log(
    JSON.stringify(
      {
        decision: 'AIRPORT_OSM_EXTRACT_WROTE',
        pbf: TURKEY_AIRPORTS_PBF_RAW_REL,
        geojson: TURKEY_AIRPORTS_GEOJSON_RAW_REL,
        filter: OSM_AIRPORT_TAGS_FILTER,
      },
      null,
      2,
    ),
  );
}

main();
