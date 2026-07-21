/**
 * Retention Pack V1 — milestone ve haftalık sezon görev ilerlemesi.
 */

import { MILESTONE_DEFINITIONS, type MilestoneDefinition } from '../data/milestones';
import {
  generateWeeklyObjectives,
  getWeeklyObjectiveDefinitions,
  type WeeklyObjectiveDefinition,
} from '../data/weeklyObjectives';
import { calculateCompanyScore } from './companyScore';
import { normalizeWarehouse } from './trading';
import { getWeeklySeasonKey } from '../utils/leaderboardSeason';
import type {
  FinanceLedgerEntry,
  RetentionLifetimeStats,
  RetentionMilestoneProgress,
  RetentionState,
  RetentionWeeklyStats,
  StoreGameState,
  WeeklySeasonObjectiveProgress,
} from '../types/game';

export const RETENTION_VERSION = 1;

export type RetentionEvent =
  | { type: 'contract_completed'; originCityId: string; destinationCityId: string; onTime: boolean; contractType?: string }
  | { type: 'special_contract_completed'; contractType: string }
  | { type: 'urgent_contract_completed' }
  | { type: 'fragile_contract_completed' }
  | { type: 'high_reputation_contract_completed' }
  | { type: 'driver_level_up'; driverId: string; newLevel: number }
  | { type: 'truck_upgraded'; truckId: string }
  | { type: 'truck_maintained'; truckId: string }
  | { type: 'trade_completed'; profit: number; productId?: string; side: 'buy' | 'sell' }
  | { type: 'warehouse_stock_changed'; totalStockTons: number }
  | { type: 'truck_purchased' }
  | { type: 'reputation_changed' }
  | { type: 'cash_changed' }
  | { type: 'company_score_changed' };

export type RetentionProgressState = Pick<
  StoreGameState,
  'player' | 'financeLedger' | 'cities' | 'products' | 'currentTime' | 'retention'
>;

function createEmptyWeeklyStats(): RetentionWeeklyStats {
  return {
    deliveriesCompleted: 0,
    tradeProfit: 0,
    stockStoredTons: 0,
    onTimeDeliveries: 0,
    citiesOperated: [],
    tradeBuyCount: 0,
    tradeSellCount: 0,
  };
}

function createEmptyLifetimeStats(): RetentionLifetimeStats {
  return {
    cityDeliveryCounts: {},
    urgentContractsCompleted: 0,
    fragileContractsCompleted: 0,
    highReputationContractsCompleted: 0,
    maintenanceCount: 0,
    truckUpgradeCount: 0,
    maxDriverLevel: 1,
  };
}

function initializeMilestoneProgress(): Record<string, RetentionMilestoneProgress> {
  const milestones: Record<string, RetentionMilestoneProgress> = {};
  for (const def of MILESTONE_DEFINITIONS) {
    milestones[def.id] = { progress: 0, isClaimed: false };
  }
  return milestones;
}

function initializeWeeklyObjectiveProgress(
  seasonKey: string,
): Record<string, WeeklySeasonObjectiveProgress> {
  const objectives: Record<string, WeeklySeasonObjectiveProgress> = {};
  for (const def of generateWeeklyObjectives(seasonKey)) {
    objectives[def.id] = { progress: 0, isClaimed: false };
  }
  return objectives;
}

export function createDefaultRetentionState(seasonKey: string = getWeeklySeasonKey()): RetentionState {
  return {
    retentionVersion: RETENTION_VERSION,
    milestones: initializeMilestoneProgress(),
    weeklyObjectives: initializeWeeklyObjectiveProgress(seasonKey),
    claimedBadges: [],
    currentWeeklySeasonKey: seasonKey,
    weeklyStats: createEmptyWeeklyStats(),
    lifetimeStats: createEmptyLifetimeStats(),
  };
}

function safeRecordProgress(
  raw: unknown,
): Record<string, RetentionMilestoneProgress | WeeklySeasonObjectiveProgress> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const result: Record<string, RetentionMilestoneProgress | WeeklySeasonObjectiveProgress> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const record = value as Record<string, unknown>;
    result[key] = {
      progress: Math.max(0, Number(record.progress) || 0),
      isClaimed: record.isClaimed === true,
      completedAt:
        typeof record.completedAt === 'number' && Number.isFinite(record.completedAt)
          ? record.completedAt
          : undefined,
    };
  }
  return result;
}

