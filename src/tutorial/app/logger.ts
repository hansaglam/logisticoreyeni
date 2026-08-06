import type { AppTutorialId, AppTutorialLogAction } from './types';

declare const __DEV__: boolean | undefined;

export function logAppTutorialDev(payload: {
  tutorialId: AppTutorialId;
  action: AppTutorialLogAction;
  stepId?: string;
  tutorialVersion: number;
  context?: string;
}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.info('[tutorial]', {
    tutorialId: payload.tutorialId,
    action: payload.action,
    stepId: payload.stepId,
    version: payload.tutorialVersion,
    context: payload.context,
  });
}
