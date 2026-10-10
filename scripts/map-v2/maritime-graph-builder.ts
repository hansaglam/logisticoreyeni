import { haversineMeters } from '../../src/mapV2/geo/wgs84Distance';
import {
  APPROACH_STEP_DEG,
  BOSPHORUS_NORTH_APPROACH,
  BOSPHORUS_SOUTH_APPROACH,
  BOSPHORUS_STEP_DEG,
  BOSPHORUS_WINDOW,
  DARDANELLES_NORTH_APPROACH,
  DARDANELLES_SOUTH_APPROACH,
  MARMARA_FILL,
  DARDANELLES_STEP_DEG,
  DARDANELLES_WINDOW,
  MARITIME_AOI,
  MARITIME_COARSE_GAP_FILL_METERS,
  MARITIME_COARSE_STEP_DEG,
  MARITIME_MAX_EDGE_METERS,
  PORT_LOCAL_STEP_DEG,
  PORT_REGIONAL_APPROACH_BOXES,
  classifyMaritimeChannel,
  classifyMaritimeRegion,
  gridPoints,
  isNavigableWater,
  maritimeNodeId,
  neighborOffsets,
  pointInLonLatBbox,
  segmentHitsLand,
  type MaritimeGraphEdge,
  type MaritimeGraphNode,
  type MaritimeNavigabilityQuery,
  type LonLatBbox,
} from '../../src/mapV2/geo/maritimeNavigability';
import { inflateProjectedLine, projectLineString, projectedPolylineLength, quantizeProjectedPoint } from '../../src/mapV2/geo/transportGeometry';
import { projectWgs84ToNormalizedMercator } from '../../src/mapV2/geo/webMercator';
import type { GeoTransportEdgeRecord, GeoTransportNodeRecord } from '../../src/mapV2/geo/transportNetwork';

function gridKey(kind: string, ix: number, iy: number): string {
  return `${kind}:${ix}:${iy}`;
}

function indexOf(value: number, origin: number, step: number): number {
  return Math.round((value - origin) / step);
}

