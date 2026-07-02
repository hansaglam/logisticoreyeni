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
  MarketNews,
  ProductId,
  SimulationGameState,
  StoreGameState,
  Truck,
} from '../types/game';
import { CITIES, CITIES_BY_ID } from '../data/cities';
import { PRODUCTS, PRODUCT_BY_ID } from '../data/products';
import { ROUTES } from '../data/routes';
import { AVAILABLE_DRIVERS, STARTER_DRIVER } from '../data/drivers';
import { AVAILABLE_TRUCKS, STARTER_TRUCK } from '../data/trucks';
import {
  DEFAULT_GLOBAL_ECONOMY,
  randomBetween,
  updateAllCitiesEconomy,
} from '../simulation/economy';
import {
  dedupeAvailableContracts,
  expireOldContracts,
  generateContracts,
  getRouteBetweenCities,
} from '../simulation/contracts';
import {
  calculateLatePenalty,
  calculateTruckRepairCost,
  completeDelivery as completeDeliverySim,
  createDelivery,
  DeliveryError,
  failDelivery as failDeliverySim,
  randomBetween as deliveryRandomBetween,
  updateDeliveryProgress,
} from '../simulation/delivery';
import { economyBalance } from '../config/balance';
import {
  clearSavedGame,
  hasSavedGame,
  loadGameState,
  SAVE_GAME_VERSION,
  saveGameState,
} from '../storage/saveGame';

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const STARTING_MONEY = 20_000;
const AUTO_SAVE_MIN_INTERVAL_MS = 15_000;
const AUTO_SAVE_GAME_HOURS_THRESHOLD = 6;
const ECONOMY_TICK_INTERVAL_HOURS = 24;
const MARKET_NEWS_MAX_AGE_HOURS = 72;
const MARKET_NEWS_MAX_COUNT = 30;
const EVENT_LOG_MAX_AGE_HOURS = 72;
const EVENT_LOG_MAX_COUNT = 50;
const REPUTATION_GAIN = 2;
const REPUTATION_LOSS = 5;
const HIGH_PAYMENT_CONTRACT_THRESHOLD = 8_000;
const FUEL_PRICE_CHANGE_THRESHOLD = 0.05;

// ---------------------------------------------------------------------------
// Otomatik kayıt durumu (modül kapsamı)
// ---------------------------------------------------------------------------

let lastAutoSaveAt = 0;
let lastSavedGameTime = 0;
let saveDirty = false;
let autoSaveEnabled = true;
let gameInitPromise: Promise<void> | null = null;

export type AutoSaveReason =
  | 'critical'
  | 'delivery_completed'
  | 'delivery_failed'
  | 'delivery_started'
  | 'purchase'
  | 'repair'
  | 'reset'
  | 'new_game'
  | 'economy_tick'
  | 'contracts_generated'
  | 'warehouse'
  | 'clear_save'
  | 'background'
  | 'manual';

const IMMEDIATE_SAVE_REASONS = new Set<AutoSaveReason>([
  'critical',
  'delivery_completed',
  'delivery_failed',
  'delivery_started',
  'purchase',
  'repair',
  'reset',
  'new_game',
  'economy_tick',
  'contracts_generated',
  'warehouse',
  'clear_save',
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
  saveVersion: number;
}

function createSaveStatusSnapshot(hasSave = false): SaveStatusSnapshot {
  return {
    hasSave,
    lastSavedAt: lastAutoSaveAt > 0 ? lastAutoSaveAt : null,
    autoSaveEnabled,
    isDirty: saveDirty,
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
  const nonAvailable = existing.filter((contract) => contract.status !== 'available');
  const dedupedAvailable = dedupeAvailableContracts([
    ...existing.filter((contract) => contract.status === 'available'),
    ...incoming.filter((contract) => contract.status === 'available'),
  ]);
  return [...nonAvailable, ...dedupedAvailable];
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
  const contracts = generateContracts(
    citiesToRecord(cities),
    ROUTES,
    PRODUCTS,
    globalEconomy,
    [],
    { currentTime: 0, maxNewContracts: 12 },
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
          storedProducts: {},
        },
      ],
    },
    cities,
    products: structuredClone(PRODUCTS),
    routes: structuredClone(ROUTES),
    contracts,
    activeDeliveries: [],
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
  };
}

// ---------------------------------------------------------------------------
// Store tipi
// ---------------------------------------------------------------------------

