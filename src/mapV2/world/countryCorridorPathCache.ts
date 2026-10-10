import { Skia, type SkPath } from '@shopify/react-native-skia';

import type { CompactPlayerCorridor } from '../geo/playerFacingRoadCorridor';
import { corridorProjectedPoints } from './countryRoadCorridorLoader';

const geometryCache = new Map<string, { x: number; y: number }[]>();
const pathCache = new Map<string, SkPath>();

function geometryKey(contentHash: string, corridorId: string): string {
  return `${contentHash}:${corridorId}`;
}

/** Geometry only. Never keyed by the selected city. */
export function getCachedCorridorPoints(contentHash: string, corridor: CompactPlayerCorridor): { x: number; y: number }[] {
  const key = geometryKey(contentHash, corridor.id);
  const hit = geometryCache.get(key);
  if (hit) return hit;
  const points = corridorProjectedPoints(corridor);
  geometryCache.set(key, points);
  return points;
}

export function getCachedCorridorPath(contentHash: string, corridor: CompactPlayerCorridor): SkPath | null {
  const key = geometryKey(contentHash, corridor.id);
  const hit = pathCache.get(key);
  if (hit) return hit;
  const points = getCachedCorridorPoints(contentHash, corridor);
  if (points.length < 2) return null;
  const path = Skia.Path.Make();
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    path.lineTo(points[i].x, points[i].y);
  }
  pathCache.set(key, path);
  return path;
}

/** Composes cached corridor paths. Do not store city selection in the geometry cache. */
export function composeCorridorBatchPath(
  contentHash: string,
  corridors: readonly CompactPlayerCorridor[],
): SkPath | null {
  if (corridors.length === 0) return null;
  const path = Skia.Path.Make();
  let added = 0;
  for (const corridor of corridors) {
    const piece = getCachedCorridorPath(contentHash, corridor);
    if (!piece) continue;
    path.addPath(piece);
    added += 1;
  }
  return added > 0 ? path : null;
}
