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
  StartDeliveryResult,
  StartTruckTransferResult,
  StoreGameState,
  TradeActionResult,
  Truck,
  TruckTransfer,
  Warehouse,
  WarehouseType,
} from '../types/game';
import { resolveNotificationDismissMs } from '../types/game';
import { CITIES, CITIES_BY_ID } from '../data/cities';
import { PRODUCTS, PRODUCT_BY_ID } from '../data/products';
import { ROUTES } from '../data/routes';
import {
  findDriverPoolItem,
  getDriverPoolForLevel,
  getDriverTierLabel,
  isDriverPoolItemHired,
  resolveDriverRequiredLevel,
  STARTER_DRIVER,
} from '../data/drivers';
import { findTruckMarketItem, resolveTruckMarketRequiredLevel, STARTER_TRUCK } from '../data/trucks';
import {
  DEFAULT_GLOBAL_ECONOMY,
  randomBetween,
  updateAllCitiesEconomy,
} from '../simulation/economy';
import {
  expireOldContracts,
  generateContracts,
  getRouteBetweenCities,
  mergeContractLists,
  randomBetween as contractRandomBetween,
  refreshContractsFromMarket,
  replenishAvailableContracts,
} from '../simulation/contracts';
import {
  availabilityReasonToStartDeliveryErrorCode,
  calculateLatePenalty,
  calculateTruckRepairCost,
  canTruckCarryContract,
  completeDelivery as completeDeliverySim,
  createDelivery,
  getContractAvailability,
  getContractCargoWeight,
  getHighestOwnedTruckCapacity,
  getMaxIdleTruckCapacity,
  DeliveryError,
  failDelivery as failDeliverySim,
  formatCapacityExceededMessage,
  getIdleTruckOriginCityIds,
  normalizeTruckCity,
  resolveTruckCityId,
  selectIdleTruckForContract,
  randomBetween as deliveryRandomBetween,
  updateDeliveryProgress,
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
import { contractBalance, economyBalance, levelBalance, tradingBalance, warehouseBalance } from '../config/balance';
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
  clearSavedGame,
  hasSavedGame,
  loadGameState,
  normalizeLoadedPlayer,
  SAVE_GAME_VERSION,
  saveGameState,
} from '../storage/saveGame';

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const STARTING_MONEY = 20_000;
const AUTO_SAVE_MIN_INTERVAL_MS = 15_000;
const ENABLE_SAVE_LOGS = false;
const ECONOMY_TICK_INTERVAL_HOURS = 24;
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
  lastSavedAt: number | null;
  autoSaveEnabled: boolean;
  isDirty: boolean;
  isSaving: boolean;
  lastSaveReason: AutoSaveReason | null;
  saveVersion: number;
}

function createSaveStatusSnapshot(hasSave = false): SaveStatusSnapshot {
  return {
    hasSave,
    lastSavedAt: lastAutoSaveAt > 0 ? lastAutoSaveAt : null,
    autoSaveEnabled,
    isDirty: saveDirty,
    isSaving: isSavingGame,
    lastSaveReason,
    saveVersion: SAVE_GAME_VERSION,
  };
}