export function buildMaritimeGraph(query: MaritimeNavigabilityQuery): {
  nodes: MaritimeGraphNode[];
  edges: MaritimeGraphEdge[];
} {
  const layers: Array<{
    kind: 'c' | 'b' | 'd' | 'p';
    step: number;
    box: typeof MARITIME_AOI;
    nodeKind: MaritimeGraphNode['kind'];
  }> = [
    { kind: 'c', step: MARITIME_COARSE_STEP_DEG, box: MARITIME_AOI, nodeKind: 'COARSE' },
    { kind: 'p', step: APPROACH_STEP_DEG, box: BOSPHORUS_NORTH_APPROACH, nodeKind: 'APPROACH' },
    { kind: 'p', step: APPROACH_STEP_DEG, box: BOSPHORUS_SOUTH_APPROACH, nodeKind: 'APPROACH' },
    { kind: 'p', step: APPROACH_STEP_DEG, box: DARDANELLES_NORTH_APPROACH, nodeKind: 'APPROACH' },
    { kind: 'p', step: APPROACH_STEP_DEG, box: DARDANELLES_SOUTH_APPROACH, nodeKind: 'APPROACH' },
    { kind: 'p', step: APPROACH_STEP_DEG, box: MARMARA_FILL, nodeKind: 'APPROACH' },
    { kind: 'b', step: BOSPHORUS_STEP_DEG, box: BOSPHORUS_WINDOW, nodeKind: 'CHANNEL' },
    { kind: 'd', step: DARDANELLES_STEP_DEG, box: DARDANELLES_WINDOW, nodeKind: 'CHANNEL' },
  ];
  const nodes: MaritimeGraphNode[] = [];
  const byPosition = new Map<string, MaritimeGraphNode>();
  const index = new Map<string, MaritimeGraphNode>();
  for (const layer of layers) {
    for (const point of gridPoints(layer.box, layer.step)) {
      if (layer.kind === 'c' && classifyMaritimeChannel(point.longitude, point.latitude) != null) continue;
      if (layer.kind === 'p' && classifyMaritimeChannel(point.longitude, point.latitude) != null) continue;
      if (!isNavigableWater(point.longitude, point.latitude, query)) continue;
      const posKey = `${Math.round(point.longitude * 10000)}:${Math.round(point.latitude * 10000)}`;
      let node = byPosition.get(posKey);
      if (!node) {
        const nodeId = maritimeNodeId(layer.kind, point.longitude, point.latitude);
        node = {
          nodeId,
          longitude: point.longitude,
          latitude: point.latitude,
          region: classifyMaritimeRegion(point.longitude, point.latitude),
          channel: classifyMaritimeChannel(point.longitude, point.latitude),
          kind: layer.nodeKind,
        };
        nodes.push(node);
        byPosition.set(posKey, node);
      }
      index.set(
        gridKey(
          `${layer.kind}:${layer.box.west}:${layer.box.south}`,
          indexOf(point.longitude, layer.box.west, layer.step),
          indexOf(point.latitude, layer.box.south, layer.step),
        ),
        node,
      );
    }
  }
  nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));

  const edges: MaritimeGraphEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (
    a: MaritimeGraphNode,
    b: MaritimeGraphNode,
    portal = false,
    maxMeters = MARITIME_MAX_EDGE_METERS,
    sampleMeters = 400,
  ) => {
    if (a.nodeId === b.nodeId) return;
    const lengthMeters = haversineMeters(
      { longitude: a.longitude, latitude: a.latitude },
      { longitude: b.longitude, latitude: b.latitude },
    );
    if (lengthMeters <= 0 || lengthMeters > maxMeters) return;
    const aPos = { longitude: a.longitude, latitude: a.latitude };
    const bPos = { longitude: b.longitude, latitude: b.latitude };
    const blocked = portal
      ? !isNavigableWater((a.longitude + b.longitude) / 2, (a.latitude + b.latitude) / 2, query) ||
        !isNavigableWater(a.longitude, a.latitude, query) ||
        !isNavigableWater(b.longitude, b.latitude, query)
      : segmentHitsLand(aPos, bPos, query, sampleMeters);
    if (blocked) return;
    const [left, right] = a.nodeId < b.nodeId ? [a.nodeId, b.nodeId] : [b.nodeId, a.nodeId];
    const edgeId = `te.tur.sea.${left.replace('tn.tur.sea.', '')}_${right.replace('tn.tur.sea.', '')}`;
    if (seen.has(edgeId)) return;
    seen.add(edgeId);
    edges.push({
      edgeId,
      fromNodeId: left,
      toNodeId: right,
      lengthMeters: Math.round(lengthMeters),
      channel: a.channel && a.channel === b.channel ? a.channel : null,
    });
  };

  for (const layer of layers) {
    for (const node of nodes) {
      if (node.kind !== layer.nodeKind) continue;
      if (!pointInLonLatBbox(node.longitude, node.latitude, layer.box)) continue;
      if (layer.kind === 'b' && node.channel !== 'BOSPHORUS') continue;
      if (layer.kind === 'd' && node.channel !== 'DARDANELLES') continue;
      const ix = indexOf(node.longitude, layer.box.west, layer.step);
      const iy = indexOf(node.latitude, layer.box.south, layer.step);
      for (const [dx, dy] of neighborOffsets(true)) {
        const neighbor = index.get(
          gridKey(`${layer.kind}:${layer.box.west}:${layer.box.south}`, ix + dx, iy + dy),
        );
        if (neighbor) addEdge(node, neighbor);
      }
    }
  }

  const coarseGapCell = 0.2;
  const coarseGapBuckets = new Map<string, MaritimeGraphNode[]>();
  const coarseGapKey = (longitude: number, latitude: number) =>
    `${Math.floor(longitude / coarseGapCell)}:${Math.floor(latitude / coarseGapCell)}`;
  for (const node of nodes.filter((item) => item.kind === 'COARSE')) {
    const key = coarseGapKey(node.longitude, node.latitude);
    const bucket = coarseGapBuckets.get(key);
    if (bucket) bucket.push(node);
    else coarseGapBuckets.set(key, [node]);
  }
  for (const node of nodes.filter((item) => item.kind === 'COARSE')) {
    const ix = Math.floor(node.longitude / coarseGapCell);
    const iy = Math.floor(node.latitude / coarseGapCell);
    const nearby: MaritimeGraphNode[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = coarseGapBuckets.get(`${ix + dx}:${iy + dy}`);
        if (bucket) nearby.push(...bucket);
      }
    }
    const ranked = nearby
      .map((other) => ({
        other,
        d: haversineMeters(
          { longitude: node.longitude, latitude: node.latitude },
          { longitude: other.longitude, latitude: other.latitude },
        ),
      }))
      .filter((row) => row.d > 20_000 && row.d <= MARITIME_COARSE_GAP_FILL_METERS)
      .sort((a, b) => a.d - b.d);
    let linked = 0;
    for (const row of ranked.slice(0, 8)) {
      const before = seen.size;
      addEdge(node, row.other, false, MARITIME_COARSE_GAP_FILL_METERS, 1200);
      if (seen.size > before) {
        linked += 1;
        if (linked >= 4) break;
      }
    }
  }

  const hubs = nodes.filter((node) => node.kind === 'COARSE' || node.kind === 'APPROACH');
  const hubCell = 0.08;
  const hubBuckets = new Map<string, MaritimeGraphNode[]>();
  const bucketKey = (longitude: number, latitude: number) =>
    `${Math.floor(longitude / hubCell)}:${Math.floor(latitude / hubCell)}`;
  for (const hub of hubs) {
    const key = bucketKey(hub.longitude, hub.latitude);
    const bucket = hubBuckets.get(key);
    if (bucket) bucket.push(hub);
    else hubBuckets.set(key, [hub]);
  }
  const nearbyHubs = (longitude: number, latitude: number): MaritimeGraphNode[] => {
    const ix = Math.floor(longitude / hubCell);
    const iy = Math.floor(latitude / hubCell);
    const out: MaritimeGraphNode[] = [];
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        const bucket = hubBuckets.get(`${ix + dx}:${iy + dy}`);
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  };
  for (const channelNode of nodes.filter((node) => node.kind === 'CHANNEL' || node.kind === 'APPROACH')) {
    const ranked = nearbyHubs(channelNode.longitude, channelNode.latitude)
      .map((node) => ({
        node,
        d: haversineMeters(
          { longitude: channelNode.longitude, latitude: channelNode.latitude },
          { longitude: node.longitude, latitude: node.latitude },
        ),
      }))
      .filter((row) => row.d > 0 && row.d <= 16_000)
      .sort((a, b) => a.d - b.d);
    let linked = 0;
    for (const row of ranked) {
      const before = seen.size;
      addEdge(channelNode, row.node, true);
      if (seen.size > before) {
        linked += 1;
        if (linked >= 4) break;
      }
    }
  }

  edges.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  return { nodes, edges };
}

