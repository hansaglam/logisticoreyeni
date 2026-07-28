/**
 * Debug-only contract generation from the player's current city
 * to every eligible destination (explicit origin→destination).
 *
 * Does not change the normal generateContracts() market algorithm.
 */

import {
  getCityUnlockLevel,
  getContractTonnageRangeForLevel,
  isWarehouseCityUnlocked,
} from '../config/levelConfig';
import { debugConfig } from '../config/debug';
import { CITY_IDS, CITIES } from '../data/cities';
import {
  getMapRoadSegmentById,
  MAP_ROAD_SEGMENTS,
  isMapRoadSegmentRoutable,
} from '../data/mapRoadNetwork';
import { mergeCanonicalCities, mergeCanonicalRoutes } from '../data/mergeCanonicalCatalog';
import { normalizeCityId } from '../data/networkPositions';
import type {
  City,
  Contract,
  GlobalEconomy,
  Product,
  Route,
  Truck,
} from '../types/game';
import {
  getRoadGraphAdjacency,
  isRoadGraphPairConnected,
} from '../components/map/mapRoadUtils';
import {
  DEFAULT_TRUCK_CITY_ID,
  getIdleTrucks,
  resolveTruckCityId,
} from './delivery';
import {
  generateContractForProduct,
  getRouteBetweenCities,
} from './contracts';
import {
  inspectContractsUiSelector,
  selectAvailableContractsForUi,
} from '../utils/contractsUiSelector';

export type DebugContractSkipReason =
  | 'locked'
  | 'unreachable'
  | 'missing-route'
  | 'invalid-city'
  | 'duplicate'
  | 'generator-failed'
  | 'filtered-from-ui';

export type DebugContractTraceResult =
  | 'created'
  | 'skipped'
  | 'lost-in-store'
  | 'lost-in-post'
  | 'hidden-in-ui';

export interface DebugContractSkip {
  originCityId: string;
  destinationCityId: string;
  reason: DebugContractSkipReason;
}

export interface DebugContractTrace {
  batchId: string;
  originCityId: string;
  destinationCityId: string;
  cityExists: boolean;
  playerLevel: number;
  unlockLevel: number;
  isUnlocked: boolean;
  unlockBypassed: boolean;
  roadBypassed: boolean;
  segmentIds: string[];
  isRoadConnected: boolean;
  hasRouteDistance: boolean;
  generatorCalled: boolean;
  generatorReturnedContract: boolean;
  contractId: string | null;
  insertedIntoStore: boolean;
  storeCountBefore: number;
  storeCountAfter: number;
  survivesPostProcessing: boolean;
  visibleInSelector: boolean;
  renderedByUI: boolean;
  result: DebugContractTraceResult;
  reason?: DebugContractSkipReason | 'assert-failed' | 'ok';
}

export interface DebugContractGenerationResult {
  batchId: string;
  originCityId: string;
  createdDestinations: string[];
  skippedDestinations: DebugContractSkip[];
  createdCount: number;
  /** Contracts that survived store insert + selector membership */
  storedCount: number;
  storedDestinations: string[];
  contracts: Contract[];
  forceUnlockCities: boolean;
  traces: DebugContractTrace[];
}

export function resolveDebugOriginCityId(
  trucks: Truck[] | undefined,
  homeCityId?: string,
): string {
  const fallback = normalizeCityId(homeCityId ?? DEFAULT_TRUCK_CITY_ID);
  const idle = getIdleTrucks(trucks);

  if (idle.length === 0) {
    return fallback;
  }

  const atHome = idle.find(
    (truck) => resolveTruckCityId(truck, fallback) === fallback,
  );
  if (atHome) {
    return resolveTruckCityId(atHome, fallback);
  }

  return resolveTruckCityId(idle[0], fallback);
}

export function createDebugContractBatchId(currentTime: number): string {
  return `dbg_${Math.floor(currentTime * 1000)}_${Math.floor(Math.random() * 1_000_000)}`;
}

function findSegmentIdsBetween(fromCityId: string, toCityId: string): string[] {
  const from = normalizeCityId(fromCityId);
  const to = normalizeCityId(toCityId);
  return MAP_ROAD_SEGMENTS.filter((segment) => {
    const a = normalizeCityId(segment.fromCityId);
    const b = normalizeCityId(segment.toCityId);
    return (a === from && b === to) || (a === to && b === from);
  }).map((segment) => segment.id);
}