export interface GameStore extends StoreGameState {
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
  runEconomyTick: () => void;
  generateNewContracts: () => void;
  expireContracts: () => void;
  startDelivery: (contractId: string, truckId: string, driverId: string) => void;
  updateDeliveries: (hoursPassed: number) => void;
  completeDeliveryById: (deliveryId: string) => void;
  failDeliveryById: (deliveryId: string, reason: DeliveryFailureReason) => void;
  buyTruck: (truckId: string) => void;
  hireDriver: (driverId: string) => void;
  repairTruck: (truckId: string) => void;
  refuelOrUpdateFuelPrice: () => void;
  addMarketNews: (news: Omit<MarketNews, 'id'> & { id?: string }) => void;
  clearOldMarketNews: () => void;
  addGameEvent: (event: Omit<GameEvent, 'id'> & { id?: string }) => void;
  clearOldGameEvents: () => void;
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

export const useGameStore = create<GameStore>((set, get) => ({
  ...createInitialGameState(),
  saveStatus: createSaveStatusSnapshot(false),
  isGameReady: false,

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
        resetAutoSaveTracking(0);
        await get().saveGame();
        await get().refreshSaveStatus();
      } catch (error) {
        console.warn('[gameStore] initializeGame failed:', error);
        set({ ...createInitialGameState(), isGameReady: false, saveStatus: get().saveStatus });
        resetAutoSaveTracking(0);
      } finally {
        set({ isGameReady: true });
      }
    })();

