import type { View } from 'react-native';
import { Dimensions, type ScrollView as ScrollViewType } from 'react-native';

import type { TutorialTargetPadding } from '../types';
import {
  finalizeTutorialOverlayRect,
  finalizeTutorialWindowRect,
  isValidTutorialScreenRect,
  logTutorialMeasureDev,
  measureOverlayWindowOrigin,
  measureViewInWindow,
  waitForTutorialLayoutFrame,
  type TutorialScreenRect,
} from './coordinates';
import { measureAppTutorialTarget } from './targetRegistry';
import type { AppTutorialId } from './types';

const OVERLAY_ROOT_WAIT_MS = 600;

async function waitForOverlayRoot(overlayRootRef: React.RefObject<View | null>): Promise<View | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < OVERLAY_ROOT_WAIT_MS) {
    if (overlayRootRef.current) {
      return overlayRootRef.current;
    }
    await waitForTutorialLayoutFrame();
  }
  return overlayRootRef.current;
}

export async function measureTutorialTargetWindowRect({
  tutorialId,
  targetId,
  spotlightPadding,
  sequence,
  transitionSequenceRef,
}: {
  tutorialId: AppTutorialId;
  targetId: string;
  spotlightPadding?: TutorialTargetPadding;
  sequence: number;
  transitionSequenceRef: React.MutableRefObject<number>;
}): Promise<TutorialScreenRect | null> {
  if (sequence !== transitionSequenceRef.current) {
    return null;
  }

  await waitForTutorialLayoutFrame();
  if (sequence !== transitionSequenceRef.current) {
    return null;
  }

  const targetWindowRect = await measureAppTutorialTarget(tutorialId, targetId);
  if (sequence !== transitionSequenceRef.current || !targetWindowRect) {
    return null;
  }

  const padded = finalizeTutorialWindowRect(targetWindowRect, spotlightPadding);
  const { width: windowWidth, height: windowHeight } = Dimensions.get('window');
  if (!isValidTutorialScreenRect(padded, windowWidth, windowHeight)) {
    return null;
  }
  return padded;
}

export async function measureTutorialTargetInOverlaySpace({
  tutorialId,
  targetId,
  overlayRootRef,
  spotlightPadding,
  sequence,
  transitionSequenceRef,
  debug,
}: {
  tutorialId: AppTutorialId;
  targetId: string;
  overlayRootRef: React.RefObject<View | null>;
  spotlightPadding?: TutorialTargetPadding;
  sequence: number;
  transitionSequenceRef: React.MutableRefObject<number>;
  debug?: {
    stepId?: string;
  };
}): Promise<{
  overlayRect: TutorialScreenRect;
  windowRect: TutorialScreenRect;
} | null> {
  if (sequence !== transitionSequenceRef.current) {
    return null;
  }

  await waitForTutorialLayoutFrame();
  if (sequence !== transitionSequenceRef.current) {
    return null;
  }

  const targetWindowRect = await measureAppTutorialTarget(tutorialId, targetId);
  if (sequence !== transitionSequenceRef.current) {
    return null;
  }

  if (!targetWindowRect) {
    return null;
  }

  const overlayRoot = await waitForOverlayRoot(overlayRootRef);
  const overlayWindowOrigin = await measureOverlayWindowOrigin(overlayRoot);
  if (sequence !== transitionSequenceRef.current) {
    return null;
  }

  const windowRect = finalizeTutorialWindowRect(targetWindowRect, spotlightPadding);
  const overlayRect = finalizeTutorialOverlayRect(
    targetWindowRect,
    overlayWindowOrigin,
    spotlightPadding,
  );

  const { width: windowWidth, height: windowHeight } = Dimensions.get('window');
  if (
    !isValidTutorialScreenRect(overlayRect, windowWidth, windowHeight) ||
    !isValidTutorialScreenRect(windowRect, windowWidth, windowHeight)
  ) {
    logTutorialMeasureDev({
      tutorialId,
      stepId: debug?.stepId,
      targetId,
      status: 'invalid-overlay-rect',
      targetWindowRect,
      overlayWindowOrigin,
      overlayRect,
      windowRect,
      window: { width: windowWidth, height: windowHeight },
    });
    return null;
  }

  logTutorialMeasureDev({
    tutorialId,
    stepId: debug?.stepId,
    targetId,
    targetWindowRect,
    overlayWindowOrigin,
    overlayRect,
    windowRect,
    window: { width: windowWidth, height: windowHeight },
  });

  return {
    overlayRect,
    windowRect,
  };
}

export async function measureScrollViewportInWindow(
  scrollRef: React.RefObject<ScrollViewType | null>,
): Promise<TutorialScreenRect | null> {
  await waitForTutorialLayoutFrame();
  return measureViewInWindow(scrollRef.current as unknown as View | null);
}
