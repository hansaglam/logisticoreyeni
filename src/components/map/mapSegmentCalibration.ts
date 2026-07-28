import { useSyncExternalStore } from 'react';

import { getResolvedMapDebugFlags } from '../../config/debug';
import { getMapRoadSegmentById, type MapRoadPoint } from '../../data/mapRoadNetwork';
import { debugCalibrationPointLine, debugLog, debugWarn } from '../../utils/debugLog';

function calibrationLogsEnabled(): boolean {
  return getResolvedMapDebugFlags().calibrationLogs;
}

function calibrationVerboseEnabled(): boolean {
  return getResolvedMapDebugFlags().calibrationVerbose;
}

export type MapCalibrationMode = 'segment' | 'city' | 'off';

export interface MapCalibrationSnapshot {
  mode: MapCalibrationMode;
  enabled: boolean;
  segmentId: string | null;
  points: MapRoadPoint[];
  version: number;
}

type Listener = () => void;

let enabled = false;
let mode: MapCalibrationMode = 'off';
let activeSegmentId: string | null = null;
let points: MapRoadPoint[] = [];
let version = 0;
const listeners = new Set<Listener>();

function emit(): void {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

function getSnapshot(): MapCalibrationSnapshot {
  return {
    mode,
    enabled,
    segmentId: activeSegmentId,
    points,
    version,
  };
}

let cachedSnapshot: MapCalibrationSnapshot = getSnapshot();

function refreshSnapshot(): MapCalibrationSnapshot {
  cachedSnapshot = getSnapshot();
  emit();
  return cachedSnapshot;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): MapCalibrationSnapshot {
  return cachedSnapshot;
}

export function useMapCalibrationSession(): MapCalibrationSnapshot {
  return useSyncExternalStore(subscribe, () => cachedSnapshot, getServerSnapshot);
}

export function getMapCalibrationSnapshot(): MapCalibrationSnapshot {
  return cachedSnapshot;
}

export function getMapSegmentCalibrationPoints(): MapRoadPoint[] {
  return [...points];
}

export function getActiveCalibrationSegmentId(): string | null {
  return activeSegmentId;
}

export function addCalibrationPoint(point: MapRoadPoint): MapRoadPoint[] {
  if (!enabled) {
    debugWarn(calibrationLogsEnabled(), '[map-calibration] ignored point — calibration disabled');
    return [...points];
  }

  if (mode === 'city') {
    debugLog(calibrationLogsEnabled(), '[map-calibration:city]', point);
    debugCalibrationPointLine(
      calibrationLogsEnabled(),
      `paste into worldMapPositions.ts: { x: ${point.x.toFixed(4)}, y: ${point.y.toFixed(4)} }`,
    );
    points = [...points, point];
    refreshSnapshot();
    return [...points];
  }

  if (mode !== 'segment' || !activeSegmentId) {
    debugWarn(calibrationLogsEnabled(), '[map-calibration] no active segment session');
    return [...points];
  }

  points = [...points, point];
  refreshSnapshot();

  debugCalibrationPointLine(
    calibrationLogsEnabled(),
    `{ x: ${point.x.toFixed(4)}, y: ${point.y.toFixed(4)} },`,
  );
  debugLog(calibrationVerboseEnabled(), '[map-calibration:add]', {
    index: points.length - 1,
    point,
    segmentId: activeSegmentId,
    total: points.length,
  });

  return [...points];
}

export function undoMapSegmentCalibrationPoint(): MapRoadPoint[] {
  if (points.length === 0) {
    return [];
  }
  points = points.slice(0, -1);
  refreshSnapshot();
  debugLog(calibrationLogsEnabled(), '[map-calibration] undo — total points:', points.length);
  return [...points];
}

export function clearMapSegmentCalibrationPoints(): MapRoadPoint[] {
  points = [];
  refreshSnapshot();
  debugLog(calibrationLogsEnabled(), '[map-calibration] points cleared');
  return [];
}

export function printMapSegmentCalibrationSegment(): void {
  if (!activeSegmentId) {
    debugWarn(true, '[map-calibration] no active segment to print');
    return;
  }

  const segment = getMapRoadSegmentById(activeSegmentId);
  if (!segment) {
    debugWarn(true, `[map-calibration] Unknown segment: ${activeSegmentId}`);
    return;
  }

  const payload = {
    id: segment.id,
    fromCityId: segment.fromCityId,
    toCityId: segment.toCityId,
    isCalibrated: true,
    points: [...points],
  };

  // Explicit __mapCalibration.print() — always emit in __DEV__
  debugLog(true, '[map-calibration] paste into mapRoadNetwork.ts:');
  debugLog(true, JSON.stringify(payload, null, 2));
}

export function finishMapSegmentCalibration(): void {
  printMapSegmentCalibrationSegment();
  debugLog(true, '[map-calibration] session finished — copy output above into mapRoadNetwork.ts');
}

export function startMapSegmentCalibration(segmentId: string): boolean {
  const segment = getMapRoadSegmentById(segmentId);
  if (!segment) {
    debugWarn(calibrationLogsEnabled(), `[map-calibration] Unknown segment: ${segmentId}`);
    mode = 'off';
    activeSegmentId = null;
    refreshSnapshot();
    return false;
  }

  if (activeSegmentId && activeSegmentId !== segmentId && points.length > 0) {
    debugWarn(calibrationLogsEnabled(), '[map-calibration] switching segment — unsaved points discarded', {
      previousSegmentId: activeSegmentId,
      nextSegmentId: segmentId,
      discardedPoints: points.length,
    });
  }

  activeSegmentId = segmentId;
  mode = 'segment';
  points = [];
  refreshSnapshot();
  debugLog(calibrationLogsEnabled(), '[map-calibration] segment session started:', segmentId);
  return true;
}

export function syncMapSegmentCalibration(params: {
  enabled: boolean;
  segmentId: string | null | undefined;
}): void {
  enabled = params.enabled;

  if (!enabled) {
    mode = 'off';
    activeSegmentId = null;
    points = [];
    refreshSnapshot();
    return;
  }

  const nextSegmentId = params.segmentId ?? null;

  if (nextSegmentId) {
    if (activeSegmentId !== nextSegmentId || mode !== 'segment') {
      startMapSegmentCalibration(nextSegmentId);
    } else {
      mode = 'segment';
      refreshSnapshot();
    }
    return;
  }

  if (mode === 'segment' && points.length > 0) {
    debugWarn(calibrationLogsEnabled(), '[map-calibration] leaving segment mode — unsaved points discarded', {
      previousSegmentId: activeSegmentId,
      discardedPoints: points.length,
    });
  }

  mode = 'city';
  activeSegmentId = null;
  points = [];
  refreshSnapshot();
  debugLog(calibrationLogsEnabled(), '[map-calibration] city center mode');
}

export function logMapCalibrationInit(params: {
  enabled: boolean;
  segmentId: string | null | undefined;
}): void {
  const segmentId = params.segmentId ?? null;
  const segmentFound = segmentId ? getMapRoadSegmentById(segmentId) != null : false;
  let resolvedMode: MapCalibrationMode = 'off';
  if (params.enabled) {
    resolvedMode = segmentId ? (segmentFound ? 'segment' : 'off') : 'city';
  }

  debugLog(calibrationLogsEnabled(), '[map-calibration:init]', {
    enabled: params.enabled,
    segmentId,
    segmentFound,
    mode: resolvedMode,
  });

  if (params.enabled && segmentId && !segmentFound) {
    debugWarn(calibrationLogsEnabled(), `[map-calibration] Unknown segment: ${segmentId}`);
  }
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
      getPoints: () => MapRoadPoint[];
      points: () => MapRoadPoint[];
      getActiveSegmentId: () => string | null;
    };
  };

  globalRef.__mapCalibration = {
    clear: clearMapSegmentCalibrationPoints,
    undo: undoMapSegmentCalibrationPoint,
    print: printMapSegmentCalibrationSegment,
    finish: finishMapSegmentCalibration,
    getPoints: getMapSegmentCalibrationPoints,
    points: getMapSegmentCalibrationPoints,
    getActiveSegmentId: getActiveCalibrationSegmentId,
  };
}
