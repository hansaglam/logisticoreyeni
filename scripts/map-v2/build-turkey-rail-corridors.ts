import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  EXPECTED_RAIL_SOURCE_PACKAGE_HASH,
  PLAYER_FACING_RAIL_CORRIDOR_CANDIDATES,
  PLAYER_RAIL_CORRIDOR_POLICY_VERSION,
  PLAYER_RAIL_CORRIDOR_QUANTIZE,
  PLAYER_RAIL_CORRIDOR_SCHEMA_VERSION,
  PLAYER_RAIL_CORRIDOR_SIMPLIFY_TOLERANCE,
  PLAYER_RAIL_CORRIDOR_SIMPLIFY_VERSION,
  PLAYER_RAIL_ELIGIBLE_LEGACY_CITY_IDS,
  PLAYER_RAIL_UNRESOLVED_LEGACY_CITY_IDS,
  railCorridorIdForPair,
  type CompactPlayerRailCorridor,
  type PlayerFacingRailCorridorArtifactV1,
  type UnresolvedRailCorridorCandidate,
} from '../../src/mapV2/geo/playerFacingRailCorridor';
import {
  RAIL_CORRIDOR_COST_POLICY_VERSION,
  RAIL_CORRIDOR_ROUTE_ALGORITHM_VERSION,
  buildRailUndirectedAdjacency,
  dijkstraShortestPath,
  undirectedComponents,
} from '../../src/mapV2/geo/railCorridorRouting';
import { deltaEncodeQuantized } from '../../src/mapV2/geo/roadRuntimePackage';
import { simplifyOpenPolyline } from '../../src/mapV2/geo/simplifyPolyline';
import { inflateProjectedLine, lineHasDatelineJump, quantizeProjectedPoint } from '../../src/mapV2/geo/transportGeometry';
import type {
  CountryCityTransportAccessPackageV1,
  GeoTransportEdgeRecord,
  GeoTransportNetworkPackageV1,
} from '../../src/mapV2/geo/transportNetwork';
import { haversineMeters } from '../../src/mapV2/geo/wgs84Distance';
import { geoCityIdForGameplayCity } from '../../src/mapV2/world/countryCityLoader';

export const MIN_CORRIDOR_LENGTH_METERS = 40_000;
export const MAX_CORRIDOR_LENGTH_METERS = 2_000_000;
export const OPTIONAL_MIN_CORRIDOR_LENGTH_METERS = 120_000;

const root = resolve(__dirname, '../..');
const sourcePath = resolve(root, 'src/mapV2/generated/transport/turkey-rail-network.json');
const accessPath = resolve(root, 'src/mapV2/generated/transport/turkey-city-access.json');
const qaPath = resolve(root, 'src/mapV2/generated/transport/turkey-rail-connectivity-qa.json');
const outDir = resolve(root, 'src/mapV2/generated/countryOverview');
const artifactPath = resolve(outDir, 'turkey-rail-corridors.json');
const lineagePath = resolve(outDir, 'turkey-rail-corridors.lineage.json');
const reportPath = resolve(outDir, 'turkey-rail-corridors.report.json');

type QaAccessRow = {
  legacyCityId: string;
  candidateNodeId?: string | null;
  candidateKind?: string | null;
  distanceHint?: string;
  attributes?: { stationName?: string | null } | null;
};

type QaPackage = {
  cityAccessAudit: QaAccessRow[];
};

type AccessMeta = {
  legacyCityId: string;
  geoCityId: string;
  nodeId: string | null;
  status: 'PROVISIONAL' | 'UNRESOLVED';
  accessName: string | null;
  accessKind: string | null;
  componentId: string | null;
  componentSize: number | null;
  distanceMeters: number | null;
  notes: string;
};

function hashCanonical(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function nearEq(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12;
}

function joinRoutePolyline(
  edgeIds: readonly string[],
  nodeIds: readonly string[],
  edgeById: Map<string, GeoTransportEdgeRecord>,
  quantize: number,
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
    const poly = inflateProjectedLine(edge.geometry.projectedQuantized, quantize);
    if (poly.length < 2) return { points: [], ok: false, reason: 'short-edge-geometry' };
    const ordered = reverse ? [...poly].reverse() : poly;
    for (const point of ordered) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return { points: [], ok: false, reason: 'non-finite' };
      }
      if (points.length && nearEq(points[points.length - 1], point)) continue;
      if (points.length >= 2) {
        const prev = points[points.length - 1];
        if (prev.x === point.x && prev.y === point.y) continue;
      }
      points.push(point);
    }
  }
  return { points, ok: points.length >= 2 };
}

