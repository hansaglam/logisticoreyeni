/**
 * Offline RAIL corridor routing. Never imported by the player country dashboard.
 * Cost is geographic edge length (meters) with modest usage/service weights.
 */
import { isRailServiceDetail, OSM_RAIL_USAGE_HIGH } from './railClassPolicy';
import { dijkstraShortestPath, undirectedComponents, type RouteHop } from './roadCorridorRouting';
import type { GeoTransportEdgeRecord } from './transportNetwork';

export const RAIL_CORRIDOR_ROUTE_ALGORITHM_VERSION = 'dijkstra-length-usageweight-undirected-overview-v1' as const;
export const RAIL_CORRIDOR_COST_POLICY_VERSION = 'rail-usage-service-v1' as const;

/**
 * Length remains primary. Mainline is preferred; yards/sidings/spurs are
 * strongly discouraged except for the last metres of station access.
 */
export const RAIL_CORRIDOR_USAGE_WEIGHT: Record<string, number> = {
  main: 0.92,
  branch: 1,
};

export const RAIL_CORRIDOR_UNKNOWN_USAGE_WEIGHT = 1.04;
export const RAIL_CORRIDOR_COMMUTER_WEIGHT = 1.12;
export const RAIL_CORRIDOR_INDUSTRIAL_WEIGHT = 8;
export const RAIL_CORRIDOR_SERVICE_WEIGHT = 12;
export const RAIL_CORRIDOR_CROSSOVER_WEIGHT = 2.4;

export { dijkstraShortestPath, undirectedComponents };

export function railEdgeTravelCost(edge: Pick<GeoTransportEdgeRecord, 'lengthMeters' | 'attributes'>): number {
  const meters = edge.lengthMeters ?? 0;
  if (!(meters > 0) || !Number.isFinite(meters)) return Number.POSITIVE_INFINITY;
  return meters * railEdgeClassWeight(edge.attributes.usage, edge.attributes.service);
}

export function railEdgeClassWeight(usage: unknown, service: unknown): number {
  const serviceTag = typeof service === 'string' ? service.trim().toLowerCase() : '';
  if (serviceTag === 'yard' || serviceTag === 'siding' || serviceTag === 'spur') {
    return RAIL_CORRIDOR_SERVICE_WEIGHT;
  }
  if (serviceTag === 'crossover' || isRailServiceDetail(serviceTag)) {
    return RAIL_CORRIDOR_CROSSOVER_WEIGHT;
  }
  const usageTag = typeof usage === 'string' ? usage.trim().toLowerCase() : '';
  if (usageTag && (OSM_RAIL_USAGE_HIGH as readonly string[]).includes(usageTag)) {
    return RAIL_CORRIDOR_INDUSTRIAL_WEIGHT;
  }
  if (usageTag === 'commuter') return RAIL_CORRIDOR_COMMUTER_WEIGHT;
  if (usageTag === 'main') return RAIL_CORRIDOR_USAGE_WEIGHT.main;
  if (usageTag === 'branch') return RAIL_CORRIDOR_USAGE_WEIGHT.branch;
  return RAIL_CORRIDOR_UNKNOWN_USAGE_WEIGHT;
}

export function buildRailUndirectedAdjacency(
  edges: readonly GeoTransportEdgeRecord[],
): Map<string, RouteHop[]> {
  const adj = new Map<string, RouteHop[]>();
  const push = (from: string, hop: RouteHop) => {
    const list = adj.get(from);
    if (list) list.push(hop);
    else adj.set(from, [hop]);
  };
  for (const edge of edges) {
    const cost = railEdgeTravelCost(edge);
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
