import type { MapDetailLevel } from './mapTransformUtils';
import { viewportToContentPoint as mapViewportToContentPoint } from './mapCoordinateUtils';
import {
  MAP_DETAIL_LEVEL_HIGH_FACTOR,
  MAP_DETAIL_LEVEL_MEDIUM_FACTOR,
  MAP_FIT_EPSILON,
} from './mapTheme';

export interface ClampTransformInput {
  scale: number;
  translateX: number;
  translateY: number;
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
  fitScale: number;
  fitTranslateX: number;
  fitTranslateY: number;
  maxScale: number;
  elastic?: boolean;
}

export function clampValue(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

export function isNearFitScale(scale: number, fitScale: number): boolean {
  'worklet';
  return scale <= fitScale + MAP_FIT_EPSILON;
}

/** Minimum zoom'da tam fit merkez transform; aksi halde top-left pan bounds. */
export function getClampedTransform(input: ClampTransformInput): {
  scale: number;
  translateX: number;
  translateY: number;
} {
  'worklet';
  const {
    viewportWidth,
    viewportHeight,
    contentWidth,
    contentHeight,
    fitScale,
    fitTranslateX,
    fitTranslateY,
    maxScale,
    elastic = false,
  } = input;

  const nextScale = clampValue(input.scale, fitScale, maxScale);

  if (isNearFitScale(nextScale, fitScale)) {
    return {
      scale: fitScale,
      translateX: fitTranslateX,
      translateY: fitTranslateY,
    };
  }

  const scaledW = contentWidth * nextScale;
  const scaledH = contentHeight * nextScale;

  let tx = input.translateX;
  let ty = input.translateY;

  if (scaledW <= viewportWidth) {
    tx = (viewportWidth - scaledW) / 2;
  } else {
    const minTx = viewportWidth - scaledW;
    const maxTx = 0;
    if (elastic) {
      if (tx > maxTx) tx = maxTx + (tx - maxTx) / 3;
      if (tx < minTx) tx = minTx + (tx - minTx) / 3;
    } else {
      tx = clampValue(tx, minTx, maxTx);
    }
  }

  if (scaledH <= viewportHeight) {
    ty = (viewportHeight - scaledH) / 2;
  } else {
    const minTy = viewportHeight - scaledH;
    const maxTy = 0;
    if (elastic) {
      if (ty > maxTy) ty = maxTy + (ty - maxTy) / 3;
      if (ty < minTy) ty = minTy + (ty - minTy) / 3;
    } else {
      ty = clampValue(ty, minTy, maxTy);
    }
  }

  return { scale: nextScale, translateX: tx, translateY: ty };
}

/** @deprecated getClampedTransform kullan */
export function clampMapTransform(
  scale: number,
  translateX: number,
  translateY: number,
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
  fitScale: number,
  maxScale: number,
  elastic = false,
  fitTranslateX?: number,
  fitTranslateY?: number,
): { scale: number; translateX: number; translateY: number } {
  'worklet';
  const fitTx =
    fitTranslateX ??
    (viewportWidth - contentWidth * fitScale) / 2;
  const fitTy =
    fitTranslateY ??
    (viewportHeight - contentHeight * fitScale) / 2;

  return getClampedTransform({
    scale,
    translateX,
    translateY,
    viewportWidth,
    viewportHeight,
    contentWidth,
    contentHeight,
    fitScale,
    fitTranslateX: fitTx,
    fitTranslateY: fitTy,
    maxScale,
    elastic,
  });
}

export function zoomToFocalPoint(
  focalX: number,
  focalY: number,
  startScale: number,
  startTranslateX: number,
  startTranslateY: number,
  nextScale: number,
): { translateX: number; translateY: number } {
  'worklet';
  const contentX = (focalX - startTranslateX) / startScale;
  const contentY = (focalY - startTranslateY) / startScale;
  return {
    translateX: focalX - contentX * nextScale,
    translateY: focalY - contentY * nextScale,
  };
}

export function scaleToDetailLevelWorklet(
  absoluteScale: number,
  operationalScale: number,
): MapDetailLevel {
  'worklet';
  const lowThreshold = operationalScale * MAP_DETAIL_LEVEL_MEDIUM_FACTOR;
  const highThreshold = operationalScale * MAP_DETAIL_LEVEL_HIGH_FACTOR;

  if (absoluteScale < lowThreshold) return 'low';
  if (absoluteScale < highThreshold) return 'medium';
  return 'high';
}

export function viewportToContentPoint(
  viewportX: number,
  viewportY: number,
  scale: number,
  translateX: number,
  translateY: number,
): { x: number; y: number } {
  'worklet';
  return mapViewportToContentPoint(viewportX, viewportY, { scale, translateX, translateY });
}
