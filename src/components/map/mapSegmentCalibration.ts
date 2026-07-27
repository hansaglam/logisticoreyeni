import { getMapRoadSegmentById, type MapRoadPoint } from '../../data/mapRoadNetwork';

export interface MapSegmentCalibrationSession {
  segmentId: string;
  points: MapRoadPoint[];
}

let activeSession: MapSegmentCalibrationSession | null = null;

function requireSession(): MapSegmentCalibrationSession {
  if (!activeSession) {
    throw new Error('[map-calibration] Aktif segment oturumu yok. debug.ts mapCalibrationSegmentId ayarlayın.');
  }
  return activeSession;
}

export function startMapSegmentCalibration(segmentId: string): void {
  const segment = getMapRoadSegmentById(segmentId);
  if (!segment) {
    console.warn('[map-calibration] segment not found:', segmentId);
    return;
  }
  activeSession = { segmentId, points: [] };
  console.log('[map-calibration] segment session started:', segmentId);
  console.log('[map-calibration] commands: __mapCalibration.clear() | undo() | print() | finish()');
}

export function syncMapSegmentCalibration(segmentId: string | null | undefined): void {
  if (!segmentId) {
    activeSession = null;
    return;
  }
  if (activeSession?.segmentId !== segmentId) {
    startMapSegmentCalibration(segmentId);
  }
}

export function appendMapSegmentCalibrationPoint(point: MapRoadPoint): MapRoadPoint[] {
  const session = requireSession();
  session.points.push(point);
  console.log('[map-calibration] point added:', point, `(total=${session.points.length})`);
  return [...session.points];
}

export function undoMapSegmentCalibrationPoint(): MapRoadPoint[] {
  const session = requireSession();
  session.points.pop();
  console.log('[map-calibration] undo — total points:', session.points.length);
  return [...session.points];
}

export function clearMapSegmentCalibrationPoints(): MapRoadPoint[] {
  const session = requireSession();
  session.points = [];
  console.log('[map-calibration] points cleared');
  return [];
}

export function getMapSegmentCalibrationPoints(): MapRoadPoint[] {
  return activeSession ? [...activeSession.points] : [];
}

export function printMapSegmentCalibrationSegment(): void {
  const session = requireSession();
  const segment = getMapRoadSegmentById(session.segmentId);
  if (!segment) {
    console.warn('[map-calibration] segment not found:', session.segmentId);
    return;
  }

  const payload = {
    id: segment.id,
    fromCityId: segment.fromCityId,
    toCityId: segment.toCityId,
    isCalibrated: true,
    points: session.points,
  };

  console.log('[map-calibration] paste into mapRoadNetwork.ts:');
  console.log(JSON.stringify(payload, null, 2));
}

export function finishMapSegmentCalibration(): void {
  printMapSegmentCalibrationSegment();
  console.log('[map-calibration] session finished — copy output above into mapRoadNetwork.ts');
}

export function registerMapSegmentCalibrationDevTools(): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }

  const globalRef = globalThis as typeof globalThis & {
    __mapCalibration?: {
      clear: () => MapRoadPoint[];
      undo: () => MapRoadPoint[];
      print: () => void;
      finish: () => void;
      points: () => MapRoadPoint[];
    };
  };

  globalRef.__mapCalibration = {
    clear: clearMapSegmentCalibrationPoints,
    undo: undoMapSegmentCalibrationPoint,
    print: printMapSegmentCalibrationSegment,
    finish: finishMapSegmentCalibration,
    points: getMapSegmentCalibrationPoints,
  };
}