function withForcedMarketGap(city: City, productId: string, mode: 'surplus' | 'shortage'): City {
  const market = city.products[productId as keyof typeof city.products];
  if (!market) {
    return city;
  }

  const targetStock = Math.max(market.targetStock, 40);
  const nextMarket =
    mode === 'surplus'
      ? { ...market, stock: targetStock + 220, targetStock }
      : { ...market, stock: Math.max(5, targetStock - 120), targetStock };

  return {
    ...city,
    products: {
      ...city.products,
      [productId]: nextMarket,
    },
  };
}

function logDev(tag: string, payload: unknown): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (!debugConfig.debugContractGenerationLogsEnabled) return;
  console.log(tag, payload);
}

/**
 * Explicit origin→destination contract using the real product generator.
 * Pass bypassCityUnlockOnly for documentation; generator itself has no city-unlock gate.
 */
export function generateContractForRoute(params: {
  originCity: City;
  destinationCity: City;
  routes: Route[];
  products: Product[];
  globalEconomy: GlobalEconomy;
  currentTime: number;
  playerLevel: number;
  playerReputation?: number;
  maxTruckCapacity?: number;
  sequence?: number;
  /** Debug options — does not alter normal generateContracts path */
  debugOptions?: {
    bypassCityUnlock?: boolean;
    bypassRoadGraph?: boolean;
  };
}): Contract | null {
  const {
    originCity,
    destinationCity,
    routes,
    products,
    globalEconomy,
    currentTime,
    playerLevel,
    playerReputation = 0,
    maxTruckCapacity,
    sequence,
  } = params;

  const originCityId = normalizeCityId(originCity.id);
  const destinationCityId = normalizeCityId(destinationCity.id);

  if (originCityId === destinationCityId) {
    logDev('[debug-contract-generator-result]', {
      originCityId,
      destinationCityId,
      success: false,
      contractId: null,
      cargoType: null,
      requiredLevel: null,
      failureReason: 'same-city',
    });
    return null;
  }

  const route = getRouteBetweenCities(routes, originCity.id, destinationCity.id);
  if (!route) {
    logDev('[debug-contract-generator-result]', {
      originCityId,
      destinationCityId,
      success: false,
      contractId: null,
      cargoType: null,
      requiredLevel: null,
      failureReason: 'distance-not-found',
    });
    return null;
  }

  const range = getContractTonnageRangeForLevel(playerLevel);
  const cappedMax = Math.min(
    range.maxTonnage,
    Math.max(range.minTonnage, maxTruckCapacity ?? range.maxTonnage),
  );

  for (const product of products) {
    if (!originCity.products[product.id] || !destinationCity.products[product.id]) {
      continue;
    }

    const contract = generateContractForProduct({
      originCity,
      destinationCity,
      productId: product.id,
      product,
      route,
      globalEconomy,
      currentTime,
      playerLevel,
      playerReputation,
      maxTruckCapacity: cappedMax,
      minTonnage: range.minTonnage,
      maxTonnage: cappedMax,
      sequence,
    });
    if (contract) {
      logDev('[debug-contract-generator-result]', {
        originCityId,
        destinationCityId,
        success: true,
        contractId: contract.id,
        cargoType: contract.productId,
        requiredLevel: contract.requiredLevel ?? 1,
        failureReason: null,
      });
      return contract;
    }
  }

  const fallbackProduct = products[0];
  if (!fallbackProduct) {
    logDev('[debug-contract-generator-result]', {
      originCityId,
      destinationCityId,
      success: false,
      contractId: null,
      cargoType: null,
      requiredLevel: null,
      failureReason: 'cargo-catalog-empty',
    });
    return null;
  }

  const fallback = generateContractForProduct({
    originCity: withForcedMarketGap(originCity, fallbackProduct.id, 'surplus'),
    destinationCity: withForcedMarketGap(destinationCity, fallbackProduct.id, 'shortage'),
    productId: fallbackProduct.id,
    product: fallbackProduct,
    route,
    globalEconomy,
    currentTime,
    playerLevel,
    playerReputation,
    maxTruckCapacity: cappedMax,
    minTonnage: range.minTonnage,
    maxTonnage: cappedMax,
    sequence: sequence ?? Date.now() % 1_000_000,
  });

  logDev('[debug-contract-generator-result]', {
    originCityId,
    destinationCityId,
    success: !!fallback,
    contractId: fallback?.id ?? null,
    cargoType: fallback?.productId ?? fallbackProduct.id,
    requiredLevel: fallback?.requiredLevel ?? null,
    failureReason: fallback ? null : 'market-gap-or-tonnage',
  });

  return fallback;
}

