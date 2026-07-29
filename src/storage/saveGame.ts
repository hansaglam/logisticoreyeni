/**
 * LogistiCore - Yerel oyun kaydı (AsyncStorage) + Firestore cloud sync köprüsü
 *
 * Local save ana kaynaktır. Cloud sync: src/storage/cloudSaveSync.ts
 * Backend servisleri: src/services/firebase.ts, authService.ts, cloudSaveService.ts
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { reputationBalance, contractGenerationBalance } from '../config/balance';
import { CITIES } from '../data/cities';
import {
  mergeCanonicalCities,
  mergeCanonicalRoutes,
} from '../data/mergeCanonicalCatalog';
import { normalizeDriver, STARTER_DRIVER } from '../data/drivers';
import { PRODUCTS } from '../data/products';
import { ROUTES } from '../data/routes';
import { STARTER_TRUCK } from '../data/trucks';
import { normalizeGlobalEconomy } from '../simulation/economy';
import { materializeSnapshotCities } from '../simulation/globalMarketSnapshot';
import { normalizeTruckCity } from '../simulation/delivery';
import { normalizeDelivery } from '../simulation/deliveryIncidents';
import { normalizePlayerTrailers } from '../simulation/trailerOps';
import { normalizeContract } from '../simulation/contractTypes';
import { normalizeTruckUpgrades } from '../simulation/truckUpgrades';
import { normalizeTruckFuel } from '../utils/truckFuel';
import { calculateXpToNextLevel, normalizePlayerProgress } from '../simulation/leveling';
import { normalizeWarehouse } from '../simulation/trading';
import { calculateCompanyScore } from '../simulation/companyScore';
import { ensureFinanceTotals, FINANCE_LEDGER_MAX_COUNT } from '../utils/financeLedger';
import { normalizeMissionsState, normalizeTutorialState } from '../utils/missionProgress';
import { normalizeRetentionState } from '../simulation/retentionProgress';
import { gameDayFromTime, normalizeWorldEventsState } from '../simulation/worldEvents';
import {
  inferLegacyOnboardingFromSave,
  normalizeOnboardingState,
} from '../onboarding/onboardingProgress';
import { normalizeSpotlightTutorialState } from '../tutorial/spotlightTutorialState';
import { normalizeCitiesPriceHistory, seedProductPriceHistory } from '../utils/productPriceHistory';
import { normalizeMarketAlerts } from '../utils/marketAlerts';
import type { MonetizationState } from '../types/monetization';
import {
  createDefaultMonetizationState,
  normalizeMonetizationState,
} from '../simulation/adRewardGrants';
import { migratePlayerTruckNames } from '../utils/truckDisplayNames';
import type {
  City,
  Contract,
  Delivery,
  GameEvent,
  FinanceLedgerEntry,
  FinanceTotals,
  FuelWarningKey,
  GlobalEconomy,
  GlobalEconomySnapshot,
  MarketNews,
  MissionsState,
  ProductId,
  RetentionState,
  WorldEvent,
  OnboardingState,
  MarketPriceAlert,
  Player,
  Product,
  Route,
  SpotlightTutorialPersistence,
  StoreGameState,
  TutorialState,
  TruckTransfer,
  Warehouse,
  WarehouseStockTransfer,
} from '../types/game';

export const SAVE_STORAGE_KEY = 'logisticore_save_v1';
export const SAVE_BACKUP_INVALID_KEY = 'logisticore_save_backup_invalid';
export const SAVE_BACKUP_MIGRATED_KEY = 'logisticore_save_backup_migrated';
export const SAVE_GAME_VERSION = 3;

const APP_VERSION = '1.0.0';

export interface SaveGameMeta {
  savedAt: number;
  currentTime: number;
  cash: number;
  companyName: string;
  completedContracts: number;
  /** Şirket seviyesi — player.level ile senkron */
  level: number;
  /** Mevcut seviye XP'si */
  xp: number;
  /** Kariyer boyu toplam XP */
  totalXp: number;
  /** Premium elmas bakiyesi */
  diamonds?: number;
  /** Kayıt anındaki şirket puanı (runtime hesaplanabilir) */
  companyScore?: number;
  appVersion: string;
  saveVersion: number;
  /** Migration kaynağı — eski save sürümü */
  migratedFromVersion?: number;
  /** Migration zamanı (ms) */
  migratedAt?: number;
}

export interface SaveGamePayload {
  version: number;
  meta: SaveGameMeta;
  currentTime: number;
  player: Player;
  cities: City[];
  products: Product[];
  routes: Route[];
  contracts: Contract[];
  activeDeliveries: Delivery[];
  activeTransfers?: TruckTransfer[];
  completedTransfers?: TruckTransfer[];
  activeWarehouseStockTransfers?: WarehouseStockTransfer[];
  completedWarehouseStockTransfers?: WarehouseStockTransfer[];
  globalEconomy: GlobalEconomy;
  marketNews: MarketNews[];
  eventLog: GameEvent[];
  financeLedger?: FinanceLedgerEntry[];
  financeTotals?: FinanceTotals;
  gameSpeed: number;
  isPaused: boolean;
  lastEconomyTickTime?: number;
  lastDailyOperatingCostTime?: number;
  lastContractGenerationTime?: number;
  lastMarketRefreshTime?: number;
  lastDailyCleanupTime?: number;
  lastPlayableContractGeneratedTime?: number;
  lastManualContractRefreshTime?: number;
  tutorial?: TutorialState;
  missions?: MissionsState;
  retention?: RetentionState;
  onboarding?: OnboardingState;
  spotlightTutorial?: SpotlightTutorialPersistence;
  marketAlerts?: MarketPriceAlert[];
  worldEvents?: WorldEvent[];
  worldEventsVersion?: number;
  lastWorldEventGeneratedDay?: number;
  monetization?: MonetizationState;
  lastSeenRealTimeMs?: number;
  lastSimulatedRealTimeMs?: number;
  lastOfflineProgressAppliedAt?: number;
  offlineProgressVersion?: number;
  lastSimulationGameSpeed?: number;
  lastProcessedEconomyAt?: number;
  lastSeenMarketEpoch?: number;
  cachedSnapshotVersion?: number;
  cachedSnapshotGeneratedAt?: number;
  cachedGlobalEconomySnapshot?: GlobalEconomySnapshot;
  cachedGlobalEconomySnapshotTrusted?: boolean;
  appliedEconomyPeriodKeys?: string[];
  lastEmergencyContractAtMs?: number;
  lastRoadsideFuelAssistanceAt?: number;
  fuelTransactionKeys?: string[];
}

export interface SaveBackupStatus {
  invalid: boolean;
  migrated: boolean;
}

export interface SaveLoadResult {
  state: StoreGameState | null;
  error: string | null;
  migratedFromVersion: number | null;
  hasValidSave: boolean;
  backup: SaveBackupStatus;
}

