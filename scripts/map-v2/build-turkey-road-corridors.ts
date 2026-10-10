import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../../src/mapV2/domain/ids';
import { CITY_ACCESS_CANDIDATE_RADIUS_METERS } from './road-ingest-core';
import { proposeCityTransportAccess } from '../../src/mapV2/geo/cityTransportAccess';
import {
  EXPECTED_ROAD_SOURCE_PACKAGE_HASH,
  PLAYER_FACING_ROAD_CORRIDOR_CANDIDATES,
  PLAYER_ROAD_CORRIDOR_POLICY_VERSION,
  PLAYER_ROAD_CORRIDOR_QUANTIZE,
  PLAYER_ROAD_CORRIDOR_SCHEMA_VERSION,
  PLAYER_ROAD_CORRIDOR_SIMPLIFY_TOLERANCE,
  PLAYER_ROAD_CORRIDOR_SIMPLIFY_VERSION,
  corridorIdForPair,
  type CompactPlayerCorridor,
  type PlayerFacingRoadCorridorArtifactV1,
  type UnresolvedCorridorCandidate,
} from '../../src/mapV2/geo/playerFacingRoadCorridor';
import {
  ROAD_CORRIDOR_ROUTE_ALGORITHM_VERSION,
  buildUndirectedAdjacency,
  dijkstraShortestPath,
  undirectedComponents,
} from '../../src/mapV2/geo/roadCorridorRouting';
import { ROAD_SOURCE_PACKAGE_HASH_2E } from '../../src/mapV2/geo/roadRuntimePackage';
import { deltaEncodeQuantized } from '../../src/mapV2/geo/roadRuntimePackage';
import { simplifyOpenPolyline } from '../../src/mapV2/geo/simplifyPolyline';
import { inflateProjectedLine, lineHasDatelineJump, quantizeProjectedPoint } from '../../src/mapV2/geo/transportGeometry';
import type { GeoTransportEdgeRecord, GeoTransportNetworkPackageV1, GeoTransportNodeRecord } from '../../src/mapV2/geo/transportNetwork';
import { haversineMeters } from '../../src/mapV2/geo/wgs84Distance';
import { getTurkeyCityPackage, geoCityIdForGameplayCity } from '../../src/mapV2/world/countryCityLoader';
import type { CountryCityTransportAccessPackageV1 } from '../../src/mapV2/geo/transportNetwork';

export const MIN_USABLE_COMPONENT_SIZE = 500;
export const MIN_CORRIDOR_LENGTH_METERS = 8_000;
export const MAX_CORRIDOR_LENGTH_METERS = 2_000_000;

const root = resolve(__dirname, '../..');
const sourcePath = resolve(root, 'src/mapV2/generated/transport/turkey-road-network.json');
const accessPath = resolve(root, 'src/mapV2/generated/transport/turkey-city-access.json');
const outDir = resolve(root, 'src/mapV2/generated/countryOverview');
const artifactPath = resolve(outDir, 'turkey-road-corridors.json');
const lineagePath = resolve(outDir, 'turkey-road-corridors.lineage.json');
const reportPath = resolve(outDir, 'turkey-road-corridors.report.json');

export type CityAccessReportRow = {
  legacyCityId: string;
  geoCityId: string;
  candidateNodeId: string | null;
  distanceMeters: number | null;
  roadClass: string | null;
  componentId: string | null;
  componentSize: number | null;
  status: 'PROVISIONAL' | 'UNRESOLVED';
  notes: string;
};

