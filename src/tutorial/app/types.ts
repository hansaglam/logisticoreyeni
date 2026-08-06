import type { TutorialLayoutRect, TutorialTargetPadding } from '../types';

export type AppTutorialId =
  | 'dashboard'
  | 'map'
  | 'contracts'
  | 'market'
  | 'fleet'
  | 'warehouses'
  | 'finance'
  | 'vehicle-marketplace'
  | 'leaderboard'
  | 'account'
  | 'reputation';

export type TutorialPlacement = 'below' | 'above' | 'center';

export type TutorialTransitionState = 'idle' | 'scrolling' | 'measuring' | 'animating';

export type AppTutorialStep = {
  id: string;
  title: string;
  description: string;
  targetId?: string;
  spotlightPadding?: TutorialTargetPadding;
  placement?: TutorialPlacement;
  /** Son adım birincil buton etiketi */
  finalCtaLabel?: string;
  /** Herhangi bir adımda ileri butonu etiketi */
  primaryLabel?: string;
};

export type AppTutorialDefinition = {
  id: AppTutorialId;
  version: number;
  autoStart: boolean;
  steps: AppTutorialStep[];
};

export type TutorialProgressEntry = {
  completed: boolean;
  version: number;
};

export type TutorialProgressState = Partial<Record<AppTutorialId, TutorialProgressEntry>>;

export type AppTutorialLogAction =
  | 'auto-open'
  | 'manual-open'
  | 'replayed'
  | 'step-viewed'
  | 'step-skipped'
  | 'completed'
  | 'dismissed'
  | 'target-missing';

export type AppTutorialMeasureFn = () => Promise<TutorialLayoutRect | null>;
export type AppTutorialScrollFn = () => void | Promise<void>;

export interface AppTutorialTargetEntry {
  measure: AppTutorialMeasureFn;
  scrollIntoView?: AppTutorialScrollFn;
}
