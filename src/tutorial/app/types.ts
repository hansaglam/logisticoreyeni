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

export type TutorialProgressStatus =
  | 'never-seen'
  | 'completed'
  | 'skipped'
  | 'dismissed';

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
  version: number;
  hasBeenPresented: boolean;
  status: TutorialProgressStatus;
  /** @deprecated Use hasBeenPresented + status */
  completed?: boolean;
  completedAt?: number;
  skippedAt?: number;
  dismissedAt?: number;
  lastManualReplayAt?: number;
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
  | 'target-missing'
  | 'presented';

export type AppTutorialMeasureFn = () => Promise<TutorialLayoutRect | null>;
export type AppTutorialScrollFn = () => void | Promise<void>;

export interface AppTutorialTargetEntry {
  measure: AppTutorialMeasureFn;
  scrollIntoView?: AppTutorialScrollFn;
}

export type TutorialOutcome = 'completed' | 'skipped' | 'dismissed';
