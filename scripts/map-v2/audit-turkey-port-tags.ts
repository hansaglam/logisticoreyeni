/**
 * Tag-frequency audit for the Türkiye port extract.
 * Run after extract-turkey-ports-osm.ts
 *
 * npx tsx scripts/map-v2/audit-turkey-port-tags.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TURKEY_PORTS_GEOJSON_RAW_REL, TURKEY_PORTS_TAG_AUDIT_REL } from '../../src/mapV2/geo/portRawSource';

type Feature = {
  type: string;
  geometry?: { type: string } | null;
  properties?: Record<string, unknown> | null;
};

const KEYS = [
  'harbour',
  'landuse',
  'industrial',
  'amenity',
  'leisure',
  'port',
  'cargo',
  'container',
  'terminal',
  'ferry',
  'seamark:type',
  'man_made',
  'operator',
  'name',
] as const;

function main(): void {
  const root = resolve(__dirname, '../..');
  const geoPath = resolve(root, TURKEY_PORTS_GEOJSON_RAW_REL);
  if (!existsSync(geoPath)) {
    console.error('SEA_PORT_FOUNDATION_BLOCKED_SOURCE');
    console.error(`Missing ${TURKEY_PORTS_GEOJSON_RAW_REL}`);
    process.exit(2);
  }
  const fc = JSON.parse(readFileSync(geoPath, 'utf8')) as { features?: Feature[] };
  const features = fc.features ?? [];
  const geom: Record<string, number> = {};
  const keyPresence: Record<string, number> = {};
  const valueCounts: Record<string, Record<string, number>> = {};
  for (const key of KEYS) {
    keyPresence[key] = 0;
    valueCounts[key] = {};
  }
  for (const feature of features) {
    const g = feature.geometry?.type ?? 'null';
    geom[g] = (geom[g] ?? 0) + 1;
    const props = feature.properties ?? {};
    for (const key of KEYS) {
      const raw = props[key];
      if (raw == null || raw === '') continue;
      keyPresence[key] += 1;
      const text = String(raw);
      valueCounts[key][text] = (valueCounts[key][text] ?? 0) + 1;
    }
  }
  const topValues: Record<string, Array<{ value: string; count: number }>> = {};
  for (const key of KEYS) {
    topValues[key] = Object.entries(valueCounts[key])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 20)
      .map(([value, count]) => ({ value, count }));
  }
  const audit = {
    featureCount: features.length,
    geometryTypes: geom,
    keyPresence,
    topValues,
  };
  writeFileSync(resolve(root, TURKEY_PORTS_TAG_AUDIT_REL), `${JSON.stringify(audit, null, 2)}\n`);
  console.log(JSON.stringify({ wrote: TURKEY_PORTS_TAG_AUDIT_REL, featureCount: features.length, geometryTypes: geom, keyPresence }, null, 2));
}

main();
