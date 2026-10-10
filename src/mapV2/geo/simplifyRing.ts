/**
 * Radial-distance Douglas–Peucker in projected world space.
 * Never drops a ring below 4 closed vertices; caller must keep at least one polygon per country.
 */
export function simplifyRing(ring: { x: number; y: number }[], tolerance: number): { x: number; y: number }[] {
  if (ring.length <= 4 || tolerance <= 0) {
    return ring;
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first.x === last.x && first.y === last.y;
  const open = closed ? ring.slice(0, -1) : ring.slice();
  const kept = douglasPeucker(open, tolerance);
  if (kept.length < 3) {
    return ring;
  }
  const next = closed ? [...kept, { x: kept[0].x, y: kept[0].y }] : kept;
  if (next.length < 4) return ring;
  return next;
}

function douglasPeucker(
  points: { x: number; y: number }[],
  tolerance: number,
): { x: number; y: number }[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      index = i;
      maxDist = dist;
    }
  }
  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, index + 1), tolerance);
    const right = douglasPeucker(points.slice(index), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [start, end];
}

function perpendicularDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}
