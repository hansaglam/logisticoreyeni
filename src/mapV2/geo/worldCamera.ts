/**
 * Map V2 geographic camera in normalized world [0,1]².
 * Screen pixels are derived; they are not geographic truth.
 * V1 wrapping: clamped world bounds. No infinite horizontal wrap.
 */

export const WORLD_WRAP_MODE = 'CLAMPED_NO_WRAP' as const;

export const WORLD_MIN_SCALE_FACTOR = 0.85;
export const WORLD_MAX_SCALE = 48;
export const WORLD_NAV_MAX_SCALE_FACTOR = 12;
/** Max zoom relative to country overview fit. Modest overview range, not a free globe zoom. */
export const COUNTRY_CONTENT_MAX_SCALE_FACTOR = 1.8;
export const COUNTRY_CONTENT_MIN_SCALE_FACTOR = 1;
/** Player country overview: framed, not an explorer. */
export const COUNTRY_OVERVIEW_MAX_SCALE_FACTOR = 1.4;
export const COUNTRY_OVERVIEW_MIN_SCALE_FACTOR = 1;
export const COUNTRY_FIT_PADDING = 0.1;
/** World-mode zoom toward the selected country before the isolated scene. */
export const WORLD_ENTER_COUNTRY_MAX_SCALE_FACTOR = 24;
export const COUNTRY_ENTER_WORLD_PADDING = 0.22;
export const COUNTRY_ENTER_ZOOM_MS = 400;
export const COUNTRY_ENTER_FADE_MS = 200;
/** @deprecated Use COUNTRY_CONTENT_MAX_SCALE_FACTOR. Kept so older imports compile. */
export const COUNTRY_NAV_MAX_SCALE_FACTOR = COUNTRY_CONTENT_MAX_SCALE_FACTOR;
export const WORLD_DOUBLE_TAP_ZOOM = 2.2;
export const WORLD_GESTURE_SNAP_MS = 180;
export const CAMERA_FOCUS_MS = 320;

export type CameraContentBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export const FULL_WORLD_CONTENT_BOUNDS: CameraContentBounds = {
  minX: 0,
  minY: 0,
  maxX: 1,
  maxY: 1,
};

/** Inhabited-land framing for WORLD home. Avoids empty polar band. */
export const WORLD_INHABITED_BOUNDS = {
  minX: 0.05,
  minY: 0.22,
  maxX: 0.95,
  maxY: 0.64,
};

export type CameraSnapshot = {
  scale: number;
  translateX: number;
  translateY: number;
};

export type MapV2WorldCamera = {
  centerX: number;
  centerY: number;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
};

export function clamp(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

export function worldFitScale(viewportWidth: number, viewportHeight: number): number {
  'worklet';
  if (viewportWidth <= 0 || viewportHeight <= 0) return 1;
  return Math.min(viewportWidth, viewportHeight);
}

export function contentFitScale(
  viewportWidth: number,
  viewportHeight: number,
  bounds: CameraContentBounds,
): number {
  'worklet';
  if (viewportWidth <= 0 || viewportHeight <= 0) return 1;
  const width = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-6);
  return Math.min(viewportWidth / width, viewportHeight / height);
}

export function isFiniteCamera(cam: CameraSnapshot): boolean {
  return (
    Number.isFinite(cam.scale) &&
    Number.isFinite(cam.translateX) &&
    Number.isFinite(cam.translateY) &&
    cam.scale > 0
  );
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  translateX: number,
  translateY: number,
  scale: number,
): { x: number; y: number } {
  'worklet';
  return { x: worldX * scale + translateX, y: worldY * scale + translateY };
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  translateX: number,
  translateY: number,
  scale: number,
): { x: number; y: number } {
  'worklet';
  const safe = scale === 0 ? 1 : scale;
  return { x: (screenX - translateX) / safe, y: (screenY - translateY) / safe };
}

export function getVisibleWorldBounds(
  translateX: number,
  translateY: number,
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
  pad = 0,
): { minX: number; minY: number; maxX: number; maxY: number } {
  'worklet';
  const safe = scale === 0 ? 1 : scale;
  const minX = (0 - translateX) / safe - pad;
  const minY = (0 - translateY) / safe - pad;
  return {
    minX,
    minY,
    maxX: minX + viewportWidth / safe + pad * 2,
    maxY: minY + viewportHeight / safe + pad * 2,
  };
}