export type SaveProvider = {
  save: (payload: SaveGamePayload) => Promise<void>;
  load: () => Promise<SaveGamePayload | null>;
  clear: () => Promise<void>;
  hasSave: () => Promise<boolean>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cloneDefaultCities(): City[] {
  return structuredClone(CITIES).map((city) => ({
    ...city,
    products: Object.fromEntries(
      Object.entries(city.products).map(([productId, productState]) => {
        const stock = productState.stock ?? 0;
        const targetStock =
          productState.targetStock && productState.targetStock > 0
            ? productState.targetStock
            : Math.max(stock, 1);
        const ratio = stock / targetStock;
        let stockStatus = 'Dengeli';
        if (ratio < 0.3) stockStatus = 'Kritik Kıtlık';
        else if (ratio < 0.7) stockStatus = 'Kıtlık';
        else if (ratio <= 1.2) stockStatus = 'Dengeli';
        else if (ratio <= 1.6) stockStatus = 'Fazla';
        else stockStatus = 'Yüksek Fazla';

        const currentPrice = productState.currentPrice ?? productState.basePrice;

        return [
          productId,
          {
            ...productState,
            currentPrice,
            priceHistory: seedProductPriceHistory(currentPrice, {
              productId,
              cityId: city.id,
              basePrice: productState.basePrice,
              stock,
              targetStock,
              stockStatus,
            }),
          },
        ];
      }),
    ) as City['products'],
  }));
}

function normalizeGameSpeed(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (value === 'normal') {
    return 1;
  }
  if (value === 'fast') {
    return 2;
  }
  if (value === 'debug') {
    return 6;
  }
  return 1;
}

function normalizePlayerWarehouses(warehouses: Warehouse[]): Warehouse[] {
  return (warehouses ?? []).map((warehouse) => normalizeWarehouse(warehouse));
}

function hasActiveDeliveriesInFlight(deliveries: Delivery[] | undefined): boolean {
  return (deliveries ?? []).some(
    (delivery) => delivery.status === 'on_route' || delivery.status === 'preparing',
  );
}

/** Boş filo save'lerinde oynanabilirlik için güvenli kurtarma */
function recoverStarterFleetIfMissing(
  player: Player,
  activeDeliveries: Delivery[] = [],
): Player {
  const trucks = player.trucks ?? [];
  const drivers = player.drivers ?? [];

  if (trucks.length > 0 && drivers.length > 0) {
    return player;
  }

  if (hasActiveDeliveriesInFlight(activeDeliveries)) {
    console.warn(
      '[saveGame] Empty fleet with active deliveries — skipping starter fleet recovery',
    );
    return player;
  }

  const homeCityId = player.homeCityId ?? 'izmir';
  const recoveredTrucks =
    trucks.length > 0
      ? trucks
      : [normalizeTruckCity(structuredClone(STARTER_TRUCK), homeCityId)];
  let recoveredDrivers =
    drivers.length > 0 ? drivers : [structuredClone(STARTER_DRIVER)];

  if (drivers.length === 0 && recoveredTrucks.length > 0) {
    recoveredDrivers = [
      {
        ...recoveredDrivers[0],
        assignedTruckId: recoveredTrucks[0].id,
      },
    ];
  }

  if (trucks.length === 0) {
    console.warn('[saveGame] Recovered missing starter truck for playable save');
  }
  if (drivers.length === 0) {
    console.warn('[saveGame] Recovered missing starter driver for playable save');
  }

  return {
    ...player,
    trucks: recoveredTrucks,
    drivers: recoveredDrivers,
  };
}

function normalizePlayerTrucks(trucks: Player['trucks'], homeCityId: string): Player['trucks'] {
  const fallbackHome = homeCityId || 'izmir';
  return (trucks ?? []).map((truck) =>
    normalizeTruckFuel(
      normalizeTruckUpgrades(normalizeTruckCity(truck, fallbackHome)),
    ),
  );
}

function normalizeLoadedContracts(contracts: Contract[] | undefined): Contract[] {
  return (contracts ?? []).map((contract) => normalizeContract(contract));
}

function normalizeActiveDeliveries(deliveries: Delivery[] | undefined): Delivery[] {
  return (deliveries ?? []).map((delivery) => normalizeDelivery(delivery));
}

const VALID_FUEL_WARNING_KEYS = new Set<FuelWarningKey>([
  'low-fuel',
  'critical-fuel',
  'insufficient-range',
  'out-of-fuel',
]);

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : Math.max(0, fallback);
}

function normalizeFuelJobFields<
  T extends {
    truckId: string;
    status: string;
    progress: number;
    pausedReason?: 'out-of-fuel';
    fuelLitersAtStart?: number;
    fuelLitersTotal?: number;
    fuelConsumedL?: number;
    lastFuelProcessedProgress?: number;
    lastFuelProcessedAt?: number;
    distanceTraveledKm?: number;
    fuelWarningsEmitted?: FuelWarningKey[];
    roadsideAssistanceGrantedAt?: number;
  },
>(
  job: T,
  activeStatus: T['status'],
  trucks: Player['trucks'],
  currentTime: number,
  distanceKm: number,
): T {
  const progress = Math.max(0, Math.min(1, Number(job.progress) || 0));
  const truck = trucks.find((candidate) => candidate.id === job.truckId);
  const truckFuel = finiteNonNegative(truck?.currentFuelL, 0);
  const totalFuel = finiteNonNegative(job.fuelLitersTotal, 0);
  const consumedFuel = Math.min(
    totalFuel,
    finiteNonNegative(job.fuelConsumedL, totalFuel * progress),
  );
  const processedProgress = Math.max(
    0,
    Math.min(progress, Number.isFinite(job.lastFuelProcessedProgress)
      ? Number(job.lastFuelProcessedProgress)
      : progress),
  );
  const shouldInferOutOfFuel = progress < 1 && truckFuel <= 1e-6;
  const pausedWithoutReason = job.status === 'paused' && job.pausedReason !== 'out-of-fuel';
  const status =
    shouldInferOutOfFuel
      ? ('paused' as T['status'])
      : pausedWithoutReason
        ? activeStatus
        : job.status;
  const pausedReason =
    status === 'paused' && (job.pausedReason === 'out-of-fuel' || shouldInferOutOfFuel)
      ? 'out-of-fuel'
      : undefined;
  const warningKeys = Array.isArray(job.fuelWarningsEmitted)
    ? job.fuelWarningsEmitted
        .filter((key): key is FuelWarningKey => VALID_FUEL_WARNING_KEYS.has(key))
        .slice(-4)
    : [];

  return {
    ...job,
    status,
    progress,
    pausedReason,
    fuelLitersAtStart: finiteNonNegative(
      job.fuelLitersAtStart,
      truckFuel + consumedFuel,
    ),
    fuelLitersTotal: totalFuel,
    fuelConsumedL: consumedFuel,
    lastFuelProcessedProgress: processedProgress,
    lastFuelProcessedAt: Number.isFinite(job.lastFuelProcessedAt)
      ? Number(job.lastFuelProcessedAt)
      : currentTime,
    distanceTraveledKm: Math.min(
      Math.max(0, distanceKm),
      finiteNonNegative(job.distanceTraveledKm, distanceKm * processedProgress),
    ),
    fuelWarningsEmitted: warningKeys,
    roadsideAssistanceGrantedAt: Number.isFinite(job.roadsideAssistanceGrantedAt)
      ? Number(job.roadsideAssistanceGrantedAt)
      : undefined,
  };
}

function normalizeDeliveryFuelJobs(
  deliveries: Delivery[] | undefined,
  trucks: Player['trucks'],
  currentTime: number,
): Delivery[] {
  return normalizeActiveDeliveries(deliveries).map((delivery) =>
    normalizeFuelJobFields(
      delivery,
      'on_route',
      trucks,
      currentTime,
      finiteNonNegative(delivery.distanceKm, 0),
    ),
  );
}

function normalizeTruckTransferFuelJobs(
  transfers: TruckTransfer[] | undefined,
  trucks: Player['trucks'],
  currentTime: number,
): TruckTransfer[] {
  return (transfers ?? []).map((transfer) =>
    normalizeFuelJobFields(
      transfer,
      'active',
      trucks,
      currentTime,
      finiteNonNegative(transfer.distanceKm, 0),
    ),
  );
}

