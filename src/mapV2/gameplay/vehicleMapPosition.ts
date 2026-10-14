import type { TruckStatus } from '../../types/game';
import { resolveStationaryTruckCityId } from './fleetLocation';

export type MapPoint = { x: number; y: number };

export type VehicleMapPlacement =
  | {
      kind: 'city';
      gameplayCityId: string;
      x: number;
      y: number;
    }
  | {
      kind: 'route';
      originCityId: string;
      destinationCityId: string;
      progress: number;
      x: number;
      y: number;
      completed: MapPoint[];
      remaining: MapPoint[];
    }
  | {
      kind: 'corridor';
      originCityId: string;
      destinationCityId: string;
      points: MapPoint[];
    }
  | {
      kind: 'status-only';
      originCityId: string | null;
      destinationCityId: string | null;
    };

const MOVING_STATUSES = new Set<TruckStatus>(['on_route', 'transferring']);

export function pointAlongPolyline(
  points: readonly MapPoint[],
  progress: number,
): { point: MapPoint; completed: MapPoint[]; remaining: MapPoint[] } | null {
  if (points.length < 2) return null;
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    lengths.push(distance);
    total += distance;
  }
  if (total <= 0) return null;
  const clamped = Math.min(1, Math.max(0, progress));
  let target = total * clamped;
  const completed: MapPoint[] = [{ ...points[0] }];
  for (let index = 0; index < lengths.length; index += 1) {
    const segment = lengths[index];
    const start = points[index];
    const end = points[index + 1];
    if (target <= segment || index === lengths.length - 1) {
      const share = segment <= 0 ? 1 : Math.min(1, target / segment);
      const point = {
        x: start.x + (end.x - start.x) * share,
        y: start.y + (end.y - start.y) * share,
      };
      completed.push(point);
      return {
        point,
        completed,
        remaining: [point, ...points.slice(index + 1).map((row) => ({ ...row }))],
      };
    }
    target -= segment;
    completed.push({ ...end });
  }
  const last = points[points.length - 1];
  return { point: { ...last }, completed: points.map((row) => ({ ...row })), remaining: [{ ...last }] };
}

/**
 * Map position for one truck.
 * Stationary trucks use the shared city rule.
 * Moving trucks are placed only when a real corridor polyline and a stored progress exist.
 * No timer and no invented road geometry.
 */
export function resolveVehicleMapPosition(input: {
  status: TruckStatus;
  currentCityId?: string | null;
  homeCityId?: string | null;
  originCityId?: string | null;
  destinationCityId?: string | null;
  progress?: number | null;
  cityPoint?: MapPoint | null;
  corridorPoints?: readonly MapPoint[] | null;
}): VehicleMapPlacement {
  const originCityId = input.originCityId ?? null;
  const destinationCityId = input.destinationCityId ?? null;
  if (MOVING_STATUSES.has(input.status)) {
    const corridor = input.corridorPoints;
    if (!originCityId || !destinationCityId || !corridor || corridor.length < 2) {
      return { kind: 'status-only', originCityId, destinationCityId };
    }
    if (typeof input.progress !== 'number' || !Number.isFinite(input.progress)) {
      return { kind: 'corridor', originCityId, destinationCityId, points: corridor.map((point) => ({ ...point })) };
    }
    const along = pointAlongPolyline(corridor, input.progress);
    if (!along) {
      return { kind: 'status-only', originCityId, destinationCityId };
    }
    return {
      kind: 'route',
      originCityId,
      destinationCityId,
      progress: Math.min(1, Math.max(0, input.progress)),
      x: along.point.x,
      y: along.point.y,
      completed: along.completed,
      remaining: along.remaining,
    };
  }
  const gameplayCityId = resolveStationaryTruckCityId({
    status: input.status,
    currentCityId: input.currentCityId,
    homeCityId: input.homeCityId,
  });
  if (!gameplayCityId || !input.cityPoint) {
    return { kind: 'status-only', originCityId: null, destinationCityId: null };
  }
  return {
    kind: 'city',
    gameplayCityId,
    x: input.cityPoint.x,
    y: input.cityPoint.y,
  };
}