export function appendPortApproachGraph(
  nodes: MaritimeGraphNode[],
  edges: MaritimeGraphEdge[],
  query: MaritimeNavigabilityQuery,
  localWindows: readonly LonLatBbox[],
): { localNodes: number; localEdges: number } {
  const beforeNodes = nodes.length;
  const beforeEdges = edges.length;
  const byPosition = new Map(
    nodes.map((node) => [`${Math.round(node.longitude * 10000)}:${Math.round(node.latitude * 10000)}`, node] as const),
  );
  const seen = new Set(edges.map((edge) => edge.edgeId));
  const addEdge = (a: MaritimeGraphNode, b: MaritimeGraphNode, portal = false) => {
    if (a.nodeId === b.nodeId) return;
    const [left, right] = a.nodeId < b.nodeId ? [a.nodeId, b.nodeId] : [b.nodeId, a.nodeId];
    const edgeId = `te.tur.sea.${left.replace('tn.tur.sea.', '')}_${right.replace('tn.tur.sea.', '')}`;
    if (seen.has(edgeId)) return;
    const lengthMeters = haversineMeters(
      { longitude: a.longitude, latitude: a.latitude },
      { longitude: b.longitude, latitude: b.latitude },
    );
    if (lengthMeters <= 0 || lengthMeters > MARITIME_MAX_EDGE_METERS) return;
    const blocked = portal
      ? !isNavigableWater((a.longitude + b.longitude) / 2, (a.latitude + b.latitude) / 2, query)
      : segmentHitsLand(
          { longitude: a.longitude, latitude: a.latitude },
          { longitude: b.longitude, latitude: b.latitude },
          query,
        );
    if (blocked) return;
    const geometry = projectLineString([
      { longitude: a.longitude, latitude: a.latitude },
      { longitude: b.longitude, latitude: b.latitude },
    ]);
    if (projectedPolylineLength(inflateProjectedLine(geometry.projectedQuantized)) === 0) return;
    seen.add(edgeId);
    edges.push({
      edgeId,
      fromNodeId: left,
      toNodeId: right,
      lengthMeters: Math.round(lengthMeters),
      channel: a.channel && a.channel === b.channel ? a.channel : null,
    });
  };

  const localIndex = new Map<string, MaritimeGraphNode>();
  const regionalIndex = new Map<string, MaritimeGraphNode>();
  const putPoint = (
    point: { longitude: number; latitude: number },
    kind: 'p' | 'l',
    nodeKind: MaritimeGraphNode['kind'],
    index: Map<string, MaritimeGraphNode>,
    step: number,
  ) => {
    if (classifyMaritimeChannel(point.longitude, point.latitude) != null) return;
    if (!isNavigableWater(point.longitude, point.latitude, query)) return;
    const posKey = `${Math.round(point.longitude * 10000)}:${Math.round(point.latitude * 10000)}`;
    let node = byPosition.get(posKey);
    if (!node) {
      node = {
        nodeId: maritimeNodeId(kind, point.longitude, point.latitude),
        longitude: point.longitude,
        latitude: point.latitude,
        region: classifyMaritimeRegion(point.longitude, point.latitude),
        channel: classifyMaritimeChannel(point.longitude, point.latitude),
        kind: nodeKind,
      };
      nodes.push(node);
      byPosition.set(posKey, node);
    }
    index.set(`${indexOf(point.longitude, 0, step)}:${indexOf(point.latitude, 0, step)}`, node);
  };

  for (const box of PORT_REGIONAL_APPROACH_BOXES) {
    for (const point of gridPoints(box, APPROACH_STEP_DEG)) {
      putPoint(point, 'p', 'APPROACH', regionalIndex, APPROACH_STEP_DEG);
    }
  }
  for (const box of localWindows) {
    for (const point of gridPoints(box, PORT_LOCAL_STEP_DEG)) {
      putPoint(point, 'l', 'LOCAL', localIndex, PORT_LOCAL_STEP_DEG);
    }
  }

  const connectIndex = (index: Map<string, MaritimeGraphNode>) => {
    for (const [key, node] of index) {
      const [ixRaw, iyRaw] = key.split(':');
      const ix = Number(ixRaw);
      const iy = Number(iyRaw);
      for (const [dx, dy] of neighborOffsets(true)) {
        const neighbor = index.get(`${ix + dx}:${iy + dy}`);
        if (neighbor) addEdge(node, neighbor);
      }
    }
  };
  connectIndex(regionalIndex);
  connectIndex(localIndex);

  const hubCell = 0.08;
  const hubBuckets = new Map<string, MaritimeGraphNode[]>();
  const coarseBuckets = new Map<string, MaritimeGraphNode[]>();
  const bucketKey = (longitude: number, latitude: number) =>
    `${Math.floor(longitude / hubCell)}:${Math.floor(latitude / hubCell)}`;
  const pushBucket = (map: Map<string, MaritimeGraphNode[]>, node: MaritimeGraphNode) => {
    const key = bucketKey(node.longitude, node.latitude);
    const bucket = map.get(key);
    if (bucket) bucket.push(node);
    else map.set(key, [node]);
  };
  for (const hub of nodes.filter((node) => node.kind === 'COARSE' || node.kind === 'CHANNEL' || node.kind === 'APPROACH')) {
    pushBucket(hubBuckets, hub);
  }
  for (const hub of nodes.filter((node) => node.kind === 'COARSE' || node.kind === 'CHANNEL')) {
    pushBucket(coarseBuckets, hub);
  }
  const nearbyFrom = (map: Map<string, MaritimeGraphNode[]>, longitude: number, latitude: number, reach: number) => {
    const ix = Math.floor(longitude / hubCell);
    const iy = Math.floor(latitude / hubCell);
    const nearby: MaritimeGraphNode[] = [];
    for (let dx = -reach; dx <= reach; dx += 1) {
      for (let dy = -reach; dy <= reach; dy += 1) {
        const bucket = map.get(`${ix + dx}:${iy + dy}`);
        if (bucket) nearby.push(...bucket);
      }
    }
    return nearby;
  };
  const linkRanked = (from: MaritimeGraphNode, candidates: MaritimeGraphNode[], maxLinks: number, maxMeters: number, portal: boolean) => {
    const ranked = candidates
      .map((node) => ({
        node,
        d: haversineMeters(
          { longitude: from.longitude, latitude: from.latitude },
          { longitude: node.longitude, latitude: node.latitude },
        ),
      }))
      .filter((row) => row.d > 0 && row.d <= maxMeters)
      .sort((a, b) => a.d - b.d);
    let linked = 0;
    for (const row of ranked) {
      const before = seen.size;
      addEdge(from, row.node, portal);
      if (seen.size > before) {
        linked += 1;
        if (linked >= maxLinks) break;
      }
    }
    return linked;
  };
  for (const local of localIndex.values()) {
    linkRanked(local, nearbyFrom(hubBuckets, local.longitude, local.latitude, 1), 3, 16_000, true);
  }
  const regionalSeen = new Set<string>();
  for (const regional of regionalIndex.values()) {
    if (regionalSeen.has(regional.nodeId)) continue;
    regionalSeen.add(regional.nodeId);
    linkRanked(regional, nearbyFrom(coarseBuckets, regional.longitude, regional.latitude, 2), 2, 18_000, false);
  }

  nodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  edges.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  return { localNodes: nodes.length - beforeNodes, localEdges: edges.length - beforeEdges };
}

