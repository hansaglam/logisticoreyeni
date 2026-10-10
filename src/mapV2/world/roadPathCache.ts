import { Skia, type SkPath } from '@shopify/react-native-skia';

import { inflateProjectedLine } from '../geo/transportGeometry';
import {
  ROAD_RUNTIME_TRANSFORM_VERSION,
  ROAD_STYLE_FROM_CODE,
  deltaDecodeQuantized,
  type RoadOverviewLowV1,
  type RoadRuntimeChunkV1,
} from '../geo/roadRuntimePackage';
import type { TransportStyleClass, TransportRenderableEdge } from '../presentation/transportPaint';

const cache = new Map<string, SkPath>();

export function getRoadChunkStyleBatchPathFromChunk(
  chunk: RoadRuntimeChunkV1,
  lod: string,
  styleClass: TransportStyleClass,
  quantize: number,
): SkPath | null {
  const styleCode = ROAD_STYLE_FROM_CODE.indexOf(styleClass as (typeof ROAD_STYLE_FROM_CODE)[number]);
  if (styleCode < 0) return null;
  const key = `${ROAD_RUNTIME_TRANSFORM_VERSION}:${chunk.id}:${lod}:${styleClass}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const path = Skia.Path.Make();
  let added = 0;
  for (const row of chunk.e) {
    if (row[1] !== styleCode) continue;
    const projected = deltaDecodeQuantized(row.slice(4) as number[]);
    const points = inflateProjectedLine(projected, quantize);
    if (points.length < 2) continue;
    path.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      path.lineTo(points[i].x, points[i].y);
    }
    added += 1;
  }
  if (added === 0) return null;
  cache.set(key, path);
  return path;
}

/** @deprecated Prefer getRoadChunkStyleBatchPath. Kept for tests that still batch a viewport edge list. */
export function getRoadStyleBatchPath(
  packageHash: string,
  lod: string,
  styleClass: TransportStyleClass,
  edges: TransportRenderableEdge[],
): SkPath | null {
  if (edges.length === 0) return null;
  const key = `${packageHash}:${lod}:${styleClass}:legacy:${edges.map((edge) => edge.edgeId).join('|')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const path = Skia.Path.Make();
  for (const edge of edges) {
    const points = inflateProjectedLine(edge.projectedGeometry, edge.quantizeScale);
    if (points.length < 2) continue;
    path.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      path.lineTo(points[i].x, points[i].y);
    }
  }
  cache.set(key, path);
  return path;
}

export function peekRoadChunkStylePath(chunkId: string, lod: string, styleClass: TransportStyleClass): SkPath | null {
  return cache.get(`${ROAD_RUNTIME_TRANSFORM_VERSION}:${chunkId}:${lod}:${styleClass}`) ?? null;
}

export function buildRoadChunkStylePath(
  chunk: RoadRuntimeChunkV1,
  lod: string,
  styleClass: TransportStyleClass,
  quantize: number,
): boolean {
  if (peekRoadChunkStylePath(chunk.id, lod, styleClass)) return false;
  return getRoadChunkStyleBatchPathFromChunk(chunk, lod, styleClass, quantize) != null;
}

export function peekRoadOverviewStylePath(styleClass: TransportStyleClass): SkPath | null {
  return cache.get(`${ROAD_RUNTIME_TRANSFORM_VERSION}:overview.low:${styleClass}`) ?? null;
}

export function buildRoadOverviewStylePath(overview: RoadOverviewLowV1, styleClass: TransportStyleClass): boolean {
  const key = `${ROAD_RUNTIME_TRANSFORM_VERSION}:overview.low:${styleClass}`;
  if (cache.has(key)) return false;
  const styleCode = ROAD_STYLE_FROM_CODE.indexOf(styleClass as (typeof ROAD_STYLE_FROM_CODE)[number]);
  const group = overview.styles.find((row) => row.c === styleCode);
  if (!group || group.p.length === 0) return false;
  const path = Skia.Path.Make();
  let added = 0;
  for (const encoded of group.p) {
    const projected = deltaDecodeQuantized(encoded);
    const points = inflateProjectedLine(projected, overview.quantization);
    if (points.length < 2) continue;
    path.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      path.lineTo(points[i].x, points[i].y);
    }
    added += 1;
  }
  if (added === 0) return false;
  cache.set(key, path);
  return true;
}

export function clearRoadPathCache(): void {
  cache.clear();
}

export const ROAD_STYLE_DRAW_ORDER: TransportStyleClass[] = [
  'ROAD_SECONDARY',
  'ROAD_PRIMARY',
  'ROAD_TRUNK',
  'ROAD_MOTORWAY',
];
