import type { MapRoadPoint } from '../../data/mapRoadNetwork';
import {
  getRouteMarkerPose,
  normalizeHeadingDegrees360,
  type MapBounds,
} from './mapRoadUtils';
import { VEHICLE_MARKER_ZERO_HEADING_DEG } from './mapTheme';

export interface MapVehicleHeadingResult {
  /** Screen-space route tangent before marker asset offset (degrees). */
  routeHeadingDeg: number;
  /** CSS/RN rotate value in [0, 360). */
  markerRotationDeg: number;
  markerRotationRad: number;
  position: MapRoadPoint;
  positionPx: { x: number; y: number };
  segmentIndex: number;
  segmentProgress: number;
}

/**
 * Convert a route tangent (screen-space, atan2) into marker rotation.
 * Chevron tip at rotation 0° points EAST (+X); no truck-icon calibration offset.
 */
export function routeHeadingToMarkerRotationDeg(routeHeadingDeg: number): number {
  return normalizeHeadingDegrees360(routeHeadingDeg - VEHICLE_MARKER_ZERO_HEADING_DEG);
}

/**
 * Canonical map vehicle heading — single source for marker rotation on the live map.
 */
export function getMapVehicleHeading(params: {
  routePoints: MapRoadPoint[];
  progress: number | undefined | null;
  mapBounds: MapBounds;
  previousHeadingDeg?: number;
  fallbackHeadingDeg?: number;
  lookAheadDistance?: number;
}): MapVehicleHeadingResult {
  const pose = getRouteMarkerPose({
    routePoints: params.routePoints,
    progress: params.progress,
    mapBounds: params.mapBounds,
    assetForwardAngleDeg: VEHICLE_MARKER_ZERO_HEADING_DEG,
    fallbackHeadingDeg: params.fallbackHeadingDeg,
    previousHeadingDeg: params.previousHeadingDeg,
    lookAheadDistance: params.lookAheadDistance,
  });
  return {
    routeHeadingDeg: pose.headingDeg,
    markerRotationDeg: pose.markerHeadingDeg,
    markerRotationRad: (pose.markerHeadingDeg * Math.PI) / 180,
    position: pose.position,
    positionPx: pose.positionPx,
    segmentIndex: pose.segmentIndex,
    segmentProgress: pose.segmentProgress,
  };
}