export function toTransportRecords(nodes: MaritimeGraphNode[], edges: MaritimeGraphEdge[]): {
  nodes: GeoTransportNodeRecord[];
  edges: GeoTransportEdgeRecord[];
} {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  return {
    nodes: nodes.map((node) => ({
      nodeId: node.nodeId,
      mode: 'SEA' as const,
      kind: 'SEA_WAYPOINT' as const,
      geoCountryId: 'country.tur',
      coordinate: { longitude: node.longitude, latitude: node.latitude },
      projected: projectWgs84ToNormalizedMercator(node.longitude, node.latitude),
      sourceMetadata: {
        region: node.region,
        channel: node.channel,
        grid: node.kind,
      },
    })),
    edges: edges.map((edge) => {
      const from = byId.get(edge.fromNodeId)!;
      const to = byId.get(edge.toNodeId)!;
      return {
        edgeId: edge.edgeId,
        mode: 'SEA' as const,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        geometry: projectLineString([
          { longitude: from.longitude, latitude: from.latitude },
          { longitude: to.longitude, latitude: to.latitude },
        ]),
        lengthMeters: edge.lengthMeters,
        networkLod: edge.channel ? 'NETWORK_HIGH' : 'NETWORK_LOW',
        attributes: { channel: edge.channel, region: from.region },
        sourceMetadata: { graph: 'hybrid-water-grid' },
      };
    }),
  };
}

