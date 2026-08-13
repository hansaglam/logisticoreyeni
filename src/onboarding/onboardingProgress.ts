import type { NextActionDispatch } from '../components/dashboard/dashboardHubLogic';
import type { TabKey } from '../navigation/tabTypes';
import { STARTER_MISSION_IDS } from '../config/missions';
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
  getOnboardingProgressLabel,
  getOnboardingStepById,
  KNOWN_ONBOARDING_STEP_IDS,
  migrateOnboardingStepId,
  ONBOARDING_STEP_ORDER,
  ONBOARDING_TOTAL_STEPS,
  type OnboardingStepConfig,
} from './onboardingConfig';

export const ONBOARDING_STATE_VERSION = 2;

export interface OnboardingEvaluationState {
  onboarding: OnboardingState;
  activeDeliveries: Delivery[];
  missions: MissionsState;
  player: Player;
  currentTime?: number;
  getMissionProgress?: (missionId: string) => MissionProgressResult;
}

export function createDefaultOnboardingState(): OnboardingState {
  return {
    version: ONBOARDING_STATE_VERSION,
    enabled: true,
    completed: false,
    currentStepId: 'choose_first_contract',
    completedStepIds: [],
    dismissedHintIds: [],
    visitedScreens: [],
    assignmentOpened: false,
  };
}

