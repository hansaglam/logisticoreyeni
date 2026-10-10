import type { GeoTransportEdgeRecord, GeoTransportNetworkPackageV1, GeoTransportNodeRecord, TransportNetworkLod } from './transportNetwork';
import { TRANSPORT_NETWORK_SCHEMA_VERSION, edgeVisibleAtLod, transportLodRank } from './transportNetwork';
import { geometryFingerprint, inflateProjectedLine, lineHasDatelineJump, projectedPolylineLength } from './transportGeometry';

export type TransportNetworkIssue = { code: string; detail: string };

export type ConnectivityMetrics = {
  nodeCount: number;
  edgeCount: number;
  componentCount: number;
  isolatedNodeCount: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validProjected(x: number, y: number): boolean {
  return isFiniteNumber(x) && isFiniteNumber(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

function unionFind(ids: string[]): { parent: Map<string, string>; find: (id: string) => string; unite: (a: string, b: string) => void } {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let cur = parent.get(id) ?? id;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur) ?? cur;
      parent.set(cur, parent.get(next) ?? next);
      cur = next;
    }
    return cur;
  };
  const unite = (a: string, b: string) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };
  return { parent, find, unite };
}

export function measureConnectivity(nodes: GeoTransportNodeRecord[], edges: GeoTransportEdgeRecord[]): ConnectivityMetrics {
  if (nodes.length === 0) {
    return { nodeCount: 0, edgeCount: edges.length, componentCount: 0, isolatedNodeCount: 0 };
  }
  const { find, unite } = unionFind(nodes.map((node) => node.nodeId));
  const degree = new Map(nodes.map((node) => [node.nodeId, 0]));
  for (const edge of edges) {
    if (degree.has(edge.fromNodeId)) degree.set(edge.fromNodeId, (degree.get(edge.fromNodeId) ?? 0) + 1);
    if (degree.has(edge.toNodeId)) degree.set(edge.toNodeId, (degree.get(edge.toNodeId) ?? 0) + 1);
    unite(edge.fromNodeId, edge.toNodeId);
  }
  const roots = new Set(nodes.map((node) => find(node.nodeId)));
  let isolatedNodeCount = 0;
  for (const node of nodes) {
    if ((degree.get(node.nodeId) ?? 0) === 0) isolatedNodeCount += 1;
  }
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    componentCount: roots.size,
    isolatedNodeCount,
  };
}

export function validateTransportNetwork(pkg: GeoTransportNetworkPackageV1): TransportNetworkIssue[] {
  const issues: TransportNetworkIssue[] = [];
  if (pkg.schemaVersion !== TRANSPORT_NETWORK_SCHEMA_VERSION) {
    issues.push({ code: 'schema', detail: String(pkg.schemaVersion) });
  }
  if (pkg.productionApproved) {
    issues.push({ code: 'production-approved', detail: 'Step 2D packages must remain unapproved' });
  }
  if (pkg.geoCountryId !== 'country.tur') {
    issues.push({ code: 'country', detail: pkg.geoCountryId });
  }
  if (pkg.projection.id !== 'WEB_MERCATOR') {
    issues.push({ code: 'projection', detail: pkg.projection.id });
  }
  if (!pkg.contentHash.startsWith('sha256:')) {
    issues.push({ code: 'hash-format', detail: pkg.contentHash });
  }

  const nodeIds = new Set<string>();
  for (const node of pkg.nodes) {
    if (nodeIds.has(node.nodeId)) issues.push({ code: 'duplicate-node', detail: node.nodeId });
    nodeIds.add(node.nodeId);
    if (node.mode !== pkg.mode) issues.push({ code: 'node-mode', detail: node.nodeId });
    if (node.geoCountryId !== pkg.geoCountryId) {
      issues.push({ code: 'cross-country-node', detail: node.nodeId });
    }
    if (node.coordinate) {
      const { longitude, latitude } = node.coordinate;
      if (!isFiniteNumber(longitude) || !isFiniteNumber(latitude)) {
        issues.push({ code: 'node-nan', detail: node.nodeId });
      }
    }
    if (node.projected && !validProjected(node.projected.x, node.projected.y)) {
      issues.push({ code: 'node-projected', detail: node.nodeId });
    }
  }

  const edgeIds = new Set<string>();
  const fingerprints = new Map<string, string>();
  for (const edge of pkg.edges) {
    if (edgeIds.has(edge.edgeId)) issues.push({ code: 'duplicate-edge', detail: edge.edgeId });
    edgeIds.add(edge.edgeId);
    if (edge.mode !== pkg.mode) issues.push({ code: 'edge-mode', detail: edge.edgeId });
    if (edge.fromNodeId === edge.toNodeId) issues.push({ code: 'self-loop', detail: edge.edgeId });
    if (!nodeIds.has(edge.fromNodeId)) issues.push({ code: 'missing-from', detail: edge.edgeId });
    if (!nodeIds.has(edge.toNodeId)) issues.push({ code: 'missing-to', detail: edge.edgeId });
    const points = inflateProjectedLine(edge.geometry.projectedQuantized, pkg.transformation.quantize);
    if (points.length < 2 || edge.geometry.wgs84.length < 2) {
      issues.push({ code: 'geometry-short', detail: edge.edgeId });
      continue;
    }
    if (points.some((p) => !validProjected(p.x, p.y))) {
      issues.push({ code: 'edge-projected', detail: edge.edgeId });
    }
    if (edge.geometry.wgs84.some((c) => !isFiniteNumber(c.longitude) || !isFiniteNumber(c.latitude))) {
      issues.push({ code: 'edge-nan', detail: edge.edgeId });
    }
    if (projectedPolylineLength(points) === 0) {
      issues.push({ code: 'zero-length', detail: edge.edgeId });
    }
    if (lineHasDatelineJump(points)) {
      issues.push({ code: 'dateline-jump', detail: edge.edgeId });
    }
    const fp = geometryFingerprint(edge.geometry.projectedQuantized);
    const existing = fingerprints.get(fp);
    if (existing) issues.push({ code: 'duplicate-geometry', detail: `${existing}|${edge.edgeId}` });
    else fingerprints.set(fp, edge.edgeId);
  }

  for (const lod of ['NETWORK_LOW', 'NETWORK_MEDIUM', 'NETWORK_HIGH'] as TransportNetworkLod[]) {
    const visible = pkg.edges.filter((edge) => edgeVisibleAtLod(edge.networkLod, lod));
    for (const edge of visible) {
      if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
        issues.push({ code: 'lod-broken-ref', detail: `${lod}:${edge.edgeId}` });
      }
    }
  }

  const lower = pkg.edges.filter((e) => transportLodRank(e.networkLod) === 0);
  const mid = pkg.edges.filter((e) => transportLodRank(e.networkLod) <= 1);
  if (lower.length > mid.length || mid.length > pkg.edges.length) {
    issues.push({ code: 'lod-subset', detail: `${lower.length}/${mid.length}/${pkg.edges.length}` });
  }

  const metrics = measureConnectivity(pkg.nodes, pkg.edges);
  if (pkg.stats.nodeCount !== metrics.nodeCount || pkg.stats.edgeCount !== metrics.edgeCount) {
    issues.push({ code: 'stats-mismatch', detail: JSON.stringify({ expected: metrics, got: pkg.stats }) });
  }
  if (pkg.stats.componentCount !== metrics.componentCount) {
    issues.push({ code: 'component-mismatch', detail: `${pkg.stats.componentCount}!=${metrics.componentCount}` });
  }

  return issues;
}
