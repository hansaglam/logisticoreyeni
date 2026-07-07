import { createDefaultMissionsState, getMissionById } from '../config/missions';
import { createDefaultTutorialState } from '../config/tutorial';
import { getNextTutorialStepId } from '../config/tutorial';
import type {
  FinanceLedgerEntry,
  MissionsState,
  StoreGameState,
  TutorialState,
  TutorialStepId,
} from '../types/game';

export interface MissionProgressResult {
  current: number;
  target: number;
  isComplete: boolean;
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function normalizeTutorialState(raw?: Partial<TutorialState> | null): TutorialState {
  const defaults = createDefaultTutorialState();
  if (!raw) {
    return defaults;
  }

  const currentStepId =
    typeof raw.currentStepId === 'string' &&
    [
      'open_contracts',
      'select_contract',
      'assign_team',
      'track_delivery',
      'complete_delivery',
      'open_market',
    ].includes(raw.currentStepId)
      ? (raw.currentStepId as TutorialStepId)
      : defaults.currentStepId;

  return {
    isEnabled: typeof raw.isEnabled === 'boolean' ? raw.isEnabled : defaults.isEnabled,
    isCompleted: typeof raw.isCompleted === 'boolean' ? raw.isCompleted : defaults.isCompleted,
    currentStepId,
    completedStepIds: safeStringArray(raw.completedStepIds),
    dismissedStepIds: safeStringArray(raw.dismissedStepIds),
  };
}

function migrateLegacyMissionId(missionId: string): string {
  return missionId === 'first_contract' ? 'first_contract_start' : missionId;
}

function migrateMissionIdList(ids: string[]): string[] {
  const migrated = ids.map(migrateLegacyMissionId);
  return [...new Set(migrated)];
}

export function normalizeMissionsState(raw?: Partial<MissionsState> | null): MissionsState {
  const defaults = createDefaultMissionsState();
  if (!raw) {
    return defaults;
  }

  const flags = raw.flags ?? defaults.flags;
  const activeMissionIds =
    safeStringArray(raw.activeMissionIds).length > 0
      ? migrateMissionIdList(safeStringArray(raw.activeMissionIds))
      : defaults.activeMissionIds;

  return {
    activeMissionIds,
    completedMissionIds: migrateMissionIdList(safeStringArray(raw.completedMissionIds)),
    claimedMissionRewardIds: migrateMissionIdList(safeStringArray(raw.claimedMissionRewardIds)),
    flags: {
      marketOpened: flags.marketOpened === true,
      deliveryStarted: flags.deliveryStarted === true,
      tradePurchased: flags.tradePurchased === true,
    },
  };
}

function countLedgerCategory(
  ledger: FinanceLedgerEntry[] | undefined,
  category: FinanceLedgerEntry['category'],
): number {
  return (ledger ?? []).filter((entry) => entry.category === category).length;
}

function getContractIncomeTotal(
  financeTotals: StoreGameState['financeTotals'],
  financeLedger: FinanceLedgerEntry[] | undefined,
): number {
  const fromTotals = financeTotals?.incomeByCategory?.contract_income ?? 0;

  if (fromTotals > 0) {
    return fromTotals;
  }

  return (financeLedger ?? [])
    .filter(
      (entry) =>
        entry.type === 'income' &&
        (entry.category === 'contract_income' || entry.category === 'delivery_income'),
    )
    .reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
}

function countStartedDeliveries(
  state: Pick<StoreGameState, 'player' | 'activeDeliveries' | 'missions'>,
): number {
  const missions = state.missions ?? createDefaultMissionsState();
  const hasActive = (state.activeDeliveries?.length ?? 0) > 0;
  const hasCompleted = (state.player.completedContracts ?? 0) > 0;
  const flagged = missions.flags.deliveryStarted === true;
  return hasActive || hasCompleted || flagged ? 1 : 0;
}

export function getMissionProgress(
  missionId: string,
  state: Pick<StoreGameState, 'player' | 'financeTotals' | 'financeLedger' | 'activeDeliveries' | 'missions'>,
): MissionProgressResult {
  const mission = getMissionById(missionId);
  const target = mission?.targetValue ?? 1;
  const missions = state.missions ?? createDefaultMissionsState();
  let current = 0;

  switch (missionId) {
    case 'first_contract_start':
    case 'first_contract':
      current = countStartedDeliveries(state);
      break;
    case 'first_delivery':
      current = state.player.completedContracts ?? 0;
      break;
    case 'first_profit':
      current = getContractIncomeTotal(state.financeTotals, state.financeLedger);
      break;
    case 'open_market':
      current = missions.flags.marketOpened ? 1 : 0;
      break;
    case 'first_trade':
      current =
        missions.flags.tradePurchased ||
        countLedgerCategory(state.financeLedger, 'trade_purchase') > 0
          ? 1
          : 0;
      break;
    default:
      current = 0;
  }

  const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
  return {
    current: Math.min(safeCurrent, target),
    target,
    isComplete: safeCurrent >= target,
  };
}

function markTutorialStepCompleted(tutorial: TutorialState, stepId: TutorialStepId): TutorialState {
  const completedStepIds = tutorial.completedStepIds.includes(stepId)
    ? tutorial.completedStepIds
    : [...tutorial.completedStepIds, stepId];
  return { ...tutorial, completedStepIds };
}

function advanceTutorialStep(
  tutorial: TutorialState,
  completedStepId: TutorialStepId,
  nextStepId: TutorialStepId | null,
  markCompleted = true,
): TutorialState {
  if (!tutorial.isEnabled || tutorial.isCompleted) {
    return tutorial;
  }

  let next = tutorial;
  if (markCompleted) {
    next = markTutorialStepCompleted(next, completedStepId);
  }

  if (tutorial.currentStepId !== completedStepId) {
    return next;
  }

  if (!nextStepId) {
    return {
      ...next,
      isCompleted: true,
      currentStepId: completedStepId,
    };
  }

  return {
    ...next,
    currentStepId: nextStepId,
  };
}

export function tutorialOnContractsOpened(tutorial: TutorialState): TutorialState {
  return advanceTutorialStep(tutorial, 'open_contracts', 'select_contract');
}

export function tutorialOnContractAssignmentOpened(tutorial: TutorialState): TutorialState {
  return advanceTutorialStep(tutorial, 'select_contract', 'assign_team');
}

export function tutorialOnDeliveryStarted(tutorial: TutorialState): TutorialState {
  return advanceTutorialStep(tutorial, 'assign_team', 'track_delivery');
}

export function tutorialOnActiveDeliverySeen(tutorial: TutorialState): TutorialState {
  return advanceTutorialStep(tutorial, 'track_delivery', 'complete_delivery');
}

export function tutorialOnFirstDeliveryCompleted(tutorial: TutorialState): TutorialState {
  return advanceTutorialStep(tutorial, 'complete_delivery', 'open_market');
}

export function tutorialOnMarketOpened(tutorial: TutorialState): TutorialState {
  const advanced = advanceTutorialStep(tutorial, 'open_market', null);
  return {
    ...advanced,
    isCompleted: true,
    completedStepIds: advanced.completedStepIds.includes('open_market')
      ? advanced.completedStepIds
      : [...advanced.completedStepIds, 'open_market'],
    currentStepId: 'open_market',
  };
}

export function completeTutorialStepState(
  tutorial: TutorialState,
  stepId: TutorialStepId,
): TutorialState {
  const nextStepId = getNextTutorialStepId(stepId);
  return advanceTutorialStep(tutorial, stepId, nextStepId);
}

export function setCurrentTutorialStepState(
  tutorial: TutorialState,
  stepId: TutorialStepId,
): TutorialState {
  return {
    ...tutorial,
    currentStepId: stepId,
  };
}

export function dismissTutorialStepState(
  tutorial: TutorialState,
  stepId: TutorialStepId,
): TutorialState {
  const dismissedStepIds = tutorial.dismissedStepIds.includes(stepId)
    ? tutorial.dismissedStepIds
    : [...tutorial.dismissedStepIds, stepId];
  return { ...tutorial, dismissedStepIds };
}

export function syncMissionsState(
  missions: MissionsState,
  state: Pick<StoreGameState, 'player' | 'financeTotals' | 'financeLedger' | 'activeDeliveries' | 'missions'>,
): MissionsState {
  const completed = new Set(missions.completedMissionIds);

  for (const missionId of missions.activeMissionIds) {
    const progress = getMissionProgress(missionId, { ...state, missions });
    if (progress.isComplete) {
      completed.add(missionId);
    }
  }

  return {
    ...missions,
    completedMissionIds: [...completed],
  };
}