async function resolveSaveStatusPatch(): Promise<SaveStatusSnapshot> {
  try {
    const hasSave = await hasSavedGame();
    return createSaveStatusSnapshot(hasSave);
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
  const dedupeWindowHours = 3;
  return !eventLog.some(
    (event) =>
      event.type === 'market' &&
      (event.title === 'Yeni taşıma fırsatları' || event.title === 'Yeni sözleşmeler') &&
      currentTime - event.time < dedupeWindowHours,
  );
}

let lastContractMarketRefreshAt = Date.now();

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

function getCityName(cityId: string): string {
  return CITIES_BY_ID[cityId]?.name ?? cityId;
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

function createLedgerId(suffix: string): string {
  return `ledger_${Date.now()}_${suffix}`;
}

function prependFinanceLedger(
  entries: FinanceLedgerEntry[],
  entry: Omit<FinanceLedgerEntry, 'id'> & { id?: string },
): FinanceLedgerEntry[] {
  const record: FinanceLedgerEntry = {
    ...entry,
    id: entry.id ?? createLedgerId(`${Math.random().toString(36).slice(2, 8)}`),
  };
  return [record, ...entries].slice(0, FINANCE_LEDGER_MAX_COUNT);
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
  return { ...DEFAULT_GLOBAL_ECONOMY };
}

/** GDD Bölüm 6'ya göre başlangıç oyun durumu */
export function createInitialGameState(): StoreGameState {
  const globalEconomy = createInitialGlobalEconomy();
  const cities = cloneInitialCities();
  const initialContractCount = Math.floor(
    contractRandomBetween(
      contractBalance.initialContractsMin,
      contractBalance.initialContractsMax + 0.999,
    ),
  );
  const contracts = generateContracts(
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
    },
  );

  return {
    currentTime: 0,
    isPaused: false,
    gameSpeed: 1,
    lastEconomyTickTime: 0,
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
      trucks: [structuredClone(STARTER_TRUCK)],
      drivers: [structuredClone(STARTER_DRIVER)],
      warehouses: [
        {
          id: 'warehouse-starter-1',
          cityId: 'izmir',
          capacityTons: 100,
          upgradeTier: 1,
          warehouseType: 'standard',
          qualityProtection: 0.5,
          inventory: [],
          storedProducts: {},
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
  loadGame: () => Promise<boolean>;
  clearSave: () => Promise<void>;
  autoSave: (reason?: AutoSaveReason) => void;
  markSaveDirty: () => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  saveStatus: SaveStatusSnapshot;
  getSaveStatus: () => SaveStatusSnapshot;
  refreshSaveStatus: () => Promise<void>;
  /** App açılışında initializeGame tamamlandığında true olur */
  isGameReady: boolean;
  pauseGame: () => void;
  resumeGame: () => void;
  setGameSpeed: (speed: number) => void;
  advanceTime: (hours: number) => void;
  replenishContractsIfNeeded: () => void;
  runEconomyTick: () => void;
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
  hireDriver: (poolId: string) => TradeActionResult;
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
  addCompanyXp: (amount: number, reason?: string) => void;
  checkLevelUp: () => void;
  getLevelBenefits: (level?: number) => LevelBenefits;
  /** Debug/test — production'da gizlenmeli */
  debugAddCash: (amount: number) => void;
  debugRemoveCash: (amount: number) => void;
  debugSetCash: (amount: number) => void;
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
  saveStatus: createSaveStatusSnapshot(false),
  isGameReady: false,

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
      fromCityName: opportunity.fromCityName || CITIES_BY_ID[fromCityId]?.name || fromCityId,
      toCityName: opportunity.toCityName || CITIES_BY_ID[toCityId]?.name || toCityId,
      productName: opportunity.productName || PRODUCT_BY_ID[productId]?.name || productId,
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
      fromCityName: CITIES_BY_ID[originCityId]?.name ?? originCityId,
      toCityName: CITIES_BY_ID[destinationCityId]?.name ?? destinationCityId,
      productName: PRODUCT_BY_ID[productId]?.name ?? productId,
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
        if (await hasSavedGame()) {
          const loaded = await get().loadGame();
          if (loaded) {
            await get().refreshSaveStatus();
            return;
          }
        }

        set({ ...createInitialGameState(), isGameReady: false, saveStatus: get().saveStatus });
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
        await get().saveGame();
        await get().refreshSaveStatus();
      } catch (error) {
        console.warn('[gameStore] initializeGame failed:', error);
        set({ ...createInitialGameState(), isGameReady: false, saveStatus: get().saveStatus });
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
      } finally {
        set({ isGameReady: true });
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

  loadGame: async () => {
    try {
      const saved = await loadGameState();
      if (!saved) {
        return false;
      }

      set({
        ...saved,
        player: normalizeLoadedPlayer(saved.player),
        saveStatus: get().saveStatus,
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
      patchSaveStatus(set, {
        hasSave: true,
        lastSavedAt: lastAutoSaveAt,
        isDirty: false,
        autoSaveEnabled,
      });
      if (__DEV__) {
        console.log('[gameStore] Game loaded from save');
      }
      return true;
    } catch (error) {
      console.warn('[gameStore] loadGame failed:', error);
      return false;
    }
  },

  clearSave: async () => {
    try {
      await clearSavedGame();
    } catch (error) {
      console.warn('[gameStore] clearSave failed:', error);
    }

    set({ ...createInitialGameState(), saveStatus: get().saveStatus });
    resetAutoSaveTracking(0);
    await get().saveGame();
    await get().refreshSaveStatus();
  },

  autoSave: (reason?: AutoSaveReason) => {
    if (!autoSaveEnabled) {
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

    const scaledHours = hours * state.gameSpeed;
    const newTime = state.currentTime + scaledHours;

    set({ currentTime: newTime });

    get().updateDeliveries(scaledHours);
    get().updateTransfers(scaledHours);

    const stateAfterDelivery = get();
    const qualityResult = processWarehouseQualityDegradation(
      stateAfterDelivery.player.warehouses,
      newTime,
      scaledHours,
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

    // Her 24 oyun saatinde bir ekonomi tick'i
    let { lastEconomyTickTime } = get();
    while (lastEconomyTickTime + ECONOMY_TICK_INTERVAL_HOURS <= newTime) {
      lastEconomyTickTime += ECONOMY_TICK_INTERVAL_HOURS;
      set({ lastEconomyTickTime });
      get().runEconomyTick();
    }

    get().replenishContractsIfNeeded();
    get().clearOldMarketNews();
    get().clearOldGameEvents();
    get().markSaveDirty();
    get().autoSave('time_tick');
  },

  runEconomyTick: () => {
    const state = get();
    const previousFuelPrice = state.globalEconomy.fuelPrice;
    const previousCities = citiesToRecord(state.cities);

    // Şehir ekonomilerini güncelle
    const updatedCitiesRecord = updateAllCitiesEconomy(
      previousCities,
      state.globalEconomy,
    );

    // Yakıt fiyatını küçük rastgele değişimle güncelle
    const fuelChange = randomBetween(-0.06, 0.08);
    const newFuelPrice = Math.max(0.8, state.globalEconomy.fuelPrice * (1 + fuelChange));
    const globalEconomy: GlobalEconomy = {
      ...state.globalEconomy,
      fuelPrice: Number(newFuelPrice.toFixed(2)),
    };

    const expiredContracts = expireOldContracts(state.contracts, state.currentTime);
    const refreshParams = buildContractRefreshParams(state);
    const replenishResult = replenishAvailableContracts({
      ...refreshParams,
      cities: updatedCitiesRecord,
      globalEconomy,
      contracts: expiredContracts,
    });
    const { contracts: updatedContracts, newContracts } = replenishResult;

    const news: MarketNews[] = [];
    const gameEvents: Array<Omit<GameEvent, 'id'> & { id?: string }> = [];

    // Yakıt haberi
    const fuelDelta = (globalEconomy.fuelPrice - previousFuelPrice) / previousFuelPrice;
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
          const shortageTitle = `${city.name} — stok alarmı`;
          const shortageMessage = `${PRODUCT_BY_ID[productId as ProductId].name} stoğu hedefin %30 altına düştü.`;

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
          news.push({
            id: createNewsId(state.currentTime, `surp_${city.id}_${productId}`),
            time: state.currentTime,
            type: 'economy',
            title: `${city.name} — stok fazlası`,
            message: `${PRODUCT_BY_ID[productId as ProductId].name} stoğu hedefin %160 üzerine çıktı.`,
            cityId: city.id,
            productId: productId as ProductId,
            importance: 'low',
          });
        }
      }
    }

    // Yüksek ödemeli yeni sözleşme haberleri
    for (const contract of newContracts) {
      if (contract.payment >= HIGH_PAYMENT_CONTRACT_THRESHOLD) {
        news.push({
          id: createNewsId(state.currentTime, `contract_${contract.id}`),
          time: state.currentTime,
          type: 'contract',
          title: 'Yüksek ödemeli sözleşme',
          message: `${contract.originCityId} → ${contract.destinationCityId}: $${contract.payment.toFixed(0)} ödeme.`,
          cityId: contract.destinationCityId,
          productId: contract.productId,
          importance: 'medium',
        });
      }
    }

    if (newContracts.length > 0 && shouldLogContractMarketEvent(state.eventLog, state.currentTime)) {
      gameEvents.push({
        time: state.currentTime,
        type: 'market',
        title: 'Yeni taşıma fırsatları',
        message: `${newContracts.length} yeni taşıma fırsatı piyasaya eklendi.`,
        importance: 'medium',
      });
    }

    set({
      cities: citiesFromRecord(updatedCitiesRecord),
      globalEconomy,
      contracts: updatedContracts,
      marketNews: [...news, ...state.marketNews].slice(0, MARKET_NEWS_MAX_COUNT),
      eventLog: prependGameEvents(state.eventLog, gameEvents, state.currentTime),
    });
    get().markSaveDirty();
    get().autoSave('economy_tick');
  },

  refreshMarketSnapshot: () => {
    const state = get();
    const expired = expireOldContracts(state.contracts ?? [], state.currentTime);
    if (expired !== state.contracts) {
      set({ contracts: expired });
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
      set({ contracts: mergeContractsWithDedupe(state.contracts, newContracts) });
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

    const product = PRODUCT_BY_ID[contract.productId];
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

    set({
      player: {
        ...state.player,
        money: state.player.money - delivery.fuelCost,
        trucks: updatedTrucks,
        drivers: updatedDrivers,
      },
      contracts: updatedContracts,
      activeDeliveries: [...state.activeDeliveries, delivery],
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

    const product = PRODUCT_BY_ID[contract.productId];
    const truck = selectIdleTruckForContract(state.player.trucks, contract, product);
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

    const updatedDeliveries = state.activeDeliveries.map((delivery) => {
      if (delivery.status !== 'on_route' && delivery.status !== 'preparing') {
        return delivery;
      }

      // Arıza / kaza riski — seyahat süresine orantılı düşük ihtimal
      const progressFraction = hoursPassed / Math.max(delivery.travelHours, 0.1);
      if (deliveryRandomBetween(0, 1) < delivery.breakdownChance * progressFraction * 0.15) {
        deliveriesToFail.push({ id: delivery.id, reason: 'breakdown' });
        return delivery;
      }
      if (deliveryRandomBetween(0, 1) < delivery.accidentChance * progressFraction * 0.12) {
        deliveriesToFail.push({ id: delivery.id, reason: 'accident' });
        return delivery;
      }

      const updated = updateDeliveryProgress(delivery, hoursPassed);

      if (updated.progress >= 1) {
        deliveriesToComplete.push(updated.id);
      }

      return updated;
    });

    set({ activeDeliveries: updatedDeliveries });

    for (const { id, reason } of deliveriesToFail) {
      get().failDeliveryById(id, reason);
    }

    for (const deliveryId of deliveriesToComplete) {
      const current = get().activeDeliveries.find((d) => d.id === deliveryId);
      if (current && current.status === 'on_route' && current.progress >= 1) {
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

    if (!CITIES_BY_ID[params.toCityId]) {
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
      financeLedger: prependFinanceLedger(state.financeLedger ?? [], {
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
      state.eventLog.some((event) => event.id === deliveryEventId)
    ) {
      return;
    }

    const beforeMoney = state.player.money;
    const simState = toSimulationState(state);

    const delivery = simState.deliveries.find((d) => d.id === deliveryId);
    if (!delivery || delivery.progress < 1) {
      return;
    }

    if (delivery.status === 'completed' || delivery.status === 'failed') {
      return;
    }

    const contract = simState.contracts.find((c) => c.id === delivery.contractId);
    if (!contract) {
      return;
    }

    const actualTravelHours = state.currentTime - delivery.startedAt;
    const product = PRODUCT_BY_ID[delivery.productId];

    // Kritik gecikme → başarısız teslimat
    if (actualTravelHours > contract.deadlineHours * 2) {
      get().failDeliveryById(deliveryId, 'too_late');
      return;
    }

    const newSimState = completeDeliverySim(simState, deliveryId);

    const penaltyCost = calculateLatePenalty(
      contract,
      delivery.travelHours,
      actualTravelHours,
      product,
    );

    // Yakıt başlangıçta ödendi; sim netProfit yakıtı tekrar düşer → düzelt
    const netProfit = contract.payment - penaltyCost - delivery.maintenanceCost;
    const moneyAfterComplete = beforeMoney + netProfit;
    const routeLabel = `${getCityName(delivery.originCityId)} → ${getCityName(delivery.destinationCityId)}`;
    const distanceKm = contract.distanceKm ?? delivery.distanceKm ?? 0;
    const riskTier = getDeliveryRiskTier(delivery);
    const xpGain = calculateDeliveryXp(distanceKm, netProfit, riskTier);
    const notificationMessage = `Teslimat tamamlandı · +${xpGain} XP`;
    const eventMessage = `${routeLabel} teslimatı tamamlandı. Net kâr: ${formatNotificationMoney(netProfit)} · +${xpGain} XP`;
    const completedTruck = newSimState.trucks.find((t) => t.id === delivery.truckId);
    const destinationCityName = getCityName(delivery.destinationCityId);
    const truckArrivalMessage = completedTruck
      ? `${completedTruck.name} ${destinationCityName}'ya ulaştı ve yeni işler için hazır.`
      : `Kamyon ${destinationCityName}'ya ulaştı ve yeni işler için hazır.`;

    const merged = mergeSimulationIntoStore(state, newSimState, moneyAfterComplete);

    set({
      ...merged,
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
          message: `${routeLabel}: ${formatNotificationMoney(netProfit)} net kâr.`,
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
  },

  failDeliveryById: (deliveryId: string, reason: DeliveryFailureReason) => {
    const state = get();
    const simState = toSimulationState(state);

    const delivery = simState.deliveries.find((d) => d.id === deliveryId);
    if (!delivery || delivery.status === 'completed' || delivery.status === 'failed') {
      return;
    }

    const newSimState = failDeliverySim(simState, deliveryId, reason);
    const moneyAfterFail = newSimState.player.money;
    const penaltyApplied = state.player.money - moneyAfterFail;
    const merged = mergeSimulationIntoStore(state, newSimState, moneyAfterFail);

    set({
      ...merged,
      player: {
        ...state.player,
        trucks: merged.player!.trucks,
        drivers: merged.player!.drivers,
        warehouses: merged.player!.warehouses,
        money: moneyAfterFail,
        reputation: Math.max(0, state.player.reputation - REPUTATION_LOSS),
      },
      marketNews: [
        {
          id: createNewsId(state.currentTime, `del_fail_${deliveryId}`),
          time: state.currentTime,
          type: 'warning' as const,
          title: 'Teslimat başarısız',
          message: `Teslimat iptal edildi (${reason}). Ceza: $${penaltyApplied.toFixed(0)}`,
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
          message: `${getCityName(delivery.originCityId)} → ${getCityName(delivery.destinationCityId)} (${formatFailureReason(reason)}). Ceza: $${penaltyApplied.toFixed(0)}`,
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
      financeLedger: prependFinanceLedger(state.financeLedger ?? [], {
        time: state.currentTime,
        type: 'expense',
        category: 'fleet_purchase',
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

    if (state.player.money < template.hiringFee) {
      return {
        success: false,
        errorCode: 'INSUFFICIENT_FUNDS',
        message: `Şoför işe almak için ${formatNotificationMoney(template.hiringFee)} gerekli.`,
      };
    }

    const { hiringFee, comingSoon: _comingSoon, ...driverFields } = template;
    const newDriver: Driver = {
      ...driverFields,
      id: poolId,
      poolId,
      assignedTruckId: null,
      status: 'idle',
    };

    set({
      player: {
        ...state.player,
        money: state.player.money - hiringFee,
        drivers: [...state.player.drivers, newDriver],
      },
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

    const warehouse: Warehouse = {
      id: `warehouse-${cityId}-${resolvedType}-${Date.now()}`,
      cityId,
      capacityTons: tradingBalance.defaultWarehouseCapacityTons,
      upgradeTier: 1,
      warehouseType: resolvedType,
      qualityProtection: resolvedType === 'cold' ? 1 : 0.5,
      inventory: [],
      storedProducts: {},
      usedCapacityTon: 0,
    };

    set({
      player: {
        ...state.player,
        money: state.player.money - openCost,
        warehouses: [...state.player.warehouses, warehouse],
      },
      financeLedger: prependFinanceLedger(state.financeLedger ?? [], {
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
    const upgradeCost = Math.round(warehouseBalance.baseOpenCost * 0.5 * costModifier);

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
      financeLedger: prependFinanceLedger(state.financeLedger ?? [], {
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

    const product = PRODUCT_BY_ID[productId];
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
      financeLedger: prependFinanceLedger(state.financeLedger ?? [], {
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
      financeLedger: prependFinanceLedger(state.financeLedger ?? [], {
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
