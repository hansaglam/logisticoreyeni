import {
  ROAD_CHUNKS_PER_TICK,
  ROAD_PATHS_PER_TICK,
  type RoadRuntimeChunkV1,
} from '../geo/roadRuntimePackage';
import { getRoadRuntimeManifest, loadRoadChunks, peekLoadedRoadChunk } from './roadChunkLoader';

export type RoadPerfSnapshot = {
  countrySceneMountMs: number;
  roadManifestLoadMs: number;
  chunkResolveMs: number;
  chunkJsonParseMs: number;
  pathBuildMs: number;
  firstRoadPaintMs: number;
  timeToInteractiveMs: number;
  chunksRequested: number;
  chunksLoadedThisTick: number;
  pathsBuiltThisTick: number;
  generation: number;
};

const perf: RoadPerfSnapshot = {
  countrySceneMountMs: 0,
  roadManifestLoadMs: 0,
  chunkResolveMs: 0,
  chunkJsonParseMs: 0,
  pathBuildMs: 0,
  firstRoadPaintMs: 0,
  timeToInteractiveMs: 0,
  chunksRequested: 0,
  chunksLoadedThisTick: 0,
  pathsBuiltThisTick: 0,
  generation: 0,
};

let mountOrigin = 0;
let gestureActive = false;
let scheduled = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let desiredIds: string[] = [];
let pendingIds: string[] | null = null;
let workRunning = false;
const pathQueue: Array<{ chunkId: string; styleCode: number }> = [];
let onUpdate: (() => void) | null = null;
let pathBuilder: ((chunk: RoadRuntimeChunkV1, styleCode: number) => boolean) | null = null;

export function getRoadPerfSnapshot(): RoadPerfSnapshot {
  return { ...perf, generation };
}

export function markCountrySceneMount(): void {
  mountOrigin = Date.now();
  perf.countrySceneMountMs = 0;
  perf.chunkJsonParseMs = 0;
  perf.pathBuildMs = 0;
  perf.firstRoadPaintMs = 0;
  perf.timeToInteractiveMs = 0;
  const started = Date.now();
  getRoadRuntimeManifest();
  perf.roadManifestLoadMs = Date.now() - started;
}

export function markCountryInteractive(): void {
  if (perf.timeToInteractiveMs === 0 && mountOrigin > 0) {
    perf.timeToInteractiveMs = Date.now() - mountOrigin;
  }
}

export function markFirstRoadPaint(): void {
  if (perf.firstRoadPaintMs === 0 && mountOrigin > 0) {
    perf.firstRoadPaintMs = Date.now() - mountOrigin;
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.log('[mapV2 road perf]', getRoadPerfSnapshot());
    }
  }
}

export function setRoadGestureActive(active: boolean): void {
  gestureActive = active;
  if (!active) schedule();
}

export function isRoadGestureActive(): boolean {
  return gestureActive;
}

export function setRoadSchedulerHooks(hooks: {
  onUpdate?: () => void;
  pathBuilder?: (chunk: RoadRuntimeChunkV1, styleCode: number) => boolean;
}): void {
  onUpdate = hooks.onUpdate ?? null;
  pathBuilder = hooks.pathBuilder ?? null;
}

export function requestRoadChunkLoads(ids: string[]): void {
  generation += 1;
  perf.generation = generation;
  const resolveStart = Date.now();
  desiredIds = [...ids];
  pendingIds = ids.filter((id) => !peekLoadedRoadChunk(id));
  perf.chunksRequested = ids.length;
  perf.chunkResolveMs = Date.now() - resolveStart;
  schedule();
}

export function cancelStaleRoadLoads(): void {
  generation += 1;
  perf.generation = generation;
  pendingIds = [];
  pathQueue.length = 0;
}

function schedule(): void {
  if (timer != null) return;
  scheduled = true;
  timer = setTimeout(() => {
    timer = null;
    scheduled = false;
    processRoadLoadTick();
  }, 0);
}

export function processRoadLoadTick(): { chunksLoaded: number; pathsBuilt: number; paused: boolean } {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  scheduled = false;
  perf.chunksLoadedThisTick = 0;
  perf.pathsBuiltThisTick = 0;
  if (gestureActive) {
    return { chunksLoaded: 0, pathsBuilt: 0, paused: true };
  }
  workRunning = true;
  const tickGen = generation;
  let chunksLoaded = 0;
  const queue = pendingIds;
  if (queue && queue.length > 0) {
    const batch = queue.splice(0, ROAD_CHUNKS_PER_TICK);
    const parseStart = Date.now();
    const loaded = loadRoadChunks(batch);
    perf.chunkJsonParseMs += Date.now() - parseStart;
    chunksLoaded = loaded.length;
    perf.chunksLoadedThisTick = chunksLoaded;
    for (const chunk of loaded) {
      const styles = new Set(chunk.e.map((row) => row[1]));
      for (const styleCode of styles) {
        pathQueue.push({ chunkId: chunk.id, styleCode });
      }
    }
    if (tickGen !== generation) {
      workRunning = false;
      return { chunksLoaded, pathsBuilt: 0, paused: false };
    }
  }
  let pathsBuilt = 0;
  if (pathBuilder) {
    const pathStart = Date.now();
    while (pathsBuilt < ROAD_PATHS_PER_TICK && pathQueue.length > 0) {
      if (tickGen !== generation) break;
      const job = pathQueue.shift();
      if (!job) break;
      const chunk = peekLoadedRoadChunk(job.chunkId);
      if (!chunk) continue;
      if (pathBuilder(chunk, job.styleCode)) pathsBuilt += 1;
    }
    perf.pathBuildMs += Date.now() - pathStart;
    perf.pathsBuiltThisTick = pathsBuilt;
  }
  workRunning = false;
  if (onUpdate && (chunksLoaded > 0 || pathsBuilt > 0)) onUpdate();
  const more = (pendingIds && pendingIds.length > 0) || pathQueue.length > 0;
  if (more && tickGen === generation && !gestureActive) schedule();
  return { chunksLoaded, pathsBuilt, paused: false };
}

export function hasPendingRoadWork(): boolean {
  return workRunning || scheduled || (pendingIds != null && pendingIds.length > 0) || pathQueue.length > 0;
}

export function resetRoadSchedulerForTests(): void {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  generation = 0;
  desiredIds = [];
  pendingIds = null;
  pathQueue.length = 0;
  scheduled = false;
  workRunning = false;
  gestureActive = false;
  onUpdate = null;
  pathBuilder = null;
}
