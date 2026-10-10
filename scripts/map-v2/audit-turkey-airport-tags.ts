/**
 * Tag-frequency audit for the Türkiye airport extract.
 * Run after extract-turkey-airports-osm.ts
 *
 * npx tsx scripts/map-v2/audit-turkey-airport-tags.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TURKEY_AIRPORTS_GEOJSON_RAW_REL, TURKEY_AIRPORTS_TAG_AUDIT_REL } from '../../src/mapV2/geo/airportRawSource';

type Feature = {
  type: string;
  geometry?: { type: string } | null;
  properties?: Record<string, unknown> | null;
};

const KEYS = [
  'aeroway',
  'aerodrome:type',
  'iata',
  'icao',
  'operator',
  'name',
  'international',
  'military',
  'access',
  'cargo',
  'disused',
  'abandoned',
  'ref',
  'surface',
] as const;

function main(): void {
  const root = resolve(__dirname, '../..');
  const geoPath = resolve(root, TURKEY_AIRPORTS_GEOJSON_RAW_REL);
  if (!existsSync(geoPath)) {
    console.error('AIRPORT_FOUNDATION_BLOCKED_SOURCE');
    console.error(`Missing ${TURKEY_AIRPORTS_GEOJSON_RAW_REL}`);
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
      .slice(0, 30)
      .map(([value, count]) => ({ value, count }));
  }
  const audit = {
    featureCount: features.length,
    geometryTypes: geom,
    keyPresence,
    topValues,
  };
  writeFileSync(resolve(root, TURKEY_AIRPORTS_TAG_AUDIT_REL), `${JSON.stringify(audit, null, 2)}\n`);
  console.log(JSON.stringify({ wrote: TURKEY_AIRPORTS_TAG_AUDIT_REL, featureCount: features.length, geometryTypes: geom, keyPresence }, null, 2));
}

main();