function normalizeWarehouseTransferFuelJobs(
  transfers: WarehouseStockTransfer[] | undefined,
  trucks: Player['trucks'],
  currentTime: number,
): WarehouseStockTransfer[] {
  return (transfers ?? []).map((transfer) =>
    normalizeFuelJobFields(
      transfer,
      'active',
      trucks,
      currentTime,
      finiteNonNegative(transfer.routeDistanceKm, 0),
    ),
  );
}

export function normalizeLoadedPlayer(player: Player): Player {
  const homeCityId = player.homeCityId ?? 'izmir';
  const trucks = normalizePlayerTrucks(player.trucks, homeCityId);
  const normalized = normalizePlayerProgress({
    ...player,
    homeCityId,
    warehouses: normalizePlayerWarehouses(player.warehouses ?? []),
    trucks,
    trailers: normalizePlayerTrailers(player.trailers, homeCityId, trucks),
    drivers: (player.drivers ?? []).map((driver) => normalizeDriver(driver)),
  });
  return migratePlayerTruckNames(normalized);
}

/** Eski save'lerde eksik alanlar için varsayılan değerler */
export function createDefaultSaveFallbacks(
  payload: Partial<SaveGamePayload> & Record<string, unknown>,
): Partial<SaveGamePayload> & Record<string, unknown> {
  const playerRecord: Record<string, unknown> = isRecord(payload.player)
    ? payload.player
    : {};
  const metaRecord: Record<string, unknown> = isRecord(payload.meta) ? payload.meta : {};
  const homeCityId =
    typeof playerRecord.homeCityId === 'string' ? playerRecord.homeCityId : 'izmir';
  const level = safeNumber(playerRecord.level ?? playerRecord.companyLevel, 1);
  const xp = safeNumber(playerRecord.xp, 0);
  const economyTickInterval = 24;
  const currentTime = safeNumber(payload.currentTime, 0);
  const fallbackTickTime =
    Math.floor(currentTime / economyTickInterval) * economyTickInterval;

  const player: Player = normalizeLoadedPlayer({
    companyName:
      typeof playerRecord.companyName === 'string' && playerRecord.companyName.length > 0
        ? playerRecord.companyName
        : 'LogistiCore Lojistik',
    money: safeNumber(playerRecord.money ?? playerRecord.cash, 20_000),
    companyLevel: level,
    level,
    xp,
    xpToNextLevel: safeNumber(playerRecord.xpToNextLevel, calculateXpToNextLevel(level)),
    totalXp: safeNumber(playerRecord.totalXp, xp),
    homeCityId,
    reputation: Math.max(
      reputationBalance.min,
      Math.min(reputationBalance.max, safeNumber(playerRecord.reputation, reputationBalance.initial)),
    ),
    completedContracts: safeNumber(playerRecord.completedContracts, 0),
    failedDeliveries: safeNumber(playerRecord.failedDeliveries, 0),
    lateDeliveries: safeNumber(playerRecord.lateDeliveries, 0),
    diamonds: safeNumber(playerRecord.diamonds, 0),
    trucks: isArray(playerRecord.trucks) ? (playerRecord.trucks as Player['trucks']) : [],
    trailers: isArray(playerRecord.trailers) ? (playerRecord.trailers as Player['trailers']) : [],
    drivers: isArray(playerRecord.drivers) ? (playerRecord.drivers as Player['drivers']) : [],
    warehouses: isArray(playerRecord.warehouses)
      ? (playerRecord.warehouses as Warehouse[])
      : [],
  } as Player);

  return {
    ...payload,
    version: typeof payload.version === 'number' ? payload.version : 0,
    currentTime,
    gameSpeed: normalizeGameSpeed(payload.gameSpeed),
    isPaused: typeof payload.isPaused === 'boolean' ? payload.isPaused : false,
    player,
    cities: isArray(payload.cities) && payload.cities.length > 0
      ? mergeCanonicalCities(payload.cities as City[])
      : cloneDefaultCities(),
    products: isArray(payload.products) && payload.products.length > 0
      ? (payload.products as Product[])
      : structuredClone(PRODUCTS),
    routes: isArray(payload.routes) && payload.routes.length > 0
      ? mergeCanonicalRoutes(payload.routes as Route[])
      : structuredClone(ROUTES),
    contracts: normalizeLoadedContracts(
      isArray(payload.contracts) ? (payload.contracts as Contract[]) : [],
    ),
    activeDeliveries: isArray(payload.activeDeliveries)
      ? (payload.activeDeliveries as Delivery[])
      : [],
    activeTransfers: isArray(payload.activeTransfers)
      ? (payload.activeTransfers as TruckTransfer[])
      : [],
    completedTransfers: isArray(payload.completedTransfers)
      ? (payload.completedTransfers as TruckTransfer[])
      : [],
    activeWarehouseStockTransfers: isArray(payload.activeWarehouseStockTransfers)
      ? (payload.activeWarehouseStockTransfers as WarehouseStockTransfer[])
      : [],
    completedWarehouseStockTransfers: isArray(payload.completedWarehouseStockTransfers)
      ? (payload.completedWarehouseStockTransfers as WarehouseStockTransfer[])
      : [],
    globalEconomy: normalizeGlobalEconomy(payload.globalEconomy, { logFallback: true }),
    marketNews: isArray(payload.marketNews) ? (payload.marketNews as MarketNews[]) : [],
    eventLog: isArray(payload.eventLog) ? (payload.eventLog as GameEvent[]) : [],
    financeLedger: isArray(payload.financeLedger)
      ? (payload.financeLedger as FinanceLedgerEntry[])
      : [],
    financeTotals: isRecord(payload.financeTotals)
      ? (payload.financeTotals as FinanceTotals)
      : undefined,
    lastEconomyTickTime: safeNumber(payload.lastEconomyTickTime, fallbackTickTime),
    lastDailyOperatingCostTime: safeNumber(
      payload.lastDailyOperatingCostTime,
      fallbackTickTime,
    ),
    lastContractGenerationTime: safeNumber(
      payload.lastContractGenerationTime,
      currentTime,
    ),
    lastMarketRefreshTime: safeNumber(payload.lastMarketRefreshTime, 0),
    lastDailyCleanupTime: safeNumber(payload.lastDailyCleanupTime, 0),
    lastPlayableContractGeneratedTime: safeNumber(payload.lastPlayableContractGeneratedTime, 0),
    lastManualContractRefreshTime: safeNumber(payload.lastManualContractRefreshTime, 0),
    tutorial: normalizeTutorialState(
      isRecord(payload.tutorial) ? (payload.tutorial as Partial<TutorialState>) : undefined,
    ),
    missions: normalizeMissionsState(
      isRecord(payload.missions) ? (payload.missions as Partial<MissionsState>) : undefined,
    ),
    retention: normalizeRetentionState(
      isRecord(payload.retention) ? (payload.retention as Partial<RetentionState>) : undefined,
    ),
    onboarding: isRecord(payload.onboarding)
      ? normalizeOnboardingState(payload.onboarding as Partial<OnboardingState>)
      : inferLegacyOnboardingFromSave({
          completedContracts: player.completedContracts ?? 0,
          activeDeliveryCount: isArray(payload.activeDeliveries)
            ? (payload.activeDeliveries as Delivery[]).length
            : 0,
          deliveryStarted: isRecord(payload.missions)
            ? (payload.missions as Partial<MissionsState>).flags?.deliveryStarted === true
            : false,
          tradePurchased: isRecord(payload.missions)
            ? (payload.missions as Partial<MissionsState>).flags?.tradePurchased === true
            : false,
          playerLevel: player.level ?? 1,
          tutorialCompleted: isRecord(payload.tutorial)
            ? (payload.tutorial as Partial<TutorialState>).isCompleted === true
            : false,
        }),
    spotlightTutorial: normalizeSpotlightTutorialState(
      isRecord(payload.spotlightTutorial)
        ? (payload.spotlightTutorial as Partial<SpotlightTutorialPersistence>)
        : undefined,
    ),
    marketAlerts: normalizeMarketAlerts(
      isArray(payload.marketAlerts) ? (payload.marketAlerts as MarketPriceAlert[]) : undefined,
    ),
    ...normalizeWorldEventsState(
      isArray(payload.worldEvents) ? payload.worldEvents : undefined,
      gameDayFromTime(currentTime),
      payload.worldEventsVersion,
      payload.lastWorldEventGeneratedDay,
    ),
    monetization: normalizeMonetizationState(
      isRecord(payload.monetization) ? (payload.monetization as Partial<MonetizationState>) : undefined,
      currentTime,
    ),
    meta: {
      savedAt: safeNumber(metaRecord.savedAt, Date.now()),
      currentTime: safeNumber(metaRecord.currentTime, currentTime),
      cash: safeNumber(metaRecord.cash, player.money),
      companyName: player.companyName,
      completedContracts: safeNumber(
        metaRecord.completedContracts,
        player.completedContracts,
      ),
      level: safeNumber(metaRecord.level, player.level ?? 1),
      xp: safeNumber(metaRecord.xp, player.xp ?? 0),
      totalXp: safeNumber(metaRecord.totalXp, player.totalXp ?? 0),
      diamonds: safeNumber(metaRecord.diamonds, player.diamonds ?? 0),
      appVersion:
        typeof metaRecord.appVersion === 'string' ? metaRecord.appVersion : APP_VERSION,
      saveVersion:
        typeof metaRecord.saveVersion === 'number'
          ? metaRecord.saveVersion
          : typeof payload.version === 'number'
            ? payload.version
            : 0,
      migratedFromVersion:
        typeof metaRecord.migratedFromVersion === 'number'
          ? metaRecord.migratedFromVersion
          : undefined,
      migratedAt:
        typeof metaRecord.migratedAt === 'number' ? metaRecord.migratedAt : undefined,
    },
  };
}

