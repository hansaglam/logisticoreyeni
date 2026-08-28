import type { Driver, Trailer, Truck, Warehouse } from '../../types/game';
import {
  EMPTY_ACTIVE_DELIVERIES,
  EMPTY_ACTIVE_TRANSFERS,
} from './stableCollections';

export const EMPTY_PLAYER_TRUCKS: Truck[] = [];
export const EMPTY_PLAYER_DRIVERS: Driver[] = [];
export const EMPTY_PLAYER_TRAILERS: Trailer[] = [];
export const EMPTY_PLAYER_WAREHOUSES: Warehouse[] = [];

export function selectHasPlayer(state: { player?: unknown | null }): boolean {
  return state.player != null;
}

export function selectPlayerMoney(state: { player?: { money?: number } | null }): number {
  return state.player?.money ?? 0;
}

export function selectPlayerLevel(state: {
  player?: { level?: number; companyLevel?: number } | null;
}): number {
  return Math.max(1, state.player?.level ?? state.player?.companyLevel ?? 1);
}

export function selectPlayerCompanyName(state: { player?: { companyName?: string } | null }): string {
  return state.player?.companyName ?? 'LogistiCore Lojistik';
}

export function selectPlayerReputation(state: { player?: { reputation?: number } | null }): number {
  return state.player?.reputation ?? 0;
}

export function selectPlayerHomeCityId(state: {
  player?: { homeCityId?: string } | null;
}): string | undefined {
  return state.player?.homeCityId;
}

export function selectPlayerCompletedContracts(state: {
  player?: { completedContracts?: number } | null;
}): number {
  return state.player?.completedContracts ?? 0;
}

export function selectPlayerXp(state: { player?: { xp?: number } | null }): number {
  return state.player?.xp ?? 0;
}

export function selectPlayerTotalXp(state: { player?: { totalXp?: number } | null }): number {
  return state.player?.totalXp ?? 0;
}

export function selectPlayerTrucks(state: { player?: { trucks?: Truck[] } | null }): Truck[] {
  const trucks = state.player?.trucks;
  return Array.isArray(trucks) ? trucks : EMPTY_PLAYER_TRUCKS;
}

export function selectPlayerDrivers(state: { player?: { drivers?: Driver[] } | null }): Driver[] {
  const drivers = state.player?.drivers;
  return Array.isArray(drivers) ? drivers : EMPTY_PLAYER_DRIVERS;
}

export function selectPlayerTrailers(state: { player?: { trailers?: Trailer[] } | null }): Trailer[] {
  const trailers = state.player?.trailers;
  return Array.isArray(trailers) ? trailers : EMPTY_PLAYER_TRAILERS;
}

export function selectPlayerWarehouses(state: {
  player?: { warehouses?: Warehouse[] } | null;
}): Warehouse[] {
  const warehouses = state.player?.warehouses;
  return Array.isArray(warehouses) ? warehouses : EMPTY_PLAYER_WAREHOUSES;
}

/** Player reference for score/level helpers — still narrower than subscribing to unrelated store slices. */
export function selectPlayer(state: { player?: import('../../types/game').Player | null }) {
  return state.player ?? null;
}

export { EMPTY_ACTIVE_DELIVERIES, EMPTY_ACTIVE_TRANSFERS };