export function clampWorldCamera(input: {
  scale: number;
  translateX: number;
  translateY: number;
  viewportWidth: number;
  viewportHeight: number;
  elastic: boolean;
  maxScaleFactor?: number;
  minScaleFactor?: number;
  contentBounds?: CameraContentBounds;
}): { scale: number; translateX: number; translateY: number } {
  'worklet';
  const bounds = input.contentBounds ?? FULL_WORLD_CONTENT_BOUNDS;
  const fit = contentFitScale(input.viewportWidth, input.viewportHeight, bounds);
  const minFactor = input.minScaleFactor ?? WORLD_MIN_SCALE_FACTOR;
  const maxFactor = input.maxScaleFactor ?? WORLD_MAX_SCALE;
  const minScale = Math.max(fit * minFactor, 8);
  const maxScale = Math.max(fit * maxFactor, minScale);
  let nextScale = clamp(input.scale, minScale, maxScale);
  let tx = input.translateX;
  let ty = input.translateY;
  if (!Number.isFinite(nextScale) || !Number.isFinite(tx) || !Number.isFinite(ty) || nextScale <= 0) {
    nextScale = minScale;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    return {
      scale: nextScale,
      translateX: input.viewportWidth / 2 - cx * nextScale,
      translateY: input.viewportHeight / 2 - cy * nextScale,
    };
  }
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const contentW = Math.max(bounds.maxX - bounds.minX, 1e-6) * nextScale;
  const contentH = Math.max(bounds.maxY - bounds.minY, 1e-6) * nextScale;
  const elastic = input.elastic;
  const minTx = input.viewportWidth - bounds.maxX * nextScale;
  const maxTx = -bounds.minX * nextScale;
  const minTy = input.viewportHeight - bounds.maxY * nextScale;
  const maxTy = -bounds.minY * nextScale;
  if (contentW <= input.viewportWidth) {
    tx = input.viewportWidth / 2 - cx * nextScale;
  } else if (elastic) {
    if (tx > maxTx) tx = maxTx + (tx - maxTx) / 3;
    else if (tx < minTx) tx = minTx + (tx - minTx) / 3;
  } else {
    tx = clamp(tx, minTx, maxTx);
  }
  if (contentH <= input.viewportHeight) {
    ty = input.viewportHeight / 2 - cy * nextScale;
  } else if (elastic) {
    if (ty > maxTy) ty = maxTy + (ty - maxTy) / 3;
    else if (ty < minTy) ty = minTy + (ty - minTy) / 3;
  } else {
    ty = clamp(ty, minTy, maxTy);
  }
  return { scale: nextScale, translateX: tx, translateY: ty };
}

export function zoomToFocal(
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

export function lodForScale(scale: number, fitScale: number): 'WORLD_LOW' | 'WORLD_MEDIUM' | 'COUNTRY_HIGH' {
  const rel = fitScale <= 0 ? 1 : scale / fitScale;
  if (rel < 2.1) return 'WORLD_LOW';
  if (rel < 5.5) return 'WORLD_MEDIUM';
  return 'COUNTRY_HIGH';
}

export function cameraToFitBounds(input: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
  maxScaleFactor?: number;
  minScaleFactor?: number;
  contentBounds?: CameraContentBounds;
}): CameraSnapshot {
  const pad = input.padding ?? 0.16;
  const width = Math.max(input.maxX - input.minX, 1e-4);
  const height = Math.max(input.maxY - input.minY, 1e-4);
  const paddedW = width * (1 + pad * 2);
  const paddedH = height * (1 + pad * 2);
  const scale = Math.min(input.viewportWidth / paddedW, input.viewportHeight / paddedH);
  const cx = (input.minX + input.maxX) / 2;
  const cy = (input.minY + input.maxY) / 2;
  return clampWorldCamera({
    scale,
    translateX: input.viewportWidth / 2 - cx * scale,
    translateY: input.viewportHeight / 2 - cy * scale,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    elastic: false,
    maxScaleFactor: input.maxScaleFactor,
    minScaleFactor: input.minScaleFactor,
    contentBounds: input.contentBounds,
  });
}