export function normalizeRetentionState(
  raw?: Partial<RetentionState> | null,
  seasonKey: string = getWeeklySeasonKey(),
): RetentionState {
  const defaults = createDefaultRetentionState(seasonKey);

  if (!raw) {
    return defaults;
  }

  const rawMilestones = safeRecordProgress(raw.milestones) as Record<string, RetentionMilestoneProgress>;
  const milestones = { ...defaults.milestones };
  for (const def of MILESTONE_DEFINITIONS) {
    if (rawMilestones[def.id]) {
      milestones[def.id] = {
        progress: Math.max(0, rawMilestones[def.id].progress),
        isClaimed: rawMilestones[def.id].isClaimed === true,
        completedAt: rawMilestones[def.id].completedAt,
      };
    }
  }

  const currentWeeklySeasonKey =
    typeof raw.currentWeeklySeasonKey === 'string' && raw.currentWeeklySeasonKey.length > 0
      ? raw.currentWeeklySeasonKey
      : seasonKey;

  const weeklyObjectivesDefaults = initializeWeeklyObjectiveProgress(currentWeeklySeasonKey);
  const rawWeekly = safeRecordProgress(raw.weeklyObjectives) as Record<
    string,
    WeeklySeasonObjectiveProgress
  >;
  const weeklyObjectives = { ...weeklyObjectivesDefaults };
  for (const [id, progress] of Object.entries(rawWeekly)) {
    if (weeklyObjectives[id]) {
      weeklyObjectives[id] = {
        progress: Math.max(0, progress.progress),
        isClaimed: progress.isClaimed === true,
        completedAt: progress.completedAt,
      };
    }
  }

  const rawWeeklyStats = raw.weeklyStats;
  const weeklyStats: RetentionWeeklyStats = {
    deliveriesCompleted: Math.max(0, Number(rawWeeklyStats?.deliveriesCompleted) || 0),
    tradeProfit: Math.max(0, Number(rawWeeklyStats?.tradeProfit) || 0),
    stockStoredTons: Math.max(0, Number(rawWeeklyStats?.stockStoredTons) || 0),
    onTimeDeliveries: Math.max(0, Number(rawWeeklyStats?.onTimeDeliveries) || 0),
    citiesOperated: Array.isArray(rawWeeklyStats?.citiesOperated)
      ? rawWeeklyStats!.citiesOperated.filter((c): c is string => typeof c === 'string')
      : [],
    tradeBuyCount: Math.max(0, Number(rawWeeklyStats?.tradeBuyCount) || 0),
    tradeSellCount: Math.max(0, Number(rawWeeklyStats?.tradeSellCount) || 0),
  };

  const rawLifetime = raw.lifetimeStats;
  const cityDeliveryCounts: Record<string, number> = {};
  if (rawLifetime?.cityDeliveryCounts && typeof rawLifetime.cityDeliveryCounts === 'object') {
    for (const [cityId, count] of Object.entries(rawLifetime.cityDeliveryCounts)) {
      cityDeliveryCounts[cityId] = Math.max(0, Number(count) || 0);
    }
  }

  return {
    retentionVersion:
      typeof raw.retentionVersion === 'number' && raw.retentionVersion > 0
        ? raw.retentionVersion
        : RETENTION_VERSION,
    milestones,
    weeklyObjectives,
    claimedBadges: Array.isArray(raw.claimedBadges)
      ? raw.claimedBadges.filter((b): b is string => typeof b === 'string')
      : [],
    currentWeeklySeasonKey,
    weeklyStats,
    lifetimeStats: {
      cityDeliveryCounts,
      urgentContractsCompleted: Math.max(0, Number(rawLifetime?.urgentContractsCompleted) || 0),
      fragileContractsCompleted: Math.max(0, Number(rawLifetime?.fragileContractsCompleted) || 0),
      highReputationContractsCompleted: Math.max(
        0,
        Number(rawLifetime?.highReputationContractsCompleted) || 0,
      ),
      maintenanceCount: Math.max(0, Number(rawLifetime?.maintenanceCount) || 0),
      truckUpgradeCount: Math.max(0, Number(rawLifetime?.truckUpgradeCount) || 0),
      maxDriverLevel: Math.max(1, Math.min(5, Number(rawLifetime?.maxDriverLevel) || 1)),
    },
  };
}

