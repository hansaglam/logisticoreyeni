/**
 * Game-hour bucket selectors for UI subscriptions.
 * Simulation `currentTime` is unchanged — only render granularity is coarser.
 */

export function selectCurrentTimeQuarterHour(state: { currentTime: number }): number {
  return Math.floor(state.currentTime * 4) / 4;
}

export function selectCurrentTimeHour(state: { currentTime: number }): number {
  return Math.floor(state.currentTime);
}

export function selectCurrentTimeSixHour(state: { currentTime: number }): number {
  return Math.floor(state.currentTime / 6) * 6;
}

export function selectCurrentTimeGameDayAnchor(state: { currentTime: number }): number {
  return Math.floor(state.currentTime / 24) * 24;
}