export function createCompletedOnboardingState(): OnboardingState {
  return {
    version: ONBOARDING_STATE_VERSION,
    enabled: false,
    completed: true,
    currentStepId: null,
    completedStepIds: [...ONBOARDING_STEP_ORDER],
    dismissedHintIds: [],
    visitedScreens: [],
    assignmentOpened: false,
    missionRewardClaimed: true,
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
    ? raw.completedStepIds
        .map((id) => migrateOnboardingStepId(id))
        .filter((id): id is OnboardingStepId => id != null)
    : [];

  const completed = raw.completed === true;
  let currentStepId = migrateOnboardingStepId(raw.currentStepId);

  if (completed) {
    currentStepId = null;
  }

  return {
    version: ONBOARDING_STATE_VERSION,
    enabled: raw.enabled !== false,
    completed,
    currentStepId,
    completedStepIds,
    dismissedHintIds,
    visitedScreens,
    assignmentOpened: raw.assignmentOpened === true,
    missionRewardClaimed: raw.missionRewardClaimed === true,
    startedAtGameTime:
      typeof raw.startedAtGameTime === 'number' ? raw.startedAtGameTime : undefined,
    completedAtGameTime:
      typeof raw.completedAtGameTime === 'number' ? raw.completedAtGameTime : undefined,
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

function shouldCompleteOnboarding(state: OnboardingEvaluationState): boolean {
  const { onboarding } = state;

  if (onboarding.missionRewardClaimed) {
    return true;
  }

  if (hasClaimedAnyStarterReward(state)) {
    return true;
  }

  if (!hasVisitedScreen(onboarding, 'Missions')) {
    return false;
  }

  const readyStarterCount = countReadyStarterMissionRewards(state);
  if (readyStarterCount > 0) {
    return false;
  }

  const completedContracts = state.player.completedContracts ?? 0;
  if (completedContracts >= 1) {
    return true;
  }

  return areAllActiveStarterRewardsClaimed(state);
}

/** Mevcut oyun durumundan doğru onboarding adımını belirler */
export function resolveOnboardingStep(
  state: OnboardingEvaluationState,
): OnboardingStepId | null {
  const { onboarding, activeDeliveries, missions, player } = state;

  if (onboarding.completed) {
    return null;
  }

  if (shouldCompleteOnboarding(state)) {
    return null;
  }

  const completedContracts = player.completedContracts ?? 0;
  const activeCount = activeDeliveries.length;
  const deliveryStarted = missions.flags.deliveryStarted === true || activeCount > 0;
  const mapVisited = hasVisitedScreen(onboarding, 'Map');

  if (completedContracts >= 1) {
    return 'claim_first_reward';
  }

  if (deliveryStarted) {
    if (mapVisited) {
      return 'complete_first_delivery';
    }
    return 'track_delivery';
  }

  if (onboarding.assignmentOpened) {
    return 'assign_team';
  }

  return 'choose_first_contract';
}

function collectCompletedStepsBefore(stepId: OnboardingStepId): OnboardingStepId[] {
  const index = ONBOARDING_STEP_ORDER.indexOf(stepId);
  if (index <= 0) {
    return [];
  }
  return ONBOARDING_STEP_ORDER.slice(0, index);
}

/** Tek sync helper — event sonrası ve save load'da çağrılır */
export function syncOnboardingProgress(state: OnboardingEvaluationState): OnboardingState {
  const { onboarding } = state;

  if (onboarding.completed) {
    return onboarding;
  }

  const resolvedStep = resolveOnboardingStep(state);

  if (resolvedStep === null) {
    return {
      ...onboarding,
      enabled: false,
      completed: true,
      currentStepId: null,
      completedStepIds: [...ONBOARDING_STEP_ORDER],
      completedAtGameTime:
        onboarding.completedAtGameTime ?? state.currentTime ?? onboarding.completedAtGameTime,
    };
  }

  const priorSteps = collectCompletedStepsBefore(resolvedStep);
  const completedStepIds = [
    ...new Set([...onboarding.completedStepIds, ...priorSteps, resolvedStep]),
  ].filter((id): id is OnboardingStepId => KNOWN_ONBOARDING_STEP_IDS.has(id as OnboardingStepId));

  return {
    ...onboarding,
    version: ONBOARDING_STATE_VERSION,
    currentStepId: resolvedStep,
    completedStepIds,
    startedAtGameTime:
      onboarding.startedAtGameTime ?? state.currentTime ?? onboarding.startedAtGameTime,
  };
}

/** @deprecated syncOnboardingProgress kullan */
export function advanceOnboardingIfNeeded(state: OnboardingEvaluationState): OnboardingState {
  return syncOnboardingProgress(state);
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

export function markOnboardingAssignmentOpened(onboarding: OnboardingState): OnboardingState {
  if (onboarding.assignmentOpened) {
    return onboarding;
  }
  return {
    ...onboarding,
    assignmentOpened: true,
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
    completedStepIds: [...ONBOARDING_STEP_ORDER],
  };
}

export function resetOnboardingForDev(): OnboardingState {
  return createDefaultOnboardingState();
}

export const resetOnboardingForTesting = resetOnboardingForDev;

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
  | { type: 'open-warehouse' };

export interface OnboardingDashboardAction {
  title: string;
  description: string;
  ctaLabel: string;
  variant: OnboardingStepConfig['variant'];
  icon: OnboardingStepConfig['icon'];
  progressLabel: string;
  stepId: OnboardingStepId;
  stepIndex: number;
  totalSteps: number;
  showArtwork: boolean;
  action: OnboardingAction;
}

/** @deprecated UI removed — domain helper kept for tests / dev tooling */
export function resolveOnboardingDashboardAction(
  state: OnboardingEvaluationState,
): OnboardingDashboardAction | null {
  const step = getCurrentOnboardingStep(state);
  if (!step || !state.onboarding.currentStepId) {
    return null;
  }

  const stepIndex = ONBOARDING_STEP_ORDER.indexOf(state.onboarding.currentStepId) + 1;
  const progressLabel = getOnboardingProgressLabel(state.onboarding.currentStepId);
  let title = step.title;
  let description = step.dashboardDescription ?? step.description;
  let ctaLabel = step.ctaLabel;
  const variant = step.variant;
  const icon = step.icon;
  let showArtwork = step.showArtwork === true;

  let navigationAction = getOnboardingNavigationAction(step.route);

  if (step.id === 'claim_first_reward') {
    const readyCount = countReadyStarterMissionRewards(state);
    const hasClaimed = hasClaimedAnyStarterReward(state);
    if (readyCount > 0) {
      title = 'İlk Ödülünü Al';
      description = `${readyCount} görev ödülü seni bekliyor.`;
      ctaLabel = 'Görevlere Git';
    } else if (!hasClaimed) {
      description = 'Başlangıç görev ödülünü almak için görevler ekranını aç.';
      ctaLabel = 'Görevlere Git';
    }
    showArtwork = false;
    navigationAction = getOnboardingNavigationAction('Missions');
  }

  if (step.id === 'complete_first_delivery') {
    const activeCount = state.activeDeliveries.length;
    if (activeCount > 0) {
      ctaLabel = 'Teslimatı Gör';
      navigationAction = { type: 'navigate', tab: 'map' };
    }
  }

  if (step.id === 'assign_team') {
    showArtwork = false;
  }

  if (!navigationAction) {
    navigationAction = { type: 'navigate', tab: 'dashboard' };
  }

  return {
    title,
    description,
    ctaLabel,
    variant,
    icon,
    progressLabel,
    stepId: step.id,
    stepIndex,
    totalSteps: ONBOARDING_TOTAL_STEPS,
    showArtwork,
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
  },
): void {
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
    currentTime?: number;
    getMissionProgress?: (missionId: string) => MissionProgressResult;
  },
): OnboardingEvaluationState {
  return {
    onboarding: state.onboarding,
    activeDeliveries: state.activeDeliveries ?? [],
    missions: state.missions,
    player: state.player,
    currentTime: state.currentTime,
    getMissionProgress: state.getMissionProgress,
  };
}

export function inferLegacyOnboardingFromSave(signals: {
  completedContracts: number;
  activeDeliveryCount: number;
  deliveryStarted: boolean;
  tradePurchased: boolean;
  playerLevel?: number;
  tutorialCompleted?: boolean;
  onboardingPreviouslyCompleted?: boolean;
}): OnboardingState {
  const hasProgress =
    signals.onboardingPreviouslyCompleted === true ||
    signals.completedContracts >= 1 ||
    signals.activeDeliveryCount > 0 ||
    signals.deliveryStarted ||
    signals.tradePurchased ||
    (signals.playerLevel ?? 1) > 1 ||
    signals.tutorialCompleted === true;

  if (hasProgress) {
    return createCompletedOnboardingState();
  }

  return createDefaultOnboardingState();
}
