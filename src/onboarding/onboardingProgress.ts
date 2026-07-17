import type { NextActionDispatch } from '../components/dashboard/dashboardHubLogic';
import type { TabKey } from '../navigation/tabTypes';
import { STARTER_MISSION_IDS } from '../config/missions';
import { getTotalInventoryTons } from '../simulation/trading';
import type {
  Delivery,
  MissionsState,
  OnboardingScreenId,
  OnboardingState,
  OnboardingStepId,
  Player,
} from '../types/game';
import {
  getMissionDisplayStatus,
  getMissionProgress,
  type MissionProgressResult,
} from '../utils/missionProgress';
import {
  getNextOnboardingStepId,
  getOnboardingProgressLabel,
  getOnboardingStepById,
  KNOWN_ONBOARDING_STEP_IDS,
  ONBOARDING_STEP_ORDER,
  type OnboardingStepConfig,
} from './onboardingConfig';

export interface OnboardingEvaluationState {
  onboarding: OnboardingState;
  activeDeliveries: Delivery[];
  missions: MissionsState;
  player: Player;
  getMissionProgress?: (missionId: string) => MissionProgressResult;
}

export function createDefaultOnboardingState(): OnboardingState {
  return {
    enabled: true,
    completed: false,
    currentStepId: 'welcome',
    completedStepIds: [],
    dismissedHintIds: [],
    visitedScreens: [],
  };
}

export function createCompletedOnboardingState(): OnboardingState {
  return {
    enabled: false,
    completed: true,
    currentStepId: null,
    completedStepIds: [...ONBOARDING_STEP_ORDER],
    dismissedHintIds: [],
    visitedScreens: [],
  };
}

export function normalizeOnboardingState(
  raw?: Partial<OnboardingState> | null,
  options?: { legacySave?: boolean },
): OnboardingState {
  if (!raw || typeof raw !== 'object') {
    if (options?.legacySave) {
      return createCompletedOnboardingState();
    }
    return createDefaultOnboardingState();
  }

  const dismissedHintIds = Array.isArray(raw.dismissedHintIds)
    ? raw.dismissedHintIds.filter((id): id is string => typeof id === 'string')
    : [];
  const visitedScreens = Array.isArray(raw.visitedScreens)
    ? raw.visitedScreens.filter((id): id is string => typeof id === 'string')
    : [];
  const completedStepIds = Array.isArray(raw.completedStepIds)
    ? raw.completedStepIds.filter((id): id is string => typeof id === 'string')
    : [];

  const completed = raw.completed === true;
  let currentStepId: OnboardingStepId | null =
    typeof raw.currentStepId === 'string' &&
    KNOWN_ONBOARDING_STEP_IDS.has(raw.currentStepId as OnboardingStepId)
      ? (raw.currentStepId as OnboardingStepId)
      : 'welcome';

  if (completed) {
    currentStepId = null;
  }

  return {
    enabled: raw.enabled !== false,
    completed,
    currentStepId,
    completedStepIds,
    dismissedHintIds,
    visitedScreens,
    missionRewardClaimed: raw.missionRewardClaimed === true,
  };
}

export function isOnboardingActive(onboarding: OnboardingState): boolean {
  return onboarding.enabled && !onboarding.completed && onboarding.currentStepId != null;
}

export function getCurrentOnboardingStep(
  state: OnboardingEvaluationState,
): OnboardingStepConfig | null {
  if (!isOnboardingActive(state.onboarding)) {
    return null;
  }
  return getOnboardingStepById(state.onboarding.currentStepId);
}

function countReadyMissionRewards(state: OnboardingEvaluationState): number {
  const missions = state.missions;
  const getProgress =
    state.getMissionProgress ??
    ((missionId: string) => getMissionProgress(missionId, state as never));

  return missions.activeMissionIds.filter((missionId) => {
    const progress = getProgress(missionId);
    return getMissionDisplayStatus(missionId, missions, progress) === 'ready';
  }).length;
}

