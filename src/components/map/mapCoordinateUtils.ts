export interface MapPoint {
  x: number;
  y: number;
}

export interface MapTransformState {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface MapContentBounds {
  width: number;
  height: number;
}

export interface ViewportToNormalizedResult {
  viewport: MapPoint;
  content: MapPoint;
  normalized: MapPoint;
  transform: MapTransformState;
  isInsideContent: boolean;
}

/** Top-left transform origin: translate then scale on content layer. */
export function viewportToContentPoint(
  viewportX: number,
  viewportY: number,
  transform: MapTransformState,
): MapPoint {
  'worklet';
  return {
    x: (viewportX - transform.translateX) / transform.scale,
    y: (viewportY - transform.translateY) / transform.scale,
  };
}

export function contentToViewportPoint(
  contentX: number,
  contentY: number,
  transform: MapTransformState,
): MapPoint {
  'worklet';
  return {
    x: contentX * transform.scale + transform.translateX,
    y: contentY * transform.scale + transform.translateY,
  };
}

export function isPointInsideContentBounds(
  contentX: number,
  contentY: number,
  bounds: MapContentBounds,
): boolean {
  'worklet';
  return (
    contentX >= 0 &&
    contentY >= 0 &&
    contentX <= bounds.width &&
    contentY <= bounds.height
  );
}

export function contentToNormalizedPoint(
  contentX: number,
  contentY: number,
  bounds: MapContentBounds,
): MapPoint {
  'worklet';
  if (bounds.width <= 0 || bounds.height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: contentX / bounds.width,
    y: contentY / bounds.height,
  };
}

export function normalizedToContentPoint(
  normalizedX: number,
  normalizedY: number,
  bounds: MapContentBounds,
): MapPoint {
  'worklet';
  return {
    x: normalizedX * bounds.width,
    y: normalizedY * bounds.height,
  };
}

export function roundMapCoordinate(value: number, decimals = 4): number {
  'worklet';
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function viewportToNormalizedMapPoint(
  viewportX: number,
  viewportY: number,
  transform: MapTransformState,
  bounds: MapContentBounds,
): ViewportToNormalizedResult {
  'worklet';
  const content = viewportToContentPoint(viewportX, viewportY, transform);
  const isInsideContent = isPointInsideContentBounds(content.x, content.y, bounds);
  const normalized = contentToNormalizedPoint(content.x, content.y, bounds);

  return {
    viewport: { x: viewportX, y: viewportY },
    content,
    normalized,
    transform: { ...transform },
    isInsideContent,
  };
}

export function normalizedMapPointToViewport(
  normalizedX: number,
  normalizedY: number,
  transform: MapTransformState,
  bounds: MapContentBounds,
): MapPoint {
  'worklet';
  const content = normalizedToContentPoint(normalizedX, normalizedY, bounds);
  return contentToViewportPoint(content.x, content.y, transform);
}

/** JS-only round-trip helper for tests and diagnostics. */
export function measureViewportRoundTripError(
  viewportX: number,
  viewportY: number,
  transform: MapTransformState,
  bounds: MapContentBounds,
): { dx: number; dy: number } {
  const mapped = viewportToNormalizedMapPoint(viewportX, viewportY, transform, bounds);
  const roundTrip = normalizedMapPointToViewport(
    mapped.normalized.x,
    mapped.normalized.y,
    transform,
    bounds,
  );
  return {
    dx: roundTrip.x - viewportX,
    dy: roundTrip.y - viewportY,
  };
}
