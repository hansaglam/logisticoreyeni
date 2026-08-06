import type { TutorialLayoutRect } from '../types';
import { isValidTutorialRect } from '../types';
import type { TutorialPlacement } from './types';

export const TUTORIAL_RECT_EPSILON_PX = 3;
export const TOOLTIP_PLACEMENT_HYSTERESIS_PX = 24;

/** @deprecated use TUTORIAL_RECT_EPSILON_PX */
export const POSITION_EPSILON_PX = TUTORIAL_RECT_EPSILON_PX;

export function normalizeTutorialRect(rect: TutorialLayoutRect): TutorialLayoutRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function isMeaningfullyDifferentRect(
  prev: TutorialLayoutRect | null | undefined,
  next: TutorialLayoutRect | null | undefined,
  epsilon = TUTORIAL_RECT_EPSILON_PX,
): boolean {
  if (!prev && !next) {
    return false;
  }
  if (!prev || !next) {
    return true;
  }
  return (
    Math.abs(prev.x - next.x) > epsilon ||
    Math.abs(prev.y - next.y) > epsilon ||
    Math.abs(prev.width - next.width) > epsilon ||
    Math.abs(prev.height - next.height) > epsilon
  );
}

export const computeTutorialTooltipPlacement = computeTooltipLayout;

export function computeTooltipLayout({
  anchorRect,
  screenWidth,
  screenHeight,
  safeAreaTop,
  safeAreaBottom,
  tabBarHeight,
  tooltipWidth,
  tooltipHeight,
  previousPlacement,
}: {
  anchorRect: TutorialLayoutRect | null;
  screenWidth: number;
  screenHeight: number;
  safeAreaTop: number;
  safeAreaBottom: number;
  tabBarHeight: number;
  tooltipWidth: number;
  tooltipHeight: number;
  previousPlacement?: TutorialPlacement | null;
}): { top: number; left: number; placement: TutorialPlacement } {
  const minTop = safeAreaTop + 12;
  const maxTop = screenHeight - tooltipHeight - safeAreaBottom - tabBarHeight - 16;
  const minLeft = 16;
  const maxLeft = screenWidth - tooltipWidth - 16;

  if (!isValidTutorialRect(anchorRect)) {
    return {
      top: Math.max(minTop, Math.min(maxTop, Math.round(screenHeight * 0.18))),
      left: Math.max(minLeft, Math.round((screenWidth - tooltipWidth) / 2)),
      placement: 'center',
    };
  }

  const targetBottom = anchorRect.y + anchorRect.height;
  const targetCenterX = anchorRect.x + anchorRect.width / 2;
  const gap = 14;
  const spaceBelow = screenHeight - targetBottom - gap - safeAreaBottom - tabBarHeight;
  const spaceAbove = anchorRect.y - gap - minTop;

  const canPlaceBelow = spaceBelow >= tooltipHeight;
  const canPlaceAbove = spaceAbove >= tooltipHeight;

  let placement: TutorialPlacement = 'below';
  if (previousPlacement === 'below' && canPlaceBelow) {
    placement = 'below';
  } else if (previousPlacement === 'above' && canPlaceAbove) {
    placement = 'above';
  } else if (canPlaceBelow && (!canPlaceAbove || spaceBelow >= spaceAbove)) {
    placement = 'below';
  } else if (canPlaceAbove) {
    placement = 'above';
  } else if (
    previousPlacement === 'below' &&
    spaceBelow >= tooltipHeight - TOOLTIP_PLACEMENT_HYSTERESIS_PX
  ) {
    placement = 'below';
  } else if (
    previousPlacement === 'above' &&
    spaceAbove >= tooltipHeight - TOOLTIP_PLACEMENT_HYSTERESIS_PX
  ) {
    placement = 'above';
  } else if (spaceBelow >= spaceAbove) {
    placement = 'below';
  } else {
    placement = 'above';
  }

  let top: number;
  if (placement === 'below') {
    top = targetBottom + gap;
  } else {
    top = anchorRect.y - gap - tooltipHeight;
  }

  top = Math.max(minTop, Math.min(maxTop, Math.round(top)));
  let left = Math.round(targetCenterX - tooltipWidth / 2);
  left = Math.max(minLeft, Math.min(maxLeft, left));
  return { top, left, placement };
}
