import {
  createDefaultMissionsState,
  ensureActiveMissionIds,
  getMissionById,
  STARTER_MISSION_IDS,
} from '../config/missions';
import { createDefaultTutorialState } from '../config/tutorial';
import { getNextTutorialStepId } from '../config/tutorial';
import {
  calculateCompanyScore,
  calculateInventoryValue,
} from '../simulation/companyScore';
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

export type MissionDisplayStatus = 'ready' | 'in_progress' | 'claimed';

export type MissionProgressState = Pick<
  StoreGameState,
  | 'player'
  | 'financeTotals'
  | 'financeLedger'
  | 'activeDeliveries'
  | 'missions'
  | 'cities'
  | 'products'
  | 'currentTime'
>;

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
  const activeMissionIds = ensureActiveMissionIds(
    safeStringArray(raw.activeMissionIds).length > 0
      ? migrateMissionIdList(safeStringArray(raw.activeMissionIds))
      : defaults.activeMissionIds,
  );

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

function getTotalTradeProfit(
  financeTotals: StoreGameState['financeTotals'],
  financeLedger: FinanceLedgerEntry[] | undefined,
): number {
  const sales = financeTotals?.incomeByCategory?.trade_sale ?? 0;
  const purchases = financeTotals?.expenseByCategory?.trade_purchase ?? 0;

  if (sales > 0 || purchases > 0) {
    return Math.max(0, sales - purchases);
  }

  let ledgerSales = 0;
  let ledgerPurchases = 0;
  for (const entry of financeLedger ?? []) {
    if (entry.category === 'trade_sale' && entry.type === 'income') {
      ledgerSales += entry.amount ?? 0;
    }
    if (entry.category === 'trade_purchase' && entry.type === 'expense') {
      ledgerPurchases += entry.amount ?? 0;
    }
  }

  return Math.max(0, ledgerSales - ledgerPurchases);
}

function getWarehouseInventoryMarketValue(state: MissionProgressState): number {
  return calculateInventoryValue(
    state.player?.warehouses,
    state.cities,
    state.products,
  );
}

function getOperationCityCount(state: MissionProgressState): number {
  const cityIds = new Set<string>();

  for (const truck of state.player?.trucks ?? []) {
    const cityId = truck.currentCityId ?? truck.homeCityId;
    if (cityId) {
      cityIds.add(cityId);
    }
  }

  for (const warehouse of state.player?.warehouses ?? []) {
    if (warehouse.cityId) {
      cityIds.add(warehouse.cityId);
    }
  }

  return cityIds.size;
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
  state: MissionProgressState,
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
    case 'complete_5_deliveries':
    case 'complete_10_deliveries':
      current = state.player?.completedContracts ?? 0;
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
    case 'reach_company_score_150k':
      current = calculateCompanyScore({
        player: state.player,
        cities: state.cities,
        products: state.products,
        financeLedger: state.financeLedger,
        currentTime: state.currentTime,
      });
      break;
    case 'own_2_trucks':
      current = (state.player?.trucks ?? []).filter((truck) => !truck.leaseExpired).length;
      break;
    case 'reach_warehouse_value_25000':
      current = getWarehouseInventoryMarketValue(state);
      break;
    case 'earn_10000_trade_profit':
      current = getTotalTradeProfit(state.financeTotals, state.financeLedger);
      break;
    case 'operate_in_3_cities':
      current = getOperationCityCount(state);
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

export function getMissionDisplayStatus(
  missionId: string,
  missions: MissionsState,
  progress: MissionProgressResult,
): MissionDisplayStatus {
  if (missions.claimedMissionRewardIds.includes(missionId)) {
    return 'claimed';
  }
  if (progress.isComplete) {
    return 'ready';
  }
  return 'in_progress';
}

function getMissionSortPriority(
  missionId: string,
  missions: MissionsState,
  progress: MissionProgressResult,
): number {
  const status = getMissionDisplayStatus(missionId, missions, progress);
  if (status === 'ready') return 0;
  if (status === 'in_progress') return 1;
  return 2;
}

export function sortMissionIdsForDisplay(
  missionIds: string[],
  missions: MissionsState,
  getProgress: (missionId: string) => MissionProgressResult,
): string[] {
  return [...missionIds].sort((a, b) => {
    const progressA = getProgress(a);
    const progressB = getProgress(b);
    const priorityDiff =
      getMissionSortPriority(a, missions, progressA) -
      getMissionSortPriority(b, missions, progressB);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const ratioA = progressA.target > 0 ? progressA.current / progressA.target : 0;
    const ratioB = progressB.target > 0 ? progressB.current / progressB.target : 0;
    if (ratioB !== ratioA) {
      return ratioB - ratioA;
    }

    return a.localeCompare(b);
  });
}

export function getDashboardMissionIds(
  missions: MissionsState,
  getProgress: (missionId: string) => MissionProgressResult,
  limit = 3,
): string[] {
  const claimed = new Set(missions.claimedMissionRewardIds);
  const starterRemaining = STARTER_MISSION_IDS.filter(
    (missionId) => missions.activeMissionIds.includes(missionId) && !claimed.has(missionId),
  );

  const pool =
    starterRemaining.length > 1
      ? starterRemaining
      : missions.activeMissionIds.filter((missionId) => !claimed.has(missionId));

  return sortMissionIdsForDisplay(pool, missions, getProgress).slice(0, limit);
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
  state: MissionProgressState,
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
