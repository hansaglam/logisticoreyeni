/**
 * Oyun zaman döngüsü — aktifken periyodik advanceTime çağırır.
 */

import { useEffect } from 'react';

import { GAME_LOOP_TICK_MS, buildTimeScaleDebugSnapshot, getEffectiveOfflineGameSpeed, getGameHoursPerTick } from '../config/balance';
import { useGameStore } from '../store/gameStore';

export { GAME_LOOP_TICK_MS, getGameHoursPerTick } from '../config/balance';

export function useGameLoop(isAppActive = true) {
  const isGameReady = useGameStore((state) => state.isGameReady);
  const isPaused = useGameStore((state) => state.isPaused);
  const gameSpeed = useGameStore((state) => state.gameSpeed);
  const lastSimulationGameSpeed = useGameStore((state) => state.lastSimulationGameSpeed);

  useEffect(() => {
    if (!isGameReady || isPaused || !isAppActive) {
      return;
    }

    const simulationGameSpeed = getEffectiveOfflineGameSpeed({ gameSpeed, lastSimulationGameSpeed });
    const hoursPerTick = getGameHoursPerTick(simulationGameSpeed);

    if (__DEV__) {
      const scale = buildTimeScaleDebugSnapshot(simulationGameSpeed);
      console.log(
        `[time-debug-online] gameSpeed=${scale.gameSpeed} msPerGameHour=${scale.msPerGameHour} gameHoursPerTick=${scale.gameHoursPerTick.toFixed(4)} tickMs=${scale.tickMs} gameHoursPerRealMinute=${scale.gameHoursPerRealMinute.toFixed(2)}`,
      );
    }

    const intervalId = setInterval(() => {
      useGameStore.getState().advanceTime(hoursPerTick);
    }, GAME_LOOP_TICK_MS);

    return () => clearInterval(intervalId);
  }, [gameSpeed, isAppActive, isGameReady, isPaused, lastSimulationGameSpeed]);
}
