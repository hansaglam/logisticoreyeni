import {
  contentFitScale,
  type CameraContentBounds,
} from '../geo/worldCamera';
import type { MapScope } from './mapLodPolicy';

/**
 * Scale is pixels per normalized world unit.
 * contentFitScale fills the frame bounds exactly.
 * The composed fit is a fraction of that, and the pinch minimum is lower still.
 */

/** Share of the limiting viewport axis used by the framed geography. */
export const WORLD_FRAME_COVERAGE = 0.82;
export const COUNTRY_FRAME_COVERAGE = 0.86;

/** How far pinch-out may go, as a fraction of the composed fit. */
export const WORLD_ZOOM_OUT_FROM_FIT = 0.78;
export const COUNTRY_ZOOM_OUT_FROM_FIT = 0.74;

/** How far pinch-in may go, as a multiple of the composed fit. */
export const WORLD_ZOOM_IN_FROM_FIT = 8;
export const COUNTRY_ZOOM_IN_FROM_FIT = 2.8;

/** Extra geographic margin before the pan clamp. */
export const MAP_WORLD_PAN_MARGIN = 0.08;
export const MAP_COUNTRY_PAN_MARGIN = 0.1;

export const MAP_WORLD_FRAME_PADDING = coverageToPadding(WORLD_FRAME_COVERAGE);
export const MAP_COUNTRY_FRAME_PADDING = coverageToPadding(COUNTRY_FRAME_COVERAGE);

export function coverageToPadding(coverage: number): number {
  const safe = Math.min(0.94, Math.max(0.55, coverage));
  return (1 / safe - 1) / 2;
}

export function expandPanBounds<T extends { minX: number; minY: number; maxX: number; maxY: number }>(
  bounds: T,
  margin = MAP_COUNTRY_PAN_MARGIN,
): T {
  const padX = Math.max(bounds.maxX - bounds.minX, 0) * margin;
  const padY = Math.max(bounds.maxY - bounds.minY, 0) * margin;
  return {
    ...bounds,
    minX: bounds.minX - padX,
    minY: bounds.minY - padY,
    maxX: bounds.maxX + padX,
    maxY: bounds.maxY + padY,
  };
}

export type CameraScalePlan = {
  fitScale: number;
  minScale: number;
  maxScale: number;
  framePadding: number;
  panBounds: CameraContentBounds;
  /** Factors for clampWorldCamera against panBounds. */
  minScaleFactor: number;
  maxScaleFactor: number;
};

export function resolveCameraScalePlan(input: {
  scope: MapScope;
  viewportWidth: number;
  viewportHeight: number;
  frameBounds: CameraContentBounds;
}): CameraScalePlan {
  const country = input.scope !== 'WORLD';
  const coverage = country ? COUNTRY_FRAME_COVERAGE : WORLD_FRAME_COVERAGE;
  const zoomOut = country ? COUNTRY_ZOOM_OUT_FROM_FIT : WORLD_ZOOM_OUT_FROM_FIT;
  const zoomIn = country ? COUNTRY_ZOOM_IN_FROM_FIT : WORLD_ZOOM_IN_FROM_FIT;
  const frameFit = contentFitScale(input.viewportWidth, input.viewportHeight, input.frameBounds);
  const fitScale = frameFit * coverage;
  const minScale = fitScale * zoomOut;
  const maxScale = Math.max(fitScale * zoomIn, minScale);
  const panBounds = expandPanBounds(input.frameBounds, country ? MAP_COUNTRY_PAN_MARGIN : MAP_WORLD_PAN_MARGIN);
  const panFit = contentFitScale(input.viewportWidth, input.viewportHeight, panBounds);
  const safePan = panFit > 0 ? panFit : 1;
  return {
    fitScale,
    minScale,
    maxScale,
    framePadding: coverageToPadding(coverage),
    panBounds,
    minScaleFactor: minScale / safePan,
    maxScaleFactor: maxScale / safePan,
  };
}

export function resolveCameraLimits(scope: MapScope): {
  minScaleFactor: number;
  maxScaleFactor: number;
  framePadding: number;
} {
  const country = scope !== 'WORLD';
  const coverage = country ? COUNTRY_FRAME_COVERAGE : WORLD_FRAME_COVERAGE;
  const zoomOut = country ? COUNTRY_ZOOM_OUT_FROM_FIT : WORLD_ZOOM_OUT_FROM_FIT;
  const zoomIn = country ? COUNTRY_ZOOM_IN_FROM_FIT : WORLD_ZOOM_IN_FROM_FIT;
  return {
    minScaleFactor: coverage * zoomOut,
    maxScaleFactor: coverage * zoomIn,
    framePadding: coverageToPadding(coverage),
  };
}
