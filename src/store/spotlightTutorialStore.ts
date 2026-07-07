import { create } from 'zustand';

import type { TabKey } from '../components/BottomTabBar';
import { getSpotlightTutorial } from '../tutorial/spotlightTutorialConfig';
import type {
  SpotlightTutorialId,
  SpotlightTutorialStep,
  TutorialLayoutRect,
} from '../tutorial/types';
import {
  areTutorialRectsAlmostEqual,
  buildTutorialMeasureStepKey,
  isValidTutorialRect,
} from '../tutorial/types';
import {
  invokeTutorialTargetPress,
  measureTutorialTarget,
  subscribeTutorialTargets,
} from '../tutorial/tutorialTargetRegistry';
import { useGameStore } from './gameStore';

type TabNavigator = (tab: TabKey) => void;

const MEASURE_RETRY_DELAY_MS = 100;
const MEASURE_MAX_ATTEMPTS = 5;

interface SpotlightTutorialStore {
  isActive: boolean;
  tutorialId: SpotlightTutorialId | null;
  currentStepIndex: number;
  targetRect: TutorialLayoutRect | null;
  targetFallbackActive: boolean;
  isTargetRectLocked: boolean;
  measureStepKey: string | null;
  activeTab: TabKey;
  pendingAdvanceToStepIndex: number | null;
  pendingAdvanceTab: TabKey | null;
  tabNavigator: TabNavigator | null;
  setActiveTab: (tab: TabKey) => void;
  setTabNavigator: (navigator: TabNavigator | null) => void;
  startTutorial: (tutorialId: SpotlightTutorialId, options?: { force?: boolean }) => void;
  resetActive: () => void;
  nextStep: () => void;
  previousStep: () => void;
  skipTutorial: () => void;
  finishTutorial: () => void;
  handleTargetPress: () => Promise<void>;
  executePrimaryAction: () => Promise<void>;
  tryCompletePendingAdvance: () => Promise<void>;
  refreshTargetRect: (options?: { force?: boolean }) => Promise<void>;
  unlockTargetMeasurement: () => void;
  getCurrentStep: () => SpotlightTutorialStep | null;
}

function persistTutorialCompletion(tutorialId: SpotlightTutorialId, skipped: boolean): void {
  const gameStore = useGameStore.getState();
  if (skipped) {
    gameStore.markSpotlightTutorialSkipped(tutorialId);
  } else {
    gameStore.markSpotlightTutorialCompleted(tutorialId);
  }
}

