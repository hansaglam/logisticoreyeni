/**
 * LogistiCore - Merkezi oyun state yönetimi (Zustand)
 *
 * Ekonomi, sözleşme ve teslimat simülasyon modüllerini birleştirir.
 * React Native / Expo bileşenleri useGameStore hook'u ile state'e erişir.
 *
 * Kurulum: npm install zustand
 */

import { create } from 'zustand';
import type {
  City,
  Contract,
  Delivery,
  DeliveryFailureReason,
  Driver,
  GameEvent,
  GlobalEconomy,
  GameNotification,
  GameNotificationActionTarget,
  FinanceLedgerEntry,
  MarketContractFilter,
  MarketNews,
  MarketOpportunity,
  ProductId,
  SimulationGameState,
  SpotlightTutorialId,
  StartDeliveryResult,
  StartTruckTransferResult,
  StoreGameState,
  TradeActionResult,
  Truck,
  TruckTransfer,
  TutorialStepId,
  Warehouse,
  WarehouseType,
} from '../types/game';
import { resolveNotificationDismissMs } from '../types/game';
import { CITIES } from '../data/cities';
import { PRODUCTS } from '../data/products';
import { ROUTES } from '../data/routes';
import {
  getCityName,
  getCityByIdSafe,
  getProductByIdSafe,
  getProductName,
} from '../utils/entityLookup';
import {
  addFinanceLedgerEntries,
  createEmptyFinanceTotals,
  hasDeliveryCompletionLedgerEntry,
} from '../utils/financeLedger';
import {
  findDriverPoolItem,
  getDriverPoolForLevel,
  getDriverTierLabel,
  isDriverPoolItemHired,
  normalizeDriver,
  resolveDriverRequiredLevel,
  STARTER_DRIVER,
} from '../data/drivers';
import { findTruckMarketItem, resolveTruckMarketRequiredLevel, STARTER_TRUCK } from '../data/trucks';
import {
  createDefaultGlobalEconomy,
  getSafeFuelPrice,
  normalizeGlobalEconomy,
  updateAllCitiesEconomy,
} from '../simulation/economy';
import { randomBetween, randomIntBetween } from '../utils/math';
import {
  expireOldContracts,
  generateContracts,
  getRouteBetweenCities,
  mergeContractLists,
  balanceAvailableContractLevelMix,
  refreshContractsFromMarket,
  replenishAvailableContracts,
  processContractGenerationSchedule,
  type ContractGenerationDebugSnapshot,
} from '../simulation/contracts';
import { ensureStarterContracts } from '../simulation/starterContracts';
import {
  availabilityReasonToStartDeliveryErrorCode,
  calculateDeliverySettlement,
  calculateFailurePenalty,
  calculateLatePenalty,
  calculateTruckRepairCost,
  canTruckCarryContract,
  createDelivery,
  getContractAvailability,
  getContractCargoWeight,
  getHighestOwnedTruckCapacity,
  getMaxIdleTruckCapacity,
  isDeliveryProgressComplete,
  safeCompleteDelivery,
  DeliveryError,
  failDelivery as failDeliverySim,
  formatCapacityExceededMessage,
  getIdleTruckOriginCityIds,
  normalizeTruckCity,
  resolveTruckCityId,
  selectIdleTruckForContract,
  updateDeliveryProgress,
  type DeliverySettlementDebugSnapshot,
  type DeliverySettlementResult,
} from '../simulation/delivery';
import {
  createTruckTransfer,
  resolveTransferRoute,
  selectDriverForTransfer,
  updateTransferProgress,
} from '../simulation/truckTransfer';
import {
  calculateTradeBuyCost,
  calculateTradeProfit,
  calculateTradeSellRevenue,
  getCityProductMarketPrice,
  getCityProductStock,
  getProductDisplayName,
  getWarehouseFreeCapacityTon,
  getWarehouseInventoryItem,
  mergeInventoryOnBuy,
  normalizeWarehouse,
  reduceInventoryOnSell,
} from '../simulation/trading';
import {
  buildStorageWarningForPurchase,
  evaluateStorageSuitability,
  getWarehouseTypeLabel,
  processWarehouseQualityDegradation,
  resolveWarehouseType,
} from '../simulation/warehouseStorage';
import {
  completeTutorialStepState,
  dismissTutorialStepState,
  getMissionProgress,
  setCurrentTutorialStepState,
  syncMissionsState,
  tutorialOnActiveDeliverySeen,
  tutorialOnContractAssignmentOpened,
  tutorialOnContractsOpened,
  tutorialOnDeliveryStarted,
  tutorialOnFirstDeliveryCompleted,
  tutorialOnMarketOpened,
} from '../utils/missionProgress';
import type { MissionProgressResult } from '../utils/missionProgress';
import {
  calculateWarehouseDailyOperatingCostBreakdown,
  estimateWarehouseUpgradeCost,
} from '../utils/warehouseCalculations';
import { contractBalance, contractGenerationBalance, economyBalance, getMsPerGameHour, levelBalance, operatingCostBalance, timeBalance, tradingBalance, warehouseBalance } from '../config/balance';
import { createDefaultMissionsState } from '../config/missions';
import { getMissionById } from '../config/missions';
import { createDefaultTutorialState } from '../config/tutorial';
import {
  clearSpotlightTutorialProgressState,
  createDefaultSpotlightTutorialState,
  markSpotlightTutorialCompletedState,
  markSpotlightTutorialSkippedState,
} from '../tutorial/spotlightTutorialState';
import {
  buildSummarizedDailyOperatingCostLedgerEntry,
  calculateDailyOperatingCostBreakdown,
  computeElapsedOperatingDays,
  formatOperatingCostEventLogMessage,
  formatOperatingCostNotificationMessage,
  getSkippedOperatingDaysDueToCap,
  processExpiredTruckLeases,
  resolveOperatingCostElapsedDays,
  type DailyOperatingCostReason,
} from '../simulation/dailyOperatingCosts';
import { getMaxContractTonnageForLevel } from '../config/levelConfig';
import {
  canOpenMoreWarehouses,
  getMaxWarehousesForLevel,
  getNextLevelForMoreWarehouses,
  getWarehouseUpgradeCapacityGain,
  getWarehouseUpgradeRequiredLevel,
  isWarehouseCityUnlocked,
  levelConfig,
} from '../config/levelConfig';
import {
  applyXpToPlayer,
  calculateDeliveryXp,
  calculateTradeSaleXp,
  calculateXpToNextLevel,
  getDeliveryRiskTier,
  getLevelBenefits as resolveLevelBenefits,
  getMaxTonnageForLevel,
  normalizePlayerProgress,
} from '../simulation/leveling';
import type { ApplyXpResult, LevelBenefits } from '../simulation/leveling';
import {
  clearAllDebugSaves,
  clearSavedGame,
  getSaveBackupStatus,
  hasSavedGame,
  hasValidSavedGame,
  loadGameStateWithMeta,
  normalizeLoadedPlayer,
  SAVE_GAME_VERSION,
  saveGameState,
  type SaveBackupStatus,
} from '../storage/saveGame';

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const STARTING_MONEY = 20_000;
const AUTO_SAVE_MIN_INTERVAL_MS = 15_000;
const ENABLE_SAVE_LOGS = false;
const ECONOMY_TICK_INTERVAL_HOURS = timeBalance.hoursPerDay;
const DAILY_COST_INTERVAL_HOURS = timeBalance.hoursPerDay;
const MARKET_NEWS_MAX_AGE_HOURS = 72;
const MARKET_NEWS_MAX_COUNT = 30;
const EVENT_LOG_MAX_AGE_HOURS = 72;
const EVENT_LOG_MAX_COUNT = 50;
const REPUTATION_GAIN = 2;
const REPUTATION_LOSS = 5;
const HIGH_PAYMENT_CONTRACT_THRESHOLD = 8_000;
const FUEL_PRICE_CHANGE_THRESHOLD = 0.05;
const MIN_TRUCK_CONDITION_FOR_DELIVERY = 30;

// ---------------------------------------------------------------------------
// Otomatik kayıt durumu (modül kapsamı)
// ---------------------------------------------------------------------------

let lastAutoSaveAt = 0;
let lastSavedGameTime = 0;
let saveDirty = false;
let autoSaveEnabled = true;
let isSavingGame = false;
let lastSaveReason: AutoSaveReason | null = null;
let isLoadingSave = false;
let hasHydratedGame = false;
let gameInitPromise: Promise<void> | null = null;

/** Teslimat tamamlama bildirimi tekrarını engeller (transient) */
const completedDeliveryNotificationIds = new Set<string>();
const completedTransferNotificationIds = new Set<string>();

export type NavigationTab = 'dashboard' | 'map' | 'contracts' | 'fleet' | 'market' | 'more';

export interface NavigationRequest {
  tab: NavigationTab;
  moreSubRoute?: 'finance' | 'warehouse' | 'debug';
}

export type FleetSubTab = 'trucks' | 'drivers' | 'shop' | 'hire_drivers';

export type AutoSaveReason =
  | 'critical'
  | 'delivery_completed'
  | 'delivery_failed'
  | 'delivery_started'
  | 'transfer_started'
  | 'transfer_completed'
  | 'purchase'
  | 'level_up'
  | 'repair'
  | 'reset'
  | 'new_game'
  | 'economy_tick'
  | 'contracts_generated'
  | 'warehouse'
  | 'clear_save'
  | 'background'
  | 'manual'
  | 'debug_cash_change'
  | 'time_tick';

const IMMEDIATE_SAVE_REASONS = new Set<AutoSaveReason>([
  'critical',
  'delivery_completed',
  'delivery_failed',
  'delivery_started',
  'transfer_started',
  'transfer_completed',
  'purchase',
  'level_up',
  'repair',
  'reset',
  'new_game',
  'clear_save',
  'background',
  'manual',
]);

function resetAutoSaveTracking(gameTime = 0): void {
  lastAutoSaveAt = Date.now();
  lastSavedGameTime = gameTime;
  saveDirty = false;
}

export interface SaveStatusSnapshot {
  hasSave: boolean;
  hasValidSave: boolean;
  lastSavedAt: number | null;
  autoSaveEnabled: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isLoadingSave: boolean;
  lastSaveReason: AutoSaveReason | null;
  saveVersion: number;
  migratedFromVersion: number | null;
  lastSaveError: string | null;
  backup: SaveBackupStatus;
}

function createSaveStatusSnapshot(hasSave = false, overrides?: Partial<SaveStatusSnapshot>): SaveStatusSnapshot {
  return {
    hasSave,
    hasValidSave: hasSave,
    lastSavedAt: lastAutoSaveAt > 0 ? lastAutoSaveAt : null,
    autoSaveEnabled,
    isDirty: saveDirty,
    isSaving: isSavingGame,
    isLoadingSave,
    lastSaveReason,
    saveVersion: SAVE_GAME_VERSION,
    migratedFromVersion: null,
    lastSaveError: null,
    backup: { invalid: false, migrated: false },
    ...overrides,
  };
}

async function resolveSaveStatusPatch(): Promise<SaveStatusSnapshot> {
  try {
    const [hasValidSave, backup] = await Promise.all([
      hasValidSavedGame(),
      getSaveBackupStatus(),
    ]);
    return createSaveStatusSnapshot(hasValidSave, { hasValidSave, backup });
  } catch {
    return createSaveStatusSnapshot(false);
  }
}

function patchSaveStatus(
  set: (partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>)) => void,
  patch: Partial<SaveStatusSnapshot>,
): void {
  set((state) => ({
    saveStatus: {
      ...state.saveStatus,
      ...patch,
      saveVersion: SAVE_GAME_VERSION,
    },
  }));
}

// ---------------------------------------------------------------------------
// Yardımcı fonksiyonlar
// ---------------------------------------------------------------------------

/** Şehir dizisini simülasyon modülünün beklediği Record yapısına çevirir */
export function citiesToRecord(cities: City[]): Record<string, City> {
  return Object.fromEntries(cities.map((city) => [city.id, city]));
}

/** Record yapısını şehir dizisine geri çevirir */
export function citiesFromRecord(record: Record<string, City>): City[] {
  return Object.values(record);
}

/** Available sözleşmeleri birleştirirken duplicate rota+ürün+miktar tekrarlarını temizler */
function mergeContractsWithDedupe(existing: Contract[], incoming: Contract[]): Contract[] {
  return mergeContractLists(existing, incoming);
}

function shouldLogContractMarketEvent(eventLog: GameEvent[], currentTime: number): boolean {
  const dedupeWindowHours = 6;
  return !eventLog.some(
    (event) =>
      event.type === 'market' &&
      (event.title === 'Yeni taşıma fırsatları' ||
        event.title === 'Yeni sözleşmeler' ||
        event.title === 'Piyasa güncellendi') &&
      currentTime - event.time < dedupeWindowHours,
  );
}

function createEmptyContractGenerationDebug(currentTime = 0): ContractGenerationDebugSnapshot {
  return {
    currentTime,
    availableContracts: 0,
    lastContractGenerationTime: 0,
    lastMarketRefreshTime: 0,
    lastDailyCleanupTime: 0,
    hoursSinceLastGeneration: 0,
    hoursSinceLastMarketRefresh: 0,
    lastGeneratedContractsCount: 0,
    expiredContractsRemoved: 0,
    nextSmallGenerationInHours: contractGenerationBalance.smallGenerationIntervalHours,
    nextMediumGenerationInHours: contractGenerationBalance.mediumGenerationIntervalHours,
    nextDailyCleanupInHours: contractGenerationBalance.dailyCleanupIntervalHours,
    elapsedSmallTicks: 0,
    processedSmallTicks: 0,
    elapsedMediumTicks: 0,
    processedMediumTicks: 0,
    elapsedDailyTicks: 0,
    generatedContractsCount: 0,
    offlineCatchup: false,
  };
}

let lastContractMarketRefreshAt = Date.now();
let leaseTruckInFlight = false;

function buildContractRefreshParams(state: StoreGameState) {
  const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);
  const ownedMaxTruckCapacity = getHighestOwnedTruckCapacity(state.player.trucks);
  const idleMaxTruckCapacity = getMaxIdleTruckCapacity(state.player.trucks);

  return {
    cities: citiesToRecord(state.cities),
    routes: state.routes,
    products: state.products,
    globalEconomy: state.globalEconomy,
    contracts: state.contracts,
    currentTime: state.currentTime,
    playerLevel,
    maxTruckCapacity: ownedMaxTruckCapacity || getMaxContractTonnageForLevel(playerLevel),
    ownedMaxTruckCapacity: ownedMaxTruckCapacity || getMaxContractTonnageForLevel(playerLevel),
    idleMaxTruckCapacity,
    idleTruckOriginCityIds: getIdleTruckOriginCityIds(
      state.player.trucks,
      state.player.homeCityId,
    ),
  };
}

function applyContractReplenishment(
  state: StoreGameState,
  cities: Record<string, City>,
  globalEconomy: GlobalEconomy,
): { contracts: Contract[]; newContracts: Contract[] } {
  const params = buildContractRefreshParams(state);
  return replenishAvailableContracts({
    ...params,
    cities,
    globalEconomy,
    contracts: state.contracts,
  });
}

function appendLevelUpEvents(
  eventLog: GameEvent[],
  currentTime: number,
  newLevels: number[],
): GameEvent[] {
  let log = eventLog;
  for (const level of newLevels) {
    log = prependGameEvent(
      log,
      {
        time: currentTime,
        type: 'system',
        title: 'Şirket seviye atladı',
        message: `Şirket Level ${level} seviyesine ulaştı.`,
        importance: 'high',
      },
      currentTime,
    );
  }
  return log;
}

function commitXpResult(
  get: () => GameStore,
  set: (partial: Partial<GameStore>) => void,
  xpResult: ApplyXpResult,
): void {
  const state = get();
  const eventLog = xpResult.leveledUp
    ? appendLevelUpEvents(state.eventLog, state.currentTime, xpResult.newLevels)
    : state.eventLog;

  set({
    player: xpResult.player,
    eventLog,
  });

  if (xpResult.leveledUp) {
    notifyLevelUps(get, state.currentTime, xpResult.newLevels);
    get().autoSave('level_up');
  }
}

function notifyLevelUps(get: () => GameStore, currentTime: number, newLevels: number[]): void {
  for (const level of newLevels) {
    try {
      get().addNotification({
        time: currentTime,
        type: 'success',
        title: 'Şirket seviye atladı',
        message: `Level ${level} oldun. Yeni fırsatlar açıldı.`,
        autoDismissMs: 3500,
      });
    } catch (error) {
      console.warn('[gameStore] level up notification failed:', error);
    }
  }
}

/** Başlangıç şehir verisini klonlar ve currentPrice alanlarını doldurur */
function cloneInitialCities(): City[] {
  return structuredClone(CITIES).map((city) => ({
    ...city,
    products: Object.fromEntries(
      Object.entries(city.products).map(([productId, productState]) => [
        productId,
        {
          ...productState,
          currentPrice: productState.currentPrice ?? productState.basePrice,
        },
      ]),
    ) as City['products'],
  }));
}

