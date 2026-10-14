import type { CompactPlayerCorridor } from '../geo/playerFacingRoadCorridor';
import { corridorProjectedPoints, getTurkeyPlayerRoadCorridors } from '../world/countryRoadCorridorLoader';
import type { MapPoint } from './vehicleMapPosition';

type IndexedCorridor = {
  fromLegacyCityId: string;
  toLegacyCityId: string;
  points: MapPoint[];
  displayPriority: number;
};

let index: Map<string, IndexedCorridor> | null = null;

function pairKey(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function ensureIndex(): Map<string, IndexedCorridor> {
  if (index) return index;
  const next = new Map<string, IndexedCorridor>();
  for (const corridor of getTurkeyPlayerRoadCorridors().corridors) {
    const points = corridorProjectedPoints(corridor);
    if (points.length < 2) continue;
    remember(next, corridor, points);
  }
  index = next;
  return next;
}

function remember(target: Map<string, IndexedCorridor>, corridor: CompactPlayerCorridor, points: MapPoint[]): void {
  const key = pairKey(corridor.fromLegacyCityId, corridor.toLegacyCityId);
  const current = target.get(key);
  if (current && current.displayPriority > corridor.displayPriority) return;
  target.set(key, {
    fromLegacyCityId: corridor.fromLegacyCityId,
    toLegacyCityId: corridor.toLegacyCityId,
    points,
    displayPriority: corridor.displayPriority,
  });
}

/**
 * Player-facing corridor polyline for an exact gameplay city pair.
 * Returns null when that pair is not one of the drawn corridors.
 * Does not stitch a new path and does not read routes.ts.
 */
export function playerCorridorPointsForCityPair(originCityId: string, destinationCityId: string): MapPoint[] | null {
  if (!originCityId || !destinationCityId || originCityId === destinationCityId) return null;
  const row = ensureIndex().get(pairKey(originCityId, destinationCityId));
  if (!row) return null;
  if (row.fromLegacyCityId === originCityId && row.toLegacyCityId === destinationCityId) {
    return row.points;
  }
  if (row.fromLegacyCityId === destinationCityId && row.toLegacyCityId === originCityId) {
    return [...row.points].reverse();
  }
  return null;
}