function getStep(tutorialId: SpotlightTutorialId | null, index: number): SpotlightTutorialStep | null {
  if (!tutorialId) {
    return null;
  }
  const tutorial = getSpotlightTutorial(tutorialId);
  return tutorial.steps[index] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearMeasurementState(): Pick<
  SpotlightTutorialStore,
  'targetRect' | 'targetFallbackActive' | 'isTargetRectLocked' | 'measureStepKey'
> {
  return {
    targetRect: null,
    targetFallbackActive: false,
    isTargetRectLocked: false,
    measureStepKey: null,
  };
}

function applyTargetRect(
  state: SpotlightTutorialStore,
  stepKey: string,
  rect: TutorialLayoutRect,
): Partial<SpotlightTutorialStore> {
  if (
    state.isTargetRectLocked &&
    state.measureStepKey === stepKey &&
    areTutorialRectsAlmostEqual(state.targetRect, rect)
  ) {
    return {};
  }

  return {
    targetRect: rect,
    targetFallbackActive: false,
    isTargetRectLocked: true,
    measureStepKey: stepKey,
  };
}

async function measureTargetWithRetries(
  targetId: SpotlightTutorialStep['targetId'],
): Promise<TutorialLayoutRect | null> {
  for (let attempt = 0; attempt < MEASURE_MAX_ATTEMPTS; attempt += 1) {
    const rect = await measureTutorialTarget(targetId);
    if (isValidTutorialRect(rect)) {
      return rect;
    }
    if (attempt < MEASURE_MAX_ATTEMPTS - 1) {
      await sleep(MEASURE_RETRY_DELAY_MS);
    }
  }
  return null;
}

export const useSpotlightTutorialStore = create<SpotlightTutorialStore>((set, get) => ({
  isActive: false,
  tutorialId: null,
  currentStepIndex: 0,
  targetRect: null,
  targetFallbackActive: false,
  isTargetRectLocked: false,
  measureStepKey: null,
  activeTab: 'dashboard',
  pendingAdvanceToStepIndex: null,
  pendingAdvanceTab: null,
  tabNavigator: null,

  setActiveTab: (tab) => {
    const state = get();
    set({ activeTab: tab });

    if (state.pendingAdvanceToStepIndex != null) {
      return;
    }

    const step = getStep(state.tutorialId, state.currentStepIndex);
    if (
      state.isActive &&
      step?.interactionMode === 'navigate' &&
      step.navigateTab === tab
    ) {
      set({
        pendingAdvanceToStepIndex: state.currentStepIndex + 1,
        pendingAdvanceTab: tab,
      });
      void get().tryCompletePendingAdvance();
    }
  },

  setTabNavigator: (navigator) => set({ tabNavigator: navigator }),

  getCurrentStep: () => {
    const { tutorialId, currentStepIndex } = get();
    return getStep(tutorialId, currentStepIndex);
  },

  unlockTargetMeasurement: () => {
    set({ isTargetRectLocked: false, measureStepKey: null });
  },

  refreshTargetRect: async (options?: { force?: boolean }) => {
    const state = get();
    const step = state.getCurrentStep();
    if (!step || state.targetFallbackActive) {
      return;
    }

    const stepKey = buildTutorialMeasureStepKey(
      state.tutorialId,
      state.currentStepIndex,
      step.targetId,
    );
    if (!stepKey) {
      return;
    }

    if (
      !options?.force &&
      state.isTargetRectLocked &&
      state.measureStepKey === stepKey &&
      isValidTutorialRect(state.targetRect)
    ) {
      return;
    }

    const rect = await measureTutorialTarget(step.targetId);
    if (!isValidTutorialRect(rect)) {
      if (!state.isTargetRectLocked) {
        set({ targetRect: null });
      }
      return;
    }

    const patch = applyTargetRect(state, stepKey, rect);
    if (Object.keys(patch).length > 0) {
      set(patch);
    }
  },

  startTutorial: (tutorialId, options?: { force?: boolean }) => {
    const persistence = useGameStore.getState().spotlightTutorial;
    if (
      !options?.force &&
      (persistence.completedIds.includes(tutorialId) || persistence.skippedIds.includes(tutorialId))
    ) {
      return;
    }
    set({
      isActive: true,
      tutorialId,
      currentStepIndex: 0,
      ...clearMeasurementState(),
      pendingAdvanceToStepIndex: null,
      pendingAdvanceTab: null,
    });
    void get().refreshTargetRect({ force: true });
  },

  nextStep: () => {
    const { tutorialId, currentStepIndex } = get();
    if (!tutorialId) {
      return;
    }
    const tutorial = getSpotlightTutorial(tutorialId);
    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= tutorial.steps.length) {
      get().finishTutorial();
      return;
    }
    set({
      currentStepIndex: nextIndex,
      ...clearMeasurementState(),
    });
    void get().refreshTargetRect({ force: true });
  },

  previousStep: () => {
    const { currentStepIndex } = get();
    if (currentStepIndex <= 0) {
      return;
    }
    set({
      currentStepIndex: currentStepIndex - 1,
      ...clearMeasurementState(),
    });
    void get().refreshTargetRect({ force: true });
  },

  skipTutorial: () => {
    const { tutorialId } = get();
    if (tutorialId) {
      persistTutorialCompletion(tutorialId, true);
    }
    set({
      isActive: false,
      tutorialId: null,
      currentStepIndex: 0,
      ...clearMeasurementState(),
      pendingAdvanceToStepIndex: null,
      pendingAdvanceTab: null,
    });
  },

  finishTutorial: () => {
    const { tutorialId } = get();
    if (tutorialId) {
      persistTutorialCompletion(tutorialId, false);
    }
    set({
      isActive: false,
      tutorialId: null,
      currentStepIndex: 0,
      ...clearMeasurementState(),
      pendingAdvanceToStepIndex: null,
      pendingAdvanceTab: null,
    });
  },

  tryCompletePendingAdvance: async () => {
    const {
      isActive,
      tutorialId,
      pendingAdvanceToStepIndex,
      pendingAdvanceTab,
      activeTab,
    } = get();

    if (
      !isActive ||
      !tutorialId ||
      pendingAdvanceToStepIndex == null ||
      pendingAdvanceTab == null ||
      pendingAdvanceTab !== activeTab
    ) {
      return;
    }

    const tutorial = getSpotlightTutorial(tutorialId);
    const nextStepConfig = tutorial.steps[pendingAdvanceToStepIndex];
    if (!nextStepConfig) {
      set({ pendingAdvanceToStepIndex: null, pendingAdvanceTab: null });
      return;
    }

    if (tutorialId === 'first_contract' && activeTab === 'contracts') {
      useGameStore.getState().ensureStarterContractsForTutorial();
    }

    const stepKey = buildTutorialMeasureStepKey(
      tutorialId,
      pendingAdvanceToStepIndex,
      nextStepConfig.targetId,
    );
    const rect = await measureTargetWithRetries(nextStepConfig.targetId);
    if (rect && stepKey) {
      set({
        currentStepIndex: pendingAdvanceToStepIndex,
        pendingAdvanceToStepIndex: null,
        pendingAdvanceTab: null,
        ...applyTargetRect(get(), stepKey, rect),
      });
      return;
    }

    if (__DEV__ && tutorialId === 'first_contract') {
      console.warn('[tutorial] No starter contract found for first_contract tutorial');
    }

    if (__DEV__) {
      console.warn('[tutorial] using fallback target', {
        stepId: nextStepConfig.id,
        targetId: nextStepConfig.targetId,
      });
    }

    set({
      currentStepIndex: pendingAdvanceToStepIndex,
      pendingAdvanceToStepIndex: null,
      pendingAdvanceTab: null,
      targetRect: null,
      targetFallbackActive: true,
      isTargetRectLocked: true,
      measureStepKey: stepKey,
    });
  },

  handleTargetPress: async () => {
    const step = get().getCurrentStep();
    if (!step) {
      return;
    }

    switch (step.interactionMode) {
      case 'navigate': {
        if (!step.navigateTab) {
          return;
        }
        get().tabNavigator?.(step.navigateTab);
        await invokeTutorialTargetPress(step.targetId);
        set({
          pendingAdvanceToStepIndex: get().currentStepIndex + 1,
          pendingAdvanceTab: step.navigateTab,
        });
        void get().tryCompletePendingAdvance();
        return;
      }
      case 'tap_target': {
        await invokeTutorialTargetPress(step.targetId);
        get().nextStep();
        return;
      }
      case 'complete_action': {
        await invokeTutorialTargetPress(step.targetId);
        get().finishTutorial();
        return;
      }
      case 'next':
      default:
        await invokeTutorialTargetPress(step.targetId);
    }
  },

  executePrimaryAction: async () => {
    const step = get().getCurrentStep();
    if (!step) {
      return;
    }

    switch (step.interactionMode) {
      case 'navigate': {
        if (!step.navigateTab) {
          return;
        }
        get().tabNavigator?.(step.navigateTab);
        set({
          pendingAdvanceToStepIndex: get().currentStepIndex + 1,
          pendingAdvanceTab: step.navigateTab,
        });
        void get().tryCompletePendingAdvance();
        return;
      }
      case 'tap_target': {
        await invokeTutorialTargetPress(step.targetId);
        get().nextStep();
        return;
      }
      case 'complete_action': {
        await invokeTutorialTargetPress(step.targetId);
        get().finishTutorial();
        return;
      }
      case 'next':
      default:
        get().nextStep();
    }
  },

  resetActive: () => {
    set({
      isActive: false,
      tutorialId: null,
      currentStepIndex: 0,
      ...clearMeasurementState(),
      pendingAdvanceToStepIndex: null,
      pendingAdvanceTab: null,
    });
  },
}));

subscribeTutorialTargets(() => {
  const state = useSpotlightTutorialStore.getState();
  if (!state.isActive) {
    return;
  }
  if (state.pendingAdvanceToStepIndex != null) {
    void state.tryCompletePendingAdvance();
    return;
  }
  if (!state.isTargetRectLocked) {
    void state.refreshTargetRect();
  }
});

export function isSpotlightTutorialCompleted(id: SpotlightTutorialId): boolean {
  const persistence = useGameStore.getState().spotlightTutorial;
  return persistence.completedIds.includes(id) || persistence.skippedIds.includes(id);
}

export function canAutoStartSpotlightTutorial(id: SpotlightTutorialId): boolean {
  return !isSpotlightTutorialCompleted(id);
}