/** Kısmi payload'ı tam SaveGamePayload'a normalize eder */
export function normalizeSavePayload(
  payload: Partial<SaveGamePayload> & Record<string, unknown>,
): SaveGamePayload {
  const withFallbacks = createDefaultSaveFallbacks(payload);
  const player = withFallbacks.player as Player;
  const currentTime = withFallbacks.currentTime as number;
  const meta = withFallbacks.meta as SaveGameMeta;

  const normalizedCities = normalizeCitiesPriceHistory(withFallbacks.cities as City[]);

  const companyScore = calculateCompanyScore({
    player,
    cities: normalizedCities,
    products: withFallbacks.products as Product[],
    financeLedger: (withFallbacks.financeLedger as FinanceLedgerEntry[]) ?? [],
    currentTime,
  });

  return {
    version: withFallbacks.version as number,
    meta: {
      ...meta,
      cash: player.money,
      companyName: player.companyName,
      completedContracts: player.completedContracts,
      level: player.level ?? 1,
      xp: player.xp ?? 0,
      totalXp: player.totalXp ?? 0,
      diamonds: player.diamonds ?? 0,
      companyScore,
    },
    currentTime,
    player,
    cities: normalizedCities,
    products: withFallbacks.products as Product[],
    routes: withFallbacks.routes as Route[],
    contracts: withFallbacks.contracts as Contract[],
    activeDeliveries: normalizeDeliveryFuelJobs(
      withFallbacks.activeDeliveries as Delivery[],
      player.trucks,
      currentTime,
    ),
    activeTransfers: normalizeTruckTransferFuelJobs(
      withFallbacks.activeTransfers as TruckTransfer[],
      player.trucks,
      currentTime,
    ),
    completedTransfers: normalizeTruckTransferFuelJobs(
      withFallbacks.completedTransfers as TruckTransfer[],
      player.trucks,
      currentTime,
    ),
    activeWarehouseStockTransfers:
      normalizeWarehouseTransferFuelJobs(
        withFallbacks.activeWarehouseStockTransfers as WarehouseStockTransfer[] | undefined,
        player.trucks,
        currentTime,
      ),
    completedWarehouseStockTransfers:
      normalizeWarehouseTransferFuelJobs(
        withFallbacks.completedWarehouseStockTransfers as WarehouseStockTransfer[] | undefined,
        player.trucks,
        currentTime,
      ),
    globalEconomy: normalizeGlobalEconomy(withFallbacks.globalEconomy, { logFallback: true }),
    marketNews: withFallbacks.marketNews as MarketNews[],
    eventLog: withFallbacks.eventLog as GameEvent[],
    financeLedger: withFallbacks.financeLedger as FinanceLedgerEntry[],
    financeTotals: ensureFinanceTotals(
      withFallbacks.financeLedger as FinanceLedgerEntry[],
      withFallbacks.financeTotals as FinanceTotals | undefined,
    ),
    gameSpeed: withFallbacks.gameSpeed as number,
    isPaused: withFallbacks.isPaused as boolean,
    lastEconomyTickTime: withFallbacks.lastEconomyTickTime as number,
    lastDailyOperatingCostTime: withFallbacks.lastDailyOperatingCostTime as number,
    lastContractGenerationTime: withFallbacks.lastContractGenerationTime as number,
    lastMarketRefreshTime: withFallbacks.lastMarketRefreshTime as number,
    lastDailyCleanupTime: withFallbacks.lastDailyCleanupTime as number,
    lastPlayableContractGeneratedTime: withFallbacks.lastPlayableContractGeneratedTime as number,
    lastManualContractRefreshTime: withFallbacks.lastManualContractRefreshTime as number,
    tutorial: withFallbacks.tutorial as TutorialState,
    missions: withFallbacks.missions as MissionsState,
    onboarding: withFallbacks.onboarding as OnboardingState,
    spotlightTutorial: withFallbacks.spotlightTutorial as SpotlightTutorialPersistence,
    marketAlerts: normalizeMarketAlerts(withFallbacks.marketAlerts as MarketPriceAlert[] | undefined),
    ...normalizeWorldEventsState(
      withFallbacks.worldEvents,
      gameDayFromTime(currentTime),
      withFallbacks.worldEventsVersion,
      withFallbacks.lastWorldEventGeneratedDay,
    ),
    monetization: normalizeMonetizationState(
      isRecord(withFallbacks.monetization)
        ? (withFallbacks.monetization as Partial<MonetizationState>)
        : undefined,
      currentTime,
    ),
    lastSeenRealTimeMs: Number.isFinite(withFallbacks.lastSeenRealTimeMs)
      ? Number(withFallbacks.lastSeenRealTimeMs)
      : undefined,
    lastSimulatedRealTimeMs: Number.isFinite(withFallbacks.lastSimulatedRealTimeMs)
      ? Number(withFallbacks.lastSimulatedRealTimeMs)
      : undefined,
    lastOfflineProgressAppliedAt: Number.isFinite(withFallbacks.lastOfflineProgressAppliedAt)
      ? Number(withFallbacks.lastOfflineProgressAppliedAt)
      : undefined,
    offlineProgressVersion: Number.isFinite(withFallbacks.offlineProgressVersion)
      ? Number(withFallbacks.offlineProgressVersion)
      : 1,
    lastSimulationGameSpeed: Number.isFinite(withFallbacks.lastSimulationGameSpeed)
      ? Number(withFallbacks.lastSimulationGameSpeed)
      : undefined,
    lastProcessedEconomyAt: Number.isFinite(withFallbacks.lastProcessedEconomyAt)
      ? Number(withFallbacks.lastProcessedEconomyAt)
      : undefined,
    lastSeenMarketEpoch: Number.isFinite(withFallbacks.lastSeenMarketEpoch)
      ? Number(withFallbacks.lastSeenMarketEpoch)
      : undefined,
    cachedSnapshotVersion: Number.isFinite(withFallbacks.cachedSnapshotVersion)
      ? Number(withFallbacks.cachedSnapshotVersion)
      : undefined,
    cachedSnapshotGeneratedAt: Number.isFinite(withFallbacks.cachedSnapshotGeneratedAt)
      ? Number(withFallbacks.cachedSnapshotGeneratedAt)
      : undefined,
    appliedEconomyPeriodKeys: Array.isArray(withFallbacks.appliedEconomyPeriodKeys)
      ? withFallbacks.appliedEconomyPeriodKeys
          .filter((key): key is string => typeof key === 'string')
          .slice(-48)
      : [],
    lastEmergencyContractAtMs: Number.isFinite(withFallbacks.lastEmergencyContractAtMs)
      ? Number(withFallbacks.lastEmergencyContractAtMs)
      : undefined,
    lastRoadsideFuelAssistanceAt: Number.isFinite(
      withFallbacks.lastRoadsideFuelAssistanceAt,
    )
      ? Number(withFallbacks.lastRoadsideFuelAssistanceAt)
      : undefined,
    fuelTransactionKeys: Array.isArray(withFallbacks.fuelTransactionKeys)
      ? withFallbacks.fuelTransactionKeys
          .filter((key): key is string => typeof key === 'string' && key.length > 0)
          .slice(-32)
      : [],
  };
}

