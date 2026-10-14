export type ProjectedPoint = { x: number; y: number };

export type CullBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** Extra margin so markers do not pop at the viewport edge. */
export const MARKER_CULL_MARGIN_FRACTION = 0.08;

export function expandCullBounds(bounds: CullBounds, fraction = MARKER_CULL_MARGIN_FRACTION): CullBounds {
  const padX = Math.max(bounds.maxX - bounds.minX, 1e-6) * fraction;
  const padY = Math.max(bounds.maxY - bounds.minY, 1e-6) * fraction;
  return {
    minX: bounds.minX - padX,
    minY: bounds.minY - padY,
    maxX: bounds.maxX + padX,
    maxY: bounds.maxY + padY,
  };
}

export function markerIntersectsViewport(point: ProjectedPoint, bounds: CullBounds, marginFraction = MARKER_CULL_MARGIN_FRACTION): boolean {
  const box = expandCullBounds(bounds, marginFraction);
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
}