export function generateDebugContractsFromCurrentCity(params: {
  cities: City[];
  routes: Route[];
  products: Product[];
  globalEconomy: GlobalEconomy;
  trucks: Truck[];
  homeCityId?: string;
  playerLevel: number;
  playerReputation?: number;
  currentTime: number;
  maxTruckCapacity?: number;
  cityIds?: readonly string[];
  /**
   * When true (default), locked / uncalibrated destinations are skipped.
   * Debug UI passes false to force-unlock and allow list jobs without calibrated roads.
   */
  respectCityUnlockRules?: boolean;
  batchId?: string;
  storeCountBefore?: number;
}): DebugContractGenerationResult {
  const respectCityUnlockRules = params.respectCityUnlockRules !== false;
  const forceUnlockCities = !respectCityUnlockRules;
  const playerLevel = Math.max(1, params.playerLevel ?? 1);
  const batchId = params.batchId ?? createDebugContractBatchId(params.currentTime);
  const storeCountBefore = params.storeCountBefore ?? 0;

  // Always resolve against canonical catalog — old saves may omit expanded cities/routes.
  const cities = mergeCanonicalCities(params.cities?.length ? params.cities : CITIES);
  const routes = mergeCanonicalRoutes(params.routes);

  const originCityId = resolveDebugOriginCityId(params.trucks, params.homeCityId);
  const originCity = cities.find((city) => normalizeCityId(city.id) === originCityId);

  const createdDestinations: string[] = [];
  const skippedDestinations: DebugContractSkip[] = [];
  const contracts: Contract[] = [];
  const traces: DebugContractTrace[] = [];
  const seenDestinations = new Set<string>();

  logDev('[debug-contract-runtime]', {
    playerLevel,
    currentCityId: originCityId,
    cityIds: (params.cityIds ?? CITY_IDS).map((id) => normalizeCityId(id)),
    storeCityIds: cities.map((c) => normalizeCityId(c.id)),
    existingContractCount: storeCountBefore,
    respectCityUnlockRules,
    forceUnlockCities,
    currentGameTime: params.currentTime,
    batchId,
  });

  const emptyResult = (
    reason: DebugContractSkipReason,
  ): DebugContractGenerationResult => ({
    batchId,
    originCityId,
    createdDestinations,
    skippedDestinations: [
      { originCityId, destinationCityId: originCityId, reason },
    ],
    createdCount: 0,
    storedCount: 0,
    storedDestinations: [],
    contracts,
    forceUnlockCities,
    traces,
  });

  if (!originCity) {
    return emptyResult('invalid-city');
  }

  const destinationIds = (params.cityIds ?? CITY_IDS)
    .map((id) => normalizeCityId(id))
    .filter((id) => id !== originCityId);

  let sequence = Math.floor(params.currentTime * 100) % 100_000;

  for (const destinationCityId of destinationIds) {
    const unlockLevel = getCityUnlockLevel(destinationCityId);
    const isUnlocked = isWarehouseCityUnlocked(destinationCityId, playerLevel);
    const unlockBypassed = forceUnlockCities && !isUnlocked;
    const segmentIds = findSegmentIdsBetween(originCityId, destinationCityId);
    const isRoadConnected = isRoadGraphPairConnected(originCityId, destinationCityId);
    const hasRouteDistance = !!getRouteBetweenCities(routes, originCityId, destinationCityId);
    const destinationCity = cities.find(
      (city) => normalizeCityId(city.id) === destinationCityId,
    );
    const cityExists = destinationCity != null;

    const baseTrace = (): DebugContractTrace => ({
      batchId,
      originCityId,
      destinationCityId,
      cityExists,
      playerLevel,
      unlockLevel,
      isUnlocked,
      unlockBypassed,
      roadBypassed: false,
      segmentIds,
      isRoadConnected,
      hasRouteDistance,
      generatorCalled: false,
      generatorReturnedContract: false,
      contractId: null,
      insertedIntoStore: false,
      storeCountBefore,
      storeCountAfter: storeCountBefore,
      survivesPostProcessing: false,
      visibleInSelector: false,
      renderedByUI: false,
      result: 'skipped',
      reason: undefined,
    });

    const pushSkip = (reason: DebugContractSkipReason, extra?: Partial<DebugContractTrace>) => {
      const skip: DebugContractSkip = { originCityId, destinationCityId, reason };
      skippedDestinations.push(skip);
      const trace: DebugContractTrace = {
        ...baseTrace(),
        ...extra,
        result: 'skipped',
        reason,
      };
      traces.push(trace);
      logDev('[debug-contract-trace]', trace);
    };

    if (seenDestinations.has(destinationCityId)) {
      pushSkip('duplicate');
      continue;
    }
    seenDestinations.add(destinationCityId);

    if (!cityExists) {
      pushSkip('invalid-city');
      continue;
    }

    if (respectCityUnlockRules && !isUnlocked) {
      pushSkip('locked');
      continue;
    }

    const roadBypassed = forceUnlockCities && !isRoadConnected;
    if (!isRoadConnected && !forceUnlockCities) {
      pushSkip('unreachable');
      continue;
    }

    if (!hasRouteDistance) {
      pushSkip('missing-route', { roadBypassed });
      continue;
    }

    sequence += 1;
    const contract = generateContractForRoute({
      originCity,
      destinationCity: destinationCity!,
      routes,
      products: params.products,
      globalEconomy: params.globalEconomy,
      currentTime: params.currentTime,
      playerLevel,
      playerReputation: params.playerReputation,
      maxTruckCapacity: params.maxTruckCapacity,
      sequence,
      debugOptions: {
        bypassCityUnlock: forceUnlockCities,
        bypassRoadGraph: forceUnlockCities,
      },
    });

    if (!contract) {
      pushSkip('generator-failed', {
        roadBypassed,
        generatorCalled: true,
        generatorReturnedContract: false,
      });
      continue;
    }

    createdDestinations.push(destinationCityId);
    contracts.push(contract);

    const trace: DebugContractTrace = {
      ...baseTrace(),
      roadBypassed,
      generatorCalled: true,
      generatorReturnedContract: true,
      contractId: contract.id,
      result: 'created',
      reason: 'ok',
    };
    traces.push(trace);
    logDev('[debug-contract-trace]', trace);
  }

  logDev('[debug-contract-generation]', {
    batchId,
    originCityId,
    forceUnlockCities,
    respectCityUnlockRules,
    createdDestinations,
    skippedDestinations,
    createdCount: contracts.length,
  });

  return {
    batchId,
    originCityId,
    createdDestinations,
    skippedDestinations,
    createdCount: contracts.length,
    storedCount: 0,
    storedDestinations: [],
    contracts,
    forceUnlockCities,
    traces,
  };
}