function hasMinimalSaveStructure(payload: Record<string, unknown>): boolean {
  if (!isRecord(payload.player)) {
    console.warn('[saveGame] Save missing player object.');
    return false;
  }

  const money = payload.player.money ?? payload.player.cash;
  if (typeof money !== 'number' || Number.isNaN(money)) {
    console.warn('[saveGame] Save missing valid player money.');
    return false;
  }

  if (!isArray(payload.player.trucks) || !isArray(payload.player.drivers)) {
    console.warn('[saveGame] Save missing player trucks/drivers arrays.');
    return false;
  }

  if (payload.player.trucks.length === 0 || payload.player.drivers.length === 0) {
    console.warn('[saveGame] Save has empty trucks or drivers — will attempt recovery on load.');
  }

  return true;
}

function validateMigratedPayload(payload: SaveGamePayload): boolean {
  if (typeof payload.version !== 'number') {
    return false;
  }

  if (!isRecord(payload.meta)) {
    return false;
  }

  const requiredNumbers: Array<[unknown, string]> = [
    [payload.currentTime, 'currentTime'],
    [payload.gameSpeed, 'gameSpeed'],
    [payload.meta.savedAt, 'meta.savedAt'],
    [payload.meta.currentTime, 'meta.currentTime'],
    [payload.meta.cash, 'meta.cash'],
    [payload.meta.completedContracts, 'meta.completedContracts'],
    [payload.meta.saveVersion, 'meta.saveVersion'],
  ];

  for (const [value, label] of requiredNumbers) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      console.warn(`[saveGame] Invalid save field after migration: ${label}`);
      return false;
    }
  }

  if (typeof payload.meta.companyName !== 'string' || payload.meta.companyName.length === 0) {
    return false;
  }

  if (typeof payload.meta.appVersion !== 'string') {
    return false;
  }

  if (typeof payload.isPaused !== 'boolean') {
    return false;
  }

  const arrayFields: Array<[unknown, string]> = [
    [payload.cities, 'cities'],
    [payload.products, 'products'],
    [payload.routes, 'routes'],
    [payload.contracts, 'contracts'],
    [payload.activeDeliveries, 'activeDeliveries'],
    [payload.marketNews, 'marketNews'],
    [payload.eventLog, 'eventLog'],
  ];

  for (const [value, label] of arrayFields) {
    if (!isArray(value)) {
      console.warn(`[saveGame] Invalid save field after migration: ${label}`);
      return false;
    }
  }

  return true;
}

/** Eski veya eksik save payload'ını güncel formata yükseltir */
export function migrateSavePayload(rawPayload: unknown): SaveGamePayload | null {
  if (!isRecord(rawPayload)) {
    return null;
  }

  if (!hasMinimalSaveStructure(rawPayload)) {
    return null;
  }

  const strippedPayload = stripLegacyBloatedSaveFields(rawPayload);

  const sourceVersion =
    typeof strippedPayload.version === 'number' ? strippedPayload.version : 0;

  if (sourceVersion > SAVE_GAME_VERSION) {
    console.warn(
      `[saveGame] Save version ${sourceVersion} is newer than app version ${SAVE_GAME_VERSION}. Cannot migrate.`,
    );
    return null;
  }

  if (sourceVersion < SAVE_GAME_VERSION) {
    console.warn(
      `[saveGame] Save version mismatch. Attempting migration from v${sourceVersion} to v${SAVE_GAME_VERSION}.`,
    );
  }

  const normalized = normalizeSavePayload(strippedPayload);

  if (sourceVersion < SAVE_GAME_VERSION) {
    normalized.version = SAVE_GAME_VERSION;
    normalized.meta = {
      ...normalized.meta,
      saveVersion: SAVE_GAME_VERSION,
      migratedFromVersion: sourceVersion,
      migratedAt: Date.now(),
    };
    console.warn(
      `[saveGame] Migration successful. Save upgraded to v${SAVE_GAME_VERSION}.`,
    );
  }

  if (!validateMigratedPayload(normalized)) {
    console.warn('[saveGame] Migration produced invalid payload.');
    return null;
  }

  return normalized;
}

async function backupCorruptedSave(rawString: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SAVE_BACKUP_INVALID_KEY, rawString);
    console.warn('[saveGame] Corrupted save backed up to invalid key.');
  } catch (error) {
    console.warn('[saveGame] backupCorruptedSave failed:', error);
  }
}

async function backupInvalidSave(rawString: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SAVE_BACKUP_INVALID_KEY, rawString);
    console.warn('[saveGame] Invalid save backed up before clearing main slot.');
  } catch (error) {
    console.warn('[saveGame] backupInvalidSave failed:', error);
  }
}

async function backupMigratedSave(rawString: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SAVE_BACKUP_MIGRATED_KEY, rawString);
  } catch (error) {
    console.warn('[saveGame] backupMigratedSave failed:', error);
  }
}

async function clearMainSaveSlot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SAVE_STORAGE_KEY);
  } catch (error) {
    console.warn('[saveGame] clearMainSaveSlot failed:', error);
    throw error;
  }
}

/** Hesap silme — ana kayıt + yedek anahtarlarını temizler. */
export async function clearLocalSave(): Promise<void> {
  await clearAllDebugSaves({ includeBackups: true });
}

/** Debug/test — ana kayıt ve isteğe bağlı yedek anahtarlarını temizler. */
export async function clearAllDebugSaves(options?: { includeBackups?: boolean }): Promise<void> {
  try {
    await clearMainSaveSlot();
    if (options?.includeBackups !== false) {
      await AsyncStorage.multiRemove([SAVE_BACKUP_INVALID_KEY, SAVE_BACKUP_MIGRATED_KEY]);
    }
  } catch (error) {
    console.warn('[saveGame] clearAllDebugSaves failed:', error);
    throw error;
  }
}

export async function getSaveBackupStatus(): Promise<SaveBackupStatus> {
  try {
    const [invalid, migrated] = await Promise.all([
      AsyncStorage.getItem(SAVE_BACKUP_INVALID_KEY),
      AsyncStorage.getItem(SAVE_BACKUP_MIGRATED_KEY),
    ]);
    return {
      invalid: invalid != null && invalid.length > 0,
      migrated: migrated != null && migrated.length > 0,
    };
  } catch (error) {
    console.warn('[saveGame] getSaveBackupStatus failed:', error);
    return { invalid: false, migrated: false };
  }
}

