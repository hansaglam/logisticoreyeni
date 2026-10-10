/**
 * Offline RAIL connectivity audit. Reads canonical package + raw GeoJSON.
 * Never invents edges. Writes a compact DEV QA report.
 *
 * Run: npx tsx scripts/map-v2/audit-turkey-rail-connectivity.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { GeoTransportNetworkPackageV1 } from '../../src/mapV2/geo/transportNetwork';
import { TURKEY_RAIL_GEOJSON_RAW_REL } from '../../src/mapV2/geo/railRawSource';
import { isExcludedOsmRailway, isLogisticsOsmRailway } from '../../src/mapV2/geo/railClassPolicy';
import { getTurkeyCityPackage } from '../../src/mapV2/world/countryCityLoader';
import { haversineMeters } from '../../src/mapV2/geo/wgs84Distance';
import {
  buildRailComponents,
  classifyNearBreak,
  findNearBreaks,
  type RailQaIssue,
} from '../../src/mapV2/geo/railConnectivityAudit';
import { hashCanonical } from './transport-package-factory';

const root = resolve(__dirname, '../..');
const packagePath = resolve(root, 'src/mapV2/generated/transport/turkey-rail-network.json');
const rawPath = resolve(root, TURKEY_RAIL_GEOJSON_RAW_REL);
const outPath = resolve(root, 'src/mapV2/generated/transport/turkey-rail-connectivity-qa.json');

const CORRIDORS = [
  { id: 'istanbul-ankara', a: 'istanbul', b: 'ankara' },
  { id: 'izmir-ankara', a: 'izmir', b: 'ankara' },
  { id: 'ankara-adana', a: 'ankara', b: 'adana' },
  { id: 'adana-diyarbakir', a: 'adana', b: 'diyarbakir' },
] as const;

type RawFeat = {
  properties?: Record<string, unknown> | null;
  geometry?: { type: string; coordinates: unknown } | null;
};

function firstCoord(geometry: { type: string; coordinates: unknown } | null | undefined): { longitude: number; latitude: number } | null {
  if (!geometry) return null;
  const walk = (value: unknown): number[] | null => {
    if (!Array.isArray(value) || value.length === 0) return null;
    if (typeof value[0] === 'number' && typeof value[1] === 'number') return value as number[];
    return walk(value[0]);
  };
  const pair = walk(geometry.coordinates);
  if (!pair) return null;
  return { longitude: Number(pair[0]), latitude: Number(pair[1]) };
}

function inspectRawNear(
  features: RawFeat[],
  lon: number,
  lat: number,
  radiusMeters: number,
): { railway: string; usage: unknown; service: unknown; name: unknown; id: unknown }[] {
  const hits: { railway: string; usage: unknown; service: unknown; name: unknown; id: unknown }[] = [];
  for (const feature of features) {
    const coord = firstCoord(feature.geometry ?? null);
    if (!coord) continue;
    if (haversineMeters(coord, { longitude: lon, latitude: lat }) > radiusMeters) continue;
    const props = feature.properties ?? {};
    hits.push({
      railway: String(props.railway ?? ''),
      usage: props.usage ?? null,
      service: props.service ?? null,
      name: props.name ?? null,
      id: props['@id'] ?? null,
    });
  }
  return hits.slice(0, 12);
}

function main(): void {
  if (!existsSync(packagePath)) {
    console.error('RAIL_CONNECTIVITY_AUDIT_BLOCKED missing canonical package');
    process.exit(2);
  }
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as GeoTransportNetworkPackageV1;
  const { byNode, records } = buildRailComponents(pkg.nodes, pkg.edges);
  const nearBreaks = findNearBreaks(pkg.nodes, pkg.edges);
  const cities = getTurkeyCityPackage();
  const gameplay = new Map(cities.gameplayMappings.map((row) => [row.gameplayCityId, row]));
  const accessByGeo = new Map(
    JSON.parse(readFileSync(resolve(root, 'src/mapV2/generated/transport/turkey-city-access.json'), 'utf8')).accesses
      .filter((row: { mode: string }) => row.mode === 'RAIL')
      .map((row: { geoCityId: string }) => [row.geoCityId, row]),
  );

  const raw: { features: RawFeat[] } = existsSync(rawPath)
    ? (JSON.parse(readFileSync(rawPath, 'utf8')) as { features: RawFeat[] })
    : { features: [] };

  const cityAccessAudit = cities.gameplayMappings.map((row) => {
    const city = cities.cities.find((c) => c.geoCityId === row.geoCityId)!;
    const access = accessByGeo.get(row.geoCityId) as
      | { status: string; accessNodeIds: string[]; notes?: string }
      | undefined;
    const nodeId = access?.accessNodeIds?.[0];
    const node = nodeId ? pkg.nodes.find((n) => n.nodeId === nodeId) : undefined;
    const componentId = nodeId ? byNode.get(nodeId) : undefined;
    const component = records.find((r) => r.componentId === componentId);
    return {
      legacyCityId: row.gameplayCityId,
      geoCityId: row.geoCityId,
      status: access?.status ?? 'UNRESOLVED',
      candidateNodeId: nodeId ?? null,
      candidateKind: node?.kind ?? null,
      distanceHint: access?.notes ?? null,
      componentId: componentId ?? null,
      componentSize: component?.nodeCount ?? 0,
      region: component?.regionHint ?? null,
      coordinate: node?.coordinate ?? null,
      attributes: node?.sourceMetadata ?? null,
    };
  });

  const issues: RailQaIssue[] = [];
  const giant = records[0];
  issues.push({
    id: 'qa.rail.giant',
    type: 'UNKNOWN',
    severity: 'info',
    componentIds: giant ? [giant.componentId] : [],
    sourceEvidence: `Largest component ${giant?.nodeCount ?? 0} nodes / ${giant?.edgeCount ?? 0} edges (${giant?.regionHint})`,
    resolutionStatus: 'OPEN',
  });

  const corridors = CORRIDORS.map((pair) => {
    const a = cityAccessAudit.find((c) => c.legacyCityId === pair.a);
    const b = cityAccessAudit.find((c) => c.legacyCityId === pair.b);
    const same = Boolean(a?.componentId && a.componentId === b?.componentId);
    const mid =
      a?.coordinate && b?.coordinate
        ? {
            longitude: (a.coordinate.longitude + b.coordinate.longitude) / 2,
            latitude: (a.coordinate.latitude + b.coordinate.latitude) / 2,
          }
        : null;
    const rawHits = mid ? inspectRawNear(raw.features, mid.longitude, mid.latitude, 25000) : [];
    const excludedNear = rawHits.filter(
      (hit) => isExcludedOsmRailway(hit.railway) || !isLogisticsOsmRailway(hit.railway, typeof hit.usage === 'string' ? hit.usage : null),
    );
    if (!same) {
      issues.push({
        id: `qa.rail.corridor.${pair.id}`,
        type: a?.componentSize && b?.componentSize && Math.min(a.componentSize, b.componentSize) < 200 ? 'ACCESS_MAPPING' : 'SOURCE_GAP',
        severity: 'warning',
        componentIds: [a?.componentId, b?.componentId].filter((v): v is string => Boolean(v)),
        location: mid ?? undefined,
        sourceEvidence: `components ${a?.componentId}@${a?.componentSize} vs ${b?.componentId}@${b?.componentSize}; excluded/raw sample ${excludedNear.length}`,
        qaReference: 'TCDD_QA_ONLY',
        resolutionStatus: 'OPEN',
        breakClass: a?.componentSize && giant && a.componentSize < giant.nodeCount / 8 ? 'ACCESS_SPLIT' : 'UNKNOWN',
      });
    }
    return {
      id: pair.id,
      sameComponent: same,
      cityA: a,
      cityB: b,
      rawSampleNearMid: rawHits.slice(0, 6),
    };
  });

  const precisionCandidates = nearBreaks.filter((row) => row.distanceMeters <= 1.2);
  const ingestCandidates = nearBreaks.filter((row) => row.distanceMeters <= 0.15);
  for (const row of precisionCandidates.slice(0, 20)) {
    issues.push({
      id: `qa.rail.near.${row.fromNodeId.slice(-10)}.${row.toNodeId.slice(-10)}`,
      type: row.distanceMeters <= 0.15 ? 'INGEST_TOPOLOGY' : 'UNKNOWN',
      severity: row.distanceMeters <= 0.15 ? 'error' : 'info',
      componentIds: [row.fromComponentId, row.toComponentId],
      location: row.from,
      sourceEvidence: `near-break ${row.distanceMeters.toFixed(2)} m bucket ${row.radiusBucket}`,
      resolutionStatus: 'OPEN',
      breakClass: classifyNearBreak(row.distanceMeters, false, false, null),
    });
  }

  const stationOrphans = pkg.nodes.filter((n) => n.kind === 'RAIL_STATION' && n.sourceMetadata.associated !== true);
  const stationClasses = {
    attachedExact: pkg.nodes.filter((n) => n.kind === 'RAIL_STATION' && n.sourceMetadata.associationStatus === 'ATTACHED_EXACT').length,
    provisionalNearEdge: pkg.nodes.filter((n) => n.kind === 'RAIL_STATION' && n.sourceMetadata.associationStatus === 'PROVISIONAL_NEAR_EDGE').length,
    unresolved: pkg.nodes.filter((n) => n.kind === 'RAIL_STATION' && n.sourceMetadata.associationStatus === 'UNRESOLVED').length,
  };
  const body = {
    schemaVersion: 1 as const,
    packageId: 'map-v2.country.tur.transport.rail.connectivity-qa.v1',
    sourcePackageHash: pkg.contentHash,
    componentCount: records.length,
    largestComponent: giant,
    mediumComponents: records.filter((r) => r.nodeCount >= 25 && r.nodeCount < (giant?.nodeCount ?? 0)).slice(0, 20),
    tinyFragments: records.filter((r) => r.nodeCount > 1 && r.nodeCount < 25).length,
    stationOnlyComponents: records.filter((r) => r.isolated && r.stationCount > 0).length,
    borderFragments: records.filter((r) => r.borderNodeCount > 0 && r.nodeCount < 40).length,
    nearBreakCounts: {
      r25: nearBreaks.filter((r) => r.radiusBucket <= 25).length,
      r50: nearBreaks.filter((r) => r.radiusBucket <= 50).length,
      r100: nearBreaks.filter((r) => r.radiusBucket <= 100).length,
      r250: nearBreaks.filter((r) => r.radiusBucket <= 250).length,
      r500: nearBreaks.length,
      precisionLe1m: precisionCandidates.length,
      ingestLe15cm: ingestCandidates.length,
    },
    nearBreaksSample: nearBreaks.slice(0, 40),
    cityAccessAudit,
    corridors,
    stationOrphans: stationOrphans.length,
    stationClasses,
    issues,
    notes: [
      'Nearby endpoints are QA candidates only. Not auto-connected.',
      'TCDD is QA/reference. No geometry copied.',
    ],
  };
  const sealed = { ...body, contentHash: hashCanonical(body) };
  writeFileSync(outPath, `${JSON.stringify(sealed)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        decision: 'RAIL_CONNECTIVITY_AUDIT_WROTE',
        components: records.length,
        giant: giant?.nodeCount,
        nearBreaks: body.nearBreakCounts,
        cityAccess: cityAccessAudit.map((c) => ({
          city: c.legacyCityId,
          status: c.status,
          size: c.componentSize,
          component: c.componentId,
        })),
        corridors: corridors.map((c) => ({ id: c.id, same: c.sameComponent })),
        issues: issues.length,
        rawFeatures: raw.features.length,
        sourceHash: createHash('sha256').update(readFileSync(packagePath)).digest('hex').slice(0, 16),
      },
      null,
      2,
    ),
  );
}

main();