function sumTradeProfit(ledger: FinanceLedgerEntry[] | undefined): number {
  let purchases = 0;
  let sales = 0;
  for (const entry of ledger ?? []) {
    if (entry.category === 'trade_purchase' && entry.type === 'expense') {
      purchases += entry.amount ?? 0;
    }
    if (entry.category === 'trade_sale' && entry.type === 'income') {
      sales += entry.amount ?? 0;
    }
  }
  return Math.max(0, sales - purchases);
}

function sumProductTradeProfit(
  ledger: FinanceLedgerEntry[] | undefined,
  productId: string,
): number {
  let total = 0;
  for (const entry of ledger ?? []) {
    if (entry.category === 'trade_sale' && entry.meta?.productId === productId) {
      total += Math.max(0, entry.meta?.profit ?? 0);
    }
  }
  return total;
}

function countWarehouseStockTons(state: RetentionProgressState): number {
  let total = 0;
  for (const warehouse of state.player?.warehouses ?? []) {
    const normalized = normalizeWarehouse(warehouse);
    for (const item of normalized.inventory ?? []) {
      total += item.quantity ?? 0;
    }
  }
  return total;
}

function countWarehouseCities(state: RetentionProgressState): number {
  const cities = new Set<string>();
  for (const warehouse of state.player?.warehouses ?? []) {
    const stock = normalizeWarehouse(warehouse).inventory?.reduce(
      (sum, item) => sum + (item.quantity ?? 0),
      0,
    );
    if ((stock ?? 0) > 0) {
      cities.add(warehouse.cityId);
    }
  }
  return cities.size;
}

function countHighCapacityTrucks(state: RetentionProgressState, minCapacity: number): number {
  return (state.player?.trucks ?? []).filter((truck) => {
    if (truck.leaseExpired) {
      return false;
    }
    const capacity = truck.capacity ?? 0;
    return capacity >= minCapacity;
  }).length;
}

function countActiveTrucks(state: RetentionProgressState): number {
  return (state.player?.trucks ?? []).filter((truck) => !truck.leaseExpired).length;
}

function hasTradeBuyAndSell(state: RetentionProgressState): boolean {
  let hasBuy = false;
  let hasSell = false;
  for (const entry of state.financeLedger ?? []) {
    if (entry.category === 'trade_purchase') {
      hasBuy = true;
    }
    if (entry.category === 'trade_sale') {
      hasSell = true;
    }
    if (hasBuy && hasSell) {
      return true;
    }
  }
  return false;
}

export function computeMilestoneProgressValue(
  def: MilestoneDefinition,
  state: RetentionProgressState,
): number {
  const retention = normalizeRetentionState(state.retention);
  const metric = def.metric;

  switch (metric.type) {
    case 'completed_contracts':
      return state.player?.completedContracts ?? 0;
    case 'trade_profit_total':
      return sumTradeProfit(state.financeLedger);
    case 'trade_profit_product':
      return metric.productId
        ? sumProductTradeProfit(state.financeLedger, metric.productId)
        : 0;
    case 'trade_buy_and_sell':
      return hasTradeBuyAndSell(state) ? 1 : 0;
    case 'truck_count':
      return countActiveTrucks(state);
    case 'high_capacity_truck':
      return countHighCapacityTrucks(state, metric.minCapacity ?? 20) > 0 ? 1 : 0;
    case 'warehouse_active':
      return countWarehouseStockTons(state) > 0 ? 1 : 0;
    case 'warehouse_stock_tons':
      return countWarehouseStockTons(state);
    case 'warehouse_cities':
      return countWarehouseCities(state);
    case 'reputation':
      return state.player?.reputation ?? 0;
    case 'cash':
      return state.player?.money ?? 0;
    case 'company_score':
      return calculateCompanyScore(state);
    case 'city_deliveries':
      return metric.cityId
        ? retention.lifetimeStats.cityDeliveryCounts[metric.cityId] ?? 0
        : 0;
    case 'urgent_contracts_completed':
      return retention.lifetimeStats.urgentContractsCompleted ?? 0;
    case 'fragile_contracts_completed':
      return retention.lifetimeStats.fragileContractsCompleted ?? 0;
    case 'high_reputation_contracts_completed':
      return retention.lifetimeStats.highReputationContractsCompleted ?? 0;
    case 'driver_level_3': {
      const maxLevel = Math.max(
        ...(state.player?.drivers ?? []).map((d) => d.level ?? 1),
        retention.lifetimeStats.maxDriverLevel ?? 1,
      );
      return maxLevel;
    }
    case 'truck_upgraded':
      return retention.lifetimeStats.truckUpgradeCount ?? 0;
    case 'maintenance_count':
      return retention.lifetimeStats.maintenanceCount ?? 0;
    default:
      return 0;
  }
}

