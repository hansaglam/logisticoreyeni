export type SpikeVec = { x: number; y: number };

export function polylineLength(points: readonly SpikeVec[]): number {
  'worklet';
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.hypot(dx, dy);
  }
  return total;
}

export function cumulativeLengths(points: readonly SpikeVec[]): number[] {
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(total);
  }
  return lengths;
}

/** Sample a polyline at normalized progress 0..1. Geometry must be stable (not rebuilt per frame). */
export function getPointAtProgress(
  points: readonly SpikeVec[],
  cumLen: readonly number[],
  progress: number,
): SpikeVec {
  'worklet';
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { x: points[0].x, y: points[0].y };
  const total = cumLen[cumLen.length - 1] || 1;
  const t = Math.min(1, Math.max(0, progress));
  const target = t * total;
  for (let i = 1; i < points.length; i += 1) {
    if (cumLen[i] >= target) {
      const span = cumLen[i] - cumLen[i - 1] || 1;
      const u = (target - cumLen[i - 1]) / span;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * u,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * u,
      };
    }
  }
  return { x: points[points.length - 1].x, y: points[points.length - 1].y };
}

export function getPointAtProgressXY(
  xs: readonly number[],
  ys: readonly number[],
  cumLen: readonly number[],
  progress: number,
): SpikeVec {
  'worklet';
  const n = xs.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return { x: xs[0], y: ys[0] };
  const total = cumLen[n - 1] || 1;
  const t = Math.min(1, Math.max(0, progress));
  const target = t * total;
  for (let i = 1; i < n; i += 1) {
    if (cumLen[i] >= target) {
      const span = cumLen[i] - cumLen[i - 1] || 1;
      const u = (target - cumLen[i - 1]) / span;
      return {
        x: xs[i - 1] + (xs[i] - xs[i - 1]) * u,
        y: ys[i - 1] + (ys[i] - ys[i - 1]) * u,
      };
    }
  }
  return { x: xs[n - 1], y: ys[n - 1] };
}

export function getHeadingAtProgressXY(
  xs: readonly number[],
  ys: readonly number[],
  cumLen: readonly number[],
  progress: number,
): number {
  'worklet';
  const n = xs.length;
  if (n < 2) return 0;
  const total = cumLen[n - 1] || 1;
  const t = Math.min(1, Math.max(0, progress));
  const target = t * total;
  for (let i = 1; i < n; i += 1) {
    if (cumLen[i] >= target) {
      return Math.atan2(ys[i] - ys[i - 1], xs[i] - xs[i - 1]);
    }
  }
  return Math.atan2(ys[n - 1] - ys[n - 2], xs[n - 1] - xs[n - 2]);
}

export function getHeadingAtProgress(
  points: readonly SpikeVec[],
  cumLen: readonly number[],
  progress: number,
): number {
  'worklet';
  if (points.length < 2) return 0;
  const total = cumLen[cumLen.length - 1] || 1;
  const t = Math.min(1, Math.max(0, progress));
  const target = t * total;
  for (let i = 1; i < points.length; i += 1) {
    if (cumLen[i] >= target) {
      return Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
    }
  }
  const last = points.length - 1;
  return Math.atan2(points[last].y - points[last - 1].y, points[last].x - points[last - 1].x);
}

export function pointsToSvgPath(points: readonly SpikeVec[], closed: boolean): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  if (closed) d += ' Z';
  return d;
}
