import type { RoadOverviewLowV1 } from '../geo/roadRuntimePackage';

let cached: RoadOverviewLowV1 | null = null;
let parseMs = 0;

export function getRoadOverviewLowParseMs(): number {
  return parseMs;
}

export function getRoadOverviewLow(): RoadOverviewLowV1 | null {
  if (cached) return cached;
  const started = Date.now();
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    cached = require('../generated/transport/road/turkey-road-overview-low.json') as RoadOverviewLowV1;
    /* eslint-enable @typescript-eslint/no-require-imports */
  } catch {
    cached = null;
  }
  parseMs = Date.now() - started;
  return cached;
}

export function resetRoadOverviewCacheForTests(): void {
  cached = null;
  parseMs = 0;
}