function tryLandFreeTrunkLink(
  access: MaritimeGraphNode,
  nodes: MaritimeGraphNode[],
  edges: MaritimeGraphEdge[],
  query: MaritimeNavigabilityQuery,
  trunkNodeIds: ReadonlySet<string>,
): boolean {
  const ranked = nodes
    .filter((node) => node.nodeId !== access.nodeId && trunkNodeIds.has(node.nodeId))
    .map((node) => ({
      node,
      d: haversineMeters(
        { longitude: access.longitude, latitude: access.latitude },
        { longitude: node.longitude, latitude: node.latitude },
      ),
    }))
    .filter((row) => row.d >= 75 && row.d <= MARITIME_MAX_EDGE_METERS)
    .sort((a, b) => a.d - b.d);
  for (const row of ranked.slice(0, 12)) {
    if (
      segmentHitsLand(
        { longitude: access.longitude, latitude: access.latitude },
        { longitude: row.node.longitude, latitude: row.node.latitude },
        query,
      )
    ) {
      continue;
    }
    const geometry = projectLineString([
      { longitude: access.longitude, latitude: access.latitude },
      { longitude: row.node.longitude, latitude: row.node.latitude },
    ]);
    if (projectedPolylineLength(inflateProjectedLine(geometry.projectedQuantized)) === 0) continue;
    const [left, right] = access.nodeId < row.node.nodeId ? [access.nodeId, row.node.nodeId] : [row.node.nodeId, access.nodeId];
    const edgeId = `te.tur.sea.${left.replace('tn.tur.sea.', '')}_${right.replace('tn.tur.sea.', '')}`;
    if (!edges.some((edge) => edge.edgeId === edgeId)) {
      edges.push({
        edgeId,
        fromNodeId: left,
        toNodeId: right,
        lengthMeters: Math.round(row.d),
        channel: access.channel && access.channel === row.node.channel ? access.channel : null,
      });
    }
    return true;
  }
  return false;
}

