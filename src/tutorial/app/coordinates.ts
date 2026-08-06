import { InteractionManager, type View } from 'react-native';

import {
  expandTutorialRect,
  isValidTutorialRect,
  type TutorialLayoutRect,
  type TutorialTargetPadding,
} from '../types';
import { normalizeTutorialRect } from './layout';

export type TutorialScreenRect = TutorialLayoutRect;

export type TutorialSpotlightPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const DEFAULT_TUTORIAL_SPOTLIGHT_PADDING: TutorialSpotlightPadding = {
  top: 6,
  right: 6,
  bottom: 6,
  left: 6,
};

export function resolveTutorialSpotlightPadding(
  padding?: TutorialTargetPadding,
): TutorialSpotlightPadding {
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return {
    top: padding?.top ?? DEFAULT_TUTORIAL_SPOTLIGHT_PADDING.top,
    right: padding?.right ?? DEFAULT_TUTORIAL_SPOTLIGHT_PADDING.right,
    bottom: padding?.bottom ?? DEFAULT_TUTORIAL_SPOTLIGHT_PADDING.bottom,
    left: padding?.left ?? DEFAULT_TUTORIAL_SPOTLIGHT_PADDING.left,
  };
}

export function applySpotlightPadding(
  rect: TutorialScreenRect,
  padding?: TutorialTargetPadding,
): TutorialScreenRect {
  const resolved = resolveTutorialSpotlightPadding(padding);
  return {
    x: rect.x - resolved.left,
    y: rect.y - resolved.top,
    width: rect.width + resolved.left + resolved.right,
    height: rect.height + resolved.top + resolved.bottom,
  };
}

export function convertTargetRectToOverlaySpace(
  targetWindowRect: TutorialScreenRect,
  overlayWindowOrigin: { x: number; y: number },
): TutorialScreenRect {
  return {
    x: targetWindowRect.x - overlayWindowOrigin.x,
    y: targetWindowRect.y - overlayWindowOrigin.y,
    width: targetWindowRect.width,
    height: targetWindowRect.height,
  };
}

export function waitForTutorialLayoutFrame(): Promise<void> {
  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

export function measureViewInWindow(view: View | null): Promise<TutorialScreenRect | null> {
  return new Promise((resolve) => {
    if (!view) {
      resolve(null);
      return;
    }
    view.measureInWindow((x, y, width, height) => {
      const rect = { x, y, width, height };
      if (!isValidTutorialRect(rect)) {
        resolve(null);
        return;
      }
      resolve(rect);
    });
  });
}

export async function measureOverlayWindowOrigin(
  overlayRoot: View | null,
): Promise<{ x: number; y: number }> {
  const rect = await measureViewInWindow(overlayRoot);
  if (!rect) {
    return { x: 0, y: 0 };
  }
  return { x: rect.x, y: rect.y };
}

export function isValidTutorialScreenRect(
  rect: TutorialLayoutRect | null | undefined,
  windowWidth: number,
  windowHeight: number,
): rect is TutorialLayoutRect {
  if (!isValidTutorialRect(rect)) {
    return false;
  }
  return (
    rect.width > 1 &&
    rect.height > 1 &&
    rect.x < windowWidth &&
    rect.y < windowHeight &&
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0
  );
}

export function finalizeTutorialOverlayRect(
  targetWindowRect: TutorialScreenRect,
  overlayWindowOrigin: { x: number; y: number },
  padding?: TutorialTargetPadding,
): TutorialScreenRect {
  const overlayRect = convertTargetRectToOverlaySpace(targetWindowRect, overlayWindowOrigin);
  const padded = applySpotlightPadding(overlayRect, padding);
  return normalizeTutorialRect(padded);
}

export function finalizeTutorialWindowRect(
  targetWindowRect: TutorialScreenRect,
  padding?: TutorialTargetPadding,
): TutorialScreenRect {
  return normalizeTutorialRect(expandTutorialRect(targetWindowRect, padding ?? DEFAULT_TUTORIAL_SPOTLIGHT_PADDING));
}

export function logTutorialMeasureDev(payload: Record<string, unknown>): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[tutorial-measure]', payload);
  }
}
