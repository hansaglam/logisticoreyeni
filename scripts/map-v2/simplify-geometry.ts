import type { GeometryLodId, ProjectedPolygon } from '../../src/mapV2/geo/geometry';
import { closeRing, ringAreaAbs, validateProjectedRing } from '../../src/mapV2/geo/geometry';
import { simplifyRing } from '../../src/mapV2/geo/simplifyRing';
import { LOD_MAX_POLYGONS_PER_COUNTRY, LOD_MAX_RING_VERTICES, LOD_MIN_POLYGON_AREA, LOD_SIMPLIFY_TOLERANCE } from './config';

function capRing(ring: { x: number; y: number }[], maxVertices: number): { x: number; y: number }[] {
  const closed = closeRing(ring);
  const openLen = closed.length - 1;
  if (openLen <= maxVertices) return closed;
  const keep = Math.max(3, maxVertices - 1);
  const sampled: { x: number; y: number }[] = [];
  for (let i = 0; i < keep; i += 1) {
    const idx = Math.round((i * (openLen - 1)) / (keep - 1));
    sampled.push(closed[idx]);
  }
  return closeRing(sampled);
}

export function simplifyPolygons(polygons: ProjectedPolygon[], lod: GeometryLodId): ProjectedPolygon[] {
  const tolerance = LOD_SIMPLIFY_TOLERANCE[lod];
  const maxVerts = LOD_MAX_RING_VERTICES[lod];
  const out: ProjectedPolygon[] = [];
  for (const polygon of polygons) {
    let exterior = closeRing(simplifyRing(polygon.exterior, tolerance));
    if (validateProjectedRing(exterior) != null) {
      exterior = capRing(polygon.exterior, maxVerts);
    } else {
      exterior = capRing(exterior, maxVerts);
    }
    if (validateProjectedRing(exterior) != null) {
      out.push({
        exterior: capRing(polygon.exterior, maxVerts),
        holes: polygon.holes.map((hole) => capRing(hole, Math.max(8, Math.floor(maxVerts / 3)))),
      });
      continue;
    }
    const holes: typeof polygon.holes = [];
    for (const hole of polygon.holes) {
      let simplified = closeRing(simplifyRing(hole, tolerance));
      if (validateProjectedRing(simplified) != null) {
        simplified = capRing(hole, Math.max(8, Math.floor(maxVerts / 3)));
      } else {
        simplified = capRing(simplified, Math.max(8, Math.floor(maxVerts / 3)));
      }
      if (validateProjectedRing(simplified) == null && ringAreaAbs(simplified) > 0) {
        holes.push(simplified);
      }
    }
    out.push({ exterior, holes });
  }
  return out;
}

/** Keep every country: if simplification empties geometry, restore source polygons. */
export function simplifyCountryPolygons(
  polygons: ProjectedPolygon[],
  lod: GeometryLodId,
): ProjectedPolygon[] {
  const simplified = simplifyPolygons(polygons, lod).filter((polygon) => ringAreaAbs(polygon.exterior) > 0);
  const source = simplified.length === 0 ? polygons : simplified;
  const ranked = [...source].sort((a, b) => ringAreaAbs(b.exterior) - ringAreaAbs(a.exterior));
  const minArea = LOD_MIN_POLYGON_AREA[lod];
  const maxPolys = LOD_MAX_POLYGONS_PER_COUNTRY[lod];
  const kept: ProjectedPolygon[] = [];
  for (const polygon of ranked) {
    if (kept.length === 0 || ringAreaAbs(polygon.exterior) >= minArea) {
      kept.push(polygon);
    }
    if (kept.length >= maxPolys) break;
  }
  return kept.length > 0 ? kept : [ranked[0]];
}
