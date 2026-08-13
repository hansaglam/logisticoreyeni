import type { RefObject } from 'react';
import type { ScrollView } from 'react-native';

import type { AppTutorialId } from './types';

const sessionDisabledTutorialIds = new Set<AppTutorialId>();

export function noop(): void {}

export type AppTutorialController = {
  isEnabled: boolean;
  isOpen: boolean;
  start: () => void;
  replay: () => void;
  close: () => void;
  next: () => void;
  previous: () => void;
};

export const DISABLED_TUTORIAL_CONTROLLER: AppTutorialController = {
  isEnabled: false,
  isOpen: false,
  start: noop,
  replay: noop,
  close: noop,
  next: noop,
  previous: noop,
};

export function isTutorialSessionDisabled(tutorialId: AppTutorialId): boolean {
  return sessionDisabledTutorialIds.has(tutorialId);
}

export function disableTutorialForSession(tutorialId: AppTutorialId): void {
  sessionDisabledTutorialIds.add(tutorialId);
}

export function resetTutorialSessionDisables(): void {
  sessionDisabledTutorialIds.clear();
}

export function createDisabledScreenTutorialResult(
  scrollRef: RefObject<ScrollView | null>,
  tutorialId: AppTutorialId = 'dashboard',
) {
  return {
    tutorial: DISABLED_TUTORIAL_CONTROLLER,
    overlayProps: {
      tutorialId,
      visible: false,
      steps: [],
      stepIndex: 0,
      transitionState: 'idle' as const,
      isTransitioning: false,
      anchorRect: null,
      layoutAnchorRect: null,
      fallbackMode: false,
      spotlightVisible: false,
      showPreparingLabel: false,
      placementRef: { current: null },
      noticeText: null,
      onRequestStepChange: noop,
      onSkip: noop,
      onDismiss: noop,
      onComplete: noop,
    },
    helpButtonProps: {
      onPress: noop,
      disabled: true,
      accessibilityLabel: 'Rehber',
    },
    scrollRef,
    handleScroll: noop,
    handleScrollEnd: noop,
  };
}
