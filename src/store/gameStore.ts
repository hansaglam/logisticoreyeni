/**
 * LogistiCore - Merkezi oyun state yönetimi (Zustand)
 *
 * Ekonomi, sözleşme ve teslimat simülasyon modüllerini birleştirir.
 * React Native / Expo bileşenleri useGameStore hook'u ile state'e erişir.
 *
 * Kurulum: npm install zustand
 */

import { create } from 'zustand';
import type { ShopCategory } from '../navigation/tabTypes';
import { VEHICLE_MARKETPLACE_ENABLED } from '../config/backendRoadmap';
import type {
  City,
  Contract,
  Delivery,
  DeliveryFailureReason,
  DeliveryIncidentType,
  Driver,
  GameEvent,
  GlobalEconomy,
  GameNotification,
  GameNotificationActionTarget,
  FinanceLedgerEntry,
  MarketContractFilter,
  MarketFocusRequest,
  MarketAlertActionResult,
  MarketNews,
  MarketOpportunity,
  MarketPriceAlert,
  MarketPriceAlertCondition,
  ProductId,
  SimulationGameState,
  SpotlightTutorialId,
  StartDeliveryResult,
  StartTruckTransferResult,
  StoreGameState,
  TradeActionResult,
  Trailer,
  Truck,
  TruckTransfer,
  TutorialStepId,
  OnboardingScreenId,
  OnboardingStepId,
  Warehouse,
  WarehouseStockTransfer,
  WarehouseType,
} from '../types/game';
import type { AdRewardGrantContext, AdRewardSlotId } from '../types/monetization';
import type { AuthoritativeMarketplaceReconciliation } from '../domain/vehicleMarketplaceReconciliation';
import { reconcileFleetWithVehicleMarketplace } from '../domain/vehicleMarketplaceReconciliation';
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
  createTrailerFromTemplate,
  findTrailerMarketItem,
  TRAILER_MARKET,
} from '../data/trailers';
import {
  createDefaultGlobalEconomy,
  getSafeFuelPrice,
  normalizeGlobalEconomy,
  sanitizeFuelPricePerLiter,
  updateAllCitiesEconomy,
} from '../simulation/economy';
import { randomBetween, randomIntBetween } from '../utils/math';
import { missionsProgressUnchanged, retentionProgressUnchanged } from '../utils/syncStateGuards';
import {
  expireOldContracts,
  generateContracts,
  getRouteBetweenCities,
  mergeContractLists,
  balanceAvailableContractLevelMix,
  refreshContractsFromMarket,
  replenishAvailableContracts,
  processContractGenerationSchedule,
  buildPlayerFleetCityContext,
  countPlayableContracts,
  ensurePlayableContractSupply,
  ensurePlayableContractsAfterDelivery,
  type ContractGenerationDebugSnapshot,
} from '../simulation/contracts';
import { ensureStarterContracts } from '../simulation/starterContracts';
import {
  assertDebugAnkaraAdanaContract,
  createDebugContractBatchId,
  finalizeDebugContractTraces,
  generateDebugContractsFromCurrentCity,
  installDebugContractsInspector,
  reportUncalibratedExtendedSegments,
  resolveDebugOriginCityId,
  type DebugContractGenerationResult,
} from '../simulation/debugContractGeneration';
import {
  catalogNeedsCanonicalMerge,
  mergeCanonicalCities,
  mergeCanonicalRoutes,
} from '../data/mergeCanonicalCatalog';
import {
  availabilityReasonToStartDeliveryErrorCode,
  calculateDeliverySettlement,
  calculateFailurePenalty,
  calculateLatePenalty,
  calculateTruckRepairCost,
  canTruckCarryContract,
  applyFleetArrivalForDelivery,
  ensureFleetAtDeliveryDestination,
  buildDeliveryStartCapacitySnapshot,
  createDelivery,
  formatDeliveryCapacityFailureMessage,
  getContractAvailability,
  getContractCargoWeight,
  getHighestOwnedTruckCapacity,
  getMaxIdleTruckCapacity,
  isDeliveryProgressComplete,
  isDeliveryFuelProgressComplete,
  logDeliveryCompletionLocation,
  logDeliveryStartCapacity,
  safeCompleteDelivery,
  DeliveryError,
  failDelivery as failDeliverySim,
  formatCapacityExceededMessage,
  getIdleTruckOriginCityIds,
  getActiveDeliveryDestinationCityIds,
  getBusyTruckOriginCityIds,
  getIdleTrucks,
  isContractOfferExpired,
  isTruckAvailableForAssignment,
  normalizeTruckCity,
  resolveDeliveryDestinationCityId,
  resolveTruckCityId,
  selectIdleTruckForContract,
  updateDeliveryProgressWithFuel,
  type DeliverySettlementDebugSnapshot,
  type DeliverySettlementResult,
} from '../simulation/delivery';
import {
  getMaxPotentialFleetCapacityTons,
  getTruckEffectiveCapacityTons,
} from '../simulation/capacity';
import {
  attachTrailerToTruckState,
  detachTrailerFromTruckState,
  detachTrailersFromTruckState,
  normalizePlayerTrailers,
  syncAllTrailersWithFleet,
  syncTrailersWithTruckLocation,
  validateTrailerPurchase,
} from '../simulation/trailerOps';
import { getEffectiveTruckCapacityTons } from '../simulation/cargoCapacity';
import {
  getLatestDeliveryIncident,
  isDeliveryIncidentCooldownActive,
  maybeRollDeliveryIncident,
  createDebugDeliveryIncident,
  resolveDeliveryIncident as resolveDeliveryIncidentSim,
} from '../simulation/deliveryIncidents';
import {
  buildOfflineProgressSummary,
  buildTimeProgressionAudit,
  applyOfflineProgress,
  createOfflineProgressSnapshot,
  OFFLINE_PROGRESS_VERSION,
  realMsToGameHours,
  shouldShowOfflineSummary,
  type OfflineProgressSummary,
} from '../simulation/offlineProgression';
import { loadOfflineMeta, saveOfflineMeta } from '../storage/offlineMeta';
import {
  createTruckTransfer,
  resolveTransferRoute,
  selectDriverForTransfer,
  updateTransferProgressWithFuel,
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
  validateTradeQuantity,
} from '../simulation/trading';
import {
  buildStorageWarningForPurchase,
  getWarehouseTypeLabel,
  processWarehouseQualityDegradation,
  resolveWarehouseType,
} from '../simulation/warehouseStorage';
import {
  formatWarehouseLimitReachedMessage,
  resolveStorageBlockResult,
  tradeFail,
  tradeOk,
} from '../simulation/warehouseActions';
import {
  appendCompletedWarehouseStockTransfer,
  applyDestinationCompletion,
  applySourceReservationOnStart,
  createWarehouseStockTransfer,
  getWarehouseStockTransferReasonMessage,
  markWarehouseStockTransferSettled,
  rollbackStockToSource,
  updateWarehouseStockTransferProgressWithFuel,
  validateWarehouseStockTransfer,
} from '../simulation/warehouseStockTransfer';
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
  getWarehouseUpgradePreview,
  resolveWarehouseDailyOperatingCost,
} from '../utils/warehouseCalculations';
import {
  applyCashTransaction,
  canAffordVoluntaryPurchase,
} from '../utils/cashPolicy';
import { formatDeliveryCompleteLocationToast } from '../utils/truckLocationUx';
import {
  finalizeTruckFuelAfterJob,
  getTruckFuelReadiness,
  normalizeTruckFuel,
  validateTruckRefuelRequest,
} from '../utils/truckFuel';
import type { TruckRefuelResult } from '../utils/truckFuel';
import { contractBalance, contractGenerationBalance, economyBalance, buildTimeScaleDebugSnapshot, getEffectiveOfflineGameSpeed, getMsPerGameHour, levelBalance, marketAlertBalance, operatingCostBalance, reputationBalance, timeBalance, tradingBalance, warehouseBalance } from '../config/balance';
import {
  applyAdRewardGrant,
  calculateDeliveryBoostProgress,
  calculateDiscountedRepairCost,
  canGrantAdReward,
  consumeMaintenanceDiscountToken,
  createDefaultMonetizationState,
  getActiveMaintenanceDiscountToken,
  normalizeMonetizationState,
  resetDailyUsageIfNeeded,
} from '../simulation/adRewardGrants';
import { showRewardedAd } from '../services/adProvider';
import {
  cancelMarketAlertNotification,
  getDefaultAlertExpiryTime,
  requestNotificationPermissions,
  scheduleMarketAlertNotification,
  sendLocalMarketAlertNotification,
} from '../services/notifications';
import {
  buildTriggeredAlertMessage,
  cleanExpiredMarketAlerts,
  countActiveMarketAlerts,
  createMarketAlertId,
  evaluateMarketAlertCondition,
  getCityProductMarketState,
  isDuplicateMarketAlert,
  normalizeMarketAlerts,
} from '../utils/marketAlerts';
import { createDefaultMissionsState } from '../config/missions';
import { getMilestoneById } from '../data/milestones';
import { getWeeklyObjectiveById } from '../data/weeklyObjectives';
import {
  applyRetentionEvent,
  claimMilestoneRewardState,
  claimWeeklyObjectiveRewardState,
  createDefaultRetentionState,
  getRetentionSummary,
  syncRetentionProgressState,
  type RetentionEvent,
} from '../simulation/retentionProgress';
import {
  shouldGrantHighReputationBonus,
  getContractTypePenaltyMultiplier,
  normalizeContractType,
} from '../simulation/contractTypes';
import {
  applyDriverXp,
  calculateDriverDeliveryXp,
  recordDriverDeliveryStats,
} from '../simulation/driverProgress';
import {
  applyTruckUpgrade,
  canUpgradeTruck,
  getTruckUpgradeCost,
  type TruckUpgradeType,
} from '../simulation/truckUpgrades';
import { HIGH_REPUTATION_SUCCESS_BONUS } from '../config/contractTypes';
import {
  applyWorldEventImpactToFuelPrice,
  applyWorldEventImpactToProductPrice,
  gameDayFromTime,
  getActiveWorldEvents,
  getSharedWorldTimeIndex,
  processWorldEventsForDayRange,
  forceCreateWorldEvent,
} from '../simulation/worldEvents';
import {
  ensureEmergencyContractsForSoftLock,
  evaluateSoftLockCashRecovery,
  evaluateRoadsideFuelAssistance,
} from '../simulation/softLockRecovery';
import { evaluateFuelWarning } from '../simulation/fuelWarnings';
import {
  resumeRoadsideJob,
  validateRoadsideFuelPurchase,
  type RoadsideFuelJob,
  type RoadsideFuelResult,
} from '../simulation/roadsideFuel';
import {
  DAY_MS,
  getEconomyClock,
  getEconomyNow,
  getSimulationRealNowMs,
  getMarketEpoch,
  HOUR_MS,
  MINUTE_MS,
} from '../simulation/economyClock';
import {
  buildPeriodicCostDeductions,
  logTimeProgressionAudit,
} from '../simulation/periodicCosts';
import {
  buildGlobalEconomySnapshot,
  getSnapshotFuelPrice,
  materializeSnapshotCities,
} from '../simulation/globalMarketSnapshot';
import { resolveGlobalMarketAvailability } from '../simulation/globalMarketAvailability';
import {
  isFuelPricePurchaseReady,
  resolveFuelPriceQuote,
} from '../simulation/fuelPriceQuote';
import { getGlobalEconomyRepository } from '../services/globalEconomyRepository';
import {
  canReadGlobalEconomy,
  categorizeGlobalEconomyClientError,
  validateGlobalEconomySnapshot,
  type GlobalEconomyLoadErrorCode,
} from '../services/globalEconomyClient';
import {
  loadGlobalEconomyCache,
  saveGlobalEconomyCache,
} from '../services/globalEconomyCache';
import type { WorldEventType } from '../types/game';
import { getWeeklySeasonKey } from '../utils/leaderboardSeason';
import { getMissionById } from '../config/missions';
import { createDefaultTutorialState } from '../config/tutorial';
import {
  buildOnboardingEvaluationState,
  createDefaultOnboardingState,
  dismissOnboardingGuide,
  dismissOnboardingHint,
  isOnboardingActive,
  markOnboardingAssignmentOpened,
  markOnboardingMissionRewardClaimed,
  markOnboardingScreenVisited as markOnboardingScreenVisitedState,
  resetOnboardingForDev as resetOnboardingStateForDev,
  syncOnboardingProgress,
} from '../onboarding/onboardingProgress';
import {
  clearSpotlightTutorialProgressState,
  createDefaultSpotlightTutorialState,
  markSpotlightTutorialCompletedState,
  markSpotlightTutorialSkippedState,
} from '../tutorial/spotlightTutorialState';
import {
  buildSummarizedDailyOperatingCostLedgerEntry,
  calculateDailyOperatingCostBreakdown,
  formatOperatingCostEventLogMessage,
  formatOperatingCostNotificationMessage,
  getSkippedOperatingDaysDueToCap,
  processExpiredTruckLeases,
  resolveOperatingCostElapsedDays,
  type DailyOperatingCostReason,
} from '../simulation/dailyOperatingCosts';
import {
  canFireDriver,
  canSellTruck,
  calculateDriverSeveranceCost,
} from '../simulation/fleetManagement';
import { getMaxContractTonnageForLevel } from '../config/levelConfig';
import {
  canOpenMoreWarehouses,
  getCityUnlockLevel,
  getMaxWarehousesForLevel,
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
import {
  mapAutoSaveReasonToCloudSync,
  syncLocalSaveToCloud,
} from '../storage/cloudSaveSync';
import { deleteAccountAndCloudData as runAccountDeletion } from '../utils/accountDeletion';

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
const REPUTATION_GAIN = reputationBalance.onTimeDeliveryGain;
const REPUTATION_LOSS = reputationBalance.failedDeliveryLoss;
const HIGH_PAYMENT_CONTRACT_THRESHOLD = 8_000;
const FUEL_PRICE_CHANGE_THRESHOLD = 0.05;
const MIN_TRUCK_CONDITION_FOR_DELIVERY = 30;
const INITIAL_GLOBAL_HISTORY_DAYS = 30;
const INITIAL_GLOBAL_HISTORY_LIMIT = 3_000;

type GlobalEconomyLoadAudit = {
  success: boolean;
  code: GlobalEconomyLoadErrorCode | null;
  projectId: string | null;
  path: 'globalEconomy/current';
  authReady: boolean;
  userPresent: boolean;
  userAnonymous: boolean | null;
  online: boolean | null;
  documentExists: boolean;
  snapshotEpochPresent: boolean;
  fuelPricePresent: boolean;
  validationPassed: boolean;
  cacheAvailable: boolean;
  cacheAgeMs: number | null;
};

function logGlobalEconomyLoadResult(audit: GlobalEconomyLoadAudit): void {
  console.info('[global-economy-load-result]', audit);
}

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
let globalMarketRefreshInFlight: Promise<{
  success: boolean;
  source: 'backend' | 'development-fallback' | 'cache' | 'unavailable';
  stale: boolean;
}> | null = null;

/** Teslimat tamamlama bildirimi tekrarını engeller (transient) */
const completedDeliveryNotificationIds = new Set<string>();
const completedTransferNotificationIds = new Set<string>();
const hydratedOutOfFuelNotificationJobIds = new Set<string>();
const settledWarehouseStockTransferIds = new Set<string>();

let offlineProgressionActive = false;
let offlineProgressApplying = false;

interface OfflineProgressCollector {
  earnings: number;
  expenses: number;
  completedDeliveries: number;
  lateDeliveries: number;
  driverLevelUps: string[];
  worldEventsUpdated: boolean;
  marketUpdated: boolean;
  dailyCostsApplied: boolean;
}

let offlineProgressCollector: OfflineProgressCollector | null = null;

const OFFLINE_META_PERSIST_INTERVAL_MS = 15_000;
let lastOfflineMetaPersistAt = 0;
let cachedOfflineMetaLastSimulated: number | null = null;

function schedulePersistOfflineMeta(lastSimulatedRealTimeMs: number, lastSimulationGameSpeed: number): void {
  const now = Date.now();
  if (now - lastOfflineMetaPersistAt < OFFLINE_META_PERSIST_INTERVAL_MS) {
    return;
  }
  lastOfflineMetaPersistAt = now;
  cachedOfflineMetaLastSimulated = lastSimulatedRealTimeMs;
  void saveOfflineMeta({ lastSimulatedRealTimeMs, lastSimulationGameSpeed });
}

function persistOfflineMetaImmediate(lastSimulatedRealTimeMs: number, lastSimulationGameSpeed: number): void {
  lastOfflineMetaPersistAt = Date.now();
  cachedOfflineMetaLastSimulated = lastSimulatedRealTimeMs;
  void saveOfflineMeta({ lastSimulatedRealTimeMs, lastSimulationGameSpeed });
}

function getEffectiveTradeUnitPrice(
  state: Pick<StoreGameState, 'worldEvents' | 'currentTime'>,
  city: { id: string },
  productId: import('../types/game').ProductId,
): number {
  const basePrice = getCityProductMarketPrice(city as import('../types/game').City, productId);
  const activeEvents = getActiveWorldEvents(
    state.worldEvents ?? [],
    gameDayFromTime(state.currentTime),
  );
  return applyWorldEventImpactToProductPrice(
    basePrice,
    productId,
    city.id,
    activeEvents,
    gameDayFromTime(state.currentTime),
  );
}

let saveLoadFailureToastShown = false;
let saveWriteFailureToastShown = false;

const SAVE_LOAD_FAILURE_TOAST = {
  title: 'Kayıt yüklenemedi',
  message: 'Yeni oyun başlatıldı.',
} as const;

const SAVE_WRITE_FAILURE_TOAST = {
  title: 'Kayıt kaydedilemedi',
  message: 'Kayıt şu anda kaydedilemedi. Biraz sonra tekrar denenecek.',
} as const;

function notifySaveLoadFailureOnce(
  currentTime: number,
  addNotification: (notification: Omit<GameNotification, 'id'> & { id?: string }) => void,
  debugDetail?: string | null,
): void {
  if (saveLoadFailureToastShown) {
    return;
  }
  saveLoadFailureToastShown = true;
  addNotification({
    time: currentTime,
    type: 'warning',
    title: SAVE_LOAD_FAILURE_TOAST.title,
    message: SAVE_LOAD_FAILURE_TOAST.message,
  });
  if (__DEV__ && debugDetail) {
    console.warn('[gameStore] Save load failure detail:', debugDetail);
  }
}

function notifySaveWriteFailureOnce(
  currentTime: number,
  addNotification: (notification: Omit<GameNotification, 'id'> & { id?: string }) => void,
  debugDetail?: string | null,
): void {
  if (saveWriteFailureToastShown) {
    return;
  }
  saveWriteFailureToastShown = true;
  addNotification({
    time: currentTime,
    type: 'warning',
    title: SAVE_WRITE_FAILURE_TOAST.title,
    message: SAVE_WRITE_FAILURE_TOAST.message,
  });
  if (__DEV__ && debugDetail) {
    console.warn('[gameStore] Save write failure detail:', debugDetail);
  }
}

export type NavigationTab =
  | 'dashboard'
  | 'map'
  | 'contracts'
  | 'fleet'
  | 'shop'
  | 'market'
  | 'vehicleMarketplace'
  | 'more';

export interface NavigationRequest {
  tab: NavigationTab;
  moreSubRoute?: 'finance' | 'warehouse' | 'debug' | 'missions';
}

export type FleetSubTab = 'trucks' | 'drivers' | 'trailers' | 'shop' | 'hire_drivers';

export type AutoSaveReason =
  | 'critical'
  | 'delivery_completed'
  | 'delivery_failed'
  | 'delivery_started'
  | 'transfer_started'
  | 'transfer_completed'
  | 'purchase'
  | 'fuel_purchase'
  | 'roadside_fuel'
  | 'level_up'
  | 'repair'
  | 'upgrade'
  | 'reset'
  | 'new_game'
  | 'economy_tick'
  | 'contracts_generated'
  | 'warehouse'
  | 'marketplace-reconciliation'
  | 'clear_save'
  | 'background'
  | 'manual'
  | 'debug_cash_change'
  | 'time_tick'
  | 'delivery_incident'
  | 'offline_progress';

const IMMEDIATE_SAVE_REASONS = new Set<AutoSaveReason>([
  'critical',
  'delivery_completed',
  'delivery_failed',
  'delivery_started',
  'transfer_started',
  'transfer_completed',
  'purchase',
  'fuel_purchase',
  'roadside_fuel',
  'level_up',
  'repair',
  'reset',
  'new_game',
  'clear_save',
  'background',
  'manual',
  'offline_progress',
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
    playableContractsCount: 0,
    idleTruckOriginCities: [],
    activeDeliveryDestinationCities: [],
    lastPlayableContractGeneratedTime: 0,
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

let lastContractMarketRefreshAt = getEconomyNow();
let leaseTruckInFlight = false;

function buildContractRefreshParams(state: StoreGameState) {
  const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);
  const trucks = state.player.trucks ?? [];
  const trailers = state.player.trailers ?? [];
  const ownedMaxTruckCapacity = getMaxPotentialFleetCapacityTons(trucks, trailers);
  const idleMaxTruckCapacity = getMaxIdleTruckCapacity(trucks, trailers);
  const drivers = state.player.drivers ?? [];
  const homeCityId = state.player.homeCityId;
  const idleTruckOriginCityIds = getIdleTruckOriginCityIds(trucks, homeCityId);
  const activeDeliveryDestinationCityIds = getActiveDeliveryDestinationCityIds(
    state.activeDeliveries,
  );
  const busyTruckOriginCityIds = getBusyTruckOriginCityIds(trucks, homeCityId);
  const fleetCityContext = buildPlayerFleetCityContext({
    trucks,
    activeDeliveries: state.activeDeliveries,
    homeCityId,
    idleTruckOriginCityIds,
  });
  const activeWorldEvents = getActiveWorldEvents(
    state.worldEvents ?? [],
    gameDayFromTime(state.currentTime),
  );
  const playerReputation = state.player.reputation ?? 0;

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
    idleTruckOriginCityIds,
    activeDeliveryDestinationCityIds,
    busyTruckOriginCityIds,
    fleetCityContext,
    trucks,
    trailers,
    drivers,
    homeCityId,
    activeWorldEvents,
    playerReputation,
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
    pendingUpgradeTruckId: null,
    pendingFleetSubTab: null,
    pendingShopCategory: null,
    marketContractFilter: null,
    highlightedContractId: null,
    pendingMarketFocus: null,
    pendingOfflineProgressSummary: null,
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
      category: 'contract_revenue',
      amount: settlement.grossRevenue,
      description: `Sözleşme ödemesi · ${routeLabel}`,
      relatedDeliveryId: deliveryId,
      transactionId: `delivery:${deliveryId}:revenue`,
      referenceId: `delivery:${deliveryId}:revenue`,
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
      transactionId: `delivery:${deliveryId}:maintenance`,
      referenceId: `delivery:${deliveryId}:maintenance`,
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
      transactionId: `delivery:${deliveryId}:penalty`,
      referenceId: `delivery:${deliveryId}:penalty`,
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
  transactionId?: string;
  referenceId?: string;
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

function hasUsableGlobalMarketSnapshot(
  state: Pick<
    StoreGameState,
    | 'cachedGlobalEconomySnapshot'
    | 'cachedGlobalEconomySnapshotTrusted'
    | 'globalMarketSyncStatus'
  >,
): boolean {
  return resolveGlobalMarketAvailability({
    snapshot: state.cachedGlobalEconomySnapshot,
    trusted: state.cachedGlobalEconomySnapshotTrusted === true,
    syncStatus: state.globalMarketSyncStatus,
    development: typeof __DEV__ !== 'undefined' && __DEV__,
  }).priceCriticalOperationsAllowed;
}

function resolveStoreFuelPriceQuote(
  state: Pick<
    StoreGameState,
    | 'cachedGlobalEconomySnapshot'
    | 'cachedGlobalEconomySnapshotTrusted'
    | 'globalMarketSyncStatus'
    | 'globalMarketLastSyncedAtMs'
  >,
) {
  return resolveFuelPriceQuote({
    snapshot: state.cachedGlobalEconomySnapshot,
    trusted: state.cachedGlobalEconomySnapshotTrusted === true,
    syncStatus: state.globalMarketSyncStatus,
    development: typeof __DEV__ !== 'undefined' && __DEV__,
    lastSyncedAtMs: state.globalMarketLastSyncedAtMs,
  });
}

/** GDD Bölüm 6'ya göre başlangıç oyun durumu */
export function createInitialGameState(): StoreGameState {
  const initialEconomyNowMs = getEconomyNow();
  const developmentFallbackEnabled =
    typeof __DEV__ !== 'undefined' && __DEV__;
  const initialSnapshot = developmentFallbackEnabled
    ? buildGlobalEconomySnapshot({ cities: CITIES })
    : undefined;
  const globalEconomy = normalizeGlobalEconomy({
    ...createInitialGlobalEconomy(),
    fuelPrice:
      initialSnapshot?.fuelPricePerLiter ??
      createInitialGlobalEconomy().fuelPrice,
  });
  const cities = initialSnapshot
    ? materializeSnapshotCities(cloneInitialCities(), initialSnapshot)
    : cloneInitialCities();
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
      activeDeliveryDestinationCityIds: [],
      busyTruckOriginCityIds: [],
      fleetCityContext: buildPlayerFleetCityContext({
        idleTruckOriginCityIds: ['izmir'],
        trucks: [structuredClone(STARTER_TRUCK)],
      }),
    },
  );
  const balancedContracts = balanceAvailableContractLevelMix(rawContracts, 1);
  const starterPlayer = {
    level: 1,
    companyLevel: 1,
    homeCityId: 'izmir' as const,
    trucks: [structuredClone(STARTER_TRUCK)],
    drivers: [structuredClone(STARTER_DRIVER)],
    trailers: [] as Trailer[],
  };
  const contracts = ensureStarterContracts({
    contracts: balancedContracts,
    cities: citiesToRecord(cities),
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy,
    player: starterPlayer,
    currentTime: 0,
    minCount: contractGenerationBalance.minAvailableContractsPerIdleTruckCity,
  });

  const ensuredPlayable = ensurePlayableContractSupply({
    cities: citiesToRecord(cities),
    routes: ROUTES,
    products: PRODUCTS,
    globalEconomy,
    contracts,
    currentTime: 0,
    playerLevel: 1,
    trucks: starterPlayer.trucks,
    trailers: starterPlayer.trailers,
    drivers: starterPlayer.drivers,
    homeCityId: starterPlayer.homeCityId,
    idleTruckOriginCityIds: ['izmir'],
    forceFallback: true,
    maxNewContracts: contractGenerationBalance.maxPlayableContractsGeneratedAtOnce,
  }).contracts;

  return {
    currentTime: 0,
    isPaused: false,
    gameSpeed: 1,
    lastSimulationGameSpeed: 1,
    lastEconomyTickTime: 0,
    lastDailyOperatingCostTime: 0,
    lastContractGenerationTime: 0,
    lastMarketRefreshTime: 0,
    lastDailyCleanupTime: 0,
    lastPlayableContractGeneratedTime: 0,
    lastManualContractRefreshTime: 0,
    player: {
      companyName: 'LogistiCore Lojistik',
      money: STARTING_MONEY,
      companyLevel: 1,
      level: 1,
      xp: 0,
      xpToNextLevel: calculateXpToNextLevel(1),
      totalXp: 0,
      homeCityId: 'izmir',
      reputation: reputationBalance.initial,
      completedContracts: 0,
      failedDeliveries: 0,
      lateDeliveries: 0,
      diamonds: 0,
      trucks: [normalizeTruckFuel(structuredClone(STARTER_TRUCK))],
      drivers: [structuredClone(STARTER_DRIVER)],
      trailers: [],
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
    contracts: ensuredPlayable,
    activeDeliveries: [],
    activeTransfers: [],
    completedTransfers: [],
    activeWarehouseStockTransfers: [],
    completedWarehouseStockTransfers: [],
    globalEconomy,
    cachedGlobalEconomySnapshot: initialSnapshot,
    cachedGlobalEconomySnapshotTrusted: false,
    globalMarketHistory: [],
    globalMarketSyncStatus: 'idle',
    globalMarketErrorCode: null,
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
    retention: createDefaultRetentionState(),
    onboarding: createDefaultOnboardingState(),
    spotlightTutorial: createDefaultSpotlightTutorialState(),
    marketAlerts: [],
    worldEvents: initialSnapshot?.activeEvents ?? [],
    worldEventsVersion: 1,
    lastWorldEventGeneratedDay: 0,
    monetization: createDefaultMonetizationState(),
    lastSeenRealTimeMs: initialEconomyNowMs,
    lastSimulatedRealTimeMs: initialEconomyNowMs,
    lastProcessedEconomyAt: initialEconomyNowMs,
    appliedEconomyPeriodKeys: [],
    offlineProgressVersion: OFFLINE_PROGRESS_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Store tipi
// ---------------------------------------------------------------------------

export interface GameStore extends StoreGameState {
  /** Geçici UI bildirimleri — save'e yazılmaz */
  notifications: GameNotification[];
  navigationRequest: NavigationRequest | null;
  pendingMoreSubRoute: 'finance' | 'warehouse' | 'debug' | 'missions' | 'leaderboard' | 'upgrades' | null;
  pendingUpgradeTruckId: string | null;
  pendingFleetSubTab: FleetSubTab | null;
  pendingShopCategory: ShopCategory | null;
  pendingMarketplaceSellTruckId: string | null;
  marketContractFilter: MarketContractFilter | null;
  highlightedContractId: string | null;
  pendingMarketFocus: MarketFocusRequest | null;
  /** Sözleşme üretim zamanlaması — save'e yazılmaz, debug için */
  contractGenerationDebug: ContractGenerationDebugSnapshot;
  /** Son teslimat para mutabakatı — save'e yazılmaz, debug için */
  deliverySettlementDebug: DeliverySettlementDebugSnapshot;
  /** Günlük işletme gideri zamanlaması — save'e yazılmaz */
  dailyOperatingCostDebug: DailyOperatingCostDebugSnapshot;
  /** Offline catch-up özeti — save'e yazılmaz */
  pendingOfflineProgressSummary: OfflineProgressSummary | null;
  addNotification: (notification: Omit<GameNotification, 'id'> & { id?: string }) => void;
  dismissNotification: (notificationId: string) => void;
  clearNotifications: () => void;
  applyVehicleMarketplaceReconciliation: (
    authoritative: AuthoritativeMarketplaceReconciliation,
  ) => void;
  requestNavigationFromNotification: (target: GameNotificationActionTarget) => void;
  clearNavigationRequest: () => void;
  clearPendingMoreSubRoute: () => void;
  openUpgradesScreen: (truckId?: string) => void;
  clearPendingUpgradeTruckId: () => void;
  requestNavigationToFleet: (subTab?: FleetSubTab) => void;
  clearPendingFleetSubTab: () => void;
  requestNavigationToShop: (category?: ShopCategory) => void;
  clearPendingShopCategory: () => void;
  openVehicleMarketplaceForTruck: (truckId: string) => void;
  clearPendingMarketplaceSellTruckId: () => void;
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
  deleteAccountAndCloudData: () => Promise<{ ok: boolean; error?: string; errorCode?: string }>;
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
  recordLastSeenRealTimeMs: () => void;
  applyOfflineProgressionIfNeeded: (trigger?: 'cold-start' | 'foreground') => void;
  dismissOfflineProgressSummary: () => void;
  replenishContractsIfNeeded: () => void;
  runEconomyTick: () => void;
  getContractGenerationDebug: () => ContractGenerationDebugSnapshot;
  getDeliverySettlementDebug: () => DeliverySettlementDebugSnapshot;
  /** Oyuncu ekranları: süresi dolmuş teklifleri temizler, yeni sözleşme üretmez */
  refreshMarketSnapshot: () => Promise<{
    success: boolean;
    source: 'backend' | 'development-fallback' | 'cache' | 'unavailable';
    stale: boolean;
  }>;
  refreshContractsFromMarket: (options?: { bypassCooldown?: boolean }) => void;
  applyAdReward: (
    slotId: AdRewardSlotId,
    context: Omit<AdRewardGrantContext, 'currentGameTime' | 'playerLevel' | 'hasCompletedOnboarding'>,
  ) => Promise<{ ok: boolean; reason?: string }>;
  resolveDeliveryIncident: (
    deliveryId: string,
    choiceId: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
  forceGeneratePlayableContracts: () => number;
  getContractRefreshRemainingSeconds: () => number;
  /** Debug: manuel sözleşme üretimi */
  generateNewContracts: () => void;
  /** Debug — mevcut şehir origin, tüm ulaşılabilir hedeflere 1'er sözleşme */
  debugGenerateContractsFromCurrentCity: () => DebugContractGenerationResult;
  expireContracts: () => void;
  startDelivery: (contractId: string, truckId: string, driverId: string) => StartDeliveryResult;
  startDeliveryAutoAssign: (contractId: string) => StartDeliveryResult;
  updateDeliveries: (hoursPassed: number) => void;
  updateTransfers: (hoursPassed: number) => void;
  updateWarehouseStockTransfers: (hoursPassed: number) => void;
  startTruckTransfer: (params: { truckId: string; toCityId: string; driverId?: string }) => StartTruckTransferResult;
  completeTruckTransferById: (transferId: string) => void;
  startWarehouseStockTransfer: (params: {
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    productId: ProductId;
    quantityTons: number;
    truckId?: string;
    driverId?: string;
  }) => TradeActionResult;
  completeWarehouseStockTransferById: (transferId: string) => void;
  cancelWarehouseStockTransfer: (transferId: string) => TradeActionResult;
  failWarehouseStockTransfer: (transferId: string, reason?: string) => TradeActionResult;
  completeDeliveryById: (deliveryId: string) => void;
  failDeliveryById: (deliveryId: string, reason: DeliveryFailureReason) => void;
  buyTruck: (catalogId: string) => TradeActionResult;
  buyTrailer: (catalogId: string) => TradeActionResult;
  attachTrailerToTruck: (trailerId: string, truckId: string) => TradeActionResult;
  detachTrailerFromTruck: (trailerId: string) => TradeActionResult;
  leaseTruck: (catalogId: string) => TradeActionResult;
  hireDriver: (poolId: string) => TradeActionResult;
  sellTruck: (truckId: string) => TradeActionResult;
  fireDriver: (driverId: string) => TradeActionResult;
  processDailyOperatingCosts: (options?: ProcessDailyOperatingCostsOptions) => void;
  processExpiredLeases: () => void;
  repairTruck: (truckId: string) => void;
  upgradeTruck: (truckId: string, upgradeType: TruckUpgradeType) => void;
  refuelTruck: (params: {
    truckId: string;
    liters: number;
    expectedUnitPrice: number;
    idempotencyKey?: string;
  }) => TruckRefuelResult;
  purchaseRoadsideFuel: (params: {
    jobId: string;
    liters: number;
    expectedUnitPrice: number;
    idempotencyKey?: string;
  }) => RoadsideFuelResult;
  requestRoadsideFuelAssistance: (jobId: string) => RoadsideFuelResult;
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
  createMarketPriceAlert: (input: {
    cityId: string;
    productId: ProductId;
    condition: MarketPriceAlertCondition;
    targetPrice: number;
  }) => Promise<MarketAlertActionResult>;
  deleteMarketPriceAlert: (alertId: string) => Promise<MarketAlertActionResult>;
  toggleMarketPriceAlert: (alertId: string, isActive: boolean) => Promise<MarketAlertActionResult>;
  checkMarketPriceAlerts: (options?: {
    sendInApp?: boolean;
    sendLocal?: boolean;
  }) => MarketPriceAlert[];
  markMarketAlertTriggered: (alertId: string) => void;
  openMarketFromAlert: (focus: MarketFocusRequest) => void;
  clearPendingMarketFocus: () => void;
  clearAllMarketAlerts: () => Promise<void>;
  forceGenerateWorldEvent: (type: WorldEventType) => void;
  clearWorldEvents: () => void;
  forceGenerateSpecialContracts: () => number;
  addDriverXp: (driverId: string, amount: number) => void;
  resetDriverProgress: (driverId: string) => void;
  addTruckUpgrade: (truckId: string, upgradeType: TruckUpgradeType) => void;
  getActiveWorldEventsValue: () => import('../types/game').WorldEvent[];
  syncMissionProgress: () => void;
  getMissionProgressValue: (missionId: string) => MissionProgressResult;
  claimMissionReward: (missionId: string) => { success: boolean; message?: string };
  syncRetentionProgress: () => void;
  applyRetentionEventAndSync: (event: RetentionEvent) => void;
  claimMilestoneReward: (milestoneId: string) => { success: boolean; message?: string };
  claimWeeklyObjectiveReward: (objectiveId: string) => { success: boolean; message?: string };
  getRetentionSummaryValue: () => ReturnType<typeof getRetentionSummary>;
  markOnboardingScreenVisited: (screenId: OnboardingScreenId) => void;
  dismissOnboardingHint: (hintId: string) => void;
  dismissOnboardingGuide: () => void;
  completeOnboardingStepPress: (stepId: OnboardingStepId) => void;
  advanceOnboardingProgress: () => void;
  resetOnboardingForDev: () => void;
  addCompanyXp: (amount: number, reason?: string) => void;
  checkLevelUp: () => void;
  getLevelBenefits: (level?: number) => LevelBenefits;
  /** Debug/test — production'da gizlenmeli */
  debugAddCash: (amount: number) => void;
  debugRemoveCash: (amount: number) => void;
  debugSetCash: (amount: number) => void;
  debugAdvanceOneDay: () => void;
  debugAdvanceOfflineDays: (days?: number) => void;
  debugSimulateOfflineRealMinutes: (minutes?: number) => {
    realMinutes: number;
    gameHours: number;
    gameSpeed: number;
  };
  debugProcessDailyCosts: () => void;
  debugExpireLeaseTruck: () => void;
  debugGetEconomyBalanceSummary: () => string;
  debugInjectDeliveryIncident: (
    incidentType?: DeliveryIncidentType,
  ) => { ok: boolean; reason?: string };
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

export const useGameStore = create<GameStore>((set, get) => ({
  ...createInitialGameState(),
  notifications: [],
  navigationRequest: null,
  pendingMoreSubRoute: null,
  pendingUpgradeTruckId: null,
  pendingFleetSubTab: null,
  pendingShopCategory: null,
  pendingMarketplaceSellTruckId: null,
  marketContractFilter: null,
  highlightedContractId: null,
  pendingMarketFocus: null,
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
  pendingOfflineProgressSummary: null,
  saveStatus: createSaveStatusSnapshot(false),
  isGameReady: false,
  saveError: null,

  addNotification: (notification) => {
    const entry: GameNotification = {
      ...notification,
      id: notification.id ?? createNotificationId(`${Math.random().toString(36).slice(2, 8)}`),
      autoDismissMs: resolveNotificationDismissMs(notification.type, notification.autoDismissMs),
    };
    set({
      notifications: [
        entry,
        ...get().notifications.filter((candidate) => candidate.id !== entry.id),
      ].slice(0, 8),
    });
  },

  dismissNotification: (notificationId) => {
    set({
      notifications: get().notifications.filter((notification) => notification.id !== notificationId),
    });
  },

  clearNotifications: () => {
    set({ notifications: [] });
  },

  applyVehicleMarketplaceReconciliation: (authoritative) => {
    const state = get();
    const result = reconcileFleetWithVehicleMarketplace(
      state.player.trucks,
      authoritative,
    );
    set({
      player: {
        ...state.player,
        trucks: result.trucks,
        money: result.authoritativeCash ?? state.player.money,
      },
      vehicleMarketplace: result.cache,
    });
    get().autoSave('marketplace-reconciliation');
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
      case 'market':
        set({ navigationRequest: { tab: 'market' } });
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

  openUpgradesScreen: (truckId) => {
    set({
      navigationRequest: { tab: 'more' },
      pendingMoreSubRoute: 'upgrades',
      pendingUpgradeTruckId: truckId ?? null,
    });
  },

  clearPendingUpgradeTruckId: () => {
    set({ pendingUpgradeTruckId: null });
  },

  requestNavigationToFleet: (subTab = 'trucks') => {
    if (subTab === 'shop') {
      get().requestNavigationToShop('trucks');
      return;
    }
    if (subTab === 'hire_drivers') {
      get().requestNavigationToShop('drivers');
      return;
    }
    set({ navigationRequest: { tab: 'fleet' }, pendingFleetSubTab: subTab });
  },

  clearPendingFleetSubTab: () => {
    set({ pendingFleetSubTab: null });
  },

  requestNavigationToShop: (category = 'trucks') => {
    set({ navigationRequest: { tab: 'shop' }, pendingShopCategory: category });
  },

  clearPendingShopCategory: () => {
    set({ pendingShopCategory: null });
  },

  openVehicleMarketplaceForTruck: (truckId) => {
    if (!VEHICLE_MARKETPLACE_ENABLED) return;
    set({
      navigationRequest: { tab: 'vehicleMarketplace' },
      pendingMarketplaceSellTruckId: truckId,
    });
  },

  clearPendingMarketplaceSellTruckId: () => {
    set({ pendingMarketplaceSellTruckId: null });
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
    const nextTutorial = tutorialOnContractsOpened(tutorial);
    if (nextTutorial === tutorial) {
      return;
    }
    set({ tutorial: nextTutorial });
    get().markSaveDirty();
  },

  notifyContractAssignmentOpened: () => {
    const state = get();
    const tutorial = state.tutorial ?? createDefaultTutorialState();
    const onboarding = state.onboarding ?? createDefaultOnboardingState();
    const nextOnboarding = markOnboardingAssignmentOpened(onboarding);
    set({
      tutorial: tutorialOnContractAssignmentOpened(tutorial),
      onboarding: nextOnboarding,
    });
    get().markSaveDirty();
    get().advanceOnboardingProgress();
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
    const nextTutorial = tutorialOnActiveDeliverySeen(tutorial);
    if (nextTutorial === tutorial) {
      return;
    }
    set({ tutorial: nextTutorial });
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
    const tutorial = state.tutorial ?? createDefaultTutorialState();
    if (missions.flags.marketOpened && tutorial.isCompleted) {
      return;
    }
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
    set({
      tutorial: tutorialOnMarketOpened(tutorial),
      missions: nextMissions,
    });
    get().markSaveDirty();
    get().advanceOnboardingProgress();
  },

  markOnboardingScreenVisited: (screenId) => {
    const state = get();
    const onboarding = state.onboarding ?? createDefaultOnboardingState();
    const nextOnboarding = markOnboardingScreenVisitedState(onboarding, screenId);
    if (nextOnboarding === onboarding) {
      return;
    }
    set({ onboarding: nextOnboarding });
    get().markSaveDirty();
    get().advanceOnboardingProgress();
  },

  dismissOnboardingHint: (hintId) => {
    const state = get();
    const onboarding = state.onboarding ?? createDefaultOnboardingState();
    const nextOnboarding = dismissOnboardingHint(onboarding, hintId);
    if (nextOnboarding === onboarding) {
      return;
    }
    set({ onboarding: nextOnboarding });
    get().markSaveDirty();
  },

  dismissOnboardingGuide: () => {
    const state = get();
    const onboarding = state.onboarding ?? createDefaultOnboardingState();
    set({ onboarding: dismissOnboardingGuide(onboarding) });
    get().markSaveDirty();
  },

  completeOnboardingStepPress: (_stepId) => {
    get().advanceOnboardingProgress();
  },

  advanceOnboardingProgress: () => {
    const state = get();
    if (!state.player) {
      return;
    }
    const currentOnboarding = state.onboarding ?? createDefaultOnboardingState();
    const nextOnboarding = syncOnboardingProgress(
      buildOnboardingEvaluationState({
        onboarding: currentOnboarding,
        activeDeliveries: state.activeDeliveries ?? [],
        missions: state.missions ?? createDefaultMissionsState(),
        player: state.player,
        currentTime: state.currentTime,
        getMissionProgress: (missionId) => getMissionProgress(missionId, state),
      }),
    );
    if (
      nextOnboarding.currentStepId === currentOnboarding.currentStepId &&
      nextOnboarding.completed === currentOnboarding.completed &&
      nextOnboarding.completedStepIds.length === currentOnboarding.completedStepIds.length &&
      nextOnboarding.assignmentOpened === currentOnboarding.assignmentOpened
    ) {
      return;
    }
    set({ onboarding: nextOnboarding });
    get().markSaveDirty();
  },

  resetOnboardingForDev: () => {
    set({ onboarding: resetOnboardingStateForDev() });
    get().markSaveDirty();
  },

  createMarketPriceAlert: async (input) => {
    const state = get();
    const city = getCityByIdSafe(input.cityId);
    if (!city) {
      return { success: false, errorCode: 'CITY_NOT_FOUND', message: 'Şehir bulunamadı.' };
    }

    const product = getProductByIdSafe(input.productId);
    if (!product) {
      return { success: false, errorCode: 'PRODUCT_NOT_FOUND', message: 'Ürün bulunamadı.' };
    }

    if (!Number.isFinite(input.targetPrice) || input.targetPrice <= 0) {
      return { success: false, errorCode: 'INVALID_TARGET', message: 'Geçerli bir hedef fiyat gir.' };
    }

    const alerts = normalizeMarketAlerts(state.marketAlerts);
    if (
      isDuplicateMarketAlert(alerts, {
        cityId: input.cityId,
        productId: input.productId,
        condition: input.condition,
        targetPrice: input.targetPrice,
      })
    ) {
      return {
        success: false,
        errorCode: 'DUPLICATE_ALERT',
        message: 'Bu alarm zaten kurulu.',
      };
    }

    if (countActiveMarketAlerts(alerts) >= marketAlertBalance.maxActiveAlerts) {
      return {
        success: false,
        errorCode: 'MAX_ALERTS_REACHED',
        message: `En fazla ${marketAlertBalance.maxActiveAlerts} aktif alarm kurabilirsin.`,
      };
    }

    const market = getCityProductMarketState(city, input.productId);
    const currentPrice = market?.currentPrice ?? 0;
    const alert: MarketPriceAlert = {
      id: createMarketAlertId(`${input.cityId}-${input.productId}`),
      cityId: input.cityId,
      productId: input.productId,
      condition: input.condition,
      targetPrice: input.targetPrice,
      isActive: true,
      createdAt: state.currentTime,
      expiresAt: getDefaultAlertExpiryTime(state.currentTime),
    };

    const permission = await requestNotificationPermissions();
    let notificationId: string | undefined;
    if (permission.granted) {
      notificationId =
        (await scheduleMarketAlertNotification(alert, currentPrice)) ?? undefined;
    }

    set({ marketAlerts: [...alerts, { ...alert, notificationId }] });
    get().markSaveDirty();

    return {
      success: true,
      alertId: alert.id,
      message: permission.granted
        ? 'Alarm kuruldu. Hedefe ulaşınca bildirim alırsın.'
        : 'Alarm kuruldu. Bildirim izni kapalı. Alarm oyun içindeyken çalışacak.',
    };
  },

  deleteMarketPriceAlert: async (alertId) => {
    const state = get();
    const alert = (state.marketAlerts ?? []).find((item) => item.id === alertId);
    if (!alert) {
      return { success: false, errorCode: 'ALERT_NOT_FOUND', message: 'Alarm bulunamadı.' };
    }

    await cancelMarketAlertNotification(alert.notificationId);
    set({ marketAlerts: (state.marketAlerts ?? []).filter((item) => item.id !== alertId) });
    get().markSaveDirty();
    return { success: true, message: 'Alarm silindi.' };
  },

  toggleMarketPriceAlert: async (alertId, isActive) => {
    const state = get();
    const alerts = normalizeMarketAlerts(state.marketAlerts);
    const alert = alerts.find((item) => item.id === alertId);
    if (!alert) {
      return { success: false, errorCode: 'ALERT_NOT_FOUND', message: 'Alarm bulunamadı.' };
    }

    if (isActive && countActiveMarketAlerts(alerts) >= marketAlertBalance.maxActiveAlerts) {
      return {
        success: false,
        errorCode: 'MAX_ALERTS_REACHED',
        message: `En fazla ${marketAlertBalance.maxActiveAlerts} aktif alarm kurabilirsin.`,
      };
    }

    let notificationId = alert.notificationId;
    if (isActive) {
      const city = getCityByIdSafe(alert.cityId);
      const market = city ? getCityProductMarketState(city, alert.productId) : null;
      await cancelMarketAlertNotification(alert.notificationId);
      const permission = await requestNotificationPermissions();
      if (permission.granted) {
        notificationId =
          (await scheduleMarketAlertNotification(
            { ...alert, isActive: true, triggeredAt: undefined },
            market?.currentPrice ?? 0,
          )) ?? undefined;
      } else {
        notificationId = undefined;
      }
    } else {
      await cancelMarketAlertNotification(alert.notificationId);
      notificationId = undefined;
    }

    set({
      marketAlerts: alerts.map((item) =>
        item.id === alertId
          ? {
              ...item,
              isActive,
              triggeredAt: isActive ? undefined : item.triggeredAt,
              notificationId,
            }
          : item,
      ),
    });
    get().markSaveDirty();
    return { success: true };
  },

  checkMarketPriceAlerts: (options = {}) => {
    const { sendInApp = true, sendLocal = true } = options;
    const state = get();
    const now = state.currentTime;
    const marketEpoch = state.cachedGlobalEconomySnapshot?.epoch;
    const cleanedAlerts = cleanExpiredMarketAlerts(normalizeMarketAlerts(state.marketAlerts), now);
    const triggeredAlerts: MarketPriceAlert[] = [];

    const updatedAlerts = cleanedAlerts.map((alert) => {
      if (
        !alert.isActive ||
        alert.triggeredAt ||
        (marketEpoch != null && alert.lastTriggeredMarketEpoch === marketEpoch)
      ) {
        return alert;
      }

      const city = getCityByIdSafe(alert.cityId);
      if (!city) return alert;

      const market = getCityProductMarketState(city, alert.productId);
      if (!market) return alert;
      const currentPrice =
        state.cachedGlobalEconomySnapshot?.cityMarketPrices[alert.cityId]?.[
          alert.productId
        ] ?? market.currentPrice;

      if (!evaluateMarketAlertCondition(alert, currentPrice, market.basePrice)) {
        return alert;
      }

      triggeredAlerts.push(alert);
      return {
        ...alert,
        isActive: false,
        triggeredAt: now,
        lastTriggeredMarketEpoch: marketEpoch,
      };
    });

    set({ marketAlerts: updatedAlerts });
    if (triggeredAlerts.length > 0) {
      get().markSaveDirty();
    }

    for (const alert of triggeredAlerts) {
      const cityName = getCityName(alert.cityId);
      const productName = getProductName(alert.productId);
      const city = getCityByIdSafe(alert.cityId);
      const market = city ? getCityProductMarketState(city, alert.productId) : null;
      const currentPrice =
        state.cachedGlobalEconomySnapshot?.cityMarketPrices[alert.cityId]?.[
          alert.productId
        ] ?? market?.currentPrice ?? alert.targetPrice ?? 0;
      const message = buildTriggeredAlertMessage(alert, cityName, productName, currentPrice);

      void cancelMarketAlertNotification(alert.notificationId);

      if (sendInApp) {
        get().addNotification({
          time: now,
          type: 'info',
          title: 'Fiyat alarmı',
          message,
          actionLabel: 'Piyasaya Git',
          actionTarget: 'market',
          marketFocus: { cityId: alert.cityId, productId: alert.productId },
        });
      }

      get().addGameEvent({
        time: now,
        type: 'market',
        title: 'Fiyat alarmı',
        message,
        importance: 'medium',
      });

      if (sendLocal) {
        void sendLocalMarketAlertNotification(alert, message);
      }
    }

    return triggeredAlerts;
  },

  markMarketAlertTriggered: (alertId) => {
    const state = get();
    const alerts = normalizeMarketAlerts(state.marketAlerts);
    const alert = alerts.find((item) => item.id === alertId);
    if (!alert) return;

    void cancelMarketAlertNotification(alert.notificationId);
    set({
      marketAlerts: alerts.map((item) =>
        item.id === alertId
          ? { ...item, isActive: false, triggeredAt: state.currentTime }
          : item,
      ),
    });
    get().markSaveDirty();
  },

  openMarketFromAlert: (focus) => {
    set({
      navigationRequest: { tab: 'market' },
      pendingMarketFocus: focus,
    });
  },

  clearPendingMarketFocus: () => {
    set({ pendingMarketFocus: null });
  },

  clearAllMarketAlerts: async () => {
    const state = get();
    for (const alert of state.marketAlerts ?? []) {
      await cancelMarketAlertNotification(alert.notificationId);
    }
    set({ marketAlerts: [] });
    get().markSaveDirty();
  },

  forceGenerateWorldEvent: (type) => {
    if (!__DEV__) {
      return;
    }
    const state = get();
    const currentDay = gameDayFromTime(state.lastEconomyTickTime || state.currentTime);
    const forced = forceCreateWorldEvent(type, currentDay);
    if (!forced) {
      return;
    }
    set({
      worldEvents: [...(state.worldEvents ?? []), forced].slice(-12),
    });
    get().markSaveDirty();
  },

  clearWorldEvents: () => {
    if (!__DEV__) {
      return;
    }
    set({
      worldEvents: [],
      lastWorldEventGeneratedDay: gameDayFromTime(get().currentTime),
    });
    get().markSaveDirty();
  },

  forceGenerateSpecialContracts: () => {
    if (!__DEV__) {
      return 0;
    }
    const state = get();
    const params = buildContractRefreshParams(state);
    const specialContracts = generateContracts(
      params.cities,
      state.routes,
      state.products,
      state.globalEconomy,
      state.contracts,
      {
        currentTime: state.currentTime,
        maxNewContracts: 6,
        playerLevel: Math.max(4, params.playerLevel),
        playerReputation: Math.max(70, params.playerReputation ?? 0),
        ownedMaxTruckCapacity: params.ownedMaxTruckCapacity,
        idleMaxTruckCapacity: params.idleMaxTruckCapacity,
        idleTruckOriginCityIds: params.idleTruckOriginCityIds,
        activeDeliveryDestinationCityIds: params.activeDeliveryDestinationCityIds,
        busyTruckOriginCityIds: params.busyTruckOriginCityIds,
        fleetCityContext: params.fleetCityContext,
        activeWorldEvents: params.activeWorldEvents,
      },
    ).filter((c) => (c.contractType ?? 'standard') !== 'standard');
    if (specialContracts.length === 0) {
      return 0;
    }
    const merged = mergeContractsWithDedupe(state.contracts, specialContracts);
    set({ contracts: merged });
    get().markSaveDirty();
    return specialContracts.length;
  },

  addDriverXp: (driverId, amount) => {
    if (!__DEV__) {
      return;
    }
    const state = get();
    const drivers = state.player.drivers.map((driver) => {
      if (driver.id !== driverId) {
        return driver;
      }
      return applyDriverXp(driver, amount).driver;
    });
    set({ player: { ...state.player, drivers } });
    get().markSaveDirty();
  },

  resetDriverProgress: (driverId) => {
    if (!__DEV__) {
      return;
    }
    const state = get();
    const drivers = state.player.drivers.map((driver) =>
      driver.id === driverId
        ? {
            ...driver,
            xp: 0,
            level: 1,
            completedDeliveries: 0,
            onTimeDeliveries: 0,
            specialty: undefined,
          }
        : driver,
    );
    set({ player: { ...state.player, drivers } });
    get().markSaveDirty();
  },

  addTruckUpgrade: (truckId, upgradeType) => {
    if (!__DEV__) {
      return;
    }
    const state = get();
    const truck = state.player.trucks.find((t) => t.id === truckId);
    if (!truck || !canUpgradeTruck(truck, upgradeType)) {
      return;
    }
    const upgraded = applyTruckUpgrade(truck, upgradeType);
    set({
      player: {
        ...state.player,
        trucks: state.player.trucks.map((t) => (t.id === truckId ? upgraded : t)),
      },
    });
    get().applyRetentionEventAndSync({ type: 'truck_upgraded', truckId });
    get().markSaveDirty();
  },

  getActiveWorldEventsValue: () => {
    const state = get();
    return getActiveWorldEvents(state.worldEvents ?? [], gameDayFromTime(state.currentTime));
  },

  syncMissionProgress: () => {
    const state = get();
    const previous = state.missions ?? createDefaultMissionsState();
    const missions = syncMissionsState(previous, state);
    if (missionsProgressUnchanged(previous, missions)) {
      return;
    }
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
    const rewardTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: moneyReward,
      kind: 'income',
      referenceId: `mission:${missionId}:reward`,
      transactionId: `mission-reward:${missionId}`,
    });

    const ledgerPatch =
      rewardTransaction.amount > 0
        ? patchFinanceLedger(state, {
            time: state.currentTime,
            type: 'income',
            category: 'reward',
            amount: rewardTransaction.amount,
            title: 'Görev Ödülü',
            description: mission.title,
            transactionId: rewardTransaction.transactionId,
            referenceId: rewardTransaction.referenceId,
          })
        : null;

    const claimedMissionRewardIds = [...missions.claimedMissionRewardIds, missionId];
    const completedMissionIds = missions.completedMissionIds.includes(missionId)
      ? missions.completedMissionIds
      : [...missions.completedMissionIds, missionId];

    const currentOnboarding = state.onboarding ?? createDefaultOnboardingState();
    const nextOnboarding =
      isOnboardingActive(currentOnboarding) &&
      currentOnboarding.currentStepId === 'claim_first_reward'
        ? markOnboardingMissionRewardClaimed(currentOnboarding)
        : currentOnboarding;

    set({
      player: {
        ...state.player,
        money: rewardTransaction.cashAfter,
        diamonds: (state.player.diamonds ?? 0) + diamondReward,
        reputation: Math.min(100, (state.player.reputation ?? 0) + reputationReward),
      },
      missions: {
        ...missions,
        claimedMissionRewardIds,
        completedMissionIds,
      },
      onboarding: nextOnboarding,
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
    get().advanceOnboardingProgress();
    void get()
      .saveGame()
      .then(() => {
        void syncLocalSaveToCloud('mission_claim', { force: true, state: get() });
      });
    return { success: true };
  },

  syncRetentionProgress: () => {
    const state = get();
    const previous = state.retention ?? createDefaultRetentionState();
    const retention = syncRetentionProgressState(state);
    if (retentionProgressUnchanged(previous, retention)) {
      return;
    }
    set({ retention });
  },

  applyRetentionEventAndSync: (event) => {
    const state = get();
    const withEvent = applyRetentionEvent(state.retention ?? createDefaultRetentionState(), event);
    const retention = syncRetentionProgressState({ ...state, retention: withEvent });
    set({ retention });
  },

  getRetentionSummaryValue: () => {
    const state = get();
    return getRetentionSummary(state.retention ?? createDefaultRetentionState());
  },

  claimMilestoneReward: (milestoneId) => {
    const state = get();
    const synced = syncRetentionProgressState(state);
    const claimResult = claimMilestoneRewardState(synced, milestoneId, state.currentTime);
    if (!claimResult.ok) {
      if (claimResult.error === 'already-claimed') {
        return { success: false, message: 'Ödül zaten alındı.' };
      }
      if (claimResult.error === 'not-complete') {
        return { success: false, message: 'Başarı henüz tamamlanmadı.' };
      }
      return { success: false, message: 'Başarı bulunamadı.' };
    }

    const milestone = getMilestoneById(milestoneId);
    if (!milestone) {
      return { success: false, message: 'Başarı bulunamadı.' };
    }

    const moneyReward = milestone.reward.cash ?? 0;
    const xpReward = milestone.reward.xp ?? 0;
    const diamondReward = milestone.reward.diamonds ?? 0;
    const reputationReward = milestone.reward.reputation ?? 0;
    const rewardTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: moneyReward,
      kind: 'income',
      referenceId: `milestone:${milestoneId}:reward`,
      transactionId: `milestone-reward:${milestoneId}`,
    });

    const ledgerPatch =
      rewardTransaction.amount > 0
        ? patchFinanceLedger(state, {
            time: state.currentTime,
            type: 'income',
            category: 'reward',
            amount: rewardTransaction.amount,
            title: 'Başarı Ödülü',
            description: milestone.title,
            transactionId: rewardTransaction.transactionId,
            referenceId: rewardTransaction.referenceId,
          })
        : null;

    set({
      player: {
        ...state.player,
        money: rewardTransaction.cashAfter,
        diamonds: (state.player.diamonds ?? 0) + diamondReward,
        reputation: Math.min(100, (state.player.reputation ?? 0) + reputationReward),
      },
      retention: claimResult.retention,
      financeLedger: ledgerPatch?.financeLedger ?? state.financeLedger ?? [],
      financeTotals: ledgerPatch?.financeTotals ?? state.financeTotals,
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'system',
          title: 'Başarı tamamlandı',
          message: `${milestone.title} ödülü alındı.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    if (xpReward > 0) {
      get().addCompanyXp(xpReward, 'milestone_reward');
    }

    get().markSaveDirty();
    get().syncRetentionProgress();
    return { success: true };
  },

  claimWeeklyObjectiveReward: (objectiveId) => {
    const state = get();
    const seasonKey = getWeeklySeasonKey();
    const synced = syncRetentionProgressState(state);
    const claimResult = claimWeeklyObjectiveRewardState(
      synced,
      objectiveId,
      seasonKey,
      state.currentTime,
    );
    if (!claimResult.ok) {
      if (claimResult.error === 'already-claimed') {
        return { success: false, message: 'Ödül zaten alındı.' };
      }
      if (claimResult.error === 'not-complete') {
        return { success: false, message: 'Haftalık görev henüz tamamlanmadı.' };
      }
      return { success: false, message: 'Haftalık görev bulunamadı.' };
    }

    const objective = getWeeklyObjectiveById(seasonKey, objectiveId);
    if (!objective) {
      return { success: false, message: 'Haftalık görev bulunamadı.' };
    }

    const moneyReward = objective.reward.cash ?? 0;
    const xpReward = objective.reward.xp ?? 0;
    const diamondReward = objective.reward.diamonds ?? 0;
    const reputationReward = objective.reward.reputation ?? 0;
    const rewardTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: moneyReward,
      kind: 'income',
      referenceId: `weekly:${seasonKey}:${objectiveId}:reward`,
      transactionId: `weekly-reward:${seasonKey}:${objectiveId}`,
    });

    const ledgerPatch =
      rewardTransaction.amount > 0
        ? patchFinanceLedger(state, {
            time: state.currentTime,
            type: 'income',
            category: 'reward',
            amount: rewardTransaction.amount,
            title: 'Haftalık Görev Ödülü',
            description: objective.title,
            transactionId: rewardTransaction.transactionId,
            referenceId: rewardTransaction.referenceId,
          })
        : null;

    set({
      player: {
        ...state.player,
        money: rewardTransaction.cashAfter,
        diamonds: (state.player.diamonds ?? 0) + diamondReward,
        reputation: Math.min(100, (state.player.reputation ?? 0) + reputationReward),
      },
      retention: claimResult.retention,
      financeLedger: ledgerPatch?.financeLedger ?? state.financeLedger ?? [],
      financeTotals: ledgerPatch?.financeTotals ?? state.financeTotals,
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'system',
          title: 'Haftalık görev tamamlandı',
          message: `${objective.title} ödülü alındı.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    if (xpReward > 0) {
      get().addCompanyXp(xpReward, 'weekly_objective_reward');
    }

    get().markSaveDirty();
    get().syncRetentionProgress();
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
        let saveLoadFailed = false;
        if (hadSaveOnDisk) {
          const loadResult = await loadGameStateWithMeta();
          if (loadResult.state) {
            const loaded = await get().loadGame(loadResult);
            if (loaded) {
              hasHydratedGame = true;
              await get().refreshMarketSnapshot();
              await get().refreshSaveStatus();
              return;
            }
          }

          saveLoadFailed = true;
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
          pendingUpgradeTruckId: null,
          pendingFleetSubTab: null,
    pendingShopCategory: null,
          marketContractFilter: null,
          highlightedContractId: null,
        });
        resetAutoSaveTracking(0);
        hasHydratedGame = true;
        if (saveLoadFailed) {
          notifySaveLoadFailureOnce(get().currentTime, get().addNotification, get().saveError);
        }
        await get().refreshMarketSnapshot();
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
          pendingUpgradeTruckId: null,
          pendingFleetSubTab: null,
    pendingShopCategory: null,
          marketContractFilter: null,
          highlightedContractId: null,
        });
        resetAutoSaveTracking(0);
        hasHydratedGame = true;
      } finally {
        isLoadingSave = false;
        const meta = await loadOfflineMeta();
        if (meta?.lastSimulatedRealTimeMs) {
          cachedOfflineMetaLastSimulated = meta.lastSimulatedRealTimeMs;
          const current = get();
          set({
            lastSimulatedRealTimeMs: Math.max(
              current.lastSimulatedRealTimeMs ?? 0,
              meta.lastSimulatedRealTimeMs,
              current.lastSeenRealTimeMs ?? 0,
            ),
            lastSimulationGameSpeed:
              current.lastSimulationGameSpeed ?? meta.lastSimulationGameSpeed ?? current.gameSpeed,
          });
        }
        set({ isGameReady: true });
        patchSaveStatus(set, { isLoadingSave: false });
        get().refreshContractsFromMarket();
        get().checkMarketPriceAlerts({ sendLocal: false });
        get().applyOfflineProgressionIfNeeded('cold-start');
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
      pendingUpgradeTruckId: null,
      pendingFleetSubTab: null,
    pendingShopCategory: null,
      marketContractFilter: null,
      highlightedContractId: null,
      pendingMarketFocus: null,
    });
    resetAutoSaveTracking(0);
    get().autoSave('reset');
  },

  saveGame: async () => {
    const state = get();
    const saved = await saveGameState(state);
    if (!saved) {
      const userMessage = SAVE_WRITE_FAILURE_TOAST.message;
      patchSaveStatus(set, {
        hasSave: get().saveStatus.hasSave,
        isSaving: false,
        lastSaveError: __DEV__ ? 'saveGameState returned false' : userMessage,
      });
      notifySaveWriteFailureOnce(state.currentTime, get().addNotification, userMessage);
      return;
    }

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

    void syncLocalSaveToCloud(mapAutoSaveReasonToCloudSync(lastSaveReason), { state });
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
        cities: mergeCanonicalCities(saved.cities),
        routes: mergeCanonicalRoutes(saved.routes),
        monetization: normalizeMonetizationState(saved.monetization, saved.currentTime ?? 0),
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
        pendingUpgradeTruckId: null,
        pendingFleetSubTab: null,
    pendingShopCategory: null,
        marketContractFilter: null,
        highlightedContractId: null,
        pendingMarketFocus: null,
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
      get().checkMarketPriceAlerts({ sendLocal: false });
      get().advanceOnboardingProgress();
      get().syncRetentionProgress();

      const hydratedState = get();
      const pausedFuelJobs = [
        ...hydratedState.activeDeliveries,
        ...(hydratedState.activeTransfers ?? []),
        ...(hydratedState.activeWarehouseStockTransfers ?? []),
      ].filter(
        (job) => job.status === 'paused' && job.pausedReason === 'out-of-fuel',
      );
      if (pausedFuelJobs.length > 0) {
        const pausedIds = new Set(pausedFuelJobs.map((job) => job.id));
        const markHydratedFuelWarning = <
          T extends { id: string; fuelWarningsEmitted?: import('../types/game').FuelWarningKey[] },
        >(job: T): T =>
          pausedIds.has(job.id)
            ? {
                ...job,
                fuelWarningsEmitted: [
                  ...new Set([
                    ...(job.fuelWarningsEmitted ?? []),
                    'low-fuel' as const,
                    'critical-fuel' as const,
                    'insufficient-range' as const,
                    'out-of-fuel' as const,
                  ]),
                ],
              }
            : job;
        set({
          activeDeliveries: hydratedState.activeDeliveries.map(markHydratedFuelWarning),
          activeTransfers: (hydratedState.activeTransfers ?? []).map(markHydratedFuelWarning),
          activeWarehouseStockTransfers: (
            hydratedState.activeWarehouseStockTransfers ?? []
          ).map(markHydratedFuelWarning),
        });
        for (const job of pausedFuelJobs) {
          if (hydratedOutOfFuelNotificationJobIds.has(job.id)) continue;
          hydratedOutOfFuelNotificationJobIds.add(job.id);
          get().addNotification({
            id: `fuel-warning:${job.id}:out-of-fuel`,
            time: hydratedState.currentTime,
            type: 'error',
            title: 'Yakıt bitti',
            message: 'Yakıt bitti. Araç rota üzerinde durdu.',
            actionLabel: 'Haritada Gör',
            actionTarget: 'map',
          });
        }
      }

      // Soft-lock recovery — bozuk save / -$5000 sonrası alınabilir acil işler
      const loaded = get();
      const recoveryNowMs = getEconomyNow();
      const softLock = ensureEmergencyContractsForSoftLock({
        money: loaded.player.money ?? 0,
        contracts: loaded.contracts ?? [],
        trucks: loaded.player.trucks ?? [],
        products: loaded.products ?? [],
        routes: loaded.routes ?? [],
        globalEconomy: normalizeGlobalEconomy(loaded.globalEconomy),
        currentTime: loaded.currentTime,
        homeCityId: loaded.player.homeCityId,
        lastEmergencyContractAtMs: loaded.lastEmergencyContractAtMs,
        nowMs: recoveryNowMs,
      });
      const cashRecovery = evaluateSoftLockCashRecovery({
        money: loaded.player.money ?? 0,
        trucks: loaded.player.trucks ?? [],
        alreadyGrantedAtMs: loaded.cashRecoveryAssistanceGrantedAtMs,
      });
      const recoveryLedgerPatch =
        cashRecovery.allowed && cashRecovery.transaction
          ? patchFinanceLedger(loaded, {
              time: loaded.currentTime,
              type: 'income',
              category: 'recovery_assistance',
              amount: cashRecovery.transaction.amount,
              title: 'Operasyon kurtarma desteği',
              description:
                'Kredi tabanındaki şirketin yeniden iş alabilmesi için tek seferlik destek.',
              transactionId: cashRecovery.transaction.transactionId,
              referenceId: cashRecovery.transaction.referenceId,
            })
          : null;
      if (softLock.added.length > 0 || cashRecovery.allowed) {
        set({
          contracts: softLock.contracts,
          ...(cashRecovery.transaction
            ? {
                player: {
                  ...loaded.player,
                  money: cashRecovery.transaction.cashAfter,
                },
                ...recoveryLedgerPatch,
                cashRecoveryAssistanceGrantedAtMs: recoveryNowMs,
              }
            : {}),
          lastEmergencyContractAtMs: recoveryNowMs,
          globalEconomy: normalizeGlobalEconomy(loaded.globalEconomy),
        });
        get().markSaveDirty();
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

  deleteAccountAndCloudData: async () => {
    const result = await runAccountDeletion({
      clearLocalSave: async () => {
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
      },
    });

    return result;
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
    const nextSpeed = Math.max(0.25, Math.min(speed, 8));
    set({ gameSpeed: nextSpeed, lastSimulationGameSpeed: nextSpeed });
  },

  recordLastSeenRealTimeMs: () => {
    const nowMs = getSimulationRealNowMs();
    const simulationGameSpeed = getEffectiveOfflineGameSpeed(get());
    set({ lastSeenRealTimeMs: nowMs, lastSimulatedRealTimeMs: nowMs });
    persistOfflineMetaImmediate(nowMs, simulationGameSpeed);
  },

  dismissOfflineProgressSummary: () => {
    set({ pendingOfflineProgressSummary: null });
  },

  applyOfflineProgressionIfNeeded: (trigger = 'foreground') => {
    if (offlineProgressApplying || isLoadingSave || !get().isGameReady) {
      return;
    }

    const state = get();
    const nowMs = getSimulationRealNowMs();
    const simulationGameSpeed = getEffectiveOfflineGameSpeed(state);
    const plan = applyOfflineProgress({
      nowMs,
      lastSimulatedRealTimeMs: state.lastSimulatedRealTimeMs,
      lastOfflineProgressAppliedAt: state.lastOfflineProgressAppliedAt,
      lastSeenRealTimeMs: state.lastSeenRealTimeMs,
      metaLastSimulatedRealTimeMs: cachedOfflineMetaLastSimulated,
      gameState: state,
    });
    const baselineMs = plan.baselineMs;

    if (baselineMs == null) {
      set({
        lastSeenRealTimeMs: nowMs,
        lastSimulatedRealTimeMs: nowMs,
        lastProcessedEconomyAt: state.lastProcessedEconomyAt ?? nowMs,
        lastSeenMarketEpoch: getMarketEpoch(nowMs),
        offlineProgressVersion: OFFLINE_PROGRESS_VERSION,
      });
      persistOfflineMetaImmediate(nowMs, simulationGameSpeed);
      return;
    }

    if (plan.duplicatePrevented) {
      if (
        (typeof __DEV__ !== 'undefined' && __DEV__) ||
        process.env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED === 'true'
      ) {
        console.log('[offline-progress]', {
          trigger,
          elapsedRealMs: Math.max(0, nowMs - baselineMs),
          appliedSimHours: 0,
          capped: false,
          deliveriesAdvanced: 0,
          deliveriesCompleted: 0,
          transfersCompleted: 0,
          fuelStops: 0,
          costsProcessed: 0,
          duplicatePrevented: true,
        });
      }
      set({ lastSeenRealTimeMs: nowMs, lastSimulatedRealTimeMs: nowMs });
      persistOfflineMetaImmediate(nowMs, simulationGameSpeed);
      return;
    }

    const elapsed = plan.elapsed;
    if (!elapsed.shouldApply) {
      set({
        lastSeenRealTimeMs: nowMs,
        lastSimulatedRealTimeMs: nowMs,
        offlineProgressVersion: OFFLINE_PROGRESS_VERSION,
      });
      persistOfflineMetaImmediate(nowMs, simulationGameSpeed);
      return;
    }

    offlineProgressApplying = true;
    offlineProgressionActive = true;
    offlineProgressCollector = {
      earnings: 0,
      expenses: 0,
      completedDeliveries: 0,
      lateDeliveries: 0,
      driverLevelUps: [],
      worldEventsUpdated: false,
      marketUpdated: false,
      dailyCostsApplied: false,
    };

    const beforeSnapshot = createOfflineProgressSnapshot(state);
    const simulation = plan.simulation;
    const gameHours = simulation.appliedSimulationHours;
    const deliveryTicksApplied =
      gameHours > 0
        ? state.activeDeliveries.filter(
            (job) => job.status === 'on_route' || job.status === 'preparing',
          ).length
        : 0;
    const transferTicksApplied =
      gameHours > 0
        ? [
            ...(state.activeTransfers ?? []),
            ...(state.activeWarehouseStockTransfers ?? []),
          ].filter(
            (job) => job.status === 'active' || job.status === 'pending',
          ).length
        : 0;

    if (__DEV__) {
      const scale = buildTimeScaleDebugSnapshot(simulationGameSpeed);
      console.log(
        `[time-debug-offline] elapsedRealMs=${elapsed.elapsedMs} appliedRealMs=${elapsed.appliedMs} gameSpeed=${scale.gameSpeed} rawGameHours=${simulation.rawSimulationHours.toFixed(2)} cappedGameHours=${gameHours.toFixed(2)} gameHoursPerRealMinute=${scale.gameHoursPerRealMinute.toFixed(2)}`,
      );
    }

    const cashBefore = state.player.money ?? 0;
    const truckTransferIdsBefore = new Set((state.activeTransfers ?? []).map((job) => job.id));
    const warehouseTransferIdsBefore = new Set(
      (state.activeWarehouseStockTransfers ?? []).map((job) => job.id),
    );

    try {
      if (gameHours > 0) {
        get().advanceTime(gameHours);
      }
    } finally {
      offlineProgressionActive = false;
      offlineProgressApplying = false;
    }

    const progressedState = get();
    const periodic = buildPeriodicCostDeductions({
      player: progressedState.player,
      economyNowMs: nowMs,
      lastProcessedEconomyAt:
        progressedState.lastProcessedEconomyAt ?? baselineMs,
      alreadyAppliedPeriodKeys:
        progressedState.appliedEconomyPeriodKeys ?? [],
      maxOfflineCostPeriods: operatingCostBalance.maxOfflineChargeDays,
    });

    if (periodic.periodsCharged > 0) {
      offlineProgressionActive = true;
      try {
        get().processDailyOperatingCosts({
          days: periodic.periodsCharged,
          elapsedDays: periodic.periodsElapsed,
          reason: 'offline_catchup',
          currentTime: progressedState.currentTime,
          lastDailyOperatingCostTime: progressedState.currentTime,
          transactionId: `periodic-cost:${periodic.periodKeysApplied.join('|')}`,
          referenceId: `periodic-cost:${periodic.periodKeysApplied.join('|')}`,
        });
      } finally {
        offlineProgressionActive = false;
      }
    }

    const midState = get();
    const mergedPeriodKeys = [
      ...(midState.appliedEconomyPeriodKeys ?? []),
      ...periodic.periodKeysApplied,
    ].slice(-48);

    logTimeProgressionAudit(
      buildTimeProgressionAudit({
        trustedNow: nowMs,
        savedAt: state.lastSeenRealTimeMs ?? baselineMs,
        lastProcessedAt:
          progressedState.lastProcessedEconomyAt ?? baselineMs,
        elapsedMs: elapsed.elapsedMs,
        elapsedHours: elapsed.elapsedMs / HOUR_MS,
        cappedProgressHours: gameHours,
        costPeriods: periodic.periodsCharged,
        deliveryTicksApplied,
        transferTicksApplied,
        processedUntil: periodic.newlyProcessedUntil,
      }),
    );

    const softLock = ensureEmergencyContractsForSoftLock({
      money: midState.player.money ?? 0,
      contracts: midState.contracts ?? [],
      trucks: midState.player.trucks ?? [],
      products: midState.products ?? [],
      routes: midState.routes ?? [],
      globalEconomy: normalizeGlobalEconomy(midState.globalEconomy),
      currentTime: midState.currentTime,
      homeCityId: midState.player.homeCityId,
      lastEmergencyContractAtMs: midState.lastEmergencyContractAtMs,
      nowMs,
    });
    const cashRecovery = evaluateSoftLockCashRecovery({
      money: midState.player.money ?? 0,
      trucks: midState.player.trucks ?? [],
      alreadyGrantedAtMs: midState.cashRecoveryAssistanceGrantedAtMs,
    });
    const recoveryLedgerPatch =
      cashRecovery.allowed && cashRecovery.transaction
        ? patchFinanceLedger(midState, {
            time: midState.currentTime,
            type: 'income',
            category: 'recovery_assistance',
            amount: cashRecovery.transaction.amount,
            title: 'Operasyon kurtarma desteği',
            description:
              'Kredi tabanındaki şirketin yeniden iş alabilmesi için tek seferlik destek.',
            transactionId: cashRecovery.transaction.transactionId,
            referenceId: cashRecovery.transaction.referenceId,
          })
        : null;

    // Offline catch-up must not invent a new world snapshot/history. Keep the
    // last backend-verified cache until the next successful connection.
    const snapshot = midState.cachedGlobalEconomySnapshot;

    set({
      contracts: softLock.contracts,
      ...(cashRecovery.transaction
        ? {
            player: {
              ...midState.player,
              money: cashRecovery.transaction.cashAfter,
            },
            ...recoveryLedgerPatch,
            cashRecoveryAssistanceGrantedAtMs: nowMs,
          }
        : {}),
      lastProcessedEconomyAt: Math.max(
        midState.lastProcessedEconomyAt ?? 0,
        periodic.newlyProcessedUntil,
        nowMs,
      ),
      appliedEconomyPeriodKeys: mergedPeriodKeys,
      lastSeenMarketEpoch: snapshot?.epoch ?? midState.lastSeenMarketEpoch,
      cachedSnapshotVersion: snapshot?.version ?? midState.cachedSnapshotVersion,
      cachedSnapshotGeneratedAt:
        snapshot?.generatedAt ?? midState.cachedSnapshotGeneratedAt,
      globalMarketSyncStatus: snapshot ? 'offline-cache' : 'error',
      lastEmergencyContractAtMs:
        softLock.added.length > 0 ? nowMs : midState.lastEmergencyContractAtMs,
    });

    const afterState = get();
    const activeTruckTransferIdsAfter = new Set(
      (afterState.activeTransfers ?? []).map((job) => job.id),
    );
    const activeWarehouseTransferIdsAfter = new Set(
      (afterState.activeWarehouseStockTransfers ?? []).map((job) => job.id),
    );
    const completedTruckTransfers = [...truckTransferIdsBefore].filter(
      (id) => !activeTruckTransferIdsAfter.has(id),
    ).length;
    const completedWarehouseTransfers = [...warehouseTransferIdsBefore].filter(
      (id) => !activeWarehouseTransferIdsAfter.has(id),
    ).length;
    const collector = offlineProgressCollector ?? {
      earnings: 0,
      expenses: 0,
      completedDeliveries: 0,
      lateDeliveries: 0,
      driverLevelUps: [],
      worldEventsUpdated: false,
      marketUpdated: false,
      dailyCostsApplied: false,
    };
    offlineProgressCollector = null;

    if (__DEV__ && gameHours > 0) {
      const elapsedMin = Math.round(elapsed.appliedMs / MINUTE_MS);
      console.log(
        `[offline] elapsedReal=${elapsedMin}m gameHours=${gameHours.toFixed(1)} speed=${simulationGameSpeed} completed=${collector.completedDeliveries}`,
      );
    }

    const summary = buildOfflineProgressSummary(beforeSnapshot, afterState, elapsed, {
      earnings: collector.earnings,
      expenses: collector.expenses,
      completedDeliveries: collector.completedDeliveries,
      completedTruckTransfers,
      completedWarehouseTransfers,
      lateDeliveries: collector.lateDeliveries,
      worldEventsUpdated: collector.worldEventsUpdated,
      marketUpdated: collector.marketUpdated,
      dailyCostsApplied: collector.dailyCostsApplied,
    });

    if (
      (typeof __DEV__ !== 'undefined' && __DEV__) ||
      process.env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED === 'true'
    ) {
      const fuelStops = [
        ...afterState.activeDeliveries,
        ...(afterState.activeTransfers ?? []),
        ...(afterState.activeWarehouseStockTransfers ?? []),
      ].filter((job) => job.status === 'paused' && job.pausedReason === 'out-of-fuel').length;
      console.log('[offline-progress]', {
        trigger,
        elapsedRealMs: elapsed.elapsedMs,
        appliedSimHours: gameHours,
        capped: elapsed.capped || simulation.capped,
        deliveriesAdvanced: deliveryTicksApplied,
        deliveriesCompleted: summary.completedDeliveries,
        transfersCompleted: completedTruckTransfers + completedWarehouseTransfers,
        fuelStops,
        costsProcessed: periodic.periodsCharged,
        duplicatePrevented: plan.duplicatePrevented,
      });
    }

    if (__DEV__) {
      if (summary.completedDeliveries > 0 && summary.earnings <= 0) {
        console.warn('[offline-summary-debug] completed>0 but earnings=0', summary);
      }
      console.log(
        `[offline-summary-debug] completed=${summary.completedDeliveries} late=${summary.lateDeliveries} earnings=${summary.earnings} expenses=${summary.expenses} other=${summary.otherNetChange} beforeMoney=${beforeSnapshot.money} afterMoney=${afterState.player.money ?? 0} net=${summary.netChange} ledgerEntries=${summary.ledgerEntryCount}`,
      );
    }

    set({
      lastSeenRealTimeMs: nowMs,
      lastSimulatedRealTimeMs: nowMs,
      lastOfflineProgressAppliedAt: nowMs,
      offlineProgressVersion: OFFLINE_PROGRESS_VERSION,
      pendingOfflineProgressSummary: shouldShowOfflineSummary(summary) ? summary : null,
    });
    persistOfflineMetaImmediate(nowMs, simulationGameSpeed);

    if (shouldShowOfflineSummary(summary) || softLock.added.length > 0) {
      get().markSaveDirty();
      get().autoSave('offline_progress');
    }
  },

  advanceTime: (hours: number) => {
    const state = get();
    if (hours <= 0) {
      return;
    }
    if (state.isPaused && !offlineProgressionActive) {
      return;
    }

    const simulationGameSpeed = getEffectiveOfflineGameSpeed(state);
    if (!offlineProgressionActive) {
      const nowMs = getSimulationRealNowMs();
      set({ lastSimulationGameSpeed: simulationGameSpeed, lastSimulatedRealTimeMs: nowMs });
      schedulePersistOfflineMeta(nowMs, simulationGameSpeed);
    }

    const newTime = state.currentTime + hours;

    set({ currentTime: newTime });

    get().updateDeliveries(hours);
    get().updateTransfers(hours);
    get().updateWarehouseStockTransfers(hours);

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

    // Maaş/depo/operasyon giderleri hızlandırılmış oyun gününden değil,
    // trusted gerçek zaman cursor'ından işlenir. Offline catch-up kendi
    // bounded period uygulamasını advanceTime sonrasında yapar.
    if (!offlineProgressionActive) {
      const costState = get();
      const economyNowMs = getEconomyNow();
      const periodic = buildPeriodicCostDeductions({
        player: costState.player,
        economyNowMs,
        lastProcessedEconomyAt: costState.lastProcessedEconomyAt,
        alreadyAppliedPeriodKeys: costState.appliedEconomyPeriodKeys ?? [],
        maxOfflineCostPeriods: operatingCostBalance.maxOfflineChargeDays,
      });

      if (periodic.periodsCharged > 0) {
        get().processDailyOperatingCosts({
          days: periodic.periodsCharged,
          elapsedDays: periodic.periodsElapsed,
          reason:
            periodic.periodsElapsed > 1 || periodic.capped
              ? 'offline_catchup'
              : 'daily_tick',
          currentTime: newTime,
          lastDailyOperatingCostTime: newTime,
          transactionId: `periodic-cost:${periodic.periodKeysApplied.join('|')}`,
          referenceId: `periodic-cost:${periodic.periodKeysApplied.join('|')}`,
        });
      }

      const afterCosts = get();
      set({
        lastProcessedEconomyAt: periodic.newlyProcessedUntil,
        appliedEconomyPeriodKeys: [
          ...(afterCosts.appliedEconomyPeriodKeys ?? []),
          ...periodic.periodKeysApplied,
        ].slice(-48),
        dailyOperatingCostDebug: buildDailyOperatingCostDebugSnapshot(
          { ...afterCosts, currentTime: newTime },
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
      lastPlayableContractGeneratedTime:
        stateBeforeContracts.lastPlayableContractGeneratedTime ?? 0,
    });

    const contractPatch: Partial<StoreGameState> = {
      contracts: scheduleResult.contracts,
      lastContractGenerationTime: scheduleResult.lastContractGenerationTime,
      lastMarketRefreshTime: scheduleResult.lastMarketRefreshTime,
      lastDailyCleanupTime: scheduleResult.lastDailyCleanupTime,
      lastPlayableContractGeneratedTime: scheduleResult.lastPlayableContractGeneratedTime,
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
    if (!offlineProgressionActive) {
      get().autoSave('time_tick');
    }
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

    const requestedTotalCost = breakdown.total * chargedDays;
    const referenceId =
      options?.referenceId ??
      `daily-operating:${Math.floor(currentTime)}:${chargedDays}`;
    const transactionId = options?.transactionId ?? `cash:${referenceId}`;
    const cashTransaction = applyCashTransaction({
      currentCash: state.player.money ?? 0,
      amount: requestedTotalCost,
      kind: 'mandatory-expense',
      referenceId,
      transactionId,
      appliedTransactionIds: (state.financeLedger ?? [])
        .map((entry) => entry.transactionId)
        .filter((value): value is string => typeof value === 'string'),
    });
    if (!cashTransaction.ok && cashTransaction.reason === 'duplicate-transaction') {
      return;
    }
    const totalCost = cashTransaction.amount;
    if (offlineProgressionActive && offlineProgressCollector) {
      offlineProgressCollector.expenses += totalCost;
      offlineProgressCollector.dailyCostsApplied = totalCost > 0;
    }
    const requestedLedgerEntry = buildSummarizedDailyOperatingCostLedgerEntry(
      breakdown,
      currentTime,
      chargedDays,
      elapsedDays,
    );
    const paidRatio =
      requestedTotalCost > 0 ? totalCost / requestedTotalCost : 0;
    const ledgerEntry =
      requestedLedgerEntry && totalCost > 0
        ? {
            ...requestedLedgerEntry,
            amount: totalCost,
            transactionId: cashTransaction.transactionId,
            referenceId: cashTransaction.referenceId,
            ...(requestedLedgerEntry.breakdown
              ? {
                  breakdown: {
                    driverSalary:
                      requestedLedgerEntry.breakdown.driverSalary * paidRatio,
                    warehouseOperating:
                      requestedLedgerEntry.breakdown.warehouseOperating * paidRatio,
                    generalOperations:
                      requestedLedgerEntry.breakdown.generalOperations * paidRatio,
                    chargedTruckLease:
                      requestedLedgerEntry.breakdown.chargedTruckLease * paidRatio,
                  },
                }
              : {}),
          }
        : null;

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
        money: cashTransaction.cashAfter,
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

    if (shouldSurfaceCatchup && eventLogMessage && !offlineProgressionActive) {
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

    if (shouldNotify && notificationMessage && !offlineProgressionActive) {
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
    // Global prices/events are backend-owned. A simulation tick only requests
    // the canonical current snapshot; it never rolls local market state.
    void get().refreshMarketSnapshot();
  },

  refreshMarketSnapshot: () => {
    if (globalMarketRefreshInFlight) return globalMarketRefreshInFlight;
    const operation = (async () => {
    let before = get();
    if (!before.cachedGlobalEconomySnapshot) {
      const persistedCache = await loadGlobalEconomyCache();
      if (persistedCache) {
        set({
          cachedGlobalEconomySnapshot: persistedCache.snapshot,
          cachedGlobalEconomySnapshotTrusted: true,
          globalMarketSyncStatus: 'offline-cache',
          globalMarketLastSyncedAtMs: persistedCache.loadedAt,
          globalMarketErrorCode: null,
        });
        before = get();
      }
    }
    const canUseCachedSnapshot =
      !!before.cachedGlobalEconomySnapshot &&
      before.cachedGlobalEconomySnapshotTrusted === true &&
      validateGlobalEconomySnapshot(before.cachedGlobalEconomySnapshot).marketDataValid;
    const cacheAgeMs =
      canUseCachedSnapshot && before.globalMarketLastSyncedAtMs != null
        ? Math.max(0, getEconomyNow() - before.globalMarketLastSyncedAtMs)
        : null;
    set({ globalMarketSyncStatus: 'syncing', globalMarketErrorCode: null });

    const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? null;
    const online =
      typeof navigator !== 'undefined' && 'onLine' in navigator
        ? navigator.onLine
        : null;

    // Production Firestore rules require signedIn(); auth bootstrap race'ini kapat.
    // Sıra: auth ready + currentUser olmadan globalEconomy/current okunmaz.
    let authReady = false;
    let authUser: { uid: string; isAnonymous: boolean } | null = null;
    try {
      const { initAnonymousAuth, isAuthSessionReady } = await import(
        '../services/authService'
      );
      await initAnonymousAuth();
      authReady = isAuthSessionReady();
      const { getFirebaseAuthSafe } = await import('../services/firebase');
      const user = getFirebaseAuthSafe()?.currentUser ?? null;
      authUser = user
        ? { uid: user.uid, isAnonymous: Boolean(user.isAnonymous) }
        : null;
    } catch (authError) {
      console.warn('[global-economy-load-failed]', {
        code: 'auth-bootstrap-failed',
        projectId,
        path: 'globalEconomy/current',
        authReady: false,
        userPresent: false,
        anonymous: null,
        online,
        detail:
          authError instanceof Error ? authError.message : String(authError),
      });
      const { recordGlobalEconomyResult } = await import(
        '../services/backendDiagnostics'
      );
      recordGlobalEconomyResult({
        success: false,
        code: 'unauthenticated',
        diagnostics: {
          documentExists: false,
          validationPassed: canUseCachedSnapshot,
          source: canUseCachedSnapshot ? 'cached' : 'unavailable',
          snapshotAgeMs: cacheAgeMs,
          fuelPriceFinite: Number.isFinite(before.cachedGlobalEconomySnapshot?.fuelPricePerLiter),
          cacheAvailable: canUseCachedSnapshot,
          cacheAgeMs,
        },
      });
      set({
        globalMarketSyncStatus: canUseCachedSnapshot
          ? 'offline-cache'
          : 'error',
        globalMarketErrorCode: 'unauthenticated',
      });
      logGlobalEconomyLoadResult({
        success: false,
        code: 'unauthenticated',
        projectId,
        path: 'globalEconomy/current',
        authReady: false,
        userPresent: false,
        userAnonymous: null,
        online,
        documentExists: false,
        snapshotEpochPresent: Boolean(before.cachedGlobalEconomySnapshot?.epoch),
        fuelPricePresent: Number.isFinite(before.cachedGlobalEconomySnapshot?.fuelPricePerLiter),
        validationPassed: canUseCachedSnapshot,
        cacheAvailable: canUseCachedSnapshot,
        cacheAgeMs,
      });
      return {
        success: canUseCachedSnapshot,
        source: canUseCachedSnapshot ? ('cache' as const) : ('unavailable' as const),
        stale: true,
      };
    }

    if (!canReadGlobalEconomy({ authReady, userPresent: Boolean(authUser) })) {
      console.warn('[global-economy-load-failed]', {
        code: 'unauthenticated',
        projectId,
        path: 'globalEconomy/current',
        authReady,
        userPresent: Boolean(authUser),
        anonymous: authUser?.isAnonymous ?? null,
        online,
        detail:
          'request.auth yok — Firestore signedIn() kuralı permission-denied üretir; okuma atlandı',
      });
      const { recordGlobalEconomyResult } = await import(
        '../services/backendDiagnostics'
      );
      recordGlobalEconomyResult({
        success: false,
        code: 'unauthenticated',
        detail: 'no-current-user-before-economy-read',
        diagnostics: {
          documentExists: false,
          validationPassed: canUseCachedSnapshot,
          source: canUseCachedSnapshot ? 'cached' : 'unavailable',
          snapshotAgeMs: cacheAgeMs,
          fuelPriceFinite: Number.isFinite(before.cachedGlobalEconomySnapshot?.fuelPricePerLiter),
          cacheAvailable: canUseCachedSnapshot,
          cacheAgeMs,
        },
      });
      set({
        globalMarketSyncStatus: canUseCachedSnapshot
          ? 'offline-cache'
          : 'error',
        globalMarketErrorCode: 'unauthenticated',
      });
      logGlobalEconomyLoadResult({
        success: false,
        code: 'unauthenticated',
        projectId,
        path: 'globalEconomy/current',
        authReady,
        userPresent: Boolean(authUser),
        userAnonymous: authUser?.isAnonymous ?? null,
        online,
        documentExists: false,
        snapshotEpochPresent: Boolean(before.cachedGlobalEconomySnapshot?.epoch),
        fuelPricePresent: Number.isFinite(before.cachedGlobalEconomySnapshot?.fuelPricePerLiter),
        validationPassed: canUseCachedSnapshot,
        cacheAvailable: canUseCachedSnapshot,
        cacheAgeMs,
      });
      return {
        success: canUseCachedSnapshot,
        source: canUseCachedSnapshot ? ('cache' as const) : ('unavailable' as const),
        stale: true,
      };
    }

    let repository = getGlobalEconomyRepository();
    if (!repository) {
      const [{ getFirestoreSafe }, { FirestoreGlobalEconomyRepository }] =
        await Promise.all([
          import('../services/firebase'),
          import('../services/firestoreGlobalEconomyRepository'),
        ]);
      const firestore = getFirestoreSafe();
      if (firestore) {
        repository = new FirestoreGlobalEconomyRepository(firestore);
      }
    }
    if (!repository) {
      const { recordGlobalEconomyResult } = await import(
        '../services/backendDiagnostics'
      );
      recordGlobalEconomyResult({
        success: false,
        code: 'unavailable',
        diagnostics: {
          documentExists: false,
          validationPassed: canUseCachedSnapshot,
          source: canUseCachedSnapshot ? 'cached' : 'unavailable',
          snapshotAgeMs: cacheAgeMs,
          fuelPriceFinite: Number.isFinite(before.cachedGlobalEconomySnapshot?.fuelPricePerLiter),
          cacheAvailable: canUseCachedSnapshot,
          cacheAgeMs,
        },
      });
      set({
        globalMarketSyncStatus: canUseCachedSnapshot
          ? 'offline-cache'
          : 'error',
        globalMarketErrorCode: 'unavailable',
      });
      logGlobalEconomyLoadResult({
        success: false,
        code: 'unavailable',
        projectId,
        path: 'globalEconomy/current',
        authReady,
        userPresent: Boolean(authUser),
        userAnonymous: authUser?.isAnonymous ?? null,
        online,
        documentExists: false,
        snapshotEpochPresent: Boolean(before.cachedGlobalEconomySnapshot?.epoch),
        fuelPricePresent: Number.isFinite(before.cachedGlobalEconomySnapshot?.fuelPricePerLiter),
        validationPassed: canUseCachedSnapshot,
        cacheAvailable: canUseCachedSnapshot,
        cacheAgeMs,
      });
      return {
        success: canUseCachedSnapshot,
        source: canUseCachedSnapshot ? ('cache' as const) : ('unavailable' as const),
        stale: true,
      };
    }

    try {
      const result = await repository.getCurrentSnapshot();
      const snapshot = result.snapshot;
      if (!snapshot) {
        const { recordGlobalEconomyResult } = await import(
          '../services/backendDiagnostics'
        );
        recordGlobalEconomyResult({
          success: false,
          code: 'not-found',
          diagnostics: {
            documentExists: false,
            validationPassed: canUseCachedSnapshot,
            source: canUseCachedSnapshot ? 'cached' : 'unavailable',
            snapshotAgeMs: cacheAgeMs,
            fuelPriceFinite: Number.isFinite(before.cachedGlobalEconomySnapshot?.fuelPricePerLiter),
            cacheAvailable: canUseCachedSnapshot,
            cacheAgeMs,
          },
        });
        set({
          globalMarketSyncStatus: canUseCachedSnapshot
            ? 'offline-cache'
            : 'error',
          globalMarketErrorCode: 'not-found',
        });
        logGlobalEconomyLoadResult({
          success: false,
          code: 'not-found',
          projectId,
          path: 'globalEconomy/current',
          authReady,
          userPresent: Boolean(authUser),
          userAnonymous: authUser?.isAnonymous ?? null,
          online,
          documentExists: false,
          snapshotEpochPresent: Boolean(before.cachedGlobalEconomySnapshot?.epoch),
          fuelPricePresent: Number.isFinite(before.cachedGlobalEconomySnapshot?.fuelPricePerLiter),
          validationPassed: canUseCachedSnapshot,
          cacheAvailable: canUseCachedSnapshot,
          cacheAgeMs,
        });
        return {
          success: canUseCachedSnapshot,
          source: canUseCachedSnapshot ? ('cache' as const) : ('unavailable' as const),
          stale: true,
        };
      }

      if (result.serverTimeMs != null) {
        getEconomyClock().syncFromServer?.(result.serverTimeMs);
      }
      const validation = validateGlobalEconomySnapshot(snapshot);
      if (!validation.marketDataValid) {
        throw Object.assign(new Error('GLOBAL_ECONOMY_INVALID_SNAPSHOT'), {
          code: 'invalid-snapshot',
        });
      }
      const live = get();
      const globalEconomy = normalizeGlobalEconomy({
        ...live.globalEconomy,
        fuelPrice: validation.fuelPriceValid
          ? snapshot.fuelPricePerLiter
          : live.globalEconomy.fuelPrice,
        globalDemandMultiplier: snapshot.modifiers.demandMultiplier,
        eventMultiplier: snapshot.activeEvents.length > 0 ? 1.05 : 1,
      });
      const loadedAt = result.serverTimeMs ?? getEconomyNow();

      // Current snapshot is canonical. Optional history failure must not discard it.
      set({
        cachedGlobalEconomySnapshot: snapshot,
        cachedGlobalEconomySnapshotTrusted: result.source === 'backend',
        globalMarketSyncStatus:
          result.source === 'backend' ? 'online' : 'offline-cache',
        globalMarketLastSyncedAtMs: loadedAt,
        globalMarketErrorCode: null,
        lastSeenMarketEpoch: snapshot.epoch,
        cachedSnapshotVersion: snapshot.version,
        cachedSnapshotGeneratedAt: snapshot.generatedAt,
        globalEconomy,
        cities: materializeSnapshotCities(CITIES, snapshot, live.globalMarketHistory),
        worldEvents: snapshot.activeEvents,
      });
      if (result.source === 'backend') {
        await saveGlobalEconomyCache(snapshot, loadedAt).catch(() => undefined);
      }
      get().markSaveDirty();
      get().checkMarketPriceAlerts();
      const { recordGlobalEconomyResult } = await import(
        '../services/backendDiagnostics'
      );
      recordGlobalEconomyResult({
        success: true,
        code: null,
        detail: `source=${result.source};fuel=${validation.fuelPriceValid ? 'valid' : 'invalid'}`,
        diagnostics: {
          documentExists: true,
          validationPassed: validation.marketDataValid,
          source: result.source === 'backend' ? 'live' : 'cached',
          snapshotAgeMs: Math.max(0, loadedAt - snapshot.generatedAt),
          fuelPriceFinite: validation.fuelPriceValid,
          cacheAvailable: true,
          cacheAgeMs: 0,
        },
      });
      logGlobalEconomyLoadResult({
        success: true,
        code: null,
        projectId,
        path: 'globalEconomy/current',
        authReady,
        userPresent: true,
        userAnonymous: authUser?.isAnonymous ?? null,
        online,
        documentExists: true,
        snapshotEpochPresent: Number.isFinite(snapshot.epoch),
        fuelPricePresent: validation.fuelPriceValid,
        validationPassed: validation.marketDataValid,
        cacheAvailable: true,
        cacheAgeMs: 0,
      });

      try {
        const epochDurationMs = Math.max(1, snapshot.validUntil - snapshot.generatedAt);
        const epochsPerDay = Math.max(1, Math.round(DAY_MS / epochDurationMs));
        const history = await repository.getHistory({
          fromEpoch: Math.max(
            0,
            snapshot.epoch - epochsPerDay * INITIAL_GLOBAL_HISTORY_DAYS,
          ),
          toEpoch: snapshot.epoch,
          limit: INITIAL_GLOBAL_HISTORY_LIMIT,
        });
        set({
          globalMarketHistory: history,
          cities: materializeSnapshotCities(CITIES, snapshot, history),
        });
      } catch (historyError) {
        console.warn('[global-economy-history-load-result]', {
          success: false,
          code: categorizeGlobalEconomyClientError(historyError),
          currentSnapshotPreserved: true,
          requestedLimit: INITIAL_GLOBAL_HISTORY_LIMIT,
        });
      }
      return {
        success: true,
        source: result.source,
        stale: result.source !== 'backend',
      };
    } catch (error) {
      const firebaseCode =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code ?? '')
          : error instanceof Error
            ? error.message
            : String(error);
      const category = categorizeGlobalEconomyClientError(error);
      console.warn('[global-economy-load-failed]', {
        firebaseCode: firebaseCode || null,
        code: category,
        projectId,
        path: 'globalEconomy/current',
        authReady,
        userPresent: Boolean(authUser),
        anonymous: authUser?.isAnonymous ?? null,
        online,
      });
      const { recordGlobalEconomyResult } = await import(
        '../services/backendDiagnostics'
      );
      recordGlobalEconomyResult({
        success: false,
        code: category,
        detail: firebaseCode || null,
        diagnostics: {
          documentExists: category === 'invalid-snapshot' || category === 'parse-failed',
          validationPassed: canUseCachedSnapshot,
          source: canUseCachedSnapshot ? 'cached' : 'unavailable',
          snapshotAgeMs: cacheAgeMs,
          fuelPriceFinite: Number.isFinite(
            before.cachedGlobalEconomySnapshot?.fuelPricePerLiter,
          ),
          cacheAvailable: canUseCachedSnapshot,
          cacheAgeMs,
        },
      });
      set({
        globalMarketSyncStatus: canUseCachedSnapshot
          ? 'offline-cache'
          : 'error',
        globalMarketErrorCode: category,
      });
      logGlobalEconomyLoadResult({
        success: false,
        code: category,
        projectId,
        path: 'globalEconomy/current',
        authReady,
        userPresent: Boolean(authUser),
        userAnonymous: authUser?.isAnonymous ?? null,
        online,
        documentExists: category === 'invalid-snapshot' || category === 'parse-failed',
        snapshotEpochPresent: Boolean(before.cachedGlobalEconomySnapshot?.epoch),
        fuelPricePresent: Number.isFinite(
          before.cachedGlobalEconomySnapshot?.fuelPricePerLiter,
        ),
        validationPassed: canUseCachedSnapshot,
        cacheAvailable: canUseCachedSnapshot,
        cacheAgeMs,
      });
      return {
        success: canUseCachedSnapshot,
        source: canUseCachedSnapshot ? ('cache' as const) : ('unavailable' as const),
        stale: true,
      };
    }
    })();
    globalMarketRefreshInFlight = operation;
    void operation.finally(() => {
      if (globalMarketRefreshInFlight === operation) {
        globalMarketRefreshInFlight = null;
      }
    });
    return operation;
  },

  refreshContractsFromMarket: (options?: { bypassCooldown?: boolean }) => {
    const state = get();
    if (!state.player) {
      return;
    }

    const bypassCooldown = options?.bypassCooldown === true;
    const refreshParams = buildContractRefreshParams(state);
    const playerLevel = refreshParams.playerLevel;
    const playableCount = countPlayableContracts(
      state.contracts ?? [],
      refreshParams.trucks,
      refreshParams.drivers,
      playerLevel,
      state.currentTime,
    );
    const idleTruckCount = getIdleTrucks(refreshParams.trucks).length;
    const previousContracts = state.contracts ?? [];

    if (playableCount === 0 && idleTruckCount > 0) {
      const playableResult = ensurePlayableContractSupply({
        ...refreshParams,
        contracts: previousContracts,
        maxNewContracts: contractGenerationBalance.manualRefreshPlayableContractCount,
        forceFallback: true,
        lastPlayableContractGeneratedTime: state.lastPlayableContractGeneratedTime ?? 0,
      });

      if (playableResult.newContracts.length > 0) {
        set({
          contracts: playableResult.contracts,
          lastPlayableContractGeneratedTime:
            playableResult.updatedLastPlayableContractGeneratedTime ??
            state.lastPlayableContractGeneratedTime,
          lastManualContractRefreshTime: state.currentTime,
        });
        get().markSaveDirty();
        get().autoSave('contracts_generated');
      } else {
        get().refreshMarketSnapshot();
      }
      lastContractMarketRefreshAt = getEconomyNow();
      return;
    }

    const hoursSinceManual =
      state.currentTime - (state.lastManualContractRefreshTime ?? 0);
    if (
      !bypassCooldown &&
      hoursSinceManual < contractGenerationBalance.manualRefreshCooldownHours
    ) {
      get().refreshMarketSnapshot();
      lastContractMarketRefreshAt = getEconomyNow();
      return;
    }

    const { contracts: updatedContracts, newContracts } = refreshContractsFromMarket(
      refreshParams,
    );

    const contractsChanged =
      newContracts.length > 0 ||
      updatedContracts.length !== previousContracts.length ||
      updatedContracts.some(
        (contract, index) => previousContracts[index]?.status !== contract.status,
      );

    lastContractMarketRefreshAt = getEconomyNow();

    if (!contractsChanged) {
      get().refreshMarketSnapshot();
      set({ lastManualContractRefreshTime: state.currentTime });
      return;
    }

    const patch: Partial<StoreGameState> = {
      contracts: updatedContracts,
      lastManualContractRefreshTime: state.currentTime,
    };

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

  forceGeneratePlayableContracts: () => {
    const state = get();
    if (!state.player) {
      return 0;
    }

    const refreshParams = buildContractRefreshParams(state);
    if (getIdleTrucks(refreshParams.trucks).length === 0) {
      return 0;
    }

    const result = ensurePlayableContractSupply({
      ...refreshParams,
      contracts: state.contracts ?? [],
      maxNewContracts: contractGenerationBalance.maxPlayableContractsGeneratedAtOnce,
      forceFallback: true,
      lastPlayableContractGeneratedTime: state.lastPlayableContractGeneratedTime ?? 0,
    });

    if (result.newContracts.length === 0) {
      return 0;
    }

    set({
      contracts: result.contracts,
      lastPlayableContractGeneratedTime:
        result.updatedLastPlayableContractGeneratedTime ?? state.currentTime,
    });
    get().markSaveDirty();
    get().autoSave('contracts_generated');
    return result.newContracts.length;
  },

  getContractRefreshRemainingSeconds: () => {
    const elapsed = getEconomyNow() - lastContractMarketRefreshAt;
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
    const refreshParams = buildContractRefreshParams(state);
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
        ownedMaxTruckCapacity:
          refreshParams.ownedMaxTruckCapacity || getMaxContractTonnageForLevel(playerLevel),
        idleMaxTruckCapacity: refreshParams.idleMaxTruckCapacity,
        idleTruckOriginCityIds: refreshParams.idleTruckOriginCityIds,
        activeDeliveryDestinationCityIds: refreshParams.activeDeliveryDestinationCityIds,
        busyTruckOriginCityIds: refreshParams.busyTruckOriginCityIds,
        fleetCityContext: refreshParams.fleetCityContext,
        activeWorldEvents: refreshParams.activeWorldEvents,
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

  debugGenerateContractsFromCurrentCity: () => {
    const state = get();
    const empty: DebugContractGenerationResult = {
      batchId: 'none',
      originCityId: 'unknown',
      createdDestinations: [],
      skippedDestinations: [],
      createdCount: 0,
      storedCount: 0,
      storedDestinations: [],
      contracts: [],
      forceUnlockCities: true,
      traces: [],
    };

    if (!state.player) {
      return empty;
    }

    // Patch old saves missing expanded cities/routes into live store (no schema change).
    const cities = mergeCanonicalCities(state.cities);
    const routes = mergeCanonicalRoutes(state.routes);
    if (catalogNeedsCanonicalMerge(state.cities, state.routes)) {
      set({ cities, routes });
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('[debug-contract-catalog-merge]', {
          citiesBefore: state.cities.length,
          citiesAfter: cities.length,
          routesBefore: state.routes.length,
          routesAfter: routes.length,
        });
      }
    }

    const live = get();
    const playerLevel = Math.max(1, live.player?.level ?? live.player?.companyLevel ?? 1);
    const batchId = createDebugContractBatchId(live.currentTime);
    const storeContractsBefore = live.contracts;

    const generated = generateDebugContractsFromCurrentCity({
      cities: live.cities,
      routes: live.routes,
      products: live.products,
      globalEconomy: live.globalEconomy,
      trucks: live.player!.trucks,
      homeCityId: live.player!.homeCityId,
      playerLevel,
      playerReputation: live.player!.reputation ?? 0,
      currentTime: live.currentTime,
      maxTruckCapacity:
        getHighestOwnedTruckCapacity(live.player!.trucks) ||
        getMaxContractTonnageForLevel(playerLevel),
      // Debug force: unlock + uncalibrated destinations still get list jobs.
      respectCityUnlockRules: false,
      batchId,
      storeCountBefore: storeContractsBefore.length,
    });

    reportUncalibratedExtendedSegments(generated.originCityId);

    // Single store update — never per-destination set() with stale snapshots.
    if (generated.contracts.length > 0) {
      const merged = mergeContractsWithDedupe(storeContractsBefore, generated.contracts);
      set({ contracts: merged });
      get().markSaveDirty();
      get().autoSave('contracts_generated');
    }

    const storeContractsAfter = get().contracts;
    const finalized = finalizeDebugContractTraces({
      result: generated,
      storeContractsBefore,
      storeContractsAfter,
    });

    assertDebugAnkaraAdanaContract({
      originCityId: finalized.originCityId,
      storeContracts: storeContractsAfter,
      batchId,
    });

    return finalized;
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

    if (isContractOfferExpired(contract, state.currentTime)) {
      return {
        success: false,
        errorCode: 'CONTRACT_EXPIRED',
        message: 'İşin süresi doldu.',
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

    if (truck.status === 'marketplace_locked') {
      return {
        success: false,
        errorCode: 'TRUCK_BUSY',
        message: 'Bu kamyon Araç Pazarı’nda olduğu için yönlendirilemez.',
      };
    }

    if (truck.leaseExpired) {
      return {
        success: false,
        errorCode: 'TRUCK_BUSY',
        message: 'Kiralama süresi dolan kamyon yönlendirilemez.',
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
    const trailers = state.player.trailers ?? [];

    if (!canTruckCarryContract(truck, contract, product, trailers)) {
      const capacitySnapshot = buildDeliveryStartCapacitySnapshot({
        contract,
        truck,
        trailers,
        product,
      });
      return {
        success: false,
        errorCode: 'CAPACITY_INSUFFICIENT',
        message: formatDeliveryCapacityFailureMessage({
          cargoWeight: capacitySnapshot.requiredTonnage,
          effectiveCapacity: capacitySnapshot.effectiveCapacity,
          truckName: truck.name,
        }),
      };
    }

    if ((truck.condition ?? 0) < MIN_TRUCK_CONDITION_FOR_DELIVERY) {
      return {
        success: false,
        errorCode: 'TRUCK_CONDITION_TOO_LOW',
        message: `Kamyon kondisyonu çok düşük (%${Math.round(truck.condition ?? 0)}). Önce tamir et.`,
      };
    }

    if (!isTruckAvailableForAssignment(truck, state.currentTime)) {
      return {
        success: false,
        errorCode: 'LEASE_EXPIRED',
        message: 'Kiralık kamyonun süresi doldu.',
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
      logDeliveryStartCapacity({ contract, truck, trailers, product });
      delivery = createDelivery({
        contract,
        truck,
        driver,
        route,
        product,
        globalEconomy: state.globalEconomy,
        currentTime: state.currentTime,
        sequence: state.activeDeliveries.length + 1,
        trailers,
        activeWorldEvents: getActiveWorldEvents(
          state.worldEvents ?? [],
          gameDayFromTime(state.currentTime),
        ),
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

    const deliveryFuelReadiness = getTruckFuelReadiness(
      truck,
      delivery.fuelLitersTotal ?? 0,
      getSnapshotFuelPrice(state.cachedGlobalEconomySnapshot, state.globalEconomy),
    );
    if (!deliveryFuelReadiness.canCompleteWithoutRefuel) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_FUEL',
        message: `Bu rota için ${Math.ceil(deliveryFuelReadiness.requiredFuelL)} L yakıt gerekiyor. Kamyonda ${Math.floor(deliveryFuelReadiness.currentFuelL)} L var.`,
      };
    }

    const routeLabel = `${getCityName(contract.originCityId)} → ${getCityName(contract.destinationCityId)}`;
    const deliveryStartEventId = `event_delivery_start_${delivery.id}`;

    const updatedTrucks = state.player.trucks.map((t) =>
      t.id === truckId ? { ...t, status: 'on_route' as const } : t,
    );

    const updatedDrivers = state.player.drivers.map((d) =>
      d.id === driverId
        ? {
            ...d,
            status: 'driving' as const,
            assignedTruckId: truckId,
            currentCityId: resolveTruckCityId(truck, state.player.homeCityId),
          }
        : d,
    );

    const updatedContracts = state.contracts.map((c) =>
      c.id === contractId ? { ...c, status: 'active' as const } : c,
    );

    const cashBeforeStart = state.player.money;
    // Yakıt litre satın alımında ödenmiştir; görev başlangıcı tekrar tahsilat yapmaz.
    const cashAfterStart = cashBeforeStart;

    const updatedTrailers = syncTrailersWithTruckLocation(
      trailers,
      truckId,
      originCityId,
      'on_route',
    );

    set({
      player: {
        ...state.player,
        money: cashAfterStart,
        trucks: updatedTrucks,
        drivers: updatedDrivers,
        trailers: updatedTrailers,
      },
      contracts: updatedContracts,
      activeDeliveries: [...state.activeDeliveries, delivery],
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
    get().advanceOnboardingProgress();
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
      state.currentTime,
      state.player.reputation ?? 0,
      state.player.homeCityId,
      state.player.trailers,
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
      state.player.homeCityId,
      state.player.trailers,
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
    const fuelWarningsToNotify: Array<{
      jobId: string;
      title: string;
      message: string;
      key: string;
    }> = [];
    const incidentNotifications: Array<{ deliveryId: string; title: string }> = [];
    const contractById = new Map(state.contracts.map((contract) => [contract.id, contract]));
    const latestIncident = getLatestDeliveryIncident(state.activeDeliveries);
    let pendingIncidentReserved = state.activeDeliveries.some(
      (delivery) => delivery.incident?.status === 'pending' && !delivery.incidentResolved,
    );
    const incidentCooldownActive = isDeliveryIncidentCooldownActive(
      state.activeDeliveries,
      state.currentTime,
    );

    let updatedTrucks = state.player.trucks;
    const updatedDeliveries = state.activeDeliveries.map((delivery) => {
      if (delivery.status !== 'on_route' && delivery.status !== 'preparing') {
        if (delivery.status === 'paused' && delivery.pausedReason === 'out-of-fuel') {
          const truck = updatedTrucks.find((candidate) => candidate.id === delivery.truckId);
          if (truck) {
            const advanced = updateDeliveryProgressWithFuel(
              delivery,
              truck,
              hoursPassed,
              state.currentTime,
            );
            updatedTrucks = updatedTrucks.map((candidate) =>
              candidate.id === truck.id ? advanced.truck : candidate,
            );
            const warningEvaluation = evaluateFuelWarning(advanced.delivery, advanced.truck);
            if (warningEvaluation.warning) {
              fuelWarningsToNotify.push({
                jobId: delivery.id,
                title: warningEvaluation.warning.title,
                message: warningEvaluation.warning.message,
                key: warningEvaluation.warning.key,
              });
            }
            return {
              ...advanced.delivery,
              fuelWarningsEmitted: warningEvaluation.fuelWarningsEmitted,
            };
          }
        }
        return delivery;
      }

      // A pending player decision survives background/cold-start and pauses only
      // that delivery. It must not be discarded or complete behind the modal.
      if (
        delivery.incident?.status === 'pending' &&
        !delivery.incidentResolved
      ) {
        return { ...delivery, currentSpeedKmh: 0 };
      }

      // Arıza / kaza riski — offline catch-up sırasında uygulanmaz
      if (!offlineProgressionActive) {
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
      }

      const truck = updatedTrucks.find((candidate) => candidate.id === delivery.truckId);
      if (!truck) {
        return delivery;
      }
      const fuelUpdate = updateDeliveryProgressWithFuel(
        delivery,
        truck,
        hoursPassed,
        state.currentTime,
      );
      updatedTrucks = updatedTrucks.map((candidate) =>
        candidate.id === truck.id ? fuelUpdate.truck : candidate,
      );
      let updated = fuelUpdate.delivery;
      const warningEvaluation = evaluateFuelWarning(updated, fuelUpdate.truck);
      if (warningEvaluation.warning) {
        fuelWarningsToNotify.push({
          jobId: delivery.id,
          title: warningEvaluation.warning.title,
          message: warningEvaluation.warning.message,
          key: warningEvaluation.warning.key,
        });
      }
      updated = {
        ...updated,
        fuelWarningsEmitted: warningEvaluation.fuelWarningsEmitted,
      };

      if (
        !offlineProgressionActive &&
        !pendingIncidentReserved &&
        !incidentCooldownActive &&
        !updated.incidentGenerated &&
        updated.progress >= 0.2 &&
        updated.progress <= 0.85 &&
        state.player
      ) {
        const contract = contractById.get(updated.contractId);
        const rolled = maybeRollDeliveryIncident(
          updated,
          contract,
          state.player,
          state.currentTime,
          latestIncident?.type,
        );
        if (rolled.incident?.status === 'pending') {
          pendingIncidentReserved = true;
          incidentNotifications.push({
            deliveryId: rolled.id,
            title: rolled.incident.title,
          });
        }
        updated = rolled;
      }

      if (isDeliveryProgressComplete(updated.progress)) {
        deliveriesToComplete.push(updated.id);
      }

      return updated;
    });

    set({
      activeDeliveries: updatedDeliveries,
      player: {
        ...state.player,
        trucks: updatedTrucks,
      },
    });

    for (const warning of fuelWarningsToNotify) {
      get().addNotification({
        id: `fuel-warning:${warning.jobId}:${warning.key}`,
        time: state.currentTime,
        type: warning.key === 'out-of-fuel' ? 'error' : 'warning',
        title: warning.title,
        message: warning.message,
        actionLabel: 'Haritada Gör',
        actionTarget: 'map',
      });
    }

    for (const incident of incidentNotifications) {
      get().addNotification({
        id: `delivery-incident:${incident.deliveryId}`,
        time: state.currentTime,
        type: 'warning',
        title: 'Operasyon kararı gerekiyor',
        message: incident.title,
        actionLabel: 'Kararı Gör',
        actionTarget: 'contracts',
      });
    }

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
        isDeliveryProgressComplete(current.progress) &&
        isDeliveryFuelProgressComplete(current)
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
    const fuelWarningsToNotify: Array<{
      jobId: string;
      title: string;
      message: string;
      key: string;
    }> = [];

    let updatedTrucks = state.player.trucks;
    const updatedTransfers = (state.activeTransfers ?? []).map((transfer) => {
      if (transfer.status !== 'active' && transfer.status !== 'paused') {
        return transfer;
      }

      const truck = updatedTrucks.find((candidate) => candidate.id === transfer.truckId);
      if (!truck) {
        return transfer;
      }
      const fuelUpdate = updateTransferProgressWithFuel(
        transfer,
        truck,
        hoursPassed,
        state.currentTime,
      );
      const warningEvaluation = evaluateFuelWarning(fuelUpdate.transfer, fuelUpdate.truck);
      const updated = {
        ...fuelUpdate.transfer,
        fuelWarningsEmitted: warningEvaluation.fuelWarningsEmitted,
      };
      if (warningEvaluation.warning) {
        fuelWarningsToNotify.push({
          jobId: transfer.id,
          title: warningEvaluation.warning.title,
          message: warningEvaluation.warning.message,
          key: warningEvaluation.warning.key,
        });
      }
      updatedTrucks = updatedTrucks.map((candidate) =>
        candidate.id === truck.id ? fuelUpdate.truck : candidate,
      );
      if (updated.progress >= 1) {
        transfersToComplete.push(updated.id);
      }
      return updated;
    });

    set({
      activeTransfers: updatedTransfers,
      player: {
        ...state.player,
        trucks: updatedTrucks,
      },
    });

    for (const warning of fuelWarningsToNotify) {
      get().addNotification({
        id: `fuel-warning:${warning.jobId}:${warning.key}`,
        time: state.currentTime,
        type: warning.key === 'out-of-fuel' ? 'error' : 'warning',
        title: warning.title,
        message: warning.message,
        actionLabel: 'Haritada Gör',
        actionTarget: 'map',
      });
    }

    for (const transferId of transfersToComplete) {
      const current = get().activeTransfers.find((transfer) => transfer.id === transferId);
      if (
        current &&
        current.status === 'active' &&
        current.progress >= 1 &&
        (current.lastFuelProcessedProgress == null ||
          current.lastFuelProcessedProgress >= 0.999)
      ) {
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

    if (truck.leaseExpired) {
      return {
        success: false,
        errorCode: 'TRUCK_BUSY',
        message: 'Kiralama süresi dolan kamyon yönlendirilemez.',
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

    const fuelPrice = getSnapshotFuelPrice(
      state.cachedGlobalEconomySnapshot,
      state.globalEconomy,
    );
    let transfer: TruckTransfer;
    try {
      transfer = createTruckTransfer({
        truck,
        driver,
        trailer: (state.player.trailers ?? []).find(
          (candidate) => candidate.attachedTruckId === truck.id,
        ),
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

    const transferFuelReadiness = getTruckFuelReadiness(
      truck,
      transfer.fuelLitersTotal ?? 0,
      fuelPrice,
    );
    if (!transferFuelReadiness.canCompleteWithoutRefuel) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_FUEL',
        message: `Bu rota için ${Math.ceil(transferFuelReadiness.requiredFuelL)} L yakıt gerekiyor. Kamyonda ${Math.floor(transferFuelReadiness.currentFuelL)} L var.`,
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
        trucks: updatedTrucks,
        drivers: updatedDrivers,
      },
      activeTransfers: [...(state.activeTransfers ?? []), transfer],
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

    const updatedTrucks = state.player.trucks.map((candidate) => {
      if (candidate.id !== transfer.truckId) {
        return candidate;
      }
      const arrived = {
        ...candidate,
        status: 'idle' as const,
        currentCityId: transfer.toCityId,
      };
      if (transfer.fuelConsumedL != null) {
        return normalizeTruckFuel(arrived);
      }
      if (transfer.fuelLitersAtStart == null || transfer.fuelLitersTotal == null) {
        return normalizeTruckFuel(arrived);
      }
      return finalizeTruckFuelAfterJob({
        truck: arrived,
        fuelLitersAtStart: transfer.fuelLitersAtStart,
        fuelLitersTotal: transfer.fuelLitersTotal,
        distanceKm: transfer.distanceKm,
      });
    });

    const updatedDrivers = state.player.drivers.map((candidate) => {
      if (transfer.driverId && candidate.id === transfer.driverId) {
        return { ...candidate, status: 'idle' as const, assignedTruckId: transfer.truckId };
      }
      return candidate;
    });

    const updatedTrailers = syncTrailersWithTruckLocation(
      state.player.trailers ?? [],
      transfer.truckId,
      transfer.toCityId,
      'idle',
    );

    set({
      player: {
        ...state.player,
        trucks: updatedTrucks,
        drivers: updatedDrivers,
        trailers: updatedTrailers,
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
    const deliveryRecord = state.activeDeliveries.find((d) => d.id === deliveryId);

    if (!deliveryRecord) {
      console.warn('[delivery] complete skipped: delivery not found', deliveryId);
      return;
    }

    const deliveryEventId = `event_delivery_complete_${deliveryId}`;
    const alreadySettled =
      completedDeliveryNotificationIds.has(deliveryId) ||
      state.eventLog.some((event) => event.id === deliveryEventId) ||
      hasDeliveryCompletionLedgerEntry(state.financeLedger, deliveryId) ||
      deliveryRecord.status === 'completed' ||
      deliveryRecord.status === 'failed' ||
      deliveryRecord.settledAt != null;

    if (alreadySettled) {
      const repair = ensureFleetAtDeliveryDestination(
        state.player.trucks,
        state.player.drivers,
        deliveryRecord,
      );
      if (repair.changed) {
        set({
          player: {
            ...state.player,
            trucks: repair.trucks,
            drivers: repair.drivers,
            trailers: syncTrailersWithTruckLocation(
              state.player.trailers ?? [],
              deliveryRecord.truckId,
              resolveDeliveryDestinationCityId(deliveryRecord),
              'idle',
            ),
          },
        });
      }
      return;
    }

    const simState = toSimulationState(state);
    const delivery = simState.deliveries.find((d) => d.id === deliveryId);

    if (!delivery) {
      console.warn('[delivery] complete skipped: delivery not found in sim', deliveryId);
      return;
    }

    if (delivery.status === 'completed') {
      return;
    }

    if (delivery.status === 'failed') {
      console.warn('[delivery] complete skipped: already failed', deliveryId);
      return;
    }

    if (delivery.settledAt != null) {
      return;
    }

    if (
      !isDeliveryProgressComplete(delivery.progress) ||
      !isDeliveryFuelProgressComplete(delivery)
    ) {
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
    const typePenaltyMult = getContractTypePenaltyMultiplier(contract);
    let adjustedPenaltyCost = Math.round(penaltyCost * typePenaltyMult);
    const completedTruckBefore = simState.trucks.find((t) => t.id === delivery.truckId);
    const truckCityBefore = completedTruckBefore
      ? resolveTruckCityId(completedTruckBefore, state.player.homeCityId)
      : 'unknown';
    const destinationCityId = resolveDeliveryDestinationCityId(delivery);
    if (
      normalizeContractType(contract) === 'fragile' &&
      completedTruckBefore &&
      (completedTruckBefore.condition ?? 100) < (contract.recommendedTruckCondition ?? 70)
    ) {
      adjustedPenaltyCost += Math.round((contract.payment ?? 0) * 0.05);
    }

    // Deadline aşıldı ama kritik eşik geçilmedi → teslimat tamamlanır,
    // para cezası uygulanır, itibar kazanılmaz ve geç teslimat sayılır.
    const isLateDelivery = actualTravelHours > contract.deadlineHours;

    const settlement = calculateDeliverySettlement({
      contractPayment: contract.payment ?? 0,
      fuelCost: delivery.fuelCost ?? 0,
      maintenanceCost: delivery.maintenanceCost ?? 0,
      penaltyCost: adjustedPenaltyCost,
      fuelAlreadyPaid: true,
    });
    const revenueTransaction = applyCashTransaction({
      currentCash: beforeMoney,
      amount: settlement.grossRevenue,
      kind: 'income',
      referenceId: `delivery:${deliveryId}:revenue`,
      transactionId: `delivery:${deliveryId}:revenue`,
    });
    const requestedCompletionExpenses =
      settlement.maintenanceCost + settlement.penaltyCost;
    const expenseTransaction =
      requestedCompletionExpenses > 0
        ? applyCashTransaction({
            currentCash: revenueTransaction.cashAfter,
            amount: requestedCompletionExpenses,
            kind: 'mandatory-expense',
            referenceId: `delivery:${deliveryId}:completion-expenses`,
            transactionId: `delivery:${deliveryId}:completion-expenses`,
          })
        : null;
    const paidCompletionExpenses = expenseTransaction?.amount ?? 0;
    const completionExpenseRatio =
      requestedCompletionExpenses > 0
        ? paidCompletionExpenses / requestedCompletionExpenses
        : 0;
    const paidMaintenanceCost =
      settlement.maintenanceCost * completionExpenseRatio;
    const paidPenaltyCost = settlement.penaltyCost * completionExpenseRatio;
    const moneyAfterComplete =
      expenseTransaction?.cashAfter ?? revenueTransaction.cashAfter;
    const cashSettlement = {
      ...settlement,
      maintenanceCost: paidMaintenanceCost,
      penaltyCost: paidPenaltyCost,
      cashDeltaOnCompletion: moneyAfterComplete - beforeMoney,
    };

    if (offlineProgressionActive && offlineProgressCollector) {
      offlineProgressCollector.completedDeliveries += 1;
      if (isLateDelivery) {
        offlineProgressCollector.lateDeliveries += 1;
      }
      offlineProgressCollector.earnings += settlement.grossRevenue;
      offlineProgressCollector.expenses +=
        settlement.fuelCost + paidMaintenanceCost + paidPenaltyCost;
    }

    const netProfit = settlement.netProfit;
    const routeLabel = `${getCityName(delivery.originCityId)} → ${getCityName(delivery.destinationCityId)}`;
    const distanceKm = contract.distanceKm ?? delivery.distanceKm ?? 0;
    const riskTier = getDeliveryRiskTier(delivery);
    const xpGain = calculateDeliveryXp(distanceKm, netProfit, riskTier);
    const destinationCityName = getCityName(delivery.destinationCityId);
    const locationToastMessage = formatDeliveryCompleteLocationToast(destinationCityName, !!delivery.driverId);
    const notificationMessage = `${locationToastMessage} Net kâr: ${formatNotificationMoney(netProfit)}`;
    const eventMessage = `${routeLabel} teslimatı tamamlandı. Ödeme: ${formatNotificationMoney(settlement.grossRevenue)} · Net kâr: ${formatNotificationMoney(netProfit)} · +${xpGain} XP`;
    const completedTruck = newSimState.trucks.find((t) => t.id === delivery.truckId);
    const driverXpGain = calculateDriverDeliveryXp({
      contract,
      distanceKm,
      onTime: !isLateDelivery,
      success: true,
    });
    const reputationBonus =
      !isLateDelivery && shouldGrantHighReputationBonus(contract)
        ? HIGH_REPUTATION_SUCCESS_BONUS
        : 0;
    const truckArrivalMessage = completedTruck
      ? `${completedTruck.name} ${destinationCityName}'ya ulaştı ve yeni işler için hazır.`
      : `Kamyon ${destinationCityName}'ya ulaştı ve yeni işler için hazır.`;

    const merged = mergeSimulationIntoStore(state, newSimState, moneyAfterComplete);
    const updatedDrivers = (merged.player?.drivers ?? state.player.drivers).map((driver) => {
      if (driver.id !== delivery.driverId) {
        return driver;
      }
      const nextDriver = recordDriverDeliveryStats(driver, !isLateDelivery);
      const xpResult = applyDriverXp(nextDriver, driverXpGain, contract);
      if (xpResult.leveledUp) {
        if (offlineProgressionActive && offlineProgressCollector) {
          offlineProgressCollector.driverLevelUps.push(`${driver.name} → Lv.${xpResult.newLevel}`);
        } else {
          queueMicrotask(() => {
            get().applyRetentionEventAndSync({
              type: 'driver_level_up',
              driverId: driver.id,
              newLevel: xpResult.newLevel,
            });
          });
        }
      }
      return xpResult.driver;
    });
    const syncedTrailers = syncTrailersWithTruckLocation(
      state.player.trailers ?? [],
      delivery.truckId,
      destinationCityId,
      'idle',
    );
    const completedDriver = updatedDrivers.find((d) => d.id === delivery.driverId);
    const truckCityAfter = completedTruck
      ? resolveTruckCityId(completedTruck, state.player.homeCityId)
      : 'unknown';
    logDeliveryCompletionLocation({
      deliveryId: delivery.id,
      truckId: delivery.truckId,
      originCityId: delivery.originCityId,
      destinationCityId,
      truckCityBefore,
      truckCityAfter,
      driverCityAfter: completedDriver?.currentCityId,
      trailerCityAfter: syncedTrailers.find((trailer) => trailer.attachedTruckId === delivery.truckId)
        ?.city,
      truckStatusAfter: completedTruck?.status ?? 'idle',
      deliveryStatusAfter: 'completed',
      activeDeliveryCleared: true,
    });
    const settledAt = state.currentTime;
    const settledDeliveries = (merged.activeDeliveries ?? []).map((item) =>
      item.id === deliveryId ? { ...item, settledAt } : item,
    );
    const completionLedgerEntries = buildDeliveryCompletionLedgerEntries(
      cashSettlement,
      routeLabel,
      state.currentTime,
      deliveryId,
    );
    const ledgerPatch = patchFinanceLedger(state, completionLedgerEntries);

    set({
      ...merged,
      activeDeliveries: settledDeliveries,
      ...ledgerPatch,
      deliverySettlementDebug: {
        phase: 'complete',
        cashBefore: beforeMoney,
        cashAfter: moneyAfterComplete,
        fuelCost: settlement.fuelCost,
        contractPayment: settlement.grossRevenue,
        maintenanceCost: paidMaintenanceCost,
        penaltyCost: paidPenaltyCost,
        reportedNetProfit: netProfit,
        cashDeltaOnCompletion: moneyAfterComplete - beforeMoney,
      },
      player: {
        ...state.player,
        trucks: merged.player!.trucks,
        drivers: updatedDrivers,
        warehouses: merged.player!.warehouses,
        trailers: syncedTrailers,
        money: moneyAfterComplete,
        completedContracts: state.player.completedContracts + 1,
        lateDeliveries: isLateDelivery
          ? (state.player.lateDeliveries ?? 0) + 1
          : (state.player.lateDeliveries ?? 0),
        reputation: isLateDelivery
          ? state.player.reputation
          : Math.min(100, state.player.reputation + REPUTATION_GAIN + reputationBonus),
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
    get().applyRetentionEventAndSync({
      type: 'contract_completed',
      originCityId: delivery.originCityId,
      destinationCityId: delivery.destinationCityId,
      onTime: !isLateDelivery,
      contractType: normalizeContractType(contract),
    });
    const contractType = normalizeContractType(contract);
    if (contractType === 'urgent') {
      get().applyRetentionEventAndSync({ type: 'urgent_contract_completed' });
    } else if (contractType === 'fragile') {
      get().applyRetentionEventAndSync({ type: 'fragile_contract_completed' });
    } else if (contractType === 'high_reputation') {
      get().applyRetentionEventAndSync({ type: 'high_reputation_contract_completed' });
    }

    const postState = get();
    if (postState.player) {
      const refreshParams = buildContractRefreshParams(postState);
      const supplyResult = ensurePlayableContractsAfterDelivery({
        ...refreshParams,
        contracts: postState.contracts ?? [],
        destinationCityId: delivery.destinationCityId,
        completedContracts: postState.player.completedContracts ?? 0,
      });

      if (
        supplyResult.newContracts.length > 0 ||
        supplyResult.contracts !== postState.contracts
      ) {
        set({
          contracts: supplyResult.contracts,
          lastPlayableContractGeneratedTime:
            supplyResult.updatedLastPlayableContractGeneratedTime ??
            postState.lastPlayableContractGeneratedTime,
        });
        get().markSaveDirty();
      }
    }

    try {
      if (!offlineProgressionActive) {
        get().addNotification({
          time: state.currentTime,
          type: 'success',
          title: 'Teslimat tamamlandı',
          message: notificationMessage,
          actionLabel: 'Finansı Gör',
          actionTarget: 'finance',
          autoDismissMs: 3500,
        });
      }
    } catch (error) {
      console.warn('[gameStore] addNotification failed:', error);
    }

    if (!offlineProgressionActive) {
      get().autoSave('delivery_completed');
    }
    get().processExpiredLeases();
    get().advanceOnboardingProgress();
  },

  failDeliveryById: (deliveryId: string, reason: DeliveryFailureReason) => {
    const state = get();
    const simState = toSimulationState(state);

    const delivery = simState.deliveries.find((d) => d.id === deliveryId);
    if (!delivery || delivery.status === 'completed' || delivery.status === 'failed') {
      return;
    }

    if (delivery.settledAt != null) {
      return;
    }

    const newSimState = failDeliverySim(simState, deliveryId, reason);
    const contract = simState.contracts.find((c) => c.id === delivery.contractId);
    const penaltyAmount = calculateFailurePenalty(contract);
    const penaltyTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: penaltyAmount,
      kind: 'mandatory-expense',
      referenceId: `delivery:${deliveryId}:failure-penalty`,
      transactionId: `delivery:${deliveryId}:failure-penalty`,
      appliedTransactionIds: (state.financeLedger ?? [])
        .map((entry) => entry.transactionId)
        .filter((value): value is string => typeof value === 'string'),
    });
    const paidPenaltyAmount = penaltyTransaction.amount;
    const moneyAfterFail = penaltyTransaction.cashAfter;
    const merged = mergeSimulationIntoStore(state, newSimState, moneyAfterFail);
    const settledAt = state.currentTime;
    const settledDeliveries = (merged.activeDeliveries ?? []).map((item) =>
      item.id === deliveryId ? { ...item, settledAt } : item,
    );
    const routeLabel = `${getCityName(delivery.originCityId)} → ${getCityName(delivery.destinationCityId)}`;

    set({
      ...merged,
      activeDeliveries: settledDeliveries,
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'penalty',
        amount: paidPenaltyAmount,
        description: `Başarısız teslimat cezası · ${routeLabel}`,
        transactionId: penaltyTransaction.transactionId,
        referenceId: penaltyTransaction.referenceId,
      }),
      deliverySettlementDebug: {
        phase: 'fail',
        cashBefore: state.player.money,
        cashAfter: moneyAfterFail,
        fuelCost: delivery.fuelCost ?? 0,
        contractPayment: contract?.payment ?? 0,
        maintenanceCost: 0,
        penaltyCost: paidPenaltyAmount,
        reportedNetProfit: -(delivery.fuelCost ?? 0) - paidPenaltyAmount,
        cashDeltaOnCompletion: -paidPenaltyAmount,
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
          message: `Teslimat iptal edildi (${reason}). Ceza: $${paidPenaltyAmount.toFixed(0)}`,
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

    if (!canAffordVoluntaryPurchase(state.player.money, template.purchasePrice)) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_FUNDS',
        message: `Kamyon satın almak için ${formatNotificationMoney(template.purchasePrice)} gerekli.`,
      };
    }

    const instanceId = `${catalogId}-${Date.now()}`;
    const newTruck: Truck = normalizeTruckFuel({
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
    });
    const purchaseTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: template.purchasePrice,
      kind: 'voluntary-expense',
      referenceId: `truck:${instanceId}:purchase`,
      transactionId: `vehicle-purchase:${instanceId}`,
    });

    set({
      player: {
        ...state.player,
        money: purchaseTransaction.cashAfter,
        trucks: [...state.player.trucks, newTruck],
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'vehicle_purchase',
        amount: purchaseTransaction.amount,
        description: `${template.name} satın alındı`,
        transactionId: purchaseTransaction.transactionId,
        referenceId: purchaseTransaction.referenceId,
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
    get().syncRetentionProgress();
    return {
      success: true,
      message: `${template.name} satın alındı.`,
    };
  },

  buyTrailer: (catalogId: string): TradeActionResult => {
    const state = get();
    const template = findTrailerMarketItem(catalogId);
    const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);
    const validation = validateTrailerPurchase(
      template,
      playerLevel,
      state.player.money ?? 0,
    );
    if (!validation.success || !template) {
      return {
        success: false,
        message: validation.message,
        errorCode: validation.errorCode === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : undefined,
      };
    }

    const instanceId = `${catalogId}-${Date.now()}`;
    const newTrailer = createTrailerFromTemplate(template, {
      id: instanceId,
      city: state.player.homeCityId ?? 'izmir',
      createdAtGameTime: state.currentTime,
    });
    const purchaseTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: template.purchasePrice,
      kind: 'voluntary-expense',
      referenceId: `trailer:${instanceId}:purchase`,
      transactionId: `vehicle-purchase:${instanceId}`,
    });

    set({
      player: {
        ...state.player,
        money: purchaseTransaction.cashAfter,
        trailers: [...(state.player.trailers ?? []), newTrailer],
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'vehicle_purchase',
        amount: purchaseTransaction.amount,
        description: `${template.name} satın alındı`,
        transactionId: purchaseTransaction.transactionId,
        referenceId: purchaseTransaction.referenceId,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'fleet',
          title: 'Dorse satın alındı',
          message: `${template.name} ${getCityName(newTrailer.city)} şehrine eklendi.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });
    get().autoSave('purchase');
    return {
      success: true,
      message: `${template.name} satın alındı.`,
    };
  },

  attachTrailerToTruck: (trailerId: string, truckId: string): TradeActionResult => {
    const state = get();
    const trucks = state.player.trucks ?? [];
    const trailers = state.player.trailers ?? [];
    const result = attachTrailerToTruckState(trailers, trailerId, truckId, trucks);
    if (result.error) {
      return { success: false, message: result.error.message };
    }

    set({
      player: {
        ...state.player,
        trailers: syncAllTrailersWithFleet(result.trailers, trucks),
      },
    });
    get().autoSave('purchase');
    return { success: true, message: 'Dorse kamyona bağlandı.' };
  },

  detachTrailerFromTruck: (trailerId: string): TradeActionResult => {
    const state = get();
    const trucks = state.player.trucks ?? [];
    const trailers = state.player.trailers ?? [];
    const result = detachTrailerFromTruckState(trailers, trailerId, trucks);
    if (result.error) {
      return { success: false, message: result.error.message };
    }

    set({
      player: {
        ...state.player,
        trailers: result.trailers,
      },
    });
    get().autoSave('purchase');
    return { success: true, message: 'Dorse ayrıldı.' };
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

      if (!canAffordVoluntaryPurchase(state.player.money, weeklyLeaseCost)) {
        return {
          success: false,
          errorCode: 'INSUFFICIENT_FUNDS',
          message: `Haftalık kira için ${formatNotificationMoney(weeklyLeaseCost)} gerekli.`,
        };
      }

      const instanceId = `${catalogId}-lease-${Date.now()}`;
      const leaseExpiresAt = state.currentTime + operatingCostBalance.leaseDurationHours;
      const newTruck: Truck = normalizeTruckFuel({
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
      });
      const leaseTransaction = applyCashTransaction({
        currentCash: state.player.money,
        amount: weeklyLeaseCost,
        kind: 'voluntary-expense',
        referenceId: `truck:${instanceId}:lease`,
        transactionId: `truck-lease:${instanceId}`,
      });

      set({
        player: {
          ...state.player,
          money: leaseTransaction.cashAfter,
          trucks: [...state.player.trucks, newTruck],
        },
        ...patchFinanceLedger(state, {
          time: state.currentTime,
          type: 'expense',
          category: 'truck_lease',
          amount: leaseTransaction.amount,
          description: `${template.name} · 7 günlük kira (peşin)`,
          transactionId: leaseTransaction.transactionId,
          referenceId: leaseTransaction.referenceId,
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
    if (!canAffordVoluntaryPurchase(state.player.money, hireCost)) {
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
    const hireTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: hireCost,
      kind: 'voluntary-expense',
      referenceId: `driver:${poolId}:hire`,
      transactionId: `driver-hire:${poolId}`,
    });

    set({
      player: {
        ...state.player,
        money: hireTransaction.cashAfter,
        drivers: [...state.player.drivers, newDriver],
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'driver_hire',
        amount: hireTransaction.amount,
        description: `${template.name} işe alım`,
        transactionId: hireTransaction.transactionId,
        referenceId: hireTransaction.referenceId,
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

  sellTruck: (truckId: string): TradeActionResult => {
    const state = get();
    const fleetState = {
      player: state.player,
      activeDeliveries: state.activeDeliveries,
      activeTransfers: state.activeTransfers,
    };
    const sellCheck = canSellTruck(truckId, fleetState);
    if (!sellCheck.canSell) {
      return {
        success: false,
        message: sellCheck.reason ?? 'Kamyon satılamaz.',
      };
    }

    const truck = (state.player.trucks ?? []).find((item) => item.id === truckId);
    if (!truck) {
      return {
        success: false,
        message: 'Kamyon bulunamadı.',
      };
    }

    const salePrice = sellCheck.salePrice ?? 0;
    const condition = Math.round(truck.condition ?? 100);
    const updatedDrivers = (state.player.drivers ?? []).map((driver) =>
      driver.assignedTruckId === truckId ? { ...driver, assignedTruckId: null } : driver,
    );
    const updatedTrucks = (state.player.trucks ?? []).filter((item) => item.id !== truckId);
    const updatedTrailers = detachTrailersFromTruckState(
      state.player.trailers ?? [],
      truckId,
      state.player.trucks ?? [],
    );
    const saleTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: salePrice,
      kind: 'income',
      referenceId: `truck:${truckId}:sale`,
      transactionId: `vehicle-sale:${truckId}`,
    });

    set({
      player: {
        ...state.player,
        money: saleTransaction.cashAfter,
        trucks: updatedTrucks,
        drivers: updatedDrivers,
        trailers: updatedTrailers,
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'income',
        category: 'vehicle_sale',
        amount: saleTransaction.amount,
        title: 'Kamyon satışı',
        description: `${truck.name} satıldı. Kondisyon: %${condition}`,
        transactionId: saleTransaction.transactionId,
        referenceId: saleTransaction.referenceId,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'fleet',
          title: 'Kamyon satıldı',
          message: `${truck.name} satıldı. Kasaya ${formatNotificationMoney(salePrice)} eklendi.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    try {
      get().addNotification({
        time: state.currentTime,
        type: 'success',
        title: 'Kamyon satıldı',
        message: `${truck.name} satıldı: ${formatNotificationMoney(salePrice)}`,
        actionLabel: 'Finansı Gör',
        actionTarget: 'finance',
        autoDismissMs: 3500,
      });
    } catch (error) {
      console.warn('[gameStore] sellTruck notification failed:', error);
    }

    get().autoSave('purchase');
    return {
      success: true,
      message: `${truck.name} ${formatNotificationMoney(salePrice)} karşılığında satıldı.`,
    };
  },

  fireDriver: (driverId: string): TradeActionResult => {
    const state = get();
    const fleetState = {
      player: state.player,
      activeDeliveries: state.activeDeliveries,
      activeTransfers: state.activeTransfers,
    };
    const fireCheck = canFireDriver(driverId, fleetState);
    if (!fireCheck.canFire) {
      return {
        success: false,
        message: fireCheck.reason ?? 'Şoför işten çıkarılamaz.',
      };
    }

    const driver = (state.player.drivers ?? []).find((item) => item.id === driverId);
    if (!driver) {
      return {
        success: false,
        message: 'Şoför bulunamadı.',
      };
    }

    const severanceCost = fireCheck.severanceCost ?? calculateDriverSeveranceCost(driver);
    if ((state.player.money ?? 0) < severanceCost) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_FUNDS',
        message: `Şoför çıkış maliyeti için ${formatNotificationMoney(severanceCost)} gerekli.`,
      };
    }

    const updatedDrivers = (state.player.drivers ?? []).filter((item) => item.id !== driverId);
    const severanceTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: severanceCost,
      kind: 'voluntary-expense',
      referenceId: `driver:${driverId}:severance`,
      transactionId: `driver-severance:${driverId}`,
    });

    set({
      player: {
        ...state.player,
        money: severanceTransaction.cashAfter,
        drivers: updatedDrivers,
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'driver_severance',
        amount: severanceTransaction.amount,
        title: 'Şoför çıkış maliyeti',
        description: `${driver.name} işten çıkarıldı.`,
        transactionId: severanceTransaction.transactionId,
        referenceId: severanceTransaction.referenceId,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'fleet',
          title: 'Şoför işten çıkarıldı',
          message: `${driver.name} için ${formatNotificationMoney(severanceCost)} çıkış maliyeti ödendi.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    try {
      get().addNotification({
        time: state.currentTime,
        type: 'info',
        title: 'Şoför işten çıkarıldı',
        message: `${driver.name} için ${formatNotificationMoney(severanceCost)} çıkış maliyeti ödendi.`,
        actionLabel: 'Finansı Gör',
        actionTarget: 'finance',
        autoDismissMs: 3500,
      });
    } catch (error) {
      console.warn('[gameStore] fireDriver notification failed:', error);
    }

    get().autoSave('purchase');
    return {
      success: true,
      message: `${driver.name} işten çıkarıldı.`,
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

    const baseRepairCost = calculateTruckRepairCost(truck);
    if (baseRepairCost <= 0) {
      return;
    }

    const monetization = normalizeMonetizationState(state.monetization, state.currentTime);
    const discountToken = getActiveMaintenanceDiscountToken(
      monetization,
      truckId,
      state.currentTime,
    );
    const { finalCost: repairCost, discountAmount } = calculateDiscountedRepairCost(
      baseRepairCost,
      discountToken,
    );

    if (!canAffordVoluntaryPurchase(state.player.money, repairCost)) {
      throw new Error('Yetersiz bakiye.');
    }
    const repairTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: repairCost,
      kind: 'voluntary-expense',
      referenceId: `truck:${truckId}:maintenance`,
      transactionId: `maintenance:${truckId}:${condition}:${state.currentTime}`,
    });
    if (!repairTransaction.ok) {
      throw new Error('Yetersiz bakiye.');
    }

    const nextMonetization =
      discountToken && discountAmount > 0
        ? consumeMaintenanceDiscountToken(monetization, truckId)
        : monetization;

    const repairMessage =
      discountAmount > 0
        ? `${truck.name} tamir edildi. Maliyet: $${repairCost.toFixed(0)} (reklam indirimi -$${discountAmount.toFixed(0)})`
        : `${truck.name} tamir edildi. Maliyet: $${repairCost.toFixed(0)}`;

    set({
      monetization: nextMonetization,
      player: {
        ...state.player,
        money: repairTransaction.cashAfter,
        trucks: state.player.trucks.map((t) =>
          t.id === truckId ? { ...t, condition: 100 } : t,
        ),
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'maintenance',
        amount: repairTransaction.amount,
        title: 'Kamyon bakımı',
        description: repairMessage,
        transactionId: repairTransaction.transactionId,
        referenceId: repairTransaction.referenceId,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'fleet',
          title: 'Kamyon bakımı',
          message: repairMessage,
          importance: 'low',
        },
        state.currentTime,
      ),
    });
    get().autoSave('repair');
    get().applyRetentionEventAndSync({ type: 'truck_maintained', truckId });
  },

  applyAdReward: async (slotId, context) => {
    const state = get();
    if (!state.player) {
      return { ok: false, reason: 'Oyun yüklenmedi.' };
    }

    const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);
    const hasCompletedOnboarding = state.onboarding?.completed === true;
    const monetization = resetDailyUsageIfNeeded(
      normalizeMonetizationState(state.monetization, state.currentTime),
    );

    const fullContext: AdRewardGrantContext = {
      currentGameTime: state.currentTime,
      playerLevel,
      hasCompletedOnboarding,
      ...context,
    };

    const eligibility = canGrantAdReward(monetization, slotId, fullContext);
    if (!eligibility.ok) {
      return { ok: false, reason: eligibility.reason };
    }

    const adResult = await showRewardedAd(slotId);
    if (adResult !== 'completed') {
      return {
        ok: false,
        reason: adResult === 'skipped' ? 'Reklam izlenmedi.' : 'Reklam yüklenemedi.',
      };
    }

    let grantResult;
    try {
      grantResult = applyAdRewardGrant(monetization, slotId, fullContext);
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Ödül uygulanamadı.',
      };
    }

    let nextPlayer = state.player;
    let nextLedgerPatch: Pick<StoreGameState, 'financeLedger' | 'financeTotals'> | undefined;
    let nextDeliveries = state.activeDeliveries;
    let shouldRefreshContracts = false;
    let boostedDeliveryToComplete: string | null = null;

    for (const effect of grantResult.effects) {
      switch (effect.type) {
        case 'cash': {
          const usageCount =
            grantResult.monetization.adRewardUsage[slotId]?.count ?? 0;
          const transactionId =
            `ad-reward:${slotId}:${grantResult.monetization.dailyResetKey}:${usageCount}`;
          const rewardTransaction = applyCashTransaction({
            currentCash: nextPlayer.money,
            amount: effect.amount,
            kind: 'income',
            referenceId: `ad-reward:${slotId}`,
            transactionId,
            appliedTransactionIds: (
              nextLedgerPatch?.financeLedger ??
              state.financeLedger ??
              []
            )
              .map((entry) => entry.transactionId)
              .filter((value): value is string => typeof value === 'string'),
          });
          nextPlayer = {
            ...nextPlayer,
            money: rewardTransaction.cashAfter,
          };
          if (rewardTransaction.amount > 0) {
            nextLedgerPatch = patchFinanceLedger(
              {
                financeLedger: nextLedgerPatch?.financeLedger ?? state.financeLedger,
                financeTotals: nextLedgerPatch?.financeTotals ?? state.financeTotals,
              },
              {
                time: state.currentTime,
                type: 'income',
                category: 'reward',
                amount: rewardTransaction.amount,
                description: 'Reklam ödülü · günlük operasyon bonusu',
                transactionId: rewardTransaction.transactionId,
                referenceId: rewardTransaction.referenceId,
              },
            );
          }
          break;
        }
        case 'contract_refresh_bypass':
          shouldRefreshContracts = true;
          break;
        case 'delivery_boost': {
          nextDeliveries = nextDeliveries.map((delivery) => {
            if (delivery.id !== effect.deliveryId) {
              return delivery;
            }
            const boostedProgress = calculateDeliveryBoostProgress(
              delivery.progress,
              effect.progressBoost,
            );
            if (isDeliveryProgressComplete(boostedProgress)) {
              boostedDeliveryToComplete = delivery.id;
            }
            if (typeof __DEV__ !== 'undefined' && __DEV__ === true) {
              console.log('[gameStore] delivery_boost applied', {
                deliveryId: delivery.id,
                oldProgress: delivery.progress,
                newProgress: boostedProgress,
              });
            }
            return {
              ...delivery,
              progress: boostedProgress,
            };
          });
          break;
        }
        case 'market_analysis_unlock':
        case 'maintenance_discount_token':
          break;
        default:
          break;
      }
    }

    set({
      monetization: grantResult.monetization,
      player: nextPlayer,
      activeDeliveries: nextDeliveries,
      ...(nextLedgerPatch ?? {}),
    });
    get().markSaveDirty();

    if (shouldRefreshContracts) {
      get().refreshContractsFromMarket({ bypassCooldown: true });
    }

    if (boostedDeliveryToComplete) {
      const current = get().activeDeliveries.find((d) => d.id === boostedDeliveryToComplete);
      if (
        current &&
        (current.status === 'on_route' || current.status === 'preparing') &&
        isDeliveryProgressComplete(current.progress)
      ) {
        get().completeDeliveryById(boostedDeliveryToComplete);
      }
    }

    get().autoSave('manual');
    return { ok: true };
  },

  resolveDeliveryIncident: async (deliveryId, choiceId) => {
    const state = get();
    const delivery = state.activeDeliveries.find((item) => item.id === deliveryId);
    if (!delivery) {
      return { ok: false, reason: 'Teslimat bulunamadı.' };
    }

    const result = resolveDeliveryIncidentSim(delivery, choiceId, state.currentTime);
    if (!result.ok || !result.delivery || !result.effects) {
      return { ok: false, reason: result.reason ?? 'Operasyon kararı uygulanamadı.' };
    }

    const contract = state.contracts.find((item) => item.id === delivery.contractId);
    const incidentTitle = result.delivery.incident?.title ?? 'Teslimat';
    // fuelCostDelta describes cost direction: positive is extra cost, negative
    // is savings. Convert it to the inverse cash movement exactly once.
    const cashDelta = result.effects.cashDelta - result.effects.fuelCostDelta;
    let nextPlayer = state.player;
    let ledgerPatch: Pick<StoreGameState, 'financeLedger' | 'financeTotals'> | undefined;

    if (cashDelta !== 0) {
      const incidentTransactionId = `incident:${deliveryId}:${choiceId}:${state.currentTime}`;
      const incidentTransaction = applyCashTransaction({
        currentCash: nextPlayer.money,
        amount: Math.abs(cashDelta),
        kind: cashDelta >= 0 ? 'income' : 'mandatory-expense',
        referenceId: `delivery:${deliveryId}:incident`,
        transactionId: incidentTransactionId,
        appliedTransactionIds: (state.financeLedger ?? [])
          .map((entry) => entry.transactionId)
          .filter((value): value is string => typeof value === 'string'),
      });
      nextPlayer = {
        ...nextPlayer,
        money: incidentTransaction.cashAfter,
      };
      if (incidentTransaction.amount > 0) {
        ledgerPatch = patchFinanceLedger(state, {
          time: state.currentTime,
          type: cashDelta >= 0 ? 'income' : 'expense',
          category:
            cashDelta >= 0
              ? 'other_income'
              : result.effects.fuelCostDelta !== 0 &&
                  result.effects.cashDelta === 0
                ? 'fuel'
                : 'other_expense',
          amount: incidentTransaction.amount,
          description: `Operasyon kararı · ${incidentTitle}`,
          relatedDeliveryId: deliveryId,
          transactionId: incidentTransaction.transactionId,
          referenceId: incidentTransaction.referenceId,
        });
      }
    }

    if (result.effects.truckConditionDelta !== 0) {
      nextPlayer = {
        ...nextPlayer,
        trucks: nextPlayer.trucks.map((truck) => {
          if (truck.id !== delivery.truckId) {
            return truck;
          }
          return {
            ...truck,
            condition: Math.min(
              100,
              Math.max(0, truck.condition + result.effects!.truckConditionDelta),
            ),
          };
        }),
      };
    }

    if (result.effects.driverXpDelta > 0) {
      nextPlayer = {
        ...nextPlayer,
        drivers: nextPlayer.drivers.map((driver) => {
          if (driver.id !== delivery.driverId) {
            return driver;
          }
          return applyDriverXp(driver, result.effects!.driverXpDelta, contract).driver;
        }),
      };
    }

    if (result.effects.playerXpDelta > 0) {
      nextPlayer = applyXpToPlayer(nextPlayer, result.effects.playerXpDelta).player;
    }

    if (result.effects.reputationDelta !== 0) {
      nextPlayer = {
        ...nextPlayer,
        reputation: Math.min(
          100,
          Math.max(0, nextPlayer.reputation + result.effects.reputationDelta),
        ),
      };
    }

    const nextDeliveries = state.activeDeliveries.map((item) =>
      item.id === deliveryId ? result.delivery! : item,
    );

    set({
      player: nextPlayer,
      activeDeliveries: nextDeliveries,
      ...(ledgerPatch ?? {}),
    });

    get().applyRetentionEventAndSync({ type: 'delivery_incident_resolved' });
    get().addNotification({
      time: state.currentTime,
      type: 'info',
      title: 'Operasyon kararı uygulandı',
      message: incidentTitle,
      autoDismissMs: 3500,
    });
    get().markSaveDirty();
    get().autoSave('delivery_incident');

    if (isDeliveryProgressComplete(result.delivery.progress)) {
      get().completeDeliveryById(deliveryId);
    }

    return { ok: true };
  },

  upgradeTruck: (truckId, upgradeType) => {
    const state = get();
    const truck = state.player.trucks.find((t) => t.id === truckId);
    if (!truck) {
      throw new Error('Kamyon bulunamadı.');
    }
    if ((truck.ownershipType ?? 'owned') === 'leased') {
      throw new Error('Kiralık kamyon geliştirilemez.');
    }
    if (truck.status !== 'idle') {
      throw new Error('Yalnızca boştaki kamyon geliştirilebilir.');
    }
    if (!canUpgradeTruck(truck, upgradeType)) {
      throw new Error('Bu geliştirme maksimum seviyede.');
    }
    const cost = getTruckUpgradeCost(truck, upgradeType);
    if (!canAffordVoluntaryPurchase(state.player.money, cost)) {
      throw new Error('Yetersiz nakit.');
    }
    const upgraded = applyTruckUpgrade(truck, upgradeType);
    const upgradeTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: cost,
      kind: 'voluntary-expense',
      referenceId: `truck:${truckId}:upgrade:${upgradeType}`,
      transactionId: `truck-upgrade:${truckId}:${upgradeType}:${cost}`,
    });
    set({
      player: {
        ...state.player,
        money: upgradeTransaction.cashAfter,
        trucks: state.player.trucks.map((t) => (t.id === truckId ? upgraded : t)),
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'maintenance',
        amount: upgradeTransaction.amount,
        description: `${truck.name} · ${upgradeType} geliştirmesi`,
        transactionId: upgradeTransaction.transactionId,
        referenceId: upgradeTransaction.referenceId,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'fleet',
          title: 'Kamyon geliştirildi',
          message: `${truck.name} — ${upgradeType} yükseltildi. Maliyet: $${cost.toFixed(0)}`,
          importance: 'low',
        },
        state.currentTime,
      ),
    });
    get().applyRetentionEventAndSync({ type: 'truck_upgraded', truckId });
    get().autoSave('upgrade');
  },

  openWarehouse: (cityId: string, warehouseType: WarehouseType = 'standard'): TradeActionResult => {
    const state = get();
    const city = state.cities.find((candidate) => candidate.id === cityId);
    if (!city) {
      return tradeFail('invalid-city', 'Şehir bulunamadı.', 'CITY_NOT_FOUND');
    }

    const resolvedType = resolveWarehouseType(warehouseType);
    if (resolvedType !== 'standard' && resolvedType !== 'cold') {
      return tradeFail('incompatible-warehouse', 'Bu depo tipi henüz kullanılamıyor.');
    }

    if (
      state.player.warehouses.some(
        (warehouse) =>
          warehouse.cityId === cityId && resolveWarehouseType(warehouse.warehouseType) === resolvedType,
      )
    ) {
      return tradeFail(
        'duplicate-warehouse',
        `Bu şehirde zaten ${getWarehouseTypeLabel(resolvedType).toLowerCase()} var.`,
      );
    }

    const warehouses = state.player.warehouses ?? [];
    const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);

    if (!isWarehouseCityUnlocked(cityId, playerLevel)) {
      const requiredCityLevel = getCityUnlockLevel(cityId);
      return tradeFail(
        'level-required',
        `Bu şehirde depo açmak için Level ${requiredCityLevel} gerekli.`,
      );
    }

    if (!canOpenMoreWarehouses(playerLevel, warehouses.length)) {
      const maxWarehouses = getMaxWarehousesForLevel(playerLevel);
      return tradeFail(
        'warehouse-limit-reached',
        formatWarehouseLimitReachedMessage(warehouses.length, maxWarehouses),
      );
    }

    const costModifier = city.warehouseCostModifier ?? 1;
    const typeCostMultiplier =
      resolvedType === 'cold' ? warehouseBalance.coldOpenCostMultiplier : 1;
    const openCost = Math.round(warehouseBalance.baseOpenCost * costModifier * typeCostMultiplier);
    const typeLabel = getWarehouseTypeLabel(resolvedType);

    if (!canAffordVoluntaryPurchase(state.player.money, openCost)) {
      return tradeFail(
        'insufficient-funds',
        `${typeLabel} açmak için ${formatNotificationMoney(openCost)} gerekli.`,
        'INSUFFICIENT_FUNDS',
      );
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
    const openTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: openCost,
      kind: 'voluntary-expense',
      referenceId: `warehouse:${warehouse.id}:open`,
      transactionId: `warehouse-open:${warehouse.id}`,
    });

    set({
      player: {
        ...state.player,
        money: openTransaction.cashAfter,
        warehouses: [...state.player.warehouses, warehouse],
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'warehouse_open',
        amount: openTransaction.amount,
        description: `${city.name} · ${typeLabel}`,
        transactionId: openTransaction.transactionId,
        referenceId: openTransaction.referenceId,
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
    return tradeOk(`${city.name} · ${typeLabel} açıldı.`);
  },
  upgradeWarehouse: (warehouseId: string): TradeActionResult => {
    const state = get();
    const warehouse = state.player.warehouses.find((candidate) => candidate.id === warehouseId);
    if (!warehouse) {
      return tradeFail('warehouse-required', 'Depo bulunamadı.', 'WAREHOUSE_NOT_FOUND');
    }

    const playerLevel = Math.max(1, state.player.level ?? state.player.companyLevel ?? 1);
    const city = state.cities.find((candidate) => candidate.id === warehouse.cityId);
    const preview = getWarehouseUpgradePreview(warehouse, city);

    if (preview.nextLevel == null || preview.upgradePrice == null || preview.nextCapacity == null) {
      return tradeFail('upgrade-maxed', 'Depo maksimum kapasitede.');
    }

    if (preview.requiredPlayerLevel != null && playerLevel < preview.requiredPlayerLevel) {
      return tradeFail(
        'level-required',
        `Bu yükseltme için Level ${preview.requiredPlayerLevel} gerekli.`,
      );
    }

    const capacityIncrease = preview.nextCapacity - preview.currentCapacity;
    if (capacityIncrease <= 0) {
      return tradeFail('upgrade-maxed', 'Depo maksimum kapasitede.');
    }

    const upgradeCost = preview.upgradePrice;

    if (!canAffordVoluntaryPurchase(state.player.money, upgradeCost)) {
      return tradeFail(
        'insufficient-funds',
        `Depo yükseltmek için ${formatNotificationMoney(upgradeCost)} gerekli.`,
        'INSUFFICIENT_FUNDS',
      );
    }

    const cityName = city?.name ?? warehouse.cityId;
    const nextTier = preview.nextLevel;
    const upgradeLabel = nextTier === 2 ? 'Orta depo' : 'Büyük depo';
    const updatedWarehouses = state.player.warehouses.map((candidate) => {
      if (candidate.id !== warehouse.id) {
        return candidate;
      }
      const upgraded = {
        ...candidate,
        capacityTons: preview.nextCapacity!,
        capacityTon: preview.nextCapacity!,
        upgradeTier: nextTier,
      };
      return {
        ...upgraded,
        dailyOperatingCost: resolveWarehouseDailyOperatingCost(upgraded, city),
      };
    });
    const upgradeTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: upgradeCost,
      kind: 'voluntary-expense',
      referenceId: `warehouse:${warehouse.id}:upgrade:${nextTier}`,
      transactionId: `warehouse-upgrade:${warehouse.id}:${nextTier}`,
    });

    set({
      player: {
        ...state.player,
        money: upgradeTransaction.cashAfter,
        warehouses: updatedWarehouses,
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'warehouse_open',
        amount: upgradeTransaction.amount,
        description: `${cityName} deposu yükseltildi`,
        transactionId: upgradeTransaction.transactionId,
        referenceId: upgradeTransaction.referenceId,
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
    return tradeOk(`${cityName} deposu yükseltildi (+${capacityIncrease} ton, ${upgradeLabel}).`);
  },

  buyProductForWarehouse: ({
    cityId,
    productId,
    quantity,
    warehouseId,
  }): TradeActionResult => {
    const state = get();
    if (!hasUsableGlobalMarketSnapshot(state)) {
      return tradeFail(
        'market-offline',
        'Fiyat kritik işlem için global piyasaya yeniden bağlanmalısın.',
        'MARKET_OFFLINE',
      );
    }

    const quantityError = validateTradeQuantity(quantity);
    if (quantityError) {
      return tradeFail('invalid-quantity', quantityError, 'INVALID_QUANTITY');
    }

    const city = state.cities.find((candidate) => candidate.id === cityId);
    if (!city) {
      return tradeFail('invalid-city', 'Şehir bulunamadı.', 'CITY_NOT_FOUND');
    }

    if (!warehouseId) {
      return tradeFail(
        'warehouse-required',
        'Satın alma için bir depo seçmelisin.',
        'WAREHOUSE_NOT_FOUND',
      );
    }

    const warehouse = state.player.warehouses.find((candidate) => candidate.id === warehouseId);

    if (!warehouse || warehouse.cityId !== cityId) {
      return tradeFail(
        'warehouse-required',
        'Seçilen depo bu şehirde bulunamadı.',
        'WAREHOUSE_NOT_FOUND',
      );
    }

    const product = getProductByIdSafe(productId);
    if (!product) {
      return tradeFail('product-not-found', 'Ürün bulunamadı.', 'PRODUCT_NOT_FOUND');
    }

    const storageBlock = resolveStorageBlockResult(product, warehouse.warehouseType);
    if (storageBlock) {
      return storageBlock;
    }

    const warehouseType = resolveWarehouseType(warehouse.warehouseType);
    const unitPrice = getEffectiveTradeUnitPrice(state, city, productId);
    const cityStock = getCityProductStock(city, productId);
    const normalizedWarehouse = normalizeWarehouse(warehouse, state.currentTime);
    const freeCapacity = getWarehouseFreeCapacityTon(normalizedWarehouse);

    if (quantity > cityStock) {
      return tradeFail(
        'insufficient-market-stock',
        `Şehir stoğu yetersiz. Mevcut: ${cityStock.toFixed(1)} ton.`,
        'INSUFFICIENT_STOCK',
      );
    }

    if (quantity > freeCapacity) {
      return tradeFail(
        'warehouse-full',
        `Depo kapasitesi yetersiz. Boş alan: ${freeCapacity.toFixed(1)} ton.`,
        'INSUFFICIENT_CAPACITY',
      );
    }

    const totalCost = calculateTradeBuyCost(unitPrice, quantity);
    if (!canAffordVoluntaryPurchase(state.player.money, totalCost)) {
      return tradeFail(
        'insufficient-funds',
        `Yetersiz nakit. Gerekli: ${formatNotificationMoney(totalCost)}`,
        'INSUFFICIENT_FUNDS',
      );
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
    const inventoryBefore =
      getWarehouseInventoryItem(normalizedWarehouse, productId)?.quantity ?? 0;
    const purchaseTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: totalCost,
      kind: 'voluntary-expense',
      referenceId: `market:${warehouse.id}:${productId}:purchase`,
      transactionId:
        `market-purchase:${warehouse.id}:${productId}:${state.currentTime}:${inventoryBefore}`,
    });

    set({
      player: {
        ...state.player,
        money: purchaseTransaction.cashAfter,
        warehouses: updatedWarehouses,
      },
      cities: updateCityProductStock(state.cities, cityId, productId, -quantity),
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'market_purchase',
        amount: purchaseTransaction.amount,
        description: `${cityName} · ${quantity.toFixed(1)} ton ${productName} (işlem gideri dahil)`,
        meta: { productId },
        transactionId: purchaseTransaction.transactionId,
        referenceId: purchaseTransaction.referenceId,
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
    get().advanceOnboardingProgress();
    get().applyRetentionEventAndSync({
      type: 'trade_completed',
      profit: 0,
      productId,
      side: 'buy',
    });
    get().applyRetentionEventAndSync({
      type: 'warehouse_stock_changed',
      totalStockTons: usedCapacityTon,
    });
    return tradeOk(`${quantity.toFixed(1)} ton ${productName} depoya eklendi.`);
  },

  sellProductFromWarehouse: ({
    warehouseId,
    productId,
    quantity,
  }): TradeActionResult => {
    const state = get();
    if (!hasUsableGlobalMarketSnapshot(state)) {
      return tradeFail(
        'market-offline',
        'Fiyat kritik işlem için global piyasaya yeniden bağlanmalısın.',
        'MARKET_OFFLINE',
      );
    }

    const quantityError = validateTradeQuantity(quantity);
    if (quantityError) {
      return tradeFail('invalid-quantity', quantityError, 'INVALID_QUANTITY');
    }

    const warehouse = state.player.warehouses.find((candidate) => candidate.id === warehouseId);
    if (!warehouse) {
      return tradeFail('warehouse-required', 'Depo bulunamadı.', 'WAREHOUSE_NOT_FOUND');
    }

    const city = state.cities.find((candidate) => candidate.id === warehouse.cityId);
    if (!city) {
      return tradeFail('invalid-city', 'Depo şehri bulunamadı.', 'CITY_NOT_FOUND');
    }

    const normalizedWarehouse = normalizeWarehouse(warehouse);
    const inventoryItem = getWarehouseInventoryItem(normalizedWarehouse, productId);
    const availableQuantity = inventoryItem?.quantity ?? 0;

    if (!inventoryItem || availableQuantity <= 0) {
      return tradeFail(
        'insufficient-inventory',
        'Depoda satılacak ürün yok.',
        'INSUFFICIENT_INVENTORY',
      );
    }

    if (quantity > availableQuantity) {
      return tradeFail(
        'insufficient-inventory',
        `Depoda yalnızca ${availableQuantity.toFixed(1)} ton var.`,
        'INSUFFICIENT_INVENTORY',
      );
    }

    const unitPrice = getEffectiveTradeUnitPrice(state, city, productId);
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
    const saleTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: revenue,
      kind: 'income',
      referenceId: `market:${warehouse.id}:${productId}:sale`,
      transactionId:
        `market-sale:${warehouse.id}:${productId}:${state.currentTime}:${availableQuantity}`,
    });

    set({
      player: {
        ...state.player,
        money: saleTransaction.cashAfter,
        warehouses: updatedWarehouses,
      },
      cities: updateCityProductStock(state.cities, warehouse.cityId, productId, quantity),
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'income',
        category: 'market_sale',
        amount: saleTransaction.amount,
        description: `${productName} · Net kâr: ${formatNotificationMoney(profit)} (işlem gideri dahil)`,
        meta: { productId, profit },
        transactionId: saleTransaction.transactionId,
        referenceId: saleTransaction.referenceId,
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

    get().applyRetentionEventAndSync({
      type: 'trade_completed',
      profit: Math.max(0, profit),
      productId,
      side: 'sell',
    });
    get().applyRetentionEventAndSync({
      type: 'warehouse_stock_changed',
      totalStockTons: usedCapacityTon,
    });

    get().markSaveDirty();
    get().autoSave('warehouse');
    return tradeOk(`${quantity.toFixed(1)} ton ${productName} satıldı.`);
  },

  updateWarehouseStockTransfers: (hoursPassed: number) => {
    if (hoursPassed <= 0) {
      return;
    }

    const state = get();
    const transfersToComplete: string[] = [];
    const fuelWarningsToNotify: Array<{
      jobId: string;
      title: string;
      message: string;
      key: string;
    }> = [];

    let updatedTrucks = state.player.trucks;
    const updatedTransfers = (state.activeWarehouseStockTransfers ?? []).map((transfer) => {
      if (
        transfer.status !== 'active' &&
        transfer.status !== 'pending' &&
        transfer.status !== 'paused'
      ) {
        return transfer;
      }
      const truck = updatedTrucks.find((candidate) => candidate.id === transfer.truckId);
      if (!truck) {
        return transfer;
      }
      const fuelUpdate = updateWarehouseStockTransferProgressWithFuel(
        transfer,
        truck,
        hoursPassed,
        state.currentTime,
      );
      const warningEvaluation = evaluateFuelWarning(fuelUpdate.transfer, fuelUpdate.truck);
      const updated = {
        ...fuelUpdate.transfer,
        fuelWarningsEmitted: warningEvaluation.fuelWarningsEmitted,
      };
      if (warningEvaluation.warning) {
        fuelWarningsToNotify.push({
          jobId: transfer.id,
          title: warningEvaluation.warning.title,
          message: warningEvaluation.warning.message,
          key: warningEvaluation.warning.key,
        });
      }
      updatedTrucks = updatedTrucks.map((candidate) =>
        candidate.id === truck.id ? fuelUpdate.truck : candidate,
      );
      if (updated.progress >= 1) {
        transfersToComplete.push(updated.id);
      }
      return updated;
    });

    set({
      activeWarehouseStockTransfers: updatedTransfers,
      player: {
        ...state.player,
        trucks: updatedTrucks,
      },
    });

    for (const warning of fuelWarningsToNotify) {
      get().addNotification({
        id: `fuel-warning:${warning.jobId}:${warning.key}`,
        time: state.currentTime,
        type: warning.key === 'out-of-fuel' ? 'error' : 'warning',
        title: warning.title,
        message: warning.message,
        actionLabel: 'Haritada Gör',
        actionTarget: 'map',
      });
    }

    for (const transferId of transfersToComplete) {
      const current = get().activeWarehouseStockTransfers.find((item) => item.id === transferId);
      if (
        current &&
        (current.status === 'active' || current.status === 'pending') &&
        current.progress >= 1 &&
        (current.lastFuelProcessedProgress == null ||
          current.lastFuelProcessedProgress >= 0.999) &&
        current.settledAt == null
      ) {
        get().completeWarehouseStockTransferById(transferId);
      }
    }
  },

  startWarehouseStockTransfer: ({
    sourceWarehouseId,
    destinationWarehouseId,
    productId,
    quantityTons,
    truckId,
    driverId,
  }): TradeActionResult => {
    const state = get();
    const validation = validateWarehouseStockTransfer({
      sourceWarehouseId,
      destinationWarehouseId,
      productId,
      quantityTons,
      truckId,
      driverId,
      warehouses: state.player.warehouses,
      trucks: state.player.trucks,
      trailers: state.player.trailers ?? [],
      drivers: state.player.drivers,
      routes: state.routes,
      activeWarehouseStockTransfers: state.activeWarehouseStockTransfers,
      activeTransfers: state.activeTransfers,
      activeDeliveries: state.activeDeliveries,
      homeCityId: state.player.homeCityId,
      playerMoney: state.player.money,
      fuelPrice: getSnapshotFuelPrice(
        state.cachedGlobalEconomySnapshot,
        state.globalEconomy,
      ),
    });

    if (!validation.success || !validation.validated) {
      return validation;
    }

    const transfer = createWarehouseStockTransfer({
      validated: validation.validated,
      currentTime: state.currentTime,
      sequence: (state.activeWarehouseStockTransfers ?? []).length + 1,
    });

    const reservedWarehouses = applySourceReservationOnStart(
      state.player.warehouses,
      transfer,
      state.currentTime,
    );

    const truck = validation.validated.truck;
    const driver = validation.validated.driver;

    const updatedTrucks = state.player.trucks.map((candidate) =>
      candidate.id === truck.id ? { ...candidate, status: 'transferring' as const } : candidate,
    );
    const updatedDrivers = state.player.drivers.map((candidate) =>
      candidate.id === driver.id
        ? { ...candidate, status: 'driving' as const, assignedTruckId: truck.id }
        : candidate,
    );
    const updatedTrailers = syncTrailersWithTruckLocation(
      state.player.trailers ?? [],
      truck.id,
      transfer.sourceCityId,
      'transferring',
    );

    const productName = getProductDisplayName(productId);
    const routeLabel = `${getCityName(transfer.sourceCityId)} → ${getCityName(transfer.destinationCityId)}`;
    set({
      player: {
        ...state.player,
        warehouses: reservedWarehouses,
        trucks: updatedTrucks,
        drivers: updatedDrivers,
        trailers: updatedTrailers,
      },
      activeWarehouseStockTransfers: [
        ...(state.activeWarehouseStockTransfers ?? []),
        transfer,
      ],
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'warehouse',
          title: 'Stok transferi başladı',
          message: `${quantityTons.toFixed(1)} ton ${productName}, ${routeLabel} rotasına çıktı.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    get().markSaveDirty();
    get().autoSave('transfer_started');
    return {
      ...tradeOk('Stok transferi başladı.'),
      transferId: transfer.id,
    };
  },

  completeWarehouseStockTransferById: (transferId: string) => {
    const state = get();
    if (settledWarehouseStockTransferIds.has(transferId)) {
      return;
    }

    const transfer = (state.activeWarehouseStockTransfers ?? []).find(
      (candidate) => candidate.id === transferId,
    );
    if (!transfer || transfer.settledAt != null) {
      return;
    }
    if (transfer.status !== 'active' && transfer.status !== 'pending') {
      return;
    }
    if (transfer.progress < 1) {
      return;
    }

    settledWarehouseStockTransferIds.add(transferId);

    const completed = markWarehouseStockTransferSettled(transfer, 'completed', state.currentTime);
    const warehouses = applyDestinationCompletion(
      state.player.warehouses,
      completed,
      state.currentTime,
    );

    const updatedTrucks = state.player.trucks.map((candidate) => {
      if (candidate.id !== transfer.truckId) {
        return candidate;
      }
      const arrived = {
        ...candidate,
        status: 'idle' as const,
        currentCityId: transfer.destinationCityId,
      };
      if (transfer.fuelConsumedL != null) {
        return normalizeTruckFuel(arrived);
      }
      return finalizeTruckFuelAfterJob({
        truck: arrived,
        fuelLitersAtStart: transfer.fuelLitersAtStart,
        fuelLitersTotal: transfer.fuelLitersTotal,
        distanceKm: transfer.routeDistanceKm,
      });
    });

    const updatedDrivers = state.player.drivers.map((candidate) =>
      candidate.id === transfer.driverId
        ? {
            ...candidate,
            status: 'idle' as const,
            currentCityId: transfer.destinationCityId,
            assignedTruckId: transfer.truckId,
          }
        : candidate,
    );

    const updatedTrailers = syncTrailersWithTruckLocation(
      state.player.trailers ?? [],
      transfer.truckId,
      transfer.destinationCityId,
      'idle',
    );

    const productName = getProductDisplayName(transfer.productId);

    set({
      player: {
        ...state.player,
        warehouses,
        trucks: updatedTrucks,
        drivers: updatedDrivers,
        trailers: updatedTrailers,
      },
      activeWarehouseStockTransfers: (state.activeWarehouseStockTransfers ?? []).filter(
        (candidate) => candidate.id !== transferId,
      ),
      completedWarehouseStockTransfers: appendCompletedWarehouseStockTransfer(
        state.completedWarehouseStockTransfers,
        completed,
      ),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          id: `event_wst_complete_${transferId}`,
          time: state.currentTime,
          type: 'warehouse',
          title: 'Stok transferi tamamlandı',
          message: `${transfer.quantityTons.toFixed(1)} ton ${productName}, ${getCityName(transfer.destinationCityId)} deposuna ulaştı.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });

    get().markSaveDirty();
    get().autoSave('transfer_completed');
  },

  cancelWarehouseStockTransfer: (transferId: string): TradeActionResult => {
    const state = get();
    const transfer = (state.activeWarehouseStockTransfers ?? []).find(
      (candidate) => candidate.id === transferId,
    );
    if (!transfer) {
      return tradeFail('warehouse-required', 'Transfer bulunamadı.');
    }
    if (transfer.settledAt != null || settledWarehouseStockTransferIds.has(transferId)) {
      return tradeFail('transfer-in-progress', 'Transfer zaten kapatıldı.');
    }
    if (transfer.status !== 'active' && transfer.status !== 'pending') {
      return tradeFail('transfer-in-progress', 'Transfer iptal edilemez.');
    }

    settledWarehouseStockTransferIds.add(transferId);
    const cancelled = markWarehouseStockTransferSettled(transfer, 'cancelled', state.currentTime);
    const warehouses = rollbackStockToSource(
      state.player.warehouses,
      cancelled,
      state.currentTime,
    );

    const updatedTrucks = state.player.trucks.map((candidate) =>
      candidate.id === transfer.truckId
        ? {
            ...candidate,
            status: 'idle' as const,
            currentCityId: transfer.sourceCityId,
          }
        : candidate,
    );
    const updatedDrivers = state.player.drivers.map((candidate) =>
      candidate.id === transfer.driverId
        ? { ...candidate, status: 'idle' as const, currentCityId: transfer.sourceCityId }
        : candidate,
    );
    const updatedTrailers = syncTrailersWithTruckLocation(
      state.player.trailers ?? [],
      transfer.truckId,
      transfer.sourceCityId,
      'idle',
    );

    set({
      player: {
        ...state.player,
        warehouses,
        trucks: updatedTrucks,
        drivers: updatedDrivers,
        trailers: updatedTrailers,
      },
      activeWarehouseStockTransfers: (state.activeWarehouseStockTransfers ?? []).filter(
        (candidate) => candidate.id !== transferId,
      ),
      completedWarehouseStockTransfers: appendCompletedWarehouseStockTransfer(
        state.completedWarehouseStockTransfers,
        cancelled,
      ),
    });

    get().markSaveDirty();
    get().autoSave('transfer_completed');
    return tradeOk('Transfer iptal edildi; stok kaynak depoya döndü.');
  },

  failWarehouseStockTransfer: (transferId: string, reason?: string): TradeActionResult => {
    const state = get();
    const transfer = (state.activeWarehouseStockTransfers ?? []).find(
      (candidate) => candidate.id === transferId,
    );
    if (!transfer) {
      return tradeFail('warehouse-required', 'Transfer bulunamadı.');
    }
    if (transfer.settledAt != null || settledWarehouseStockTransferIds.has(transferId)) {
      return tradeOk('Transfer zaten sonuçlandı.');
    }

    settledWarehouseStockTransferIds.add(transferId);
    const failed = markWarehouseStockTransferSettled(
      transfer,
      'failed',
      state.currentTime,
      reason ?? 'failed',
    );
    const warehouses = rollbackStockToSource(state.player.warehouses, failed, state.currentTime);

    const updatedTrucks = state.player.trucks.map((candidate) =>
      candidate.id === transfer.truckId
        ? {
            ...candidate,
            status: 'idle' as const,
            currentCityId: transfer.sourceCityId,
          }
        : candidate,
    );
    const updatedDrivers = state.player.drivers.map((candidate) =>
      candidate.id === transfer.driverId
        ? { ...candidate, status: 'idle' as const, currentCityId: transfer.sourceCityId }
        : candidate,
    );
    const updatedTrailers = syncTrailersWithTruckLocation(
      state.player.trailers ?? [],
      transfer.truckId,
      transfer.sourceCityId,
      'idle',
    );

    set({
      player: {
        ...state.player,
        warehouses,
        trucks: updatedTrucks,
        drivers: updatedDrivers,
        trailers: updatedTrailers,
      },
      activeWarehouseStockTransfers: (state.activeWarehouseStockTransfers ?? []).filter(
        (candidate) => candidate.id !== transferId,
      ),
      completedWarehouseStockTransfers: appendCompletedWarehouseStockTransfer(
        state.completedWarehouseStockTransfers,
        failed,
      ),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'warehouse',
          title: 'Stok transferi başarısız',
          message:
            reason ??
            getWarehouseStockTransferReasonMessage('transfer-in-progress'),
          importance: 'high',
        },
        state.currentTime,
      ),
    });

    get().markSaveDirty();
    get().autoSave('transfer_completed');
    return tradeOk('Transfer geri alındı; stok kaynak depoya döndü.');
  },

  refuelTruck: ({ truckId, liters, expectedUnitPrice, idempotencyKey }) => {
    const state = get();
    const fuelQuote = resolveStoreFuelPriceQuote(state);
    if (!isFuelPricePurchaseReady(fuelQuote) || fuelQuote.pricePerLiter == null) {
      return {
        success: false,
        reason: 'market-unavailable',
        message: 'Yakıt fiyatına ulaşılamıyor. Tekrar dene.',
      };
    }
    if (idempotencyKey && (state.fuelTransactionKeys ?? []).includes(idempotencyKey)) {
      return {
        success: true,
        message: 'Yakıt işlemi daha önce uygulandı.',
      };
    }
    const truck = state.player.trucks.find((candidate) => candidate.id === truckId);
    if (!truck) {
      return {
        success: false,
        reason: 'truck-not-found',
        message: 'Kamyon bulunamadı.',
      };
    }
    const unitPrice = fuelQuote.pricePerLiter;
    const validation = validateTruckRefuelRequest({
      truck,
      requestedLiters: liters,
      currentMoney: state.player.money,
      currentUnitPrice: unitPrice,
      expectedUnitPrice,
    });
    if (!validation.result.success || !validation.quote) {
      return validation.result;
    }
    const quote = validation.quote;
    const transactionId =
      idempotencyKey ??
      `refuel:${truck.id}:${quote.currentFuelL}:${quote.newFuelL}:${quote.unitPrice}`;
    const cashTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: quote.totalCost,
      kind: 'voluntary-expense',
      referenceId: `truck:${truck.id}:fuel`,
      transactionId,
      appliedTransactionIds: state.fuelTransactionKeys ?? [],
    });
    if (!cashTransaction.ok) {
      return {
        success: false,
        reason: 'insufficient-funds',
        message: 'Yakıt almak için yeterli nakdin yok.',
      };
    }

    const updatedTrucks = state.player.trucks.map((candidate) =>
      candidate.id === truck.id
        ? normalizeTruckFuel({ ...candidate, currentFuelL: quote.newFuelL })
        : candidate,
    );
    set({
      player: {
        ...state.player,
        money: cashTransaction.cashAfter,
        trucks: updatedTrucks,
      },
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'fuel_purchase',
        amount: cashTransaction.amount,
        description: `${truck.name} · ${quote.litersToAdd.toFixed(1)} L yakıt alımı`,
        transactionId: cashTransaction.transactionId,
        referenceId: cashTransaction.referenceId,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'finance',
          title: 'Yakıt alındı',
          message: `${truck.name} için ${quote.litersToAdd.toFixed(1)} L yakıt alındı.`,
          importance: 'low',
        },
        state.currentTime,
      ),
      fuelTransactionKeys: [
        ...(state.fuelTransactionKeys ?? []),
        cashTransaction.transactionId,
      ].slice(-32),
    });
    get().markSaveDirty();
    get().autoSave('fuel_purchase');
    return validation.result;
  },

  purchaseRoadsideFuel: ({ jobId, liters, expectedUnitPrice, idempotencyKey }) => {
    const state = get();
    const fuelQuote = resolveStoreFuelPriceQuote(state);
    if (!isFuelPricePurchaseReady(fuelQuote) || fuelQuote.pricePerLiter == null) {
      return {
        success: false,
        reason: 'market-unavailable',
        message: 'Yakıt fiyatına ulaşılamıyor. Tekrar dene.',
        source: 'roadside-emergency',
      };
    }
    if (idempotencyKey && (state.fuelTransactionKeys ?? []).includes(idempotencyKey)) {
      return {
        success: true,
        message: 'Acil yakıt işlemi daha önce uygulandı.',
        source: 'roadside-emergency',
      };
    }
    const delivery = state.activeDeliveries.find((job) => job.id === jobId);
    const truckTransfer = (state.activeTransfers ?? []).find((job) => job.id === jobId);
    const warehouseTransfer = (state.activeWarehouseStockTransfers ?? []).find(
      (job) => job.id === jobId,
    );
    const job = (delivery ?? truckTransfer ?? warehouseTransfer) as RoadsideFuelJob | undefined;
    const truck = job
      ? state.player.trucks.find((candidate) => candidate.id === job.truckId)
      : undefined;
    const unitPrice = fuelQuote.pricePerLiter;
    const validation = validateRoadsideFuelPurchase({
      job,
      truck,
      requestedLiters: liters,
      currentMoney: state.player.money,
      currentUnitPrice: unitPrice,
      expectedUnitPrice,
    });
    if (!validation.result.success || !validation.quote || !job || !truck) {
      return validation.result;
    }
    const quote = validation.quote;
    const transactionId =
      idempotencyKey ??
      `roadside:${job.id}:${quote.litersToAdd}:${quote.totalCost}`;
    const cashTransaction = applyCashTransaction({
      currentCash: state.player.money,
      amount: quote.totalCost,
      kind: 'voluntary-expense',
      referenceId: `job:${job.id}:roadside-fuel`,
      transactionId,
      appliedTransactionIds: state.fuelTransactionKeys ?? [],
    });
    if (!cashTransaction.ok) {
      return {
        success: false,
        reason: 'insufficient-funds',
        message: 'Yakıt almak için yeterli nakdin yok.',
        source: 'roadside-emergency',
      };
    }
    const resumedTruckStatus = delivery ? 'on_route' as const : 'transferring' as const;
    const updatedTrucks = state.player.trucks.map((candidate) =>
      candidate.id === truck.id
        ? normalizeTruckFuel({
            ...candidate,
            currentFuelL: quote.newFuelL,
            status: resumedTruckStatus,
          })
        : candidate,
    );
    set({
      player: {
        ...state.player,
        money: cashTransaction.cashAfter,
        trucks: updatedTrucks,
      },
      activeDeliveries: state.activeDeliveries.map((candidate) =>
        candidate.id === jobId
          ? resumeRoadsideJob(candidate, 'delivery', { litersAdded: quote.litersToAdd })
          : candidate,
      ),
      activeTransfers: (state.activeTransfers ?? []).map((candidate) =>
        candidate.id === jobId
          ? resumeRoadsideJob(candidate, 'truck-transfer', { litersAdded: quote.litersToAdd })
          : candidate,
      ),
      activeWarehouseStockTransfers: (state.activeWarehouseStockTransfers ?? []).map(
        (candidate) =>
          candidate.id === jobId
            ? resumeRoadsideJob(candidate, 'warehouse-transfer', {
                litersAdded: quote.litersToAdd,
              })
            : candidate,
      ),
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'roadside_fuel',
        amount: cashTransaction.amount,
        title: 'Acil yol yakıtı',
        description: `${truck.name} · ${quote.litersToAdd.toFixed(1)} L · servis ${formatNotificationMoney(quote.serviceFee)}`,
        source: 'roadside-emergency',
        transactionId: cashTransaction.transactionId,
        referenceId: cashTransaction.referenceId,
      }),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'fleet',
          title: 'Araç yeniden yola çıktı',
          message: `${truck.name} için ${quote.litersToAdd.toFixed(1)} L acil yakıt teslim edildi.`,
          importance: 'medium',
        },
        state.currentTime,
      ),
      fuelTransactionKeys: [
        ...(state.fuelTransactionKeys ?? []),
        cashTransaction.transactionId,
      ].slice(-32),
    });
    get().addNotification({
      time: state.currentTime,
      type: 'success',
      title: 'Acil yakıt teslim edildi',
      message: `${truck.name} kaldığı yerden devam ediyor.`,
      actionLabel: 'Haritada Gör',
      actionTarget: 'map',
    });
    get().markSaveDirty();
    get().autoSave('roadside_fuel');
    return validation.result;
  },

  requestRoadsideFuelAssistance: (jobId) => {
    const state = get();
    const delivery = state.activeDeliveries.find((job) => job.id === jobId);
    const truckTransfer = (state.activeTransfers ?? []).find((job) => job.id === jobId);
    const warehouseTransfer = (state.activeWarehouseStockTransfers ?? []).find(
      (job) => job.id === jobId,
    );
    const job = (delivery ?? truckTransfer ?? warehouseTransfer) as RoadsideFuelJob | undefined;
    if (!job || job.status !== 'paused' || job.pausedReason !== 'out-of-fuel') {
      return {
        success: false,
        reason: 'job-not-out-of-fuel',
        message: 'Sınırlı yardım yalnız yakıtsız kalan aktif iş için kullanılabilir.',
      };
    }
    const truck = state.player.trucks.find((candidate) => candidate.id === job.truckId);
    if (!truck) {
      return { success: false, reason: 'truck-not-found', message: 'Kamyon bulunamadı.' };
    }
    const unitPrice = getSnapshotFuelPrice(
      state.cachedGlobalEconomySnapshot,
      state.globalEconomy,
    );
    const assistance = evaluateRoadsideFuelAssistance({
      truck,
      money: state.player.money,
      fuelPrice: unitPrice,
      currentTime: state.currentTime,
      lastAssistanceAt: state.lastRoadsideFuelAssistanceAt,
      jobAssistanceGrantedAt: job.roadsideAssistanceGrantedAt,
    });
    if (!assistance.allowed) {
      const reason =
        assistance.reason === 'already-used'
          ? 'assistance-already-used'
          : assistance.reason === 'cooldown'
            ? 'assistance-cooldown'
            : 'insufficient-funds';
      const message =
        assistance.reason === 'already-used'
          ? 'Bu iş için sınırlı yol yardımı zaten kullanıldı.'
          : assistance.reason === 'cooldown'
            ? 'Sınırlı yol yardımı henüz tekrar kullanılamaz.'
            : 'Sınırlı yardım koşulları karşılanmıyor.';
      return { success: false, reason, message };
    }

    const normalized = normalizeTruckFuel(truck);
    const capacity = normalized.fuelTankCapacityL ?? 0;
    const currentFuel = normalized.currentFuelL ?? 0;
    const litersAdded = Math.min(assistance.liters, Math.max(0, capacity - currentFuel));
    const newFuelL = currentFuel + litersAdded;
    const resumedTruckStatus = delivery ? 'on_route' as const : 'transferring' as const;
    set({
      player: {
        ...state.player,
        trucks: state.player.trucks.map((candidate) =>
          candidate.id === truck.id
            ? normalizeTruckFuel({
                ...candidate,
                currentFuelL: newFuelL,
                status: resumedTruckStatus,
              })
            : candidate,
        ),
      },
      activeDeliveries: state.activeDeliveries.map((candidate) =>
        candidate.id === jobId
          ? resumeRoadsideJob(candidate, 'delivery', {
              litersAdded,
              roadsideAssistanceGrantedAt: state.currentTime,
            })
          : candidate,
      ),
      activeTransfers: (state.activeTransfers ?? []).map((candidate) =>
        candidate.id === jobId
          ? resumeRoadsideJob(candidate, 'truck-transfer', {
              litersAdded,
              roadsideAssistanceGrantedAt: state.currentTime,
            })
          : candidate,
      ),
      activeWarehouseStockTransfers: (state.activeWarehouseStockTransfers ?? []).map(
        (candidate) =>
          candidate.id === jobId
            ? resumeRoadsideJob(candidate, 'warehouse-transfer', {
                litersAdded,
                roadsideAssistanceGrantedAt: state.currentTime,
              })
            : candidate,
      ),
      lastRoadsideFuelAssistanceAt: state.currentTime,
      ...patchFinanceLedger(state, {
        time: state.currentTime,
        type: 'expense',
        category: 'fuel',
        amount: 0,
        title: 'Sınırlı yol yardımı',
        description: `${truck.name} · ${litersAdded.toFixed(1)} L yardım · normal bedel ${formatNotificationMoney(assistance.avoidedCost)}`,
        source: 'roadside-emergency',
      }),
    });
    get().addNotification({
      time: state.currentTime,
      type: 'info',
      title: 'Sınırlı yol yardımı',
      message: `${litersAdded.toFixed(1)} L yakıt sağlandı. Bu yardım cooldown süresine tabidir.`,
      actionLabel: 'Haritada Gör',
      actionTarget: 'map',
    });
    get().markSaveDirty();
    get().autoSave('roadside_fuel');
    return {
      success: true,
      message: `${litersAdded.toFixed(1)} L sınırlı yol yardımı sağlandı.`,
      litersAdded,
      totalCost: 0,
      source: 'roadside-emergency',
    };
  },

  refuelOrUpdateFuelPrice: () => {
    void get().refreshMarketSnapshot();
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

  debugSimulateOfflineRealMinutes: (minutes = 30) => {
    const state = get();
    const simulationGameSpeed = getEffectiveOfflineGameSpeed(state);
    const realMinutes = Math.max(1, Math.floor(minutes));
    const appliedMs = realMinutes * 60_000;
    const gameHours = realMsToGameHours(appliedMs, simulationGameSpeed);

    offlineProgressionActive = true;
    try {
      if (gameHours > 0) {
        get().advanceTime(gameHours);
      }
    } finally {
      offlineProgressionActive = false;
    }

    if (__DEV__) {
      console.log(
        `[offline-debug] realMinutes=${realMinutes} gameHours=${gameHours.toFixed(2)} gameSpeed=${simulationGameSpeed}`,
      );
    }

    return { realMinutes, gameHours, gameSpeed: simulationGameSpeed };
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

  debugInjectDeliveryIncident: (incidentType) => {
    if (!__DEV__) {
      return { ok: false, reason: 'Production build.' };
    }

    const state = get();
    const activeDelivery = state.activeDeliveries.find(
      (delivery) => delivery.status === 'on_route' || delivery.status === 'preparing',
    );

    if (!activeDelivery) {
      get().addNotification({
        time: state.currentTime,
        type: 'warning',
        title: 'Aktif teslimat yok',
        message: 'Hızlı müdahale testi için önce bir teslimat başlat.',
        autoDismissMs: 3500,
      });
      return { ok: false, reason: 'Aktif teslimat yok' };
    }

    const incident = createDebugDeliveryIncident(
      activeDelivery,
      state.currentTime,
      incidentType,
    );

    const nextDeliveries = state.activeDeliveries.map((delivery) =>
      delivery.id === activeDelivery.id
        ? {
            ...delivery,
            incident,
            incidentGenerated: true,
            incidentResolved: false,
          }
        : delivery,
    );

    set({ activeDeliveries: nextDeliveries });
    get().markSaveDirty();

    get().addNotification({
      time: state.currentTime,
      type: 'info',
      title: 'Debug incident eklendi',
      message: `${incident.title} · ${getCityName(activeDelivery.originCityId)} → ${getCityName(activeDelivery.destinationCityId)}`,
      autoDismissMs: 3000,
    });

    return { ok: true };
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

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  installDebugContractsInspector(
    () => useGameStore.getState().contracts,
    () => {
      const state = useGameStore.getState();
      if (!state.player) return null;
      return resolveDebugOriginCityId(state.player.trucks, state.player.homeCityId);
    },
  );
}

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