async function parseAndMigrateRawSave(rawString: string): Promise<{
  payload: SaveGamePayload | null;
  error: string | null;
  migratedFromVersion: number | null;
  shouldPersistMigrated: boolean;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawString);
  } catch (error) {
    const message = '[saveGame] Save JSON parse failed. Backing up corrupted save.';
    console.warn(message, error);
    await backupCorruptedSave(rawString);
    await clearMainSaveSlot();
    return {
      payload: null,
      error: 'Kayıt dosyası bozuk — yedeklendi, yeni oyun başlatılacak.',
      migratedFromVersion: null,
      shouldPersistMigrated: false,
    };
  }

  const sourceVersion = isRecord(parsed) && typeof parsed.version === 'number' ? parsed.version : 0;
  const migrated = migrateSavePayload(parsed);

  if (!migrated) {
    const message =
      '[saveGame] Migration failed. Backing up invalid save and starting new game.';
    console.warn(message);
    await backupInvalidSave(rawString);
    await clearMainSaveSlot();
    return {
      payload: null,
      error: 'Kayıt yüklenemedi — yedeklendi, yeni oyun başlatılacak.',
      migratedFromVersion: null,
      shouldPersistMigrated: false,
    };
  }

  const migratedFromVersion =
    migrated.meta.migratedFromVersion ?? (sourceVersion < SAVE_GAME_VERSION ? sourceVersion : null);

  return {
    payload: migrated,
    error: null,
    migratedFromVersion,
    shouldPersistMigrated: sourceVersion < SAVE_GAME_VERSION,
  };
}

export const localSaveProvider: SaveProvider = {
  async save(payload) {
    try {
      const json = JSON.stringify(payload);
      await AsyncStorage.setItem(SAVE_STORAGE_KEY, json);
    } catch (error) {
      console.warn('[saveGame] localSaveProvider.save failed:', error);
      throw error;
    }
  },

  async load() {
    const result = await loadGameStateDetailed();
    if (!result.payload) {
      return null;
    }
    return result.payload;
  },

  async clear() {
    await clearMainSaveSlot();
  },

  async hasSave() {
    return hasValidSavedGame();
  },
};

let activeSaveProvider: SaveProvider = localSaveProvider;

export function setSaveProvider(provider: SaveProvider): void {
  activeSaveProvider = provider;
}

export function getSaveProvider(): SaveProvider {
  return activeSaveProvider;
}

/** Legacy / debug fields that must never be persisted — stripped on load. */
const LEGACY_BLOATED_SAVE_KEYS = [
  'mapRoadSegments',
  'roadNetwork',
  'roadSegments',
  'routePoints',
  'polyline',
  'calibrationPoints',
  'calibration',
  'sessionsBySegmentId',
  'activeCalibrationSegmentId',
  'debugMarkers',
  'mapDebugConfig',
  'graphAdjacency',
  'routeResolutionCache',
  'uiSelectorCache',
] as const;

export function stripLegacyBloatedSaveFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const stripped = { ...payload };
  for (const key of LEGACY_BLOATED_SAVE_KEYS) {
    delete stripped[key];
  }
  return stripped;
}

/** UTF-8 byte length of JSON serialization (cloud save limit probe). */
export function measureUtf8JsonBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(json).length;
    }
    return json.length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export interface SavePayloadSizeReport {
  totalBytes: number;
  totalKb: number;
  topLevelKeys: Record<string, number>;
}

/** Per top-level field size breakdown for dev diagnostics. */
export function analyzeSavePayloadSize(payload: SaveGamePayload): SavePayloadSizeReport {
  const topLevelKeys: Record<string, number> = {};
  const fields: Array<keyof SaveGamePayload | 'calibration'> = [
    'meta',
    'player',
    'cities',
    'products',
    'routes',
    'contracts',
    'activeDeliveries',
    'globalEconomy',
    'marketNews',
    'eventLog',
    'financeLedger',
    'tutorial',
    'missions',
    'monetization',
  ];

  const payloadRecord = payload as unknown as Record<string, unknown>;

  for (const key of fields) {
    if (key in payloadRecord) {
      topLevelKeys[key] = measureUtf8JsonBytes(payloadRecord[key]);
    }
  }

  const legacyCalibration =
    payloadRecord.calibration ?? payloadRecord.sessionsBySegmentId;
  if (legacyCalibration !== undefined) {
    topLevelKeys.calibration = measureUtf8JsonBytes(legacyCalibration);
  }

  const totalBytes = measureUtf8JsonBytes(payload);
  return {
    totalBytes,
    totalKb: Math.round((totalBytes / 1024) * 10) / 10,
    topLevelKeys,
  };
}

function trimCityProductsForSave(products: City['products']): City['products'] {
  const trimmed = {} as City['products'];
  for (const [productId, state] of Object.entries(products)) {
    trimmed[productId as ProductId] = {
      ...state,
      // Global chart history belongs to globalMarketHistory, not player save.
      priceHistory: undefined,
    };
  }
  return trimmed;
}

/** Persist only dynamic city market state — static metadata rehydrates from canonical catalog. */
export function slimCityForSave(city: City): City {
  return {
    id: city.id,
    name: city.name,
    population: 0,
    industryLevel: 0,
    tourismLevel: 0,
    agricultureLevel: 0,
    productionMultiplier: 1,
    demandMultiplier: 1,
    fuelPriceModifier: 1,
    trafficDifficulty: 0,
    warehouseCostModifier: 1,
    products: trimCityProductsForSave(city.products),
  };
}

/**
 * Drop dead contract history before save.
 * Keeps available/active contracts and any contract tied to an in-flight delivery.
 */
export function pruneContractsForSave(
  contracts: Contract[],
  activeDeliveries: Delivery[],
  currentTime: number,
): Contract[] {
  const activeContractIds = new Set(
    activeDeliveries.map((delivery) => delivery.contractId).filter(Boolean),
  );
  const gen = contractGenerationBalance;
  const maxAvailable = gen.maxAvailableContracts + 8;

  const available: Contract[] = [];
  const retained: Contract[] = [];

  for (const contract of contracts) {
    if (contract.status === 'active' || activeContractIds.has(contract.id)) {
      retained.push(contract);
      continue;
    }
    if (contract.status === 'available') {
      if (currentTime >= contract.expiresAt) {
        continue;
      }
      available.push(contract);
    }
  }

  available.sort((a, b) => b.createdAt - a.createdAt);
  const cappedAvailable = available.slice(0, maxAvailable);

  return [...retained, ...cappedAvailable];
}