function computeWeeklyObjectiveProgressValue(
  def: WeeklyObjectiveDefinition,
  retention: RetentionState,
): number {
  const stats = retention.weeklyStats;
  switch (def.metric) {
    case 'weekly_deliveries':
      return stats.deliveriesCompleted;
    case 'weekly_trade_profit':
      return stats.tradeProfit;
    case 'weekly_stock_stored':
      return Math.max(stats.stockStoredTons, retention.weeklyStats.stockStoredTons);
    case 'weekly_on_time_deliveries':
      return stats.onTimeDeliveries;
    case 'weekly_cities_operated':
      return stats.citiesOperated.length;
    case 'weekly_trade_roundtrip':
      return stats.tradeBuyCount > 0 && stats.tradeSellCount > 0 ? 1 : 0;
    default:
      return 0;
  }
}

export function refreshWeeklyObjectivesIfNeeded(
  retention: RetentionState,
  seasonKey: string = getWeeklySeasonKey(),
): RetentionState {
  if (retention.currentWeeklySeasonKey === seasonKey) {
    return retention;
  }

  return {
    ...retention,
    currentWeeklySeasonKey: seasonKey,
    weeklyObjectives: initializeWeeklyObjectiveProgress(seasonKey),
    weeklyStats: createEmptyWeeklyStats(),
  };
}

export function applyRetentionEvent(
  retention: RetentionState,
  event: RetentionEvent,
): RetentionState {
  let next = refreshWeeklyObjectivesIfNeeded(retention);
  const weeklyStats = { ...next.weeklyStats };
  const lifetimeStats: RetentionLifetimeStats = {
    ...createEmptyLifetimeStats(),
    ...next.lifetimeStats,
    cityDeliveryCounts: { ...next.lifetimeStats.cityDeliveryCounts },
  };

  switch (event.type) {
    case 'contract_completed': {
      weeklyStats.deliveriesCompleted += 1;
      if (event.onTime) {
        weeklyStats.onTimeDeliveries += 1;
      }
      const cities = new Set(weeklyStats.citiesOperated);
      cities.add(event.originCityId);
      cities.add(event.destinationCityId);
      weeklyStats.citiesOperated = [...cities];

      for (const cityId of [event.originCityId, event.destinationCityId]) {
        lifetimeStats.cityDeliveryCounts[cityId] =
          (lifetimeStats.cityDeliveryCounts[cityId] ?? 0) + 1;
      }
      break;
    }
    case 'urgent_contract_completed':
      lifetimeStats.urgentContractsCompleted =
        (lifetimeStats.urgentContractsCompleted ?? 0) + 1;
      break;
    case 'fragile_contract_completed':
      lifetimeStats.fragileContractsCompleted =
        (lifetimeStats.fragileContractsCompleted ?? 0) + 1;
      break;
    case 'high_reputation_contract_completed':
      lifetimeStats.highReputationContractsCompleted =
        (lifetimeStats.highReputationContractsCompleted ?? 0) + 1;
      break;
    case 'driver_level_up':
      lifetimeStats.maxDriverLevel = Math.max(
        lifetimeStats.maxDriverLevel ?? 1,
        event.newLevel,
      );
      break;
    case 'truck_upgraded':
      lifetimeStats.truckUpgradeCount = (lifetimeStats.truckUpgradeCount ?? 0) + 1;
      break;
    case 'truck_maintained':
      lifetimeStats.maintenanceCount = (lifetimeStats.maintenanceCount ?? 0) + 1;
      break;
    case 'special_contract_completed': {
      const specialType = event.contractType;
      if (specialType === 'urgent') {
        lifetimeStats.urgentContractsCompleted =
          (lifetimeStats.urgentContractsCompleted ?? 0) + 1;
      } else if (specialType === 'fragile') {
        lifetimeStats.fragileContractsCompleted =
          (lifetimeStats.fragileContractsCompleted ?? 0) + 1;
      } else if (specialType === 'high_reputation') {
        lifetimeStats.highReputationContractsCompleted =
          (lifetimeStats.highReputationContractsCompleted ?? 0) + 1;
      }
      break;
    }
    case 'trade_completed': {
      if (event.profit > 0) {
        weeklyStats.tradeProfit += event.profit;
      }
      if (event.side === 'buy') {
        weeklyStats.tradeBuyCount += 1;
      } else {
        weeklyStats.tradeSellCount += 1;
      }
      break;
    }
    case 'warehouse_stock_changed': {
      weeklyStats.stockStoredTons = Math.max(
        weeklyStats.stockStoredTons,
        event.totalStockTons,
      );
      break;
    }
    default:
      break;
  }

  return {
    ...next,
    weeklyStats,
    lifetimeStats,
  };
}