function countReadyStarterMissionRewards(state: OnboardingEvaluationState): number {
  const missions = state.missions;
  const getProgress =
    state.getMissionProgress ??
    ((missionId: string) => getMissionProgress(missionId, state as never));

  return missions.activeMissionIds.filter((missionId) => {
    if (!STARTER_MISSION_IDS.includes(missionId)) {
      return false;
    }
    const progress = getProgress(missionId);
    return getMissionDisplayStatus(missionId, missions, progress) === 'ready';
  }).length;
}

function hasClaimedAnyStarterReward(state: OnboardingEvaluationState): boolean {
  return STARTER_MISSION_IDS.some((missionId) =>
    state.missions.claimedMissionRewardIds.includes(missionId),
  );
}

function areAllActiveStarterRewardsClaimed(state: OnboardingEvaluationState): boolean {
  const activeStarterIds = state.missions.activeMissionIds.filter((missionId) =>
    STARTER_MISSION_IDS.includes(missionId),
  );
  if (activeStarterIds.length === 0) {
    return hasClaimedAnyStarterReward(state);
  }
  return activeStarterIds.every((missionId) =>
    state.missions.claimedMissionRewardIds.includes(missionId),
  );
}

function hasVisitedScreen(onboarding: OnboardingState, screenId: OnboardingScreenId): boolean {
  return onboarding.visitedScreens.includes(screenId);
}

export function isOnboardingStepComplete(
  stepId: OnboardingStepId,
  state: OnboardingEvaluationState,
): boolean {
  const { onboarding, activeDeliveries, missions, player } = state;
  const deliveryCount = activeDeliveries.length;
  const deliveryStarted = missions.flags.deliveryStarted || deliveryCount > 0;
  const completedDeliveries = (player.completedContracts ?? 0) > 0;
  const inventoryTons = getTotalInventoryTons(player.warehouses);
  const readyMissionCount = countReadyMissionRewards(state);

  switch (stepId) {
    case 'welcome':
    case 'finish':
      return false;
    case 'first_contract':
      return deliveryStarted;
    case 'track_delivery': {
      if (completedDeliveries) {
        return true;
      }
      if (!hasVisitedScreen(onboarding, 'Map')) {
        return false;
      }
      return deliveryCount > 0 || deliveryStarted;
    }
    case 'market_intro':
      return hasVisitedScreen(onboarding, 'Market');
    case 'first_trade':
      return inventoryTons > 0 || missions.flags.tradePurchased;
    case 'warehouse_intro':
      return hasVisitedScreen(onboarding, 'Warehouse');
    case 'claim_rewards':
      if (onboarding.missionRewardClaimed) {
        return true;
      }
      if (hasClaimedAnyStarterReward(state)) {
        return true;
      }
      if (
        hasVisitedScreen(onboarding, 'Missions') &&
        countReadyStarterMissionRewards(state) === 0 &&
        areAllActiveStarterRewardsClaimed(state)
      ) {
        return true;
      }
      return false;
    default:
      return false;
  }
}

function markStepCompleted(onboarding: OnboardingState, stepId: OnboardingStepId): OnboardingState {
  const completedStepIds = onboarding.completedStepIds.includes(stepId)
    ? onboarding.completedStepIds
    : [...onboarding.completedStepIds, stepId];
  return { ...onboarding, completedStepIds };
}

export function completeOnboardingStep(
  onboarding: OnboardingState,
  stepId: OnboardingStepId,
): OnboardingState {
  const step = getOnboardingStepById(stepId);
  if (!step) {
    return onboarding;
  }

  let next = markStepCompleted(onboarding, stepId);

  if (stepId === 'finish') {
    return {
      ...next,
      completed: true,
      currentStepId: null,
    };
  }

  const nextStepId = getNextOnboardingStepId(stepId);
  if (!nextStepId) {
    return {
      ...next,
      completed: true,
      currentStepId: null,
    };
  }

  return {
    ...next,
    currentStepId: nextStepId,
  };
}

