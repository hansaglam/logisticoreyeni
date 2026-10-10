/**
 * Offline ROAD corridor routing. Never imported by the player country dashboard runtime.
 * Cost is geographic edge length (meters), optionally scaled by highway class.
 */
import { highwayBase } from './roadClassPolicy';
import type { GeoTransportEdgeRecord, GeoTransportNodeRecord } from './transportNetwork';

export const ROAD_CORRIDOR_ROUTE_ALGORITHM_VERSION =
  'dijkstra-length-classweight-undirected-overview-v1' as const;

/** Modest class multipliers. Length remains the primary cost. */
export const ROAD_CORRIDOR_CLASS_WEIGHT: Record<string, number> = {
  motorway: 0.92,
  trunk: 0.95,
  primary: 1,
  secondary: 1.08,
  motorway_link: 1.05,
  trunk_link: 1.06,
  primary_link: 1.1,
  secondary_link: 1.16,
};

export type OnewayPolicy = 'OSM_TAG_DIRECTED_V1';
export const ROAD_CORRIDOR_ONEWAY_POLICY: OnewayPolicy = 'OSM_TAG_DIRECTED_V1';

export type RoutedCorridorPath = {
  nodeIds: string[];
  edgeIds: string[];
  costMetersWeighted: number;
  lengthMeters: number;
};

export type RouteHop = {
  toNodeId: string;
  edgeId: string;
  reverse: boolean;
  lengthMeters: number;
  cost: number;
};

function onewayTravel(value: unknown): 'forward' | 'reverse' | 'both' {
  if (value == null || value === '' || value === 'no' || value === 'false' || value === 0) return 'both';
  const text = String(value).trim().toLowerCase();
  if (text === '-1' || text === 'reverse') return 'reverse';
  if (text === 'yes' || text === 'true' || text === '1') return 'forward';
  return 'both';
}

export function edgeClassWeight(highway: unknown): number {
  const base = highwayBase(typeof highway === 'string' ? highway : undefined);
  const raw = typeof highway === 'string' ? highway : '';
  if (raw.includes('_link')) {
    return ROAD_CORRIDOR_CLASS_WEIGHT[raw] ?? ROAD_CORRIDOR_CLASS_WEIGHT[`${base}_link`] ?? 1.12;
  }
  return ROAD_CORRIDOR_CLASS_WEIGHT[base] ?? 1.12;
}

export function edgeTravelCost(edge: Pick<GeoTransportEdgeRecord, 'lengthMeters' | 'attributes'>): number {
  const meters = edge.lengthMeters ?? 0;
  if (!(meters > 0) || !Number.isFinite(meters)) return Number.POSITIVE_INFINITY;
  return meters * edgeClassWeight(edge.attributes.highway);
}

export function directedHopsForEdge(edge: GeoTransportEdgeRecord): RouteHop[] {
  const cost = edgeTravelCost(edge);
  if (!Number.isFinite(cost)) return [];
  const lengthMeters = edge.lengthMeters ?? 0;
  const dir = onewayTravel(edge.attributes.oneway);
  const hops: RouteHop[] = [];
  if (dir === 'forward' || dir === 'both') {
    hops.push({
      toNodeId: edge.toNodeId,
      edgeId: edge.edgeId,
      reverse: false,
      lengthMeters,
      cost,
    });
  }
  if (dir === 'reverse' || dir === 'both') {
    hops.push({
      toNodeId: edge.fromNodeId,
      edgeId: edge.edgeId,
      reverse: true,
      lengthMeters,
      cost,
    });
  }
  return hops;
}