    return gameInitPromise;
  },

  resetGame: () => {
    set(createInitialGameState());
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
        autoSaveEnabled,
      });
      if (__DEV__) {
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

      set({ ...saved, saveStatus: get().saveStatus });
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

    const now = Date.now();
    const state = get();
    const isImmediate = reason !== undefined && IMMEDIATE_SAVE_REASONS.has(reason);
    const realTimeElapsed = now - lastAutoSaveAt;
    const gameTimeElapsed = state.currentTime - lastSavedGameTime;

    if (
      !isImmediate &&
      realTimeElapsed < AUTO_SAVE_MIN_INTERVAL_MS &&
      gameTimeElapsed < AUTO_SAVE_GAME_HOURS_THRESHOLD &&
      !saveDirty
    ) {
      return;
    }

    void get()
      .saveGame()
      .then(() => {
        lastAutoSaveAt = Date.now();
        patchSaveStatus(set, {
          lastSavedAt: lastAutoSaveAt,
          isDirty: false,
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

    // Her 24 oyun saatinde bir ekonomi tick'i
    let { lastEconomyTickTime } = get();
    while (lastEconomyTickTime + ECONOMY_TICK_INTERVAL_HOURS <= newTime) {
      lastEconomyTickTime += ECONOMY_TICK_INTERVAL_HOURS;
      set({ lastEconomyTickTime });
      get().runEconomyTick();
    }

    get().expireContracts();
    get().clearOldMarketNews();
    get().clearOldGameEvents();
    get().markSaveDirty();
    get().autoSave();
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
    const newContracts = generateContracts(
      updatedCitiesRecord,
      state.routes,
      state.products,
      globalEconomy,
      expiredContracts,
      { currentTime: state.currentTime, maxNewContracts: 10 },
    );

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

    if (newContracts.length > 0) {
      gameEvents.push({
        time: state.currentTime,
        type: 'market',
        title: 'Yeni taşıma fırsatları',
        message: `Piyasa güncellendi: ${newContracts.length} yeni sözleşme eklendi.`,
        importance: 'medium',
      });
    }

    set({
      cities: citiesFromRecord(updatedCitiesRecord),
      globalEconomy,
      contracts: mergeContractsWithDedupe(expiredContracts, newContracts),
      marketNews: [...news, ...state.marketNews].slice(0, MARKET_NEWS_MAX_COUNT),
      eventLog: prependGameEvents(state.eventLog, gameEvents, state.currentTime),
    });
    get().autoSave('economy_tick');
  },

  generateNewContracts: () => {
    const state = get();
    const newContracts = generateContracts(
      citiesToRecord(state.cities),
      state.routes,
      state.products,
      state.globalEconomy,
      state.contracts,
      { currentTime: state.currentTime, maxNewContracts: 10 },
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
      get().autoSave('contracts_generated');
    }
  },

  expireContracts: () => {
    const state = get();
    const expired = expireOldContracts(state.contracts, state.currentTime);
    set({ contracts: expired });
  },

  startDelivery: (contractId: string, truckId: string, driverId: string) => {
    const state = get();

    const contract = state.contracts.find((c) => c.id === contractId);
    if (!contract || contract.status !== 'available') {
      throw new Error('Sözleşme bulunamadı veya müsait değil.');
    }

    const truck = state.player.trucks.find((t) => t.id === truckId);
    if (!truck || truck.status !== 'idle') {
      throw new Error('Kamyon bulunamadı veya müsait değil.');
    }

    const driver = state.player.drivers.find((d) => d.id === driverId);
    if (!driver || driver.status !== 'idle') {
      throw new Error('Şoför bulunamadı veya müsait değil.');
    }

    const route = getRouteBetweenCities(
      state.routes,
      contract.originCityId,
      contract.destinationCityId,
    );
    if (!route) {
      throw new Error('Rota bulunamadı.');
    }

    const product = PRODUCT_BY_ID[contract.productId];

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
      if (error instanceof DeliveryError) {
        throw error;
      }
      throw error;
    }

    if (state.player.money < delivery.fuelCost) {
      throw new Error(
        `Yetersiz bakiye. Yakıt maliyeti: $${delivery.fuelCost.toFixed(0)}, mevcut: $${state.player.money.toFixed(0)}`,
      );
    }

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
          time: state.currentTime,
          type: 'delivery',
          title: 'Teslimat başlatıldı',
          message: `${getCityName(contract.originCityId)} → ${getCityName(contract.destinationCityId)}: ${product.name} (${delivery.amount.toFixed(1)} ton). Yakıt: $${delivery.fuelCost.toFixed(0)}`,
          importance: 'medium',
        },
        state.currentTime,
      ),
    });
    get().autoSave('delivery_started');
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

  completeDeliveryById: (deliveryId: string) => {
    const state = get();
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
    const earnings = contract.payment - penaltyCost - delivery.maintenanceCost;
    const moneyAfterComplete = beforeMoney + earnings;

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
          message: `${delivery.originCityId} → ${delivery.destinationCityId}: $${earnings.toFixed(0)} net kazanç.`,
          cityId: delivery.destinationCityId,
          productId: delivery.productId,
          importance: 'low' as const,
        },
        ...state.marketNews,
      ].slice(0, MARKET_NEWS_MAX_COUNT),
      eventLog: prependGameEvent(
        state.eventLog,
        {
          time: state.currentTime,
          type: 'delivery',
          title: 'Teslimat tamamlandı',
          message: `${getCityName(delivery.originCityId)} → ${getCityName(delivery.destinationCityId)}: $${earnings.toFixed(0)} net kazanç.`,
          importance: earnings >= HIGH_PAYMENT_CONTRACT_THRESHOLD ? 'high' : 'medium',
        },
        state.currentTime,
      ),
    });
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

  buyTruck: (truckId: string) => {
    const state = get();
    const template = AVAILABLE_TRUCKS.find((t) => t.id === truckId);
    if (!template) {
      throw new Error('Kamyon bulunamadı.');
    }

    if (state.player.trucks.some((t) => t.id === truckId)) {
      throw new Error('Bu kamyon zaten filoda.');
    }

    if (state.player.money < template.purchasePrice) {
      throw new Error('Yetersiz bakiye.');
    }

    const newTruck: Truck = {
      ...template,
      currentCityId: state.player.homeCityId,
      status: 'idle',
    };

    set({
      player: {
        ...state.player,
        money: state.player.money - template.purchasePrice,
        trucks: [...state.player.trucks, newTruck],
      },
    });
    get().autoSave('purchase');
  },

  hireDriver: (driverId: string) => {
    const state = get();
    const template = AVAILABLE_DRIVERS.find((d) => d.id === driverId);
    if (!template) {
      throw new Error('Şoför bulunamadı.');
    }

    if (state.player.drivers.some((d) => d.id === driverId)) {
      throw new Error('Bu şoför zaten işe alınmış.');
    }

    if (state.player.money < template.hiringFee) {
      throw new Error('Yetersiz bakiye.');
    }

    const { hiringFee, ...driverFields } = template;
    const newDriver: Driver = {
      ...driverFields,
      assignedTruckId: null,
      status: 'idle',
    };

    set({
      player: {
        ...state.player,
        money: state.player.money - hiringFee,
        drivers: [...state.player.drivers, newDriver],
      },
    });
    get().autoSave('purchase');
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