export function serializeGameState(state: StoreGameState): SaveGamePayload {
  const homeCityId = state.player.homeCityId ?? 'izmir';
  const player: Player = normalizeLoadedPlayer({
    ...structuredClone(state.player),
    homeCityId,
  });

  const companyScore = calculateCompanyScore({
    player,
    cities: state.cities,
    products: state.products,
    financeLedger: state.financeLedger ?? [],
    currentTime: state.currentTime,
  });

  return {
    version: SAVE_GAME_VERSION,
    meta: {
      savedAt: Date.now(),
      currentTime: state.currentTime,
      cash: state.player.money,
      companyName: state.player.companyName,
      completedContracts: state.player.completedContracts,
      level: player.level,
      xp: player.xp,
      totalXp: player.totalXp,
      diamonds: player.diamonds ?? 0,
      companyScore,
      appVersion: APP_VERSION,
      saveVersion: SAVE_GAME_VERSION,
    },
    currentTime: state.currentTime,
    player,
    cities: state.cities.map(slimCityForSave),
    products: [],
    routes: [],
    contracts: pruneContractsForSave(
      state.contracts,
      state.activeDeliveries,
      state.currentTime,
    ),
    activeDeliveries: structuredClone(state.activeDeliveries),
    activeTransfers: structuredClone(state.activeTransfers ?? []),
    completedTransfers: structuredClone(state.completedTransfers ?? []),
    activeWarehouseStockTransfers: structuredClone(state.activeWarehouseStockTransfers ?? []),
    completedWarehouseStockTransfers: structuredClone(
      state.completedWarehouseStockTransfers ?? [],
    ),
    globalEconomy: normalizeGlobalEconomy(state.globalEconomy),
    marketNews: structuredClone(state.marketNews),
    eventLog: structuredClone(state.eventLog),
    financeLedger: structuredClone(
      (state.financeLedger ?? []).slice(0, FINANCE_LEDGER_MAX_COUNT),
    ),
    financeTotals: structuredClone(state.financeTotals),
    gameSpeed: state.gameSpeed,
    isPaused: state.isPaused,
    lastEconomyTickTime: state.lastEconomyTickTime,
    lastDailyOperatingCostTime: state.lastDailyOperatingCostTime,
    lastContractGenerationTime: state.lastContractGenerationTime,
    lastMarketRefreshTime: state.lastMarketRefreshTime,
    lastDailyCleanupTime: state.lastDailyCleanupTime,
    lastPlayableContractGeneratedTime: state.lastPlayableContractGeneratedTime,
    lastManualContractRefreshTime: state.lastManualContractRefreshTime,
    tutorial: structuredClone(state.tutorial),
    missions: structuredClone(state.missions),
    retention: structuredClone(state.retention),
    onboarding: structuredClone(state.onboarding),
    spotlightTutorial: structuredClone(state.spotlightTutorial),
    marketAlerts: structuredClone(state.marketAlerts ?? []),
    worldEvents: structuredClone(state.worldEvents ?? []),
    worldEventsVersion: state.worldEventsVersion ?? 1,
    lastWorldEventGeneratedDay: state.lastWorldEventGeneratedDay ?? 0,
    monetization: structuredClone(
      normalizeMonetizationState(state.monetization, state.currentTime),
    ),
    lastSeenRealTimeMs: state.lastSeenRealTimeMs ?? state.lastSimulatedRealTimeMs ?? Date.now(),
    lastSimulatedRealTimeMs:
      state.lastSimulatedRealTimeMs ?? state.lastSeenRealTimeMs ?? Date.now(),
    lastOfflineProgressAppliedAt: state.lastOfflineProgressAppliedAt,
    offlineProgressVersion: state.offlineProgressVersion ?? 1,
    lastSimulationGameSpeed: state.lastSimulationGameSpeed ?? state.gameSpeed ?? 1,
    lastProcessedEconomyAt: state.lastProcessedEconomyAt,
    lastSeenMarketEpoch: state.lastSeenMarketEpoch,
    cachedSnapshotVersion: state.cachedSnapshotVersion,
    cachedSnapshotGeneratedAt: state.cachedSnapshotGeneratedAt,
    cachedGlobalEconomySnapshot: state.cachedGlobalEconomySnapshot
      ? structuredClone(state.cachedGlobalEconomySnapshot)
      : undefined,
    cachedGlobalEconomySnapshotTrusted:
      state.cachedGlobalEconomySnapshotTrusted === true,
    appliedEconomyPeriodKeys: state.appliedEconomyPeriodKeys?.slice(-48),
    lastEmergencyContractAtMs: state.lastEmergencyContractAtMs,
    lastRoadsideFuelAssistanceAt: state.lastRoadsideFuelAssistanceAt,
    fuelTransactionKeys: state.fuelTransactionKeys?.slice(-32),
  };
}

