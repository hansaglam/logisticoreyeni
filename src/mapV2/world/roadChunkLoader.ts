import { boundsIntersect, inflateProjectedLine, projectedLineBounds } from '../geo/transportGeometry';
import type { ProjectedBoundingBox } from '../geo/webMercator';
import type { TransportNetworkLod } from '../geo/transportNetwork';
import type { TransportRenderableEdge, TransportStyleClass } from '../presentation/transportPaint';
import {
  ROAD_CACHE_MAX_BYTES,
  ROAD_CACHE_MAX_CHUNKS,
  ROAD_PREFETCH_PAD,
  ROAD_RUNTIME_TRANSFORM_VERSION,
  ROAD_STYLE_FROM_CODE,
  cumulativeLodLayers,
  deltaDecodeQuantized,
  expandEdgeId,
  expandNodeId,
  inflateBounds,
  type RoadRuntimeChunkV1,
  type RoadRuntimeManifestV1,
} from '../geo/roadRuntimePackage';
import { ROAD_CHUNK_REGISTRY } from '../generated/transport/road/roadChunkRegistry';

/* eslint-disable @typescript-eslint/no-require-imports */
const ROAD_RUNTIME_MANIFEST = require('../generated/transport/road/manifest.json') as RoadRuntimeManifestV1;
/* eslint-enable @typescript-eslint/no-require-imports */

type CacheEntry = {
  chunk: RoadRuntimeChunkV1;
  byteSize: number;
  lastUsed: number;
};

const cache = new Map<string, CacheEntry>();
let evictionCount = 0;
let useSeq = 0;

export function getRoadRuntimeManifest(): RoadRuntimeManifestV1 {
  return ROAD_RUNTIME_MANIFEST;
}

export function getRequiredRoadChunks(args: {
  viewport: ProjectedBoundingBox;
  lod: TransportNetworkLod;
  prefetch?: boolean;
  allForLod?: boolean;
}): string[] {
  const manifest = getRoadRuntimeManifest();
  const layers = new Set(cumulativeLodLayers(args.lod));
  if (args.allForLod) {
    return manifest.chunks.filter((row) => layers.has(row.lod)).map((row) => row.id);
  }
  const query = args.prefetch ? inflateBounds(args.viewport, ROAD_PREFETCH_PAD) : args.viewport;
  return manifest.chunks
    .filter((row) => layers.has(row.lod) && boundsIntersect(row.bounds, query))
    .map((row) => row.id);
}

function touch(id: string, entry: CacheEntry): void {
  useSeq += 1;
  entry.lastUsed = useSeq;
  cache.delete(id);
  cache.set(id, entry);
}

function evictIfNeeded(pinned: ReadonlySet<string>): void {
  const byteEstimate = [...cache.values()].reduce((sum, row) => sum + row.byteSize, 0);
  const over = cache.size > ROAD_CACHE_MAX_CHUNKS || byteEstimate > ROAD_CACHE_MAX_BYTES;
  if (!over) return;
  const victims = [...cache.entries()]
    .filter(([id]) => !pinned.has(id))
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  let bytes = byteEstimate;
  for (const [id, entry] of victims) {
    if (cache.size <= ROAD_CACHE_MAX_CHUNKS && bytes <= ROAD_CACHE_MAX_BYTES) break;
    cache.delete(id);
    bytes -= entry.byteSize;
    evictionCount += 1;
  }
}

export function loadRoadChunks(chunkIds: string[]): RoadRuntimeChunkV1[] {
  const pinned = new Set(chunkIds);
  const out: RoadRuntimeChunkV1[] = [];
  for (const id of chunkIds) {
    const hit = cache.get(id);
    if (hit) {
      touch(id, hit);
      out.push(hit.chunk);
      continue;
    }
    const loader = ROAD_CHUNK_REGISTRY[id];
    if (!loader) continue;
    const chunk = loader();
    const meta = getRoadRuntimeManifest().chunks.find((row) => row.id === id);
    const entry: CacheEntry = { chunk, byteSize: meta?.byteSize ?? 0, lastUsed: 0 };
    touch(id, entry);
    out.push(chunk);
  }
  evictIfNeeded(pinned);
  return out;
}

