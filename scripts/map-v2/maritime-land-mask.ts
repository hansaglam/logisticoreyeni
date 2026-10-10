import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MARITIME_AOI,
  pointInLonLatBbox,
  type LonLatBbox,
} from '../../src/mapV2/geo/maritimeNavigability';
import {
  NATURAL_EARTH_LAND_RAW_REL,
  TURKEY_WATER_GEOJSON_RAW_REL,
} from '../../src/mapV2/geo/maritimeRawSource';
import { projectGeoJsonGeometry, type ProjectedPolygon } from '../../src/mapV2/geo/geometry';

type GeoJsonGeometry = { type: string; coordinates: unknown };

function hashFile(path: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function ringBbox(ring: number[][]): LonLatBbox | null {
  if (!ring.length) return null;
  let west = ring[0][0];
  let east = ring[0][0];
  let south = ring[0][1];
  let north = ring[0][1];
  for (const point of ring) {
    west = Math.min(west, point[0]);
    east = Math.max(east, point[0]);
    south = Math.min(south, point[1]);
    north = Math.max(north, point[1]);
  }
  return { west, south, east, north };
}

function bboxOverlaps(a: LonLatBbox, b: LonLatBbox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function interpolate(a: number[], b: number[], axis: 0 | 1, value: number): number[] {
  const t = (value - a[axis]) / (b[axis] - a[axis] || 1e-18);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clipRingToBbox(ring: number[][], box: LonLatBbox): number[][] {
  const planes: Array<{ axis: 0 | 1; keepMin: boolean; value: number }> = [
    { axis: 0, keepMin: true, value: box.west },
    { axis: 0, keepMin: false, value: box.east },
    { axis: 1, keepMin: true, value: box.south },
    { axis: 1, keepMin: false, value: box.north },
  ];
  let current = ring.map((point) => [point[0], point[1]]);
  if (current.length && (current[0][0] !== current[current.length - 1][0] || current[0][1] !== current[current.length - 1][1])) {
    current = [...current, current[0]];
  }
  for (const plane of planes) {
    if (current.length < 4) return [];
    const next: number[][] = [];
    for (let i = 0; i < current.length - 1; i += 1) {
      const s = current[i];
      const e = current[i + 1];
      const sIn = plane.keepMin ? s[plane.axis] >= plane.value : s[plane.axis] <= plane.value;
      const eIn = plane.keepMin ? e[plane.axis] >= plane.value : e[plane.axis] <= plane.value;
      if (eIn) {
        if (!sIn) next.push(interpolate(s, e, plane.axis, plane.value));
        next.push(e);
      } else if (sIn) {
        next.push(interpolate(s, e, plane.axis, plane.value));
      }
    }
    if (next.length && (next[0][0] !== next[next.length - 1][0] || next[0][1] !== next[next.length - 1][1])) {
      next.push(next[0]);
    }
    current = next;
  }
  return current.length >= 4 ? current : [];
}

function clipPolygonToAoi(rings: number[][][], box: LonLatBbox): number[][][] | null {
  const exteriorBox = ringBbox(rings[0] ?? []);
  if (!exteriorBox || !bboxOverlaps(exteriorBox, box)) return null;
  const clippedExt = clipRingToBbox(rings[0], box);
  if (clippedExt.length < 4) return null;
  const holes = rings.slice(1).map((ring) => clipRingToBbox(ring, box)).filter((ring) => ring.length >= 4);
  return [clippedExt, ...holes];
}

function isMarineOsmTags(props: Record<string, unknown>): boolean {
  const natural = String(props.natural ?? '');
  const water = String(props.water ?? '');
  const seamark = String(props['seamark:type'] ?? '');
  if (natural === 'strait' || natural === 'bay') return true;
  if (water === 'sea' || water === 'bay' || water === 'strait' || water === 'lagoon') return true;
  if (water === 'harbour' || water === 'harbour_basin' || water === 'dock') return true;
  if (seamark === 'harbour_basin') return true;
  return false;
}

export type MaritimeLandMask = {
  neLand: ProjectedPolygon[];
  osmMarine: ProjectedPolygon[];
  neSourceHash: `sha256:${string}`;
  osmWaterHash: `sha256:${string}`;
};

export function loadMaritimeLandMask(root: string): MaritimeLandMask {
  const nePath = resolve(root, NATURAL_EARTH_LAND_RAW_REL);
  const osmPath = resolve(root, TURKEY_WATER_GEOJSON_RAW_REL);
  if (!existsSync(nePath)) {
    throw new Error('MARITIME_NAVIGATION_BLOCKED_SOURCE missing Natural Earth 10m land');
  }
  if (!existsSync(osmPath)) {
    throw new Error('MARITIME_NAVIGATION_BLOCKED_SOURCE missing OSM water extract');
  }
  const neFc = JSON.parse(readFileSync(nePath, 'utf8')) as { features?: Array<{ geometry: GeoJsonGeometry | null }> };
  const neLand: ProjectedPolygon[] = [];
  for (const feature of neFc.features ?? []) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === 'Polygon') {
      const clipped = clipPolygonToAoi(geometry.coordinates as number[][][], MARITIME_AOI);
      if (clipped) neLand.push(...projectGeoJsonGeometry({ type: 'Polygon', coordinates: clipped }));
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates as number[][][][]) {
        const clipped = clipPolygonToAoi(polygon, MARITIME_AOI);
        if (clipped) neLand.push(...projectGeoJsonGeometry({ type: 'Polygon', coordinates: clipped }));
      }
    }
  }
  const osmFc = JSON.parse(readFileSync(osmPath, 'utf8')) as {
    features?: Array<{ geometry: GeoJsonGeometry | null; properties?: Record<string, unknown> | null }>;
  };
  const osmMarine: ProjectedPolygon[] = [];
  for (const feature of osmFc.features ?? []) {
    if (!feature.geometry || !isMarineOsmTags(feature.properties ?? {})) continue;
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue;
    osmMarine.push(...projectGeoJsonGeometry(feature.geometry));
  }
  if (neLand.length === 0) throw new Error('MARITIME_NAVIGATION_BLOCKED_SOURCE empty land mask');
  return {
    neLand,
    osmMarine,
    neSourceHash: hashFile(nePath),
    osmWaterHash: hashFile(osmPath),
  };
}

export function inMaritimeAoi(longitude: number, latitude: number): boolean {
  return pointInLonLatBbox(longitude, latitude, MARITIME_AOI);
}
