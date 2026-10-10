import { simplifyRing } from './simplifyRing';
import type { ProjectedWorldPoint } from './webMercator';

/** Open polyline Douglas–Peucker. Always keeps first and last vertex. */
export function simplifyOpenPolyline(points: ProjectedWorldPoint[], tolerance: number): ProjectedWorldPoint[] {
  if (points.length <= 2 || tolerance <= 0) return points;
  const simplified = simplifyRing(points, tolerance);
  if (simplified.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const out = simplified.slice();
  if (out[0].x !== first.x || out[0].y !== first.y) out.unshift(first);
  const end = out[out.length - 1];
  if (end.x !== last.x || end.y !== last.y) out.push(last);
  return out;
}

/** Douglas–Peucker that never drops protected vertices (straits, obstacles). */
export function simplifyOpenPolylineProtected(
  points: ProjectedWorldPoint[],
  tolerance: number,
  protectedIndices: ReadonlySet<number>,
): ProjectedWorldPoint[] {
  if (points.length <= 2) return points;
  const cuts = new Set<number>([0, points.length - 1, ...protectedIndices]);
  const ordered = [...cuts].filter((index) => index >= 0 && index < points.length).sort((a, b) => a - b);
  const out: ProjectedWorldPoint[] = [];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const start = ordered[i];
    const end = ordered[i + 1];
    const slice = simplifyOpenPolyline(points.slice(start, end + 1), tolerance);
    for (const point of slice) {
      if (out.length && out[out.length - 1].x === point.x && out[out.length - 1].y === point.y) continue;
      out.push(point);
    }
  }
  return out.length >= 2 ? out : points;
}
