/**
 * Deterministic fictional scene — not Türkiye, not OSM, not PNG traces.
 * World: "Noxmere Archipelago" (invented).
 */

import { SPIKE_WORLD_HEIGHT, SPIKE_WORLD_WIDTH } from './spikeCamera';
import {
  cumulativeLengths,
  pointsToSvgPath,
  type SpikeVec,
} from './spikeRouteMath';

export const SPIKE_SCENE_ID = 'noxmere-archipelago-v1';

export type SpikeMarkerKind = 'hub' | 'depot' | 'waypoint';
export type SpikeMarkerScaleMode = 'map' | 'screen';
export type SpikeRouteMode = 'ROAD' | 'RAIL' | 'SEA' | 'AIR';

export type SpikeMarker = {
  id: string;
  x: number;
  y: number;
  kind: SpikeMarkerKind;
  scaleMode: SpikeMarkerScaleMode;
  locked: boolean;
  label?: string;
};

export type SpikeRoute = {
  id: string;
  mode: SpikeRouteMode;
  points: SpikeVec[];
  path: string;
  cumLen: number[];
};

const ISLAND: SpikeVec[] = [
  { x: 180, y: 220 },
  { x: 340, y: 140 },
  { x: 560, y: 110 },
  { x: 780, y: 160 },
  { x: 980, y: 250 },
  { x: 1050, y: 420 },
  { x: 960, y: 610 },
  { x: 720, y: 700 },
  { x: 430, y: 680 },
  { x: 220, y: 560 },
  { x: 140, y: 380 },
];

const REGION_VELK: SpikeVec[] = [
  { x: 260, y: 240 },
  { x: 420, y: 210 },
  { x: 430, y: 360 },
  { x: 280, y: 380 },
];

const REGION_ORRIN: SpikeVec[] = [
  { x: 560, y: 200 },
  { x: 760, y: 230 },
  { x: 740, y: 400 },
  { x: 540, y: 370 },
];

const REGION_SABLE: SpikeVec[] = [
  { x: 430, y: 430 },
  { x: 680, y: 450 },
  { x: 650, y: 620 },
  { x: 400, y: 590 },
];

const ROAD: SpikeVec[] = [
  { x: 300, y: 300 },
  { x: 420, y: 280 },
  { x: 560, y: 310 },
  { x: 700, y: 290 },
  { x: 820, y: 360 },
  { x: 880, y: 480 },
];

const RAIL: SpikeVec[] = [
  { x: 250, y: 340 },
  { x: 400, y: 420 },
  { x: 560, y: 440 },
  { x: 720, y: 500 },
  { x: 860, y: 540 },
];

const SEA: SpikeVec[] = [
  { x: 120, y: 480 },
  { x: 200, y: 620 },
  { x: 380, y: 740 },
  { x: 620, y: 760 },
  { x: 880, y: 720 },
];

const AIR: SpikeVec[] = [
  { x: 220, y: 180 },
  { x: 500, y: 160 },
  { x: 820, y: 200 },
  { x: 980, y: 320 },
];

function extraRoute(index: number): SpikeVec[] {
  const y = 180 + (index % 9) * 55;
  const x0 = 200 + (index % 5) * 30;
  return [
    { x: x0, y },
    { x: x0 + 180, y: y + 20 },
    { x: x0 + 360, y: y - 10 },
    { x: x0 + 540, y: y + 25 },
  ];
}

function makeRoute(id: string, mode: SpikeRouteMode, points: SpikeVec[]): SpikeRoute {
  return {
    id,
    mode,
    points,
    path: pointsToSvgPath(points, false),
    cumLen: cumulativeLengths(points),
  };
}

export const SPIKE_ISLAND_PATH = pointsToSvgPath(ISLAND, true);
export const SPIKE_REGION_PATHS = [
  pointsToSvgPath(REGION_VELK, true),
  pointsToSvgPath(REGION_ORRIN, true),
  pointsToSvgPath(REGION_SABLE, true),
] as const;

export const SPIKE_BASE_ROUTES: SpikeRoute[] = [
  makeRoute('road-spine', 'ROAD', ROAD),
  makeRoute('rail-spine', 'RAIL', RAIL),
  makeRoute('sea-ring', 'SEA', SEA),
  makeRoute('air-arc', 'AIR', AIR),
];

export const SPIKE_VEHICLE_ROUTE = SPIKE_BASE_ROUTES[0]!;

export const SPIKE_MARKER_COUNT_OPTIONS = [100, 250, 500, 1000] as const;
export const SPIKE_ROUTE_COUNT_OPTIONS = [5, 20, 50] as const;

function seededOffset(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Precomputed 1000 fictional markers. Slice for stress toggles. */
export function createSpikeMarkerPool(maxCount: number): SpikeMarker[] {
  const count = Math.min(1000, Math.max(0, maxCount));
  const markers: SpikeMarker[] = [];
  for (let i = 0; i < count; i += 1) {
    const col = i % 40;
    const row = Math.floor(i / 40);
    const jitterX = seededOffset(i) * 18 - 9;
    const jitterY = seededOffset(i + 91) * 18 - 9;
    const x = 220 + col * 20 + jitterX;
    const y = 180 + row * 22 + jitterY;
    const kind: SpikeMarkerKind = i % 17 === 0 ? 'hub' : i % 7 === 0 ? 'depot' : 'waypoint';
    markers.push({
      id: `nx-${i}`,
      x: Math.min(SPIKE_WORLD_WIDTH - 40, Math.max(40, x)),
      y: Math.min(SPIKE_WORLD_HEIGHT - 40, Math.max(40, y)),
      kind,
      scaleMode: kind === 'hub' ? 'map' : 'screen',
      locked: i === 42,
      label: i < 6 ? `NX-${i}` : undefined,
    });
  }
  if (markers[0]) {
    markers[0] = { ...markers[0], kind: 'hub', scaleMode: 'map', label: 'Velk' };
  }
  if (markers[1]) {
    markers[1] = { ...markers[1], kind: 'hub', scaleMode: 'map', label: 'Orrin' };
  }
  if (markers[2]) {
    markers[2] = { ...markers[2], kind: 'hub', scaleMode: 'map', label: 'Sable' };
  }
  return markers;
}

export const SPIKE_DEFAULT_SELECTED_ID = 'nx-0';

export function createSpikeRoutes(count: number): SpikeRoute[] {
  const n = Math.min(50, Math.max(4, count));
  const routes = [...SPIKE_BASE_ROUTES];
  for (let i = routes.length; i < n; i += 1) {
    const mode: SpikeRouteMode = i % 4 === 0 ? 'AIR' : i % 3 === 0 ? 'SEA' : i % 2 === 0 ? 'RAIL' : 'ROAD';
    routes.push(makeRoute(`synth-${i}`, mode, extraRoute(i)));
  }
  return routes.slice(0, n);
}

export const SPIKE_LABELS = [
  { id: 'lab-velk', x: 330, y: 270, text: 'Velk' },
  { id: 'lab-orrin', x: 620, y: 280, text: 'Orrin' },
  { id: 'lab-sable', x: 520, y: 520, text: 'Sable Reach' },
] as const;
