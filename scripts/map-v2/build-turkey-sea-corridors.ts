/**
 * Offline player SEA corridor extraction.
 * Run: npx tsx scripts/map-v2/build-turkey-sea-corridors.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import type { TurkeyPortPackageV1 } from '../../src/mapV2/geo/geoPort';
import {
  EXPECTED_SEA_SOURCE_PACKAGE_HASH,
  PLAYER_FACING_SEA_CORRIDOR_CANDIDATES,
  PLAYER_SEA_CORRIDOR_POLICY_VERSION,
  PLAYER_SEA_CORRIDOR_QUANTIZE,
  PLAYER_SEA_CORRIDOR_SCHEMA_VERSION,
  PLAYER_SEA_CORRIDOR_SIMPLIFY_TOLERANCE,
  PLAYER_SEA_CORRIDOR_SIMPLIFY_VERSION,
  PLAYER_SEA_ELIGIBLE_LEGACY_CITY_IDS,
  PLAYER_SEA_NON_SEA_LEGACY_CITY_IDS,
  seaCorridorIdForPair,
  type CompactPlayerSeaCorridor,
  type PlayerFacingSeaAssociationType,
  type PlayerFacingSeaCorridorArtifactV1,
  type UnresolvedSeaCorridorCandidate,
} from '../../src/mapV2/geo/playerFacingSeaCorridor';
import {
  SEA_CORRIDOR_COST_POLICY_VERSION,
  SEA_CORRIDOR_ROUTE_ALGORITHM_VERSION,
  buildSeaUndirectedAdjacency,
  channelsUsedFromTraversedPath,
  dijkstraShortestPath,
  regionsFromPath,
} from '../../src/mapV2/geo/seaCorridorRouting';
import {
  classifyMaritimeChannel,
  isNavigableWater,
  segmentHitsLand,
  type MaritimeNavigabilityQuery,
} from '../../src/mapV2/geo/maritimeNavigability';
import { haversineMeters } from '../../src/mapV2/geo/wgs84Distance';
import { unprojectNormalizedMercatorToWgs84 } from '../../src/mapV2/geo/webMercator';
import { deltaEncodeQuantized } from '../../src/mapV2/geo/roadRuntimePackage';
import { simplifyOpenPolylineProtected } from '../../src/mapV2/geo/simplifyPolyline';
import { inflateProjectedLine, lineHasDatelineJump, quantizeProjectedPoint } from '../../src/mapV2/geo/transportGeometry';
import type { GeoTransportEdgeRecord, GeoTransportNetworkPackageV1, GeoTransportNodeRecord } from '../../src/mapV2/geo/transportNetwork';
import { undirectedComponents } from '../../src/mapV2/geo/roadCorridorRouting';
import { geoCityIdForGameplayCity } from '../../src/mapV2/world/countryCityLoader';
import { loadMaritimeLandMask } from './maritime-land-mask';
import { hashCanonical } from './transport-package-factory';

export const MIN_CORRIDOR_LENGTH_METERS = 80_000;
export const MAX_CORRIDOR_LENGTH_METERS = 2_200_000;
export const OPTIONAL_MIN_CORRIDOR_LENGTH_METERS = 80_000;
export const SALIPAZARI_MARMARA_REHOME_MAX_METERS = 12_000;

const root = resolve(__dirname, '../..');
const sourcePath = resolve(root, 'src/mapV2/generated/transport/turkey-sea-network.json');
const portsPath = resolve(root, 'src/mapV2/generated/infrastructure/turkey-ports.json');
const outDir = resolve(root, 'src/mapV2/generated/countryOverview');
const artifactPath = resolve(outDir, 'turkey-sea-corridors.json');
const lineagePath = resolve(outDir, 'turkey-sea-corridors.lineage.json');
const reportPath = resolve(outDir, 'turkey-sea-corridors.report.json');

function nearEq(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12;
}

function joinRoutePolyline(
  edgeIds: readonly string[],
  nodeIds: readonly string[],
  edgeById: Map<string, GeoTransportEdgeRecord>,
  quantize: number,
): { points: { x: number; y: number }[]; protectedIndices: Set<number>; ok: boolean; reason?: string } {
  const points: { x: number; y: number }[] = [];
  const protectedIndices = new Set<number>();
  for (let i = 0; i < edgeIds.length; i += 1) {
    const edge = edgeById.get(edgeIds[i]);
    if (!edge) return { points: [], protectedIndices, ok: false, reason: 'missing-edge' };
    const from = nodeIds[i];
    const to = nodeIds[i + 1];
    const reverse = edge.fromNodeId === to && edge.toNodeId === from;
    const forward = edge.fromNodeId === from && edge.toNodeId === to;
    if (!forward && !reverse) return { points: [], protectedIndices, ok: false, reason: 'edge-not-incident' };
    const poly = inflateProjectedLine(edge.geometry.projectedQuantized, quantize);
    if (poly.length < 2) return { points: [], protectedIndices, ok: false, reason: 'short-edge-geometry' };
    const ordered = reverse ? [...poly].reverse() : poly;
    const channel = edge.attributes.channel === 'BOSPHORUS' || edge.attributes.channel === 'DARDANELLES';
    for (const point of ordered) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return { points: [], protectedIndices, ok: false, reason: 'non-finite' };
      }
      if (points.length && nearEq(points[points.length - 1], point)) {
        if (channel) protectedIndices.add(points.length - 1);
        continue;
      }
      points.push(point);
      if (channel) protectedIndices.add(points.length - 1);
    }
  }
  return { points, protectedIndices, ok: points.length >= 2 };
}

function polylineHitsLand(points: { x: number; y: number }[], query: MaritimeNavigabilityQuery): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const a = unprojectNormalizedMercatorToWgs84(points[i - 1].x, points[i - 1].y);
    const b = unprojectNormalizedMercatorToWgs84(points[i].x, points[i].y);
    if (segmentHitsLand(a, b, query, 700)) return true;
  }
  return false;
}

function findNonChannelMarmaraAccess(
  current: GeoTransportNodeRecord,
  nodes: readonly GeoTransportNodeRecord[],
  query: MaritimeNavigabilityQuery,
): { node: GeoTransportNodeRecord; meters: number } | null {
  if (current.sourceMetadata?.channel !== 'BOSPHORUS') return null;
  let best: { node: GeoTransportNodeRecord; meters: number } | null = null;
  for (const node of nodes) {
    if (node.sourceMetadata?.region !== 'MARMARA') continue;
    if (node.sourceMetadata?.channel) continue;
    const kind = node.sourceMetadata?.grid;
    if (kind !== 'COARSE' && kind !== 'APPROACH' && kind !== 'LOCAL') continue;
    if (classifyMaritimeChannel(node.coordinate.longitude, node.coordinate.latitude) != null) continue;
    const meters = haversineMeters(current.coordinate, node.coordinate);
    if (meters <= 0 || meters > SALIPAZARI_MARMARA_REHOME_MAX_METERS) continue;
    if (!isNavigableWater(node.coordinate.longitude, node.coordinate.latitude, query)) continue;
    if (segmentHitsLand(current.coordinate, node.coordinate, query, 400)) continue;
    if (!best || meters < best.meters) best = { node, meters };
  }
  return best;
}

export async function buildTurkeySeaCorridorsFromDisk(): Promise<{
  artifact: PlayerFacingSeaCorridorArtifactV1;
  report: Record<string, unknown>;
  bytes: number;
}> {
  if (!existsSync(sourcePath)) throw new Error(`Missing canonical SEA package: ${sourcePath}`);
  if (!existsSync(portsPath)) throw new Error(`Missing ports package: ${portsPath}`);
  const pkg = JSON.parse(readFileSync(sourcePath, 'utf8')) as GeoTransportNetworkPackageV1;
  if (pkg.contentHash !== EXPECTED_SEA_SOURCE_PACKAGE_HASH) {
    throw new Error(`Unexpected SEA contentHash ${pkg.contentHash}`);
  }
  const ports = JSON.parse(readFileSync(portsPath, 'utf8')) as TurkeyPortPackageV1;
  const mask = loadMaritimeLandMask(root);
  const query: MaritimeNavigabilityQuery = { neLand: mask.neLand, osmMarine: mask.osmMarine };
  const nodeById = new Map(pkg.nodes.map((node) => [node.nodeId, node]));
  const edgeById = new Map(pkg.edges.map((edge) => [edge.edgeId, edge]));
  const components = undirectedComponents(pkg.nodes, pkg.edges);

  const istanbulAssoc = ports.cityAssociations.find((row) => row.gameplayCityId === 'istanbul');
  const istanbulPort = ports.ports.find((port) => port.id === istanbulAssoc?.primaryPortCandidateId);
  const currentAccessId = istanbulPort?.seaAccess.graphNodeId ?? null;
  const currentAccessNode = currentAccessId ? nodeById.get(currentAccessId) : null;
  const rehome = currentAccessNode ? findNonChannelMarmaraAccess(currentAccessNode, pkg.nodes, query) : null;
  let portsHash = ports.contentHash;
  const salipazariPreflight = {
    diagnosis: rehome
      ? 'B'
      : currentAccessNode?.sourceMetadata?.channel === 'BOSPHORUS'
        ? 'A'
        : 'ok',
    previousNodeId: currentAccessId,
    previousChannel: currentAccessNode?.sourceMetadata?.channel ?? null,
    previousRegion: currentAccessNode?.sourceMetadata?.region ?? istanbulPort?.seaAccess.maritimeRegion ?? null,
    replacementNodeId: rehome?.node.nodeId ?? null,
    replacementMeters: rehome?.meters ?? null,
    replacementKind: rehome?.node.sourceMetadata?.grid ?? null,
    note:
      rehome
        ? 'Preferred existing non-channel MARMARA node; GeoPort geometry unchanged.'
        : currentAccessNode?.sourceMetadata?.channel === 'BOSPHORUS'
          ? 'Access remains geographically in Bosphorus window; channel use is classified from traversed strait span, not endpoint metadata.'
          : 'Access node is already MARMARA without BOSPHORUS channel identity.',
  };
  if (rehome && istanbulPort) {
    istanbulPort.seaAccess.graphNodeId = rehome.node.nodeId;
    istanbulPort.seaAccess.position = rehome.node.coordinate;
    istanbulPort.seaAccess.projected = rehome.node.projected;
    istanbulPort.seaAccess.maritimeRegion = 'MARMARA';
    istanbulPort.seaAccess.approachKind =
      rehome.node.sourceMetadata?.grid === 'LOCAL' || rehome.node.sourceMetadata?.grid === 'PORT_ACCESS' ? 'LOCAL' : 'TRUNK';
    istanbulPort.seaAccess.evidence = `${istanbulPort.seaAccess.evidence} Pre-flight: Marmara non-channel access ${rehome.node.nodeId} (${Math.round(rehome.meters)}m). GeoPort unmoved.`;
    const portBody = { ...ports };
    delete (portBody as { contentHash?: string }).contentHash;
    const sealed = { ...portBody, contentHash: hashCanonical(portBody) } as TurkeyPortPackageV1;
    writeFileSync(portsPath, `${JSON.stringify(sealed)}\n`);
    portsHash = sealed.contentHash;
  }

  type AccessMeta = {
    legacyCityId: string;
    geoCityId: string;
    portId: string | null;
    nodeId: string | null;
    status: 'PROVISIONAL' | 'UNRESOLVED';
    association: PlayerFacingSeaAssociationType;
    portName: string | null;
    coordinate: { longitude: number; latitude: number } | null;
  };
  const accessByLegacy = new Map<string, AccessMeta>();
  for (const legacyCityId of [...PLAYER_SEA_ELIGIBLE_LEGACY_CITY_IDS, ...PLAYER_SEA_NON_SEA_LEGACY_CITY_IDS]) {
    const assoc = ports.cityAssociations.find((row) => row.gameplayCityId === legacyCityId);
    const port = assoc?.primaryPortCandidateId
      ? ports.ports.find((item) => item.id === assoc.primaryPortCandidateId)
      : undefined;
    const nodeId = port?.seaAccess.status === 'PROVISIONAL' ? port.seaAccess.graphNodeId : null;
    accessByLegacy.set(legacyCityId, {
      legacyCityId,
      geoCityId: assoc?.geoCityId || geoCityIdForGameplayCity(legacyCityId) || '',
      portId: port?.id ?? null,
      nodeId,
      status: port?.seaAccess.status === 'PROVISIONAL' && nodeId ? 'PROVISIONAL' : 'UNRESOLVED',
      association: (assoc?.associationType ?? 'NONE') as PlayerFacingSeaAssociationType,
      portName: port?.displayName ?? null,
      coordinate: nodeId ? nodeById.get(nodeId)?.coordinate ?? port?.seaAccess.position ?? null : null,
    });
  }

  const compact: CompactPlayerSeaCorridor[] = [];
  const unresolved: UnresolvedSeaCorridorCandidate[] = [];
  const lineage: Record<
    string,
    { sourceEdgeIds: string[]; sourceNodeIds: string[]; rawVertexCount: number; simplifiedVertexCount: number }
  > = {};
  const reports: Record<string, unknown>[] = [];

  PLAYER_FACING_SEA_CORRIDOR_CANDIDATES.forEach((pair, index) => {
    const fromAccess = accessByLegacy.get(pair.fromLegacyCityId);
    const toAccess = accessByLegacy.get(pair.toLegacyCityId);
    const fail = (reason: string) => {
      unresolved.push({
        fromLegacyCityId: pair.fromLegacyCityId,
        toLegacyCityId: pair.toLegacyCityId,
        reason: pair.optional ? `optional:${reason}` : reason,
      });
    };
    if (
      !fromAccess?.nodeId ||
      !toAccess?.nodeId ||
      !fromAccess.portId ||
      !toAccess.portId ||
      fromAccess.status !== 'PROVISIONAL' ||
      toAccess.status !== 'PROVISIONAL'
    ) {
      fail('missing-access');
      return;
    }
    if (PLAYER_SEA_NON_SEA_LEGACY_CITY_IDS.some((id) => id === pair.fromLegacyCityId || id === pair.toLegacyCityId)) {
      fail('inland-city');
      return;
    }
    if (fromAccess.nodeId === toAccess.nodeId) {
      fail('same-node');
      return;
    }
    const fromComp = components.componentOf.get(fromAccess.nodeId);
    const toComp = components.componentOf.get(toAccess.nodeId);
    if (fromComp !== toComp) {
      fail(`different-components:${fromComp}:${toComp}`);
      return;
    }
    const fromCoord = fromAccess.coordinate ?? { longitude: 0, latitude: 0 };
    const toCoord = toAccess.coordinate ?? { longitude: 0, latitude: 0 };
    const adjacency = buildSeaUndirectedAdjacency(pkg.edges, nodeById, fromCoord, toCoord);
    const routed = dijkstraShortestPath(adjacency, fromAccess.nodeId, toAccess.nodeId);
    if (!routed || routed.edgeIds.length === 0) {
      fail('no-path');
      return;
    }
    const minLen = pair.optional ? OPTIONAL_MIN_CORRIDOR_LENGTH_METERS : MIN_CORRIDOR_LENGTH_METERS;
    if (routed.lengthMeters < minLen || routed.lengthMeters > MAX_CORRIDOR_LENGTH_METERS) {
      fail(`length:${Math.round(routed.lengthMeters)}`);
      return;
    }
    const channels = channelsUsedFromTraversedPath(routed.nodeIds, routed.edgeIds, nodeById, edgeById);
    const missing = pair.requiredChannels.filter((ch) => !channels.includes(ch));
    if (missing.length) {
      fail(`missing-channel:${missing.join(',')}`);
      return;
    }
    const forbidden = (pair.forbiddenChannels ?? []).filter((ch) => channels.includes(ch));
    if (forbidden.length) {
      fail(`forbidden-channel:${forbidden.join(',')}`);
      return;
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
    const keepIndices = new Set(joined.protectedIndices);
    let simplified = simplifyOpenPolylineProtected(joined.points, PLAYER_SEA_CORRIDOR_SIMPLIFY_TOLERANCE, keepIndices);
    let landValidation = 'PASS';
    if (polylineHitsLand(simplified, query)) {
      for (let i = 0; i < joined.points.length; i += 6) keepIndices.add(i);
      simplified = simplifyOpenPolylineProtected(joined.points, PLAYER_SEA_CORRIDOR_SIMPLIFY_TOLERANCE / 2, keepIndices);
    }
    if (polylineHitsLand(simplified, query)) {
      simplified = joined.points;
      landValidation = 'GRAPH_EDGE_FALLBACK';
    }
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
      const [qx, qy] = quantizeProjectedPoint(point, PLAYER_SEA_CORRIDOR_QUANTIZE);
      quantized.push(qx, qy);
    }
    const id = seaCorridorIdForPair(pair.fromLegacyCityId, pair.toLegacyCityId);
    const leftAccess = swapped ? toAccess : fromAccess;
    const rightAccess = swapped ? fromAccess : toAccess;
    const sourceEdgeIds = swapped ? [...routed.edgeIds].reverse() : routed.edgeIds;
    const sourceNodeIds = swapped ? [...routed.nodeIds].reverse() : routed.nodeIds;
    compact.push({
      id,
      fromLegacyCityId: swapped ? pair.toLegacyCityId : pair.fromLegacyCityId,
      toLegacyCityId: swapped ? pair.fromLegacyCityId : pair.toLegacyCityId,
      fromGeoCityId: leftAccess.geoCityId,
      toGeoCityId: rightAccess.geoCityId,
      fromPortId: leftAccess.portId!,
      toPortId: rightAccess.portId!,
      fromSeaAccessId: leftAccess.nodeId!,
      toSeaAccessId: rightAccess.nodeId!,
      portAssociationFrom: leftAccess.association,
      portAssociationTo: rightAccess.association,
      accessStatusFrom: leftAccess.status,
      accessStatusTo: rightAccess.status,
      fromPortName: leftAccess.portName,
      toPortName: rightAccess.portName,
      maritimeRegions: regionsFromPath(sourceNodeIds, nodeById),
      channelsUsed: channelsUsedFromTraversedPath(sourceNodeIds, sourceEdgeIds, nodeById, edgeById),
      status: 'PROVISIONAL_SOURCE_PATH',
      displayPriority: index,
      sourceEdgeCount: routed.edgeIds.length,
      sourceNodeCount: routed.nodeIds.length,
      sourceRouteLengthMeters: Math.round(routed.lengthMeters),
      sourceEdgeIdsHash: `sha256:${createHash('sha256').update(JSON.stringify(sourceEdgeIds)).digest('hex')}`,
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
      fromPort: fromAccess.portName,
      toPort: toAccess.portName,
      fromAccessNode: fromAccess.nodeId,
      toAccessNode: toAccess.nodeId,
      associationFrom: fromAccess.association,
      associationTo: toAccess.association,
      status: 'PROVISIONAL_SOURCE_PATH',
      rawEdgeCount: routed.edgeIds.length,
      rawNodeCount: routed.nodeIds.length,
      routeLengthMeters: Math.round(routed.lengthMeters),
      regions: regionsFromPath(routed.nodeIds, nodeById),
      channels,
      simplifiedVertices: simplified.length,
      landValidation,
    });
  });

  compact.sort((a, b) => a.id.localeCompare(b.id));
  const body: Omit<PlayerFacingSeaCorridorArtifactV1, 'contentHash'> = {
    schemaVersion: PLAYER_SEA_CORRIDOR_SCHEMA_VERSION,
    countryId: 'country.tur',
    mode: 'SEA',
    sourceSeaPackageHash: pkg.contentHash,
    sourcePortsArtifactHash: portsHash,
    corridorPolicyVersion: PLAYER_SEA_CORRIDOR_POLICY_VERSION,
    routeAlgorithmVersion: SEA_CORRIDOR_ROUTE_ALGORITHM_VERSION,
    routeCostPolicyVersion: SEA_CORRIDOR_COST_POLICY_VERSION,
    simplificationVersion: PLAYER_SEA_CORRIDOR_SIMPLIFY_VERSION,
    quantization: PLAYER_SEA_CORRIDOR_QUANTIZE,
    corridors: compact,
    unresolved,
  };
  const artifact: PlayerFacingSeaCorridorArtifactV1 = { ...body, contentHash: hashCanonical(body) };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact)}\n`);
  writeFileSync(lineagePath, `${JSON.stringify(lineage)}\n`);
  const report = {
    salipazariPreflight,
    eligibleCities: [...PLAYER_SEA_ELIGIBLE_LEGACY_CITY_IDS],
    nonSeaCities: [...PLAYER_SEA_NON_SEA_LEGACY_CITY_IDS],
    corridorCount: compact.length,
    unresolved,
    corridors: reports,
    bytes: statSync(artifactPath).size,
    contentHash: artifact.contentHash,
    sourceSeaPackageHash: pkg.contentHash,
    sourcePortsArtifactHash: portsHash,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { artifact, report, bytes: report.bytes };
}

if (process.argv[1] && process.argv[1].endsWith('build-turkey-sea-corridors.ts')) {
  buildTurkeySeaCorridorsFromDisk()
    .then((result) => {
      console.log(JSON.stringify({ bytes: result.bytes, corridors: result.artifact.corridors.length, unresolved: result.artifact.unresolved, hash: result.artifact.contentHash }, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