export function advanceOnboardingIfNeeded(state: OnboardingEvaluationState): OnboardingState {
  const { onboarding } = state;
  if (!isOnboardingActive(onboarding)) {
    return onboarding;
  }

  const currentStepId = onboarding.currentStepId;
  if (!currentStepId) {
    return onboarding;
  }

  const currentStep = getOnboardingStepById(currentStepId);
  if (!currentStep || currentStep.manualComplete) {
    return onboarding;
  }

  if (!isOnboardingStepComplete(currentStepId, state)) {
    return onboarding;
  }

  let next = completeOnboardingStep(onboarding, currentStepId);

  const advancedState: OnboardingEvaluationState = {
    ...state,
    onboarding: next,
  };

  if (next.currentStepId && !next.completed) {
    const nextStep = getOnboardingStepById(next.currentStepId);
    if (nextStep && !nextStep.manualComplete && isOnboardingStepComplete(next.currentStepId, advancedState)) {
      return advanceOnboardingIfNeeded(advancedState);
    }
  }

  return next;
}

export function dismissOnboardingHint(onboarding: OnboardingState, hintId: string): OnboardingState {
  if (onboarding.dismissedHintIds.includes(hintId)) {
    return onboarding;
  }
  return {
    ...onboarding,
    dismissedHintIds: [...onboarding.dismissedHintIds, hintId],
  };
}

export function markOnboardingScreenVisited(
  onboarding: OnboardingState,
  screenId: OnboardingScreenId,
): OnboardingState {
  if (onboarding.visitedScreens.includes(screenId)) {
    return onboarding;
  }
  return {
    ...onboarding,
    visitedScreens: [...onboarding.visitedScreens, screenId],
  };
}

export function markOnboardingMissionRewardClaimed(onboarding: OnboardingState): OnboardingState {
  if (onboarding.missionRewardClaimed) {
    return onboarding;
  }
  return {
    ...onboarding,
    missionRewardClaimed: true,
  };
}

export function dismissOnboardingGuide(onboarding: OnboardingState): OnboardingState {
  return {
    ...onboarding,
    enabled: false,
    completed: true,
    currentStepId: null,
  };
}

export function resetOnboardingForDev(): OnboardingState {
  return createDefaultOnboardingState();
}

export function shouldShowOnboardingHint(
  onboarding: OnboardingState,
  hintId: string,
  requiredStepId: OnboardingStepId,
): boolean {
  if (!isOnboardingActive(onboarding)) {
    return false;
  }
  if (onboarding.currentStepId !== requiredStepId) {
    return false;
  }
  return !onboarding.dismissedHintIds.includes(hintId);
}

export type OnboardingAction =
  | NextActionDispatch
  | { type: 'complete-step'; stepId: OnboardingStepId }
  | { type: 'open-warehouse' };

export interface OnboardingDashboardAction {
  title: string;
  description: string;
  ctaLabel: string;
  variant: OnboardingStepConfig['variant'];
  icon: OnboardingStepConfig['icon'];
  progressLabel: string;
  stepId: OnboardingStepId;
  action: OnboardingAction;
}

