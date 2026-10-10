/**
 * Build Türkiye maritime navigability graph and reconcile PortSeaAccess.
 * Run: npx tsx scripts/map-v2/ingest-turkey-maritime.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MARITIME_GRAPH_POLICY_VERSION,
  MARITIME_INGEST_PROCESSING_VERSION,
  MARITIME_LAND_MASK_VERSION,
  MARITIME_VERIFIED_CRITERIA,
  PORT_CLUSTER_SPAN_QA_METERS,
  PORT_SEA_ACCESS_FAILURE_REASONS,
  PORT_SEA_ACCESS_SEARCH_RADII_METERS,
  PORT_ACCESS_BEARINGS_DEG,
  bboxAround,
  PORT_LOCAL_WINDOW_DEG,
  classifyMaritimeRegion,
  dijkstraMaritime,
  isNavigableWater,
  nearestNode,
  offsetWgs84,
  resolvePortDisplayName,
  segmentHitsLand,
  type MaritimeChannelId,
  type PortSeaAccessFailureReason,
} from '../../src/mapV2/geo/maritimeNavigability';
import type { SeaDebugViewV1, SeaRuntimeManifestV1, MaritimeSmokeTest } from '../../src/mapV2/geo/maritimeRuntime';
import type { TurkeyPortPackageV1 } from '../../src/mapV2/geo/geoPort';
import { OFFICIAL_PORT_QA_STATUS } from '../../src/mapV2/geo/geoPort';
import { haversineMeters } from '../../src/mapV2/geo/wgs84Distance';
import { projectWgs84ToNormalizedMercator } from '../../src/mapV2/geo/webMercator';
import {
  TRANSPORT_NETWORK_SCHEMA_VERSION,
  TRANSPORT_PACKAGE_PROCESSING_VERSION,
  WEB_MERCATOR_TRANSPORT_PROJECTION,
  type CountryTransportManifestV1,
  type GeoTransportNetworkPackageV1,
} from '../../src/mapV2/geo/transportNetwork';
import { measureConnectivity, validateTransportNetwork } from '../../src/mapV2/geo/validateTransportNetwork';
import { WEB_MERCATOR_PROJECTION_VERSION } from '../../src/mapV2/geo/webMercator';
import { NATURAL_EARTH_LAND_VERSION, TURKEY_OSM_PBF_RAW_REL } from '../../src/mapV2/geo/maritimeRawSource';
import { loadMaritimeLandMask } from './maritime-land-mask';
import { appendPortApproachGraph, attachPortAccessNode, buildMaritimeGraph, toTransportRecords } from './maritime-graph-builder';
import { hashCanonical } from './transport-package-factory';

const root = resolve(__dirname, '../..');
const outDir = resolve(root, 'src/mapV2/generated/transport');
const portsPath = resolve(root, 'src/mapV2/generated/infrastructure/turkey-ports.json');
const portsReportPath = resolve(root, 'src/mapV2/generated/infrastructure/turkey-ports.report.json');

function hashFile(path: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function main(): void {
  const mask = loadMaritimeLandMask(root);
  const query = { neLand: mask.neLand, osmMarine: mask.osmMarine };
  const graph = buildMaritimeGraph(query);
  const parent = new Map(graph.nodes.map((node) => [node.nodeId, node.nodeId]));
  const find = (id: string): string => {
    let cur = id;
    while (parent.get(cur) !== cur) {
      parent.set(cur, parent.get(parent.get(cur) ?? cur) ?? cur);
      cur = parent.get(cur) ?? cur;
    }
    return cur;
  };
  for (const edge of graph.edges) {
    const a = find(edge.fromNodeId);
    const b = find(edge.toNodeId);
    if (a !== b) parent.set(a, b);
  }
  const byId = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const mix = graph.edges.filter((edge) => {
    const a = byId.get(edge.fromNodeId);
    const b = byId.get(edge.toNodeId);
    if (!a || !b) return false;
    const kinds = new Set([a.kind, b.kind]);
    return kinds.has('CHANNEL') && (kinds.has('COARSE') || kinds.has('APPROACH'));
  }).length;
  const coarseCoarse = graph.edges.filter((edge) => {
    const a = byId.get(edge.fromNodeId);
    const b = byId.get(edge.toNodeId);
    return a?.kind === 'COARSE' && b?.kind === 'COARSE';
  }).length;
  const bosphorusNodes = graph.nodes.filter((node) => node.channel === 'BOSPHORUS');
  const dardanellesNodes = graph.nodes.filter((node) => node.channel === 'DARDANELLES');
  if (bosphorusNodes.length < 8 || dardanellesNodes.length < 8) {
    console.error('MARITIME_NAVIGATION_BLOCKED_STRAITS');
    console.error(JSON.stringify({ bosphorusNodes: bosphorusNodes.length, dardanellesNodes: dardanellesNodes.length }));
    process.exit(2);
  }

  const sizes = new Map<string, number>();
  for (const node of graph.nodes) {
    const root = find(node.nodeId);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  const maxComp = Math.max(...sizes.values());
  const inMax = (node: (typeof graph.nodes)[number]) => sizes.get(find(node.nodeId)) === maxComp;
  const black =
    graph.nodes.find((node) => node.region === 'BLACK_SEA' && node.kind === 'COARSE' && inMax(node)) ??
    nearestNode({ longitude: 38.4, latitude: 41.85 }, graph.nodes, 80_000);
  const marmara =
    graph.nodes.find((node) => node.region === 'MARMARA' && node.kind === 'COARSE' && inMax(node)) ??
    nearestNode({ longitude: 28.0, latitude: 40.72 }, graph.nodes, 80_000);
  const aegean =
    graph.nodes.find((node) => node.region === 'AEGEAN' && node.kind === 'COARSE' && inMax(node)) ??
    nearestNode({ longitude: 26.7, latitude: 38.4 }, graph.nodes, 80_000);
  const med =
    graph.nodes.find((node) => node.region === 'MEDITERRANEAN' && node.kind === 'COARSE' && inMax(node)) ??
    nearestNode({ longitude: 32.4, latitude: 36.25 }, graph.nodes, 80_000);
  if (!black || !marmara || !aegean || !med) {
    console.error('MARITIME_NAVIGATION_BLOCKED_SOURCE missing region seed nodes');
    process.exit(2);
  }
  console.error(
    JSON.stringify({
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      bosphorus: bosphorusNodes.length,
      mixChannelHub: mix,
      coarseCoarse,
      sameBlackMarmara: find(black.nodeId) === find(marmara.nodeId),
      bosInBlack: bosphorusNodes.some((node) => find(node.nodeId) === find(black.nodeId)),
      bosInMarmara: bosphorusNodes.some((node) => find(node.nodeId) === find(marmara.nodeId)),
      darInMarmara: dardanellesNodes.some((node) => find(node.nodeId) === find(marmara.nodeId)),
      darInAegean: dardanellesNodes.some((node) => find(node.nodeId) === find(aegean.nodeId)),
      maxComp,
      marmaraCompSize: graph.nodes.filter((node) => find(node.nodeId) === find(marmara.nodeId)).length,
    }),
  );
  const blackMarmara = dijkstraMaritime(graph.nodes, graph.edges, black.nodeId, marmara.nodeId);
  const marmaraAegean = dijkstraMaritime(graph.nodes, graph.edges, marmara.nodeId, aegean.nodeId);
  const aegeanMed = dijkstraMaritime(graph.nodes, graph.edges, aegean.nodeId, med.nodeId);
  if (!blackMarmara || !blackMarmara.channels.includes('BOSPHORUS')) {
    console.error('MARITIME_NAVIGATION_BLOCKED_STRAITS Black Sea → Marmara');
    console.error(JSON.stringify(blackMarmara));
    process.exit(2);
  }
  if (!marmaraAegean || !marmaraAegean.channels.includes('DARDANELLES')) {
    console.error('MARITIME_NAVIGATION_BLOCKED_STRAITS Marmara → Aegean');
    console.error(JSON.stringify(marmaraAegean));
    process.exit(2);
  }
  if (!aegeanMed) {
    console.error('MARITIME_NAVIGATION_BLOCKED_SOURCE Aegean → Mediterranean');
    process.exit(2);
  }

  if (!existsSync(portsPath)) throw new Error('turkey-ports.json missing');
  const ports = JSON.parse(readFileSync(portsPath, 'utf8')) as TurkeyPortPackageV1;
  const logistics = ports.ports.filter((port) => port.logisticsEligibility === 'LOGISTICS_ELIGIBLE');
  const localWindows = logistics.map((port) =>
    bboxAround(port.position.longitude, port.position.latitude, PORT_LOCAL_WINDOW_DEG),
  );
  const approachStats = appendPortApproachGraph(graph.nodes, graph.edges, query, localWindows);
  for (const node of graph.nodes) {
    if (!parent.has(node.nodeId)) parent.set(node.nodeId, node.nodeId);
  }
  for (const edge of graph.edges) {
    const a = find(edge.fromNodeId);
    const b = find(edge.toNodeId);
    if (a !== b) parent.set(a, b);
  }
  sizes.clear();
  for (const node of graph.nodes) {
    const rootId = find(node.nodeId);
    sizes.set(rootId, (sizes.get(rootId) ?? 0) + 1);
  }
  const maxCompAfter = Math.max(...sizes.values());
  const inMaxAfter = (node: (typeof graph.nodes)[number]) => sizes.get(find(node.nodeId)) === maxCompAfter;
  const blackAfter = graph.nodes.find((node) => node.region === 'BLACK_SEA' && inMaxAfter(node)) ?? black;
  const marmaraAfter = graph.nodes.find((node) => node.region === 'MARMARA' && inMaxAfter(node)) ?? marmara;
  const aegeanAfter = graph.nodes.find((node) => node.region === 'AEGEAN' && inMaxAfter(node)) ?? aegean;
  const medAfter = graph.nodes.find((node) => node.region === 'MEDITERRANEAN' && inMaxAfter(node)) ?? med;
  if (
    find(blackAfter.nodeId) !== find(marmaraAfter.nodeId) ||
    find(marmaraAfter.nodeId) !== find(aegeanAfter.nodeId) ||
    find(aegeanAfter.nodeId) !== find(medAfter.nodeId)
  ) {
    console.error('MARITIME_NAVIGATION_BLOCKED_STRAITS approach graph split regional trunk');
    process.exit(2);
  }
  const trunkRoot = find(marmaraAfter.nodeId);
  const maxCompIds = new Set(graph.nodes.filter((node) => find(node.nodeId) === trunkRoot).map((node) => node.nodeId));
  console.error(
    JSON.stringify({
      afterApproach: {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        localNodes: approachStats.localNodes,
        localEdges: approachStats.localEdges,
        trunk: maxCompIds.size,
      },
    }),
  );

  const osmHash = existsSync(resolve(root, TURKEY_OSM_PBF_RAW_REL))
    ? hashFile(resolve(root, TURKEY_OSM_PBF_RAW_REL))
    : mask.osmWaterHash;
  const sourceManifest = {
    policyVersion: 1 as const,
    datasetId: 'ne10m.land+osm.tur.marine.hybrid',
    datasetType: 'transport-network' as const,
    sourceName: 'Natural Earth 10m land + OSM marine/strait polygons (Türkiye hybrid water grid)',
    sourceURL: 'https://www.naturalearthdata.com/about/terms-of-use/',
    license: 'Public Domain + ODbL 1.0 (OSM marine overlay)',
    licenseURL: 'https://opendatacommons.org/licenses/odbl/1-0/',
    sourceVersion: NATURAL_EARTH_LAND_VERSION,
    retrievedAt: '2026-09-18',
    sourceHash: osmHash,
    originalFormat: 'GeoJSON',
    processedFormat: 'GeoTransportNetworkPackageV1',
    processingVersion: MARITIME_INGEST_PROCESSING_VERSION,
    derivedFrom: [mask.neSourceHash, mask.osmWaterHash],
    attributionRequired: true,
    productionApproved: false,
    notes:
      'DEV maritime graph. Not player corridors. NE 10m land mask; OSM marine/harbour polygons open straits and basins. Adaptive local approach. No AIS/shipping lanes.',
  };

  const failureReasons = Object.fromEntries(PORT_SEA_ACCESS_FAILURE_REASONS.map((code) => [code, 0])) as Record<
    PortSeaAccessFailureReason,
    number
  >;
  let resolved = 0;
  let unresolved = 0;
  ports.issues = ports.issues.filter((issue) => !issue.id.startsWith('qa.port.duplicate.'));
  for (const port of ports.ports) {
    const names = resolvePortDisplayName(port.evidence.names.length ? port.evidence.names : [port.displayName]);
    port.displayName = names.displayName;
    if (port.logisticsEligibility !== 'LOGISTICS_ELIGIBLE') continue;
    const span = port.bounds
      ? haversineMeters(
          { longitude: port.bounds.west, latitude: port.bounds.south },
          { longitude: port.bounds.east, latitude: port.bounds.north },
        )
      : 0;
    if (span > PORT_CLUSTER_SPAN_QA_METERS) {
      ports.issues.push({
        id: `qa.port.duplicate.${port.id}`,
        type: 'PORT_DUPLICATE',
        portId: port.id,
        evidence: `Cluster span ${Math.round(span)}m exceeds ${PORT_CLUSTER_SPAN_QA_METERS}m`,
        resolutionStatus: 'OPEN',
      });
    }
    let chosen: (typeof graph.nodes)[number] | null = null;
    let radiusUsed: number | null = null;
    let lastReason: PortSeaAccessFailureReason = 'NO_NAVIGABLE_WATER_NEARBY';
    let failureStage: 'LOCAL' | 'TRUNK' | null = 'LOCAL';
    const origin = port.position;
    const originInland = !isNavigableWater(origin.longitude, origin.latitude, query);
    const waterHits: Array<{ point: { longitude: number; latitude: number }; radius: number }> = [];
    if (!originInland) waterHits.push({ point: origin, radius: 0 });
    for (const radius of PORT_SEA_ACCESS_SEARCH_RADII_METERS) {
      for (const bearing of PORT_ACCESS_BEARINGS_DEG) {
        const sample = offsetWgs84(origin, radius, bearing);
        if (!isNavigableWater(sample.longitude, sample.latitude, query)) continue;
        if (!originInland && segmentHitsLand(origin, sample, query)) {
          lastReason = 'LAND_INTERSECTION';
          continue;
        }
        waterHits.push({ point: sample, radius });
        break;
      }
    }
    if (waterHits.length === 0) {
      lastReason = originInland ? 'PORT_POSITION_INLAND' : 'HARBOUR_WATER_MISSING';
    }
    for (const hit of waterHits) {
      const nearby = nearestNode(hit.point, graph.nodes, Math.max(hit.radius, 2500));
      if (nearby && isNavigableWater(nearby.longitude, nearby.latitude, query)) {
        if (!segmentHitsLand(hit.point, { longitude: nearby.longitude, latitude: nearby.latitude }, query)) {
          if (maxCompIds.has(nearby.nodeId)) {
            chosen = nearby;
            radiusUsed = hit.radius || 250;
            failureStage = null;
            break;
          }
          lastReason = 'NO_TRUNK_CONNECTION';
          failureStage = 'TRUNK';
        } else {
          lastReason = 'LAND_INTERSECTION';
          failureStage = 'LOCAL';
        }
      } else {
        lastReason = 'NO_APPROACH_PATH';
        failureStage = 'LOCAL';
      }
      const attached = attachPortAccessNode(graph.nodes, graph.edges, hit.point, query, maxCompIds);
      if (attached) {
        chosen = attached;
        radiusUsed = hit.radius || 250;
        failureStage = null;
        if (!maxCompIds.has(attached.nodeId)) maxCompIds.add(attached.nodeId);
        break;
      }
      lastReason = 'NO_TRUNK_CONNECTION';
      failureStage = 'TRUNK';
    }
    if (!chosen) {
      unresolved += 1;
      failureReasons[lastReason] += 1;
      port.seaAccess = {
        portId: port.id,
        position: origin,
        projected: port.projected,
        status: 'UNRESOLVED',
        evidence: `No land-free navigable graph node within ${PORT_SEA_ACCESS_SEARCH_RADII_METERS.join('/')} m. ${lastReason}`,
        failureReason: lastReason,
        maritimeRegion: classifyMaritimeRegion(origin.longitude, origin.latitude),
        graphNodeId: null,
        searchRadiusMeters: null,
        failureStage,
        approachKind: null,
      };
      continue;
    }
    resolved += 1;
    const accessPos = { longitude: chosen.longitude, latitude: chosen.latitude };
    port.seaAccess = {
      portId: port.id,
      position: accessPos,
      projected: projectWgs84ToNormalizedMercator(accessPos.longitude, accessPos.latitude),
      status: 'PROVISIONAL',
      evidence: `Validated water access ${chosen.kind === 'PORT_ACCESS' ? 'sample' : 'grid node'} ${chosen.nodeId} within ${radiusUsed}m. Diagnostic access only.`,
      failureReason: null,
      maritimeRegion: chosen.region ?? classifyMaritimeRegion(accessPos.longitude, accessPos.latitude),
      graphNodeId: chosen.nodeId,
      searchRadiusMeters: radiusUsed,
      failureStage: null,
      approachKind: chosen.kind === 'LOCAL' || chosen.kind === 'PORT_ACCESS' ? 'LOCAL' : 'TRUNK',
    };
  }
  void MARITIME_VERIFIED_CRITERIA;
  void OFFICIAL_PORT_QA_STATUS;

  graph.nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  graph.edges.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  const records = toTransportRecords(graph.nodes, graph.edges);
  const metrics = measureConnectivity(records.nodes, records.edges);
  const body: Omit<GeoTransportNetworkPackageV1, 'contentHash'> = {
    schemaVersion: TRANSPORT_NETWORK_SCHEMA_VERSION,
    packageId: 'map-v2.country.tur.transport.sea.v1',
    geoCountryId: 'country.tur',
    mode: 'SEA',
    sourceStatus: 'PROTOTYPE',
    projection: WEB_MERCATOR_TRANSPORT_PROJECTION,
    sourceManifest,
    transformation: {
      processingVersion: TRANSPORT_PACKAGE_PROCESSING_VERSION,
      projectionVersion: WEB_MERCATOR_PROJECTION_VERSION,
      simplificationVersion: MARITIME_GRAPH_POLICY_VERSION,
      filtersApplied: [MARITIME_LAND_MASK_VERSION],
      lodPolicyId: 'maritime-coarse-plus-straits-v1',
      quantize: 100000,
    },
    nodes: records.nodes,
    edges: records.edges,
    stats: {
      nodeCount: metrics.nodeCount,
      edgeCount: metrics.edgeCount,
      componentCount: metrics.componentCount,
    },
    productionApproved: false,
  };
  const artifact: GeoTransportNetworkPackageV1 = { ...body, contentHash: hashCanonical(body) };
  const validation = validateTransportNetwork(artifact);
  if (validation.length) {
    console.error(validation.slice(0, 12));
    throw new Error(`SEA graph validation failed (${validation.length})`);
  }

  const pickCityPort = (cityId: string): string | null => {
    const row = ports.cityAssociations.find((item) => item.gameplayCityId === cityId);
    return (
      (row?.portIds ?? []).find((id) => {
        const port = ports.ports.find((item) => item.id === id);
        return port?.seaAccess.status === 'PROVISIONAL' && port.seaAccess.graphNodeId && maxCompIds.has(port.seaAccess.graphNodeId);
      }) ?? null
    );
  };
  const pickRegionPort = (region: ReturnType<typeof classifyMaritimeRegion>, avoidIds: string[]): string | null => {
    return (
      ports.ports.find(
        (port) =>
          port.logisticsEligibility === 'LOGISTICS_ELIGIBLE' &&
          port.seaAccess.status === 'PROVISIONAL' &&
          port.seaAccess.maritimeRegion === region &&
          port.seaAccess.graphNodeId != null &&
          maxCompIds.has(port.seaAccess.graphNodeId) &&
          !avoidIds.includes(port.id),
      )?.id ?? null
    );
  };
  const smokePairs: Array<{
    id: string;
    fromPortId: string | null;
    toPortId: string | null;
    required: MaritimeChannelId[];
  }> = [
    { id: 'istanbul-izmir', fromPortId: pickCityPort('istanbul'), toPortId: pickCityPort('izmir'), required: ['DARDANELLES'] },
    { id: 'istanbul-trabzon', fromPortId: pickCityPort('istanbul'), toPortId: pickCityPort('trabzon'), required: ['BOSPHORUS'] },
    { id: 'izmir-antalya', fromPortId: pickCityPort('izmir'), toPortId: pickCityPort('antalya'), required: [] },
    { id: 'bursa-trabzon', fromPortId: pickCityPort('bursa'), toPortId: pickCityPort('trabzon'), required: ['BOSPHORUS'] },
    {
      id: 'marmara-black-sea',
      fromPortId: pickRegionPort('MARMARA', []),
      toPortId: pickRegionPort('BLACK_SEA', []),
      required: ['BOSPHORUS'],
    },
    { id: 'antalya-adana', fromPortId: pickCityPort('antalya'), toPortId: pickCityPort('adana'), required: [] },
  ];
  const smokeTests: MaritimeSmokeTest[] = smokePairs.map((pair) => {
    const fromPortId = pair.fromPortId;
    const toPortId = pair.toPortId;
    const fromNode = fromPortId ? ports.ports.find((port) => port.id === fromPortId)?.seaAccess.graphNodeId : null;
    const toNode = toPortId ? ports.ports.find((port) => port.id === toPortId)?.seaAccess.graphNodeId : null;
    if (!fromPortId || !toPortId || !fromNode || !toNode) {
      return {
        id: pair.id,
        fromPortId: fromPortId ?? '',
        toPortId: toPortId ?? '',
        ok: false,
        meters: null,
        nodeCount: null,
        channels: [],
        requiredChannels: pair.required,
        notes: 'Missing resolved PortSeaAccess endpoint',
      };
    }
    const path = dijkstraMaritime(graph.nodes, graph.edges, fromNode, toNode);
    const missing = pair.required.filter((ch) => !path?.channels.includes(ch));
    return {
      id: pair.id,
      fromPortId,
      toPortId,
      ok: Boolean(path) && missing.length === 0,
      meters: path?.meters ?? null,
      nodeCount: path?.nodeIds.length ?? null,
      channels: path?.channels ?? [],
      requiredChannels: pair.required,
      notes: path ? (missing.length ? `missing ${missing.join(',')}` : 'diagnostic path only') : 'no graph path',
    };
  });

  const nodeById = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const debugEdges = graph.edges
    .map((edge) => {
      const from = nodeById.get(edge.fromNodeId)!;
      const to = nodeById.get(edge.toNodeId)!;
      const layer =
        edge.channel != null
          ? ('CHANNEL' as const)
          : from.kind === 'LOCAL' || to.kind === 'LOCAL' || from.kind === 'PORT_ACCESS' || to.kind === 'PORT_ACCESS'
            ? ('APPROACH' as const)
            : ('TRUNK' as const);
      return { edge, from, to, layer };
    })
    .filter((row, index) => row.layer !== 'TRUNK' || row.edge.channel != null || index % 5 === 0)
    .slice(0, 12000)
    .map((row) => {
      const a = projectWgs84ToNormalizedMercator(row.from.longitude, row.from.latitude);
      const b = projectWgs84ToNormalizedMercator(row.to.longitude, row.to.latitude);
      return { edgeId: row.edge.edgeId, channel: row.edge.channel, layer: row.layer, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    });
  const smokePaths = smokeTests
    .filter((row) => row.ok && row.fromPortId && row.toPortId)
    .map((row) => {
      const fromNode = ports.ports.find((port) => port.id === row.fromPortId)!.seaAccess.graphNodeId!;
      const toNode = ports.ports.find((port) => port.id === row.toPortId)!.seaAccess.graphNodeId!;
      const path = dijkstraMaritime(graph.nodes, graph.edges, fromNode, toNode);
      return {
        id: row.id,
        points: (path?.nodeIds ?? []).map((id) => {
          const node = nodeById.get(id)!;
          const p = projectWgs84ToNormalizedMercator(node.longitude, node.latitude);
          return { x: p.x, y: p.y };
        }),
      };
    });
  const debug: SeaDebugViewV1 = { schemaVersion: 1, packageId: 'map-v2.country.tur.transport.sea.debug.v1', edges: debugEdges, smokePaths };

  const portBody = { ...ports };
  delete (portBody as { contentHash?: string }).contentHash;
  const portsSealed: TurkeyPortPackageV1 = { ...portBody, contentHash: hashCanonical(portBody) };
  writeFileSync(portsPath, `${JSON.stringify(portsSealed)}\n`);

  const report = JSON.parse(readFileSync(portsReportPath, 'utf8')) as Record<string, unknown>;
  report.contentHash = portsSealed.contentHash;
  report.seaAccess = { resolved, unresolved, logisticsEvaluated: logistics.length, failureReasons };
  report.maritimeSmoke = smokeTests;
  writeFileSync(portsReportPath, `${JSON.stringify(report, null, 2)}\n`);

  mkdirSync(outDir, { recursive: true });
  const networkPath = resolve(outDir, 'turkey-sea-network.json');
  writeFileSync(networkPath, `${JSON.stringify(artifact)}\n`);
  writeFileSync(resolve(outDir, 'turkey-sea-debug.json'), `${JSON.stringify(debug)}\n`);

  const runtimeBody: Omit<SeaRuntimeManifestV1, 'contentHash'> = {
    schemaVersion: 1,
    packageId: 'map-v2.country.tur.transport.sea.runtime.v1',
    geoCountryId: 'country.tur',
    mode: 'SEA',
    sourceStatus: 'PROTOTYPE',
    sourcePackageFile: 'turkey-sea-network.json',
    debugPackageFile: 'turkey-sea-debug.json',
    sourcePackageHash: artifact.contentHash,
    sourceManifest,
    graphPolicyVersion: MARITIME_GRAPH_POLICY_VERSION,
    landMaskVersion: MARITIME_LAND_MASK_VERSION,
    processingVersion: MARITIME_INGEST_PROCESSING_VERSION,
    stats: {
      nodeCount: metrics.nodeCount,
      edgeCount: metrics.edgeCount,
      componentCount: metrics.componentCount,
      channelNodeCount: graph.nodes.filter((node) => node.kind === 'CHANNEL').length,
      coarseNodeCount: graph.nodes.filter((node) => node.kind === 'COARSE').length,
      approachNodeCount: graph.nodes.filter((node) => node.kind === 'APPROACH' || node.kind === 'LOCAL').length,
      bosphorusNodeCount: bosphorusNodes.length,
      dardanellesNodeCount: dardanellesNodes.length,
    },
    regions: ['BLACK_SEA', 'MARMARA', 'AEGEAN', 'MEDITERRANEAN'],
    channels: ['BOSPHORUS', 'DARDANELLES'],
    seaAccess: { logisticsEvaluated: logistics.length, resolved, unresolved, failureReasons },
    smokeTests,
    productionApproved: false,
  };
  const runtime: SeaRuntimeManifestV1 = { ...runtimeBody, contentHash: hashCanonical(runtimeBody) };
  writeFileSync(resolve(outDir, 'turkey-sea-runtime-manifest.json'), `${JSON.stringify(runtime)}\n`);

  const manifestPath = resolve(outDir, 'turkeyTransportManifest.json');
  const current = JSON.parse(readFileSync(manifestPath, 'utf8')) as CountryTransportManifestV1;
  const manifestBody = {
    schemaVersion: current.schemaVersion,
    packageId: current.packageId,
    geoCountryId: current.geoCountryId,
    layout: current.layout,
    processingVersion: current.processingVersion,
    modes: current.modes.map((row) =>
      row.mode === 'SEA'
        ? {
            ...row,
            source: 'Natural Earth 10m land + OSM marine/strait polygons',
            license: 'Public Domain + ODbL 1.0',
            status: 'PROTOTYPE' as const,
            notes: 'Step 12 hybrid water grid + local port approach. DEV only. Player Denizyolu Yakında.',
          }
        : row,
    ),
    infrastructurePackageFile: current.infrastructurePackageFile,
    cityAccessPackageFile: current.cityAccessPackageFile,
    gameplaySeparation: current.gameplaySeparation,
  };
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifestBody, contentHash: hashCanonical(manifestBody) })}\n`);

  console.log(
    JSON.stringify(
      {
        nodes: metrics.nodeCount,
        edges: metrics.edgeCount,
        approach: approachStats,
        bytes: statSync(networkPath).size,
        contentHash: artifact.contentHash,
        seaAccess: runtime.seaAccess,
        smokeTests: smokeTests.map((row) => ({ id: row.id, ok: row.ok, meters: row.meters, channels: row.channels })),
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
