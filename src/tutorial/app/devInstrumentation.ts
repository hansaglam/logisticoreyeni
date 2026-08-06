import type { AppTutorialId } from './types';
import { trackRenderRate } from '../../utils/renderRateInstrumentation';

declare const __DEV__: boolean | undefined;

export function logTutorialEffectRun(payload: {
  tutorialId: AppTutorialId;
  effect: string;
  details?: Record<string, unknown>;
}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  console.info('[tutorial-effect-run]', {
    tutorialId: payload.tutorialId,
    effect: payload.effect,
    ...payload.details,
  });
}

export function warnRenderLoopSuspected(
  component: string,
  _renderCount: number,
  context?: Record<string, unknown>,
): void {
  trackRenderRate(component, context);
}