export function syncRetentionProgressState(state: RetentionProgressState): RetentionState {
  const seasonKey = getWeeklySeasonKey();
  let retention = normalizeRetentionState(state.retention, seasonKey);
  retention = refreshWeeklyObjectivesIfNeeded(retention, seasonKey);

  const milestones = { ...retention.milestones };
  for (const def of MILESTONE_DEFINITIONS) {
    const existing = milestones[def.id] ?? { progress: 0, isClaimed: false };
    if (existing.isClaimed) {
      milestones[def.id] = existing;
      continue;
    }
    const progress = computeMilestoneProgressValue(def, { ...state, retention });
    const completed = progress >= def.target;
    milestones[def.id] = {
      progress: Math.min(progress, def.target),
      isClaimed: false,
      completedAt: completed ? existing.completedAt ?? state.currentTime : undefined,
    };
  }

  const weeklyDefs = getWeeklyObjectiveDefinitions(seasonKey);
  const weeklyObjectives = { ...retention.weeklyObjectives };
  for (const def of weeklyDefs) {
    const existing = weeklyObjectives[def.id] ?? { progress: 0, isClaimed: false };
    if (existing.isClaimed) {
      weeklyObjectives[def.id] = existing;
      continue;
    }
    const stockTons = countWarehouseStockTons(state);
    retention = {
      ...retention,
      weeklyStats: {
        ...retention.weeklyStats,
        stockStoredTons: Math.max(retention.weeklyStats.stockStoredTons, stockTons),
      },
    };
    const progress = computeWeeklyObjectiveProgressValue(def, retention);
    const completed = progress >= def.target;
    weeklyObjectives[def.id] = {
      progress: Math.min(progress, def.target),
      isClaimed: false,
      completedAt: completed ? existing.completedAt ?? state.currentTime : undefined,
    };
  }

  return {
    ...retention,
    milestones,
    weeklyObjectives,
  };
}

export interface RetentionObjectiveView {
  id: string;
  progress: number;
  target: number;
  isComplete: boolean;
  isClaimed: boolean;
}

export function getReadyMilestones(retention: RetentionState): string[] {
  return MILESTONE_DEFINITIONS.filter((def) => {
    const entry = retention.milestones[def.id];
    return entry && !entry.isClaimed && entry.progress >= def.target;
  }).map((def) => def.id);
}

export function getReadyWeeklyObjectives(
  retention: RetentionState,
  seasonKey: string = getWeeklySeasonKey(),
): string[] {
  return getWeeklyObjectiveDefinitions(seasonKey)
    .filter((def) => {
      const entry = retention.weeklyObjectives[def.id];
      return entry && !entry.isClaimed && entry.progress >= def.target;
    })
    .map((def) => def.id);
}

export function getRetentionSummary(retention: RetentionState): {
  readyMilestones: number;
  readyWeekly: number;
  readyRewards: number;
  weeklyInProgress: number;
  weeklyTotal: number;
} {
  const seasonKey = retention.currentWeeklySeasonKey || getWeeklySeasonKey();
  const readyMilestones = getReadyMilestones(retention).length;
  const readyWeekly = getReadyWeeklyObjectives(retention, seasonKey).length;
  const weeklyDefs = getWeeklyObjectiveDefinitions(seasonKey);
  const weeklyInProgress = weeklyDefs.filter((def) => {
    const entry = retention.weeklyObjectives[def.id];
    return entry && !entry.isClaimed && entry.progress > 0 && entry.progress < def.target;
  }).length;

  return {
    readyMilestones,
    readyWeekly,
    readyRewards: readyMilestones + readyWeekly,
    weeklyInProgress,
    weeklyTotal: weeklyDefs.length,
  };
}

