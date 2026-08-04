/**
 * Akıllı Oyun İpuçları — bağlamsal seçim ve rotasyon yardımcıları.
 * Ağır hesaplar burada; UI yalnızca sonucu gösterir.
 */

import {
  GAME_TIPS,
  type GameTipConditionKey,
  type GameTipDefinition,
  type GameTipTargetRoute,
} from '../data/gameTips';
import type { Delivery, Driver, Player, Trailer, Truck } from '../types/game';
import { getTruckFuelPercent } from '../utils/truckFuel';
import { getWarehouseUsedCapacityTon, normalizeWarehouse } from './trading';

export const SMART_TIP_ROTATION_MS = 10_000;
export const SMART_TIP_CRITICAL_ROTATION_MS = 16_000;
export const SMART_TIP_EARLY_SESSION_MS = 30 * 60 * 1000;
export const SMART_TIP_LOW_FUEL_PERCENT = 20;
export const SMART_TIP_WAREHOUSE_FULL_RATIO = 0.95;
export const SMART_TIP_LOW_REPUTATION = 40;
export const SMART_TIP_LOW_CONDITION = 40;
export const SMART_TIP_LOW_CASH = 8_000;
/** Oyun saati cinsinden teslimat aciliyeti eşiği */
export const SMART_TIP_URGENT_DEADLINE_HOURS = 4;

export interface SmartTipContext {
  minFuelPercent: number;
  idleTruckCount: number;
  trucksWithoutDriver: number;
  warehouseFillRatio: number;
  hasUrgentDelivery: boolean;
  accountLinked: boolean;
  reputation: number;
  minTruckCondition: number;
  trailerCount: number;
  sessionAgeMs: number;
  money: number;
}

export interface SmartTipSelection {
  tip: GameTipDefinition;
  isCritical: boolean;
  rotationMs: number;
  eligibleIds: string[];
}

export interface BuildSmartTipContextInput {
  player: Player | null | undefined;
  drivers?: Driver[] | null;
  trailers?: Trailer[] | null;
  activeDeliveries?: Delivery[] | null;
  currentTime: number;
  accountLinked: boolean;
  sessionAgeMs: number;
}

function getWarehouseFillRatio(player: Player, currentTime: number): number {
  const warehouses = player.warehouses ?? [];
  let totalCapacity = 0;
  let usedCapacity = 0;

  for (const warehouse of warehouses) {
    totalCapacity += warehouse.capacityTons ?? 0;
    usedCapacity += getWarehouseUsedCapacityTon(normalizeWarehouse(warehouse, currentTime));
  }

  return totalCapacity > 0 ? usedCapacity / totalCapacity : 0;
}