export function payloadToStoreState(payload: SaveGamePayload): StoreGameState {
  const economyTickInterval = 24;
  const safeCurrentTime = payload.currentTime ?? 0;
  const fallbackTickTime =
    Math.floor(safeCurrentTime / economyTickInterval) * economyTickInterval;
  const player: Player = recoverStarterFleetIfMissing(
    normalizeLoadedPlayer({
      ...payload.player,
      warehouses: payload.player.warehouses ?? [],
    }),
    payload.activeDeliveries ?? [],
  );
  const cachedSnapshotCandidate =
    payload.cachedGlobalEconomySnapshot &&
    Number.isFinite(payload.cachedGlobalEconomySnapshot.epoch) &&
    Number.isFinite(payload.cachedGlobalEconomySnapshot.fuelPricePerLiter)
      ? structuredClone(payload.cachedGlobalEconomySnapshot)
      : undefined;
  const cachedSnapshotTrusted =
    payload.cachedGlobalEconomySnapshotTrusted === true;
  const cachedSnapshot =
    cachedSnapshotCandidate &&
    (cachedSnapshotTrusted || (typeof __DEV__ !== 'undefined' && __DEV__))
      ? cachedSnapshotCandidate
      : undefined;
  const hydratedCities = cachedSnapshot
    ? materializeSnapshotCities(CITIES, cachedSnapshot)
    : mergeCanonicalCities(payload.cities);
  const hydratedEconomy = normalizeGlobalEconomy({
    ...payload.globalEconomy,
    fuelPrice:
      cachedSnapshot?.fuelPricePerLiter ?? payload.globalEconomy?.fuelPrice,
  });

  return {
    currentTime: safeCurrentTime,
    isPaused: payload.isPaused,
    gameSpeed: payload.gameSpeed,
    lastEconomyTickTime: payload.lastEconomyTickTime ?? fallbackTickTime,
    lastDailyOperatingCostTime: payload.lastDailyOperatingCostTime ?? fallbackTickTime,
    lastContractGenerationTime: payload.lastContractGenerationTime ?? safeCurrentTime,
    lastMarketRefreshTime: payload.lastMarketRefreshTime ?? 0,
    lastDailyCleanupTime: payload.lastDailyCleanupTime ?? 0,
    lastPlayableContractGeneratedTime: payload.lastPlayableContractGeneratedTime ?? 0,
    lastManualContractRefreshTime: payload.lastManualContractRefreshTime ?? 0,
    player,
    cities: hydratedCities,
    products:
      isArray(payload.products) && payload.products.length > 0
        ? (payload.products as Product[])
        : structuredClone(PRODUCTS),
    routes: mergeCanonicalRoutes(payload.routes),
    contracts: normalizeLoadedContracts(payload.contracts ?? []),
    activeDeliveries: normalizeDeliveryFuelJobs(
      payload.activeDeliveries,
      player.trucks,
      safeCurrentTime,
    ),
    activeTransfers: normalizeTruckTransferFuelJobs(
      payload.activeTransfers,
      player.trucks,
      safeCurrentTime,
    ),
    completedTransfers: normalizeTruckTransferFuelJobs(
      payload.completedTransfers,
      player.trucks,
      safeCurrentTime,
    ),
    activeWarehouseStockTransfers: normalizeWarehouseTransferFuelJobs(
      payload.activeWarehouseStockTransfers,
      player.trucks,
      safeCurrentTime,
    ),
    completedWarehouseStockTransfers: normalizeWarehouseTransferFuelJobs(
      payload.completedWarehouseStockTransfers,
      player.trucks,
      safeCurrentTime,
    ),
    globalEconomy: hydratedEconomy,
    marketNews: payload.marketNews,
    eventLog: payload.eventLog,
    financeLedger: payload.financeLedger ?? [],
    financeTotals: ensureFinanceTotals(payload.financeLedger, payload.financeTotals),
    tutorial: normalizeTutorialState(payload.tutorial),
    missions: normalizeMissionsState(payload.missions),
    retention: normalizeRetentionState(payload.retention),
    onboarding: payload.onboarding
      ? normalizeOnboardingState(payload.onboarding)
      : inferLegacyOnboardingFromSave({
          completedContracts: player.completedContracts ?? 0,
          activeDeliveryCount: payload.activeDeliveries?.length ?? 0,
          deliveryStarted: payload.missions?.flags?.deliveryStarted === true,
          tradePurchased: payload.missions?.flags?.tradePurchased === true,
          playerLevel: player.level ?? 1,
          tutorialCompleted: payload.tutorial?.isCompleted === true,
        }),
    spotlightTutorial: normalizeSpotlightTutorialState(payload.spotlightTutorial),
    marketAlerts: normalizeMarketAlerts(payload.marketAlerts),
    ...normalizeWorldEventsState(
      payload.worldEvents,
      gameDayFromTime(safeCurrentTime),
      payload.worldEventsVersion,
      payload.lastWorldEventGeneratedDay,
    ),
    monetization: normalizeMonetizationState(payload.monetization, safeCurrentTime),
    lastSeenRealTimeMs:
      payload.lastSeenRealTimeMs != null && Number.isFinite(payload.lastSeenRealTimeMs)
        ? payload.lastSeenRealTimeMs
        : payload.lastSimulatedRealTimeMs != null &&
            Number.isFinite(payload.lastSimulatedRealTimeMs)
          ? payload.lastSimulatedRealTimeMs
          : undefined,
    lastSimulatedRealTimeMs:
      payload.lastSimulatedRealTimeMs != null &&
      Number.isFinite(payload.lastSimulatedRealTimeMs)
        ? payload.lastSimulatedRealTimeMs
        : payload.lastSeenRealTimeMs != null && Number.isFinite(payload.lastSeenRealTimeMs)
          ? payload.lastSeenRealTimeMs
          : undefined,
    lastOfflineProgressAppliedAt:
      payload.lastOfflineProgressAppliedAt != null &&
      Number.isFinite(payload.lastOfflineProgressAppliedAt)
        ? payload.lastOfflineProgressAppliedAt
        : undefined,
    offlineProgressVersion: payload.offlineProgressVersion ?? 1,
    lastSimulationGameSpeed:
      payload.lastSimulationGameSpeed != null &&
      Number.isFinite(payload.lastSimulationGameSpeed) &&
      payload.lastSimulationGameSpeed > 0
        ? payload.lastSimulationGameSpeed
        : payload.gameSpeed ?? 1,
    lastProcessedEconomyAt:
      payload.lastProcessedEconomyAt != null && Number.isFinite(payload.lastProcessedEconomyAt)
        ? payload.lastProcessedEconomyAt
        : undefined,
    lastSeenMarketEpoch:
      payload.lastSeenMarketEpoch != null && Number.isFinite(payload.lastSeenMarketEpoch)
        ? payload.lastSeenMarketEpoch
        : undefined,
    cachedSnapshotVersion:
      payload.cachedSnapshotVersion != null && Number.isFinite(payload.cachedSnapshotVersion)
        ? payload.cachedSnapshotVersion
        : undefined,
    cachedSnapshotGeneratedAt:
      payload.cachedSnapshotGeneratedAt != null &&
      Number.isFinite(payload.cachedSnapshotGeneratedAt)
        ? payload.cachedSnapshotGeneratedAt
        : undefined,
    cachedGlobalEconomySnapshot: cachedSnapshot,
    cachedGlobalEconomySnapshotTrusted: cachedSnapshotTrusted && !!cachedSnapshot,
    globalMarketHistory: [],
    globalMarketSyncStatus: cachedSnapshot
      ? 'offline-cache'
      : 'idle',
    appliedEconomyPeriodKeys: Array.isArray(payload.appliedEconomyPeriodKeys)
      ? payload.appliedEconomyPeriodKeys.filter((k): k is string => typeof k === 'string').slice(-48)
      : undefined,
    lastEmergencyContractAtMs:
      payload.lastEmergencyContractAtMs != null &&
      Number.isFinite(payload.lastEmergencyContractAtMs)
        ? payload.lastEmergencyContractAtMs
        : undefined,
    lastRoadsideFuelAssistanceAt:
      payload.lastRoadsideFuelAssistanceAt != null &&
      Number.isFinite(payload.lastRoadsideFuelAssistanceAt)
        ? payload.lastRoadsideFuelAssistanceAt
        : undefined,
    fuelTransactionKeys: Array.isArray(payload.fuelTransactionKeys)
      ? payload.fuelTransactionKeys
          .filter((key): key is string => typeof key === 'string' && key.length > 0)
          .slice(-32)
      : [],
  };
}

export interface SaveLoadDetailedResult {
  payload: SaveGamePayload | null;
  error: string | null;
  migratedFromVersion: number | null;
}

export async function loadGameStateDetailed(): Promise<SaveLoadDetailedResult> {
  try {
    const json = await AsyncStorage.getItem(SAVE_STORAGE_KEY);
    if (!json) {
      return { payload: null, error: null, migratedFromVersion: null };
    }

    const rawBeforeMigrate = json;
    const parsed = await parseAndMigrateRawSave(json);

    if (!parsed.payload) {
      return {
        payload: null,
        error: parsed.error,
        migratedFromVersion: null,
      };
    }

    if (parsed.shouldPersistMigrated) {
      await backupMigratedSave(rawBeforeMigrate);
      await activeSaveProvider.save(parsed.payload);
    }

    return {
      payload: parsed.payload,
      error: null,
      migratedFromVersion: parsed.migratedFromVersion,
    };
  } catch (error) {
    const message = '[saveGame] loadGameStateDetailed failed.';
    console.warn(message, error);
    return {
      payload: null,
      error: 'Kayıt okunurken beklenmeyen hata oluştu.',
      migratedFromVersion: null,
    };
  }
}

export async function loadGameState(): Promise<StoreGameState | null> {
  const result = await loadGameStateWithMeta();
  return result.state;
}

export async function loadGameStateWithMeta(): Promise<SaveLoadResult> {
  const backup = await getSaveBackupStatus();
  const detailed = await loadGameStateDetailed();

  if (!detailed.payload) {
    return {
      state: null,
      error: detailed.error,
      migratedFromVersion: null,
      hasValidSave: false,
      backup,
    };
  }

  return {
    state: payloadToStoreState(detailed.payload),
    error: null,
    migratedFromVersion: detailed.migratedFromVersion,
    hasValidSave: true,
    backup,
  };
}

export async function saveGameState(state: StoreGameState): Promise<boolean> {
  try {
    const payload = serializeGameState(state);
    await activeSaveProvider.save(payload);
    return true;
  } catch (error) {
    console.warn('[saveGame] saveGameState failed:', error);
    return false;
  }
}

export async function clearSavedGame(): Promise<void> {
  try {
    await activeSaveProvider.clear();
  } catch (error) {
    console.warn('[saveGame] clearSavedGame failed:', error);
    throw error;
  }
}

/** Geçerli veya migrate edilebilir kayıt var mı? */
export async function hasValidSavedGame(): Promise<boolean> {
  try {
    const json = await AsyncStorage.getItem(SAVE_STORAGE_KEY);
    if (!json || json.length === 0) {
      return false;
    }

    try {
      const parsed: unknown = JSON.parse(json);
      return migrateSavePayload(parsed) !== null;
    } catch {
      return false;
    }
  } catch (error) {
    console.warn('[saveGame] hasValidSavedGame failed:', error);
    return false;
  }
}

export async function hasSavedGame(): Promise<boolean> {
  return hasValidSavedGame();
}