export function buildUndirectedAdjacency(
  edges: readonly GeoTransportEdgeRecord[],
): Map<string, RouteHop[]> {
  const adj = new Map<string, RouteHop[]>();
  const push = (from: string, hop: RouteHop) => {
    const list = adj.get(from);
    if (list) list.push(hop);
    else adj.set(from, [hop]);
  };
  for (const edge of edges) {
    const cost = edgeTravelCost(edge);
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

export function buildDirectedAdjacency(
  edges: readonly GeoTransportEdgeRecord[],
): Map<string, RouteHop[]> {
  const adj = new Map<string, RouteHop[]>();
  const push = (from: string, hop: RouteHop) => {
    const list = adj.get(from);
    if (list) list.push(hop);
    else adj.set(from, [hop]);
  };
  for (const edge of edges) {
    for (const hop of directedHopsForEdge(edge)) {
      const from = hop.reverse ? edge.toNodeId : edge.fromNodeId;
      push(from, hop);
    }
  }
  return adj;
}

class MinHeap {
  private keys: number[] = [];
  private values: string[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: string): void {
    this.keys.push(key);
    this.values.push(value);
    this.bubbleUp(this.keys.length - 1);
  }

  pop(): { key: number; value: string } | null {
    if (this.keys.length === 0) return null;
    const key = this.keys[0];
    const value = this.values[0];
    const lastK = this.keys.pop()!;
    const lastV = this.values.pop()!;
    if (this.keys.length) {
      this.keys[0] = lastK;
      this.values[0] = lastV;
      this.sink(0);
    }
    return { key, value };
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.keys[parent] <= this.keys[index]) break;
      this.swap(parent, index);
      index = parent;
    }
  }

  private sink(index: number): void {
    const n = this.keys.length;
    while (true) {
      let smallest = index;
      const left = index * 2 + 1;
      const right = left + 1;
      if (left < n && this.keys[left] < this.keys[smallest]) smallest = left;
      if (right < n && this.keys[right] < this.keys[smallest]) smallest = right;
      if (smallest === index) break;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const k = this.keys[i];
    this.keys[i] = this.keys[j];
    this.keys[j] = k;
    const v = this.values[i];
    this.values[i] = this.values[j];
    this.values[j] = v;
  }
}

export function dijkstraShortestPath(
  adjacency: Map<string, RouteHop[]>,
  fromNodeId: string,
  toNodeId: string,
): RoutedCorridorPath | null {
  if (!fromNodeId || !toNodeId) return null;
  if (fromNodeId === toNodeId) {
    return { nodeIds: [fromNodeId], edgeIds: [], costMetersWeighted: 0, lengthMeters: 0 };
  }
  const dist = new Map<string, number>([[fromNodeId, 0]]);
  const prev = new Map<string, { nodeId: string; hop: RouteHop }>();
  const heap = new MinHeap();
  heap.push(0, fromNodeId);
  while (heap.size) {
    const current = heap.pop()!;
    if (current.key !== (dist.get(current.value) ?? Number.POSITIVE_INFINITY)) continue;
    if (current.value === toNodeId) break;
    const hops = adjacency.get(current.value);
    if (!hops) continue;
    for (const hop of hops) {
      const next = current.key + hop.cost;
      if (next < (dist.get(hop.toNodeId) ?? Number.POSITIVE_INFINITY)) {
        dist.set(hop.toNodeId, next);
        prev.set(hop.toNodeId, { nodeId: current.value, hop });
        heap.push(next, hop.toNodeId);
      }
    }
  }
  if (!prev.has(toNodeId) && fromNodeId !== toNodeId) return null;
  const nodeIds: string[] = [toNodeId];
  const edgeIds: string[] = [];
  let lengthMeters = 0;
  let cursor = toNodeId;
  while (cursor !== fromNodeId) {
    const step = prev.get(cursor);
    if (!step) return null;
    edgeIds.push(step.hop.edgeId);
    lengthMeters += step.hop.lengthMeters;
    cursor = step.nodeId;
    nodeIds.push(cursor);
  }
  nodeIds.reverse();
  edgeIds.reverse();
  return {
    nodeIds,
    edgeIds,
    costMetersWeighted: dist.get(toNodeId) ?? 0,
    lengthMeters,
  };
}

export function undirectedComponents(
  nodes: readonly GeoTransportNodeRecord[],
  edges: readonly GeoTransportEdgeRecord[],
): { componentOf: Map<string, string>; sizeByComponent: Map<string, number>; componentCount: number } {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let cur = parent.get(id) ?? id;
    if (!parent.has(id)) parent.set(id, id);
    while ((parent.get(cur) ?? cur) !== cur) {
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
  for (const node of nodes) find(node.nodeId);
  for (const edge of edges) unite(edge.fromNodeId, edge.toNodeId);
  const componentOf = new Map<string, string>();
  const sizeByComponent = new Map<string, number>();
  for (const node of nodes) {
    const root = find(node.nodeId);
    componentOf.set(node.nodeId, root);
    sizeByComponent.set(root, (sizeByComponent.get(root) ?? 0) + 1);
  }
  return { componentOf, sizeByComponent, componentCount: sizeByComponent.size };
}