/** After store merge: mark traces with insert / selector visibility. */
export function finalizeDebugContractTraces(params: {
  result: DebugContractGenerationResult;
  storeContractsBefore: Contract[];
  storeContractsAfter: Contract[];
}): DebugContractGenerationResult {
  const { result, storeContractsBefore, storeContractsAfter } = params;
  const storeCountBefore = storeContractsBefore.length;
  const storeCountAfter = storeContractsAfter.length;
  const afterIds = new Set(storeContractsAfter.map((c) => c.id));
  const visible = selectAvailableContractsForUi(storeContractsAfter);
  const visibleIds = new Set(visible.map((c) => c.id));

  const storedDestinations: string[] = [];
  const traces = result.traces.map((trace) => {
    if (!trace.contractId || trace.result === 'skipped') {
      return { ...trace, storeCountBefore, storeCountAfter };
    }

    const insertedIntoStore = afterIds.has(trace.contractId);
    const survivesPostProcessing = insertedIntoStore;
    const visibleInSelector = visibleIds.has(trace.contractId);
    const renderedByUI = visibleInSelector;

    let nextResult: DebugContractTraceResult = 'created';
    let reason: DebugContractTrace['reason'] = 'ok';
    if (!insertedIntoStore) {
      nextResult = 'lost-in-store';
      reason = 'assert-failed';
    } else if (!survivesPostProcessing) {
      nextResult = 'lost-in-post';
      reason = 'assert-failed';
    } else if (!visibleInSelector) {
      nextResult = 'hidden-in-ui';
      reason = 'filtered-from-ui';
    } else {
      storedDestinations.push(trace.destinationCityId);
    }

    const next: DebugContractTrace = {
      ...trace,
      insertedIntoStore,
      storeCountBefore,
      storeCountAfter,
      survivesPostProcessing,
      visibleInSelector,
      renderedByUI,
      result: nextResult,
      reason,
    };
    logDev('[debug-contract-trace]', next);
    logDev('[debug-contract-created]', {
      contractId: trace.contractId,
      originCityId: trace.originCityId,
      destinationCityId: trace.destinationCityId,
      stored: insertedIntoStore,
      visibleInCurrentList: visibleInSelector,
    });
    return next;
  });

  const selectorSnap = inspectContractsUiSelector({
    contracts: storeContractsAfter,
    currentCityId: result.originCityId,
    originCityId: result.originCityId,
    destinationCityId: 'adana',
  });
  logDev('[contracts-ui-selector]', selectorSnap);

  return {
    ...result,
    traces,
    storedCount: storedDestinations.length,
    storedDestinations,
  };
}

