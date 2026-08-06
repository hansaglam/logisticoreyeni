import type { TutorialLayoutRect } from '../types';
import type { AppTutorialId, AppTutorialTargetEntry } from './types';

const registries = new Map<AppTutorialId, Map<string, AppTutorialTargetEntry>>();

function getRegistry(tutorialId: AppTutorialId): Map<string, AppTutorialTargetEntry> {
  let registry = registries.get(tutorialId);
  if (!registry) {
    registry = new Map();
    registries.set(tutorialId, registry);
  }
  return registry;
}

export function registerAppTutorialTarget(
  tutorialId: AppTutorialId,
  targetId: string,
  entry: AppTutorialTargetEntry,
): () => void {
  const registry = getRegistry(tutorialId);
  const existing = registry.get(targetId);
  if (existing === entry) {
    return () => {
      const current = registry.get(targetId);
      if (current === entry) {
        registry.delete(targetId);
      }
    };
  }
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    existing != null
  ) {
    console.warn('[tutorial] duplicate-target-id', { tutorialId, targetId });
  }
  registry.set(targetId, entry);
  return () => {
    const current = registry.get(targetId);
    if (current === entry) {
      registry.delete(targetId);
    }
  };
}

export async function measureAppTutorialTarget(
  tutorialId: AppTutorialId,
  targetId: string,
): Promise<TutorialLayoutRect | null> {
  const entry = getRegistry(tutorialId).get(targetId);
  if (!entry) {
    return null;
  }
  return entry.measure();
}

export async function scrollAppTutorialTargetIntoView(
  tutorialId: AppTutorialId,
  targetId: string,
): Promise<void> {
  const entry = getRegistry(tutorialId).get(targetId);
  if (!entry?.scrollIntoView) {
    return;
  }
  await entry.scrollIntoView();
}

export function hasAppTutorialTarget(tutorialId: AppTutorialId, targetId: string): boolean {
  return getRegistry(tutorialId).has(targetId);
}

export function clearAppTutorialTargets(tutorialId?: AppTutorialId): void {
  if (tutorialId) {
    registries.delete(tutorialId);
    return;
  }
  registries.clear();
}
