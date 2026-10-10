/**
 * Offline ROAD first/last-mile access between gameplay city ROAD anchors
 * and multimodal transfer infrastructure. Never imported by production runtime.
 *
 * Run: node --max-old-space-size=8192 --import tsx scripts/map-v2/build-turkey-multimodal-road-access.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MULTIMODAL_ROAD_TRANSFER_ACCESS_ALGORITHM_ID,
  MULTIMODAL_ROAD_TRANSFER_ACCESS_PACKAGE_ID,
  MULTIMODAL_ROAD_TRANSFER_ACCESS_SCHEMA_VERSION,
  ROAD_ACCESS_ENDPOINT_CANDIDATE_LIMIT,
  ROAD_ACCESS_MAX_DIRECT_DETOUR_RATIO,
  ROAD_ACCESS_MAX_DIRECT_ROUTE_METERS,
  ROAD_ACCESS_MAX_REGIONAL_ROUTE_METERS,
  ROAD_ACCESS_ROUTING_DIRECTIONALITY,
  ROAD_INFRA_ATTACHED_EXACT_METERS,
  ROAD_INFRA_NEAR_ROAD_METERS,
  ROAD_INFRA_SNAP_DISCONNECTED_PRECINCT_METERS,
  ROAD_INFRA_SNAP_MAX_METERS,
  SOURCE_BACKED_ROAD_TRANSFER_ACCESS,
  roadTransferAccessLogicalKey,
  type MultimodalRoadTransferAccessArtifactV1,
  type MultimodalRoadTransferAccessRecord,
  type MultimodalRoadTransferMode,
  type RoadCityAssociationType,
} from '../../src/domain/multimodalRoadAccess';
import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../../src/mapV2/domain/ids';
import { buildTurkeyMultimodalFoundation } from '../../src/mapV2/gameplay/multimodalFoundation';
import { EXPECTED_ROAD_SOURCE_PACKAGE_HASH } from '../../src/mapV2/geo/playerFacingRoadCorridor';
import { resolveProvisionalAccess } from './build-turkey-road-corridors';
import {
  buildUndirectedAdjacency,
  dijkstraShortestPath,
  undirectedComponents,
} from '../../src/mapV2/geo/roadCorridorRouting';
import { ROAD_SOURCE_PACKAGE_HASH_2E } from '../../src/mapV2/geo/roadRuntimePackage';
import type {
  CountryCityTransportAccessPackageV1,
  GeoTransportEdgeRecord,
  GeoTransportNetworkPackageV1,
  GeoTransportNodeRecord,
} from '../../src/mapV2/geo/transportNetwork';
import { haversineMeters } from '../../src/mapV2/geo/wgs84Distance';
import type { GeoCoordinateWgs84 } from '../../src/mapV2/geo/webMercator';
import { getTurkeyAirportPackage } from '../../src/mapV2/world/countryAirportLoader';
import { getTurkeyCityPackage, geoCityIdForGameplayCity } from '../../src/mapV2/world/countryCityLoader';
import { getTurkeyPortPackage } from '../../src/mapV2/world/countryPortLoader';
import { getCityTransportAccessPackage } from '../../src/mapV2/world/transportNetworkLoader';

export const MIN_USABLE_ROAD_COMPONENT_SIZE = 500;

const root = resolve(__dirname, '../..');
const sourcePath = resolve(root, 'src/mapV2/generated/transport/turkey-road-network.json');
const accessPath = resolve(root, 'src/mapV2/generated/transport/turkey-city-access.json');
const outDir = resolve(root, 'src/mapV2/generated/multimodal');
const artifactPath = resolve(outDir, 'turkey-road-transfer-access.json');
const reportPath = resolve(outDir, 'turkey-road-transfer-access.report.json');

function hashCanonical(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function parseTopologyCoordFromNodeId(nodeId: string): GeoCoordinateWgs84 | null {
  const prefixes = ['tn.tur.road.n.', 'tn.tur.rail.n.'];
  const prefix = prefixes.find((row) => nodeId.startsWith(row));
  if (!prefix) return null;
  const key = nodeId.slice(prefix.length);
  const match = key.match(/^(-?\d+\.\d+)_(-?\d+\.\d+)$/);
  if (!match) return null;
  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
}

function nodeCoord(node: GeoTransportNodeRecord): GeoCoordinateWgs84 | null {
  if (node.coordinate && Number.isFinite(node.coordinate.longitude) && Number.isFinite(node.coordinate.latitude)) {
    return node.coordinate;
  }
  return parseTopologyCoordFromNodeId(node.nodeId);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function snapEvidence(
  distanceMeters: number,
): 'ATTACHED_EXACT' | 'PROVISIONAL_NEAR_ROAD' | 'PROVISIONAL_BOUNDED_SNAP' {
  if (distanceMeters <= ROAD_INFRA_ATTACHED_EXACT_METERS) return 'ATTACHED_EXACT';
  if (distanceMeters <= ROAD_INFRA_NEAR_ROAD_METERS) return 'PROVISIONAL_NEAR_ROAD';
  return 'PROVISIONAL_BOUNDED_SNAP';
}

type SnapCandidate = {
  nodeId: string;
  distanceMeters: number;
};

function nearestAnyRoad(
  target: GeoCoordinateWgs84,
  nodes: readonly { nodeId: string; coord: GeoCoordinateWgs84 }[],
  maxMeters: number,
): SnapCandidate | null {
  const hits = gatherSnapCandidates(target, nodes, maxMeters);
  return hits[0] ?? null;
}

function gatherSnapCandidates(
  target: GeoCoordinateWgs84,
  nodes: readonly { nodeId: string; coord: GeoCoordinateWgs84 }[],
  maxMeters: number,
): SnapCandidate[] {
  const lonPad = maxMeters / 90_000 + 0.02;
  const latPad = maxMeters / 111_000 + 0.02;
  const hits: SnapCandidate[] = [];
  for (const node of nodes) {
    if (Math.abs(node.coord.longitude - target.longitude) > lonPad) continue;
    if (Math.abs(node.coord.latitude - target.latitude) > latPad) continue;
    const distanceMeters = haversineMeters(target, node.coord);
    if (!Number.isFinite(distanceMeters) || distanceMeters > maxMeters) continue;
    hits.push({ nodeId: node.nodeId, distanceMeters });
  }
  hits.sort((a, b) => a.distanceMeters - b.distanceMeters || a.nodeId.localeCompare(b.nodeId));
  return hits.slice(0, ROAD_ACCESS_ENDPOINT_CANDIDATE_LIMIT);
}

function maxAllowedRouteMeters(associationType: RoadCityAssociationType, crowMeters: number): number {
  if (associationType === 'REGIONAL') {
    return Math.max(crowMeters * ROAD_ACCESS_MAX_DIRECT_DETOUR_RATIO, ROAD_ACCESS_MAX_REGIONAL_ROUTE_METERS);
  }
  return Math.max(crowMeters * ROAD_ACCESS_MAX_DIRECT_DETOUR_RATIO, ROAD_ACCESS_MAX_DIRECT_ROUTE_METERS);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function main(): void {
  if (!existsSync(sourcePath)) {
    fail(`Missing canonical ROAD graph: ${sourcePath}`);
  }
  if (ROAD_SOURCE_PACKAGE_HASH_2E !== EXPECTED_ROAD_SOURCE_PACKAGE_HASH) {
    fail('ROAD source package hash constants disagree');
  }

  console.log('Loading ROAD graph…');
  const graph = JSON.parse(readFileSync(sourcePath, 'utf8')) as GeoTransportNetworkPackageV1;
  if (graph.contentHash !== EXPECTED_ROAD_SOURCE_PACKAGE_HASH) {
    fail(`ROAD graph contentHash ${graph.contentHash} != ${EXPECTED_ROAD_SOURCE_PACKAGE_HASH}`);
  }
  const cityAccess = JSON.parse(readFileSync(accessPath, 'utf8')) as CountryCityTransportAccessPackageV1;
  const foundation = buildTurkeyMultimodalFoundation({
    railAccess: getCityTransportAccessPackage(),
    ports: getTurkeyPortPackage(),
    airports: getTurkeyAirportPackage(),
  });
  const ports = getTurkeyPortPackage();
  const airports = getTurkeyAirportPackage();
  const cities = getTurkeyCityPackage();

  const { componentOf, sizeByComponent } = undirectedComponents(graph.nodes, graph.edges);
  let giantId: string | null = null;
  let giantSize = 0;
  for (const [id, size] of sizeByComponent) {
    if (size > giantSize) {
      giantSize = size;
      giantId = id;
    }
  }
  if (!giantId || giantSize < MIN_USABLE_ROAD_COMPONENT_SIZE) {
    fail('No usable ROAD giant component');
  }

  const giantNodes: Array<{ nodeId: string; coord: GeoCoordinateWgs84 }> = [];
  const allRoadNodes: Array<{ nodeId: string; coord: GeoCoordinateWgs84 }> = [];
  const nodeById = new Map<string, GeoTransportNodeRecord>();
  for (const node of graph.nodes) {
    nodeById.set(node.nodeId, node);
    const coord = nodeCoord(node);
    if (!coord) continue;
    allRoadNodes.push({ nodeId: node.nodeId, coord });
    if (componentOf.get(node.nodeId) !== giantId) continue;
    giantNodes.push({ nodeId: node.nodeId, coord });
  }

  const adj = buildUndirectedAdjacency(graph.edges);
  const cityAnchorByLegacy = new Map<string, string>();
  for (const legacyCityId of LEGACY_STABLE_GAMEPLAY_CITY_IDS) {
    const geoCityId = geoCityIdForGameplayCity(legacyCityId);
    const city = geoCityId ? cities.cities.find((row) => row.geoCityId === geoCityId) : undefined;
    const stored = geoCityId
      ? cityAccess.accesses.find((row) => row.geoCityId === geoCityId && row.mode === 'ROAD')
      : undefined;
    if (!geoCityId || !city) continue;
    const resolved = resolveProvisionalAccess({
      geoCityId,
      cityProjected: city.projected,
      cityWgs84: city.coordinate,
      storedNodeId: stored?.accessNodeIds[0],
      nodes: graph.nodes.filter((node) => componentOf.get(node.nodeId) === giantId),
      nodeById,
      componentOf,
      sizeByComponent,
      giantComponentId: giantId,
    });
    if (resolved.nodeId) cityAnchorByLegacy.set(legacyCityId, resolved.nodeId);
  }

  type Job = {
    legacyCityId: string;
    geoCityId: string;
    transferMode: MultimodalRoadTransferMode;
    infrastructureId: string;
    transferNodeId: string;
    associationType: RoadCityAssociationType;
    infrastructureWgs84: GeoCoordinateWgs84;
  };

  const jobs: Job[] = [];
  for (const node of foundation.transferNodes) {
    const geoCityId = node.geoCityId;
    if (node.lineage.railAccessId) {
      const coord = parseTopologyCoordFromNodeId(node.lineage.railAccessId);
      if (!coord) fail(`Cannot parse RAIL access WGS84 from ${node.lineage.railAccessId}`);
      jobs.push({
        legacyCityId: node.gameplayCityId,
        geoCityId,
        transferMode: 'RAIL',
        infrastructureId: node.lineage.railAccessId,
        transferNodeId: node.id,
        associationType: 'DIRECT',
        infrastructureWgs84: coord,
      });
    }
    if (node.lineage.geoPortId) {
      const port = ports.ports.find((row) => row.id === node.lineage.geoPortId);
      if (!port) fail(`Missing GeoPort ${node.lineage.geoPortId}`);
      const assoc = port.cityAssociations.find((row) => row.gameplayCityId === node.gameplayCityId);
      jobs.push({
        legacyCityId: node.gameplayCityId,
        geoCityId,
        transferMode: 'SEA',
        infrastructureId: port.id,
        transferNodeId: node.id,
        associationType: assoc?.associationType === 'REGIONAL' || assoc?.associationType === 'DIRECT' ? assoc.associationType : null,
        infrastructureWgs84: port.position,
      });
    }
    if (node.lineage.geoAirportId) {
      const airport = airports.airports.find((row) => row.id === node.lineage.geoAirportId);
      if (!airport) fail(`Missing GeoAirport ${node.lineage.geoAirportId}`);
      const assoc = airport.cityAssociations.find((row) => row.gameplayCityId === node.gameplayCityId);
      jobs.push({
        legacyCityId: node.gameplayCityId,
        geoCityId,
        transferMode: 'AIR',
        infrastructureId: airport.id,
        transferNodeId: node.id,
        associationType: assoc?.associationType === 'REGIONAL' || assoc?.associationType === 'DIRECT' ? assoc.associationType : null,
        infrastructureWgs84: airport.position,
      });
    }
  }
  jobs.sort((a, b) =>
    roadTransferAccessLogicalKey(a.legacyCityId, a.transferMode, a.infrastructureId).localeCompare(
      roadTransferAccessLogicalKey(b.legacyCityId, b.transferMode, b.infrastructureId),
    ),
  );

  const snapDistances: number[] = [];
  const unresolved: Array<Record<string, unknown>> = [];
  const records: MultimodalRoadTransferAccessRecord[] = [];
  const seen = new Set<string>();

  for (const job of jobs) {
    const logicalKey = roadTransferAccessLogicalKey(job.legacyCityId, job.transferMode, job.infrastructureId);
    if (seen.has(logicalKey)) fail(`Duplicate logical key ${logicalKey}`);
    seen.add(logicalKey);

    const cityAnchor = cityAnchorByLegacy.get(job.legacyCityId) ?? null;
    if (!cityAnchor || componentOf.get(cityAnchor) !== giantId) {
      unresolved.push({ logicalKey, reason: 'CITY_ROAD_ANCHOR_UNRESOLVED', cityAnchor });
      continue;
    }
    const nearestAny = nearestAnyRoad(job.infrastructureWgs84, allRoadNodes, 80_000);
    let candidates = gatherSnapCandidates(job.infrastructureWgs84, giantNodes, ROAD_INFRA_SNAP_MAX_METERS);
    if (candidates.length === 0 && nearestAny && nearestAny.distanceMeters <= ROAD_INFRA_NEAR_ROAD_METERS) {
      candidates = gatherSnapCandidates(
        job.infrastructureWgs84,
        giantNodes,
        ROAD_INFRA_SNAP_DISCONNECTED_PRECINCT_METERS,
      );
    }
    if (candidates.length === 0) {
      unresolved.push({
        logicalKey,
        reason: 'INFRASTRUCTURE_ROAD_SNAP_UNRESOLVED',
        maxMeters: ROAD_INFRA_SNAP_MAX_METERS,
        nearestAnyMeters: nearestAny?.distanceMeters ?? null,
      });
      continue;
    }

    const crow = haversineMeters(parseTopologyCoordFromNodeId(cityAnchor) ?? job.infrastructureWgs84, job.infrastructureWgs84);
    const maxRoute = maxAllowedRouteMeters(job.associationType, crow);
    let chosen: {
      snap: SnapCandidate;
      distanceMeters: number;
      roadEdgeCount: number;
    } | null = null;
    for (const snap of candidates) {
      const routed = dijkstraShortestPath(adj, cityAnchor, snap.nodeId);
      if (!routed || !Number.isFinite(routed.lengthMeters)) continue;
      const colocated = cityAnchor === snap.nodeId;
      const distanceMeters = colocated ? 1 : routed.lengthMeters;
      const roadEdgeCount = colocated ? 0 : routed.edgeIds.length;
      if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) continue;
      if (!colocated && roadEdgeCount < 1) continue;
      if (distanceMeters > maxRoute) continue;
      if (
        !chosen ||
        distanceMeters < chosen.distanceMeters ||
        (distanceMeters === chosen.distanceMeters && snap.distanceMeters < chosen.snap.distanceMeters) ||
        (distanceMeters === chosen.distanceMeters &&
          snap.distanceMeters === chosen.snap.distanceMeters &&
          snap.nodeId < chosen.snap.nodeId)
      ) {
        chosen = { snap, distanceMeters, roadEdgeCount };
      }
    }
    if (!chosen) {
      unresolved.push({ logicalKey, reason: 'ROAD_PATH_DETOUR_OR_UNRESOLVED', cityAnchor, maxRoute, crow });
      continue;
    }
    snapDistances.push(chosen.snap.distanceMeters);

    const mapping = cities.gameplayMappings.find((row) => row.gameplayCityId === job.legacyCityId);
    if (!mapping || mapping.geoCityId !== job.geoCityId) {
      fail(`City mapping mismatch for ${job.legacyCityId}`);
    }

    records.push({
      logicalKey,
      legacyCityId: job.legacyCityId,
      geoCityId: job.geoCityId,
      transferMode: job.transferMode,
      infrastructureId: job.infrastructureId,
      transferNodeId: job.transferNodeId,
      associationType: job.associationType,
      cityRoadAnchorNodeId: cityAnchor,
      infrastructureRoadNodeId: chosen.snap.nodeId,
      infrastructureWgs84: {
        longitude: job.infrastructureWgs84.longitude,
        latitude: job.infrastructureWgs84.latitude,
      },
      snapDistanceMeters: chosen.snap.distanceMeters,
      snapEvidenceStatus: snapEvidence(chosen.snap.distanceMeters),
      distanceMeters: chosen.distanceMeters,
      roadEdgeCount: chosen.roadEdgeCount,
      routeReference: `domain.canonical.road-transfer-access.${logicalKey.replace(/\|/g, '.')}`,
      distanceAuthority: SOURCE_BACKED_ROAD_TRANSFER_ACCESS,
      sourceRoadPackageHash: EXPECTED_ROAD_SOURCE_PACKAGE_HASH,
      algorithmId: MULTIMODAL_ROAD_TRANSFER_ACCESS_ALGORITHM_ID,
      routingDirectionality: ROAD_ACCESS_ROUTING_DIRECTIONALITY,
      evidenceStatus: 'PROVISIONAL',
      status: 'READY',
    });
  }

  records.sort((a, b) => a.logicalKey.localeCompare(b.logicalKey));
  const contentHash = hashCanonical(records);
  const artifact: MultimodalRoadTransferAccessArtifactV1 = {
    schemaVersion: MULTIMODAL_ROAD_TRANSFER_ACCESS_SCHEMA_VERSION,
    packageId: MULTIMODAL_ROAD_TRANSFER_ACCESS_PACKAGE_ID,
    geoCountryId: 'country.tur',
    algorithmId: MULTIMODAL_ROAD_TRANSFER_ACCESS_ALGORITHM_ID,
    routingDirectionality: ROAD_ACCESS_ROUTING_DIRECTIONALITY,
    sourceRoadPackageHash: EXPECTED_ROAD_SOURCE_PACKAGE_HASH,
    cityAccessPackageHash: cityAccess.contentHash,
    contentHash,
    records,
  };

  const json = `${JSON.stringify(artifact)}\n`;
  if (Buffer.byteLength(json) > 750_000) {
    fail(`Artifact too large: ${Buffer.byteLength(json)} bytes`);
  }

  const sortedSnaps = [...snapDistances].sort((a, b) => a - b);
  const report = {
    sourceRoadPackageHash: EXPECTED_ROAD_SOURCE_PACKAGE_HASH,
    algorithmId: MULTIMODAL_ROAD_TRANSFER_ACCESS_ALGORITHM_ID,
    routingDirectionality: ROAD_ACCESS_ROUTING_DIRECTIONALITY,
    snapPolicy: {
      maxMeters: ROAD_INFRA_SNAP_MAX_METERS,
      attachedExactMeters: ROAD_INFRA_ATTACHED_EXACT_METERS,
      note: 'Nearest giant-component ROAD node. OSM snap is provisional, not VERIFIED freight access.',
    },
    snapDiagnostics: {
      count: sortedSnaps.length,
      min: sortedSnaps[0] ?? null,
      median: percentile(sortedSnaps, 50),
      p90: percentile(sortedSnaps, 90),
      p95: percentile(sortedSnaps, 95),
      max: sortedSnaps[sortedSnaps.length - 1] ?? null,
    },
    giantComponentSize: giantSize,
    recordCount: records.length,
    unresolved,
    contentHash,
    bytes: Buffer.byteLength(json),
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(artifactPath, json);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${artifactPath} records=${records.length} bytes=${Buffer.byteLength(json)} ${contentHash}`);
  console.log(`Snap min/median/p90/p95/max`, report.snapDiagnostics);
  if (unresolved.length) console.log(`Unresolved ${unresolved.length}`, unresolved);
}

main();
