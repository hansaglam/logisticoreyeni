/**
 * LogistiCore - Yerel oyun kaydı (AsyncStorage)
 *
 * Internal test build: yalnızca localSaveProvider aktif.
 * Backend entegrasyonu için bkz. src/config/backendRoadmap.ts
 *
 * TODO: Add firebaseSaveProvider for cloud save sync.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  City,
  Contract,
  Delivery,
  GameEvent,
  FinanceLedgerEntry,
  GlobalEconomy,
  MarketNews,
  Player,
  Product,
  Route,
  StoreGameState,
  Warehouse,
} from '../types/game';
import { normalizeWarehouse } from '../simulation/trading';
import { normalizePlayerProgress } from '../simulation/leveling';

export const SAVE_STORAGE_KEY = 'logisticore_save_v1';
export const SAVE_GAME_VERSION = 1;

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
  appVersion: string;
  saveVersion: number;
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
  globalEconomy: GlobalEconomy;
  marketNews: MarketNews[];
  eventLog: GameEvent[];
  financeLedger?: FinanceLedgerEntry[];
  gameSpeed: number;
  isPaused: boolean;
}

export type SaveProvider = {
  save: (payload: SaveGamePayload) => Promise<void>;
  load: () => Promise<SaveGamePayload | null>;
  clear: () => Promise<void>;
  hasSave: () => Promise<boolean>;
};

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
    try {
      const json = await AsyncStorage.getItem(SAVE_STORAGE_KEY);
      if (!json) {
        return null;
      }

      const parsed: unknown = JSON.parse(json);
      if (!validateSavePayload(parsed)) {
        console.warn('[saveGame] Invalid or incompatible save payload, ignoring.');
        return null;
      }

      return parsed;
    } catch (error) {
      console.warn('[saveGame] localSaveProvider.load failed:', error);
      return null;
    }
  },

  async clear() {
    try {
      await AsyncStorage.removeItem(SAVE_STORAGE_KEY);
    } catch (error) {
      console.warn('[saveGame] localSaveProvider.clear failed:', error);
      throw error;
    }
  },

  async hasSave() {
    try {
      const json = await AsyncStorage.getItem(SAVE_STORAGE_KEY);
      return json != null && json.length > 0;
    } catch (error) {
      console.warn('[saveGame] localSaveProvider.hasSave failed:', error);
      return false;
    }
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
  const player: Player = normalizePlayerProgress({
    ...structuredClone(state.player),
    warehouses: normalizePlayerWarehouses(state.player.warehouses),
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
    globalEconomy: structuredClone(state.globalEconomy),
    marketNews: structuredClone(state.marketNews),
    eventLog: structuredClone(state.eventLog),
    financeLedger: structuredClone(state.financeLedger ?? []),
    gameSpeed: state.gameSpeed,
    isPaused: state.isPaused,
  };
}

function normalizePlayerWarehouses(warehouses: Warehouse[]): Warehouse[] {
  return (warehouses ?? []).map((warehouse) => normalizeWarehouse(warehouse));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function validateSavePayload(payload: unknown): payload is SaveGamePayload {
  if (!isRecord(payload)) {
    return false;
  }

  if (typeof payload.version !== 'number') {
    return false;
  }

  // TODO: Add save migration when SAVE_GAME_VERSION increases.
  if (payload.version !== SAVE_GAME_VERSION) {
    console.warn(
      `[saveGame] Save version mismatch: expected ${SAVE_GAME_VERSION}, got ${payload.version}`,
    );
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
      console.warn(`[saveGame] Invalid save field: ${label}`);
      return false;
    }
  }

  if (typeof payload.meta.companyName !== 'string' || payload.meta.companyName.length === 0) {
    return false;
  }

  // level/xp meta alanları eski kayıtlarda olmayabilir — player normalize edilir
  const optionalMetaNumbers: Array<[unknown, string]> = [
    [payload.meta.level, 'meta.level'],
    [payload.meta.xp, 'meta.xp'],
    [payload.meta.totalXp, 'meta.totalXp'],
  ];
  for (const [value, label] of optionalMetaNumbers) {
    if (value !== undefined && (typeof value !== 'number' || Number.isNaN(value))) {
      console.warn(`[saveGame] Invalid save field: ${label}`);
      return false;
    }
  }

  if (typeof payload.meta.appVersion !== 'string') {
    return false;
  }

  if (typeof payload.isPaused !== 'boolean') {
    return false;
  }

  if (!isRecord(payload.player)) {
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
      console.warn(`[saveGame] Invalid save field: ${label}`);
      return false;
    }
  }

  if (!isRecord(payload.globalEconomy)) {
    return false;
  }

  if (typeof payload.player.money !== 'number') {
    return false;
  }

  if (!isArray(payload.player.trucks) || !isArray(payload.player.drivers)) {
    return false;
  }

  return true;
}

export function payloadToStoreState(payload: SaveGamePayload): StoreGameState {
  const economyTickInterval = 24;
  const player: Player = normalizePlayerProgress({
    ...payload.player,
    warehouses: normalizePlayerWarehouses(payload.player.warehouses ?? []),
  });

  return {
    currentTime: payload.currentTime,
    isPaused: payload.isPaused,
    gameSpeed: payload.gameSpeed,
    lastEconomyTickTime:
      Math.floor(payload.currentTime / economyTickInterval) * economyTickInterval,
    player,
    cities: payload.cities,
    products: payload.products,
    routes: payload.routes,
    contracts: payload.contracts,
    activeDeliveries: payload.activeDeliveries,
    globalEconomy: payload.globalEconomy,
    marketNews: payload.marketNews,
    eventLog: payload.eventLog,
    financeLedger: payload.financeLedger ?? [],
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

export async function loadGameState(): Promise<StoreGameState | null> {
  try {
    const payload = await activeSaveProvider.load();
    if (!payload) {
      return null;
    }
    return payloadToStoreState(payload);
  } catch (error) {
    console.warn('[saveGame] loadGameState failed:', error);
    return null;
  }
}

export async function clearSavedGame(): Promise<void> {
  try {
    await activeSaveProvider.clear();
  } catch (error) {
    console.warn('[saveGame] clearSavedGame failed:', error);
  }
}

export async function hasSavedGame(): Promise<boolean> {
  try {
    return await activeSaveProvider.hasSave();
  } catch (error) {
    console.warn('[saveGame] hasSavedGame failed:', error);
    return false;
  }
}