export function attachPortAccessNode(
  nodes: MaritimeGraphNode[],
  edges: MaritimeGraphEdge[],
  point: { longitude: number; latitude: number },
  query: MaritimeNavigabilityQuery,
  trunkNodeIds?: ReadonlySet<string>,
): MaritimeGraphNode | null {
  const nodeId = maritimeNodeId('a', point.longitude, point.latitude);
  const posKey = `${Math.round(point.longitude * 10000)}:${Math.round(point.latitude * 10000)}`;
  const projected = projectWgs84ToNormalizedMercator(point.longitude, point.latitude);
  const [qx, qy] = quantizeProjectedPoint(projected);
  const quantKey = `${qx}:${qy}`;
  const accept = (node: MaritimeGraphNode): MaritimeGraphNode | null => {
    if (!trunkNodeIds) return node;
    if (trunkNodeIds.has(node.nodeId)) return node;
    return tryLandFreeTrunkLink(node, nodes, edges, query, trunkNodeIds) ? node : null;
  };
  const existingQuant = nodes.find((node) => {
    const p = projectWgs84ToNormalizedMercator(node.longitude, node.latitude);
    const [nx, ny] = quantizeProjectedPoint(p);
    return `${nx}:${ny}` === quantKey;
  });
  if (existingQuant) return accept(existingQuant);
  const existing =
    nodes.find((node) => node.nodeId === nodeId) ??
    nodes.find(
      (node) => `${Math.round(node.longitude * 10000)}:${Math.round(node.latitude * 10000)}` === posKey,
    );
  if (existing) return accept(existing);
  const close = nodes.find((node) => {
    const d = haversineMeters(point, { longitude: node.longitude, latitude: node.latitude });
    return d > 0 && d < 75;
  });
  if (close) return accept(close);
  const access: MaritimeGraphNode = {
    nodeId,
    longitude: point.longitude,
    latitude: point.latitude,
    region: classifyMaritimeRegion(point.longitude, point.latitude),
    channel: classifyMaritimeChannel(point.longitude, point.latitude),
    kind: 'PORT_ACCESS',
  };
  nodes.push(access);
  if (!trunkNodeIds) {
    const idx = nodes.findIndex((node) => node.nodeId === access.nodeId);
    if (idx >= 0) nodes.splice(idx, 1);
    return null;
  }
  if (tryLandFreeTrunkLink(access, nodes, edges, query, trunkNodeIds)) return access;
  const idx = nodes.findIndex((node) => node.nodeId === access.nodeId);
  if (idx >= 0) nodes.splice(idx, 1);
  return null;
}