export function evictRoadChunks(ids: string[] | 'all'): void {
  if (ids === 'all') {
    evictionCount += cache.size;
    cache.clear();
    return;
  }
  for (const id of ids) {
    if (cache.delete(id)) evictionCount += 1;
  }
}

export function getLoadedRoadChunkStats(): {
  loadedChunkCount: number;
  loadedByteEstimate: number;
  evictionCount: number;
  loadedChunkIds: string[];
  runtimeTransformVersion: string;
} {
  return {
    loadedChunkCount: cache.size,
    loadedByteEstimate: [...cache.values()].reduce((sum, row) => sum + row.byteSize, 0),
    evictionCount,
    loadedChunkIds: [...cache.keys()],
    runtimeTransformVersion: ROAD_RUNTIME_TRANSFORM_VERSION,
  };
}

export function peekLoadedRoadChunk(chunkId: string): RoadRuntimeChunkV1 | null {
  return cache.get(chunkId)?.chunk ?? null;
}

function chunkToRenderable(
  chunk: RoadRuntimeChunkV1,
  viewport: ProjectedBoundingBox | null,
  quantize: number,
): TransportRenderableEdge[] {
  const out: TransportRenderableEdge[] = [];
  for (const row of chunk.e) {
    const [hex, styleCode, _from, _to, ...encoded] = row;
    const projectedGeometry = deltaDecodeQuantized(encoded as number[]);
    if (viewport) {
      const bounds = projectedLineBounds(inflateProjectedLine(projectedGeometry, quantize));
      if (!bounds || !boundsIntersect(bounds, viewport)) continue;
    }
    out.push({
      edgeId: expandEdgeId(hex),
      mode: 'ROAD',
      projectedGeometry,
      styleClass: ROAD_STYLE_FROM_CODE[styleCode] as TransportStyleClass,
      quantizeScale: quantize,
    });
  }
  return out;
}

export function getVisibleRoadRuntimeEdges(
  viewport: ProjectedBoundingBox,
  lod: TransportNetworkLod,
  cullEnabled: boolean,
): TransportRenderableEdge[] {
  const ids = getRequiredRoadChunks({ viewport, lod, prefetch: false, allForLod: !cullEnabled });
  const quantize = getRoadRuntimeManifest().quantization;
  const query = cullEnabled ? viewport : null;
  const out: TransportRenderableEdge[] = [];
  for (const id of ids) {
    const chunk = peekLoadedRoadChunk(id);
    if (!chunk) continue;
    out.push(...chunkToRenderable(chunk, query, quantize));
  }
  return out;
}

export function getRoadChunkStyleEdges(
  chunk: RoadRuntimeChunkV1,
  styleClass: TransportStyleClass,
  quantize: number,
): TransportRenderableEdge[] {
  return chunkToRenderable(chunk, null, quantize).filter((edge) => edge.styleClass === styleClass);
}

export function findRoadRuntimeNode(nodeId: string): { chunkId: string; topologyKey: string } | null {
  const key = nodeId.startsWith('tn.tur.road.n.') ? nodeId.slice('tn.tur.road.n.'.length) : nodeId;
  for (const [chunkId, entry] of cache) {
    if (entry.chunk.n.includes(key)) {
      return { chunkId, topologyKey: expandNodeId(key) };
    }
  }
  return null;
}

export function resetRoadChunkCacheForTests(): void {
  cache.clear();
  evictionCount = 0;
  useSeq = 0;
}

export function requiredPlusPrefetchIds(viewport: ProjectedBoundingBox, lod: TransportNetworkLod, cullEnabled: boolean): {
  required: string[];
  prefetch: string[];
} {
  const required = getRequiredRoadChunks({ viewport, lod, prefetch: false, allForLod: !cullEnabled });
  const prefetch = getRequiredRoadChunks({ viewport, lod, prefetch: true, allForLod: !cullEnabled });
  return { required, prefetch };
}
