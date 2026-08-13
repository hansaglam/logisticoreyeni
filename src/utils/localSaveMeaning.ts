import type { StoreGameState } from '../types/game';
import { isLocalSaveSafeForAccountTransition } from './accountTransition';

/** Canonical starter defaults — must match createInitialGameState. */
export const STARTER_MONEY = 20_000;
export const STARTER_COMPANY_NAME = 'LogistiCore Lojistik';
export const STARTER_HOME_CITY_ID = 'izmir';

export type LocalSaveMeaning = {
  exists: boolean;
  meaningful: boolean;
  ownerUid?: string | null;
};

export function isMeaningfulLocalSave(state: StoreGameState): boolean {
  if (!isLocalSaveSafeForAccountTransition(state)) {
    return false;
  }

  const player = state.player;
  if (!player) {
    return false;
  }

  if ((player.completedContracts ?? 0) > 0) {
    return true;
  }

  if ((player.warehouses?.length ?? 0) > 0) {
    return true;
  }

  if ((player.trailers?.length ?? 0) > 0) {
    return true;
  }

  if ((player.trucks?.length ?? 0) > 1) {
    return true;
  }

  if ((player.level ?? 1) > 1 || (player.xp ?? 0) > 0) {
    return true;
  }

  const money = player.money ?? 0;
  if (Math.abs(money - STARTER_MONEY) > 1_000) {
    return true;
  }

  if ((state.currentTime ?? 0) > 24) {
    return true;
  }

  if (
    (state.activeDeliveries?.length ?? 0) > 0 ||
    (state.activeTransfers?.length ?? 0) > 0 ||
    (state.activeWarehouseStockTransfers?.length ?? 0) > 0
  ) {
    return true;
  }

  if (
    player.companyName &&
    player.companyName.trim().length > 0 &&
    player.companyName !== STARTER_COMPANY_NAME
  ) {
    return true;
  }

  if (player.homeCityId && player.homeCityId !== STARTER_HOME_CITY_ID) {
    return true;
  }

  return false;
}

export function classifyLocalSave(
  state: StoreGameState,
  options?: { ownerUid?: string | null; hasPersistedSave?: boolean },
): LocalSaveMeaning {
  const exists = options?.hasPersistedSave ?? isLocalSaveSafeForAccountTransition(state);
  return {
    exists,
    meaningful: exists ? isMeaningfulLocalSave(state) : false,
    ownerUid: options?.ownerUid ?? null,
  };
}
