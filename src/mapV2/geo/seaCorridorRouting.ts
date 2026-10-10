/**
 * Offline SEA corridor routing. Never imported by the player country dashboard.
 * Cost is geographic meters with modest grid-kind weights. Local approach is
 * cheap only near the two port endpoints.
 */
import { haversineMeters } from './wgs84Distance';
import { dijkstraShortestPath, type RouteHop } from './roadCorridorRouting';
import type { GeoTransportEdgeRecord, GeoTransportNodeRecord } from './transportNetwork';
import {
  BOSPHORUS_WINDOW,
  DARDANELLES_WINDOW,
  pointInLonLatBbox,
  type MaritimeChannelId,
} from './maritimeNavigability';
import type { GeoCoordinateWgs84 } from './webMercator';

export const SEA_CORRIDOR_ROUTE_ALGORITHM_VERSION = 'dijkstra-length-gridweight-undirected-v1' as const;
export const SEA_CORRIDOR_COST_POLICY_VERSION = 'sea-trunk-channel-local-near-endpoint-v1' as const;

export const SEA_CORRIDOR_KIND_WEIGHT = {
  CHANNEL: 0.9,
  COARSE: 1,
  APPROACH: 1.08,
  LOCAL: 1.18,
  PORT_ACCESS: 1.22,
} as const;

export const SEA_CORRIDOR_FAR_LOCAL_WEIGHT = 7.5;
export const SEA_LOCAL_NEAR_ENDPOINT_METERS = 32_000;

export { dijkstraShortestPath };

function gridKind(node: GeoTransportNodeRecord | undefined): string {
  const value = node?.sourceMetadata?.grid;
  return typeof value === 'string' ? value : 'COARSE';
}

function kindWeight(kind: string): number {
  if (kind === 'CHANNEL') return SEA_CORRIDOR_KIND_WEIGHT.CHANNEL;
  if (kind === 'COARSE') return SEA_CORRIDOR_KIND_WEIGHT.COARSE;
  if (kind === 'APPROACH') return SEA_CORRIDOR_KIND_WEIGHT.APPROACH;
  if (kind === 'LOCAL') return SEA_CORRIDOR_KIND_WEIGHT.LOCAL;
  if (kind === 'PORT_ACCESS') return SEA_CORRIDOR_KIND_WEIGHT.PORT_ACCESS;
  return 1.05;
}

function nearEitherEndpoint(
  coordinate: GeoCoordinateWgs84 | undefined,
  from: GeoCoordinateWgs84,
  to: GeoCoordinateWgs84,
): boolean {
  if (!coordinate) return true;
  return (
    haversineMeters(coordinate, from) <= SEA_LOCAL_NEAR_ENDPOINT_METERS ||
    haversineMeters(coordinate, to) <= SEA_LOCAL_NEAR_ENDPOINT_METERS
  );
}

export function seaEdgeTravelCost(
  edge: Pick<GeoTransportEdgeRecord, 'lengthMeters'>,
  fromNode: GeoTransportNodeRecord | undefined,
  toNode: GeoTransportNodeRecord | undefined,
  fromPort: GeoCoordinateWgs84,
  toPort: GeoCoordinateWgs84,
): number {
  const meters = edge.lengthMeters ?? 0;
  if (!(meters > 0) || !Number.isFinite(meters)) return Number.POSITIVE_INFINITY;
  const fromKind = gridKind(fromNode);
  const toKind = gridKind(toNode);
  const localish = fromKind === 'LOCAL' || fromKind === 'PORT_ACCESS' || toKind === 'LOCAL' || toKind === 'PORT_ACCESS';
  let weight = Math.max(kindWeight(fromKind), kindWeight(toKind));
  if (localish) {
    const near =
      nearEitherEndpoint(fromNode?.coordinate, fromPort, toPort) ||
      nearEitherEndpoint(toNode?.coordinate, fromPort, toPort);
    if (!near) weight = SEA_CORRIDOR_FAR_LOCAL_WEIGHT;
  }
  return meters * weight;
}

