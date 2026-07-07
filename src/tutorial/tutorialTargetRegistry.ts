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

export async function measureTutorialTarget(
  id: TutorialTargetId,
): Promise<TutorialLayoutRect | null> {
  const registration = targets.get(id);
  if (!registration) {
    return null;
  }
  try {
    await registration.scrollIntoView?.();
    const rect = await registration.measure();
    return isValidTutorialRect(rect) ? rect : null;
  } catch {
    return null;
  }
}

export async function invokeTutorialTargetPress(id: TutorialTargetId): Promise<void> {
  const registration = targets.get(id);
  if (!registration?.onPress) {
    return;
  }
  await registration.onPress();
}