function hashCanonical(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function nearEq(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12;
}

function highwayOfIncident(nodeId: string, edgesByNode: Map<string, GeoTransportEdgeRecord[]>): string | null {
  const list = edgesByNode.get(nodeId) ?? [];
  const ranked = [...list].sort((a, b) => (a.attributes.highway as string).localeCompare(String(b.attributes.highway)));
  const highway = ranked[0]?.attributes.highway;
  return typeof highway === 'string' ? highway : null;
}

function joinRoutePolyline(
  edgeIds: readonly string[],
  nodeIds: readonly string[],
  edgeById: Map<string, GeoTransportEdgeRecord>,
): { points: { x: number; y: number }[]; ok: boolean; reason?: string } {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < edgeIds.length; i += 1) {
    const edge = edgeById.get(edgeIds[i]);
    if (!edge) return { points: [], ok: false, reason: 'missing-edge' };
    const from = nodeIds[i];
    const to = nodeIds[i + 1];
    const reverse = edge.fromNodeId === to && edge.toNodeId === from;
    const forward = edge.fromNodeId === from && edge.toNodeId === to;
    if (!forward && !reverse) return { points: [], ok: false, reason: 'edge-not-incident' };
    const poly = inflateProjectedLine(edge.geometry.projectedQuantized, PLAYER_ROAD_CORRIDOR_QUANTIZE);
    if (poly.length < 2) return { points: [], ok: false, reason: 'short-edge-geometry' };
    const ordered = reverse ? [...poly].reverse() : poly;
    for (const point of ordered) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return { points: [], ok: false, reason: 'non-finite' };
      }
      if (points.length && nearEq(points[points.length - 1], point)) continue;
      points.push(point);
    }
  }
  return { points, ok: points.length >= 2 };
}

export function resolveProvisionalAccess(input: {
  geoCityId: string;
  cityProjected: { x: number; y: number };
  cityWgs84: { longitude: number; latitude: number } | undefined;
  storedNodeId: string | undefined;
  nodes: GeoTransportNodeRecord[];
  nodeById: Map<string, GeoTransportNodeRecord>;
  componentOf: Map<string, string>;
  sizeByComponent: Map<string, number>;
  giantComponentId: string;
}): { nodeId: string | null; distanceMeters: number | null; notes: string } {
  const ranked = proposeCityTransportAccess(
    {
      geoCityId: input.geoCityId,
      projected: input.cityProjected,
    } as never,
    'ROAD',
    input.nodes,
    12,
  ).candidates;
  const usable = ranked.filter((candidate) => {
    const node = input.nodeById.get(candidate.nodeId);
    if (!node?.coordinate) return false;
    const meters = input.cityWgs84
      ? haversineMeters(input.cityWgs84, node.coordinate)
      : Number.POSITIVE_INFINITY;
    if (!(meters <= CITY_ACCESS_CANDIDATE_RADIUS_METERS)) return false;
    const component = input.componentOf.get(candidate.nodeId);
    const size = component ? input.sizeByComponent.get(component) ?? 0 : 0;
    if (size < MIN_USABLE_COMPONENT_SIZE) return false;
    if (component !== input.giantComponentId) return false;
    return true;
  });
  const preferred =
    usable.find((row) => row.nodeId === input.storedNodeId) ?? usable[0] ?? null;
  if (!preferred) {
    return { nodeId: null, distanceMeters: null, notes: 'No usable ROAD candidate within 15 km of the giant component' };
  }
  const node = input.nodeById.get(preferred.nodeId);
  const meters = input.cityWgs84 && node?.coordinate ? haversineMeters(input.cityWgs84, node.coordinate) : null;
  const usedStored = preferred.nodeId === input.storedNodeId;
  return {
    nodeId: preferred.nodeId,
    distanceMeters: meters,
    notes: usedStored
      ? 'Stored PROVISIONAL candidate is in the giant component'
      : 'Stored candidate unused; nearest giant-component node within 15 km (still PROVISIONAL)',
  };
}

