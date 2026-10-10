/**
 * Offline Osmium extract for Türkiye water / basin polygons (ODbL).
 * Complements Natural Earth 10m land, which closes the Bosphorus at 10m scale.
 *
 * Run: npx tsx scripts/map-v2/extract-turkey-water-osm.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  TURKEY_OSM_PBF_RAW_REL,
  TURKEY_WATER_GEOJSON_RAW_REL,
  TURKEY_WATER_PBF_RAW_REL,
} from '../../src/mapV2/geo/maritimeRawSource';

export const OSM_WATER_TAGS_FILTER = [
  'nwr/natural=water',
  'nwr/natural=bay',
  'nwr/natural=strait',
  'nwr/water=sea',
  'nwr/water=bay',
  'nwr/water=strait',
  'nwr/water=lagoon',
  'nwr/seamark:type=harbour_basin',
] as const;

const root = resolve(__dirname, '../..');
const pbfIn = resolve(root, TURKEY_OSM_PBF_RAW_REL);
const pbfOut = resolve(root, TURKEY_WATER_PBF_RAW_REL);
const geoOut = resolve(root, TURKEY_WATER_GEOJSON_RAW_REL);
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
    console.error('MARITIME_NAVIGATION_BLOCKED_SOURCE');
    console.error(`Missing ${TURKEY_OSM_PBF_RAW_REL}`);
    process.exit(2);
  }
  run(['tags-filter', pbfIn, ...OSM_WATER_TAGS_FILTER, '-o', pbfOut, '--overwrite']);
  run(['export', pbfOut, '-f', 'geojson', '-c', exportConfig, '-o', geoOut, '--overwrite']);
  console.log(
    JSON.stringify(
      { decision: 'WATER_OSM_EXTRACT_WROTE', pbf: TURKEY_WATER_PBF_RAW_REL, geojson: TURKEY_WATER_GEOJSON_RAW_REL },
      null,
      2,
    ),
  );
}

main();