/** Store state → SimulationGameState adaptörü */
export function toSimulationState(state: StoreGameState): SimulationGameState {
  return {
    currentDay: Math.floor(state.currentTime / 24) + 1,
    currentTime: state.currentTime,
    player: {
      companyName: state.player.companyName,
      money: state.player.money,
      companyLevel: state.player.companyLevel,
      homeCityId: state.player.homeCityId,
    },
    trucks: state.player.trucks,
    drivers: state.player.drivers,
    warehouses: state.player.warehouses,
    cities: citiesToRecord(state.cities),
    contracts: state.contracts,
    deliveries: state.activeDeliveries,
  };
}

/** Simülasyon sonucunu store state'e geri yazar (para hariç — store ayrı yönetir) */
function mergeSimulationIntoStore(
  state: StoreGameState,
  simState: SimulationGameState,
  moneyOverride?: number,
): Partial<StoreGameState> {
  return {
    cities: citiesFromRecord(simState.cities),
    contracts: simState.contracts,
    activeDeliveries: simState.deliveries,
    player: {
      ...state.player,
      money: moneyOverride ?? state.player.money,
      trucks: simState.trucks,
      drivers: simState.drivers,
      warehouses: simState.warehouses,
    },
  };
}

function createNewsId(time: number, suffix: string): string {
  return `news_${Math.floor(time)}_${suffix}`;
}

function createEventId(time: number, suffix: string): string {
  return `event_${Math.floor(time)}_${suffix}`;
}

function formatNotificationMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function createNotificationId(suffix: string): string {
  return `notif_${Date.now()}_${suffix}`;
}

function resetTransientGameUiState(): void {
  completedDeliveryNotificationIds.clear();
  completedTransferNotificationIds.clear();
}

function createFreshGameStorePatch(): Partial<GameStore> {
  const freshState = createInitialGameState();
  return {
    ...freshState,
    notifications: [],
    navigationRequest: null,
    pendingMoreSubRoute: null,
    pendingFleetSubTab: null,
    marketContractFilter: null,
    highlightedContractId: null,
    contractGenerationDebug: createEmptyContractGenerationDebug(0),
    deliverySettlementDebug: createEmptyDeliverySettlementDebug(),
    dailyOperatingCostDebug: buildDailyOperatingCostDebugSnapshot(
      {
        ...freshState,
        lastDailyOperatingCostTime: 0,
      },
      null,
    ),
    isGameReady: true,
    saveError: null,
  };
}

function formatFailureReason(reason: DeliveryFailureReason): string {
  switch (reason) {
    case 'breakdown':
      return 'arıza';
    case 'accident':
      return 'kaza';
    case 'too_late':
      return 'gecikme';
    case 'cancelled':
      return 'iptal';
    case 'capacity_exceeded':
      return 'kapasite aşımı';
    default:
      return reason;
  }
}

function prependGameEvent(
  events: GameEvent[],
  event: Omit<GameEvent, 'id'> & { id?: string },
  currentTime: number,
): GameEvent[] {
  const entry: GameEvent = {
    ...event,
    id: event.id ?? createEventId(currentTime, `${Date.now()}`),
  };
  return [entry, ...events].slice(0, EVENT_LOG_MAX_COUNT);
}

const FINANCE_LEDGER_MAX_COUNT = 200;

function patchFinanceLedger(
  state: Pick<StoreGameState, 'financeLedger' | 'financeTotals'>,
  entries:
    | Array<Omit<FinanceLedgerEntry, 'id'> & { id?: string }>
    | (Omit<FinanceLedgerEntry, 'id'> & { id?: string }),
): Pick<StoreGameState, 'financeLedger' | 'financeTotals'> {
  const list = Array.isArray(entries) ? entries : [entries];
  return addFinanceLedgerEntries(state.financeLedger, state.financeTotals, list, FINANCE_LEDGER_MAX_COUNT);
}

function buildDeliveryCompletionLedgerEntries(
  settlement: DeliverySettlementResult,
  routeLabel: string,
  currentTime: number,
  deliveryId: string,
): Array<Omit<FinanceLedgerEntry, 'id'>> {
  const entries: Array<Omit<FinanceLedgerEntry, 'id'>> = [];

  if (settlement.grossRevenue > 0) {
    entries.push({
      time: currentTime,
      type: 'income',
      category: 'contract_income',
      amount: settlement.grossRevenue,
      description: `Sözleşme ödemesi · ${routeLabel}`,
      relatedDeliveryId: deliveryId,
    });
  }

  if (settlement.maintenanceCost > 0) {
    entries.push({
      time: currentTime,
      type: 'expense',
      category: 'maintenance',
      amount: settlement.maintenanceCost,
      description: `Bakım gideri · ${routeLabel}`,
      relatedDeliveryId: deliveryId,
    });
  }

  if (settlement.penaltyCost > 0) {
    entries.push({
      time: currentTime,
      type: 'expense',
      category: 'penalty',
      amount: settlement.penaltyCost,
      description: `Gecikme cezası · ${routeLabel}`,
      relatedDeliveryId: deliveryId,
    });
  }

  return entries;
}

function createEmptyDeliverySettlementDebug(): DeliverySettlementDebugSnapshot {
  return {
    phase: 'start',
    cashBefore: 0,
    cashAfter: 0,
    fuelCost: 0,
    contractPayment: 0,
    maintenanceCost: 0,
    penaltyCost: 0,
    reportedNetProfit: 0,
    cashDeltaOnCompletion: 0,
  };
}

export interface DailyOperatingCostDebugSnapshot {
  lastDailyOperatingCostTime: number;
  currentTime: number;
  hoursUntilNextDailyCost: number;
  dailyOperatingCost: number;
  maxOfflineChargeDays: number;
  elapsedOperatingDays: number | null;
  chargedOperatingDays: number | null;
  skippedOperatingDaysDueToCap: number;
  lastCharge: {
    days: number;
    elapsedDays: number;
    skippedDays: number;
    total: number;
    at: number;
    reason: DailyOperatingCostReason;
  } | null;
}

export interface ProcessDailyOperatingCostsOptions {
  days?: number;
  elapsedDays?: number;
  reason?: DailyOperatingCostReason;
  currentTime?: number;
  lastDailyOperatingCostTime?: number;
}

function buildDailyOperatingCostDebugSnapshot(
  state: Pick<StoreGameState, 'currentTime' | 'lastDailyOperatingCostTime' | 'player'>,
  lastCharge: DailyOperatingCostDebugSnapshot['lastCharge'] = null,
): DailyOperatingCostDebugSnapshot {
  const currentTime = state.currentTime ?? 0;
  const lastDaily = state.lastDailyOperatingCostTime ?? 0;
  const breakdown = calculateDailyOperatingCostBreakdown(state.player);
  const nextDue = lastDaily + DAILY_COST_INTERVAL_HOURS;

  return {
    lastDailyOperatingCostTime: lastDaily,
    currentTime,
    hoursUntilNextDailyCost: Math.max(0, nextDue - currentTime),
    dailyOperatingCost: breakdown.total,
    maxOfflineChargeDays: operatingCostBalance.maxOfflineChargeDays ?? 3,
    elapsedOperatingDays: lastCharge?.elapsedDays ?? null,
    chargedOperatingDays: lastCharge?.days ?? null,
    skippedOperatingDaysDueToCap: lastCharge?.skippedDays ?? 0,
    lastCharge,
  };
}

function normalizePlayerWarehouses(warehouses: Warehouse[]): Warehouse[] {
  return (warehouses ?? []).map((warehouse) => normalizeWarehouse(warehouse));
}

function updateCityProductStock(
  cities: City[],
  cityId: string,
  productId: ProductId,
  deltaStock: number,
): City[] {
  return cities.map((city) => {
    if (city.id !== cityId) {
      return city;
    }

    const productState = city.products[productId];
    if (!productState) {
      return city;
    }

    return {
      ...city,
      products: {
        ...city.products,
        [productId]: {
          ...productState,
          stock: Math.max(0, productState.stock + deltaStock),
        },
      },
    };
  });
}

function prependGameEvents(
  events: GameEvent[],
  incoming: Array<Omit<GameEvent, 'id'> & { id?: string }>,
  currentTime: number,
): GameEvent[] {
  if (incoming.length === 0) {
    return events;
  }

  const newEntries = incoming.map((event, index) => ({
    ...event,
    id: event.id ?? createEventId(currentTime, `${Date.now()}_${index}`),
  }));

  return [...newEntries, ...events].slice(0, EVENT_LOG_MAX_COUNT);
}

/** Son N oyun olayını döndürür (en yeni önce) */
export function getRecentGameEvents(eventLog: GameEvent[], limit = 3): GameEvent[] {
  return eventLog.slice(0, limit);
}

/** Başlangıç globalEconomy değeri */
export function createInitialGlobalEconomy(): GlobalEconomy {
  return createDefaultGlobalEconomy();
}

/** GDD Bölüm 6'ya göre başlangıç oyun durumu */
export function createInitialGameState(): StoreGameState {
  const globalEconomy = createInitialGlobalEconomy();
  const cities = cloneInitialCities();
  const initialContractCount = randomIntBetween(
    contractGenerationBalance.initialContractsMin,
    contractGenerationBalance.initialContractsMax,
  );
  const rawContracts = generateContracts(
    citiesToRecord(cities),
    ROUTES,
    PRODUCTS,
    globalEconomy,
    [],
    {
      currentTime: 0,
      maxNewContracts: initialContractCount,
      playerLevel: 1,
      ownedMaxTruckCapacity: STARTER_TRUCK.capacity ?? 25,
      idleMaxTruckCapacity: STARTER_TRUCK.capacity ?? 25,
      idleTruckOriginCityIds: ['izmir'],
    },
  );
  const balancedContracts = balanceAvailableContractLevelMix(rawContracts, 1);
  const starterPlayer = {
    level: 1,
    companyLevel: 1,
    homeCityId: 'izmir' as const,
    trucks: [structuredClone(STARTER_TRUCK)],
    drivers: [structuredClone(STARTER_DRIVER)],
  };
  const contracts = ensureStarterContracts({
    contracts: balancedContracts,
    cities: citiesToRecord(cities),
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy,
    player: starterPlayer,
    currentTime: 0,
    minCount: 2,
  });

  return {
    currentTime: 0,
    isPaused: false,
    gameSpeed: 1,
    lastEconomyTickTime: 0,
    lastDailyOperatingCostTime: 0,
    lastContractGenerationTime: 0,
    lastMarketRefreshTime: 0,
    lastDailyCleanupTime: 0,
    player: {
      companyName: 'LogistiCore Lojistik',
      money: STARTING_MONEY,
      companyLevel: 1,
      level: 1,
      xp: 0,
      xpToNextLevel: calculateXpToNextLevel(1),
      totalXp: 0,
      homeCityId: 'izmir',
      reputation: 50,
      completedContracts: 0,
      failedDeliveries: 0,
      lateDeliveries: 0,
      diamonds: 0,
      trucks: [structuredClone(STARTER_TRUCK)],
      drivers: [structuredClone(STARTER_DRIVER)],
      warehouses: [
        {
          id: 'warehouse-starter-1',
          cityId: 'izmir',
          capacityTons: 100,
          capacityTon: 100,
          dailyOperatingCost: operatingCostBalance.fallbackWarehouseDailyCost,
          upgradeTier: 1,
          warehouseType: 'standard',
          qualityProtection: 0.5,
          inventory: [],
          usedCapacityTon: 0,
        },
      ],
    },
    cities,
    products: structuredClone(PRODUCTS),
    routes: structuredClone(ROUTES),
    contracts,
    activeDeliveries: [],
    activeTransfers: [],
    completedTransfers: [],
    globalEconomy,
    marketNews: [
      {
        id: createNewsId(0, 'welcome'),
        time: 0,
        type: 'economy',
        title: 'Hoş geldiniz!',
        message: 'İzmir merkezli lojistik şirketiniz faaliyete başladı. İlk sözleşmeleri inceleyin.',
        importance: 'medium',
      },
    ],
    eventLog: [
      {
        id: createEventId(0, 'welcome'),
        time: 0,
        type: 'system',
        title: 'Oyun başladı',
        message: 'LogistiCore lojistik şirketiniz faaliyete geçti.',
        importance: 'medium',
      },
    ],
    financeLedger: [],
    financeTotals: createEmptyFinanceTotals(),
    tutorial: createDefaultTutorialState(),
    missions: createDefaultMissionsState(),
    spotlightTutorial: createDefaultSpotlightTutorialState(),
  };
}

// ---------------------------------------------------------------------------
// Store tipi
// ---------------------------------------------------------------------------

