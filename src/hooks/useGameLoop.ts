/**
 * Oyun zaman döngüsü — aktifken periyodik advanceTime çağırır.
 */

import { useEffect } from 'react';

import { getMsPerGameHour } from '../config/balance';
import { useGameStore } from '../store/gameStore';

/** Gerçek zaman tick aralığı (ms) */
export const GAME_LOOP_TICK_MS = 1000;

export function getGameHoursPerTick(gameSpeed: number): number {
  const msPerGameHour = getMsPerGameHour(gameSpeed);
  return GAME_LOOP_TICK_MS / msPerGameHour;
}

export function useGameLoop() {
  const isGameReady = useGameStore((state) => state.isGameReady);
  const isPaused = useGameStore((state) => state.isPaused);
  const gameSpeed = useGameStore((state) => state.gameSpeed);

  useEffect(() => {
    if (!isGameReady || isPaused) {
      return;
    }

    const hoursPerTick = getGameHoursPerTick(gameSpeed);

    const intervalId = setInterval(() => {
      useGameStore.getState().advanceTime(hoursPerTick);
    }, GAME_LOOP_TICK_MS);

    return () => clearInterval(intervalId);
  }, [gameSpeed, isGameReady, isPaused]);
}