function parseDistanceHint(hint: string | undefined): number | null {
  if (!hint) return null;
  const match = hint.match(/(\d+)\s*m\b/);
  return match ? Number(match[1]) : null;
}

export async function buildTurkeyRailCorridorsFromDisk(): Promise<{
  artifact: PlayerFacingRailCorridorArtifactV1;
  report: Record<string, unknown>;
  bytes: number;
}> {
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing canonical RAIL package: ${sourcePath}`);
  }
  const pkg = JSON.parse(readFileSync(sourcePath, 'utf8')) as GeoTransportNetworkPackageV1;
  if (pkg.contentHash !== EXPECTED_RAIL_SOURCE_PACKAGE_HASH) {
    throw new Error(`Unexpected RAIL contentHash ${pkg.contentHash}`);
  }
  const accessPkg = JSON.parse(readFileSync(accessPath, 'utf8')) as CountryCityTransportAccessPackageV1;
  const qa = existsSync(qaPath) ? (JSON.parse(readFileSync(qaPath, 'utf8')) as QaPackage) : null;
  const nodeById = new Map(pkg.nodes.map((node) => [node.nodeId, node]));
  const edgeById = new Map(pkg.edges.map((edge) => [edge.edgeId, edge]));
  const components = undirectedComponents(pkg.nodes, pkg.edges);
  let giantComponentId = '';
  let giantSize = 0;
  for (const [id, size] of components.sizeByComponent) {
    if (size > giantSize) {
      giantSize = size;
      giantComponentId = id;
    }
  }

  const accessByLegacy = new Map<string, AccessMeta>();
  for (const legacyCityId of [...PLAYER_RAIL_ELIGIBLE_LEGACY_CITY_IDS, ...PLAYER_RAIL_UNRESOLVED_LEGACY_CITY_IDS]) {
    const geoCityId = geoCityIdForGameplayCity(legacyCityId);
    const stored = geoCityId
      ? accessPkg.accesses.find((row) => row.geoCityId === geoCityId && row.mode === 'RAIL')
      : undefined;
    const qaRow = qa?.cityAccessAudit.find((row) => row.legacyCityId === legacyCityId);
    const nodeId = stored?.accessNodeIds[0] ?? qaRow?.candidateNodeId ?? null;
    const componentId = nodeId ? components.componentOf.get(nodeId) ?? null : null;
    accessByLegacy.set(legacyCityId, {
      legacyCityId,
      geoCityId: geoCityId ?? '',
      nodeId: stored?.status === 'PROVISIONAL' ? nodeId : null,
      status: stored?.status === 'PROVISIONAL' && nodeId ? 'PROVISIONAL' : 'UNRESOLVED',
      accessName: qaRow?.attributes && 'stationName' in qaRow.attributes ? String(qaRow.attributes.stationName ?? '') || null : null,
      accessKind: qaRow?.candidateKind ?? null,
      componentId,
      componentSize: componentId ? components.sizeByComponent.get(componentId) ?? null : null,
      distanceMeters: parseDistanceHint(stored?.notes ?? qaRow?.distanceHint),
      notes: stored?.notes ?? qaRow?.distanceHint ?? 'No RAIL access',
    });
  }

  const adjacency = buildRailUndirectedAdjacency(pkg.edges);
  const compact: CompactPlayerRailCorridor[] = [];
  const unresolved: UnresolvedRailCorridorCandidate[] = [];
  const lineage: Record<
    string,
    { sourceEdgeIds: string[]; sourceNodeIds: string[]; rawVertexCount: number; simplifiedVertexCount: number }
  > = {};
  const reports: Record<string, unknown>[] = [];

  PLAYER_FACING_RAIL_CORRIDOR_CANDIDATES.forEach((pair, index) => {
    const fromAccess = accessByLegacy.get(pair.fromLegacyCityId);
    const toAccess = accessByLegacy.get(pair.toLegacyCityId);
    const fromNode = fromAccess?.nodeId ?? null;
    const toNode = toAccess?.nodeId ?? null;
    const fromGeo = fromAccess?.geoCityId || geoCityIdForGameplayCity(pair.fromLegacyCityId);
    const toGeo = toAccess?.geoCityId || geoCityIdForGameplayCity(pair.toLegacyCityId);
    const fail = (reason: string) => {
      if (pair.optional) {
        unresolved.push({
          fromLegacyCityId: pair.fromLegacyCityId,
          toLegacyCityId: pair.toLegacyCityId,
          reason: `optional:${reason}`,
        });
        return;
      }
      unresolved.push({
        fromLegacyCityId: pair.fromLegacyCityId,
        toLegacyCityId: pair.toLegacyCityId,
        reason,
      });
    };
    if (!fromNode || !toNode || !fromGeo || !toGeo || fromAccess?.status !== 'PROVISIONAL' || toAccess?.status !== 'PROVISIONAL') {
      fail('missing-access');
      return;
    }
    if (fromNode === toNode) {
      fail('same-node');
      return;
    }
    const fromComp = components.componentOf.get(fromNode);
    const toComp = components.componentOf.get(toNode);
    if (fromComp !== toComp) {
      fail(`different-components:${fromComp}:${toComp}`);
      return;
    }
    const routed = dijkstraShortestPath(adjacency, fromNode, toNode);
    if (!routed || routed.edgeIds.length === 0) {
      fail('no-path');
      return;
    }
    const minLen = pair.optional ? OPTIONAL_MIN_CORRIDOR_LENGTH_METERS : MIN_CORRIDOR_LENGTH_METERS;
    if (routed.lengthMeters < minLen || routed.lengthMeters > MAX_CORRIDOR_LENGTH_METERS) {
      fail(`length:${Math.round(routed.lengthMeters)}`);
      return;
    }
    if (routed.nodeIds[0] !== fromNode || routed.nodeIds[routed.nodeIds.length - 1] !== toNode) {
      fail('endpoint-mismatch');
      return;
    }
    for (const edgeId of routed.edgeIds) {
      if (!edgeById.has(edgeId)) {
        fail('synthetic-or-missing-edge');
        return;
      }
    }
    const joined = joinRoutePolyline(routed.edgeIds, routed.nodeIds, edgeById, pkg.transformation.quantize);
    if (!joined.ok) {
      fail(joined.reason ?? 'join-failed');
      return;
    }
    if (lineHasDatelineJump(joined.points)) {
      fail('dateline');
      return;
    }
    const simplified = simplifyOpenPolyline(joined.points, PLAYER_RAIL_CORRIDOR_SIMPLIFY_TOLERANCE);
    if (simplified.length < 2) {
      fail('simplify-empty');
      return;
    }
    const swapped = pair.fromLegacyCityId > pair.toLegacyCityId;
    const oriented = swapped ? [...simplified].reverse() : simplified;
    const quantized: number[] = [];
    for (const point of oriented) {
      if (point.x < 0.5 || point.x > 0.7 || point.y < 0.3 || point.y > 0.45) {
        fail('out-of-turkey-scope');
        return;
      }
      const [qx, qy] = quantizeProjectedPoint(point, PLAYER_RAIL_CORRIDOR_QUANTIZE);
      quantized.push(qx, qy);
    }
    const id = railCorridorIdForPair(pair.fromLegacyCityId, pair.toLegacyCityId);
    const [left, right] = swapped
      ? [pair.toLegacyCityId, pair.fromLegacyCityId]
      : [pair.fromLegacyCityId, pair.toLegacyCityId];
    const leftAccess = swapped ? toAccess : fromAccess;
    const rightAccess = swapped ? fromAccess : toAccess;
    const leftNode = swapped ? toNode : fromNode;
    const rightNode = swapped ? fromNode : toNode;
    const sourceEdgeIds = swapped ? [...routed.edgeIds].reverse() : routed.edgeIds;
    const sourceNodeIds = swapped ? [...routed.nodeIds].reverse() : routed.nodeIds;
    const fromCoord = nodeById.get(fromNode)?.coordinate;
    const toCoord = nodeById.get(toNode)?.coordinate;
    const greatCircle =
      fromCoord && toCoord ? haversineMeters(fromCoord, toCoord) : null;
    const qaFlag =
      greatCircle && routed.lengthMeters > greatCircle * 4.5
        ? 'QA_LENGTH_VS_GREAT_CIRCLE'
        : null;
    compact.push({
      id,
      fromLegacyCityId: left,
      toLegacyCityId: right,
      fromGeoCityId: leftAccess.geoCityId,
      toGeoCityId: rightAccess.geoCityId,
      fromRailAccessId: leftNode,
      toRailAccessId: rightNode,
      accessStatusFrom: leftAccess.status,
      accessStatusTo: rightAccess.status,
      fromAccessName: leftAccess.accessName,
      toAccessName: rightAccess.accessName,
      fromAccessKind: leftAccess.accessKind,
      toAccessKind: rightAccess.accessKind,
      fromComponentId: leftAccess.componentId,
      toComponentId: rightAccess.componentId,
      status: 'PROVISIONAL_SOURCE_PATH',
      displayPriority: index,
      sourceEdgeCount: routed.edgeIds.length,
      sourceRouteLengthMeters: Math.round(routed.lengthMeters),
      sourceEdgeIdsHash: hashCanonical(sourceEdgeIds),
      q: deltaEncodeQuantized(quantized),
    });
    lineage[id] = {
      sourceEdgeIds,
      sourceNodeIds,
      rawVertexCount: joined.points.length,
      simplifiedVertexCount: simplified.length,
    };
    reports.push({
      id,
      fromLegacyCityId: pair.fromLegacyCityId,
      toLegacyCityId: pair.toLegacyCityId,
      fromAccess: {
        name: fromAccess.accessName,
        nodeId: fromNode,
        status: fromAccess.status,
        kind: fromAccess.accessKind,
        componentId: fromComp,
        distanceMeters: fromAccess.distanceMeters,
      },
      toAccess: {
        name: toAccess.accessName,
        nodeId: toNode,
        status: toAccess.status,
        kind: toAccess.accessKind,
        componentId: toComp,
        distanceMeters: toAccess.distanceMeters,
      },
      componentId: fromComp,
      sourceEdgeCount: routed.edgeIds.length,
      rawVertexCount: joined.points.length,
      simplifiedVertexCount: simplified.length,
      sourceRouteLengthMeters: Math.round(routed.lengthMeters),
      status: 'PROVISIONAL_SOURCE_PATH',
      qaFlag,
      optional: Boolean(pair.optional),
    });
  });

  compact.sort((a, b) => a.id.localeCompare(b.id));
  const body = {
    schemaVersion: PLAYER_RAIL_CORRIDOR_SCHEMA_VERSION,
    countryId: 'country.tur' as const,
    mode: 'RAIL' as const,
    sourceRailPackageHash: pkg.contentHash,
    corridorPolicyVersion: PLAYER_RAIL_CORRIDOR_POLICY_VERSION,
    routeAlgorithmVersion: RAIL_CORRIDOR_ROUTE_ALGORITHM_VERSION,
    routeCostPolicyVersion: RAIL_CORRIDOR_COST_POLICY_VERSION,
    simplificationVersion: PLAYER_RAIL_CORRIDOR_SIMPLIFY_VERSION,
    quantization: PLAYER_RAIL_CORRIDOR_QUANTIZE,
    corridors: compact,
    unresolved,
  };
  const artifact: PlayerFacingRailCorridorArtifactV1 = {
    ...body,
    contentHash: hashCanonical(body),
  };

  const report = {
    sourceRailPackageHash: pkg.contentHash,
    routeAlgorithmVersion: RAIL_CORRIDOR_ROUTE_ALGORITHM_VERSION,
    routeCostPolicyVersion: RAIL_CORRIDOR_COST_POLICY_VERSION,
    giantComponentId,
    giantComponentSize: giantSize,
    eligibleCities: [...PLAYER_RAIL_ELIGIBLE_LEGACY_CITY_IDS],
    unresolvedCities: [...PLAYER_RAIL_UNRESOLVED_LEGACY_CITY_IDS],
    access: [...accessByLegacy.values()],
    resolved: reports,
    unresolved,
    notes: [
      'Adana gameplay city stays Adana; rail access is Yenice. No synthetic Yenice→Adana connector.',
      'TCDD is QA/reference only. Geometry is OSM source-backed.',
      'UNRESOLVED cities are not force-connected.',
    ],
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact)}\n`);
  writeFileSync(lineagePath, `${JSON.stringify({ sourceRailPackageHash: pkg.contentHash, corridors: lineage })}\n`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { artifact, report, bytes: statSync(artifactPath).size };
}

if (process.argv[1] && process.argv[1].endsWith('build-turkey-rail-corridors.ts')) {
  buildTurkeyRailCorridorsFromDisk()
    .then((result) => {
      console.log(
        JSON.stringify(
          {
            bytes: result.bytes,
            contentHash: result.artifact.contentHash,
            resolved: result.artifact.corridors.length,
            unresolved: result.artifact.unresolved.length,
            ids: result.artifact.corridors.map((row) => row.id),
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