export function resolveOnboardingDashboardAction(
  state: OnboardingEvaluationState,
): OnboardingDashboardAction | null {
  const step = getCurrentOnboardingStep(state);
  if (!step || !state.onboarding.currentStepId) {
    return null;
  }

  const progressLabel = getOnboardingProgressLabel(state.onboarding.currentStepId);
  let title = step.title;
  let description = step.dashboardDescription ?? step.description;
  let ctaLabel = step.ctaLabel;
  let variant = step.variant;
  let icon = step.icon;

  if (step.manualComplete) {
    return {
      title,
      description,
      ctaLabel,
      variant,
      icon,
      progressLabel,
      stepId: step.id,
      action: { type: 'complete-step', stepId: step.id },
    };
  }

  let navigationAction = getOnboardingNavigationAction(step.route);

  if (step.id === 'track_delivery') {
    const completedCount = state.player.completedContracts ?? 0;
    const activeCount = state.activeDeliveries.length;
    if (activeCount === 0 && completedCount > 0) {
      title = 'Teslimat Tamamlandı';
      description = 'İlk teslimatın tamamlandı. Şimdi piyasayı keşfedebilirsin.';
      ctaLabel = 'Piyasaya Git';
      navigationAction = { type: 'navigate', tab: 'market' };
    }
  }

  if (step.id === 'claim_rewards') {
    const readyCount = countReadyStarterMissionRewards(state);
    const hasClaimed = hasClaimedAnyStarterReward(state);
    if (readyCount > 0) {
      title = 'Görev Ödüllerini Al';
      description = `${readyCount} görev ödülü seni bekliyor.`;
      ctaLabel = 'Görevlere Git';
    } else if (!hasClaimed) {
      title = 'Görev Ödülü Aç';
      description = 'İlk teslimatını tamamlayarak görev ödülü açabilirsin.';
      ctaLabel = 'İşlere Git';
      navigationAction = { type: 'navigate', tab: 'contracts' };
    } else {
      title = 'Görevleri Kontrol Et';
      description = 'Başlangıç görev ödüllerini aldın. Rehberi tamamlayabilirsin.';
      ctaLabel = 'Görevlere Git';
    }
    if (readyCount > 0 || hasClaimed) {
      navigationAction = getOnboardingNavigationAction('Missions');
    }
  }

  if (!navigationAction) {
    return {
      title,
      description,
      ctaLabel,
      variant,
      icon,
      progressLabel,
      stepId: step.id,
      action: { type: 'navigate', tab: 'dashboard' },
    };
  }

  return {
    title,
    description,
    ctaLabel,
    variant,
    icon,
    progressLabel,
    stepId: step.id,
    action: navigationAction,
  };
}

export function getOnboardingNavigationAction(route: OnboardingStepConfig['route']): OnboardingAction | null {
  switch (route) {
    case 'Dashboard':
      return { type: 'navigate', tab: 'dashboard' };
    case 'Contracts':
      return { type: 'navigate', tab: 'contracts' };
    case 'Map':
      return { type: 'navigate', tab: 'map' };
    case 'Market':
      return { type: 'navigate', tab: 'market' };
    case 'Warehouse':
      return { type: 'open-warehouse' };
    case 'Missions':
      return { type: 'open-missions' };
    default:
      return null;
  }
}

export function dispatchOnboardingNavigation(
  action: OnboardingAction,
  handlers: {
    navigate: (tab: TabKey) => void;
    openMissions: () => void;
    openWarehouse: () => void;
    completeStep: (stepId: OnboardingStepId) => void;
  },
): void {
  if (action.type === 'complete-step') {
    handlers.completeStep(action.stepId);
    return;
  }

  switch (action.type) {
    case 'navigate':
      handlers.navigate(action.tab);
      return;
    case 'open-missions':
      handlers.openMissions();
      return;
    case 'open-warehouse':
      handlers.openWarehouse();
      return;
    case 'claim':
      handlers.openMissions();
      return;
  }
}

export function buildOnboardingEvaluationState(
  state: Pick<OnboardingEvaluationState, 'onboarding' | 'activeDeliveries' | 'missions' | 'player'> & {
    getMissionProgress?: (missionId: string) => MissionProgressResult;
  },
): OnboardingEvaluationState {
  return {
    onboarding: state.onboarding,
    activeDeliveries: state.activeDeliveries ?? [],
    missions: state.missions,
    player: state.player,
    getMissionProgress: state.getMissionProgress,
  };
}

export function inferLegacyOnboardingFromSave(signals: {
  completedContracts: number;
  activeDeliveryCount: number;
  deliveryStarted: boolean;
  tradePurchased: boolean;
}): OnboardingState {
  const hasProgress =
    signals.completedContracts > 0 ||
    signals.activeDeliveryCount > 0 ||
    signals.deliveryStarted ||
    signals.tradePurchased;

  if (hasProgress) {
    return createCompletedOnboardingState();
  }

  return createDefaultOnboardingState();
}