function countTrucksWithoutDriver(trucks: Truck[], drivers: Driver[]): number {
  if (trucks.length === 0) return 0;
  const assigned = new Set(
    drivers
      .map((driver) => driver.assignedTruckId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  return trucks.filter((truck) => !truck.leaseExpired && !assigned.has(truck.id)).length;
}

export function buildSmartTipContext(input: BuildSmartTipContextInput): SmartTipContext {
  const player = input.player;
  const trucks = player?.trucks ?? [];
  const drivers = input.drivers ?? player?.drivers ?? [];
  const trailers = input.trailers ?? player?.trailers ?? [];
  const deliveries = input.activeDeliveries ?? [];

  let minFuelPercent = 100;
  let minTruckCondition = 100;
  let idleTruckCount = 0;

  for (const truck of trucks) {
    if (truck.leaseExpired) continue;
    minFuelPercent = Math.min(minFuelPercent, getTruckFuelPercent(truck));
    minTruckCondition = Math.min(minTruckCondition, truck.condition ?? 100);
    if (truck.status === 'idle') {
      idleTruckCount += 1;
    }
  }

  if (trucks.length === 0) {
    minFuelPercent = 100;
    minTruckCondition = 100;
  }

  const hasUrgentDelivery = deliveries.some((delivery) => {
    if (delivery.status !== 'on_route' && delivery.status !== 'preparing') {
      return false;
    }
    const remaining = delivery.deadlineTime - input.currentTime;
    return Number.isFinite(remaining) && remaining <= SMART_TIP_URGENT_DEADLINE_HOURS;
  });

  return {
    minFuelPercent,
    idleTruckCount,
    trucksWithoutDriver: countTrucksWithoutDriver(trucks, drivers),
    warehouseFillRatio: player ? getWarehouseFillRatio(player, input.currentTime) : 0,
    hasUrgentDelivery,
    accountLinked: input.accountLinked,
    reputation: player?.reputation ?? 50,
    minTruckCondition,
    trailerCount: trailers.length,
    sessionAgeMs: Math.max(0, input.sessionAgeMs),
    money: player?.money ?? 0,
  };
}

export function isTipConditionMet(
  condition: GameTipConditionKey,
  context: SmartTipContext,
): boolean {
  switch (condition) {
    case 'always':
      return true;
    case 'early_session':
      return context.sessionAgeMs < SMART_TIP_EARLY_SESSION_MS;
    case 'low_fuel':
      return context.minFuelPercent < SMART_TIP_LOW_FUEL_PERCENT;
    case 'idle_truck':
      return context.idleTruckCount > 0;
    case 'truck_without_driver':
      return context.trucksWithoutDriver > 0;
    case 'warehouse_full':
      return context.warehouseFillRatio >= SMART_TIP_WAREHOUSE_FULL_RATIO;
    case 'delivery_urgent':
      return context.hasUrgentDelivery;
    case 'account_unlinked':
      return !context.accountLinked;
    case 'low_reputation':
      return context.reputation < SMART_TIP_LOW_REPUTATION;
    case 'low_condition':
      return context.minTruckCondition < SMART_TIP_LOW_CONDITION;
    case 'no_trailers':
      return context.trailerCount <= 0;
    case 'low_cash':
      return context.money < SMART_TIP_LOW_CASH;
    default:
      return false;
  }
}

export function getEligibleTips(
  context: SmartTipContext,
  catalog: readonly GameTipDefinition[] = GAME_TIPS,
): GameTipDefinition[] {
  return catalog
    .filter((tip) => isTipConditionMet(tip.condition, context))
    .slice()
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function getCriticalTips(eligible: readonly GameTipDefinition[]): GameTipDefinition[] {
  return eligible.filter((tip) => tip.critical === true && tip.condition !== 'always');
}

/**
 * Sonraki ipucu — aynı id art arda gelmez.
 * Kritik havuz varsa normal havuzun önüne geçer.
 */
export function pickNextTip(
  eligible: readonly GameTipDefinition[],
  previousTipId: string | null,
): SmartTipSelection | null {
  if (eligible.length === 0) {
    return null;
  }

  const critical = getCriticalTips(eligible);
  const pool = critical.length > 0 ? critical : eligible;
  const isCritical = critical.length > 0;

  let candidates = pool.filter((tip) => tip.id !== previousTipId);
  if (candidates.length === 0) {
    candidates = [...pool];
  }

  // Öncelik sırası korunur; aynı öncelikte deterministik id sırası.
  candidates.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const tip = candidates[0]!;

  return {
    tip,
    isCritical,
    rotationMs: isCritical ? SMART_TIP_CRITICAL_ROTATION_MS : SMART_TIP_ROTATION_MS,
    eligibleIds: eligible.map((item) => item.id),
  };
}

/** Manuel “sonraki” — rotasyonla aynı kurallar. */
export function advanceTip(
  context: SmartTipContext,
  previousTipId: string | null,
  catalog: readonly GameTipDefinition[] = GAME_TIPS,
): SmartTipSelection | null {
  return pickNextTip(getEligibleTips(context, catalog), previousTipId);
}

export function resolveTipNavigation(target: GameTipTargetRoute | null | undefined): {
  tab?: 'fleet' | 'contracts' | 'market' | 'map' | 'vehicleMarketplace' | 'more';
  moreSubRoute?: 'warehouse' | 'finance' | 'leaderboard' | null;
} | null {
  if (!target) return null;
  switch (target) {
    case 'fleet':
      return { tab: 'fleet' };
    case 'contracts':
      return { tab: 'contracts' };
    case 'market':
      return { tab: 'market' };
    case 'map':
      return { tab: 'map' };
    case 'vehicleMarketplace':
      return { tab: 'vehicleMarketplace' };
    case 'warehouse':
      return { tab: 'more', moreSubRoute: 'warehouse' };
    case 'finance':
      return { tab: 'more', moreSubRoute: 'finance' };
    case 'leaderboard':
      return { tab: 'more', moreSubRoute: 'leaderboard' };
    case 'account':
      return { tab: 'more', moreSubRoute: null };
    default:
      return null;
  }
}