export interface GameStore extends StoreGameState {
  /** Geçici UI bildirimleri — save'e yazılmaz */
  notifications: GameNotification[];
  navigationRequest: NavigationRequest | null;
  pendingMoreSubRoute: 'finance' | 'warehouse' | 'debug' | null;
  pendingFleetSubTab: FleetSubTab | null;
  marketContractFilter: MarketContractFilter | null;
  highlightedContractId: string | null;
  /** Sözleşme üretim zamanlaması — save'e yazılmaz, debug için */
  contractGenerationDebug: ContractGenerationDebugSnapshot;
  /** Son teslimat para mutabakatı — save'e yazılmaz, debug için */
  deliverySettlementDebug: DeliverySettlementDebugSnapshot;
  /** Günlük işletme gideri zamanlaması — save'e yazılmaz */
  dailyOperatingCostDebug: DailyOperatingCostDebugSnapshot;
  addNotification: (notification: Omit<GameNotification, 'id'> & { id?: string }) => void;
  dismissNotification: (notificationId: string) => void;
  clearNotifications: () => void;
  requestNavigationFromNotification: (target: GameNotificationActionTarget) => void;
  clearNavigationRequest: () => void;
  clearPendingMoreSubRoute: () => void;
  requestNavigationToFleet: (subTab?: FleetSubTab) => void;
  clearPendingFleetSubTab: () => void;
  setMarketContractFilter: (filter: MarketContractFilter | null) => void;
  clearMarketContractFilter: () => void;
  setHighlightedContractId: (contractId: string | null) => void;
  openContractsForMarketOpportunity: (opportunity: MarketOpportunity) => void;
  openContractsForMapContract: (contract: Contract) => void;
  /** Kayıt varsa yükler, yoksa yeni oyun başlatır */
  initializeGame: () => Promise<void>;
  resetGame: () => void;
  saveGame: () => Promise<void>;
  loadGame: (preloaded?: Awaited<ReturnType<typeof loadGameStateWithMeta>>) => Promise<boolean>;
  clearSave: () => Promise<void>;
  /** Debug/test — AsyncStorage kaydını siler ve tamamen yeni oyun başlatır */
  resetGameForTesting: () => Promise<void>;
  getDebugSaveInfo: () => {
    hasHydrated: boolean;
    hasSavedGame: boolean;
    gameDay: number;
    currentTime: number;
    tutorialStepId: TutorialStepId;
    tutorialCompletedStepIds: string[];
    spotlightCompletedIds: string[];
    spotlightSkippedIds: string[];
    missionsCompletedIds: string[];
    missionsClaimedRewardIds: string[];
  };
  autoSave: (reason?: AutoSaveReason) => void;
  markSaveDirty: () => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  saveStatus: SaveStatusSnapshot;
  getSaveStatus: () => SaveStatusSnapshot;
  refreshSaveStatus: () => Promise<void>;
  /** App açılışında initializeGame tamamlandığında true olur */
  isGameReady: boolean;
  /** Kayıt yüklenemediğinde kullanıcıya/debug'a gösterilecek hata */
  saveError: string | null;
  pauseGame: () => void;
  resumeGame: () => void;
  setGameSpeed: (speed: number) => void;
  advanceTime: (hours: number) => void;
  replenishContractsIfNeeded: () => void;
  runEconomyTick: () => void;
  getContractGenerationDebug: () => ContractGenerationDebugSnapshot;
  getDeliverySettlementDebug: () => DeliverySettlementDebugSnapshot;
  /** Oyuncu ekranları: süresi dolmuş teklifleri temizler, yeni sözleşme üretmez */
  refreshMarketSnapshot: () => void;
  refreshContractsFromMarket: () => void;
  getContractRefreshRemainingSeconds: () => number;
  /** Debug: manuel sözleşme üretimi */
  generateNewContracts: () => void;
  expireContracts: () => void;
  startDelivery: (contractId: string, truckId: string, driverId: string) => StartDeliveryResult;
  startDeliveryAutoAssign: (contractId: string) => StartDeliveryResult;
  updateDeliveries: (hoursPassed: number) => void;
  updateTransfers: (hoursPassed: number) => void;
  startTruckTransfer: (params: { truckId: string; toCityId: string; driverId?: string }) => StartTruckTransferResult;
  completeTruckTransferById: (transferId: string) => void;
  completeDeliveryById: (deliveryId: string) => void;
  failDeliveryById: (deliveryId: string, reason: DeliveryFailureReason) => void;
  buyTruck: (catalogId: string) => TradeActionResult;
  leaseTruck: (catalogId: string) => TradeActionResult;
  hireDriver: (poolId: string) => TradeActionResult;
  processDailyOperatingCosts: (options?: ProcessDailyOperatingCostsOptions) => void;
  processExpiredLeases: () => void;
  repairTruck: (truckId: string) => void;
  refuelOrUpdateFuelPrice: () => void;
  addMarketNews: (news: Omit<MarketNews, 'id'> & { id?: string }) => void;
  clearOldMarketNews: () => void;
  addGameEvent: (event: Omit<GameEvent, 'id'> & { id?: string }) => void;
  clearOldGameEvents: () => void;
  openWarehouse: (cityId: string, warehouseType?: WarehouseType) => TradeActionResult;
  upgradeWarehouse: (warehouseId: string) => TradeActionResult;
  buyProductForWarehouse: (params: {
    cityId: string;
    productId: ProductId;
    quantity: number;
    warehouseId: string;
  }) => TradeActionResult;
  sellProductFromWarehouse: (params: {
    warehouseId: string;
    productId: ProductId;
    quantity: number;
  }) => TradeActionResult;
  completeTutorialStep: (stepId: TutorialStepId) => void;
  setCurrentTutorialStep: (stepId: TutorialStepId) => void;
  dismissTutorialStep: (stepId: TutorialStepId) => void;
  resetTutorial: () => void;
  markSpotlightTutorialCompleted: (tutorialId: SpotlightTutorialId) => void;
  markSpotlightTutorialSkipped: (tutorialId: SpotlightTutorialId) => void;
  clearSpotlightTutorialProgress: (tutorialId: SpotlightTutorialId) => void;
  resetSpotlightTutorials: () => void;
  ensureStarterContractsForTutorial: () => void;
  notifyContractsScreenOpened: () => void;
  notifyContractAssignmentOpened: () => void;
  notifyTutorialDeliveryStarted: () => void;
  notifyActiveDeliverySeen: () => void;
  notifyFirstDeliveryCompleted: () => void;
  notifyMarketScreenOpened: () => void;
  syncMissionProgress: () => void;
  getMissionProgressValue: (missionId: string) => MissionProgressResult;
  claimMissionReward: (missionId: string) => { success: boolean; message?: string };
  addCompanyXp: (amount: number, reason?: string) => void;
  checkLevelUp: () => void;
  getLevelBenefits: (level?: number) => LevelBenefits;
  /** Debug/test — production'da gizlenmeli */
  debugAddCash: (amount: number) => void;
  debugRemoveCash: (amount: number) => void;
  debugSetCash: (amount: number) => void;
  debugAdvanceOneDay: () => void;
  debugAdvanceOfflineDays: (days?: number) => void;
  debugProcessDailyCosts: () => void;
  debugExpireLeaseTruck: () => void;
  debugGetEconomyBalanceSummary: () => string;
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

export const useGameStore = create<GameStore>((set, get) => ({
  ...createInitialGameState(),
  notifications: [],
  navigationRequest: null,
  pendingMoreSubRoute: null,
  pendingFleetSubTab: null,
  marketContractFilter: null,
  highlightedContractId: null,
  contractGenerationDebug: createEmptyContractGenerationDebug(),
  deliverySettlementDebug: createEmptyDeliverySettlementDebug(),
  dailyOperatingCostDebug: {
    lastDailyOperatingCostTime: 0,
    currentTime: 0,
    hoursUntilNextDailyCost: DAILY_COST_INTERVAL_HOURS,
    dailyOperatingCost: 0,
    maxOfflineChargeDays: operatingCostBalance.maxOfflineChargeDays ?? 3,
    elapsedOperatingDays: null,
    chargedOperatingDays: null,
    skippedOperatingDaysDueToCap: 0,
    lastCharge: null,
  },
  saveStatus: createSaveStatusSnapshot(false),
  isGameReady: false,
  saveError: null,

  addNotification: (notification) => {
    const entry: GameNotification = {
      ...notification,
      id: notification.id ?? createNotificationId(`${Math.random().toString(36).slice(2, 8)}`),
      autoDismissMs: resolveNotificationDismissMs(notification.type, notification.autoDismissMs),
    };
    set({ notifications: [entry, ...get().notifications].slice(0, 8) });
  },

  dismissNotification: (notificationId) => {
    set({
      notifications: get().notifications.filter((notification) => notification.id !== notificationId),
    });
  },

  clearNotifications: () => {
    set({ notifications: [] });
  },

  requestNavigationFromNotification: (target) => {
    switch (target) {
      case 'dashboard':
        set({ navigationRequest: { tab: 'dashboard' } });
        break;
      case 'contracts':
        set({ navigationRequest: { tab: 'contracts' } });
        break;
      case 'fleet':
        set({ navigationRequest: { tab: 'fleet' } });
        break;
      case 'map':
        set({ navigationRequest: { tab: 'map' } });
        break;
      case 'finance':
        set({ navigationRequest: { tab: 'more' }, pendingMoreSubRoute: 'finance' });
        break;
      default:
        break;
    }
  },

  clearNavigationRequest: () => {
    set({ navigationRequest: null });
  },

  clearPendingMoreSubRoute: () => {
    set({ pendingMoreSubRoute: null });
  },

  requestNavigationToFleet: (subTab = 'shop') => {
    set({ navigationRequest: { tab: 'fleet' }, pendingFleetSubTab: subTab });
  },

  clearPendingFleetSubTab: () => {
    set({ pendingFleetSubTab: null });
  },

  setMarketContractFilter: (filter) => {
    set({ marketContractFilter: filter });
  },

  clearMarketContractFilter: () => {
    set({ marketContractFilter: null, highlightedContractId: null });
  },

  setHighlightedContractId: (contractId) => {
    set({ highlightedContractId: contractId });
  },

  openContractsForMarketOpportunity: (opportunity) => {
    const fromCityId = opportunity.fromCityId;
    const toCityId = opportunity.toCityId;
    const productId = opportunity.productId;

    if (!fromCityId || !toCityId || !productId) {
      console.warn('[gameStore] Market opportunity missing route ids', opportunity.id);
      return;
    }

    const filter: MarketContractFilter = {
      fromCityId,
      toCityId,
      productId,
      fromCityName: opportunity.fromCityName || getCityName(fromCityId),
      toCityName: opportunity.toCityName || getCityName(toCityId),
      productName: opportunity.productName || getProductName(productId),
      opportunityId: opportunity.id,
      source: 'market',
      createdAt: Date.now(),
    };

    set({
      marketContractFilter: filter,
      navigationRequest: { tab: 'contracts' },
    });

    get().replenishContractsIfNeeded();
  },

  openContractsForMapContract: (contract: Contract) => {
    const { originCityId, destinationCityId, productId } = contract;
    if (!originCityId || !destinationCityId || !productId) {
      console.warn('[gameStore] Map contract missing route ids', contract.id);
      return;
    }

    const filter: MarketContractFilter = {
      fromCityId: originCityId,
      toCityId: destinationCityId,
      productId,
      fromCityName: getCityName(originCityId),
      toCityName: getCityName(destinationCityId),
      productName: getProductName(productId),
      contractId: contract.id,
      source: 'map',
      createdAt: Date.now(),
    };

    set({
      marketContractFilter: filter,
      highlightedContractId: contract.id,
      navigationRequest: { tab: 'contracts' },
    });

    get().replenishContractsIfNeeded();
  },

  completeTutorialStep: (stepId) => {
    const state = get();
    set({
      tutorial: completeTutorialStepState(state.tutorial ?? createDefaultTutorialState(), stepId),
    });
    get().markSaveDirty();
  },

  setCurrentTutorialStep: (stepId) => {
    const state = get();
    set({
      tutorial: setCurrentTutorialStepState(state.tutorial ?? createDefaultTutorialState(), stepId),
    });
    get().markSaveDirty();
  },

  dismissTutorialStep: (stepId) => {
    const state = get();
    set({
      tutorial: dismissTutorialStepState(state.tutorial ?? createDefaultTutorialState(), stepId),
    });
    get().markSaveDirty();
  },

  resetTutorial: () => {
    set({ tutorial: createDefaultTutorialState() });
    get().markSaveDirty();
  },

  markSpotlightTutorialCompleted: (tutorialId) => {
    const state = get();
    set({
      spotlightTutorial: markSpotlightTutorialCompletedState(
        state.spotlightTutorial ?? createDefaultSpotlightTutorialState(),
        tutorialId,
      ),
    });
    get().markSaveDirty();
    get().autoSave('manual');
  },

  markSpotlightTutorialSkipped: (tutorialId) => {
    const state = get();
    set({
      spotlightTutorial: markSpotlightTutorialSkippedState(
        state.spotlightTutorial ?? createDefaultSpotlightTutorialState(),
        tutorialId,
      ),
    });
    get().markSaveDirty();
    get().autoSave('manual');
  },

  clearSpotlightTutorialProgress: (tutorialId) => {
    const state = get();
    set({
      spotlightTutorial: clearSpotlightTutorialProgressState(
        state.spotlightTutorial ?? createDefaultSpotlightTutorialState(),
        tutorialId,
      ),
    });
    get().markSaveDirty();
  },

  resetSpotlightTutorials: () => {
    set({ spotlightTutorial: createDefaultSpotlightTutorialState() });
    get().markSaveDirty();
  },

  ensureStarterContractsForTutorial: () => {
    const state = get();
    if (!state.player) {
      return;
    }

    const nextContracts = ensureStarterContracts({
      contracts: state.contracts ?? [],
      cities: citiesToRecord(state.cities),
      routes: state.routes ?? ROUTES,
      products: state.products ?? PRODUCTS,
      globalEconomy: state.globalEconomy,
      player: state.player,
      currentTime: state.currentTime,
      minCount: 1,
    });

    if (nextContracts.length === state.contracts.length) {
      let changed = false;
      for (let index = 0; index < nextContracts.length; index += 1) {
        if (nextContracts[index]?.id !== state.contracts[index]?.id) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        return;
      }
    }

    set({ contracts: nextContracts });
    get().markSaveDirty();
  },

  notifyContractsScreenOpened: () => {
    const state = get();
    const tutorial = state.tutorial ?? createDefaultTutorialState();
    set({ tutorial: tutorialOnContractsOpened(tutorial) });
    get().markSaveDirty();
  },

  notifyContractAssignmentOpened: () => {
    const state = get();
    const tutorial = state.tutorial ?? createDefaultTutorialState();
    set({ tutorial: tutorialOnContractAssignmentOpened(tutorial) });
    get().markSaveDirty();
  },

  notifyTutorialDeliveryStarted: () => {
    const state = get();
    const tutorial = state.tutorial ?? createDefaultTutorialState();
    const missions = state.missions ?? createDefaultMissionsState();
    const nextMissions = syncMissionsState(
      {
        ...missions,
        flags: { ...missions.flags, deliveryStarted: true },
      },
      state,
    );
    set({
      tutorial: tutorialOnDeliveryStarted(tutorial),
      missions: nextMissions,
    });
    get().markSaveDirty();
  },

  notifyActiveDeliverySeen: () => {
    const state = get();
    if ((state.activeDeliveries?.length ?? 0) === 0) {
      return;
    }
    const tutorial = state.tutorial ?? createDefaultTutorialState();
    set({ tutorial: tutorialOnActiveDeliverySeen(tutorial) });
    get().markSaveDirty();
  },

  notifyFirstDeliveryCompleted: () => {
    const state = get();
    const tutorial = state.tutorial ?? createDefaultTutorialState();
    const missions = syncMissionsState(state.missions ?? createDefaultMissionsState(), state);
    set({
      tutorial: tutorialOnFirstDeliveryCompleted(tutorial),
      missions,
    });
    get().markSaveDirty();
  },

  notifyMarketScreenOpened: () => {
    const state = get();
    const missions = state.missions ?? createDefaultMissionsState();
    const nextMissions = syncMissionsState(
      {
        ...missions,
        flags: { ...missions.flags, marketOpened: true },
        activeMissionIds: missions.activeMissionIds.includes('open_market')
          ? missions.activeMissionIds
          : [...missions.activeMissionIds, 'open_market'],
      },
      state,
    );
    const tutorial = state.tutorial ?? createDefaultTutorialState();
    set({
      tutorial: tutorialOnMarketOpened(tutorial),
      missions: nextMissions,
    });
    get().markSaveDirty();
  },

  syncMissionProgress: () => {
    const state = get();
    const missions = syncMissionsState(state.missions ?? createDefaultMissionsState(), state);
    set({ missions });
    get().markSaveDirty();
  },

  getMissionProgressValue: (missionId) => {
    const state = get();
    return getMissionProgress(missionId, state);
  },

  claimMissionReward: (missionId) => {
    const state = get();
    const missions = syncMissionsState(state.missions ?? createDefaultMissionsState(), state);

    if (missions.claimedMissionRewardIds.includes(missionId)) {
      return { success: false, message: 'Ödül zaten alındı.' };
    }

    const progress = getMissionProgress(missionId, { ...state, missions });
    if (!progress.isComplete) {
      return { success: false, message: 'Görev henüz tamamlanmadı.' };
    }

    const mission = getMissionById(missionId);
    if (!mission) {
      return { success: false, message: 'Görev bulunamadı.' };
    }

    const moneyReward = mission.reward.money ?? 0;
    const xpReward = mission.reward.xp ?? 0;
    const diamondReward = mission.reward.diamonds ?? 0;
    const reputationReward = mission.reward.reputation ?? 0;

    const ledgerPatch =
      moneyReward > 0
        ? patchFinanceLedger(state, {
            time: state.currentTime,
            type: 'income',
            category: 'bonus',
            amount: moneyReward,
            title: 'Görev Ödülü',
            description: mission.title,
          })
        : null;

    const claimedMissionRewardIds = [...missions.claimedMissionRewardIds, missionId];
    const completedMissionIds = missions.completedMissionIds.includes(missionId)
      ? missions.completedMissionIds
      : [...missions.completedMissionIds, missionId];

    set({
      player: {
        ...state.player,
        money: (state.player.money ?? 0) + moneyReward,
        diamonds: (state.player.diamonds ?? 0) + diamondReward,
        reputation: Math.min(100, (state.player.reputation ?? 0) + reputationReward),
      },
      missions: {
        ...missions,
        claimedMissionRewardIds,
        completedMissionIds,
      },
      financeLedger: ledgerPatch?.financeLedger ?? state.financeLedger ?? [],
      financeTotals: ledgerPatch?.financeTotals ?? state.financeTotals,
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'system',
          title: 'Görev tamamlandı',
          message: `${mission.title} ödülü alındı.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    if (xpReward > 0) {
      get().addCompanyXp(xpReward, 'mission_reward');
    }

    try {
      get().addNotification({
        time: state.currentTime,
        type: 'success',
        title: 'Görev tamamlandı',
        message: `${mission.title} ödülü alındı.`,
        autoDismissMs: 3500,
      });
    } catch (error) {
      console.warn('[gameStore] mission reward notification failed:', error);
    }

    get().markSaveDirty();
    return { success: true };
  },

  addCompanyXp: (amount: number, _reason?: string) => {
    if (amount <= 0) {
      return;
    }

    const state = get();
    const xpResult = applyXpToPlayer(normalizePlayerProgress(state.player), amount);
    commitXpResult(get, set, xpResult);
  },

  checkLevelUp: () => {
    const state = get();
    const normalized = normalizePlayerProgress(state.player);

    if (normalized.level >= levelConfig.maxLevel) {
      return;
    }
    if (normalized.xp < normalized.xpToNextLevel) {
      return;
    }

    const xpResult = applyXpToPlayer(normalized, 0);
    if (!xpResult.leveledUp) {
      return;
    }

    commitXpResult(get, set, xpResult);
  },

  getLevelBenefits: (level?: number) => {
    const playerLevel = level ?? get().player.level ?? get().player.companyLevel ?? 1;
    return resolveLevelBenefits(playerLevel);
  },

  initializeGame: () => {
    if (gameInitPromise) {
      return gameInitPromise;
    }

    // Internal test: StartScreen yok — kayıt varsa yükle, yoksa yeni oyun.
    gameInitPromise = (async () => {
      try {
        isLoadingSave = true;
        patchSaveStatus(set, { isLoadingSave: true, lastSaveError: null });
        set({ saveError: null });

        const hadSaveOnDisk = await hasSavedGame();
        if (hadSaveOnDisk) {
          const loadResult = await loadGameStateWithMeta();
          if (loadResult.state) {
            const loaded = await get().loadGame(loadResult);
            if (loaded) {
              hasHydratedGame = true;
              await get().refreshSaveStatus();
              return;
            }
          }

          const loadError =
            loadResult.error ??
            'Kayıt dosyası bulundu ancak yüklenemedi. Yeni oyun başlatılıyor.';
          console.warn('[gameStore] Save existed but could not be loaded:', loadError);
          set({
            saveError: loadError,
            saveStatus: createSaveStatusSnapshot(false, {
              lastSaveError: loadError,
              backup: loadResult.backup,
            }),
          });
        }

        set({ ...createInitialGameState(), isGameReady: false, saveError: get().saveError, saveStatus: get().saveStatus });
        resetTransientGameUiState();
        set({
          notifications: [],
          navigationRequest: null,
          pendingMoreSubRoute: null,
          pendingFleetSubTab: null,
          marketContractFilter: null,
          highlightedContractId: null,
        });
        resetAutoSaveTracking(0);
        hasHydratedGame = true;
        await get().saveGame();
        await get().refreshSaveStatus();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Oyun başlatılırken beklenmeyen hata oluştu.';
        console.warn('[gameStore] initializeGame failed:', error);
        set({
          ...createInitialGameState(),
          isGameReady: false,
          saveError: message,
          saveStatus: createSaveStatusSnapshot(false, { lastSaveError: message }),
        });
        resetTransientGameUiState();
        set({
          notifications: [],
          navigationRequest: null,
          pendingMoreSubRoute: null,
          pendingFleetSubTab: null,
          marketContractFilter: null,
          highlightedContractId: null,
        });
        resetAutoSaveTracking(0);
        hasHydratedGame = true;
      } finally {
        isLoadingSave = false;
        set({ isGameReady: true });
        patchSaveStatus(set, { isLoadingSave: false });
        get().refreshContractsFromMarket();
      }
    })();

    return gameInitPromise;
  },

  resetGame: () => {
    resetTransientGameUiState();
    set({
      ...createInitialGameState(),
      notifications: [],
      navigationRequest: null,
      pendingMoreSubRoute: null,
      pendingFleetSubTab: null,
      marketContractFilter: null,
      highlightedContractId: null,
    });
    resetAutoSaveTracking(0);
    get().autoSave('reset');
  },

  saveGame: async () => {
    const state = get();
    try {
      await saveGameState(state);
      lastSavedGameTime = state.currentTime;
      lastAutoSaveAt = Date.now();
      saveDirty = false;
      patchSaveStatus(set, {
        hasSave: true,
        lastSavedAt: lastAutoSaveAt,
        isDirty: false,
        isSaving: false,
        lastSaveReason,
        autoSaveEnabled,
      });
      if (__DEV__ && ENABLE_SAVE_LOGS) {
        console.log('[gameStore] Game saved at game time', state.currentTime);
      }
    } catch (error) {
      console.warn('[gameStore] saveGame failed:', error);
    }
  },

  loadGame: async (preloaded?: Awaited<ReturnType<typeof loadGameStateWithMeta>>) => {
    try {
      isLoadingSave = true;
      patchSaveStatus(set, { isLoadingSave: true });

      const loadResult = preloaded ?? (await loadGameStateWithMeta());
      const saved = loadResult.state;
      if (!saved) {
        const errorMessage = loadResult.error ?? 'Kayıt yüklenemedi.';
        set({
          saveError: errorMessage,
          saveStatus: createSaveStatusSnapshot(false, {
            lastSaveError: errorMessage,
            backup: loadResult.backup,
          }),
        });
        console.warn('[gameStore] loadGame: no valid save state.', errorMessage);
        return false;
      }

      set({
        ...saved,
        player: normalizeLoadedPlayer(saved.player),
        contractGenerationDebug: createEmptyContractGenerationDebug(saved.currentTime ?? 0),
        deliverySettlementDebug: createEmptyDeliverySettlementDebug(),
        saveError: null,
        saveStatus: createSaveStatusSnapshot(true, {
          hasValidSave: loadResult.hasValidSave,
          migratedFromVersion: loadResult.migratedFromVersion,
          backup: loadResult.backup,
        }),
      });
      resetTransientGameUiState();
      set({
        notifications: [],
        navigationRequest: null,
        pendingMoreSubRoute: null,
        pendingFleetSubTab: null,
        marketContractFilter: null,
        highlightedContractId: null,
      });
      resetAutoSaveTracking(saved.currentTime);
      hasHydratedGame = true;
      set({
        dailyOperatingCostDebug: buildDailyOperatingCostDebugSnapshot(
          {
            ...saved,
            currentTime: saved.currentTime ?? 0,
            lastDailyOperatingCostTime: saved.lastDailyOperatingCostTime ?? 0,
          },
          null,
        ),
      });
      patchSaveStatus(set, {
        hasSave: true,
        hasValidSave: loadResult.hasValidSave,
        lastSavedAt: lastAutoSaveAt,
        isDirty: false,
        migratedFromVersion: loadResult.migratedFromVersion,
        lastSaveError: null,
        backup: loadResult.backup,
      });
      if (__DEV__) {
        console.log('[gameStore] Game loaded from save', {
          migratedFromVersion: loadResult.migratedFromVersion,
        });
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kayıt yüklenemedi.';
      console.warn('[gameStore] loadGame failed:', error);
      set({
        saveError: message,
        saveStatus: createSaveStatusSnapshot(false, { lastSaveError: message }),
      });
      return false;
    } finally {
      isLoadingSave = false;
      patchSaveStatus(set, { isLoadingSave: false });
    }
  },

  clearSave: async () => {
    try {
      await clearSavedGame();
    } catch (error) {
      console.warn('[gameStore] clearSave failed:', error);
    }

    set({ ...createInitialGameState(), saveError: null, saveStatus: get().saveStatus });
    resetAutoSaveTracking(0);
    await get().saveGame();
    await get().refreshSaveStatus();
  },

  resetGameForTesting: async () => {
    isLoadingSave = true;
    isSavingGame = true;
    patchSaveStatus(set, { isLoadingSave: true, isSaving: true });

    try {
      await clearAllDebugSaves({ includeBackups: true });
      resetTransientGameUiState();

      set(createFreshGameStorePatch());

      resetAutoSaveTracking(0);
      hasHydratedGame = true;
      saveDirty = false;

      await saveGameState(get());
      lastAutoSaveAt = Date.now();
      lastSavedGameTime = 0;

      patchSaveStatus(set, {
        hasSave: true,
        hasValidSave: true,
        lastSavedAt: lastAutoSaveAt,
        isDirty: false,
        isSaving: false,
        lastSaveError: null,
        migratedFromVersion: null,
        backup: { invalid: false, migrated: false },
      });

      get().refreshContractsFromMarket();
      get().ensureStarterContractsForTutorial();
      get().addNotification({
        time: get().currentTime,
        type: 'success',
        title: 'Test kaydı sıfırlandı',
        message: 'Test kaydı sıfırlandı. Yeni oyun başlatıldı.',
      });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./spotlightTutorialStore').useSpotlightTutorialStore.getState().resetActive();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Test kaydı sıfırlanamadı.';
      console.warn('[gameStore] resetGameForTesting failed:', error);
      patchSaveStatus(set, { lastSaveError: message });
      get().addNotification({
        time: get().currentTime,
        type: 'error',
        title: 'Sıfırlama başarısız',
        message,
      });
    } finally {
      isLoadingSave = false;
      isSavingGame = false;
      patchSaveStatus(set, { isLoadingSave: false, isSaving: false });
      await get().refreshSaveStatus();
    }
  },

  getDebugSaveInfo: () => {
    const state = get();
    const tutorial = state.tutorial ?? createDefaultTutorialState();
    const missions = state.missions ?? createDefaultMissionsState();
    const spotlight = state.spotlightTutorial ?? createDefaultSpotlightTutorialState();
    return {
      hasHydrated: hasHydratedGame,
      hasSavedGame: state.saveStatus.hasSave,
      gameDay: Math.floor(state.currentTime / 24) + 1,
      currentTime: state.currentTime,
      tutorialStepId: tutorial.currentStepId,
      tutorialCompletedStepIds: tutorial.completedStepIds,
      spotlightCompletedIds: spotlight.completedIds,
      spotlightSkippedIds: spotlight.skippedIds,
      missionsCompletedIds: missions.completedMissionIds,
      missionsClaimedRewardIds: missions.claimedMissionRewardIds,
    };
  },

  autoSave: (reason?: AutoSaveReason) => {
    if (!autoSaveEnabled || isLoadingSave || !hasHydratedGame) {
      return;
    }

    const state = get();
    if (!state.isGameReady || isSavingGame) {
      return;
    }

    const now = Date.now();
    const isImmediate = reason !== undefined && IMMEDIATE_SAVE_REASONS.has(reason);

    if (!isImmediate) {
      if (lastAutoSaveAt > 0 && now - lastAutoSaveAt < AUTO_SAVE_MIN_INTERVAL_MS) {
        return;
      }
      if (!saveDirty) {
        return;
      }
    }

    lastSaveReason = reason ?? null;
    isSavingGame = true;
    patchSaveStatus(set, { isSaving: true, lastSaveReason: reason ?? null });

    void get()
      .saveGame()
      .finally(() => {
        isSavingGame = false;
        lastAutoSaveAt = Date.now();
        patchSaveStatus(set, {
          lastSavedAt: lastAutoSaveAt,
          isDirty: false,
          isSaving: false,
          lastSaveReason: reason ?? null,
        });
      });
  },

  markSaveDirty: () => {
    saveDirty = true;
    patchSaveStatus(set, { isDirty: true });
  },

  setAutoSaveEnabled: (enabled: boolean) => {
    autoSaveEnabled = enabled;
    patchSaveStatus(set, { autoSaveEnabled: enabled });
  },

  getSaveStatus: () => createSaveStatusSnapshot(get().saveStatus.hasSave),

  refreshSaveStatus: async () => {
    const snapshot = await resolveSaveStatusPatch();
    set({ saveStatus: snapshot });
  },

  pauseGame: () => {
    set({ isPaused: true });
  },

  resumeGame: () => {
    set({ isPaused: false });
  },

  setGameSpeed: (speed: number) => {
    set({ gameSpeed: Math.max(0.25, Math.min(speed, 8)) });
  },

  advanceTime: (hours: number) => {
    const state = get();
    if (state.isPaused || hours <= 0) {
      return;
    }

    const newTime = state.currentTime + hours;

    set({ currentTime: newTime });

    get().updateDeliveries(hours);
    get().updateTransfers(hours);

    const stateAfterDelivery = get();
    const qualityResult = processWarehouseQualityDegradation(
      stateAfterDelivery.player.warehouses,
      newTime,
      hours,
      stateAfterDelivery.eventLog,
    );
    if (qualityResult.newEvents.length > 0 || qualityResult.warehouses !== stateAfterDelivery.player.warehouses) {
      set({
        player: {
          ...stateAfterDelivery.player,
          warehouses: qualityResult.warehouses.map((warehouse) =>
            normalizeWarehouse(warehouse, newTime),
          ),
        },
        ...(qualityResult.newEvents.length > 0
          ? {
              eventLog: prependGameEvents(
                stateAfterDelivery.eventLog,
                qualityResult.newEvents,
                newTime,
              ),
            }
          : {}),
      });
    }

    const stateBeforeDailyCosts = get();
    const lastDailyOperatingCostTime =
      stateBeforeDailyCosts.lastDailyOperatingCostTime ??
      stateBeforeDailyCosts.currentTime ??
      0;
    const elapsedDays = computeElapsedOperatingDays(
      lastDailyOperatingCostTime,
      newTime,
      DAILY_COST_INTERVAL_HOURS,
    );

    if (elapsedDays > 0) {
      const maxOfflineDays = operatingCostBalance.maxOfflineChargeDays ?? 3;
      const chargedDays = Math.min(elapsedDays, maxOfflineDays);
      const newLastDailyOperatingCostTime =
        lastDailyOperatingCostTime + elapsedDays * DAILY_COST_INTERVAL_HOURS;

      get().processDailyOperatingCosts({
        days: chargedDays,
        elapsedDays,
        reason:
          elapsedDays > 1 || chargedDays < elapsedDays
            ? 'offline_catchup'
            : 'daily_tick',
        currentTime: newTime,
        lastDailyOperatingCostTime: newLastDailyOperatingCostTime,
      });
    } else {
      set({
        dailyOperatingCostDebug: buildDailyOperatingCostDebugSnapshot(
          { ...stateBeforeDailyCosts, currentTime: newTime },
          get().dailyOperatingCostDebug?.lastCharge ?? null,
        ),
      });
    }

    get().processExpiredLeases();

    // Her 24 oyun saatinde bir ekonomi tick'i
    let { lastEconomyTickTime } = get();
    while (lastEconomyTickTime + ECONOMY_TICK_INTERVAL_HOURS <= newTime) {
      lastEconomyTickTime += ECONOMY_TICK_INTERVAL_HOURS;
      set({ lastEconomyTickTime });
      get().runEconomyTick();
    }

    const stateBeforeContracts = get();
    const scheduleParams = buildContractRefreshParams(stateBeforeContracts);
    const scheduleResult = processContractGenerationSchedule({
      ...scheduleParams,
      previousTime: state.currentTime,
      newTime,
      lastContractGenerationTime:
        stateBeforeContracts.lastContractGenerationTime ?? state.currentTime,
      lastMarketRefreshTime: stateBeforeContracts.lastMarketRefreshTime ?? 0,
      lastDailyCleanupTime: stateBeforeContracts.lastDailyCleanupTime ?? 0,
    });

    const contractPatch: Partial<StoreGameState> = {
      contracts: scheduleResult.contracts,
      lastContractGenerationTime: scheduleResult.lastContractGenerationTime,
      lastMarketRefreshTime: scheduleResult.lastMarketRefreshTime,
      lastDailyCleanupTime: scheduleResult.lastDailyCleanupTime,
    };

    if (
      (scheduleResult.newContracts.length > 0 || scheduleResult.debug.expiredContractsRemoved > 0) &&
      shouldLogContractMarketEvent(stateBeforeContracts.eventLog, newTime)
    ) {
      const isCatchup = scheduleResult.debug.offlineCatchup;
      const newCount = scheduleResult.newContracts.length;
      const expiredCount = scheduleResult.debug.expiredContractsRemoved;

      contractPatch.eventLog = prependGameEvents(
        stateBeforeContracts.eventLog,
        [
          {
            time: newTime,
            type: 'market',
            title: isCatchup ? 'Piyasa güncellendi' : 'Yeni sözleşmeler',
            message: isCatchup
              ? `${newCount} yeni sözleşme oluştu${expiredCount > 0 ? `, ${expiredCount} süresi dolan iş kaldırıldı` : ''}.`
              : `${newCount} yeni taşıma fırsatı piyasaya eklendi.`,
            importance: 'medium',
          },
        ],
        newTime,
      );
    }

    set({
      ...contractPatch,
      contractGenerationDebug: scheduleResult.debug,
    });

    if (scheduleResult.newContracts.length > 0) {
      get().markSaveDirty();
    }

    get().clearOldMarketNews();
    get().clearOldGameEvents();
    get().markSaveDirty();
    get().autoSave('time_tick');
  },

  processDailyOperatingCosts: (options?: ProcessDailyOperatingCostsOptions) => {
    const state = get();
    const chargedDays = Math.max(0, Math.floor(options?.days ?? 1));
    const currentTime = options?.currentTime ?? state.currentTime ?? 0;
    const reason = options?.reason ?? 'daily_tick';
    const elapsedDays = resolveOperatingCostElapsedDays(options?.elapsedDays, chargedDays);
    const skippedDays = getSkippedOperatingDaysDueToCap(elapsedDays, chargedDays);

    if (chargedDays <= 0) {
      if (options?.lastDailyOperatingCostTime != null) {
        set({
          lastDailyOperatingCostTime: options.lastDailyOperatingCostTime,
          dailyOperatingCostDebug: buildDailyOperatingCostDebugSnapshot(
            {
              ...state,
              currentTime,
              lastDailyOperatingCostTime: options.lastDailyOperatingCostTime,
            },
            state.dailyOperatingCostDebug?.lastCharge ?? null,
          ),
        });
      }
      return;
    }

    const breakdown = calculateDailyOperatingCostBreakdown(state.player);
    if (breakdown.total <= 0) {
      if (options?.lastDailyOperatingCostTime != null) {
        set({
          lastDailyOperatingCostTime: options.lastDailyOperatingCostTime,
          dailyOperatingCostDebug: buildDailyOperatingCostDebugSnapshot(
            {
              ...state,
              currentTime,
              lastDailyOperatingCostTime: options.lastDailyOperatingCostTime,
            },
            state.dailyOperatingCostDebug?.lastCharge ?? null,
          ),
        });
      }
      return;
    }

    const totalCost = breakdown.total * chargedDays;
    const ledgerEntry = buildSummarizedDailyOperatingCostLedgerEntry(
      breakdown,
      currentTime,
      chargedDays,
      elapsedDays,
    );

    let ledgerPatch: Pick<StoreGameState, 'financeLedger' | 'financeTotals'> | null = null;
    if (ledgerEntry) {
      ledgerPatch = patchFinanceLedger(state, ledgerEntry);
    }

    const lastCharge = {
      days: chargedDays,
      elapsedDays,
      skippedDays,
      total: totalCost,
      at: currentTime,
      reason,
    };

    const notificationMessage = formatOperatingCostNotificationMessage(
      { elapsedDays, chargedDays, amount: totalCost },
      formatNotificationMoney,
    );
    const eventLogMessage = formatOperatingCostEventLogMessage({
      elapsedDays,
      chargedDays,
    });
    const shouldSurfaceCatchup =
      elapsedDays > chargedDays ||
      chargedDays > 1 ||
      reason === 'offline_catchup';

    const patch: Partial<GameStore> = {
      player: {
        ...state.player,
        money: (state.player.money ?? 0) - totalCost,
      },
      financeLedger: ledgerPatch?.financeLedger ?? state.financeLedger ?? [],
      financeTotals: ledgerPatch?.financeTotals ?? state.financeTotals,
      dailyOperatingCostDebug: buildDailyOperatingCostDebugSnapshot(
        {
          ...state,
          currentTime,
          lastDailyOperatingCostTime:
            options?.lastDailyOperatingCostTime ??
            state.lastDailyOperatingCostTime ??
            0,
        },
        lastCharge,
      ),
    };

    if (options?.lastDailyOperatingCostTime != null) {
      patch.lastDailyOperatingCostTime = options.lastDailyOperatingCostTime;
    }

    if (shouldSurfaceCatchup && eventLogMessage) {
      patch.eventLog = prependGameEvent(
        state.eventLog,
        {
          time: currentTime,
          type: 'system',
          title: 'İşletme giderleri işlendi',
          message: eventLogMessage,
          importance: 'medium',
        },
        currentTime,
      );
    }

    set(patch);

    const shouldNotify =
      elapsedDays > chargedDays ||
      (chargedDays > 1 && operatingCostBalance.notifyWhenMultipleDaysCharged);

    if (shouldNotify && notificationMessage) {
      try {
        get().addNotification({
          time: currentTime,
          type: 'info',
          title: 'İşletme giderleri işlendi',
          message: notificationMessage,
          autoDismissMs: 4000,
        });
      } catch (error) {
        console.warn('[gameStore] daily operating cost notification failed:', error);
      }
    }

    get().markSaveDirty();
  },

  processExpiredLeases: () => {
    const state = get();
    const { trucks, expiredTruckNames } = processExpiredTruckLeases(
      state.player.trucks,
      state.currentTime,
    );

    if (expiredTruckNames.length === 0) {
      return;
    }

    set({
      player: {
        ...state.player,
        trucks,
      },
    });

    for (const truckName of expiredTruckNames) {
      get().addNotification({
        time: state.currentTime,
        type: 'warning',
        title: 'Kiralama süresi doldu',
        message: `${truckName} — kiralık kamyon süresi doldu ve pasif hale getirildi.`,
        actionLabel: 'Filoyu Gör',
        actionTarget: 'fleet',
        autoDismissMs: 5000,
      });
    }
  },

  runEconomyTick: () => {
    const state = get();
    const safeEconomy = normalizeGlobalEconomy(state.globalEconomy);
    const previousFuelPrice = getSafeFuelPrice(safeEconomy);
    const previousCities = citiesToRecord(state.cities);

    // Şehir ekonomilerini güncelle
    const updatedCitiesRecord = updateAllCitiesEconomy(
      previousCities,
      safeEconomy,
    );

    // Yakıt fiyatını küçük rastgele değişimle güncelle
    const fuelChange = randomBetween(-0.06, 0.08);
    const newFuelPrice = Math.max(0.8, previousFuelPrice * (1 + fuelChange));
    const globalEconomy = normalizeGlobalEconomy({
      ...safeEconomy,
      fuelPrice: Number(newFuelPrice.toFixed(2)),
    });

    const expiredContracts = expireOldContracts(state.contracts, state.currentTime);
    const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);
    const balancedContracts = balanceAvailableContractLevelMix(expiredContracts, playerLevel);

    const news: MarketNews[] = [];
    const gameEvents: Array<Omit<GameEvent, 'id'> & { id?: string }> = [];

    // Yakıt haberi
    const fuelDelta =
      previousFuelPrice > 0
        ? (globalEconomy.fuelPrice - previousFuelPrice) / previousFuelPrice
        : 0;
    if (Math.abs(fuelDelta) > FUEL_PRICE_CHANGE_THRESHOLD) {
      const fuelTitle = fuelDelta > 0 ? 'Yakıt fiyatları arttı' : 'Yakıt fiyatları düştü';
      const fuelMessage = `Yakıt ${(Math.abs(fuelDelta) * 100).toFixed(0)}% ${fuelDelta > 0 ? 'zamlan' : 'indirim'} yaptı. Yeni fiyat: $${globalEconomy.fuelPrice}/L`;
      const fuelImportance = Math.abs(fuelDelta) > 0.1 ? 'high' as const : 'medium' as const;

      news.push({
        id: createNewsId(state.currentTime, `fuel_${Date.now()}`),
        time: state.currentTime,
        type: 'fuel',
        title: fuelTitle,
        message: fuelMessage,
        importance: fuelImportance,
      });
      gameEvents.push({
        time: state.currentTime,
        type: 'market',
        title: fuelTitle,
        message: fuelMessage,
        importance: fuelImportance,
      });
    }

    // Stok haberleri
    for (const city of citiesFromRecord(updatedCitiesRecord)) {
      for (const [productId, productState] of Object.entries(city.products)) {
        const safeTarget = Math.max(productState.targetStock, 1);
        const stockRatio = productState.stock / safeTarget;

        if (stockRatio < 0.3) {
          const productName = getProductName(productId);
          const shortageTitle = `${city.name} — stok alarmı`;
          const shortageMessage = `${productName} stoğu hedefin %30 altına düştü.`;

          news.push({
            id: createNewsId(state.currentTime, `short_${city.id}_${productId}`),
            time: state.currentTime,
            type: 'warning',
            title: shortageTitle,
            message: shortageMessage,
            cityId: city.id,
            productId: productId as ProductId,
            importance: 'high',
          });
          gameEvents.push({
            time: state.currentTime,
            type: 'market',
            title: shortageTitle,
            message: shortageMessage,
            importance: 'high',
          });
        } else if (stockRatio > 1.6) {
          const productName = getProductName(productId);
          news.push({
            id: createNewsId(state.currentTime, `surp_${city.id}_${productId}`),
            time: state.currentTime,
            type: 'economy',
            title: `${city.name} — stok fazlası`,
            message: `${productName} stoğu hedefin %160 üzerine çıktı.`,
            cityId: city.id,
            productId: productId as ProductId,
            importance: 'low',
          });
        }
      }
    }

    set({
      cities: citiesFromRecord(updatedCitiesRecord),
      globalEconomy,
      contracts: balancedContracts,
      marketNews: [...news, ...state.marketNews].slice(0, MARKET_NEWS_MAX_COUNT),
      eventLog: prependGameEvents(state.eventLog, gameEvents, state.currentTime),
    });
    get().markSaveDirty();
    get().autoSave('economy_tick');
  },

  refreshMarketSnapshot: () => {
    const state = get();
    const playerLevel = Math.max(1, state.player?.level ?? state.player?.companyLevel ?? 1);
    const expired = expireOldContracts(state.contracts ?? [], state.currentTime);
    const balanced = balanceAvailableContractLevelMix(expired, playerLevel);
    if (balanced !== state.contracts) {
      set({ contracts: balanced });
      get().markSaveDirty();
    }
  },

  refreshContractsFromMarket: () => {
    const state = get();
    if (!state.player) {
      return;
    }

    const previousContracts = state.contracts ?? [];
    const { contracts: updatedContracts, newContracts } = refreshContractsFromMarket(
      buildContractRefreshParams(state),
    );

    const contractsChanged =
      newContracts.length > 0 ||
      updatedContracts.length !== previousContracts.length ||
      updatedContracts.some(
        (contract, index) => previousContracts[index]?.status !== contract.status,
      );

    lastContractMarketRefreshAt = Date.now();

    if (!contractsChanged) {
      return;
    }

    const patch: Partial<StoreGameState> = { contracts: updatedContracts };

    if (
      newContracts.length > 0 &&
      shouldLogContractMarketEvent(state.eventLog, state.currentTime)
    ) {
      patch.eventLog = prependGameEvents(
        state.eventLog,
        [
          {
            time: state.currentTime,
            type: 'market',
            title: 'Yeni taşıma fırsatları',
            message: `${newContracts.length} yeni taşıma fırsatı piyasaya eklendi.`,
            importance: 'low',
          },
        ],
        state.currentTime,
      );
    }

    set(patch);
    get().markSaveDirty();
    if (newContracts.length > 0) {
      get().autoSave('contracts_generated');
    }
  },

  getContractRefreshRemainingSeconds: () => {
    const elapsed = Date.now() - lastContractMarketRefreshAt;
    const remaining = contractBalance.contractRefreshIntervalMs - elapsed;
    return Math.max(0, Math.ceil(remaining / 1000));
  },

  getContractGenerationDebug: () => {
    const state = get();
    return (
      state.contractGenerationDebug ??
      createEmptyContractGenerationDebug(state.currentTime ?? 0)
    );
  },

  getDeliverySettlementDebug: () => {
    const state = get();
    return state.deliverySettlementDebug ?? createEmptyDeliverySettlementDebug();
  },

  replenishContractsIfNeeded: () => {
    const state = get();
    const { contracts: updatedContracts, newContracts } = applyContractReplenishment(
      state,
      citiesToRecord(state.cities),
      state.globalEconomy,
    );

    const contractsChanged =
      newContracts.length > 0 ||
      updatedContracts.length !== (state.contracts ?? []).length ||
      updatedContracts.some(
        (contract, index) => state.contracts[index]?.status !== contract.status,
      );

    if (!contractsChanged) {
      return;
    }

    const patch: Partial<StoreGameState> = { contracts: updatedContracts };

    if (newContracts.length > 0 && shouldLogContractMarketEvent(state.eventLog, state.currentTime)) {
      patch.eventLog = prependGameEvents(
        state.eventLog,
        [
          {
            time: state.currentTime,
            type: 'market',
            title: 'Yeni sözleşmeler',
            message: `${newContracts.length} yeni taşıma fırsatı piyasaya eklendi.`,
            importance: 'medium',
          },
        ],
        state.currentTime,
      );
    }

    set(patch);
    get().markSaveDirty();
    if (newContracts.length > 0) {
      get().autoSave('contracts_generated');
    }
  },

  generateNewContracts: () => {
    const state = get();
    const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);
    const ownedMaxTruckCapacity = getHighestOwnedTruckCapacity(state.player.trucks);
    const idleMaxTruckCapacity = getMaxIdleTruckCapacity(state.player.trucks);
    const newContracts = generateContracts(
      citiesToRecord(state.cities),
      state.routes,
      state.products,
      state.globalEconomy,
      state.contracts,
      {
        currentTime: state.currentTime,
        maxNewContracts: 10,
        playerLevel,
        ownedMaxTruckCapacity: ownedMaxTruckCapacity || getMaxContractTonnageForLevel(playerLevel),
        idleMaxTruckCapacity,
        idleTruckOriginCityIds: getIdleTruckOriginCityIds(
          state.player.trucks,
          state.player.homeCityId,
        ),
      },
    );

    if (newContracts.length > 0) {
      const merged = mergeContractsWithDedupe(state.contracts, newContracts);
      set({
        contracts: balanceAvailableContractLevelMix(merged, playerLevel),
      });
      get().addGameEvent({
        time: state.currentTime,
        type: 'market',
        title: 'Yeni sözleşmeler',
        message: `${newContracts.length} yeni taşıma fırsatı listelendi.`,
        importance: 'medium',
      });
      get().markSaveDirty();
      get().autoSave('contracts_generated');
    }
  },

  expireContracts: () => {
    const state = get();
    const expired = expireOldContracts(state.contracts, state.currentTime);
    set({ contracts: expired });
  },

  startDelivery: (contractId: string, truckId: string, driverId: string): StartDeliveryResult => {
    const state = get();

    const contract = state.contracts.find((c) => c.id === contractId);
    if (!contract || contract.status !== 'available') {
      return {
        success: false,
        errorCode: 'CONTRACT_NOT_FOUND',
        message: 'Sözleşme bulunamadı veya müsait değil.',
      };
    }

    const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);
    const requiredLevel = contract.requiredLevel ?? 1;
    if (requiredLevel > playerLevel) {
      return {
        success: false,
        errorCode: 'DELIVERY_CREATE_FAILED',
        message: `Bu sözleşme için şirket seviyen Level ${requiredLevel} olmalı.`,
      };
    }

    const truck = state.player.trucks.find((t) => t.id === truckId);
    if (!truck) {
      return {
        success: false,
        errorCode: 'TRUCK_NOT_FOUND',
        message: 'Kamyon bulunamadı.',
      };
    }

    if (truck.status !== 'idle') {
      return {
        success: false,
        errorCode: 'TRUCK_BUSY',
        message:
          truck.status === 'maintenance'
            ? 'Kamyon bakımda. Teslimat için boşta bir kamyon seç.'
            : truck.status === 'transferring'
              ? 'Kamyon şu anda yönlendiriliyor.'
              : 'Seçilen kamyon şu anda teslimatta.',
      };
    }

    const driver = state.player.drivers.find((d) => d.id === driverId);
    if (!driver) {
      return {
        success: false,
        errorCode: 'DRIVER_NOT_FOUND',
        message: 'Şoför bulunamadı.',
      };
    }

    if (driver.status !== 'idle') {
      return {
        success: false,
        errorCode: 'DRIVER_BUSY',
        message: 'Seçilen şoför şu anda görevde.',
      };
    }

    const originCityId = contract.originCityId;
    if (!originCityId) {
      return {
        success: false,
        errorCode: 'DELIVERY_CREATE_FAILED',
        message: 'Sözleşmenin çıkış şehri tanımlı değil.',
      };
    }

    const truckCityId = resolveTruckCityId(truck, state.player.homeCityId);
    if (truckCityId !== originCityId) {
      const fromCityName = getCityName(originCityId);
      const truckCityName = getCityName(truckCityId);
      return {
        success: false,
        errorCode: 'TRUCK_NOT_AT_ORIGIN',
        message: `Bu sözleşme ${fromCityName} çıkışlı. Seçilen kamyon şu anda ${truckCityName} şehrinde.`,
      };
    }

    const product = getProductByIdSafe(contract.productId);
    if (!product) {
      console.warn('[gameStore] Skipping delivery start: unknown productId', contract.productId);
      return {
        success: false,
        errorCode: 'PRODUCT_NOT_FOUND',
        message: 'Sözleşme ürünü tanınamadı.',
      };
    }
    const cargoWeight = getContractCargoWeight(contract, product);

    if ((truck.capacity ?? 0) < cargoWeight) {
      return {
        success: false,
        errorCode: 'CAPACITY_INSUFFICIENT',
        message: `Bu iş için ${cargoWeight.toFixed(1)} ton kapasite gerekiyor. Seçilen kamyon ${(truck.capacity ?? 0).toFixed(1)} ton taşıyabiliyor.`,
      };
    }

    if ((truck.condition ?? 0) < MIN_TRUCK_CONDITION_FOR_DELIVERY) {
      return {
        success: false,
        errorCode: 'TRUCK_CONDITION_TOO_LOW',
        message: `Kamyon kondisyonu çok düşük (%${Math.round(truck.condition ?? 0)}). Önce tamir et.`,
      };
    }

    if (!canTruckCarryContract(truck, contract, product)) {
      const maxIdleTruckCapacity = getMaxIdleTruckCapacity(state.player.trucks);
      return {
        success: false,
        errorCode: 'CAPACITY_INSUFFICIENT',
        message: formatCapacityExceededMessage(cargoWeight, maxIdleTruckCapacity),
      };
    }

    const route = getRouteBetweenCities(
      state.routes,
      contract.originCityId,
      contract.destinationCityId,
    );
    if (!route) {
      return {
        success: false,
        errorCode: 'ROUTE_NOT_FOUND',
        message: 'Rota bulunamadı.',
      };
    }

    let delivery: Delivery;
    try {
      delivery = createDelivery({
        contract,
        truck,
        driver,
        route,
        product,
        globalEconomy: state.globalEconomy,
        currentTime: state.currentTime,
        sequence: state.activeDeliveries.length + 1,
      });
    } catch (error) {
      const message =
        error instanceof DeliveryError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Teslimat oluşturulamadı.';
      return {
        success: false,
        errorCode: 'DELIVERY_CREATE_FAILED',
        message,
      };
    }

    if (state.player.money < delivery.fuelCost) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_FUNDS',
        message: `Yetersiz bakiye. Yakıt maliyeti: $${delivery.fuelCost.toFixed(0)}, mevcut: $${state.player.money.toFixed(0)}`,
      };
    }

    const routeLabel = `${getCityName(contract.originCityId)} → ${getCityName(contract.destinationCityId)}`;
    const deliveryStartEventId = `event_delivery_start_${delivery.id}`;

    const updatedTrucks = state.player.trucks.map((t) =>
      t.id === truckId ? { ...t, status: 'on_route' as const } : t,
    );

    const updatedDrivers = state.player.drivers.map((d) =>
      d.id === driverId
        ? { ...d, status: 'driving' as const, assignedTruckId: truckId }
        : d,
    );

    const updatedContracts = state.contracts.map((c) =>
      c.id === contractId ? { ...c, status: 'active' as const } : c,
    );

    const cashBeforeStart = state.player.money;
    const cashAfterStart = cashBeforeStart - delivery.fuelCost;

    set({
      player: {
        ...state.player,
        money: cashAfterStart,
        trucks: updatedTrucks,
        drivers: updatedDrivers,
      },
      contracts: updatedContracts,
      activeDeliveries: [...state.activeDeliveries, delivery],
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'fuel',
        amount: delivery.fuelCost,
        description: `Yakıt · ${routeLabel}`,
      }),
      deliverySettlementDebug: {
        phase: 'start',
        cashBefore: cashBeforeStart,
        cashAfter: cashAfterStart,
        fuelCost: delivery.fuelCost ?? 0,
        contractPayment: contract.payment ?? 0,
        maintenanceCost: 0,
        penaltyCost: 0,
        reportedNetProfit: 0,
        cashDeltaOnCompletion: 0,
      },
      eventLog: prependGameEvent(
        state.eventLog,
        {
          id: deliveryStartEventId,
          time: state.currentTime,
          type: 'delivery',
          title: 'Teslimat başladı',
          message: `${truck.name} ve ${driver.name}, ${routeLabel} rotasına çıktı.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    try {
      get().addNotification({
        time: state.currentTime,
        type: 'info',
        title: 'Teslimat başladı',
        message: `${truck.name} · ${driver.name} — ${routeLabel}`,
        autoDismissMs: 2500,
      });
    } catch (error) {
      console.warn('[gameStore] delivery start notification failed:', error);
    }

    get().autoSave('delivery_started');
    get().notifyTutorialDeliveryStarted();
    return { success: true };
  },

  startDeliveryAutoAssign: (contractId: string): StartDeliveryResult => {
    const state = get();
    const contract = state.contracts.find((c) => c.id === contractId);
    if (!contract) {
      return {
        success: false,
        errorCode: 'CONTRACT_NOT_FOUND',
        message: 'Sözleşme bulunamadı.',
      };
    }

    const availability = getContractAvailability(
      contract,
      state.player.trucks,
      state.player.drivers,
      Math.max(1, state.player.level ?? state.player.companyLevel ?? 1),
    );

    if (!availability.canStart) {
      return {
        success: false,
        errorCode: availabilityReasonToStartDeliveryErrorCode(availability.reason),
        message: availability.message ?? availability.buttonLabel,
      };
    }

    const product = getProductByIdSafe(contract.productId);
    if (!product) {
      console.warn('[gameStore] Skipping auto-assign: unknown productId', contract.productId);
      return {
        success: false,
        errorCode: 'PRODUCT_NOT_FOUND',
        message: 'Sözleşme ürünü tanınamadı.',
      };
    }
    const truck = selectIdleTruckForContract(
      state.player.trucks,
      contract,
      product,
      state.currentTime,
    );
    const driver = (state.player.drivers ?? []).find((candidate) => candidate.status === 'idle');

    if (!truck) {
      return {
        success: false,
        errorCode: 'CAPACITY_INSUFFICIENT',
        message: availability.message ?? formatCapacityExceededMessage(
          availability.requiredCapacity ?? getContractCargoWeight(contract, product),
          availability.maxIdleTruckCapacity ?? getMaxIdleTruckCapacity(state.player.trucks),
        ),
      };
    }

    if ((truck.condition ?? 0) < MIN_TRUCK_CONDITION_FOR_DELIVERY) {
      return {
        success: false,
        errorCode: 'TRUCK_CONDITION_TOO_LOW',
        message: 'Uygun kamyonun kondisyonu çok düşük.',
      };
    }

    if (!driver) {
      return {
        success: false,
        errorCode: 'DRIVER_BUSY',
        message: 'Seçilen şoför şu anda görevde.',
      };
    }

    return get().startDelivery(contractId, truck.id, driver.id);
  },

  updateDeliveries: (hoursPassed: number) => {
    if (hoursPassed <= 0) {
      return;
    }

    const state = get();
    const deliveriesToComplete: string[] = [];
    const deliveriesToFail: { id: string; reason: DeliveryFailureReason }[] = [];
    const failedThisTick = new Set<string>();

    const updatedDeliveries = state.activeDeliveries.map((delivery) => {
      if (delivery.status !== 'on_route' && delivery.status !== 'preparing') {
        return delivery;
      }

      // Arıza / kaza riski — seyahat süresine orantılı düşük ihtimal
      const progressFraction = hoursPassed / Math.max(delivery.travelHours, 0.1);
      if (randomBetween(0, 1) < delivery.breakdownChance * progressFraction * 0.15) {
        if (!failedThisTick.has(delivery.id)) {
          deliveriesToFail.push({ id: delivery.id, reason: 'breakdown' });
          failedThisTick.add(delivery.id);
        }
        return delivery;
      }
      if (randomBetween(0, 1) < delivery.accidentChance * progressFraction * 0.12) {
        if (!failedThisTick.has(delivery.id)) {
          deliveriesToFail.push({ id: delivery.id, reason: 'accident' });
          failedThisTick.add(delivery.id);
        }
        return delivery;
      }

      const updated = updateDeliveryProgress(delivery, hoursPassed);

      if (isDeliveryProgressComplete(updated.progress)) {
        deliveriesToComplete.push(updated.id);
      }

      return updated;
    });

    set({ activeDeliveries: updatedDeliveries });

    for (const { id, reason } of deliveriesToFail) {
      get().failDeliveryById(id, reason);
    }

    const failedIdSet = new Set(deliveriesToFail.map((entry) => entry.id));
    for (const deliveryId of deliveriesToComplete) {
      if (failedIdSet.has(deliveryId)) {
        continue;
      }
      const current = get().activeDeliveries.find((d) => d.id === deliveryId);
      if (
        current &&
        (current.status === 'on_route' || current.status === 'preparing') &&
        isDeliveryProgressComplete(current.progress)
      ) {
        get().completeDeliveryById(deliveryId);
      }
    }
  },

  updateTransfers: (hoursPassed: number) => {
    if (hoursPassed <= 0) {
      return;
    }

    const state = get();
    const transfersToComplete: string[] = [];

    const updatedTransfers = (state.activeTransfers ?? []).map((transfer) => {
      if (transfer.status !== 'active') {
        return transfer;
      }

      const updated = updateTransferProgress(transfer, hoursPassed);
      if (updated.progress >= 1) {
        transfersToComplete.push(updated.id);
      }
      return updated;
    });

    set({ activeTransfers: updatedTransfers });

    for (const transferId of transfersToComplete) {
      const current = get().activeTransfers.find((transfer) => transfer.id === transferId);
      if (current && current.status === 'active' && current.progress >= 1) {
        get().completeTruckTransferById(transferId);
      }
    }
  },

  startTruckTransfer: (params: {
    truckId: string;
    toCityId: string;
    driverId?: string;
  }): StartTruckTransferResult => {
    const state = get();
    const truck = state.player.trucks.find((candidate) => candidate.id === params.truckId);
    if (!truck) {
      return {
        success: false,
        errorCode: 'TRUCK_NOT_FOUND',
        message: 'Kamyon bulunamadı.',
      };
    }

    if (truck.status !== 'idle') {
      return {
        success: false,
        errorCode: 'TRUCK_BUSY',
        message:
          truck.status === 'transferring'
            ? 'Kamyon şu anda yönlendiriliyor.'
            : truck.status === 'on_route'
              ? 'Kamyon şu anda yolda.'
              : 'Kamyon şu anda müsait değil.',
      };
    }

    const fromCityId = resolveTruckCityId(truck, state.player.homeCityId);
    if (!fromCityId) {
      return {
        success: false,
        errorCode: 'TRANSFER_CREATE_FAILED',
        message: 'Kamyon konumu belirlenemedi.',
      };
    }

    if (fromCityId === params.toCityId) {
      return {
        success: false,
        errorCode: 'SAME_CITY',
        message: 'Bu kamyon zaten bu şehirde.',
      };
    }

    if (!getCityByIdSafe(params.toCityId)) {
      return {
        success: false,
        errorCode: 'CITY_NOT_FOUND',
        message: 'Hedef şehir bulunamadı.',
      };
    }

    const route = resolveTransferRoute(state.routes, fromCityId, params.toCityId);
    if (!route) {
      return {
        success: false,
        errorCode: 'ROUTE_NOT_FOUND',
        message: 'Bu şehirler arasında rota bulunamadı.',
      };
    }

    const driver =
      (params.driverId
        ? state.player.drivers.find(
            (candidate) => candidate.id === params.driverId && candidate.status === 'idle',
          )
        : undefined) ?? selectDriverForTransfer(truck.id, state.player.drivers);

    if (!driver) {
      return {
        success: false,
        errorCode: 'NO_IDLE_DRIVER',
        message: 'Boş transfer için müsait şoför gerekiyor.',
      };
    }

    const fuelPrice = state.globalEconomy?.fuelPrice ?? economyBalance.baseFuelPrice;
    let transfer: TruckTransfer;
    try {
      transfer = createTruckTransfer({
        truck,
        driver,
        fromCityId,
        toCityId: params.toCityId,
        route,
        fuelPrice,
        currentTime: state.currentTime,
        sequence: (state.activeTransfers ?? []).length + 1,
      });
    } catch {
      return {
        success: false,
        errorCode: 'TRANSFER_CREATE_FAILED',
        message: 'Transfer oluşturulamadı.',
      };
    }

    if (state.player.money < transfer.totalCost) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_FUNDS',
        message: 'Nakit yetersiz.',
      };
    }

    const fromCityName = getCityName(fromCityId);
    const toCityName = getCityName(params.toCityId);
    const routeLabel = `${fromCityName} → ${toCityName}`;

    const updatedTrucks = state.player.trucks.map((candidate) =>
      candidate.id === truck.id ? { ...candidate, status: 'transferring' as const } : candidate,
    );
    const updatedDrivers = state.player.drivers.map((candidate) =>
      candidate.id === driver.id
        ? { ...candidate, status: 'driving' as const, assignedTruckId: truck.id }
        : candidate,
    );

    set({
      player: {
        ...state.player,
        money: state.player.money - transfer.totalCost,
        trucks: updatedTrucks,
        drivers: updatedDrivers,
      },
      activeTransfers: [...(state.activeTransfers ?? []), transfer],
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'truck_transfer',
        amount: transfer.totalCost,
        description: `Boş kamyon transferi · ${routeLabel}`,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'fleet',
          title: 'Boş transfer başladı',
          message: `${truck.name}, ${routeLabel} rotasına çıktı.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    try {
      get().addNotification({
        time: state.currentTime,
        type: 'info',
        title: 'Transfer başladı',
        message: `${truck.name}, ${toCityName} yönüne çıktı.`,
        autoDismissMs: 2500,
      });
    } catch (error) {
      console.warn('[gameStore] transfer start notification failed:', error);
    }

    get().autoSave('transfer_started');
    return { success: true, transferId: transfer.id, message: 'Transfer başladı.' };
  },

  completeTruckTransferById: (transferId: string) => {
    const state = get();
    const transferEventId = `event_transfer_complete_${transferId}`;

    if (
      completedTransferNotificationIds.has(transferId) ||
      state.eventLog.some((event) => event.id === transferEventId)
    ) {
      return;
    }

    const transfer = (state.activeTransfers ?? []).find((candidate) => candidate.id === transferId);
    if (!transfer || transfer.status !== 'active' || transfer.progress < 1) {
      return;
    }

    const truck = state.player.trucks.find((candidate) => candidate.id === transfer.truckId);
    if (!truck) {
      return;
    }

    const toCityName = getCityName(transfer.toCityId);
    const completedTransfer: TruckTransfer = { ...transfer, status: 'completed', progress: 1 };

    const updatedTrucks = state.player.trucks.map((candidate) =>
      candidate.id === transfer.truckId
        ? {
            ...candidate,
            status: 'idle' as const,
            currentCityId: transfer.toCityId,
          }
        : candidate,
    );

    const updatedDrivers = state.player.drivers.map((candidate) => {
      if (transfer.driverId && candidate.id === transfer.driverId) {
        return { ...candidate, status: 'idle' as const, assignedTruckId: transfer.truckId };
      }
      return candidate;
    });

    set({
      player: {
        ...state.player,
        trucks: updatedTrucks,
        drivers: updatedDrivers,
      },
      activeTransfers: (state.activeTransfers ?? []).filter(
        (candidate) => candidate.id !== transferId,
      ),
      completedTransfers: [completedTransfer, ...(state.completedTransfers ?? [])].slice(0, 50),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          id: transferEventId,
          time: state.currentTime,
          type: 'fleet',
          title: 'Boş transfer tamamlandı',
          message: `${truck.name}, ${toCityName} şehrine ulaştı.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    completedTransferNotificationIds.add(transferId);

    try {
      get().addNotification({
        time: state.currentTime,
        type: 'success',
        title: 'Kamyon ulaştı',
        message: `${truck.name}, ${toCityName} konumunda yeni işler için hazır.`,
        autoDismissMs: 3000,
      });
    } catch (error) {
      console.warn('[gameStore] transfer complete notification failed:', error);
    }

    get().autoSave('transfer_completed');
  },

  completeDeliveryById: (deliveryId: string) => {
    const state = get();
    const deliveryEventId = `event_delivery_complete_${deliveryId}`;

    if (
      completedDeliveryNotificationIds.has(deliveryId) ||
      state.eventLog.some((event) => event.id === deliveryEventId) ||
      hasDeliveryCompletionLedgerEntry(state.financeLedger, deliveryId)
    ) {
      return;
    }

    const simState = toSimulationState(state);
    const delivery = simState.deliveries.find((d) => d.id === deliveryId);

    if (!delivery) {
      console.warn('[delivery] complete skipped: delivery not found', deliveryId);
      return;
    }

    if (delivery.status === 'completed') {
      return;
    }

    if (delivery.status === 'failed') {
      console.warn('[delivery] complete skipped: already failed', deliveryId);
      return;
    }

    if (!isDeliveryProgressComplete(delivery.progress)) {
      console.warn(
        '[delivery] complete skipped: delivery not ready',
        deliveryId,
        delivery.progress,
      );
      return;
    }

    const contract = simState.contracts.find((c) => c.id === delivery.contractId);
    if (!contract) {
      console.warn('[delivery] complete skipped: contract not found', delivery.contractId);
      return;
    }

    const beforeMoney = state.player.money;
    const actualTravelHours = state.currentTime - delivery.startedAt;
    const product = getProductByIdSafe(delivery.productId);

    // Kritik gecikme → başarısız teslimat
    if (actualTravelHours > contract.deadlineHours * 2) {
      get().failDeliveryById(deliveryId, 'too_late');
      return;
    }

    let newSimState: ReturnType<typeof toSimulationState>;
    try {
      const simResult = safeCompleteDelivery(simState, deliveryId);
      if (!simResult.success || !simResult.updatedState) {
        if (simResult.errorCode === 'SIMULATION_ERROR') {
          console.warn('[delivery] completeDeliverySim error', deliveryId, simResult.message);
        }
        return;
      }
      newSimState = simResult.updatedState;
    } catch (error: unknown) {
      console.warn('[delivery] completeDeliverySim error', deliveryId, error);
      return;
    }

    const penaltyCost = product
      ? calculateLatePenalty(
          contract,
          delivery.travelHours,
          actualTravelHours,
          product,
        )
      : 0;

    const settlement = calculateDeliverySettlement({
      contractPayment: contract.payment ?? 0,
      fuelCost: delivery.fuelCost ?? 0,
      maintenanceCost: delivery.maintenanceCost ?? 0,
      penaltyCost,
      fuelAlreadyPaid: true,
    });

    const moneyAfterComplete = beforeMoney + settlement.cashDeltaOnCompletion;
    const netProfit = settlement.netProfit;
    const routeLabel = `${getCityName(delivery.originCityId)} → ${getCityName(delivery.destinationCityId)}`;
    const distanceKm = contract.distanceKm ?? delivery.distanceKm ?? 0;
    const riskTier = getDeliveryRiskTier(delivery);
    const xpGain = calculateDeliveryXp(distanceKm, netProfit, riskTier);
    const notificationMessage = `Teslimat tamamlandı. Ödeme: ${formatNotificationMoney(settlement.grossRevenue)} · Net kâr: ${formatNotificationMoney(netProfit)}`;
    const eventMessage = `${routeLabel} teslimatı tamamlandı. Ödeme: ${formatNotificationMoney(settlement.grossRevenue)} · Net kâr: ${formatNotificationMoney(netProfit)} · +${xpGain} XP`;
    const completedTruck = newSimState.trucks.find((t) => t.id === delivery.truckId);
    const destinationCityName = getCityName(delivery.destinationCityId);
    const truckArrivalMessage = completedTruck
      ? `${completedTruck.name} ${destinationCityName}'ya ulaştı ve yeni işler için hazır.`
      : `Kamyon ${destinationCityName}'ya ulaştı ve yeni işler için hazır.`;

    const merged = mergeSimulationIntoStore(state, newSimState, moneyAfterComplete);
    const completionLedgerEntries = buildDeliveryCompletionLedgerEntries(
      settlement,
      routeLabel,
      state.currentTime,
      deliveryId,
    );
    const ledgerPatch = patchFinanceLedger(state, completionLedgerEntries);

    set({
      ...merged,
      ...ledgerPatch,
      deliverySettlementDebug: {
        phase: 'complete',
        cashBefore: beforeMoney,
        cashAfter: moneyAfterComplete,
        fuelCost: settlement.fuelCost,
        contractPayment: settlement.grossRevenue,
        maintenanceCost: settlement.maintenanceCost,
        penaltyCost: settlement.penaltyCost,
        reportedNetProfit: netProfit,
        cashDeltaOnCompletion: settlement.cashDeltaOnCompletion,
      },
      player: {
        ...state.player,
        trucks: merged.player!.trucks,
        drivers: merged.player!.drivers,
        warehouses: merged.player!.warehouses,
        money: moneyAfterComplete,
        completedContracts: state.player.completedContracts + 1,
        reputation: Math.min(100, state.player.reputation + REPUTATION_GAIN),
      },
      marketNews: [
        {
          id: createNewsId(state.currentTime, `del_ok_${deliveryId}`),
          time: state.currentTime,
          type: 'delivery' as const,
          title: 'Teslimat tamamlandı',
          message: `${routeLabel}: Ödeme ${formatNotificationMoney(settlement.grossRevenue)} · Net kâr ${formatNotificationMoney(netProfit)}.`,
          cityId: delivery.destinationCityId,
          productId: delivery.productId,
          importance: 'medium' as const,
        },
        ...state.marketNews,
      ].slice(0, MARKET_NEWS_MAX_COUNT),
      eventLog: prependGameEvent(
        prependGameEvent(
          state.eventLog,
          {
            id: deliveryEventId,
            time: state.currentTime,
            type: 'delivery',
            title: 'Teslimat tamamlandı',
            message: eventMessage,
            importance: 'high',
          },
          state.currentTime,
        ),
        {
          time: state.currentTime,
          type: 'fleet',
          title: 'Kamyon konumu güncellendi',
          message: truckArrivalMessage,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    completedDeliveryNotificationIds.add(deliveryId);

    get().addCompanyXp(xpGain, 'delivery_completed');
    get().notifyFirstDeliveryCompleted();
    get().syncMissionProgress();

    try {
      get().addNotification({
        time: state.currentTime,
        type: 'success',
        title: 'Teslimat tamamlandı',
        message: notificationMessage,
        actionLabel: 'Finansı Gör',
        actionTarget: 'finance',
        autoDismissMs: 3000,
      });
    } catch (error) {
      console.warn('[gameStore] addNotification failed:', error);
    }

    get().autoSave('delivery_completed');
    get().processExpiredLeases();
  },

  failDeliveryById: (deliveryId: string, reason: DeliveryFailureReason) => {
    const state = get();
    const simState = toSimulationState(state);

    const delivery = simState.deliveries.find((d) => d.id === deliveryId);
    if (!delivery || delivery.status === 'completed' || delivery.status === 'failed') {
      return;
    }

    const newSimState = failDeliverySim(simState, deliveryId, reason);
    const contract = simState.contracts.find((c) => c.id === delivery.contractId);
    const penaltyAmount = calculateFailurePenalty(contract);
    const moneyAfterFail = state.player.money - penaltyAmount;
    const merged = mergeSimulationIntoStore(state, newSimState, moneyAfterFail);
    const routeLabel = `${getCityName(delivery.originCityId)} → ${getCityName(delivery.destinationCityId)}`;

    set({
      ...merged,
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'penalty',
        amount: penaltyAmount,
        description: `Başarısız teslimat cezası · ${routeLabel}`,
      }),
      deliverySettlementDebug: {
        phase: 'fail',
        cashBefore: state.player.money,
        cashAfter: moneyAfterFail,
        fuelCost: delivery.fuelCost ?? 0,
        contractPayment: contract?.payment ?? 0,
        maintenanceCost: 0,
        penaltyCost: penaltyAmount,
        reportedNetProfit: -(delivery.fuelCost ?? 0) - penaltyAmount,
        cashDeltaOnCompletion: -penaltyAmount,
      },
      player: {
        ...state.player,
        trucks: merged.player!.trucks,
        drivers: merged.player!.drivers,
        warehouses: merged.player!.warehouses,
        money: moneyAfterFail,
        reputation: Math.max(0, state.player.reputation - REPUTATION_LOSS),
        failedDeliveries: (state.player.failedDeliveries ?? 0) + 1,
        lateDeliveries:
          reason === 'too_late'
            ? (state.player.lateDeliveries ?? 0) + 1
            : (state.player.lateDeliveries ?? 0),
      },
      marketNews: [
        {
          id: createNewsId(state.currentTime, `del_fail_${deliveryId}`),
          time: state.currentTime,
          type: 'warning' as const,
          title: 'Teslimat başarısız',
          message: `Teslimat iptal edildi (${reason}). Ceza: $${penaltyAmount.toFixed(0)}`,
          importance: 'high' as const,
        },
        ...state.marketNews,
      ].slice(0, MARKET_NEWS_MAX_COUNT),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'delivery',
          title: 'Teslimat başarısız',
          message: `${getCityName(delivery.originCityId)} → ${getCityName(delivery.destinationCityId)} (${formatFailureReason(reason)}). Ceza: $${penaltyAmount.toFixed(0)}`,
          importance: 'high',
        },
        state.currentTime,
      ),
    });
    get().autoSave('delivery_failed');
  },

  buyTruck: (catalogId: string): TradeActionResult => {
    const state = get();
    const template = findTruckMarketItem(catalogId);
    if (!template) {
      return {
        success: false,
        message: 'Kamyon bulunamadı.',
      };
    }

    const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);
    const requiredLevel = resolveTruckMarketRequiredLevel(template);
    if (playerLevel < requiredLevel) {
      return {
        success: false,
        message: `Bu kamyon için şirket seviyen Level ${requiredLevel} olmalı.`,
      };
    }

    if (state.player.money < template.purchasePrice) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_FUNDS',
        message: `Kamyon satın almak için ${formatNotificationMoney(template.purchasePrice)} gerekli.`,
      };
    }

    const instanceId = `${catalogId}-${Date.now()}`;
    const newTruck: Truck = {
      id: instanceId,
      catalogId,
      name: template.name,
      capacity: template.capacity,
      fuelConsumptionPerKm: template.fuelConsumptionPerKm,
      speed: template.speed,
      reliability: template.reliability,
      maintenanceCost: template.maintenanceCost,
      comfort: template.comfort,
      condition: template.condition,
      purchasePrice: template.purchasePrice,
      ownershipType: 'owned',
      currentCityId: state.player.homeCityId ?? 'izmir',
      homeCityId: state.player.homeCityId ?? 'izmir',
      status: 'idle',
    };

    set({
      player: {
        ...state.player,
        money: state.player.money - template.purchasePrice,
        trucks: [...state.player.trucks, newTruck],
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'truck_purchase',
        amount: template.purchasePrice,
        description: `${template.name} satın alındı`,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'fleet',
          title: 'Kamyon satın alındı',
          message: `${template.name} filoya eklendi.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });
    get().addCompanyXp(levelBalance.xpRewards.truckPurchase, 'truck_purchase');
    get().autoSave('purchase');
    return {
      success: true,
      message: `${template.name} satın alındı.`,
    };
  },

  leaseTruck: (catalogId: string): TradeActionResult => {
    if (leaseTruckInFlight) {
      return {
        success: false,
        message: 'Kiralama işlemi devam ediyor.',
      };
    }

    leaseTruckInFlight = true;
    try {
      const state = get();
      const template = findTruckMarketItem(catalogId);
      if (!template) {
        return {
          success: false,
          message: 'Kamyon bulunamadı.',
        };
      }

      const weeklyLeaseCost = template.weeklyLeaseCost;
      if (!weeklyLeaseCost || weeklyLeaseCost <= 0) {
        return {
          success: false,
          message: 'Bu kamyon için kiralama seçeneği yok.',
        };
      }

      const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);
      const requiredLevel = resolveTruckMarketRequiredLevel(template);
      if (playerLevel < requiredLevel) {
        return {
          success: false,
          message: `Bu kamyon için şirket seviyen Level ${requiredLevel} olmalı.`,
        };
      }

      if (state.player.money < weeklyLeaseCost) {
        return {
          success: false,
          errorCode: 'INSUFFICIENT_FUNDS',
          message: `Haftalık kira için ${formatNotificationMoney(weeklyLeaseCost)} gerekli.`,
        };
      }

      const instanceId = `${catalogId}-lease-${Date.now()}`;
      const leaseExpiresAt = state.currentTime + operatingCostBalance.leaseDurationHours;
      const newTruck: Truck = {
        id: instanceId,
        catalogId,
        name: `${template.name} (Kiralık)`,
        capacity: template.capacity,
        fuelConsumptionPerKm: template.fuelConsumptionPerKm,
        speed: template.speed,
        reliability: template.reliability,
        maintenanceCost: template.maintenanceCost,
        comfort: template.comfort,
        condition: template.condition,
        purchasePrice: template.purchasePrice,
        ownershipType: 'leased',
        leasePeriod: 'weekly',
        leaseWeeklyCost: weeklyLeaseCost,
        leaseDailyCost: Math.round(weeklyLeaseCost / timeBalance.daysPerWeek),
        leaseStartedAt: state.currentTime,
        leaseExpiresAt,
        leaseExpired: false,
        currentCityId: state.player.homeCityId ?? 'izmir',
        homeCityId: state.player.homeCityId ?? 'izmir',
        status: 'idle',
      };

      set({
        player: {
          ...state.player,
          money: state.player.money - weeklyLeaseCost,
          trucks: [...state.player.trucks, newTruck],
        },
        ...patchFinanceLedger(state, {
          time: state.currentTime,
          type: 'expense',
          category: 'truck_lease',
          amount: weeklyLeaseCost,
          description: `${template.name} · 7 günlük kira (peşin)`,
        }),
        eventLog: prependGameEvent(
          state.eventLog,
          {
            time: state.currentTime,
            type: 'fleet',
            title: 'Kamyon kiralandı',
            message: `${template.name} 7 gün için kiralandı. Haftalık kira peşin tahsil edildi.`,
            importance: 'medium',
          },
          state.currentTime,
        ),
      });
      get().autoSave('purchase');
      return {
        success: true,
        message: `${template.name} 7 gün kiralandı.`,
      };
    } finally {
      leaseTruckInFlight = false;
    }
  },

  hireDriver: (poolId: string): TradeActionResult => {
    const state = get();
    const template = findDriverPoolItem(poolId);
    if (!template) {
      return {
        success: false,
        message: 'Şoför bulunamadı.',
      };
    }

    if (template.comingSoon) {
      return {
        success: false,
        message: 'Uluslararası şoförler yakında eklenecek.',
      };
    }

    if (isDriverPoolItemHired(state.player.drivers, poolId)) {
      return {
        success: false,
        message: 'Bu şoför zaten işe alınmış.',
      };
    }

    const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);
    const requiredLevel = resolveDriverRequiredLevel(template);
    if (playerLevel < requiredLevel) {
      return {
        success: false,
        message: `Bu şoför için şirket seviyen Level ${requiredLevel} olmalı.`,
      };
    }

    const hireCost = template.hiringFee;
    if (state.player.money < hireCost) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_FUNDS',
        message: `Şoför işe almak için ${formatNotificationMoney(hireCost)} gerekli.`,
      };
    }

    const { hiringFee, comingSoon: _comingSoon, ...driverFields } = template;
    const dailySalary = driverFields.salaryPerDay ?? operatingCostBalance.fallbackDriverDailySalary;
    const newDriver: Driver = {
      ...driverFields,
      id: poolId,
      poolId,
      dailySalary,
      salaryPerDay: dailySalary,
      salaryPeriod: 'daily',
      hireCost,
      assignedTruckId: null,
      status: 'idle',
    };

    set({
      player: {
        ...state.player,
        money: state.player.money - hireCost,
        drivers: [...state.player.drivers, newDriver],
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'driver_hire',
        amount: hireCost,
        description: `${template.name} işe alım`,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'fleet',
          title: 'Şoför işe alındı',
          message: `${template.name} (${getDriverTierLabel(template.tier)}) filoya katıldı.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });
    get().addCompanyXp(levelBalance.xpRewards.driverHire, 'driver_hire');
    get().autoSave('purchase');
    return {
      success: true,
      message: `${template.name} işe alındı.`,
    };
  },

  repairTruck: (truckId: string) => {
    const state = get();
    const truck = state.player.trucks.find((t) => t.id === truckId);
    if (!truck) {
      throw new Error('Kamyon bulunamadı.');
    }

    if (truck.status === 'on_route') {
      throw new Error('Yoldaki kamyon tamir edilemez.');
    }

    if (truck.status === 'transferring') {
      throw new Error('Yönlendirilen kamyon tamir edilemez.');
    }

    const condition = truck.condition ?? 100;
    if (condition >= 100) {
      return;
    }

    const repairCost = calculateTruckRepairCost(truck);
    if (repairCost <= 0) {
      return;
    }

    if (state.player.money < repairCost) {
      throw new Error('Yetersiz bakiye.');
    }

    set({
      player: {
        ...state.player,
        money: state.player.money - repairCost,
        trucks: state.player.trucks.map((t) =>
          t.id === truckId ? { ...t, condition: 100 } : t,
        ),
      },
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'fleet',
          title: 'Kamyon bakımı',
          message: `${truck.name} tamir edildi. Maliyet: $${repairCost.toFixed(0)}`,
          importance: 'low',
        },
        state.currentTime,
      ),
    });
    get().autoSave('repair');
  },

  openWarehouse: (cityId: string, warehouseType: WarehouseType = 'standard'): TradeActionResult => {
    const state = get();
    const city = state.cities.find((candidate) => candidate.id === cityId);
    if (!city) {
      return {
        success: false,
        errorCode: 'CITY_NOT_FOUND',
        message: 'Şehir bulunamadı.',
      };
    }

    const resolvedType = resolveWarehouseType(warehouseType);
    if (resolvedType !== 'standard' && resolvedType !== 'cold') {
      return {
        success: false,
        message: 'Bu depo tipi henüz kullanılamıyor.',
      };
    }

    if (
      state.player.warehouses.some(
        (warehouse) =>
          warehouse.cityId === cityId && resolveWarehouseType(warehouse.warehouseType) === resolvedType,
      )
    ) {
      return {
        success: false,
        message: `Bu şehirde zaten ${getWarehouseTypeLabel(resolvedType).toLowerCase()} var.`,
      };
    }

    const warehouses = state.player.warehouses ?? [];
    const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);

    if (!isWarehouseCityUnlocked(cityId, playerLevel)) {
      const requiredCityLevel = levelConfig.warehouseUnlocks.extendedCityUnlockLevel;
      return {
        success: false,
        message: `Bu şehirde depo açmak için Level ${requiredCityLevel} gerekli.`,
      };
    }

    if (!canOpenMoreWarehouses(playerLevel, warehouses.length)) {
      const nextLevel = getNextLevelForMoreWarehouses(warehouses.length);
      return {
        success: false,
        message: `Yeni depo açmak için Level ${nextLevel} gerekiyor.`,
      };
    }

    const costModifier = city.warehouseCostModifier ?? 1;
    const typeCostMultiplier =
      resolvedType === 'cold' ? warehouseBalance.coldOpenCostMultiplier : 1;
    const openCost = Math.round(warehouseBalance.baseOpenCost * costModifier * typeCostMultiplier);
    const typeLabel = getWarehouseTypeLabel(resolvedType);

    if (state.player.money < openCost) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_FUNDS',
        message: `${typeLabel} açmak için ${formatNotificationMoney(openCost)} gerekli.`,
      };
    }

    const warehouseBase = {
      cityId,
      capacityTons: tradingBalance.defaultWarehouseCapacityTons,
      capacityTon: tradingBalance.defaultWarehouseCapacityTons,
      upgradeTier: 1,
      warehouseType: resolvedType,
      qualityProtection: resolvedType === 'cold' ? 1 : 0.5,
      inventory: [] as Warehouse['inventory'],
      usedCapacityTon: 0,
    };

    const warehouse: Warehouse = {
      id: `warehouse-${cityId}-${resolvedType}-${Date.now()}`,
      ...warehouseBase,
      dailyOperatingCost: calculateWarehouseDailyOperatingCostBreakdown(
        { id: 'preview', ...warehouseBase },
        city,
      ).total,
      openCost,
    };

    set({
      player: {
        ...state.player,
        money: state.player.money - openCost,
        warehouses: [...state.player.warehouses, warehouse],
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'warehouse_open',
        amount: openCost,
        description: `${city.name} · ${typeLabel}`,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'warehouse',
          title: 'Depo açıldı',
          message: `${city.name} şehrinde ${typeLabel.toLowerCase()} açıldı. Maliyet: ${formatNotificationMoney(openCost)}`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    get().addCompanyXp(levelBalance.xpRewards.warehouseOpen, 'warehouse_open');
    get().markSaveDirty();
    get().autoSave('warehouse');
    return {
      success: true,
      message: `${city.name} · ${typeLabel} açıldı.`,
    };
  },

  upgradeWarehouse: (warehouseId: string): TradeActionResult => {
    const state = get();
    const warehouse = state.player.warehouses.find((candidate) => candidate.id === warehouseId);
    if (!warehouse) {
      return {
        success: false,
        errorCode: 'WAREHOUSE_NOT_FOUND',
        message: 'Depo bulunamadı.',
      };
    }

    const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);
    const currentTier = warehouse.upgradeTier ?? 1;
    const requiredLevel = getWarehouseUpgradeRequiredLevel(currentTier);

    if (requiredLevel == null) {
      return {
        success: false,
        message: 'Depo maksimum kapasitede.',
      };
    }

    if (playerLevel < requiredLevel) {
      return {
        success: false,
        message: `Bu yükseltme için Level ${requiredLevel} gerekli.`,
      };
    }

    const capacityIncrease = getWarehouseUpgradeCapacityGain(currentTier);
    if (capacityIncrease <= 0) {
      return {
        success: false,
        message: 'Depo maksimum kapasitede.',
      };
    }

    const city = state.cities.find((candidate) => candidate.id === warehouse.cityId);
    const costModifier = city?.warehouseCostModifier ?? 1;
    const upgradeCost = estimateWarehouseUpgradeCost(city, warehouse.cityId);

    if (state.player.money < upgradeCost) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_FUNDS',
        message: `Depo yükseltmek için ${formatNotificationMoney(upgradeCost)} gerekli.`,
      };
    }

    const cityName = city?.name ?? warehouse.cityId;
    const nextTier = currentTier + 1;
    const upgradeLabel = nextTier === 2 ? 'Orta depo' : 'Büyük depo';
    const updatedWarehouses = state.player.warehouses.map((candidate) => {
      if (candidate.id !== warehouse.id) {
        return candidate;
      }
      return {
        ...candidate,
        capacityTons: candidate.capacityTons + capacityIncrease,
        upgradeTier: nextTier,
      };
    });

    set({
      player: {
        ...state.player,
        money: state.player.money - upgradeCost,
        warehouses: updatedWarehouses,
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'warehouse_open',
        amount: upgradeCost,
        description: `${cityName} deposu yükseltildi`,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'warehouse',
          title: 'Depo yükseltildi',
          message: `${cityName} deposu ${upgradeLabel} seviyesine yükseltildi (+${capacityIncrease} ton).`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    get().addCompanyXp(levelBalance.xpRewards.warehouseUpgrade, 'warehouse_upgrade');
    get().markSaveDirty();
    get().autoSave('warehouse');
    return {
      success: true,
      message: `${cityName} deposu yükseltildi (+${capacityIncrease} ton, ${upgradeLabel}).`,
    };
  },

  buyProductForWarehouse: ({
    cityId,
    productId,
    quantity,
    warehouseId,
  }): TradeActionResult => {
    const state = get();

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return {
        success: false,
        errorCode: 'INVALID_QUANTITY',
        message: 'Geçerli bir miktar seçmelisin.',
      };
    }

    if (quantity < tradingBalance.minTradeQuantity) {
      return {
        success: false,
        errorCode: 'INVALID_QUANTITY',
        message: `Minimum alım miktarı ${tradingBalance.minTradeQuantity} ton.`,
      };
    }

    const city = state.cities.find((candidate) => candidate.id === cityId);
    if (!city) {
      return {
        success: false,
        errorCode: 'CITY_NOT_FOUND',
        message: 'Şehir bulunamadı.',
      };
    }

    if (!warehouseId) {
      return {
        success: false,
        errorCode: 'WAREHOUSE_NOT_FOUND',
        message: 'Satın alma için bir depo seçmelisin.',
      };
    }

    const warehouse = state.player.warehouses.find((candidate) => candidate.id === warehouseId);

    if (!warehouse || warehouse.cityId !== cityId) {
      return {
        success: false,
        errorCode: 'WAREHOUSE_NOT_FOUND',
        message: 'Seçilen depo bu şehirde bulunamadı.',
      };
    }

    const product = getProductByIdSafe(productId);
    if (!product) {
      return {
        success: false,
        errorCode: 'PRODUCT_NOT_FOUND',
        message: 'Ürün bulunamadı.',
      };
    }

    const warehouseType = resolveWarehouseType(warehouse.warehouseType);
    const storageSuitability = evaluateStorageSuitability(product, warehouseType);
    if (storageSuitability === 'blocked') {
      return {
        success: false,
        errorCode: 'INCOMPATIBLE_WAREHOUSE',
        message: 'Bu ürün bu depo tipinde saklanamaz.',
      };
    }

    const unitPrice = getCityProductMarketPrice(city, productId);
    const cityStock = getCityProductStock(city, productId);
    const normalizedWarehouse = normalizeWarehouse(warehouse, state.currentTime);
    const freeCapacity = getWarehouseFreeCapacityTon(normalizedWarehouse);

    if (quantity > cityStock) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_STOCK',
        message: `Şehir stoğu yetersiz. Mevcut: ${cityStock.toFixed(1)} ton.`,
      };
    }

    if (quantity > freeCapacity) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_CAPACITY',
        message: `Depo kapasitesi yetersiz. Boş alan: ${freeCapacity.toFixed(1)} ton.`,
      };
    }

    const totalCost = calculateTradeBuyCost(unitPrice, quantity);
    if (state.player.money < totalCost) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_FUNDS',
        message: `Yetersiz nakit. Gerekli: ${formatNotificationMoney(totalCost)}`,
      };
    }

    const storageWarning = buildStorageWarningForPurchase(product, warehouseType);
    const nextInventory = mergeInventoryOnBuy(
      normalizedWarehouse.inventory ?? [],
      productId,
      quantity,
      unitPrice,
      normalizedWarehouse,
      state.currentTime,
      storageWarning,
    );
    const usedCapacityTon = nextInventory.reduce((sum, item) => sum + item.quantity, 0);
    const productName = getProductDisplayName(productId);
    const cityName = city.name;

    const updatedWarehouses = state.player.warehouses.map((candidate) => {
      if (candidate.id !== warehouse.id) {
        return candidate;
      }
      return normalizeWarehouse({
        ...candidate,
        inventory: nextInventory,
        usedCapacityTon,
      });
    });

    set({
      player: {
        ...state.player,
        money: state.player.money - totalCost,
        warehouses: updatedWarehouses,
      },
      cities: updateCityProductStock(state.cities, cityId, productId, -quantity),
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'trade_purchase',
        amount: totalCost,
        description: `${cityName} · ${quantity.toFixed(1)} ton ${productName}`,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'warehouse',
          title: 'Ürün satın alındı',
          message: `${cityName} deposuna ${quantity.toFixed(1)} ton ${productName} alındı.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    try {
      get().addNotification({
        time: state.currentTime,
        type: 'info',
        title: 'Ürün satın alındı',
        message: `${productName} · ${quantity.toFixed(1)} ton · ${formatNotificationMoney(totalCost)}`,
        autoDismissMs: 2500,
      });
    } catch (error) {
      console.warn('[gameStore] trade buy notification failed:', error);
    }

    get().markSaveDirty();
    get().autoSave('warehouse');
    const latest = get();
    const missions = latest.missions ?? createDefaultMissionsState();
    set({
      missions: syncMissionsState(
        {
          ...missions,
          flags: { ...missions.flags, tradePurchased: true },
          activeMissionIds: missions.activeMissionIds.includes('first_trade')
            ? missions.activeMissionIds
            : [...missions.activeMissionIds, 'first_trade'],
        },
        latest,
      ),
    });
    return {
      success: true,
      message: `${quantity.toFixed(1)} ton ${productName} depoya eklendi.`,
    };
  },

  sellProductFromWarehouse: ({
    warehouseId,
    productId,
    quantity,
  }): TradeActionResult => {
    const state = get();

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return {
        success: false,
        errorCode: 'INVALID_QUANTITY',
        message: 'Geçerli bir miktar seçmelisin.',
      };
    }

    const warehouse = state.player.warehouses.find((candidate) => candidate.id === warehouseId);
    if (!warehouse) {
      return {
        success: false,
        errorCode: 'WAREHOUSE_NOT_FOUND',
        message: 'Depo bulunamadı.',
      };
    }

    const city = state.cities.find((candidate) => candidate.id === warehouse.cityId);
    if (!city) {
      return {
        success: false,
        errorCode: 'CITY_NOT_FOUND',
        message: 'Depo şehri bulunamadı.',
      };
    }

    const normalizedWarehouse = normalizeWarehouse(warehouse);
    const inventoryItem = getWarehouseInventoryItem(normalizedWarehouse, productId);
    const availableQuantity = inventoryItem?.quantity ?? 0;

    if (!inventoryItem || availableQuantity <= 0) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_INVENTORY',
        message: 'Depoda satılacak ürün yok.',
      };
    }

    if (quantity > availableQuantity) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_INVENTORY',
        message: `Depoda yalnızca ${availableQuantity.toFixed(1)} ton var.`,
      };
    }

    const unitPrice = getCityProductMarketPrice(city, productId);
    const averageBuyPrice = inventoryItem.averageBuyPrice ?? unitPrice;
    const itemQuality = inventoryItem.quality ?? 100;
    const revenue = calculateTradeSellRevenue(unitPrice, quantity, itemQuality);
    const profit = calculateTradeProfit(unitPrice, averageBuyPrice, quantity, itemQuality);
    const xpGain = calculateTradeSaleXp(profit);
    const productName = getProductDisplayName(productId);
    const cityName = city.name;

    const nextInventory = reduceInventoryOnSell(
      normalizedWarehouse.inventory ?? [],
      productId,
      quantity,
    );
    const usedCapacityTon = nextInventory.reduce((sum, item) => sum + item.quantity, 0);

    const updatedWarehouses = state.player.warehouses.map((candidate) => {
      if (candidate.id !== warehouse.id) {
        return candidate;
      }
      return normalizeWarehouse({
        ...candidate,
        inventory: nextInventory,
        usedCapacityTon,
      });
    });

    set({
      player: {
        ...state.player,
        money: state.player.money + revenue,
        warehouses: updatedWarehouses,
      },
      cities: updateCityProductStock(state.cities, warehouse.cityId, productId, quantity),
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'income',
        category: 'trade_sale',
        amount: revenue,
        description: `${productName} · Kâr: ${formatNotificationMoney(profit)}`,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'warehouse',
          title: 'Ürün satıldı',
          message: `${quantity.toFixed(1)} ton ${productName} satıldı. Kâr: ${formatNotificationMoney(profit)}`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    try {
      get().addNotification({
        time: state.currentTime,
        type: 'success',
        title: 'Ürün satıldı',
        message:
          profit > 0
            ? `Kâr: ${formatNotificationMoney(profit)} · +${xpGain} XP`
            : `Satış tamamlandı · +${xpGain} XP`,
        actionLabel: 'Finansı Gör',
        actionTarget: 'finance',
        autoDismissMs: 3000,
      });
    } catch (error) {
      console.warn('[gameStore] trade sell notification failed:', error);
    }

    get().addCompanyXp(xpGain, 'trade_sale');

    get().markSaveDirty();
    get().autoSave('warehouse');
    return {
      success: true,
      message: `${quantity.toFixed(1)} ton ${productName} satıldı.`,
    };
  },

  refuelOrUpdateFuelPrice: () => {
    const state = get();
    const change = randomBetween(
      -economyBalance.maxDailyFuelChange * 0.75,
      economyBalance.maxDailyFuelChange,
    );
    set({
      globalEconomy: {
        ...state.globalEconomy,
        fuelPrice: Number(Math.max(0.8, state.globalEconomy.fuelPrice * (1 + change)).toFixed(2)),
      },
    });
  },

  // TODO: Hide debug cash tools in production builds.
  debugAddCash: (amount: number) => {
    if (!Number.isFinite(amount)) {
      return;
    }
    const safeAmount = Math.abs(amount);
    if (safeAmount <= 0) {
      return;
    }

    const state = get();
    if (!state.player) {
      return;
    }

    const currentMoney = state.player.money ?? 0;
    set({
      player: {
        ...state.player,
        money: currentMoney + safeAmount,
      },
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'system',
          title: 'Debug nakit eklendi',
          message: `${formatNotificationMoney(safeAmount)} test parası eklendi.`,
          importance: 'low',
        },
        state.currentTime,
      ),
    });
    get().markSaveDirty();
    get().autoSave('debug_cash_change');
  },

  debugRemoveCash: (amount: number) => {
    if (!Number.isFinite(amount)) {
      return;
    }
    const safeAmount = Math.abs(amount);
    if (safeAmount <= 0) {
      return;
    }

    const state = get();
    if (!state.player) {
      return;
    }

    const currentMoney = state.player.money ?? 0;
    const newMoney = Math.max(0, currentMoney - safeAmount);
    const removedAmount = currentMoney - newMoney;

    set({
      player: {
        ...state.player,
        money: newMoney,
      },
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'system',
          title: 'Debug nakit azaltıldı',
          message: `${formatNotificationMoney(removedAmount)} test parası düşüldü.`,
          importance: 'low',
        },
        state.currentTime,
      ),
    });
    get().markSaveDirty();
    get().autoSave('debug_cash_change');
  },

  debugSetCash: (amount: number) => {
    if (!Number.isFinite(amount)) {
      return;
    }

    const safeAmount = Math.max(0, amount);
    const state = get();
    if (!state.player) {
      return;
    }

    const title =
      safeAmount === 0 ? 'Debug nakit sıfırlandı' : 'Debug nakit ayarlandı';
    const message =
      safeAmount === 0
        ? 'Nakit test amaçlı sıfırlandı.'
        : `Nakit ${formatNotificationMoney(safeAmount)} olarak ayarlandı.`;

    set({
      player: {
        ...state.player,
        money: safeAmount,
      },
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'system',
          title,
          message,
          importance: 'low',
        },
        state.currentTime,
      ),
    });
    get().markSaveDirty();
    get().autoSave('debug_cash_change');
  },

  debugAdvanceOneDay: () => {
    get().advanceTime(timeBalance.hoursPerDay);
  },

  debugAdvanceOfflineDays: (days = 10) => {
    get().advanceTime(Math.max(1, Math.floor(days)) * timeBalance.hoursPerDay);
  },

  debugProcessDailyCosts: () => {
    get().processDailyOperatingCosts({ days: 1, reason: 'debug' });
  },

  debugExpireLeaseTruck: () => {
    const state = get();
    const leasedTruck = state.player.trucks.find(
      (truck) =>
        (truck.ownershipType ?? 'owned') === 'leased' &&
        !truck.leaseExpired &&
        truck.status === 'idle',
    );
    if (!leasedTruck) {
      return;
    }

    set({
      player: {
        ...state.player,
        trucks: state.player.trucks.map((truck) =>
          truck.id === leasedTruck.id
            ? { ...truck, leaseExpiresAt: state.currentTime - 1 }
            : truck,
        ),
      },
    });
    get().processExpiredLeases();
  },

  debugGetEconomyBalanceSummary: () => {
    const state = get();
    const breakdown = calculateDailyOperatingCostBreakdown(state.player);
    const msPerHour = getMsPerGameHour(state.gameSpeed);
    const leasedCount = state.player.trucks.filter(
      (t) => (t.ownershipType ?? 'owned') === 'leased' && !t.leaseExpired,
    ).length;
    return [
      `Zaman: ${msPerHour}ms/saat (speed ${state.gameSpeed}x)`,
      `Günlük sabit gider: $${breakdown.total}`,
      `  Şoför: $${breakdown.driverSalaries}`,
      `  Depo: $${breakdown.warehouseOperating}`,
      `  Operasyon: $${breakdown.operations}`,
      `Aktif kiralık kamyon: ${leasedCount}`,
      `Nakit: $${state.player.money}`,
    ].join('\n');
  },

  addMarketNews: (news) => {
    const state = get();
    const entry: MarketNews = {
      ...news,
      id: news.id ?? createNewsId(state.currentTime, `custom_${Date.now()}`),
    };
    set({
      marketNews: [entry, ...state.marketNews].slice(0, MARKET_NEWS_MAX_COUNT),
    });
  },

  clearOldMarketNews: () => {
    const state = get();
    const cutoff = state.currentTime - MARKET_NEWS_MAX_AGE_HOURS;
    set({
      marketNews: state.marketNews.filter((news) => news.time >= cutoff),
    });
  },

  addGameEvent: (event) => {
    const state = get();
    set({
      eventLog: prependGameEvent(state.eventLog, event, state.currentTime),
    });
  },

  clearOldGameEvents: () => {
    const state = get();
    const cutoff = state.currentTime - EVENT_LOG_MAX_AGE_HOURS;
    set({
      eventLog: state.eventLog.filter((event) => event.time >= cutoff),
    });
  },
}));

// ---------------------------------------------------------------------------
// Örnek kullanım (yorum — çalıştırılmaz)
// ---------------------------------------------------------------------------

/*
import { useGameStore } from './gameStore';

// Expo / React Native bileşeninde:
function GameScreen() {
  const {
    player,
    contracts,
    activeDeliveries,
    initializeGame,
    advanceTime,
    startDelivery,
  } = useGameStore();

  // Oyunu başlat
  initializeGame();

  // Zamanı ilerlet (4 saat)
  advanceTime(4);

  // Sözleşme kabul et
  const available = contracts.find((c) => c.status === 'available');
  if (available) {
    startDelivery(available.id, player.trucks[0].id, player.drivers[0].id);
  }
}
*/
