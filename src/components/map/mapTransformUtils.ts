import { getWorldMapCityPosition } from '../../data/worldMapPositions';
import {
  MAP_DETAIL_LEVEL_HIGH_FACTOR,
  MAP_DETAIL_LEVEL_MEDIUM_FACTOR,
  MAP_MAX_SCALE_FIT_FACTOR,
  MAP_MAX_SCALE_OPERATIONAL_FACTOR,
  MAP_OPERATIONAL_SCALE_MAX,
} from './mapTheme';

export type MapDetailLevel = 'low' | 'medium' | 'high';

export interface MapTransform {
  /** Absolute display scale (transform scale değeri). */
  scale: number;
  translateX: number;
  translateY: number;
}

export interface MapTransformInput {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
}

export interface MapScaleBounds {
  fitScale: number;
  operationalScale: number;
  maxScale: number;
  fitTransform: MapTransform;
  operationalTransform: MapTransform;
}

export interface NormalizedBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const OPERATIONAL_FOCUS_CITY_IDS = ['istanbul', 'bursa', 'izmir', 'ankara', 'antalya'] as const;

/** Content canvas: viewport yüksekliğine göre asset aspect ratio korunur. */
export function computeMapContentSize(
  viewportHeight: number,
  aspectRatio: number,
): { width: number; height: number } {
  if (viewportHeight <= 0 || aspectRatio <= 0) {
    return { width: 0, height: 0 };
  }
  return {
    width: viewportHeight * aspectRatio,
    height: viewportHeight,
  };
}

export function getBaseFitScale(input: MapTransformInput): number {
  const { viewportWidth, viewportHeight, contentWidth, contentHeight } = input;
  if (contentWidth <= 0 || contentHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return 1;
  }
  return Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight);
}

export function getCoverRelativeScale(input: MapTransformInput): number {
  const fitScale = getBaseFitScale(input);
  if (fitScale <= 0 || input.contentWidth <= 0 || input.contentHeight <= 0) {
    return 1;
  }
  const coverScale = Math.max(
    input.viewportWidth / input.contentWidth,
    input.viewportHeight / input.contentHeight,
  );
  return coverScale / fitScale;
}

/** Beş ana şehirden başlangıç operasyon bounding box'ı. */
export function getOperationalFocusBounds(): NormalizedBounds {
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;

  for (const cityId of OPERATIONAL_FOCUS_CITY_IDS) {
    const pos = getWorldMapCityPosition(cityId);
    if (!pos) continue;
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x);
    minY = Math.min(minY, pos.y);
    maxY = Math.max(maxY, pos.y);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const padX = width * 0.1;
  const padY = height * 0.12;

  return {
    minX: Math.max(0, minX - padX),
    maxX: Math.min(1, maxX + padX),
    minY: Math.max(0, minY - padY),
    maxY: Math.min(1, maxY + padY),
  };
}

/** Türkiye'nin tamamı görünür — minimum zoom. */
export function getFitMapTransform(input: MapTransformInput): MapTransform {
  const { viewportWidth, viewportHeight, contentWidth, contentHeight } = input;
  const fitScale = getBaseFitScale(input);

  if (contentWidth <= 0 || contentHeight <= 0 || viewportWidth <= 0) {
    return { scale: fitScale, translateX: 0, translateY: 0 };
  }

  const scaledW = contentWidth * fitScale;
  const scaledH = contentHeight * fitScale;

  return {
    scale: fitScale,
    translateX: (viewportWidth - scaledW) / 2,
    translateY: (viewportHeight - scaledH) / 2,
  };
}

/** Başlangıç kadrajı — kartı doldurur, batı/orta Türkiye odaklı. */
export function getOperationalMapTransform(
  input: MapTransformInput,
  focusBounds: NormalizedBounds = getOperationalFocusBounds(),
): MapTransform {
  const { viewportWidth, viewportHeight, contentWidth, contentHeight } = input;
  const fitScale = getBaseFitScale(input);

  if (contentWidth <= 0 || contentHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { scale: fitScale, translateX: 0, translateY: 0 };
  }

  const coverRelative = getCoverRelativeScale(input);

  const focusW = (focusBounds.maxX - focusBounds.minX) * contentWidth;
  const focusH = (focusBounds.maxY - focusBounds.minY) * contentHeight;
  const focusAbsoluteScale = Math.min(viewportWidth / focusW, viewportHeight / focusH);
  const focusRelative = focusAbsoluteScale / fitScale;

  const relativeScale = Math.max(
    coverRelative,
    Math.min(focusRelative, MAP_OPERATIONAL_SCALE_MAX),
  );
  const absoluteScale = fitScale * relativeScale;

  const focusCx = ((focusBounds.minX + focusBounds.maxX) / 2) * contentWidth;
  const focusCy = ((focusBounds.minY + focusBounds.maxY) / 2) * contentHeight;

  const translateX = viewportWidth / 2 - focusCx * absoluteScale;
  const translateY = viewportHeight / 2 - focusCy * absoluteScale;

  const clamped = clampMapTranslation(
    translateX,
    translateY,
    absoluteScale,
    input,
  );

  return {
    scale: absoluteScale,
    translateX: clamped.translateX,
    translateY: clamped.translateY,
  };
}

export function getMapScaleBounds(input: MapTransformInput): MapScaleBounds {
  const fitTransform = getFitMapTransform(input);
  const operationalTransform = getOperationalMapTransform(input);
  const fitScale = fitTransform.scale;
  const operationalScale = operationalTransform.scale;
  const maxScale = Math.max(
    operationalScale * MAP_MAX_SCALE_OPERATIONAL_FACTOR,
    fitScale * MAP_MAX_SCALE_FIT_FACTOR,
  );

  return {
    fitScale,
    operationalScale,
    maxScale,
    fitTransform,
    operationalTransform,
  };
}

export function clampMapTranslation(
  translateX: number,
  translateY: number,
  absoluteScale: number,
  input: MapTransformInput,
): { translateX: number; translateY: number } {
  const { viewportWidth, viewportHeight, contentWidth, contentHeight } = input;
  const scaledW = contentWidth * absoluteScale;
  const scaledH = contentHeight * absoluteScale;

  let x = translateX;
  let y = translateY;

  if (scaledW <= viewportWidth) {
    x = (viewportWidth - scaledW) / 2;
  } else {
    x = Math.min(0, Math.max(viewportWidth - scaledW, x));
  }

  if (scaledH <= viewportHeight) {
    y = (viewportHeight - scaledH) / 2;
  } else {
    y = Math.min(0, Math.max(viewportHeight - scaledH, y));
  }

  return { translateX: x, translateY: y };
}

export function scaleToDetailLevel(
  absoluteScale: number,
  operationalScale: number,
): MapDetailLevel {
  const lowThreshold = operationalScale * MAP_DETAIL_LEVEL_MEDIUM_FACTOR;
  const highThreshold = operationalScale * MAP_DETAIL_LEVEL_HIGH_FACTOR;

  if (absoluteScale < lowThreshold) return 'low';
  if (absoluteScale < highThreshold) return 'medium';
  return 'high';
}