export function assertDebugAnkaraAdanaContract(params: {
  originCityId: string;
  storeContracts: Contract[];
  batchId: string;
}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  if (normalizeCityId(params.originCityId) !== 'ankara') {
    return;
  }

  const found = params.storeContracts.find(
    (contract) =>
      contract.status === 'available' &&
      normalizeCityId(contract.originCityId) === 'ankara' &&
      normalizeCityId(contract.destinationCityId) === 'adana',
  );

  if (!found) {
    console.error('[debug-contract-assert-failed]', {
      message: 'Ankara → Adana contract missing after store update',
      batchId: params.batchId,
      availableCount: params.storeContracts.filter((c) => c.status === 'available').length,
    });
  }
}

export function reportUncalibratedExtendedSegments(originCityId: string): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }

  const adjacency = getRoadGraphAdjacency();
  for (const segmentId of ['ankara-trabzon', 'adana-diyarbakir'] as const) {
    const segment = getMapRoadSegmentById(segmentId);
    const from = segment ? normalizeCityId(segment.fromCityId) : null;
    const to = segment ? normalizeCityId(segment.toCityId) : null;
    const includedInGraph =
      !!segment &&
      isMapRoadSegmentRoutable(segment) &&
      !!from &&
      !!to &&
      (adjacency.get(from) ?? []).some((edge) => edge.toCityId === to);

    console.log('[debug-extended-segment]', {
      id: segmentId,
      isCalibrated: segment?.isCalibrated === true,
      pointCount: segment?.points.length ?? 0,
      includedInGraph,
      connectedFromCurrentCity: isRoadGraphPairConnected(
        originCityId,
        segmentId === 'ankara-trabzon' ? 'trabzon' : 'diyarbakir',
      ),
    });
  }
}

export type DebugContractsInspectResult = {
  storeMatches: Contract[];
  selectorMatches: Contract[];
  visible: boolean;
  failureReason: string | null;
};

export function inspectDebugContractPair(
  contracts: Contract[],
  originCityId: string,
  destinationCityId: string,
): DebugContractsInspectResult {
  const origin = normalizeCityId(originCityId);
  const destination = normalizeCityId(destinationCityId);

  const storeMatches = (contracts ?? []).filter(
    (c) =>
      normalizeCityId(c.originCityId) === origin &&
      normalizeCityId(c.destinationCityId) === destination,
  );
  const selectorMatches = selectAvailableContractsForUi(contracts).filter(
    (c) =>
      normalizeCityId(c.originCityId) === origin &&
      normalizeCityId(c.destinationCityId) === destination,
  );

  if (storeMatches.length === 0) {
    return {
      storeMatches,
      selectorMatches,
      visible: false,
      failureReason: 'not-in-store',
    };
  }
  if (selectorMatches.length === 0) {
    const statuses = storeMatches.map((c) => c.status);
    return {
      storeMatches,
      selectorMatches,
      visible: false,
      failureReason: `in-store-but-not-available:${statuses.join(',')}`,
    };
  }
  return {
    storeMatches,
    selectorMatches,
    visible: true,
    failureReason: null,
  };
}

/** Install globalThis.__debugContracts in __DEV__ */
export function installDebugContractsInspector(
  getContracts: () => Contract[],
  getOriginHint?: () => string | null,
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  const root = globalThis as typeof globalThis & {
    __debugContracts?: {
      inspect: (originCityId: string, destinationCityId: string) => DebugContractsInspectResult;
    };
  };
  root.__debugContracts = {
    inspect: (originCityId, destinationCityId) => {
      const result = inspectDebugContractPair(getContracts(), originCityId, destinationCityId);
      logDev('[debug-contracts-inspect]', {
        originCityId,
        destinationCityId,
        originHint: getOriginHint?.() ?? null,
        ...result,
        storeMatchIds: result.storeMatches.map((c) => c.id),
        selectorMatchIds: result.selectorMatches.map((c) => c.id),
      });
      return result;
    },
  };
}
