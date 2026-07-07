import type { TabKey } from '../components/BottomTabBar';

export type SpotlightTutorialId = 'first_contract' | 'track_delivery' | 'market_basics';

export type TutorialInteractionMode =
  | 'tap_target'
  | 'next'
  | 'navigate'
  | 'complete_action';

export type TutorialTargetId =
  | 'tab-dashboard'
  | 'tab-map'
  | 'tab-contracts'
  | 'tab-fleet'
  | 'tab-market'
  | 'tab-more'
  | 'contract-first-card'
  | 'assignment-truck-card'
  | 'assignment-driver-card'
  | 'assignment-start-button'
  | 'dashboard-active-delivery'
  | 'market-first-opportunity';

export type SpotlightLayer = 'root' | 'modal';

export type TutorialTargetPadding =
  | number
  | {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };

export interface TutorialLayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function areTutorialRectsAlmostEqual(
  a: TutorialLayoutRect | null | undefined,
  b: TutorialLayoutRect | null | undefined,
  threshold = 2,
): boolean {
  if (!a || !b) {
    return false;
  }
  return (
    Math.abs(a.x - b.x) < threshold &&
    Math.abs(a.y - b.y) < threshold &&
    Math.abs(a.width - b.width) < threshold &&
    Math.abs(a.height - b.height) < threshold
  );
}

export type TutorialPointerOffset = {
  x?: number;
  y?: number;
};

export interface SpotlightTutorialStep {
  id: string;
  targetId: TutorialTargetId;
  title: string;
  description: string;
  interactionMode: TutorialInteractionMode;
  requiredTab?: TabKey;
  navigateTab?: TabKey;
  layer: SpotlightLayer;
  targetPadding?: TutorialTargetPadding;
  /** @deprecated use showPointer */
  showFinger?: boolean;
  showPointer?: boolean;
  pointerOffset?: TutorialPointerOffset;
  primaryButtonLabel?: string;
  fallbackTitle?: string;
  fallbackDescription?: string;
}

export function shouldShowTutorialPointer(step: SpotlightTutorialStep): boolean {
  if (step.showPointer != null) {
    return step.showPointer;
  }
  if (step.showFinger != null) {
    return step.showFinger;
  }
  return (
    step.interactionMode === 'tap_target' ||
    step.interactionMode === 'navigate' ||
    step.interactionMode === 'complete_action'
  );
}

export function buildTutorialMeasureStepKey(
  tutorialId: SpotlightTutorialId | null,
  stepIndex: number,
  targetId: TutorialTargetId,
): string | null {
  if (!tutorialId) {
    return null;
  }
  return `${tutorialId}:${stepIndex}:${targetId}`;
}

export interface SpotlightTutorialDefinition {
  id: SpotlightTutorialId;
  steps: SpotlightTutorialStep[];
}

export interface SpotlightTutorialPersistence {
  completedIds: SpotlightTutorialId[];
  skippedIds: SpotlightTutorialId[];
}

export interface TutorialTargetRegistration {
  measure: () => Promise<TutorialLayoutRect | null>;
  onPress?: () => void | Promise<void>;
  scrollIntoView?: () => void | Promise<void>;
}

export function isValidTutorialRect(rect: TutorialLayoutRect | null | undefined): rect is TutorialLayoutRect {
  return (
    rect != null &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function expandTutorialRect(
  rect: TutorialLayoutRect,
  padding: TutorialTargetPadding = 8,
): TutorialLayoutRect {
  if (typeof padding === 'number') {
    return {
      x: rect.x - padding,
      y: rect.y - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    };
  }

  const top = padding.top ?? 0;
  const right = padding.right ?? 0;
  const bottom = padding.bottom ?? 0;
  const left = padding.left ?? 0;

  return {
    x: rect.x - left,
    y: rect.y - top,
    width: rect.width + left + right,
    height: rect.height + top + bottom,
  };
}
