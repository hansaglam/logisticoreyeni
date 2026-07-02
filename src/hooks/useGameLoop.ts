/**
 * Oyun zaman döngüsü — aktifken periyodik advanceTime çağırır.
 */

import { useEffect } from 'react';

import { useGameStore } from '../store/gameStore';

/** Gerçek zaman tick aralığı (ms) */
export const GAME_LOOP_TICK_MS = 500;

/** Her tick'te ilerletilen oyun saati */
export const GAME_HOURS_PER_TICK = 0.25;

export function useGameLoop() {
  const isGameReady = useGameStore((state) => state.isGameReady);
  const isPaused = useGameStore((state) => state.isPaused);
  const gameSpeed = useGameStore((state) => state.gameSpeed);

  useEffect(() => {
    if (!isGameReady || isPaused) {
      return;
    }

    const intervalMs = GAME_LOOP_TICK_MS / Math.max(gameSpeed, 0.25);

    const intervalId = setInterval(() => {
      useGameStore.getState().advanceTime(GAME_HOURS_PER_TICK);
    }, intervalMs);

    return () => clearInterval(intervalId);
  }, [gameSpeed, isGameReady, isPaused]);
}