export function buildSeaUndirectedAdjacency(
  edges: readonly GeoTransportEdgeRecord[],
  nodeById: ReadonlyMap<string, GeoTransportNodeRecord>,
  fromPort: GeoCoordinateWgs84,
  toPort: GeoCoordinateWgs84,
): Map<string, RouteHop[]> {
  const adj = new Map<string, RouteHop[]>();
  const push = (from: string, hop: RouteHop) => {
    const list = adj.get(from);
    if (list) list.push(hop);
    else adj.set(from, [hop]);
  };
  for (const edge of edges) {
    const cost = seaEdgeTravelCost(edge, nodeById.get(edge.fromNodeId), nodeById.get(edge.toNodeId), fromPort, toPort);
    if (!Number.isFinite(cost)) continue;
    const lengthMeters = edge.lengthMeters ?? 0;
    push(edge.fromNodeId, {
      toNodeId: edge.toNodeId,
      edgeId: edge.edgeId,
      reverse: false,
      lengthMeters,
      cost,
    });
    push(edge.toNodeId, {
      toNodeId: edge.fromNodeId,
      edgeId: edge.edgeId,
      reverse: true,
      lengthMeters,
      cost,
    });
  }
  return adj;
}

/**
 * Channel use from traversed CHANNEL-window geometry, not endpoint membership.
 * Bosphorus counts only if the path actually spans the strait (south mouth to north mouth).
 * Dardanelles counts only if the path spans Marmara-side to Aegean-side.
 */
export function channelsUsedFromTraversedPath(
  nodeIds: readonly string[],
  edgeIds: readonly string[],
  nodeById: ReadonlyMap<string, GeoTransportNodeRecord>,
  edgeById: ReadonlyMap<string, GeoTransportEdgeRecord>,
): MaritimeChannelId[] {
  const bosLats: number[] = [];
  const darLats: number[] = [];
  for (let i = 0; i < edgeIds.length; i += 1) {
    const edge = edgeById.get(edgeIds[i]);
    const a = nodeById.get(nodeIds[i]);
    const b = nodeById.get(nodeIds[i + 1]);
    if (!edge || !a?.coordinate || !b?.coordinate) continue;
    const tagged = edge.attributes.channel;
    if (tagged === 'BOSPHORUS' || (a.sourceMetadata?.channel === 'BOSPHORUS' && b.sourceMetadata?.channel === 'BOSPHORUS')) {
      if (
        pointInLonLatBbox(a.coordinate.longitude, a.coordinate.latitude, BOSPHORUS_WINDOW) &&
        pointInLonLatBbox(b.coordinate.longitude, b.coordinate.latitude, BOSPHORUS_WINDOW)
      ) {
        bosLats.push(a.coordinate.latitude, b.coordinate.latitude);
      }
    }
    if (tagged === 'DARDANELLES' || (a.sourceMetadata?.channel === 'DARDANELLES' && b.sourceMetadata?.channel === 'DARDANELLES')) {
      if (
        pointInLonLatBbox(a.coordinate.longitude, a.coordinate.latitude, DARDANELLES_WINDOW) &&
        pointInLonLatBbox(b.coordinate.longitude, b.coordinate.latitude, DARDANELLES_WINDOW)
      ) {
        darLats.push(a.coordinate.latitude, b.coordinate.latitude);
      }
    }
  }
  const used: MaritimeChannelId[] = [];
  if (bosLats.length && Math.min(...bosLats) <= 41.05 && Math.max(...bosLats) >= 41.18) {
    used.push('BOSPHORUS');
  }
  if (darLats.length && Math.min(...darLats) <= 40.12 && Math.max(...darLats) >= 40.28) {
    used.push('DARDANELLES');
  }
  return used;
}

export function regionsFromPath(
  nodeIds: readonly string[],
  nodeById: ReadonlyMap<string, GeoTransportNodeRecord>,
): string[] {
  const seen = new Set<string>();
  for (const id of nodeIds) {
    const region = nodeById.get(id)?.sourceMetadata?.region;
    if (typeof region === 'string' && region) seen.add(region);
  }
  return [...seen].sort();
}
