import { MAX_PLAUSIBLE_RENDER_SEGMENT_DX } from './polarPolicy';
import { TRANSPORT_QUANTIZE, type GeoTransportLineString } from './transportNetwork';
import { projectWgs84ToNormalizedMercator, type GeoCoordinateWgs84, type ProjectedBoundingBox, type ProjectedWorldPoint } from './webMercator';

export function quantizeProjectedPoint(point: ProjectedWorldPoint, scale = TRANSPORT_QUANTIZE): [number, number] {
  return [Math.round(point.x * scale), Math.round(point.y * scale)];
}

export function dequantizeProjectedPoint(qx: number, qy: number, scale = TRANSPORT_QUANTIZE): ProjectedWorldPoint {
  return { x: qx / scale, y: qy / scale };
}

export function projectLineString(wgs84: GeoCoordinateWgs84[]): GeoTransportLineString {
  const projectedQuantized: number[] = [];
  for (const coord of wgs84) {
    const projected = projectWgs84ToNormalizedMercator(coord.longitude, coord.latitude);
    const [qx, qy] = quantizeProjectedPoint(projected);
    projectedQuantized.push(qx, qy);
  }
  return { wgs84, projectedQuantized };
}

export function inflateProjectedLine(quantized: number[], scale = TRANSPORT_QUANTIZE): ProjectedWorldPoint[] {
  const out: ProjectedWorldPoint[] = [];
  for (let i = 0; i + 1 < quantized.length; i += 2) {
    out.push(dequantizeProjectedPoint(quantized[i], quantized[i + 1], scale));
  }
  return out;
}

export function projectedLineBounds(points: ProjectedWorldPoint[]): ProjectedBoundingBox | null {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function boundsIntersect(a: ProjectedBoundingBox, b: ProjectedBoundingBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function lineHasDatelineJump(points: ProjectedWorldPoint[]): boolean {
  for (let i = 1; i < points.length; i += 1) {
    if (Math.abs(points[i].x - points[i - 1].x) > MAX_PLAUSIBLE_RENDER_SEGMENT_DX) return true;
  }
  return false;
}

export function projectedPolylineLength(points: ProjectedWorldPoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    sum += Math.hypot(dx, dy);
  }
  return sum;
}

export function geometryFingerprint(quantized: number[]): string {
  return quantized.join(',');
}