export function claimMilestoneRewardState(
  retention: RetentionState,
  milestoneId: string,
  currentTime: number,
): { ok: true; retention: RetentionState } | { ok: false; error: string } {
  const def = MILESTONE_DEFINITIONS.find((m) => m.id === milestoneId);
  if (!def) {
    return { ok: false, error: 'milestone-not-found' };
  }

  const entry = retention.milestones[milestoneId];
  if (!entry) {
    return { ok: false, error: 'milestone-not-found' };
  }
  if (entry.isClaimed) {
    return { ok: false, error: 'already-claimed' };
  }
  if (entry.progress < def.target) {
    return { ok: false, error: 'not-complete' };
  }

  const claimedBadges = def.reward.badgeId
    ? [...new Set([...retention.claimedBadges, def.reward.badgeId])]
    : retention.claimedBadges;

  return {
    ok: true,
    retention: {
      ...retention,
      claimedBadges,
      milestones: {
        ...retention.milestones,
        [milestoneId]: {
          ...entry,
          isClaimed: true,
          completedAt: entry.completedAt ?? currentTime,
        },
      },
    },
  };
}

export function claimWeeklyObjectiveRewardState(
  retention: RetentionState,
  objectiveId: string,
  seasonKey: string,
  currentTime: number,
): { ok: true; retention: RetentionState } | { ok: false; error: string } {
  const def = getWeeklyObjectiveDefinitions(seasonKey).find((obj) => obj.id === objectiveId);
  if (!def) {
    return { ok: false, error: 'objective-not-found' };
  }

  const entry = retention.weeklyObjectives[objectiveId];
  if (!entry) {
    return { ok: false, error: 'objective-not-found' };
  }
  if (entry.isClaimed) {
    return { ok: false, error: 'already-claimed' };
  }
  if (entry.progress < def.target) {
    return { ok: false, error: 'not-complete' };
  }

  return {
    ok: true,
    retention: {
      ...retention,
      weeklyObjectives: {
        ...retention.weeklyObjectives,
        [objectiveId]: {
          ...entry,
          isClaimed: true,
          completedAt: entry.completedAt ?? currentTime,
        },
      },
    },
  };
}

export function sortMilestoneIdsForDisplay(
  ids: string[],
  retention: RetentionState,
): string[] {
  return [...ids].sort((a, b) => {
    const aEntry = retention.milestones[a];
    const bEntry = retention.milestones[b];
    const aDef = MILESTONE_DEFINITIONS.find((m) => m.id === a);
    const bDef = MILESTONE_DEFINITIONS.find((m) => m.id === b);
    if (!aDef || !bDef || !aEntry || !bEntry) {
      return 0;
    }

    const score = (entry: RetentionMilestoneProgress, def: MilestoneDefinition) => {
      if (!entry.isClaimed && entry.progress >= def.target) return 0;
      if (!entry.isClaimed) return 1;
      return 2;
    };

    const diff = score(aEntry, aDef) - score(bEntry, bDef);
    if (diff !== 0) {
      return diff;
    }
    return aDef.title.localeCompare(bDef.title, 'tr');
  });
}

export function sortWeeklyObjectiveIdsForDisplay(
  ids: string[],
  retention: RetentionState,
  seasonKey: string,
): string[] {
  const defs = getWeeklyObjectiveDefinitions(seasonKey);
  return [...ids].sort((a, b) => {
    const aDef = defs.find((d) => d.id === a);
    const bDef = defs.find((d) => d.id === b);
    const aEntry = retention.weeklyObjectives[a];
    const bEntry = retention.weeklyObjectives[b];
    if (!aDef || !bDef || !aEntry || !bEntry) {
      return 0;
    }

    const score = (entry: WeeklySeasonObjectiveProgress, def: WeeklyObjectiveDefinition) => {
      if (!entry.isClaimed && entry.progress >= def.target) return 0;
      if (!entry.isClaimed) return 1;
      return 2;
    };

    const diff = score(aEntry, aDef) - score(bEntry, bDef);
    if (diff !== 0) {
      return diff;
    }
    return aDef.slot.localeCompare(bDef.slot);
  });
}
