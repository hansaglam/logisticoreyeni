/**
 * LogistiCore - Yerel oyun kaydı (AsyncStorage) + Firestore cloud sync köprüsü
 *
 * Local save ana kaynaktır. Cloud sync: src/storage/cloudSaveSync.ts
 * Backend servisleri: src/services/firebase.ts, authService.ts, cloudSaveService.ts
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { CITIES } from '../data/cities';
import { normalizeDriver } from '../data/drivers';
import { PRODUCTS } from '../data/products';
import { ROUTES } from '../data/routes';
import { normalizeGlobalEconomy } from '../simulation/economy';
import { normalizeTruckCity } from '../simulation/delivery';
import { calculateXpToNextLevel, normalizePlayerProgress } from '../simulation/leveling';
import { normalizeWarehouse } from '../simulation/trading';
import { calculateCompanyScore } from '../simulation/companyScore';
import { ensureFinanceTotals } from '../utils/financeLedger';
import { normalizeMissionsState, normalizeTutorialState } from '../utils/missionProgress';
import { normalizeSpotlightTutorialState } from '../tutorial/spotlightTutorialState';
import { normalizeCitiesPriceHistory, seedProductPriceHistory } from '../utils/productPriceHistory';
import { normalizeMarketAlerts } from '../utils/marketAlerts';
import type {
  City,
  Contract,
  Delivery,
  GameEvent,
  FinanceLedgerEntry,
  FinanceTotals,
  GlobalEconomy,
  MarketNews,
  MissionsState,
  MarketPriceAlert,
  Player,
  Product,
  Route,
  SpotlightTutorialPersistence,
  StoreGameState,
  TutorialState,
  TruckTransfer,
  Warehouse,
} from '../types/game';

export const SAVE_STORAGE_KEY = 'logisticore_save_v1';
export const SAVE_BACKUP_INVALID_KEY = 'logisticore_save_backup_invalid';
export const SAVE_BACKUP_MIGRATED_KEY = 'logisticore_save_backup_migrated';
export const SAVE_GAME_VERSION = 2;

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
  spotlightTutorial?: SpotlightTutorialPersistence;
  marketAlerts?: MarketPriceAlert[];
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
      Object.entries(city.products).map(([productId, productState]) => [
        productId,
        {
          ...productState,
          currentPrice: productState.currentPrice ?? productState.basePrice,
          priceHistory: seedProductPriceHistory(
            productState.currentPrice ?? productState.basePrice,
          ),
        },
      ]),
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

function normalizePlayerTrucks(trucks: Player['trucks'], homeCityId: string): Player['trucks'] {
  const fallbackHome = homeCityId || 'izmir';
  return (trucks ?? []).map((truck) => normalizeTruckCity(truck, fallbackHome));
}

export function normalizeLoadedPlayer(player: Player): Player {
  const homeCityId = player.homeCityId ?? 'izmir';
  return normalizePlayerProgress({
    ...player,
    homeCityId,
    warehouses: normalizePlayerWarehouses(player.warehouses ?? []),
    trucks: normalizePlayerTrucks(player.trucks, homeCityId),
    drivers: (player.drivers ?? []).map((driver) => normalizeDriver(driver)),
  });
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
    reputation: safeNumber(playerRecord.reputation, 50),
    completedContracts: safeNumber(playerRecord.completedContracts, 0),
    failedDeliveries: safeNumber(playerRecord.failedDeliveries, 0),
    lateDeliveries: safeNumber(playerRecord.lateDeliveries, 0),
    diamonds: safeNumber(playerRecord.diamonds, 0),
    trucks: isArray(playerRecord.trucks) ? (playerRecord.trucks as Player['trucks']) : [],
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
      ? (payload.cities as City[])
      : cloneDefaultCities(),
    products: isArray(payload.products) && payload.products.length > 0
      ? (payload.products as Product[])
      : structuredClone(PRODUCTS),
    routes: isArray(payload.routes) && payload.routes.length > 0
      ? (payload.routes as Route[])
      : structuredClone(ROUTES),
    contracts: isArray(payload.contracts) ? (payload.contracts as Contract[]) : [],
    activeDeliveries: isArray(payload.activeDeliveries)
      ? (payload.activeDeliveries as Delivery[])
      : [],
    activeTransfers: isArray(payload.activeTransfers)
      ? (payload.activeTransfers as TruckTransfer[])
      : [],
    completedTransfers: isArray(payload.completedTransfers)
      ? (payload.completedTransfers as TruckTransfer[])
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
    spotlightTutorial: normalizeSpotlightTutorialState(
      isRecord(payload.spotlightTutorial)
        ? (payload.spotlightTutorial as Partial<SpotlightTutorialPersistence>)
        : undefined,
    ),
    marketAlerts: normalizeMarketAlerts(
      isArray(payload.marketAlerts) ? (payload.marketAlerts as MarketPriceAlert[]) : undefined,
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
    activeDeliveries: withFallbacks.activeDeliveries as Delivery[],
    activeTransfers: withFallbacks.activeTransfers as TruckTransfer[],
    completedTransfers: withFallbacks.completedTransfers as TruckTransfer[],
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
    spotlightTutorial: withFallbacks.spotlightTutorial as SpotlightTutorialPersistence,
    marketAlerts: normalizeMarketAlerts(withFallbacks.marketAlerts as MarketPriceAlert[] | undefined),
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

  const sourceVersion =
    typeof rawPayload.version === 'number' ? rawPayload.version : 0;

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

  const normalized = normalizeSavePayload(rawPayload);

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
    cities: structuredClone(state.cities),
    products: structuredClone(state.products),
    routes: structuredClone(state.routes),
    contracts: structuredClone(state.contracts),
    activeDeliveries: structuredClone(state.activeDeliveries),
    activeTransfers: structuredClone(state.activeTransfers ?? []),
    completedTransfers: structuredClone(state.completedTransfers ?? []),
    globalEconomy: normalizeGlobalEconomy(state.globalEconomy),
    marketNews: structuredClone(state.marketNews),
    eventLog: structuredClone(state.eventLog),
    financeLedger: structuredClone(state.financeLedger ?? []),
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
    spotlightTutorial: structuredClone(state.spotlightTutorial),
    marketAlerts: structuredClone(state.marketAlerts ?? []),
  };
}

export function payloadToStoreState(payload: SaveGamePayload): StoreGameState {
  const economyTickInterval = 24;
  const safeCurrentTime = payload.currentTime ?? 0;
  const fallbackTickTime =
    Math.floor(safeCurrentTime / economyTickInterval) * economyTickInterval;
  const player: Player = normalizeLoadedPlayer({
    ...payload.player,
    warehouses: payload.player.warehouses ?? [],
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
    cities: payload.cities,
    products: payload.products,
    routes: payload.routes,
    contracts: payload.contracts,
    activeDeliveries: payload.activeDeliveries,
    activeTransfers: payload.activeTransfers ?? [],
    completedTransfers: payload.completedTransfers ?? [],
    globalEconomy: normalizeGlobalEconomy(payload.globalEconomy),
    marketNews: payload.marketNews,
    eventLog: payload.eventLog,
    financeLedger: payload.financeLedger ?? [],
    financeTotals: ensureFinanceTotals(payload.financeLedger, payload.financeTotals),
    tutorial: normalizeTutorialState(payload.tutorial),
    missions: normalizeMissionsState(payload.missions),
    spotlightTutorial: normalizeSpotlightTutorialState(payload.spotlightTutorial),
    marketAlerts: normalizeMarketAlerts(payload.marketAlerts),
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

export async function saveGameState(state: StoreGameState): Promise<void> {
  try {
    const payload = serializeGameState(state);
    await activeSaveProvider.save(payload);
  } catch (error) {
    console.warn('[saveGame] saveGameState failed:', error);
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
