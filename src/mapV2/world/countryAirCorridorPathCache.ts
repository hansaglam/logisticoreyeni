import { Skia, type SkPath } from '@shopify/react-native-skia';

import type { CompactPlayerAirCorridor } from '../geo/playerFacingAirCorridor';
import { airCorridorProjectedPoints } from './countryAirCorridorLoader';

const geometryCache = new Map<string, { x: number; y: number }[]>();
const pathCache = new Map<string, SkPath>();

function geometryKey(contentHash: string, corridorId: string): string {
  return `${contentHash}:${corridorId}`;
}

export function getCachedAirCorridorPoints(
  contentHash: string,
  corridor: CompactPlayerAirCorridor,
): { x: number; y: number }[] {
  const key = geometryKey(contentHash, corridor.id);
  const hit = geometryCache.get(key);
  if (hit) return hit;
  const points = airCorridorProjectedPoints(corridor);
  geometryCache.set(key, points);
  return points;
}

export function getCachedAirCorridorPath(contentHash: string, corridor: CompactPlayerAirCorridor): SkPath | null {
  const key = geometryKey(contentHash, corridor.id);
  const hit = pathCache.get(key);
  if (hit) return hit;
  const points = getCachedAirCorridorPoints(contentHash, corridor);
  if (points.length < 2) return null;
  const path = Skia.Path.Make();
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    path.lineTo(points[i].x, points[i].y);
  }
  pathCache.set(key, path);
  return path;
}

export function composeAirCorridorBatchPath(
  contentHash: string,
  corridors: readonly CompactPlayerAirCorridor[],
): SkPath | null {
  if (corridors.length === 0) return null;
  const path = Skia.Path.Make();
  let added = 0;
  for (const corridor of corridors) {
    const piece = getCachedAirCorridorPath(contentHash, corridor);
    if (!piece) continue;
    path.addPath(piece);
    added += 1;
  }
  return added > 0 ? path : null;
}