export async function buildTurkeyRoadCorridorsFromDisk(): Promise<{
  artifact: PlayerFacingRoadCorridorArtifactV1;
  report: Record<string, unknown>;
  bytes: number;
}> {
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing canonical ROAD package: ${sourcePath}`);
  }
  const pkg = JSON.parse(readFileSync(sourcePath, 'utf8')) as GeoTransportNetworkPackageV1;
  if (pkg.contentHash !== EXPECTED_ROAD_SOURCE_PACKAGE_HASH || pkg.contentHash !== ROAD_SOURCE_PACKAGE_HASH_2E) {
    throw new Error(`Unexpected ROAD contentHash ${pkg.contentHash}`);
  }
  const accessPkg = JSON.parse(readFileSync(accessPath, 'utf8')) as CountryCityTransportAccessPackageV1;
  const nodeById = new Map(pkg.nodes.map((node) => [node.nodeId, node]));
  const edgeById = new Map(pkg.edges.map((edge) => [edge.edgeId, edge]));
  const edgesByNode = new Map<string, GeoTransportEdgeRecord[]>();
  for (const edge of pkg.edges) {
    if (!edgesByNode.has(edge.fromNodeId)) edgesByNode.set(edge.fromNodeId, []);
    if (!edgesByNode.has(edge.toNodeId)) edgesByNode.set(edge.toNodeId, []);
    edgesByNode.get(edge.fromNodeId)!.push(edge);
    edgesByNode.get(edge.toNodeId)!.push(edge);
  }
  const components = undirectedComponents(pkg.nodes, pkg.edges);
  let giantComponentId = '';
  let giantSize = 0;
  for (const [id, size] of components.sizeByComponent) {
    if (size > giantSize) {
      giantSize = size;
      giantComponentId = id;
    }
  }
  const cities = getTurkeyCityPackage();
  const accessRows: CityAccessReportRow[] = [];
  const accessNodeByLegacy = new Map<string, string>();
  for (const legacyCityId of LEGACY_STABLE_GAMEPLAY_CITY_IDS) {
    const geoCityId = geoCityIdForGameplayCity(legacyCityId);
    const city = geoCityId ? cities.cities.find((row) => row.geoCityId === geoCityId) : undefined;
    const stored = geoCityId
      ? accessPkg.accesses.find((row) => row.geoCityId === geoCityId && row.mode === 'ROAD')
      : undefined;
    if (!geoCityId || !city) {
      accessRows.push({
        legacyCityId,
        geoCityId: geoCityId ?? '',
        candidateNodeId: null,
        distanceMeters: null,
        roadClass: null,
        componentId: null,
        componentSize: null,
        status: 'UNRESOLVED',
        notes: 'Missing GeoCity mapping',
      });
      continue;
    }
    const giantNodes = pkg.nodes.filter((node) => components.componentOf.get(node.nodeId) === giantComponentId);
    const resolved = resolveProvisionalAccess({
      geoCityId,
      cityProjected: city.projected,
      cityWgs84: city.coordinate,
      storedNodeId: stored?.accessNodeIds[0],
      nodes: giantNodes,
      nodeById,
      componentOf: components.componentOf,
      sizeByComponent: components.sizeByComponent,
      giantComponentId,
    });
    const node = resolved.nodeId ? nodeById.get(resolved.nodeId) : undefined;
    const componentId = resolved.nodeId ? components.componentOf.get(resolved.nodeId) ?? null : null;
    const row: CityAccessReportRow = {
      legacyCityId,
      geoCityId,
      candidateNodeId: resolved.nodeId,
      distanceMeters: resolved.distanceMeters,
      roadClass: resolved.nodeId ? highwayOfIncident(resolved.nodeId, edgesByNode) : null,
      componentId,
      componentSize: componentId ? components.sizeByComponent.get(componentId) ?? null : null,
      status: resolved.nodeId ? 'PROVISIONAL' : 'UNRESOLVED',
      notes: resolved.notes,
    };
    accessRows.push(row);
    if (resolved.nodeId) accessNodeByLegacy.set(legacyCityId, resolved.nodeId);
    void node;
  }

  const adjacency = buildUndirectedAdjacency(pkg.edges);
  const compact: CompactPlayerCorridor[] = [];
  const unresolved: UnresolvedCorridorCandidate[] = [];
  const lineage: Record<string, { sourceEdgeIds: string[]; sourceNodeIds: string[] }> = {};

  PLAYER_FACING_ROAD_CORRIDOR_CANDIDATES.forEach((pair, index) => {
    const fromNode = accessNodeByLegacy.get(pair.fromLegacyCityId);
    const toNode = accessNodeByLegacy.get(pair.toLegacyCityId);
    const fromGeo = geoCityIdForGameplayCity(pair.fromLegacyCityId);
    const toGeo = geoCityIdForGameplayCity(pair.toLegacyCityId);
    if (!fromNode || !toNode || !fromGeo || !toGeo) {
      unresolved.push({
        fromLegacyCityId: pair.fromLegacyCityId,
        toLegacyCityId: pair.toLegacyCityId,
        reason: 'missing-access',
      });
      return;
    }
    if (fromNode === toNode) {
      unresolved.push({
        fromLegacyCityId: pair.fromLegacyCityId,
        toLegacyCityId: pair.toLegacyCityId,
        reason: 'same-node',
      });
      return;
    }
    const fromComp = components.componentOf.get(fromNode);
    const toComp = components.componentOf.get(toNode);
    if (fromComp !== toComp) {
      unresolved.push({
        fromLegacyCityId: pair.fromLegacyCityId,
        toLegacyCityId: pair.toLegacyCityId,
        reason: `different-components:${fromComp}:${toComp}`,
      });
      return;
    }
    const routed = dijkstraShortestPath(adjacency, fromNode, toNode);
    if (!routed || routed.edgeIds.length === 0) {
      unresolved.push({
        fromLegacyCityId: pair.fromLegacyCityId,
        toLegacyCityId: pair.toLegacyCityId,
        reason: 'no-path',
      });
      return;
    }
    if (routed.lengthMeters < MIN_CORRIDOR_LENGTH_METERS || routed.lengthMeters > MAX_CORRIDOR_LENGTH_METERS) {
      unresolved.push({
        fromLegacyCityId: pair.fromLegacyCityId,
        toLegacyCityId: pair.toLegacyCityId,
        reason: `length:${Math.round(routed.lengthMeters)}`,
      });
      return;
    }
    if (routed.nodeIds[0] !== fromNode || routed.nodeIds[routed.nodeIds.length - 1] !== toNode) {
      unresolved.push({
        fromLegacyCityId: pair.fromLegacyCityId,
        toLegacyCityId: pair.toLegacyCityId,
        reason: 'endpoint-mismatch',
      });
      return;
    }
    const joined = joinRoutePolyline(routed.edgeIds, routed.nodeIds, edgeById);
    if (!joined.ok) {
      unresolved.push({
        fromLegacyCityId: pair.fromLegacyCityId,
        toLegacyCityId: pair.toLegacyCityId,
        reason: joined.reason ?? 'join-failed',
      });
      return;
    }
    if (lineHasDatelineJump(joined.points)) {
      unresolved.push({
        fromLegacyCityId: pair.fromLegacyCityId,
        toLegacyCityId: pair.toLegacyCityId,
        reason: 'dateline',
      });
      return;
    }
    const simplified = simplifyOpenPolyline(joined.points, PLAYER_ROAD_CORRIDOR_SIMPLIFY_TOLERANCE);
    if (simplified.length < 2) {
      unresolved.push({
        fromLegacyCityId: pair.fromLegacyCityId,
        toLegacyCityId: pair.toLegacyCityId,
        reason: 'simplify-empty',
      });
      return;
    }
    const quantized: number[] = [];
    for (const point of simplified) {
      if (point.x < 0.5 || point.x > 0.7 || point.y < 0.3 || point.y > 0.45) {
        unresolved.push({
          fromLegacyCityId: pair.fromLegacyCityId,
          toLegacyCityId: pair.toLegacyCityId,
          reason: 'out-of-turkey-scope',
        });
        return;
      }
      const [qx, qy] = quantizeProjectedPoint(point, PLAYER_ROAD_CORRIDOR_QUANTIZE);
      quantized.push(qx, qy);
    }
    const id = corridorIdForPair(pair.fromLegacyCityId, pair.toLegacyCityId);
    const [left, right] = pair.fromLegacyCityId < pair.toLegacyCityId
      ? [pair.fromLegacyCityId, pair.toLegacyCityId]
      : [pair.toLegacyCityId, pair.fromLegacyCityId];
    const leftGeo = geoCityIdForGameplayCity(left)!;
    const rightGeo = geoCityIdForGameplayCity(right)!;
    const leftNode = left === pair.fromLegacyCityId ? fromNode : toNode;
    const rightNode = right === pair.toLegacyCityId ? toNode : fromNode;
    compact.push({
      id,
      fromLegacyCityId: left,
      toLegacyCityId: right,
      fromGeoCityId: leftGeo,
      toGeoCityId: rightGeo,
      fromAccessNodeId: leftNode,
      toAccessNodeId: rightNode,
      status: 'PROVISIONAL_SOURCE_PATH',
      displayPriority: index,
      sourceEdgeCount: routed.edgeIds.length,
      sourceRouteLengthMeters: Math.round(routed.lengthMeters),
      sourceEdgeIdsHash: hashCanonical(routed.edgeIds),
      q: deltaEncodeQuantized(quantized),
    });
    lineage[id] = { sourceEdgeIds: routed.edgeIds, sourceNodeIds: routed.nodeIds };
  });

  compact.sort((a, b) => a.id.localeCompare(b.id));
  const body = {
    schemaVersion: PLAYER_ROAD_CORRIDOR_SCHEMA_VERSION,
    countryId: 'country.tur' as const,
    mode: 'ROAD' as const,
    sourceRoadPackageHash: pkg.contentHash,
    corridorPolicyVersion: PLAYER_ROAD_CORRIDOR_POLICY_VERSION,
    routeAlgorithmVersion: ROAD_CORRIDOR_ROUTE_ALGORITHM_VERSION,
    simplificationVersion: PLAYER_ROAD_CORRIDOR_SIMPLIFY_VERSION,
    quantization: PLAYER_ROAD_CORRIDOR_QUANTIZE,
    corridors: compact,
    unresolved,
  };
  const artifact: PlayerFacingRoadCorridorArtifactV1 = {
    ...body,
    contentHash: hashCanonical(body),
  };

  const connected = new Set<string>();
  for (const row of compact) {
    connected.add(row.fromLegacyCityId);
    connected.add(row.toLegacyCityId);
  }
  const disconnected = LEGACY_STABLE_GAMEPLAY_CITY_IDS.filter((id) => !connected.has(id));
  const report = {
    sourceRoadPackageHash: pkg.contentHash,
    canonicalComponentCount: components.componentCount,
    giantComponentSize: giantSize,
    access: accessRows,
    resolved: compact.map((row) => ({
      id: row.id,
      sourceEdgeCount: row.sourceEdgeCount,
      sourceRouteLengthMeters: row.sourceRouteLengthMeters,
    })),
    unresolved,
    connectedCities: [...connected].sort(),
    disconnectedCities: disconnected,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact)}\n`);
  writeFileSync(lineagePath, `${JSON.stringify({ sourceRoadPackageHash: pkg.contentHash, corridors: lineage })}\n`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { artifact, report, bytes: statSync(artifactPath).size };
}

if (process.argv[1] && process.argv[1].endsWith('build-turkey-road-corridors.ts')) {
  buildTurkeyRoadCorridorsFromDisk()
    .then((result) => {
      console.log(
        JSON.stringify(
          {
            bytes: result.bytes,
            contentHash: result.artifact.contentHash,
            resolved: result.artifact.corridors.length,
            unresolved: result.artifact.unresolved.length,
            report: result.report,
          },
          null,
          2,
        ),
      );
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
