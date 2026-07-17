import { InteractionManager, Platform, StatusBar } from 'react-native';

import { ENABLE_SPOTLIGHT_TUTORIAL } from './featureFlags';
import type { TutorialLayoutRect, TutorialTargetId, TutorialTargetRegistration } from './types';
import { isValidTutorialRect } from './types';

type RegistryListener = () => void;

const targets = new Map<TutorialTargetId, TutorialTargetRegistration>();
const listeners = new Set<RegistryListener>();

export function subscribeTutorialTargets(listener: RegistryListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyTutorialTargetChange(): void {
  listeners.forEach((listener) => listener());
}

export function registerTutorialTarget(
  id: TutorialTargetId,
  registration: TutorialTargetRegistration,
): () => void {
  if (!ENABLE_SPOTLIGHT_TUTORIAL) {
    return () => {};
  }
  targets.set(id, registration);
  notifyTutorialTargetChange();
  return () => {
    const current = targets.get(id);
    if (current === registration) {
      targets.delete(id);
      notifyTutorialTargetChange();
    }
  };
}

export function getTutorialTargetRegistration(
  id: TutorialTargetId,
): TutorialTargetRegistration | undefined {
  return targets.get(id);
}

export function hasTutorialTarget(id: TutorialTargetId): boolean {
  return targets.has(id);
}

/**
 * measureInWindow ile overlay AbsoluteFill aynı window koordinat sistemini kullanır.
 * Android Modal senaryolarında StatusBar offset gerekirse buradan tek yerden uygulanır.
 * Root overlay Modal olmadığı için varsayılan olarak offset uygulanmaz.
 */
export function normalizeTutorialTargetRect(
  rect: TutorialLayoutRect,
  options?: { applyAndroidStatusBarOffset?: boolean },
): TutorialLayoutRect {
  if (!options?.applyAndroidStatusBarOffset || Platform.OS !== 'android') {
    return rect;
  }
  const statusBarHeight = StatusBar.currentHeight ?? 0;
  if (statusBarHeight <= 0) {
    return rect;
  }
  return {
    ...rect,
    y: Math.max(0, rect.y - statusBarHeight),
  };
}

function waitForInteractions(): Promise<void> {
  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
}

export async function measureTutorialTarget(
  id: TutorialTargetId,
): Promise<TutorialLayoutRect | null> {
  if (!ENABLE_SPOTLIGHT_TUTORIAL) {
    return null;
  }
  const registration = targets.get(id);
  if (!registration) {
    return null;
  }
  try {
    await waitForInteractions();
    await registration.scrollIntoView?.();
    const rect = await registration.measure();
    if (!isValidTutorialRect(rect)) {
      return null;
    }
    return normalizeTutorialTargetRect(rect);
  } catch {
    return null;
  }
}

export async function measureTutorialTargetChain(
  targetIds: TutorialTargetId[],
): Promise<{ targetId: TutorialTargetId; rect: TutorialLayoutRect } | null> {
  for (const targetId of targetIds) {
    const rect = await measureTutorialTarget(targetId);
    if (rect) {
      return { targetId, rect };
    }
  }
  return null;
}

export async function invokeTutorialTargetPress(id: TutorialTargetId): Promise<void> {
  const registration = targets.get(id);
  if (!registration?.onPress) {
    return;
  }
  await registration.onPress();
}
