/**
 * Spike-only camera math. Synthetic canvas space, not WGS84 / PNG map.
 * Worklet-safe; not the production Map V2 camera.
 */

export const SPIKE_WORLD_WIDTH = 1200;
export const SPIKE_WORLD_HEIGHT = 800;
export const SPIKE_MIN_SCALE = 0.35;
export const SPIKE_MAX_SCALE = 4;
export const SPIKE_DOUBLE_TAP_ZOOM = 1.75;
export const SPIKE_GESTURE_SNAP_MS = 180;

export function clampSpike(value: number, min: number, max: number): number {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

export function spikeFitScale(viewportWidth: number, viewportHeight: number): number {
  'worklet';
  if (viewportWidth <= 0 || viewportHeight <= 0) return 1;
  return Math.min(
    viewportWidth / SPIKE_WORLD_WIDTH,
    viewportHeight / SPIKE_WORLD_HEIGHT,
  );
}

export function spikeFitTranslate(
  viewportWidth: number,
  viewportHeight: number,
  scale: number,
): { translateX: number; translateY: number } {
  'worklet';
  return {
    translateX: (viewportWidth - SPIKE_WORLD_WIDTH * scale) / 2,
    translateY: (viewportHeight - SPIKE_WORLD_HEIGHT * scale) / 2,
  };
}

export function clampSpikeCamera(input: {
  scale: number;
  translateX: number;
  translateY: number;
  viewportWidth: number;
  viewportHeight: number;
  elastic: boolean;
}): { scale: number; translateX: number; translateY: number } {
  'worklet';
  const fit = spikeFitScale(input.viewportWidth, input.viewportHeight);
  const minScale = Math.max(SPIKE_MIN_SCALE, fit * 0.85);
  const nextScale = clampSpike(input.scale, minScale, SPIKE_MAX_SCALE);
  const scaledW = SPIKE_WORLD_WIDTH * nextScale;
  const scaledH = SPIKE_WORLD_HEIGHT * nextScale;
  let tx = input.translateX;
  let ty = input.translateY;
  const elastic = input.elastic;
  if (scaledW <= input.viewportWidth) {
    tx = (input.viewportWidth - scaledW) / 2;
  } else {
    const minTx = input.viewportWidth - scaledW;
    const maxTx = 0;
    if (elastic) {
      if (tx > maxTx) tx = maxTx + (tx - maxTx) / 3;
      if (tx < minTx) tx = minTx + (tx - minTx) / 3;
    } else {
      tx = clampSpike(tx, minTx, maxTx);
    }
  }
  if (scaledH <= input.viewportHeight) {
    ty = (input.viewportHeight - scaledH) / 2;
  } else {
    const minTy = input.viewportHeight - scaledH;
    const maxTy = 0;
    if (elastic) {
      if (ty > maxTy) ty = maxTy + (ty - maxTy) / 3;
      if (ty < minTy) ty = minTy + (ty - minTy) / 3;
    } else {
      ty = clampSpike(ty, minTy, maxTy);
    }
  }
  return { scale: nextScale, translateX: tx, translateY: ty };
}

export function spikeZoomToFocal(
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

export function spikeVisibleWorldAabb(
  translateX: number,
  translateY: number,
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
  pad: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  'worklet';
  const safeScale = scale === 0 ? 1 : scale;
  const minX = -translateX / safeScale - pad;
  const minY = -translateY / safeScale - pad;
  return {
    minX,
    minY,
    maxX: minX + viewportWidth / safeScale + pad * 2,
    maxY: minY + viewportHeight / safeScale + pad * 2,
  };
}
