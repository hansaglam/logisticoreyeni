import { calculateCompanyScore } from '../simulation/companyScore';
import type { SaveGamePayload } from '../storage/saveGame';
import type { StoreGameState } from '../types/game';

export interface CloudSaveSummary {
  companyName: string;
  money: number;
  level: number;
  xp: number;
  companyScore: number;
  completedDeliveries: number;
  trucksCount: number;
  warehousesCount: number;
  lastGameTime: number;
  lastLocalSaveAt: number;
  driversCount?: number;
  trailersCount?: number;
  activeJobsCount?: number;
  progressionScore?: number;
  saveVersion?: number;
}

export function buildCloudSaveSummary(
  gameState: StoreGameState,
  lastLocalSaveAt?: number,
): CloudSaveSummary {
  const companyScore = calculateCompanyScore({
    player: gameState.player,
    cities: gameState.cities,
    products: gameState.products,
    financeLedger: gameState.financeLedger ?? [],
    currentTime: gameState.currentTime,
  });

  return {
    companyName: gameState.player?.companyName ?? 'LogistiCore Lojistik',
    money: gameState.player?.money ?? 0,
    level: gameState.player?.level ?? gameState.player?.companyLevel ?? 1,
    xp: gameState.player?.xp ?? 0,
    companyScore,
    completedDeliveries: gameState.player?.completedContracts ?? 0,
    trucksCount: gameState.player?.trucks?.length ?? 0,
    warehousesCount: gameState.player?.warehouses?.length ?? 0,
    lastGameTime: gameState.currentTime ?? 0,
    lastLocalSaveAt: lastLocalSaveAt ?? Date.now(),
    driversCount: gameState.player?.drivers?.length ?? 0,
    trailersCount: gameState.player?.trailers?.length ?? 0,
    activeJobsCount:
      (gameState.activeDeliveries?.length ?? 0) +
      (gameState.activeTransfers?.length ?? 0) +
      (gameState.activeWarehouseStockTransfers?.length ?? 0),
    progressionScore: companyScore,
  };
}

export function buildCloudSaveSummaryFromPayload(payload: SaveGamePayload): CloudSaveSummary {
  return {
    companyName: payload.meta.companyName ?? 'LogistiCore Lojistik',
    money: payload.meta.cash ?? 0,
    level: payload.meta.level ?? 1,
    xp: payload.meta.xp ?? 0,
    companyScore: payload.meta.companyScore ?? 0,
    completedDeliveries: payload.meta.completedContracts ?? 0,
    trucksCount: payload.player.trucks?.length ?? 0,
    warehousesCount: payload.player.warehouses?.length ?? 0,
    lastGameTime: payload.currentTime ?? 0,
    lastLocalSaveAt: payload.meta.savedAt ?? Date.now(),
    driversCount: payload.player.drivers?.length ?? 0,
    trailersCount: payload.player.trailers?.length ?? 0,
    activeJobsCount:
      (payload.activeDeliveries?.length ?? 0) +
      (payload.activeTransfers?.length ?? 0) +
      (payload.activeWarehouseStockTransfers?.length ?? 0),
    progressionScore: payload.meta.companyScore ?? 0,
    saveVersion: payload.meta.saveVersion ?? payload.version,
  };
}
